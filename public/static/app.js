"use strict";
// Everything is stored in this browser only.
const ME = "You";
const KEY = "voice-split-v2";
const ASKED_FOR_TOUR = location.hash === "#welcome"; // read before the app changes the address
const OLD_KEY = "voice-split-v1";
const $ = (id) => document.getElementById(id);
let state = load();
let draft = null;      // the expense on the confirmation sheet
let draftGroup = null; // which group it will be saved to
let draftHeard = null;  // what was said, so the checks can run again after edits
let draftChecks = [];   // the AI reading's doubts; edits can clear them but never add new ones
let openGroupId = null;

// ---------- storage ----------
// "rev kumar" -> "Rev Kumar". Only the first letter of each word changes.
const titleName = (raw) => (raw || "").trim().replace(/\s+/g, " ").split(" ").map((w) => w ? w[0].toUpperCase() + w.slice(1) : w).join(" ");
function newId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
function blankGroup(name) { return { id: newId(), name, people: [ME], expenses: [] }; }
function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s && Array.isArray(s.groups) && s.groups.length) return s;
  } catch (_) {}
  const fresh = { profile: { name: "", phone: "", upi: "", lang: "" }, friends: [], groups: [blankGroup("Friends")], current: null };
  try { // bring over data from the first version
    const old = JSON.parse(localStorage.getItem(OLD_KEY));
    if (old && Array.isArray(old.expenses)) {
      fresh.groups[0].people = old.people && old.people.length ? old.people : [ME];
      fresh.groups[0].expenses = old.expenses;
      fresh.profile.upi = old.upi || "";
      fresh.profile.lang = old.lang || "";
    }
  } catch (_) {}
  fresh.current = fresh.groups[0].id;
  return fresh;
}
function persist() { localStorage.setItem(KEY, JSON.stringify(state)); }
const group = (id) => state.groups.find((g) => g.id === id);
const current = () => group(state.current) || state.groups[0];
const allExpenses = () => state.groups.flatMap((g) => g.expenses.map((e) => ({ ...e, _group: g.name, _gid: g.id })));
const allPeople = () => [...new Set([...state.groups.flatMap((g) => g.people), ...(state.friends || [])])];

// ---------- helpers ----------
const rupees = (n) => "₹" + Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2, minimumFractionDigits: Number(n) % 1 ? 2 : 0 });
function el(tag, cls, text) { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
function avatar(name, extra) { const a = el("span", "avatar" + (name === ME ? " me" : "") + (extra ? " " + extra : ""), (name || "?").slice(0, 1).toUpperCase()); a.setAttribute("aria-hidden", "true"); return a; }
function who(name, sub, extra) {
  const w = el("span", "who");
  const t = el("span", "lines");
  t.append(el("span", "name", name), ...(sub ? [el("span", "sub", sub)] : []));
  w.append(avatar(name, extra), t);
  return w;
}
const shortDate = (iso) => new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
// Errors show on the listening screen while it is open, otherwise under the typing box.
const errorBox = () => ($("listen").hidden ? $("error") : $("listenError"));
function showError(msg) { const b = errorBox(); b.textContent = msg; b.hidden = false; }
function clearError() { $("error").hidden = true; $("listenError").hidden = true; }
let toastTimer = null;
function toast(msg) {
  const t = $("toast");
  t.textContent = msg; t.hidden = false;
  requestAnimationFrame(() => t.classList.add("show"));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.classList.remove("show"); setTimeout(() => (t.hidden = true), 250); }, 2200);
}
async function post(url, body, isForm, raw) {
  // Never leave someone waiting on a spinner: give up after 40 seconds with a clear message.
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 45000); // the server gives up first, at about 38 s
  let res;
  try {
    res = await fetch(url, Object.assign(isForm ? { method: "POST", body } :
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }, { signal: ctl.signal }));
  } catch (e) {
    throw new Error(e.name === "AbortError" ? "This is taking too long. Check your connection and try again." : "Couldn't reach the server. Check your connection.");
  } finally { clearTimeout(timer); }
  if (raw && res.ok) return res;
  let data = null;
  try { data = await res.json(); } catch (_) {}
  if (!res.ok) throw new Error((data && typeof data.detail === "string" && data.detail) || "Something went wrong. Please try again.");
  return data;
}
const plainExpense = (e) => ({ description: e.description, total: e.total, payer: e.payer, participants: e.participants, mode: e.mode, values: e.values || {}, items: e.items || [] });

// ---------- navigation ----------
const TABS = ["home", "friends", "groups", "account"];
function go(view, gid) {
  if (view === "group") openGroupId = gid || openGroupId;
  if (!["group", ...TABS].includes(view) || (view === "group" && !group(openGroupId))) view = "home";
  document.querySelectorAll(".view").forEach((v) => (v.hidden = v.id !== "view-" + view));
  const tab = view === "group" ? "groups" : view;
  document.querySelectorAll(".tabs button").forEach((b) => {
    const on = b.dataset.go === tab;
    b.classList.toggle("on", on);
    if (on) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
  });
  $("back").hidden = view !== "group";
  $("meBtn").hidden = view !== "home";
  document.body.classList.toggle("home", view === "home");
  $("title").textContent = view === "group" ? group(openGroupId).name : $("view-" + view).dataset.title;
  $("views").scrollTop = 0;
  const hash = view === "group" ? "group/" + openGroupId : view;
  if (location.hash !== "#" + hash) history.replaceState(null, "", "#" + hash);
  if (view === "group") renderGroup();
  if (view === "account") renderExportCount();
}
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-go]");
  if (b) go(b.dataset.go);
});
$("back").addEventListener("click", () => go("groups"));

// ---------- reading an expense ----------
function busy(on, label) {
  document.body.classList.toggle("busy", on);
  document.body.classList.toggle("checking", on);
  $("micHint").textContent = on ? label : "Tap the mic and say the expense";
}

// ---------- listening screen ----------
function openListen() {
  clearError();
  $("listenGroup").textContent = "Adding to " + current().name;
  $("listen").hidden = false;
  requestAnimationFrame(() => document.body.classList.add("listen-open"));
  startRecording();
}
function closeListen() {
  document.body.classList.remove("listen-open");
  setTimeout(() => { $("listen").hidden = true; }, 300);
}
document.addEventListener("click", (e) => { if (e.target.closest("[data-listen]")) openListen(); });
$("listenClose").addEventListener("click", () => {
  if (rec && rec.state === "recording") { cancelled = true; rec.stop(); }
  closeListen();
});

// A faint sound wave behind the mic, the same as the earlier design: it follows the voice while recording.
const WAVE = 34;
(function buildWave() {
  const w = $("wave");
  for (let i = 0; i < WAVE; i++) {
    const b = document.createElement("i");
    const mid = 1 - Math.abs(i - (WAVE - 1) / 2) / ((WAVE - 1) / 2);
    b.style.setProperty("--h", (0.12 + 0.5 * mid * (0.6 + 0.4 * Math.sin(i * 1.7) ** 2)).toFixed(3));
    b.style.setProperty("--v", (0.6 + 1.6 * mid).toFixed(2));
    b.style.setProperty("--c", i / WAVE < 0.55 ? "#2F7CF6" : "#B9500C");
    w.append(b);
  }
})();
let meterStop = null;
function meter(stream) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const an = ctx.createAnalyser();
    an.fftSize = 512;
    ctx.createMediaStreamSource(stream).connect(an);
    const data = new Uint8Array(an.fftSize);
    let raf = 0;
    const tick = () => {
      an.getByteTimeDomainData(data);
      let sum = 0;
      for (const v of data) sum += (v - 128) ** 2;
      const level = Math.min(1, Math.sqrt(sum / data.length) / 40);
      document.body.style.setProperty("--level", level.toFixed(3));
      raf = requestAnimationFrame(tick);
    };
    tick();
    meterStop = () => { cancelAnimationFrame(raf); ctx.close(); document.body.style.setProperty("--level", 0); };
  } catch (_) { meterStop = null; }
}
const knownNames = () => [...new Set([...current().people, ...allPeople()])];
// Silence or noise can come back as a stray word (like "E aí"). With no amount and nobody
// but you, there's nothing to check, so stay on this screen instead of opening the sheet.
const heardNothing = (res) => { const e = res.expense || {}; return !e.total && !(e.participants || []).some((p) => p !== ME) && (!e.payer || e.payer === ME); };
async function readText(text) {
  clearError();
  busy(true, "Reading…");
  try {
    const res = await post("/api/read-text", { text, people: knownNames() });
    if (heardNothing(res)) showError("That doesn't look like an expense. Say what it was, the amount and who it's with.");
    else showCard(res, state.current);
  }
  catch (e) { showError(e.message); }
  finally { busy(false); }
}
async function readAudio(blob, name) {
  clearError();
  busy(true, "Understanding…");
  const form = new FormData();
  form.append("file", blob, name);
  form.append("people", knownNames().join("|"));
  form.append("language", state.profile.lang || "");
  try {
    const res = await post("/api/read-audio", form, true);
    if (heardNothing(res)) { showError("I couldn't hear an expense. Tap the mic and say the amount and who it's with."); return; }
    closeListen();
    showCard(res, state.current);
  }
  catch (e) { showError(e.message); $("micHint").textContent = "Tap the mic to try again"; }
  finally { busy(false); if (!$("listen").hidden && $("listenError").hidden) $("micHint").textContent = "Tap the mic and say the expense"; }
}
$("typeForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const t = $("typed").value.trim();
  if (t) { $("typed").blur(); readText(t); } else showError("Nothing to read yet. Type what you spent, or tap the mic and say it.");
});

