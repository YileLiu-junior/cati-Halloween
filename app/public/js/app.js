// 落地页：双入口 + 开场命名（用户裁决：命名前置，「请输入你好奇的宠物的名字」）+ 继续上次 + 找回
import { getState, setState, initState, consumeSourceParam, shuffled, petNameCodePoints, fetchQuiz } from "./store.js";
import { initTrack, track } from "./track.js";

const state = initState();
const source = consumeSourceParam();
if (source) setState({ source });
initTrack();

let petType = state.petType || "cat";
const $ = (id) => document.getElementById(id);
const nameInput = $("petName");
const nameError = $("nameError");
const startBtn = $("startBtn");

function refreshToggle() {
  document.querySelectorAll(".type-btn").forEach((b) => {
    b.classList.toggle("selected", b.dataset.type === petType);
    b.setAttribute("aria-checked", String(b.dataset.type === petType));
  });
  nameInput.placeholder = window.PETI_CONFIG.defaultNames[petType];
}
document.querySelectorAll(".type-btn").forEach((b) => {
  b.addEventListener("click", () => {
    petType = b.dataset.type;
    refreshToggle();
  });
});
refreshToggle();

function showNameError(msg) {
  nameError.textContent = msg;
  nameError.classList.remove("hidden");
}
function hideNameError() {
  nameError.classList.add("hidden");
}
nameInput.addEventListener("input", hideNameError);

function setLoading(on) {
  startBtn.disabled = on;
  startBtn.textContent = on ? "正在加载…" : "开始测试";
}

async function startQuiz() {
  hideNameError();
  const raw = nameInput.value.trim();
  const petName = raw || window.PETI_CONFIG.defaultNames[petType];
  const len = petNameCodePoints(petName);
  if (len < 1 || len > 12) {
    showNameError("名字限 1–12 字，请调整后再开始");
    return;
  }
  setLoading(true);
  try {
    const quizVersion = window.PETI_CONFIG.quizVersions[petType];
    const res = await fetch("/api/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source: getState().source || "direct", quizVersion, petType }),
    });
    const data = await res.json();
    if (!res.ok) {
      showNameError(data.code === "RATE_LIMITED" ? "尝试太频繁，请稍后再试" : "加载失败，请重试");
      setLoading(false);
      return;
    }
    const quiz = await fetchQuiz(petType);
    // 每题选项随机排序一次后入 L，本次作答内顺序不变（PRD §3.2）
    const order = {};
    for (const q of quiz.questions) order[q.id] = shuffled(q.options.map((o) => o.id));
    setState({
      petType,
      quizVersion,
      testId: data.testId,
      token: data.token,
      petName,
      order,
      answers: {},
      currentQ: 0,
      result: null,
    });
    track("quiz_start", { entry: getState().source || "direct" });
    location.href = "/quiz.html";
  } catch {
    showNameError("加载失败，请重试");
    setLoading(false);
  }
}
startBtn.addEventListener("click", startQuiz);

// 继续上次：有结果去结果页，答到一半回答题页（ui-ux Q4 默认走法）
$("continueBtn").addEventListener("click", () => {
  const s = getState();
  if (s.result) location.href = "/result.html";
  else if (s.testId && s.order) location.href = "/quiz.html";
  else {
    const el = $("globalError");
    el.textContent = "还没有进行中的测试，先开始一个吧";
    el.classList.remove("hidden");
  }
});

// 找回结果：testId + 口令，失败统一文案、保留输入（PRD §4.5/§7.7）
$("recoverToggle").addEventListener("click", () => {
  $("recoverForm").classList.toggle("hidden");
});
$("recoverForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const errEl = $("recoverError");
  errEl.classList.add("hidden");
  const testId = $("recoverTestId").value.trim();
  const token = $("recoverToken").value.trim();
  if (!testId || !token) {
    errEl.textContent = "请填写测试编号和私密口令";
    errEl.classList.remove("hidden");
    return;
  }
  try {
    const res = await fetch("/api/recover", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, testId }),
    });
    const data = await res.json();
    if (!res.ok) {
      // 统一文案，不泄露结果是否存在（裁决后口径）
      errEl.textContent = "口令无效或已超过保留期";
      errEl.classList.remove("hidden");
      return;
    }
    setState({ petType: data.petType, quizVersion: data.quizVersion, testId, token, petName: data.petName, result: data });
    track("recovery", { outcome: "success" });
    location.href = "/result.html";
  } catch {
    errEl.textContent = "加载失败，请重试";
    errEl.classList.remove("hidden");
  }
});
