// Builds dist/content-factory.html: one self-contained file (app + libraries + styles).
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";
const dir = path.dirname(fileURLToPath(import.meta.url));
const read = (p) => fs.readFileSync(path.join(dir, p), "utf8");
const vendor = ["vendor/htm-preact.umd.js", "vendor/mp4-muxer.js", "vendor/fflate.umd.js"].map(read).join("\n;\n");
const app = fs.readdirSync(path.join(dir, "src")).filter((f) => f.endsWith(".js")).sort().map((f) => read("src/" + f)).join("\n");
// wrap in an async-safe IIFE so nothing leaks to window; escape </script
const safe = (s) => s.replace(/<\/script/gi, "<\\/script");
const out = read("index.template.html")
  .replace("/*CSS*/", () => read("style.css"))
  .replace("/*VENDOR*/", () => safe(vendor))
  .replace("/*APP*/", () => safe(`(() => {\n"use strict";\n${app}\n})();`));
// refuse to write a broken file: every script must compile
for (const [i, code] of [...out.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).entries()) {
  try {
    new vm.Script(code);
  } catch (e) {
    console.error(`✖ script ${i} has a syntax error: ${e.message}`);
    process.exit(1);
  }
}
fs.mkdirSync(path.join(dir, "dist"), { recursive: true });
fs.writeFileSync(path.join(dir, "dist/content-factory.html"), out);
console.log(`dist/content-factory.html  ${(out.length / 1024).toFixed(0)} KB`);
