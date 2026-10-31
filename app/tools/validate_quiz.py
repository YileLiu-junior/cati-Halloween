# -*- coding: utf-8 -*-
"""题库 JSON 校验（balance-check.py 的 JSON 版随迁，PRD-quiz §6.1）

用法: python tools/validate_quiz.py
检查：
1. 结构完整：16 角色 / 10 题 / 每题 5 选项（含 1 个中庸选项）/ TIE_BREAK 恰含 16 个角色 id
2. 加分合法：中庸选项 axis=None、delta=0、points 为空；其余 axis ∈ 六轴、delta=±3、points 角色存在
3. 题干精简：每题题干不超过 25 个可见字符
4. 猫狗同构：两版每题 optionId、axis、delta、points 完全一致（quiz-design-dog §0 承诺）
5. 可达性与占比：随机模拟 20000 次，全部角色可达；输出中庸选项占比与平局率
"""
import json
import random
import statistics
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
AXES = ["E", "A", "B", "D", "F", "C"]
CHAR_IDS = {"ghost", "zombie", "chainsaw", "mummy", "nurse", "vampire", "franken",
            "pirate", "clown", "bride", "witch", "pumpkin", "werewolf", "bat",
            "gargoyle", "pharaoh"}


def load(pet):
    path = ROOT / "public" / "data" / f"quiz-{pet}.json"
    return json.loads(path.read_text(encoding="utf-8"))


def check_structure(data, pet):
    errors = []
    ids = {c["id"] for c in data["characters"]}
    if ids != CHAR_IDS:
        errors.append(f"{pet}: 角色集合不符 {CHAR_IDS ^ ids}")
    if len(data["tieBreak"]) != 16 or set(data["tieBreak"]) != CHAR_IDS:
        errors.append(f"{pet}: TIE_BREAK 必须恰含 16 个角色 id 各一次")
    if data["petType"] != pet:
        errors.append(f"{pet}: petType 字段不符")
    qs = data["questions"]
    if len(qs) != 10:
        errors.append(f"{pet}: 题量 {len(qs)} != 10")
    for q in qs:
        opts = q["options"]
        if len(opts) != 5:
            errors.append(f"{pet} {q['id']}: 选项数 {len(opts)} != 5")
        if len(q["text"]) > 25:
            errors.append(f"{pet} {q['id']}: 题干 {len(q['text'])} 字 > 25")
        neutrals = [o for o in opts if o["axis"] is None]
        if len(neutrals) != 1:
            errors.append(f"{pet} {q['id']}: 中庸选项数 {len(neutrals)} != 1")
        for o in opts:
            if o["axis"] is None:
                if o["delta"] != 0 or o["points"] != {}:
                    errors.append(f"{pet} {q['id']}/{o['id']}: 中庸选项须 delta=0 且 points 为空")
                continue
            if o["axis"] not in AXES:
                errors.append(f"{pet} {q['id']}/{o['id']}: 非法轴 {o['axis']}")
            if o["delta"] not in (3, -3):
                errors.append(f"{pet} {q['id']}/{o['id']}: delta 非 ±3")
            for cid in o["points"]:
                if cid not in CHAR_IDS:
                    errors.append(f"{pet} {q['id']}/{o['id']}: 未知角色 {cid}")
    # 稀有度齐全
    for c in data["characters"]:
        if not isinstance(c.get("rarityPct"), (int, float)):
            errors.append(f"{pet}: {c['id']} 缺 rarityPct")
    return errors


def check_isomorphic(cat, dog):
    errors = []
    for qc, qd in zip(cat["questions"], dog["questions"]):
        if qc["id"] != qd["id"]:
            errors.append(f"题序不一致: {qc['id']} vs {qd['id']}")
        for oc, od in zip(qc["options"], qd["options"]):
            if oc["id"] != od["id"]:
                errors.append(f"{qc['id']}: optionId 不一致 {oc['id']} vs {od['id']}")
            for field in ("axis", "delta", "points"):
                if oc[field] != od[field]:
                    errors.append(f"{qc['id']}/{oc['id']}: {field} 猫狗不一致 {oc[field]} vs {od[field]}")
    return errors


def score(picks):
    chars = Counter({cid: 0 for cid in CHAR_IDS})
    axis = {a: 5.0 for a in AXES}
    for (axis_delta, char_pts) in picks:
        a, d = axis_delta
        if a is not None:
            axis[a] += d
        for cid, pts in char_pts:
            chars[cid] += pts
    return chars, [max(0.0, min(10.0, axis[a])) for a in AXES]


def simulate(data, n=20000, seed=42):
    rng = random.Random(seed)
    tie = data["tieBreak"]
    tally = Counter()
    axis_sums = []
    neutral_picks = 0
    tie_tests = 0
    for _ in range(n):
        picks = []
        for q in data["questions"]:
            o = rng.choice(q["options"])
            if o["axis"] is None:
                neutral_picks += 1
            picks.append(((o["axis"], o["delta"]), list(o["points"].items())))
        chars, vec = score(picks)
        top = max(chars.values())
        winners = [cid for cid in tie if chars[cid] == top]
        if len(winners) > 1:
            tie_tests += 1
        tally[winners[0]] += 1
        axis_sums.append(vec)
    return tally, axis_sums, n, neutral_picks, tie_tests


def main():
    cat, dog = load("cat"), load("dog")
    errors = check_structure(cat, "cat") + check_structure(dog, "dog")
    errors += check_isomorphic(cat, dog)

    name_map = {c["id"]: c["name"] for c in cat["characters"]}
    warnings = []
    for pet, data in (("cat", cat), ("dog", dog)):
        tally, axis_sums, n, neutral_picks, tie_tests = simulate(data)
        shares = {cid: tally.get(cid, 0) / n * 100 for cid in CHAR_IDS}
        missing = [name_map[c] for c in CHAR_IDS if shares[c] == 0]
        if missing:
            errors.append(f"{pet}: 抽不中角色 {missing}")
        for cid in CHAR_IDS:
            if 0 < shares[cid] < 0.5:
                warnings.append(f"{pet}: 角色 {name_map[cid]} 份额 {shares[cid]:.2f}% < 0.5%")
        means = [statistics.mean(v[i] for v in axis_sums) for i in range(6)]
        print(f"== {pet} 模拟（n={n}，种子 42）==")
        for cid in sorted(CHAR_IDS, key=lambda c: -shares[c]):
            print(f"  {shares[cid]:5.1f}%  {name_map[cid]}")
        print("  六轴均值:", {a: round(m, 1) for a, m in zip(AXES, means)})
        print(f"  中庸选项占比: {neutral_picks / (n * len(data['questions'])) * 100:.1f}%")
        print(f"  平局率: {tie_tests / n * 100:.1f}%")
        print()

    if warnings:
        print("警告（不阻断）：")
        for w in warnings:
            print("  -", w)
    if errors:
        print("校验失败：")
        for e in errors:
            print("  -", e)
        sys.exit(1)
    print("校验通过：结构 / 加分 / 题干 / 猫狗同构 / 可达性 全部 OK")


if __name__ == "__main__":
    main()
