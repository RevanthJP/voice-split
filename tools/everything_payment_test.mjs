// Checks "Everything with {name}" in the payment sheet: offered and chosen from Friends when two or more scopes
// (groups and/or No group) have a balance; it records one payment per scope for exactly that scope's balance,
// so every scope ends at zero, in mixed directions too, and when the net is zero. Also: single scopes and
// partial amounts still work, the overpay hint points to Everything only when other scopes exist, a group's
// Settle Up keeps its own group, one Everything payment can be deleted on its own, the Who owes whom chart
// shows paise like the rows, and the delete-sheet wording. No AI calls. Needs Google Chrome and the app on
// localhost:8502. Usage: node tools/everything_payment_test.mjs
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PORT = 9345, profile = mkdtempSync(join(tmpdir(), "kitty-everything-"));
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
      { v: (li.querySelector(".amt.owe") ? -1 : 1) * (money(li.querySelector(".amt strong").textContent) || 0), label: li.querySelector(".amt small").textContent, text: li.querySelector(".amt strong").textContent }])); };
  const settle = async (gid) => { go("group", gid); await wait(1100);
    return Object.fromEntries([...document.querySelectorAll("#gSettle li")].map((li) => [li.querySelector(".name").textContent, money(li.querySelector("strong").textContent)])); };
  const openPayFor = async (n) => { go("friends"); await wait(900); [...friendRow(n).querySelectorAll("button")].find((b) => b.textContent === "Record payment").click(); await wait(1300); };
  const sheet = () => ({ open: !$("pay").hidden, chooser: !$("payGroupPick").hidden, chips: [...document.querySelectorAll("#payGroupChips .chip")].map((c) => c.textContent + (c.classList.contains("on") ? " [on]" : "")),
    dirIn: $("payIn").classList.contains("on"), dirOut: $("payOut").classList.contains("on"), dirLocked: $("payIn").disabled && $("payOut").disabled,
    amount: $("payAmount").value, readOnly: $("payAmount").readOnly, note: $("payNote").textContent, save: !$("paySave").disabled });
  const chip = (start) => [...document.querySelectorAll("#payGroupChips .chip")].find((c) => c.textContent.startsWith(start));
  const typeAmount = (v) => { $("payAmount").value = v; $("payAmount").dispatchEvent(new Event("input")); };
  const savePay = async () => { $("paySave").click(); await wait(1300); };
  const close = async () => { closePayment(); await wait(400); };
`;
const run = async (expression) => {
  const r = await send("Runtime.evaluate", { expression: `(async () => { ${HELPERS} ${expression} })()`, awaitPromise: true, returnByValue: true });
  if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 600));
  return r.result.result.value;
};
const open = async () => { await send("Page.navigate", { url: `http://localhost:8502/?${Date.now()}#home` }); await sleep(1400); };
const setState = async (s) => { await open(); await run(`localStorage.clear(); localStorage.setItem("voice-split-v2", ${JSON.stringify(JSON.stringify(s))}); return true`); await open(); };
const exp = (id, description, total, payer, participants, day) => ({ id, at: `2026-11-${day}T10:00:00.000Z`, description, total, payer, participants, mode: "equal", values: {}, items: [] });
const base = (more) => ({ profile: { name: "Asha", phone: "", upi: "", lang: "" }, friends: [], onboarded: 6, contactsAsked: true, current: "g1", ...more });
let failed = 0;
const check = (name, ok, got) => { console.log((ok ? "PASS " : "FAIL ") + name + (ok ? "" : " | got: " + JSON.stringify(got))); if (!ok) failed++; };

// The reported case: Aro owes you ₹994.66 in Goa trip and ₹41.50 in "Aro and Me" (₹1,036.16 in all)
const ARO = base({ groups: [
  { id: "g1", name: "Goa trip", people: ["You", "Aro", "Ravi"], expenses: [exp("e1", "Hotel", 1989.32, "You", ["You", "Aro"], "02"), exp("e2", "Cab", 300, "You", ["You", "Ravi"], "03")] },
  { id: "g2", name: "Aro and Me", people: ["You", "Aro"], expenses: [exp("e3", "Snacks", 83, "You", ["You", "Aro"], "04")] }] });

