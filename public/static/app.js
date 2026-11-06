"use strict";
// Group state lives in this browser only.
const ME = "You";
const KEY = "voice-split-v1";
const $ = (id) => document.getElementById(id);
let state = load();
let draft = null; // the expense on the confirmation card

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s && Array.isArray(s.people) && Array.isArray(s.expenses)) return s;
  } catch (_) {}
  return { people: [ME], expenses: [], upi: "" };
}
function persist() { localStorage.setItem(KEY, JSON.stringify(state)); }
const rupees = (n) => "₹" + Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2, minimumFractionDigits: Number(n) % 1 ? 2 : 0 });
const others = () => state.people.filter((p) => p !== ME);
function el(tag, cls, text) { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }

function showError(msg) { $("error").textContent = msg; $("error").hidden = false; }
function clearError() { $("error").hidden = true; }

async function post(url, body, isForm) {
  const res = await fetch(url, isForm ? { method: "POST", body } :
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  let data = null;
  try { data = await res.json(); } catch (_) {}
  if (!res.ok) throw new Error((data && typeof data.detail === "string" && data.detail) || "Something went wrong. Please try again.");
  return data;
}

// ---------- reading an expense ----------
function busy(on, label) {
  document.body.classList.toggle("busy", on);
  $("micHint").textContent = on ? label : "Tap and speak. Tap again when you're done.";
}

async function readText(text) {
  clearError();
  busy(true, "Reading…");
  try { showCard(await post("/api/read-text", { text, people: state.people })); }
  catch (e) { showError(e.message); }
  finally { busy(false); }
}

async function readAudio(blob, name) {
  clearError();
  busy(true, "Listening back…");
  const form = new FormData();
  form.append("file", blob, name);
  form.append("people", state.people.join("|"));
  form.append("language", state.lang || "");
  try { showCard(await post("/api/read-audio", form, true)); }
  catch (e) { showError(e.message); }
  finally { busy(false); }
}

$("typeForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const t = $("typed").value.trim();
  if (t) readText(t); else showError("Type or say an expense first.");
});
$("examples").addEventListener("click", (e) => {
  if (e.target.tagName !== "BUTTON") return;
  $("typed").value = e.target.textContent;
  readText(e.target.textContent);
});

function paintLangs() {
  document.querySelectorAll(".langs button").forEach((b) => {
    const on = b.dataset.lang === (state.lang || "");
    b.classList.toggle("on", on);
    b.setAttribute("aria-checked", on);
  });
}
document.querySelector(".langs").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  state.lang = b.dataset.lang; persist(); paintLangs();
});
paintLangs();

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
  catch (_) { showError("Microphone access was blocked. Allow it in your browser settings, or type instead."); return; }
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
  $("micHint").textContent = "Listening… tap again when you're done.";
  stopTimer = setTimeout(() => rec.state === "recording" && rec.stop(), 45000);
});

// ---------- confirmation card ----------
function showCard(res) {
  draft = res.expense;
  $("heard").hidden = !res.transcript;
  $("heard").textContent = res.transcript ? "We heard: “" + res.transcript + "”" : "";
  $("desc").value = draft.description || "";
  $("total").value = draft.total || "";
  paintCard(res);
  $("card").hidden = false;
  $("card").scrollIntoView({ behavior: "smooth", block: "start" });
}

function cardPeople() {
  return [...new Set([ME, ...others(), draft.payer, ...draft.participants, ...draft.items.flatMap((i) => [...i.only, ...i.excluded])])].filter(Boolean);
}

