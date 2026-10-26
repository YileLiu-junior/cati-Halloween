# PostHog 同域反代部署指南（Cloudflare Pages）

版本 v1.0 ｜ 2026-10-27 ｜ 读者：开发；标注「项目所有者」的步骤只有你能做。
目的：大陆用户埋点不直连海外 PostHog，经本站同域 `/ingest` 转发；顺带规避广告拦截器。
官方依据：proxy-reference 与 Cloudflare 指南（链接见文末）。官方 Cloudflare 方案是「独立 Worker 绑自有子域名」；本文改为 Pages Functions 同域路径实现，代码同源，`pages.dev` 域名即可用。

## 0. 结论速览

1. 方案：产品仓库加 1 个 Pages Function 文件 + 前端 init 3 行，无环境变量。
2. 费用：PostHog 免费档（100 万事件/月，无需信用卡）；Pages Functions 免费档 10 万请求/天。
3. 只有一步需要项目所有者亲手做：注册 PostHog、拿 Project API key（§1）。

## 1. 注册与建项目（项目所有者，约 5 分钟）

1. 打开 https://posthog.com 注册（邮箱或 Google/GitHub 登录，免信用卡）。
2. 建项目时选区域：本指南按 **US** 写；选 EU 则把下文所有 `us` 主机换成 `eu` 对应主机。区域事后不可改。
3. Project settings → 复制 **Project API key**（`phc_` 开头）。这是公开 key，可放前端；不要用个人账号 key。
4. 面板地址确认区域：`us.posthog.com` = US。

## 2. 产品仓库加反代函数

1. 在产品仓库（Cloudflare Pages 项目根）新建 `functions/ingest/[[path]].js`（catch-all 路由）。
2. 内容如下——官方 Cloudflare Worker 代码移植为 Pages Functions，并增加 `/ingest` 前缀剥离：

```js
// PostHog 同域反代（US 区；EU 换 eu.i.posthog.com / eu-assets.i.posthog.com）
const API_HOST = "us.i.posthog.com"
const ASSET_HOST = "us-assets.i.posthog.com"
const PROXY_PREFIX = "/ingest"

async function forwardRequest(request, pathWithSearch) {
  const ip = request.headers.get("CF-Connecting-IP") || ""
  const headers = new Headers(request.headers)
  headers.delete("cookie")
  headers.delete("authorization")
  headers.set("X-Forwarded-For", ip)

  return fetch(`https://${API_HOST}${pathWithSearch}`, {
    method: request.method,
    headers,
    body: request.method !== "GET" && request.method !== "HEAD" ? await request.arrayBuffer() : null,
    redirect: request.redirect
  })
}

async function retrieveAsset(request, pathWithSearch, ctx) {
  let response = await caches.default.match(request)
  if (!response) {
    response = await fetch(`https://${ASSET_HOST}${pathWithSearch}`)
    ctx.waitUntil(caches.default.put(request, response.clone()))
  }
  return response
}

export async function onRequest(ctx) {
  const request = ctx.request
  const url = new URL(request.url)
  const path = url.pathname.startsWith(PROXY_PREFIX) ? url.pathname.slice(PROXY_PREFIX.length) : url.pathname
  const pathWithSearch = path + url.search

  if (path.startsWith("/static/") || path.startsWith("/array/")) {
    return retrieveAsset(request, pathWithSearch, ctx)
  }
  return forwardRequest(request, pathWithSearch)
}
```

3. 要点：`/static/`、`/array/` 走资产主机并走 Cloudflare 缓存，其余转发采集主机；删 `cookie`/`authorization`，把真实 IP 写进 `X-Forwarded-For`（保住地理信息，丢了会全部显示 Cloudflare 机房）；请求体上限满足官方要求的 64MB。
4. 改完正常部署，`functions/` 目录随 Pages 项目自动生效。

## 3. 前端 init

```html
<script src="/ingest/static/array.js"></script>
<script>
  // 先消费再剥离，顺序不能反：落地页在此读渠道参数；找回页在此读片段中的口令。
  // 剥掉查询串与片段后才 init，口令不进 PostHog 的 $current_url（上游隐私硬要求）。
  var source = new URLSearchParams(location.search).get('source')
  if (location.search || location.hash) history.replaceState(null, '', location.pathname)

  posthog.init('<ph_project_token>', {
    api_host: '/ingest',
    ui_host: 'https://us.posthog.com',
    autocapture: false,
    capture_pageview: false,
    disable_session_recording: true
  })
</script>
```

1. `ui_host` 必填，否则工具栏与录制回放失效（官方明示）。
2. 本活动只用 5 个自定义事件（见 `doc/interaction-design.md` §6），关 autocapture、自动 pageview 与会话录制，避免事件噪声并满足上游「不采集会话录屏、不记恢复 URL」要求。
3. SDK 与上报全部走同域 `/ingest`：无 CORS、无第三方脚本源（jsdelivr 等公共 CDN 会被部分拦截器拦），§2 的资产缓存分支随之真实生效。

## 4. 部署与验证

1. 部署后打开 H5，DevTools → Network：应看到发往 `本站/ingest/…` 的请求且返回 200——`/ingest/static/array.js`（SDK 本体，同域加载）、`/ingest/array/…`（配置）、`/ingest/e/`（事件上报）。
2. PostHog 面板 → Live events：1 分钟内出现事件（面板刷新偶有分钟级延迟）。
3. 逐个触发五个事件核对：landing_view、quiz_start、quiz_answer、quiz_complete、result_view。

## 5. 漏斗看板（验收用）

1. 面板建 Funnel：landing_view → quiz_start → quiz_complete → result_view（quiz_answer 是过程事件，不进漏斗）。
2. 验收口径：完成数/开始数 = quiz_complete / quiz_start > 60%（`doc/PRD-quiz.md` §8）。

## 6. 故障速查（官方排查表摘编）

| 症状 | 原因 |
|---|---|
| 401 | 区域不匹配（函数常量与项目区域不一致）；或请求体被平台剥离丢 key |
| 405 | 代理拦了方法；确保 GET/POST 都放行（本函数全部转发） |
| 事件不显示 | 用了个人 key 而非 Project API key；或刚部署等几分钟 |
| 用户位置全是 Cloudflare 机房 | `X-Forwarded-For` 逻辑失效 |
| 工具栏/录制回放打不开 | 漏配 `ui_host` |

## 7. 值守注意（10-31 19–22 点）

1. 大陆直开 PostHog 面板可能慢或超时，提前确定一个当晚可达的查看方式（含备用代理）。
2. 事件有分钟级延迟，漏斗数字看趋势即可，不追单分钟波动。
3. 上线前一天按 §4 完整走一遍验证，别当晚首跑。

## 8. 备选方案（不推荐，仅记录）

自有域名的话，可按官方 Cloudflare 指南部署独立 Worker 并绑定 `e.<你的域名>` 子域名（代码即 §2 去掉前缀剥离的原版，`api_host` 写完整子域）。需要自有域名托管在 Cloudflare，多一次域名解析配置；同域路径方案无此依赖，故为主方案。

## 参考

- 反代技术要求：https://posthog.com/docs/advanced/proxy/proxy-reference
- Cloudflare 指南（官方原版）：https://posthog.com/docs/advanced/proxy/cloudflare
- 定价：https://posthog.com/pricing
