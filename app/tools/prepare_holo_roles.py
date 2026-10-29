"""Prepare the role layers with the original holographic-card tool."""
from pathlib import Path
import sys
import shutil
import json

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "holo-card/h5-kit/tools"))
from make_character import clean_subject, make_lineart

# 映射使用 JSON 对象语法，去掉 JS 导出声明即可读取同一份数据。
ROLES = json.loads((ROOT / "app/functions/lib/role-references.js").read_text(encoding="utf-8").removeprefix("export default ").strip().removesuffix(";"))

out = ROOT / "app/public/holo-card/roles"
out.mkdir(parents=True, exist_ok=True)
references = ROOT / "app/public/role-references"
references.mkdir(parents=True, exist_ok=True)
size = Image.open(ROOT / "holo-card/h5-kit/viewer/assets/background.png").size
for role, filename in ROLES.items():
    shutil.copyfile(ROOT / "free-pic" / filename, references / f"{role}.png")
    source = Image.open(ROOT / "free-pic" / filename)
    if "A" not in source.mode:
        raise ValueError(f"{filename} has no alpha channel")
    subject = clean_subject(source)
    height = round(subject.height * 800 / subject.width)
    canvas = Image.new("RGBA", size)
    canvas.paste(subject.resize((800, height), Image.Resampling.LANCZOS), (54, 880 - height // 2))
    canvas.save(out / f"{role}.png")
    make_lineart(canvas).save(out / f"{role}-line.png")
    print(role, flush=True)
