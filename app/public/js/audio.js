const PREF_KEY = "peti:audio:v1";
const POSITION_KEY = "peti:audio-position";
let muted = false;
try { muted = JSON.parse(localStorage.getItem(PREF_KEY))?.muted === true; } catch { /* 默认首次交互播放。 */ }

const audio = document.createElement("audio");
audio.src = "/assets/bgm.mp3";
audio.loop = true;
audio.preload = "metadata";
audio.volume = 0.35;
audio.setAttribute("aria-hidden", "true");
document.body.appendChild(audio);
const toggle = document.createElement("button");
toggle.id = "audioToggle";
toggle.type = "button";
toggle.className = "icon-button audio-toggle";
const feedback = document.createElement("p");
feedback.className = "audio-feedback hidden";
feedback.setAttribute("role", "status");
document.body.append(toggle, feedback);

function render() {
  const playing = !audio.paused && !muted;
  toggle.setAttribute("aria-pressed", String(playing));
  toggle.setAttribute("aria-label", playing ? "静音音乐" : "开启音乐");
  toggle.title = playing ? "静音音乐" : "开启音乐";
  toggle.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4V5Z"/>${playing ? '<path d="M15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>' : '<path d="m16 9 5 6m0-6-5 6"/>'}</svg>`;
}
async function play() {
  if (muted || !audio.paused) return;
  try {
    await audio.play();
    feedback.classList.add("hidden");
  } catch (error) {
    if (error.name !== "NotAllowedError") {
      feedback.textContent = "音乐暂时无法播放，点击可重试";
      feedback.classList.remove("hidden");
    }
  }
  render();
}
toggle.addEventListener("click", async () => {
  muted = !audio.paused && !muted;
  try { localStorage.setItem(PREF_KEY, JSON.stringify({ muted })); } catch { /* 本页仍可控制。 */ }
  if (muted) audio.pause();
  else await play();
  render();
});
function firstInteraction(event) {
  if (toggle.contains(event.target) || (event.type === "keydown" && event.key !== "Enter" && event.key !== " ")) return;
  if (!muted) void play();
}
document.addEventListener("pointerdown", firstInteraction);
document.addEventListener("keydown", firstInteraction);
audio.addEventListener("play", render);
audio.addEventListener("pause", render);
audio.addEventListener("loadedmetadata", () => {
  try {
    const position = Number(sessionStorage.getItem(POSITION_KEY));
    if (Number.isFinite(position) && audio.duration > 0) audio.currentTime = position % audio.duration;
  } catch { /* 无播放位置时从头开始。 */ }
});
function savePosition() {
  try { sessionStorage.setItem(POSITION_KEY, String(audio.currentTime)); } catch { /* 不影响播放。 */ }
}
window.addEventListener("pagehide", savePosition);
let lastSaved = 0;
audio.addEventListener("timeupdate", () => {
  if (Math.abs(audio.currentTime - lastSaved) > 5) { savePosition(); lastSaved = audio.currentTime; }
});
render();
if (!muted) void play();
