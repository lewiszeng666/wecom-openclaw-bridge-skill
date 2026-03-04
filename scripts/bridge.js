/**
 * WeChat Work ↔ OpenClaw Multi-Channel Bridge
 * Version: 3.1.0
 *
 * Features:
 * - Multiple WeCom apps → Multiple OpenClaw instances routing
 * - Per-channel message queues (no cross-channel blocking)
 * - Per-channel log files
 * - Local (file) and Remote (HTTP session-proxy) OpenClaw support
 * - Stable retry/timeout handling
 *
 * Config: channels.json (see channels.json.example)
 */

const express = require("express");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const readline = require("readline");
const FormData = require("form-data");
const { XMLParser } = require("fast-xml-parser");
const WXBizMsgCrypt = require("wechat-crypto");

// ============================================================
// Logger
// ============================================================

class Logger {
  constructor(logDir, channelId = "bridge") {
    this.logDir = logDir;
    this.channelId = channelId;
    this.logPath = path.join(logDir, `${channelId}.log`);
    try {
      if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
    } catch (e) {
      console.error(`[Logger] Failed to create log dir ${logDir}: ${e.message}`);
    }
  }

  _write(level, ...args) {
    const prefix = `[${new Date().toISOString()}] [${level.padEnd(5)}] [${this.channelId}]`;
    const msg = args.map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a))).join(" ");
    const line = `${prefix} ${msg}\n`;
    try { fs.appendFileSync(this.logPath, line); } catch {}
    if (level === "ERROR" || level === "WARN") process.stderr.write(line);
    else process.stdout.write(line);
  }

  info(...a)  { this._write("INFO",  ...a); }
  warn(...a)  { this._write("WARN",  ...a); }
  error(...a) { this._write("ERROR", ...a); }
  debug(...a) { this._write("DEBUG", ...a); }
}

// ============================================================
// Utility: extract text from OpenClaw content block
// ============================================================

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

// ============================================================
// WeComChannel
// ============================================================

class WeComChannel {
  constructor(channelConfig, logger) {
    this.cfg = channelConfig;
    this.log = logger;
    this.cryptor = new WXBizMsgCrypt(
      channelConfig.wecom.token,
      channelConfig.wecom.aesKey,
      channelConfig.wecom.corpId
    );
    this.xmlParser = new XMLParser();
    this._queue = [];
    this._busy = false;
    this._accessToken = null;
    this._tokenExpiry = 0;
  }

  // ---- WeCom Access Token (with simple in-memory cache) ----

  async getAccessToken() {
    if (this._accessToken && Date.now() < this._tokenExpiry) return this._accessToken;
    const { corpId, corpSecret } = this.cfg.wecom;
    const res = await axios.get(
      `https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${corpId}&corpsecret=${corpSecret}`
    );
    if (res.data.errcode && res.data.errcode !== 0)
      throw new Error(`Failed to get AccessToken: ${res.data.errmsg}`);
    this._accessToken = res.data.access_token;
    this._tokenExpiry = Date.now() + (res.data.expires_in - 60) * 1000;
    return this._accessToken;
  }

  // ---- WeCom Send Helpers ----

  async sendTextToWecom(userId, text) {
    try {
      const token = await this.getAccessToken();
      const res = await axios.post(
        `https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${token}`,
        { touser: userId, msgtype: "text", agentid: this.cfg.wecom.agentId, text: { content: text } }
      );
      this.log.info(`✅ Text sent to ${userId} | errcode=${res.data.errcode}`);
    } catch (e) {
      this.log.error(`❌ Failed to send text to ${userId}: ${e.message}`);
    }
  }

  async uploadMedia(filePath, type) {
    const token = await this.getAccessToken();
    const form = new FormData();
    const mimeMap = { image: "image/jpeg", voice: "audio/amr", video: "video/mp4", file: "application/octet-stream" };
    form.append("media", fs.createReadStream(filePath), { filename: path.basename(filePath), contentType: mimeMap[type] || "application/octet-stream" });
    const res = await axios.post(
      `https://qyapi.weixin.qq.com/cgi-bin/media/upload?access_token=${token}&type=${type}`,
      form, { headers: form.getHeaders() }
    );
    if (res.data.errcode && res.data.errcode !== 0) throw new Error(res.data.errmsg);
    return res.data.media_id;
  }

