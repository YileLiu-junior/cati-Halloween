# 项目状态锚点（多 agent 协作必读）

更新：2026-10-28 凌晨 ｜ 维护约定：agent 完成一整块工作后更新本文件对应小节；逐文件变更不记这里，以 git 为准（仓库已 init）。

## 1. 目录归属

| 路径 | 归属 | 说明 |
|---|---|---|
| `doc/` | 方案仓库（本仓库核心） | 定稿文档 + 两份 PRD + 评审记录，见 §2 |
| `free-pic/` | 美术资产线 | 免费卡立绘成品（角色名命名） |
| `ref-pic/<角色>-ref-prompt/` | 美术资产线 | 每角色：参考图 + 定稿生图 prompt.md |
| `output/` | 美术资产线过程留档 | imagegen 中间产物、自制技能 image-to-image-prompt |
| 根目录 `page头图.png` `card-free.png` `馒头图像.png` `halloween-cat-showcase-card-3x4.png` | 素材 | 馒头图像 = 立绘原型主体 |
| 根目录 `生图平台免费额度调研-2026-10-26.md` | 调研留档 | 各平台免费额度+置信度；生图主用国内免费档 |
| `app/` | **quiz MVP（初版 14 用例；2026-10-27 UI 改版后 19 用例通过）** | Cloudflare Pages 项目：`public/`（三页前端+题库 JSON+资产）+ `functions/`（sessions/results/recover + ingest 反代）+ `tools/`（题库校验、截图脚本）+ `tests/`（Playwright）。跑法：`cd app && npm run dev` → http://127.0.0.1:8788；验收 `npm test`；题库校验 `npm run validate`。用户指示 MVP 进本仓库（原「本仓库只维护方案」约定对 MVP 让位，正式产品仓库如需拆分再拆） |

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

1. ~~产品实现仓库未建~~ → MVP 已在 `app/` 建成（quiz 全链路，见 §1）。题库 JSON 已转写并通过校验（`npm run validate`，模拟分布与 quiz-design §7 一致）。
2. ~~本仓库未 git 管理~~ → 已 init；MVP 已按里程碑提交（数据/接口前端/测试 3 个 commit + 文档基线）。
3. 12+16 张立绘生产中，生图依赖各平台免费额度（见调研文档）；MVP 结果页/免费卡用 free-pic 已有立绘映射（护士/狼人/僵尸/木乃伊），其余角色暂用女仆咪透明立绘占位——**替换真图后需告知**（用户原话：跑出来告诉我要换）。
4. MVP 部署待办：`wrangler.toml` 的 KV namespace id 是本地占位，线上部署需建真实 namespace 并 `wrangler pages deploy`（需 Cloudflare 账号连接）；PostHog token 已按公开 key 嵌入 `app/public/js/config.js`。
5. 已知取舍（MVP）：限流为实例内存近似（PRD §7.1 允许）；KV 幂等为先查后写（真 KV 无原子 put-if-absent，单写路径下够用）；quiz-design.md Q2c「小护士+1」与 balance-check.py「nurse+2」不一致，**JSON 按 py 为准**，上游文档待作者改齐。
6. KV 免费额度核算（PRD §7.6）上线前完成。
7. 头图更换后同步改 PRD 素材表与 §9.1（现占位图带「10·02」字样）。
8. ui-ux 清单开放问题待裁决（见 §2 该行）：Q7 狗版立绘、Q12 AI 生成标识已部分落实（免费卡加了「AI 生成示意」小字）、其余见报告。
6. ui-ux 清单开放问题待作者裁决（见 §2 该行）：Q2 petName 时序（动 PRD 需重开评审）、F1 免费卡 demo 期口径、Q7 狗版立绘、Q12 AI 生成标识补入验收。
7. 木乃伊咪成品从 ref-pic 归位 free-pic（资产线执行）。

## 5. 协作边界约定

1. `doc/` 定稿文档只读；改 PRD 走 review-convention.md 流程。
2. 上游定稿文档不复制进代码与新文档；题库唯一数据源是产品仓库的题库 JSON。
3. 评审/分析类 agent（plan-critic-*、dev-review、ui-ux-analysis）对文档只读不写。

## 6. 2026-10-27 UI 与历史结果更新

以用户本轮明确要求覆盖旧版界面约定，未改题库、计分、支付或生图。

1. 首页表单叠在头图上，使用半透明暖黑和紧凑控件；姓名提示改为“请输入宠物姓名”，不显示 placeholder。后续按用户反馈取消整块表单黑底与渐变遮罩，文字和独立控件使用投影；手机首屏改为至少一整屏高度。
2. 三页加载 `bgm.mp3`，右上角 SVG 按钮切换静音并保存偏好；浏览器限制时首次交互后播放。
3. 结果自动归档到本浏览器历史；首页直接列出姓名和角色。移除手输测试编号与口令的表单，保留后台校验及自动恢复 API。清除网站数据、换浏览器或换域名后无法读取本地历史。
4. 点击答案自动进入下一题，末题自动提交；返回图标支持改选；失败可重试。切题回到页首，多标签页不覆盖其他会话。
5. 结果按稀有度、角色名、免费卡、台词、姓名、左右性格解读、定制引导排列；雷达图缩小，页面与导出卡移除公开编号；姓名编辑提供保存、取消及成功反馈。
6. 百分比仍来自题库模拟，页面信息提示说明并非实时全站统计。现有角色素材缺口和定制占位状态不变。
7. 新增根目录 `PRODUCT.md`、`DESIGN.md`，供后续 impeccable 修改读取。

验证：19 项 Chromium 测试通过，覆盖猫狗全链路、PNG 导出、320/390px 布局、历史与改名、音乐、提交重试及多标签隔离；题库结构、猫狗同构及各 20,000 次模拟检查通过。未验证真实手机和线上部署。三页截图与导出样卡在 `app/shots/`。
