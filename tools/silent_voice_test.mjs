// Checks the voice guards with fake microphones (Web Audio tones; no audio files): silence is caught on the
// phone and nothing is sent, quiet speech still goes through, closing the panel during the permission prompt
// records nothing, and a cancelled recording is never sent and never stops a newer one. Reading requests are
// counted, not sent. Needs Google Chrome and the app on localhost:8502. No AI calls and no key.
// Usage: node tools/silent_voice_test.mjs
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PORT = 9338, profile = mkdtempSync(join(tmpdir(), "kitty-voice-"));
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
const SETUP = `
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  window.sent = window.sent || [];
  if (!window.__fetchWrapped) {
    const real = window.fetch;
    window.fetch = (u, o) => { if (String(u).includes("/api/read-audio")) { window.sent.push(o.body.get("file").size); return Promise.resolve(new Response(JSON.stringify({ detail: "counted, not sent" }), { status: 422 })); } return real(u, o); };
    window.__fetchWrapped = true;
  }
  // A fake microphone: a 300 Hz tone at the given RMS (0 = silence), with a handle to its track.
  window.mic = (rms) => { const c = new AudioContext(), o = c.createOscillator(), g = c.createGain(); o.frequency.value = 300; g.gain.value = rms * Math.SQRT2;
    const d = c.createMediaStreamDestination(); o.connect(g).connect(d); o.start(); window.tracks = (window.tracks || []).concat(d.stream.getTracks()); return d.stream; };
  window.useMic = (rms) => { navigator.mediaDevices.getUserMedia = async () => mic(rms); };
  window.say = async (rms, ms) => { useMic(rms); document.querySelector(".fab").click(); await wait(ms); take.rec.stop(); await wait(500);
    const r = { sent: window.sent.length, error: $("listenError").hidden ? "" : $("listenError").textContent, peak: take.peak }; $("listenClose").click(); await wait(400); window.sent.length = 0; return r; };
`;
const run = async (expression) => {
  const r = await send("Runtime.evaluate", { expression: `(async () => { ${SETUP} ${expression} })()`, awaitPromise: true, returnByValue: true });
  if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 500));
  return r.result.result.value;
};
let failed = 0;
const check = (name, ok, got) => { console.log((ok ? "PASS " : "FAIL ") + name + (ok ? "" : " | got: " + JSON.stringify(got))); if (!ok) failed++; };
const SEED = JSON.stringify({ profile: { name: "Asha", phone: "", upi: "", lang: "" }, friends: [], onboarded: 6, contactsAsked: true, current: "g",
  groups: [{ id: "g", name: "Goa trip", people: ["You", "Arun"], expenses: [] }] });

