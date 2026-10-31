# 变更台账：限时免费 1000 份 + 五选项中庸答案

- 日期：2026-10-31
- 状态：**本地完成，未部署、未做真实生图验收**
- 影响范围：测题库、计分、定制头像前端、免费生图后端、配置开关、测试与文档
- 上一版基线：提交 `aef51da`（单角色单 Prompt，白底出图，无抠图）
- 对应锚点：`PROJECT-STATUS.md` §20

## 1. 本轮目标

1. 作者自费提供 1000 份免费生图，先把体验和口碑做起来；不再走爱发电付款与退款。
2. 生图后询问满意度；满意再问 1 / 2 / 6 元付费意愿，作为后续定价参考。
3. 爱发电链接只保留为「打赏作者」入口。
4. 测评题干压到 25 字内，每题补一个「四个选项都不像我家的宠物」时的中庸选项。

## 2. 已确认的产品决策

| 项 | 决策 |
|---|---|
| 角标位置 | 定制弹窗标题行右侧、关闭按钮左侧 |
| 全球额度 | 1000 份，硬上限 |
| 每浏览器额度 | 2 次；清空浏览器数据会被重置，属于已接受的软限制 |
| 失败处理 | 生成失败/超时退回额度；同一 attempt 只退一次 |
| 不满意分支 | 有额度时引导换照片或换角色再生成一次；无额度只给建议 |
| 付费意愿 | 1 / 2 / 6 元三档，等权展示，三档下提供「跳过」 |
| 打赏 | 沿用现有 `AFDIAN_PAY_URL` 商品页，不加 `remark` / `custom_order_id` |
| 旧付费代码 | 保留但休眠，不删除；前端不再展示付款/退款入口 |
| 题库缩短范围 | 只改题干，选项文案保持原样 |
| 中庸选项 | 每题 1 个，`axis:null, delta:0, points:{}` |

## 3. 当前免费生图流程

```
结果页「定制宠物万圣节装扮头像」
  → 选择角色
  → 上传照片（浏览器压缩 JPEG，服务端复验）
  → POST /api/free-orders
       ├─ 校验 token / testId / photoId 归属 / roleId / 服务配置 / 心跳
       ├─ 原子占用：全局额度 + 浏览器额度
       ├─ 写 orders（status='unlocked', amount_fen=0, plan_id='free'）
       └─ 写 delivery_jobs 并入队
  → delivery worker 调一次 Seedream 5.0 Flash
  → 成品写 R2 jobs/<orderId>/<attemptId>.png
  → orders.status='ready'
  → 前端轮询 GET /api/free-orders 显示图片 + 保存
  → 满意度问卷 POST /api/feedback
  → 打赏作者（外链）
```

订单状态沿用：`unpaid → unlocked → queued → generating → ready / failed / uncertain`。免费单不经过 `unpaid`。`jobId === payId === orderId`。

## 4. 数据库：迁移 `0005_free_generation.sql`

新增表：

- `free_quota`：单行，`total=1000`、`per_browser=2`、`used`、`last_request_id`。**改额度直接改这张表**，不需要改代码。
- `free_usage`：按 `browser_key = sha256("peti-free:" + browserId)` 计次。
- `free_requests`：每个占用请求的标记，用于 D1 条件更新后的同批补偿。
- `free_quota_refunds`：按 `attempt_id` 的退回台账，保证同一 attempt 只退一次。
- `free_feedback`：每个 ready attempt 一行；`satisfied`、`price_fen`（100/200/600/NULL）、`price_answered`、`skipped`。

`orders` 新增列：`free_browser_key`、`free_request_id`、`free_sequence`、`free_quota_charged`、`free_quota_refunded`、`free_refund_attempt_id`。

**重要**：D1 `batch()` 是事务，但条件 UPDATE 命中 0 行不会报错、不会回滚整批。额度占用必须保持「请求标记 + 条件 UPDATE + 同批补偿」的写法，不要改成先读后写。对应实现见 `app/functions/lib/free-quota.js`。

## 5. 接口契约

| 接口 | 说明 |
|---|---|
| `POST /api/free-orders` | `{token,testId,photoId,roleId,browserId,regenerate}`；首次 202，已有结论 200；`regenerate=true` 才复用订单行并重新占额度 |
| `GET /api/free-orders?testId=&browserId=` | 返回 `{order|null, feedback, free}`；**不检查服务可用性**，维护/耗尽时仍能看图和保存 |
| `POST /api/feedback` | `{token,testId,orderId,attemptId,satisfied,priceFen,skipped}`；按 attempt UPSERT |
| `GET /api/config?browserId=` | 新增 `free`、`tipUrl`、`paymentAvailable`；`available` 不再依赖爱发电 |

