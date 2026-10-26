# UI/UX 分析报告：PETI 问答模块（万圣节活动）

**被分析文档**：`E:\Programs\Pets-Halloween\doc\PRD-quiz.md`
**文档状态**：定稿 v1.2（2026-10-27）
**素材清单裁决标注**：**已裁决**。功能集来源 = PRD-quiz.md 定稿 v1.2，经两轮 dev-review 修订（doc/reviews/PRD-quiz-dev-review-20261026.md：9 MODIFY/7 KEEP/2 OPEN；PRD-quiz-dev-review-20261027.md：7 MODIFY/2 OPEN，均「已修订」入文，已核实 v1.2 含 session 记录 §7.5、找回统一文案 §4.5、publicId 直写 §7.5、recover 接口 §7.7 等裁决落点）。素材清单只覆盖裁决后保留的功能集；支付生图链路（PRD-payment-generation.md，仍 draft）不入清单。

**前置声明（优先级口径）**：PRD 全文无 P0/P1/P2 标注（已通读核实）。本报告不自创分级，按「定稿功能集 = 上线范围」将范围内交互全量按六要素展开；素材优先级列沿用 PRD 自身仅有的两处优先级表述（头图「占位、后续更换」PRD-quiz.md:22、:120；16 张立绘「上线前待办」PRD-quiz.md:91）加 coordinator 给定的「demo 可开工 / 上线前必备」两层框架。正式 P0/P1/P2 分级列为开放问题 Q1。

---

## 一、交互清单

### 落地页

**1. 到达落地页**
- 触发：小红书笔记/搜索口令「喵灵万圣节」进入（系统事件：页面加载）（PRD-quiz.md:57-59）
- 对象：落地页整页
- 反馈：渲染头图 `page头图.png`（PRD-quiz.md:75）；记录渠道（interaction-design.md:36）；上报 landing_view（PRD-quiz.md:114）
- 状态：normal；loading＝「正在加载…」并禁用提交；error＝「加载失败，请重试」（PRD-quiz.md:79）
- 边界：弱网/资源加载失败落 §4.1 通用文案；渠道参数缺失时的行为未写（未核实）

**2. 选宠物类型（猫咪/狗狗）→ 开始测试**
- 触发：点击双入口（PRD-quiz.md:41、:59-64；quiz-design-dog.md:18）
- 对象：落地页入口控件（一次点击还是「先选宠物再点开始」两步，UI 形态未写，见 Q5）
- 反馈：调 POST /api/sessions（入参 source、quizVersion、petType，PRD-quiz.md:104）→ 加载对应题库 JSON → 进答题页；quiz_start 埋点（interaction-design.md:148-149）
- 状态：入口 normal/pressed；请求期间禁用；quizVersion 取 cat-2026v1/dog-2026v1 须与 petType 匹配（PRD-quiz.md:104、:135）
- 边界：限流 RATE_LIMITED、SERVER_ERROR（PRD-quiz.md:106）在落地页的展示形态未写；sessions 不幂等、每次进入新建会话（PRD-quiz.md:104），连点防抖未写（见 Q5）

**3. 点「继续上次」**
- 触发：点击（interaction-design.md:36）
- 对象：落地页按钮
- 反馈：从 localStorage 恢复进度（interaction-design.md:72）→ 回答题页续答；流程图只画「继续上次/找回结果 → 结果页」（PRD-quiz.md:69-70），答到一半的会话恢复去向未画（见 Q4）
- 状态：localStorage 有/无记录时按钮显隐逻辑未写
- 边界：quizVersion 升版后旧会话答案不跨版本解释（PRD-quiz.md:96），旧会话恢复行为未写（Q4）

**4. 找回结果**
- 触发：点击「找回结果」→ 输入 → 提交
- 对象：找回入口（UI 形态未写：落地页内嵌输入区或弹层，见 Q3；interaction-design.md:72 仅说「首页可粘贴口令」）
- 反馈：POST /api/recover（入参 token、testId，PRD-quiz.md:110）→ 成功跳结果页；失败统一提示「口令无效或已超过保留期」、保留输入、回落地页、不泄露结果是否存在（PRD-quiz.md:83、:131）
- 状态：输入 normal；提交 loading（重复提交禁用未写）；失败 error
- 边界：空输入行为未写；错误口令与超 30 天同文案（裁决后口径，PRD-quiz.md:83）；换浏览器时 testId 从何而来未写（Q3）

