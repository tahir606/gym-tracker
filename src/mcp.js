// Minimal MCP server (Streamable HTTP, stateless JSON responses) exposing the gym tracker as tools.
import * as core from './core.js';

const setSchema = {
  type: 'object',
  properties: {
    weight: { type: 'number', description: 'Weight lifted, in the user\'s unit (see get_stats.unit). Use 0 for bodyweight.' },
    reps: { type: 'integer' },
    rpe: { type: 'number', description: 'Optional rate of perceived exertion, 1-10' },
    warmup: { type: 'boolean', description: 'Warm-up sets are excluded from PRs and volume' },
    notes: { type: 'string' },
    logged_at: { type: 'string', description: 'Optional ISO-8601 time the set was done; defaults to now' },
  },
  required: ['weight', 'reps'],
};
const date = { type: 'string', description: 'YYYY-MM-DD. Defaults to today (UTC) - pass it explicitly when you know the user\'s local date.' };
const exerciseRef = { type: 'string', description: 'Exercise name (case-insensitive) or numeric id. Unknown names are created automatically.' };
const obj = (properties, required = []) => ({ type: 'object', properties, required });
const time = (what) => ({ type: 'string', description: `Optional ISO-8601 time ${what}` });

const tools = [
  {
    name: 'log_workout',
    description: 'Create a workout, optionally with all of its exercises and sets in one call. Returns the saved workout with PR flags.',
    inputSchema: obj({
      date,
      name: { type: 'string', description: 'e.g. "Push day"' },
      notes: { type: 'string' },
      started_at: time('the workout started; defaults to now'),
      finished_at: time('the workout finished'),
      exercises: { type: 'array', items: obj({ exercise: exerciseRef, added_at: time('this exercise was started'), sets: { type: 'array', items: setSchema } }, ['exercise', 'sets']) },
    }),
    run: (db, a) => core.createWorkout(db, a),
  },
  {
    name: 'add_sets',
    description: 'Add one or more sets of an exercise to an existing workout.',
    inputSchema: obj({ workout_id: { type: 'integer' }, exercise: exerciseRef, exercise_added_at: time('this exercise was started in the workout'), sets: { type: 'array', items: setSchema } }, ['workout_id', 'exercise', 'sets']),
    run: (db, a) => core.addSets(db, a.workout_id, a),
  },
  {
    name: 'list_workouts',
    description: 'List workouts, newest first, with exercise names, set count and volume.',
    inputSchema: obj({ limit: { type: 'integer', description: 'Default 30' }, offset: { type: 'integer' }, from: date, to: date }),
    run: (db, a) => core.listWorkouts(db, a),
  },
  {
    name: 'get_workout',
    description: 'Get one workout with every set, grouped by exercise, including PR flags and what was done the previous time.',
    inputSchema: obj({ workout_id: { type: 'integer' } }, ['workout_id']),
    run: (db, a) => core.getWorkout(db, a.workout_id),
  },
  {
    name: 'update_workout',
    description: 'Change a workout\'s name, date, notes, or start/finish times.',
    inputSchema: obj({ workout_id: { type: 'integer' }, name: { type: 'string' }, date, notes: { type: 'string' }, started_at: time('the workout started'), finished_at: time('the workout finished') }, ['workout_id']),
    run: (db, a) => core.updateWorkout(db, a.workout_id, a),
  },
  {
    name: 'delete_workout',
    description: 'Permanently delete a workout and all of its sets.',
    inputSchema: obj({ workout_id: { type: 'integer' } }, ['workout_id']),
    run: (db, a) => core.deleteWorkout(db, a.workout_id),
  },
  {
    name: 'update_set',
    description: 'Edit a logged set (ids come from get_workout).',
    inputSchema: obj({ set_id: { type: 'integer' }, ...setSchema.properties }, ['set_id']),
    run: (db, a) => core.updateSet(db, a.set_id, a),
  },
  {
    name: 'delete_set',
    description: 'Delete a logged set.',
    inputSchema: obj({ set_id: { type: 'integer' } }, ['set_id']),
    run: (db, a) => core.deleteSet(db, a.set_id),
  },
  {
    name: 'list_exercises',
    description: 'List the exercise library with usage counts. Optional search by name or muscle group.',
    inputSchema: obj({ search: { type: 'string' } }),
    run: (db, a) => core.listExercises(db, a),
  },
  {
    name: 'create_exercise',
    description: 'Add an exercise to the library.',
    inputSchema: obj(
      {
        name: { type: 'string' },
        muscle_group: { type: 'string', description: 'Chest, Back, Shoulders, Arms, Legs, Core, Cardio or Other' },
        equipment: { type: 'string', description: 'Barbell, Dumbbell, Machine, Cable, Bodyweight, Kettlebell or Other' },
        notes: { type: 'string' },
      },
      ['name']
    ),
    run: (db, a) => core.createExercise(db, a),
  },
  {
    name: 'get_exercise_history',
    description: 'History for one exercise: personal records plus every session (sets, best estimated 1RM, top weight, volume), newest first.',
    inputSchema: obj({ exercise: exerciseRef, limit: { type: 'integer', description: 'Max sessions, default 20' } }, ['exercise']),
    run: (db, a) => core.getExercise(db, a.exercise, { limit: a.limit || 20 }),
  },
  {
    name: 'get_personal_records',
    description: 'Personal records for every exercise: best estimated 1RM, heaviest weight, most reps, best single-set volume.',
    inputSchema: obj({}),
    run: (db) => core.getPRs(db),
  },
  {
    name: 'get_stats',
    description: 'Overview: weight unit, total workouts, this week, weekly streak, total volume, workouts per week for the last 12 weeks.',
    inputSchema: obj({ today: date }),
    run: (db, a) => core.getStats(db, a),
  },
  {
    name: 'get_insights',
    description:
      'Full training analysis: consistency (per week, streaks, longest break), monthly trend (workouts, sets, volume, PRs, assisted share, sets per muscle group), weekday and split breakdown, muscle group and equipment balance, rep ranges, most-used exercises, per-exercise progress (first/best/latest top weight), recent PRs and body weight trend. `from` limits the breakdown sections to a date range; trends are always all-time.',
    inputSchema: obj({ from: { type: 'string', description: 'YYYY-MM-DD start of the range for breakdowns (omit for all time)' }, today: date }),
    run: (db, a) => core.getInsights(db, a),
  },
  {
    name: 'log_bodyweight',
    description: 'Record body weight for a date (one entry per date; logging again overwrites).',
    inputSchema: obj({ weight: { type: 'number' }, date }, ['weight']),
    run: (db, a) => core.logBodyweight(db, a),
  },
  {
    name: 'get_bodyweight',
    description: 'Body weight entries, newest first.',
    inputSchema: obj({ limit: { type: 'integer' } }),
    run: (db, a) => core.listBodyweight(db, a),
  },
];

