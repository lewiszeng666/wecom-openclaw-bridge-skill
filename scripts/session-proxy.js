/**
 * OpenClaw Session Proxy
 * Version: 1.1.0
 *
 * Deploy this on any machine running OpenClaw.
 * Exposes a lightweight HTTP API so a remote bridge.js can:
 *   1. Wake OpenClaw (POST /wake)
 *   2. Poll for the latest assistant reply (GET /session/latest)
 *
 * This means the bridge only needs access to ONE port on the remote machine.
 * OpenClaw's port 18789 never needs to be exposed externally.
 *
 * Endpoints:
 *   GET  /health                        → Health check (no auth required)
 *   POST /wake                          → Proxy wake request to local OpenClaw
 *   GET  /session/latest?after=<ISO>    → Returns latest assistant reply
 *
 * Environment Variables:
 *   PROXY_PORT          Port to listen on (default: 3001)
 *   OPENCLAW_PORT       Local OpenClaw port (default: 18789)
 *   SESSIONS_DIR        Path to OpenClaw sessions directory
 *   PROXY_AUTH_TOKEN    Optional Bearer token for authentication
 */

const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const readline = require("readline");
const os = require("os");

// ---- Config ----
const CONFIG = {
  PORT:          parseInt(process.env.PROXY_PORT     || "3001",  10),
  OPENCLAW_PORT: parseInt(process.env.OPENCLAW_PORT  || "18789", 10),
  OPENCLAW_HOST: process.env.OPENCLAW_HOST || "127.0.0.1",
  SESSIONS_DIR:  process.env.SESSIONS_DIR  || path.join(os.homedir(), ".openclaw", "agents", "main", "sessions"),
  AUTH_TOKEN:    process.env.PROXY_AUTH_TOKEN || null,
};

// ---- Logging ----
function log(level, ...args) {
  const line = `[${new Date().toISOString()}] [${level.padEnd(5)}] [session-proxy] ${args.join(" ")}`;
  if (level === "ERROR" || level === "WARN") process.stderr.write(line + "\n");
  else process.stdout.write(line + "\n");
}

// ---- Session File Helpers ----
function getMainSessionFile() {
  const indexPath = path.join(CONFIG.SESSIONS_DIR, "sessions.json");
  try {
    if (fs.existsSync(indexPath)) {
      const index = JSON.parse(fs.readFileSync(indexPath, "utf-8"));
      const mainKey = Object.keys(index).find((k) => k.includes("main"));
      if (mainKey && index[mainKey]) {
        const entry = index[mainKey];
        if (entry.sessionFile && fs.existsSync(entry.sessionFile)) {
          log("DEBUG", `Session from index: ${path.basename(entry.sessionFile)}`);
          return entry.sessionFile;
        }
        if (entry.sessionId) {
          const fp = path.join(CONFIG.SESSIONS_DIR, `${entry.sessionId}.jsonl`);
          if (fs.existsSync(fp)) { log("DEBUG", `Session from sessionId: ${path.basename(fp)}`); return fp; }
        }
      }
    }
  } catch (e) { log("WARN", `Could not read sessions.json: ${e.message}`); }

  // Fallback: latest .jsonl
  try {
    const files = fs.readdirSync(CONFIG.SESSIONS_DIR)
      .filter((f) => f.endsWith(".jsonl"))
      .map((f) => ({ fp: path.join(CONFIG.SESSIONS_DIR, f), mt: fs.statSync(path.join(CONFIG.SESSIONS_DIR, f)).mtime }))
      .sort((a, b) => b.mt - a.mt);
    if (files.length > 0) { log("DEBUG", `Fallback session: ${path.basename(files[0].fp)}`); return files[0].fp; }
  } catch (e) { log("ERROR", `Failed to list sessions dir: ${e.message}`); }
  return null;
}

function extractTextFromContent(content) {
  if (!content) return null;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const item = content.find((c) => c.type === "text");
    if (item) return item.text;
    const parts = content.map((c) => c.text || c.value || "").filter(Boolean);
    return parts.length > 0 ? parts.join("\n") : null;
  }
  return String(content);
}

async function getLatestAssistantReply(sessionFile, afterTimestamp) {
  return new Promise((resolve) => {
    const lines = [];
    const rl = readline.createInterface({ input: fs.createReadStream(sessionFile), crlfDelay: Infinity });
    rl.on("line", (l) => { try { lines.push(JSON.parse(l)); } catch {} });
    rl.on("close", () => {
      const reply = lines.find((l) => {
        const ts = l.timestamp || l.createdAt;
        if (!ts || new Date(ts) <= afterTimestamp) return false;
        const role = l.message?.role ?? l.role;
        if (role !== "assistant") return false;
        return !!(l.message?.content ?? l.content);
      });
      if (reply) resolve(extractTextFromContent(reply.message?.content ?? reply.content));
      else resolve(null);
    });
  });
}

