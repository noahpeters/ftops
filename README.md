# ftops

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
