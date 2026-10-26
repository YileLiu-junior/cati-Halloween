# 问答模块 PRD 第二轮复审报告

被评审文档：`E:\Programs\Pets-Halloween\doc\PRD-quiz.md` ｜ 送审时状态：已修订 v1.1（2026-10-27，第二轮复审） ｜ 版本号：v1.1

核实基础：PRD 全文、`doc/posthog-proxy-setup.md` 全文、上轮报告 `doc/reviews/PRD-quiz-dev-review-20261026.md`、上游 `doc/technical-notes.md` §4/§8、`doc/interaction-design.md` §1/§6、`doc/balance-check.py`、`doc/quiz-design.md` §7、`doc/quiz-design-dog.md` 均逐份读过；素材文件 `page头图.png`、`card-free.png` 已确认存在于仓库根。

## 一、上轮 9 条 MODIFY 落地核验

| 上轮项 | v1.1 落点 | 判定 |
|---|---|---|
| 1 接口契约（§7 新写） | PRD-quiz.md:103-105：出入参精确到字段、token 走 body、错误码五枚 | 已落地，但存 3 处内部缝隙（见质询 1/2/3） |
| 2 题库 JSON 唯一数据源 | PRD-quiz.md:94-95：JSON 唯一源 + 改动规则（只改文案跑校验、动加分升 quizVersion） | 已落地，但数据源清单缺 TIE_BREAK/optionId，且仓库归属未定（见质询 4/5） |
| 3 找回失败终点 | PRD-quiz.md:82：失败文案 + 回落地页 + 不泄露存在性 | 已落地，但「已过期」与 30 天 TTL 逻辑互斥（见质询 2） |
| 4 埋点通道 | PRD-quiz.md:109,113：PostHog Cloud + /ingest 反代、不自建 /api/events | 已落地；配套指南有 2 处必修（见质询 6/7） |
| 5 KV 键设计与 TTL | PRD-quiz.md:107：result:{testId}、30 天 TTL、不建反查索引 | 已落地，但 publicId put-if-absent 与不建索引自相矛盾（见质询 3） |
| 6 KV 额度预案 | PRD-quiz.md:108：1,000 次/日、每用户 2 写、升付费档 | 已落地；「2 写」隐含会话记录存在但 §7.5 没定义（并入质询 1） |
| 7 quizVersion 取值 | PRD-quiz.md:103：cat-2026v1 / dog-2026v1；§6.2 升版规则 :95 | 已落地，§3/§6/§7 对齐 |
| 8 验收可判定 | PRD-quiz.md:125-133：9 条编号 | 已落地；第 6 条「超 30 天提示已过期」按当前存储设计不可测（见质询 2） |
| 9 术语统一 | PRD-quiz.md:106：私密口令=私密凭证=找回凭证 | 已落地，但 §10.5/§10.7 出现两处新漂移（见质询 9） |

上轮 2 个 OPEN 处置确认：§9 视觉已填（PRD-quiz.md:117-121，剪纸叠层、#2B2020→#010000 渐变+噪点、四装饰色）；免费卡占位立绘已定（PRD-quiz.md:22,90,131，card-free.png 在仓库根存在）。两个处置均成立，无新缺口。

## 二、质询清单

**1. 会话无服务端落点，token 校验与 petType 来源悬空 ｜ MODIFY（最高优先级）**
- 问题：§7.2（PRD-quiz.md:104）results 入参只有 token、testId、optionIds、petName，出参却要「按 petType 出咪/汪文案」；§7.5（:107）只定义 `result:{testId}` 一个键。首次 results 提交时服务端没有任何已存记录：token 无从校验（TOKEN_INVALID 对首次提交形同虚设，testId 若可枚举，任何人可抢注他人 testId）、petType/quizVersion 无从取得（optionId 归属哪个题库也就无从判定）。
- 为什么挡开工：token 校验是本模块唯一鉴权防线（无登录，PRD-quiz.md:28）；结果创建安全与计分正确性都压在这个缺失的记录上。
- 最薄形态：§7.5 补一行会话记录——键 `session:{testId}`，value 含口令哈希、petType、quizVersion、source、createdAt，expirationTtl 30 天；results 校验 token、读取 petType 均以此为准。§7.6「每用户 2 写」口径即闭环。
- 备注：服务端未核实项——testId 生成格式全文未写，若顺序可枚举则本条为硬安全缺口。

