# ftops

## Dev Workflow Cheat Sheet

One-time setup:

```sh
npm install
```

Git hooks are installed automatically via `npm run prepare` (runs on install).

Daily loop:

```sh
wrangler dev
```

Migrations:

```sh
npm run gen:migrations
npm run db:migrations:create
npm run db:migrations:list:local
npm run db:migrations:list:remote
npm run db:migrate:local
npm run db:migrate:remote
```

Tests:

```sh
npm run test:unit
npm run test:int
npm run test:watch
npm run tidy
npm run verify
```

Deploy (guarded):

```sh
npm run deploy
npm run deploy:dev
npm run deploy:prod
```

Production notes:

- This worker is internal-only (service binding). Disable the `workers.dev` route in the
  Cloudflare dashboard and ensure no public routes are configured for `api.from-trees.com/*`.

Deploy (unsafe, skips tests):

```sh
npm run deploy:unsafe
```

DB execute:

```sh
npm run db:execute -- "<SQL>"
npm run db:execute:remote -- "<SQL>"
```

Migration manifest:

- `src/generated/migrationsManifest.ts` is generated from `migrations/*.sql`.
- It runs automatically via `prebuild` and `pretest` hooks.
- Unit tests fail if it is stale; run `npm run gen:migrations`.

## Local testing

Health:

```sh
curl -s http://localhost:8787/health
```

Projects:

```sh
curl -s http://localhost:8787/projects
curl -s -X POST http://localhost:8787/projects
```

Events:

```sh
curl -s http://localhost:8787/events
curl -s -X POST http://localhost:8787/events/test \
  -H 'content-type: application/json' \
  -d '{"source":"manual","type":"test_event","externalId":"abc","payload":{"hello":"world"}}'
```

Plan preview (requires seeded data):

```sh
curl -s "http://localhost:8787/plan/preview?record_uri=manual://proposal/demo"
```

### Commercial record ingestion (local)

```sh
curl -s -X POST http://localhost:8787/events/test \
  -H 'content-type: application/json' \
  -d '{"source":"manual","type":"commercial_record_upserted","externalId":"demo-1","payload":{"record":{"uri":"manual://proposal/demo-1","kind":"proposal","customer":{"display":"Jane Smith"},"commitments":{"quotedDeliveryDate":"2026-03-15","quotedInstallDate":"2026-03-20"},"currency":"USD"},"line_items":[{"uri":"manual://proposal/demo-1/line/table","title":"Ash Dining Table","category_key":"furniture","deliverable_key":"dining_table","quantity":1,"position":1,"config":{"requiresDesign":true}}]}}'
```

```sql
SELECT * FROM commercial_records ORDER BY updated_at DESC;
SELECT * FROM commercial_line_items WHERE record_uri = 'manual://proposal/demo-1';
```

Templates CRUD:

```sh
curl -s -X POST http://localhost:8787/templates \\
  -H 'content-type: application/json' \\
  -d '{\"key\":\"custom.project.example\",\"title\":\"Example\",\"scope\":\"project\",\"is_active\":true}'

curl -s -X POST http://localhost:8787/templates/custom.project.example/rules \\
  -H 'content-type: application/json' \\
  -d '{\"priority\":100,\"match_json\":{\"attach_to\":\"project\"},\"is_active\":true}'

curl -s -X DELETE http://localhost:8787/templates/custom.project.example/rules/<RULE_ID>

curl -s -X DELETE http://localhost:8787/templates/custom.project.example
```

### CORS checks (local)

Preflight:

```sh
curl -i -X OPTIONS "http://localhost:8787/plan/preview" \
  -H "Origin: http://localhost:5173" \
  -H "Access-Control-Request-Method: GET"
```

Actual request:

```sh
curl -i "http://localhost:8787/health" -H "Origin: http://localhost:5173"
```

Disallowed origin:

```sh
curl -i "http://localhost:8787/health" -H "Origin: https://evil.example"
```

### Example seed SQL

```sql
INSERT INTO commercial_records (
  uri, source, kind, external_id, snapshot_json, snapshot_hash,
  first_seen_at, last_seen_at, created_at, updated_at
) VALUES (
  'manual://proposal/demo', 'manual', 'proposal', 'demo', '{}', 'snap-demo',
  '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'
);

INSERT INTO commercial_line_items (
  uri, record_uri, category_key, deliverable_key, quantity, position,
  config_json, config_hash, created_at, updated_at
) VALUES (
  'manual://proposal/demo/line/1', 'manual://proposal/demo',
  'furniture', 'dining_table', 1, 1, '{}', 'cfg-demo',
  '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'
);
```

Ensure `line_item_categories` and `deliverable_kinds` include the referenced keys (see migrations seed data).
