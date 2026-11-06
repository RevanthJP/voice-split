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

  // Order: Welcome -> How it works (6 steps) -> Set up -> app
  await run(`document.getElementById("introNext").click()`);
  await waitFor(`!document.getElementById("how").hidden && document.getElementById("howTitle").textContent === "Just say it"`);
  // Back from the first step returns to Welcome
  await run(`document.getElementById("howBack").click()`);
  await waitFor(`!document.getElementById("intro").hidden && document.getElementById("how").hidden`);
  console.log("back from step 1 goes to Welcome: true");
  await run(`document.getElementById("introNext").click()`);
  await waitFor(`!document.getElementById("how").hidden && document.getElementById("howTitle").textContent === "Just say it"`);
  // Step 1 types all five languages, then stops on the English dinner
  await waitFor(`document.getElementById("howLang").textContent === "English" && document.getElementById("howTyping").textContent.endsWith("Arun")`, 30000);
  await sleep(600);
  await shot("02-how-1-say.jpg");
  // The same step on a taller screen, like a laptop browser: the phone frame grows instead of floating small
  await send("Emulation.setDeviceMetricsOverride", { width: 650, height: 1050, deviceScaleFactor: 1, mobile: false });
  await sleep(600);
  console.log("phone frame on a tall screen:", await run(`(() => { const r = document.getElementById("phone").getBoundingClientRect(); return Math.round(r.width) + "x" + Math.round(r.height); })()`));
  await shot("02-how-1-say-laptop-window.jpg");
  await send("Emulation.setDeviceMetricsOverride", { width: 375, height: 812, deviceScaleFactor: 2, mobile: true });
  await sleep(600);
  await run(`document.getElementById("howNext").click()`);
  const howShots = ["03-how-2-friends-3-added.jpg", "04-how-3-names.jpg", "05-how-4-check.jpg", "06-how-5-group-tally.jpg", "07-how-6-share.jpg"];
  for (let k = 0; k < howShots.length; k++) {
    const i = k + 1;
    if (i === 4) { await sleep(3000); await shot("06-how-5-group-make.jpg"); await sleep(5600); } // making the group, then its tally
    else if (i === 1) { // contacts first, then one friend added by number
      await sleep(3500); await shot("03-how-2-friends-1-contacts.jpg");
      await sleep(2300); await shot("03-how-2-friends-2-by-number.jpg");
      await sleep(3200);
    }
    else await sleep(3600); // let each step's animation finish
    console.log("how step", i, await run(`document.getElementById("howTitle").textContent`));
    await shot(howShots[k]);
    await run(`document.getElementById("howNext").click()`);
  }
  const findFriendsGone = await run(`!document.getElementById("findFriends") && !document.querySelector("#slides .artSay")`);
  console.log("old tour slides and Find friends screen removed:", findFriendsGone);
  if (!findFriendsGone) throw new Error("Old screens are still there");

  // Set up comes after How it works, and Back from it returns to the last step
  await waitFor(`!document.getElementById("setup").hidden && document.getElementById("how").hidden`);
  await run(`document.getElementById("setupBack").click()`);
  await waitFor(`!document.getElementById("how").hidden && document.getElementById("howTitle").textContent === "Split and share"`);
  await run(`document.getElementById("howBack").click()`);
  const backOne = await run(`document.getElementById("howTitle").textContent`);
  console.log("back from set up, then back again:", backOne);
  if (backOne !== "Groups keep the tally") throw new Error("Back didn't go to the previous step");
  // Swipe right goes back a step, swipe left goes on (pointer events, as a finger or mouse sends them)
  const drag = (fromX, toX) => run(`(() => { const t = document.querySelector("#how .howStage");
    t.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: ${fromX}, clientY: 400, pointerType: "touch" }));
    t.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, clientX: ${toX}, clientY: 405, pointerType: "touch" }));
    return document.getElementById("howTitle").textContent; })()`);
  const swipedBack = await drag(80, 300), swipedOn = await drag(300, 80);
  console.log("swipe right:", swipedBack, "| swipe left:", swipedOn);
  if (swipedBack !== "Check it, then save" || swipedOn !== "Groups keep the tally") throw new Error("Swipe didn't move between steps");
  await run(`document.getElementById("howNext").click(); document.getElementById("howNext").click()`);
  await waitFor(`!document.getElementById("setup").hidden && document.getElementById("how").hidden`);
  await sleep(700);
  await shot("08-setup.jpg");
  await run(`document.getElementById("setupDone").click()`);
  const blocked = await run(`!document.getElementById("oError").hidden && !document.getElementById("setup").hidden`);
  console.log("empty name blocked:", blocked);
  if (!blocked) throw new Error("Empty name was not blocked");
  await run(`document.getElementById("oName").value = "asha kumar"; document.getElementById("setupDone").click()`);
  await waitFor(`document.getElementById("setup").hidden`);
  const saved = await run(`JSON.parse(localStorage.getItem("voice-split-v2")).profile.name`);
  console.log("name saved as:", saved);
  if (saved !== "Asha Kumar") throw new Error("Name was not capitalised");
  const after = await run(`(() => { const s = JSON.parse(localStorage.getItem("voice-split-v2"));
    return { friends: s.friends, samples: s.samples, onboarded: s.onboarded, typed: document.getElementById("typed").value }; })()`);
  console.log("after onboarding", JSON.stringify(after));
  if (after.friends.length || after.onboarded !== 6 || after.typed) throw new Error("Sample friends or example text were left in the app");

  // The contacts prompt shows in the main app
  await waitFor(`!document.getElementById("contactsAsk").hidden`, 5000);
  await sleep(800);
  await shot("09-contacts-ask.jpg");
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

  // New user with ₹0: the balance shortcuts don't open Friends
  const zero = await run(`(() => { const b = document.querySelectorAll(".heroSplit button"); b[0].click(); b[1].click();
    return { disabled: [...b].every((x) => x.disabled), stillHome: location.hash === "#home" }; })()`);
  console.log("₹0 shortcuts:", JSON.stringify(zero));
  if (!zero.disabled || !zero.stillHome) throw new Error("₹0 balances still open Friends");

  // Empty box: the new message
  await run(`document.getElementById("typed").value = ""; document.getElementById("typeForm").requestSubmit()`);
  console.log("empty box says:", await run(`document.getElementById("error").textContent`));
  // A stray word from silence must not open the expense sheet
  await run(`readText("E aí")`);
  const stray = await run(`({ sheetOpen: !document.getElementById("card").hidden, error: document.getElementById("error").textContent })`);
  console.log("stray word:", JSON.stringify(stray));
  if (stray.sheetOpen) throw new Error("The expense sheet opened for a stray word");
  await run(`clearError()`);

  // The example split, read by the AI, with Share on WhatsApp at the bottom
  await run(`document.getElementById("typed").value = "Dinner yesterday ₹1,500 split with Arun and Ravi"; document.getElementById("typeForm").requestSubmit()`);
  await waitFor(`!document.getElementById("card").hidden && !document.getElementById("shareWa").disabled`, 40000);
  await sleep(900);
  const share = await run(`({ msg: splitMessage(), owed: lastOwed })`);
  console.log("share message:", JSON.stringify(share));
  const noSplitwise = await run(`!document.body.innerText.toLowerCase().includes("splitwise") && !document.getElementById("listenTip")`);
  console.log("no Splitwise text, no tip under the mic:", noSplitwise);
  if (!noSplitwise) throw new Error("Splitwise text or the mic tip is still there");
  await run(`document.getElementById("shareWa").scrollIntoView({ block: "center" })`);
  await shot("11-split-share.jpg");
  await run(`closeCard(); document.getElementById("typed").value = ""`);
  await sleep(500);

  await run(`document.querySelector('.tabs [data-go=friends]').click()`);
  await sleep(700);
  console.log("friends empty:", await run(`({ chart: !document.getElementById("friendsCard").hidden, tips: !document.getElementById("friendsTips").hidden })`));
  await shot("12-friends.jpg");
  // Friends: two ways to add. From contacts shows the privacy note first.
  await run(`document.getElementById("friendFromContacts").click()`);
  await waitFor(`!document.getElementById("contactsAsk").hidden`);
  await sleep(700);
  console.log("from contacts opens:", await run(`document.getElementById("contactsTitle").textContent + " | " + document.getElementById("contactsLater").textContent`));
  await shot("13-friends-from-contacts.jpg");
  await run(`document.getElementById("contactsLater").click()`); // "Not now"
  await waitFor(`document.getElementById("contactsAsk").hidden`);
  await sleep(400);
  await run(`document.getElementById("friendByNumber").click()`);
  await waitFor(`!document.getElementById("addPerson").hidden`);
  // A name alone isn't enough: the number is required
  await run(`document.getElementById("apName").value = "meena"; document.getElementById("addPersonForm").requestSubmit()`);
  console.log("without number:", await run(`document.getElementById("apError").textContent`));
  await run(`document.getElementById("apPhone").value = "99999 99999"; document.getElementById("apPhone").dispatchEvent(new Event("input"))`);
  await sleep(600);
  await shot("14-friends-by-number.jpg");
  await run(`document.getElementById("addPersonForm").requestSubmit()`);
  await waitFor(`document.getElementById("addPerson").hidden`);
  await sleep(600);
  const added = await run(`(() => { const s = JSON.parse(localStorage.getItem("voice-split-v2")); return { friends: s.friends, phone: (s.phones || {}).Meena, nameBox: !!document.getElementById("friendName") }; })()`);
  console.log("added by number:", JSON.stringify(added));
  if (added.friends.join() !== "Meena" || added.phone !== "99999 99999" || added.nameBox) throw new Error("Adding by number failed");

  // Search: by name, by part of the number, and an offer to add someone who isn't there
  const search = async (text) => { await run(`(() => { const i = document.getElementById("friendSearch"); i.value = ${JSON.stringify(text)}; i.dispatchEvent(new Event("input")); })()`); await sleep(300);
    return run(`({ shown: [...document.querySelectorAll("#friends li .name")].map((x) => x.textContent), noMatch: !document.getElementById("friendsNoMatch").hidden })`); };
  const byName = await search("mee"), byNumber = await search("9999"), nobody = await search("zara");
  console.log("search:", JSON.stringify({ byName, byNumber, nobody }));
  if (byName.shown.join() !== "Meena" || byNumber.shown.join() !== "Meena" || !nobody.noMatch) throw new Error("Search failed");
  await shot("16-friends-search.jpg");
  await run(`document.getElementById("addSearched").click()`);
  await waitFor(`!document.getElementById("addPerson").hidden`);
  console.log("add from search prefills:", await run(`document.getElementById("apName").value`));
  await run(`document.getElementById("apCancel").click()`);
  await waitFor(`document.getElementById("addPerson").hidden`);
  await search("");

  // Each friend: Invite to Kitty, and how you last reached them. Invite opens the send sheet with WhatsApp and SMS.
  await run(`[...document.querySelectorAll("#friends li")].find((li) => li.textContent.includes("Meena")).querySelector(".friendActions .link").click()`);
  await waitFor(`!document.getElementById("remind").hidden`);
  await sleep(500);
  const invite = await run(`({ title: document.getElementById("remindTitle").textContent, link: document.getElementById("remindText").value.includes("https://voice-split.vercel.app"), number: document.getElementById("remindPhone").value, buttons: [...document.querySelectorAll("#sendBtns button")].map((b) => b.textContent.trim()) })`);
  console.log("invite:", JSON.stringify(invite));
  if (!invite.link || invite.number !== "99999 99999" || invite.buttons.join() !== "WhatsApp,SMS") throw new Error("Invite sheet is wrong");
  await shot("15-friends-invite.jpg");
  // Send by SMS (the test stops the browser leaving for the Messages app), then the row shows the SMS icon
  await run(`window.addEventListener("beforeunload", (e) => { e.preventDefault(); }); document.getElementById("remindSms").click()`);
  await sleep(900);
  const afterSms = await run(`({ via: JSON.parse(localStorage.getItem("voice-split-v2")).via, badge: !!document.querySelector("#friends .via.sms") })`);
  console.log("after SMS:", JSON.stringify(afterSms));
  if (!afterSms.badge || afterSms.via.Meena !== "sms") throw new Error("SMS wasn't remembered");
  // A friend Kitty only knows by name (say, from a voice note) gets "Add number"
  await run(`(() => { state.friends.push("Ravi"); persist(); renderAll(); })()`);
  await sleep(2600); // let the "Opening Messages" note fade
  await shot("15-friends-list.jpg");
  await run(`[...document.querySelectorAll("#friends li")].find((li) => li.textContent.includes("Ravi")).querySelector(".friendActions .link").click()`);
  await waitFor(`!document.getElementById("addPerson").hidden`);
  console.log("add number sheet:", await run(`document.getElementById("apTitle").textContent + " | name locked: " + document.getElementById("apName").readOnly`));
  await run(`document.getElementById("apPhone").value = "987xxxxxxx"; document.getElementById("addPersonForm").requestSubmit()`);
  console.log("placeholder-style number refused:", await run(`!document.getElementById("apError").hidden`));
  await run(`document.getElementById("apPhone").value = "99999 99998"; document.getElementById("addPersonForm").requestSubmit()`);
  await waitFor(`document.getElementById("addPerson").hidden`);
  const ravi = await run(`JSON.parse(localStorage.getItem("voice-split-v2")).phones.Ravi`);
  console.log("Ravi's number saved:", ravi);
  if (ravi !== "99999 99998") throw new Error("Add number failed");
  await run(`document.querySelector('.tabs [data-go=groups]').click()`);
  await sleep(800);
  console.log("groups tab:", await run(`[...document.querySelectorAll("#groupIdeas .chip")].map((b) => b.textContent).join(", ") + " | tips shown: " + !document.getElementById("groupsTips").hidden`));
  await shot("17-groups.jpg");
  await run(`document.querySelector('.tabs [data-go=account]').click()`);
  await sleep(600);
  const account = await run(`({ name: document.getElementById("pName").value, hasLanguageRow: document.body.innerText.includes("Speaking language") })`);
  console.log("account", JSON.stringify(account));
  if (account.name !== "Asha Kumar" || account.hasLanguageRow) throw new Error("Speaking language row is still there");
  await shot("18-account.jpg");

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
    s.friends = ["Arun", "Ravi", "Meena"]; s.samples = ["Arun", "Ravi", "Suresh"]; s.onboarded = 6;
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
