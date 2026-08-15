import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";

const PORT = Number(process.env.PORT ?? 3000);
const MAX_BODY_BYTES = 1024 * 100; // 100 KiB is plenty for JSON APIs

const tasks = new Map(); // id → { id, title, done }

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// ---------------------------------------------------------------- responses

function sendJson(res, status, data) {
  const payload = JSON.stringify(data);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

// ---------------------------------------------------------------- body

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const type = req.headers["content-type"] ?? "";
    if (!type.startsWith("application/json")) {
      return reject(new HttpError(415, "content-type must be application/json"));
    }
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new HttpError(413, "body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new HttpError(400, "invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

// ---------------------------------------------------------------- static

const PUBLIC_DIR = path.resolve("./public");
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

async function serveStatic(res, pathname) {
  const relative = pathname.replace(/^\/public\//, "").replaceAll("\0", "");
  const filePath = path.resolve(PUBLIC_DIR, relative === "" ? "index.html" : relative);

  // 🛡️ THE path traversal check
  if (!filePath.startsWith(PUBLIC_DIR + path.sep) && filePath !== PUBLIC_DIR) {
    throw new HttpError(404, "not found");
  }

  let info;
  try {
    info = await stat(filePath);
  } catch {
    throw new HttpError(404, "not found");
  }
  if (!info.isFile()) throw new HttpError(404, "not found");

  res.writeHead(200, {
    "content-type": MIME[path.extname(filePath)] ?? "application/octet-stream",
    "content-length": info.size,
  });
  createReadStream(filePath).pipe(res);
}

// ---------------------------------------------------------------- router

async function router(req, res, url) {
  try {
    if (req.method === "GET" && url.pathname === "/health") {
      return sendJson(res, 200, { status: "ok" });
    }
    if (req.method === "GET" && url.pathname === "/api/tasks") {
      return sendJson(res, 200, [...tasks.values()]);
    }
    if (req.method === "POST" && url.pathname === "/api/tasks") {
      const body = await readJsonBody(req);
      if (typeof body?.title !== "string" || body.title.trim() === "") {
        return sendJson(res, 400, { error: "title (non-empty string) is required" });
      }
      const task = { id: randomUUID(), title: body.title.trim(), done: false };
      tasks.set(task.id, task);
      return sendJson(res, 201, task);
    }
    if (req.method === "GET" && url.pathname.startsWith("/public/")) {
      return serveStatic(res, url.pathname);
    }
    if (req.method === "GET" && url.pathname === "/") {
      return serveStatic(res, "/public/index.html");
    }
    sendJson(res, 404, { error: "not found" });
  } catch (err) {
    if (err instanceof HttpError) {
      return sendJson(res, err.status, { error: err.message });
    }
    console.error(err);
    sendJson(res, 500, { error: "internal server error" });
  }
}

// ---------------------------------------------------------------- server

const server = createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);
  router(req, res, url);
});

server.listen(PORT, () => {
  console.log(`listening on http://localhost:${PORT}`);
});

process.on("SIGINT", () => {
  server.close(() => process.exit(0));
});
