# 猫咪分角色 Prompt

## 当前生效的文件

`combined/NN-role.txt` 是 App 实际使用的 16 份完整 Prompt，也是这一套 Prompt 的唯一源文件。

每份文件的结构：

```text
通用身份底稿（来自 shared-generic.md）
+
【角色专属要求】
+
NN-role.md 的角色段
```

修改角色 Prompt 时直接改 `combined/NN-role.txt`，然后运行同步脚本：

```bash
cd app
node tools/sync-generation-prompts.mjs
```

同步脚本会生成：

- `app/functions/lib/generation-prompts.json`：Prompt 调用仓库，`cat.roles[roleId]` 是完整 Prompt。
- `app/functions/lib/generation-prompts.js`：从 JSON 复制的 ESM 镜像，供 Wrangler 运行时导入。

`npm run dev` / `npm run deploy` 会通过 `predev` / `predeploy` 自动执行同步。

## 多图融合约定

Seedream 5.0 Flash 的多图融合请求使用 `image` 数组，数组顺序就是 Prompt 里的图号：

```json
{
  "model": "doubao-seedream-5-0-flash-260915",
  "prompt": "……图1……图2……",
  "image": ["data:image/jpeg;base64,<用户照片>", "data:image/png;base64,<角色参考图>"],
  "size": "2048x2048",
  "output_format": "png",
  "response_format": "b64_json",
  "watermark": false
}
```

- **图1 = `image[0]`**：用户宠物照片，唯一的宠物身份参考。
- **图2 = `image[1]`**：角色参考图，只提供服装、姿势、道具和材质。

因此 16 份 Prompt 统一使用「图1 / 图2」，不要再写「图一 / 图二」。`sync-generation-prompts.mjs` 会检查并拒绝旧写法。

## App 接入点

猫用户在选择角色后点「免费生成头像」时：

1. 前端把 `roleId` 提交到 `/api/free-orders`。
2. `generationSnapshot(result)` 从 `GENERATION_CONFIG.rolePrompts.cat[roleId]` 取出对应 Prompt。
3. Prompt、参考图 key、模型参数一起写入订单的 `result_json`，之后配置修改不会影响已下单的订单。
4. `buildImageRequest()` 按「图1 用户照片、图2 角色参考图」组装 `image` 数组，调用 Seedream 多图融合接口。

狗也使用同一套结构：`dog.roles[roleId]` 来自 `doc/prompts/dog-roles/<role>.md`，未知角色才回落到 `pet-character-dog.md`。

## 注意

`build.mjs` 是旧版构建脚本，仍会从 `shared.md` 和旧的 `NN-role.md` 重写 `combined/`。**不要运行它**，否则会覆盖当前生效的 Prompt。
