// Correctness by CONSTRUCTION: the database itself refuses cross-tenant rows,
// even when application code is buggy. Raw SQL migration — this is why we kept
// the escape hatch.
export const up = (pgm) => {
  // 🛡️ The privilege split that makes RLS real: RLS does not constrain
  // superusers or owners (unless FORCEd). The app connects as trellis_app —
  // NOT the table owner — and is fully subject to policies. Migrations keep
  // running as the owner.
  pgm.sql(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'trellis_app') THEN
        CREATE ROLE trellis_app LOGIN PASSWORD 'trellis_app';
      END IF;
    END $$;
  `);

  // current_schema() so the same migration works in prod (public) and in the
  // ephemeral per-test-file schemas.
  pgm.sql(`
    DO $$
    DECLARE s text := current_schema();
    BEGIN
      EXECUTE format('GRANT USAGE ON SCHEMA %I TO trellis_app', s);
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA %I TO trellis_app', s);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA %I GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO trellis_app', s);
    END $$;
  `);

  pgm.sql("ALTER TABLE tasks ENABLE ROW LEVEL SECURITY");
  pgm.sql("ALTER TABLE tasks FORCE ROW LEVEL SECURITY"); // applies even to the owner

  // USING filters what exists; WITH CHECK vetoes what you may write.
  // current_setting(..., true) = missing_ok: tenant never set → NULL → matches
  // NOTHING. The failure mode of a forgotten context is zero rows, not all rows.
  pgm.sql(`
    CREATE POLICY tenant_isolation ON tasks
      USING      (workspace_id = current_setting('app.tenant_id', true)::uuid)
      WITH CHECK (workspace_id = current_setting('app.tenant_id', true)::uuid)
  `);
};

export const down = (pgm) => {
  pgm.sql("DROP POLICY tenant_isolation ON tasks");
  pgm.sql("ALTER TABLE tasks NO FORCE ROW LEVEL SECURITY");
  pgm.sql("ALTER TABLE tasks DISABLE ROW LEVEL SECURITY");
};