function paintLangs() { state.profile.lang = ""; } // the language is always detected automatically

// ---------- recording ----------
let rec = null, chunks = [], stream = null, stopTimer = null, cancelled = false;
function pickMime() {
  for (const m of ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"]) {
    if (window.MediaRecorder && MediaRecorder.isTypeSupported(m)) return m;
  }
  return "";
}
$("mic").addEventListener("click", () => {
  if (rec && rec.state === "recording") { rec.stop(); return; }
  startRecording();
});
async function startRecording() {
  if (rec && rec.state === "recording") return;
  clearError();
  cancelled = false;
  if (!navigator.mediaDevices || !window.MediaRecorder) { showError("This browser can't record. Please type instead."); return; }
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
  catch (_) { showError("Microphone access was blocked. Allow it in your settings, or type instead."); return; }
  const mime = pickMime();
  rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  chunks = [];
  const started = Date.now();
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  rec.onstop = () => {
    clearTimeout(stopTimer);
    stream.getTracks().forEach((t) => t.stop());
    if (meterStop) meterStop();
    document.body.classList.remove("recording");
    if (cancelled) { busy(false); return; }
    const type = rec.mimeType || "audio/webm";
    if (Date.now() - started < 800) { showError("That was too short. Tap, speak, then tap again."); busy(false); return; }
    const ext = type.includes("mp4") ? "m4a" : type.includes("ogg") ? "ogg" : "webm";
    readAudio(new Blob(chunks, { type }), "expense." + ext);
  };
  rec.start();
  document.body.classList.add("recording");
  meter(stream);
  $("micHint").textContent = "Listening… tap when done";
  if (navigator.vibrate) navigator.vibrate(10);
  stopTimer = setTimeout(() => rec.state === "recording" && rec.stop(), 45000);
}

// ---------- confirmation sheet ----------
function openSheet() {
  $("scrim").hidden = false; $("card").hidden = false;
  requestAnimationFrame(() => document.body.classList.add("sheet-open"));
}
function closeCard() {
  draft = null;
  document.body.classList.remove("sheet-open");
  setTimeout(() => { $("scrim").hidden = true; $("card").hidden = true; }, 260);
}
$("scrim").addEventListener("click", () => { if (!$("shareTo").hidden) closeShareTo(); else if (!$("addPerson").hidden) closeAddPerson(); else if (!$("contactsAsk").hidden) closeContactsAsk(); else if (!$("remind").hidden) closeRemind(); else closeCard(); });
$("discard").addEventListener("click", closeCard);
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && draft) closeCard(); });

function fillGroupSelect(sel, value, withAll) {
  sel.replaceChildren(...(withAll ? [Object.assign(el("option", null, "All groups"), { value: "" })] : []),
    ...state.groups.map((g) => Object.assign(el("option", null, g.name), { value: g.id })));
  sel.value = value;
}

function showCard(res, gid) {
  draft = res.expense;
  draftGroup = gid;
  draftHeard = res.transcript || null;
  draftChecks = res.checks || [];
  fillGroupSelect($("sheetGroup"), gid);
  $("heard").hidden = !res.transcript;
  $("heard").textContent = res.transcript ? "“" + res.transcript + "”" : "";
  $("desc").value = draft.description || "";
  $("total").value = draft.total || "";
  const matched = matchContacts(draft);
  paintCard(res);
  $("card").scrollTop = 0;
  openSheet();
  if (matched) recheck(); // names changed to the contact's full name, so work the shares out again
}
function newBlankCard(gid) {
  showCard({ expense: { description: "", total: null, payer: ME, participants: [...group(gid).people], mode: "equal", values: {}, items: [] }, missing: ["amount"], transcript: null }, gid);
  setTimeout(() => $("desc").focus(), 320);
}
$("sheetGroup").addEventListener("change", () => { draftGroup = $("sheetGroup").value; recheck(); });

function cardPeople() {
  return [...new Set([ME, ...group(draftGroup).people, draft.payer, ...draft.participants, ...draft.items.flatMap((i) => [...i.only, ...i.excluded])])].filter(Boolean);
}
function paintCard(res) {
  const people = cardPeople();
  $("payer").replaceChildren(...people.map((p) => { const o = el("option", null, p); o.value = p; o.selected = p === draft.payer; return o; }));
  $("sharers").replaceChildren(...people.map((p) => {
    const on = draft.participants.includes(p);
    const b = el("button", "chip" + (on ? " on" : ""), p);
    b.type = "button";
    b.setAttribute("aria-pressed", on);
    b.onclick = () => {
      draft.participants = on ? draft.participants.filter((x) => x !== p) : [...draft.participants, p];
      if (draft.mode !== "equal") { draft.mode = "equal"; draft.values = {}; }
      recheck();
    };
    return b;
  }));
  const modeNote = { shares: "Split by shares: ", percent: "Split by percent: ", exact: "Exact amounts: " }[draft.mode];
  $("modeNote").hidden = !modeNote;
  if (modeNote) $("modeNote").textContent = modeNote + Object.entries(draft.values).map(([k, v]) => `${k} ${v}${draft.mode === "percent" ? "%" : ""}`).join(", ") + ". Changing who shares switches to an equal split.";
  $("items").replaceChildren(...draft.items.map((it, i) => {
    const whoTxt = it.only.length ? "only " + it.only.join(", ") : "everyone except " + it.excluded.join(", ");
    const li = el("li", null, `${rupees(it.amount)} ${it.description || "item"}: ${whoTxt}`);
    const x = el("button", "link", "Remove");
    x.type = "button";
    x.onclick = () => { draft.items.splice(i, 1); recheck(); };
    li.append(x);
    return li;
  }));
  const owed = $("owed");
  owed.replaceChildren();
  const missing = res.missing || [];
  const problem = missing.includes("amount") ? "Add the amount." : missing.includes("people") ? "Choose who shares it." : res.problem;
  $("problem").hidden = !problem;
  $("problem").textContent = problem || "";
  const checks = (res.checks || []).filter((c) => draftChecks.includes(c));
  $("checks").replaceChildren(...checks.map((c) => el("li", null, c)));
  $("checks").hidden = !checks.length;
  if (res.owed) {
    for (const [name, amount] of Object.entries(res.owed)) {
      if (!amount) continue;
      const li = el("li");
      li.append(who(name === ME ? "Your share" : name), el("strong", null, rupees(amount)));
      owed.append(li);
    }
  }
  $("save").disabled = !res.owed;
  $("shareWa").disabled = !res.owed;
  lastOwed = res.owed || null;
}
let checkTimer = null;
function recheck() {
  draft.description = $("desc").value.trim() || "Expense";
  const t = parseFloat($("total").value);
  draft.total = Number.isFinite(t) && t > 0 ? t : null;
  draft.payer = $("payer").value || draft.payer;
  clearTimeout(checkTimer);
  checkTimer = setTimeout(async () => {
    try { paintCard(await post("/api/check", { expense: draft, people: group(draftGroup).people, transcript: draftHeard })); }
    catch (e) { $("problem").hidden = false; $("problem").textContent = e.message; $("save").disabled = true; }
  }, 150);
}
["desc", "total"].forEach((id) => $(id).addEventListener("input", recheck));
$("payer").addEventListener("change", recheck);
$("addSharer").addEventListener("submit", (e) => {
  e.preventDefault();
  if (!draft) return;
  const raw = $("newSharer").value.trim().replace(/\s+/g, " ");
  $("newSharer").value = "";
  if (!raw) return;
  const name = raw.toLowerCase() === "you" ? ME : (allPeople().find((p) => p.toLowerCase() === raw.toLowerCase()) || titleName(raw));
  if (!draft.participants.includes(name)) draft.participants = [...draft.participants, name];
  if (draft.mode !== "equal") { draft.mode = "equal"; draft.values = {}; }
  recheck();
});
$("save").addEventListener("click", () => {
  if (!draft || $("save").disabled) return;
  const g = group(draftGroup);
  for (const p of cardPeople()) if (!g.people.includes(p) && (p === draft.payer || draft.participants.includes(p))) g.people.push(p);
  g.expenses.unshift({ ...plainExpense(draft), id: newId(), at: new Date().toISOString() });
  state.current = g.id;
  persist();
  const what = draft.description;
  closeCard();
  $("typed").value = "";
  renderAll();
  toast(`Saved ${what} in ${g.name}`);
  if (navigator.vibrate) navigator.vibrate(15);
});

