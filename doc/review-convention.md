# PRD 评审约定

版本 v1.0 ｜ 2026-10-26 ｜ 读者：coordinator 与 PRD 作者。
本文规定 PRD 的评审状态怎么标记、评审报告放哪、状态由谁推进。评审/分析 agent（plan-critic-general、plan-critic-prio、plan-critic-tech、dev-review、ui-ux-analysis）对 PRD 只读不写。

## 1. 状态块

每份 PRD 在标题与版本行之后、正文之前放一个状态块，全文状态只此一处：

| 状态 | 评审记录 |
|---|---|
| draft | （尚无评审记录） |

评审记录列一轮评审一行，行格式固定：

```
日期 ｜ agent 名 ｜ 结论摘要 ｜ 报告路径 ｜ 是否已修订
```

示例：

```
2026-10-26 ｜ dev-review ｜ 3 KILL / 5 MODIFY / 2 OPEN ｜ doc/reviews/PRD-quiz-dev-review-20261026.md ｜ 已修订
```

## 2. 状态机

| from | to | 触发条件 | 迁移人 |
|---|---|---|---|
| draft | 评审中 | 首次送任一评审 agent | coordinator |
| 评审中 | 已修订 | 按意见修订完毕 | 作者或 coordinator |
| 评审中 | draft | 决定不采纳该轮意见，退回 | 作者或 coordinator |
| 已修订 | 评审中 | 再次送审，新起一行评审记录 | coordinator |
| 已修订 | 定稿 | 作者确认无需再改 | 作者 |
| 定稿 | 评审中 | 需求变更重新打开，新起一行评审记录 | coordinator |

规则：

1. 评审 agent 只产出报告文本，不改 PRD 正文、不推进状态。
2. 状态推进只发生在报告落盘、作者（或 coordinator）已应用或明确拒绝意见之后。
3. 不允许跳迁（如 draft → 定稿、draft → 已修订）。

## 3. 评审报告存放

1. 目录：`doc/reviews/`；文件名 `<PRD文件名去扩展名>-<agent名>-<YYYYMMDD>.md`，如 `PRD-quiz-dev-review-20261026.md`。
2. 报告由 coordinator 落盘并回填状态块；评审 agent 不自己写文件。
3. 报告首行注明：被评审文档路径、送审时状态、对应文档版本号。

## 4. coordinator 送审指令格式

发给评审 agent 的任务必须含三样：文档路径、当前状态、本次要看什么。示例：

```
用 dev-review 评审 doc/PRD-quiz.md（当前：已修订 v1.1），重点看新增的退款章节。
```

## 5. 与 agent 分工的衔接

1. ui-ux-analysis 读状态块：无 dev-review 记录 → 素材清单注明"未经裁决"；有 → 素材清单只覆盖裁决后保留的功能集。
2. dev-review 裁决 KILL 的功能，ui-ux-analysis 已产出的对应素材项由 coordinator 在回填状态块时标注作废。
3. P0/P1/P2 以方案文档自身标注为准，评审 agent 不另立优先级体系。
