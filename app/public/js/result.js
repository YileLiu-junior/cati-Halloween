// 结果页：立绘占位 + 雷达图 + 改名重绘 + 免费卡 canvas 导出
import { getState, setState, fetchQuiz, petNameCodePoints } from "./store.js";
import { track } from "./track.js";

const state = getState();
const $ = (id) => document.getElementById(id);

// 立绘占位映射：已有成品角色用真图，其余统一女仆咪透明立绘（用户裁决 demo 口径）
const ILLUS = {
  nurse: "/assets/illus-nurse.png",
  werewolf: "/assets/illus-werewolf.png",
  zombie: "/assets/illus-zombie.png",
  mummy: "/assets/illus-mummy.png",
};
const ILLUS_PLACEHOLDER = "/assets/illus-nurse.png";
const AXIS_ORDER = [
  ["E", "电量"],
  ["A", "贴贴"],
  ["B", "胆量"],
  ["D", "戏精"],
  ["F", "干饭"],
  ["C", "好奇"],
];

async function boot() {
  let result = state.result;
  // 空态：有凭证自动找回一次，失败回「找回结果」（PRD §4 空态去向）
  if (!result && state.testId && state.token) {
    try {
      const res = await fetch("/api/recover", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: state.token, testId: state.testId }),
      });
      if (res.ok) {
        result = await res.json();
        setState({ result });
      }
    } catch {
      /* 落到空态提示 */
    }
  }
  if (!result) {
    $("resultLoading").textContent = "结果丢失，请回首页「找回结果」";
    return;
  }
  $("resultLoading").classList.add("hidden");
  $("resultMain").classList.remove("hidden");
  track("result_view", { roleId: result.roleId });
  render(result);
}

function render(result) {
  $("illus").src = ILLUS[result.roleId] || ILLUS_PLACEHOLDER;
  $("illus").alt = result.roleName;
  $("roleName").textContent = result.roleName;
  $("tagline").textContent = result.tagline || "";
  const ul = $("shortLines");
  ul.innerHTML = "";
  for (const line of result.shortLines) {
    const li = document.createElement("li");
    li.textContent = line;
    ul.appendChild(li);
  }
  $("quote").textContent = result.quote;
  $("petNameText").textContent = state.petName || result.petName;
  $("rarity").textContent = `全站仅 ${result.rarityPct}% 的毛孩子是这个角色`;
  $("publicId").textContent = result.publicId;
  drawRadar(result.axes);
}

// 六边形雷达图：纯 canvas（素材最小化阶梯第 2 级）
function drawRadar(axes) {
  const canvas = $("radar");
  const ctx = canvas.getContext("2d");
  const W = canvas.width;
  const H = canvas.height;
  const cx = W / 2;
  const cy = H / 2 + 8;
  const R = Math.min(W, H) / 2 - 40;
  const n = AXIS_ORDER.length;
  const angle = (i) => (Math.PI * 2 * i) / n - Math.PI / 2;
  ctx.clearRect(0, 0, W, H);

  // 网格环 2.5/5/7.5/10
  ctx.strokeStyle = "rgba(255,255,255,0.18)";
  ctx.lineWidth = 1;
  for (const ring of [0.25, 0.5, 0.75, 1]) {
    ctx.beginPath();
    for (let i = 0; i <= n; i++) {
      const a = angle(i % n);
      const x = cx + R * ring * Math.cos(a);
      const y = cy + R * ring * Math.sin(a);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  // 轴线与标签
  ctx.font = '13px "PingFang SC", "Microsoft YaHei", sans-serif';
  for (let i = 0; i < n; i++) {
    const a = angle(i);
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + R * Math.cos(a), cy + R * Math.sin(a));
    ctx.stroke();
    const lx = cx + (R + 22) * Math.cos(a);
    const ly = cy + (R + 22) * Math.sin(a);
    ctx.fillStyle = "#FC9B26";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(AXIS_ORDER[i][1], lx, ly);
  }
  // 数据多边形：主紫填充 + 暖金描边
  ctx.beginPath();
  for (let i = 0; i <= n; i++) {
    const [key] = AXIS_ORDER[i % n];
    const v = Math.max(0, Math.min(10, axes[key] ?? 5)) / 10;
    const a = angle(i % n);
    const x = cx + R * v * Math.cos(a);
    const y = cy + R * v * Math.sin(a);
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fillStyle = "rgba(145, 19, 184, 0.4)";
  ctx.fill();
  ctx.strokeStyle = "#FC9B26";
  ctx.lineWidth = 2;
  ctx.stroke();
}

// 改名只触发重绘（PRD §5.2）；服务端仍存提交时名，MVP 不回传
$("renameBtn").addEventListener("click", () => {
  const input = $("petNameInput");
  const text = $("petNameText");
  text.classList.add("hidden");
  $("renameBtn").classList.add("hidden");
  input.value = state.petName || "";
  input.classList.remove("hidden");
  input.focus();
});
$("petNameInput").addEventListener("change", applyRename);
$("petNameInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter") applyRename();
});
function applyRename() {
  const input = $("petNameInput");
  const name = input.value.trim();
  const len = petNameCodePoints(name);
  const errEl = $("resultError");
  if (len >= 1 && len <= 12) {
    setState({ petName: name });
    errEl.classList.add("hidden");
    input.classList.add("hidden");
    $("petNameText").classList.remove("hidden");
    $("renameBtn").classList.remove("hidden");
    render(getState().result);
    drawCard(getState().result); // 改名只重绘（含卡面）
  } else {
    errEl.textContent = "名字限 1–12 字";
    errEl.classList.remove("hidden");
  }
}

