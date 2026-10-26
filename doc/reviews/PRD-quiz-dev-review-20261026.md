被评审文档：`E:\Programs\Pets-Halloween\doc\PRD-quiz.md` ｜ 送审时状态：draft ｜ 文档版本：v1.0（2026-10-26，首次送审）

前置说明：本仓库只有文档，无产品代码（technical-notes.md:3「本项目只维护方案，不创建产品代码」），故无存量表/接口可核对，以下"现状"均指文档现状；产品在另一项目开发，库表接口均为从零新增。

## 一、主问裁决：「只引用不复制」对开发落地够不够

结论先行：写法成立，5 处 KEEP、3 处 MODIFY、1 处 OPEN。上游文档真实存在、内容与 PRD 描述对得上（逐份读过），不需要把上游复制进 PRD；会卡住的只有「PRD 是集成文档却没定上游没定的字段」这类缝隙。

| # | 引用点 | 裁决 | 依据与理由 |
|---|---|---|---|
| 1 | 题库文案、加分、16 角色引用 `quiz-design.md` §1–§4、`quiz-design-dog.md` §1 | KEEP | 引用够用。抽查猫版 Q1/Q2/Q9 与 balance-check.py QUESTIONS 逐项一致（balance-check.py:24-27 对 quiz-design.md:88-91）；狗版加分逐项对齐（quiz-design-dog.md:26-29 对猫版同位）。文案、加分、后缀全在，开发照抄即可。 |
| 2 | 平局顺序引用 `balance-check.py` 第 95 行 | KEEP | 核实 balance-check.py:95-97，`TIE_BREAK` 数组确实起于第 95 行、语义为「撞分取靠前」（:114 `max(TIE_BREAK, key=...)`），与 PRD-quiz.md:32 及 quiz-design.md:73 伪代码语义一致。数组跨 95–97 行，锚首行足够定位，不必改引用。 |
| 3 | 接口字段引用 `technical-notes.md` §4 | MODIFY | 引用不够。§4（technical-notes.md:59-73）只定到字段名级：无请求/响应 JSON、无错误码集合、无凭证传递方式（header 还是 body）、无幂等语义。且 PRD-quiz.md:93-94 的 sessions 入参没有宠物类型字段——上游也没有，两边一起缺。这两个接口是问答模块的全部 API 面，必须有人定成精确字段，PRD 不定就没人定。 |
| 4 | 埋点定义引用 `interaction-design.md` §6 | MODIFY | 事件表本身引用够用（interaction-design.md:147-158，五个事件齐全）。但传输通道上游自相矛盾：technical-notes.md:72 有 `POST /api/events` 接口，technical-notes.md:143 又推荐 PostHog Cloud SDK 直发。PRD 不点名，开发会各做一半。 |
| 5 | 存储分工引用 `interaction-design.md` §1 + `technical-notes.md` §1 | KEEP | 够用。L/K 分工、localStorage 不作权益依据、口令为 128 位随机（interaction-design.md:28-32、:72），quiz 范围内所有存取项都写得出来。 |
| 6 | 生图 prompt 引用 `quiz-design.md` §6、狗版前缀引用 `quiz-design-dog.md` §3 | KEEP | 生图不在本 PRD 范围（PRD-quiz.md:21），prompt 属付费链路资产，引用即够。但注意：免费简版卡需要的 16 张通用立绘是另一回事，见质询清单第 4 条。 |
| 7 | 稀有度 X% 引用 `quiz-design.md` §7 | KEEP | 核实 §7 存在（quiz-design.md:253-262，占比 2.6%–12.0%）。狗版「毛孩子」措辞也与 quiz-design-dog.md:125 一致。附带提醒：这是 n=20000 模拟占比不是全站实况，上游已按彩蛋文案定位，可接受。 |
| 8 | 视觉风格 §9 留空 | OPEN | PRD-quiz.md:106 自认留空。不挡开工（可占位开发），挡免费卡导出定稿与雷达图样式。需作者补或明确挂到别的文档。 |

另记一处术语漂移（不单列裁决）：同一凭证在 PRD-quiz.md:39 叫「私密口令」、technical-notes.md:61 叫「私密凭证」、interaction-design.md:72 叫「找回凭证」。开发能猜懂，但接口定稿时应统一为一名。

## 二、质询清单

