// Checks the iPhone first-run fixes in headless Chrome: contacts only where the browser can share them,
// a still panel until the microphone is granted, and no keyboard focus while the add-expense sheet slides
// up on a touch phone. Desktop Chrome, like iPhone Safari, cannot share contacts, so that is the default;
// a browser that can is imitated before the app loads. Needs Google Chrome and the app on localhost:8502.
// No AI calls and no key. This is not a real iPhone: see the report for what still needs the phone.
// Usage: node tools/ios_first_run_test.mjs
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PORT = 9337, profile = mkdtempSync(join(tmpdir(), "kitty-ios-"));
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
  const r = await send("Runtime.evaluate", { expression: `(async () => { const wait = (ms) => new Promise((r) => setTimeout(r, ms)); ${expression} })()`, awaitPromise: true, returnByValue: true });
  if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 400));
  return r.result.result.value;
};
const open = async (hash) => { await send("Page.navigate", { url: `http://localhost:8502/?${Date.now()}#${hash}` }); await sleep(1300); };
const SEED = (onboarded) => JSON.stringify({ profile: { name: "Asha", phone: "", upi: "", lang: "" }, friends: [], onboarded: onboarded ? 6 : 0, current: "g",
  groups: [{ id: "g", name: "Goa trip", people: ["You", "Arun"], expenses: [] }] });
let failed = 0;
const check = (name, ok, got) => { console.log((ok ? "PASS " : "FAIL ") + name + (ok ? "" : " | got: " + JSON.stringify(got))); if (!ok) failed++; };
const visible = (sel) => `(() => { const n = document.querySelector(${JSON.stringify(sel)}); return !!n && n.getClientRects().length > 0; })()`;

