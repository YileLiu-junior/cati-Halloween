import { test, expect } from "@playwright/test";
import { stat } from "node:fs/promises";

async function answerN(page, n, pick = 0) {
  for (let i = 0; i < n; i++) {
    const progress = await page.locator("#progress").innerText();
    await expect(page.locator("#options .option")).toHaveCount(4);
    await page.locator("#options .option").nth(pick).click();
    if (progress.includes("10 / 10")) {
      await expect(page).toHaveURL(/\/result(?:\.html)?(?:\?.*)?$/, { timeout: 15_000 });
    } else {
      await expect(page.locator("#progress")).not.toHaveText(progress);
    }
  }
}

async function startQuiz(page, name) {
  await page.goto("/");
  if (name) await page.getByLabel("请输入宠物姓名", { exact: true }).fill(name);
  await page.locator("#startBtn").click();
  await expect(page).toHaveURL(/\/quiz(?:\.html)?$/);
  await expect(page.locator("#options .option").first()).toBeVisible();
}

async function readState(page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem("peti:v1")));
}

async function seedPage(page, state, path = "/result.html") {
  await page.goto("/");
  await page.evaluate((value) => localStorage.setItem("peti:v1", JSON.stringify(value)), state);
  await page.goto(path);
  await expect(page.locator("#roleName")).toBeVisible();
}

async function expectNoOverflow(page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

test.describe("首页与答题", () => {
  test("首页表单叠在主视觉内，姓名为空，历史空态不展示无效入口", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".hero")).toBeVisible();
    await expect(page.getByLabel("请输入宠物姓名", { exact: true })).toHaveValue("");
    expect((await page.locator("#petName").getAttribute("placeholder")) || "").toBe("");
    await expect(page.locator('.type-btn[data-type="cat"]')).toBeVisible();
    await expect(page.locator('.type-btn[data-type="dog"]')).toBeVisible();
    await expect(page.locator("#continueBtn")).toBeHidden();
    await expect(page.locator("#historySection")).toBeHidden();
    await expect(page.locator("#recoverForm")).toHaveCount(0);
    const hero = await page.locator(".hero").boundingBox();
    const start = await page.locator("#startBtn").boundingBox();
    expect(start.y).toBeGreaterThan(hero.y);
    expect(start.y + start.height).toBeLessThanOrEqual(hero.y + hero.height);
  });

  test("名字超 12 字报错并保留输入", async ({ page }) => {
    await page.goto("/");
    await page.locator("#petName").fill("一二三四五六七八九十十一二");
    await page.locator("#startBtn").click();
    await expect(page.locator("#nameError")).toContainText("1–12 字");
    await expect(page.locator("#petName")).toHaveValue("一二三四五六七八九十十一二");
  });

  test("选项自动推进，图标返回保留已选答案与顺序，刷新稳定", async ({ page }) => {
    await startQuiz(page, "馒头");
    const order = await page.locator("#options .option").allTextContents();
    await expect(page.locator("#nextBtn")).toHaveCount(0);
    await expect(page.locator("#prevBtn")).toHaveAccessibleName("返回首页");
    const selected = await page.locator("#options .option").nth(1).getAttribute("data-oid");
    await page.locator("#options .option").nth(1).click();
    await expect(page.locator("#progress")).toHaveText("第 2 / 10 题");
    await expect(page.locator("#prevBtn")).toHaveAccessibleName("返回上一题");
    await page.locator("#prevBtn").click();
    await expect(page.locator("#progress")).toHaveText("第 1 / 10 题");
    await expect(page.locator("#options .option.selected")).toHaveAttribute("data-oid", selected);
    expect(await page.locator("#options .option").allTextContents()).toEqual(order);
    await page.reload();
    await expect(page.locator("#options .option.selected")).toHaveAttribute("data-oid", selected);
    expect(await page.locator("#options .option").allTextContents()).toEqual(order);
  });

  test("快速重复选择只回答当前一题", async ({ page }) => {
    await startQuiz(page);
    await page.locator("#options .option").first().evaluate((button) => {
      button.click();
      button.click();
    });
    await expect(page.locator("#progress")).toHaveText("第 2 / 10 题");
    expect(Object.keys((await readState(page)).answers)).toHaveLength(1);
  });

  test("另一个标签开始新测后，旧答题页不能覆盖新进度", async ({ page, context }) => {
    await startQuiz(page, "馒头");
    const old = await readState(page);
    const secondPage = await context.newPage();
    await startQuiz(secondPage, "团子");
    const active = await readState(secondPage);
    expect(active.testId).not.toBe(old.testId);
    await page.locator("#options .option").first().click();
    await expect(page.locator("#quizError")).toHaveText("另一场测试已在本浏览器开始，请返回首页继续");
    expect((await readState(page)).testId).toBe(active.testId);
    expect((await readState(page)).answers).toEqual({});
    await expect(page.locator("#prevBtn")).toHaveAccessibleName("返回首页");
    await page.locator("#prevBtn").click();
    await expect(page).toHaveURL(/\/(?:index\.html)?$/);
    await secondPage.close();
  });

  test("末题自动提交，失败保留答案并可重试", async ({ page }) => {
    await startQuiz(page);
    await answerN(page, 9);
    let submissions = 0;
    await page.route("**/api/results", async (route) => {
      submissions += 1;
      if (submissions === 1) {
        await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ code: "SERVER_ERROR", retryable: true }) });
      } else {
        await route.continue();
      }
    });
    await page.locator("#options .option").first().click();
    await expect(page.locator("#quizError")).toBeVisible();
    await expect(page.locator("#retryBtn")).toBeVisible();
    expect(Object.keys((await readState(page)).answers)).toHaveLength(10);
    await page.locator("#retryBtn").click();
    await expect(page).toHaveURL(/\/result(?:\.html)?(?:\?.*)?$/, { timeout: 15_000 });
    await expect(page.locator("#roleName")).toBeVisible();
    expect(submissions).toBe(2);
  });

  test("音乐支持开启和静音，并记住跨页偏好", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("#audioToggle")).toBeVisible();
    if ((await page.locator("#audioToggle").getAttribute("aria-pressed")) !== "true") {
      await page.locator("#audioToggle").click();
    }
    await expect(page.locator("#audioToggle")).toHaveAttribute("aria-pressed", "true");
    await page.locator("#audioToggle").click();
    await expect(page.locator("#audioToggle")).toHaveAttribute("aria-pressed", "false");
    await page.locator("#startBtn").click();
    await expect(page).toHaveURL(/\/quiz(?:\.html)?$/);
    await expect(page.locator("#audioToggle")).toHaveAttribute("aria-pressed", "false");
    await page.reload();
    await expect(page.locator("#audioToggle")).toHaveAttribute("aria-pressed", "false");
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("peti:audio:v1")).muted)).toBe(true);
  });
});