主要错误码：`FREE_QUOTA_EXHAUSTED`(409)、`FREE_BROWSER_LIMIT`(429)、`FREE_REQUEST_CONFLICT`(409)、`LEGACY_ORDER_EXISTS` / `LEGACY_ORDER_PENDING`(409)、`SERVICE_NOT_CONFIGURED` / `DELIVERY_UNAVAILABLE`(503)、`FEEDBACK_STALE`(409)、`NOT_FREE_ORDER`(409)。

`free` 快照字段：`enabled,total,used,remaining,perBrowser,browserUsed,browserRemaining,exhausted,browserExhausted,reason`。`reason` 取 `SERVICE_NOT_CONFIGURED | DELIVERY_UNAVAILABLE | QUOTA_EXHAUSTED | BROWSER_LIMIT | null`。

## 6. 配置开关

| 变量 | 当前值 | 作用 |
|---|---|---|
| `FREE_GENERATION_ENABLED` | `true` | 免费生图总开关，`"false"` 才关闭 |
| `PAYMENT_ENABLED` | `false` | 必须显式 `"true"` 才开放付款；默认休眠 |
| `CUSTOM_GENERATION_ENABLED` | `true` | 沿用，生图总开关 |
| `DELIVERY_ENABLED` | 生产 `true` / preview `false` | delivery worker 心跳；为 false 时 `/api/config` 不可用 |
| `AFDIAN_SUPPORT_URL` | 未配置 | 打赏链接覆盖；缺省回退 `AFDIAN_PAY_URL` |

已加在 `wrangler.toml`、`delivery-wrangler.toml`、`preview-wrangler.toml`、`preview-delivery-wrangler.toml`。

## 7. 前端结构与状态机

文件：`public/result.html`、`public/js/custom.js`、`public/css/style.css`。

- 步骤条：`#stepRole / #stepPhoto / #stepGenerate`，共 3 步。
- 角标：`#freeQuotaBadge` + `#freeQuotaHelp`；`data-state="open|closed"`；关闭态停扫光。
- 生成按钮：`#startFreeBtn`（原 `#generatePaidBtn` 已删除）。
- 问卷：`#surveyStep`、`#satisfiedYes/No`、`#priceQuestion`、`.price-option[data-price-fen]`、`#skipPriceBtn`、`#unsatisfiedGuide`、`#regeneratePhotoBtn`、`#regenerateRoleBtn`。
- 打赏：`#tipAuthorLink`，只在 `status='ready'` 时显示。
- 已彻底移除：`#paymentStep`、`#refundSection`、`#payLink`、`#checkPaymentBtn`、`#confirmPaymentBtn`、`#platformOrderNo`。测试会断言这些 id 不存在。
- `browserId` 取 `localStorage peti:v1` 的 `anonId`，缺失时生成 UUID 并写回。
- 「换角色再试」保留已上传照片；「换照片再试」清空照片、预览与同意勾选。真正扣第 2 次额度发生在再次点击 `#startFreeBtn` 时。

## 8. 题库与计分

- 每题 5 个选项。多数题的 `qNn` 仍是 `axis:null, delta:0, points:{}` 的中庸项；例外：q4n 为 `B+3 / pirate2+werewolf1`，q7n 为 `A+3 / nurse2+bride1`，q5c 改为 `A+3 / nurse1+bride2`（两版同一句“天使”文案，替代原 D 轴“神秘消失”项）。
- 中庸选项猫狗同 id、同分值，文案可不同。
- 题干全部 ≤25 可见字符。本轮只改了猫版 q1（28 → 17 字）。
- 版本：`cat-2026v3` / `dog-2026v3`；`public/js/config.js` 同步。
- `scoring.js` 对 `axis:null` 跳过累加；`validate_quiz.py` 强制「恰好 1 个中庸选项」并检查题干长度。
- 旧会话只有 4 个 optionId 时，`store.js#completeOptionOrder` 会把缺失项追加到末尾并持久化。
- `sessions.js` 过渡期同时接受 v2 / v3，避免旧 `config.js` 缓存导致新会话被拒。
- 为让全量回归不互相打满限流，`sessions` 的内存限流从 30 次/分提高到 120 次/分。

## 9. 改动文件清单

新增：

- `app/migrations/0005_free_generation.sql`
- `app/functions/lib/free-quota.js`
- `app/functions/api/free-orders.js`
- `app/functions/api/feedback.js`
- `app/tools/free-orders.test.mjs`
- `app/shots/free-quota-role-390.png`、`free-quota-help-390.png`、`free-quota-survey-390.png`、`free-quota-closed-320.png`

