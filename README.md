# Gym Tracker

A self-hosted gym and workout tracker that runs on Cloudflare's free tier, with a built-in
[MCP](https://modelcontextprotocol.io) server so AI agents can log and analyse your training.

One Cloudflare Worker serves everything: the mobile-friendly web app, a REST API, and the MCP endpoint.
Data lives in a D1 (SQLite) database. No build step, no framework, no runtime dependencies.

## Features

- **Workout logging** - exercises, sets, weight, reps, RPE, warm-ups and notes, with last session's numbers shown as you log and a rest timer.
- **Personal records** - flagged the moment you beat a previous best; estimated 1RM, heaviest weight, most reps and best set volume per exercise.
- **Exercise library** - 39 common exercises preloaded; add your own. Each has a progress chart and full history.
- **Insights** - training calendar, workouts/sets/volume per month, weekday and split breakdown, muscle-group balance, rep ranges, progress per exercise, records over time and body-weight trend.
- **Body weight log** with a smoothed trend line.
- **Light and dark themes**, installable to a phone home screen.
- **MCP server** with 16 tools, protected by the same access key as the app.

## Deploy your own

You need Node.js 20+ and a free [Cloudflare](https://dash.cloudflare.com/sign-up) account.

```bash
git clone <this repo> && cd gym-tracker
npm install
npx wrangler login
./deploy.sh
```

`deploy.sh` creates the D1 database, applies migrations, deploys the Worker, and generates a random
access key (saved to `ACCESS_KEY.txt`, which is git-ignored). It prints your `*.workers.dev` URL.
Open it, paste the access key once per device, and start logging. Re-run `./deploy.sh` after any change.

To rotate the key, delete `ACCESS_KEY.txt` and run `./deploy.sh` again.

## Connect an AI agent (MCP)

The MCP endpoint is `https://<your-worker>.workers.dev/mcp` (Streamable HTTP).

- Clients that can send headers: use `Authorization: Bearer <access key>`.
- Clients that cannot: use `https://<your-worker>.workers.dev/mcp/<access key>`. Treat that URL like a password.

Claude Code example:

```bash
claude mcp add --transport http gym https://<your-worker>.workers.dev/mcp --header "Authorization: Bearer <access key>"
```

Tools: `log_workout`, `add_sets`, `list_workouts`, `get_workout`, `update_workout`, `delete_workout`,
`update_set`, `delete_set`, `list_exercises`, `create_exercise`, `get_exercise_history`,
`get_personal_records`, `get_stats`, `get_insights`, `log_bodyweight`, `get_bodyweight`.

## Local development

```bash
cp .dev.vars.example .dev.vars
npm run migrate:local
npm run dev
```

Then open http://localhost:8787 and sign in with the key from `.dev.vars`.

## REST API

All routes require `Authorization: Bearer <access key>` and speak JSON.

| Route | Methods | Purpose |
|---|---|---|
| `/api/workouts` | GET, POST | List workouts; create one (optionally with exercises and sets) |
| `/api/workouts/:id` | GET, PATCH, DELETE | One workout with sets, PR flags and previous performance |
| `/api/workouts/:id/sets` | POST | Add sets for an exercise |
| `/api/sets/:id` | PATCH, DELETE | Edit or remove a set |
| `/api/exercises` | GET, POST | Exercise library |
| `/api/exercises/:id` | GET, PATCH, DELETE | Records and session history for one exercise |
| `/api/prs` | GET | Personal records for every exercise |
| `/api/stats` | GET | Totals, weekly streak, workouts per week |
| `/api/insights` | GET | Full analysis (`?from=YYYY-MM-DD` narrows the breakdowns) |
| `/api/bodyweight` | GET, POST | Body-weight entries (`DELETE /api/bodyweight/:id`) |
| `/api/settings` | GET, PUT | Weight unit (`kg` or `lb`) |

## How things are counted

- Weights are plain numbers in your chosen unit; switching between kg and lb changes the label only.
- Estimated 1RM uses the Epley formula. Warm-up sets are excluded from records and volume.
- A set whose note starts with `plates` is treated as a machine plate count rather than a weight:
  it is displayed as "N plates" and left out of volume totals.
- A set with 0 reps means "reps not recorded" and is shown as the weight alone.

## Project layout

```
src/index.js    Worker entry: auth, REST routing
src/core.js     Data layer and analysis, shared by the API and MCP server
src/mcp.js      MCP server (JSON-RPC over HTTP)
public/         Single-file web app, manifest, icon
migrations/     D1 schema and starter exercises
deploy.sh       One-command deploy
```

## Security notes

This is a single-user app guarded by one shared secret. Anyone with the access key can read and
change everything, so keep it out of screenshots and shared links.

## License

[MIT](LICENSE)
