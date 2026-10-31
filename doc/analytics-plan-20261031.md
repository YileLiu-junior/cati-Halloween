# Pets Halloween 埋点与付费验证方案

日期：2026-10-31。检查基线：本地 main，提交 f9aed9d，与本地 origin/main 引用一致。
本方案来自代码检查；没有检查线上部署配置、PostHog 入库或真实交易。本次只新增方案文档，不修改产品逻辑。

## 1. 核心问题与证据边界

核心验证问题：用户看到作品示例、明确价格和交付规则后，是否实际付款，获得并使用由创作者私有 Prompt 驱动的生成结果？

当前产品可以验证宠物头像这一场景，不能直接证明通用创作者市场成立。

| 行为 | 能提供的证据 | 不能直接证明 |
| --- | --- | --- |
| 完成 quiz、点击分享 | 测评吸引力、传播意向 | 生图付费需求 |
| 上传照片并免费生成 | 免费条件下的使用需求 | 可接受价格 |
| 满意、保存头像 | 对已交付作品的认可 | 愿意为下一次生成付款 |
| 问卷填写价格 | 自报意愿 | 实际支付转化 |
| 免费体验后完成打赏 | 自愿支持作者 | 必须先付款才能生成时仍会购买 |
| 看到明确报价后完成生图付款 | 特定价格、场景、渠道下的实际购买 | 其他价格和品类同样成立 |
| 再次付费，或购买另一位创作者服务 | 重复需求、跨创作者消费迹象 | 市场规模和长期留存已成立 |

如果 Prompt 始终只有作者能看，商品应定义为“私有 Prompt 的生成使用权”。“Prompt 源文购买”是另一种商品，会改变可见性和交付规则。素材图、文件、视频属于成品或素材购买，应单独统计。

## 2. 当前项目检查结论

| 代码位置 | 当前行为 | 对方案的影响 |
| --- | --- | --- |
| app/public/js/track.js、app.js | 首页调用 initTrack；SDK 未就绪时 track 静默跳过，没有应用层暂存队列 | 快速操作可能漏记；需要统一初始化和暂存 |
| app/public/js/quiz.js、result.js；quiz.html、result.html | quiz 和结果页有 track 调用，但未发现这些页面初始化 SDK 的路径 | 普通整页跳转后模块状态重置；现有 quiz、结果事件不能视为完整采集 |
| app/public/js/result-media.js | 分享结果打开海报预览；export_ready 只表示海报生成完成 | 补点击、预览、发起保存；不能记为真实社交分享成功 |
| app/public/js/custom.js | 选角色→选照片→上传→免费生成→等待→查看头像→问卷／打赏 | 需要分阶段观察，不能只用“定制按钮点击”衡量生图 |
| app/wrangler.toml | 仓库配置为免费生成开启、支付关闭；默认全站 1000 次、每浏览器 2 次 | 当前默认流程不能直接验证付费生图；线上实际覆盖配置未核验 |
| app/functions/api/config.js | 打赏地址返回原始爱发电地址，不附加站内订单关联参数 | 无法仅靠本站点击知道哪个匿名访客实际打赏 |
| app/functions/api/feedback.js | 每答一题更新 free_feedback；同 attempt 的反馈覆盖保存 | 现有表可做最新回答分布，回答顺序和修改过程需要事件 |
| app/public/js/custom.js、feedback.js | 满意用户走相似度→价格→付费经历；不满意用户走原因→付费经历 | 价格回答存在路径选择偏差；未回答不能按零支付意愿处理 |
| app/functions/lib/generation-config.js | 已按宠物类型和角色选用 Prompt，并保存生成快照和 promptId | 可关联角色与服务质量；需要补不可变版本标识，不能只靠固定 promptId |
| app/functions/lib/generation-jobs.js | 后台有 generation_attempts；同 order 可再次生成 | 应区分用户发起的一轮生成和后台模型调用尝试 |

## 3. 身份、关联和通用字段

