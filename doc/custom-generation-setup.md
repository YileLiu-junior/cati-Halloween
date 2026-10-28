# 定制盲盒流程与接入说明

更新：2026-10-28。对应本轮用户要求：先上传照片，再付款，再用 OpenAI Image 2 生图。

本文记录当前代码。`PRD-payment-generation.md` 仍保留原稿，本文不覆盖其余退款、审核、抠图和双导出需求。

## 当前流程

1. 在结果页点击「定制我家毛孩子」。
2. 在弹框中选择照片，并勾选用途说明。
3. 点击上传。浏览器重编码为 JPEG，移除元信息，长边最多 1600px，文件最多 2MB。
4. 上传成功后显示「2元生成定制盲盒」。
5. 点击按钮创建订单。服务端重新核验价格、照片、Prompt、参考图和支付配置。
6. 复制支付标识，前往爱发电付款，将标识完整填写在订单留言。
7. 回到弹框，填写爱发电订单号，点击「我已付款，核对订单」。
8. 服务端用创作者凭证查单，核对交易成功、商品方案、实付金额和订单留言。
9. 核验通过后，自动将宠物照片、参考图和 Prompt 发给 OpenAI。
10. 在弹框中查看并保存 PNG。重新打开结果页可查询原订单。

报价沿用既有活动规则：北京时间 2026-10-31 00:00 前为 200 分，之后为 590 分。按钮金额读取服务端，不能由前端改价。过期旧报价停止自动认单，已付款的跨期订单转人工核对，不引导补付。

爱发电付款使用外部页面。本版不依赖回跳或 Webhook，也不会把点击「我已付款」当成付款凭证。订单留言必须与支付标识一致，不依赖未验证的 `custom_order_id` 透传参数。

## 留空的位置

| 内容 | 文件 | 字段 |
|---|---|---|
| 固定 Prompt | `app/functions/lib/generation-config.js` | `prompt: ""` |
| 参考图 | 同上 | `referenceImageKeys: []`，仅填写私有 R2 的 `references/` 对象 key |
| OpenAI Key | `app/.dev.vars.example` | `OPENAI_API_KEY=""` |
| 爱发电创作者信息、方案与支付链接 | 同上 | `AFDIAN_USER_ID`、`AFDIAN_API_TOKEN`、`AFDIAN_PLAN_ID`、`AFDIAN_PAY_URL` |

这些内容未从已有素材目录自动导入。真实密钥只放本地 `app/.dev.vars` 或 Cloudflare 服务端 Secrets，不能放 `public/`。`.dev.vars` 已被 Git 忽略。

Prompt 可使用 `{petType}`、`{roleId}`、`{petName}` 三个占位符。值来自创建订单时保存的服务端测评结果。浏览器不能传 Prompt、模型、参考图 key 或收费金额。

当前请求固定为 `POST https://api.openai.com/v1/images/edits`，模型 `gpt-image-2`，单张 PNG，1024×1024。`image[]` 第一张是宠物照片，之后按配置顺序附上参考图。未填写 Prompt、参考图或 Key 时，创建收费订单返回 `SERVICE_NOT_CONFIGURED`。

## 本地准备

在 `app/` 中运行：

```powershell
Copy-Item .dev.vars.example .dev.vars
npx wrangler d1 migrations apply peti-custom-orders --local
npm run dev
```

`.dev.vars` 中的值可以继续留空。此时可测试上传，点击生成入口会提示暂不收款。

接口测试使用 Node.js 22.16 或更新版本的内置 SQLite，不需要安装测试数据库：

```powershell
npm run test:api
npm test
```

接口测试模拟付款和 OpenAI 响应。浏览器测试包含真实本地照片上传，付款与生图完整流程使用测试替身。

## 线上配置

