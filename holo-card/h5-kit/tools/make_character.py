# -*- coding: utf-8 -*-
"""换角色工具：把新角色 PNG 换进全息卡，保持锁定格式不变。

用法（在 h5-kit/ 目录下）：
  python tools/make_character.py --src ../../free-pic/僵尸咪-免费.png \
      --name 僵尸咪 --subtitle 万圣夜行 · 喵灵

只重写三样东西：
  viewer/assets/subject.png   新角色（连通域清理 + 缩放 + 居中）
  viewer/assets/lineart.png   从新角色边缘提取的发光线稿
  viewer/card-config.json     标题/副题等文案（parameters/appearance/safeArea 原样保留）

背景、文字层、card.glb、锁定数值（景深/比例/银箔/光泽）全部不动，
无需重跑 Blender —— 刷新页面即可看到新角色。

可选参数：
  --width 800   主体在画布上的目标宽（锁定格式默认 800）
  --cx 454      主体中心 x（锁定格式默认 454）
  --cy 880      主体中心 y（锁定格式默认 880）
  --technique / --tagline / --collection / --edition   卡面其余文案
  --out <dir>   目标 viewer 目录（默认本 kit 的 viewer/）
"""
import argparse
import json
from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

KIT = Path(__file__).resolve().parent.parent


def clean_subject(src: Image.Image) -> Image.Image:
    """RGBA 主体：只保留面积达标的连通域，全透明区 RGB 清零防晕边。"""
    s = np.array(src.convert("RGBA"))
    sa = s[:, :, 3]
    mask = sa > 40
    labels = np.zeros(mask.shape, np.int32)
    sizes = {}
    cur = 0
    mh, mw = mask.shape
    for y0, x0 in zip(*np.nonzero(mask)):
        if labels[y0, x0]:
            continue
        cur += 1
        dq = deque([(y0, x0)])
        labels[y0, x0] = cur
        n = 0
        while dq:
            y, x = dq.popleft()
            n += 1
            if y > 0 and mask[y - 1, x] and not labels[y - 1, x]:
                labels[y - 1, x] = cur; dq.append((y - 1, x))
            if y < mh - 1 and mask[y + 1, x] and not labels[y + 1, x]:
                labels[y + 1, x] = cur; dq.append((y + 1, x))
            if x > 0 and mask[y, x - 1] and not labels[y, x - 1]:
                labels[y, x - 1] = cur; dq.append((y, x - 1))
            if x < mw - 1 and mask[y, x + 1] and not labels[y, x + 1]:
                labels[y, x + 1] = cur; dq.append((y, x + 1))
        sizes[cur] = n
    biggest = max(sizes.values()) if sizes else 0
    keep_min = max(2000, int(biggest * 0.003))
    keep = np.isin(labels, [i for i, n in sizes.items() if n >= keep_min])
    sa2 = np.where(keep, sa, 0)
    s[:, :, 3] = sa2
    s[sa2 == 0, :3] = 0
    print(f"连通域 {len(sizes)} 个，最大 {biggest}px，保留像素 {int(keep.sum()) / max(int(mask.sum()), 1):.1%}")
    return Image.fromarray(s, "RGBA")


def make_lineart(canvas_subj: Image.Image) -> Image.Image:
    """同一来源边缘阈值提取：深线白底，只取主体轮廓内侧。"""
    W, H = canvas_subj.size
    over_white = Image.alpha_composite(
        Image.new("RGBA", (W, H), (255, 255, 255, 255)), canvas_subj).convert("L")
    g = np.asarray(over_white.filter(ImageFilter.GaussianBlur(1.2))).astype(np.float32)
    gy, gx = np.gradient(g)
    mag = np.hypot(gx, gy)
    a = np.asarray(canvas_subj)[:, :, 3].astype(np.float32) / 255.0
    ay, ax = np.gradient(a)
    a_mag = np.hypot(ax, ay)
    inside = np.asarray(canvas_subj.copy().filter(ImageFilter.MinFilter(3)))[:, :, 3] > 128
    line_mag = np.where(inside, mag, 0.0)
    nz = line_mag > 0
    thr = float(np.percentile(line_mag[nz], 97)) if nz.any() else 1.0
    line = (line_mag >= max(thr, 0.04)) | ((a_mag > 0.35) & inside)
    out = np.full((H, W), 255, np.uint8)
    out[line] = 0
    return Image.fromarray(out).convert("RGB")


def main():
    ap = argparse.ArgumentParser(description="全息卡换角色")
    ap.add_argument("--src", required=True, help="新角色 PNG（需带透明通道）")
    ap.add_argument("--name", required=True, help="卡名（也是卡背首字来源）")
    ap.add_argument("--subtitle", default=None, help="副题/称号")
    ap.add_argument("--technique", default=None, help="招式/标签行")
    ap.add_argument("--tagline", default=None, help="一句话说明")
    ap.add_argument("--collection", default=None, help="收藏系列名（卡背小字）")
    ap.add_argument("--edition", default=None, help="编号，如 002 / 050")
    ap.add_argument("--out", default=str(KIT / "viewer"), help="目标 viewer 目录")
    ap.add_argument("--width", type=int, default=800, help="主体目标宽（锁定格式）")
    ap.add_argument("--cx", type=int, default=454, help="主体中心 x")
    ap.add_argument("--cy", type=int, default=880, help="主体中心 y")
    args = ap.parse_args()

    out = Path(args.out)
    bg_path = out / "assets" / "background.png"
    cfg_path = out / "card-config.json"
    for p in (bg_path, cfg_path):
        if not p.exists():
            raise SystemExit(f"缺少 {p} —— 请对准本 kit 的 viewer 目录")
    W, H = Image.open(bg_path).size

    src = Image.open(args.src)
    if "A" not in src.mode:
        raise SystemExit(f"{args.src} 没有透明通道（模式 {src.mode}），需要 RGBA 角色图")
    subj = clean_subject(src)
    scale = args.width / subj.width
    tw, th = args.width, round(subj.height * scale)
    placed = subj.resize((tw, th), Image.LANCZOS)
    canvas = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    px, py = args.cx - tw // 2, args.cy - th // 2
    canvas.paste(placed, (px, py))
    canvas.save(out / "assets" / "subject.png")
    make_lineart(canvas).save(out / "assets" / "lineart.png")
    print(f"主体 {tw}x{th} @ ({px},{py})，画布 {W}x{H}；subject/lineart 已重写")

    cfg = json.loads(cfg_path.read_text(encoding="utf-8"))
    locked = cfg.get("parameters", {})
    cfg["title"] = args.name
    if args.subtitle: cfg["subtitle"] = args.subtitle
    if args.technique: cfg["technique"] = args.technique
    if args.tagline: cfg["tagline"] = args.tagline
    if args.collection: cfg["collection"] = args.collection
    if args.edition: cfg["edition"] = args.edition
    cfg_path.write_text(json.dumps(cfg, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"card-config.json 已更新：title={args.name}，锁定数值原样保留 {locked}")
    print("完成 —— 刷新页面即可看到新角色（无需 Blender）。")


if __name__ == "__main__":
    main()
