import { chromium as playwright } from "playwright-core";
import chromium from "@sparticuz/chromium";
import csvParser from "csv-parser";
import { ulid } from "ulid";

import { sql } from "../utils/database.js";
import { getIso2FromCountryName } from "../utils/countries.js";

export async function run(event) {
  try {
    const { startDate, endDate } = event;

    // Helper function to generate dates in range
    const getDatesInRange = (start, end) => {
      const dates = [];
      const current = new Date(start);
      const last = new Date(end);
      
      while (current <= last) {
        dates.push(new Date(current));
        current.setDate(current.getDate() + 1);
      }
      return dates;
    };

    const dateRange = getDatesInRange(startDate, endDate);
    console.log(`Processing ${dateRange.length} days from ${startDate} to ${endDate}`);

    const browser = await playwright.launch({
      args: chromium.args,
      executablePath: await chromium.executablePath(),
      headless: true,
    });

    const context = await browser.newContext({ acceptDownloads: true });
    const page = await context.newPage();
    
    // Login only once
    await page.goto("https://www.traffiqnet.com");
    await page.getByRole("button", { name: "Login" }).click();
    await page.waitForLoadState("domcontentloaded");
    await page.locator('input[id="1-email"]').fill("shamil.a@antetechnologies.com");
    await page.locator('input[name="password"]').fill("48s!8IDIFJSL");
    await page.getByLabel("Log In").click();

    // Process each date
    for (const currentDate of dateRange) {
      console.log(`Fetching data for ${currentDate.toISOString().split('T')[0]}`);
      
      await page.waitForLoadState("networkidle");
      await page.getByText("Reports").click();
      await page.getByText("Player").click();

      await page.waitForLoadState("networkidle");

      // Wait for the iframe to load
      const iframe = page.locator('iframe[title="Reporting Dashboard"]');

      await iframe.contentFrame().getByRole("button").click();
      await iframe.contentFrame().getByText("Select date range").click();
      await iframe
        .contentFrame()
        .locator("div")
        .filter({ hasText: /^Between$/ })
        .nth(2)
        .click();
      await iframe.contentFrame().getByTestId("menuitem-on").click();

      const formattedDate = currentDate
        .toLocaleDateString("en-US", {
          weekday: "short",
          month: "short",
          day: "2-digit",
        })
        .replace(/,/g, "");

      await iframe.contentFrame().getByLabel(formattedDate).click();

      await page.mouse.click(600, 300);
      await iframe.contentFrame().getByTestId("crumb-settings").click();
      const exportButtonBox = await iframe
        .contentFrame()
        .getByTestId("menuitem-export")
        .boundingBox();

      if (exportButtonBox !== null) {
        await page.mouse.move(
          exportButtonBox.x + exportButtonBox.width / 2,
          exportButtonBox.y + exportButtonBox.height / 2
        );
      }

      const jsonOption = iframe.contentFrame().getByTestId("menuitem-csv");

      const [download] = await Promise.all([
        page.waitForEvent("download", { timeout: 1000000 }),
        jsonOption.click(),
      ]);

      const reader = await download.createReadStream();
      const reports = [];
      const getData = () => {
        return new Promise((resolve) => {
          reader
            .pipe(csvParser())
            .on("data", (data) => {
              const trackingId = data.S4 || data.S3 || data.S2 || data.S1;
              let campaignId = null;
              let gclid = null;
              if (trackingId?.includes("$$")) {
                const subidParts = trackingId.split("$$");
                campaignId = subidParts[0].toUpperCase() || null;
                gclid = subidParts[1] || null;
              } else {
                gclid = trackingId;
              }

              reports.push({
                id: ulid(),
                brand: data.Brand,
                aff_partner: "TraffiqNet",
                offer: data.Offer,
                geo: getIso2FromCountryName(data["IP Country"]),
                click_count: null,
                reg_count: Number.parseInt(data.Reg),
                ftd_count: Number.parseInt(data.FTD),
                cpa: Number.parseFloat(data["CPA Earnings"]),
                click_id: gclid,
                traffic_type: data["Marketing Type"],
                date: currentDate,
                campaign_id: campaignId,
              });
            })
            .on("end", () => {
              resolve(reports);
            });
        });
      };

      for (const report of await getData()) {
        if (report.click_id) {
          await sql`insert into reports ${sql(
            report,
            Object.keys(report)
          )} on conflict on constraint report_duplicated do nothing`;
        }
      }
    }

    await browser.close();
  } catch (error) {
    throw new Error(error.message);
  } finally {
    await sql.end();
  }
}
