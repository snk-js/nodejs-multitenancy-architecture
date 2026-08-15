// A factory taking `db`, not an import of the pool: the repository doesn't
// care if `db` is the pool, a transaction client, or a test double.
// This one parameter is what lets tests (Epoch 05) and tenant scoping
// (Epoch 07) slot in without changing a line in here.
export function makeTaskRepository(db) {
  return {
    async list() {
      const { rows } = await db.query(
        "SELECT id, title, done, created_at FROM tasks ORDER BY created_at DESC"
      );
      return rows;
    },

    async create({ title }) {
      // $1 placeholders, always: query text and values travel to Postgres in
      // separate protocol messages — the value is never parsed as SQL.
      const { rows } = await db.query(
        "INSERT INTO tasks (title) VALUES ($1) RETURNING id, title, done, created_at",
        [title]
      );
      return rows[0];
    },

    async setDone(id, done) {
      const { rows } = await db.query(
        "UPDATE tasks SET done = $2 WHERE id = $1 RETURNING id, title, done, created_at",
        [id, done]
      );
      return rows[0] ?? null; // "not found" is a domain outcome, not an exception
    },
  };
}