优先沿用已有 anonId 作为匿名浏览器标识，并与 PostHog 的匿名身份做明确映射。同浏览器回访保留；不通过 IP、设备特征或宠物姓名猜测同一人。跨浏览器和清除存储后无法可靠识别同一人，报表称“匿名访客”，不称真实人数。未来登录后再通过明确身份关联。

| 字段 | 定义 |
| --- | --- |
| event_id / event_version | 一次事件的唯一 ID／事件结构版本；重传保留原 ID |
| occurred_at / received_at | 行为发生时间／接收时间；服务端业务事实以服务端时间为准 |
| anon_id / user_id | 匿名浏览器 ID／未来登录用户 ID；user_id 当前可空 |
| visit_id / page_view_id | 访问 ID／一次页面展示 ID；visit 默认连续 30 分钟无活动后更新，前后台共用 |
| test_id | 一次 quiz；沿用现有 testId，回看历史结果时取对应条目 |
| generation_request_id | 一次用户主动发起并被接受的生成；新增；自动重试不更新，主动再生成更新 |
| order_id / attempt_id | 现有订单／后台一次模型执行；第一阶段尚无 attempt 时允许空，后续由后台映射 |
| offer_id / checkout_id / transaction_id | 一次报价定义／结账／真实交易；未来付费验证使用 |
| app_version / quiz_version / survey_version | 发布、题库、问卷版本；新版本避免混算 |
| pet_type / quiz_role_id / selected_role_id | 猫狗类型／测评角色／用户实际生图角色；两种角色不能共用一个字段 |
| prompt_id / prompt_version / reference_version / model_version | 私有 Prompt、素材与模型的不可变标识；后台确定 |
| source / medium / campaign / referral_id | 首次来源和本次来源分别保存；只收允许的渠道字段 |
| device_type / browser_family / is_wechat | 设备与浏览器分类；用于识别上传、保存和支付的体验差异 |
| environment / is_internal / is_test | 生产、预览、内部测试和模拟交易隔离 |
| generation_mode / service_available / availability_reason | free／paid；是否可用；维护、额度耗尽等枚举原因 |
| experiment_id / variant | 未来实验分组；非实验为空 |

禁止把完整应用状态整体上传。埋点只传允许字段；不传 Prompt 原文、原始照片、宠物姓名、访问口令、支付凭证、带 token 的图片地址。匿名 ID 不作为授权或支付依据。

## 4. 当前版本事件字典

所有曝光采用同一默认口径：页面在前台，目标区域至少 50% 进入可视区域，连续 1 秒。大区域使用标题或主要按钮作为观察目标。曝光每 page_view_id＋目标＋业务对象只记一次；刷新和回访可产生新曝光，分析时按业务单位去重。

以下事件是设计目标，不表示项目已经实现。前端事件表示可观察交互；服务端事件表示已持久化的业务事实。

### 4.1 进入与 quiz

| 事件 | 触发条件 | 专属字段／说明 |
| --- | --- | --- |
| landing_view | 首页主要内容可见 | 渠道；沿用现有名称，不能由任意页面的统计初始化自动触发 |
| quiz_start_click | 点击开始 quiz | pet_type；用于区分点击后加载失败 |
| quiz_start | 成功创建测评并准备进入答题 | test_id；沿用现有事件语义 |
| quiz_question_view | 本题内容和选项实际可见 | question_id、question_index、question_count、is_resume |
| quiz_answer | 确认一个选项 | question_id、option_id、display_position、active_answer_ms、is_revision；沿用事件名 |
| quiz_submit | 全部答完并发起结果计算 | answered_count |
| quiz_complete | 后端成功保存／返回结果 | quiz_role_id；建议后端作为唯一权威来源，原前端事件迁移或去重 |
| result_view | 测评结果主要内容实际可见 | result_origin=new/history/recovered、card_load_status |
| flow_error | 可识别的失败或阻塞 | stage、error_code、retryable；不上传任意错误全文 |

