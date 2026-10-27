# -*- coding: utf-8 -*-
"""把现有素材切成全息卡五层：背景压平、主体去杂点、线稿提取。

输入（仓库根，相对本脚本 ../../）：
  卡片背景素材.png        -> assets/background.png（模切透明边距填黑压平，画布 908x1732）
  free-pic/女仆咪-免费.png -> assets/subject.png（真透明通道，连通域去杂点后放到共享画布）
                            assets/lineart.png（从主体边缘阈值提取，深线白底）
                            assets/text.png    （全透明占位；文字烤在背景层里）
输出调试图：tools/alpha_debug.png、tools/preview.png
"""
from pathlib import Path
from collections import deque
from PIL import Image, ImageFilter
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
REPO = ROOT.parent
BG_SRC = REPO / "卡片背景素材.png"
SUBJ_SRC = REPO / "free-pic" / "女仆咪-免费.png"
ASSETS = ROOT / "assets"
TOOLS = ROOT / "tools"

SUBJECT_TARGET_W = 700          # 主体在画布上的宽
SUBJECT_CENTER = (454, 880)     # 主体中心（画布坐标）

# ---------- 背景：模切贴纸卡，透明刀版边距填黑压平 ----------
bg = Image.open(BG_SRC).convert("RGBA")
W, H = bg.size
arr = np.array(bg)
alpha = arr[:, :, 3]
print(f"背景 {W}x{H} 透明像素占比 {float((alpha < 10).mean()):.1%}")
Image.fromarray(alpha).save(TOOLS / "alpha_debug.png")

flat = Image.new("RGBA", (W, H), (0, 0, 0, 255))
Image.alpha_composite(flat, bg).convert("RGB").save(ASSETS / "background.png")

# ---------- 主体：连通域标记去杂点 ----------
subj = Image.open(SUBJ_SRC).convert("RGBA")
s = np.array(subj)
sa = s[:, :, 3]
mask = sa > 40
ys, xs = np.nonzero(mask)
print(f"主体 {subj.size}，候选像素 {mask.sum()}")

# 纯 BFS 全图连通域，保留面积达标的团（最大团的 0.3%，下限 2000px）
labels = np.zeros(mask.shape, np.int32)
sizes = {}
cur = 0
mh, mw = mask.shape
for y0, x0 in zip(ys, xs):
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

biggest = max(sizes.values())
keep_min = max(2000, int(biggest * 0.003))
keep_ids = {i for i, n in sizes.items() if n >= keep_min}
keep = np.isin(labels, list(keep_ids))
print(f"连通域 {len(sizes)} 个，最大 {biggest}px，保留 {len(keep_ids)} 个"
      f"（阈值 {keep_min}px），像素 {int(keep.sum()) / int(mask.sum()):.1%}")

sa2 = np.where(keep, sa, 0)
s[:, :, 3] = sa2
s[sa2 == 0, :3] = 0
subj_clean = Image.fromarray(s, "RGBA")

# ---------- 放到共享画布 ----------
scale = SUBJECT_TARGET_W / subj_clean.width
target_h = round(subj_clean.height * scale)
subj_placed = subj_clean.resize((SUBJECT_TARGET_W, target_h), Image.LANCZOS)
canvas_subj = Image.new("RGBA", (W, H), (0, 0, 0, 0))
px = SUBJECT_CENTER[0] - SUBJECT_TARGET_W // 2
py = SUBJECT_CENTER[1] - target_h // 2
canvas_subj.paste(subj_placed, (px, py))
canvas_subj.save(ASSETS / "subject.png")
print(f"主体放置：{SUBJECT_TARGET_W}x{target_h} @ ({px},{py})，画布 {W}x{H}")

# ---------- 线稿：同一来源做边缘阈值，深线白底，只在轮廓内 ----------
rgb_over_white = Image.alpha_composite(
    Image.new("RGBA", (W, H), (255, 255, 255, 255)), canvas_subj).convert("L")
g = np.asarray(rgb_over_white.filter(ImageFilter.GaussianBlur(1.2))).astype(np.float32)
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
line_img = np.full((H, W), 255, np.uint8)
line_img[line] = 0
Image.fromarray(line_img).convert("RGB").save(ASSETS / "lineart.png")
print(f"线稿覆盖主体区域 {line.sum() / max(inside.sum(), 1):.1%}（阈值 {thr:.3f}）")

# ---------- 文字层：全透明占位（文字烤在背景里） ----------
Image.new("RGBA", (W, H), (0, 0, 0, 0)).save(ASSETS / "text.png")

# ---------- 预览合成图供目检 ----------
prev = Image.alpha_composite(
    Image.new("RGBA", (W, H), (0, 0, 0, 255)),
    Image.open(ASSETS / "background.png").convert("RGBA"))
prev = Image.alpha_composite(prev, canvas_subj)
prev.convert("RGB").save(TOOLS / "preview.png")
prev.convert("RGB").resize((W // 2, H // 2), Image.LANCZOS).save(TOOLS / "preview_small.png")
print("完成：assets/ 五层 + tools/preview.png")
