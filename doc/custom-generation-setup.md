# 定制盲盒流程与接入说明

更新：2026-10-29。用户先选择测评角色或其他角色，再上传照片、确认付款，核验到账后用火山方舟 Seedream 5.0 Flash 生图。

本文记录当前代码。`PRD-payment-generation.md` 仍保留原稿，本文不覆盖其余退款、审核、抠图和双导出需求。

## 当前流程

1. 在结果页点击「生成专属盲盒角色卡片」。
2. 选择测评结果角色，或左右滑动浏览 16 个角色并确认选择。占比来自题库模拟分布。
3. 选择照片并勾选用途说明。浏览器重编码为 JPEG，移除元信息，长边最多 1600px，文件最多 2MB。
4. 上传照片后点击「下一步：确认付款」。服务端重新核验角色、价格、照片、Prompt、参考图和支付配置。
5. 查看所选角色和付款金额。订单创建后角色与照片均固定。
6. 点击付款入口前往指定型号付款页，`remark` 参数预填支付标识，不再经过创作者主页或型号选择页。
7. 爱发电向本站 Webhook 发送到账通知，服务端用创作者凭证再次查单。用户回到 PETI 后，自动恢复弹框并查询订单。
8. 核对交易成功、商品方案、型号、数量 1、实付金额和订单留言。自动确认失败时，保留折叠的手填平台订单号入口。
9. 核验通过后，自动将宠物照片（图1）、该角色参考图（图2）和 Prompt 发给火山方舟 Seedream 5.0 Flash。
10. 先将原图私有保存到 `jobs/<orderId>/source.png`，再调用同一模型的图层拆分接口提取角色，按图层位置合成 2048×2048 透明 PNG。
11. 检查每个前景图层及最终图片同时具有全透明像素和非透明主体。检查通过才标记完成，供用户查看和下载。重新打开结果页可查询原订单。

用户于 2026-10-29 更新定价：原价 6 元，活动期间三折实付 1.8 元；北京时间 `2026-10-31T18:00:00+08:00`（UTC `2026-10-31T10:00:00Z`）恢复 6 元。后端金额为 180 / 600 分。爱发电商品折扣结束时间也必须同步配置；本站不能通过链接参数修改平台售价。过期旧报价停止自动认单，跨期已付订单转人工核对，不引导补付。

指定商品 `plan_id=2315e4b0d2e911f186f652540025c377`，指定型号 `sku_id=231df344d2e911f1b46452540025c377`，数量 1。完整原始付款链接在 `app/wrangler.toml`。2026-10-29 已在访客页面验证：该链接直达型号 1、实付 1.80 元；`remark` 可预填留言；未登录者仍需验证手机号或邮箱。没有提交真实付款。

**浏览器回跳仍未验证。** 本版在同一标签页前往爱发电，保留待付测评标记；手动返回 PETI 时自动恢复并查单。Webhook 只能确认到账，不能控制爱发电页面导航。未发现官方支付成功 `redirect_url` 或 `return_url` 支持，因此代码没有拼接这些未经支持的参数。可在爱发电商品自动回复中配置 PETI 返回链接，但需先有正式 H5 地址，此方式仍需用户点击。真正的自动回跳须另行确认平台支持并用真单验证。

## 配置位置

| 内容 | 文件 | 字段 |
|---|---|---|
| 固定 Prompt | `doc/prompts/pet-character.md`；运行时在 `app/functions/lib/generation-config.js` | 用户原文完整保存，接口测试逐字核对两处内容 |
| 唯一角色映射 | `app/functions/lib/role-references.js` | `roleId → free-pic/文件名`，服务端、上传脚本与素材准备脚本共用 |
| 角色参考图 key | `app/functions/lib/generation-config.js` | 根据唯一映射生成 `references/<roleId>.png`，仅在服务端从私有 R2 读取 |
| 模型与输出 | 同上 | `model`、`size: "2048x2048"`、`outputFormat: "png"`、`watermark: false` |
| 火山方舟 Key | `app/.dev.vars.example` | `ARK_API_KEY=""` |
| 爱发电创作者凭证 | 同上 | `AFDIAN_USER_ID`、`AFDIAN_API_TOKEN` |
| 指定商品、型号、支付链接 | `app/wrangler.toml` 的 `[vars]` | 已填 `AFDIAN_PLAN_ID`、`AFDIAN_SKU_ID`、`AFDIAN_PAY_URL`；不属于密钥 |

16 张参考图来源均为 `free-pic/`。`node tools/upload-references.mjs` 根据唯一映射同步到本地 R2，追加 `--remote` 同步远程桶。上传前会核验全部源图存在、PNG 格式、不超过 10MB，并检查其与角色选择页面的预览图逐字节一致；追加 `--check` 只做预检。真实密钥只放本地 `app/.dev.vars` 或 Cloudflare 服务端 Secrets，不能放 `public/`。`.dev.vars` 已被 Git 忽略。

