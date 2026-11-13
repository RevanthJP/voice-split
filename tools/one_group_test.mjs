// Checks the group choice on the add-expense sheet opened from Home: with one group it is chosen already
// (exactly as if its chip were tapped), with two or more the person still picks one. The AI reading is
// replaced by a fixed expense sent through the real /api/check, so no key and no AI calls. Drives the real
// type box and the real mic button. Needs Google Chrome and the app on localhost:8502.
// Usage: node tools/one_group_test.mjs
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PORT = 9341, profile = mkdtempSync(join(tmpdir(), "kitty-onegroup-"));
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
// Meena is a friend who is not in the group, so the friend-not-in-group behaviour is covered too.
const EXPENSE = { description: "Dinner", total: 900, payer: "You", participants: ["You", "Meena"], mode: "equal", values: {}, items: [] };
const HELPERS = `
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  // The AI reading, replaced: read-text and read-audio answer with a fixed expense, worked out by the real /api/check.
  if (!window.__readStub) {
    const real = window.fetch;
    window.fetch = (u, o) => /\\/api\\/read-(text|audio)/.test(String(u))
      ? real("/api/check", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expense: ${JSON.stringify(EXPENSE)}, people: [] }) })
      : real(u, o);
    window.__readStub = true;
  }
  const typeIt = async () => { $("typed").value = "Dinner 900 with Meena"; $("typeForm").requestSubmit(); await wait(1200); };
  const sheet = () => ({ open: !$("card").hidden, draftGroup, chipsShown: !$("groupPick").hidden, menuShown: !$("sheetGroupRow").hidden, menu: $("sheetGroup").value,
    ask: $("groupPick").hidden ? "" : $("groupProblem").textContent, save: !$("save").disabled,
    sharers: [...document.querySelectorAll("#sharers .chip")].map((c) => c.textContent + (c.classList.contains("on") ? " (on)" : "")),
    participants: draft ? [...draft.participants] : null });
  const chip = (name) => [...document.querySelectorAll("#groupChips .chip")].find((c) => c.textContent.startsWith(name));
`;
const run = async (expression) => {
  const r = await send("Runtime.evaluate", { expression: `(async () => { ${HELPERS} ${expression} })()`, awaitPromise: true, returnByValue: true });
  if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 500));
  return r.result.result.value;
};
const open = async () => { await send("Page.navigate", { url: `http://localhost:8502/?${Date.now()}#home` }); await sleep(1300); };
const seed = (groups) => JSON.stringify({ profile: { name: "Asha", phone: "", upi: "", lang: "" }, friends: ["Meena"], onboarded: 6, contactsAsked: true, current: groups[0].id, groups });
const GOA = { id: "g", name: "Goa trip", people: ["You", "Arun"], expenses: [] };
const FLAT = { id: "f", name: "Flat", people: ["You", "Ravi"], expenses: [] };
let failed = 0;
const check = (name, ok, got) => { console.log((ok ? "PASS " : "FAIL ") + name + (ok ? "" : " | got: " + JSON.stringify(got))); if (!ok) failed++; };

