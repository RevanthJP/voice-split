// Checks expenses with no group: a fresh install has no groups, an expense from Home with no groups saves as
// a one-off with no group step, one-offs show in Friends, Home, Explain and export as "No group" but never in
// a group's balance, the group step with one and with two groups offers "No group", existing data loads
// unchanged, and the last group can be deleted. The AI reading is replaced by a fixed expense sent through
// the real /api/check (no key, no AI calls). Needs Google Chrome and the app on localhost:8502.
// Usage: node tools/no_group_test.mjs
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PORT = 9343, profile = mkdtempSync(join(tmpdir(), "kitty-nogroup-"));
const chrome = spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", ["--headless=new",
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "--no-first-run", "--autoplay-policy=no-user-gesture-required",
  "--window-size=390,844", "about:blank"], { stdio: "ignore" });
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
// You paid ₹900 for dinner with Meena: Meena owes you ₹450 for each one saved
const EXPENSE = { description: "Dinner", total: 900, payer: "You", participants: ["You", "Meena"], mode: "equal", values: {}, items: [] };
const HELPERS = `
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  if (!window.__readStub) {
    const real = window.fetch;
    window.fetch = (u, o) => /\\/api\\/read-(text|audio)/.test(String(u))
      ? real("/api/check", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expense: ${JSON.stringify(EXPENSE)}, people: [] }) })
      : real(u, o);
    window.__readStub = true;
  }
  const saved = () => JSON.parse(localStorage.getItem("voice-split-v2"));
  const typeIt = async () => { go("home"); await wait(200); $("typed").value = "Dinner 900 with Meena"; $("typeForm").requestSubmit(); await wait(1300); };
  const sayIt = async () => { navigator.mediaDevices.getUserMedia = async () => { const c = new AudioContext(), o = c.createOscillator(), g = c.createGain(); g.gain.value = 0.07;
      const d = c.createMediaStreamDestination(); o.connect(g).connect(d); o.start(); return d.stream; };
    go("home"); await wait(200); document.querySelector(".fab").click(); await wait(1300); take.rec.stop(); await wait(1600); };
  const sheet = () => ({ open: !$("card").hidden, draftGroup, chips: $("groupPick").hidden ? null : [...document.querySelectorAll("#groupChips .chip")].map((c) => c.textContent),
    ask: $("groupPick").hidden ? "" : $("groupProblem").textContent, menu: $("sheetGroupRow").hidden ? null : [...$("sheetGroup").options].map((o) => o.textContent),
    menuValue: $("sheetGroup").value, save: !$("save").disabled, listenLabel: $("listenGroup").textContent });
  const friendRow = (n) => { const li = [...document.querySelectorAll("#friends li")].find((l) => l.querySelector(".name") && l.querySelector(".name").textContent.startsWith(n));
    return li && { amount: li.querySelector(".amt strong").textContent, label: li.querySelector(".amt small").textContent, remind: !!li.querySelector(".wa"), buttons: [...li.querySelectorAll("button")].map((b) => b.textContent.trim()).filter(Boolean) }; };
  const createGroup2 = async (name) => { go("groups"); await wait(200); $("newGroupName").value = name; $("newGroup").requestSubmit(); await wait(700); };
`;
const run = async (expression) => {
  const r = await send("Runtime.evaluate", { expression: `(async () => { ${HELPERS} ${expression} })()`, awaitPromise: true, returnByValue: true });
  if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 500));
  return r.result.result.value;
};
const open = async (hash = "home") => { await send("Page.navigate", { url: `http://localhost:8502/?${Date.now()}#${hash}` }); await sleep(1400); };
const clean = async () => { await open(); await run(`localStorage.clear(); return true`); await open(); };
const setState = async (s, extra = "") => { await open(); await run(`localStorage.clear(); ${extra} localStorage.setItem("voice-split-v2", ${JSON.stringify(JSON.stringify(s))}); return true`); await open(); };
const base = (more) => ({ profile: { name: "Asha", phone: "", upi: "", lang: "" }, friends: [], onboarded: 6, contactsAsked: true, ...more });
let failed = 0;
const check = (name, ok, got) => { console.log((ok ? "PASS " : "FAIL ") + name + (ok ? "" : " | got: " + JSON.stringify(got))); if (!ok) failed++; };