逐题分析以 test_id＋question_id 为单位，回退重答不增加“答过该题人数”。统计首次曝光到首次作答耗时，同时保留修改次数。quiz_complete 与 result_view 分开，避免把已计算但没看到结果当作已浏览结果。

### 4.2 分享与生图选择

| 事件 | 触发条件 | 专属字段／说明 |
| --- | --- | --- |
| share_entry_view | 分享按钮可见 | content_type=quiz_result/generated_image；当前主要为 quiz_result |
| share_click | 点击分享结果 | content_type；在海报处理之前触发 |
| share_preview_view | 海报加载成功且预览可见 | content_type；现有 export_ready 作为海报生成诊断事件保留，不替代曝光 |
| share_save_click | 点击保存海报 | save_method=download/long_press_instruction；只表示发起保存 |
| generation_entry_view | 定制入口可见 | service_available、availability_reason、已有结果与免费次数状态 |
| generation_entry_click | 点击定制入口 | 当前是否被额度／维护拦截；拦截仍记录点击 |
| generation_step_view | 角色、照片或生成步骤实际可见 | step=role/photo/generate；恢复已有订单时标记 is_restore |
| role_select | 确认用于生图的角色 | selected_role_id、selection_source=quiz_default/manual |
| photo_pick_open | 打开照片选择器 | 当前阶段；切到系统选图器不算离开等待 |
| photo_selected | 用户选定文件 | file_size_band、format；不传文件名 |
| photo_upload_start | 确认上传并发请求 | 图片尺寸档、压缩后大小档 |
| photo_upload_succeeded | 后端存储成功 | 耗时；上传失败通过 flow_error 记录 |
| generation_start_click | 点击免费生成／付费生成 | generation_mode、is_regenerate、remaining_free_count |
| generation_requested | 后端接受新一轮生成并持久化 | generation_request_id；重复返回原订单不重复计新请求 |

不选择生图应拆分：未看到入口、看到但未点击、点击后受阻、进选角后未上传、上传后未生成。它们分别对应触达、意愿、服务可用性和操作摩擦，不能合称“不想要”。

当前网页无法确认用户长按图片后是否保存，也无法确认图片是否发布到社交平台。报表用“分享点击率”“发起保存率”，不用“分享成功率”。未来需要衡量传播时，可在海报加入带 referral_id 的可访问二维码，新增 referral_visit；分享者标识须为不含权限的公开随机标识。

### 4.3 等待、交付与消费

| 事件 | 触发条件 | 专属字段／说明 |
| --- | --- | --- |
| generation_started | 后端开始一次模型调用 | attempt_id、generation_request_id、queue_ms |
| generation_succeeded | 图片存储且订单成功进入可交付状态 | attempt_id、queue_ms、generation_ms、delivery_ms、model_cost_fen；不可只在浏览器轮询看到 ready 时记 |
| generation_failed | 后端确认本次执行失败 | attempt_id、error_code、retryable；request 级是否最终失败另行聚合 |
| generation_uncertain | 后端尚不能确认执行结果 | attempt_id、error_code；与失败分开，后续可转成功 |
| generation_wait_view | 等待区域在前台实际可见 | generation_request_id、order_status |
| generation_wait_checkpoint | 等待可见期间每 15 秒汇总 | wait_segment_id、checkpoint_seq、visible_wait_ms、idle_ms；visible_wait_ms 为该段累计，分析取最大值，不能逐条求和 |
| generation_wait_pause | 等待失去可见性或关闭弹窗 | reason=page_hidden/dialog_closed/navigation、本段累计时间；可漏报，不能依赖此事件判定流失 |
| generation_wait_resume | 回到前台等待或重新打开等待区 | 新 wait_segment_id、距上次可见时长；后台状态已完成时也标记返回 |
| generated_image_view | 图片成功解码，且头像区域实际可见 | attempt_id、generation_request_id、view_origin=continuous_wait/return/history |
| image_save_click | 点击保存生成头像 | attempt_id、save_method；仅表示发起保存 |
| regeneration_click | 点击换照片／换角色／重试 | reason=change_photo/change_role/retry_failure；真正发起新一轮仍看 generation_requested |

