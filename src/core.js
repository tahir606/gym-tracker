// Shared data layer used by both the REST API and the MCP server.

export class AppError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

// Strength score used for PRs: estimated 1RM (Epley). Bodyweight sets (weight 0) rank by reps.
const SCORE = `CASE WHEN s.weight>0 THEN (CASE WHEN s.reps=1 THEN s.weight ELSE s.weight*(1+s.reps/30.0) END) ELSE s.reps/1000.0 END`;
const score = (s) => (s.weight > 0 ? (s.reps === 1 ? s.weight : s.weight * (1 + s.reps / 30)) : s.reps / 1000);
const e1rm = (s) => (s.weight > 0 ? Math.round(score(s) * 10) / 10 : 0);
const round = (n) => Math.round(n * 10) / 10;

const today = () => new Date().toISOString().slice(0, 10);
const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
const num = (v, d = null) => (v === undefined || v === null || v === '' || !Number.isFinite(+v) ? d : +v);
const str = (v, d = '') => (v === undefined || v === null ? d : String(v).trim());

// An ISO timestamp from the client, normalised to UTC; null when missing or unreadable.
function ts(v) {
  if (v === undefined || v === null || v === '') return null;
  const d = new Date(v);
  return isNaN(d) ? null : d.toISOString();
}
const nowIso = () => new Date().toISOString();

function cleanSet(s) {
  const weight = num(s.weight, 0);
  const reps = Math.round(num(s.reps, 0));
  if (weight < 0 || reps < 0) throw new AppError('weight and reps must be zero or more');
  const rpe = num(s.rpe);
  return { weight, reps, rpe, is_warmup: s.warmup || s.is_warmup ? 1 : 0, notes: str(s.notes), logged_at: ts(s.logged_at) };
}

// ---------- settings ----------
export async function getSettings(db) {
  const { results } = await db.prepare('SELECT key, value FROM settings').all();
  const out = Object.fromEntries(results.map((r) => [r.key, r.value]));
  if (out.workout_names !== undefined) out.workout_names = JSON.parse(out.workout_names);
  return out;
}

export async function setSettings(db, patch) {
  if (patch.unit !== undefined) {
    if (!['kg', 'lb'].includes(patch.unit)) throw new AppError('unit must be "kg" or "lb"');
    await db.prepare(`INSERT INTO settings (key,value) VALUES ('unit',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`).bind(patch.unit).run();
  }
  // The user's own list of workout names to pick from (e.g. "Push day", "Legs").
  if (patch.workout_names !== undefined) {
    if (!Array.isArray(patch.workout_names)) throw new AppError('workout_names must be a list of names');
    const names = [...new Set(patch.workout_names.map((n) => str(n)).filter(Boolean))].slice(0, 100);
    await db.prepare(`INSERT INTO settings (key,value) VALUES ('workout_names',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`).bind(JSON.stringify(names)).run();
  }
  return getSettings(db);
}

// ---------- exercises ----------
export async function listExercises(db, { search } = {}) {
  const q = str(search) || null;
  const { results } = await db
    .prepare(
      `SELECT e.id, e.name, e.muscle_group, e.equipment, e.notes, COUNT(s.id) AS set_count, MAX(w.date) AS last_used
       FROM exercises e LEFT JOIN sets s ON s.exercise_id=e.id LEFT JOIN workouts w ON w.id=s.workout_id
       WHERE (? IS NULL OR e.name LIKE '%'||?||'%' OR e.muscle_group LIKE '%'||?||'%')
       GROUP BY e.id ORDER BY e.name COLLATE NOCASE`
    )
    .bind(q, q, q)
    .all();
  // Per exercise: the best set ever (by estimated 1RM, or most reps for bodyweight work) and the last session's sets.
  const { results: sets } = await db
    .prepare(
      `SELECT s.exercise_id, s.workout_id, s.weight, s.reps, s.is_warmup, s.notes, w.date
       FROM sets s JOIN workouts w ON w.id=s.workout_id ORDER BY w.date, w.id, s.id`
    )
    .all();
  const by = new Map();
  for (const s of sets) {
    if (!by.has(s.exercise_id)) by.set(s.exercise_id, []);
    by.get(s.exercise_id).push(s);
  }
  for (const e of results) {
    const list = by.get(e.id);
    e.pr = null;
    e.last = null;
    if (!list) continue;
    const rec = recordsFor(list);
    const best = rec.best_e1rm || rec.most_reps;
    if (best) e.pr = { weight: best.weight, reps: best.reps, date: best.date, unit: best.unit };
    const lastId = list.at(-1).workout_id;
    const lastSets = list.filter((s) => s.workout_id === lastId);
    e.last = {
      workout_id: lastId,
      date: list.at(-1).date,
      sets: lastSets.map((s) => ({ weight: s.weight, reps: s.reps, is_warmup: s.is_warmup, notes: s.notes })),
    };
  }
  return results;
}

