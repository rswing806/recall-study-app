// ---------- helpers ----------
const $ = (sel, root = document) => root.querySelector(sel);

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === "class") node.className = value;
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value);
  }
  node.append(...children);
  return node; // text goes in as text nodes, so user content can never inject HTML
}

async function api(path, method = "GET", body) {
  const res = await fetch(path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text && res.headers.get("content-type")?.includes("json") ? JSON.parse(text) : null;
  if (!res.ok) throw new Error((data && data.error) || "Something went wrong. Try again.");
  return data;
}

let toastTimer;
function toast(message) {
  const box = $("#toast");
  box.textContent = message;
  box.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => box.classList.remove("show"), 2600);
}

const guard = (fn) => async (...args) => {
  try { await fn(...args); } catch (err) { toast(err.message); }
};

// ---------- tabs ----------
let currentTab = "decks";
function showTab(name) {
  currentTab = name;
  document.querySelectorAll(".tab").forEach((t) => (t.hidden = t.id !== `tab-${name}`));
  document.querySelectorAll("[role=tab]").forEach((b) => b.setAttribute("aria-selected", b.dataset.tab === name));
  if (name === "decks") loadDecks();
  if (name === "study") fillStudySelect();
  if (name === "stats") loadStats();
}
document.querySelectorAll("[role=tab]").forEach((b) => b.addEventListener("click", guard(() => showTab(b.dataset.tab))));

// ---------- decks ----------
let decks = [];
let selectedDeck = null;

async function loadDecks() {
  decks = await api("/api/decks");
  const list = $("#deckList");
  list.replaceChildren(
    ...decks.map((d) =>
      el("button", { class: "deck" + (d.id === selectedDeck ? " on" : ""), type: "button", onclick: guard(() => selectDeck(d.id)) },
        el("strong", {}, d.name),
        el("span", { class: "meta" }, `${d.cards} card${d.cards === 1 ? "" : "s"}, ${d.due} due`))
    )
  );
  if (!decks.length) list.append(el("p", { class: "empty" }, "No decks yet. Name one above to begin."));
}

$("#deckForm").addEventListener("submit", guard(async (e) => {
  e.preventDefault();
  const deck = await api("/api/decks", "POST", { name: $("#deckName").value });
  $("#deckName").value = "";
  selectedDeck = deck.id;
  await loadDecks();
  await selectDeck(deck.id);
}));

async function selectDeck(id) {
  selectedDeck = id;
  const deck = decks.find((d) => d.id === id);
  const cards = await api(`/api/decks/${id}/cards`);
  document.querySelectorAll(".deck").forEach((n) => n.classList.toggle("on", n.querySelector("strong").textContent === deck.name));

  const front = el("textarea", { rows: "2", maxlength: "2000", required: "", "aria-label": "Front of card", placeholder: "Question or term" });
  const back = el("textarea", { rows: "2", maxlength: "2000", required: "", "aria-label": "Back of card", placeholder: "Answer or definition" });
  const addForm = el("form", { class: "stack", onsubmit: guard(async (e) => {
    e.preventDefault();
    await api(`/api/decks/${id}/cards`, "POST", { front: front.value, back: back.value });
    await loadDecks();
    await selectDeck(id);
    $("#deckDetail textarea").focus();
  }) }, front, back, el("button", { class: "btn", type: "submit" }, "Add card"));

  const fileInput = el("input", { type: "file", accept: ".csv,text/csv", hidden: "", onchange: guard(async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const result = await api(`/api/decks/${id}/import`, "POST", { csv: await file.text() });
    toast(`Added ${result.added} card${result.added === 1 ? "" : "s"}.`);
    await loadDecks();
    await selectDeck(id);
  }) });

  const tools = el("div", { class: "tools" },
    el("button", { class: "btn ghost small", type: "button", onclick: () => fileInput.click() }, "Import CSV"),
    fileInput,
    el("a", { class: "btn ghost small", href: `/api/decks/${id}/export.csv` }, "Export CSV"),
    el("button", { class: "btn danger small", type: "button", onclick: guard(async () => {
      if (!confirm(`Delete "${deck.name}" and all its cards?`)) return;
      await api(`/api/decks/${id}`, "DELETE");
      selectedDeck = null;
      $("#deckDetail").replaceChildren(el("p", { class: "empty" }, "Deck deleted. Pick another or create a new one."));
      await loadDecks();
    }) }, "Delete deck"));

  const rows = cards.map((c) =>
    el("li", {},
      el("div", {}, el("strong", {}, c.front), el("br"), el("span", { class: "meta" }, c.back)),
      el("button", { class: "link", type: "button", "aria-label": `Delete card ${c.front}`, onclick: guard(async () => {
        await api(`/api/cards/${c.id}`, "DELETE");
        await loadDecks();
        await selectDeck(id);
      }) }, "Delete")));

  $("#deckDetail").replaceChildren(
    el("h2", {}, deck.name), addForm, tools,
    el("p", { class: "hint" }, "CSV files need two columns: front, back."),
    rows.length ? el("ul", { class: "cards" }, ...rows) : el("p", { class: "empty" }, "No cards yet. Add your first one above."));
}