“前台可见”等于可测的展示机会，不等于目光一直停在屏幕。页面可见但长时间无交互时保留 idle_ms，不宣称用户一直关注。

后台轮询、弹窗反复渲染、5 秒刷新订单均不产生重复成功事件。模型尝试成功与用户一轮最终交付分开：后台重试可能有多个 attempt，用户层成功率按 generation_request_id 统计。

### 4.4 问卷与打赏

| 事件 | 触发条件 | 专属字段／说明 |
| --- | --- | --- |
| survey_view | 问卷第一题实际可见 | survey_version、attempt_id、branch |
| survey_question_view | 对应题实际可见 | question_id、branch；隐藏的价格题不记曝光 |
| survey_answer_click | 点击一个问卷答案 | question_id、answer_code、is_revision；仅交互意向 |
| survey_answer_saved | 后端成功保存本次变更 | question_id、answer_code、response_revision；不能将整份草稿的其他旧字段重复记作新答案 |
| survey_complete | 当前分支必答项首次全部保存 | attempt_id、branch、survey_version；同对象只计一次完成，最新完整性另查反馈快照 |
| tip_entry_view | 打赏链接实际可见 | displayed_amount_fen、attempt_id、position |
| tip_click | 点击跳转打赏 | tip_checkout_id（具备关联能力后）、displayed_amount_fen；跳转前发送 |
| tip_payment_verified | 后端确认真实打赏交易 | transaction_id、实际金额、currency、attribution_status；当前需要新建关联机制才可可靠归因 |

survey_complete 的满意分支要求满意度、相似度、价格、付费经历；不满意分支要求满意度、原因、付费经历。修改第一题后重新计算当前分支完整性，清掉不适用字段，保留历史修改事件。

打赏需要创建独立站内打赏记录，再通过支付渠道支持的字段关联交易。先核实渠道的订单关联与回调能力，不能假定任意 URL 参数有效。服务端验证收款状态、金额、商品与唯一交易号后，才能发 tip_payment_verified。

若无法可靠关联，仍保留 tip_click，并单列外部后台确认的“未归因打赏笔数／金额”。不按点击时间或同额付款猜测是哪位访客。未归因不等于没打赏，已归因的转化只报告归因覆盖率和可确认部分。

## 5. 六张核心看板及指标口径

默认全部剔除内部、预览、模拟交易和已知机器人。数值同时显示分子、分母、百分比、版本、渠道和观察窗。以下时间为本项目建议的初始口径，不是行业标准。

| 看板 | 指标与分母 | 窗口／业务单位 |
| --- | --- | --- |
| 进入与答题 | 开始率=开始 quiz 的访客／首页曝光访客；完成率=完成 test／开始 test；逐题作答率=答该题 test／看到该题 test；结果到达率=看到结果 test／完成 test | 开始率本次 visit；主 quiz 漏斗同 test、24 小时，另看本次 visit |
| 结果与分享 | 分享点击率=点击分享的 test／分享入口曝光的 test；另报点击分享／结果曝光；预览到达率=预览 test／分享点击 test；发起保存率=保存点击 test／预览 test | 同 test、24 小时；分享和生图为并行分支，不强制串联 |
| 生图意向与阻塞 | 入口点击率=点击入口 test／入口曝光 test；可用入口点击率仅筛 service_available=true；上传成功率=成功上传／上传开始；首次生图率=接受首轮请求 test／可用入口曝光 test；上传后生成率=发起首轮 test／上传成功 test | 同 test、24 小时；同时展示原始口径和排除阻塞的口径 |
| 等待与交付 | 请求成功率=最终成功 request／被接受 request；交付查看率=24h 内图片曝光 request／成功 request；前台等待时长 P50/P90；请求→交付时长 P50/P90；离开后返回查看占比 | 同 generation_request_id；失败和 uncertain 单列；24h、7d 查看结果并列 |
| 问卷 | 开始率=保存至少一题的 attempt／问卷曝光 attempt；完成率=当前分支完整 attempt／问卷曝光 attempt；逐题回答率=该题已保存 attempt／该题曝光 attempt；价格分布仅用价格回答者 | 同 attempt、24 小时；默认每访客首张成功图，补充全部 attempt 视图 |
| 打赏与真实付费 | 打赏点击率=点击访客／打赏曝光访客；已归因打赏率=确认打赏访客／打赏曝光访客；未来付费率=实际付款访客／真实报价曝光访客；支付完成率=付款 checkout／创建 checkout | 同 offer/checkout；主窗口 7 天，24h 辅助；打赏和生图购买分开 |

