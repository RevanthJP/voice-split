// Checks recording a payment by scope: each shared group, and "No group" for one-off debts. One-off payments
// live in state.oneOffPayments (never in a group), count in Friends, Home, Explain and export, never in a
// group's balance or Settle Up, and can be deleted from Friends → Explain. No AI calls; the real balance routes
// work everything out. Needs Google Chrome and the app on localhost:8502. Usage: node tools/payment_scopes_test.mjs
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PORT = 9344, profile = mkdtempSync(join(tmpdir(), "kitty-scopes-"));
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
  const money = (t) => { const m = String(t).match(/₹([\\d,]+(?:\\.\\d+)?)/); return m ? Number(m[1].replace(/,/g, "")) : null; };
  const saved = () => JSON.parse(localStorage.getItem("voice-split-v2"));
  const friendRow = (n) => [...document.querySelectorAll("#friends li")].find((li) => li.querySelector(".name") && li.querySelector(".name").textContent.startsWith(n));
  const friendsTab = async () => { go("friends"); await wait(1000);
    return Object.fromEntries([...document.querySelectorAll("#friends li")].map((li) => [li.querySelector(".name").textContent.replace(/[^A-Za-z ]/g, "").trim(),
      (li.querySelector(".amt.owe") ? -1 : 1) * (money(li.querySelector(".amt strong").textContent) || 0)])); };
  const settle = async (gid) => { go("group", gid); await wait(1100);
    return Object.fromEntries([...document.querySelectorAll("#gSettle li")].map((li) => [li.querySelector(".name").textContent, money(li.querySelector("strong").textContent)])); };
  const getBack = async () => { go("home"); await wait(800); return money($("getBack").textContent); };
  const hasPay = (n) => { const li = friendRow(n); return !!li && [...li.querySelectorAll("button")].some((b) => b.textContent === "Record payment"); };
  const openPayFor = async (n) => { go("friends"); await wait(900); [...friendRow(n).querySelectorAll("button")].find((b) => b.textContent === "Record payment").click(); await wait(1200); };
  const sheet = () => ({ open: !$("pay").hidden, chips: [...document.querySelectorAll("#payGroupChips .chip")].map((c) => c.textContent + (c.classList.contains("on") ? " [on]" : "")),
    dirIn: $("payIn").classList.contains("on"), dirOut: $("payOut").classList.contains("on"), amount: $("payAmount").value, note: $("payNote").textContent, save: !$("paySave").disabled });
  const chip = (start) => [...document.querySelectorAll("#payGroupChips .chip")].find((c) => c.textContent.startsWith(start));
  const typeAmount = (v) => { $("payAmount").value = v; $("payAmount").dispatchEvent(new Event("input")); };
  const savePay = async () => { $("paySave").click(); await wait(1200); };
`;
const run = async (expression) => {
  const r = await send("Runtime.evaluate", { expression: `(async () => { ${HELPERS} ${expression} })()`, awaitPromise: true, returnByValue: true });
  if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 600));
  return r.result.result.value;
};
const open = async () => { await send("Page.navigate", { url: `http://localhost:8502/?${Date.now()}#home` }); await sleep(1400); };
const setState = async (s) => { await open(); await run(`localStorage.clear(); localStorage.setItem("voice-split-v2", ${JSON.stringify(JSON.stringify(s))}); return true`); await open(); };
const exp = (id, description, total, payer, participants, day) => ({ id, at: `2026-11-${day}T10:00:00.000Z`, description, total, payer, participants, mode: "equal", values: {}, items: [] });
const base = (more) => ({ profile: { name: "Asha", phone: "", upi: "", lang: "" }, friends: [], onboarded: 6, contactsAsked: true, current: "g", ...more });
let failed = 0;
const check = (name, ok, got) => { console.log((ok ? "PASS " : "FAIL ") + name + (ok ? "" : " | got: " + JSON.stringify(got))); if (!ok) failed++; };

// Goa trip: Arun owes you ₹500. One-offs: Ravi owes you ₹300 (Cab), Arun owes you ₹100 (Lunch).
const GOA = { id: "g", name: "Goa trip", people: ["You", "Arun"], expenses: [exp("e1", "Hotel", 1000, "You", ["You", "Arun"], "02")] };
const ONE_OFFS = [exp("o1", "Cab", 600, "You", ["You", "Ravi"], "05"), exp("o2", "Lunch", 200, "You", ["You", "Arun"], "04")];

