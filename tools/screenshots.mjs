// Takes phone-size screenshots of the welcome tour with a fresh, empty browser profile,
// so it shows exactly what a brand-new user sees. Needs Google Chrome and the app running
// on localhost:8502. Usage: node tools/screenshots.mjs
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const OUT = new URL("../test-outputs/screenshots/", import.meta.url).pathname;
const PORT = 9333;
const profile = mkdtempSync(join(tmpdir(), "kitty-shots-"));
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  "--no-first-run", "--hide-scrollbars", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function connect() {
  for (let i = 0; i < 50; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
      const page = list.find((t) => t.type === "page");
      if (page) return page.webSocketDebuggerUrl;
    } catch (_) {}
    await sleep(200);
  }
  throw new Error("Chrome did not start");
}

const ws = new WebSocket(await connect());
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let id = 0;
const pending = new Map();
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
});
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const n = ++id;
  pending.set(n, (m) => (m.error ? reject(new Error(m.error.message)) : resolve(m.result)));
  ws.send(JSON.stringify({ id: n, method, params }));
});
const run = async (expr) => (await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true })).result.value;
const waitFor = async (expr, ms = 20000) => {
  for (let t = 0; t < ms; t += 150) { if (await run(expr)) return; await sleep(150); }
  throw new Error("Timed out waiting for: " + expr);
};
const shot = async (name) => {
  await sleep(700); // let animations settle
  const { data } = await send("Page.captureScreenshot", { format: "jpeg", quality: 88 });
  writeFileSync(OUT + name, Buffer.from(data, "base64"));
  console.log("saved", name);
};