每题“未作答”只说明没有观察到后续行为，不能证明题目本身导致流失。结合加载失败、作答耗时、题目版本、来源与回访观察。

流失按窗口结束后推导，不依赖浏览器 exit 事件。未满 24h／7d 的批次标记“观察中”，不纳入最终转化比较。PostHog 普通用户漏斗还须限制同 test／request／offer；若不能保持同一属性，使用关联查询，防止把一次测评的入口和另一测评的结果拼接。

等待用户按首次离开与首次看到结果的顺序划分互斥组：

1. **持续前台看到结果**：首次看到头像前未发生可观察的隐藏／关闭；并列心跳覆盖率，只称“观察到的前台等待”。
2. **离开后返回看到结果**：先隐藏、关闭或导航，随后在窗口内查看同一轮结果。
3. **已成功但未观察到查看**：后台成功，窗口到期仍无头像曝光；不等于确定没有看过。
4. **失败、结果不确定或仍在处理**：单列服务问题，不归为用户放弃。

等待段心跳取每段最大 visible_wait_ms 后求和。报告 15／30／60／120 秒时仍处于等待且前台可见的占比时，只纳入到该时间仍未交付的请求，并展示该时间点风险集数量。不能把提前成功出图计作停止等待。

## 6. 如何回答“哪些用户愿意打赏”

当前优先按以下维度比较已归因打赏者、点击但无已确认交易者、看到入口未点击者。无法关联的打赏单独列出。

- 渠道：首次来源、本次来源、活动批次。
- 使用：猫／狗、实际选用角色、首张／再生成、是否改过默认角色。
- 体验：等待时长、是否曾失败、持续等待／返回查看、是否点击保存。
- 质量反馈：很喜欢／还行／不满意；相似度；未回答单列。
- 商业反馈：自报价格区间、已有付费经历；未曝光与曝光未答分开。
- 环境：微信内浏览器／其他、手机／电脑。

主表每组显示入口曝光 UV、打赏点击 UV、确认打赏 UV、实收金额、归因覆盖率。首张体验按匿名访客去重，不能让生成两次的人贡献两份“用户”。

描述“等待较短的用户打赏更多”只能是相关性。要判断缩短等待是否提高付款，需要控制版本和来源，或另做有明确分组的实验。

## 7. 问卷的最小调整

先保留现有短问卷，并给每题增加曝光和保存事件。报表明确价格题只覆盖满意分支。不要把缺失价格填成 0 元，也不要用满意分支的价格分布代表全体访客。

若要比较所有已体验用户的商业意愿，可在两个分支末尾展示同一题，更新前后端校验和 survey_version：

“如果下次生成一张新头像需要付款，你会怎么选？”

选择：愿意按展示价格购买／结果改善后再考虑／只接受免费／目前没需要。价格必须绑定具体报价，不能让“愿意”脱离金额。

现有“花过／没花过但愿意试试／没花过也不感兴趣”同时混合经历与未来意愿。若需要严格分析，下一版拆成“是否付过同类服务”和“是否购买本次报价”，避免把后两项当纯历史消费标签。

问卷保持自愿，不影响保存作品。新增题也只提供解释性证据；真实购买测试仍是主要依据。

## 8. 真正验证生图付费的下一步

### 8.1 优先做“免费体验后的第二次付费生成”