function paintCard(res) {
  const people = cardPeople();
  const payer = $("payer");
  payer.replaceChildren(...people.map((p) => { const o = el("option", null, p); o.value = p; o.selected = p === draft.payer; return o; }));

  const sharers = $("sharers");
  sharers.replaceChildren(...people.map((p) => {
    const b = el("button", "chip" + (draft.participants.includes(p) ? " on" : ""), p);
    b.type = "button";
    b.setAttribute("aria-pressed", draft.participants.includes(p));
    b.onclick = () => {
      draft.participants = draft.participants.includes(p) ? draft.participants.filter((x) => x !== p) : [...draft.participants, p];
      if (draft.mode !== "equal") { draft.mode = "equal"; draft.values = {}; }
      recheck();
    };
    return b;
  }));

  const modeNote = { shares: "Split by shares: ", percent: "Split by percent: ", exact: "Exact amounts: " }[draft.mode];
  $("modeNote").hidden = !modeNote;
  if (modeNote) $("modeNote").textContent = modeNote + Object.entries(draft.values).map(([k, v]) => `${k} ${v}${draft.mode === "percent" ? "%" : ""}`).join(", ") + ". Changing who shares switches to an equal split.";

  $("items").replaceChildren(...draft.items.map((it, i) => {
    const who = it.only.length ? "only " + it.only.join(", ") : "everyone except " + it.excluded.join(", ");
    const li = el("li", null, `${rupees(it.amount)} ${it.description || "item"}: ${who}`);
    const x = el("button", "quiet", "Remove");
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
      li.append(el("span", null, name === ME ? "Your share" : name), el("strong", null, rupees(amount)));
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
    try { paintCard(await post("/api/check", { expense: draft, people: state.people })); }
    catch (e) { $("problem").hidden = false; $("problem").textContent = e.message; $("save").disabled = true; }
  }, 150);
}
["desc", "total"].forEach((id) => $(id).addEventListener("input", recheck));
$("addSharer").addEventListener("submit", (e) => {
  e.preventDefault();
  if (!draft) return;
  const raw = $("newSharer").value.trim().replace(/\s+/g, " ");
  $("newSharer").value = "";
  if (!raw) return;
  const name = raw.toLowerCase() === "you" ? ME : (state.people.find((p) => p.toLowerCase() === raw.toLowerCase()) || raw[0].toUpperCase() + raw.slice(1));
  if (!draft.participants.includes(name)) draft.participants = [...draft.participants, name];
  if (draft.mode !== "equal") { draft.mode = "equal"; draft.values = {}; }
  recheck();
});
$("payer").addEventListener("change", recheck);

$("save").addEventListener("click", () => {
  if (!draft || $("save").disabled) return;
  for (const p of cardPeople()) if (!state.people.includes(p) && (p === draft.payer || draft.participants.includes(p))) state.people.push(p);
  state.expenses.unshift({ ...draft, id: Date.now(), at: new Date().toISOString() });
  persist();
  closeCard();
  $("typed").value = "";
  render();
});
$("discard").addEventListener("click", closeCard);
function closeCard() { draft = null; $("card").hidden = true; }

// ---------- group ----------
async function render() {
  $("upi").value = state.upi || "";
  $("people").replaceChildren(...state.people.map((p) => {
    const c = el("span", "chip on", p);
    if (p !== ME && !state.expenses.some((e) => e.payer === p || e.participants.includes(p))) {
      const x = el("button", "x", "×"); x.type = "button"; x.setAttribute("aria-label", "Remove " + p);
      x.onclick = () => { state.people = state.people.filter((q) => q !== p); persist(); render(); };
      c.append(x);
    }
    return c;
  }));

  $("expenses").replaceChildren(...state.expenses.map((e) => {
    const li = el("li");
    const who = e.payer === ME ? "You paid" : e.payer + " paid";
    li.append(el("div", "what", e.description), el("div", "meta", `${who} · ${e.participants.join(", ")}`), el("strong", null, rupees(e.total)));
    const del = el("button", "quiet", "Delete"); del.type = "button";
    del.onclick = () => { if (confirm(`Delete "${e.description}"?`)) { state.expenses = state.expenses.filter((x) => x.id !== e.id); persist(); render(); } };
    li.append(del);
    return li;
  }));

  const settle = $("settle");
  settle.replaceChildren();
  $("settleEmpty").hidden = state.expenses.length > 0;
  if (!state.expenses.length) return;
  try {
    const b = await post("/api/balances", { expenses: state.expenses });
    if (!b.payments.length) { settle.append(el("li", "even", "Everyone is even.")); return; }
    for (const p of b.payments) {
      const li = el("li");
      const line = p.to === ME ? `${p.from} pays you` : p.from === ME ? `You pay ${p.to}` : `${p.from} pays ${p.to}`;
      li.append(el("span", null, line), el("strong", null, rupees(p.amount)));
      const msg = settleMessage(p);
      if (msg) {
        const a = el("a", "share", "Send on WhatsApp");
        a.href = "https://wa.me/?text=" + encodeURIComponent(msg);
        a.target = "_blank"; a.rel = "noopener";
        li.append(a);
      }
      settle.append(li);
    }
  } catch (e) { settle.append(el("li", "problem", e.message)); }
}

function settleMessage(p) {
  if (p.to !== ME) return null;
  let msg = `Hi ${p.from}, your share for our expenses comes to ${rupees(p.amount)}.`;
  const upi = (state.upi || "").trim();
  if (/^[\w.\-]{2,}@[a-zA-Z]{2,}$/.test(upi)) {
    // WhatsApp only makes web links tappable, so the UPI ID is given as text to pay from any UPI app.
    msg += ` You can pay to my UPI ID: ${upi}`;
  }
  return msg;
}

$("addPerson").addEventListener("submit", (e) => {
  e.preventDefault();
  const raw = $("newPerson").value.trim().replace(/\s+/g, " ");
  if (!raw) return;
  const name = raw[0].toUpperCase() + raw.slice(1);
  if (name.toLowerCase() === "you" || state.people.some((p) => p.toLowerCase() === name.toLowerCase())) { $("newPerson").value = ""; return; }
  state.people.push(name); persist(); $("newPerson").value = ""; render();
});
$("upi").addEventListener("change", () => { state.upi = $("upi").value.trim(); persist(); render(); });
$("reset").addEventListener("click", () => {
  if (!state.expenses.length && state.people.length === 1) return;
  if (confirm("Delete all expenses and people on this phone?")) { state = { people: [ME], expenses: [], upi: state.upi }; persist(); closeCard(); render(); }
});

render();

// Lets the phone install this as an app from the browser's "Add to Home Screen".
if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
