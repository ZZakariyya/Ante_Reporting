import { chromium as playwright } from "playwright-core";
import chromium from "@sparticuz/chromium";
import csvParser from "csv-parser";
import { ulid } from "ulid";

import { sql } from "../utils/database.js";

export async function run() {
  try {
    console.log("TEST", await sql`select now()`);

    const browser = await playwright.launch({
      args: chromium.args,
      executablePath: await chromium.executablePath(),
      headless: true,
    });

    const context = await browser.newContext({ acceptDownloads: true });
    const page = await context.newPage();
    await page.goto("http://partners.ivyaffiliates.com/login.asp");

    await page.locator("input[name='username']").fill("antecpa");
    await page.locator("input[name='password']").fill("78huiyd9whkid");
    await page.getByRole("button", { name: "Login" }).click();
    await page.getByRole("button", { name: "Reports" }).click();
    await page.getByRole("link", { name: "ACID Report" }).click();
    await page
      .locator("iframe")
      .contentFrame()
      .locator("#DatePeriod")
      .getByLabel("kendo.combobox.")
      .click();
    await page
      .locator("iframe")
      .contentFrame()
      .getByRole("option", { name: "Today" })
      .click();
    await page
      .locator("iframe")
      .contentFrame()
      .locator("#MerchantId")
      .getByLabel("kendo.combobox.")
      .click();
    await page
      .locator("iframe")
      .contentFrame()
      .getByRole("option", { name: "All Merchants" })
      .click();
    await page
      .locator("iframe")
      .contentFrame()
      .locator("label")
      .filter({ hasText: "Date" })
      .nth(2)
      .click();
    await page
      .locator("iframe")
      .contentFrame()
      .locator("label")
      .filter({ hasText: "Merchant" })
      .nth(1)
      .click();
    await page
      .locator("iframe")
      .contentFrame()
      .getByRole("button", { name: "Generate Report" })
      .click();

    await page
      .locator("iframe")
      .contentFrame()
      .locator(".k-master-row > td")
      .first()
      .waitFor();

    await page
      .locator("iframe")
      .contentFrame()
      .getByRole("button", { name: "Export" })
      .click();
    const downloadPromise = page.waitForEvent("download");
    await page
      .locator("iframe")
      .contentFrame()
      .getByRole("menuitem", { name: "CSV (Unicode/UTF-8)" })
      .locator("span")
      .first()
      .click();
    const download = await downloadPromise;

    const reader = await download.createReadStream();

    const reports = [];

    const getData = () => {
      return new Promise((resolve) => {
        reader
          .pipe(csvParser())
          .on("data", (data) => {
            const trackingId = data.ACID;
            let campaignId = null;
            let gclid = null;
            if (trackingId?.includes("$$")) {
              const subidParts = trackingId.split("$$");
              campaignId = subidParts[0].toUpperCase() || null;
              gclid = subidParts[1] || null;
            } else {
              gclid = trackingId;
            }

            if (data["Affiliate ID"]) {
              reports.push({
                id: ulid(),
                brand: data.Merchant,
                aff_partner: "IvyAffiliates",
                offer: data["Site Name"],
                geo: null,
                click_count: Number.parseInt(data.Clicks),
                reg_count: Number.parseInt(data.Registrations),
                ftd_count: Number.parseInt(data["First Deposit Count"]),
                cpa: Number.parseFloat(data["CPA Commission"]),
                click_id: gclid,
                traffic_type: null,
                date: data.Period,
                campaign_id: campaignId,
              });
            }
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

    await browser.close();
  } catch (error) {
    throw new Error(error.message);
  } finally {
    await sql.end();
  }
}
