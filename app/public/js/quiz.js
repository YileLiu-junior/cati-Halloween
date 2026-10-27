// 选项顺序和进度保存在当前浏览器，角色仍由服务端计算。
import { getState, setState, saveResult, fetchQuiz, petNameCodePoints } from "./store.js";
import { track } from "./track.js";

const state = getState();
const $ = (id) => document.getElementById(id);
const prevBtn = $("prevBtn");
const retryBtn = $("retryBtn");
const quizError = $("quizError");
const quizStatus = $("quizStatus");

if (!state.testId || !state.order) {
  location.href = "/index.html";
} else {
  main();
}

async function main() {
  prevBtn.onclick = () => { location.href = "/index.html"; };
  quizError.classList.add("hidden");
  retryBtn.classList.add("hidden");
  quizStatus.textContent = "正在加载题目…";
  quizStatus.classList.remove("hidden");
  let quiz;
  try {
    quiz = await fetchQuiz(state.petType);
  } catch {
    quizStatus.classList.add("hidden");
    quizError.textContent = "题目加载失败，答题进度已保留";
    quizError.classList.remove("hidden");
    retryBtn.textContent = "重新加载题目";
    retryBtn.classList.remove("hidden");
    retryBtn.onclick = main;
    return;
  }
  quizStatus.classList.add("hidden");

  const questions = quiz.questions;
  let qi = Math.max(0, Math.min(state.currentQ || 0, questions.length - 1));
  const answers = { ...(state.answers || {}) };
  let busy = false;
  let expired = false;
  const progressEl = $("progress");
  const qtextEl = $("qtext");
  const optionsEl = $("options");

  function showError(msg, canRetry = false) {
    quizError.textContent = msg;
    quizError.classList.remove("hidden");
    retryBtn.textContent = "重新揭晓身份";
    retryBtn.classList.toggle("hidden", !canRetry);
  }

  function save() {
    if (!isCurrentSession()) return false;
    setState({ answers, currentQ: qi });
    return true;
  }

  function setBusy(on) {
    busy = on;
    prevBtn.disabled = on;
    optionsEl.querySelectorAll("button").forEach((btn) => { btn.disabled = on || expired; });
    optionsEl.setAttribute("aria-busy", String(on));
  }

  function isCurrentSession() {
    if (getState().testId === state.testId) return true;
    expired = true;
    setBusy(false);
    prevBtn.setAttribute("aria-label", "返回首页");
    showError("另一场测试已在本浏览器开始，请返回首页继续");
    return false;
  }

  function render(focus = false) {
    if (!isCurrentSession()) return;
    const q = questions[qi];
    progressEl.textContent = `第 ${qi + 1} / ${questions.length} 题`;
    $("progressFill").style.transform = `scaleX(${(qi + 1) / questions.length})`;
    $("scene").textContent = q.scene;
    qtextEl.textContent = q.text;
    optionsEl.replaceChildren();
    quizError.classList.add("hidden");
    retryBtn.classList.add("hidden");
    for (const oid of state.order[q.id]) {
      const opt = q.options.find((o) => o.id === oid);
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "option" + (answers[q.id] === oid ? " selected" : "");
      btn.dataset.oid = oid;
      btn.textContent = opt.text;
      btn.setAttribute("aria-pressed", String(answers[q.id] === oid));
      btn.addEventListener("click", async (event) => {
        if (busy || expired || event.detail > 1) return;
        if (!isCurrentSession()) return;
        answers[q.id] = oid;
        if (!save()) return;
        optionsEl.querySelectorAll("button").forEach((option) => {
          const selected = option === btn;
          option.classList.toggle("selected", selected);
          option.setAttribute("aria-pressed", String(selected));
        });
        setBusy(true);
        track("quiz_answer", { questionId: q.id, optionId: oid });
        await new Promise((resolve) => setTimeout(resolve, 220));
        if (!isCurrentSession()) return;
        if (qi < questions.length - 1) {
          qi += 1;
          setBusy(false);
          render(true);
        } else {
          await submit();
        }
      });
      optionsEl.appendChild(btn);
    }
    prevBtn.setAttribute("aria-label", qi === 0 ? "返回首页" : "返回上一题");
    save();
    if (focus) {
      window.scrollTo({ top: 0, behavior: "instant" });
      qtextEl.focus({ preventScroll: true });
    }
  }

  prevBtn.onclick = () => {
    if (busy) return;
    if (qi === 0 || expired || getState().testId !== state.testId) {
      location.href = "/index.html";
      return;
    }
    qi -= 1;
    render(true);
  };

  async function submit() {
    if (!isCurrentSession()) return;
    setBusy(true);
    retryBtn.classList.add("hidden");
    quizError.classList.add("hidden");
    quizStatus.textContent = "正在揭晓万圣节身份…";
    quizStatus.classList.remove("hidden");
    try {
      const optionIds = questions.map((q) => answers[q.id]);
      const unanswered = optionIds.findIndex((id) => !id);
      if (unanswered !== -1) {
        qi = unanswered;
        render(true);
        showError("这一题还没有作答，请选择一个答案");
        return;
      }
      const nameLength = petNameCodePoints(state.petName || "");
      if (nameLength < 1 || nameLength > 12) {
        expired = true;
        showError("宠物姓名无效，请点击左上角返回首页重新开始");
        return;
      }
      const res = await fetch("/api/results", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: state.token, testId: state.testId, optionIds, petName: state.petName }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (!isCurrentSession()) return;
        expired = data.code === "TOKEN_INVALID";
        showError(expired ? "会话已失效，请点击左上角返回首页重新开始" : "揭晓失败，答案已保留，请重试", !expired);
        return;
      }
      saveResult({ ...state, result: data });
      if (getState().testId === state.testId) setState({ result: data, currentQ: questions.length });
      track("quiz_complete", { roleId: data.roleId });
      location.href = `/result.html?testId=${encodeURIComponent(state.testId)}`;
    } catch {
      if (!isCurrentSession()) return;
      showError("揭晓失败，答案已保留，请重试", true);
    } finally {
      quizStatus.classList.add("hidden");
      setBusy(false);
    }
  }

  retryBtn.onclick = () => { if (!busy) submit(); };
  render();
}
