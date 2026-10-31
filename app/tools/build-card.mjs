import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { readFileSync, writeFileSync } from "node:fs";
const output = fileURLToPath(new URL("../public/holo-card/app.bundle.js", import.meta.url));
await build({
  entryPoints: [fileURLToPath(new URL("../public/holo-card/app.js", import.meta.url))],
  outfile: output,
  nodePaths: [fileURLToPath(new URL("../../holo-card/web/node_modules", import.meta.url))],
  bundle: true, minify: true, format: "esm", target: "es2020",
});
writeFileSync(output, readFileSync(output, "utf8").replace(/[ \t]+$/gm, ""));
console.log("Card bundle updated");
