export const up = (pgm) => {
  pgm.createExtension("citext", { ifNotExists: true }); // case-insensitive text

  pgm.createTable("users", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    email: { type: "citext", notNull: true, unique: true },
    password_hash: { type: "text", notNull: true },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });

  pgm.createTable("sessions", {
    // 🛡️ We store a SHA-256 of the session token, never the token itself:
    // the token is a credential; a leaked database must not mint logins.
    token_hash: { type: "text", primaryKey: true },
    user_id: { type: "uuid", notNull: true, references: "users", onDelete: "CASCADE" },
    expires_at: { type: "timestamptz", notNull: true },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
  pgm.createIndex("sessions", ["user_id"]);
  pgm.createIndex("sessions", ["expires_at"]);
};

export const down = (pgm) => {
  pgm.dropTable("sessions");
  pgm.dropTable("users");
};