当前免费用户可生成两次，不能直接收回已展示或承诺的免费次数。对后续新增活动批次明确说明免费与收费规则，或提供不占原免费权益的新付费商品。

向已体验用户展示真实可交付的报价：具体风格、创作者、示例、一次价格、交付内容、失败处理。购买的是生成使用权，Prompt 原文不交付。问卷、保存和打赏均不作为看到付费报价的前置条件。

| 新增事件 | 条件 |
| --- | --- |
| generation_offer_view | 实际看到明确价格、作品示例和交付规则；服务可下单 |
| generation_offer_click | 点击购买生成服务 |
| checkout_created | 后台持久化结账，固定 offer、金额、商品和权益 |
| payment_redirect | 前端发起外部支付跳转 |
| payment_verified | 服务端验证真实付款；唯一 transaction_id 去重；purchase_type=generation_use |
| payment_failed | 支付渠道可确认的失败；用户没回来不当作支付失败 |
| refund_verified | 后台确认退款；记录全额／部分金额和原因 |
| paid_generation_delivered | 付费权益对应结果已可交付；关联 request 与 transaction |
| creator_settlement_recorded | 未来市场结算入账／打款确认；与用户付款区分 |

报价曝光必须记录 offer_id、价格分、币种、权益数量、活动批次、创作者、Prompt 版本、示例素材版本和免费剩余次数。后台固定报价，不能采信浏览器上报金额。

核心指标：报价曝光→真实付款的 UV 转化率；付款→成功交付率；退款率；7／30 天再次真实付款率。复购窗口只统计已满观察期的首购用户。未登录阶段名称为“同浏览器复购率”，明确可能漏计跨设备复购。

这一步验证“体验后增购”。它不能替代“第一次使用前付费”的验证。后续单独对新客测试示例→报价→付款→生成，报表区分 purchase_context=first_use/repeat_after_free。

### 8.2 价格实验规则

先用一个明确价格验证完整付款、交付、退款与关联链路，再根据流量决定是否分组。没有样本量信息时，不预设“达到某转化率市场就成立”。

若比较多个价格，除价格外保持交付、示例、渠道和时间尽量一致。随机按稳定访客分组，价格在报价和结账中固定；记录 experiment_id／variant。单纯先低价后高价会混入时间、渠道和节日效应，不能称为严格价格 A/B 实验。

事先确定最低值得继续做的转化率、最小可识别差异、样本量和观察期。结果展示实际付款人数、分母及区间估计；不凭少数几笔付款宣布平台需求成立。宠物万圣节属于季节性场景，后续用非节日场景复验。

### 8.3 收益口径

用户支付总额是交易额，不是平台服务收入。分别保存 gross_paid_fen、refund_fen、creator_payable_fen、platform_fee_fen、payment_fee_fen、model_cost_fen，以及 fee_payer=buyer/creator。

平台单笔贡献可按以下业务口径核算：实收减退款，再减创作者应结金额、支付渠道成本、平台承担的模型与交付变动成本。该口径不是会计净利润；费用包含关系需固定，避免重复扣除。

免费单和失败／重试也有成本。既看每付费订单贡献，也看整个获客批次的总贡献；否则可能忽视免费体验成本。打赏收入与生成服务收入分列。

## 9. 为未来创作者平台预留

当前不必先建完整市场，但从第一笔付费开始固定商品类型：

| purchase_type | 用户获得什么 | 核心后续行为 |
| --- | --- | --- |
| generation_use | 私有 Prompt 的一次／多次生成权益 | 使用权益、交付查看、再次付费 |
| asset | 素材图、文件、视频等固定内容及约定使用权 | 获取交付、下载发起、再次购买 |
| tip | 对作者的自愿打赏 | 确认付款；不混入商品购买转化 |

共用 creator_id、listing_id、listing_version、offer_id、purchase_type、price_fen、currency。生成商品补 prompt_id／prompt_version；素材商品补 asset_id／asset_version／asset_type／license_id。Prompt 版本只用无内容的标识，不上传源文。