修改：

- 后端：`functions/api/{config,checkout,jobs,refund-requests,sessions}.js`、`functions/lib/{custom,generation-jobs,scoring}.js`、`tools/delivery-fixture.mjs`
- 前端：`public/result.html`、`public/js/{custom,quiz,store,config}.js`、`public/css/style.css`、`public/_headers`
- 题库：`public/data/quiz-cat.json`、`quiz-dog.json`
- 测试/工具：`tests/{quiz,custom}.spec.js`、`tools/{validate_quiz.py,screenshot.mjs}`、`doc/balance-check.py`、`package.json`
- 配置：四份 wrangler toml、`.dev.vars.example`
- 文档：`PRODUCT.md`、`DESIGN.md`、`PROJECT-STATUS.md`、`doc/custom-generation-setup.md`

## 10. 验证结果

| 项 | 结果 |
|---|---|
| `python tools/validate_quiz.py` | 通过；10 题 × 5 选项、猫狗同构、16 角色可达、题干 ≤25 字 |
| `npm run test:api` | 58 / 58 通过 |
| `npx playwright test` | 61 / 61 通过 |
| 视觉复核 | 390px 角标/问卷、320px 关闭态、reduced-motion 扫光关闭，截图见 `app/shots/free-quota-*.png` |

模拟分布（猫狗各 20000 次，种子 42）：中庸选项占比 19.9%，平局率 32.8%，最低角色份额 1.4%。

## 11. 部署清单（尚未执行）

1. 对 D1 `PETI_DB` 应用 `0005_free_generation.sql`。
2. 确认 `ARK_API_KEY`、`ORDER_ACCESS_SECRET`、`PETI_DELIVERY_QUEUE` 已配置；16 张角色参考图在 R2。
3. 部署 Pages，确认 `/api/config` 返回 `available:true`、`free.remaining=1000`、`paymentAvailable:false`。
4. 部署 delivery worker，确认 `DELIVERY_ENABLED="true"` 且心跳 5 分钟内为 `ok`。
5. 用一张真实宠物照片走一次免费生成，确认 `orders.status='ready'`、R2 成品为 2048×2048 PNG、前端可保存。
6. 用错误 Key 或断网模拟一次失败，确认 `free_quota.used` 与 `free_usage.used` 退回。
7. 不要部署 preview delivery worker 来测免费生图（当前 `DELIVERY_ENABLED=false`）。

## 12. 给后续 agent 的注意事项

- **不要**在没有用户明确要求时把 `PAYMENT_ENABLED` 改回 `"true"` 或恢复前端付款 UI。
- **不要**改回「先读额度再写订单」，也不要删掉 `free_requests` 的补偿语句；并发会超发。
- **不要**把免费单放进 `/api/jobs` 或退款接口；两个入口都已显式拒绝。
- **不要**改 `qNn` 的 id 或 `axis/delta/points`；猫狗同构和 `OPTION_INDEX` 依赖它。
- **不要**重新引入透明抠图；本轮明确只交付白底 PNG。
- **不要**把本地 Playwright / Node 替身测试写成「真实生图已验收」。
- 若要关闭活动：把 `FREE_GENERATION_ENABLED` 设为 `"false"`，前端会显示维护态且不扣额度；不要靠改额度表为 0 来关闭。
- 若要恢复收费：需要同时处理旧订单、退款、`paid_at`、通知、后台交付与新订单来源，先读 `doc/avatar-delivery-operations.md`。
- 角标当前显示「剩余份数」而不是固定「1000 份」；如需固定文案只改 `custom.js` 的 `TEXT.badge`。

## 13. 2026-10-31 测试反馈修正（本地完成，未部署）

用户在测试环境验收 §20 后提出四点，已全部落实：

