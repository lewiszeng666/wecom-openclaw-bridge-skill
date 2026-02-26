require("dotenv").config();

const express = require("express");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const readline = require("readline");
const FormData = require("form-data");
const { XMLParser } = require("fast-xml-parser");
const WXBizMsgCrypt = require("wechat-crypto");

// ============================================================
// Configuration — loaded from .env (see .env.example)
// ============================================================
const CONFIG = {
  WECOM_TOKEN:    process.env.WECOM_TOKEN,
  WECOM_AES_KEY:  process.env.WECOM_AES_KEY,
  CORP_ID:        process.env.CORP_ID,
  CORP_SECRET:    process.env.CORP_SECRET,
  AGENT_ID:       parseInt(process.env.AGENT_ID || "1000000", 10),
  OPENCLAW_TOKEN: process.env.OPENCLAW_TOKEN,
  OPENCLAW_PORT:  parseInt(process.env.OPENCLAW_PORT || "18789", 10),
  BRIDGE_PORT:    parseInt(process.env.BRIDGE_PORT || "3000", 10),
  SESSIONS_DIR:   process.env.SESSIONS_DIR || "/home/ubuntu/.openclaw/agents/main/sessions",
};

// Validate required config values on startup
const REQUIRED = ["WECOM_TOKEN", "WECOM_AES_KEY", "CORP_ID", "CORP_SECRET", "OPENCLAW_TOKEN"];
const missing = REQUIRED.filter((k) => !CONFIG[k]);
if (missing.length > 0) {
  console.error(`\n❌ Missing required environment variables: ${missing.join(", ")}`);
  console.error("   Please copy .env.example to .env and fill in all required values.\n");
  process.exit(1);
}
// ============================================================

const cryptor = new WXBizMsgCrypt(CONFIG.WECOM_TOKEN, CONFIG.WECOM_AES_KEY, CONFIG.CORP_ID);
const xmlParser = new XMLParser();
const app = express();
app.use(express.raw({ type: "*/*" }));

// --- Get WeCom Access Token ---
async function getAccessToken() {
  const res = await axios.get(
    `https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${CONFIG.CORP_ID}&corpsecret=${CONFIG.CORP_SECRET}`
  );
  if (res.data.errcode && res.data.errcode !== 0) {
    throw new Error(`Failed to get AccessToken: ${res.data.errmsg}`);
  }
  return res.data.access_token;
}

// --- Send Text Message to WeCom ---
async function sendTextToWecom(userId, text) {
  try {
    const accessToken = await getAccessToken();
    const res = await axios.post(
      `https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${accessToken}`,
      { touser: userId, msgtype: "text", agentid: CONFIG.AGENT_ID, text: { content: text } }
    );
    console.log("✅ Text sent to:", userId, "| WeCom API response:", JSON.stringify(res.data));
  } catch (e) {
    console.error("❌ Failed to send text message:", e.message);
  }
}

// --- Upload and Send Image to WeCom ---
async function sendImageToWecom(userId, imagePath) {
  try {
    if (!fs.existsSync(imagePath)) {
      console.error("❌ Image file not found:", imagePath);
      await sendTextToWecom(userId, `Image file not found: ${imagePath}`);
      return;
    }
    const accessToken = await getAccessToken();
    const form = new FormData();
    form.append("media", fs.createReadStream(imagePath), {
      filename: path.basename(imagePath),
      contentType: "image/png",
    });
    const uploadRes = await axios.post(
      `https://qyapi.weixin.qq.com/cgi-bin/media/upload?access_token=${accessToken}&type=image`,
      form,
      { headers: form.getHeaders() }
    );
    if (uploadRes.data.errcode && uploadRes.data.errcode !== 0) {
      throw new Error(`Failed to upload image: ${uploadRes.data.errmsg}`);
    }
    const mediaId = uploadRes.data.media_id;
    console.log("📎 Image uploaded, media_id:", mediaId);
    const sendRes = await axios.post(
      `https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${accessToken}`,
      { touser: userId, msgtype: "image", agentid: CONFIG.AGENT_ID, image: { media_id: mediaId } }
    );
    console.log("✅ Image sent to:", userId, "| WeCom API response:", JSON.stringify(sendRes.data));
  } catch (e) {
    console.error("❌ Failed to send image:", e.message);
    await sendTextToWecom(userId, `Failed to send image: ${e.message}`);
  }
}

// --- Parse AI reply to separate text and images ---
function parseReply(rawText) {
  const finalMatch = rawText.match(/<final>([\s\S]*?)<\/final>/);
  const text = finalMatch ? finalMatch[1].trim() : rawText.trim();
  const imagePaths = [...text.matchAll(/\[IMAGE:(.*?)\]/g)].map((m) => m[1].trim());
  const textOnly = text.replace(/\[IMAGE:.*?\]/g, "").trim();
  return { textOnly, imagePaths };
}

// --- Send final reply (text + images) to WeCom ---
async function sendReplyToWecom(userId, rawReply) {
  const { textOnly, imagePaths } = parseReply(rawReply);
  if (textOnly) await sendTextToWecom(userId, textOnly);
  for (const imgPath of imagePaths) await sendImageToWecom(userId, imgPath);
  if (!textOnly && imagePaths.length === 0)
    await sendTextToWecom(userId, "(Received an empty reply)");
}

