// POST /api/sessions：入参 source、quizVersion、petType → testId、token（PRD-quiz §7.1）
import { QUIZZES } from "../lib/scoring.js";
import {
  json, apiError, sha256Hex, randomToken, randomTestId, rateLimit, clientIp,
} from "../lib/api.js";

const TTL_30D = 60 * 60 * 24 * 30;

export async function onRequestPost({ request, env }) {
  try {
    if (!rateLimit(`sessions:${clientIp(request)}`)) {
      return apiError("RATE_LIMITED", "请求太频繁，请稍后再试", 429, true);
    }
    const body = await request.json().catch(() => null);
    const { source, quizVersion, petType } = body || {};
    if (!["cat", "dog"].includes(petType)) {
      return apiError("PARAM_MISSING", "petType 必须为 cat 或 dog", 400);
    }
    const quiz = QUIZZES[petType];
    if (!quizVersion || quizVersion !== quiz.quizVersion) {
      // quizVersion 非法或与 petType 不匹配一律 PARAM_MISSING（验收 §10.10）
      return apiError("PARAM_MISSING", "quizVersion 非法或与宠物类型不匹配", 400);
    }

    const testId = randomTestId();
    const token = randomToken();
    const tokenHash = await sha256Hex(token);
    // session:{testId}——token 校验与 petType/quizVersion 来源（PRD §7.5）
    await env.PETI_KV.put(
      `session:${testId}`,
      JSON.stringify({ tokenHash, petType, quizVersion, source: source || "", createdAt: new Date().toISOString() }),
      { expirationTtl: TTL_30D }
    );
    return json({ testId, token });
  } catch (e) {
    return apiError("SERVER_ERROR", "服务暂时不可用，请稍后再试", 500, true);
  }
}
