"""Prepare the role layers with the original holographic-card tool."""
from pathlib import Path
import sys

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "holo-card/h5-kit/tools"))
from make_character import clean_subject, make_lineart

ROLES = {
    "ghost": "小幽灵咪.png", "zombie": "僵尸咪-免费.png",
    "chainsaw": "电锯咪-免费.png", "mummy": "木乃伊咪-免费.png",
    "nurse": "小管家咪-免费.png", "vampire": "吸血鬼咪.png",
    "franken": "科学怪人咪.png", "pirate": "海盗咪-免费.png",
    "clown": "小鬼咪（替代小丑咪）-免费.png", "bride": "月光新娘咪.png",
    "witch": "女巫咪-免费.png", "werewolf": "狼人咪-免费.png",
    "bat": "蝙蝠咪-免费.png", "gargoyle": "贪睡财神咪.png",
    "pharaoh": "埃及法老咪.png", "pumpkin": "南瓜咪-免费.png",
}

out = ROOT / "app/public/holo-card/roles"
out.mkdir(parents=True, exist_ok=True)
size = Image.open(ROOT / "holo-card/h5-kit/viewer/assets/background.png").size
for role, filename in ROLES.items():
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
