import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { GENERATION_CONFIG, generationSnapshot } from "../functions/lib/generation-config.js";
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

test("猫狗参考图来自各自目录，同角色内容不能复用", () => {
  const hash = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
  for (const role of Object.keys(PET_ROLE_FILES.cat)) {
    const cat = hash(new URL(`../../free-pic/${PET_ROLE_FILES.cat[role]}`, import.meta.url));
    const dog = hash(new URL(`../../free-pic-dog/${PET_ROLE_FILES.dog[role]}`, import.meta.url));
    assert.notEqual(cat, dog, `${role} 的狗参考图仍与猫参考图相同`);
    assert.notEqual(referenceKey("cat", role), referenceKey("dog", role));
  }
});

test("猫狗各16角色使用图1/图2多图融合Prompt，未知角色回落统一Prompt", () => {
  const repository = JSON.parse(readFileSync(new URL("../functions/lib/generation-prompts.json", import.meta.url), "utf8"));
  assert.deepEqual(repository.imageOrder, ["图1 = 用户宠物照片（image[0]）", "图2 = 角色参考图（image[1]）"]);
  assert.equal(GENERATION_CONFIG.prompts.cat, repository.cat.default);
  assert.equal(GENERATION_CONFIG.prompts.dog, repository.dog.default);
  assert.deepEqual(GENERATION_CONFIG.rolePrompts.cat, repository.cat.roles);
  assert.deepEqual(GENERATION_CONFIG.rolePrompts.dog, repository.dog.roles);

  const combined = new Map();
  for (const name of readdirSync(new URL("../../doc/prompts/cat-roles/combined/", import.meta.url))) {
    const match = /^\d{2}-([a-z]+)\.txt$/.exec(name);
    if (match) combined.set(match[1], name);
  }
  assert.deepEqual(Object.keys(GENERATION_CONFIG.rolePrompts.cat).sort(), Object.keys(PET_ROLE_FILES.cat).sort());
  assert.equal(Object.keys(GENERATION_CONFIG.rolePrompts.cat).length, 16);
  for (const [role, name] of combined) {
    const source = readFileSync(new URL(`../../doc/prompts/cat-roles/combined/${name}`, import.meta.url), "utf8").trim().replaceAll("\r\n", "\n");
    assert.equal(GENERATION_CONFIG.rolePrompts.cat[role], source);
    assert.match(source, /图1/);
    assert.match(source, /图2/);
    assert.doesNotMatch(source, /图[一二]/);
    const snapshot = generationSnapshot({ petType: "cat", roleId: role });
    assert.equal(snapshot.prompt, source);
    assert.equal(snapshot.promptId, `cat:${role}`);
  }

  assert.deepEqual(Object.keys(GENERATION_CONFIG.rolePrompts.dog).sort(), Object.keys(PET_ROLE_FILES.dog).sort());
  assert.equal(Object.keys(GENERATION_CONFIG.rolePrompts.dog).length, 16);
  for (const role of Object.keys(PET_ROLE_FILES.dog)) {
    const source = readFileSync(new URL(`../../doc/prompts/dog-roles/${role}.md`, import.meta.url), "utf8").trim().replaceAll("\r\n", "\n");
    assert.equal(GENERATION_CONFIG.rolePrompts.dog[role], source);
    assert.match(source, /图1/);
    assert.match(source, /图2/);
    assert.doesNotMatch(source, /图[一二]/);
    const snapshot = generationSnapshot({ petType: "dog", roleId: role });
    assert.equal(snapshot.prompt, source);
    assert.equal(snapshot.promptId, `dog:${role}`);
  }

  const fallback = generationSnapshot({ petType: "dog", roleId: "unknown" });
  assert.equal(fallback.prompt, GENERATION_CONFIG.prompts.dog);
  assert.equal(fallback.promptId, "dog:default");
});
