const KEY = "iron:v1";

const GROUPS = ["None", "A", "B", "C", "D", "E", "F"];

function uid() {
  return (crypto.randomUUID ? crypto.randomUUID() : "id-" + Date.now() + "-" + Math.random().toString(16).slice(2));
}

function defaultState() {
  return {
    userName: "",
    userHeightCm: null,
    exercises: {},
    days: {},
    dayOrder: [],
    programName: "",
    sessions: [],
    bodyLog: [],
    kcalLog: [],
  };
}

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw);
    return { ...defaultState(), ...parsed };
  } catch (e) {
    console.error("Failed to load state", e);
    return defaultState();
  }
}

let state = load();
const listeners = new Set();

function save() {
  localStorage.setItem(KEY, JSON.stringify(state));
  listeners.forEach((fn) => fn(state));
}

export const Store = {
  GROUPS,

  get state() { return state; },
  subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },

  // ---- profile ----
  setUserName(name) { state.userName = name; save(); },
  setUserHeight(cm) { state.userHeightCm = cm; save(); },

  // ---- exercises ----
  upsertExercise(ex) {
    const id = ex.id || uid();
    state.exercises[id] = { id, name: ex.name, defaultSets: ex.defaultSets, defaultReps: ex.defaultReps, defaultWeight: ex.defaultWeight, restSec: ex.restSec };
    save();
    return id;
  },
  deleteExercise(id) {
    delete state.exercises[id];
    Object.values(state.days).forEach((d) => { d.items = d.items.filter((it) => it.exerciseId !== id); });
    save();
  },

  // ---- days / program ----
  upsertDay(day) {
    const id = day.id || uid();
    const existing = state.days[id];
    state.days[id] = { id, name: day.name, items: existing ? existing.items : [] };
    if (!existing) state.dayOrder.push(id);
    save();
    return id;
  },
  deleteDay(id) {
    delete state.days[id];
    state.dayOrder = state.dayOrder.filter((d) => d !== id);
    save();
  },
  reorderDay(id, delta) {
    const i = state.dayOrder.indexOf(id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= state.dayOrder.length) return;
    [state.dayOrder[i], state.dayOrder[j]] = [state.dayOrder[j], state.dayOrder[i]];
    save();
  },
  addDayItem(dayId, item) {
    const day = state.days[dayId];
    if (!day) return;
    day.items.push({ id: uid(), exerciseId: item.exerciseId, sets: item.sets, repsTarget: item.repsTarget, restSec: item.restSec, group: item.group || "None" });
    save();
  },
  removeDayItem(dayId, itemId) {
    const day = state.days[dayId];
    if (!day) return;
    day.items = day.items.filter((it) => it.id !== itemId);
    save();
  },
  updateDayItem(dayId, itemId, patch) {
    const day = state.days[dayId];
    const item = day && day.items.find((it) => it.id === itemId);
    if (!item) return;
    Object.assign(item, patch);
    save();
  },
  reorderDayItem(dayId, itemId, delta) {
    const day = state.days[dayId];
    if (!day) return;
    const i = day.items.findIndex((it) => it.id === itemId);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= day.items.length) return;
    [day.items[i], day.items[j]] = [day.items[j], day.items[i]];
    save();
  },
  setProgramName(name) { state.programName = name; save(); },

  // ---- sessions ----
  saveSession(session) {
    state.sessions.push(session);
    save();
  },
  lastWeightFor(exerciseId) {
    for (let i = state.sessions.length - 1; i >= 0; i--) {
      const s = state.sessions[i];
      const entry = s.entries.find((e) => e.exerciseId === exerciseId);
      if (entry && entry.sets.length) return entry.sets[entry.sets.length - 1].weight;
    }
    return null;
  },

  // ---- body / kcal ----
  logWeight(dateISO, kg) {
    const existing = state.bodyLog.find((b) => b.date === dateISO);
    if (existing) existing.weightKg = kg;
    else state.bodyLog.push({ date: dateISO, weightKg: kg });
    state.bodyLog.sort((a, b) => a.date.localeCompare(b.date));
    save();
  },
  logKcal(dateISO, kcal) {
    const existing = state.kcalLog.find((k) => k.date === dateISO);
    if (existing) existing.kcal = kcal;
    else state.kcalLog.push({ date: dateISO, kcal });
    state.kcalLog.sort((a, b) => a.date.localeCompare(b.date));
    save();
  },

  // ---- data mgmt ----
  exportJSON() { return JSON.stringify(state, null, 2); },
  importJSON(json) {
    const parsed = JSON.parse(json);
    state = { ...defaultState(), ...parsed };
    save();
  },
  resetAll() { state = defaultState(); save(); },

  uid,
};