1. 创建 D1 数据库，将真实 ID 填入 `app/wrangler.toml`，再应用数据库迁移。D1 用唯一约束和条件更新保护付款认领与生成次数，不能改回 KV 的先查后写。
2. 创建 R2 私有桶并绑定 `PETI_IMAGES`。关闭公开访问，不设置公开图片域名。
3. 配置 R2 生命周期：`photos/` 和 `jobs/` 前缀分别在创建 7 天后删除；`references/` 不设该删除规则。接口同时按 `expiresAt` 拒读到期图片。
4. 上传参考图到 `references/`，设置正确的 `Content-Type`，每张不超过 10MB，最多 15 张。
5. 填写服务端 Prompt 和参考图 key。
6. 设置 OpenAI 与爱发电 Secrets，并替换原有 KV namespace 占位 ID。
7. 核实爱发电方案实际金额与服务端报价一致。到价格切换点同步调整平台方案。支付链接只允许 `https://afdian.com` 或 `https://afdian.net`。
8. 用真实订单验证「留言完整保留 → 查单 → 图片生成 → 下载」后再开放收费。密钥、生命周期和真实订单均未在本轮配置或验证。

云端数据库与图片桶均未创建，本轮只应用了本地数据库迁移。

## 接口

POST 的凭证放请求体 `token`；GET 的凭证放 `X-PT-Token`。响应及私有图片均为 `no-store`。

| 方法与路径 | 输入 | 输出或作用 |
|---|---|---|
| `GET /api/config` | 无 | 服务器时间、截止点、金额、配置是否已填写 |
| `POST /api/photos` | multipart：`testId`、`token`、`consent=true`、`photo` | `photoId`、`expiresAt` |
| `GET /api/photos/:photoId` | 凭证头 | 私有照片 |
| `POST /api/checkout` | `testId`、`token`、`photoId` | `payId`、`amountFen`、`payUrl`、状态 |
| `GET /api/checkout?testId=...` | 凭证头 | 原订单或 `null` |
| `GET /api/checkout/:payId` | 凭证头 | 原订单状态 |
| `POST /api/checkout/:payId/confirm` | `token`、`platformOrderNo` | 查单核验后的订单状态 |
| `POST /api/jobs` | `token`、`payId` | 同步生成；`jobId` 与 `payId` 一致 |
| `GET /api/jobs/:jobId` | 凭证头 | 状态与私有图片路径 |
| `GET /api/jobs/:jobId/image` | 凭证头 | PNG 图片 |

每份测评最多一笔订单，每个平台订单号只能认领一次。确认付款全站最多每 15 秒查一次平台，频控存 D1。上传频控沿用实例内存近似，每 IP / 凭证每分钟最多 3 张。

## 本版边界

- 生成通过 Pages Functions 同步请求执行，180 秒超时。页面提示保持打开；未接队列，不承诺关闭页面后继续生成。
- 网络中断、返回内容不明或图片保存不明，标记 `uncertain`。此状态禁止再次调用，保留订单供核对。长时间停留在生成中的任务在查询时转为 `uncertain`。
- 明确的 429 / 5xx 失败允许用户重试一次。每单最多两次调用；成功后不能再生成。
- 支付前不做阿里云图片审核。本版只核验文件；OpenAI 的生成处理发生在付款后。独立审核、退款申请、抠图和双导出仍未实现。
- 订单与原照片绑定。创建订单后更换照片、跨期低价付款、照片到期后的已付订单需人工处理。
- 原订单状态从当前浏览器的结果凭证恢复。清除浏览器数据或换设备后的人工找回入口未实现。
- 当前 PNG 为模型输出，页面显示 AI 生成说明；未额外合成品牌水印、角色卡文字或导出标识。

## 官方接口依据

- [OpenAI Image 2 模型](https://developers.openai.com/api/docs/models/gpt-image-2)
- [OpenAI 图片编辑接口](https://developers.openai.com/api/reference/resources/images/methods/edit)
- [爱发电开发者 API](https://guide.afdian.com/creator/developer)
