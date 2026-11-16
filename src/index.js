import * as core from './core.js';
import { handleMcp } from './mcp.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization,Content-Type,Mcp-Session-Id,Mcp-Protocol-Version',
};

function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const json = (data, status = 200) => Response.json(data, { status, headers: CORS });

async function api(request, url, db) {
  const m = request.method;
  const p = url.pathname.replace(/\/+$/, '');
  const q = Object.fromEntries(url.searchParams);
  const body = ['POST', 'PUT', 'PATCH'].includes(m) ? await request.json().catch(() => ({})) : {};
  let r;

  if (p === '/api/settings') return m === 'GET' ? core.getSettings(db) : core.setSettings(db, body);
  if (p === '/api/stats') return core.getStats(db, q);
  if (p === '/api/prs') return core.getPRs(db);
  if (p === '/api/insights') return core.getInsights(db, q);

  if (p === '/api/exercises') return m === 'POST' ? core.createExercise(db, body) : core.listExercises(db, q);
  if ((r = p.match(/^\/api\/exercises\/(\d+)$/))) {
    if (m === 'GET') return core.getExercise(db, +r[1], { limit: +q.limit || 100 });
    if (m === 'PATCH') return core.updateExercise(db, +r[1], body);
    if (m === 'DELETE') return core.deleteExercise(db, +r[1]);
  }

  if (p === '/api/workouts') return m === 'POST' ? core.createWorkout(db, body) : core.listWorkouts(db, q);
  if ((r = p.match(/^\/api\/workouts\/(\d+)$/))) {
    if (m === 'GET') return core.getWorkout(db, +r[1], (q.extra || '').split(',').filter(Boolean));
    if (m === 'PATCH') return core.updateWorkout(db, +r[1], body);
    if (m === 'DELETE') return core.deleteWorkout(db, +r[1]);
  }
  if ((r = p.match(/^\/api\/workouts\/(\d+)\/sets$/)) && m === 'POST') return core.addSets(db, +r[1], body);
  if ((r = p.match(/^\/api\/sets\/(\d+)$/))) {
    if (m === 'PATCH') return core.updateSet(db, +r[1], body);
    if (m === 'DELETE') return core.deleteSet(db, +r[1]);
  }

  if (p === '/api/bodyweight') return m === 'POST' ? core.logBodyweight(db, body) : core.listBodyweight(db, q);
  if ((r = p.match(/^\/api\/bodyweight\/(\d+)$/)) && m === 'DELETE') return core.deleteBodyweight(db, +r[1]);

  throw new core.AppError('Not found', 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const isMcp = path === '/mcp' || path.startsWith('/mcp/');
    if (!isMcp && !path.startsWith('/api/')) return new Response('Not found', { status: 404 });
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

    if (!env.APP_TOKEN) return json({ error: 'Server is missing the APP_TOKEN secret' }, 500);
    // Accept the key as a Bearer header, or as /mcp/<key> for MCP clients that cannot send headers.
    const bearer = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    const pathKey = isMcp ? decodeURIComponent(path.slice(5)) : '';
    if (!safeEqual(bearer, env.APP_TOKEN) && !safeEqual(pathKey, env.APP_TOKEN)) {
      return json({ error: 'Unauthorized' }, 401);
    }

    try {
      if (isMcp) {
        const res = await handleMcp(request, env.DB);
        const headers = new Headers(res.headers);
        for (const [k, v] of Object.entries(CORS)) headers.set(k, v);
        return new Response(res.body, { status: res.status, headers });
      }
      return json(await api(request, url, env.DB));
    } catch (e) {
      if (e instanceof core.AppError) return json({ error: e.message }, e.status);
      console.error(e);
      return json({ error: 'Internal error' }, 500);
    }
  },
};