try {
  await send("Page.enable");

  // f) Saved groups load unchanged: no payments field is added on startup
  await setState(base({ groups: [GOA], oneOffs: ONE_OFFS }));
  const loaded = await run(`return { group: JSON.stringify(saved().groups[0]), oneOffPayments: "oneOffPayments" in saved() }`);
  check("f) an existing user's saved group loads unchanged, with no 'payments' field written on startup", loaded.group === JSON.stringify(GOA) && !loaded.oneOffPayments, loaded);

  // a) Ravi owes only through a one-off
  const a = await run(`const before = { friends: await friendsTab(), getBack: await getBack(), settle: await settle("g") };
    await friendsTab(); const button = hasPay("Ravi");
    await openPayFor("Ravi"); const s = sheet(); await savePay();
    const st = saved(); const after = { friends: await friendsTab(), getBack: await getBack(), settle: await settle("g") };
    return { before, button, s, after, stored: st.oneOffPayments, groupPayments: "payments" in st.groups[0] }`);
  check("a) Ravi (one-offs only) has 'Record payment'; the only scope is 'No group', chosen, ₹300 filled in, Ravi paid you",
    a.button && JSON.stringify(a.s.chips) === JSON.stringify(["No group · owes you ₹300 [on]"]) && a.s.amount === "300" && a.s.dirIn && a.s.save
    && a.s.note === "After this, you and Ravi will be settled up outside groups.", a.s);
  check("a) saved in state.oneOffPayments, never in a group", a.stored.length === 1 && a.stored[0].from === "Ravi" && a.stored[0].to === "You" && a.stored[0].amount === 30000 && !a.groupPayments, a);
  check("a) Friends: Ravi settled; Home 'You get back' went from ₹900 to ₹600; the group's Settle Up is unchanged",
    a.before.friends.Ravi === 300 && !a.after.friends.Ravi && a.before.getBack === 900 && a.after.getBack === 600 && JSON.stringify(a.before.settle) === JSON.stringify(a.after.settle) && a.after.settle["Arun pays you"] === 500, a);

  // b) Arun owes in the group (₹500) and in one-offs (₹100)
  const b = await run(`await openPayFor("Arun"); const s = sheet();
    chip("No group").click(); await wait(300); const none = sheet(); await savePay();
    const afterNone = { friends: await friendsTab(), settle: await settle("g") };
    await openPayFor("Arun"); const s2 = sheet(); chip("Goa trip").click(); await wait(300); typeAmount("200"); await wait(200); await savePay();
    const afterGroup = { friends: await friendsTab(), settle: await settle("g") };
    return { s, none, afterNone, s2, afterGroup, groupPays: saved().groups[0].payments.length, oneOffPays: saved().oneOffPayments.length }`);
  check("b) Arun: both scopes shown with their own amounts, with Everything offered and chosen", JSON.stringify(b.s.chips) === JSON.stringify(["Everything · owes you ₹600 [on]", "Goa trip · owes you ₹500", "No group · owes you ₹100"]), b.s);
  check("b) paying 'No group' fills ₹100 and changes only the one-off part: Friends ₹600 → ₹500, the group still ₹500",
    b.none.amount === "100" && b.none.dirIn && b.afterNone.friends.Arun === 500 && b.afterNone.settle["Arun pays you"] === 500, b);
  check("b) next time No group shows as settled (it has a payment) and Goa trip, the only balance, is chosen; paying ₹200 there changes only that group: group ₹300, Friends ₹300 (the sum of both scopes)",
    JSON.stringify(b.s2.chips) === JSON.stringify(["Goa trip · owes you ₹500 [on]", "No group · settled"]) && b.afterGroup.settle["Arun pays you"] === 300 && b.afterGroup.friends.Arun === 300 && b.groupPays === 1 && b.oneOffPays === 2, b);

  // c) The Arun example: Arun owes you ₹100 in a group, you owe Arun ₹500 in one-offs: Friends says you owe ₹400
  await setState(base({ groups: [{ id: "g", name: "Goa trip", people: ["You", "Arun"], expenses: [exp("e1", "Snacks", 200, "You", ["You", "Arun"], "02")] }],
    oneOffs: [exp("o1", "Dinner", 1000, "Arun", ["You", "Arun"], "03")] }));
  const c = await run(`const f = await friendsTab(); await openPayFor("Arun"); const s = sheet();
    chip("Goa trip").click(); await wait(300); const g = sheet(); chip("No group").click(); await wait(300); const n = sheet(); chip("Goa trip").click(); await wait(300); const back = sheet();
    closePayment(); await wait(400); return { f, s, g, n, back }`);
  check("c) Friends: you owe Arun ₹400", c.f.Arun === -400, c.f);
  check("c) the sheet lists Goa trip (owes you ₹100) and No group (you owe ₹500), and Everything (you owe ₹400) is chosen with the net ₹400",
    JSON.stringify(c.s.chips) === JSON.stringify(["Everything · you owe ₹400 [on]", "Goa trip · owes you ₹100", "No group · you owe ₹500"]) && c.s.amount === "400" && c.s.dirOut, c.s);
  check("c) each scope points the right way: Goa trip → 'Arun paid you' ₹100; No group → 'You paid Arun' ₹500; and back again",
    c.g.dirIn && c.g.amount === "100" && c.n.dirOut && c.n.amount === "500" && c.back.dirIn && c.back.amount === "100", c);

  // d) Overpaying No group flips that scope only
  const d = await run(`await openPayFor("Arun"); chip("No group").click(); await wait(300); typeAmount("700"); await wait(200); const s = sheet(); await savePay();
    await openPayFor("Arun"); const after = sheet(); closePayment(); await wait(400); return { s, after, friends: await friendsTab(), settle: await settle("g") }`);
  check("d) paying Arun ₹700 against ₹500 says ₹200 more, and that Arun will owe you ₹200 outside groups",
    d.s.note === "That's ₹200 more than you owe Arun outside groups. Choose Everything to settle all balances. After this, Arun will owe you ₹200 outside groups.", d.s);
  check("d) only No group flips (Arun now owes you ₹200 there); Goa trip is still ₹100; Friends ₹300",
    JSON.stringify(d.after.chips) === JSON.stringify(["Everything · owes you ₹300 [on]", "Goa trip · owes you ₹100", "No group · owes you ₹200"]) && d.settle["Arun pays you"] === 100 && d.friends.Arun === 300, d);

  // e) Deleting a one-off payment restores the balance; deleting the expense it paid doesn't break anything
  const e = await run(`go("friends"); await wait(800); openExplain("Arun"); await wait(1200);
    const line = [...document.querySelectorAll("#explainList li")].find((li) => li.textContent.includes("Payment") && li.querySelector("button"));
    const label = line && line.textContent; line.querySelector("button").click(); await wait(600);
    const sheetShown = { open: !$("oneOff").hidden, title: $("ooTitle").textContent, desc: $("ooDesc").textContent, amount: $("ooAmount").textContent, who: $("ooWho").textContent, explain: !$("explain").hidden };
    $("ooCancel").click(); await wait(500); const kept = saved().oneOffPayments.length;
    openExplain("Arun"); await wait(1200); [...document.querySelectorAll("#explainList li")].find((li) => li.textContent.includes("Payment") && li.querySelector("button")).querySelector("button").click(); await wait(600);
    $("ooDelete").click(); await wait(1200); const afterPay = { left: saved().oneOffPayments.length, friends: await friendsTab(), settle: await settle("g") };
    // The other case: pay the one-off off, then delete the one-off expense itself
    await openPayFor("Arun"); chip("No group").click(); await wait(300); await savePay();
    go("home"); await wait(800); [...document.querySelectorAll("#recent li")].find((li) => li.textContent.includes("Dinner")).click(); await wait(500); $("ooDelete").click(); await wait(1200);
    const errs = []; window.addEventListener("error", (x) => errs.push(String(x.message)));
    const afterExp = { oneOffs: saved().oneOffs.length, pays: saved().oneOffPayments.length, friends: await friendsTab(), getBack: await getBack() };
    await openPayFor("Arun"); const s = sheet(); closePayment(); await wait(400);
    openExplain("Arun"); await wait(1200); const lines = [...document.querySelectorAll("#explainList li")].map((li) => li.textContent); closeExplain(); await wait(400);
    return { label, sheetShown, kept, afterPay, afterExp, s, lines, errs }`);
  check("e) a No group payment in Friends → Explain has Delete; it opens 'Delete this payment?' with who, the amount and 'No group'",
    e.label.includes("No group") && e.sheetShown.open && !e.sheetShown.explain && e.sheetShown.title === "Delete this payment?" && e.sheetShown.desc === "You paid Arun" && e.sheetShown.amount === "₹700" && e.sheetShown.who.startsWith("Payment · No group"), e.sheetShown);
  check("e) Cancel keeps it; Delete restores the balance (Friends −₹400, No group back to you owe ₹500), the group untouched",
    e.kept === 1 && e.afterPay.left === 0 && e.afterPay.friends.Arun === -400 && e.afterPay.settle["Arun pays you"] === 100, e);
  check("e) deleting the one-off expense a payment settled: nothing breaks; the payment stays and now counts the other way",
    e.afterExp.oneOffs === 0 && e.afterExp.pays === 1 && e.afterExp.friends.Arun === 600 && e.afterExp.getBack === 600
    && JSON.stringify(e.s.chips) === JSON.stringify(["Everything · owes you ₹600 [on]", "Goa trip · owes you ₹100", "No group · owes you ₹500"]) && e.lines.some((l) => l.includes("Payment")) && !e.errs.length, e);

  // g) Export lists one-off payments as "No group", and they never reach a group's export
  const g = await run(`go("account"); await wait(500); $("xRange").value = "all"; $("xGroup").dispatchEvent(new Event("change")); await wait(200);
    const all = exportRows(); $("xGroup").value = "g"; const grp = exportRows();
    return { all: all.pays.map((p) => p._group + ":" + p.from + ">" + p.to), grp: grp.pays.map((p) => p._group) }`);
  check("g) export: the one-off payment is listed with 'No group'; the Goa trip export has no one-off payments",
    g.all.includes("No group:You>Arun") && g.grp.every((x) => x === "Goa trip"), g);
} finally { ws.close(); chrome.kill(); await sleep(300); rmSync(profile, { recursive: true, force: true }); }
console.log(failed ? `\n${failed} check(s) failed` : "\nAll checks passed");
process.exit(failed ? 1 : 0);
