// 视觉自查截图：三页 + 导出免费卡
import { chromium } from "@playwright/test";
import fs from "fs";

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 420, height: 900 } });
fs.mkdirSync("shots", { recursive: true });

await p.goto("http://127.0.0.1:8788/");
await p.waitForTimeout(800);
await p.screenshot({ path: "shots/1-landing.png", fullPage: true });

await p.getByPlaceholder("我家猫").fill("馒头");
await p.getByRole("button", { name: "开始测试" }).click();
await p.waitForURL(/\/quiz$/);
await p.locator("#options .option").first().click();
await p.waitForTimeout(300);
await p.screenshot({ path: "shots/2-quiz.png", fullPage: true });

for (let i = 0; i < 10; i++) {
  await p.locator("#options .option").first().click();
  await p.locator("#nextBtn").click();
  await p.waitForTimeout(120);
}
await p.waitForURL(/\/result$/, { timeout: 15000 });
await p.waitForTimeout(1200);
await p.screenshot({ path: "shots/3-result.png", fullPage: true });

const [download] = await Promise.all([p.waitForEvent("download"), p.locator("#saveCardBtn").click()]);
await download.saveAs("shots/4-card.png");
console.log("shots saved:", fs.readdirSync("shots").join(", "));
await b.close();