如旧 `.dev.vars` 中还有 `AFDIAN_PLAN_ID`、`AFDIAN_SKU_ID` 或 `AFDIAN_PAY_URL` 空值，请移除这几行，避免覆盖 `wrangler.toml` 中已填的公开商品配置。

Prompt 可使用 `{petType}`、`{roleId}`、`{petName}` 三个占位符。宠物信息来自服务端测评结果，角色由用户选择并经服务端验证后写入订单。浏览器不能传 Prompt、模型、参考图 key 或收费金额。

当前请求固定为 `POST https://ark.cn-beijing.volces.com/api/v3/images/generations`，使用服务端 `Authorization: Bearer <ARK_API_KEY>`。模型为 `doubao-seedream-5-0-flash-260915`（Seedream 5.0 Flash）。两次请求均设置 `output_format: "png"`、`response_format: "b64_json"`、`stream: false`、`watermark: false`。

| 阶段 | 图片输入 | 尺寸 | 其他参数 | 产出 |
|---|---|---|---|---|
| 角色生成 | `image: [宠物照片 data URI, 所选角色参考图 data URI]`，严格图1、图2顺序 | `2048x2048` | 用户完整 Prompt | 一张 PNG 原图，私有留档 |
| 抠图 | `image: 原图 data URI`，只传一张图 | `2K`（图层拆分只接受档位） | `layer_decomposition: true`，要求完整角色及配饰同属一个前景 | 底图与透明前景图层 |

**透明背景限制：** 官方 `background: "transparent"` 只接受一张带 alpha 的输入图，双图请求和 JPEG 输入不能使用该模式。因此两次请求均不传该参数。第二次请求使用图层拆分返回的透明前景，舍弃 `z_index=0` 的背景，再按 `bounding_box.absolute` 缩放并合成前景；多个前景按 `z_index` 叠放。最终输出保持第一阶段的 2048×2048 画布与构图。

抠图是额外一次模型调用，可能增加时延和费用。图层拆分还可能产出多个图层，实际成本以方舟账单为准。像素检查只确认真实透明通道及非空主体，不能自动证明耳朵、透明配饰或半透明边缘完全保留；猫、狗及复杂配饰仍需真图验收。

未填写 Prompt、Key，或所选角色未登记参考图、参考图不在 R2 中时，创建收费订单返回 `SERVICE_NOT_CONFIGURED`，付款前即拦截。不依赖浏览器的“已付款”字段。爱发电二次查单核验成功才将订单改为 `unlocked`，生图入口只接受该状态或明确可重试的首次生图失败。

## 本地准备

在 `app/` 中运行：

```powershell
Copy-Item .dev.vars.example .dev.vars
npx wrangler d1 migrations apply peti-custom-orders --local
node tools/upload-references.mjs
npm run dev
```

`.dev.vars` 中的值可以继续留空。此时可测试上传，点击生成入口会提示暂不收款。

接口测试使用 Node.js 22.16 或更新版本的内置 SQLite，不需要安装测试数据库：

```powershell
npm run test:api
npm run test:worker
npm test
```

接口测试模拟付款和火山方舟响应，覆盖双图顺序、所选角色、两阶段调用、透明像素、图层坐标、并发与失败处理。`test:worker` 在本地 Cloudflare Workers 运行环境验证 2048 方形透明 PNG 的解码、合成与导出。浏览器测试包含真实本地照片上传，付款与生图完整流程使用测试替身。

## 线上配置

1. 创建 D1 数据库，将真实 ID 填入 `app/wrangler.toml`，再应用数据库迁移。D1 用唯一约束和条件更新保护付款认领与生成次数，不能改回 KV 的先查后写。
2. 创建 R2 私有桶并绑定 `PETI_IMAGES`。关闭公开访问，不设置公开图片域名。
3. 配置 R2 生命周期：`photos/` 和 `jobs/` 前缀分别在创建 7 天后删除；`references/` 不设该删除规则。接口同时按 `expiresAt` 拒读到期图片。
4. 在 `app/` 运行 `node tools/upload-references.mjs --check`，再运行 `node tools/upload-references.mjs --remote`。16 张图的源文件映射见 `functions/lib/role-references.js`；上传到 `references/<roleId>.png`，设置 `Content-Type: image/png`。
5. Prompt 和角色映射已填写。更换 `free-pic/` 素材后先运行 `python tools/prepare_holo_roles.py` 更新预览，再重新同步 R2；不要单独修改某一处映射。
6. 设置火山方舟（ARK_API_KEY）与爱发电 Secrets，并替换原有 KV namespace 占位 ID。
7. 在爱发电设置该型号原价 6 元、三折 1.8 元，并确认折扣在北京时间 2026-10-31 18:00 结束。后台若不支持定时结束，需届时手动取消折扣。
8. 在爱发电开发者后台将 Webhook 通知 URL 配置为 `https://你的正式H5域名/api/afdian/webhook`。通知接口还会二次查单；不能用伪造通知解锁。限流或查单故障时不确认成功，仍保留手工核对入口。
9. 应用新增迁移 `0002_order_sku.sql`，让每单记录创建时的型号。迁移前的旧订单型号为空时不能自动认领，需人工处理；不猜测或覆盖旧订单型号。
10. 用真实订单验证「预填留言完整保留 → 通知 → 二次查单 → 返回 PETI → 自动生图 → 下载」后再开放收费。密钥、线上 Webhook、生命周期和真实订单均未在本轮配置或验证。

