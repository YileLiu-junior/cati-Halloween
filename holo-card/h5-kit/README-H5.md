# 全息卡 H5 嵌入包（h5-kit）

女仆咪全息卡的「固定格式 + 可换角色」发行包。你在预览里调好的卡片格式已固化为默认值：
画面比例 **0.95** · 画面景深 **0.19** · 特效景深 **0.72** · 底纹景深 **+0.26**（背景向前）·
光泽 **100%** · 卡面质感 **银箔**。

## 目录

```
h5-kit/
  viewer/               纯静态查看器，可直接部署（共 9 个文件，约 3.4MB）
    index.html            页面骨架
    app.bundle.js         全部效果控制脚本（视差/镭射/翻面/质面，单文件已打包）
    style.css             样式
    card-config.json      卡片配置：文案 + 锁定数值 + 素材路径
    assets/
      subject.png         主体层（角色，真透明，景深 0.19）
      background.png      背景层（不透明，景深 +0.26）
      lineart.png         线稿层（驱动卡面内发光墨线，随主体）
      text.png            文字层占位（无视差；当前无独立文字）
      card.glb            卡片几何（复合模式：卡面/卡边/卡背/金边四个材质槽）
  tools/
    make_character.py     换角色工具
```

## 集成到 H5

viewer/ 是纯前端静态资源，不需要 node 服务、不需要 Blender。两种接法：

1. **整目录托管（推荐）**：把 `viewer/` 拷进你的静态目录，例如
   `app/public/holo-card/`，页面里 `<a href="/holo-card/">` 或
   `<iframe src="/holo-card/" style="width:100%;height:100%;border:0"></iframe>`。
2. **多角色并存**：每个角色一份目录（见下），路径各不相同即可，如
   `/holo/女仆咪/`、`/holo/僵尸咪/`。

注意：必须走 http(s) 访问（Express/static 任意静态服务器都行），
不能 `file://` 双击打开 —— fetch 加载配置和贴图会跨域失败。
唯一的要求是 `.json/.png/.glb` 能被正常返回（Express static 默认即可）。

## 换角色

```bash
cd h5-kit
python tools/make_character.py --src ../../free-pic/僵尸咪-免费.png \
    --name 僵尸咪 --subtitle 万圣夜行 · 喵灵
```

- 只重写 `subject.png` + `lineart.png` + config 文案，**背景/几何/锁定数值不动，无需 Blender**。
- 完成后刷新页面即见新角色；卡背首字自动取 `--name` 的第一个字。
- 角色图要求：**带透明通道的 RGBA PNG**，站姿完整、无背景；工具会自动做连通域
  去杂点、等比缩放到锁定宽度（800px）并居中到锁定位置 (454, 880)。
- 想微调某角色的位置/大小：`--cx/--cy/--width`（只影响该次生成）。

换完想回滚：重新跑一次原角色，或从 `../assets/` 拷回原 subject/lineart。

## 锁定数值（在 viewer/card-config.json 的 parameters/appearance）

| 字段 | 值 | 含义 |
|---|---|---|
| subjectScale | 0.95 | 画面比例（主体层缩放） |
| subjectDepth | 0.19 | 画面景深（主体视差强度） |
| effectsDepth | 0.72 | 特效景深（当前无特效层，备用） |
| backgroundDepth | 0.26 | 底纹景深（**正值 = 背景向前，与主体同向**） |
| foil | 1.0 | 光泽/镭射强度（100%） |
| appearance.finish | "silver" | 卡面质感（pearl 珠光 / silver 银箔 / gold 烫金 / original 原画） |

想全局改格式：直接改 `card-config.json` 这几个字段，所有角色共用。
safeArea（1.12 / [-0.06, -0.085]）是安全区映射，勿与上面混淆，一般不动。

## 页面能力（面向最终用户）

拖拽倾斜（井深视差）、滚轮缩放、双击或按钮翻面（卡背自动显示收藏名/首字/编号）、
方向键微调、四种质面切换、五根调节滑杆（景深与构图）、下载 1400×1800 卡图、
390px 小屏自适应、`prefers-reduced-motion` 降级、WebGL 不可用时 CSS-3D 兜底。
调试钩子：`window.__holo`（`ready/uniforms/reset/flip/getState`）。
