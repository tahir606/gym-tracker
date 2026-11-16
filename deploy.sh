#!/bin/sh
# One-command deploy to Cloudflare Workers + D1. Safe to re-run.
# Requires: `npx wrangler login` done once.
set -e
cd "$(dirname "$0")"
CFG=wrangler.deploy.jsonc

db_id() {
  npx wrangler d1 list --json 2>/dev/null | node -e '
    let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
      const db=JSON.parse(s).find(d=>d.name==="gym-db");process.stdout.write(db?db.uuid:"")})'
}

ID=$(db_id)
if [ -z "$ID" ]; then
  echo "Creating database..."
  npx wrangler d1 create gym-db >/dev/null
  ID=$(db_id)
fi
[ -n "$ID" ] || { echo "Could not find or create the gym-db database"; exit 1; }

# Write a deploy config with the real database id, leaving the committed wrangler.jsonc untouched.
node -e '
  const fs=require("fs");
  fs.writeFileSync(process.argv[2],fs.readFileSync("wrangler.jsonc","utf8").replace(/"database_id": "[^"]*"/,`"database_id": "${process.argv[1]}"`))' "$ID" "$CFG"

echo "Applying database migrations..."
npx wrangler d1 migrations apply gym-db --remote --config "$CFG"

echo "Deploying..."
npx wrangler deploy --config "$CFG"

if [ ! -f ACCESS_KEY.txt ]; then
  openssl rand -hex 16 > ACCESS_KEY.txt
  echo "Setting access key..."
  npx wrangler secret put APP_TOKEN --config "$CFG" < ACCESS_KEY.txt
  echo "Your access key was saved to ACCESS_KEY.txt - keep it private."
fi
echo "Done."
