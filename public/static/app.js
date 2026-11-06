"use strict";
// Everything is stored in this browser only.
const ME = "You";
const KEY = "voice-split-v2";
const OLD_KEY = "voice-split-v1";
const $ = (id) => document.getElementById(id);
let state = load();
let draft = null;      // the expense on the confirmation sheet
let draftGroup = null; // which group it will be saved to
let openGroupId = null;

// ---------- storage ----------
function newId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
function blankGroup(name) { return { id: newId(), name, people: [ME], expenses: [] }; }
function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s && Array.isArray(s.groups) && s.groups.length) return s;
  } catch (_) {}
  const fresh = { profile: { name: "", phone: "", upi: "", lang: "" }, groups: [blankGroup("Friends")], current: null };
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
const allPeople = () => [...new Set(state.groups.flatMap((g) => g.people))];

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
function showError(msg) { $("error").textContent = msg; $("error").hidden = false; }
function clearError() { $("error").hidden = true; }
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
  const timer = setTimeout(() => ctl.abort(), 40000);
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
  $("micHint").textContent = on ? label : "Tap and say the expense";
}
const knownNames = () => [...new Set([...current().people, ...allPeople()])];
async function readText(text) {
  clearError();
  busy(true, "Reading…");
  try { showCard(await post("/api/read-text", { text, people: knownNames() }), state.current); }
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
  try { showCard(await post("/api/read-audio", form, true), state.current); }
  catch (e) { showError(e.message); }
  finally { busy(false); }
}
$("typeForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const t = $("typed").value.trim();
  if (t) { $("typed").blur(); readText(t); } else showError("Type or say an expense first.");
});
$("examples").addEventListener("click", (e) => {
  if (e.target.tagName !== "BUTTON") return;
  $("typed").value = e.target.textContent;
  readText(e.target.textContent);
});
$("homeGroup").addEventListener("change", () => { state.current = $("homeGroup").value; persist(); });

function paintLangs() {
  document.querySelectorAll(".langs button").forEach((b) => {
    const on = b.dataset.lang === (state.profile.lang || "");
    b.classList.toggle("on", on);
    b.setAttribute("aria-checked", on);
  });
  $("pLang").value = state.profile.lang || "";
}
document.querySelector(".langs").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  state.profile.lang = b.dataset.lang; persist(); paintLangs();
});

