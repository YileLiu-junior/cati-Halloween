# 一次性脚本：把 combined/*.txt 的“黑白默认身份”替换为“完全以图一为准”，并删掉角色段里重复的尾巴颜色/白爪/灰虎斑禁令。
import re
import shutil
from pathlib import Path

base_dir = Path(__file__).resolve().parent
combined = base_dir / "combined"
backup = combined / "_before-generic"
backup.mkdir(exist_ok=True)

base = (base_dir / "shared-generic.md").read_text(encoding="utf-8").strip()

files = [
    "01-ghost", "02-zombie", "03-chainsaw", "04-mummy", "05-nurse", "06-vampire",
    "07-franken", "08-pirate", "09-clown", "10-bride", "11-witch", "12-pumpkin",
    "13-werewolf", "14-bat", "15-gargoyle", "16-pharaoh",
]

remove_tail_bullet = {"02-zombie", "05-nurse", "07-franken", "09-clown", "14-bat", "16-pharaoh"}
remove_identity_line = {"09-clown", "14-bat"}


def replace_defaults(role: str) -> str:
    pairs = [
        ("两只白色前爪", "两只前爪"),
        ("两只白色后爪", "两只后爪"),
        ("两只白色前腿", "两只前腿"),
        ("一只白色前爪", "一只前爪"),
        ("白色前爪", "前爪"),
        ("白色后爪", "后爪"),
        ("白色前腿", "前腿"),
        ("白色后腿", "后腿"),
        ("虹膜按图一深橄榄绿", "虹膜按图一"),
        ("若睁眼，虹膜按图一深橄榄绿，不用棕色", "若睁眼，虹膜按图一"),
        ("猫脸必须保持图一黑白身份——头部黑色头盔、额头白色纵纹、白色口鼻和脸颊", "猫脸的毛色、花纹、瞳色和面部特征点按图一"),
        ("猫本体必须保持图一黑白——头部黑色头盔、额头白色纵纹、脸颊纯白；白布下的身体只用黑白两色，禁止灰色虎斑额头条纹、灰色脸颊斑块和灰色身体。", "猫本体的毛色、花纹、瞳色和面部特征点按图一；白布下的身体也用图一的毛色和花纹简化表现。"),
        ("猫本体必须保持图一黑白，禁止把参考图三花猫的橘色、黑色斑块或灰色条纹带到猫身上。", "猫本体的毛色、花纹、瞳色和面部特征点按图一。"),
        ("以纯黑色为主，可保留白色尾尖，禁止复制图二的灰白环纹", "颜色、花纹和形状按图一，不要自行添加环纹或条纹"),
        ("纯黑为主，可白色尾尖；禁止环纹和灰色虎斑条纹", "颜色、花纹和形状按图一，不要自行添加环纹或条纹"),
        ("纯黑为主，可白色尾尖；禁止环纹和虎斑", "颜色、花纹和形状按图一，不要自行添加环纹或条纹"),
        ("纯黑为主，可白色尾尖；禁止环纹和橘色斑块", "颜色、花纹和形状按图一，不要自行添加环纹或条纹"),
        ("纯黑为主，可白色尾尖；禁止环纹", "颜色、花纹和形状按图一，不要自行添加环纹或条纹"),
        ("纯黑色为主，可白色尾尖；禁止环纹", "颜色、花纹和形状按图一，不要自行添加环纹或条纹"),
        ("使用图一的纯黑色简化色块，可有白色尾尖。绝对不能出现参考图的灰白环纹或灰色条纹。", "颜色、花纹和形状按图一，不要自行添加环纹或条纹。"),
        ("颜色遵循图一的身份要求", "颜色和花纹按图一"),
        ("，保持纯白。", "。"),
        ("，周围仍是纯白背景。", "。"),
    ]
    for old, new in pairs:
        role = role.replace(old, new)
    return role


def clean_lines(role: str, stem: str) -> str:
    lines = role.splitlines()
    kept = []
    for line in lines:
        s = line.strip()
        if s.startswith("- 禁止：不要把参考图的灰色额头条纹"):
            continue
        if s.startswith("- 禁止：猫本体必须是图一黑白猫"):
            continue
        if s.startswith("- 禁止：不要把参考图猫的灰色额头条纹"):
            continue
        if stem in remove_identity_line and s.startswith("- 身份："):
            continue
        if stem in remove_tail_bullet and s.startswith("- 尾巴："):
            continue
        kept.append(line)
    return "\n".join(kept).strip()


for stem in files:
    path = combined / f"{stem}.txt"
    original = path.read_text(encoding="utf-8")
    shutil.copy2(path, backup / f"{stem}.txt")

    if stem == "01-ghost":
        role_body = original.split("【图2姿势与可见四肢】", 1)[1].strip()
        role = f"""【角色：小幽灵咪】
- 服装与姿势：{role_body}
- 表情：安静、轻微歪头。
- 禁止：不要把幽灵披布画成塑料袋、玻璃或强反光材质。"""
    else:
        marker = original.rfind("【角色：")
        if marker < 0:
            raise SystemExit(f"找不到角色段：{stem}")
        role = original[marker:].strip()

    role = replace_defaults(role)
    role = clean_lines(role, stem)
    composed = f"{base}\n\n【角色专属要求】\n\n{role}\n"
    path.write_text(composed, encoding="utf-8")

# 校验：角色段里不应再出现默认身份词
banned = ["黑白", "纯黑", "白色前爪", "白色后爪", "白色前腿", "白色后腿", "深橄榄绿", "灰色虎斑", "三花", "黑色头盔", "白色纵纹", "图一黑白", "白色尾尖"]
report = []
for stem in files:
    text = (combined / f"{stem}.txt").read_text(encoding="utf-8")
    role = text.split("【角色专属要求】", 1)[1]
    hits = []
    for line in role.splitlines():
        for word in banned:
            if word in line:
                hits.append(f"{word}: {line.strip()}")
    if hits:
        report.append(f"===== {stem} =====\n" + "\n".join(hits))
(base_dir / "_validation.txt").write_text("\n\n".join(report) if report else "OK: no default identity terms in role sections.", encoding="utf-8")
print("rewritten; validation written")
