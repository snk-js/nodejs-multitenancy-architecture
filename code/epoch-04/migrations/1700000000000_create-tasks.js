export const up = (pgm) => {
  pgm.createTable("tasks", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    title: { type: "text", notNull: true },
    done: { type: "boolean", notNull: true, default: false },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
};

export const down = (pgm) => {
  pgm.dropTable("tasks");
};