try {
  await send("Page.enable");
  await open();

  // ---------- 1. one group ----------
  await run(`localStorage.setItem("voice-split-v2", ${JSON.stringify(seed([GOA]))}); return true`); await open();
  const typed = await run(`await typeIt(); return sheet()`);
  check("one group, from the type box: the group is chosen and shown in the Group menu, with no chips and no 'Add to a group?'",
    typed.open && typed.draftGroup === "g" && typed.menuShown && typed.menu === "g" && !typed.chipsShown && typed.ask === "", typed);
  check("one group: Save is on once the shares are in", typed.save, typed);
  // The same sheet reached by tapping the chip (opened with no group, as before this change)
  const tapped = await run(`closeCard(); await wait(400);
    const res = await post("/api/check", { expense: ${JSON.stringify(EXPENSE)}, people: [] }); showCard(res, null); await wait(300);
    const before = sheet(); chip("Goa trip").click(); await wait(700); return { before, after: sheet() }`);
  check("tapping the chip on a sheet with no group chosen still works, and turns Save on", !tapped.before.save && tapped.before.chipsShown && tapped.after.save && tapped.after.draftGroup === "g", tapped);
  check("pre-selected is the same as tapped: group, menu, people chips, who shares and Save all match",
    JSON.stringify({ ...typed, open: 0 }) === JSON.stringify({ ...tapped.after, open: 0 }), { typed, tapped: tapped.after });
  check("a friend who isn't in the group (Meena) stays in the split; the group's members show as extra chips, not chosen",
    JSON.stringify(typed.sharers) === JSON.stringify(["You (on)", "Arun", "Meena (on)"]) && JSON.stringify(typed.participants) === JSON.stringify(["You", "Meena"]), typed);
  // Toggling a group member on and off, and picking the group again in the menu, keep Save working
  const toggled = await run(`const arun = () => [...document.querySelectorAll("#sharers .chip")].find((c) => c.textContent === "Arun");
    arun().click(); await wait(700); const on = sheet(); arun().click(); await wait(700); const off = sheet();
    $("sheetGroup").value = "g"; $("sheetGroup").dispatchEvent(new Event("change")); await wait(700); return { off, on, repicked: sheet() }`);
  check("Arun on then off again, and the group picked again in the menu: Save stays on", toggled.on.save && JSON.stringify(toggled.on.participants) === JSON.stringify(["You", "Meena", "Arun"]) && toggled.off.save && toggled.repicked.save && toggled.repicked.draftGroup === "g"
    && JSON.stringify(toggled.repicked.participants) === JSON.stringify(["You", "Meena"]), toggled);
  // Save: the same as after a tap, Meena joins the group when the expense is saved
  const saved = await run(`$("save").click(); await wait(900); const s = JSON.parse(localStorage.getItem("voice-split-v2"));
    return { expenses: s.groups[0].expenses.length, people: s.groups[0].people, groups: s.groups.length }`);
  check("saving puts it in the one group, and Meena joins the group, as after a tap", saved.groups === 1 && saved.expenses === 1 && JSON.stringify(saved.people) === JSON.stringify(["You", "Arun", "Meena"]), saved);
  // The mic from Home takes the same path
  const voice = await run(`navigator.mediaDevices.getUserMedia = async () => { const c = new AudioContext(), o = c.createOscillator(), g = c.createGain(); g.gain.value = 0.07;
      const d = c.createMediaStreamDestination(); o.connect(g).connect(d); o.start(); return d.stream; };
    document.querySelector(".fab").click(); await wait(1300); take.rec.stop(); await wait(1500); return sheet()`);
  check("one group, from the mic on Home: chosen the same way, Save on", voice.open && voice.draftGroup === "g" && voice.menuShown && !voice.chipsShown && voice.save, voice);

  // ---------- 2. two groups ----------
  await run(`localStorage.setItem("voice-split-v2", ${JSON.stringify(seed([GOA, FLAT]))}); return true`); await open();
  const two = await run(`await typeIt(); const first = sheet(); await wait(800); const later = sheet(); return { first, later }`);
  check("two groups: nothing chosen, the chips and 'Add to a group?' show, Save is off", two.first.draftGroup === null && two.first.chipsShown && !two.first.menuShown
    && two.first.ask === "Add to a group?" && !two.first.save && !two.later.save, two);
  check("two groups: the last-used group is not chosen for you", two.later.draftGroup === null, two.later);
  const pick = await run(`chip("Flat").click(); await wait(700); return sheet()`);
  check("two groups: tapping a chip chooses it and turns Save on", pick.draftGroup === "f" && pick.menuShown && pick.save, pick);
  const voice2 = await run(`closeCard(); await wait(400);
    navigator.mediaDevices.getUserMedia = async () => { const c = new AudioContext(), o = c.createOscillator(), g = c.createGain(); g.gain.value = 0.07;
      const d = c.createMediaStreamDestination(); o.connect(g).connect(d); o.start(); return d.stream; };
    document.querySelector(".fab").click(); await wait(1300); take.rec.stop(); await wait(1500); return sheet()`);
  check("two groups, from the mic on Home: still asks, Save off", voice2.open && voice2.draftGroup === null && voice2.chipsShown && !voice2.save, voice2);
} finally { ws.close(); chrome.kill(); await sleep(300); rmSync(profile, { recursive: true, force: true }); }
console.log(failed ? `\n${failed} check(s) failed` : "\nAll checks passed");
process.exit(failed ? 1 : 0);
