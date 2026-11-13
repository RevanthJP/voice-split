// Checks that the phone's bars follow the dimmed page: while a sheet or the listening panel is open, the
// theme-color and the html/body background are the dimmed colour, worked out from the real dim layer; they
// go back on close, and never stay stuck after a fast close and reopen or while the page is hidden. Wider
// screens are left alone. Headless Chrome can't draw iPhone Safari's own bars: this checks what the page
// tells Safari, not what Safari paints. Needs Google Chrome and the app on localhost:8502. No AI calls.
// Usage: node tools/overlay_bars_test.mjs
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PORT = 9340, profile = mkdtempSync(join(tmpdir(), "kitty-bars-"));
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
const HELPERS = `
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  // What the page is telling Safari right now
  const bars = () => ({ theme: document.querySelector('meta[name="theme-color"]').getAttribute("content"),
    html: document.documentElement.style.backgroundColor, body: document.body.style.backgroundColor,
    image: document.documentElement.style.backgroundImage, flag: document.body.dataset.bars || "",
    tr: document.documentElement.style.transition + document.body.style.transition });
  // The expected colour, worked out here on its own from the CSS: layer (with alpha) over the app background
  const parse = (css) => { const [r, g, b, a = 1] = css.match(/\\(([^)]+)\\)/)[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { r, g, b, a }; };
  const mix = (top, under) => ["r", "g", "b"].map((k) => Math.round(top[k] * top.a + under[k] * (1 - top.a)));
  const toHex = (c) => "#" + c.map((v) => v.toString(16).padStart(2, "0")).join("").toUpperCase();
  const appBg = () => parse(getComputedStyle(document.querySelector(".app")).backgroundColor);
  const fakeMic = () => { navigator.mediaDevices.getUserMedia = async () => { const c = new AudioContext(), o = c.createOscillator(), d = c.createMediaStreamDestination(); o.connect(d); o.start(); return d.stream; }; };
  const openCard = async () => { const res = await post("/api/check", { expense: { description: "Dinner", total: 600, payer: "You", participants: ["You", "Arun"], mode: "equal", values: {}, items: [] }, people: ["Arun"] }); showCard(res, "g"); await wait(500); };
  const hide = (on) => { if (on) Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" }); else delete document.visibilityState; document.dispatchEvent(new Event("visibilitychange")); };
`;
const run = async (expression) => {
  const r = await send("Runtime.evaluate", { expression: `(async () => { ${HELPERS} ${expression} })()`, awaitPromise: true, returnByValue: true });
  if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 500));
  return r.result.result.value;
};
const open = async (q = "") => { await send("Page.navigate", { url: `http://localhost:8502/?${q}${Date.now()}#group/g` }); await sleep(1300); };
let failed = 0;
const check = (name, ok, got) => { console.log((ok ? "PASS " : "FAIL ") + name + (ok ? "" : " | got: " + JSON.stringify(got))); if (!ok) failed++; };
const SEED = JSON.stringify({ profile: { name: "Asha", phone: "", upi: "", lang: "" }, friends: [], onboarded: 6, contactsAsked: true, current: "g",
  groups: [{ id: "g", name: "Goa trip", people: ["You", "Arun"], expenses: [] }] });
const rgb = (h) => `rgb(${parseInt(h.slice(1, 3), 16)}, ${parseInt(h.slice(3, 5), 16)}, ${parseInt(h.slice(5, 7), 16)})`;

