// Our list() orders by created_at. Without an index Postgres reads and sorts
// the whole table — invisible at 100 rows, a database-killer at 10 million.
// Verify with: EXPLAIN ANALYZE SELECT ... ORDER BY created_at DESC LIMIT 50;
export const up = (pgm) => {
  pgm.createIndex("tasks", ["created_at"]);
};

export const down = (pgm) => {
  pgm.dropIndex("tasks", ["created_at"]);
};
