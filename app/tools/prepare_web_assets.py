"""Build lightweight display copies; generation references stay untouched."""
from pathlib import Path
from PIL import Image
import json

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / "public"
def read_roles(filename):
    return json.loads((ROOT / "functions/lib" / filename).read_text(encoding="utf-8").removeprefix("export default ").strip().removesuffix(";"))

version = "20261030-v2"
background = Image.open(PUBLIC / "holo-card/assets/background.png").convert("RGBA")
for pet, mapping in [("cat", "role-references.js"), ("dog", "dog-role-references.js")]:
    roles = read_roles(mapping)
    source_dir = ROOT.parent / ("free-pic-dog" if pet == "dog" else "free-pic")
    cards = PUBLIC / "static-cards" / version / pet
    thumbs = PUBLIC / "role-thumbnails" / version / pet
    cards.mkdir(parents=True, exist_ok=True)
    thumbs.mkdir(parents=True, exist_ok=True)
    ids = [role["id"] for role in json.loads((PUBLIC / f"data/quiz-{pet}.json").read_text(encoding="utf-8"))["characters"]]
    if set(ids) != set(roles) or len(ids) != 16:
        raise ValueError(f"Missing roles for {pet}")
    atlas = Image.new("RGBA", (1280, 1280))
    for index, role in enumerate(ids):
        with Image.open(source_dir / roles[role]) as original:
            subject = original.convert("RGBA")
            box = subject.getchannel("A").point(lambda alpha: 255 if alpha > 5 else 0).getbbox()
            if not box:
                raise ValueError(f"Empty role image: {pet}/{role}")
            subject = subject.crop(box)
            thumbnail = subject.copy()
            thumbnail.thumbnail((320, 320), Image.Resampling.LANCZOS)
            thumbnail.save(thumbs / f"{role}.webp", "WEBP", quality=74, method=6, exact=True)
            x = (index % 4) * 320 + (320 - thumbnail.width) // 2
            y = (index // 4) * 320 + (320 - thumbnail.height) // 2
            atlas.alpha_composite(thumbnail, (x, y))
            card = background.resize((900, 1380), Image.Resampling.LANCZOS)
            subject.thumbnail((792, 966), Image.Resampling.LANCZOS)
            card.alpha_composite(subject, ((900 - subject.width) // 2, round(1380 * 0.47 - subject.height / 2)))
            card.save(cards / f"{role}.webp", "WEBP", quality=94, method=6, exact=True)
            # 大图查看用 JPG，长按保存时得到通用格式；展示与预取继续用 WebP。
            card.convert("RGB").save(cards / f"{role}.jpg", "JPEG", quality=90, optimize=True, progressive=True, subsampling=0)
    atlas.save(thumbs / "atlas.webp", "WEBP", quality=80, method=6, exact=True)
    print(f"{pet}: 16 cards {sum(p.stat().st_size for p in cards.glob('*.webp')) / 1024:.0f}KiB; atlas {(thumbs / 'atlas.webp').stat().st_size / 1024:.0f}KiB", flush=True)
