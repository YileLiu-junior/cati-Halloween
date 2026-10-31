// 视觉自查截图：三页 + 导出免费卡
import { chromium, expect } from "@playwright/test";
import fs from "fs";

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 420, height: 900 } });
fs.mkdirSync("shots", { recursive: true });

await p.goto("http://127.0.0.1:8788/");
await expect(p.locator("#startBtn")).toBeVisible();
await p.screenshot({ path: "shots/1-landing.png", fullPage: true });

await p.getByLabel("请输入宠物姓名", { exact: true }).fill("馒头");
await p.getByRole("button", { name: "开始测试" }).click();
await p.waitForURL(/\/quiz$/);
await expect(p.locator("#options .option")).toHaveCount(5);
await p.screenshot({ path: "shots/2-quiz.png", fullPage: true });

for (let i = 0; i < 10; i++) {
  await expect(p.locator("#progress")).toHaveText(`第 ${i + 1} / 10 题`);
  await p.locator("#options .option").first().click();
}
await p.waitForURL(/\/result(?:\.html)?(?:\?.*)?$/, { timeout: 15000 });
await expect(p.locator("#saveCardBtn")).toBeEnabled();
await expect(p.locator("#roleName")).toBeVisible();
await p.screenshot({ path: "shots/3-result.png", fullPage: true });

const [download] = await Promise.all([p.waitForEvent("download"), p.locator("#saveCardBtn").click()]);
await download.saveAs("shots/4-card.png");
console.log("shots saved:", fs.readdirSync("shots").join(", "));
await b.close();