  async sendMediaToWecom(userId, filePath, type) {
    try {
      if (!fs.existsSync(filePath)) { await this.sendTextToWecom(userId, `[File not found: ${filePath}]`); return; }
      const token = await this.getAccessToken();
      const mediaId = await this.uploadMedia(filePath, type);
      const body = { touser: userId, msgtype: type, agentid: this.cfg.wecom.agentId, [type]: { media_id: mediaId } };
      const res = await axios.post(`https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${token}`, body);
      this.log.info(`✅ ${type} sent to ${userId} | errcode=${res.data.errcode}`);
    } catch (e) {
      this.log.error(`❌ Failed to send ${type} to ${userId}: ${e.message}`);
      await this.sendTextToWecom(userId, `Failed to send ${type}: ${e.message}`);
    }
  }

  async sendReplyToWecom(userId, rawReply) {
    const finalMatch = rawReply.match(/<final>([\s\S]*?)<\/final>/);
    const text = finalMatch ? finalMatch[1].trim() : rawReply.trim();
    const imagePaths = [...text.matchAll(/\[IMAGE:(.*?)\]/g)].map((m) => m[1].trim());
    const voicePaths = [...text.matchAll(/\[VOICE:(.*?)\]/g)].map((m) => m[1].trim());
    const videoPaths = [...text.matchAll(/\[VIDEO:(.*?)\]/g)].map((m) => m[1].trim());
    const filePaths  = [...text.matchAll(/\[FILE:(.*?)\]/g)].map((m) => m[1].trim());
    const textOnly = text.replace(/\[(IMAGE|VOICE|VIDEO|FILE):.*?\]/g, "").trim();

    if (textOnly) await this.sendTextToWecom(userId, textOnly);
    for (const p of imagePaths) await this.sendMediaToWecom(userId, p, "image");
    for (const p of voicePaths) await this.sendMediaToWecom(userId, p, "voice");
    for (const p of videoPaths) await this.sendMediaToWecom(userId, p, "video");
    for (const p of filePaths)  await this.sendMediaToWecom(userId, p, "file");
    if (!textOnly && imagePaths.length === 0 && voicePaths.length === 0 && videoPaths.length === 0 && filePaths.length === 0)
      await this.sendTextToWecom(userId, "(Received an empty reply)");
  }

  // ---- Media Download ----

  async downloadMedia(mediaId, type) {
    try {
      const token = await this.getAccessToken();
      const url = `https://qyapi.weixin.qq.com/cgi-bin/media/get?access_token=${token}&media_id=${mediaId}`;
      const extMap = { voice: "amr", video: "mp4", image: "jpg", file: "bin" };
      const filename = `/tmp/wecom_${this.cfg.id}_${type}_${Date.now()}.${extMap[type] || "bin"}`;
      const response = await axios({ method: "get", url, responseType: "stream" });
      const writer = fs.createWriteStream(filename);
      response.data.pipe(writer);
      return new Promise((resolve, reject) => {
        writer.on("finish", () => { this.log.debug(`Downloaded ${type}: ${filename}`); resolve(filename); });
        writer.on("error", reject);
      });
    } catch (e) {
      this.log.error(`Failed to download ${type}: ${e.message}`);
      return null;
    }
  }

  // ---- OpenClaw Wake ----

  async wakeOpenClaw(text) {
    const oc = this.cfg.openclaw;
    try {
      if (oc.sessionsDir) {
        // Local mode: call OpenClaw directly
        const res = await axios.post(
          `http://${oc.host}:${oc.port}/hooks/wake`,
          { text, mode: "now" },
          { headers: { Authorization: `Bearer ${oc.token}`, "Content-Type": "application/json" }, timeout: 10000 }
        );
        this.log.info(`📤 Woke up OpenClaw (local) at ${oc.host}:${oc.port}, status: ${res.status}`);
      } else {
        // Remote mode: proxy wake through session-proxy
        const proxyPort = oc.proxyPort || (oc.port + 1);
        const proxyToken = oc.proxyAuthToken || null;
        const headers = { "Content-Type": "application/json" };
        if (proxyToken) headers["Authorization"] = `Bearer ${proxyToken}`;
        const res = await axios.post(
          `http://${oc.host}:${proxyPort}/wake`,
          { text, mode: "now", openclawToken: oc.token },
          { headers, timeout: 10000 }
        );
        this.log.info(`📤 Woke up OpenClaw (via proxy) at ${oc.host}:${proxyPort}, status: ${res.status}`);
      }
      return true;
    } catch (e) {
      this.log.error(`❌ Failed to wake OpenClaw: ${e.message}`);
      return false;
    }
  }

  // ---- Session File (Local) ----

