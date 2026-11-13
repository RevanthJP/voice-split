// Checks that one person has one amount: a row, its reminder and its explain sheet all agree, on a
// group screen and on Friends. Needs Google Chrome and the app running on localhost:8502.
// No AI calls and no key. Usage: node tools/one_amount_test.mjs
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PORT = 9335, profile = mkdtempSync(join(tmpdir(), "kitty-amount-"));
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
const run = async (expression) => (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result.result.value;
const open = async (hash) => { await send("Page.navigate", { url: `http://localhost:8502/?${Date.now()}#${hash}` }); await sleep(1200); };

// The report's test data in "Test group", plus a second group with Meena so her Friends row covers two groups.
const ex = (id, description, total, payer, participants, day) =>
  ({ id, description, total, payer, participants, mode: "equal", values: {}, items: [], at: `2026-11-0${day}T10:00:00.000Z` });
const ALL3 = ["You", "Arun", "Meena"];
const SEED = {
  profile: { name: "Asha", phone: "", upi: "", lang: "" }, friends: [], onboarded: 6, contactsAsked: true, current: "tg",
  groups: [
    { id: "tg", name: "Test group", people: ALL3, expenses: [ex("e1", "Hotel", 3000, "You", ALL3, 1), ex("e2", "Lunch", 300, "You", ALL3, 2), ex("e3", "Cab", 600, "Arun", ALL3, 3), ex("e4", "Movie", 300, "Meena", ALL3, 4)] },
    { id: "fl", name: "Flat", people: ["You", "Meena"], expenses: [ex("e5", "Rent", 1000, "You", ["You", "Meena"], 5)] },
  ],
};
const money = `const money = (t) => { const m = String(t).match(/₹([\\d,]+(?:\\.\\d+)?)/); return m ? Number(m[1].replace(/,/g, "")) : null; };`;
let failed = 0;
const check = (name, ok, got) => { console.log((ok ? "PASS " : "FAIL ") + name + (ok ? "" : " | got: " + JSON.stringify(got))); if (!ok) failed++; };

// Reads a row's amount, then its reminder and its explain sheet, each opened by a real click.
const readRow = (rowExpr) => `(async () => { ${money}
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const row = ${rowExpr};
  if (!row) return null;
  const rowAmount = money(row.querySelector("strong").textContent);
  row.querySelector(".wa").click(); await wait(500);
  const remind = { title: $("remindTitle").textContent, text: $("remindText").value };
  closeRemind(); await wait(400);
  row.querySelector("strong").click(); await wait(1200);
  const strongs = [...document.querySelectorAll("#explainList strong")];
  const explain = { title: $("explainTitle").textContent, total: money(strongs[strongs.length - 1].textContent), sign: strongs[strongs.length - 1].textContent.trim()[0] };
  closeExplain(); await wait(400);
  return { rowAmount, remind, remindAmount: money(remind.text), titleAmount: money(remind.title), explain };
})()`;

try {
  await send("Page.enable"); await open("home");
  await run(`localStorage.setItem("voice-split-v2", JSON.stringify(${JSON.stringify(SEED)}))`);

  await open("group/tg");
  const groupRow = (line) => `[...document.querySelectorAll("#gSettle li")].find((li) => li.querySelector(".name") && li.querySelector(".name").textContent === "${line}")`;
  const meenaG = await run(readRow(groupRow("Meena pays you")));
  const arunG = await run(readRow(groupRow("Arun pays you")));
  check("group row: Meena pays you ₹1,000", meenaG && meenaG.rowAmount === 1000, meenaG);
  check("group row: Arun pays you ₹900", arunG && arunG.rowAmount === 900, arunG);
  for (const [who, r] of [["Meena", meenaG], ["Arun", arunG]]) {
    if (!r) continue;
    check(`group reminder for ${who} sends the row amount`, r.remindAmount === r.rowAmount && r.titleAmount === r.rowAmount, r.remind);
    check(`group reminder for ${who} names the group`, r.remind.text.includes("your share for Test group comes to") && r.remind.title.endsWith("(Test group)"), r.remind);
    check(`group explain for ${who} is limited to the group and totals the row`, r.explain.title === `You and ${who} in Test group` && r.explain.total === r.rowAmount && r.explain.sign === "+", r.explain);
  }
  const others = await run(`({ head: !$("gOthersHead").hidden, rows: [...document.querySelectorAll("#gOthers li")].map((li) => ({ text: li.textContent, muted: li.classList.contains("muted"), buttons: li.querySelectorAll("button").length })) })`);
  check("Between others shows Meena pays Arun ₹100, muted, with no reminder", others.head && others.rows.length === 1 && others.rows[0].text.includes("Meena pays Arun") && others.rows[0].text.includes("₹100") && others.rows[0].muted && others.rows[0].buttons === 0, others);
  const card = await run(`(() => { ${money} return { card: money($("gBal").textContent), rows: [...document.querySelectorAll("#gSettle li strong")].map((s) => money(s.textContent)) }; })()`);
  check("group card equals the sum of my rows", card.card === card.rows.reduce((a, b) => a + b, 0), card);

  await open("friends");
  const friendRow = (name) => `[...document.querySelectorAll("#friends li")].find((li) => li.querySelector(".name") && li.querySelector(".name").textContent.startsWith("${name}"))`;
  const meenaF = await run(readRow(friendRow("Meena")));
  const arunF = await run(readRow(friendRow("Arun")));
  check("Friends row: Meena ₹1,500 (₹1,000 Test group + ₹500 Flat)", meenaF && meenaF.rowAmount === 1500, meenaF);
  check("Friends row: Arun ₹900, the same as the group, since all their expenses are there", arunF && arunF.rowAmount === 900 && arunG && arunF.rowAmount === arunG.rowAmount, arunF);
  for (const [who, r] of [["Meena", meenaF], ["Arun", arunF]]) {
    if (!r) continue;
    check(`Friends reminder for ${who} sends the row amount, with no group named`, r.remindAmount === r.rowAmount && r.remind.text.includes("your share of our shared expenses") && !r.remind.title.includes("("), r.remind);
    check(`Friends explain for ${who} totals the row`, r.explain.title === `You and ${who}` && r.explain.total === r.rowAmount, r.explain);
  }
} finally { ws.close(); chrome.kill(); await sleep(300); rmSync(profile, { recursive: true, force: true }); }
console.log(failed ? `\n${failed} check(s) failed` : "\nAll checks passed");
process.exit(failed ? 1 : 0);
