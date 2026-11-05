// Builds dist/content-factory.html: one self-contained file.
//   shell (loader + "Change the app" chat, not editable from the chat)
//   + vendor libraries + the app's source files (editable from the chat)
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";
const dir = path.dirname(fileURLToPath(import.meta.url));
const read = (p) => fs.readFileSync(path.join(dir, p), "utf8");
const vendor = ["vendor/htm-preact.umd.js", "vendor/mp4-muxer.js", "vendor/fflate.umd.js"].map(read).join("\n;\n");
const files = {};
for (const f of fs.readdirSync(path.join(dir, "src")).filter((f) => f.endsWith(".js")).sort()) files[f] = read("src/" + f);
files["style.css"] = read("style.css");
// every piece must compile
const app = `(() => {\n"use strict";\n${Object.keys(files).filter((n) => n.endsWith(".js")).sort().map((n) => files[n]).join("\n")}\n})();`;
for (const [name, code] of [["app", app], ["shell", read("shell/shell.js")], ["vendor", vendor]]) {
  try {
    new vm.Script(code);
  } catch (e) {
    console.error(`✖ ${name} has a syntax error: ${e.message}`);
    process.exit(1);
  }
}
const safe = (s) => s.replace(/<\/script/gi, "<\\/script");
const source = JSON.stringify({ files, builtAt: new Date().toISOString() }).replace(/<\//g, "<\\/");
const out = read("index.template.html")
  .replace("/*SHELLCSS*/", () => read("shell/shell.css"))
  .replace("/*VENDOR*/", () => safe(vendor))
  .replace("/*SOURCE*/", () => source)
  .replace("/*SHELL*/", () => safe(read("shell/shell.js")));
fs.mkdirSync(path.join(dir, "dist"), { recursive: true });
fs.writeFileSync(path.join(dir, "dist/content-factory.html"), out);
console.log(`dist/content-factory.html  ${(out.length / 1024).toFixed(0)} KB`);
