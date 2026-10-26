// quiz MVP 功能验收（对照 PRD-quiz §10 验收标准的可执行子集）
import { test, expect } from "@playwright/test";

// 回答前 n 题（不点末题提交）；n=10 时等价于完成整场
async function answerN(page, n, pick = 0) {
  for (let i = 0; i < n; i++) {
    await expect(page.locator("#options .option")).toHaveCount(4);
    await page.locator("#options .option").nth(pick).click();
    await page.locator("#nextBtn").click();
    await page.waitForTimeout(80);
  }
}

async function startQuiz(page, name) {
  await page.goto("/");
  if (name) await page.getByPlaceholder("我家猫").fill(name);
  await page.getByRole("button", { name: "开始测试" }).click();
  await expect(page).toHaveURL(/\/quiz$/);
  await expect(page.locator("#options .option").first()).toBeVisible();
}

test.describe("落地页", () => {
  test("头图/双入口/命名框渲染，未选答案时下一题禁用", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".hero")).toBeVisible();
    await expect(page.locator("text=请输入你好奇的宠物的名字")).toBeVisible();
    await expect(page.getByRole("button", { name: /猫咪/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /狗狗/ })).toBeVisible();

    await page.getByPlaceholder("我家猫").fill("馒头");
    await page.getByRole("button", { name: "开始测试" }).click();
    await expect(page).toHaveURL(/\/quiz$/);
    await expect(page.locator("#progress")).toHaveText("第 1 / 10 题");
    await expect(page.locator("#nextBtn")).toBeDisabled(); // PRD §10.4
    await page.locator("#options .option").first().click();
    await expect(page.locator("#nextBtn")).toBeEnabled();
  });

  test("名字超 12 字报错并保留输入（PRD §5.2）", async ({ page }) => {
    await page.goto("/");
    await page.getByPlaceholder("我家猫").fill("一二三四五六七八九十十一二");
    await page.getByRole("button", { name: "开始测试" }).click();
    await expect(page.locator("#nameError")).toContainText("1–12 字");
    await expect(page.locator("#petName")).toHaveValue("一二三四五六七八九十十一二");
  });
});

test.describe("答题", () => {
  test("洗牌稳定：刷新后选项顺序不变（PRD §10.1）", async ({ page }) => {
    await startQuiz(page); // 空名 → 默认我家猫
    const textsBefore = await page.locator("#options .option").allTextContents();
    await page.reload();
    await expect(page.locator("#options .option").first()).toBeVisible();
    const textsAfter = await page.locator("#options .option").allTextContents();
    expect(textsAfter).toEqual(textsBefore);
    expect(textsBefore.length).toBe(4);
  });

  test("上一题保留已选答案与顺序；进度推进", async ({ page }) => {
    await startQuiz(page);
    await page.locator("#options .option").nth(1).click();
    await page.locator("#nextBtn").click();
    await expect(page.locator("#progress")).toHaveText("第 2 / 10 题");
    await page.locator("#prevBtn").click();
    await expect(page.locator("#progress")).toHaveText("第 1 / 10 题");
    await expect(page.locator("#options .option.selected")).toHaveCount(1);
  });

  test("末题按钮文字为「揭晓身份」，提交进结果页", async ({ page }) => {
    await startQuiz(page);
    await answerN(page, 9);
    await expect(page.locator("#nextBtn")).toHaveText("揭晓身份"); // PRD §10.4
    await expect(page.locator("#nextBtn")).toBeDisabled(); // 末题未选仍禁用
    await page.locator("#options .option").first().click();
    await page.locator("#nextBtn").click();
    await expect(page).toHaveURL(/\/result$/, { timeout: 15_000 });
  });
});