  getLocalMainSessionFile(sessionsDir) {
    const indexPath = path.join(sessionsDir, "sessions.json");
    try {
      if (fs.existsSync(indexPath)) {
        const index = JSON.parse(fs.readFileSync(indexPath, "utf-8"));
        const mainKey = Object.keys(index).find((k) => k.includes("main"));
        if (mainKey && index[mainKey]) {
          const entry = index[mainKey];
          if (entry.sessionFile && fs.existsSync(entry.sessionFile)) return entry.sessionFile;
          if (entry.sessionId) {
            const fp = path.join(sessionsDir, `${entry.sessionId}.jsonl`);
            if (fs.existsSync(fp)) return fp;
          }
        }
      }
    } catch (e) { this.log.warn(`Could not read sessions.json: ${e.message}`); }

    // Fallback: latest .jsonl
    try {
      const files = fs.readdirSync(sessionsDir)
        .filter((f) => f.endsWith(".jsonl"))
        .map((f) => ({ fp: path.join(sessionsDir, f), mt: fs.statSync(path.join(sessionsDir, f)).mtime }))
        .sort((a, b) => b.mt - a.mt);
      if (files.length > 0) { this.log.debug(`Fallback session: ${path.basename(files[0].fp)}`); return files[0].fp; }
    } catch (e) { this.log.error(`Failed to list sessions dir: ${e.message}`); }
    return null;
  }