**2. 「已过期」提示与 30 天 TTL 互斥 ｜ MODIFY（作者二选一）**
- 问题：§4.5（PRD-quiz.md:82）与 §10.6（:130）要求区分「口令无效」与「超 30 天已过期」；但 §7.5 expirationTtl 30 天到期记录即被删除，服务端面对一个不存在的键，无法区分「曾存在已过期」和「从未存在」。
- 为什么挡开工：§10.6 后半句按当前设计不可实现也不可测；二选一不定，找回文案与验收都会返工。
- 最薄形态：(a) 合并为一条失败文案「口令无效或已超过保留期」（最薄，ponytail 倾向）；(b) 口令哈希小记录 TTL 延长（如 90 天），仅口令校验通过才回「已过期」——与 interaction-design.md:72「结果元数据保留 30 天」的口径是否冲突，需作者拍板。

**3. publicId put-if-absent 与「不建反查索引」不能同时成立 ｜ MODIFY**
- 问题：§7.5（PRD-quiz.md:107）要求「publicId 生成用 put-if-absent，碰撞重试一次」，同段又说「不建 publicId 反查索引」。put-if-absent 只能作用在 KV 键上；没有 publicId 键就无处 put，也没有任何办法检测碰撞。
- 为什么挡开工：写进接口契约的行为无法实现，开发只能自行猜测，做出来必然偏离其中一半。
- 最薄形态：写死 publicId 熵（如 8–10 字符随机，活动量级碰撞概率可忽略），直接写入、删掉 put-if-absent 与重试表述；不要为此补索引键。

**4. 平局顺序与 optionId 不在「唯一数据源」清单，行号锚点即将失效 ｜ MODIFY**
- 问题：§6.1（PRD-quiz.md:94）清单为「题干、选项加分、16 角色、结果文案、默认宠物名」，不含 TIE_BREAK 与 optionId 命名规则；同时 §2/§10.2（:38,:126）把平局顺序锚在 balance-check.py 第 95 行，而 §6.1 又规定重写该脚本读 JSON——重写后行号必漂，服务端计分所需的 TIE_BREAK 又回到手抄第三份，上轮 M5（三源漂移）换个地方复发。
- 为什么挡开工：服务端计分和平局验收（§10.2）都依赖这两项的权威出处。
- 最薄形态：TIE_BREAK、optionId 命名规则一并写进 JSON（数据源才真正唯一）；锚点从「第 95 行」改为「balance-check.py 的 TIE_BREAK 常量」这类符号级引用。
- 核实：balance-check.py:95-97 TIE_BREAK 数组与 :109 clamp 规则均与 PRD §3.7 一致，现状引用无误，问题只在重写后的脆弱性。

**5. quiz-cat.json / quiz-dog.json 归属仓库未定 ｜ OPEN**
- 问题：§6.1 要求前端与服务端「读同一份」JSON，但产品代码在另一仓库（technical-notes.md:3 本仓库不建产品代码），本仓库当前也不存在这两个 JSON 文件（已核实）。文件放哪、balance-check.py 跟不跟着迁、跨仓库改动规则（§6.2）由谁执行，均未交代。
- 为什么值得定：不定则「唯一数据源」跨仓库即名存实亡。
- 最薄形态：一句话定归属（建议：JSON 归产品仓库，balance-check.py 随迁，本仓库只留引用地址）。

