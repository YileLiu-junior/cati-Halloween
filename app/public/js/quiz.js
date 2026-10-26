// 答题页 ×10：洗牌顺序来自 L、未选禁用下一题、末题「揭晓身份」、服务端计分
import { getState, setState, fetchQuiz, petNameCodePoints } from "./store.js";
import { track } from "./track.js";

const state = getState();
if (!state.testId || !state.order) {
  location.href = "/index.html";
} else {
  main();
}

async function main() {
  const $ = (id) => document.getElementById(id);
  const quiz = await fetchQuiz(state.petType);
  const questions = quiz.questions;
  let qi = Math.min(state.currentQ || 0, questions.length - 1);
  const answers = { ...(state.answers || {}) };

  const progressEl = $("progress");
  const sceneEl = $("scene");
  const qtextEl = $("qtext");
  const optionsEl = $("options");
  const prevBtn = $("prevBtn");
  const nextBtn = $("nextBtn");
  const quizError = $("quizError");

  function showError(msg) {
    quizError.textContent = msg;
    quizError.classList.remove("hidden");
  }

  function save() {
    setState({ answers, currentQ: qi });
  }

  function render() {
    const q = questions[qi];
    progressEl.textContent = `第 ${qi + 1} / ${questions.length} 题`;
    sceneEl.textContent = `【${q.scene}】`;
    qtextEl.textContent = q.text;
    optionsEl.innerHTML = "";
    // 顺序取 L 中洗牌结果；optionId 记录不按位置（PRD §3.2/§3.4）
    for (const oid of state.order[q.id]) {
      const opt = q.options.find((o) => o.id === oid);
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "option" + (answers[q.id] === oid ? " selected" : "");
      btn.dataset.oid = oid;
      btn.textContent = opt.text;
      btn.addEventListener("click", () => {
        answers[q.id] = oid;
        save();
        track("quiz_answer", { questionId: q.id, optionId: oid });
        render();
      });
      optionsEl.appendChild(btn);
    }
    prevBtn.classList.toggle("hidden", qi === 0); // 首题隐藏上一题（ui-ux Q6 默认走法）
    const isLast = qi === questions.length - 1;
    nextBtn.textContent = isLast ? "揭晓身份" : "下一题";
    nextBtn.disabled = !answers[q.id];
    save();
  }

  prevBtn.addEventListener("click", () => {
    if (qi > 0) {
      qi -= 1;
      render();
    }
  });

  nextBtn.addEventListener("click", async () => {
    const q = questions[qi];
    if (!answers[q.id]) return;
    if (qi < questions.length - 1) {
      qi += 1;
      render();
      return;
    }
    // 末题提交：loading 禁用，服务端幂等兜住双击（PRD §7.2）
    nextBtn.disabled = true;
    nextBtn.textContent = "正在揭晓…";
    quizError.classList.add("hidden");
    try {
      const optionIds = questions.map((x) => answers[x.id]);
      if (optionIds.some((x) => !x)) {
        showError("还有题目未作答");
        nextBtn.disabled = false;
        nextBtn.textContent = "揭晓身份";
        return;
      }
      if (petNameCodePoints(state.petName || "") < 1) {
        showError("宠物名缺失，请回首页重新开始");
        nextBtn.textContent = "揭晓身份";
        return;
      }
      const res = await fetch("/api/results", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          token: state.token,
          testId: state.testId,
          optionIds,
          petName: state.petName,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        showError(data.code === "TOKEN_INVALID" ? "会话已失效，请回首页重新开始" : "加载失败，请重试");
        nextBtn.textContent = "揭晓身份";
        return;
      }
      setState({ result: data, currentQ: questions.length });
      track("quiz_complete", { roleId: data.roleId });
      location.href = "/result.html";
    } catch {
      showError("加载失败，请重试");
      nextBtn.disabled = false;
      nextBtn.textContent = "揭晓身份";
    }
  });

  render();
}