export async function createExercise(db, data) {
  const name = str(data.name);
  if (!name) throw new AppError('Exercise name is required');
  const existing = await db.prepare('SELECT id FROM exercises WHERE name=? COLLATE NOCASE').bind(name).first();
  if (existing) throw new AppError(`Exercise "${name}" already exists`, 409);
  const r = await db
    .prepare('INSERT INTO exercises (name, muscle_group, equipment, notes) VALUES (?,?,?,?)')
    .bind(name, str(data.muscle_group, 'Other') || 'Other', str(data.equipment, 'Other') || 'Other', str(data.notes))
    .run();
  return db.prepare('SELECT * FROM exercises WHERE id=?').bind(r.meta.last_row_id).first();
}

export async function updateExercise(db, id, data) {
  const ex = await db.prepare('SELECT * FROM exercises WHERE id=?').bind(id).first();
  if (!ex) throw new AppError('Exercise not found', 404);
  const name = data.name !== undefined ? str(data.name) : ex.name;
  if (!name) throw new AppError('Exercise name is required');
  const clash = await db.prepare('SELECT id FROM exercises WHERE name=? COLLATE NOCASE AND id<>?').bind(name, id).first();
  if (clash) throw new AppError(`Exercise "${name}" already exists`, 409);
  await db
    .prepare('UPDATE exercises SET name=?, muscle_group=?, equipment=?, notes=? WHERE id=?')
    .bind(
      name,
      data.muscle_group !== undefined ? str(data.muscle_group) || 'Other' : ex.muscle_group,
      data.equipment !== undefined ? str(data.equipment) || 'Other' : ex.equipment,
      data.notes !== undefined ? str(data.notes) : ex.notes,
      id
    )
    .run();
  return db.prepare('SELECT * FROM exercises WHERE id=?').bind(id).first();
}

export async function deleteExercise(db, id) {
  await db.batch([
    db.prepare('DELETE FROM sets WHERE exercise_id=?').bind(id),
    db.prepare('DELETE FROM workout_exercises WHERE exercise_id=?').bind(id),
    db.prepare('DELETE FROM exercises WHERE id=?').bind(id),
  ]);
  return { deleted: true };
}

// Accepts an id or a name. Unknown names are created so agents can log freely.
async function resolveExercise(db, ref) {
  if (ref === undefined || ref === null || ref === '') throw new AppError('Exercise is required');
  if (typeof ref === 'number' || /^\d+$/.test(String(ref))) {
    const ex = await db.prepare('SELECT * FROM exercises WHERE id=?').bind(+ref).first();
    if (!ex) throw new AppError(`Exercise id ${ref} not found`, 404);
    return ex;
  }
  const name = str(ref);
  const ex = await db.prepare('SELECT * FROM exercises WHERE name=? COLLATE NOCASE').bind(name).first();
  return ex || createExercise(db, { name });
}

