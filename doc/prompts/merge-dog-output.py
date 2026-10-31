# -*- coding: utf-8 -*-
"""把 DeepSeek 输出的狗狗版文案拼回 quiz-dog.json：只换 scene/text/option.text，其余字段不动。"""
import json
import re
from pathlib import Path

root = Path(__file__).resolve().parents[2]
dog_path = root / "app" / "public" / "data" / "quiz-dog.json"
raw_path = Path(__file__).resolve().parent / "dog-quiz-output.raw.txt"

dog = json.loads(dog_path.read_text(encoding="utf-8"))
raw = raw_path.read_text(encoding="utf-8").strip()
raw = re.sub(r"^```(?:json)?\s*", "", raw)
raw = re.sub(r"\s*```$", "", raw)
new = json.loads(raw)

assert len(new["questions"]) == 10, "题量不对"
by_id = {q["id"]: q for q in new["questions"]}
assert set(by_id) == {f"q{i}" for i in range(1, 11)}, "题目 id 不对"
banned = ("猫", "咪", "喵", "罐罐")
for q in dog["questions"]:
    src = by_id[q["id"]]
    smap = {o["id"]: o["text"] for o in src["options"]}
    assert set(smap) == {o["id"] for o in q["options"]}, f"{q['id']} 选项 id 不对"
    joined = src["scene"] + src["text"] + "".join(smap.values())
    for word in banned:
        assert word not in joined, f"{q['id']} 出现禁词 {word}"
    q["scene"] = src["scene"]
    q["text"] = src["text"]
    for o in q["options"]:
        o["text"] = smap[o["id"]]

dog_path.write_text(json.dumps(dog, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print("merged OK")
