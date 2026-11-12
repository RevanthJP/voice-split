// Records payments through the real sheet and checks that every screen moves together: the group rows and
// card, Friends, Home, the Groups list, both reminders and the explain sheet. Starts from data saved
// before payments existed. Needs Google Chrome and the app on localhost:8502. No AI calls and no key.
// Usage: node tools/record_payment_test.mjs
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PORT = 9336, profile = mkdtempSync(join(tmpdir(), "kitty-pay-"));
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
const run = async (expression) => {
  const r = await send("Runtime.evaluate", { expression: `(async () => { ${HELPERS} ${expression} })()`, awaitPromise: true, returnByValue: true });
  if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 400));
  return r.result.result.value;
};
const open = async (hash) => { await send("Page.navigate", { url: `http://localhost:8502/?${Date.now()}#${hash}` }); await sleep(1300); };

// The report's test data in "Test group", plus "Flat" where Meena owes ₹500. Saved WITHOUT a payments key, as old data is.
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
const HELPERS = `
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const money = (t) => { const m = String(t).match(/₹([\\d,]+(?:\\.\\d+)?)/); return m ? Number(m[1].replace(/,/g, "")) : null; };
  const groupRow = (line) => [...document.querySelectorAll("#gSettle li")].find((li) => li.querySelector(".name").textContent === line);
  const friendRow = (n) => [...document.querySelectorAll("#friends li")].find((li) => li.querySelector(".name") && li.querySelector(".name").textContent.startsWith(n));
  const button = (li, text) => [...li.querySelectorAll("button")].find((b) => b.textContent === text);
  const groupScreen = async (gid) => { go("group", gid); await wait(1100);
    return { rows: Object.fromEntries([...document.querySelectorAll("#gSettle li")].map((li) => [li.querySelector(".name").textContent, money(li.querySelector("strong").textContent)])),
             others: [...document.querySelectorAll("#gOthers li")].map((li) => li.querySelector(".name").textContent + " " + money(li.querySelector("strong").textContent)),
             card: (document.getElementById("gBal").className === "owe" ? -1 : 1) * money(document.getElementById("gBal").textContent) }; };
  const friendsTab = async () => { go("friends"); await wait(900);
    return Object.fromEntries([...document.querySelectorAll("#friends li")].map((li) => [li.querySelector(".name").textContent.replace(/[^A-Za-z ]/g, "").trim(), (li.querySelector(".amt.owe") ? -1 : 1) * (money(li.querySelector(".amt strong").textContent) || 0)])); };
  const homeAndGroups = async () => { go("home"); await wait(700); const getBack = money($("getBack").textContent);
    go("groups"); await wait(900);
    return { getBack, groups: Object.fromEntries([...document.querySelectorAll("#groups li")].map((li) => [li.querySelector(".name").textContent, money(li.querySelector(".amt strong").textContent) || 0])) }; };
  const reminderFrom = async (li) => { li.querySelector(".wa").click(); await wait(500); const r = { title: $("remindTitle").textContent, text: $("remindText").value }; closeRemind(); await wait(400); return r; };
  const explainTotal = async (friend, gid) => { openExplain(friend, gid); await wait(1200); const s = [...document.querySelectorAll("#explainList strong")];
    const r = { title: $("explainTitle").textContent, total: (s[s.length - 1].textContent.trim()[0] === "−" ? -1 : 1) * money(s[s.length - 1].textContent), payments: [...document.querySelectorAll("#explainList li")].filter((li) => li.querySelector(".name").textContent === "Payment").length };
    closeExplain(); await wait(400); return r; };
  const sheet = () => ({ open: !$("pay").hidden, chooser: !$("payGroupPick").hidden, chips: [...document.querySelectorAll("#payGroupChips .chip")].map((c) => c.textContent + (c.classList.contains("on") ? " [on]" : "")),
    dirIn: $("payIn").classList.contains("on"), amount: $("payAmount").value, note: $("payNote").textContent, save: !$("paySave").disabled, pick: !$("payGroupProblem").hidden });
  const typeAmount = (v) => { $("payAmount").value = v; $("payAmount").dispatchEvent(new Event("input")); };
`;
let failed = 0;
const check = (name, ok, got) => { console.log((ok ? "PASS " : "FAIL ") + name + (ok ? "" : " | got: " + JSON.stringify(got))); if (!ok) failed++; };

