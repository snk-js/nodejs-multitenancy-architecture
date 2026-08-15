export const up = (pgm) => {
  // Pre-launch app: existing dev tasks have no owner, so we clear them.
  // Post-launch, this would be an expand/contract backfill (Epoch 11).
  pgm.sql("DELETE FROM tasks");
  pgm.addColumn("tasks", {
    owner_id: { type: "uuid", notNull: true, references: "users", onDelete: "CASCADE" },
  });
  pgm.createIndex("tasks", ["owner_id", "created_at"]);
};

export const down = (pgm) => {
  pgm.dropColumn("tasks", "owner_id");
};
