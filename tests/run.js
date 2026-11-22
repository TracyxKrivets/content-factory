// Runs the end-to-end tests in a real (headless) Chromium.
//   cd tests && npm install && npx playwright install chromium && node run.js          (all)
//   node run.js t1 sync                                                                  (some)
// Each test prints what it checked; a test fails if it exits with an error or prints FAIL / PAGEERROR.
// All AI services are simulated, so no keys or internet access to them are needed.
const { spawn, execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ALL = ["t1", "t2", "chat", "nav2", "lang", "claude", "research2", "keys", "plat2", "plat", "gemini", "money", "custom", "mine", "fallback", "sync"];
const pick = process.argv.slice(2).filter((a) => !a.startsWith("-"));
const tests = pick.length ? pick : ALL;
fs.mkdirSync(path.join(__dirname, "out"), { recursive: true });

console.log("Building the app…");
execFileSync(process.execPath, [path.join(__dirname, "../web/build.mjs")], { stdio: "inherit" });

function run(cmd, args, ms) {
  return new Promise((res) => {
    const p = spawn(cmd, args, { cwd: __dirname, env: process.env });
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (out += d));
    const t = setTimeout(() => (p.kill("SIGKILL"), (out += "\nFAIL: timed out")), ms);
    p.on("close", (code) => (clearTimeout(t), res({ code, out })));
  });
}

(async () => {
  let server = null;
  if (tests.includes("sync")) {
    server = spawn(process.execPath, [path.join(__dirname, "syncserver.js")], { stdio: "ignore" });
    await new Promise((r) => setTimeout(r, 800));
  }
  const results = [];
  for (const t of tests) {
    const t0 = Date.now();
    process.stdout.write(`\n=== ${t} `);
    const { code, out } = await run(process.execPath, [path.join(__dirname, t + ".js")], 12 * 60000);
    const bad = code !== 0 || /(^|\n)\s*FAIL\b|PAGEERROR/.test(out);
    results.push({ t, ok: !bad, s: Math.round((Date.now() - t0) / 1000) });
    console.log(`${bad ? "✗ FAILED" : "✓"} (${results.at(-1).s}s)`);
    console.log(out.trim().split("\n").map((l) => "   " + l).join("\n"));
  }
  server?.kill();
  console.log("\n" + results.map((r) => `${r.ok ? "✓" : "✗"} ${r.t}`).join("  "));
  process.exit(results.every((r) => r.ok) ? 0 : 1);
})();