| # | 问题 | 为什么挡开工/做走样 | 最薄建议形态 | 裁决 |
|---|---|---|---|---|
| 1 | sessions/results 无宠物类型字段 | 服务端不知猫狗，返回不了「汪」后缀文案、存不对题库版本；前后端字段不对齐是本模块最可能做走样的一处 | sessions 入参加 `petType`（或把类型编码进 quizVersion 并写死格式），PRD-quiz.md:93 补一句 | MODIFY |
| 2 | results 幂等未定义 | 「揭晓身份」双击或超时重提会重复生成 publicId；分享文案、后续支付绑定（payId↔testId）都锚在结果上 | 同凭证+testId 重复提交返回原结果原 publicId（KV put-if-absent 即可） | MODIFY |
| 3 | quizVersion 无取值规则 | sessions 入参、localStorage 存的题目版本（PRD-quiz.md:73）、服务端计分数据三方靠它对齐；题库改版后旧答案没法解释 | 定死格式如 `cat-2026v1` / `dog-2026v1`，写入 PRD §7 | MODIFY |
| 4 | 免费简版卡的 16 张通用立绘无着落 | PRD-quiz.md:83 范围含导出免费卡，但上游生图 prompt 全是「以参考图中的猫咪为主角」的图生图（quiz-design.md:220），通用立绘谁来生、猫狗是否共用、是否已产，任何文档都没写（未核实是否已有美术资产）。挡上线，不挡开工 | 先用 1 张占位图打通 canvas 导出链路；16 张生产列上线前待办；猫狗共用与否交作者定 | OPEN |
| 5 | 计分数据三源漂移 | 加分表现在存在于 py（balance-check.py:22-83）和 md（quiz-design.md §4）两处，产品代码在另一项目，手抄进 JS 是第三处，改题必漂移 | 定 JS 题库文件为唯一数据源，balance-check.py 改后重跑比对；写进 PRD §6 | MODIFY |
| 6 | KV 免费额度风险未提示 | 免费档写入 1,000 次/日（technical-notes.md:166），每用户至少 2 次写（session+result），约数百用户/日即触顶；活动靠小红书引流，触顶即不可用。账户实际配额未核实 | PRD 补一行额度核算与超限预案 | MODIFY |
| 7 | 找回失败无终点 | 「继续上次/找回结果」是独立入口（PRD-quiz.md:62），口令无效或结果过 30 天保留期（interaction-design.md:72）时用户停在死路 | 定义失败文案 + 回落地页，并入 §4 空态表 | MODIFY |
| 8 | 验收项不可判定 | PRD-quiz.md:102 三条全是形容词（"稳定""不重排"），无失败路径，测没测过说不清 | 按第四节验收标准编号条目执行 | MODIFY |
| 9 | 状态机是否要建 | 本模块实体只有会话/结果，两个状态，建状态机引擎是过度设计 | 一个字符串状态字段 + KV TTL，见第四节 | KEEP（薄实现） |
| 10 | 数据库/表 | 无支付无上传，KV 原生够用，引入 D1/SQL 属过度建设 | 不建库，仅定 KV 键设计 | KEEP（不建） |

## 三、开发准备清单

### 1. 数据库

无需新建数据库。存储用 Cloudflare KV（技术栈已定，technical-notes.md:13-19），本仓库无产品代码、无存量数据，无迁移问题。需在接口定稿时一并写死的 KV 设计（放 technical-notes 或 PRD 附录均可）：

- 键：`result:{testId}` → 结果记录；`publicId` 反查索引先不建（找回凭口令不凭公开 ID，PRD-quiz.md:35，当前无消费方，见 ponytail 裁决）。
- 结果记录 value 字段：testId、petType、quizVersion、optionId 数组、宠物名、roleId、六轴、publicId、口令哈希、createdAt、status。
- TTL：结果元数据保留 30 天（interaction-design.md:72），用 KV expirationTtl 实现。
- 唯一性：publicId 生成后 put-if-absent，碰撞重试一次即可。
- 额度核算：按每用户 2 次写预估日峰值，对照 1,000 次/日免费档。

### 2. 接口

只两个必做接口 + 一个埋点决策，均为新增：

- `POST /api/sessions`（PRD-quiz.md:93；technical-notes.md:61）
  - 入参：来源渠道、quizVersion（格式见质询 3）、**petType（待补）**。
  - 出参：testId、私密凭证（128 位随机，interaction-design.md:72）。
  - 幂等：不要求（每次进入新建会话可接受）；限流：按 IP 创建限流（interaction-design.md:32「创建限流」）。