// ---- Wake Proxy ----
function proxyWakeRequest(body) {
  return new Promise((resolve, reject) => {
    const data = typeof body === "string" ? body : JSON.stringify(body);
    const options = {
      hostname: CONFIG.OPENCLAW_HOST,
      port: CONFIG.OPENCLAW_PORT,
      path: "/hooks/wake",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(data),
        // Forward the Authorization header from the original request body's token field
      },
    };

    const req = http.request(options, (res) => {
      let responseBody = "";
      res.on("data", (chunk) => (responseBody += chunk));
      res.on("end", () => resolve({ status: res.statusCode, body: responseBody }));
    });

    req.on("error", reject);
    req.setTimeout(10000, () => { req.destroy(new Error("Wake request timed out")); });
    req.write(data);
    req.end();
  });
}

// ---- Read request body ----
function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

// ---- HTTP Server ----
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  log("INFO", `${req.method} ${url.pathname}`);

  const sendJson = (status, data) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(data));
  };

  // Health check (no auth required)
  if (url.pathname === "/health") {
    const sessionFile = getMainSessionFile();
    return sendJson(200, {
      status: "ok",
      openclawPort: CONFIG.OPENCLAW_PORT,
      sessionsDir: CONFIG.SESSIONS_DIR,
      activeSession: sessionFile ? path.basename(sessionFile) : null,
      timestamp: new Date().toISOString(),
    });
  }

  // Auth check for all other endpoints
  if (CONFIG.AUTH_TOKEN) {
    const auth = req.headers.authorization;
    if (!auth || auth !== `Bearer ${CONFIG.AUTH_TOKEN}`) {
      log("WARN", "Unauthorized request");
      return sendJson(401, { error: "Unauthorized" });
    }
  }

  // POST /wake → proxy to local OpenClaw
  if (req.method === "POST" && url.pathname === "/wake") {
    let rawBody;
    try { rawBody = await readBody(req); } catch (e) { return sendJson(400, { error: "Failed to read request body" }); }

    let parsedBody;
    try { parsedBody = JSON.parse(rawBody); } catch { parsedBody = {}; }

    // Inject the OpenClaw token from config if not provided
    if (!parsedBody.token && !req.headers["x-openclaw-token"]) {
      // The token should be in the Authorization header sent by bridge
      // We strip the proxy auth and forward with openclaw token
    }

    // Build the body to forward to OpenClaw (text + mode)
    const wakeBody = { text: parsedBody.text || "", mode: parsedBody.mode || "now" };
    const openclawToken = parsedBody.openclawToken || req.headers["x-openclaw-token"] || "";

    try {
      const data = JSON.stringify(wakeBody);
      const result = await new Promise((resolve, reject) => {
        const options = {
          hostname: CONFIG.OPENCLAW_HOST,
          port: CONFIG.OPENCLAW_PORT,
          path: "/hooks/wake",
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(data),
            "Authorization": `Bearer ${openclawToken}`,
          },
        };
        const r = http.request(options, (resp) => {
          let body = "";
          resp.on("data", (c) => (body += c));
          resp.on("end", () => resolve({ status: resp.statusCode, body }));
        });
        r.on("error", reject);
        r.setTimeout(10000, () => r.destroy(new Error("Timed out")));
        r.write(data);
        r.end();
      });
      log("INFO", `Wake proxied → OpenClaw status: ${result.status}`);
      res.writeHead(result.status, { "Content-Type": "application/json" });
      res.end(result.body);
    } catch (e) {
      log("ERROR", `Failed to proxy wake request: ${e.message}`);
      return sendJson(502, { error: `Failed to reach OpenClaw: ${e.message}` });
    }
    return;
  }

  // GET /session/latest?after=<ISO timestamp>
  if (req.method === "GET" && url.pathname === "/session/latest") {
    const afterStr = url.searchParams.get("after");
    if (!afterStr) return sendJson(400, { error: 'Missing required parameter "after"' });
    const afterTs = new Date(afterStr);
    if (isNaN(afterTs.getTime())) return sendJson(400, { error: 'Invalid "after" timestamp' });

    const sessionFile = getMainSessionFile();
    if (!sessionFile) return sendJson(404, { error: "No session file found" });

    try {
      const reply = await getLatestAssistantReply(sessionFile, afterTs);
      if (reply) log("INFO", `Reply found (${reply.length} chars)`);
      return sendJson(200, { reply });
    } catch (e) {
      log("ERROR", `Error reading session: ${e.message}`);
      return sendJson(500, { error: "Internal Server Error" });
    }
  }

  sendJson(404, { error: "Not Found" });
});

server.listen(CONFIG.PORT, () => {
  log("INFO", `\n🚀 Session Proxy v1.1.0 listening on port ${CONFIG.PORT}`);
  log("INFO", `   OpenClaw:    ${CONFIG.OPENCLAW_HOST}:${CONFIG.OPENCLAW_PORT} (local)`);
  log("INFO", `   Sessions:    ${CONFIG.SESSIONS_DIR}`);
  log("INFO", `   Auth:        ${CONFIG.AUTH_TOKEN ? "Enabled" : "Disabled (set PROXY_AUTH_TOKEN to enable)"}`);
  if (!fs.existsSync(CONFIG.SESSIONS_DIR)) {
    log("WARN", `Sessions directory not found. Ensure OpenClaw has run at least once.`);
  }
});