**6. 部署指南缺会话录制关闭与 URL 片段过滤，违反上游硬要求 ｜ MODIFY**
- 问题：technical-notes.md:143 明确「关闭自动全量捕获、会话录屏及敏感属性采集」「初始化 SDK 前先消费并移除恢复链接中的私密片段；统一过滤事件的完整 URL、查询串及片段」。指南 §3（posthog-proxy-setup.md:74-81）只关了 autocapture 与 capture_pageview，两项都没做。PostHog 事件默认携带 $current_url（含 fragment），而 interaction-design.md:72 找回链接用片段携带口令——口令可能原样进 PostHog。
- 为什么挡上线：隐私硬要求（interaction-design.md:145「不记口令…或恢复 URL」），且指南自身声称实现了上游约束。
- 最薄形态：init 补 `disable_session_recording: true`；init 前 history.replaceState 剥掉查询串与片段（或配 sanitize_properties 白名单）。两行代码。

**7. 指南反代函数签名错误，资产分支必崩 ｜ MODIFY**
- 问题：posthog-proxy-setup.md:55 `export async function onRequest({ request, context })`——Cloudflare Pages Functions 只向 handler 传一个 context 参数（其属性含 request、waitUntil 等，平台文档明确），解构出的 `context` 是 undefined；:61 把它当 ctx 传入 retrieveAsset，:50 `ctx.waitUntil` 在 /array/、/static/ 缓存未命中时抛 TypeError 返回 500。POST 转发路径（/e/）不受影响，所以按 §4.1 粗验可能「看起来通」，埋一条暗雷。
- 为什么挡上线：指南是供照抄的交付物，代码必须能跑；§6 故障速查表救不了这种静默崩溃。
- 最薄形态：改 `onRequest(ctx)`，函数体内用 `ctx.request` / `ctx.waitUntil`。另两处顺手修：§3 脚本源 jsdelivr `@latest` 锁定具体版本号；「顺带规避广告拦截器」（:4）与脚本本身走 jsdelivr 不自洽，从 `/ingest/array/` 加载可同时兑现该目标并让 §2 资产分支名副其实，或注明取舍。

**8. 限流实现介质未定，且与 KV 额度口径联动 ｜ OPEN**
- 问题：§7.1（PRD-quiz.md:103）「按 IP 限创建频率」未说用什么实现。若用 KV 计数器，每会话多一次写，§7.6「每用户 2 写」失真、1,000 次/日更早触顶；若用实例内存，多实例/重启下形同虚设。
- 为什么待定：不挡开工（可先内存近似），挡上线前的额度核算。
- 最薄形态：一句话声明介质；建议内存近似限流、明确不占 KV 写额，活动量级够用。

**9. 文字与术语小漂移（批量修，不挡主体）｜ MODIFY**
- §10.7（PRD-quiz.md:131）「口令『喵灵万圣节』」与 §7.4 定名的「私密口令」撞名，应写「搜索口令」。
- §10.5（:129）「同凭证」应统一为「口令/token」（§7.4 只统一了三文档名，漏了自家验收）。
- §7.7（:109）与 §8.1（:113）埋点表述整段重复，留一处即可。
- 头部素材表「当前为占位、后续更换」（:21）与 §9.1「已按此风格产出」（:119）口径微冲突，§9.1 补「现图为占位」即可。
- petName「1–12 字」（:87,:105）计数口径（code point 还是字素簇）前后端各写各的会不一致，一句话定死。

本轮无 KILL。上轮已 KEEP/KILL 的裁决未复核、不重复。

## 三、开发准备清单

### 1. 数据库
无需新建库，维持 Cloudflare KV（technical-notes.md:13-19）。无存量数据、无迁移。需定稿的记录两份：
- `session:{testId}`（新增定义，质询 1）：口令哈希、petType、quizVersion、source、createdAt；expirationTtl 30 天。
- `result:{testId}`（§7.5 已有）：字段维持；其中 status 取值建议写死为 answering / completed 两个字符串（现为裸字段名，PRD-quiz.md:107）。
- 限流状态不落 KV（质询 8 裁决后写入文档）。

