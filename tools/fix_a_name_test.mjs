// Checks fixing a misheard name on the add-expense sheet: a pick, a typed rename, merging into an existing
// person, removing, the payer, shares and Save rules, the 'new' tag, and that no ghost name is saved.
// The reading is injected (no key, no AI); the real /api/check works out the shares.
// Needs Google Chrome and the app on localhost:8502. Usage: node tools/fix_a_name_test.mjs
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PORT = 9339, profile = mkdtempSync(join(tmpdir(), "kitty-name-"));
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
  // The sheet after a reading: what the AI would return, through the real /api/check
  const heard = async (expense) => { const res = await post("/api/check", { expense: { mode: "equal", values: {}, items: [], ...expense }, people: knownNames() }); showCard(res, "g"); await wait(500); };
  const chips = () => [...document.querySelectorAll("#sharers .chip")].map((c) => c.firstChild.textContent + (c.querySelector(".newTag") ? " [new]" : "") + (c.classList.contains("on") ? " (on)" : ""));
  const shares = () => Object.fromEntries([...document.querySelectorAll("#owed li")].map((li) => [li.querySelector(".name").textContent, li.querySelector("strong").textContent]));
  const pencil = (name) => [...document.querySelectorAll("#sharers .chipEdit")].find((b) => b.getAttribute("aria-label") === "Fix the name " + name);
  const pick = (label) => [...document.querySelectorAll("#whoChips .chip")].find((c) => c.textContent === label);
  const typeName = (v) => { $("whoName").value = v; $("whoForm").requestSubmit(); };
`;
const run = async (expression) => {
  const r = await send("Runtime.evaluate", { expression: `(async () => { ${HELPERS} ${expression} })()`, awaitPromise: true, returnByValue: true });
  if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 500));
  return r.result.result.value;
};
const open = async (hash) => { await send("Page.navigate", { url: `http://localhost:8502/?${Date.now()}#${hash}` }); await sleep(1300); };
const seed = (friends, people) => JSON.stringify({ profile: { name: "Asha", phone: "", upi: "", lang: "" }, friends, onboarded: 6, contactsAsked: true, current: "g",
  groups: [{ id: "g", name: "Goa trip", people, expenses: [] }] });
let failed = 0;
const check = (name, ok, got) => { console.log((ok ? "PASS " : "FAIL ") + name + (ok ? "" : " | got: " + JSON.stringify(got))); if (!ok) failed++; };
const TANGLISH = { description: "Hotel", total: 2000, payer: "You", participants: ["You", "Aiyakkudaiyum", "Arun", "Ashirikkappiram"] };