async function handle(msg, db) {
  const { id, method, params } = msg;
  const ok = (result) => ({ jsonrpc: '2.0', id, result });
  const fail = (code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });
  if (id === undefined || id === null) return null; // notification
  switch (method) {
    case 'initialize':
      return ok({
        protocolVersion: params?.protocolVersion || '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'gym-tracker', version: '1.0.0' },
        instructions:
          'Personal gym log. Weights are plain numbers in the unit reported by get_stats. Use log_workout to record a session, get_exercise_history / get_personal_records to review progress.',
      });
    case 'ping':
      return ok({});
    case 'tools/list':
      return ok({ tools: tools.map(({ run, ...t }) => t) });
    case 'tools/call': {
      const tool = tools.find((t) => t.name === params?.name);
      if (!tool) return fail(-32602, `Unknown tool: ${params?.name}`);
      try {
        const result = await tool.run(db, params.arguments || {});
        return ok({ content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] });
      } catch (e) {
        if (!(e instanceof core.AppError)) console.error(e);
        return ok({ content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true });
      }
    }
    default:
      return fail(-32601, `Method not found: ${method}`);
  }
}

export async function handleMcp(request, db) {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: { Allow: 'POST' } });
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, { status: 400 });
  }
  if (Array.isArray(body)) {
    const out = (await Promise.all(body.map((m) => handle(m, db)))).filter(Boolean);
    return out.length ? Response.json(out) : new Response(null, { status: 202 });
  }
  const res = await handle(body, db);
  return res ? Response.json(res) : new Response(null, { status: 202 });
}