云端数据库与图片桶均未创建，本轮只应用了本地数据库迁移。

## 接口

POST 的凭证放请求体 `token`；GET 的凭证放 `X-PT-Token`。响应及私有图片均为 `no-store`。

| 方法与路径 | 输入 | 输出或作用 |
|---|---|---|
| `GET /api/config` | 无 | 服务器时间、截止点、金额、配置是否已填写 |
| `POST /api/photos` | multipart：`testId`、`token`、`consent=true`、`photo` | `photoId`、`expiresAt` |
| `GET /api/photos/:photoId` | 凭证头 | 私有照片 |
| `POST /api/checkout` | `testId`、`token`、`photoId`、`roleId` | `payId`、`roleId`、`amountFen`、`payUrl`、状态 |
| `GET /api/checkout?testId=...` | 凭证头 | 原订单或 `null` |
| `GET /api/checkout/:payId` | 凭证头 | 原订单状态 |
| `POST /api/checkout/:payId/confirm` | `token`、`platformOrderNo` | 查单核验后的订单状态 |
| `POST /api/afdian/webhook` | 爱发电订单通知 JSON | 凭创作者 API 二次查单，幂等解锁；成功回复 `{ec:200,em:""}` |
| `POST /api/jobs` | `token`、`payId` | 同步生成；`jobId` 与 `payId` 一致 |
| `GET /api/jobs/:jobId` | 凭证头 | 状态与私有图片路径 |
| `GET /api/jobs/:jobId/image` | 凭证头 | 本版新生成的透明 PNG；兼容历史图片格式 |

每份测评最多一笔订单，每个平台订单号只能认领一次。确认付款全站最多每 15 秒查一次平台，频控存 D1。上传频控沿用实例内存近似，每 IP / 凭证每分钟最多 3 张。

## 本版边界

- 生成通过 Pages Functions 同步请求执行，生图与抠图各 180 秒超时；浏览器等待 390 秒，400 秒仍未完成的任务在查询时转为待核对。页面提示保持打开；未接队列，不承诺关闭页面后继续生成。新增 PNG 解码与合成会消耗 Worker CPU，上线前需确认套餐资源足够。
- 网络中断、返回内容不明或图片保存不明，标记 `uncertain`。此状态禁止再次调用，保留订单供核对。长时间停留在生成中的任务在查询时转为 `uncertain`。
- 第一阶段明确的 429 / 5xx 失败允许用户重试一次；每单最多领取两轮生成权。正常一轮包含生图与图层拆分各一次调用。第二阶段失败或无法确认真实透明像素时转为 `CUTOUT_UNCERTAIN`，保留私有原图，禁止整单重跑。成功后不能再生成。
- 支付前不做阿里云图片审核。本版只核验文件；Seedream 的生成处理发生在付款后。抠图已接入；独立审核、退款申请和双导出仍未实现。
- 订单与原照片和所选角色绑定。创建订单后更换照片或角色、跨期低价付款、照片到期后的已付订单需人工处理。
- 原订单状态从当前浏览器的结果凭证恢复。清除浏览器数据或换设备后的人工找回入口未实现。
- 成品是经过 PNG 解码、图层合成与透明像素核验的 2048×2048 PNG；页面显示 AI 生成说明。已关闭方舟角标水印（`watermark: false`），未额外合成品牌水印、角色卡文字或导出标识。实际宠物相似度与抠图边缘质量未经过真实方舟调用验收。

## 官方接口依据

- [用户指定的火山方舟图片生成 API 入口](https://ark.volcengine.com/region:cn-beijing/docs/image-generation-api)
- [火山方舟图片生成 API 公共文档](https://docs.volcengine.com/docs/ark/image-generation-api?lang=zh)（2026-10-29 核对了双图输入、输出格式、透明模式限制与图层拆分字段）
- [Seedream 4.0/5.0 模型说明](https://docs.volcengine.com/docs/ark/seedream-4-0-5-0?lang=zh)
- [火山方舟模型价格](https://www.volcengine.com/docs/ark/model-pricing)
- [爱发电开发者 API](https://guide.afdian.com/creator/developer)
