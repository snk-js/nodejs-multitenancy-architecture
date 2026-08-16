-- Realistic seed data: a whale, a mid-size tenant, and a minnow.
-- A three-row database teaches nothing; skewed tenant sizes are what make
-- query plans, noisy neighbours, and index choices behave like production.
--
-- Deterministic by design (fixed UUIDs, fixed ordering) so a bug you find
-- today reproduces tomorrow.
--
-- Note: tasks has FORCE ROW LEVEL SECURITY (Epoch 07), so even the table owner
-- must stamp app.tenant_id before inserting. The seed therefore demonstrates
-- the very mechanism it depends on.

BEGIN;

-- password for every seeded user is: correct-horse-battery
-- (a real argon2id hash — verifiable, and safe to publish: local dev only)
\set pwhash '$argon2id$v=19$m=19456,t=2,p=1$A1ZnT3TPAgwfQqY9pTbksg$fzYQf8USvSN6lRV3Oa9XiewzO4agiDs+XhPWRMgX3Tg'

INSERT INTO users (id, email, password_hash) VALUES
  ('00000000-0000-4000-a000-000000000001', 'owner@acme.test',    :'pwhash'),
  ('00000000-0000-4000-a000-000000000002', 'owner@globex.test',  :'pwhash'),
  ('00000000-0000-4000-a000-000000000003', 'owner@initech.test', :'pwhash'),
  -- a consultant who belongs to TWO workspaces: users are people, not tenants
  ('00000000-0000-4000-a000-000000000004', 'consultant@indep.test', :'pwhash')
ON CONFLICT (id) DO NOTHING;

INSERT INTO workspaces (id, slug, name) VALUES
  ('00000000-0000-4000-b000-000000000001', 'acme',    'Acme Corp'),      -- whale
  ('00000000-0000-4000-b000-000000000002', 'globex',  'Globex'),         -- mid
  ('00000000-0000-4000-b000-000000000003', 'initech', 'Initech')         -- minnow
ON CONFLICT (id) DO NOTHING;

INSERT INTO memberships (workspace_id, user_id, role) VALUES
  ('00000000-0000-4000-b000-000000000001', '00000000-0000-4000-a000-000000000001', 'owner'),
  ('00000000-0000-4000-b000-000000000002', '00000000-0000-4000-a000-000000000002', 'owner'),
  ('00000000-0000-4000-b000-000000000003', '00000000-0000-4000-a000-000000000003', 'owner'),
  ('00000000-0000-4000-b000-000000000001', '00000000-0000-4000-a000-000000000004', 'member'),
  ('00000000-0000-4000-b000-000000000002', '00000000-0000-4000-a000-000000000004', 'admin')
ON CONFLICT DO NOTHING;

COMMIT;

-- ---------------------------------------------------------------- tasks
-- Acme: the whale — 90% of all rows. This skew is the whole point: it is what
-- makes "the index doesn't matter" false, and noisy-neighbour effects visible.
BEGIN;
SELECT set_config('app.tenant_id', '00000000-0000-4000-b000-000000000001', true);
INSERT INTO tasks (workspace_id, owner_id, title, done, created_at)
SELECT
  '00000000-0000-4000-b000-000000000001',
  '00000000-0000-4000-a000-000000000001',
  'acme task ' || i,
  (i % 4 = 0),
  now() - ((i % 525600) || ' minutes')::interval   -- spread over ~1 year
FROM generate_series(1, 900000) AS i;
COMMIT;

BEGIN;
SELECT set_config('app.tenant_id', '00000000-0000-4000-b000-000000000002', true);
INSERT INTO tasks (workspace_id, owner_id, title, done, created_at)
SELECT
  '00000000-0000-4000-b000-000000000002',
  '00000000-0000-4000-a000-000000000002',
  'globex task ' || i,
  (i % 3 = 0),
  now() - ((i % 43200) || ' minutes')::interval
FROM generate_series(1, 95000) AS i;
COMMIT;

BEGIN;
SELECT set_config('app.tenant_id', '00000000-0000-4000-b000-000000000003', true);
INSERT INTO tasks (workspace_id, owner_id, title, done, created_at)
SELECT
  '00000000-0000-4000-b000-000000000003',
  '00000000-0000-4000-a000-000000000003',
  'initech task ' || i,
  false,
  now() - (i || ' minutes')::interval
FROM generate_series(1, 500) AS i;
COMMIT;

ANALYZE tasks;   -- fresh statistics, or EXPLAIN lies to you

-- Verification that doubles as the first lesson: with NO tenant stamp, even the
-- table OWNER sees nothing (FORCE ROW LEVEL SECURITY + missing_ok current_setting).
-- The failure direction of a forgotten context is zero rows, never all rows.
\echo '--- tasks visible with NO tenant context (expect 0) ---'
SELECT count(*) AS unscoped_visible_rows FROM tasks;

\echo '--- per-tenant counts, each read inside its own stamped transaction ---'
BEGIN;
SELECT set_config('app.tenant_id', '00000000-0000-4000-b000-000000000001', true);
SELECT 'acme' AS tenant, count(*) AS tasks FROM tasks;
COMMIT;

BEGIN;
SELECT set_config('app.tenant_id', '00000000-0000-4000-b000-000000000002', true);
SELECT 'globex' AS tenant, count(*) AS tasks FROM tasks;
COMMIT;

BEGIN;
SELECT set_config('app.tenant_id', '00000000-0000-4000-b000-000000000003', true);
SELECT 'initech' AS tenant, count(*) AS tasks FROM tasks;
COMMIT;