test.describe("结果、历史与接口", () => {
  let session;

  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    await startQuiz(page, "馒头");
    await answerN(page, 10);
    await expect(page.locator("#roleName")).toBeVisible();
    session = await readState(page);
    await page.close();
  });

  test("结果顺序符合角色展示层级，免费卡与雷达已渲染，无公开编号", async ({ page }) => {
    await seedPage(page, session);
    await expect(page.locator("#roleName")).toHaveText(/咪$/);
    await expect(page.locator("#rarity")).toContainText("全站仅");
    await expect(page.locator("#publicId")).toHaveCount(0);
    await expect(page.locator("body")).not.toContainText("公开编号");
    await expect(page.locator("#petNameText")).toHaveText("馒头");
    await expect(page.locator("#holoCard")).toBeVisible();
    for (const selector of ["#radar", "#cardCanvas"]) {
      await expect.poll(() => page.$eval(selector, (canvas) => canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data.some((value) => value !== 0))).toBe(true);
    }
    const rarity = await page.locator("#rarity").boundingBox();
    const role = await page.locator("#roleName").boundingBox();
    const card = await page.locator("#holoCard").boundingBox();
    const quote = await page.locator("#quote").boundingBox();
    const radar = await page.locator("#radar").boundingBox();
    expect(rarity.y).toBeLessThan(role.y);
    expect(role.y).toBeLessThan(card.y);
    expect(card.y + card.height).toBeLessThanOrEqual(quote.y);
    expect(quote.y).toBeLessThan(radar.y);
  });

  test("16 个结果角色均有对应的炫彩卡图片和线稿", async ({ page, request }) => {
    const quiz = await (await request.get("/data/quiz-cat.json")).json();
    for (const role of quiz.characters) {
      for (const suffix of [".png", "-line.png"]) {
        expect((await request.get(`/holo-card/roles/${role.id}${suffix}`)).ok()).toBe(true);
      }
    }
    for (const role of [quiz.characters[0], quiz.characters[8]]) {
      const result = { ...session.result, roleId: role.id, roleName: role.name };
      await seedPage(page, { ...session, result, history: [] });
      const frame = page.frameLocator("#holoCard");
      await expect(frame.locator("#stage")).toBeVisible();
      await expect.poll(() => page.locator("#holoCard").evaluate((el) => el.contentWindow?.__holo?.config?.assets?.subject || el.contentWindow?.__holo?.fallback3d && el.contentWindow?.location.search), { timeout: 30000 }).toContain(role.id);
      await expect(page.locator("#saveCardBtn")).toBeEnabled();
      if (role.id === "ghost") {
        const box = await frame.locator("#stage").boundingBox();
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
        await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2);
        await page.mouse.up();
        await expect.poll(() => page.locator("#holoCard").evaluate((el) => el.contentWindow?.__holo?.getState?.().auto)).toBe(false);
      }
    }
  });

  test("保存免费卡导出非空 PNG", async ({ page }) => {
    await seedPage(page, session);
    const [download] = await Promise.all([page.waitForEvent("download"), page.locator("#saveCardBtn").click()]);
    expect(download.suggestedFilename()).toMatch(/\.png$/);
    expect((await stat(await download.path())).size).toBeGreaterThan(10_000);
  });

  test("改名有保存与取消，成功状态明确，重新查看历史保留新名", async ({ page }) => {
    await seedPage(page, session);
    await page.locator("#renameBtn").click();
    await page.locator("#petNameInput").fill("煤球");
    await page.locator("#cancelNameBtn").click();
    await expect(page.locator("#petNameText")).toHaveText("馒头");
    await page.locator("#renameBtn").click();
    await page.locator("#petNameInput").fill("煤球");
    await page.locator("#saveNameBtn").click();
    await expect(page.locator("#petNameText")).toHaveText("煤球");
    await expect(page.locator("#petNameInput")).toBeHidden();
    await expect(page.locator("#nameStatus")).toHaveText("名字已保存");
    await page.goto("/");
    await expect(page.locator("#historyList")).toContainText("煤球");
    await page.locator("a.history-item").filter({ hasText: "煤球" }).click();
    await expect(page.locator("#petNameText")).toHaveText("煤球");
  });

  test("新测不会覆盖旧结果，历史可见且查看旧结果不丢失答题进度", async ({ page }) => {
    await seedPage(page, session);
    await page.goto("/");
    await expect(page.locator("a.history-item")).toHaveCount(1);
    await page.locator("#petName").fill("团子");
    await page.locator("#startBtn").click();
    await expect(page).toHaveURL(/\/quiz(?:\.html)?$/);
    await answerN(page, 1);
    const active = await readState(page);
    expect(active.testId).not.toBe(session.testId);
    await page.goto("/");
    await expect(page.locator("#continueBtn")).toBeVisible();
    await page.locator("a.history-item").filter({ hasText: "馒头" }).click();
    await expect(page.locator("#petNameText")).toHaveText("馒头");
    const afterHistory = await readState(page);
    expect(afterHistory.testId).toBe(active.testId);
    expect(afterHistory.answers).toEqual(active.answers);
    await page.goto("/");
    await page.locator("#continueBtn").click();
    await expect(page.locator("#progress")).toHaveText("第 2 / 10 题");
    await answerN(page, 9);
    await page.goto("/");
    await expect(page.locator("a.history-item")).toHaveCount(2);
    await expect(page.locator("#historyList")).toContainText("馒头");
    await expect(page.locator("#historyList")).toContainText("团子");
    await page.reload();
    await expect(page.locator("a.history-item")).toHaveCount(2);
  });

  test("本地结果缓存缺失时自动通过原凭证恢复", async ({ page }) => {
    await seedPage(page, { ...session, result: null, history: [] });
    await expect(page.locator("#roleName")).toHaveText(session.result.roleName);
    expect((await readState(page)).result.publicId).toBe(session.result.publicId);
  });

  test("提交响应晚到时归档原结果，并保留另一场新会话", async ({ page }) => {
    await startQuiz(page, "馒头");
    await answerN(page, 9);
    const original = await readState(page);
    let newSession;
    await page.route("**/api/results", async (route) => {
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      newSession = await (await page.request.post("/api/sessions", {
        data: { petType: "cat", quizVersion: "cat-2026v1", source: "test" },
      })).json();
      await page.evaluate((state) => localStorage.setItem("peti:v1", JSON.stringify(state)), {
        ...original, ...newSession, petName: "团子", answers: {}, currentQ: 0, result: null,
      });
      await route.fulfill({ response });
    });
    await page.locator("#options .option").first().click();
    await expect(page).toHaveURL(new RegExp(`/result(?:\\.html)?\\?testId=${original.testId}$`), { timeout: 15_000 });
    await expect(page.locator("#petNameText")).toHaveText("馒头");
    const active = await readState(page);
    expect(active.testId).toBe(newSession.testId);
    expect(active.result).toBeNull();
    expect(active.answers).toEqual({});
    expect(active.history.find((entry) => entry.testId === original.testId)?.result.roleName).toBeTruthy();
    expect(active.history.some((entry) => entry.testId === newSession.testId)).toBe(false);
  });

  test("提交幂等：同凭证重复提交返回原 publicId", async ({ request }) => {
    const body = { token: session.token, testId: session.testId, optionIds: Array.from({ length: 10 }, (_, i) => `q${i + 1}a`), petName: "馒头" };
    for (let i = 0; i < 2; i++) {
      const response = await request.post("/api/results", { data: body });
      expect(response.ok()).toBe(true);
      expect((await response.json()).publicId).toBe(session.result.publicId);
    }
  });

  test("后台恢复仍验证凭证，错误凭证统一失败", async ({ request }) => {
    const valid = await request.post("/api/recover", { data: { token: session.token, testId: session.testId } });
    expect(valid.ok()).toBe(true);
    expect((await valid.json()).publicId).toBe(session.result.publicId);
    for (const testId of [session.testId, "missing-test"]) {
      const response = await request.post("/api/recover", { data: { token: "00000000000000000000000000000000", testId } });
      expect(response.status()).toBe(401);
      const error = await response.json();
      expect(error.code).toBe("TOKEN_INVALID");
      expect(error.message).toBe("口令无效或已超过保留期");
    }
  });

  test("320px 与 390px 不横向溢出，雷达图位于描述左侧且缩小", async ({ page }) => {
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 844 });
      await page.goto("/");
      await expectNoOverflow(page);
      await seedPage(page, session);
      await expectNoOverflow(page);
      const radar = await page.locator("#radar").boundingBox();
      const description = await page.locator("#shortLines").boundingBox();
      expect(radar.x + radar.width).toBeLessThanOrEqual(description.x + 1);
      expect(radar.width).toBeLessThanOrEqual(180);
      const card = await page.locator("#holoCard").boundingBox();
      expect(Math.abs(card.x + card.width / 2 - width / 2)).toBeLessThanOrEqual(2);
    }
    await page.setViewportSize({ width: 390, height: 500 });
    await startQuiz(page);
    await expectNoOverflow(page);
    await page.locator("#options .option").last().scrollIntoViewIfNeeded();
    await page.locator("#options .option").last().click();
    await expect(page.locator("#progress")).toHaveText("第 2 / 10 题");
    expect(await page.evaluate(() => scrollY)).toBe(0);
    const question = await page.locator("#qtext").boundingBox();
    expect(question.y).toBeGreaterThan(100);
  });
});

