# 云端隔离测试验收：2026-10-30

## 结论

后台交付链路本轮通过，狗狗身份保留未通过。正式站点保持原部署，暂不发布新版。

测试网址：https://peti-avatar-preview.pages.dev

该网址属于独立的测试 Pages 项目。关闭真实付款与爱发电扫描，通知只记录在测试数据库，不向真实用户发送。模型调用需要管理员及测试环境开关，同时只有一个真实生成订单名额。

## 隔离资源

| 类型 | 测试资源 |
| --- | --- |
| Pages 项目 | peti-avatar-preview |
| 后台 Worker | peti-avatar-preview-worker |
| D1 | peti-avatar-preview-orders，edba2d88-79dc-4700-a7a9-4d8e00e128e4 |
| KV | 2e1de97ed02a4ca197bb7126ae7c7570 |
| R2 | peti-avatar-preview-images |
| 正常队列 | peti-avatar-preview-delivery |
| 异常队列 | peti-avatar-preview-dlq |

两队列按当前免费套餐设置消息保留24小时。旧版 Wrangler 默认4天，首次创建遭平台校验拒绝；修改为86400秒后成功，未升级套餐。测试图片桶只对 photos/ 和 jobs/ 设置七天清理，参考图不应用该规则。

配置为 app/preview-wrangler.toml 与 app/preview-delivery-wrangler.toml。当前 Wrangler 3.114.17 的 Pages deploy 不支持 --config，所以发布时把测试配置、public/functions/migrations 复制到忽略目录 .wrangler/preview-project，再从该目录部署，明确指定 peti-avatar-preview 项目。不得使用正式项目配置代替。

## 实际生图记录

- 测试订单：7e32a662-8b0e-4aa1-82c7-7d8cf165e9ed。
- 宠物/角色：dog/pirate。
- 参考图：references/20261030-v2/dog/pirate.png，已核对数据库快照。
- 原图：用户此前指定的棕色垂耳犬测试照片。使用已有的512×640预处理JPEG，网页重新编码后上传。
- 在模拟付款确认之前关闭浏览器，之后没有浏览器负责启动或维持生成。
- 模拟付款确认后，后台自动生成并保存成品，状态 ready。
- 生成阶段约103.4秒；确认到可领取约104.7秒。
- Seedream响应HTTP200，供应商请求编号已保存在 generation_attempts。
- 全部测试订单的 generation_attempts 总数为1，无额外模型调用。
- 成品2048×2048，5449564字节，约5.2MiB。
- 后台队列日志：outcome=ok，CPU190ms，wallTime104308ms，exceptions=[]。本轮未复现资源超限。
- 未提供凭证的成品请求返回401。重复查询及重复提交生图请求没有增加生成次数。
- 原正式首页在本轮前后的SHA256均为313b5ba6e499bab3a77f8e8de8a0428a5ddfa8df9b209d8f72b74cb103d8c2a3。

这说明新的后台任务在当前账户上成功跑通了一次。它不证明旧订单的CPU/内存具体根因已经查清，也不保证所有图片请求都不会超限。

## 领取与模拟售后

1. 从捕获的专属通知链接进入全新浏览器，无需原测评存储即可查看及下载成品。
2. 生成完成通知保存在测试记录中，状态 test_captured，没有发到爱发电。
3. 真实生成的测试订单提交图片问题申请，走过待审核、待补充、重新提交及结束申请，之后成品恢复领取。
4. 另建模拟失败案例84d22367-aebd-49c3-9217-692f35d63500，不启动模型，走过退款申请、批准、处理中和完成登记。
5. 模拟退款完成后，原付款退款标记为1；该案例没有真实收款和资金退回。

两类页面均显示“独立测试环境·无真实收款或退款”。原先那笔爱发电实付1.80元的订单不在此测试数据库，仍由用户自行联系Lain处理。

## 未通过：狗狗身份保留

从云端读回的上传原图仍为棕色垂耳犬，订单关联和狗海盗参考图路径正确。成品却继承了参考图的橙白毛色，保留了参考图的尖耳，另外又生成垂耳；虹膜颜色及表面材质也未充分遵守原图/Prompt。

所以本轮不能认定头像质量合格。没有为此自动再发收费生成，也没有修改用户已确认的Prompt。下一步应针对身份与服装参考互相干扰的问题修正并另行验证。

## 证据

以下位于忽略目录，不提交包含访问凭证的文件：

- .wrangler/preview-live-report.json：真实生成、保护检查和正式首页校验。
- .wrangler/preview-worker-tail.json：本轮后台日志。
- .wrangler/preview-refund-report.json：模拟售后最终状态。
- .wrangler/preview-ready-mobile.png、preview-refund-complete.png：云端页面截图。
- .wrangler/preview-dog-pirate.png：本轮成品。
- .wrangler/preview-uploaded-source.jpg：从云端读回的实际上传原图。
- .wrangler/preview-delivery-link.txt：本次专属领取链接，勿提交至代码仓库。

真实爱发电付款回传、custom_order_id实际保留及平台私信外链体验仍未验收。本轮付款与平台消息使用模拟。