try {
  await send("Page.enable"); await open("home");
  // First run: nobody saved yet, so nothing is tagged new
  await run(`localStorage.setItem("voice-split-v2", ${JSON.stringify(seed([], ["You"]))}); return true`); await open("group/g");
  const first = await run(`await heard(${JSON.stringify(TANGLISH)}); const c = chips(); closeCard(); await wait(400); return c`);
  check("first run: no saved friends, so no name is tagged new", first.every((c) => !c.includes("[new]")), first);

  // Arun and Ashik are saved; the heard names are not
  await run(`localStorage.setItem("voice-split-v2", ${JSON.stringify(seed(["Ashik"], ["You", "Arun", "Ashik"]))}); return true`); await open("group/g");
  const start = await run(`await heard(${JSON.stringify(TANGLISH)}); return { chips: chips(), pencils: [...document.querySelectorAll("#sharers .chipEdit")].map((b) => b.getAttribute("aria-label")), shares: shares() }`);
  check("the misheard names are tagged new; saved people are not", JSON.stringify(start.chips) === JSON.stringify(["You (on)", "Arun (on)", "Ashik", "Aiyakkudaiyum [new] (on)", "Ashirikkappiram [new] (on)"]), start.chips);
  check("pencils only on names in this expense, never on You or on a member who isn't in it", JSON.stringify(start.pencils) === JSON.stringify(["Fix the name Arun", "Fix the name Aiyakkudaiyum", "Fix the name Ashirikkappiram"]), start.pencils);

  // 1. Ashirikkappiram is Ashik: one pick
  const one = await run(`pencil("Ashirikkappiram").click(); await wait(400);
    const sheet = { open: !$("who").hidden, title: $("whoTitle").textContent, options: [...document.querySelectorAll("#whoChips .chip")].map((c) => c.textContent) };
    pick("Ashik").click(); const saveRightAway = $("save").disabled; await wait(800);
    return { sheet, saveRightAway, saveAfter: $("save").disabled, participants: [...draft.participants], chips: chips(), shares: shares() }`);
  check("the pencil opens 'Who is this?' with You, the other names and saved friends", one.sheet.open && one.sheet.title === "Who is this?" && JSON.stringify(one.sheet.options) === JSON.stringify(["You", "Arun", "Ashik", "Aiyakkudaiyum"]), one.sheet);
  check("one pick fixes Ashirikkappiram to the saved friend Ashik", JSON.stringify(one.participants) === JSON.stringify(["You", "Aiyakkudaiyum", "Arun", "Ashik"]) && !one.chips.some((c) => c.startsWith("Ashirikkappiram")), one);
  check("Save is off while the shares are recalculated, then back on", one.saveRightAway === true && one.saveAfter === false, one);
  check("shares recalculate: four people, ₹500 each", Object.values(one.shares).every((v) => v === "₹500") && Object.keys(one.shares).length === 4, one.shares);

  // 2. A typed rename to a new name
  const typed = await run(`pencil("Aiyakkudaiyum").click(); await wait(400); typeName("  kavya "); await wait(800); return { participants: [...draft.participants], chips: chips() }`);
  check("a typed rename uses the typed name, in title case, tagged new", JSON.stringify(typed.participants) === JSON.stringify(["You", "Kavya", "Arun", "Ashik"]) && typed.chips.includes("Kavya [new] (on)"), typed);

  // 3. Renaming to someone already on the sheet merges, with their exact spelling
  const merge = await run(`pencil("Kavya").click(); await wait(400); typeName("ARUN"); await wait(800); return { participants: [...draft.participants], shares: shares() }`);
  check("renaming to an existing chip (any case) merges into it, spelled 'Arun'", JSON.stringify(merge.participants) === JSON.stringify(["You", "Arun", "Ashik"]), merge);
  check("after the merge the shares are three ways and add up to ₹2,000", Object.keys(merge.shares).length === 3 && Object.values(merge.shares).map((v) => Number(v.replace(/[₹,]/g, ""))).reduce((a, b) => a + b, 0) === 2000, merge.shares);

  // 4. Remove from this expense
  const removed = await run(`pencil("Ashik").click(); await wait(400); $("whoRemove").click(); await wait(800); return { participants: [...draft.participants], shares: shares(), ashikChip: chips().find((c) => c.startsWith("Ashik")) }`);
  check("remove takes Ashik out of this expense only; still a group member chip, now off", JSON.stringify(removed.participants) === JSON.stringify(["You", "Arun"]) && removed.ashikChip === "Ashik", removed);
  check("after removing, the shares are ₹1,000 each", removed.shares["Your share"] === "₹1,000" && removed.shares.Arun === "₹1,000", removed.shares);

  // 5. Save: no ghost name anywhere
  const saved = await run(`$("save").click(); await wait(900); go("friends"); await wait(900);
    const s = JSON.parse(localStorage.getItem("voice-split-v2"));
    return { expense: s.groups[0].expenses[0] && s.groups[0].expenses[0].participants, members: s.groups[0].people, friends: s.friends, friendsTab: [...document.querySelectorAll("#friends li .name")].map((n) => n.textContent.trim()) }`);
  const ghosts = ["Aiyakkudaiyum", "Ashirikkappiram", "Kavya"];
  check("saved with You and Arun only", JSON.stringify(saved.expense) === JSON.stringify(["You", "Arun"]), saved);
  check("after saving, no ghost name in the group, the friends list or the Friends tab", !ghosts.some((g) => saved.members.includes(g) || saved.friends.includes(g) || saved.friendsTab.some((n) => n.startsWith(g))), saved);

  // 6. The payer misheard, a custom split, and an item only the ghost shared
  await open("group/g");
  const payer = await run(`await heard({ description: "Dinner", total: 900, payer: "Aarun", participants: ["You", "Aarun", "Ashik"], mode: "shares", values: { You: 1, Aarun: 2, Ashik: 1 } });
    pencil("Aarun").click(); await wait(400); pick("Arun").click(); await wait(800);
    return { payer: draft.payer, menu: $("payer").value, participants: [...draft.participants], mode: draft.mode, values: draft.values, shares: shares() }`);
  check("a misheard payer: picking Arun updates the payer and the 'Paid by' menu", payer.payer === "Arun" && payer.menu === "Arun" && JSON.stringify(payer.participants) === JSON.stringify(["You", "Arun", "Ashik"]), payer);
  check("a custom split keeps its shares under the right name (Arun 2 of 4)", payer.mode === "shares" && payer.values.Arun === 2 && !("Aarun" in payer.values) && payer.shares.Arun === "₹450", payer);
  const item = await run(`closeCard(); await wait(400);
    await heard({ description: "Dinner", total: 1000, payer: "You", participants: ["You", "Arun", "Ashirikkappiram"], items: [{ amount: 400, description: "drinks", only: ["Ashirikkappiram"], excluded: [] }] });
    pencil("Ashirikkappiram").click(); await wait(400); $("whoRemove").click(); await wait(800);
    return { items: draft.items.length, participants: [...draft.participants], shares: shares() }`);
  check("removing a name drops an item only they shared, and the rest is split equally", item.items === 0 && JSON.stringify(item.participants) === JSON.stringify(["You", "Arun"]) && item.shares.Arun === "₹500", item);
} finally { ws.close(); chrome.kill(); await sleep(300); rmSync(profile, { recursive: true, force: true }); }
console.log(failed ? `\n${failed} check(s) failed` : "\nAll checks passed");
process.exit(failed ? 1 : 0);
