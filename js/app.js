import { Store } from "./store.js";

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
  runner = { dayId, day, queue, pointer: 0, startedAt: Date.now(), entries: {}, restActive: false, restRemaining: 0, restTotal: 0, restTimerId: null };
  initCurrentValues();
  showScreen("train");
}

function currentStep() { return runner.queue[runner.pointer]; }
function currentItem() { const step = currentStep(); return runner.day.items.find((i) => i.id === step.itemId); }

function initCurrentValues() {
  const step = currentStep();
  const item = currentItem();
  const last = Store.lastWeightFor(step.exerciseId);
  const ex = Store.state.exercises[step.exerciseId];
  runner.currentWeight = last != null ? last : (ex ? ex.defaultWeight : 20);
  runner.currentReps = item.repsTarget;
}

function stepValue(kind, delta) {
  if (!runner) return;
  if (kind === "weight") runner.currentWeight = Math.max(0, Math.round((runner.currentWeight + delta) * 10) / 10);
  else runner.currentReps = Math.max(0, runner.currentReps + delta);
  renderTrain();
}

function logCurrentSet() {
  const step = currentStep();
  const item = currentItem();
  const ex = Store.state.exercises[step.exerciseId];
  if (!runner.entries[step.exerciseId]) runner.entries[step.exerciseId] = { exerciseId: step.exerciseId, exerciseName: ex ? ex.name : "Exercise", sets: [] };
  runner.entries[step.exerciseId].sets.push({ weight: runner.currentWeight, reps: runner.currentReps, target: item.repsTarget, ts: Date.now() });
  runner.pointer++;
  clearInterval(runner.restTimerId);
  runner.restActive = false;
  if (runner.pointer >= runner.queue.length) {
    finishWorkout();
  } else {
    initCurrentValues();
    renderTrain();
  }
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
  renderTrain();
}
function skipRest() {
  clearInterval(runner.restTimerId);
  runner.restActive = false;
  renderTrain();
}

