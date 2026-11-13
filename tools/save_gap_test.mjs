// Checks that Save can't be tapped on a stale card, and that late recalculations are ignored.
// Needs Google Chrome and the app running on localhost:8502. No AI calls. Usage: node tools/save_gap_test.mjs
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PORT = 9334, profile = mkdtempSync(join(tmpdir(), "kitty-save-"));
const chrome = spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", ["--headless=new",
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "--no-first-run", "about:blank"], { stdio: "ignore" });
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
const run = async (expression) => (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result.result.value;
const open = async () => { await send("Page.navigate", { url: `http://localhost:8502/?${Date.now()}#home` }); await sleep(900); };
const SEED = `{profile:{name:"Asha",phone:"",upi:"",lang:""},friends:["Arun"],groups:[{id:"g",name:"Friends",people:["You","Arun"],expenses:[]}],current:"g",onboarded:6,contactsAsked:true}`;
const CARD = `(async () => { showCard(await post("/api/check", { expense: { description: "Dinner", total: 1000, payer: "You", participants: ["You", "Arun"], mode: "equal", values: {}, items: [] }, people: ["You", "Arun"] }), "g"); })()`;
const setTotal = (v) => `$("total").value = "${v}"; $("total").dispatchEvent(new Event("input"));`;
const saved = `JSON.parse(localStorage.getItem("voice-split-v2")).groups[0].expenses`;
const owed = `$("owed").textContent`;
let failed = 0;
const check = (name, ok, got) => { console.log((ok ? "PASS " : "FAIL ") + name + (ok ? "" : " | got: " + JSON.stringify(got))); if (!ok) failed++; };

try {
  await send("Page.enable"); await open();
  await run(`localStorage.setItem("voice-split-v2", JSON.stringify(${SEED}))`); await open();
  await run(CARD);
  check("Save is on for a valid card", (await run(`$("save").disabled`)) === false);
  const quick = await run(`${setTotal("")} const off = $("save").disabled; $("save").click(); ({ off, n: ${saved}.length })`);
  check("Save turns off the moment the card is edited", quick.off === true, quick);
  check("a quick tap on Save stores nothing", quick.n === 0, quick);
  await open(); await run(`localStorage.setItem("voice-split-v2", JSON.stringify(${SEED}))`); await open();
  await run(CARD);
  await run(`const real = window.fetch; let first = true; window.fetch = async (u, o) => { const late = first && String(u).includes("/api/check"); if (late) first = false; const r = await real(u, o); if (late) await new Promise((d) => setTimeout(d, 900)); return r; }; ${setTotal(900)}`);
  await sleep(300); await run(setTotal(1200));
  await sleep(500);
  check("Save returns when the latest recalculation arrives", (await run(`$("save").disabled`)) === false);
  check("the latest shares are shown", (await run(owed)).includes("600"), await run(owed));
  await sleep(1000);
  check("a late response from an older edit is ignored", (await run(owed)).includes("600"), await run(owed));
  const after = await run(`$("save").click(); ${saved}.map((e) => e.total)`);
  check("Save stores the latest amount", after.length === 1 && after[0] === 1200, after);
} finally { ws.close(); chrome.kill(); await sleep(300); rmSync(profile, { recursive: true, force: true }); }
console.log(failed ? `\n${failed} check(s) failed` : "\nAll checks passed");
process.exit(failed ? 1 : 0);
