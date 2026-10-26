// POST /api/recover：入参 token、testId → 原结果；失败统一不泄露存在性（PRD-quiz §7.7/§4.5）
import { QUIZZES, rolePayload } from "../lib/scoring.js";
import { json, apiError, sha256Hex } from "../lib/api.js";

export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json().catch(() => null);
    const { token, testId } = body || {};
    if (!token || !testId) {
      return apiError("TOKEN_INVALID", "口令无效或已超过保留期", 401);
    }

    const sessRaw = await env.PETI_KV.get(`session:${testId}`);
    const resultRaw = await env.PETI_KV.get(`result:${testId}`);
    const tokenHash = await sha256Hex(token);

    // 会话与结果都在且口令匹配才返回；任何失败同一错误码，不泄露结果是否存在
    if (!resultRaw || !sessRaw) {
      return apiError("TOKEN_INVALID", "口令无效或已超过保留期", 401);
    }
    const result = JSON.parse(resultRaw);
    if (result.tokenHash !== tokenHash) {
      return apiError("TOKEN_INVALID", "口令无效或已超过保留期", 401);
    }
    const quiz = QUIZZES[result.petType];
    return json({
      ...rolePayload(quiz, result.roleId),
      axes: result.axes,
      publicId: result.publicId,
      petType: result.petType,
      quizVersion: result.quizVersion,
      petName: result.petName,
    });
  } catch (e) {
    return apiError("SERVER_ERROR", "服务暂时不可用，请稍后再试", 500, true);
  }
}