function finishWorkout() {
  const durationSec = Math.max(1, Math.round((Date.now() - runner.startedAt) / 1000));
  const session = {
    id: Store.uid(),
    dayId: runner.dayId,
    dayName: runner.day.name,
    date: todayISO(),
    startedAt: runner.startedAt,
    durationSec,
    entries: Object.values(runner.entries),
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
  if (!confirm("Cancel this workout? Nothing logged so far will be saved.")) return;
  clearInterval(runner && runner.restTimerId);
  runner = null;
  showScreen("home");
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
  const doneExercises = new Set(Object.keys(runner.entries)).size;

  let supersetBadge = "";
  let withLine = `Set ${step.setIndex + 1} of ${item.sets} · Target ${item.repsTarget} reps`;
  if (item.group !== "None") {
    const partners = runner.day.items.filter((i) => i.group === item.group && i.id !== item.id).map((i) => state.exercises[i.exerciseId]?.name).filter(Boolean);
    supersetBadge = `<span class="superset-badge">Superset ${item.group} · Round ${step.setIndex + 1}</span>`;
    if (partners.length) withLine = `Superset with ${partners.join(", ")} · Target ${item.repsTarget} reps`;
  }

  const met = runner.currentReps >= item.repsTarget;
  const restSec = item.restSec || (ex ? ex.restSec : 90) || 90;

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
  } else {
    restHtml = `<button class="rest-start-btn" onclick="Actions.startRest(${restSec})">Start Rest · ${fmtMinSec(restSec)}</button>`;
  }

  let nextHtml = "";
  if (runner.pointer + 1 < runner.queue.length) {
    const n = runner.queue[runner.pointer + 1];
    const nItem = runner.day.items.find((i) => i.id === n.itemId);
    const nEx = state.exercises[n.exerciseId];
    nextHtml = `<div class="next-strip"><span class="lbl">Next</span> ${esc(nEx?.name || "")} · Set ${n.setIndex + 1} of ${nItem.sets}</div>`;
  } else {
    nextHtml = `<div class="next-strip"><span class="lbl">Last set</span> Log it to finish the workout</div>`;
  }

  root.innerHTML = `
    <div class="train-head">
      <div>
        <div class="eyebrow">${esc(runner.day.name)} · Exercise ${doneExercises + (runner.entries[step.exerciseId] ? 0 : 1)} of ${uniqueExercises}</div>
        <div class="train-title">${esc(ex ? ex.name : "")}</div>
      </div>
    </div>
    <div class="bar-track" style="margin-top:12px;"><div class="bar-fill" style="width:${Math.round((runner.pointer / runner.queue.length) * 100)}%"></div></div>
    ${supersetBadge}
    <div class="card exercise-card">
      <div class="exercise-name">${esc(ex ? ex.name : "")}</div>
      <div class="exercise-with">${withLine}</div>
      <div class="readout-grid">
        <div class="readout">
          <div class="rlabel">Weight</div>
          <div class="rval">${runner.currentWeight}</div>
          <div class="runit">kg</div>
          <div class="stepper">
            <button class="step-btn" onclick="Actions.step('weight',-2.5)">−</button>
            <button class="step-btn" onclick="Actions.step('weight',2.5)">+</button>
          </div>
        </div>
        <div class="readout ${met ? "met" : ""}">
          <div class="rlabel">Reps</div>
          <div class="rval">${runner.currentReps}${met ? '<span class="check">✓</span>' : ""}</div>
          <div class="runit">completed</div>
          <div class="stepper">
            <button class="step-btn" onclick="Actions.step('reps',-1)">−</button>
            <button class="step-btn" onclick="Actions.step('reps',1)">+</button>
          </div>
        </div>
      </div>
      <button class="log-set-btn" onclick="Actions.logCurrentSet()">LOG SET</button>
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
    <div class="session-row">
      <div><div class="s-name">${esc(s.dayName)}</div><div class="s-date">${fmtDate(s.date)}</div></div>
      <div class="s-dur">${fmtHM(s.durationSec)}</div>
    </div>`).join("");

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
// LOG (weight + kcal)
// =========================================================
function adjustWeight(delta) {
  const state = Store.state;
  const today = todayISO();
  const last = state.bodyLog.length ? state.bodyLog[state.bodyLog.length - 1].weightKg : 70;
  const todays = state.bodyLog.find((b) => b.date === today);
  const base = todays ? todays.weightKg : last;
  Store.logWeight(today, Math.max(0, Math.round((base + delta) * 100) / 100));
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
        <polyline points="${poly}" fill="none" stroke="var(--lime)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
        <circle cx="${last[0]}" cy="${last[1]}" r="4" fill="var(--lime)"/>
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
        <button class="step-btn-lg" onclick="Actions.adjustWeight(-0.01)" aria-label="Decrease weight">−</button>
        <div class="stepper-center"><span class="val">${latestWeight ? latestWeight.weightKg : "—"}</span><span class="unit">kg</span></div>
        <button class="step-btn-lg" onclick="Actions.adjustWeight(0.01)" aria-label="Increase weight">+</button>
      </div>
      <div class="stepper-caption">0.01 kg steps · today</div>
      ${weightSpark}
    </div>

    <div class="card log-card">
      <div class="log-card-head"><span class="lc-title">Calories Eaten</span></div>
      <div class="stepper-row">
        <button class="step-btn-lg" onclick="Actions.adjustKcal(-50)" aria-label="Decrease calories">−</button>
        <div class="stepper-center"><span class="val">${(latestKcal ? latestKcal.kcal : 0).toLocaleString()}</span><span class="unit">kcal</span></div>
        <button class="step-btn-lg" onclick="Actions.adjustKcal(50)" aria-label="Increase calories">+</button>
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
// BUILD (exercises + program days)
// =========================================================
const buildUi = { editingExerciseId: null, editingDayId: null };

function newExerciseForm() { buildUi.editingExerciseId = "new"; renderBuild(); }
function editExercise(id) { buildUi.editingExerciseId = id; renderBuild(); }
function cancelExerciseForm() { buildUi.editingExerciseId = null; renderBuild(); }
function saveExerciseForm() {
  const name = $("#ef-name").value.trim();
  if (!name) { toast("Give the exercise a name"); return; }
  const id = buildUi.editingExerciseId === "new" ? undefined : buildUi.editingExerciseId;
  Store.upsertExercise({
    id,
    name,
    defaultSets: parseInt($("#ef-sets").value, 10) || 3,
    defaultReps: parseInt($("#ef-reps").value, 10) || 10,
    defaultWeight: parseFloat($("#ef-weight").value) || 0,
    restSec: parseInt($("#ef-rest").value, 10) || 90,
  });
  buildUi.editingExerciseId = null;
  renderBuild();
}
function deleteExercise(id) {
  if (!confirm("Delete this exercise? It will be removed from any training days using it.")) return;
  Store.deleteExercise(id);
  renderBuild();
}

function addDay() {
  const input = $("#new-day-name");
  const name = input.value.trim();
  if (!name) { toast("Name the training day first"); return; }
  const id = Store.upsertDay({ name });
  input.value = "";
  buildUi.editingDayId = id;
  renderBuild();
}
function toggleEditDay(id) { buildUi.editingDayId = buildUi.editingDayId === id ? null : id; renderBuild(); }
function deleteDay(id) {
  if (!confirm("Delete this training day?")) return;
  Store.deleteDay(id);
  if (buildUi.editingDayId === id) buildUi.editingDayId = null;
  renderBuild();
}
function renameDay(id) {
  const name = $(`#day-name-${id}`).value.trim();
  if (name) Store.upsertDay({ id, name });
}
function reorderDay(id, delta) { Store.reorderDay(id, delta); renderBuild(); }
function reorderDayItem(dayId, itemId, delta) { Store.reorderDayItem(dayId, itemId, delta); renderBuild(); }
function removeDayItem(dayId, itemId) { Store.removeDayItem(dayId, itemId); renderBuild(); }

function addDayItem(dayId) {
  const exerciseId = $(`#di-exercise-${dayId}`).value;
  if (!exerciseId) { toast("Pick an exercise to add"); return; }
  const ex = Store.state.exercises[exerciseId];
  Store.addDayItem(dayId, {
    exerciseId,
    sets: parseInt($(`#di-sets-${dayId}`).value, 10) || ex.defaultSets,
    repsTarget: parseInt($(`#di-reps-${dayId}`).value, 10) || ex.defaultReps,
    restSec: parseInt($(`#di-rest-${dayId}`).value, 10) || ex.restSec,
    group: $(`#di-group-${dayId}`).value,
  });
  renderBuild();
}

function onDayItemExerciseChange(dayId) {
  const exerciseId = $(`#di-exercise-${dayId}`).value;
  const ex = Store.state.exercises[exerciseId];
  if (!ex) return;
  $(`#di-sets-${dayId}`).value = ex.defaultSets;
  $(`#di-reps-${dayId}`).value = ex.defaultReps;
  $(`#di-rest-${dayId}`).value = ex.restSec;
}

function renderBuild() {
  const state = Store.state;
  const root = $("#screen-build");

  const editingEx = buildUi.editingExerciseId ? (buildUi.editingExerciseId === "new" ? {} : state.exercises[buildUi.editingExerciseId]) : null;

  const exerciseForm = editingEx !== null ? `
    <div class="list-item">
      <div class="field"><label>Name</label><input type="text" id="ef-name" value="${esc(editingEx.name || "")}" placeholder="e.g. Barbell Bench Press"></div>
      <div class="field-row3" style="margin-top:14px;">
        <div class="field" style="margin-top:0;"><label>Sets</label><input type="text" inputmode="numeric" pattern="[0-9]*" id="ef-sets" value="${editingEx.defaultSets ?? 3}"></div>
        <div class="field" style="margin-top:0;"><label>Reps</label><input type="text" inputmode="numeric" pattern="[0-9]*" id="ef-reps" value="${editingEx.defaultReps ?? 10}"></div>
        <div class="field" style="margin-top:0;"><label>Weight kg</label><input type="text" inputmode="decimal" id="ef-weight" value="${editingEx.defaultWeight ?? 20}"></div>
      </div>
      <div class="field"><label>Rest (seconds)</label><input type="text" inputmode="numeric" pattern="[0-9]*" id="ef-rest" value="${editingEx.restSec ?? 90}"></div>
      <div class="field-row" style="margin-top:16px;">
        <button class="btn-ghost" onclick="Actions.cancelExerciseForm()">Cancel</button>
        <button class="btn-cta" style="font-size:15px; padding:13px 0;" onclick="Actions.saveExerciseForm()">SAVE</button>
      </div>
    </div>` : `<button class="btn-cta add-row" style="font-size:16px; padding:15px 0;" onclick="Actions.newExerciseForm()">+ ADD EXERCISE</button>`;

  const exerciseList = Object.values(state.exercises).sort((a, b) => a.name.localeCompare(b.name)).map((ex) => `
    <div class="list-item">
      <div class="li-head">
        <div>
          <div class="li-title">${esc(ex.name)}</div>
          <div class="li-meta">${ex.defaultSets}×${ex.defaultReps} · ${ex.defaultWeight}kg · ${ex.restSec}s rest</div>
        </div>
        <div class="li-actions">
          <button onclick="Actions.editExercise('${ex.id}')" aria-label="Edit"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg></button>
          <button class="danger" onclick="Actions.deleteExercise('${ex.id}')" aria-label="Delete"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16"/><path d="M6 7V4h12v3M8 7v13h8V7"/></svg></button>
        </div>
      </div>
    </div>`).join("") || `<div class="empty-mini">No exercises yet — add your first above.</div>`;

  const exerciseOptions = Object.values(state.exercises).sort((a, b) => a.name.localeCompare(b.name)).map((ex) => `<option value="${ex.id}">${esc(ex.name)}</option>`).join("");

  const dayList = state.dayOrder.map((id, idx) => {
    const day = state.days[id];
    const open = buildUi.editingDayId === id;
    const itemRows = day.items.map((it, i) => {
      const ex = state.exercises[it.exerciseId];
      const groupBadge = it.group !== "None" ? `<span class="dir-group">${it.group}</span>` : "";
      return `
        <div class="day-item-row">
          <div class="dir-main">
            <div class="dir-name">${groupBadge}${esc(ex ? ex.name : "Unknown")}</div>
            <div class="dir-meta">${it.sets}×${it.repsTarget} · ${it.restSec}s rest</div>
          </div>
          <div class="dir-actions">
            <button onclick="Actions.reorderDayItem('${id}','${it.id}',-1)" aria-label="Move up">↑</button>
            <button onclick="Actions.reorderDayItem('${id}','${it.id}',1)" aria-label="Move down">↓</button>
            <button onclick="Actions.removeDayItem('${id}','${it.id}')" aria-label="Remove">✕</button>
          </div>
        </div>`;
    }).join("") || `<div class="empty-mini">No exercises in this day yet.</div>`;

    const groupOptions = Store.GROUPS.map((g) => `<option value="${g}">${g === "None" ? "No Superset" : "Superset " + g}</option>`).join("");

    const detail = open ? `
      <div style="margin-top:12px;">
        <div class="field"><label>Day Name</label><input type="text" id="day-name-${id}" value="${esc(day.name)}" onchange="Actions.renameDay('${id}')"></div>
        ${itemRows}
        ${exerciseOptions ? `
        <div class="add-row" style="border-top:1px solid var(--line); padding-top:12px; margin-top:12px;">
          <div class="field" style="margin-top:0;"><label>Add Exercise</label><select id="di-exercise-${id}" onchange="Actions.onDayItemExerciseChange('${id}')">${exerciseOptions}</select></div>
          <div class="field-row3" style="margin-top:10px;">
            <div class="field" style="margin-top:0;"><label>Sets</label><input type="text" inputmode="numeric" pattern="[0-9]*" id="di-sets-${id}" value="3"></div>
            <div class="field" style="margin-top:0;"><label>Reps</label><input type="text" inputmode="numeric" pattern="[0-9]*" id="di-reps-${id}" value="10"></div>
            <div class="field" style="margin-top:0;"><label>Rest s</label><input type="text" inputmode="numeric" pattern="[0-9]*" id="di-rest-${id}" value="90"></div>
          </div>
          <div class="field"><label>Group</label><select id="di-group-${id}">${groupOptions}</select></div>
          <button class="btn-cta" style="margin-top:14px; font-size:16px; padding:15px 0;" onclick="Actions.addDayItem('${id}')">+ ADD TO DAY</button>
        </div>` : `<div class="empty-mini">Add an exercise above first, then come back to build this day.</div>`}
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
        <h3>Exercises</h3>
        <p class="sub">Your exercise library. Add one, then use it in as many training days as you like.</p>
        ${exerciseList}
        ${exerciseForm}
      </div>

      <div class="build-section">
        <h3>Training Days</h3>
        <p class="sub">Group exercises into days. Give two exercises the same superset letter to alternate between them.</p>
        ${dayList}
        <div class="new-day-box">
          <div class="field" style="margin-top:0;"><label>New Training Day</label><input type="text" id="new-day-name" placeholder="e.g. Push Day B"></div>
          <button class="btn-cta" style="margin-top:14px; font-size:16px; padding:15px 0;" onclick="Actions.addDay()">+ ADD DAY</button>
        </div>
      </div>

    </div>
  `;
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
  if (!confirm("Erase all workouts, exercises, and logs on this device? This cannot be undone.")) return;
  Store.resetAll();
  renderProfile();
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
}

function setupTabs() {
  $$(".tab").forEach((tab) => tab.addEventListener("click", () => showScreen(tab.dataset.target)));
  $("#btn-profile").addEventListener("click", openProfile);
}

window.Actions = {
  startWorkout, step: stepValue, logCurrentSet, startRest, skipRest, cancelWorkout, goHome: () => showScreen("home"),
  changeMonth,
  adjustWeight, adjustKcal,
  openBuild, closeBuild, openProfile, closeProfile,
  newExerciseForm, editExercise, cancelExerciseForm, saveExerciseForm, deleteExercise,
  addDay, toggleEditDay, deleteDay, renameDay, reorderDay, reorderDayItem, removeDayItem, addDayItem, onDayItemExerciseChange,
  exportData, importData, handleImportFile, resetAll,
  setProgramName, setUserName, setUserHeight,
};

Store.subscribe(renderAll);
setupTabs();
renderAll();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}
