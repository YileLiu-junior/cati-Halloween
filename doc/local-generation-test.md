# 单独测试真实图片生成链路

此入口只在本机执行，跳过网站、订单和支付。它复用正式代码中的提示词、角色映射、模型请求和 PNG 头部校验，直接保存模型出图结果，不做图层拆分或透明处理。它不会把线上订单改成已付款。

## 准备

1. 使用 Node.js 22.16 或更新版本。本机已安装 22.16。
2. 准备一张真正的 JPEG 宠物照片，短边至少 512px、长边最多 1600px、体积最多 2MiB。PNG 不能只改扩展名。
3. 真实调用前，在 `app/.dev.vars` 设置 `ARK_API_KEY`。已有有效配置时不必改写文件。也可使用同名环境变量；环境变量优先。

密钥不要放进命令参数，不要发送到聊天中。这个测试不需要爱发电凭证或云端图片存储。

## 使用已配置的猫、狗测试照片

在 `app/.dev.vars` 设置 `TEST_CAT_PHOTO_PATH`、`TEST_DOG_PHOTO_PATH`，值为本机图片绝对路径。Windows 路径可使用正斜杠，例如 `C:/Users/用户名/Pictures/pet.jpg`。

```powershell
Set-Location 'E:\Programs\Pets-Halloween\app'
node tools/test-generation.mjs --pet-type cat
node tools/test-generation.mjs --pet-type dog
```

不传 `--photo` 时，脚本读取对应的配置路径。它通过本机浏览器按网页规则解码、缩放和重编码，保留原图，并在本次输出目录保存实际输入 `input.jpg`。加 `--live` 才真实生成：

```powershell
node tools/test-generation.mjs --pet-type cat --live
node tools/test-generation.mjs --pet-type dog --live
```

如果当前受限进程把浏览器缓存解析到了不存在的临时用户目录，可指定本机已安装的浏览器目录：

```powershell
$env:PLAYWRIGHT_BROWSERS_PATH = 'C:\Users\Yile\AppData\Local\ms-playwright'
```

显式传入 `--photo` 时，照片须已符合下面的输入规则，脚本不会再次重编码。

## 先检查，不收费

在 PowerShell 中运行。把照片路径替换为实际文件。

```powershell
Set-Location 'E:\Programs\Pets-Halloween\app'
node tools/test-generation.mjs --photo 'E:\照片\pet.jpg' --role ghost --pet-type cat
```

这一步核验照片签名和尺寸、参考素材和请求构造，不调用 API，也不验证密钥权限或余额。JPEG 检查沿用网站现有规则，不执行完整 JPEG 解码；损坏文件仍可能需要由模型接口进一步拒绝。

## 真实测试：一次生图

```powershell
node tools/test-generation.mjs --photo 'E:\照片\pet.jpg' --role ghost --pet-type cat --live
```

`--live` 只发送一次真实收费请求，直接保存 Seedream 返回的 PNG；失败后不自动重试，沿用正式代码的 180 秒上限。

狗照片改为 `--pet-type dog`。可增加 `--pet-name '宠物名字'`。角色可用 `ghost`、`mummy`、`pumpkin`、`witch` 等；运行 `node tools/test-generation.mjs --help` 查看完整列表。此处直接调用 Node，避免本机 PowerShell 的 npm 包装入口吞掉参数。

## 查看输出

命令会显示本次输出目录。默认在 `app/.wrangler/generation-tests/<本次编号>/`，该目录已被 Git 忽略。输出不会放进公开网站。

| 文件 | 用途 |
|---|---|
| `prompt.txt` | 本次角色生成使用的提示词 |
| `result.png` | 模型直接返回的成品（白底，2048×2048） |
| `report.json` | 阶段耗时、HTTP 状态、供应商请求标识及精简错误 |

打开 `result.png` 手动检查毛色、耳朵、尾巴、配饰及画面质量。

## 怎样判断故障位置

- 没有 `--live` 就失败：先检查本地照片格式、尺寸、路径或参考素材。
- `generation` 失败：检查报告中的网络错误、HTTP 状态和供应商错误。
- 生成成功但外观不合格：属于图像质量问题，不能算功能链路失败。
- 本地成功而线上失败：继续查线上运行资源、断连和任务执行记录。

生产函数会合并部分错误。本地报告增加了网络和响应诊断，但仍不保证能还原每种图片解码错误。供应商受理状态未知时，不自动重发。

## 与现有测试的区别

`npm run test:api` 使用模拟模型响应。它不证明真实模型生成成功。

本入口验证本机到模型的真实生成链路。它不覆盖支付、Webhook、云端存储、线上 CPU 配额或关闭网页后继续生成。
