// Checks the add-expense sheet's fast open and close: reopening within its 260 ms slide-out keeps the new
// sheet on screen, and opening then closing before the open frame leaves nothing behind. Also checks the
// phone's bars are left alone (no tint, as on main). Needs Google Chrome and the app on localhost:8502.
// No AI calls. Usage: node tools/sheet_race_test.mjs
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PORT = 9340, profile = mkdtempSync(join(tmpdir(), "kitty-race-"));
const chrome = spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", ["--headless=new",
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "--no-first-run", "--window-size=390,844", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let page;
for (let i = 0; i < 50 && !page; i++, await sleep(200)) {
  try { page = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).find((t) => t.type === "page"); } catch (_) {}
}
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let id = 0; const pending = new Map();
ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); pending.get(m.id)?.(m); });
const send = (method, params = {}) => new Promise((r) => { pending.set(++id, r); ws.send(JSON.stringify({ id, method, params })); });
const HELPERS = `
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const openCard = async () => { const res = await post("/api/check", { expense: { description: "Dinner", total: 600, payer: "You", participants: ["You", "Arun"], mode: "equal", values: {}, items: [] }, people: ["Arun"] }); showCard(res, "g"); await wait(500); };
  const sheet = () => ({ card: !$("card").hidden, scrim: !$("scrim").hidden, open: document.body.classList.contains("sheet-open") });
`;
const run = async (expression) => {
  const r = await send("Runtime.evaluate", { expression: `(async () => { ${HELPERS} ${expression} })()`, awaitPromise: true, returnByValue: true });
  if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 500));
  return r.result.result.value;
};
const open = async () => { await send("Page.navigate", { url: `http://localhost:8502/?${Date.now()}#group/g` }); await sleep(1300); };
let failed = 0;
const check = (name, ok, got) => { console.log((ok ? "PASS " : "FAIL ") + name + (ok ? "" : " | got: " + JSON.stringify(got))); if (!ok) failed++; };
const SEED = JSON.stringify({ profile: { name: "Asha", phone: "", upi: "", lang: "" }, friends: [], onboarded: 6, contactsAsked: true, current: "g",
  groups: [{ id: "g", name: "Goa trip", people: ["You", "Arun"], expenses: [] }] });

try {
  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
  await open();
  await run(`localStorage.setItem("voice-split-v2", ${JSON.stringify(SEED)}); return true`);
  await open();

  // Close, then reopen within the 260 ms slide-out
  const reopen = await run(`await openCard(); closeCard(); await wait(30); await openCard(); await wait(400); const r = sheet(); closeCard(); await wait(500); return { r, after: sheet() }`);
  check("closed and reopened at once: the new sheet stays on screen", reopen.r.card && reopen.r.scrim && reopen.r.open, reopen.r);
  check("then closed normally: the sheet and dim layer go away", !reopen.after.card && !reopen.after.scrim && !reopen.after.open, reopen.after);

  // Open, then close before the open frame
  const quick = await run(`newBlankCard("g"); closeCard(); await wait(600); return sheet()`);
  check("opened and closed in one frame: nothing left open, no stray sheet-open", !quick.card && !quick.scrim && !quick.open, quick);
  const again = await run(`await openCard(); const r = sheet(); closeCard(); await wait(500); return r`);
  check("the next open still works", again.card && again.scrim && again.open, again);

  // The phone's bars are left alone, as on main
  const bars = await run(`await openCard(); const r = { theme: document.querySelector('meta[name="theme-color"]').content,
    html: document.documentElement.getAttribute("style") || "", body: document.body.getAttribute("style") || "" }; closeCard(); await wait(400); return r`);
  check("sheet open: theme-color stays #F2F2F7 and no background is set on html/body", bars.theme === "#F2F2F7" && !/background/.test(bars.html + bars.body), bars);
} finally { ws.close(); chrome.kill(); await sleep(300); rmSync(profile, { recursive: true, force: true }); }
console.log(failed ? `\n${failed} check(s) failed` : "\nAll checks passed");
process.exit(failed ? 1 : 0);