// ---------- rendering ----------
async function friendBalances() {
  const exps = allExpenses();
  if (!exps.length) return {};
  return (await post("/api/friends", { expenses: exps.map(plainExpense) })).friends;
}
function remindMessage(name, amount) {
  const me = state.profile.name ? ` – ${state.profile.name.split(" ")[0]}` : "";
  let msg = `Hi ${name}, a quick reminder: you owe me ${rupees(amount)} for our shared expenses on Kitty.`;
  const upi = (state.profile.upi || "").trim();
  if (/^[\w.\-]{2,}@[a-zA-Z]{2,}$/.test(upi)) msg += ` You can pay to my UPI ID: ${upi}.`;
  return msg + me;
}
function remindLink(name, amount) {
  const b = el("button", "wa", "Send reminder");
  b.type = "button";
  b.onclick = () => openRemind(name, amount);
  return b;
}
// One sheet sends reminders and invites, by WhatsApp, SMS or any other app.
let remindFor = null, sendKind = "remind";
function openSend(name, title, text, kind) {
  remindFor = name; sendKind = kind;
  $("remindTitle").textContent = title;
  $("remindText").value = text;
  $("remindPhone").value = (state.phones || {})[name] || "";
  $("remindPhone").dispatchEvent(new Event("input"));
  // The way you last reached this person comes first
  const sms = (state.via || {})[name] === "sms";
  $("sendBtns").classList.toggle("smsFirst", sms);
  $("scrim").hidden = false; $("remind").hidden = false;
  requestAnimationFrame(() => document.body.classList.add("remind-open"));
}
function openRemind(name, amount) { openSend(name, `Remind ${name} about ${rupees(amount)}`, remindMessage(name, amount), "remind"); }
const APP_LINK = /localhost|127\.0\.0\.1/.test(location.host) ? "https://voice-split.vercel.app" : location.origin;
function openInvite(name) {
  const me = state.profile.name ? ` – ${state.profile.name.split(" ")[0]}` : "";
  openSend(name, `Invite ${name} to Kitty`, `Hi ${name}, I'm using Kitty to split our expenses. Just say what you spent, in English, Tamil, Hindi or a mix, and it works out who owes what: ${APP_LINK}${me}`, "invite");
}
function closeRemind() {
  document.body.classList.remove("remind-open");
  setTimeout(() => { $("remind").hidden = true; if ($("card").hidden) $("scrim").hidden = true; }, 300);
}
// Indian numbers: keep the digits, and add the 91 country code to a 10-digit number.
function waNumber(raw) {
  const d = (raw || "").replace(/\D/g, "").replace(/^0+/, "");
  return d.length === 10 ? "91" + d : d.length >= 11 && d.length <= 15 ? d : "";
}
$("remindCancel").addEventListener("click", closeRemind);
$("remindPhone").addEventListener("input", () => {
  const raw = $("remindPhone").value.trim();
  $("remindNote").textContent = !raw ? "Without a number, WhatsApp lets you pick the chat. SMS needs their number."
    : waNumber(raw) ? "Opens a chat with this number, on WhatsApp or SMS." : "That number doesn't look right. Use 10 digits, or add the country code.";
});
// Saves the number and how you sent it, so their row shows it and it comes first next time
function sentVia(how, raw, num) {
  state.phones = state.phones || {}; state.via = state.via || {};
  if (num) state.phones[remindFor] = raw; else delete state.phones[remindFor];
  state.via[remindFor] = how;
  persist();
  closeRemind();
  renderAll();
}
$("remindSend").addEventListener("click", () => {
  const raw = $("remindPhone").value.trim();
  const num = waNumber(raw);
  if (raw && !num) { $("remindPhone").focus(); return; }
  window.open(`https://wa.me/${num}?text=${encodeURIComponent($("remindText").value)}`, "_blank", "noopener");
  sentVia("wa", raw, num);
  toast("Opening WhatsApp");
});
$("remindSms").addEventListener("click", () => {
  const raw = $("remindPhone").value.trim();
  const num = waNumber(raw);
  if (!num) { $("remindNote").textContent = "Add their mobile number to send an SMS."; $("remindPhone").focus(); return; }
  // "?&body=" works on both iPhone and Android
  location.href = `sms:+${num}?&body=${encodeURIComponent($("remindText").value)}`;
  sentVia("sms", raw, num);
  toast("Opening Messages");
});
$("remindOther").addEventListener("click", async () => {
  const text = $("remindText").value;
  if (navigator.share) { try { await navigator.share({ text }); closeRemind(); return; } catch (e) { if (e.name === "AbortError") return; } }
  try { await navigator.clipboard.writeText(text); toast("Message copied"); closeRemind(); } catch (_) { toast("Couldn't share. Copy the message instead."); }
});

async function renderHome(friends) {
  const first = (state.profile.name || "").split(" ")[0];
  $("greet").textContent = first ? `Hello, ${first} 👋` : "Hello there 👋";
  $("meInitial").textContent = (state.profile.name || "You").slice(0, 1).toUpperCase();
  const get = Object.values(friends).filter((v) => v > 0).reduce((a, b) => a + b, 0);
  const owe = Math.abs(Object.values(friends).filter((v) => v < 0).reduce((a, b) => a + b, 0));
  $("getBack").textContent = rupees(get); $("youOwe").textContent = rupees(owe);
  $("getBack").className = get ? "get" : "zero"; $("youOwe").className = owe ? "owe" : "zero";
  // These open Friends to show who owes what. At ₹0 there's nothing to show, so they don't open anything.
  $("getBack").closest("button").disabled = !get; $("youOwe").closest("button").disabled = !owe;
  const net = get - owe;
  $("heroLabel").textContent = net > 0 ? "Overall, you get back" : net < 0 ? "Overall, you owe" : "Overall";
  $("heroValue").textContent = rupees(Math.abs(net));
  $("heroSub").textContent = !allExpenses().length ? "Add your first expense to get started"
    : net === 0 ? "You're all settled up" : `${Object.values(friends).filter((v) => v).length} open ${Object.values(friends).filter((v) => v).length === 1 ? "balance" : "balances"} with friends`;
  document.querySelector(".hero").classList.toggle("neg", net < 0);
  const recent = allExpenses().sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 5);
  $("recent").replaceChildren(...recent.map((e) => {
    const li = el("li", "tap");
    li.append(who(e.description, `${e._group} · ${e.payer === ME ? "you paid" : e.payer + " paid"} · ${shortDate(e.at)}`, "cat"), el("strong", null, rupees(e.total)));
    li.onclick = () => go("group", e._gid);
    return li;
  }));
  $("recentEmpty").hidden = recent.length > 0;
  renderSpendChart();
  renderGroupChart();
}

