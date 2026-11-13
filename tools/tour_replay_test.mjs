// Checks the guided tour replays a step from the start every time it is shown: on first view, after Next,
// and after Back (twice each way). Each visit gets a fresh scene whose animations start at zero and whose
// people, cards and typed demo text appear again; only one typing run is ever active; Skip and finishing
// the tour still work. Headless Chrome replayed steps before this fix too, so these checks guard the
// behaviour; they can't reproduce iPhone Safari. Needs Google Chrome and the app on localhost:8502.
// Usage: node tools/tour_replay_test.mjs
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PORT = 9342, profile = mkdtempSync(join(tmpdir(), "kitty-tour-"));
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
  const scene = (n) => document.querySelector("#phone .scene.s" + n);
  // The animated parts of each step that start hidden and must appear again on every visit
  // (on step 2, the friend added by number appears later, at 8.9 s, and is checked with the typed demos)
  const PARTS = { 1: ".ctList li:not(.ffNew)", 2: ".pills i, .fakeNext", 3: ".howParts p, .fakeSave", 4: ".gForm, .gMembers .avatar", 5: ".howSplit p" };
  const shown = (n) => [...scene(n).querySelectorAll(PARTS[n] || "x")].filter((e) => getComputedStyle(e).display !== "none")
    .map((e) => +getComputedStyle(e).opacity > 0.5);
  // A visit: mark the scene, then read how far its animations have run
  const enter = async (click, n) => { const before = scene(n); before.__old = true; $(click).click(); await wait(150);
    const s = scene(n), times = s.getAnimations({ subtree: true }).map((a) => a.currentTime || 0);
    return { step: $("phone").dataset.step, fresh: !s.__old, play: $("phone").classList.contains("play"), animations: times.length, latest: Math.max(0, ...times) }; };
`;
const run = async (expression) => {
  const r = await send("Runtime.evaluate", { expression: `(async () => { ${HELPERS} ${expression} })()`, awaitPromise: true, returnByValue: true });
  if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 500));
  return r.result.result.value;
};
let failed = 0;
const check = (name, ok, got) => { console.log((ok ? "PASS " : "FAIL ") + name + (ok ? "" : " | got: " + JSON.stringify(got))); if (!ok) failed++; };
const firstRun = async () => {
  await send("Page.navigate", { url: "http://localhost:8502/" }); await sleep(700);
  await run(`localStorage.clear(); return true`);
  await send("Page.navigate", { url: `http://localhost:8502/?${Date.now()}` }); await sleep(1500);
};

