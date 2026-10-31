export function initCardMotion(button, frame) {
  const orientation = window.DeviceOrientationEvent;
  if (!orientation || !window.isSecureContext) return;
  button.hidden = false;
  let enabled = false, baseline, pending = 0, latest;
  const send = (x, y, active) => frame.contentWindow?.postMessage({ type: "peti:card-tilt", x, y, active }, location.origin);
  const reset = () => { baseline = null; };
  const listen = (event) => {
    if (!enabled || document.hidden || document.querySelector("dialog[open]") || !Number.isFinite(event.beta) || !Number.isFinite(event.gamma)) return;
    baseline ||= { beta: event.beta, gamma: event.gamma };
    const vertical = (event.beta - baseline.beta + 540) % 360 - 180;
    const horizontal = (event.gamma - baseline.gamma + 540) % 360 - 180;
    const angle = (screen.orientation?.angle ?? window.orientation ?? 0) * Math.PI / 180;
    let x = (vertical * Math.cos(angle) + horizontal * Math.sin(angle)) * Math.PI / 180 * 0.45;
    let y = (horizontal * Math.cos(angle) - vertical * Math.sin(angle)) * Math.PI / 180 * 0.45;
    const scale = Math.min(1, (Math.PI / 22.5) / Math.max(Math.hypot(x, y), 0.0001));
    latest = [x * scale, y * scale];
    if (!pending) pending = requestAnimationFrame(() => { pending = 0; if (enabled) send(...latest, true); });
  };
  window.addEventListener("deviceorientation", listen, { passive: true });
  window.addEventListener("orientationchange", reset);
  screen.orientation?.addEventListener("change", reset);
  document.addEventListener("visibilitychange", reset);
  button.addEventListener("click", async () => {
    try {
      if (!enabled && typeof orientation.requestPermission === "function" && await orientation.requestPermission() !== "granted") {
        button.textContent = "感应未授权，仍可拖动卡片";
        return;
      }
      enabled = !enabled; reset();
      button.setAttribute("aria-pressed", String(enabled));
      button.textContent = enabled ? "重力感应已开启 · 点击关闭" : "开启重力感应";
      if (!enabled) send(0, 0, false);
    } catch { button.textContent = "此浏览器不支持感应，仍可拖动"; }
  });
}