try {
  await send("Page.enable"); await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });

  // ---------- 1. contacts, where the browser cannot share them (like iPhone Safari) ----------
  await open("home"); await run(`localStorage.setItem("voice-split-v2", ${JSON.stringify(SEED(true))}); return true`);
  await open("friends");
  const no = await run(`go("friends"); await wait(300);
    const btn = $("friendByNumber"), w = btn.getBoundingClientRect().width, row = btn.parentElement.getBoundingClientRect().width;
    go("group", "g"); await wait(500);
    const g = { contacts: ${visible("#gFromContacts")}, byName: $("gByNumber").textContent.trim() };
    newBlankCard("g"); await wait(700); const sheetContacts = ${visible("#pickContacts")}; closeCard(); await wait(400);
    return { supported: CONTACTS_OK, friendsContacts: ${visible("#friendFromContacts")}, byName: btn.textContent.trim(), fullWidth: Math.round(w) === Math.round(row), g, sheetContacts,
      empty: $("friendsEmptyText").textContent, how: HOW[1].text, perm: document.querySelector(".scene.s1 .perm").hidden,
      tip: $("tipAddTitle").textContent + " | " + $("tipAddText").textContent }`);
  check("unsupported: the check says no contacts here", no.supported === false, no);
  check("unsupported: Friends hides 'From contacts' and shows one full-width 'Add friends by name'", !no.friendsContacts && no.byName === "Add friends by name" && no.fullWidth, no);
  check("unsupported: the group screen hides 'From contacts' and shows 'Add friends by name'", !no.g.contacts && no.g.byName === "Add friends by name", no.g);
  check("unsupported: the add-expense sheet hides 'Add from contacts'", !no.sheetContacts, no);
  check("unsupported: the empty Friends text and the onboarding slide don't mention contacts", !/contact/i.test(no.empty) && !/contact/i.test(no.how) && no.perm, { empty: no.empty, how: no.how, perm: no.perm });
  const add = await run(`go("friends"); await wait(300); $("friendByNumber").click(); await wait(500);
    const label = $("apPhoneLabel").textContent; $("apName").value = "Kavya"; $("addPersonForm").requestSubmit(); await wait(600);
    const s = JSON.parse(localStorage.getItem("voice-split-v2"));
    return { label, saved: (s.friends || []).includes("Kavya"), phone: (s.phones || {}).Kavya || null, error: $("apError").hidden ? "" : $("apError").textContent }`);
  check("unsupported: 'How friends work' step 1 no longer needs a number", no.tip === "Add them by name | A name is enough. Add their number too, and Kitty can open WhatsApp or SMS with their share ready to send.", no.tip);
  check("unsupported: 'Add friends by name' saves a friend with no number", add.label === "Mobile number (optional)" && add.saved && add.phone === null && !add.error, add);
  const bad = await run(`$("friendByNumber").click(); await wait(500); $("apName").value = "Ravi"; $("apPhone").value = "12"; $("addPersonForm").requestSubmit(); await wait(300);
    const r = { error: $("apError").textContent, saved: (JSON.parse(localStorage.getItem("voice-split-v2")).friends || []).includes("Ravi") }; closeAddPerson(); await wait(400); return r`);
  check("unsupported: a wrong number is still caught", !bad.saved && /doesn't look right/.test(bad.error), bad);
  await run(`localStorage.setItem("voice-split-v2", ${JSON.stringify(SEED(false))}); return true`); await open("home");
  const first = await run(`$("oName").value = "Asha"; finishOnboarding(); await wait(1900); return { sheet: !$("contactsAsk").hidden, asked: !!JSON.parse(localStorage.getItem("voice-split-v2")).contactsAsked }`);
  check("unsupported: first run never shows the contacts sheet (no dead end)", !first.sheet, first);

  // ---------- 1b. a browser that can share contacts: unchanged ----------
  const fake = await send("Page.addScriptToEvaluateOnNewDocument", { source: `window.ContactsManager = function () {}; Object.defineProperty(navigator, "contacts", { value: { select: async () => [] } });` });
  await run(`localStorage.setItem("voice-split-v2", ${JSON.stringify(SEED(true))}); return true`); await open("friends");
  const yes = await run(`go("friends"); await wait(300); const f = { supported: CONTACTS_OK, contacts: ${visible("#friendFromContacts")}, byNumber: $("friendByNumber").textContent.trim(), empty: $("friendsEmptyText").textContent, how: HOW[1].text, tip: $("tipAddTitle").textContent + " | " + $("tipAddText").textContent };
    $("friendByNumber").click(); await wait(500); f.label = $("apPhoneLabel").textContent; $("apName").value = "Kavya"; $("addPersonForm").requestSubmit(); await wait(300);
    f.required = !$("apError").hidden; closeAddPerson(); await wait(400); return f`);
  check("supported: 'From contacts' and 'By number' are unchanged", yes.supported && yes.contacts && yes.byNumber === "By number" && /contacts/.test(yes.empty), yes);
  check("supported: the number is still required", yes.label === "Mobile number" && yes.required, yes);
  check("supported: 'How friends work' step 1 is unchanged", yes.tip === "Add them with their number | Kitty opens WhatsApp or SMS with their share ready to send.", yes.tip);
  check("supported: the onboarding slide text is exactly as before", yes.how === "Pick them from your contacts, or add someone by name and mobile number. Your contact list stays on this phone; Kitty sends friends' names, never numbers, to its server and its AI provider (Groq) to match who you mean.", yes.how);
  await run(`localStorage.setItem("voice-split-v2", ${JSON.stringify(SEED(false))}); return true`); await open("home");
  const firstYes = await run(`$("oName").value = "Asha"; finishOnboarding(); await wait(1900); const r = !$("contactsAsk").hidden; closeContactsAsk(); return r`);
  check("supported: first run still offers contacts", firstYes === true, firstYes);
  await send("Page.removeScriptToEvaluateOnNewDocument", { identifier: fake.result.identifier });

  // ---------- 2. listening: still until the microphone is granted ----------
  await run(`localStorage.setItem("voice-split-v2", ${JSON.stringify(SEED(true))}); return true`); await open("home");
  const mic = await run(`
    let grant; navigator.mediaDevices.getUserMedia = () => new Promise((ok) => { grant = ok; });   // the permission prompt is open
    document.querySelector(".fab").click(); await wait(500);
    const style = (sel, p) => getComputedStyle(document.querySelector(sel), sel.includes("::") ? "::before" : null)[p];
    const asking = { cls: document.body.classList.contains("micAsk"), hint: $("micHint").textContent, wave: getComputedStyle($("wave")).opacity,
      ring: getComputedStyle(document.querySelector("#listen .mic"), "::before").animationName, recording: document.body.classList.contains("recording") };
    const c = new AudioContext(), o = c.createOscillator(), d = c.createMediaStreamDestination(); o.connect(d); o.start();
    grant(d.stream); await wait(400);
    const granted = { cls: document.body.classList.contains("micAsk"), recording: document.body.classList.contains("recording"), hint: $("micHint").textContent, wave: getComputedStyle($("wave")).opacity };
    $("listenClose").click(); await wait(500);
    navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException("denied", "NotAllowedError"));
    document.querySelector(".fab").click(); await wait(500);
    const denied = { cls: document.body.classList.contains("micDenied"), hint: $("micHint").textContent, error: $("listenError").textContent, wave: getComputedStyle($("wave")).opacity,
      ring: getComputedStyle(document.querySelector("#listen .mic"), "::before").animationName, recording: document.body.classList.contains("recording") };
    $("listenClose").click(); await wait(500);
    return { asking, granted, denied, cleared: !document.body.classList.contains("micDenied") && !document.body.classList.contains("micAsk") }`);
  check("waiting for the permission: still panel, no wave, no moving ring, and no words", mic.asking.cls && mic.asking.wave === "0" && mic.asking.ring === "none" && mic.asking.hint === "" && !mic.asking.recording, mic.asking);
  check("granted: recording starts, the wave shows, 'Listening…'", !mic.granted.cls && mic.granted.recording && mic.granted.hint.startsWith("Listening") && mic.granted.wave !== "0", mic.granted);
  check("refused: a clear message, no wave, no moving ring, not recording", mic.denied.cls && mic.denied.wave === "0" && mic.denied.ring === "none" && !mic.denied.recording && /can't use the microphone/.test(mic.denied.error) && mic.denied.hint === "The microphone is off", mic.denied);
  check("closing the panel clears those states", mic.cleared, mic);

  // ---------- 3. the add-expense sheet on a touch phone ----------
  await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await send("Emulation.setEmulatedMedia", { features: [{ name: "pointer", value: "coarse" }, { name: "any-pointer", value: "coarse" }] });
  await open("group/g");
  const touch = await run(`const coarse = matchMedia("(pointer: fine)").matches === false; $("gAdd").click(); await wait(900);
    const r = $("card").getBoundingClientRect(), d = $("desc").getBoundingClientRect();
    const out = { coarse, focused: document.activeElement === $("desc"), sheetTop: Math.round(r.top), descTop: Math.round(d.top), descBottom: Math.round(d.bottom), viewport: innerHeight, scrollY: scrollY, cardScroll: $("card").scrollTop };
    closeCard(); await wait(400); return out`);
  check("touch phone: the description is not focused while the sheet opens (no keyboard)", touch.coarse && !touch.focused, touch);
  check("touch phone: the top of the sheet and the description are on screen, nothing scrolled", touch.sheetTop >= 0 && touch.descTop >= touch.sheetTop && touch.descBottom <= touch.viewport && touch.scrollY === 0 && touch.cardScroll === 0, touch);
  await send("Emulation.setEmulatedMedia", { features: [{ name: "pointer", value: "fine" }, { name: "any-pointer", value: "fine" }] });
  await send("Emulation.setTouchEmulationEnabled", { enabled: false });
  await open("group/g");
  const desk = await run(`$("gAdd").click(); await wait(300); const early = document.activeElement === $("desc"); await wait(400);
    const out = { early, focused: document.activeElement === $("desc"), sheetTop: Math.round($("card").getBoundingClientRect().top), scrollY }; closeCard(); await wait(400); return out`);
  check("mouse and keyboard: focus waits until the sheet has finished sliding, then lands on the description", !desk.early && desk.focused && desk.sheetTop >= 0 && desk.scrollY === 0, desk);

  // ---------- 4. the page behind the app: the app's grey on phones, the darker surround on desktop ----------
  const colours = `const c = (sel, p = "backgroundColor") => getComputedStyle(document.querySelector(sel))[p];
    return { width: innerWidth, html: c("html"), body: c("body"), app: c(".app"), tabs: c(".tabs") }`;
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
  await open("home"); const phone = await run(colours);
  await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await open("home"); const desktop = await run(colours);
  console.log("     colours at 390px:  " + JSON.stringify(phone));
  console.log("     colours at 1280px: " + JSON.stringify(desktop));
  check("390px: page background is #F2F2F7, the same as the app, with matching tabs", phone.body === "rgb(242, 242, 247)" && phone.html === "rgb(242, 242, 247)" && phone.app === "rgb(242, 242, 247)" && phone.tabs === "rgba(242, 242, 247, 0.86)", phone);
  check("1280px: unchanged, the darker #DCDCE2 surround and the old tabs", desktop.body === "rgb(220, 220, 226)" && desktop.html === "rgba(0, 0, 0, 0)" && desktop.app === "rgb(242, 242, 247)" && desktop.tabs === "rgba(245, 245, 247, 0.86)", desktop);
} finally { ws.close(); chrome.kill(); await sleep(300); rmSync(profile, { recursive: true, force: true }); }
console.log(failed ? `\n${failed} check(s) failed` : "\nAll checks passed");
process.exit(failed ? 1 : 0);