市场事件逐步增加 listing_view、sample_view、creator_profile_view、asset_delivery_ready、asset_download_click。浏览器下载点击不等于文件已完整保存；服务端请求成功也不等于用户实际使用了素材。

平台价值还需分别验证：创作者是否愿意上架和持续更新；买家是否购买不同创作者的商品；创作者是否获得可持续收益。当前单一自营宠物头像数据只验证需求的一部分。

## 10. 实施安排与验收

### 第一阶段：修复统计基础，覆盖当前流程

1. 在首页、quiz、结果页统一初始化统计，初始化本身不记首页曝光；沿用一个匿名身份，SDK 就绪前暂存并有界重传。
2. 补齐入口、题目、分享、生图步骤、上传、等待、头像曝光、问卷和打赏点击事件。
3. 复用现有订单、generation_attempts、free_feedback；新增 generation_request_id 关联用户一轮生成，持久化匿名身份与订单映射。
4. 服务端持久化成功后再发业务事件。使用唯一业务键和持久化待发送记录处理重试，避免交易已发生但事件丢失。
5. 建六张看板，验证分母、窗口、版本和匿名访客去重。PostHog 延续现有接入，不新增第二套产品分析平台。

### 第二阶段：补打赏归因与真实付费测试

1. 核实爱发电打赏是否支持可靠关联；能支持再接 tip_checkout，不能支持就保留未归因交易类别。
2. 另建或复用可区分商品类型的付费结账链路，固定报价和权益；不能直接把打赏付款当成生图购买。
3. 用真实交付的新活动批次验证付费，联查支付、生成、退款和成本，再考虑价格分组。

### 最小验收清单

- 首页→quiz→结果逐页跳转后仍使用同一匿名身份；慢网和快速点击不丢第一批事件。
- 题目回退、重复答题、刷新恢复，不重复增加 test 数。
- quiz 结果保存成功但结果页未显示时，有 quiz_complete，没有 result_view。
- 分享按钮点击后海报生成失败时，有 share_click 和错误，没有 share_preview_view。
- 额度耗尽、维护、浏览器次数限制有明确阻塞原因，不被计入“可用但未使用”。
- 选图取消、上传失败、上传成功未点击生成能区分。
- 连续轮询、页面恢复、订单幂等返回不重复增加 request 或交付数。
- 前台等待、隐藏后返回、关闭弹窗后返回、服务失败、结果不确定均能正确分类。
- 图片请求成功但解码／展示失败，不发 generated_image_view；浏览历史只记回看。
- 问卷改满意度后清理旧分支；点击未保存不算已回答；保存重试不重复计数。
- 当前价格题未曝光者的价格值为缺失，不能填“不会付费”。
- 打赏只有点击无交易确认时，不产生 tip_payment_verified。
- 支付回调重试、主动查单、内部测试、重复付款和退款不重复计算真实购买。
- 每笔已确认交易可查到唯一交易号和金额；业务数据库与统计平台核对差异。
- 抽查事件载荷，确认没有 Prompt 原文、照片、token、支付凭证或任意应用状态。

等待状态变化可结合 visibilitychange 和小批量 Beacon／keepalive 上报；发送排队成功不等于服务端接收成功。窗口流失仍从已收到事件与业务事实推导，不能保证浏览器关闭事件必达。

## 11. 资料与实现依据

- 当前仓库：app/public/js/track.js、app.js、quiz.js、result.js、result-media.js、custom.js、store.js。
- 当前后端：app/functions/api/config.js、free-orders.js、feedback.js；app/functions/lib/generation-config.js、generation-jobs.js、payment.js；app/migrations/0005_free_generation.sql、0006_feedback_survey.sql。
- PostHog 漏斗官方文档：https://posthog.com/docs/product-analytics/funnels 。用于核对漏斗、转化窗口和分组能力；本方案具体窗口是产品建议。
- MDN sendBeacon：https://developer.mozilla.org/en-US/docs/Web/API/Navigator/sendBeacon 。用于核对页面切换时的小批量上报及排队返回值边界。