### 2. 接口
- `POST /api/sessions`（PRD-quiz.md:103）：入参 source、quizVersion、petType；服务端需校验 quizVersion 取值合法且与 petType 匹配（不匹配归 PARAM_MISSING，现在没写）；出参 testId、token；不幂等；按 IP 限流。
- `POST /api/results`（:104）：入参 token、testId、optionIds[10]、petName；petType/quizVersion 从 session 记录取，不采信前端；幂等 put-if-absent 作用于 result 键；错误码五枚维持；petName 计数口径定死。
- `POST /api/recover`：PRD §7 未定义，但 §4（:68,:82）与 §10.6（:130）有流程和验收依赖。入参必须至少含 token+testId（只凭口令就得建口令反查索引，比多传一字段贵，且 §7.5 已声明不建索引）；出参结果或统一错误。归属二选一写明：纳入 §7，或移交支付链路 PRD 并在 §4 标注出处（technical-notes.md:66 现有字段名级定义）。

### 3. 状态机
维持上轮薄实现，不建引擎：
| from | to | 触发 | 防御 |
|---|---|---|---|
| （无） | active | sessions 成功（写 session 记录） | — |
| active | completed | results 首次成功（put-if-absent） | completed 终态不回退，重复提交只读返回 |

- 找回 = completed 只读重入；过期 = 记录消失（「已过期」文案口径待质询 2 裁决）。
- 无并发写花点：同 testId 单一提交路径，put-if-absent 兜双击。

### 4. 验收标准
§10 九条总体可判定，维持七条（洗牌/平局/六轴/作答约束/幂等/简版卡/双入口/漏斗），两处修订：
- 修订 §10.6：拆为两条——(a) Given 错误口令，When 提交找回，Then 提示失败、保留输入、回落地页、不泄露存在性（可测）；(b) 超 30 天提示「已过期」——质询 2 裁决前标待定，按现设计不可测。
- 新增一条失败路径：Given 非法 quizVersion 或 quizVersion 与 petType 不匹配，When 调 sessions，Then 返回 PARAM_MISSING 且不建会话。
- §10.2 平局构造方法具备可执行性（balance-check.py 模拟可产出同分组合），维持。

配套指南修订项（posthog-proxy-setup.md）：修签名 bug（:55,:61,:50）、init 补录制关闭与片段剥离（:74-81）、锁 jsdelivr 版本、脚本加载源与拦截器目标对齐说明。

## 四、ponytail 裁决

- 降薄：publicId 碰撞——加熵不加索引，删 put-if-absent/重试表述（质询 3）。
- 降薄：「已过期」区分——倾向合并为单一失败文案；若作者坚持区分才考虑延长哈希记录 TTL（质询 2）。
- 降薄：限流——内存近似即可，不上 KV 计数器、不上付费 WAF（质询 8）。
- 不砍：session KV 记录——不是新建设，是 token 校验、petType 来源、额度口径三条线的最薄公共落点，砍了 results 无法安全创建。
- 不砍：指南反代函数——已是官方方案最薄移植（1 文件 + 3 行 init），bug 是修不是砍。
- 不砍：recover 带 testId——省这一个字段要付出一张反查索引表，不值。

## 末行

开工前必须先定的一件事：**把「服务端如何记住会话」写进 §7.5**——session:{testId} 记录（或等价的 token↔testId 绑定机制）。它是 token 校验、petType/quizVersion 来源、KV 额度口径三条线的公共落点，其余必改项都绕不开它。

---

**总结论：需再修**（必改项：质询 1、2、3、6、7；质询 4、5、9 建议随定稿一并带上，质询 8 为 OPEN 待作者定）。九处均为文字级或数行代码级修改，主结构与上轮方向无误，修完无需第三轮全量复审。

本次评审只读，未改动任何文件。未核实项：Cloudflare 账户实际 KV 配额（沿袭上轮 OPEN）、testId 生成格式（全文未写）、PostHog 对 `/array/` 路径的运行时请求行为（不影响质询 7 的签名结论）。