// --- Get the latest assistant reply from a session file ---
async function getLatestAssistantReply(sessionFile, afterTimestamp) {
  return new Promise((resolve) => {
    const lines = [];
    const rl = readline.createInterface({ input: fs.createReadStream(sessionFile), crlfDelay: Infinity });
    rl.on("line", (line) => { try { lines.push(JSON.parse(line)); } catch {} });
    rl.on("close", () => {
      const reply = lines.find(
        (l) =>
          l.type === "message" &&
          l.message?.role === "assistant" &&
          new Date(l.timestamp) > afterTimestamp &&
          l.message.content?.some((c) => c.type === "text")
      );
      if (reply) {
        const textContent = reply.message.content.find((c) => c.type === "text");
        resolve(textContent ? textContent.text : null);
      } else {
        resolve(null);
      }
    });
  });
}

// --- Poll for OpenClaw's reply (up to maxWaitMs) ---
async function waitForReply(sessionFile, afterTimestamp, maxWaitMs = 60000) {
  const interval = 1500;
  for (let i = 0; i < Math.ceil(maxWaitMs / interval); i++) {
    await new Promise((r) => setTimeout(r, interval));
    const reply = await getLatestAssistantReply(sessionFile, afterTimestamp);
    if (reply) return reply;
  }
  return null;
}

// --- Find the most recently modified session file ---
function getLatestSessionFile() {
  try {
    const files = fs
      .readdirSync(CONFIG.SESSIONS_DIR)
      .filter((f) => f.endsWith(".jsonl"))
      .map((f) => ({ fullPath: path.join(CONFIG.SESSIONS_DIR, f), mtime: fs.statSync(path.join(CONFIG.SESSIONS_DIR, f)).mtime }))
      .sort((a, b) => b.mtime - a.mtime);
    return files.length > 0 ? files[0].fullPath : null;
  } catch (e) {
    console.error("❌ Failed to read sessions directory:", e.message);
    return null;
  }
}

// --- Main handler for WeCom messages ---
async function handleWecomMessage(userId, text) {
  console.log(`\n📩 Processing message | User: ${userId} | Content: ${text}`);
  const sendTime = new Date();

  try {
    const wakeRes = await axios.post(
      `http://127.0.0.1:${CONFIG.OPENCLAW_PORT}/hooks/wake`,
      { text: `【WeCom Message】User ${userId} says: ${text}`, mode: "now" },
      { headers: { Authorization: `Bearer ${CONFIG.OPENCLAW_TOKEN}`, "Content-Type": "application/json" } }
    );
    console.log("📤 Woke up OpenClaw, status:", wakeRes.status, "| Waiting for reply...");
  } catch (e) {
    console.error("❌ Failed to wake OpenClaw:", e.message);
    await sendTextToWecom(userId, "The service is temporarily unavailable. Please try again later.");
    return;
  }

  await new Promise((r) => setTimeout(r, 2000));

  const sessionFile = getLatestSessionFile();
  if (!sessionFile) {
    console.error("❌ Could not find session file.");
    await sendTextToWecom(userId, "Service error. Please try again later.");
    return;
  }
  console.log("📂 Polling session file:", path.basename(sessionFile));

  const reply = await waitForReply(sessionFile, sendTime, 60000);
  if (reply) {
    console.log("💬 OpenClaw reply:", reply.substring(0, 100) + (reply.length > 100 ? "..." : ""));
    await sendReplyToWecom(userId, reply);
  } else {
    console.error("⏰ Timed out (60s) waiting for OpenClaw reply.");
    await sendTextToWecom(userId, "The request timed out. Please try again later.");
  }
}

// --- WeCom Webhook Endpoint ---
app.all("/wecom", (req, res) => {
  console.log(`\n★ Received request: ${req.method} at ${new Date().toISOString()}`);
  const { echostr } = req.query;

  if (req.method === "GET") {
    try {
      const decrypted = cryptor.decrypt(echostr);
      console.log("✅ URL validation successful.");
      return res.send(decrypted.message);
    } catch (e) {
      console.error("❌ URL validation failed:", e.message);
      return res.status(400).send("Validation failed");
    }
  }

  if (req.method === "POST") {
    res.status(200).send("success");
    try {
      const xmlData = req.body.toString("utf-8");
      const parsed = xmlParser.parse(xmlData);
      const encrypted = parsed.xml?.Encrypt;
      if (!encrypted) { console.error("❌ No Encrypt field in message"); return; }

      const decrypted = cryptor.decrypt(encrypted);
      const message = xmlParser.parse(decrypted.message).xml;
      console.log("📩 Message type:", message.MsgType, "| From:", message.FromUserName);

      if (message.MsgType === "text") {
        handleWecomMessage(message.FromUserName, message.Content).catch((e) => {
          console.error("❌ Error during message handling:", e.message);
        });
      } else {
        console.log("⚠️ Unsupported message type:", message.MsgType, "(ignored)");
      }
    } catch (e) {
      console.error("❌ Failed to decrypt/parse message:", e.message);
    }
  }
});

// --- Start the server ---
app.listen(CONFIG.BRIDGE_PORT, () => {
  console.log(`\n🚀 Webhook Bridge started, listening on port ${CONFIG.BRIDGE_PORT}`);
  console.log(`   WeCom callback URL: http://YOUR_SERVER_IP:${CONFIG.BRIDGE_PORT}/wecom`);
  console.log(`   Watching Sessions Dir: ${CONFIG.SESSIONS_DIR}`);
});