try {
  await send("Page.enable");
  await send("Page.navigate", { url: `http://localhost:8502/?${Date.now()}#home` }); await sleep(1000);
  await run(`localStorage.setItem("voice-split-v2", ${JSON.stringify(SEED)}); return true`);
  await send("Page.navigate", { url: `http://localhost:8502/?${Date.now()}#home` }); await sleep(1300);

  const limits = await run(`return { min: MIN_CLIP_MS, peak: SILENCE_PEAK_RMS }`);
  check("thresholds: 800 ms minimum, peak RMS 0.005", limits.min === 800 && limits.peak === 0.005, limits);

  const silence = await run(`return await say(0, 1500)`);
  check("silence: 'I didn't hear anything', and nothing is sent", silence.sent === 0 && silence.error.startsWith("I didn't hear anything") && silence.peak !== null && silence.peak < 0.005, silence);
  const quiet = await run(`return await say(0.02, 1500)`);
  const guarded = (r) => /didn't hear|too short/.test(r.error); // the counted request's own reply may still show
  check("quiet speech (RMS 0.02, about -34 dBFS) is sent", quiet.sent === 1 && !guarded(quiet) && quiet.peak > 0.015, quiet);
  const softest = await run(`return await say(0.008, 1500)`);
  check("very quiet sound just above the line (RMS 0.008) is still sent", softest.sent === 1 && !guarded(softest), softest);
  const short = await run(`return await say(0.05, 400)`);
  check("under 0.8 s: 'That was too short', and nothing is sent", short.sent === 0 && short.error.startsWith("That was too short"), short);

  // The meter's audio engine won't start (as iOS can do after a lock): no silence judgement, the recording is sent.
  const paused = await run(`const Real = window.AudioContext;
    window.AudioContext = class extends Real { get state() { return "suspended"; } resume() { return Promise.resolve(); } };
    const r = await say(0, 1500); window.AudioContext = Real; return r`);
  check("a suspended audio engine fails open: even silence is sent, with no peak", paused.sent === 1 && paused.peak === null, paused);

  // No panel before the permission answer; on Allow it opens and records.
  const ask = await run(`let grant; navigator.mediaDevices.getUserMedia = () => new Promise((ok) => { grant = ok; });
    document.querySelector(".fab").click(); await wait(500);
    const during = { panelHidden: $("listen").hidden, open: document.body.classList.contains("listen-open"), recording: document.body.classList.contains("recording"), take: take && take.rec.state };
    grant(mic(0.05)); await wait(600);
    const after = { panelHidden: $("listen").hidden, recording: take.rec.state, hint: $("micHint").textContent };
    take.rec.stop(); await wait(400); $("listenClose").click(); await wait(400); window.sent.length = 0;
    return { during, after }`);
  check("no panel and nothing 'listening' while the permission prompt is up", ask.during.panelHidden && !ask.during.open && !ask.during.recording && ask.during.take !== "recording", ask);
  check("on Allow, the panel opens and recording starts", !ask.after.panelHidden && ask.after.recording === "recording" && ask.after.hint.startsWith("Listening"), ask);

  // Bug A: the page goes to the background while the prompt is up, then Allow.
  const a = await run(`let grant; navigator.mediaDevices.getUserMedia = () => new Promise((ok) => { grant = ok; });
    const before = take; document.querySelector(".fab").click(); await wait(300);
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" }); document.dispatchEvent(new Event("visibilitychange"));
    const stream = mic(0.05); grant(stream); await wait(1500);
    delete document.visibilityState;
    return { newRecording: take !== before && !!take && take.rec.state === "recording", panelHidden: $("listen").hidden, recordingClass: document.body.classList.contains("recording"), micReleased: stream.getTracks().every((t) => t.readyState === "ended"), sent: window.sent.length }`);
  check("bug A: hidden during the prompt starts no recording, shows no panel, and releases the microphone", !a.newRecording && a.panelHidden && !a.recordingClass && a.micReleased && a.sent === 0, a);

  // A stale stream after the page was hidden: the recording is thrown away with its mic and audio engine,
  // and the next tap gets a fresh microphone.
  const stale = await run(`let calls = 0; navigator.mediaDevices.getUserMedia = async () => { calls++; return mic(0.05); };
    document.querySelector(".fab").click(); await wait(1200);
    const first = take, firstStream = first.stream, firstCtx = first.ctx;
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" }); document.dispatchEvent(new Event("visibilitychange"));
    await wait(500); delete document.visibilityState;
    const hidden = { stopped: first.rec.state, micEnded: firstStream.getTracks().every((t) => t.readyState === "ended"), ctx: firstCtx && firstCtx.state, recordingClass: document.body.classList.contains("recording"), error: $("listenError").textContent, sent: window.sent.length };
    $("mic").click(); await wait(1200);
    const second = take;
    const again = { calls, isNew: second !== first, freshStream: second.stream !== firstStream, live: second.stream.getTracks().every((t) => t.readyState === "live"), recording: second.rec.state };
    second.rec.stop(); await wait(500);
    const sentAfter = window.sent.length; $("listenClose").click(); await wait(400); window.sent.length = 0;
    return { hidden, again, sentAfter }`);
  check("hidden mid-recording: the recording is discarded; mic released, audio engine closed, nothing sent", stale.hidden.stopped === "inactive" && stale.hidden.micEnded && stale.hidden.ctx === "closed" && !stale.hidden.recordingClass && stale.hidden.sent === 0 && /background/.test(stale.hidden.error), stale.hidden);
  check("the next tap asks for a fresh microphone and records with it", stale.again.calls === 2 && stale.again.isNew && stale.again.freshStream && stale.again.live && stale.again.recording === "recording" && stale.sentAfter === 1, stale);

  // iOS hands back a stream whose track has already ended: ask again and use the live one.
  const ended = await run(`let calls = 0; const dead = mic(0.05); dead.getTracks().forEach((t) => t.stop());
    navigator.mediaDevices.getUserMedia = async () => (++calls === 1 ? dead : mic(0.05));
    document.querySelector(".fab").click(); await wait(1000);
    const r = { calls, live: take.stream.getTracks().every((t) => t.readyState === "live"), notDead: take.stream !== dead, recording: take.rec.state };
    $("listenClose").click(); await wait(400); window.sent.length = 0; return r`);
  check("an ended track is replaced with a new request before recording", ended.calls === 2 && ended.live && ended.notDead && ended.recording === "recording", ended);

  // Bug B: record, cancel, and reopen at once.
  const b = await run(`useMic(0.05); document.querySelector(".fab").click(); await wait(1300);
    const first = take; const firstStream = first.stream;
    $("listenClose").click(); document.querySelector(".fab").click(); await wait(1300);
    const second = take;
    const during = { sent: window.sent.length, firstCancelled: first.cancelled, firstStopped: first.rec.state, secondIsNew: second !== first, secondRecording: second.rec.state, secondMicLive: second.stream.getTracks().every((t) => t.readyState === "live"), firstMicEnded: firstStream.getTracks().every((t) => t.readyState === "ended") };
    second.rec.stop(); await wait(500);
    return { ...during, sentAfterSecond: window.sent.length }`);
  check("bug B: the cancelled recording is not sent", b.sent === 0 && b.firstCancelled && b.firstStopped === "inactive", b);
  check("bug B: the new recording keeps its own live microphone", b.secondIsNew && b.secondRecording === "recording" && b.secondMicLive && b.firstMicEnded, b);
  check("bug B: only the new recording is sent when it stops", b.sentAfterSecond === 1, b);

  // ?debug=1 shows the last recording's peak RMS and length on screen; without it, nothing.
  const plain = await run(`return !document.getElementById("micDebug")`);
  await send("Page.navigate", { url: `http://localhost:8502/?debug=1&${Date.now()}#home` }); await sleep(1300);
  const dbg = await run(`useMic(0.05); document.querySelector(".fab").click(); await wait(1500); take.rec.stop(); await wait(500);
    const d = document.getElementById("micDebug"); const r = { text: d && d.textContent, visible: !!d && !$("listen").hidden, sent: window.sent.length }; return r`);
  check("?debug=1 shows peak RMS and clip length on screen; absent without it", plain && /^peak RMS 0\.0\d{3} · 1\.\d\d s$/.test(dbg.text || "") && dbg.visible, { plain, dbg });
} finally { ws.close(); chrome.kill(); await sleep(300); rmSync(profile, { recursive: true, force: true }); }
console.log(failed ? `\n${failed} check(s) failed` : "\nAll checks passed");
process.exit(failed ? 1 : 0);
