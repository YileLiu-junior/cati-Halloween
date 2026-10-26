# 项目状态锚点（多 agent 协作必读）

更新：2026-10-27 ｜ 维护约定：agent 完成一整块工作后更新本文件对应小节；逐文件变更不记这里，以文件系统与 git 为准（本仓库建议 git init，见 §4）。

## 1. 目录归属

| 路径 | 归属 | 说明 |
|---|---|---|
| `doc/` | 方案仓库（本仓库核心） | 定稿文档 + 两份 PRD + 评审记录，见 §2 |
| `free-pic/` | 美术资产线 | 免费卡立绘成品（角色名命名） |
| `ref-pic/<角色>-ref-prompt/` | 美术资产线 | 每角色：参考图 + 定稿生图 prompt.md |
| `output/` | 美术资产线过程留档 | imagegen 中间产物、自制技能 image-to-image-prompt |
| 根目录 `page头图.png` `card-free.png` `馒头图像.png` `halloween-cat-showcase-card-3x4.png` | 素材 | 馒头图像 = 立绘原型主体 |
| 根目录 `生图平台免费额度调研-2026-10-26.md` | 调研留档 | 各平台免费额度+置信度；生图主用国内免费档 |
| 产品实现仓库 | **尚未创建** | 产品代码、quiz-cat/dog.json 归此（PRD-quiz §6.1），不在本仓库 |

## 2. 文档状态（状态以各文档头部状态块为准，此处只放锚点）

| 文档 | 状态 |
|---|---|
| `doc/PRD-quiz.md` | **定稿 v1.2**（两轮 dev-review，报告在 doc/reviews/） |
| `doc/PRD-payment-generation.md` | draft，未送审 |
| `doc/quiz-design.md` `doc/quiz-design-dog.md` `doc/interaction-design.md` `doc/technical-notes.md` | 上游定稿 2026-10-26，勿改动；题库内容改动走 PRD §6.2 规则 |
| `doc/review-convention.md` v1.0 | PRD 评审流程约定，评审 agent 只读不写 |
| `doc/posthog-proxy-setup.md` v1.0 | PostHog 反代部署指南；PostHog 已注册（US 区）、key 已取 |
| `doc/reviews/PRD-quiz-ui-ux-analysis-20261027.md` | 交互清单（15 条）＋素材对账（4 项，硬图仅头图与 16 立绘）＋14 项开放问题；Q2（petName 时序）、F1（card-free.png 是整卡非立绘）待作者裁决 |

## 3. 美术资产进度（16 角色，猫版）

| 角色 | prompt 定稿 | 免费立绘成品 |
|---|---|---|
| 女仆咪 | ✅ | ✅ free-pic/（另产出 showcase 卡，card-free.png 即其复制，作免费卡占位） |
| 狼人咪 | ✅ | ✅ free-pic/ |
| 僵尸咪 | ✅ | ✅ free-pic/ |
| 木乃伊咪 | ✅ | ⚠️ 成品在 ref-pic/木乃伊咪-ref-prompt/木乃伊咪-免费.png，**待移入 free-pic/** |
| 其余 12 角色 | — | — |
| 狗版 16 角色 | — | —（付费链路图生图用，暂未开工） |

头图：`page头图.png` 为占位、后续更换（PRD §9.1）。

## 4. 待办与风险

1. 产品实现仓库未建；建好后迁入题库 JSON（自 quiz-design.md 转写，转完跑 balance-check 校验）。
2. 本仓库未 git 管理：多 agent 并行改动无账可查，建议尽快 `git init`（含 PNG 资产一起管）。
3. 12+16 张立绘生产中，生图依赖各平台免费额度（见调研文档）。
4. KV 免费额度核算（PRD §7.6）上线前完成。
5. 头图更换后同步改 PRD 素材表与 §9.1。
6. ui-ux 清单开放问题待作者裁决（见 §2 该行）：Q2 petName 时序（动 PRD 需重开评审）、F1 免费卡 demo 期口径、Q7 狗版立绘、Q12 AI 生成标识补入验收。
7. 木乃伊咪成品从 ref-pic 归位 free-pic（资产线执行）。

## 5. 协作边界约定

1. `doc/` 定稿文档只读；改 PRD 走 review-convention.md 流程。
2. 上游定稿文档不复制进代码与新文档；题库唯一数据源是产品仓库的题库 JSON。
3. 评审/分析类 agent（plan-critic-*、dev-review、ui-ux-analysis）对文档只读不写。