  async readLocalReply(sessionFile, afterTimestamp) {
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

  // ---- Reply Polling (Local or Remote) ----

  async pollForReply(afterTimestamp, maxWaitMs = 300000) {
    const oc = this.cfg.openclaw;
    const interval = 1500;
    const maxAttempts = Math.ceil(maxWaitMs / interval);

    if (oc.sessionsDir) {
      // Local mode
      const sessionFile = this.getLocalMainSessionFile(oc.sessionsDir);
      if (!sessionFile) { this.log.error("No local session file found."); return null; }
      this.log.info(`📂 Polling local session: ${path.basename(sessionFile)}`);
      for (let i = 0; i < maxAttempts; i++) {
        await new Promise((r) => setTimeout(r, interval));
        const reply = await this.readLocalReply(sessionFile, afterTimestamp);
        if (reply) return reply;
      }
    } else {
      // Remote mode via session-proxy
      const proxyHost = oc.host;
      const proxyPort = oc.proxyPort || (oc.port + 1);
      const proxyToken = oc.proxyAuthToken || null;
      const url = `http://${proxyHost}:${proxyPort}/session/latest?after=${afterTimestamp.toISOString()}`;
      const headers = proxyToken ? { Authorization: `Bearer ${proxyToken}` } : {};
      this.log.info(`📡 Polling remote session proxy: ${proxyHost}:${proxyPort}`);
      for (let i = 0; i < maxAttempts; i++) {
        await new Promise((r) => setTimeout(r, interval));
        try {
          const res = await axios.get(url, { headers, timeout: 5000 });
          if (res.data && res.data.reply) return res.data.reply;
        } catch (e) {
          if (e.code !== "ECONNREFUSED" && e.response?.status !== 404)
            this.log.warn(`Proxy poll error: ${e.message}`);
        }
      }
    }
    return null;
  }

  // ---- Message Queue & Core Handler ----

  enqueue(userId, msgType, content, mediaId) {
    this._queue.push({ userId, msgType, content, mediaId });
    this._processQueue();
  }

  async _processQueue() {
    if (this._busy || this._queue.length === 0) return;
    this._busy = true;
    const item = this._queue.shift();
    try {
      await this._handleMessage(item);
    } catch (e) {
      this.log.error(`Unhandled error: ${e.message}`);
      try { await this.sendTextToWecom(item.userId, "An unexpected error occurred."); } catch {}
    }
    this._busy = false;
    this._processQueue();
  }

  async _handleMessage({ userId, msgType, content, mediaId }) {
    this.log.info(`📩 Processing | User: ${userId} | Type: ${msgType} | Content: ${content || "(none)"}`);

    let messageText = content || "";
    if (mediaId) {
      const filePath = await this.downloadMedia(mediaId, msgType);
      if (filePath) messageText = `[${msgType.toUpperCase()}:${filePath}] ` + (content || "");
    }

    const sendTime = new Date();
    const ok = await this.wakeOpenClaw(
      `【WeCom Message | Channel: ${this.cfg.id}】User ${userId} says: ${messageText}`
    );
    if (!ok) {
      await this.sendTextToWecom(userId, "The service is temporarily unavailable. Please try again later.");
      return;
    }

    await new Promise((r) => setTimeout(r, 2000));

    const reply = await this.pollForReply(sendTime);
    if (reply) {
      this.log.info(`💬 Reply: ${reply.substring(0, 100)}${reply.length > 100 ? "..." : ""}`);
      await this.sendReplyToWecom(userId, reply);
    } else {
      this.log.warn(`⏰ Timed out waiting for reply (user: ${userId})`);
      await this.sendTextToWecom(userId, "The request timed out. Please try again later.");
    }
  }

  // ---- Express Request Handler ----

  handleRequest(req, res) {
    this.log.debug(`★ ${req.method} ${req.path}`);
    const { echostr } = req.query;

    if (req.method === "GET") {
      try {
        const decrypted = this.cryptor.decrypt(echostr);
        this.log.info("✅ URL validation successful.");
        return res.send(decrypted.message);
      } catch (e) {
        this.log.error(`❌ URL validation failed: ${e.message}`);
        return res.status(400).send("Validation failed");
      }
    }

    if (req.method === "POST") {
      res.status(200).send("success"); // Must respond within 5s
      try {
        const xmlData = req.body.toString("utf-8");
        const parsed = this.xmlParser.parse(xmlData);
        const encrypted = parsed.xml?.Encrypt;
        if (!encrypted) { this.log.error("No Encrypt field in message"); return; }
        const decrypted = this.cryptor.decrypt(encrypted);
        const message = this.xmlParser.parse(decrypted.message).xml;
        this.log.info(`📩 Message type: ${message.MsgType} | From: ${message.FromUserName}`);

        const userId = message.FromUserName;
        switch (message.MsgType) {
          case "text":  this.enqueue(userId, "text",  message.Content, null); break;
          case "image": this.enqueue(userId, "image", "[收到图片]",     message.MediaId); break;
          case "voice": this.enqueue(userId, "voice", "[收到语音]",     message.MediaId); break;
          case "video": this.enqueue(userId, "video", "[收到视频]",     message.MediaId); break;
          case "file":  this.enqueue(userId, "file",  "[收到文件]",     message.MediaId); break;
          default: this.log.debug(`Unsupported message type: ${message.MsgType} (ignored)`);
        }
      } catch (e) {
        this.log.error(`Failed to decrypt/parse message: ${e.message}`);
      }
    }
  }
}

// ============================================================
// Main Entry Point
// ============================================================

function main() {
  const configPath = path.resolve(process.env.CHANNELS_CONFIG || path.join(__dirname, "channels.json"));
  let config;
  try {
    config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  } catch (e) {
    console.error(`FATAL: Could not load config from ${configPath}: ${e.message}`);
    process.exit(1);
  }

  const bridgeCfg = config.bridge || {};
  const logDir = bridgeCfg.logDir || path.join(__dirname, "logs");
  const port = bridgeCfg.port || 3000;

  const globalLog = new Logger(logDir, "bridge");
  globalLog.info(`Loading config from: ${configPath}`);

  if (!Array.isArray(config.channels) || config.channels.length === 0) {
    globalLog.error("FATAL: No channels defined in channels.json");
    process.exit(1);
  }

  const app = express();
  app.use(express.raw({ type: "*/*", limit: "15mb" }));

  // Health check endpoint
  app.get("/health", (req, res) => {
    res.json({ status: "ok", channels: config.channels.map((c) => c.id), timestamp: new Date().toISOString() });
  });

  for (const channelCfg of config.channels) {
    // Validate required fields
    const required = ["id", "path", "wecom.token", "wecom.aesKey", "wecom.corpId", "wecom.corpSecret", "wecom.agentId", "openclaw.host", "openclaw.port", "openclaw.token"];
    const missing = required.filter((k) => {
      const parts = k.split(".");
      let obj = channelCfg;
      for (const p of parts) { if (!obj || obj[p] === undefined) return true; obj = obj[p]; }
      return false;
    });
    if (missing.length > 0) {
      globalLog.error(`Channel "${channelCfg.id}" is missing required fields: ${missing.join(", ")} — SKIPPED`);
      continue;
    }

    const channelLog = new Logger(logDir, channelCfg.id);
    const channel = new WeComChannel(channelCfg, channelLog);
    app.all(channelCfg.path, (req, res) => channel.handleRequest(req, res));
    globalLog.info(`Registered channel "${channelCfg.id}" at ${channelCfg.path} → OpenClaw ${channelCfg.openclaw.host}:${channelCfg.openclaw.port}`);
  }

  app.listen(port, () => {
    globalLog.info(`\n🚀 Multi-Channel Bridge v3.0.0 started on port ${port}`);
    globalLog.info(`   Health check: http://localhost:${port}/health`);
    globalLog.info(`   Log directory: ${logDir}`);
    globalLog.info(`   Channels: ${config.channels.map((c) => `${c.id} → ${c.path}`).join(", ")}`);
  });
}

main();