try {
  await send("Page.enable"); await open("home");
  await run(`localStorage.setItem("voice-split-v2", ${JSON.stringify(JSON.stringify(SEED))})`);
  await open("home");
  const loaded = await run(`return JSON.parse(localStorage.getItem("voice-split-v2")).groups.map((g) => Array.isArray(g.payments) && g.payments.length === 0)`);
  check("data saved before payments loads, and each group gets an empty payments list", loaded.every(Boolean), loaded);

  const before = await run(`return { home: await homeAndGroups(), group: await groupScreen("tg"), friends: await friendsTab() }`);
  check("before: group rows Meena ₹1,000 and Arun ₹900, card ₹1,900", before.group.rows["Meena pays you"] === 1000 && before.group.rows["Arun pays you"] === 900 && before.group.card === 1900, before.group);
  check("before: Home ₹2,400 and the Groups list Test group ₹1,900", before.home.getBack === 2400 && before.home.groups["Test group"] === 1900, before.home);

  // 1. From the group row: the group is known, the amount is filled in, and we pay ₹100.
  const s1 = await run(`await groupScreen("tg"); button(groupRow("Meena pays you"), "Record payment").click(); await wait(900); const s = sheet(); typeAmount("100"); await wait(100); return { s, after: sheet() }`);
  check("group row: no group question, Meena paid you, ₹1,000 filled in", s1.s.open && !s1.s.chooser && s1.s.dirIn && s1.s.amount === "1000" && s1.s.save, s1.s);
  check("group row: the note says what's left", s1.after.note === "After this, Meena will owe you ₹900 in Test group.", s1.after.note);
  await run(`$("paySave").click(); await wait(1200); return true`);

  const after = await run(`const g = await groupScreen("tg");
    const meenaG = await reminderFrom(groupRow("Meena pays you")), arunG = await reminderFrom(groupRow("Arun pays you"));
    const exG = await explainTotal("Meena", "tg");
    const f = await friendsTab(); const meenaF = await reminderFrom(friendRow("Meena")); const exF = await explainTotal("Meena");
    return { g, meenaG, arunG, exG, f, meenaF, exF, home: await homeAndGroups() }`);
  check("after ₹100: group row Meena ₹900, Arun ₹900, card ₹1,800", after.g.rows["Meena pays you"] === 900 && after.g.rows["Arun pays you"] === 900 && after.g.card === 1800, after.g);
  check("after ₹100: Between others still Meena pays Arun ₹100", after.g.others.length === 1 && after.g.others[0] === "Meena pays Arun 100", after.g.others);
  check("after ₹100: group reminder says the rest and thanks for ₹100", after.meenaG.title === "Remind Meena about ₹900 (Test group)" && after.meenaG.text.includes("the rest of your share for Test group comes to ₹900. Thanks for the ₹100 you already sent!"), after.meenaG);
  check("Arun has paid nothing, so his reminder is unchanged", after.arunG.text.includes("Quick reminder: your share for Test group comes to ₹900.") && !after.arunG.text.includes("rest") && !after.arunG.text.includes("Thanks for"), after.arunG);
  check("group explain totals the row and lists the payment", after.exG.title === "You and Meena in Test group" && after.exG.total === 900 && after.exG.payments === 1, after.exG);
  check("Friends: Meena ₹1,400 (₹900 Test group + ₹500 Flat), Arun ₹900", after.f.Meena === 1400 && after.f.Arun === 900, after.f);
  check("Friends reminder says the rest, across all groups", after.meenaF.title === "Remind Meena about ₹1,400" && after.meenaF.text.includes("the rest of your share of our shared expenses comes to ₹1,400. Thanks for the ₹100 you already sent!"), after.meenaF);
  check("Friends explain totals the row and lists the payment", after.exF.total === 1400 && after.exF.payments === 1, after.exF);
  check("Home 'You get back' went from ₹2,400 to ₹2,300", after.home.getBack === 2300, after.home);
  check("Groups list row went from ₹1,900 to ₹1,800", after.home.groups["Test group"] === 1800 && after.home.groups["Flat"] === 500, after.home);

  // 2. From Friends, two groups with a balance: the sheet asks, and Save waits for a group.
  const s2 = await run(`await friendsTab(); button(friendRow("Meena"), "Record payment").click(); await wait(1200); const s = sheet();
    [...document.querySelectorAll("#payGroupChips .chip")].find((c) => c.textContent.startsWith("Flat")).click(); await wait(100);
    const picked = sheet(); typeAmount("33.33"); await wait(100); const typed = sheet(); $("paySave").click(); await wait(1200); return { s, picked, typed }`);
  check("Friends: asks which group, with each group's amount, none chosen yet", s2.s.chooser && s2.s.chips.join("|") === "Test group · owes you ₹900|Flat · owes you ₹500" && !s2.s.save && s2.s.pick, s2.s);
  check("Friends: picking Flat fills in ₹500 and turns Save on", s2.picked.amount === "500" && s2.picked.save && !s2.picked.pick, s2.picked);
  const odd = await run(`return { flat: await groupScreen("fl"), f: await friendsTab() }`);
  check("an odd amount, ₹33.33, leaves Flat at ₹466.67 and Friends at ₹1,366.67", odd.flat.rows["Meena pays you"] === 466.67 && odd.f.Meena === 1366.67, odd);

  // 3. One shared group with a balance: it is chosen already, but still shown.
  const s3 = await run(`await friendsTab(); button(friendRow("Arun"), "Record payment").click(); await wait(1200); const s = sheet(); closePayment(); await wait(400); return s`);
  check("Friends: one group with a balance is pre-selected and still visible", s3.chooser && s3.chips.length === 1 && s3.chips[0].endsWith("[on]") && s3.save && s3.amount === "900", s3);

  // 4. Overpay, then pay back in the other direction exactly.
  const s4 = await run(`await groupScreen("tg"); button(groupRow("Arun pays you"), "Record payment").click(); await wait(900); typeAmount("1000"); await wait(100); const s = sheet(); $("paySave").click(); await wait(1200); return { s, g: await groupScreen("tg") }`);
  check("overpay: the note says ₹100 more, and that you'll owe Arun ₹100", s4.s.note === "That's ₹100 more than Arun owes you. After this, you will owe Arun ₹100 in Test group.", s4.s.note);
  check("overpay: the row flips to 'You pay Arun ₹100'", s4.g.rows["You pay Arun"] === 100 && !("Arun pays you" in s4.g.rows), s4.g);
  const s5 = await run(`button(groupRow("You pay Arun"), "Record payment").click(); await wait(900); const s = sheet(); $("paySave").click(); await wait(1200); return { s, g: await groupScreen("tg"), f: await friendsTab() }`);
  check("other direction: 'You paid Arun' is chosen with ₹100 filled in", !s5.s.dirIn && s5.s.amount === "100" && s5.s.note === "After this, you and Arun will be settled up in Test group.", s5.s);
  check("paying exactly the row makes it disappear, in the group and in Friends", !("You pay Arun" in s5.g.rows) && !("Arun pays you" in s5.g.rows) && (s5.f.Arun || 0) === 0, s5);

  // 5. Delete the ₹33.33 payment: Flat goes back to ₹500.
  const del = await run(`window.confirm = () => true; go("group", "fl"); await wait(900);
    const li = [...document.querySelectorAll("#gExpenses li")].find((x) => x.textContent.includes("Meena paid you") && x.textContent.includes("₹33.33"));
    button(li, "Delete").click(); await wait(1200); return { flat: await groupScreen("fl"), f: await friendsTab() }`);
  check("deleting a payment restores the amount exactly", del.flat.rows["Meena pays you"] === 500 && del.f.Meena === 1400, del);

  // 6. Payments are kept after a reload, and spending did not change.
  await open("home");
  const kept = await run(`return { stored: JSON.parse(localStorage.getItem("voice-split-v2")).groups.map((g) => g.payments.map((p) => p.from + ">" + p.to + ":" + p.amount)),
    g: await groupScreen("tg"), spent: document.getElementById("gShareNote").textContent }`);
  check("after a reload the payments are still there, in whole paise", JSON.stringify(kept.stored) === JSON.stringify([["Meena>You:10000", "Arun>You:100000", "You>Arun:10000"], []]), kept.stored);
  check("after a reload the rows are the same, and spending is still ₹4,200", kept.g.rows["Meena pays you"] === 900 && kept.spent.includes("4,200"), kept);
} finally { ws.close(); chrome.kill(); await sleep(300); rmSync(profile, { recursive: true, force: true }); }
console.log(failed ? `\n${failed} check(s) failed` : "\nAll checks passed");
process.exit(failed ? 1 : 0);