// ---------- recording ----------
let rec = null, chunks = [], stream = null, stopTimer = null;
function pickMime() {
  for (const m of ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"]) {
    if (window.MediaRecorder && MediaRecorder.isTypeSupported(m)) return m;
  }
  return "";
}
$("mic").addEventListener("click", async () => {
  if (rec && rec.state === "recording") { rec.stop(); return; }
  clearError();
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
    $("mic").classList.remove("live");
    const type = rec.mimeType || "audio/webm";
    if (Date.now() - started < 800) { showError("That was too short. Tap, speak, then tap again."); busy(false); return; }
    const ext = type.includes("mp4") ? "m4a" : type.includes("ogg") ? "ogg" : "webm";
    readAudio(new Blob(chunks, { type }), "expense." + ext);
  };
  rec.start();
  $("mic").classList.add("live");
  $("micHint").textContent = "Listening… tap when done";
  if (navigator.vibrate) navigator.vibrate(10);
  stopTimer = setTimeout(() => rec.state === "recording" && rec.stop(), 45000);
});

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
$("scrim").addEventListener("click", closeCard);
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
  fillGroupSelect($("sheetGroup"), gid);
  $("heard").hidden = !res.transcript;
  $("heard").textContent = res.transcript ? "“" + res.transcript + "”" : "";
  $("desc").value = draft.description || "";
  $("total").value = draft.total || "";
  paintCard(res);
  $("card").scrollTop = 0;
  openSheet();
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
  if (res.owed) {
    for (const [name, amount] of Object.entries(res.owed)) {
      if (!amount) continue;
      const li = el("li");
      li.append(who(name === ME ? "Your share" : name), el("strong", null, rupees(amount)));
      owed.append(li);
    }
  }
  $("save").disabled = !res.owed;
  $("swJson").textContent = res.splitwise ? JSON.stringify({ cost: Number(draft.total).toFixed(2), description: draft.description, users: res.splitwise }, null, 2) : "";
}
let checkTimer = null;
function recheck() {
  draft.description = $("desc").value.trim() || "Expense";
  const t = parseFloat($("total").value);
  draft.total = Number.isFinite(t) && t > 0 ? t : null;
  draft.payer = $("payer").value || draft.payer;
  clearTimeout(checkTimer);
  checkTimer = setTimeout(async () => {
    try { paintCard(await post("/api/check", { expense: draft, people: group(draftGroup).people })); }
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
  const name = raw.toLowerCase() === "you" ? ME : (allPeople().find((p) => p.toLowerCase() === raw.toLowerCase()) || raw[0].toUpperCase() + raw.slice(1));
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
function remindLink(name, amount) {
  const me = state.profile.name ? ` – ${state.profile.name}` : "";
  let msg = `Hi ${name}, a quick reminder: you owe me ${rupees(amount)} for our shared expenses${me}.`;
  const upi = (state.profile.upi || "").trim();
  // WhatsApp only makes web links tappable, so the UPI ID is given as text to pay from any UPI app.
  if (/^[\w.\-]{2,}@[a-zA-Z]{2,}$/.test(upi)) msg += ` You can pay to my UPI ID: ${upi}`;
  const a = el("a", "wa", "Remind on WhatsApp");
  a.href = "https://wa.me/?text=" + encodeURIComponent(msg);
  a.target = "_blank"; a.rel = "noopener";
  return a;
}

async function renderHome(friends) {
  fillGroupSelect($("homeGroup"), current().id);
  const get = Object.values(friends).filter((v) => v > 0).reduce((a, b) => a + b, 0);
  const owe = -Object.values(friends).filter((v) => v < 0).reduce((a, b) => a + b, 0);
  $("getBack").textContent = rupees(get); $("youOwe").textContent = rupees(owe);
  $("getBack").className = get ? "get" : "zero"; $("youOwe").className = owe ? "owe" : "zero";
  const recent = allExpenses().sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 5);
  $("recent").replaceChildren(...recent.map((e) => {
    const li = el("li", "tap");
    li.append(who(e.description, `${e._group} · ${e.payer === ME ? "you paid" : e.payer + " paid"} · ${shortDate(e.at)}`, "cat"), el("strong", null, rupees(e.total)));
    li.onclick = () => go("group", e._gid);
    return li;
  }));
  $("examples").hidden = recent.length > 0;
}

function renderFriends(friends) {
  const names = Object.keys(friends).sort((a, b) => Math.abs(friends[b]) - Math.abs(friends[a]));
  $("friendsEmpty").hidden = names.length > 0;
  let owingMe = 0;
  $("friends").replaceChildren(...names.map((n) => {
    const v = friends[n];
    const groups = state.groups.filter((g) => g.people.includes(n)).map((g) => g.name).join(", ");
    const li = el("li", "pay");
    const amt = el("span", "amt " + (v > 0 ? "get" : "owe"));
    amt.append(el("small", null, v > 0 ? "owes you" : "you owe"), el("strong", null, rupees(Math.abs(v))));
    li.append(who(n, groups), amt);
    if (v > 0) { owingMe++; li.append(remindLink(n, v)); }
    return li;
  }));
  $("badge").hidden = !owingMe; $("badge").textContent = owingMe;
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
$("gAddPerson").addEventListener("submit", (e) => {
  e.preventDefault();
  const g = group(openGroupId);
  const raw = $("gNewPerson").value.trim().replace(/\s+/g, " ");
  $("gNewPerson").value = "";
  if (!raw || !g) return;
  const name = allPeople().find((p) => p.toLowerCase() === raw.toLowerCase()) || raw[0].toUpperCase() + raw.slice(1);
  if (name.toLowerCase() === "you" || g.people.includes(name)) return;
  g.people.push(name); persist(); renderGroup(); toast(`Added ${name} to ${g.name}`);
});
$("gDelete").addEventListener("click", () => {
  const g = group(openGroupId);
  if (!g) return;
  if (state.groups.length === 1) { toast("You need at least one group"); return; }
  if (!confirm(`Delete "${g.name}" and its ${g.expenses.length} expenses?`)) return;
  state.groups = state.groups.filter((x) => x.id !== g.id);
  if (state.current === g.id) state.current = state.groups[0].id;
  persist(); go("groups"); renderAll(); toast("Group deleted");
});
$("newGroup").addEventListener("submit", (e) => {
  e.preventDefault();
  const name = $("newGroupName").value.trim().replace(/\s+/g, " ");
  $("newGroupName").value = "";
  if (!name) return;
  const g = blankGroup(name);
  state.groups.push(g); state.current = g.id; persist(); renderAll(); go("group", g.id); toast(`Created ${name}`);
});

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
  $(id).addEventListener("change", () => { state.profile[key] = $(id).value.trim(); persist(); renderAccount(); toast("Saved"); });
}
$("pLang").addEventListener("change", () => { state.profile.lang = $("pLang").value; persist(); paintLangs(); toast("Saved"); });
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
  return { rows, title: `Voice Split: ${gname}, ${label}`, file: `voice-split-${gname}-${label}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-+$/, "") };
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
  p.append(el("p", "meta", "Made with Voice Split. Shares are calculated exactly, to the paisa."));
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
persist(); // saves data brought over from the first version
paintLangs();
const startHash = (location.hash || "#home").slice(1);
if (startHash.startsWith("group/")) go("group", startHash.slice(6)); else go(startHash);
renderAll();

// Lets the phone install this as an app from the browser's "Add to Home Screen".
if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