### 答题页 ×10

**5. 查看/切换题目**
- 触发：进入、点上一题/下一题、刷新后恢复
- 对象：题干、进度、四选项
- 反馈：渲染题目与进度；进度形态（文字/进度条）未写（待定）；恢复时选项顺序与会话首次渲染一致（PRD-quiz.md:47-48、:126）
- 状态：题目 normal；localStorage 每答一题保存（PRD-quiz.md:51）；恢复失败（结果丢失）回首页（PRD-quiz.md:76）
- 边界：刷新、关页重进均从 localStorage 续答（PRD-quiz.md:80）

**6. 点选选项**
- 触发：点击单选项（每题 4 个，随机排序后展示、会话内顺序不变，PRD-quiz.md:47-48）
- 对象：选项
- 反馈：选中态高亮（CSS 可实现）；quiz_answer 埋点（questionId、optionId，interaction-design.md:149）
- 状态：选项 normal/selected；选中后能否改选未写（见 Q6）
- 边界：快速连点行为未写

**7. 点「下一题」**
- 触发：点击
- 对象：下一题按钮
- 反馈：切下一题
- 状态：未选答案 disabled（PRD-quiz.md:50）；末题按钮文字变「揭晓身份」（PRD-quiz.md:50、:129）
- 边界：重复点击（幂等在提交侧兜底，PRD-quiz.md:105）

**8. 点「上一题」**
- 触发：点击
- 对象：上一题按钮
- 反馈：回上一题，保留该题已选答案与原选项顺序（PRD-quiz.md:48）
- 状态：首题时按钮隐藏还是禁用，未写（Q6）
- 边界：无新增

**9. 末题点「揭晓身份」（提交计分）**
- 触发：点击
- 对象：提交按钮
- 反馈：POST /api/results（PRD-quiz.md:105）→ 加载反馈（PRD-quiz.md:53）→ 跳结果页；quiz_complete 埋点（interaction-design.md:151）
- 状态：按钮 loading 禁用；双击/超时重试幂等返回原结果原 publicId（PRD-quiz.md:105、:130）
- 边界：SERVER_ERROR、TOKEN_INVALID 页面表现未细化，落 §4.1 通用文案；入参含 petName（PRD-quiz.md:105）但流程无命名步骤——时序矛盾，见 Q2（重要）

### 结果页

**10. 查看结果**
- 触发：提交成功/找回成功/继续上次
- 对象：角色立绘、称号、六边形雷达图、3 短句、金句、宠物名、公开 ID（PRD-quiz.md:87）＋稀有度「全站仅 X% 的毛孩子是这个角色」（PRD-quiz.md:90；X 取 quiz-design.md §7 占比；狗版用「毛孩子」，PRD-quiz.md:133）
- 反馈：result_view 埋点（interaction-design.md:151）；雷达图为代码绘制（quiz-design.md:58），无需图
- 状态：normal/loading/error（PRD-quiz.md:79）；空态＝结果丢失回「找回结果」（PRD-quiz.md:77）
- 边界：demo 期立绘来源未写（Q10）

**11. 改宠物名**
- 触发：输入（编辑）
- 对象：宠物名
- 反馈：只触发前端重绘、不调接口（PRD-quiz.md:88）
- 状态：默认名「我家猫/我家狗」（PRD-quiz.md:88）；限 1–12 字、Unicode 码点前后端同口径（PRD-quiz.md:88、:106）
- 边界：超 12 字前端行为（截断/报错）未写；改名后与服务端所存 petName 不一致、找回显示哪个未写（Q2）