try {
  await send("Page.enable");

  // a) A fresh install: no groups, and no "Friends" group anywhere
  await clean();
  const fresh = await run(`$("introSkip").click(); await wait(500); $("oName").value = "Asha"; $("setupDone").click(); await wait(900);
    const s = saved(); go("groups"); await wait(700);
    return { groups: s.groups.length, oneOffs: s.oneOffs, friendsGroup: JSON.stringify(s).includes('"name":"Friends"'), rows: document.querySelectorAll("#groups li").length,
      form: !$("newGroup").hidden && getComputedStyle($("newGroup")).display !== "none", ideas: [...document.querySelectorAll("#groupIdeas .chip")].length, tips: !$("groupsTips").hidden }`);
  check("a) fresh install: zero groups, an empty one-off list, and no Friends group", fresh.groups === 0 && Array.isArray(fresh.oneOffs) && !fresh.oneOffs.length && !fresh.friendsGroup, fresh);
  check("a) Groups tab with no groups is usable: the create form, the idea chips and the tips show", fresh.rows === 0 && fresh.form && fresh.ideas > 0 && fresh.tips, fresh);

  // b) With no groups, typed and spoken expenses from Home have no group step and save as one-offs
  const typed = await run(`await typeIt(); const s = sheet(); $("save").click(); await wait(900); const st = saved(); return { s, oneOffs: st.oneOffs.length, groups: st.groups.length, toast: $("toast").textContent }`);
  check("b) typed, no groups: no group chips, no Group menu, Save on", typed.s.open && typed.s.chips === null && typed.s.menu === null && typed.s.save && typed.s.draftGroup === "none", typed.s);
  check("b) typed: saved as a one-off, still no group made", typed.oneOffs === 1 && typed.groups === 0 && typed.toast === "Saved Dinner", typed);
  const spoken = await run(`await sayIt(); const s = sheet(); $("save").click(); await wait(900); const st = saved(); return { s, oneOffs: st.oneOffs.length, groups: st.groups.length }`);
  check("b) mic, no groups: no 'You'll choose the group next', no group step, Save on, saved as a one-off",
    spoken.s.open && spoken.s.listenLabel === "" && spoken.s.chips === null && spoken.s.menu === null && spoken.s.save && spoken.oneOffs === 2 && spoken.groups === 0, spoken);

  // c) The one-offs show in Friends, Home, Explain and export, labelled "No group"
  const seen = await run(`go("friends"); await wait(1200); const meena = friendRow("Meena");
    go("home"); await wait(1000); const row = [...document.querySelectorAll("#recent li")][0];
    const home = { text: row.textContent, tap: row.classList.contains("tap") }; row.click(); await wait(300); home.stayed = !$("view-home").hidden;
    go("friends"); await wait(300); openExplain("Meena"); await wait(1200);
    const rows = [...document.querySelectorAll("#explainList li")].map((l) => l.textContent);
    const explain = { lines: rows.slice(0, -1), total: rows[rows.length - 1] || "" }; // the last row is the total
    closeExplain(); await wait(400);
    go("account"); await wait(500); $("xRange").value = "all"; // the period starts on last month; the one-offs are from today
    const options = [...$("xGroup").options].map((o) => o.textContent);
    const all = exportRows(); $("xGroup").value = "none"; $("xGroup").dispatchEvent(new Event("change")); await wait(200); const only = exportRows();
    return { meena, home, explain, options, allGroups: all.rows.map((e) => e._group), onlyCount: only.rows.length, onlyTitle: only.title }`);
  check("c) Friends: Meena owes you ₹900 from the two one-offs, with Send reminder", seen.meena && seen.meena.amount === "₹900" && seen.meena.label === "owes you" && seen.meena.remind, seen.meena);
  check("c) Home: the row says 'No group' (never 'undefined') and isn't a link", seen.home.text.includes("No group") && !seen.home.text.includes("undefined") && !seen.home.tap && seen.home.stayed, seen.home);
  check("c) Explain for Meena lists both one-offs and adds up to ₹900", seen.explain.lines.length === 2 && seen.explain.lines.every((l) => l.includes("Dinner")) && seen.explain.total.includes("2 expenses") && seen.explain.total.includes("₹900"), seen.explain);
    check("c) export: rows say 'No group', and the filter can pick 'No group'", seen.allGroups.length === 2 && seen.allGroups.every((g) => g === "No group") && seen.options.includes("No group")
    && seen.onlyCount === 2 && seen.onlyTitle === "Kitty: No group, All time", seen);

  // d) One group: chosen already, the menu offers No group. Two groups: ask, with a No group chip.
  const one = await run(`await createGroup2("Goa trip"); const gid = saved().groups[0].id; await typeIt(); const s = sheet();
    $("sheetGroup").value = "none"; $("sheetGroup").dispatchEvent(new Event("change")); await wait(800); const switched = sheet();
    $("save").click(); await wait(900); const st = saved(); return { gid, s, switched, oneOffs: st.oneOffs.length, groupExpenses: st.groups[0].expenses.length }`);
  check("d) one group: it is chosen and shown in the Group menu, which also offers 'No group'", one.s.draftGroup === one.gid && one.s.chips === null && JSON.stringify(one.s.menu) === JSON.stringify(["Goa trip", "No group"]) && one.s.save, one.s);
  check("d) one group: switching the menu to 'No group' saves it as a one-off", one.switched.draftGroup === "none" && one.switched.save && one.oneOffs === 3 && one.groupExpenses === 0, one);
  const two = await run(`await createGroup2("Flat"); await typeIt(); const first = sheet(); await wait(700); const later = sheet();
    [...document.querySelectorAll("#groupChips .chip")].find((c) => c.textContent === "No group").click(); await wait(800); const picked = sheet();
    $("save").click(); await wait(900); const st = saved(); return { first, later, picked, oneOffs: st.oneOffs.length, groupExpenses: st.groups.map((g) => g.expenses.length) }`);
  check("d) two groups: 'Add to a group?' with the group chips and a 'No group' chip; Save off; nothing chosen for you",
    two.first.ask === "Add to a group?" && JSON.stringify(two.first.chips.map((c) => c.replace(" · Suggested", ""))) === JSON.stringify(["Goa trip", "Flat", "No group"]) && !two.first.save && !two.later.save && two.later.draftGroup === null, two.first);
  check("d) two groups: tapping 'No group' turns Save on and saves a one-off", two.picked.draftGroup === "none" && two.picked.save && two.oneOffs === 4 && JSON.stringify(two.groupExpenses) === "[0,0]", two);

  // e) An existing user with a saved Friends group and expenses loads unchanged; first-version data still moves into Friends
  const FRIENDS = { id: "f", name: "Friends", people: ["You", "Arun"], expenses: [{ id: "x1", at: "2026-11-01T10:00:00.000Z", description: "Lunch", total: 400, payer: "You", participants: ["You", "Arun"], mode: "equal", values: {}, items: [] }] };
  await setState(base({ groups: [FRIENDS], current: "f" }));
  const existing = await run(`const s = state; go("friends"); await wait(1200);
    return { group: JSON.stringify(s.groups[0]), groups: s.groups.length, current: s.current, oneOffs: s.oneOffs, arun: friendRow("Arun") }`);
  check("e) existing user: the Friends group and its expense are unchanged, one-offs start empty, Arun owes ₹200",
    existing.group === JSON.stringify(FRIENDS) && existing.groups === 1 && existing.current === "f" && Array.isArray(existing.oneOffs) && !existing.oneOffs.length && existing.arun && existing.arun.amount === "₹200", existing);
  await open(); await run(`localStorage.clear(); localStorage.setItem("voice-split-v1", JSON.stringify({ people: ["You", "Ravi"], expenses: [{ id: "o1", at: "2026-10-01T10:00:00.000Z", description: "Cab", total: 300, payer: "You", participants: ["You", "Ravi"], mode: "equal", values: {}, items: [] }] })); return true`); await open();
  const v1 = await run(`return { groups: state.groups.map((g) => ({ name: g.name, people: g.people, expenses: g.expenses.length })), current: state.current === (state.groups[0] || {}).id }`);
  check("e) first-version data still moves into a Friends group, as before", JSON.stringify(v1.groups) === JSON.stringify([{ name: "Friends", people: ["You", "Ravi"], expenses: 1 }]) && v1.current, v1);

  // f) The last group can be deleted, and Home still saves
  await setState(base({ groups: [{ id: "g", name: "Goa trip", people: ["You", "Arun"], expenses: [] }], current: "g" }));
  const del = await run(`window.confirm = () => true; go("group", "g"); await wait(600); $("gDelete").click(); await wait(800);
    const after = { groups: saved().groups.length, current: saved().current, onGroups: !$("view-groups").hidden, toast: $("toast").textContent, rows: document.querySelectorAll("#groups li").length };
    await typeIt(); const s = sheet(); $("save").click(); await wait(900); return { after, s, oneOffs: saved().oneOffs.length }`);
  check("f) deleting the last group works (no 'You need at least one group')", del.after.groups === 0 && del.after.current === null && del.after.onGroups && del.after.toast === "Group deleted" && del.after.rows === 0, del.after);
  check("f) then Home still saves, as a one-off with no group step", del.s.chips === null && del.s.menu === null && del.s.save && del.oneOffs === 1, del);

  // g) One-offs never count in a group's balance or its share chart
  const GROUP_EXP = { id: "e1", at: "2026-11-02T10:00:00.000Z", description: "Hotel", total: 1000, payer: "You", participants: ["You", "Arun"], mode: "equal", values: {}, items: [] };
  const ONE_OFF = { id: "o1", at: "2026-11-03T10:00:00.000Z", description: "Cab", total: 600, payer: "You", participants: ["You", "Arun"], mode: "equal", values: {}, items: [] };
  await setState(base({ groups: [{ id: "g", name: "Goa trip", people: ["You", "Arun"], expenses: [GROUP_EXP] }], oneOffs: [ONE_OFF], current: "g" }));
  const bal = await run(`go("groups"); await wait(1200); const row = document.querySelector("#groups li"); const groupsRow = row.querySelector(".amt strong").textContent;
    const chart = $("groupChart").textContent;
    go("group", "g"); await wait(1200); const screen = $("view-group").textContent;
    go("friends"); await wait(1200); const arun = friendRow("Arun");
    openExplain("Arun"); await wait(1200); const lines = [...document.querySelectorAll("#explainList li")].map((l) => l.textContent); closeExplain(); await wait(300);
    return { groupsRow, chart, screenHasCab: screen.includes("Cab"), screenHasHotel: screen.includes("Hotel"), arun, lines }`);
  check("g) the group's balance counts only its own expense: you get back ₹500, not ₹800", bal.groupsRow === "₹500", bal);
  check("g) the group screen lists only its own expense, and the share chart has no 'No group' bar", bal.screenHasHotel && !bal.screenHasCab && !bal.chart.includes("No group"), bal);
  check("g) Friends counts both: Arun owes you ₹800 (₹500 group + ₹300 one-off)", bal.arun && bal.arun.amount === "₹800", bal.arun);
  check("g) Explain for Arun labels each expense: 'Goa trip' for the group one, 'No group' for the one-off", bal.lines.some((l) => l.includes("Hotel") && l.includes("Goa trip ·")) && bal.lines.some((l) => l.includes("Cab") && l.includes("No group ·")), bal.lines);
  console.log("INFO Friends row for a person owing you via a one-off offers: " + JSON.stringify(bal.arun && bal.arun.buttons));
} finally { ws.close(); chrome.kill(); await sleep(300); rmSync(profile, { recursive: true, force: true }); }
console.log(failed ? `\n${failed} check(s) failed` : "\nAll checks passed");
process.exit(failed ? 1 : 0);