1. **生成两步进度**：`#generationProgress` 内含 `#genStepRequest` 与 `#genStepWait`，状态用 `data-state="pending|active|done"`；`unlocked/queued` 第 1 步 active，`generating` 第 1 步 done、第 2 步 active，`ready` 隐藏。转圈为 16px 圆点，完成换对勾，`prefers-reduced-motion` 停转；`#generationLive` 负责读屏播报。
2. **成品大图**：`#viewCustomLink` 包住 `#customImage`，点击调用 `result-media.js` 导出的 `viewImage`，复用 `#imageViewer`（缩放、长按保存、打开原图）。`result.js` 通过 `initCustom(getEntry, media.viewImage)` 注入。
3. **打赏强调**：`#tipAuthorLink` 位于保存按钮与问卷之间，文案「喜欢这种头像？花1.8元打赏作者」；`#tipPrice` 跟随 `config.amountFen`，`.tip-action` 用 `--purple-link: oklch(0.82 0.12 316)`、加粗、下划线。只在 `ready` 时显示。
4. **问卷回退**：`#surveyBackBtn` 在 `feedback` 存在时显示；点击只清空本地 `feedback` 并重新渲染满意度问题，重新提交走同一 UPSERT，覆盖同 attempt 的记录；切到不满意时前端显式发送 `priceFen:null, skipped:false`。

新增截图：`app/shots/free-generation-steps-390.png`、`free-tip-survey-390.png`、`free-image-viewer-390.png`。

验证：Playwright 66/66、Node API 58/58。仍未部署、未真实生图。

## 14. 2026-10-31 结果页调整（本地完成，未部署）

1. **移除朋友圈分享**：`result.html` 分享弹窗删除 `#shareMomentsBtn` 与 `#momentsGuide`，`result-media.js` 删除对应监听与禁用逻辑；分享说明改为“也可以长按预览图片保存。”。保存图片与长按保存保留。
2. **定制入口小字**：`#avatarCtaNote` 改为“上传照片生成毛孩子专属万圣节头像”，同排新增 `#roleCollectionBtn`（带下划线，44px 点击范围）。
3. **角色集合弹窗**：新增 `#roleCollectionDialog`，标题“16 个角色”，`#collectionGrid` 用 4×4 精灵网格展示 16 个角色；`result.js` 首次打开时 `fetchQuiz(entry.petType)` 并用 `roleAtlasUrl` 构建，`transform: translate(-25%*col, -25%*row)` 裁切。只浏览不选择，关闭后焦点回到入口。320/390px 保持四列。
4. 测试：`quiz.spec.js` 删除朋友圈点击断言，新增 `#shareMomentsBtn` / `#momentsGuide` 数量为 0、角色集合 16 项与下划线断言。

截图：`result-role-collection-entry-390.png`、`result-role-collection-390.png`、`result-role-collection-320.png`、`result-share-dialog-390.png`。Playwright 67/67。未部署。

## 15. 2026-10-31 题库文案二次精简与狗版同步（本地完成，未部署）

1. **猫版由用户改写**：16 个角色名去掉冗余的“的/大爆发”等词；10 题的方向选项与 qNn 文案整体缩短，`q4`、`q8` 等部分选项保留原句。
2. **狗版同步**：按猫版的新长度与语气逐题重写 50 条选项与 15 个角色名（witch 未改），保留狗的牵引绳、纸箱、肉干、球和飞盘等场景词；猫狗 optionId、axis、delta、points 仍逐项一致。
3. **q4n / q5c / q7n 改分值**：
   - q4n：狗版“特别凶，只认家里人，外人来了就狂吠”改为 `axis:"B", delta:3, points:{"pirate":2,"werewolf":1}`；猫版同步为“特别凶，只认家里人，外人来了就炸毛哈气”，分值相同。
   - q5c：两版统一为“它就是个天使一般的存在！什么时候都陪伴治愈着你”，从 `D+3 / witch2+clown1` 改为 `A+3 / nurse1+bride2`，q5 失去原来的戏精方向项。
   - q7n：两版统一为“只喜欢和你玩，狗/猫玩具再好玩也不如你手里的球/小纸团”，`A+3 / nurse2+bride1`。
4. **校验规则调整**：`validate_quiz.py` 的兜底项判定从“axis 为 null”改为“points 为空、每题至多 1 个”（q4、q7 允许 0 个，因为 q4n、q7n 已带角色分）；其余方向选项仍要求 axis ∈ 六轴、delta=±3、points 角色合法。
5. **版本升 v4**：两份 JSON 与 `public/js/config.js` 升到 `cat-2026v4` / `dog-2026v4`；`sessions.js` 的旧版兼容改为数组，同时接受 v2 与 v3，避免缓存页面提交失败。
6. **测试**：测试中的硬编码版本从 v3 改为 v4。

验证：`npm run validate` 通过；猫狗各 20000 次模拟，兜底项占比 16.0%，平局率 32.3%，A 轴均值 6.2、B 轴 6.5，16 角色全部可达（最低木乃伊 1.2%，最高小管家 19.9%）；`npm run test:api` 58/58；Playwright 67/67。未部署。

## 16. 2026-10-31 后台音乐暂停与角色集合单角色查看（本地完成，未部署）