**12. 保存免费简版卡**
- 触发：点击「保存免费卡」
- 对象：canvas 导出 PNG（PRD-quiz.md:91）
- 反馈：导出成功提示；微信「长按图片→保存到相册」、普通浏览器「点击保存；若未下载，请长按图片保存」（interaction-design.md:139）；export_ready 埋点（interaction-design.md:157）
- 状态：按钮 normal/loading；导出内容＝立绘＋角色名＋宠物名＋公开 ID＋金句＋搜索口令「喵灵万圣节」（PRD-quiz.md:91、:132）
- 边界：渲染失败只重绘、保存失败展示 PNG（interaction-design.md:137）；卡面中文全部前端 canvas 绘制（quiz-design.md:244）；卡片模板比例未定（Q11）；导出内容未含 AI 生成标识，与上游要求不一致（Q12）

**13. 点「再测一只」**
- 触发：点击
- 对象：再测按钮
- 反馈：新建 testId、回答题页（PRD-quiz.md:89）；不覆盖旧结果与旧订单（PRD-quiz.md:89）
- 状态：—
- 边界：RATE_LIMITED（PRD-quiz.md:106）；旧结果再查看路径（localStorage 多 testId 管理）未写（Q9）

**14. 点「定制」**
- 触发：点击
- 对象：付费入口（PRD-quiz.md:68）
- 反馈：进支付生图链路——本次范围外（PRD-payment-generation.md 仍 draft）
- 状态：免费模块先行上线时该按钮是否展示、点了给什么反馈，未写（Q8）

### 跨页面通用

**15. 加载态与出错态**
- 触发：接口等待/失败（系统）
- 反馈：「正在加载…」＋禁用提交；「加载失败，请重试」＋保留已输入内容（PRD-quiz.md:79）
- 状态：loading/error 全局统一；retryable 字段（PRD-quiz.md:106）与重试按钮交互的对应未细化
- 边界：错误码五枚（TOKEN_INVALID、PARAM_MISSING、PET_NAME_TOO_LONG、RATE_LIMITED、SERVER_ERROR，PRD-quiz.md:106）逐码的页面落点未逐一映射

**P1/P2 模块汇总**：PRD 未做 P0/P1/P2 分级，定稿功能集内不存在低优先级模块；埋点、洗牌、localStorage 保存为系统行为，无独立交互面。

---

## 二、素材清单

推导结论先行：逐页问「哪一步没有一张图就不成立」，定稿功能集内**硬图依赖只有两处——落地页头图、角色立绘**。其余（雷达图、选项态、按钮态、进度、加载/出错态、卡面全部文字、背景渐变）均可原生/CSS/canvas 代码实现，停在素材最小化阶梯第 1–2 级。

| 编号 | 名称 | 用在哪 | 状态/内容 | 尺寸/格式 | 来源 | 优先级 |
|---|---|---|---|---|---|---|
| M1 | page_hero_default（落地页_头图_默认） | 落地页首屏（PRD-quiz.md:75、:120） | normal；剪纸叠层万圣节海报，建议含猫+狗双形象呼应双入口、中文品牌「喵灵万圣节」；现占位图内烘焙英文「HALLOWEEN PARTY」与日期「10·02」，换图须去除 | 现占位 1072×1467 PNG（RGB）；设计尺寸@倍率待定（展示区设计宽文档未写；推算：若按 750 设计宽@2x 需约 1500px 宽源图，占位图清晰度不足，供换图参考，未核实） | 已有占位 `E:\Programs\Pets-Halloween\page头图.png`；上线前全新出图替换（PRD-quiz.md:22、:120 已声明） | 占位可开工；上线前替换（PRD §9.1） |
| M2 | result_char_{roleId}_normal（结果页_立绘_正常，共 16 张） | 结果页立绘展示（PRD-quiz.md:87）＋免费卡导出立绘（PRD-quiz.md:91），一图两用不出两张 | normal；各角色 Q 版黏土造型（prompt 见 quiz-design.md §6）；透明背景 RGBA，叠于 #2B2020→#010000 渐变上；统一画幅（现 free-pic 三张 1254×1254/1227×1282/1230×1278 不一致，出图规范待定）；不切多尺寸，倍率适配交前端 | 生图建议 3:4 或 1:1（quiz-design.md:245）；设计尺寸@倍率待定；PNG 透明底 | 已有 3 张复用（`free-pic/女仆咪-免费.png`、`狼人咪-免费.png`、`僵尸咪-免费.png`）；1 张需改造归位（`ref-pic/木乃伊咪-ref-prompt/木乃伊咪-免费.png` → free-pic/）；12 张全新出图 | demo 可开工（M3 占位）；16 张上线前必备（PRD-quiz.md:91） |
| M3 | card_free_illust_placeholder（免费卡_立绘_占位） | 免费卡 canvas 导出 demo 期用（PRD-quiz.md:91）；demo 期结果页若同用需作者确认（Q10） | normal；猫版女仆咪形象全角色共用（狗版同用，PRD-quiz.md:23）；「角色示意」四字由前端 canvas 叠加（图内现无此字）；注意：实为整卡 showcase 图非透明立绘，见发现 F1 | 1086×1448 PNG（RGB 无 alpha） | 已有 `E:\Programs\Pets-Halloween\card-free.png`（与 halloween-cat-showcase-card-3x4.png 字节数相同，同文件复制） | demo 必备（现成可用）；上线前被 M2 替换 |
| M4 | quiz_bg_noise（答题页_背景_噪点纹理） | 答题区/结果页背景（PRD-quiz.md:121） | normal；渐变部分代码实现（#2B2020→#010000）；噪点纹理优先 CSS/SVG 代码生成，效果不达标再出贴图 | 若出图：待定 | 无需图（代码实现）——阶梯第 2 级 | 上线必备（代码达成则零素材） |

