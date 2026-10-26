// PostHog 同域反代（doc/posthog-proxy-setup.md §2，US 区；onRequest(ctx) 修复版）
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