1. **音乐后台暂停**：`public/js/audio.js` 监听 `visibilitychange`。隐藏时若在播则 `pause()` 并 `savePosition()`；回到前台时只有 `resumeOnVisible` 为真且未静音才 `play()`。初始加载时 `document.hidden` 为真则不自动播放。没有改动静音按钮与跨页偏好逻辑。
2. **单角色查看**：`result.js` 把 16 格改为 `button.collection-card`；`#collectionDetail` 显示大立绘、`#collectionDetailName`、`#collectionDetailMeta`（模拟占比）、`#collectionDetailQuote`。`#collectionBack` 返回网格；`showCollectionGrid` 恢复标题“16 个角色”并把焦点还给原卡片；弹窗关闭时重置视图并聚焦“角色集合”。`result.html` 与 `style.css` 增加对应结构与样式。
3. **测试**：`quiz.spec.js` 新增 `visibilitychange` 暂停/恢复用例；角色集合用例改为进入单角色、断言隐藏网格/标题/占比/台词、320px 不溢出、返回焦点。

截图：`result-role-detail-390.png`、`result-role-detail-320.png`。验证：Playwright 74/74、Node API 58/58。首次全量有一次首页答题用例超时，单跑与复跑通过，按测试时序偶发记录。未部署。

## 17. 2026-10-31 生成等待提示与成品加载占位（本地完成，未部署）

1. **预计等待两分钟**：`result.html` 的 `#genStepWait` 内新增 `span.gen-hint`，`.gen-hint { margin-left:auto; font-size:11px; white-space:nowrap }`，只在两步进度可见时出现。
2. **成品加载占位**：`result.html` 新增 `#customImagePlaceholder`，`style.css` 用 `aspect-ratio:1` 与成品同尺寸，内含 28px `.image-spinner` 与「正在加载头像…」。`custom.js` 的 `loadOutput` 在请求前 `show` 占位，成功、失败、`resetOutput` 都隐藏；`finally` 兜底隐藏。`prefers-reduced-motion` 停止转圈。
3. **测试**：`custom.spec.js` 两步进度用例断言提示文案；新增延迟图片响应用例，验证占位先出现、图片后出现、占位消失。

截图：`free-generation-eta-390.png`、`free-image-loading-390.png`。验证：Playwright 75/75、Node API 62/62。未部署。

## 18. 2026-10-31 角色卡大图改用 JPG（本地完成，未部署）

- `tools/prepare_web_assets.py` 现在同时输出 `static-cards/<version>/<pet>/<role>.jpg`（900×1380、quality 90、4:4:4、progressive），WebP 与缩略图流程不变。新增 32 张 JPG，合计约 9.8MB。
- `public/js/role-assets.js` 新增 `roleCardJpgUrl(petType, roleId)`。
- `public/js/result.js` 给 `#roleCardImage` 写入 `dataset.viewSrc`，并把 `#viewCardLink.href` 指向 JPG；`public/js/result-media.js` 打开大图时用 `dataset.viewSrc || currentSrc`。
- 结果：页面展示与答题预取仍是 WebP；点开大图后查看器图片和「打开原图」都是 `.jpg`，长按保存得到 jpg。JPG 只在大图打开时按需加载。
- 测试：`quiz.spec.js` 断言 `#viewerImage` 与 `#openOriginalImage` 为 `.jpg`；JPG 首次加载较慢，测试等待查看器完成首帧缩放后再比较缩放宽度。

验证：Playwright 75/75、Node API 62/62。未部署，部署时需带上新增 JPG。

## 19. 2026-10-31 移动端后台音乐立即静音（本地完成，未部署）

- 原因：移动端 `audio.pause()` 到扬声器真正停止有约 1 秒缓冲；锁屏时也可能只触发页面隐藏或冻结。
- `audio.js` 的 `pauseForBackground` 改为：原本在播时先 `audio.muted = true` 立即静音，再 `pause()`、保存位置。`resumeInForeground` 先 `audio.muted = false` 再 `play()`；`play()` 内部也清掉元素静音，避免点播放无声。
- 监听入口：`blur`、`visibilitychange`（hidden）、`pagehide`、`document.freeze`；`focus`/`pageshow`/可见时恢复。静音偏好仍优先，初始在后台不自动播放。
- 测试：`quiz.spec.js` 音乐用例断言 `blur`、隐藏、`pagehide`、`freeze` 后 `audio.muted === true`，回前台后 `muted === false` 且继续播放。

验证：Playwright 75/75、Node API 62/62。未部署；真机锁屏需另行复验。