// ---------- study ----------
let session = null;
const RATINGS = [
  { label: "Again", quality: 1, key: "1" },
  { label: "Hard", quality: 3, key: "2" },
  { label: "Good", quality: 4, key: "3" },
  { label: "Easy", quality: 5, key: "4" },
];

async function fillStudySelect() {
  decks = await api("/api/decks");
  const sel = $("#studyDeck");
  const keep = sel.value;
  sel.replaceChildren(...decks.map((d) => el("option", { value: d.id }, `${d.name} (${d.due} due)`)));
  if (keep) sel.value = keep;
}

$("#studyStart").addEventListener("click", guard(async () => {
  const id = $("#studyDeck").value;
  if (!id) return toast("Create a deck first.");
  const cards = await api(`/api/decks/${id}/due`);
  session = { cards, i: 0, revealed: false, total: cards.length };
  renderStudy();
}));

function renderStudy() {
  const area = $("#studyArea");
  if (!session || session.total === 0) {
    area.replaceChildren(el("p", { class: "empty" }, "Nothing is due in this deck. Come back tomorrow, or add more cards."));
    return;
  }
  if (session.i >= session.cards.length) {
    area.replaceChildren(el("div", { class: "done" }, el("h2", {}, "Session complete"),
      el("p", {}, `You reviewed ${session.total} card${session.total === 1 ? "" : "s"}. Nice work.`)));
    session = null;
    fillStudySelect();
    return;
  }
  const card = session.cards[session.i];
  const parts = [
    el("p", { class: "hint" }, `Card ${session.i + 1} of ${session.cards.length}`),
    el("div", { class: "flashcard" },
      el("p", { class: "face" }, card.front),
      session.revealed ? el("p", { class: "face answer" }, card.back) : ""),
  ];
  if (!session.revealed) {
    const btn = el("button", { class: "btn", type: "button", onclick: reveal }, "Show answer");
    parts.push(el("div", { class: "controls" }, btn));
    area.replaceChildren(...parts);
    btn.focus();
  } else {
    parts.push(el("div", { class: "controls" }, ...RATINGS.map((r) =>
      el("button", { class: `btn rate r${r.quality}`, type: "button", onclick: guard(() => rate(r.quality)) }, `${r.label} (${r.key})`))));
    area.replaceChildren(...parts);
  }
}

function reveal() {
  if (session && !session.revealed) { session.revealed = true; renderStudy(); }
}

async function rate(quality) {
  const card = session.cards[session.i];
  const result = await api(`/api/cards/${card.id}/review`, "POST", { quality });
  toast(result.interval === 1 ? "You'll see this again tomorrow." : `Next review in ${result.interval} days.`);
  if (quality < 3) session.cards.push(card); // missed cards come back at the end of this session
  session.i += 1;
  session.revealed = false;
  renderStudy();
}