export async function getExercise(db, ref, { limit = 50 } = {}) {
  let ex;
  if (typeof ref === 'number' || /^\d+$/.test(String(ref))) ex = await db.prepare('SELECT * FROM exercises WHERE id=?').bind(+ref).first();
  else ex = await db.prepare('SELECT * FROM exercises WHERE name=? COLLATE NOCASE').bind(str(ref)).first();
  if (!ex) throw new AppError(`Exercise "${ref}" not found`, 404);
  const { results } = await db
    .prepare(
      `SELECT s.id, s.workout_id, s.weight, s.reps, s.rpe, s.is_warmup, s.notes, w.date, w.name AS workout_name
       FROM sets s JOIN workouts w ON w.id=s.workout_id WHERE s.exercise_id=? ORDER BY w.date DESC, w.id DESC, s.id`
    )
    .bind(ex.id)
    .all();
  const sessions = [];
  for (const s of results) {
    let cur = sessions[sessions.length - 1];
    if (!cur || cur.workout_id !== s.workout_id) {
      cur = { workout_id: s.workout_id, date: s.date, workout_name: s.workout_name, sets: [], best_e1rm: 0, top_weight: 0, volume: 0 };
      sessions.push(cur);
    }
    cur.sets.push({ id: s.id, weight: s.weight, reps: s.reps, rpe: s.rpe, is_warmup: s.is_warmup, notes: s.notes });
    if (!s.is_warmup) {
      cur.best_e1rm = Math.max(cur.best_e1rm, e1rm(s));
      cur.top_weight = Math.max(cur.top_weight, s.weight);
      cur.volume = round(cur.volume + s.weight * s.reps);
    }
  }
  return { exercise: ex, records: recordsFor(results), total_sessions: sessions.length, sessions: sessions.slice(0, limit) };
}

function recordsFor(sets) {
  const rec = { best_e1rm: null, heaviest: null, most_reps: null, best_volume_set: null };
  for (const s of sets) {
    if (s.is_warmup) continue;
    const entry = { weight: s.weight, reps: s.reps, date: s.date, unit: /^plates\b/.test(s.notes || '') ? 'plates' : null };
    const better = (cur, val, tie) => !cur || val > cur.value || (val === cur.value && tie > (cur.tie ?? 0));
    if (s.weight > 0 && better(rec.best_e1rm, e1rm(s), 0)) rec.best_e1rm = { value: e1rm(s), ...entry };
    if (s.weight > 0 && better(rec.heaviest, s.weight, s.reps)) rec.heaviest = { value: s.weight, tie: s.reps, ...entry };
    if (better(rec.most_reps, s.reps, s.weight)) rec.most_reps = { value: s.reps, tie: s.weight, ...entry };
    if (s.weight > 0 && better(rec.best_volume_set, s.weight * s.reps, 0)) rec.best_volume_set = { value: round(s.weight * s.reps), ...entry };
  }
  for (const k of Object.keys(rec)) if (rec[k]) delete rec[k].tie;
  return rec;
}

// ---------- personal records ----------
export async function getPRs(db) {
  const { results } = await db
    .prepare(
      `SELECT s.exercise_id, e.name, e.muscle_group, s.weight, s.reps, s.is_warmup, s.notes, w.date
       FROM sets s JOIN workouts w ON w.id=s.workout_id JOIN exercises e ON e.id=s.exercise_id
       WHERE s.is_warmup=0 ORDER BY w.date, w.id, s.id`
    )
    .all();
  const by = new Map();
  for (const s of results) {
    if (!by.has(s.exercise_id)) by.set(s.exercise_id, { exercise_id: s.exercise_id, name: s.name, muscle_group: s.muscle_group, sets: [] });
    by.get(s.exercise_id).sets.push(s);
  }
  return [...by.values()]
    .map(({ sets, ...ex }) => {
      const records = recordsFor(sets);
      const last_pr_date = (records.best_e1rm || records.most_reps)?.date || null;
      return { ...ex, ...records, last_pr_date };
    })
    .sort((a, b) => (b.last_pr_date || '').localeCompare(a.last_pr_date || '') || a.name.localeCompare(b.name));
}

// ---------- workouts ----------
export async function listWorkouts(db, { limit = 30, offset = 0, from, to } = {}) {
  const f = isDate(from) ? from : null;
  const t = isDate(to) ? to : null;
  const { results } = await db
    .prepare(
      `SELECT w.id, w.date, w.name, w.notes, COUNT(s.id) AS set_count,
         COALESCE(SUM(CASE WHEN s.is_warmup=0 THEN s.weight*s.reps END),0) AS volume,
         (SELECT GROUP_CONCAT(n, ', ') FROM (SELECT e.name AS n FROM sets s2 JOIN exercises e ON e.id=s2.exercise_id
            WHERE s2.workout_id=w.id GROUP BY e.id ORDER BY MIN(s2.id))) AS exercises
       FROM workouts w LEFT JOIN sets s ON s.workout_id=w.id
       WHERE (? IS NULL OR w.date>=?) AND (? IS NULL OR w.date<=?)
       GROUP BY w.id ORDER BY w.date DESC, w.id DESC LIMIT ? OFFSET ?`
    )
    .bind(f, f, t, t, Math.min(Math.max(num(limit, 30), 1), 500), Math.max(num(offset, 0), 0))
    .all();
  return results.map((w) => ({ ...w, volume: round(w.volume) }));
}

