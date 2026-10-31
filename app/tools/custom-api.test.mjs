import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { GENERATION_CONFIG } from "../functions/lib/generation-config.js";
import { PET_ROLE_FILES, referenceKey } from "../functions/lib/pet-role-references.js";

const emptyConfig = structuredClone(GENERATION_CONFIG);
afterEach(() => { Object.assign(GENERATION_CONFIG, structuredClone(emptyConfig)); });

test("猫狗各16角色使用独立参考图和对应原文Prompt", () => {
  for (const pet of ["cat", "dog"]) {
    const prompt = pet === "cat" ? "pet-character.md" : "pet-character-dog.md";
    assert.equal(GENERATION_CONFIG.prompts[pet], readFileSync(new URL(`../../doc/prompts/${prompt}`, import.meta.url), "utf8").trim().replaceAll("\r\n", "\n"));
    const roles = PET_ROLE_FILES[pet];
    const quiz = JSON.parse(readFileSync(new URL(`../public/data/quiz-${pet}.json`, import.meta.url), "utf8"));
    assert.equal(Object.keys(roles).length, 16);
    assert.deepEqual(quiz.characters.map(role => role.id).sort(), Object.keys(roles).sort());
    for (const [role, filename] of Object.entries(roles)) {
      assert.equal(GENERATION_CONFIG.roleImageKeys[pet][role], referenceKey(pet, role));
      const original = readFileSync(new URL(`../../${pet === "dog" ? "free-pic-dog" : "free-pic"}/${filename}`, import.meta.url));
      assert.equal(original.toString("ascii", 1, 4), "PNG");
    }
  }
  assert.notEqual(GENERATION_CONFIG.roleImageKeys.cat.ghost, GENERATION_CONFIG.roleImageKeys.dog.ghost);
});
