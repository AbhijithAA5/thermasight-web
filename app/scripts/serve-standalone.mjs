// ThermaSight — standalone production server (plain Node.js, zero platform
// dependencies). Serves the TanStack Start server bundle built by
// `bun run build` (or `npm run build`) through a tiny Node HTTP adapter,
// with static assets served straight from dist/client.
//
// Usage:
//   bun run build
//   bun run start            (or: npm run start)
//   PORT=8080 bun run start  (custom port)
import { createServer } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, normalize } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const distServer = join(ROOT, "dist", "server", "server.js");
const clientRoot = join(ROOT, "dist", "client");

if (!existsSync(distServer)) {
  console.error("dist/server/server.js not found. Run `bun run build` first.");
  process.exit(1);
}

const { default: serverEntry } = await import(distServer);
const PORT = Number(process.env.PORT || 3000);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".map": "application/json",
  ".woff2": "font/woff2",
  ".webmanifest": "application/manifest+json",
};

function readRequestBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
  });
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const pathname = decodeURIComponent(url.pathname);

    // Static asset fast path (files shipped in dist/client).
    if ((req.method === "GET" || req.method === "HEAD") && !pathname.includes("..")) {
      const rel = normalize(pathname.replace(/^\/+/, ""));
      const candidate = rel ? join(clientRoot, rel) : "";
      if (candidate && candidate.startsWith(clientRoot)) {
        let isFile = false;
        try {
          isFile = statSync(candidate).isFile();
        } catch {
          isFile = false;
        }
        if (isFile) {
          const stat = readFileSync(candidate);
          const ext = candidate.slice(candidate.lastIndexOf(".")).toLowerCase();
          res.writeHead(200, {
            "content-type": MIME[ext] ?? "application/octet-stream",
            "cache-control": pathname.startsWith("/assets/") ? "public, max-age=86400" : "no-cache",
            "content-length": stat.length,
          });
          if (req.method === "HEAD") {
            res.end();
          } else {
            res.end(stat);
          }
          return;
        }
      }
    }

    // SSR / API routes through the TanStack Start handler.
    const body = req.method === "GET" || req.method === "HEAD" ? undefined : await readRequestBody(req);
    const request = new Request(url, {
      method: req.method,
      headers: req.headers,
      body,
      // Node 18+ requires this when body is a stream; a Buffer is fine either way.
      duplex: "half",
    });
    const response = await serverEntry.fetch(request, {}, {});
    res.writeHead(response.status, {
      ...Object.fromEntries(response.headers.entries()),
      "x-powered-by": "thermasight-standalone",
    });
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    console.error(error);
    if (!res.headersSent) {
      res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      res.end("ThermaSight server error. See console for details.");
    } else {
      res.end();
    }
  }
});

server.listen(PORT, () => {
  console.log("");
  console.log(`  ThermaSight is running`);
  console.log(`  Local:   http://localhost:${PORT}`);
  console.log("");
});