try {
  await send("Page.enable");
  await firstRun();
  const start = await run(`const intro = !$("intro").hidden; $("introNext").click(); await wait(400); return { intro, step: $("phone").dataset.step, how: !$("how").hidden }`);
  check("fresh first run: Welcome, then the tour opens on step 1", start.intro && start.how && start.step === "0", start);

  // Steps 2 to 6 (data-step 1 to 5): Next, Back, Next, Back, Next, each time a fresh scene from zero, its parts shown
  for (let n = 1; n <= 5; n++) {
    const r = await run(`const out = [];
      for (const [click, step] of [["howNext", ${n}], ["howBack", ${n - 1}], ["howNext", ${n}], ["howBack", ${n - 1}], ["howNext", ${n}]]) {
        const v = await enter(click, step); await wait(${n === 4 ? 5600 : n === 5 ? 1200 : 3200}); v.parts = shown(step); out.push(v);
      }
      return out`);
    const ok = r.every((v, k) => v.step === String(k % 2 ? n - 1 : n) && v.fresh && v.play && v.animations > 0 && v.latest < 400)
      && r.filter((_, k) => k % 2 === 0 && n !== 0).every((v) => v.parts.length && v.parts.every(Boolean));
    check(`step ${n + 1} ("${["", "Find your friends", "Kitty finds the people", "Check it, then save", "Groups keep the tally", "Split and share"][n]}"): Next, Back, Next, Back, Next all start fresh, and its parts appear every time`, ok, r);
  }
  // The typed demos type again from the start: the examples on step 1, Priya on step 2, Goa trip on step 5
  const typed = await run(`const out = {};
    while ($("phone").dataset.step !== "0") { $("howBack").click(); await wait(200); }
    $("howNext").click(); await wait(200); $("howBack").click(); await wait(1500); out.sayings = $("howTyping").textContent.length;
    $("howNext").click(); await wait(8000); out.priya = $("howFfName").textContent + " " + $("howFfPhone").textContent;
    $("howNext").click(); await wait(200); $("howBack").click(); await wait(300); out.priyaCleared = $("howFfName").textContent;
    for (const k of [0, 1, 2]) { $("howNext").click(); await wait(200); }
    out.step = $("phone").dataset.step; await wait(2200); out.goa = $("howGroupName").textContent;
    $("howBack").click(); await wait(200); $("howNext").click(); await wait(200); out.goaCleared = $("howGroupName").textContent; await wait(2200); out.goaAgain = $("howGroupName").textContent;
    out.ids = ["howTyping", "howFfName", "howFfPhone", "howGroupName", "howLang"].map((x) => document.querySelectorAll("#" + x).length);
    return out`);
  check("typed demos replay: the examples type again, Priya is cleared and typed again, Goa trip is cleared and typed again",
    typed.sayings > 0 && typed.priya === "Priya 987xxxxxxx" && typed.priyaCleared === "" && typed.step === "4" && typed.goa === "Goa trip" && typed.goaCleared === "" && typed.goaAgain === "Goa trip", typed);
  check("each demo field exists exactly once (no duplicate scenes left behind)", typed.ids.every((c) => c === 1), typed.ids);

  // Only one typing run at a time: hop back and forth quickly, then the examples grow one letter per tick
  const one = await run(`while ($("phone").dataset.step !== "0") { $("howBack").click(); await wait(100); }
    for (let k = 0; k < 4; k++) { $("howNext").click(); await wait(60); $("howBack").click(); await wait(60); }
    const lens = []; const t = $("howTyping"); const mo = new MutationObserver(() => lens.push([...t.textContent].length));
    await wait(650); mo.observe(t, { childList: true, characterData: true, subtree: true }); await wait(1500); mo.disconnect();
    const steps = lens.slice(1).map((v, k) => v - lens[k]);
    return { count: lens.length, steps: [...new Set(steps)] }`);
  check("no overlapping typing runs after quick Next/Back: the example grows by exactly one letter each time", one.count > 20 && one.steps.every((d) => d === 1 || d === 0), one);

  // Skip mid-tour: set up opens, and the tour's typing stops
  const skip = await run(`$("howNext").click(); await wait(300); $("howSkip").click(); await wait(600);
    const before = $("howFfName").textContent + $("howTyping").textContent; await wait(6500); const after = $("howFfName").textContent + $("howTyping").textContent;
    return { setup: !$("setup").hidden, how: !$("how").hidden, still: before === after }`);
  check("Skip opens set up, and nothing in the tour keeps typing behind it", skip.setup && !skip.how && skip.still, skip);
  // Back from set up returns to the last step, fresh
  const fromSetup = await run(`const s = scene(5); s.__old = true; $("setupBack").click(); await wait(400);
    return { step: $("phone").dataset.step, fresh: !scene(5).__old, how: !$("how").hidden }`);
  check("Back from set up shows the last step again, from the start", fromSetup.step === "5" && fromSetup.fresh && fromSetup.how, fromSetup);
  // Finish: Next on the last step, a name, Done
  const done = await run(`$("howNext").click(); await wait(500); $("oName").value = "Asha"; $("setupDone").click(); await wait(800);
    const s = JSON.parse(localStorage.getItem("voice-split-v2")); return { home: !$("view-home").hidden, onboarded: !!s.onboarded, name: s.profile.name, tour: !$("how").hidden || !$("setup").hidden }`);
  check("finishing the tour still works: Home, onboarded, name saved", done.home && done.onboarded && done.name === "Asha" && !done.tour, done);
} finally { ws.close(); chrome.kill(); await sleep(300); rmSync(profile, { recursive: true, force: true }); }
console.log(failed ? `\n${failed} check(s) failed` : "\nAll checks passed");
process.exit(failed ? 1 : 0);
