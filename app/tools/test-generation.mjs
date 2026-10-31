// 本机诊断入口；不创建订单、不跳过线上付款校验，--live 才会调用收费 API。
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, parseEnv } from "node:util";
import { randomUUID } from "node:crypto";
import { buildImageRequest, generateImage } from "../functions/lib/generate.js";
import { GENERATION_CONFIG } from "../functions/lib/generation-config.js";
import ROLE_FILES from "../functions/lib/role-references.js";
import { PET_ROLE_FILES } from "../functions/lib/pet-role-references.js";
import { jpegDimensions } from "../functions/lib/custom.js";

const app = fileURLToPath(new URL("../", import.meta.url));
const endpoint = "https://ark.cn-beijing.volces.com/api/v3/images/generations";
const help = `本地检查（不调用 API）：
  node tools/test-generation.mjs --photo "E:\\照片\\pet.jpg" --role ghost --pet-type cat
使用 .dev.vars 中配置的测试照片（自动按网页规则缩放、重编码）：
  node tools/test-generation.mjs --pet-type cat
真实生图（收费，一次请求）：
  node tools/test-generation.mjs --photo "E:\\照片\\pet.jpg" --role ghost --pet-type cat --live
可选：--pet-name 名字，--out 输出父目录。默认输出到 app/.wrangler/generation-tests/。
照片须为真正的 JPEG，短边至少512px、长边最多1600px、最多2MiB。
角色：${Object.keys(ROLE_FILES).join(", ")}`;