- `POST /api/results`（PRD-quiz.md:94；technical-notes.md:63）
  - 入参：凭证、testId、optionId 数组（10 个）、宠物名（1–12 字，服务端校验）。
  - 出参：roleId、六轴、publicId、结果文案（含猫/狗后缀版本，指向 petType）。
  - 幂等：**必须**——同凭证+testId 重复提交返回原 publicId（质询 2）。
  - 鉴权：凭证校验，服务端计分，不采信前端角色（PRD-quiz.md:96）。
  - 错误：统一 `code / message / retryable`（technical-notes.md:74），错误码集合在接口定稿时列全（至少：凭证无效、参数缺失、宠物名超长、限流、服务错误）。
- 埋点通道二选一并写入 PRD：PostHog SDK 直发（technical-notes.md:143 推荐）或自建 `POST /api/events`（technical-notes.md:72）。ponytail 倾向前者，砍一个后端接口。

### 3. 状态机

唯一实体：会话/结果。状态集合两个，不建议建引擎：

| from | to | 触发条件 | 防御 |
|---|---|---|---|
| （无） | answering | 调 sessions 成功 | — |
| answering | completed | results 首次成功 | put-if-absent，completed 为终态不可回退；重复提交只读返回原结果 |

- 找回/「继续上次」= 对 completed 的只读重入，不是状态迁移。
- 过期：30 天 TTL 到期即记录消失，找回接口返回「已过期」——这是唯一的非法访问防御点。
- 无并发写花风险点：同一 testId 只会有一条 results 提交路径，put-if-absent 兜住双击。

### 4. 验收标准

1. 选项洗牌稳定：Given 同一会话，When 刷新/返回上一题再回来，Then 4 个选项顺序与会话首次渲染一致，且 optionId 与位置的映射不变。
2. 平局：Given 构造两角色同分的作答组合，When 提交，Then 返回 TIE_BREAK（balance-check.py:95-97）中靠前者。
3. 六轴边界：Given 某轴累计增减超出 ±5，Then 该轴返回值 clamp 为 0 或 10（balance-check.py:109 同规则）。
4. 作答约束：Given 未选答案，Then「下一题」禁用；Given 在末题，Then 按钮文字为「揭晓身份」。
5. 提交幂等（失败路径）：Given 首次 results 已成功，When 同凭证同 testId 重复提交（含双击），Then 返回原 publicId 与原结果，不新建记录。
6. 找回失败（失败路径）：Given 错误口令，Then 提示失败、保留输入、回落地页，不泄露结果是否存在；Given 结果超 30 天，Then 明确提示已过期。
7. 免费简版卡：Given 结果页，When 导出 PNG，Then 图内含通用立绘（带「角色示意」标注）、角色名（咪/汪后缀正确）、宠物名、公开 ID、金句、口令「喵灵万圣节」。
8. 双入口：Given 狗版答完，Then 角色名后缀「汪」、金句取 quiz-design-dog.md §2 文案、稀有度文案用「毛孩子」。
9. 漏斗：上线后满 7 日，完成数/开始数 > 60%（PRD-quiz.md:101，埋点核验项，非功能测试项）。

## 四、ponytail 裁决

- 砍：不建数据库/表——KV 平台原生够用，D1/SQL 是为不存在的需求建仓。
- 砍：不建状态机引擎/状态表——两个状态一个字符串字段，迁移表写进文档即可，不写代码。
- 砍：publicId 反查索引——找回凭口令不凭公开 ID，当前无任何功能按 publicId 查结果，YAGNI，有需求再加。
- 降薄：埋点取 PostHog SDK 直发——砍掉自建 `POST /api/events` 接口与台账，作者若要服务端漏斗数据再恢复。
- 降薄：免费卡立绘先用 1 张占位图打通链路——16 张资产生产是上线待办不是开发阻塞，猫狗共用与否待作者定。
- 留：results 幂等、petType 字段、quizVersion 格式——三者为真缺口，砍了必返工。

## 末行

开工前必须先定的一件事：**定稿 `POST /api/sessions` 与 `POST /api/results` 的精确出入参**——含 petType 如何传、quizVersion 格式、凭证传递方式（header/body）与错误码集合，前端、后端、另一项目三处共用这一份；这是「只引用不复制」写法下唯一没人负责补的集成缝隙。

---

核实情况汇总：五份上游文档全部存在且与 PRD 描述对得上（`doc/quiz-design.md`、`doc/quiz-design-dog.md`、`doc/interaction-design.md`、`doc/technical-notes.md`、`doc/balance-check.py`），`doc/PRD-payment-generation.md` 亦存在；`balance-check.py:95` 的 TIE_BREAK 锚点核实无误；未核实项仅两处——Cloudflare 账户实际配额、16 张通用立绘是否已有美术资产，均已标注 OPEN。本次评审只读，未改动任何文件。
