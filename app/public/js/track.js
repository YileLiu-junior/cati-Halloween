import { getState, initState } from "./store.js";

let ph = null, started = false;
const queueKey = "peti:analytics:pending";
const pageViewId = crypto.randomUUID();
const memoryQueue = [];

function visitId() {
  try {
    const now = Date.now();
    const previous = JSON.parse(sessionStorage.getItem("peti:analytics:visit") || "null");
    const id = previous && now - previous.at < 1800000 ? previous.id : crypto.randomUUID();
    sessionStorage.setItem("peti:analytics:visit", JSON.stringify({ id, at: now }));
    return id;
  } catch { return pageViewId; }
}
function pending() {
  try { return JSON.parse(sessionStorage.getItem(queueKey) || "[]"); } catch { return []; }
}
function saveQueue(items) {
  try { sessionStorage.setItem(queueKey, JSON.stringify(items.slice(-100))); } catch { /* Storage may be unavailable. */ }
}
export function initTrack() {
  if (started) return;
  started = true;
  try {
    const anonId = initState().anonId;
    const s = document.createElement("script");
    s.src = "/ingest/static/array.js";
    s.async = true;
    s.onload = () => {
      try {
        window.posthog.init(window.PETI_CONFIG.posthogToken, {
          api_host: "/ingest", ui_host: "https://us.posthog.com",
          autocapture: false, capture_pageview: false, disable_session_recording: true,
          bootstrap: { distinctID: anonId },
        });
        ph = window.posthog;
        const queued = pending();
        saveQueue([]);
        for (const item of queued.length ? queued : memoryQueue) ph.capture(item.name, item.props);
        memoryQueue.length = 0;
      } catch { /* Analytics never blocks the product. */ }
    };
    document.head.appendChild(s);
  } catch { /* Analytics never blocks the product. */ }
}
export function track(name, props = {}) {
  try {
    const state = getState();
    const payload = { event_id: crypto.randomUUID(), event_version: 1, occurred_at: new Date().toISOString(),
      page_view_id: pageViewId, visit_id: visitId(), anon_id: state.anonId || null, test_id: state.testId || null,
      pet_type: state.petType || null, quiz_version: state.quizVersion || null,
      source: state.source || "direct", is_wechat: /MicroMessenger/i.test(navigator.userAgent), ...props };
    if (ph) ph.capture(name, payload);
    else {
      const item = { name, props: payload };
      memoryQueue.push(item);
      saveQueue([...pending(), item]);
    }
  } catch { /* Analytics never blocks the product. */ }
}
export function observeView(element, name, properties = () => ({}), key = () => "") {
  if (!element || !("IntersectionObserver" in window)) return;
  let timer, seen = new Set();
  const observer = new IntersectionObserver(entries => {
    clearTimeout(timer);
    if (!document.hidden && entries[0].isIntersecting && entries[0].intersectionRatio >= 0.5) {
      const current = key();
      if (!seen.has(current)) timer = setTimeout(() => {
        if (!document.hidden && !seen.has(current) && (element.tagName !== "IMG" || (element.complete && element.naturalWidth > 0))) { seen.add(current); track(name, properties()); }
      }, 1000);
    }
  }, { threshold: [0.5] });
  observer.observe(element);
  if (element.tagName === "IMG") element.addEventListener("load", () => { observer.unobserve(element); observer.observe(element); });
  document.addEventListener("visibilitychange", () => { if (document.hidden) clearTimeout(timer); else { observer.unobserve(element); observer.observe(element); } });
}