export async function getWorkout(db, id, extraExerciseIds = []) {
  const w = await db.prepare('SELECT id, date, name, notes, started_at, finished_at FROM workouts WHERE id=?').bind(id).first();
  if (!w) throw new AppError('Workout not found', 404);
  const { results: sets } = await db
    .prepare(
      `SELECT s.id, s.exercise_id, s.weight, s.reps, s.rpe, s.is_warmup, s.notes, s.logged_at, e.name, e.muscle_group, we.added_at
       FROM sets s JOIN exercises e ON e.id=s.exercise_id
       LEFT JOIN workout_exercises we ON we.workout_id=s.workout_id AND we.exercise_id=s.exercise_id
       WHERE s.workout_id=? ORDER BY s.id`
    )
    .bind(id)
    .all();
  const exIds = [...new Set([...sets.map((s) => s.exercise_id), ...extraExerciseIds.map(Number).filter(Boolean)])];
  const previous = {};
  const best = {};
  if (exIds.length) {
    const before = `(w.date<? OR (w.date=? AND w.id<?))`;
    const prevStmt = db.prepare(
      `SELECT s.workout_id, s.weight, s.reps, s.is_warmup, s.notes, w.date FROM sets s JOIN workouts w ON w.id=s.workout_id
       WHERE s.exercise_id=? AND ${before} ORDER BY w.date DESC, w.id DESC, s.id LIMIT 40`
    );
    const bestStmt = db.prepare(
      `SELECT MAX(${SCORE}) AS best FROM sets s JOIN workouts w ON w.id=s.workout_id WHERE s.is_warmup=0 AND s.exercise_id=? AND ${before}`
    );
    const res = await db.batch(exIds.flatMap((e) => [prevStmt.bind(e, w.date, w.date, id), bestStmt.bind(e, w.date, w.date, id)]));
    exIds.forEach((e, i) => {
      const rows = res[i * 2].results;
      if (rows.length) {
        const first = rows[0].workout_id;
        previous[e] = {
          date: rows[0].date,
          sets: rows.filter((r) => r.workout_id === first).map((r) => ({ weight: r.weight, reps: r.reps, is_warmup: r.is_warmup, notes: r.notes })),
        };
      }
      best[e] = res[i * 2 + 1].results[0]?.best ?? null;
    });
  }
  const exercises = [];
  let volume = 0;
  for (const s of sets) {
    let ex = exercises.find((x) => x.exercise_id === s.exercise_id);
    if (!ex) exercises.push((ex = { exercise_id: s.exercise_id, name: s.name, muscle_group: s.muscle_group, added_at: s.added_at || null, sets: [] }));
    let is_pr = false;
    if (!s.is_warmup) {
      volume += s.weight * s.reps;
      const sc = score(s);
      // Only flag a PR when there is earlier history to beat.
      if (best[s.exercise_id] !== null && sc > best[s.exercise_id] + 1e-9) {
        is_pr = true;
        best[s.exercise_id] = sc;
      }
    }
    ex.sets.push({ id: s.id, weight: s.weight, reps: s.reps, rpe: s.rpe, is_warmup: s.is_warmup, notes: s.notes, logged_at: s.logged_at, e1rm: e1rm(s), is_pr });
  }
  return { ...w, set_count: sets.length, volume: round(volume), exercises, previous };
}

// addedAt: when the exercise was added to the workout; kept from the first time it is sent.
async function insertSets(db, workoutId, exerciseId, sets, addedAt) {
  if (!Array.isArray(sets) || !sets.length) return;
  const clean = sets.map(cleanSet).map((s) => ({ ...s, logged_at: s.logged_at || nowIso() }));
  const stmt = db.prepare('INSERT INTO sets (workout_id, exercise_id, weight, reps, rpe, is_warmup, notes, logged_at) VALUES (?,?,?,?,?,?,?,?)');
  await db.batch([
    db.prepare('INSERT OR IGNORE INTO workout_exercises (workout_id, exercise_id, added_at) VALUES (?,?,?)').bind(workoutId, exerciseId, ts(addedAt) || clean[0].logged_at),
    ...clean.map((s) => stmt.bind(workoutId, exerciseId, s.weight, s.reps, s.rpe, s.is_warmup, s.notes, s.logged_at)),
  ]);
}

