export function makeUserRepository(db) {
  return {
    async create({ email, password_hash }) {
      const { rows } = await db.query(
        "INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id, email, created_at",
        [email, password_hash]
      );
      return rows[0];
    },

    async findByEmail(email) {
      const { rows } = await db.query(
        "SELECT id, email, password_hash FROM users WHERE email = $1",
        [email]
      );
      return rows[0] ?? null;
    },
  };
}