// 免费简版卡：canvas 合成 750×1000 PNG（PRD §5.5，用户裁决：透明立绘+重建卡面）
async function drawCard(result) {
  const canvas = $("cardCanvas");
  const ctx = canvas.getContext("2d");
  const W = canvas.width;
  const H = canvas.height;

  // 背景：暖炭黑→近黑渐变 + 噪点（代码画）
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, "#2B2020");
  grad.addColorStop(1, "#010000");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "rgba(255,255,255,0.05)";
  for (let i = 0; i < 400; i++) {
    ctx.fillRect(Math.random() * W, Math.random() * H, 1.5, 1.5);
  }
  // 装饰：主紫晕 + 暖金描边框
  const glow = ctx.createRadialGradient(W / 2, H * 0.42, 40, W / 2, H * 0.42, 340);
  glow.addColorStop(0, "rgba(145,19,184,0.35)");
  glow.addColorStop(1, "rgba(145,19,184,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = "rgba(252,155,38,0.7)";
  ctx.lineWidth = 3;
  ctx.strokeRect(18, 18, W - 36, H - 36);

  const petName = state.petName || result.petName;
  ctx.textAlign = "center";
  // 立绘（透明 PNG）
  await new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const h = 460;
      const w = (img.width / img.height) * h;
      ctx.drawImage(img, (W - w) / 2, H * 0.30 - h / 2, w, h);
      resolve();
    };
    img.onerror = resolve;
    img.src = ILLUS[result.roleId] || ILLUS_PLACEHOLDER;
  });
  // 「角色示意」标注（前端叠字，PRD 验收 §10.7）
  ctx.fillStyle = "rgba(255,255,255,0.55)";
  ctx.font = '20px "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.fillText("（角色示意）", W / 2, H * 0.30 + 250);

  ctx.fillStyle = "#FC9B26";
  ctx.font = 'bold 44px "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.fillText(result.roleName, W / 2, 110);
  ctx.fillStyle = "#FFFFFF";
  ctx.font = 'bold 40px "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.fillText(petName, W / 2, H * 0.72);
  ctx.font = '24px "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.fillText(result.quote, W / 2, H * 0.72 + 46);
  ctx.fillText(`公开编号：${result.publicId}`, W / 2, H * 0.72 + 88);
  ctx.fillStyle = "rgba(252,155,38,0.9)";
  ctx.font = 'bold 28px "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.fillText("小红书搜：喵灵万圣节", W / 2, H * 0.72 + 150);
  ctx.fillStyle = "rgba(255,255,255,0.4)";
  ctx.font = '16px "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.fillText("本卡形象为 AI 生成示意", W / 2, H - 34);
  return canvas;
}

$("saveCardBtn").addEventListener("click", async () => {
  const btn = $("saveCardBtn");
  btn.disabled = true;
  btn.textContent = "正在生成…";
  try {
    const canvas = await drawCard(getState().result);
    const link = document.createElement("a");
    link.download = `peti-card-${getState().result.publicId}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
    track("export_ready", { type: "free" });
    btn.textContent = "已生成，长按或查看下载";
  } catch {
    btn.textContent = "生成失败，请重试";
  }
  btn.disabled = false;
});

// 定制入口：付费链路未上线，占位反馈（ui-ux Q8 默认走法）
$("customBtn").addEventListener("click", () => {
  const errEl = $("resultError");
  errEl.textContent = "付费定制即将开放，先保存免费卡吧";
  errEl.classList.remove("hidden");
});

// 再测一只：归档旧结果到 history，不覆盖（PRD §5.3）
$("againBtn").addEventListener("click", () => {
  const s = getState();
  const history = s.history || [];
  if (s.result) history.push({ testId: s.testId, token: s.token, result: s.result, petName: s.petName, petType: s.petType });
  setState({
    history,
    testId: null,
    token: null,
    order: null,
    answers: {},
    currentQ: 0,
    result: null,
  });
  location.href = "/index.html";
});

boot();
