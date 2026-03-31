const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");

const { parseCircuitImage } = require("./lib/circuit-parser");

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 8080);

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml; charset=utf-8",
  ".md": "text/markdown; charset=utf-8"
};

function sendJson(res, statusCode, body) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(body));
}

function sendText(res, statusCode, body) {
  res.writeHead(statusCode, {
    "Content-Type": "text/plain; charset=utf-8"
  });
  res.end(body);
}

async function readJsonBody(req) {
  const chunks = [];
  let total = 0;

  for await (const chunk of req) {
    total += chunk.length;
    if (total > 30 * 1024 * 1024) {
      throw new Error("Request body too large");
    }
    chunks.push(chunk);
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

async function serveStatic(req, res, url) {
  let relativePath = decodeURIComponent(url.pathname);
  if (relativePath === "/") relativePath = "/index.html";

  const filePath = path.join(ROOT, relativePath);
  const normalized = path.normalize(filePath);
  if (!normalized.startsWith(ROOT)) {
    sendText(res, 403, "Forbidden");
    return;
  }

  try {
    const stat = await fs.stat(normalized);
    if (stat.isDirectory()) {
      sendText(res, 403, "Forbidden");
      return;
    }

    const ext = path.extname(normalized).toLowerCase();
    const mimeType = MIME_TYPES[ext] || "application/octet-stream";
    const content = await fs.readFile(normalized);
    res.writeHead(200, { "Content-Type": mimeType });
    res.end(content);
  } catch {
    sendText(res, 404, "Not Found");
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "GET" && url.pathname === "/api/health") {
    sendJson(res, 200, { ok: true, service: "fxdemo1" });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/parse-circuit") {
    try {
      const body = await readJsonBody(req);
      const result = await parseCircuitImage(body);
      sendJson(res, 200, {
        ok: true,
        scene: result.scene,
        usage: result.usage
      });
    } catch (error) {
      console.error("[parse-circuit] failed:", error && error.stack ? error.stack : error);
      sendJson(res, 500, {
        ok: false,
        error: error.message || "Parse failed"
      });
    }
    return;
  }

  serveStatic(req, res, url);
});

server.listen(PORT, () => {
  console.log(`fxdemo1 server listening on http://localhost:${PORT}`);
});