try {
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 375, height: 812, deviceScaleFactor: 2, mobile: true });
  await send("Page.navigate", { url: "http://localhost:8502/" });
  await waitFor(`!!document.getElementById("intro") && !document.getElementById("intro").hidden`);

  // Checks a brand-new user should pass
  const checks = await run(`({ tourShown: !document.getElementById("intro").hidden,
    nameEmpty: document.getElementById("oName").value === "", upiEmpty: document.getElementById("oUpi").value === "" })`);
  console.log("checks", JSON.stringify(checks));
  if (!checks.tourShown || !checks.nameEmpty || !checks.upiEmpty) throw new Error("New-user checks failed");

  await shot("01-welcome.jpg");
  await run(`document.getElementById("introNext").click()`);
  await waitFor(`document.getElementById("langTag").textContent === "Tanglish" && document.querySelector(".artSay").classList.contains("done")`);
  await shot("02-tour-tanglish.jpg");
  await run(`showSlide(4)`);
  await sleep(900);
  await shot("09-setup.jpg");

  // Leaving the name empty must be blocked for a new user
  await run(`document.getElementById("introNext").click()`);
  const blocked = await run(`!document.getElementById("oError").hidden && !document.getElementById("intro").hidden`);
  console.log("empty name blocked:", blocked);
  if (!blocked) throw new Error("Empty name was not blocked");

  // Finish setup with a sample name: the Find friends screen comes next
  await run(`document.getElementById("oName").value = "Asha"; document.getElementById("introNext").click()`);
  await waitFor(`!document.getElementById("findFriends").hidden && document.querySelectorAll("#sampleList li").length === 5`);
  await sleep(900);
  await shot("15-find-friends.jpg");

  // How it works: four illustrated steps
  await run(`document.getElementById("howBtn").click()`);
  await waitFor(`!document.getElementById("how").hidden`);
  const howShots = ["16-how-1-contacts.jpg", "16-how-2-group.jpg", "16-how-3-voice.jpg", "16-how-4-names.jpg", "16-how-5-whatsapp.jpg"];
  for (let i = 0; i < howShots.length; i++) {
    if (i === 1) { await sleep(2900); await shot("16-how-2-group-form.jpg"); await sleep(2700); } // mid-way, then the end
    else await sleep(i === 2 ? 4200 : 3400); // let each step's animation finish
    console.log("how step", i, await run(`document.getElementById("howTitle").textContent`));
    await shot(howShots[i]);
    await run(`document.getElementById("howNext").click()`);
  }
  await waitFor(`document.getElementById("how").hidden && document.getElementById("findFriends").hidden`);
  const after = await run(`(() => { const s = JSON.parse(localStorage.getItem("voice-split-v2"));
    return { friends: s.friends, samples: s.samples, onboarded: s.onboarded, typed: document.getElementById("typed").value }; })()`);
  console.log("after onboarding", JSON.stringify(after));
  if (after.friends.length || after.onboarded !== 3 || after.typed) throw new Error("Sample friends or example text were left in the app");

  // The contacts prompt shows in the main app
  await waitFor(`!document.getElementById("contactsAsk").hidden`, 5000);
  await sleep(800);
  await shot("20-contacts-ask.jpg");
  await run(`document.getElementById("contactsAllow").click()`); // desktop Chrome has no contact picker
  const note = await run(`document.getElementById("contactsNote").hidden ? "" : document.getElementById("contactsNote").textContent`);
  console.log("no-picker note:", note.slice(0, 60));
  await run(`document.getElementById("contactsAllow").click()`);
  await waitFor(`document.getElementById("contactsAsk").hidden`);

  // Contacts are matched in the browser and never saved
  const match = await run(`(() => { phoneContacts = [{ name: "Meena Sharma", tel: "" }];
    const e = { payer: "You", participants: ["You", "Meena", "Arun"], items: [] };
    const changed = matchContacts(e);
    const saved = localStorage.getItem("voice-split-v2").includes("Meena");
    phoneContacts = [];
    return { changed, participants: e.participants, savedToStorage: saved }; })()`);
  console.log("contact match", JSON.stringify(match));
  if (!match.changed || match.participants[1] !== "Meena Sharma" || match.participants[2] !== "Arun" || match.savedToStorage) throw new Error("Contact matching failed");

  await sleep(1500);
  await shot("10-home.jpg");

  // The example split, read by the AI, with Share on WhatsApp at the bottom
  await run(`document.getElementById("typed").value = "Dinner yesterday ₹1,500 split with Arun and Ravi"; document.getElementById("typeForm").requestSubmit()`);
  await waitFor(`!document.getElementById("card").hidden && !document.getElementById("shareWa").disabled`, 40000);
  await sleep(900);
  const share = await run(`({ msg: splitMessage(), owed: lastOwed })`);
  console.log("share message:", JSON.stringify(share));
  await run(`document.getElementById("shareWa").scrollIntoView({ block: "center" })`);
  await shot("21-split-share.jpg");
  await run(`closeCard()`);
  await sleep(500);

  await run(`document.querySelector('[data-go=friends]').click()`);
  await sleep(700);
  await shot("22-friends-after-tour.jpg");
  await run(`document.querySelector('[data-go=account]').click()`);
  await sleep(600);
  const account = await run(`({ name: document.getElementById("pName").value, hasLanguageRow: document.body.innerText.includes("Speaking language") })`);
  console.log("account", JSON.stringify(account));
  if (account.hasLanguageRow) throw new Error("Speaking language row is still there");
  await shot("13-account.jpg");

  // A returning user who replays the tour must type the name again; nothing is pre-filled
  await send("Page.navigate", { url: "about:blank" }); // leave the app so the next load is a full one
  await sleep(500);
  await send("Page.navigate", { url: "http://localhost:8502/?again=1#welcome" });
  await sleep(1500);
  await waitFor(`!document.getElementById("intro").hidden`);
  const replay = await run(`({ nameEmpty: document.getElementById("oName").value === "" })`);
  console.log("replay", JSON.stringify(replay));
  if (!replay.nameEmpty) throw new Error("Name was pre-filled on replay");

  // Someone who got sample friends saved by the earlier build: they're removed on the next load
  await run(`(() => { const s = JSON.parse(localStorage.getItem("voice-split-v2"));
    s.friends = ["Arun", "Ravi", "Meena"]; s.samples = ["Arun", "Ravi", "Suresh"]; s.onboarded = 3;
    localStorage.setItem("voice-split-v2", JSON.stringify(s)); })()`);
  await send("Page.navigate", { url: "about:blank" });
  await sleep(400);
  await send("Page.navigate", { url: "http://localhost:8502/?clean=1#friends" });
  await sleep(1500);
  const cleaned = await run(`(() => { const s = JSON.parse(localStorage.getItem("voice-split-v2")); return { friends: s.friends, samples: s.samples || null }; })()`);
  console.log("old samples cleaned", JSON.stringify(cleaned));
  if (cleaned.friends.join() !== "Meena" || cleaned.samples) throw new Error("Old sample friends were not removed");
} finally {
  ws.close();
  chrome.kill();
  await sleep(300);
  rmSync(profile, { recursive: true, force: true });
}