export async function main(args = process.argv.slice(2)) {
  const { values } = parseArgs({ args, options: {
    photo: { type: "string" }, role: { type: "string", default: "ghost" },
    "pet-type": { type: "string", default: "cat" }, "pet-name": { type: "string", default: "本地测试" },
    out: { type: "string" }, live: { type: "boolean", default: false }, help: { type: "boolean" },
    "prompt-file": { type: "string" },
  } });
  if (values.help) { console.log(help); return; }
  let localVars;
  const readLocalVars = async () => localVars ??= parseEnv(await readFile(join(app, ".dev.vars"), "utf8")
    .catch((error) => { if (error.code === "ENOENT") return ""; throw error; }));
  const configuredPhoto = !values.photo;
  if (configuredPhoto) values.photo = process.env[`TEST_${values["pet-type"].toUpperCase()}_PHOTO_PATH`]
    || (await readLocalVars())[`TEST_${values["pet-type"].toUpperCase()}_PHOTO_PATH`];
  if (!values.photo) throw new Error("请用 --photo 指定照片，或在 .dev.vars 设置 TEST_<TYPE>_PHOTO_PATH。使用 --help 查看用法。");
  if (!Object.hasOwn(ROLE_FILES, values.role)) throw new Error(`未知角色。可选：${Object.keys(ROLE_FILES).join(", ")}`);
  if (!["cat", "dog"].includes(values["pet-type"])) throw new Error("--pet-type 只能是 cat 或 dog。");

  const inputPath = resolve(values.photo);
  let input = await readFile(inputPath);
  if (configuredPhoto) {
    if (input.length > 10 * 1024 * 1024) throw new Error("原图不能超过10MiB。");
    const { chromium } = await import("@playwright/test");
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      const prepared = await page.evaluate(async (encoded) => {
        const image = new Image(); image.src = `data:image/jpeg;base64,${encoded}`; await image.decode();
        if (Math.min(image.naturalWidth, image.naturalHeight) < 512) throw new Error("照片短边至少512px。");
        const scale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(image.naturalWidth * scale); canvas.height = Math.round(image.naturalHeight * scale);
        if (Math.min(canvas.width, canvas.height) < 512) throw new Error("照片过于狭长。");
        canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
        let output;
        for (const quality of [0.88, 0.82, 0.76, 0.7]) {
          output = canvas.toDataURL("image/jpeg", quality).split(",")[1];
          if (atob(output).length <= 800 * 1024) break;
        }
        return output;
      }, input.toString("base64"));
      input = Buffer.from(prepared, "base64");
    } finally { await browser.close(); }
  }
  const dimensions = jpegDimensions(input);
  if (!dimensions || input.length > 2 * 1024 * 1024 || Math.min(dimensions.width, dimensions.height) < 512
    || Math.max(dimensions.width, dimensions.height) > 1600) throw new Error("照片须为真正的 JPEG，短边至少512px、长边最多1600px、最多2MiB；PNG不能只改扩展名。");
  const roleFiles = PET_ROLE_FILES[values["pet-type"]];
  if (!roleFiles[values.role]) throw new Error(`狗参考图目录尚未提供角色：${values.role}，请补齐对应素材。`);
  const referencePath = fileURLToPath(new URL(`../../${values["pet-type"] === "dog" ? "free-pic-dog" : "free-pic"}/${roleFiles[values.role]}`, import.meta.url));
  const reference = await readFile(referencePath);
  if (reference.toString("ascii", 1, 4) !== "PNG") throw new Error("角色参考图不是 PNG。");
  const storage = new Map([["photo", input], [GENERATION_CONFIG.roleImageKeys[values["pet-type"]][values.role], reference]]);
  const request = await buildImageRequest({ PETI_IMAGES: { async get(key) {
    const bytes = storage.get(key);
    return bytes ? { httpMetadata: { contentType: key === "photo" ? "image/jpeg" : "image/png" },
      arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) } : null;
  } } }, { roleId: values.role, petType: values["pet-type"], petName: values["pet-name"] }, { object_key: "photo" });

  if (values["prompt-file"]) {
    request.prompt = await readFile(resolve(values["prompt-file"]), "utf8");
    if (!request.prompt.trim()) throw new Error("Prompt 文件不能为空。");
  }
  let apiKey = "";
  if (values.live) {
    apiKey = process.env.ARK_API_KEY?.trim() || "";
    if (!apiKey) apiKey = (await readLocalVars()).ARK_API_KEY?.trim() || "";
    if (!apiKey) throw new Error("请先在 app/.dev.vars 设置 ARK_API_KEY，或设置同名环境变量。不要把密钥放进命令参数。");
  }
  const outputDir = join(resolve(values.out || join(app, ".wrangler/generation-tests")), `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`);
  await mkdir(outputDir, { recursive: true });
  const report = { startedAt: new Date().toISOString(), live: values.live, mode: "generation",
    promptFile: values["prompt-file"] ? resolve(values["prompt-file"]) : null,
    referencePath,
    model: GENERATION_CONFIG.model, size: GENERATION_CONFIG.size, inputPath, inputPrepared: configuredPhoto, role: values.role,
    outputDir, status: "checked", stages: [], requests: [] };
  const saveReport = () => writeFile(join(outputDir, "report.json"), JSON.stringify(report, null, 2));
  if (configuredPhoto) await writeFile(join(outputDir, "input.jpg"), input);
  await writeFile(join(outputDir, "prompt.txt"), request.prompt);
  console.log(`输出目录：${outputDir}`);
  if (!values.live) {
    report.status = "dry-run-passed";
    await saveReport();
    console.log("预检通过；没有调用 API。加 --live 后才运行收费生图。此次检查不验证模型权限或余额。");
    return report;
  }

  const scrub = (value) => String(value ?? "").replaceAll(apiKey, "[redacted]").replace(/data:image\/[^;]+;base64,[A-Za-z0-9+/=]+/g, "[image]").slice(0, 500);
  const originalFetch = globalThis.fetch;
  report.status = "running";
  await saveReport();
  // 只给本机本次调用增加诊断；不保存授权头、请求体或图片 Base64。
  globalThis.fetch = async (url, options) => {
    if (String(url) !== endpoint) throw new Error("诊断入口拒绝调用未预期的服务地址。");
    const entry = { stage: "generation", sentAt: new Date().toISOString() };
    report.requests.push(entry);
    const start = performance.now();
    try {
      const response = await originalFetch(url, options);
      entry.headersElapsedMs = Math.round(performance.now() - start);
      entry.httpStatus = response.status;
      entry.requestId = response.headers.get("x-request-id") || response.headers.get("x-tt-logid") || response.headers.get("request-id");
      if (!response.ok) {
        const body = await response.clone().json().catch(() => null);
        if (body) entry.providerError = { code: scrub(body.error?.code ?? body.code), message: scrub(body.error?.message ?? body.message) };
      }
      const readJson = response.json.bind(response);
      response.json = async () => {
        try {
          const body = await readJson();
          entry.outputs = Array.isArray(body.data) ? body.data.map((item) => ({ size: item.size,
            base64Length: item.b64_json?.length,
            error: item.error ? scrub(item.error.message ?? item.error) : undefined })) : null;
          if (body.error) entry.providerError = { code: scrub(body.error.code), message: scrub(body.error.message) };
          return body;
        } catch (error) { entry.parseError = scrub(error.message); throw error; }
      };
      return response;
    } catch (error) { entry.networkError = { name: error.name, message: scrub(error.message) }; entry.networkElapsedMs = Math.round(performance.now() - start); throw error; }
    finally { await saveReport(); }
  };
  try {
    console.log("开始角色生成（收费请求，不自动重试）…");
    const start = performance.now();
    const result = await generateImage({ ARK_API_KEY: apiKey }, request);
    report.stages.push({ stage: "generation", elapsedMs: Math.round(performance.now() - start), status: result.status, errorCode: result.errorCode });
    await saveReport();
    if (result.status !== "ready") throw new Error(`generation 未完成：${result.errorCode}。查看 report.json；不要在受理未知时盲目重跑。`);
    await writeFile(join(outputDir, "result.png"), result.image);
    report.status = "ready";
    console.log(`生成完成：${join(outputDir, "result.png")}`);
  } catch (error) {
    report.status = "failed";
    report.error = scrub(error.message);
    throw new Error(`${report.error}\n诊断报告：${join(outputDir, "report.json")}`);
  } finally {
    globalThis.fetch = originalFetch;
    report.finishedAt = new Date().toISOString();
    await saveReport();
  }
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
