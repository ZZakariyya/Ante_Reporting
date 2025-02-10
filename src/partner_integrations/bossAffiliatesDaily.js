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

    await page.goto("https://ro-affiliate.bosspartners.com/login");

    await page.locator("input[name='username']").fill("ma-antetechnologie");
    await page.locator("input[name='password']").fill("Czm0}RBgA1");
    await page.locator("button[type='submit']").click();

    await page.waitForLoadState("networkidle");
    await page.locator('a[href="/reports"]').click();
    await page.waitForLoadState("networkidle");

    await page
      .locator('div[data-testid="datepicker-trigger"]')
      .locator("button")
      .nth(0)
      .click();
    await page.getByRole("button", { name: "Yesterday" }).click();
    await page.getByRole("button", { name: "Apply" }).click();
    await page.getByRole("button", { name: "All groups" }).click();
    await page.waitForLoadState("networkidle");

    await page.getByRole("button", { name: "Generate Report" }).click();
    await page.waitForLoadState("networkidle");

    const downloadButton = page.locator("label[aria-label='Download report']");
    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 1000000 }), // Wait for the download to start
      downloadButton.click(), // Click on the JSON menu item
    ]);

    const reader = await download.createReadStream();

    

    const reports = [];
    const date = new Date();
    date.setDate(date.getDate() - 1);
    const yesterday = date.toISOString().split("T")[0];

    const getData = () => {
      return new Promise((resolve) => {
        reader
          .pipe(csvParser())
          .on("data", async (data) => {
            const trackingId = data.subid || data.clickid;
            const subidParts = trackingId.split("$$");
            const campaignId = subidParts[0].toUpperCase() || null;
            const gclid = subidParts[1] || null;
            reports.push({
              id: ulid(),
              brand: data["Brand Name"],
              aff_partner: data["Program Name"],
              offer: data["Media Campaign Name"],
              geo: data.Geo,
              click_count: Number.parseInt(data["Click Count"]),
              reg_count: Number.parseInt(data["Reg. Count"]),
              ftd_count: Number.parseInt(data["FTD Count"]),
              cpa: Number.parseFloat(data.CPA),
              click_id: gclid,
              traffic_type: data["Traffic Type"],
              date: yesterday,
              campaign_id: campaignId,
            });
          })
          .on("end", async () => {
            resolve(reports);
          });
      });
    };

    for (const report of await getData()) {
      await sql`insert into reports ${sql(
        report,
        Object.keys(report)
      )} on conflict on constraint report_duplicated do nothing`;
    }

    await page.close();
    await browser.close();
  } catch (error) {
    throw new Error(error.message);
  } finally {
    await sql.end();
  }
}