try {
  await send("Page.enable");
  await setState(ARO);

  // (6) Opened from a group's Settle Up: that group, no Everything; overpay there points to Friends
  const fromGroup = await run(`await settle("g1"); [...[...document.querySelectorAll("#gSettle li")].find((li) => li.textContent.includes("Aro pays you")).querySelectorAll("button")].find((b) => b.textContent === "Record payment").click(); await wait(1300);
    const s = sheet(); typeAmount("1036.16"); await wait(200); const over = sheet(); await close(); return { s, over }`);
  check("(6) from Goa trip's Settle Up: Goa trip is chosen (no choice shown, no Everything), ₹994.66 filled in", !fromGroup.s.chooser && fromGroup.s.amount === "994.66" && fromGroup.s.dirIn && !fromGroup.s.chips.some((c) => c.startsWith("Everything")), fromGroup.s);
  check("(4) overpaying there, with another scope open, says so and points to Friends → Everything",
    fromGroup.over.note === "That's ₹41.50 more than Aro owes you in Goa trip. To settle all balances, record it from Friends and choose Everything. After this, you will owe Aro ₹41.50 in Goa trip.", fromGroup.over.note);

  // (1) From Friends: Everything is chosen, the net is read-only, the note lists what it clears
  const one = await run(`await openPayFor("Aro"); const s = sheet();
    chip("Goa trip").click(); await wait(200); typeAmount("1036.16"); await wait(200); const single = sheet();
    chip("Everything").click(); await wait(200); const back = sheet(); await savePay();
    const st = saved(); const after = { f: await friendsTab(), g1: await settle("g1"), g2: await settle("g2") };
    await openPayFor("Aro"); const again = sheet(); await close();
    return { s, single, back, after, again, pays: st.groups.map((g) => (g.payments || []).map((p) => p.from + ">" + p.to + ":" + p.amount + "@" + p.at)) }`);
  check("(1) Aro: 'Everything · owes you ₹1,036.16' is offered first and chosen, with both groups still listed",
    JSON.stringify(one.s.chips) === JSON.stringify(["Everything · owes you ₹1,036.16 [on]", "Goa trip · owes you ₹994.66", "Aro and Me · owes you ₹41.50"]), one.s.chips);
  check("(1) Everything: ₹1,036.16 read-only, 'Aro paid you' set by the net and locked, note 'Clears Goa trip ₹994.66 and Aro and Me ₹41.50.'",
    one.s.amount === "1036.16" && one.s.readOnly && one.s.dirIn && one.s.dirLocked && one.s.note === "Clears Goa trip ₹994.66 and Aro and Me ₹41.50." && one.s.save, one.s);
  check("(4) picking one group then typing the whole ₹1,036.16 gives the hint to choose Everything",
    one.single.note === "That's ₹41.50 more than Aro owes you in Goa trip. Choose Everything to settle all balances. After this, you will owe Aro ₹41.50 in Goa trip." && !one.single.readOnly && !one.single.dirLocked, one.single);
  check("(1) going back to Everything restores the net and locks it again", one.back.amount === "1036.16" && one.back.readOnly && one.back.dirLocked, one.back);
  const [p1, p2] = one.pays;
  check("(1) saving records one payment per group, for exactly its balance, with the same time", p1.length === 1 && p2.length === 1 && p1[0].startsWith("Aro>You:99466@") && p2[0].startsWith("Aro>You:4150@") && p1[0].split("@")[1] === p2[0].split("@")[1], one.pays);
  check("(1) afterwards: no Aro row in either group's Settle Up, Friends says settled up", !Object.keys(one.after.g1).some((k) => k.includes("Aro")) && !Object.keys(one.after.g2).some((k) => k.includes("Aro"))
    && one.after.f.Aro.v === 0 && one.after.f.Aro.label === "settled up", one.after);
  check("(1) reopening shows nothing to settle: no Everything, every scope settled, Save off",
    JSON.stringify(one.again.chips) === JSON.stringify(["Goa trip · settled", "Aro and Me · settled"]) && !one.again.save && one.again.amount === "", one.again);

  // (5) Deleting one of the Everything payments restores only that group
  const five = await run(`window.confirm = () => true; go("group", "g1"); await wait(1000);
    [...document.querySelectorAll("#gExpenses li")].find((li) => li.textContent.includes("Aro paid you")).querySelector("button").click(); await wait(1200);
    return { f: await friendsTab(), g1: await settle("g1"), g2: await settle("g2"), stored: saved().groups.map((g) => (g.payments || []).length) }`);
  check("(5) deleting the Goa trip payment brings back only Goa trip's ₹994.66; Aro and Me stays settled",
    five.g1["Aro pays you"] === 994.66 && !Object.keys(five.g2).length && five.f.Aro.v === 994.66 && JSON.stringify(five.stored) === "[0,1]", five);

  // (4) A single scope and a partial amount still work; with no other open scope there is no Everything hint
  const four = await run(`await openPayFor("Aro"); const s = sheet(); typeAmount("500"); await wait(200); const part = sheet(); await savePay();
    const g1 = await settle("g1"); await openPayFor("Aro"); typeAmount("600"); await wait(200); const over = sheet(); await close(); return { s, part, g1, over }`);
  check("(4) only Goa trip has a balance: it alone is chosen (no Everything), ₹994.66 filled in", JSON.stringify(four.s.chips) === JSON.stringify(["Goa trip · owes you ₹994.66 [on]", "Aro and Me · settled"]) && four.s.amount === "994.66", four.s);
  check("(4) a partial ₹500 leaves Goa trip at ₹494.66", four.part.note === "After this, Aro will owe you ₹494.66 in Goa trip." && four.g1["Aro pays you"] === 494.66, four);
  check("(4) overpaying with no other open scope: the plain note, no Everything hint", four.over.note === "That's ₹105.34 more than Aro owes you. After this, you will owe Aro ₹105.34 in Goa trip.", four.over.note);

  // (2) mixed directions, (3) a group and No group, and a net of zero
  await setState(base({ groups: [{ id: "g1", name: "Goa trip", people: ["You", "Arun", "Ravi", "Meena"],
      expenses: [exp("e1", "Snacks", 200, "You", ["You", "Arun"], "02"), exp("e2", "Fuel", 400, "You", ["You", "Ravi"], "02"), exp("e3", "Tickets", 600, "You", ["You", "Meena"], "02")] }],
    oneOffs: [exp("o1", "Dinner", 1000, "Arun", ["You", "Arun"], "03"), exp("o2", "Tea", 100, "You", ["You", "Ravi"], "03"), exp("o3", "Books", 600, "Meena", ["You", "Meena"], "03")] }));
  const two = await run(`await openPayFor("Arun"); const s = sheet(); await savePay();
    const st = saved(); return { s, f: await friendsTab(), g1: await settle("g1"), group: (st.groups[0].payments || []).map((p) => p.from + ">" + p.to + ":" + p.amount), none: st.oneOffPayments.map((p) => p.from + ">" + p.to + ":" + p.amount) }`);
  check("(2) mixed: Everything 'you owe ₹400' is chosen, 'You paid Arun' locked, ₹400, and the note names both directions",
    two.s.chips[0] === "Everything · you owe ₹400 [on]" && two.s.amount === "400" && two.s.dirOut && two.s.dirLocked
    && two.s.note === "Clears Goa trip (Arun owes you ₹100) and No group (you owe Arun ₹500).", two.s);
  check("(2) saving records both: Arun paid you ₹100 in Goa trip, you paid Arun ₹500 with no group; both scopes zero, Friends settled",
    two.group.includes("Arun>You:10000") && two.none.includes("You>Arun:50000") && two.f.Arun.v === 0 && !Object.keys(two.g1).some((k) => k.includes("Arun")), two);
  const three = await run(`await openPayFor("Ravi"); const s = sheet(); await savePay(); return { s, f: await friendsTab(), g1: await settle("g1"), none: saved().oneOffPayments.filter((p) => p.from === "Ravi").map((p) => p.amount) }`);
  check("(3) Ravi: Goa trip ₹200 and No group ₹50 both clear with Everything ₹250", three.s.chips[0] === "Everything · owes you ₹250 [on]" && three.s.note === "Clears Goa trip ₹200 and No group ₹50."
    && three.f.Ravi.v === 0 && !Object.keys(three.g1).some((k) => k.includes("Ravi")) && JSON.stringify(three.none) === "[5000]", three);
  const zero = await run(`await openPayFor("Meena"); const s = sheet(); await savePay(); const f = await friendsTab(); await openPayFor("Meena"); const again = sheet(); await close(); return { s, f, again, g1: await settle("g1") }`);
  check("(net zero) Meena: ₹300 each way: 'Everything · evens out', ₹0, and the note says no money changes hands",
    zero.s.chips[0] === "Everything · evens out [on]" && zero.s.amount === "0" && zero.s.save
    && zero.s.note === "These balances cancel out, so no money changes hands. Saving clears Goa trip (Meena owes you ₹300) and No group (you owe Meena ₹300).", zero.s);
  check("(net zero) saving clears both scopes: nothing left with Meena anywhere", zero.f.Meena.v === 0 && !Object.keys(zero.g1).some((k) => k.includes("Meena"))
    && JSON.stringify(zero.again.chips) === JSON.stringify(["Goa trip · settled", "No group · settled"]), zero);

  // (7) The Who owes whom chart shows the same amounts as the rows, with paise
  await setState(base({ groups: [], current: null, oneOffs: [exp("o1", "Cab", 633, "You", ["You", "Kavya"], "05"), exp("o2", "Lunch", 344.02, "You", ["You", "Priya"], "05"), exp("o3", "Rent", 1200, "You", ["You", "Sam"], "05")] }));
  const seven = await run(`const f = await friendsTab(); await wait(500);
    const vals = [...document.querySelectorAll("#friendsChart text.val")].map((t) => t.textContent);
    const right = Math.max(...[...document.querySelectorAll("#friendsChart text")].map((t) => { const b = t.getBBox(); return b.x + b.width; }));
    return { rows: [f.Kavya.text, f.Priya.text, f.Sam.text], vals, right, width: document.querySelector("#friendsChart svg").viewBox.baseVal.width }`);
  check("(7) rows and chart agree with paise: ₹316.50, ₹172.01, and ₹600 stays whole", JSON.stringify(seven.rows) === JSON.stringify(["₹316.50", "₹172.01", "₹600"])
    && ["₹316.50", "₹172.01", "₹600"].every((v) => seven.vals.includes(v)) && !seven.vals.some((v) => v === "₹317" || v === "₹172"), seven);
  check("(7) the longer labels still fit inside the chart", seven.right <= seven.width, seven);

  // (8) Delete-sheet wording, for a one-off expense and a one-off payment
  const eight = await run(`go("home"); await wait(800); [...document.querySelectorAll("#recent li")].find((li) => li.textContent.includes("Cab")).click(); await wait(500);
    const expense = $("ooNote").textContent; closeOneOff(); await wait(400);
    await openPayFor("Kavya"); await savePay(); go("friends"); await wait(800); openExplain("Kavya"); await wait(1200);
    [...document.querySelectorAll("#explainList li")].find((li) => li.textContent.includes("Payment")).querySelector("button").click(); await wait(600);
    const payment = $("ooNote").textContent; closeOneOff(); await wait(400); return { expense, payment }`);
  check("(8) one-off delete sheet: 'This expense isn't in a group. Deleting it removes it from all balances.'", eight.expense === "This expense isn't in a group. Deleting it removes it from all balances.", eight);
  check("(8) payment delete sheet: plain wording too", eight.payment === "This payment isn't in a group. Deleting it puts ₹316.50 back into your balance with Kavya.", eight);
} finally { ws.close(); chrome.kill(); await sleep(300); rmSync(profile, { recursive: true, force: true }); }
console.log(failed ? `\n${failed} check(s) failed` : "\nAll checks passed");
process.exit(failed ? 1 : 0);