**无需图（代码实现）**：六边形雷达图（canvas/SVG，quiz-design.md:58）；选项 normal/selected/disabled 与按钮态（CSS，装饰色 PRD-quiz.md:122）；进度指示（形态待定）；加载/出错态文案与禁用（PRD-quiz.md:79）；免费卡文字层（角色名后缀、宠物名、公开 ID、金句、「喵灵万圣节」、「角色示意」，quiz-design.md:244）；猫/狗入口图标可用 emoji 🐱🐶（quiz-design-dog.md:18），出图为可选项（待定）。

**不进清单**：音效、震动按职责不安排（音频交付暂不安排）。

---

## 三、素材差口（已有 vs 所需对账）

**最高优先级发现（方案描述与素材事实不符）**：

- **F1：`card-free.png` 的真实形态与 PRD 描述不符。** PRD-quiz.md:23 称其为「免费简版卡立绘占位图」，实际（已目视核实）是**整张成品 showcase 卡**：含烘焙背景（紫夜空、糖果骷髅纹样、墓地剪影）与右下角英文艺术字「Happy Halloween」，RGB 无透明通道，且图内**没有**「角色示意」四字。两个直接后果：(a) canvas 导出若把它当「立绘」贴入再叠卡面文字，会与图内已有背景/文字重复穿帮；(b) 验收 §10.7 要求导出卡「含占位立绘（标『角色示意』）」（PRD-quiz.md:132），该标注只能由前端 canvas 叠字实现——可行（quiz-design.md:244 文字层归前端），但 PRD 未写明。开发前需作者明确：demo 期免费卡是「整卡直出」还是「占位立绘＋canvas 重建卡面」。
- **F2：头图内烘焙了具体日期「10·02」与英文标题**，活动窗口为 10/31 万圣节（interaction-design.md:3），品牌口令为中文「喵灵万圣节」——占位图信息与活动事实冲突，已声明占位（PRD-quiz.md:22）故不算错误，但换图前若提前上线会露出错误日期。

**对账结果**：

| 类别 | 项目 |
|---|---|
| 可直接复用 | `page头图.png`（占位）、`card-free.png`（占位）、free-pic 3 张已定稿立绘（尺寸已核实，均 RGBA 透明底） |
| 需改造 | 木乃伊咪-免费.png 从 `ref-pic/木乃伊咪-ref-prompt/` 归位 `free-pic/`；card-free.png 使用口径按 F1 澄清 |
| 完全缺失（按上线阻塞排序） | ① 12 张猫版生产立绘——不阻塞 demo 开工，阻塞「去除角色示意占位」的正式上线；② 上线版头图——不阻塞开发，阻塞上线形象；③ 出图规范（统一画幅、设计尺寸@倍率、命名落位）文档未定，待定；④ 狗版立绘需求待裁决（Q7，PRD-quiz.md:23 已声明狗版共用猫版占位，PROJECT-STATUS.md 将狗版 16 张归付费链路，两处口径未对齐） |

