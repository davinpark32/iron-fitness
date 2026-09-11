import { Store } from "./store.js";
import { EXERCISE_DB } from "./exercise-db.js";

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function isoDate(d) { return d.toISOString().slice(0, 10); }
function todayISO() { return isoDate(new Date()); }
function fmtMinSec(sec) { const m = Math.floor(sec / 60), s = sec % 60; return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`; }
function fmtHM(sec) { const h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60); return h > 0 ? `${h}h ${m}m` : `${m}m`; }
function fmtDate(iso) { const d = new Date(iso + "T00:00:00"); return d.toLocaleDateString(undefined, { month: "short", day: "numeric" }); }

let toastTimer;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 1800);
}

// In-app confirmation modal — native window.confirm() is unreliable in
// standalone/home-screen PWA mode on iOS (it can silently no-op instead of
// blocking), so destructive actions go through this instead.
let confirmCallback = null;
function showConfirm(message, onConfirm, confirmLabel) {
  confirmCallback = onConfirm;
  $("#confirm-message").textContent = message;
  $("#confirm-ok").textContent = confirmLabel || "Delete";
  $("#confirm-backdrop").classList.add("show");
}
function hideConfirm() {
  $("#confirm-backdrop").classList.remove("show");
  confirmCallback = null;
}
function setupConfirmModal() {
  $("#confirm-cancel").addEventListener("click", hideConfirm);
  $("#confirm-backdrop").addEventListener("click", (e) => { if (e.target.id === "confirm-backdrop") hideConfirm(); });
  $("#confirm-ok").addEventListener("click", () => {
    const cb = confirmCallback;
    hideConfirm();
    if (cb) cb();
  });
}

// =========================================================
// derived stats
// =========================================================
function computeCurrentStreak(sessions) {
  const dates = new Set(sessions.map((s) => s.date));
  let d = new Date();
  if (!dates.has(isoDate(d))) d.setDate(d.getDate() - 1);
  let streak = 0;
  while (dates.has(isoDate(d))) { streak++; d.setDate(d.getDate() - 1); }
  return streak;
}
function computeLongestStreak(sessions) {
  const dates = Array.from(new Set(sessions.map((s) => s.date))).sort();
  let longest = 0, run = 0, prev = null;
  dates.forEach((ds) => {
    const d = new Date(ds + "T00:00:00");
    if (prev && (d - prev) / 86400000 === 1) run++; else run = 1;
    longest = Math.max(longest, run);
    prev = d;
  });
  return longest;
}
function startOfWeek(d) { const x = new Date(d); const day = (x.getDay() + 6) % 7; x.setDate(x.getDate() - day); x.setHours(0, 0, 0, 0); return x; }
function sessionsThisWeek(sessions) {
  const start = startOfWeek(new Date());
  return sessions.filter((s) => new Date(s.date + "T00:00:00") >= start).length;
}
function estimateMinutes(day) {
  let total = 0;
  day.items.forEach((it) => { total += it.sets * (1 + (it.restSec || 60) / 60); });
  return Math.round(total);
}
function nextDay(state) {
  if (!state.dayOrder.length) return null;
  const idx = state.sessions.length % state.dayOrder.length;
  return state.days[state.dayOrder[idx]];
}

// =========================================================
// TAB / SCREEN NAVIGATION
// =========================================================
function showScreen(name) {
  $$(".screen").forEach((s) => s.classList.remove("active"));
  $("#screen-" + name).classList.add("active");
  $$(".tab").forEach((t) => t.classList.toggle("active", t.dataset.target === name));
  closeBuild();
  closeProfile();
  closeSessionDetail();
  window.scrollTo(0, 0);
  if (name === "train") renderTrain();
}
function openBuild() { $("#screen-build").classList.add("active"); renderBuild(); }
function closeBuild() { $("#screen-build").classList.remove("active"); }
function openProfile() { $("#screen-profile").classList.add("active"); renderProfile(); }
function closeProfile() { $("#screen-profile").classList.remove("active"); }

// =========================================================
// HOME
// =========================================================
function renderHome() {
  const state = Store.state;
  const root = $("#screen-home");
  const streak = computeCurrentStreak(state.sessions);
  const avgDur = state.sessions.length ? Math.round(state.sessions.reduce((a, s) => a + s.durationSec, 0) / state.sessions.length / 60) : 0;
  const week = sessionsThisWeek(state.sessions);

  const day = nextDay(state);
  let todayBlock = "";
  if (day) {
    const mins = estimateMinutes(day);
    const groups = new Set(day.items.filter((i) => i.group !== "None").map((i) => i.group));
    const rows = day.items.map((it) => {
      const ex = state.exercises[it.exerciseId];
      if (!ex) return "";
      const tag = it.group !== "None" ? `<span class="superset-tag">↔ </span>` : "";
      return `<div class="exercise-row"><span class="name">${tag}${esc(ex.name)}</span><span class="sets">${it.sets}×${it.repsTarget}</span></div>`;
    }).join("");
    todayBlock = `
      <div class="card today-card">
        <div class="today-head">
          <div>
            <div class="eyebrow">Today's Session</div>
            <div class="today-title">${esc(day.name)}</div>
            <div class="today-meta">${day.items.length} exercise${day.items.length === 1 ? "" : "s"}${groups.size ? ` · ${groups.size} superset${groups.size === 1 ? "" : "s"}` : ""} · ~${mins} min</div>
          </div>
        </div>
        <div class="exercise-preview">${rows}</div>
        <button class="btn-cta" onclick="Actions.startWorkout('${day.id}')">START WORKOUT →</button>
      </div>`;
  }

  const empty = !state.dayOrder.length ? `
    <div class="empty-state">
      <svg class="e-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M4 8v8M8 5v14M12 9v6M16 5v14M20 8v8"/></svg>
      <h3>Build Your First Program</h3>
      <p>Add a few exercises, group them into a training day, and Iron will guide you through it set by set.</p>
      <button class="btn-cta" onclick="Actions.openBuild()">BUILD A PROGRAM →</button>
    </div>` : "";

  root.innerHTML = `
    <div class="eyebrow">${new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}</div>
    <div class="greeting">Welcome back${state.userName ? `, ${esc(state.userName)}` : ""}</div>
    ${todayBlock}
    ${empty}
    <div class="stat-grid">
      <div class="stat-card pop">
        <svg class="stat-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 8v8M8 5v14M12 8v8M16 5v14M20 8v8"/></svg>
        <div><div class="stat-num">${state.sessions.length}</div><div class="stat-label">Total Workouts</div></div>
      </div>
      <div class="stat-card pop2">
        <svg class="stat-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 2s6 6.5 6 11a6 6 0 1 1-12 0c0-1.8 1-3.3 2-4.5.2 1 .8 1.6 1.5 1.6 0-3 .5-5.5 2.5-8.1z"/></svg>
        <div><div class="stat-num">${streak}</div><div class="stat-label">Day Streak</div></div>
      </div>
      <div class="stat-card">
        <svg class="stat-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/></svg>
        <div><div class="stat-num">${avgDur}<small>m</small></div><div class="stat-label">Avg Duration</div></div>
      </div>
      <div class="stat-card">
        <svg class="stat-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 17l5-5 4 4 8-9"/></svg>
        <div><div class="stat-num">${week}</div><div class="stat-label">This Week</div></div>
      </div>
    </div>
  `;
}

// =========================================================
// TRAIN (workout runner)
// =========================================================
let runner = null;

function buildQueue(day) {
  const items = day.items;
  const processedGroups = new Set();
  const queue = [];
  items.forEach((it) => {
    if (it.group && it.group !== "None") {
      if (processedGroups.has(it.group)) return;
      processedGroups.add(it.group);
      const groupItems = items.filter((x) => x.group === it.group);
      const maxSets = Math.max(...groupItems.map((g) => g.sets));
      for (let r = 0; r < maxSets; r++) {
        groupItems.forEach((g) => { if (r < g.sets) queue.push({ itemId: g.id, exerciseId: g.exerciseId, setIndex: r }); });
      }
    } else {
      for (let s = 0; s < it.sets; s++) queue.push({ itemId: it.id, exerciseId: it.exerciseId, setIndex: s });
    }
  });
  return queue;
}

function startWorkout(dayId) {
  const day = Store.state.days[dayId];
  if (!day || !day.items.length) { toast("This day has no exercises yet."); return; }
  const queue = buildQueue(day);
  runner = { dayId, day, queue, pointer: 0, startedAt: Date.now(), log: {}, restActive: false, restRemaining: 0, restTotal: 0, restTimerId: null };
  loadStepValues();
  showScreen("train");
}

function currentStep() { return runner.queue[runner.pointer]; }
function currentItem() { const step = currentStep(); return runner.day.items.find((i) => i.id === step.itemId); }

// Loads the draft weight/reps/RIR shown for the current pointer: whatever
// was already logged there (so navigating back shows what you actually
// did), otherwise sensible defaults.
function loadStepValues() {
  const step = currentStep();
  const item = currentItem();
  const logged = runner.log[runner.pointer];
  if (logged) {
    runner.currentWeight = logged.weight;
    runner.currentReps = logged.reps;
    runner.currentRir = logged.rir ?? null;
    return;
  }
  const last = Store.lastWeightFor(step.exerciseId);
  const ex = Store.state.exercises[step.exerciseId];
  runner.currentWeight = last != null ? last : (ex ? ex.defaultWeight : 20);
  runner.currentReps = item.repsTarget;
  runner.currentRir = null;
}

// If the current step is already logged, keep the saved entry in sync as
// the lifter adjusts the draft values — no separate "update" action needed.
function syncLoggedEntry() {
  const entry = runner.log[runner.pointer];
  if (!entry) return;
  entry.weight = runner.currentWeight;
  entry.reps = runner.currentReps;
  entry.rir = runner.currentRir;
}

function stepValue(kind, delta) {
  if (!runner) return;
  if (kind === "weight") runner.currentWeight = Math.max(0, Math.round((runner.currentWeight + delta) * 10) / 10);
  else runner.currentReps = Math.max(0, runner.currentReps + delta);
  syncLoggedEntry();
  renderTrain();
}

function setRir(value) {
  if (!runner) return;
  runner.currentRir = runner.currentRir === value ? null : value;
  syncLoggedEntry();
  renderTrain();
}

function goToStep(index) {
  if (!runner || index < 0 || index >= runner.queue.length) return;
  runner.pointer = index;
  clearInterval(runner.restTimerId);
  runner.restActive = false;
  loadStepValues();
  renderTrain();
}
function goPrev() { if (runner) goToStep(runner.pointer - 1); }
function goNext() { if (runner) goToStep(runner.pointer + 1); }

// The primary button does double duty: logs the set (and starts rest) the
// first time, then becomes the explicit "move on" action once logged —
// Train never auto-advances on its own.
function primaryTrainAction() {
  if (!runner.log[runner.pointer]) {
    const step = currentStep();
    const item = currentItem();
    const ex = Store.state.exercises[step.exerciseId];
    runner.log[runner.pointer] = { exerciseId: step.exerciseId, weight: runner.currentWeight, reps: runner.currentReps, rir: runner.currentRir, target: item.repsTarget, ts: Date.now() };
    const restSec = item.restSec || (ex ? ex.restSec : 90) || 90;
    startRest(restSec);
    renderTrain();
    return;
  }
  clearInterval(runner.restTimerId);
  runner.restActive = false;
  if (runner.pointer >= runner.queue.length - 1) {
    finishWorkout();
  } else {
    goToStep(runner.pointer + 1);
  }
}

function primaryTrainLabel() {
  if (!runner.log[runner.pointer]) return "LOG SET";
  if (runner.pointer >= runner.queue.length - 1) return "FINISH WORKOUT →";
  const cur = runner.queue[runner.pointer];
  const next = runner.queue[runner.pointer + 1];
  return next.exerciseId === cur.exerciseId ? "NEXT SET →" : "NEXT EXERCISE →";
}

function startRest(seconds) {
  clearInterval(runner.restTimerId);
  runner.restActive = true;
  runner.restRemaining = seconds;
  runner.restTotal = seconds;
  runner.restTimerId = setInterval(() => {
    runner.restRemaining--;
    if (runner.restRemaining <= 0) { clearInterval(runner.restTimerId); runner.restActive = false; }
    renderTrain();
  }, 1000);
}
function skipRest() {
  clearInterval(runner.restTimerId);
  runner.restActive = false;
  renderTrain();
}

function finishWorkout() {
  const durationSec = Math.max(1, Math.round((Date.now() - runner.startedAt) / 1000));
  const state = Store.state;

  // Group logged sets by exercise, in the order each exercise first appears
  // in the queue (not log-insertion order, since navigating back and forth
  // can log them out of order).
  const byExercise = new Map();
  runner.queue.forEach((step, i) => {
    const entry = runner.log[i];
    if (!entry) return;
    if (!byExercise.has(step.exerciseId)) {
      const ex = state.exercises[step.exerciseId];
      byExercise.set(step.exerciseId, { exerciseId: step.exerciseId, exerciseName: ex ? ex.name : "Exercise", sets: [] });
    }
    byExercise.get(step.exerciseId).sets.push({ weight: entry.weight, reps: entry.reps, rir: entry.rir ?? null, target: entry.target, ts: entry.ts });
  });

  const session = {
    id: Store.uid(),
    dayId: runner.dayId,
    dayName: runner.day.name,
    date: todayISO(),
    startedAt: runner.startedAt,
    durationSec,
    entries: Array.from(byExercise.values()),
  };
  const totalSets = session.entries.reduce((a, e) => a + e.sets.length, 0);
  runner = null;
  Store.saveSession(session);
  renderTrainDone(session, totalSets);
}

function renderTrainDone(session, totalSets) {
  const root = $("#screen-train");
  root.innerHTML = `
    <div class="card finish-summary">
      <div class="eyebrow">Workout Complete</div>
      <div class="big">${esc(session.dayName)}</div>
      <div class="program-note" style="margin-top:6px;">${totalSets} sets logged · ${fmtHM(session.durationSec)}</div>
      <button class="btn-cta" style="margin-top:20px" onclick="Actions.goHome()">DONE →</button>
    </div>`;
}

function cancelWorkout() {
  showConfirm("Cancel this workout? Nothing logged so far will be saved.", () => {
    clearInterval(runner && runner.restTimerId);
    runner = null;
    showScreen("home");
  }, "Cancel Workout");
}

function renderTrainPicker() {
  const state = Store.state;
  const root = $("#screen-train");
  if (!state.dayOrder.length) {
    root.innerHTML = `<div class="empty-state">
      <svg class="e-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M4 8v8M8 5v14M12 9v6M16 5v14M20 8v8"/></svg>
      <h3>No Training Days Yet</h3>
      <p>Build a program with at least one training day to start a workout.</p>
      <button class="btn-cta" onclick="Actions.openBuild()">BUILD A PROGRAM →</button>
    </div>`;
    return;
  }
  const rows = state.dayOrder.map((id) => {
    const day = state.days[id];
    const mins = estimateMinutes(day);
    return `
      <div class="list-item">
        <div class="li-head">
          <div>
            <div class="li-title">${esc(day.name)}</div>
            <div class="li-meta">${day.items.length} exercises · ~${mins} min</div>
          </div>
        </div>
        <button class="btn-cta" style="margin-top:12px; padding:13px 0; font-size:17px;" onclick="Actions.startWorkout('${id}')">START →</button>
      </div>`;
  }).join("");
  root.innerHTML = `
    <div class="eyebrow">Choose a Training Day</div>
    <div class="hist-title" style="margin-bottom:6px;">Train</div>
    ${rows}
    <button class="btn-ghost" style="margin-top:6px;" onclick="Actions.openBuild()">+ Build / Edit Program</button>
  `;
}

function renderTrain() {
  if (!runner) { renderTrainPicker(); return; }
  const root = $("#screen-train");
  const state = Store.state;
  const step = currentStep();
  const item = currentItem();
  const ex = state.exercises[step.exerciseId];
  const uniqueExercises = new Set(runner.day.items.map((i) => i.exerciseId)).size;
  const seenExercises = new Set();
  for (let i = 0; i <= runner.pointer; i++) seenExercises.add(runner.queue[i].exerciseId);
  const exercisePosition = seenExercises.size;

  let supersetBadge = "";
  let withLine = `Target ${item.repsTarget} reps`;
  if (item.group !== "None") {
    const partners = runner.day.items.filter((i) => i.group === item.group && i.id !== item.id).map((i) => state.exercises[i.exerciseId]?.name).filter(Boolean);
    supersetBadge = `<span class="superset-badge">Superset ${item.group} · Round ${step.setIndex + 1}</span>`;
    if (partners.length) withLine = `Superset with ${partners.join(", ")} · Target ${item.repsTarget} reps`;
  }

  const met = runner.currentReps >= item.repsTarget;

  let restHtml = "";
  if (runner.restActive) {
    const pct = Math.max(0, (runner.restRemaining / runner.restTotal) * 100);
    restHtml = `
      <div class="rest-panel">
        <div class="rest-eyebrow">Resting</div>
        <div class="rest-clock">${fmtMinSec(Math.max(0, runner.restRemaining))}</div>
        <div class="rest-bar"><div class="rest-bar-fill" style="width:${pct}%"></div></div>
        <div class="rest-actions"><button class="skip-btn" onclick="Actions.skipRest()">Skip rest</button></div>
      </div>`;
  }

  let nextHtml = "";
  if (runner.pointer + 1 < runner.queue.length) {
    const n = runner.queue[runner.pointer + 1];
    const nItem = runner.day.items.find((i) => i.id === n.itemId);
    const nEx = state.exercises[n.exerciseId];
    nextHtml = `<div class="next-strip"><span class="lbl">Next</span> ${esc(nEx?.name || "")} · Set ${n.setIndex + 1} of ${nItem.sets}</div>`;
  } else {
    nextHtml = `<div class="next-strip"><span class="lbl">Last</span> Final set of the workout</div>`;
  }

  const rirOptions = [0, 1, 2, 3, 4];
  const rirChips = rirOptions.map((v) => `<button class="rir-chip ${runner.currentRir === v ? "active" : ""}" onclick="Actions.setRir(${v})">${v === 4 ? "4+" : v}</button>`).join("");

  root.innerHTML = `
    <div class="train-head">
      <div>
        <div class="eyebrow">${esc(runner.day.name)} · Exercise ${exercisePosition} of ${uniqueExercises}</div>
        <div class="train-title">${esc(ex ? ex.name : "")}</div>
      </div>
      <div class="train-nav">
        <button onclick="Actions.goPrev()" aria-label="Previous set" ${runner.pointer === 0 ? "disabled" : ""}>‹</button>
        <button onclick="Actions.goNext()" aria-label="Next set" ${runner.pointer === runner.queue.length - 1 ? "disabled" : ""}>›</button>
      </div>
    </div>
    <div class="bar-track" style="margin-top:12px;"><div class="bar-fill" style="width:${Math.round((runner.pointer / runner.queue.length) * 100)}%"></div></div>
    ${supersetBadge}
    <div class="card exercise-card">
      <div class="exercise-name">${esc(ex ? ex.name : "")}</div>
      <div class="set-badge">SET ${step.setIndex + 1} OF ${item.sets}</div>
      <div class="exercise-with">${withLine}</div>
      <div class="readout-grid">
        <div class="readout">
          <div class="rlabel">Weight</div>
          <div class="rval">${runner.currentWeight}</div>
          <div class="runit">kg</div>
          <div class="stepper">
            <button class="step-btn" data-step="weight" data-delta="-2.5">−</button>
            <button class="step-btn" data-step="weight" data-delta="2.5">+</button>
          </div>
        </div>
        <div class="readout ${met ? "met" : ""}">
          <div class="rlabel">Reps</div>
          <div class="rval">${runner.currentReps}${met ? '<span class="check">✓</span>' : ""}</div>
          <div class="runit">completed</div>
          <div class="stepper">
            <button class="step-btn" data-step="reps" data-delta="-1">−</button>
            <button class="step-btn" data-step="reps" data-delta="1">+</button>
          </div>
        </div>
      </div>
      <div class="rir-row">
        <div class="rir-label">RIR <span>(optional)</span></div>
        <div class="rir-chips">${rirChips}</div>
      </div>
      <button class="log-set-btn" onclick="Actions.primaryTrainAction()">${primaryTrainLabel()}</button>
      ${restHtml}
      ${nextHtml}
    </div>
    <button class="btn-ghost" style="margin-top:16px;" onclick="Actions.cancelWorkout()">Cancel Workout</button>
  `;
}

// =========================================================
// HISTORY
// =========================================================
let viewedMonth = (() => { const d = new Date(); return { y: d.getFullYear(), m: d.getMonth() }; })();

function changeMonth(delta) {
  viewedMonth.m += delta;
  if (viewedMonth.m < 0) { viewedMonth.m = 11; viewedMonth.y--; }
  if (viewedMonth.m > 11) { viewedMonth.m = 0; viewedMonth.y++; }
  renderHistory();
}

function renderHistory() {
  const state = Store.state;
  const root = $("#screen-history");
  const { y, m } = viewedMonth;
  const first = new Date(y, m, 1);
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const startWeekday = first.getDay();
  const monthLabel = first.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const doneDates = new Set(state.sessions.map((s) => s.date));
  const todayIso = todayISO();

  let cells = "";
  for (let i = 0; i < startWeekday; i++) cells += `<div class="cal-cell blank"></div>`;
  for (let day = 1; day <= daysInMonth; day++) {
    const iso = `${y}-${String(m + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const cls = ["cal-cell"];
    if (doneDates.has(iso)) cls.push("done");
    if (iso === todayIso) cls.push("today");
    cells += `<div class="${cls.join(" ")}">${day}</div>`;
  }

  const totalTime = state.sessions.reduce((a, s) => a + s.durationSec, 0);
  const setsLogged = state.sessions.reduce((a, s) => a + s.entries.reduce((b, e) => b + e.sets.length, 0), 0);
  const longest = computeLongestStreak(state.sessions);

  const recent = [...state.sessions].sort((a, b) => b.startedAt - a.startedAt).slice(0, 6).map((s) => `
    <button class="session-row" onclick="Actions.openSessionDetail('${s.id}')">
      <div><div class="s-name">${esc(s.dayName)}</div><div class="s-date">${fmtDate(s.date)}</div></div>
      <div class="s-dur">${fmtHM(s.durationSec)}</div>
    </button>`).join("");

  root.innerHTML = `
    <div class="eyebrow">Track your fitness journey</div>
    <div class="hist-title">History</div>
    <div class="card cal-card">
      <div class="cal-head">
        <h3>${monthLabel}</h3>
        <div class="cal-nav"><button onclick="Actions.changeMonth(-1)">‹</button><button onclick="Actions.changeMonth(1)">›</button></div>
      </div>
      <div class="cal-grid">
        <div class="cal-dow">S</div><div class="cal-dow">M</div><div class="cal-dow">T</div><div class="cal-dow">W</div><div class="cal-dow">T</div><div class="cal-dow">F</div><div class="cal-dow">S</div>
        ${cells}
      </div>
      <div class="foot-stats">
        <div class="foot-stat"><div class="fv">${longest} day${longest === 1 ? "" : "s"}</div><div class="fl">LONGEST STREAK</div></div>
        <div class="foot-stat"><div class="fv">${fmtHM(totalTime)}</div><div class="fl">TOTAL TIME</div></div>
        <div class="foot-stat"><div class="fv">${setsLogged}</div><div class="fl">SETS LOGGED</div></div>
      </div>
    </div>
    ${state.sessions.length ? `<div class="session-list"><div class="e-title">Recent Sessions</div>${recent}</div>` : `<div class="empty-mini" style="margin-top:16px;">No workouts logged yet — finish one from Train and it'll show up here.</div>`}
  `;
}

// =========================================================
// SESSION DETAIL (overlay opened from a History row)
// =========================================================
let sessionDetailId = null;

function openSessionDetail(id) {
  sessionDetailId = id;
  $("#screen-session-detail").classList.add("active");
  renderSessionDetail();
}
function closeSessionDetail() {
  $("#screen-session-detail").classList.remove("active");
}

function renderSessionDetail() {
  const root = $("#screen-session-detail");
  const session = Store.state.sessions.find((s) => s.id === sessionDetailId);
  if (!session) { root.innerHTML = ""; return; }

  const totalSets = session.entries.reduce((a, e) => a + e.sets.length, 0);
  const totalVolume = session.entries.reduce((a, e) => a + e.sets.reduce((b, s) => b + s.weight * s.reps, 0), 0);

  const exerciseBlocks = session.entries.map((e) => `
    <div class="detail-exercise">
      <div class="detail-exercise-name">${esc(e.exerciseName)}</div>
      <div class="detail-sets">
        ${e.sets.map((s, i) => `
          <div class="detail-set-row">
            <span class="ds-num">${i + 1}</span>
            <span class="ds-val">${s.weight} kg × ${s.reps}${s.target ? ` <span class="ds-target">/ ${s.target}</span>` : ""}</span>
            ${s.rir != null ? `<span class="ds-rir">RIR ${s.rir}</span>` : ""}
          </div>`).join("")}
      </div>
    </div>`).join("") || `<div class="empty-mini">No sets were logged in this session.</div>`;

  root.innerHTML = `
    <div class="build-head">
      <button class="icon-btn" onclick="Actions.closeSessionDetail()" aria-label="Close"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg></button>
      <div class="build-title">Session</div>
      <div style="width:38px"></div>
    </div>
    <div class="build-body">
      <div class="build-section">
        <h3>${esc(session.dayName)}</h3>
        <p class="sub">${fmtDate(session.date)} · ${fmtHM(session.durationSec)} · ${totalSets} sets · ${totalVolume.toLocaleString()} kg total volume</p>
      </div>
      <div class="build-section">
        ${exerciseBlocks}
      </div>
    </div>
  `;
}

// =========================================================
// LOG (weight + kcal)
// =========================================================
function adjustWeight(delta) {
  const state = Store.state;
  const today = todayISO();
  const last = state.bodyLog.length ? state.bodyLog[state.bodyLog.length - 1].weightKg : 70;
  const todays = state.bodyLog.find((b) => b.date === today);
  const base = todays ? todays.weightKg : last;
  Store.logWeight(today, Math.max(0, Math.round((base + delta) * 10) / 10));
}

function adjustKcal(delta) {
  const state = Store.state;
  const today = todayISO();
  const todays = state.kcalLog.find((k) => k.date === today);
  const base = todays ? todays.kcal : 0;
  Store.logKcal(today, Math.max(0, base + delta));
}

function sparklineHtml(points, getValue, unitLabel, ariaLabel) {
  if (points.length < 2) return `<div class="hint">Log a few more days to see a trend line.</div>`;
  const pts = points.slice(-14);
  const vals = pts.map(getValue);
  const min = Math.min(...vals), max = Math.max(...vals);
  const range = max - min || 1;
  const w = 320, h = 80, pad = 8;
  const coords = pts.map((p, i) => {
    const x = pts.length > 1 ? (i / (pts.length - 1)) * w : 0;
    const y = pad + (1 - (getValue(p) - min) / range) * (h - pad * 2);
    return [x, y];
  });
  const poly = coords.map((c) => c.join(",")).join(" ");
  const last = coords[coords.length - 1];
  return `
    <div class="sparkline">
      <svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-label="${ariaLabel}">
        <line x1="0" y1="${pad}" x2="${w}" y2="${pad}" stroke="var(--line)" stroke-width="1"/>
        <line x1="0" y1="${h - pad}" x2="${w}" y2="${h - pad}" stroke="var(--line)" stroke-width="1"/>
        <polyline points="${poly}" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
        <circle cx="${last[0]}" cy="${last[1]}" r="4" fill="var(--accent)"/>
      </svg>
      <div class="spark-caption"><span>${fmtDate(pts[0].date)} · ${getValue(pts[0]).toLocaleString()}${unitLabel}</span><span>${fmtDate(pts[pts.length - 1].date)} · ${getValue(pts[pts.length - 1]).toLocaleString()}${unitLabel}</span></div>
    </div>`;
}

function renderLog() {
  const state = Store.state;
  const root = $("#screen-log");
  const today = todayISO();

  const weightSorted = [...state.bodyLog].sort((a, b) => a.date.localeCompare(b.date));
  const latestWeight = weightSorted.length ? weightSorted[weightSorted.length - 1] : null;
  const weekAgo = new Date(); weekAgo.setDate(weekAgo.getDate() - 7);
  const weekAgoEntry = weightSorted.find((b) => new Date(b.date + "T00:00:00") >= weekAgo);
  let weightDelta = "";
  if (latestWeight && weekAgoEntry && weekAgoEntry.date !== latestWeight.date) {
    const diff = Math.round((latestWeight.weightKg - weekAgoEntry.weightKg) * 100) / 100;
    weightDelta = `<span class="delta">${diff <= 0 ? "▼" : "▲"} ${Math.abs(diff)} / wk</span>`;
  }
  const weightSpark = sparklineHtml(weightSorted, (p) => p.weightKg, " kg", `Body weight trend, ${weightSorted.length ? weightSorted[0].weightKg : ""} to ${latestWeight ? latestWeight.weightKg : ""} kilograms`);

  const kcalSorted = [...state.kcalLog].sort((a, b) => a.date.localeCompare(b.date));
  const latestKcal = kcalSorted.find((k) => k.date === today);
  const kcalSpark = sparklineHtml(kcalSorted, (p) => p.kcal, " kcal", "Calories eaten trend");

  root.innerHTML = `
    <div class="eyebrow">Body weight &amp; nutrition</div>
    <div class="log-title">Log</div>

    <div class="card log-card">
      <div class="log-card-head"><span class="lc-title">Body Weight</span>${weightDelta}</div>
      <div class="stepper-row">
        <button class="step-btn-lg" data-adjust="weight" data-delta="-0.1" aria-label="Decrease weight">−</button>
        <div class="stepper-center"><span class="val">${latestWeight ? latestWeight.weightKg : "—"}</span><span class="unit">kg</span></div>
        <button class="step-btn-lg" data-adjust="weight" data-delta="0.1" aria-label="Increase weight">+</button>
      </div>
      <div class="stepper-caption">0.1 kg steps · today</div>
      ${weightSpark}
    </div>

    <div class="card log-card">
      <div class="log-card-head"><span class="lc-title">Calories Eaten</span></div>
      <div class="stepper-row">
        <button class="step-btn-lg" data-adjust="kcal" data-delta="-50" aria-label="Decrease calories">−</button>
        <div class="stepper-center"><span class="val">${(latestKcal ? latestKcal.kcal : 0).toLocaleString()}</span><span class="unit">kcal</span></div>
        <button class="step-btn-lg" data-adjust="kcal" data-delta="50" aria-label="Increase calories">+</button>
      </div>
      <div class="stepper-caption">50 kcal steps · today</div>
      ${kcalSpark}
      <div class="chips">
        <button class="chip-btn" onclick="Actions.adjustKcal(250)">+250</button>
        <button class="chip-btn" onclick="Actions.adjustKcal(500)">+500</button>
        <button class="chip-btn" onclick="Actions.adjustKcal(1000)">+1000</button>
      </div>
    </div>
  `;
}

// =========================================================
// BUILD (program days, exercises added inline via search)
// =========================================================
const buildUi = { editingDayId: null, exercisePicker: null, editingItemId: null };

function addDay() {
  const input = $("#new-day-name");
  const name = input.value.trim();
  if (!name) { toast("Name the training day first"); return; }
  const id = Store.upsertDay({ name });
  input.value = "";
  buildUi.editingDayId = id;
  buildUi.exercisePicker = null;
  buildUi.editingItemId = null;
  renderBuild();
}
function toggleEditDay(id) {
  buildUi.editingDayId = buildUi.editingDayId === id ? null : id;
  buildUi.exercisePicker = null;
  buildUi.editingItemId = null;
  renderBuild();
}
function deleteDay(id) {
  showConfirm("Delete this training day?", () => {
    Store.deleteDay(id);
    if (buildUi.editingDayId === id) { buildUi.editingDayId = null; buildUi.exercisePicker = null; buildUi.editingItemId = null; }
    renderBuild();
  }, "Delete Day");
}
function renameDay(id) {
  const name = $(`#day-name-${id}`).value.trim();
  if (name) Store.upsertDay({ id, name });
}
function reorderDay(id, delta) { Store.reorderDay(id, delta); renderBuild(); }
function reorderDayItem(dayId, itemId, delta) { Store.reorderDayItem(dayId, itemId, delta); renderBuild(); }
function removeDayItem(dayId, itemId) {
  showConfirm("Remove this exercise from the day?", () => {
    Store.removeDayItem(dayId, itemId);
    renderBuild();
  }, "Remove");
}

function editDayItem(dayId, itemId) {
  buildUi.editingItemId = itemId;
  buildUi.exercisePicker = null;
  renderBuild();
}
function cancelEditDayItem() {
  buildUi.editingItemId = null;
  renderBuild();
}
function saveDayItem(dayId, itemId) {
  const day = Store.state.days[dayId];
  const item = day && day.items.find((it) => it.id === itemId);
  if (!item) return;
  const ex = Store.state.exercises[item.exerciseId];

  const sets = parseInt($(`#edit-sets-${itemId}`).value, 10) || 3;
  const repsTarget = parseInt($(`#edit-reps-${itemId}`).value, 10) || 10;
  const weight = parseFloat($(`#edit-weight-${itemId}`).value) || 0;
  const restSec = parseInt($(`#edit-rest-${itemId}`).value, 10) || 90;
  const group = $(`#edit-group-${itemId}`).value;

  Store.upsertExercise({ id: item.exerciseId, name: ex ? ex.name : "Exercise", defaultSets: sets, defaultReps: repsTarget, defaultWeight: weight, restSec });
  buildUi.editingItemId = null;
  Store.updateDayItem(dayId, itemId, { sets, repsTarget, restSec, group });
}

// ---- exercise search picker (nested inside an open training day) ----
function onExerciseSearch(dayId, query) {
  if (!buildUi.exercisePicker || buildUi.exercisePicker.dayId !== dayId) {
    buildUi.exercisePicker = { dayId, query: "", selected: null, results: [] };
  }
  buildUi.exercisePicker.query = query;
  renderExerciseResults(dayId);
}

function renderExerciseResults(dayId) {
  const container = $(`#ex-results-${dayId}`);
  const picker = buildUi.exercisePicker;
  if (!container || !picker) return;
  const query = picker.query.trim().toLowerCase();
  const state = Store.state;

  const customMatches = Object.values(state.exercises)
    .filter((ex) => !query || ex.name.toLowerCase().includes(query))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((ex) => ({ id: ex.id, name: ex.name, source: "custom", defaultSets: ex.defaultSets, defaultReps: ex.defaultReps, defaultWeight: ex.defaultWeight, defaultRest: ex.restSec }));

  if (!query) {
    picker.results = [];
    container.innerHTML = `<div class="hint">Type to search ${EXERCISE_DB.length}+ exercises, or add your own.</div>`;
    return;
  }

  const customNames = new Set(customMatches.map((c) => c.name.toLowerCase()));
  const dbMatches = EXERCISE_DB
    .filter((ex) => ex.name.toLowerCase().includes(query) && !customNames.has(ex.name.toLowerCase()))
    .slice(0, 25)
    .map((ex) => ({ id: null, name: ex.name, source: "db", defaultSets: 3, defaultReps: 10, defaultWeight: 20, defaultRest: 90 }));

  const results = [...customMatches, ...dbMatches];
  if (!results.some((r) => r.name.toLowerCase() === query)) {
    results.push({ id: null, name: picker.query.trim(), source: "new", defaultSets: 3, defaultReps: 10, defaultWeight: 20, defaultRest: 90 });
  }
  picker.results = results;

  container.innerHTML = results.map((r, i) => {
    if (r.source === "new") {
      return `<button class="ex-result-row ex-add-custom" onclick="Actions.pickExercise('${dayId}', ${i})">+ Add "${esc(r.name)}" as new exercise</button>`;
    }
    return `
      <div class="ex-result-row">
        <button class="ex-result-pick" onclick="Actions.pickExercise('${dayId}', ${i})">
          <span>${esc(r.name)}</span>${r.source === "custom" ? '<span class="ex-tag">Yours</span>' : ""}
        </button>
        ${r.source === "custom" ? `<button class="ex-result-del" onclick="Actions.deleteCustomExercise('${dayId}','${r.id}')" aria-label="Delete ${esc(r.name)}">✕</button>` : ""}
      </div>`;
  }).join("");
}

function pickExercise(dayId, index) {
  const picker = buildUi.exercisePicker;
  if (!picker || !picker.results[index]) return;
  picker.selected = { ...picker.results[index] };
  // Default rest to whatever the previous exercise in this day used — one
  // less field to fill in when supersetting or building a day in one go.
  const day = Store.state.days[dayId];
  if (day && day.items.length) {
    picker.selected.defaultRest = day.items[day.items.length - 1].restSec;
  }
  renderBuild();
}
function clearExercisePick(dayId) {
  buildUi.exercisePicker = { dayId, query: "", selected: null, results: [] };
  renderBuild();
}
function deleteCustomExercise(dayId, exerciseId) {
  showConfirm("Delete this custom exercise? It will be removed from any training days using it.", () => {
    Store.deleteExercise(exerciseId);
  }, "Delete");
}

function addDayItem(dayId) {
  const picker = buildUi.exercisePicker;
  if (!picker || picker.dayId !== dayId || !picker.selected) { toast("Search and pick an exercise first"); return; }

  const sets = parseInt($(`#di-sets-${dayId}`).value, 10) || 3;
  const repsTarget = parseInt($(`#di-reps-${dayId}`).value, 10) || 10;
  const weight = parseFloat($(`#di-weight-${dayId}`).value) || 0;
  const restSec = parseInt($(`#di-rest-${dayId}`).value, 10) || 90;
  const group = $(`#di-group-${dayId}`).value;

  // Upsert either way: for a new exercise this creates it, for an existing
  // one it refreshes its defaults to whatever was just set here.
  const exerciseId = Store.upsertExercise({ id: picker.selected.id || undefined, name: picker.selected.name, defaultSets: sets, defaultReps: repsTarget, defaultWeight: weight, restSec });

  buildUi.exercisePicker = { dayId, query: "", selected: null, results: [] };
  Store.addDayItem(dayId, { exerciseId, sets, repsTarget, restSec, group });
}

function renderAddExerciseBlock(dayId) {
  const picker = buildUi.exercisePicker && buildUi.exercisePicker.dayId === dayId ? buildUi.exercisePicker : null;

  if (picker && picker.selected) {
    const groupOptions = Store.GROUPS.map((g) => `<option value="${g}">${g === "None" ? "No Superset" : "Superset " + g}</option>`).join("");
    return `
      <div class="add-row ex-picker">
        <div class="ex-selected-chip">
          <span>${esc(picker.selected.name)}</span>
          <button onclick="Actions.clearExercisePick('${dayId}')" aria-label="Change exercise">✕ Change</button>
        </div>
        <div class="field-row" style="margin-top:12px;">
          <div class="field" style="margin-top:0;"><label>Sets</label><input type="text" inputmode="numeric" pattern="[0-9]*" id="di-sets-${dayId}" value="${picker.selected.defaultSets}"></div>
          <div class="field" style="margin-top:0;"><label>Reps</label><input type="text" inputmode="numeric" pattern="[0-9]*" id="di-reps-${dayId}" value="${picker.selected.defaultReps}"></div>
        </div>
        <div class="field-row" style="margin-top:10px;">
          <div class="field" style="margin-top:0;"><label>Weight kg</label><input type="text" inputmode="decimal" id="di-weight-${dayId}" value="${picker.selected.defaultWeight}"></div>
          <div class="field" style="margin-top:0;"><label>Rest s</label><input type="text" inputmode="numeric" pattern="[0-9]*" id="di-rest-${dayId}" value="${picker.selected.defaultRest}"></div>
        </div>
        <div class="field"><label>Group</label><select id="di-group-${dayId}">${groupOptions}</select></div>
        <button class="btn-cta" style="margin-top:14px; font-size:16px; padding:15px 0;" onclick="Actions.addDayItem('${dayId}')">+ ADD TO DAY</button>
      </div>`;
  }

  return `
    <div class="add-row ex-picker">
      <div class="field" style="margin-top:0;">
        <label>Add Exercise</label>
        <input type="text" id="ex-search-${dayId}" placeholder="Search exercises…" autocomplete="off" value="${esc(picker ? picker.query : "")}" oninput="Actions.onExerciseSearch('${dayId}', this.value)">
      </div>
      <div id="ex-results-${dayId}" class="ex-results">${picker && picker.query.trim() ? "" : `<div class="hint">Type to search ${EXERCISE_DB.length}+ exercises, or add your own.</div>`}</div>
    </div>`;
}

function renderBuild() {
  const state = Store.state;
  const root = $("#screen-build");

  const dayList = state.dayOrder.map((id, idx) => {
    const day = state.days[id];
    const open = buildUi.editingDayId === id;
    const itemRows = day.items.map((it) => {
      const ex = state.exercises[it.exerciseId];
      const exName = ex ? ex.name : "Unknown";
      const groupBadge = it.group !== "None" ? `<span class="dir-group">${it.group}</span>` : "";

      if (buildUi.editingItemId === it.id) {
        const groupOptions = Store.GROUPS.map((g) => `<option value="${g}" ${g === it.group ? "selected" : ""}>${g === "None" ? "No Superset" : "Superset " + g}</option>`).join("");
        return `
          <div class="day-item-edit">
            <div class="dir-name" style="margin-bottom:10px;">${esc(exName)}</div>
            <div class="field-row">
              <div class="field" style="margin-top:0;"><label>Sets</label><input type="text" inputmode="numeric" pattern="[0-9]*" id="edit-sets-${it.id}" value="${it.sets}"></div>
              <div class="field" style="margin-top:0;"><label>Reps</label><input type="text" inputmode="numeric" pattern="[0-9]*" id="edit-reps-${it.id}" value="${it.repsTarget}"></div>
            </div>
            <div class="field-row" style="margin-top:10px;">
              <div class="field" style="margin-top:0;"><label>Weight kg</label><input type="text" inputmode="decimal" id="edit-weight-${it.id}" value="${ex ? ex.defaultWeight : 20}"></div>
              <div class="field" style="margin-top:0;"><label>Rest s</label><input type="text" inputmode="numeric" pattern="[0-9]*" id="edit-rest-${it.id}" value="${it.restSec}"></div>
            </div>
            <div class="field"><label>Group</label><select id="edit-group-${it.id}">${groupOptions}</select></div>
            <div class="field-row" style="margin-top:14px;">
              <button class="btn-ghost" onclick="Actions.cancelEditDayItem()">Cancel</button>
              <button class="btn-cta" style="font-size:15px; padding:13px 0;" onclick="Actions.saveDayItem('${id}','${it.id}')">SAVE</button>
            </div>
          </div>`;
      }

      return `
        <div class="day-item-row">
          <div class="dir-main">
            <div class="dir-name">${groupBadge}${esc(exName)}</div>
            <div class="dir-meta">${it.sets}×${it.repsTarget} · ${it.restSec}s rest</div>
          </div>
          <div class="dir-actions">
            <button onclick="Actions.reorderDayItem('${id}','${it.id}',-1)" aria-label="Move up">↑</button>
            <button onclick="Actions.reorderDayItem('${id}','${it.id}',1)" aria-label="Move down">↓</button>
            <button onclick="Actions.editDayItem('${id}','${it.id}')" aria-label="Edit ${esc(exName)}">✎</button>
            <button onclick="Actions.removeDayItem('${id}','${it.id}')" aria-label="Remove ${esc(exName)}">✕</button>
          </div>
        </div>`;
    }).join("") || `<div class="empty-mini">No exercises in this day yet.</div>`;

    const detail = open ? `
      <div style="margin-top:12px;">
        <div class="field"><label>Day Name</label><input type="text" id="day-name-${id}" value="${esc(day.name)}" onchange="Actions.renameDay('${id}')"></div>
        ${itemRows}
        <div style="border-top:1px solid var(--line); padding-top:12px; margin-top:12px;">
          ${renderAddExerciseBlock(id)}
        </div>
      </div>` : "";

    return `
      <div class="list-item">
        <div class="li-head">
          <div>
            <div class="li-title">${esc(day.name)}</div>
            <div class="li-meta">${day.items.length} exercise${day.items.length === 1 ? "" : "s"} · ~${estimateMinutes(day)} min</div>
          </div>
          <div class="li-actions">
            <button onclick="Actions.reorderDay('${id}',-1)" aria-label="Move up" ${idx === 0 ? "disabled" : ""}>↑</button>
            <button onclick="Actions.reorderDay('${id}',1)" aria-label="Move down" ${idx === state.dayOrder.length - 1 ? "disabled" : ""}>↓</button>
            <button onclick="Actions.toggleEditDay('${id}')" aria-label="Edit"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg></button>
            <button class="danger" onclick="Actions.deleteDay('${id}')" aria-label="Delete"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16"/><path d="M6 7V4h12v3M8 7v13h8V7"/></svg></button>
          </div>
        </div>
        ${detail}
      </div>`;
  }).join("") || `<div class="empty-mini">No training days yet — add one below.</div>`;

  root.innerHTML = `
    <div class="build-head">
      <button class="icon-btn" onclick="Actions.closeBuild()" aria-label="Close"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg></button>
      <div class="build-title">Build Program</div>
      <div style="width:38px"></div>
    </div>
    <div class="build-body">

      <div class="build-section">
        <h3>Program</h3>
        <div class="field"><label>Program Name</label><input type="text" value="${esc(state.programName)}" placeholder="e.g. Push / Pull / Legs" onchange="Actions.setProgramName(this.value)"></div>
      </div>

      <div class="build-section">
        <h3>Training Days</h3>
        <p class="sub">Add a day, then search for exercises to add to it. Give two exercises the same superset letter to alternate between them.</p>
        ${dayList}
        <div class="new-day-box">
          <div class="field" style="margin-top:0;"><label>New Training Day</label><input type="text" id="new-day-name" placeholder="e.g. Push Day B"></div>
          <button class="btn-cta" style="margin-top:14px; font-size:16px; padding:15px 0;" onclick="Actions.addDay()">+ ADD DAY</button>
        </div>
      </div>

    </div>
  `;

  if (buildUi.exercisePicker && buildUi.exercisePicker.dayId === buildUi.editingDayId && !buildUi.exercisePicker.selected) {
    renderExerciseResults(buildUi.exercisePicker.dayId);
  }
}

function setProgramName(name) { Store.setProgramName(name.trim()); }

// =========================================================
// PROFILE
// =========================================================
function setUserName(name) { Store.setUserName(name.trim()); }
function setUserHeight(cm) {
  const v = parseFloat(cm);
  Store.setUserHeight(v > 0 ? v : null);
}

function exportData() {
  const blob = new Blob([Store.exportJSON()], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `iron-backup-${todayISO()}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}
function importData() { $("#import-file").click(); }
function handleImportFile(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try { Store.importJSON(reader.result); toast("Data imported"); renderProfile(); }
    catch (err) { toast("That file couldn't be read"); }
  };
  reader.readAsText(file);
}
function resetAll() {
  showConfirm("Erase all workouts, exercises, and logs on this device? This cannot be undone.", () => {
    Store.resetAll();
    renderProfile();
  }, "Erase Everything");
}

function renderProfile() {
  const state = Store.state;
  const root = $("#screen-profile");
  root.innerHTML = `
    <div class="build-head">
      <button class="icon-btn" onclick="Actions.closeProfile()" aria-label="Close"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg></button>
      <div class="build-title">Profile</div>
      <div style="width:38px"></div>
    </div>
    <div class="build-body">

      <div class="build-section">
        <h3>About You</h3>
        <div class="field"><label>Name</label><input type="text" value="${esc(state.userName)}" placeholder="e.g. Alex" onchange="Actions.setUserName(this.value)"></div>
        <div class="field"><label>Height (cm)</label><input type="text" inputmode="decimal" value="${state.userHeightCm ?? ""}" placeholder="e.g. 178" onchange="Actions.setUserHeight(this.value)"></div>
      </div>

      <div class="build-section">
        <h3>Your Data</h3>
        <p class="sub">Everything lives only on this device. Export a backup now and then.</p>
        <div class="field-row" style="margin-top:12px;">
          <button class="btn-ghost" onclick="Actions.exportData()">Export Backup</button>
          <button class="btn-ghost" onclick="Actions.importData()">Import Backup</button>
        </div>
        <input type="file" id="import-file" accept="application/json" style="display:none" onchange="Actions.handleImportFile(event)">
        <button class="btn-danger-text" style="margin-top:14px;" onclick="Actions.resetAll()">Erase All Data</button>
      </div>

    </div>
  `;
}

// =========================================================
// INIT
// =========================================================
function renderAll() {
  renderHome();
  renderTrain();
  renderHistory();
  renderLog();
  if ($("#screen-build").classList.contains("active")) renderBuild();
  if ($("#screen-profile").classList.contains("active")) renderProfile();
  if ($("#screen-session-detail").classList.contains("active")) renderSessionDetail();
}

function setupTabs() {
  $$(".tab").forEach((tab) => tab.addEventListener("click", () => showScreen(tab.dataset.target)));
  $("#btn-profile").addEventListener("click", openProfile);
}

// Press-and-hold repeat for stepper buttons (+/-), delegated so it keeps
// working across re-renders. Handling the action on pointerdown (instead of
// click) also stops iOS from treating rapid taps as a double-tap-to-zoom
// and stops a held press from triggering text selection.
function stepperAction(el) {
  const delta = parseFloat(el.dataset.delta);
  if (el.dataset.step) stepValue(el.dataset.step, delta);
  else if (el.dataset.adjust === "weight") adjustWeight(delta);
  else if (el.dataset.adjust === "kcal") adjustKcal(delta);
}

function setupSteppers() {
  const HOLD_DELAY = 450;
  let holdTimer = null;
  let repeatTimer = null;
  let activeEl = null;
  let repeatCount = 0;

  // The longer a stepper is held, the faster it fires — starts at a
  // controlled pace and ramps up to a fast scroll so big adjustments
  // don't take forever to hold through.
  function intervalForCount(n) {
    if (n < 8) return 110;
    if (n < 20) return 55;
    return 25;
  }

  function scheduleNext() {
    repeatTimer = setTimeout(() => {
      if (!activeEl) return;
      stepperAction(activeEl);
      repeatCount++;
      scheduleNext();
    }, intervalForCount(repeatCount));
  }

  function stop() {
    clearTimeout(holdTimer);
    clearTimeout(repeatTimer);
    holdTimer = null;
    repeatTimer = null;
    activeEl = null;
    repeatCount = 0;
  }

  document.addEventListener("pointerdown", (e) => {
    const el = e.target.closest(".step-btn, .step-btn-lg");
    if (!el) return;
    e.preventDefault();
    activeEl = el;
    stepperAction(el);
    holdTimer = setTimeout(() => {
      repeatCount = 0;
      scheduleNext();
    }, HOLD_DELAY);
  });
  ["pointerup", "pointerleave", "pointercancel"].forEach((evt) => document.addEventListener(evt, stop));
}

window.Actions = {
  startWorkout, primaryTrainAction, setRir, skipRest, cancelWorkout, goPrev, goNext, goHome: () => showScreen("home"),
  changeMonth,
  adjustKcal,
  openBuild, closeBuild, openProfile, closeProfile, openSessionDetail, closeSessionDetail,
  addDay, toggleEditDay, deleteDay, renameDay, reorderDay, reorderDayItem, removeDayItem, addDayItem,
  editDayItem, cancelEditDayItem, saveDayItem,
  onExerciseSearch, pickExercise, clearExercisePick, deleteCustomExercise,
  exportData, importData, handleImportFile, resetAll,
  setProgramName, setUserName, setUserHeight,
};

function disablePinchZoom() {
  // iOS Safari still allows pinch-zoom despite user-scalable=no in the
  // viewport meta tag; blocking the gesture events directly is the only
  // reliable way to stop it there. Multi-touch touchmove covers other
  // browsers that fire pinch as regular touch events instead.
  document.addEventListener("gesturestart", (e) => e.preventDefault());
  document.addEventListener("touchmove", (e) => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false });
}

Store.subscribe(renderAll);
setupTabs();
setupSteppers();
setupConfirmModal();
disablePinchZoom();
renderAll();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}
