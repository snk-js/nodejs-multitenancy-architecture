import { createServer } from "node:http";

const PORT = Number(process.env.PORT ?? 3000);

const server = createServer((req, res) => {
  res.statusCode = 200;
  res.setHeader("content-type", "text/html; charset=utf-8");
  res.end(`<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><title>Trellis</title></head>
  <body>
    <h1>Trellis</h1>
    <p>Tasks for teams. Eventually.</p>
  </body>
</html>`);
});

server.listen(PORT, () => {
  console.log(`listening on http://localhost:${PORT}`);
});

process.on("SIGINT", () => {
  server.close(() => process.exit(0));
});