let lastFriendBalances = {};
const WA_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm5.4 14.1c-.2.6-1.3 1.2-1.8 1.2-.5.1-1 .2-3.3-.7-2.8-1.1-4.5-3.9-4.7-4.1-.1-.2-1.1-1.5-1.1-2.9s.7-2 1-2.3c.2-.3.5-.3.7-.3h.5c.2 0 .4 0 .6.5l.8 2c.1.2.1.4 0 .5l-.3.5-.4.4c-.1.1-.3.3-.1.6.2.3.7 1.1 1.5 1.8 1 .9 1.9 1.2 2.2 1.3.3.1.4.1.6-.1l.8-1c.2-.3.4-.2.6-.1l1.9.9c.3.1.5.2.5.3.1.2.1.6-.1 1.2Z"/></svg>';
const SMS_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 3h16a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H8l-4 4V5a2 2 0 0 1 2-2Zm3 6v2h2V9H7Zm4 0v2h2V9h-2Zm4 0v2h2V9h-2Z"/></svg>';
function renderFriends(friends) {
  lastFriendBalances = friends;
  // Everyone you know: people in your groups, friends you added, and anyone with a balance.
  const all = [...new Set([...allPeople(), ...Object.keys(friends)])].filter((n) => n !== ME)
    .sort((a, b) => Math.abs(friends[b] || 0) - Math.abs(friends[a] || 0) || a.localeCompare(b));
  // Search by name, or by any part of a saved number
  const q = $("friendSearch").value.trim().toLowerCase();
  const digits = q.replace(/\D/g, "");
  const names = !q ? all : all.filter((n) => n.toLowerCase().includes(q) || (digits.length >= 3 && ((state.phones || {})[n] || "").replace(/\D/g, "").includes(digits)));
  $("friendsEmpty").hidden = all.length > 0;
  $("friendsNoMatch").hidden = !(all.length && q && !names.length);
  $("noMatchText").textContent = `No one matches “${$("friendSearch").value.trim()}”`;
  $("addSearched").hidden = !!digits && digits.length === q.length; // a number alone isn't a name
  const owingMe = all.filter((n) => (friends[n] || 0) > 0).length;
  $("friends").replaceChildren(...names.map((n) => {
    const v = friends[n] || 0;
    const groups = state.groups.filter((g) => g.people.includes(n)).map((g) => g.name).join(", ");
    const li = el("li", "pay");
    const amt = el("span", "amt " + (v > 0 ? "get" : v < 0 ? "owe" : "zero"));
    amt.append(el("small", null, v > 0 ? "owes you" : v < 0 ? "you owe" : "settled up"), el("strong", null, v ? rupees(Math.abs(v)) : ""));
    const phone = (state.phones || {})[n];
    const w = who(n, groups || phone || "No number yet");
    const via = (state.via || {})[n];
    if (via) { // how you last reached them, never a guess
      const badge = el("span", "via " + via); badge.innerHTML = via === "sms" ? SMS_ICON : WA_ICON;
      badge.title = via === "sms" ? "Last reached by SMS" : "Last reached on WhatsApp";
      badge.setAttribute("aria-label", badge.title);
      w.querySelector(".name").append(badge);
    }
    li.append(w, amt);
    if (v > 0) li.append(remindLink(n, v));
    const acts = el("div", "friendActions");
    if (!phone) { const a = el("button", "link", "Add number"); a.type = "button"; a.onclick = () => openAddPerson(n, true); acts.append(a); }
    const inv = el("button", "link", "Invite to Kitty"); inv.type = "button"; inv.onclick = () => openInvite(n); acts.append(inv);
    const used = state.groups.some((g) => g.expenses.some((e) => e.payer === n || e.participants.includes(n)));
    if (!used && (state.friends || []).includes(n)) {
      const x = el("button", "link removeFriend", "Remove"); x.type = "button";
      x.onclick = () => { state.friends = state.friends.filter((f) => f !== n); persist(); renderAll(); toast(`Removed ${n}`); };
      acts.append(x);
    }
    li.append(acts);
    return li;
  }));
  $("badge").hidden = !owingMe; $("badge").textContent = owingMe;
  $("friendsTips").hidden = all.length >= 3;
  renderFriendsChart(friends);
}

async function renderGroups() {
  const items = await Promise.all(state.groups.map(async (g) => {
    let mine = 0;
    if (g.expenses.length) {
      try { mine = (await post("/api/balances", { expenses: g.expenses.map(plainExpense) })).net[ME] || 0; } catch (_) {}
    }
    const li = el("li", "tap");
    const right = el("span", "amt " + (mine > 0 ? "get" : mine < 0 ? "owe" : "zero"));
    right.append(el("small", null, mine > 0 ? "you get back" : mine < 0 ? "you owe" : "settled"), el("strong", null, mine ? rupees(Math.abs(mine)) : ""));
    li.append(who(g.name, `${g.people.length} ${g.people.length === 1 ? "person" : "people"} · ${g.expenses.length} ${g.expenses.length === 1 ? "expense" : "expenses"}`, "cat"), right);
    li.onclick = () => go("group", g.id);
    return li;
  }));
  $("groups").replaceChildren(...items);
  const have = new Set(state.groups.map((g) => g.name.toLowerCase()));
  const ideas = GROUP_IDEAS.filter((n) => !have.has(n.toLowerCase()));
  document.querySelector(".ideasCard").hidden = !ideas.length;
  $("groupIdeas").replaceChildren(...ideas.map((n) => { const b = el("button", "chip", "+ " + n); b.type = "button"; b.onclick = () => createGroup(n); return b; }));
  $("groupsTips").hidden = state.groups.some((g) => g.expenses.length);
}

async function renderGroup() {
  const g = group(openGroupId);
  if (!g) return;
  $("gExpensesEmpty").hidden = g.expenses.length > 0;
  $("gExpenses").replaceChildren(...g.expenses.map((e) => {
    const li = el("li");
    const right = el("div", "right");
    const del = el("button", "link", "Delete"); del.type = "button";
    del.onclick = () => {
      if (!confirm(`Delete "${e.description}"?`)) return;
      g.expenses = g.expenses.filter((x) => x.id !== e.id); persist(); renderAll(); toast("Deleted");
    };
    right.append(el("strong", null, rupees(e.total)), del);
    li.append(who(e.description, `${e.payer === ME ? "You paid" : e.payer + " paid"} · ${shortDate(e.at)} · ${e.participants.join(", ")}`, "cat"), right);
    return li;
  }));
  $("gPeople").replaceChildren(...g.people.map((p) => {
    const li = el("li");
    li.append(who(p === ME ? (state.profile.name ? state.profile.name + " (you)" : "You") : p));
    if (p !== ME && !g.expenses.some((e) => e.payer === p || e.participants.includes(p))) {
      const x = el("button", "link", "Remove"); x.type = "button";
      x.onclick = () => { g.people = g.people.filter((q) => q !== p); persist(); renderGroup(); };
      li.append(x);
    }
    return li;
  }));
  // Friends not in this group yet, one tap to add
  const others = allPeople().filter((n) => n !== ME && !g.people.includes(n)).sort((a, b) => a.localeCompare(b));
  $("gFriendChips").replaceChildren(...others.map((n) => {
    const b = el("button", "chip addChip", "+ " + n); b.type = "button";
    b.onclick = () => { joinGroup(g.id, [n]); persist(); renderGroup(); renderGroups(); toast(`Added ${n} to ${g.name}`); };
    return b;
  }));
  $("gFriendChips").hidden = !others.length;
  renderGroupShare(g);
  const settle = $("gSettle");
  settle.replaceChildren();
  $("gBal").textContent = "₹0"; $("gBal").className = "zero"; $("gBalLabel").textContent = "All settled";
  $("gSettleEmpty").hidden = false;
  if (!g.expenses.length) return;
  try {
    const b = await post("/api/balances", { expenses: g.expenses.map(plainExpense) });
    const mine = b.net[ME] || 0;
    $("gBal").textContent = rupees(Math.abs(mine));
    $("gBal").className = mine > 0 ? "get" : mine < 0 ? "owe" : "zero";
    $("gBalLabel").textContent = mine > 0 ? "You get back" : mine < 0 ? "You owe" : "All settled";
    $("gSettleEmpty").hidden = b.payments.length > 0;
    for (const p of b.payments) {
      const li = el("li", "pay");
      const line = p.to === ME ? `${p.from} pays you` : p.from === ME ? `You pay ${p.to}` : `${p.from} pays ${p.to}`;
      li.append(who(line), el("strong", p.to === ME ? "get" : p.from === ME ? "owe" : "", rupees(p.amount)));
      if (p.to === ME) li.append(remindLink(p.from, p.amount));
      settle.append(li);
    }
  } catch (e) { settle.append(el("li", "problem", e.message)); }
}
$("gAdd").addEventListener("click", () => newBlankCard(openGroupId));
let addToGroup = null; // a group the next added friend should also join
function joinGroup(gid, names) {
  const g = group(gid);
  if (!g) return 0;
  const fresh = names.filter((n) => n && n !== ME && !g.people.includes(n));
  g.people.push(...fresh);
  return fresh.length;
}
$("gFromContacts").addEventListener("click", () => { addToGroup = openGroupId; openContactsAsk("friends"); });
$("gByNumber").addEventListener("click", () => { addToGroup = openGroupId; openAddPerson(); });
$("gDelete").addEventListener("click", () => {
  const g = group(openGroupId);
  if (!g) return;
  if (state.groups.length === 1) { toast("You need at least one group"); return; }
  if (!confirm(`Delete "${g.name}" and its ${g.expenses.length} expenses?`)) return;
  state.groups = state.groups.filter((x) => x.id !== g.id);
  if (state.current === g.id) state.current = state.groups[0].id;
  persist(); go("groups"); renderAll(); toast("Group deleted");
});
$("friendFromContacts").addEventListener("click", () => openContactsAsk("friends"));
$("friendByNumber").addEventListener("click", () => openAddPerson());
$("friendSearch").addEventListener("input", () => renderFriends(lastFriendBalances));
$("addSearched").addEventListener("click", () => openAddPerson($("friendSearch").value));

