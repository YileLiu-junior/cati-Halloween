# 喵灵万圣节

宠物人格测试应用。以下命令在项目根目录的 PowerShell 中运行。

## 启动本地开发

需要 Node.js 22.16 或更新版本，以及 npm。首次运行：

```powershell
cd app
npm ci
Copy-Item .dev.vars.example .dev.vars
npx wrangler d1 migrations apply peti-custom-orders --local
```

如果 `app/.dev.vars` 已存在，跳过复制命令，避免覆盖现有配置。之后启动应用：

```powershell
npm run dev
```

打开 [http://127.0.0.1:8788](http://127.0.0.1:8788)。终端保持运行；按 `Ctrl+C` 停止。下次启动时，只需进入 `app` 并运行 `npm run dev`。

## 本地测试

在 `app` 目录运行：

```powershell
npm run test:api       # 接口测试
npx playwright install chromium  # 首次运行浏览器测试前安装浏览器
npm test               # 浏览器测试
npm run test:headed    # 显示浏览器窗口运行测试
npm run validate       # 题库校验，需要 Python
```

浏览器测试会自动启动本地服务，也会复用已运行的服务。接口和浏览器测试中的支付与生图使用测试替身，不会验证真实付款或生成。定制功能的配置说明见 [接入文档](doc/custom-generation-setup.md)。