export async function createWorkout(db, data = {}) {
  const date = data.date ? data.date : today();
  if (!isDate(date)) throw new AppError('date must be YYYY-MM-DD');
  // Resolve every exercise first so a bad reference does not leave a half-written workout.
  const blocks = [];
  for (const b of data.exercises || []) {
    blocks.push({ ex: await resolveExercise(db, b.exercise_id ?? b.exercise ?? b.name), sets: b.sets || [], added_at: b.added_at });
    blocks.at(-1).sets.forEach(cleanSet); // validate before writing anything
  }
  const r = await db
    .prepare('INSERT INTO workouts (date, name, notes, started_at, finished_at) VALUES (?,?,?,?,?)')
    .bind(date, str(data.name) || 'Workout', str(data.notes), ts(data.started_at) || nowIso(), ts(data.finished_at))
    .run();
  const id = r.meta.last_row_id;
  for (const b of blocks) await insertSets(db, id, b.ex.id, b.sets, b.added_at);
  return getWorkout(db, id);
}

export async function updateWorkout(db, id, data) {
  const w = await db.prepare('SELECT * FROM workouts WHERE id=?').bind(id).first();
  if (!w) throw new AppError('Workout not found', 404);
  if (data.date !== undefined && !isDate(data.date)) throw new AppError('date must be YYYY-MM-DD');
  await db
    .prepare('UPDATE workouts SET date=?, name=?, notes=?, started_at=?, finished_at=? WHERE id=?')
    .bind(
      data.date ?? w.date,
      data.name !== undefined ? str(data.name) || 'Workout' : w.name,
      data.notes !== undefined ? str(data.notes) : w.notes,
      data.started_at !== undefined ? ts(data.started_at) : w.started_at,
      data.finished_at !== undefined ? ts(data.finished_at) : w.finished_at,
      id
    )
    .run();
  return getWorkout(db, id);
}

export async function deleteWorkout(db, id) {
  await db.batch([
    db.prepare('DELETE FROM sets WHERE workout_id=?').bind(id),
    db.prepare('DELETE FROM workout_exercises WHERE workout_id=?').bind(id),
    db.prepare('DELETE FROM workouts WHERE id=?').bind(id),
  ]);
  return { deleted: true };
}

export async function addSets(db, workoutId, data) {
  const w = await db.prepare('SELECT id FROM workouts WHERE id=?').bind(workoutId).first();
  if (!w) throw new AppError('Workout not found', 404);
  const ex = await resolveExercise(db, data.exercise_id ?? data.exercise ?? data.name);
  const sets = data.sets || [data];
  await insertSets(db, workoutId, ex.id, sets, data.exercise_added_at);
  return getWorkout(db, workoutId);
}

export async function updateSet(db, id, data) {
  const s = await db.prepare('SELECT * FROM sets WHERE id=?').bind(id).first();
  if (!s) throw new AppError('Set not found', 404);
  const c = cleanSet({
    weight: data.weight ?? s.weight,
    reps: data.reps ?? s.reps,
    rpe: data.rpe !== undefined ? data.rpe : s.rpe,
    is_warmup: data.warmup ?? data.is_warmup ?? s.is_warmup,
    notes: data.notes ?? s.notes,
  });
  await db.prepare('UPDATE sets SET weight=?, reps=?, rpe=?, is_warmup=?, notes=? WHERE id=?').bind(c.weight, c.reps, c.rpe, c.is_warmup, c.notes, id).run();
  return getWorkout(db, s.workout_id);
}

export async function deleteSet(db, id) {
  const s = await db.prepare('SELECT workout_id FROM sets WHERE id=?').bind(id).first();
  if (!s) throw new AppError('Set not found', 404);
  await db.prepare('DELETE FROM sets WHERE id=?').bind(id).run();
  return getWorkout(db, s.workout_id);
}

// ---------- bodyweight ----------
export async function listBodyweight(db, { limit = 365 } = {}) {
  const { results } = await db.prepare('SELECT id, date, weight FROM bodyweight ORDER BY date DESC LIMIT ?').bind(num(limit, 365)).all();
  return results;
}