// Add a friend with their mobile number, so Kitty can send them their share
let apEditing = null; // set when adding a number for someone already in Kitty
function openAddPerson(name, editing) {
  apEditing = editing ? name : null;
  $("apTitle").textContent = editing ? `Add ${name}'s number` : "Add a friend";
  $("apSubmit").textContent = editing ? "Save number" : "Add friend";
  $("apName").readOnly = !!editing;
  $("apName").value = typeof name === "string" ? (editing ? name : titleName(name)) : ""; $("apPhone").value = ""; $("apError").hidden = true;
  $("scrim").hidden = false; $("addPerson").hidden = false;
  requestAnimationFrame(() => document.body.classList.add("addPerson-open"));
  setTimeout(() => $($("apName").value ? "apPhone" : "apName").focus(), 320);
}
function closeAddPerson() {
  setTimeout(() => { addToGroup = null; }, 0);
  document.body.classList.remove("addPerson-open");
  setTimeout(() => { $("addPerson").hidden = true; if ($("card").hidden && $("remind").hidden && $("contactsAsk").hidden) $("scrim").hidden = true; }, 300);
}
$("apCancel").addEventListener("click", closeAddPerson);
["apName", "apPhone"].forEach((id) => $(id).addEventListener("input", () => { $("apError").hidden = true; }));
$("addPersonForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const name = titleName($("apName").value);
  const raw = $("apPhone").value.trim();
  const bad = (msg, field) => { $("apError").textContent = msg; $("apError").hidden = false; $(field).focus(); };
  if (!name) return bad("Add their name.", "apName");
  if (!waNumber(raw)) return bad("Add their mobile number: 10 digits, or with the country code.", "apPhone");
  if (apEditing) {
    state.phones = state.phones || {}; state.phones[apEditing] = raw;
    persist(); closeAddPerson(); renderAll(); toast(`Saved ${apEditing}'s number`); return;
  }
  if (name.toLowerCase() === "you" || allPeople().some((p) => p.toLowerCase() === name.toLowerCase())) return bad(`${name} is already a friend.`, "apName");
  state.friends = [...(state.friends || []), name];
  state.phones = state.phones || {}; state.phones[name] = raw;
  $("friendSearch").value = "";
  const g = addToGroup && group(addToGroup);
  if (g) joinGroup(g.id, [name]);
  addToGroup = null;
  persist(); closeAddPerson(); renderAll(); toast(g ? `Added ${name} to ${g.name}` : `Added ${name}`);
});
function createGroup(name) {
  if (state.groups.some((g) => g.name.toLowerCase() === name.toLowerCase())) { toast(`You already have ${name}`); return; }
  const g = blankGroup(name);
  state.groups.push(g); state.current = g.id; persist(); renderAll(); go("group", g.id); toast(`Created ${name}`);
}
$("newGroup").addEventListener("submit", (e) => {
  e.preventDefault();
  const name = $("newGroupName").value.trim().replace(/\s+/g, " ");
  $("newGroupName").value = "";
  if (name) createGroup(name);
});
// One-tap ideas, leaving out any the person already has
const GROUP_IDEAS = ["Goa trip", "Flat", "Office lunch", "Family", "Weekend trip"];

function renderAccount() {
  const p = state.profile;
  $("pName").value = p.name || ""; $("pPhone").value = p.phone || ""; $("pUpi").value = p.upi || "";
  $("meName").textContent = p.name || "You";
  $("meAvatar").textContent = (p.name || "You").slice(0, 1).toUpperCase();
  $("meSub").textContent = p.phone ? p.phone + " · saved on this phone" : "Saved on this phone";
  const keep = $("xGroup").value;
  fillGroupSelect($("xGroup"), state.groups.some((g) => g.id === keep) ? keep : "", true);
  renderExportCount();
}
for (const [id, key] of [["pName", "name"], ["pPhone", "phone"], ["pUpi", "upi"]]) {
  $(id).addEventListener("change", () => { state.profile[key] = key === "name" ? titleName($(id).value) : $(id).value.trim(); persist(); renderAccount(); renderAll(); toast("Saved"); });
}
$("reset").addEventListener("click", () => {
  if (!confirm("Delete all groups, expenses and your details on this phone?")) return;
  localStorage.removeItem(KEY); localStorage.removeItem(OLD_KEY);
  state = load(); persist(); closeCard(); renderAll(); go("home"); toast("All data deleted");
});

