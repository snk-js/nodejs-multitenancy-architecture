export const up = (pgm) => {
  // The outbox: "intent to enqueue" recorded IN the same transaction as the
  // business write. Both exist or neither does — the crash window is closed.
  pgm.createTable("outbox", {
    id: { type: "bigserial", primaryKey: true },
    workspace_id: { type: "uuid", notNull: true, references: "workspaces", onDelete: "CASCADE" },
    kind: { type: "text", notNull: true },
    payload: { type: "jsonb", notNull: true },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    published_at: { type: "timestamptz" }, // null = not yet relayed to the queue
  });
  pgm.createIndex("outbox", ["published_at"], { where: "published_at IS NULL" });
  // NOTE: outbox is deliberately NOT under RLS — it is written inside tenant
  // transactions (scope guaranteed by the writer) but READ ACROSS TENANTS by
  // the relay. It appears in the RLS meta-test allowlist with this rationale.

  // Idempotency ledger: "this exact effect already happened" — the workhorse
  // that turns at-least-once delivery into exactly-once EFFECT.
  pgm.createTable("processed_jobs", {
    key: { type: "text", primaryKey: true },
    processed_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });

  // grants for trellis_app come from ALTER DEFAULT PRIVILEGES (epoch 07),
  // but sequences need their own:
  pgm.sql(`
    DO $$
    DECLARE s text := current_schema();
    BEGIN
      EXECUTE format('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA %I TO trellis_app', s);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA %I GRANT USAGE, SELECT ON SEQUENCES TO trellis_app', s);
    END $$;
  `);
};

export const down = (pgm) => {
  pgm.dropTable("processed_jobs");
  pgm.dropTable("outbox");
};