document.addEventListener("keydown", (e) => {
  if (currentTab !== "study" || !session || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
  if (e.key === " " || e.key === "Enter") { if (!session.revealed) { e.preventDefault(); reveal(); } }
  const r = RATINGS.find((x) => x.key === e.key);
  if (r && session.revealed) guard(() => rate(r.quality))();
});

// ---------- focus timer ----------
const timer = { mode: "focus", remaining: 25 * 60000, endAt: 0, running: false, handle: null };
const minutesFor = (mode) => Math.max(1, parseInt($(mode === "focus" ? "#focusMin" : "#breakMin").value, 10) || 1);

function drawClock() {
  const secs = Math.ceil(timer.remaining / 1000);
  const text = `${String(Math.floor(secs / 60)).padStart(2, "0")}:${String(secs % 60).padStart(2, "0")}`;
  $("#clock").textContent = text;
  document.title = timer.running ? `${text} - Recall` : "Recall - study companion";
}

function setMode(mode) {
  timer.mode = mode;
  stopTimer();
  timer.remaining = minutesFor(mode) * 60000;
  $("#modeFocus").classList.toggle("on", mode === "focus");
  $("#modeBreak").classList.toggle("on", mode === "break");
  $("#timerToggle").textContent = "Start";
  drawClock();
}

function stopTimer() {
  clearInterval(timer.handle);
  timer.running = false;
}

function tick() {
  timer.remaining = Math.max(0, timer.endAt - Date.now());
  drawClock();
  if (timer.remaining === 0) finishTimer();
}

const finishTimer = guard(async () => {
  const finished = timer.mode;
  const minutes = minutesFor(finished);
  stopTimer();
  beep();
  if (finished === "focus") {
    await api("/api/focus", "POST", { minutes });
    toast(`Focus session saved: ${minutes} minutes. Take a break.`);
    setMode("break");
  } else {
    toast("Break over. Ready for another focus session?");
    setMode("focus");
  }
});

$("#timerToggle").addEventListener("click", () => {
  if (timer.running) {
    stopTimer();
    $("#timerToggle").textContent = "Resume";
  } else {
    timer.endAt = Date.now() + timer.remaining; // based on the clock, so it stays accurate in background tabs
    timer.running = true;
    timer.handle = setInterval(tick, 250);
    $("#timerToggle").textContent = "Pause";
  }
  drawClock();
});
$("#timerReset").addEventListener("click", () => setMode(timer.mode));
$("#modeFocus").addEventListener("click", () => setMode("focus"));
$("#modeBreak").addEventListener("click", () => setMode("break"));
["#focusMin", "#breakMin"].forEach((s) => $(s).addEventListener("change", () => { if (!timer.running) setMode(timer.mode); }));

function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.frequency.value = 880;
    gain.gain.value = 0.15;
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.4);
  } catch (_) { /* sound is optional */ }
}

// ---------- stats ----------
const charts = {};
function drawChart(id, labels, data, color, unit) {
  charts[id]?.destroy();
  charts[id] = new Chart($(`#${id}`), {
    type: "bar",
    data: { labels, datasets: [{ label: unit, data, backgroundColor: color, borderRadius: 3 }] },
    options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 }, title: { display: true, text: unit } } } },
  });
}

async function loadStats() {
  const s = await api("/api/stats");
  $("#nStreak").textContent = s.streak;
  $("#nCards").textContent = s.total_cards;
  $("#nMature").textContent = s.mature_cards;
  $("#nReviews").textContent = s.total_reviews;
  const labels = s.days.map((d) => new Date(d + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" }));
  drawChart("reviewChart", labels, s.reviews, "#2b4bff", "Cards");
  drawChart("focusChart", labels, s.focus, "#12a150", "Minutes");
}

// ---------- start ----------
guard(loadDecks)();
drawClock();
