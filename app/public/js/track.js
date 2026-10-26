// 埋点：PostHog 经同域 /ingest 反代；SDK 加载失败静默跳过，不阻塞产品（doc/posthog-proxy-setup.md §3）
let ph = null;

export function initTrack() {
  try {
    const s = document.createElement("script");
    s.src = "/ingest/static/array.js";
    s.async = true;
    s.onload = () => {
      try {
        window.posthog.init(window.PETI_CONFIG.posthogToken, {
          api_host: "/ingest",
          ui_host: "https://us.posthog.com",
          autocapture: false,
          capture_pageview: false,
          disable_session_recording: true,
        });
        ph = window.posthog;
        track("landing_view", { entry: ph ? "web" : "unknown" });
      } catch {
        /* 埋点失败不阻塞 */
      }
    };
    s.onerror = () => {
      /* 反代/网络不可达：MVP 跳过 */
    };
    document.head.appendChild(s);
  } catch {
    /* ignore */
  }
}

export function track(name, props = {}) {
  try {
    ph?.capture(name, props);
  } catch {
    /* ignore */
  }
}
