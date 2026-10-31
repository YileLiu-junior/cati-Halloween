import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

const EXPIRES = new Date(Date.now() + 7 * 86_400_000).toISOString();
const IMAGE_PATH = "/api/jobs/test-order/image";

async function seedResult(request, petType = "cat") {
  const quizVersion = `${petType}-2026v4`;
  const session = await (await request.post("/api/sessions", { data: { petType, quizVersion, source: "history-test" } })).json();
  const result = await (await request.post("/api/results", { data: { ...session, petName: "馒头", optionIds: Array.from({ length: 10 }, (_, i) => `q${i + 1}a`) } })).json();
  return { ...session, result, petName: "馒头", petType, quizVersion, completedAt: new Date().toISOString() };
}

function readyOrder(patch = {}) {
  return {
    orderId: "test-order", photoId: "test-photo", status: "ready", free: true,
    roleId: "ghost", petType: "cat", roleName: "幽灵", petName: "馒头",
    imageUrl: IMAGE_PATH, expiresAt: EXPIRES, deliveredAt: new Date().toISOString(), ...patch,
  };
}

async function mockReadyOrder(page, order = readyOrder()) {
  const png = await readFile(new URL("../public/assets/illus-nurse.png", import.meta.url));
  await page.route("**/api/free-orders**", route => route.fulfill({ json: { order, feedback: null, free: { remaining: 1 } } }));
  await page.route("**/api/photos/test-photo", route => route.fulfill({ contentType: "image/jpeg", body: png }));
  await page.route(`**${IMAGE_PATH}`, route => route.fulfill({ contentType: "image/png", body: png }));
}

async function seed(page, entries) {
  await page.goto("/");
  await page.evaluate((state) => localStorage.setItem("peti:v1", JSON.stringify(state)), {
    history: entries,
    ...entries[entries.length - 1],
  });
  await page.goto("/result.html");
}

test("首页历史入口打开抽屉，并按历史角色显示缩略图", async ({ page, request }) => {
  const entry = await seedResult(request);
  await page.goto("/");
  await page.evaluate((state) => localStorage.setItem("peti:v1", JSON.stringify(state)), { history: [entry], ...entry });
  await page.reload();
  await expect(page.locator("#historySection")).toBeVisible();
  await expect(page.locator("#historyList .history-item")).toHaveCount(1);
  await expect(page.locator("#historyList img")).toHaveAttribute("src", /role-thumbnails/);
  await page.locator("#historyOpenBtn").click();
  const sheet = page.locator(".history-sheet");
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole("heading", { name: "毛孩子的万圣节档案" })).toBeVisible();
  await expect(sheet.locator(".history-result")).toHaveCount(1);
  await expect(sheet.locator(".history-result img")).toHaveAttribute("src", /role-thumbnails/);
  await expect(sheet.locator("#historyAvatarsEmpty")).toBeVisible();
  await page.locator("[data-history-close]").click();
  await expect(sheet).toBeHidden();
});

test("结果页历史入口展示上传照片与生成头像，可展开保存", async ({ page, request }) => {
  const entry = await seedResult(request);
  await mockReadyOrder(page);
  await seed(page, [entry]);
  await page.locator("[data-history-open]").click();
  const card = page.locator(".history-avatar");
  await expect(card).toHaveCount(1);
  await expect(card.locator('[data-shot="photo"] img')).toBeVisible();
  await expect(card.locator('[data-shot="avatar"] img')).toBeVisible();
  await expect(card.locator(".history-save")).toBeHidden();
  await card.locator(".history-avatar-toggle").click();
  await expect(card.locator(".history-avatar-toggle")).toHaveAttribute("aria-expanded", "true");
  await expect(card.locator(".history-save")).toBeVisible();
  await expect(card.locator(".history-save")).toHaveAttribute("href", /^blob:/);
  await expect(page.locator(".history-result .history-badge")).toHaveText("已生成");
  // 历史抽屉保存同样得到 JPG，不下载 PNG。
  const [download] = await Promise.all([page.waitForEvent("download"), card.locator(".history-save").click()]);
  expect(download.suggestedFilename()).toMatch(/\.jpg$/);
  const bytes = await readFile(await download.path());
  expect(bytes.subarray(0, 2).toString("hex")).toBe("ffd8");
});

test("320px 下首页与历史抽屉都不横向溢出", async ({ page, request }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  const entry = await seedResult(request);
  await mockReadyOrder(page);
  await seed(page, [entry]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.locator("[data-history-open]").click();
  await expect(page.locator(".history-avatar")).toHaveCount(1);
  await page.locator(".history-avatar-toggle").click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("超过 7 天的头像显示已过保留期，不再请求图片", async ({ page, request }) => {
  const entry = await seedResult(request);
  const expired = readyOrder({ expiresAt: new Date(Date.now() - 60_000).toISOString() });
  let imageRequests = 0;
  await mockReadyOrder(page, expired);
  page.on("request", (request_) => { if (request_.url().includes(IMAGE_PATH)) imageRequests++; });
  await seed(page, [entry]);
  await page.locator("[data-history-open]").click();
  const card = page.locator(".history-avatar");
  await expect(card.locator('[data-shot="photo"]')).toHaveText("已过保留期");
  await expect(card.locator('[data-shot="avatar"]')).toHaveText("已过保留期");
  expect(imageRequests).toBe(0);
});
