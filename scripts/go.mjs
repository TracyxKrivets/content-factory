#!/usr/bin/env node
// One command to run Content Factory: installs, builds if needed, starts, opens the browser.
// Usage: npm run go        (or double-click "Start Content Factory" for your OS)
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const say = (m) => console.log(`\x1b[33m▶\x1b[0m ${m}`);
const die = (m) => {
  console.error(`\n\x1b[31m✖ ${m}\x1b[0m\n`);
  process.exit(1);
};

const major = Number(process.versions.node.split(".")[0]);
if (major < 20) die(`Node ${process.versions.node} is too old. Install Node 22 from https://nodejs.org and try again.`);

function step(label, args) {
  say(label);
  const r = spawnSync(npm, args, { stdio: "inherit", shell: process.platform === "win32" });
  if (r.status !== 0) die(`"${label}" failed. Scroll up for the reason, fix it, and run this again.`);
}

// 1. install (first run, or after package.json changed)
const stamp = path.join(root, "node_modules", ".cf-installed");
const pkgTime = fs.statSync(path.join(root, "package.json")).mtimeMs;
if (!fs.existsSync(stamp) || fs.statSync(stamp).mtimeMs < pkgTime) {
  step("Installing (first time takes a few minutes)…", ["install", "--no-audit", "--no-fund"]);
  fs.writeFileSync(stamp, new Date().toISOString());
}

// 2. build (first run, or when code changed since last build)
function newest(dir) {
  let t = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    t = Math.max(t, e.isDirectory() ? newest(p) : fs.statSync(p).mtimeMs);
  }
  return t;
}
const buildId = path.join(root, ".next", "BUILD_ID");
const srcTime = Math.max(newest(path.join(root, "src")), pkgTime);
if (!fs.existsSync(buildId) || fs.statSync(buildId).mtimeMs < srcTime) step("Building the app…", ["run", "build"]);

// 3. start on a free port
const free = (p) =>
  new Promise((res) => {
    const s = net.createServer().once("error", () => res(false)).once("listening", () => s.close(() => res(true))).listen(p);
  });
let port = Number(process.env.PORT) || 3000;
while (!(await free(port))) port++;
const url = `http://localhost:${port}`;
say(`Starting on ${url} …`);
const server = spawn(npm, ["start", "--", "-p", String(port)], {
  stdio: "inherit",
  shell: process.platform === "win32",
  env: { ...process.env, NODE_USE_ENV_PROXY: "1" }, // honor HTTPS_PROXY for AI calls if set
});
server.on("exit", (code) => process.exit(code ?? 0));
process.on("SIGINT", () => server.kill("SIGINT"));

// 4. open the browser once it answers
for (let i = 0; i < 60; i++) {
  await new Promise((r) => setTimeout(r, 1000));
  const ok = await fetch(url + "/api/health").then((r) => r.status < 500, () => false);
  if (ok) {
    console.log(`\n\x1b[32m✔ Content Factory is running → ${url}\x1b[0m  (keep this window open; close it to stop)\n`);
    if (!process.env.NO_OPEN) {
      const opener = process.platform === "darwin" ? ["open", [url]] : process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : ["xdg-open", [url]];
      spawn(opener[0], opener[1], { stdio: "ignore", detached: true }).on("error", () => {}).unref();
    }
    break;
  }
}