try {
  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
  await open();
  await run(`localStorage.setItem("voice-split-v2", ${JSON.stringify(SEED)}); return true`);
  await open();

  const closed = await run(`return bars()`);
  check("closed: theme-color is the page's own #F2F2F7, and no background is set", closed.theme === "#F2F2F7" && !closed.html && !closed.body && !closed.flag, closed);

  // The add-expense sheet: the scrim over the app background
  const card = await run(`await openCard();
    const want = toHex(mix(parse(getComputedStyle($("scrim")).backgroundColor), appBg()));
    const b = bars(); const sheetBottom = $("card").getBoundingClientRect().bottom, appBottom = document.querySelector(".app").getBoundingClientRect().bottom;
    return { want, b, sheetBottom, appBottom, sheetBg: getComputedStyle($("card")).backgroundColor }`);
  check("sheet open: the dimmed colour is the scrim over the app background, #AEAEB2", card.want === "#AEAEB2", card.want);
  check("sheet open: theme-color and html/body background are that colour", card.b.theme === card.want && card.b.html === rgb(card.want) && card.b.body === rgb(card.want), card.b);
  check("sheet open: the strip below the page is the sheet's own white, and the sheet reaches the bottom", card.b.image.includes("rgb(255, 255, 255) 50%") && card.sheetBottom === card.appBottom, card);
  const shut = await run(`closeCard(); await wait(500); return bars()`);
  check("sheet closed: both are restored", shut.theme === "#F2F2F7" && !shut.html && !shut.body && !shut.image && !shut.flag, shut);

  // Fast close and reopen, and fast open and close
  const fast = await run(`await openCard(); closeCard(); await wait(30); await openCard(); await wait(400); const reopened = { ...bars(), cardShown: !$("card").hidden && document.body.classList.contains("sheet-open") };
    closeCard(); await wait(20); newBlankCard("g"); await wait(10); closeCard(); await wait(600); return { reopened, after: bars(), cardHidden: $("card").hidden }`);
  check("closed and reopened at once: the sheet stays on screen and stays tinted", fast.reopened.cardShown && fast.reopened.theme === "#AEAEB2" && fast.reopened.html === rgb("#AEAEB2"), fast.reopened);
  check("opened and closed at once: nothing left stuck", fast.after.theme === "#F2F2F7" && !fast.after.html && !fast.after.body && fast.cardHidden, fast);

  // A second kind of sheet over the scrim: Add a friend
  const ap = await run(`openAddPerson(); await wait(500); const on = bars(); closeAddPerson(); await wait(500); return { on, off: bars() }`);
  check("Add a friend: tinted while open, restored after", ap.on.theme === "#AEAEB2" && ap.off.theme === "#F2F2F7" && !ap.off.html, ap);

  // The listening panel has its own lighter dim layer
  const listen = await run(`fakeMic(); document.querySelector(".fab").click(); await wait(700);
    const want = toHex(mix(parse(getComputedStyle($("listen"), "::before").backgroundColor), appBg()));
    const on = bars(); take.cancelled = true; $("listenClose").click(); await wait(500); return { want, on, off: bars() }`);
  check("listening panel: its own dim layer over the app background, #D5D5D9", listen.want === "#D5D5D9" && listen.on.theme === listen.want && listen.on.html === rgb(listen.want), listen);
  check("listening panel closed: restored", listen.off.theme === "#F2F2F7" && !listen.off.html && !listen.off.body, listen.off);

  // The page is hidden with a sheet open, the sheet is closed while hidden, and the page comes back
  const hidden = await run(`await openCard(); hide(true); await wait(100); const whileHidden = bars();
    closeCard(); await wait(500); const closedHidden = bars(); hide(false); await wait(100); return { whileHidden, closedHidden, back: bars() }`);
  check("hidden with the sheet still open: still tinted to match it", hidden.whileHidden.theme === "#AEAEB2", hidden.whileHidden);
  check("closed while hidden, then shown again: restored, nothing stuck", hidden.closedHidden.theme === "#F2F2F7" && hidden.back.theme === "#F2F2F7" && !hidden.back.html, hidden);

  // Locking during a recording: the recording is thrown away, the panel stays; closing it restores the bars
  const lock = await run(`fakeMic(); document.querySelector(".fab").click(); await wait(700); hide(true); await wait(300); const locked = bars(); hide(false);
    $("listenClose").click(); await wait(500); return { locked, off: bars() }`);
  check("hidden during a recording, then closed: restored", lock.locked.theme === "#D5D5D9" && lock.off.theme === "#F2F2F7" && !lock.off.html, lock);

  // The developer switch ?bars= (phones only): each variant sets what it should and fully restores.
  const clean = (b) => b.theme === "#F2F2F7" && !b.html && !b.body && !b.image && !b.flag && !b.tr;
  for (const mode of ["off", "bg", "meta", "late"]) {
    await open(`bars=${mode}&`);
    const r = await run(`
      const ease = getComputedStyle($("scrim")).transitionTimingFunction, dur = getComputedStyle($("scrim")).transitionDuration;
      const sameFrame = {};
      if (${JSON.stringify(mode)} === "late") {
        $("scrim").hidden = false; document.body.classList.add("sheet-open"); await Promise.resolve(); await Promise.resolve(); sameFrame.flag = bars().flag;
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); sameFrame.next = bars().flag;
        document.body.classList.remove("sheet-open"); $("scrim").hidden = true; await wait(1000); sameFrame.after = bars();
      }
      await openCard(); await wait(100); const opened = bars();
      closeCard(); await wait(50); const closing = bars(); await wait(1000); const after = bars();
      newBlankCard("g"); await wait(10); closeCard(); await wait(1000); const fastOff = bars();
      await openCard(); closeCard(); await wait(30); await openCard(); await wait(700); const reopened = { ...bars(), shown: !$("card").hidden };
      closeCard(); await wait(1000); const final = bars();
      fakeMic(); document.querySelector(".fab").click(); await wait(800); const listenOn = bars();
      take.cancelled = true; $("listenClose").click(); await wait(1000); const listenOff = bars();
      return { ease, dur, sameFrame, opened, closing, after, fastOff, reopened, final, listenOn, listenOff }`);
    const fadeTr = `background-color 300ms ${r.ease}`.replace(/ /g, "");
    const trOk = (b) => b.tr.replace(/ /g, "").includes(fadeTr) || b.tr.replace(/ /g, "").includes(`background-color0.3s${r.ease.replace(/ /g, "")}`);
    const tinted = (b, hexv) => ({
      off: clean(b),
      bg: b.html === rgb(hexv) && b.body === rgb(hexv) && b.theme === "#F2F2F7" && trOk(b),
      meta: b.theme === hexv && !b.html && !b.body && !b.tr,
      late: b.html === rgb(hexv) && b.theme === hexv && trOk(b),
    })[mode];
    check(`?bars=${mode}: sheet open sets ${({ off: "nothing", bg: "the background only, faded like the scrim (" + r.dur + ")", meta: "theme-color only", late: "both, faded" })[mode]}`, r.dur === "0.3s" && tinted(r.opened, "#AEAEB2"), r.opened);
    check(`?bars=${mode}: listening panel open ${mode === "off" ? "sets nothing either" : "sets the same, in its own colour"}`, tinted(r.listenOn, "#D5D5D9"), r.listenOn);
    if (mode === "late") {
      check("?bars=late: not in the frame the sheet opens, but in the next one", r.sameFrame.flag === "" && r.sameFrame.next === "#AEAEB2" && clean(r.sameFrame.after), r.sameFrame);
      check("?bars=late: still tinted just after closing, until the fade ends", r.closing.theme === "#AEAEB2" && r.closing.html === rgb("#AEAEB2"), r.closing);
    }
    check(`?bars=${mode}: fully restored after closing, with no transition left behind`, clean(r.after) && clean(r.listenOff), { after: r.after, listenOff: r.listenOff });
    check(`?bars=${mode}: nothing stuck after open-then-close or close-then-reopen`, clean(r.fastOff) && r.reopened.shown && tinted(r.reopened, "#AEAEB2") && clean(r.final), r);
  }

  // Desktop width: no visible change
  await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await open();
  const desk = await run(`await openCard(); const b = bars(); closeCard(); await wait(400); return b`);
  check("desktop: a sheet changes neither theme-color nor the page background", desk.theme === "#F2F2F7" && !desk.html && !desk.body && !desk.image, desk);
  await open("bars=late&");
  const deskLate = await run(`await openCard(); await wait(100); const b = bars(); closeCard(); await wait(400); return b`);
  check("desktop with ?bars=late: still no change", clean(deskLate), deskLate);
} finally { ws.close(); chrome.kill(); await sleep(300); rmSync(profile, { recursive: true, force: true }); }
console.log(failed ? `\n${failed} check(s) failed` : "\nAll checks passed");
process.exit(failed ? 1 : 0);