// ---------- export ----------
function exportRange() {
  const now = new Date();
  const r = $("xRange").value;
  const start = (m) => new Date(now.getFullYear(), now.getMonth() - m, 1);
  if (r === "this") return { from: start(0), to: null, label: now.toLocaleDateString("en-IN", { month: "long", year: "numeric" }) };
  if (r === "last") { const f = start(1); return { from: f, to: start(0), label: f.toLocaleDateString("en-IN", { month: "long", year: "numeric" }) }; }
  if (r === "all") return { from: null, to: null, label: "All time" };
  const f = start(Number(r) - 1);
  return { from: f, to: null, label: `${f.toLocaleDateString("en-IN", { month: "short", year: "numeric" })} to ${now.toLocaleDateString("en-IN", { month: "short", year: "numeric" })}` };
}
function exportRows() {
  const { from, to, label } = exportRange();
  const gid = $("xGroup").value;
  const rows = allExpenses()
    .filter((e) => (!gid || e._gid === gid) && (!from || new Date(e.at) >= from) && (!to || new Date(e.at) < to))
    .sort((a, b) => (a.at < b.at ? -1 : 1));
  const gname = gid ? group(gid).name : "All groups";
  return { rows, title: `Kitty: ${gname}, ${label}`, file: `kitty-${gname}-${label}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-+$/, "") };
}
function renderExportCount() {
  const n = exportRows().rows.length;
  $("xCount").textContent = n ? `${n} ${n === 1 ? "expense" : "expenses"} in this period.` : "No expenses in this period.";
  $("xExcel").disabled = $("xPdf").disabled = !n;
}
$("xRange").addEventListener("change", renderExportCount);
$("xGroup").addEventListener("change", renderExportCount);

async function saveFile(blob, name) {
  const file = new File([blob], name, { type: blob.type });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); return; } catch (e) { if (e.name === "AbortError") return; }
  }
  const a = el("a"); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
$("xExcel").addEventListener("click", async () => {
  const { rows, title, file } = exportRows();
  if (!rows.length) return;
  $("xExcel").disabled = true;
  try {
    const res = await post("/api/export-xlsx", { title, rows: rows.map((e) => ({ date: new Date(e.at).toLocaleDateString("en-IN"), group: e._group, expense: plainExpense(e) })) }, false, true);
    await saveFile(await res.blob(), file + ".xlsx");
    toast("Excel file ready");
  } catch (e) { toast(e.message); }
  finally { $("xExcel").disabled = false; }
});
// The PDF uses the phone's own print screen ("Save as PDF"), so Tamil and Hindi names print correctly.
$("xPdf").addEventListener("click", async () => {
  const { rows, title } = exportRows();
  if (!rows.length) return;
  let owedRows = [];
  try {
    const all = await Promise.all(rows.map((e) => post("/api/check", { expense: plainExpense(e), people: [] })));
    owedRows = all.map((r) => r.owed || {});
  } catch (e) { toast(e.message); return; }
  const p = $("print");
  p.replaceChildren();
  p.append(el("h1", null, title), el("p", "meta", `Prepared for ${state.profile.name || "you"} on ${new Date().toLocaleDateString("en-IN")}`));
  const table = el("table");
  const head = el("tr");
  for (const h of ["Date", "Group", "Expense", "Paid by", "Amount", "Your share"]) head.append(el("th", null, h));
  table.append(head);
  let total = 0, mine = 0;
  rows.forEach((e, i) => {
    const tr = el("tr");
    const share = owedRows[i][ME] || 0;
    total += Number(e.total); mine += share;
    for (const v of [new Date(e.at).toLocaleDateString("en-IN"), e._group, e.description, e.payer, rupees(e.total), rupees(share)]) tr.append(el("td", null, v));
    table.append(tr);
  });
  const foot = el("tr", "foot");
  for (const v of ["", "", "Total", "", rupees(total), rupees(mine)]) foot.append(el("td", null, v));
  table.append(foot);
  p.append(table);
  const friends = await friendBalances().catch(() => ({}));
  const owes = Object.entries(friends).filter(([, v]) => v);
  if (owes.length) {
    p.append(el("h2", null, "Balances today, across all groups"));
    const ul = el("ul");
    for (const [n, v] of owes) ul.append(el("li", null, v > 0 ? `${n} owes you ${rupees(v)}` : `You owe ${n} ${rupees(-v)}`));
    p.append(ul);
  }
  p.append(el("p", "meta", "Made with Kitty. Shares are calculated exactly, to the paisa."));
  window.print();
});

// ---------- startup ----------
async function renderAll() {
  renderAccount();
  let friends = {};
  try { friends = await friendBalances(); } catch (_) {}
  renderHome(friends);
  renderFriends(friends);
  renderGroups();
  if (!$("view-group").hidden) renderGroup();
}
if (state.samples) {
  const used = new Set(state.groups.flatMap((g) => g.expenses.flatMap((e) => [e.payer, ...e.participants])));
  state.friends = (state.friends || []).filter((f) => !state.samples.includes(f) || used.has(f));
  delete state.samples;
}
if (state.profile && state.profile.name) state.profile.name = titleName(state.profile.name);
persist(); // saves data brought over from the first version
paintLangs();
const startHash = (location.hash || "#home").slice(1);
if (startHash.startsWith("group/")) go("group", startHash.slice(6)); else go(startHash);
renderAll();

// Lets the phone install this as an app from the browser's "Add to Home Screen".
if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});


// ---------- charts ----------
// Plain SVG. One hue per job: blue for your spending, green for "owes you", orange for "you owe".
// Every value also has a text label, so colour is never the only way to read it.
const SVGNS = "http://www.w3.org/2000/svg";
function svg(tag, attrs, text) {
  const n = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs || {})) n.setAttribute(k, v);
  if (text != null) n.textContent = text;
  return n;
}
const shortRupees = (n) => n >= 100000 ? "₹" + (n / 100000).toFixed(n >= 1000000 ? 0 : 1) + "L" : n >= 1000 ? "₹" + (n / 1000).toFixed(n >= 10000 ? 0 : 1) + "k" : "₹" + Math.round(n);
// A bar with a 4px rounded end and a square base.
function barPath(x, y, w, h, dir) {
  const r = Math.min(4, Math.abs(dir === "up" ? h : w) / 2);
  if (dir === "up") return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
  if (dir === "right") return `M${x},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h - r}Q${x + w},${y + h} ${x + w - r},${y + h}H${x}Z`;
  return `M${x + w},${y}H${x + r}Q${x},${y} ${x},${y + r}V${y + h - r}Q${x},${y + h} ${x + r},${y + h}H${x + w}Z`;
}
let sharesCache = { key: "", list: [] };
async function myShares() {
  const exps = allExpenses();
  const key = exps.map((e) => e.id).join(",");
  if (sharesCache.key === key) return { exps, list: sharesCache.list };
  const list = exps.length ? (await post("/api/shares", { expenses: exps.map(plainExpense) })).shares : [];
  sharesCache = { key, list };
  return { exps, list };
}

async function renderSpendChart() {
  const card = $("spendCard"), box = $("spendChart");
  let data;
  try { data = await myShares(); } catch (_) { data = { exps: [], list: [] }; }
  const now = new Date();
  const months = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({ key: d.getFullYear() + "-" + d.getMonth(), label: d.toLocaleDateString("en-IN", { month: "short" }), total: 0 });
  }
  data.exps.forEach((e, i) => {
    const d = new Date(e.at);
    const m = months.find((x) => x.key === d.getFullYear() + "-" + d.getMonth());
    if (m) m.total += data.list[i][ME] || 0;
  });
  card.hidden = false;
  const W = 320, H = 150, top = 22, base = H - 24, slot = W / months.length, bw = Math.min(24, slot * 0.5);
  const empty = months.every((m) => !m.total);
  if (empty) { box.replaceChildren(placeholderColumns(months.map((m) => m.label), "Your monthly share will show here")); $("spendNote").textContent = "Last 6 months"; return; }
  const max = Math.max(...months.map((m) => m.total), 1);
  const root = svg("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": "Your share of spending for the last six months: " + months.map((m) => `${m.label} ${rupees(m.total)}`).join(", ") });
  root.append(svg("line", { x1: 0, x2: W, y1: base + 0.5, y2: base + 0.5, class: "axis" }));
  const tip = svg("text", { class: "tip", "text-anchor": "middle" });
  months.forEach((m, i) => {
    const x = slot * i + (slot - bw) / 2;
    const h = m.total ? Math.max(3, (base - top) * (m.total / max)) : 0;
    const g = svg("g", { class: "hit" + (i === months.length - 1 ? " now" : "") });
    g.append(svg("rect", { x: slot * i, y: 0, width: slot, height: H, fill: "transparent" }));
    if (h) g.append(svg("path", { d: barPath(x, base - h, bw, h, "up"), class: "bar blue", style: `--d:${i * 60}ms` }));
    g.append(svg("text", { x: x + bw / 2, y: H - 6, "text-anchor": "middle", class: "tick" }, m.label));
    const show = () => { tip.textContent = rupees(m.total); tip.setAttribute("x", Math.min(W - 28, Math.max(28, x + bw / 2))); tip.setAttribute("y", Math.max(14, base - h - 7)); };
    g.addEventListener("pointerenter", show); g.addEventListener("click", show);
    root.append(g);
    if (i === months.length - 1) show();
  });
  root.append(tip);
  box.replaceChildren(root);
  const total = months.reduce((a, m) => a + m.total, 0);
  $("spendNote").textContent = `Your share: ${rupees(total)}`;
}

function renderFriendsChart(friends) {
  const card = $("friendsCard"), box = $("friendsChart");
  const rows = Object.entries(friends).sort((a, b) => b[1] - a[1]);
  card.hidden = false;
  if (!rows.length) { box.replaceChildren(placeholderRows(3, "Who owes you, and whom you owe, shows here")); return; }
  const W = 320, row = 34, H = rows.length * row + 6, mid = W / 2, nameW = 0;
  const max = Math.max(...rows.map(([, v]) => Math.abs(v)), 1);
  const span = mid - 52;
  const root = svg("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": rows.map(([n, v]) => v > 0 ? `${n} owes you ${rupees(v)}` : `you owe ${n} ${rupees(-v)}`).join(", ") });
  root.append(svg("line", { x1: mid + 0.5, x2: mid + 0.5, y1: 0, y2: H, class: "axis" }));
  rows.forEach(([n, v], i) => {
    const y = i * row + 8, bh = 18, w = Math.max(3, span * Math.abs(v) / max);
    const right = v > 0;
    const x = right ? mid + 1 : mid - w;
    root.append(svg("path", { d: barPath(x, y, w, bh, right ? "right" : "left"), class: "bar " + (right ? "green" : "orange"), style: `--d:${i * 60}ms` }));
    // Name on the empty side of the axis, amount at the end of the bar.
    root.append(svg("text", { x: right ? mid - 8 : mid + 8, y: y + 13, "text-anchor": right ? "end" : "start", class: "lbl" }, n));
    root.append(svg("text", { x: right ? x + w + 6 : x - 6, y: y + 13, "text-anchor": right ? "start" : "end", class: "val" }, shortRupees(Math.abs(v))));
  });
  void nameW;
  box.replaceChildren(root);
}

async function renderGroupShare(g) {
  const card = $("gShareCard"), box = $("gShareChart");
  if (!g.expenses.length) { card.hidden = true; return; }
  let list;
  try { list = (await post("/api/shares", { expenses: g.expenses.map(plainExpense) })).shares; } catch (_) { card.hidden = true; return; }
  const totals = {};
  list.forEach((sh) => { for (const [k, v] of Object.entries(sh)) totals[k] = (totals[k] || 0) + v; });
  const rows = Object.entries(totals).filter(([, v]) => v).sort((a, b) => b[1] - a[1]);
  const spent = g.expenses.reduce((a, e) => a + Number(e.total), 0);
  card.hidden = false;
  $("gShareNote").textContent = `${rupees(spent)} spent in total`;
  const W = 320, row = 34, H = rows.length * row + 4, labelW = 88, span = W - labelW - 56;
  const max = Math.max(...rows.map(([, v]) => v), 1);
  const root = svg("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": rows.map(([n, v]) => `${n} ${rupees(v)}`).join(", ") });
  rows.forEach(([n, v], i) => {
    const y = i * row + 8, w = Math.max(3, span * v / max);
    root.append(svg("text", { x: 0, y: y + 13, class: "lbl" }, n === ME ? "You" : (n.length > 11 ? n.slice(0, 10) + "…" : n)));
    root.append(svg("path", { d: barPath(labelW, y, w, 18, "right"), class: "bar " + (n === ME ? "blue" : "soft"), style: `--d:${i * 60}ms` }));
    root.append(svg("text", { x: labelW + w + 6, y: y + 13, class: "val" }, rupees(v)));
  });
  box.replaceChildren(root);
}


// Empty charts: faint placeholder marks and a short note, so the layout is the same before and after data.
function placeholderColumns(labels, note) {
  const W = 320, H = 150, base = H - 24, slot = W / labels.length, bw = Math.min(24, slot * 0.5);
  const heights = [0.35, 0.55, 0.3, 0.7, 0.45, 0.6];
  const root = svg("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": note });
  root.append(svg("line", { x1: 0, x2: W, y1: base + 0.5, y2: base + 0.5, class: "axis" }));
  labels.forEach((l, i) => {
    const x = slot * i + (slot - bw) / 2, h = (base - 30) * heights[i % heights.length];
    root.append(svg("path", { d: barPath(x, base - h, bw, h, "up"), class: "ghostBar" }));
    root.append(svg("text", { x: x + bw / 2, y: H - 6, "text-anchor": "middle", class: "tick" }, l));
  });
  root.append(svg("text", { x: W / 2, y: 56, "text-anchor": "middle", class: "ghostNote" }, note));
  return root;
}
function placeholderRows(n, note) {
  const W = 320, row = 30, H = n * row + 34;
  const root = svg("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": note });
  [0.8, 0.55, 0.35].slice(0, n).forEach((f, i) => {
    const y = i * row + 6;
    root.append(svg("rect", { x: 0, y: y + 4, width: 64, height: 10, rx: 5, class: "ghostBar" }));
    root.append(svg("path", { d: barPath(80, y, (W - 140) * f, 18, "right"), class: "ghostBar" }));
  });
  root.append(svg("text", { x: W / 2, y: H - 6, "text-anchor": "middle", class: "ghostNote" }, note));
  return root;
}

async function renderGroupChart() {
  const box = $("groupChart");
  let data;
  try { data = await myShares(); } catch (_) { data = { exps: [], list: [] }; }
  const totals = {};
  data.exps.forEach((e, i) => { totals[e._group] = (totals[e._group] || 0) + (data.list[i][ME] || 0); });
  const rows = Object.entries(totals).filter(([, v]) => v).sort((a, b) => b[1] - a[1]).slice(0, 5);
  if (!rows.length) { box.replaceChildren(placeholderRows(3, "Your share in each group will show here")); $("groupNote").textContent = "Your share"; return; }
  const W = 320, row = 34, H = rows.length * row + 4, labelW = 96, span = W - labelW - 64;
  const max = Math.max(...rows.map(([, v]) => v), 1);
  const root = svg("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": "Your share by group: " + rows.map(([n, v]) => `${n} ${rupees(v)}`).join(", ") });
  rows.forEach(([n, v], i) => {
    const y = i * row + 8, w = Math.max(3, span * v / max);
    root.append(svg("text", { x: 0, y: y + 13, class: "lbl" }, n.length > 12 ? n.slice(0, 11) + "…" : n));
    root.append(svg("path", { d: barPath(labelW, y, w, 18, "right"), class: "bar hbar", style: `--d:${i * 60}ms` }));
    root.append(svg("text", { x: labelW + w + 6, y: y + 13, class: "val" }, rupees(v)));
  });
  box.replaceChildren(root);
  $("groupNote").textContent = `Your share: ${rupees(rows.reduce((a, [, v]) => a + v, 0))}`;
}


// ---------- first-run walkthrough ----------
// Welcome -> How it works (6 illustrated steps) -> Let's set you up -> the app.
const TOUR_VERSION = 6;
// A screen that's being hidden finishes fading first; showing it again cancels that,
// so a quick Back never ends on a blank screen.
const stageTimers = {};
function showStage(id) {
  clearTimeout(stageTimers[id]);
  $(id).hidden = false;
  requestAnimationFrame(() => document.body.classList.add(id + "-open"));
}
function hideStage(id) {
  clearTimeout(stageTimers[id]);
  document.body.classList.remove(id + "-open");
  stageTimers[id] = setTimeout(() => { $(id).hidden = true; }, 350);
}
function openIntro() {
  hideStage("setup"); hideStage("how");
  $("oName").value = "";
  $("oUpi").value = "";
  $("oError").hidden = true;
  showStage("intro");
}
function openHow() {
  showStage("how");
  showHow(0);
  hideStage("intro");
}
// Last step: name and UPI ID, after the walkthrough
function openSetup() {
  stopHow();
  showStage("setup");
  hideStage("how"); hideStage("intro");
}
function finishOnboarding() {
  state.onboarded = TOUR_VERSION;
  persist();
  hideStage("how"); hideStage("intro"); hideStage("setup");
  stopHow();
  go("home");
  renderAll();
  toast(`Welcome, ${state.profile.name.split(" ")[0]}`);
  if (!state.contactsAsked) setTimeout(openContactsAsk, 1400);
}
$("introNext").addEventListener("click", openHow);
$("introSkip").addEventListener("click", openSetup);
$("setupDone").addEventListener("click", () => {
  // The name is always what the person types here, never one saved earlier.
  const name = titleName($("oName").value);
  if (!name) { $("oError").hidden = false; $("oName").focus(); return; }
  state.profile.name = name;
  state.profile.upi = $("oUpi").value.trim();
  paintLangs();
  finishOnboarding();
});

// ---------- "How it works": illustrated with CSS and SVG ----------
// One expense runs through every step: the ₹10,000 dinner, where Akash skipped drinks.
// Its numbers come from the app's own split maths (splits.py).
const HOW = [
  { title: "Just say it", text: "Tap the mic and say the expense the way you'd tell a friend, in English, Tamil, Hindi or a mix." },
  { title: "Find your friends", text: "Pick them from your contacts, or add someone by name and mobile number. Everything stays on your phone." },
  { title: "Kitty finds the people", text: "The names you said show up, ready to check. Tap Next when it looks right." },
  { title: "Check it, then save", text: "Akash skipped drinks, so he pays only for food. Fix anything with a tap, then save." },
  { title: "Groups keep the tally", text: "Make a group for a trip or your flat. Every expense adds up, and Kitty works out who pays whom in the fewest payments." },
  { title: "Split and share", text: "Post the split in your group chat on WhatsApp, or send it by SMS or any other app. Later, remind anyone on their own from Friends." },
];
const SAY = [
  { lang: "Tanglish", text: "Petrol-ku naan 1,200 kuduthen, Arun Ravi kooda split pannu" },
  { lang: "Hinglish", text: "Maine dinner ke 900 diye, Arun aur Ravi ke saath split karo" },
  { lang: "தமிழ்", text: "நான் சாப்பாட்டுக்கு ஆயிரம் ரூபாய் கொடுத்தேன், பிரதி கூட பிரிச்சுக்கோ" },
  { lang: "हिंदी", text: "मैंने ऑटो के लिए तीन सौ रुपये दिए, अरुण के साथ बाँट दो" },
  { lang: "English", text: "Last night's dinner ₹10,000, I paid, split with Ravi, Suresh, Akash and Arun" },
];
let howAt = 0, howTimer = null;
function stopHow() { clearTimeout(howTimer); }
// Types each example in turn and stops on the English one, the dinner the next steps follow.
function typeSayings(n = 0) {
  const ex = SAY[n], t = $("howTyping"), chars = [...ex.text];
  $("howLang").textContent = ex.lang;
  t.textContent = "";
  let i = 0;
  const type = () => {
    t.textContent = chars.slice(0, ++i).join("");
    if (i < chars.length) { howTimer = setTimeout(type, 26); return; }
    if (n < SAY.length - 1) howTimer = setTimeout(() => typeSayings(n + 1), 900);
  };
  type();
}
function showHow(i) {
  stopHow();
  howAt = i;
  const phone = $("phone");
  phone.dataset.step = i;
  phone.classList.remove("play"); void phone.offsetWidth; phone.classList.add("play"); // restart the animations
  $("howTitle").textContent = HOW[i].title;
  $("howText").textContent = HOW[i].text;
  $("howDots").replaceChildren(...HOW.map((_, k) => el("i", k === i ? "on" : "")));
  $("howNext").textContent = "Next";
  $("howSkip").hidden = i === HOW.length - 1;
  $("howTyping").textContent = "";
  const g = $("howGroupName");
  g.textContent = "";
  if (i === 0) howTimer = setTimeout(() => typeSayings(0), 700);
  $("howFfName").textContent = ""; $("howFfPhone").textContent = "";
  if (i === 1) {
    // After the contacts, one friend is added by hand: name, then number
    const typeInto = (box, text, then) => { const c = [...text]; let n = 0;
      const type = () => { box.textContent = c.slice(0, ++n).join(""); if (n < c.length) howTimer = setTimeout(type, 90); else if (then) howTimer = setTimeout(then, 250); };
      type(); };
    howTimer = setTimeout(() => typeInto($("howFfName"), "Priya", () => typeInto($("howFfPhone"), "987xxxxxxx")), 5700);
  }
  if (i === 4) {
    const chars = [..."Goa trip"];
    let n = 0;
    const type = () => { g.textContent = chars.slice(0, ++n).join(""); if (n < chars.length) howTimer = setTimeout(type, 110); };
    howTimer = setTimeout(type, 900);
  }
}
$("howNext").addEventListener("click", () => { if (howAt < HOW.length - 1) showHow(howAt + 1); else openSetup(); });
$("howSkip").addEventListener("click", openSetup);
// Back: to the previous step, from the first step to Welcome, and from set up to the last step
$("howBack").addEventListener("click", () => { if (howAt > 0) showHow(howAt - 1); else { stopHow(); showStage("intro"); hideStage("how"); } });
$("setupBack").addEventListener("click", () => { showStage("how"); showHow(HOW.length - 1); hideStage("setup"); });
// Swipe like a phone: right to go back, left to go on. Works with a finger or a mouse drag.
function onSwipe(id, back, next) {
  let x0 = null, y0 = 0;
  $(id).addEventListener("pointerdown", (e) => { if (e.target.closest("input,button")) { x0 = null; return; } x0 = e.clientX; y0 = e.clientY; });
  $(id).addEventListener("pointerup", (e) => {
    if (x0 === null) return;
    const dx = e.clientX - x0, dy = e.clientY - y0;
    x0 = null;
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return; // a scroll or a tap, not a swipe
    if (dx > 0 && back) back(); else if (dx < 0 && next) next();
  });
}
onSwipe("intro", null, openHow);
onSwipe("how", () => $("howBack").click(), () => $("howNext").click());
onSwipe("setup", () => $("setupBack").click(), null);
// The tour shows once per tour version, so a changed tour reaches people who saw an older one.
// Opening the app at /#welcome always shows it, which is handy for demos.
if (state.onboarded !== TOUR_VERSION || ASKED_FOR_TOUR) openIntro();

// ---------- contacts: read on this phone only ----------
// Contacts are held in this variable for this visit only. They are never written to storage
// and never sent to the server; matching spoken names to them happens here in the browser.
let phoneContacts = [];
const canPickContacts = () => "contacts" in navigator && "ContactsManager" in window;
async function pickContacts() {
  const picked = await navigator.contacts.select(["name", "tel"], { multiple: true });
  const fresh = picked.map((c) => ({ name: ((c.name || [])[0] || "").trim().replace(/\s+/g, " "), tel: (c.tel || [])[0] || "" })).filter((c) => c.name);
  const seen = new Set(phoneContacts.map((c) => c.name));
  phoneContacts = [...phoneContacts, ...fresh.filter((c) => !seen.has(c.name))];
  return fresh;
}
let contactsMode = "app";
const CONTACT_TEXT = {
  app: { title: "Now give your contacts access", body: "Kitty uses your friends' names to match who you mean when you speak. They stay on this phone: nothing from your contacts is uploaded or saved on a server.", later: "Not now", allow: "Allow contacts" },
  friends: { title: "Add friends from your contacts", body: "Your phone opens its contact list and you choose who to add. Only the names and numbers you pick are saved, and only on this phone. Nothing from your contacts is uploaded to a server.", later: "Not now", allow: "Choose contacts" },
};
function openContactsAsk(mode) {
  contactsMode = mode === "friends" ? "friends" : "app";
  if (contactsMode === "app") { state.contactsAsked = true; persist(); }
  const t = CONTACT_TEXT[contactsMode];
  $("contactsTitle").textContent = t.title; $("contactsBody").textContent = t.body;
  $("contactsLater").textContent = t.later;
  $("contactsNote").hidden = true;
  $("contactsAllow").textContent = t.allow;
  $("scrim").hidden = false; $("contactsAsk").hidden = false;
  requestAnimationFrame(() => document.body.classList.add("contactsAsk-open"));
}
function closeContactsAsk() {
  document.body.classList.remove("contactsAsk-open");
  setTimeout(() => { $("contactsAsk").hidden = true; if ($("card").hidden && $("remind").hidden) $("scrim").hidden = true; }, 300);
}
const NO_PICKER = "This browser can't share contacts with Kitty. It works in Chrome on Android and in the Android app. You can still add friends by name in Friends, or just say their names.";
$("contactsLater").addEventListener("click", () => {
  addToGroup = null;
  closeContactsAsk();
});
$("contactsAllow").addEventListener("click", async () => {
  if (!canPickContacts()) {
    if (!$("contactsNote").hidden) { closeContactsAsk(); return; }
    $("contactsNote").textContent = NO_PICKER; $("contactsNote").hidden = false;
    $("contactsAllow").textContent = "OK";
    return;
  }
  try {
    const got = await pickContacts();
    closeContactsAsk();
    if (!got.length) return;
    if (contactsMode === "friends") {
      // Save only the people picked, on this phone, so they show in Friends and can get reminders.
      const known = new Set(allPeople().map((n) => n.toLowerCase()));
      const add = got.filter((c) => !known.has(c.name.toLowerCase()));
      state.friends = [...(state.friends || []), ...add.map((c) => c.name)];
      state.phones = state.phones || {};
      for (const c of add) if (c.tel) state.phones[c.name] = c.tel;
      const g = addToGroup && group(addToGroup);
      const joined = g ? joinGroup(g.id, got.map((c) => allPeople().find((n) => n.toLowerCase() === c.name.toLowerCase()) || c.name)) : 0;
      addToGroup = null;
      persist(); renderAll();
      toast(g ? `Added ${joined} to ${g.name}` : add.length ? `Added ${add.length} friend${add.length > 1 ? "s" : ""}` : "They're already your friends");
    } else toast(`${got.length} contact${got.length > 1 ? "s" : ""} ready to match`);
  } catch (_) { toast("Couldn't open your contacts"); }
});
// On the split sheet: add people straight from the phone's contacts
$("pickContacts").addEventListener("click", async () => {
  if (!draft) return;
  if (!canPickContacts()) { toast("Contacts work in Chrome on Android. Type the name instead."); return; }
  try {
    const got = await pickContacts();
    if (!got.length) return;
    draft.participants = [...new Set([...draft.participants, ...got.map((c) => c.name)])];
    if (draft.mode !== "equal") { draft.mode = "equal"; draft.values = {}; }
    recheck();
  } catch (_) { toast("Couldn't open your contacts"); }
});
// After the AI reads a name like "Ravi", use the contact's full name ("Ravi Kumar") when exactly
// one contact matches and the name isn't already a known friend.
function matchContacts(expense) {
  if (!phoneContacts.length || !expense) return false;
  const known = new Set(knownNames().map((n) => n.toLowerCase()));
  let changed = false;
  const fix = (n) => {
    if (!n || n === ME || known.has(n.toLowerCase())) return n;
    const low = n.toLowerCase();
    const hits = phoneContacts.filter((c) => c.name.toLowerCase() === low || c.name.toLowerCase().split(" ")[0] === low);
    if (hits.length !== 1 || hits[0].name === n) return n;
    changed = true;
    return hits[0].name;
  };
  expense.payer = fix(expense.payer);
  expense.participants = [...new Set(expense.participants.map(fix))];
  for (const it of expense.items || []) { it.only = it.only.map(fix); it.excluded = it.excluded.map(fix); }
  return changed;
}

// ---------- Share the split on WhatsApp ----------
let lastOwed = null;
function splitMessage() {
  const total = rupees(draft.total);
  const paid = draft.payer === ME ? "I paid" : `${draft.payer} paid`;
  const lines = Object.entries(lastOwed || {}).filter(([, v]) => v).map(([n, v]) => `• ${n === ME ? (state.profile.name || "Me").split(" ")[0] : n}: ${rupees(v)}`);
  let msg = `${draft.description || "Expense"} ${total} (${paid}), split on Kitty:\n${lines.join("\n")}`;
  const upi = (state.profile.upi || "").trim();
  if (draft.payer === ME && /^[\w.\-]{2,}@[a-zA-Z]{2,}$/.test(upi)) msg += `\nPay me at UPI ID: ${upi}`;
  return msg;
}
$("shareWa").addEventListener("click", () => {
  if (!draft || !lastOwed) return;
  $("shareTo").hidden = false;
  requestAnimationFrame(() => document.body.classList.add("shareTo-open"));
});
function closeShareTo() {
  document.body.classList.remove("shareTo-open");
  setTimeout(() => { $("shareTo").hidden = true; }, 300);
}
$("stCancel").addEventListener("click", closeShareTo);
// No number in either link, so WhatsApp or Messages lets you pick the chat, usually the group's.
$("stWa").addEventListener("click", () => {
  window.open(`https://wa.me/?text=${encodeURIComponent(splitMessage())}`, "_blank", "noopener");
  closeShareTo(); toast("Opening WhatsApp. Remember to save the expense too.");
});
$("stSms").addEventListener("click", () => {
  location.href = `sms:?&body=${encodeURIComponent(splitMessage())}`;
  closeShareTo(); toast("Opening Messages. Remember to save the expense too.");
});
$("stOther").addEventListener("click", async () => {
  const text = splitMessage();
  if (navigator.share) { try { await navigator.share({ text }); closeShareTo(); return; } catch (e) { if (e.name === "AbortError") return; } }
  try { await navigator.clipboard.writeText(text); closeShareTo(); toast("Split copied. Paste it in any app."); } catch (_) { toast("Couldn't share. Try WhatsApp instead."); }
});
