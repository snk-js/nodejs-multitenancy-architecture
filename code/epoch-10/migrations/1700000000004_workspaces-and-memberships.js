export const up = (pgm) => {
  pgm.createTable("workspaces", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    slug: { type: "text", notNull: true, unique: true }, // "acme" → acme.trellis.app
    name: { type: "text", notNull: true },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });

  pgm.createTable("memberships", {
    workspace_id: { type: "uuid", notNull: true, references: "workspaces", onDelete: "CASCADE" },
    user_id: { type: "uuid", notNull: true, references: "users", onDelete: "CASCADE" },
    role: { type: "text", notNull: true, default: "member" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
  pgm.addConstraint("memberships", "memberships_pkey", {
    primaryKey: ["workspace_id", "user_id"],
  });
  pgm.addConstraint("memberships", "memberships_role_check", {
    check: "role IN ('owner', 'admin', 'member')",
  });
  pgm.createIndex("memberships", ["user_id"]);

  // Every tenant-owned table carries workspace_id NOT NULL. No exceptions.
  // (Pre-launch: clear dev tasks rather than backfill — see Epoch 11 for the
  // expand/contract discipline this would need after launch.)
  pgm.sql("DELETE FROM tasks");
  pgm.addColumn("tasks", {
    workspace_id: { type: "uuid", notNull: true, references: "workspaces", onDelete: "CASCADE" },
  });
  // 🛡️ Every hot index leads with the tenant column.
  pgm.createIndex("tasks", ["workspace_id", "created_at"]);
};

export const down = (pgm) => {
  pgm.dropColumn("tasks", "workspace_id");
  pgm.dropTable("memberships");
  pgm.dropTable("workspaces");
};