以上缺失均不阻塞 demo 开工；12 张立绘是「正式上线」口径下的唯一硬阻塞素材。

---

## 四、交互问题（开放问题，编号问回作者）

- **Q1**：PRD 无 P0/P1/P2 标注。本报告按定稿功能集全量展开，正式分级请作者补（影响素材清单优先级列的最终口径）。
- **Q2（最重要）**：petName 时序不自洽。POST /api/results 入参含 petName（PRD-quiz.md:105），但流程图（:57-71）无命名步骤；改名只发生在结果页且「只触发重绘」不调接口（:88）。提交时名字从哪来（默认名直传？提交前有命名步骤？）；PET_NAME_TOO_LONG（:106）在「改名不调接口」设定下只可能由 results 触发，闭环矛盾；改名后服务端存旧名，找回显示哪个名未写。
- **Q3**：找回入口 UI 形态未定——输入框在落地页内嵌还是弹层；需输入哪些字段（token、testId 两个都要手输？换浏览器后 testId 用户从哪获取——interaction-design.md:72 只提口令）；「保留输入并回落地页」（PRD-quiz.md:83）在弹层形态下如何解释。
- **Q4**：「继续上次」无 localStorage 记录时的显隐；答题中断恢复去答题页还是结果页（流程图 :69-70 只画到结果页）；quizVersion 升版（:96）后旧会话恢复行为。
- **Q5**：「开始测试」与选宠物的先后层级（interaction-design.md:36 三按钮 vs quiz-design-dog.md:18 双入口，一步还是两步）；sessions 不幂等（PRD-quiz.md:104），入口按钮防重复点击未写。
- **Q6**：选项选中后能否改选未写；「上一题」在首题的形态（隐藏/禁用）未写。
- **Q7**：狗版素材口径——狗版免费卡/结果页上线是否需要 16 张汪版生产立绘，还是长期共用猫版形象（PRD-quiz.md:23、:91 与 PROJECT-STATUS.md 未对齐）。
- **Q8**：结果页「定制」入口在付费链路（PRD-payment-generation.md 仍 draft）上线前的形态：隐藏还是展示占位引导。
- **Q9**：「再测一只」后旧结果再查看路径（localStorage 多 testId 如何管理、落地页「继续上次」指向哪个会话）未写。
- **Q10**：结果页立绘（PRD-quiz.md:87）demo 期来源未写——§5.5 只规定了免费卡用占位；结果页是同用 card-free.png、优先用 free-pic 已定稿角色、还是别的，未定。
- **Q11**：免费卡「比例跟随最终卡片模板」（interaction-design.md:128）——模板比例/尺寸未定，canvas 画布尺寸待定。
- **Q12**：导出内容清单（PRD-quiz.md:91、:132）未含 AI 生成标识，而上游 interaction-design.md:133 要求「免费立绘若由 AI 生成也标明」；16 张生产立绘全部 AI 生成，上线前导出内容需补此项并纳入验收。
- **Q13（观察项，不阻塞）**：女仆咪立绘（free-pic/女仆咪-免费.png 及 card-free.png 同形象）含围裙血渍泼溅与嘴角血滴元素，与 quiz-design.md:220「绝不恐怖、无血腥恐怖元素」的生成基线相容性——美术线已定稿，是否已有意接受，未核实，仅提示。
- **Q14（观察项）**：落地页除头图外的视觉（背景、按钮样式、双入口控件样式）PRD §9 未规定，视觉稿缺口。

---

## 五、末行

定稿功能集里最容易被低估的一件事：**`card-free.png` 不是立绘而是整张烘焙卡（发现 F1）**——「保存免费简版卡」是定稿功能的收口动作，开发第一天写 canvas 导出就会撞上「占位图当立绘贴进去会穿帮、『角色示意』字样还得前端自己叠」的口径问题，这比缺 12 张立绘更早返工。
