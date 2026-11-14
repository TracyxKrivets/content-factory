// Puts the app into the Android project: www/index.html (launcher) + www/app.html (the app itself).
// UPDATE_URL (optional): where the app looks for updates, e.g. https://<user>.github.io/content-factory/latest.json
import fs from "node:fs";
const app = new URL("../web/dist/content-factory.html", import.meta.url);
if (!fs.existsSync(app)) throw new Error("Build the app first: node web/build.mjs");
fs.mkdirSync(new URL("./www/", import.meta.url), { recursive: true });
fs.copyFileSync(app, new URL("./www/app.html", import.meta.url));
const launcher = fs.readFileSync(new URL("./launcher.html", import.meta.url), "utf8").replace("__UPDATE_URL__", process.env.UPDATE_URL || "__UPDATE_URL__");
fs.writeFileSync(new URL("./www/index.html", import.meta.url), launcher);
console.log("www ready", process.env.UPDATE_URL ? "(updates from " + process.env.UPDATE_URL + ")" : "(no update address)");
