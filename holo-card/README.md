# 女仆咪 · 全息展示卡

基于 ruic-card 插件管线，把两张已有素材组装成五层视差全息卡：可编辑 Blender 源文件 + Three.js 交互网页（拖拽倾斜、翻面、四种质面、三根景深滑杆、存图）。

> **要嵌进 H5 或换角色？直接用 [`h5-kit/`](h5-kit/README-H5.md)**——用户调好的卡片格式已固化
> （比例 0.95 / 画面景深 0.19 / 特效景深 0.72 / 底纹景深 +0.26 / 光泽 100% / 银箔），
> 含纯静态 viewer 包与一键换角色工具 `tools/make_character.py`（换图无需重跑 Blender）。

## 素材来源（分层方案）

| 层 | 来源 | 说明 |
|---|---|---|
| 背景 | `../卡片背景素材.png` | 模切贴纸卡，透明刀版边距填黑压平 |
| 主体 | `../free-pic/女仆咪-免费.png` | 原生透明通道直用，未抠图 |
| 线稿 | 从主体边缘阈值自动提取 | 轮廓精确对位，驱动卡面内发光墨线 |
| 文字 | 全透明占位 | "Happy Halloween" 烤在背景层，随背景轻微视差（贴纸感） |
| 特效 | 无 | 省略 |

画面构图以 `../card-free.png` 为成品参照（主体居中偏上，南瓜/骷髅贴纸与文字完整露出）。

## 重新生成

```bash
# 1. 切层（画布尺寸/主体位置在 tools/prepare_layers.py 顶部常量）
python tools/prepare_layers.py
# 2. 全管线：校验 -> Blender 建场景 -> 渲染 -> GLB 导出 -> 装配网页（Blender 已装在 tools/）
python "<插件目录>/skills/ruic-card/scripts/run_pipeline.py" --project .
# 3. 起预览服务
cd web && node server.mjs    # http://127.0.0.1:4173
```

## 验收状态

- Blender 渲染成品：`renders/hero.png`
- 端到端浏览器验收：`node tools/verify_local.mjs . --out tools/verify-report`
  当前 **31/33 通过**（桌面 25/27 + 移动 6/6），2 个 FAIL 已用探针证伪为测量假象：
  - 「光泽/镭射帧不变」：Δ0.2 增量在这张深色卡上低于 1/255 量化阈值；`tools/probe_foil2.mjs` 证明 0.3→1.0/0.0 画布像素均变化。
  - 「四质面帧不变」：软件渲染一帧 2-5 秒，验收截图 450ms 后抓到旧帧；`tools/probe_finish.mjs` 同步渲染下四帧全部不同，且"原画"帧哈希与 foil=0 完全一致（交叉印证）。

### 本机环境坑（Windows 无头浏览器）

- 官方 `verify_web.mjs`（`--enable-unsafe-swiftshader --disable-gpu`，1440×1000）在累计约 16 次
  截图回读后 GPU 进程楔死，两次确定性复现于镭射滑杆步 → 用本地副本 `tools/verify_local.mjs`
  （追加 `--use-angle=swiftshader`、窗口降到 1024×700）可完整跑完。
- 硬件 GL（`--use-angle=d3d11`）在此机无头模式下会挂死渲染进程（连 `Runtime.evaluate` 都不返回），不可用。
- 常驻 node 服务必须把 stdout 重定向到文件，否则管道写满后整个服务静默阻塞。

## 文件地图

- `card-config.json` — 卡片元数据与层深度参数
- `assets/` — 五层素材（subject/background/lineart/text + `card.glb` 模型）
- `card.blend` — 可编辑 Blender 源（视差组「视差效果」/镭射箔/金边节点图）
- `web/` — 交互网页（`web/server.mjs` 起服务；`window.__holo` 为调试钩子）
- `renders/hero.png` — Blender 渲染成品图
- `tools/` — 切层脚本、本地验收副本、证伪探针、验收报告与截图
