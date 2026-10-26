// POST /api/results：入参 token、testId、optionIds、petName → 服务端计分（PRD-quiz §7.2）
import { QUIZZES, scoreAnswers, rolePayload } from "../lib/scoring.js";
import {
  json, apiError, sha256Hex, randomPublicId, petNameCodePoints,
} from "../lib/api.js";

const TTL_30D = 60 * 60 * 24 * 30;

export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json().catch(() => null);
    const { token, testId, optionIds, petName } = body || {};
    if (!token || !testId) {
      return apiError("PARAM_MISSING", "缺少 token 或 testId", 400);
    }

    const sessRaw = await env.PETI_KV.get(`session:${testId}`);
    if (!sessRaw) return apiError("TOKEN_INVALID", "会话不存在或已过期", 401);
    const sess = JSON.parse(sessRaw);
    const tokenHash = await sha256Hex(token);
    if (tokenHash !== sess.tokenHash) {
      return apiError("TOKEN_INVALID", "口令无效", 401);
    }

    if (!Array.isArray(optionIds) || optionIds.length !== 10) {
      return apiError("PARAM_MISSING", "答案必须为 10 个选项", 400);
    }
    if (typeof petName !== "string" || petNameCodePoints(petName) === 0) {
      return apiError("PARAM_MISSING", "宠物名不能为空", 400);
    }
    if (petNameCodePoints(petName) > 12) {
      return apiError("PET_NAME_TOO_LONG", "宠物名限 1–12 字", 400);
    }

    // 幂等：同 token+testId 重复提交返回原结果原 publicId（PRD §7.2，KV 无原子写，单写路径+先查后写兜底双击）
    const existingRaw = await env.PETI_KV.get(`result:${testId}`);
    if (existingRaw) {
      const existing = JSON.parse(existingRaw);
      if (existing.tokenHash === tokenHash) {
        const quiz = QUIZZES[existing.petType] || QUIZZES[sess.petType];
        return json({ ...rolePayload(quiz, existing.roleId), axes: existing.axes, publicId: existing.publicId, petType: existing.petType, quizVersion: existing.quizVersion, petName: existing.petName, idempotent: true });
      }
      return apiError("TOKEN_INVALID", "口令无效", 401);
    }

    const quiz = QUIZZES[sess.petType] || QUIZZES[sess.quizVersion.split("-")[0]];
    const scored = scoreAnswers(quiz, optionIds);
    if (!scored) {
      return apiError("PARAM_MISSING", "答案含非法选项", 400);
    }
    const payload = rolePayload(quiz, scored.roleId);
    const publicId = randomPublicId();
    const record = {
      testId,
      petType: sess.petType,
      quizVersion: sess.quizVersion,
      optionIds,
      petName,
      roleId: scored.roleId,
      axes: scored.axes,
      publicId,
      tokenHash,
      createdAt: new Date().toISOString(),
      status: "completed", // 终态不回退（PRD §7.5）
    };
    await env.PETI_KV.put(`result:${testId}`, JSON.stringify(record), { expirationTtl: TTL_30D });
    return json({ ...payload, axes: record.axes, publicId, petType: record.petType, quizVersion: record.quizVersion, petName });
  } catch (e) {
    return apiError("SERVER_ERROR", "服务暂时不可用，请稍后再试", 500, true);
  }
}