test.describe("结果页与接口", () => {
  let session; // { testId, token, publicId, state }

  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    await startQuiz(page, "馒头");
    await answerN(page, 10);
    await expect(page).toHaveURL(/\/result$/, { timeout: 15_000 });
    await expect(page.locator("#roleName")).toBeVisible();
    const state = await page.evaluate(() => JSON.parse(localStorage.getItem("peti:v1")));
    session = { testId: state.testId, token: state.token, publicId: state.result.publicId, state };
    await page.close();
  });

  // 同一浏览器的「继续上次」语义：播种 localStorage 后直接开结果页
  async function newSeededPage(browser) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.addInitScript((s) => localStorage.setItem("peti:v1", JSON.stringify(s)), session.state);
    await page.goto("/result.html");
    await expect(page.locator("#roleName")).toBeVisible();
    return page;
  }

  test("结果页：角色名后缀/公开编号/稀有度/雷达图/宠物名（PRD §5/§10.7）", async ({ browser }) => {
    const page = await newSeededPage(browser);
    await expect(page.locator("#roleName")).toHaveText(/咪$/);
    await expect(page.locator("#publicId")).toHaveText(session.publicId);
    await expect(page.locator("#rarity")).toContainText("全站仅");
    await expect(page.locator("#rarity")).toContainText("毛孩子");
    await expect(page.locator("#petNameText")).toHaveText("馒头");
    const radarPainted = await page.$eval("#radar", (c) => c.getContext("2d").getImageData(0, 0, c.width, c.height).data.some((v) => v !== 0));
    expect(radarPainted).toBe(true);
  });

  test("保存免费卡导出非空 PNG（PRD §10.7）", async ({ browser }) => {
    const page = await newSeededPage(browser);
    const [download] = await Promise.all([page.waitForEvent("download"), page.locator("#saveCardBtn").click()]);
    const path = await download.path();
    const fs = await import("fs");
    expect(fs.statSync(path).size).toBeGreaterThan(10_000);
  });

  test("改名只重绘：新名上屏（PRD §5.2）", async ({ browser }) => {
    const page = await newSeededPage(browser);
    await page.locator("#renameBtn").click();
    await page.locator("#petNameInput").fill("煤球");
    await page.locator("#petNameInput").dispatchEvent("change");
    await expect(page.locator("#petNameText")).toHaveText("煤球");
  });

  test("提交幂等：同 token+testId 重复提交返回原 publicId（PRD §10.5）", async ({ request }) => {
    const body = { token: session.token, testId: session.testId, optionIds: ["q1a", "q2a", "q3a", "q4a", "q5a", "q6a", "q7b", "q8b", "q9a", "q10a"], petName: "馒头" };
    const r1 = await request.post("/api/results", { data: body });
    const r2 = await request.post("/api/results", { data: body });
    expect(r1.ok()).toBe(true);
    expect(r2.ok()).toBe(true);
    expect((await r1.json()).publicId).toBe(session.publicId);
    expect((await r2.json()).publicId).toBe(session.publicId);
  });

  test("跨浏览器凭口令找回（PRD §10.6）", async ({ browser }) => {
    const context = await browser.newContext(); // 全新 storage：换浏览器场景
    const page = await context.newPage();
    await page.goto("/");
    await page.locator("#recoverToggle").click();
    await page.locator("#recoverTestId").fill(session.testId);
    await page.locator("#recoverToken").fill(session.token);
    await page.locator("#recoverForm button[type=submit]").click();
    await expect(page).toHaveURL(/\/result$/, { timeout: 15_000 });
    await expect(page.locator("#publicId")).toHaveText(session.publicId);
    await context.close();
  });

  test("错误口令找回：统一文案不泄露存在性（PRD §10.6）", async ({ page }) => {
    await page.goto("/");
    await page.locator("#recoverToggle").click();
    await page.locator("#recoverTestId").fill(session.testId);
    await page.locator("#recoverToken").fill("00000000000000000000000000000000");
    await page.locator("#recoverForm button[type=submit]").click();
    await expect(page.locator("#recoverError")).toHaveText("口令无效或已超过保留期");
    await expect(page.locator("#recoverTestId")).toHaveValue(session.testId); // 保留输入
  });
});

test.describe("接口错误码与狗版", () => {
  test("quizVersion 与 petType 不匹配 → PARAM_MISSING（PRD §10.10）", async ({ request }) => {
    const res = await request.post("/api/sessions", { data: { petType: "cat", quizVersion: "dog-2026v1", source: "t" } });
    expect(res.status()).toBe(400);
    expect((await res.json()).code).toBe("PARAM_MISSING");
  });

  test("petName 超 12 码点 → PET_NAME_TOO_LONG（PRD §7.3）", async ({ request }) => {
    const s = await (await request.post("/api/sessions", { data: { petType: "cat", quizVersion: "cat-2026v1", source: "t" } })).json();
    const res = await request.post("/api/results", {
      data: { token: s.token, testId: s.testId, optionIds: Array.from({ length: 10 }, (_, i) => `q${i + 1}a`), petName: "一二三四五六七八九十十一二" },
    });
    expect((await res.json()).code).toBe("PET_NAME_TOO_LONG");
  });

  test("狗版全链路：角色名后缀「汪」（PRD §10.8）", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /狗狗/ }).click();
    await page.getByRole("button", { name: "开始测试" }).click();
    await expect(page).toHaveURL(/\/quiz$/);
    await answerN(page, 10);
    await expect(page).toHaveURL(/\/result$/, { timeout: 15_000 });
    await expect(page.locator("#roleName")).toHaveText(/汪$/);
    await expect(page.locator("#petNameText")).toHaveText("我家狗"); // 狗版默认名（已裁决）
  });
});