test.describe("接口校验与狗版", () => {
  test("quizVersion 与 petType 不匹配返回 PARAM_MISSING", async ({ request }) => {
    const response = await request.post("/api/sessions", { data: { petType: "cat", quizVersion: "dog-2026v1", source: "test" } });
    expect(response.status()).toBe(400);
    expect((await response.json()).code).toBe("PARAM_MISSING");
  });

  test("petName 超 12 码点返回 PET_NAME_TOO_LONG", async ({ request }) => {
    const session = await (await request.post("/api/sessions", { data: { petType: "cat", quizVersion: "cat-2026v1", source: "test" } })).json();
    const response = await request.post("/api/results", { data: { ...session, optionIds: Array.from({ length: 10 }, (_, i) => `q${i + 1}a`), petName: "一二三四五六七八九十十一二" } });
    expect((await response.json()).code).toBe("PET_NAME_TOO_LONG");
  });

  test("狗版全链路使用汪角色与狗版默认名", async ({ page }) => {
    await page.goto("/");
    await page.locator('.type-btn[data-type="dog"]').click();
    await page.locator("#startBtn").click();
    await expect(page).toHaveURL(/\/quiz(?:\.html)?$/);
    await answerN(page, 10);
    await expect(page.locator("#roleName")).toHaveText(/汪$/);
    await expect(page.locator("#petNameText")).toHaveText("我家狗");
  });
});
