// Takes phone-size screenshots of the welcome tour with a fresh, empty browser profile,
// so it shows exactly what a brand-new user sees. Needs Google Chrome and the app running
// on localhost:8502. Usage: node tools/screenshots.mjs
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const OUT = new URL("../test-outputs/screenshots/", import.meta.url).pathname;
const PORT = 9333;
const profile = mkdtempSync(join(tmpdir(), "kitty-shots-"));
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  "--no-first-run", "--hide-scrollbars", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function connect() {
  for (let i = 0; i < 50; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
      const page = list.find((t) => t.type === "page");
      if (page) return page.webSocketDebuggerUrl;
    } catch (_) {}
    await sleep(200);
  }
  throw new Error("Chrome did not start");
}

const ws = new WebSocket(await connect());
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let id = 0;
const pending = new Map();
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
});
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const n = ++id;
  pending.set(n, (m) => (m.error ? reject(new Error(m.error.message)) : resolve(m.result)));
  ws.send(JSON.stringify({ id: n, method, params }));
});
const run = async (expr) => (await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true })).result.value;
const waitFor = async (expr, ms = 20000) => {
  for (let t = 0; t < ms; t += 150) { if (await run(expr)) return; await sleep(150); }
  throw new Error("Timed out waiting for: " + expr);
};
const shot = async (name) => {
  await sleep(700); // let animations settle
  const { data } = await send("Page.captureScreenshot", { format: "jpeg", quality: 88 });
  writeFileSync(OUT + name, Buffer.from(data, "base64"));
  console.log("saved", name);
};

try {
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 375, height: 812, deviceScaleFactor: 2, mobile: true });
  await send("Page.navigate", { url: "http://localhost:8502/" });
  await waitFor(`!!document.getElementById("intro") && !document.getElementById("intro").hidden`);

  // Checks a brand-new user should pass
  const checks = await run(`({ tourShown: !document.getElementById("intro").hidden,
    nameEmpty: document.getElementById("oName").value === "", upiEmpty: document.getElementById("oUpi").value === "" })`);
  console.log("checks", JSON.stringify(checks));
  if (!checks.tourShown || !checks.nameEmpty || !checks.upiEmpty) throw new Error("New-user checks failed");

  await shot("01-welcome.jpg");
  await run(`document.getElementById("introNext").click()`);
  await waitFor(`document.getElementById("langTag").textContent === "Tanglish" && document.querySelector(".artSay").classList.contains("done")`);
  await shot("02-tour-tanglish.jpg");
  await run(`showSlide(4)`);
  await sleep(900);
  await shot("09-setup.jpg");

  // Leaving the name empty must be blocked for a new user
  await run(`document.getElementById("introNext").click()`);
  const blocked = await run(`!document.getElementById("oError").hidden && !document.getElementById("intro").hidden`);
  console.log("empty name blocked:", blocked);
  if (!blocked) throw new Error("Empty name was not blocked");
} finally {
  ws.close();
  chrome.kill();
  await sleep(300);
  rmSync(profile, { recursive: true, force: true });
}