export async function logBodyweight(db, data) {
  const date = data.date || today();
  if (!isDate(date)) throw new AppError('date must be YYYY-MM-DD');
  const weight = num(data.weight);
  if (!weight || weight <= 0) throw new AppError('weight must be a positive number');
  await db.prepare('INSERT INTO bodyweight (date, weight) VALUES (?,?) ON CONFLICT(date) DO UPDATE SET weight=excluded.weight').bind(date, weight).run();
  return { date, weight };
}

export async function deleteBodyweight(db, id) {
  await db.prepare('DELETE FROM bodyweight WHERE id=?').bind(id).run();
  return { deleted: true };
}

// ---------- stats ----------
const weekStart = (dateStr) => {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); // Monday
  return d.toISOString().slice(0, 10);
};
const addDays = (dateStr, n) => {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

export async function getStats(db, { today: clientToday } = {}) {
  const now = isDate(clientToday) ? clientToday : today();
  const [wk, vol, settings] = await Promise.all([
    db.prepare('SELECT date FROM workouts ORDER BY date').all(),
    db.prepare('SELECT COUNT(*) AS sets, COALESCE(SUM(weight*reps),0) AS volume FROM sets WHERE is_warmup=0').first(),
    getSettings(db),
  ]);
  const dates = wk.results.map((r) => r.date);
  const perWeek = new Map();
  for (const d of dates) perWeek.set(weekStart(d), (perWeek.get(weekStart(d)) || 0) + 1);
  const thisWeek = weekStart(now);
  let streak = 0;
  let cursor = perWeek.has(thisWeek) ? thisWeek : addDays(thisWeek, -7);
  while (perWeek.has(cursor)) {
    streak++;
    cursor = addDays(cursor, -7);
  }
  const weeks = [];
  for (let i = 11; i >= 0; i--) {
    const ws = addDays(thisWeek, -7 * i);
    weeks.push({ week_start: ws, workouts: perWeek.get(ws) || 0 });
  }
  return {
    unit: settings.unit || 'kg',
    total_workouts: dates.length,
    workouts_this_week: perWeek.get(thisWeek) || 0,
    workouts_last_30_days: dates.filter((d) => d > addDays(now, -30)).length,
    week_streak: streak,
    total_sets: vol.sets,
    total_volume: round(vol.volume),
    last_workout_date: dates[dates.length - 1] || null,
    weeks,
  };
}

// ---------- insights ----------
// One pass over every set. `from` narrows the range-based sections; trends are always all-time.
export async function getInsights(db, { from, today: clientToday } = {}) {
  const now = isDate(clientToday) ? clientToday : today();
  const f = isDate(from) ? from : null;
  const [setsR, wkR, bwR, settings] = await Promise.all([
    db
      .prepare(
        `SELECT s.weight, s.reps, s.is_warmup, s.notes, s.exercise_id, e.name, e.muscle_group, e.equipment, w.id AS workout_id, w.date
         FROM sets s JOIN workouts w ON w.id=s.workout_id JOIN exercises e ON e.id=s.exercise_id ORDER BY w.date, w.id, s.id`
      )
      .all(),
    db.prepare('SELECT w.id, w.date, w.name, (SELECT COUNT(*) FROM sets s WHERE s.workout_id=w.id) AS sets FROM workouts w ORDER BY w.date, w.id').all(),
    db.prepare('SELECT date, weight FROM bodyweight ORDER BY date').all(),
    getSettings(db),
  ]);
  const all = setsR.results.filter((s) => !s.is_warmup);
  const workouts = wkR.results;
  const bw = bwR.results;
  const inRange = (d) => !f || d >= f;
  const isPlates = (s) => /^plates\b/.test(s.notes || '');
  const isAssisted = (s) => /assist|spot|support|\bsp\b/i.test(s.notes || '');
  const dayDiff = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
  const bump = (o, k, n = 1) => (o[k] = (o[k] || 0) + n);

  // PR events: a set that beats the best from earlier workouts (same rule the app uses for badges).
  const prState = new Map();
  const prByKey = new Map();
  for (const s of all) {
    const sc = score(s);
    const st = prState.get(s.exercise_id);
    if (!st) prState.set(s.exercise_id, { best: sc, first: s.workout_id });
    else if (s.workout_id === st.first) st.best = Math.max(st.best, sc);
    else if (sc > st.best + 1e-9) {
      st.best = sc;
      prByKey.set(s.exercise_id + '|' + s.date, { date: s.date, exercise_id: s.exercise_id, exercise: s.name, weight: s.weight, reps: s.reps, unit: isPlates(s) ? 'plates' : null });
    }
  }
  const prEvents = [...prByKey.values()].sort((a, b) => a.date.localeCompare(b.date));

  // Monthly trend (all-time).
  const firstDate = workouts[0]?.date || now;
  const months = [];
  const mIdx = {};
  for (let y = +firstDate.slice(0, 4), m = +firstDate.slice(5, 7); months.length < 240; ) {
    const key = `${y}-${String(m).padStart(2, '0')}`;
    mIdx[key] = months.push({ month: key, workouts: 0, sets: 0, volume: 0, prs: 0, assisted_sets: 0, assisted_pct: 0, groups: {} }) - 1;
    if (key >= now.slice(0, 7)) break;
    if (++m > 12) { m = 1; y++; }
  }
  const mOf = (d) => months[mIdx[d.slice(0, 7)]];
  for (const w of workouts) if (mOf(w.date)) mOf(w.date).workouts++;
  for (const p of prEvents) if (mOf(p.date)) mOf(p.date).prs++;
  for (const s of all) {
    const m = mOf(s.date);
    if (!m) continue;
    m.sets++;
    if (!isPlates(s)) m.volume += s.weight * s.reps;
    if (isAssisted(s)) m.assisted_sets++;
    bump(m.groups, s.muscle_group);
  }
  for (const m of months) { m.volume = Math.round(m.volume); m.assisted_pct = m.sets ? Math.round((m.assisted_sets / m.sets) * 100) : 0; }

  // Range-based breakdowns.
  const wR = workouts.filter((w) => inRange(w.date));
  const sR = all.filter((s) => inRange(s.date));
  const weekdays = [0, 0, 0, 0, 0, 0, 0];
  const splitCount = {};
  for (const w of wR) {
    weekdays[(new Date(w.date + 'T00:00:00Z').getUTCDay() + 6) % 7]++;
    bump(splitCount, w.name);
  }
  const groupMap = {};
  const equipCount = {};
  const repBuckets = [['1-5', 5], ['6-8', 8], ['9-12', 12], ['13-15', 15], ['16-20', 20], ['21+', Infinity]].map(([bucket, max]) => ({ bucket, max, sets: 0 }));
  const exMap = new Map();
  let volume = 0;
  for (const s of sR) {
    const g = (groupMap[s.muscle_group] ||= { group: s.muscle_group, sets: 0, ex: new Set() });
    g.sets++;
    g.ex.add(s.exercise_id);
    bump(equipCount, s.equipment);
    if (s.reps > 0) repBuckets.find((b) => s.reps <= b.max).sets++;
    if (!isPlates(s)) volume += s.weight * s.reps;
    const e = exMap.get(s.exercise_id) || { exercise_id: s.exercise_id, name: s.name, group: s.muscle_group, w: new Set(), sets: 0 };
    e.sets++;
    e.w.add(s.workout_id);
    exMap.set(s.exercise_id, e);
  }
  const lastByGroup = {};
  for (const s of all) lastByGroup[s.muscle_group] = s.date;
  const groups = Object.keys(lastByGroup)
    .map((g) => ({ group: g, sets: groupMap[g]?.sets || 0, exercises: groupMap[g]?.ex.size || 0, last_date: lastByGroup[g], days_since: Math.max(0, dayDiff(lastByGroup[g], now)) }))
    .sort((a, b) => b.sets - a.sets);

  // Consistency.
  const weeks = [...new Set(wR.map((w) => weekStart(w.date)))].sort();
  let longest = 0, run = 0, prev = null;
  for (const wk of weeks) {
    run = prev && addDays(prev, 7) === wk ? run + 1 : 1;
    longest = Math.max(longest, run);
    prev = wk;
  }
  let gap = { days: 0, from: null, to: null };
  for (let i = 1; i < wR.length; i++) {
    const d = dayDiff(wR[i - 1].date, wR[i].date);
    if (d > gap.days) gap = { days: d, from: wR[i - 1].date, to: wR[i].date };
  }
  const rangeStart = f || wR[0]?.date || now;
  const totalWeeks = Math.max(1, Math.ceil((dayDiff(rangeStart, now) + 1) / 7));

  // Per-exercise progress (all-time): top working weight per session.
  // Exercises logged in both kg and plate counts are compared in whichever unit they mostly use.
  const unitCount = new Map();
  for (const s of all) {
    if (!(s.weight > 0)) continue;
    const c = unitCount.get(s.exercise_id) || { plates: 0, kg: 0 };
    c[isPlates(s) ? 'plates' : 'kg']++;
    unitCount.set(s.exercise_id, c);
  }
  const prog = new Map();
  for (const s of all) {
    if (!(s.weight > 0)) continue;
    const c = unitCount.get(s.exercise_id);
    const plates = c.plates > c.kg;
    if (isPlates(s) !== plates) continue;
    const p = prog.get(s.exercise_id) || { exercise_id: s.exercise_id, name: s.name, group: s.muscle_group, plates, by: new Map() };
    const cur = p.by.get(s.workout_id);
    if (!cur || s.weight > cur.top) p.by.set(s.workout_id, { date: s.date, top: s.weight });
    prog.set(s.exercise_id, p);
  }
  const progress = [...prog.values()]
    .filter((p) => p.by.size >= 3)
    .map((p) => {
      const points = [...p.by.values()];
      const first = points[0].top, latest = points[points.length - 1].top;
      return {
        exercise_id: p.exercise_id, name: p.name, group: p.group, unit: p.plates ? 'plates' : null, sessions: points.length,
        first, latest, best: Math.max(...points.map((x) => x.top)), change_pct: Math.round(((latest - first) / first) * 100), points,
      };
    })
    .sort((a, b) => b.sessions - a.sessions);

  // Body weight with a trailing 5-entry average.
  const bwPoints = bw.map((b, i) => {
    const win = bw.slice(Math.max(0, i - 4), i + 1);
    return { date: b.date, weight: b.weight, avg: Math.round((win.reduce((n, x) => n + x.weight, 0) / win.length) * 100) / 100 };
  });
  const bwLast = bw[bw.length - 1];
  const bw30 = bwLast && [...bw].reverse().find((b) => b.date <= addDays(bwLast.date, -30));
  const r2 = (n) => Math.round(n * 100) / 100;

  return {
    unit: settings.unit || 'kg',
    range: { from: f, to: now },
    summary: {
      all_time_workouts: workouts.length,
      workouts: wR.length,
      sets: sR.length,
      exercises_used: exMap.size,
      volume: Math.round(volume),
      avg_per_week: Math.round((wR.length / totalWeeks) * 10) / 10,
      active_weeks: weeks.length,
      total_weeks: totalWeeks,
      longest_week_streak: longest,
      longest_gap_days: gap.days,
      longest_gap_from: gap.from,
      longest_gap_to: gap.to,
      prs: prEvents.filter((p) => inRange(p.date)).length,
      first_date: wR[0]?.date || null,
      last_date: wR[wR.length - 1]?.date || null,
    },
    calendar: workouts.map((w) => ({ date: w.date, name: w.name, sets: w.sets })),
    months,
    weekdays,
    splits: Object.entries(splitCount).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
    groups,
    equipment: Object.entries(equipCount).map(([equipment, sets]) => ({ equipment, sets })).sort((a, b) => b.sets - a.sets),
    reps: repBuckets.map(({ bucket, sets }) => ({ bucket, sets })),
    top_exercises: [...exMap.values()].map(({ w, ...e }) => ({ ...e, sessions: w.size })).sort((a, b) => b.sessions - a.sessions || b.sets - a.sets).slice(0, 10),
    progress,
    recent_prs: prEvents.slice(-12).reverse(),
    bodyweight: bw.length
      ? {
          points: bwPoints, start: bw[0].weight, start_date: bw[0].date, latest: bwLast.weight, latest_date: bwLast.date,
          min: Math.min(...bw.map((b) => b.weight)), max: Math.max(...bw.map((b) => b.weight)),
          change: r2(bwLast.weight - bw[0].weight), change_30d: bw30 ? r2(bwLast.weight - bw30.weight) : null,
        }
      : null,
  };
}
