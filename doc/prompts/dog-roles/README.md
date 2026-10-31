# 狗狗 16 角色专属 Prompt

- 角色专属 Prompt：本目录 `<role>.md`，共 16 个，App 默认按 `roleId` 使用。
- 兜底 Prompt：[`../pet-character-dog.md`](../pet-character-dog.md)，仅未知角色时使用。
- 生成器：`app/tools/build-dog-role-prompts.mjs`。**不要运行**，它会覆盖本目录手工微调的内容。

## App 接入

`app/tools/sync-generation-prompts.mjs` 会把 16 份文件生成到 `app/functions/lib/generation-prompts.json` 的 `dog.roles`，结构与猫一致：

- `cat.roles[roleId]` / `dog.roles[roleId]`：完整 Prompt
- 图1 = `image[0]` 用户宠物照片
- 图2 = `image[1]` 角色参考图

用户选择狗狗角色并进入生成流程后，`generationSnapshot()` 会自动绑定对应的 Prompt。

## 用法

只做预检，不调用收费 API：

```bash
node app/tools/test-generation.mjs --pet-type dog --role ghost
```

真实生图（收费）：

```bash
node app/tools/test-generation.mjs --pet-type dog --role ghost --live
```

`--prompt-file` 仍可临时覆盖 Prompt。

## 参考图

狗角色参考图在仓库根目录 `free-pic-dog/`，映射表是 `app/functions/lib/dog-role-references.js`，R2 键为：

```text
references/20261030-v2/dog/<role>.png
```

上传到 R2：

```bash
cd app
npm run references:check         # 预检 32 张图
npm run references:upload        # 本地 R2
npm run references:upload:remote # 线上 R2（需要先 wrangler login）
```

猫和狗会一起上传，共 32 张；两套图片内容互不复用。

注意：脚本固定写入 `peti-custom-images`（正式环境）。`preview-wrangler.toml` 用的是 `peti-avatar-preview-images`，预览环境需要单独上传。

## 内容审核

`zombie.md` 的服装描述已改成“传统服饰 / 红色圆顶帽子 / 黄色纸饰 / 红色纹样”，避免方舟文本审核拦截；参考图仍会带出原来的帽子和纸饰。

## 角色与露脚清单

以下清单为旧任务记录，部分数量与参考图及已修订的角色文件不一致。使用时以各角色文件为准。

| # | role | 名称 | 参考图 | 允许露出的脚爪 |
|---|---|---|---|---|
| 01 | `ghost` | 乖巧内向的小幽灵汪 | `小幽灵汪-免费.png` | 两只前爪 + 一只右后爪，共三只脚爪 |
| 02 | `zombie` | 活蹦乱跳的小僵尸汪 | `小僵尸汪-免费.png` | 两只前爪（手）+ 两只后脚（鞋内），共四只 |
| 03 | `chainsaw` | 恶魔大爆发的电锯汪 | `电锯汪-免费.png` | 两只前爪（握锯）+ 两只后脚，共四只 |
| 04 | `mummy` | 爱躲藏的木乃伊汪 | `木乃伊汪-免费.png` | 两只前爪（绷带包裹），共两只；后脚不露出 |
| 05 | `nurse` | 贴心依赖的小管家汪 | `小管家汪-免费.png` | 两只前爪（一手提灯、一手垂放）+ 两只后脚，共四只 |
| 06 | `vampire` | 个性魅力的吸血鬼汪 | `吸血鬼汪-免费.png` | 两只前爪（一手举杯、一手垂放）+ 两只后脚，共四只 |
| 07 | `franken` | 有自己想法的科学怪汪 | `科学怪汪-免费.png` | 两只前爪（一手举瓶、一手收在袖中）+ 两只后脚，共四只 |
| 08 | `pirate` | 行侠仗义的海盗汪 | `海盗汪-免费.png` | 画面总共只能出现 3 个白色脚掌：一只前爪握剑 + 两只后脚；另一条前臂末端是钩子，不算脚掌 |
| 09 | `clown` | 调皮捣蛋的小鬼汪 | `小鬼汪-免费.png` | 两只前爪，共两只；后脚和尾巴不露出 |
| 10 | `bride` | 月光新娘汪 | `月光新娘汪-免费.png` | 两只前爪（一只伸向蝴蝶、一只在胸前）+ 两只后脚，共四只 |
| 11 | `witch` | 神秘莫测的女巫汪 | `女巫汪-免费.png` | 两只前爪（一只握木头法杖、一只自然伸展）+ 两只后脚（悬空），共四只 |
| 12 | `pumpkin` | 圆滚滚的南瓜咕噜汪 | `南瓜汪-免费.png` | 两只前爪 + 一条尾巴，共两只脚爪；后脚不露出 |
| 13 | `werewolf` | 月圆变身的狼人汪 | `狼人汪-免费.png` | 两只前爪（毛绒袖口包裹），共两只；后脚和狗的生物耳朵不露出 |
| 14 | `bat` | 昼伏夜出的蝙蝠汪 | `蝙蝠汪-免费.png` | 两只前爪（胸前握拳）+ 两只后脚，共四只；两只翅膀是服装，不是手 |
| 15 | `gargoyle` | 不动如山的贪睡财神汪 | `财神汪-免费.png` | 两只前爪（一只垫在下巴下、一只搭在金元宝旁），共两只；后脚和尾巴不露出 |
| 16 | `pharaoh` | 傲娇的法老王汪 | `法老汪-免费.png` | 两只前爪 + 一条尾巴，共两只脚爪；后脚不露出 |
