#!/usr/bin/env node
// ============================================================
// setup.js — Auto-configures OpenClaw for the WeCom bridge.
// Runs automatically after `npm install` via the postinstall hook.
// ============================================================

const fs    = require("fs");
const path  = require("path");
const os    = require("os");
const crypto = require("crypto");
const https = require("https");
const http  = require("http");

const RESET  = "\x1b[0m";
const GREEN  = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED    = "\x1b[31m";
const CYAN   = "\x1b[36m";
const BOLD   = "\x1b[1m";

function ok(msg)   { console.log(`${GREEN}  ✅ ${msg}${RESET}`); }
function warn(msg) { console.log(`${YELLOW}  ⚠️  ${msg}${RESET}`); }
function info(msg) { console.log(`${CYAN}  ℹ️  ${msg}${RESET}`); }
function fail(msg) { console.log(`${RED}  ❌ ${msg}${RESET}`); }
function hr()      { console.log("─".repeat(60)); }

// ── 0. Auto-detect public IP ─────────────────────────────────
function getPublicIp() {
  return new Promise((resolve) => {
    // Try multiple public IP services in order
    const services = [
      { host: "api4.ipify.org",  path: "/",    ssl: true  },
      { host: "ipv4.icanhazip.com", path: "/", ssl: true  },
      { host: "checkip.amazonaws.com", path: "/", ssl: true },
    ];
    let tried = 0;
    function tryNext() {
      if (tried >= services.length) { resolve(null); return; }
      const svc = services[tried++];
      const req = (svc.ssl ? https : http).get(
        { host: svc.host, path: svc.path, timeout: 3000 },
        (res) => {
          let data = "";
          res.on("data", (c) => (data += c));
          res.on("end", () => {
            const ip = data.trim();
            if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) resolve(ip);
            else tryNext();
          });
        }
      );
      req.on("error", tryNext);
      req.on("timeout", () => { req.destroy(); tryNext(); });
    }
    tryNext();
  });
}

// ── 1. Detect OpenClaw home directory ────────────────────────
function detectOpenClawHome() {
  const candidates = [
    path.join(os.homedir(), ".openclaw"),
    "/root/.openclaw",
    "/home/ubuntu/.openclaw",
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

// ── 2. Configure openclaw.json (enable hooks + set token) ────
function configureOpenClawJson(openclawHome) {
  const configPath = path.join(openclawHome, "openclaw.json");

  let config = {};
  if (fs.existsSync(configPath)) {
    try {
      config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    } catch (e) {
      warn(`Could not parse ${configPath}: ${e.message}`);
      return null;
    }
  }

  // Check if hooks already configured
  if (config.hooks && config.hooks.enabled && config.hooks.token) {
    ok(`openclaw.json hooks already configured (token exists).`);
    return config.hooks.token;
  }

  // Generate a secure random token
  const token = crypto.randomBytes(32).toString("hex");

  config.hooks = {
    ...(config.hooks || {}),
    enabled: true,
    token:   token,
  };

  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
  ok(`openclaw.json updated: hooks enabled with a new token.`);
  return token;
}

// ── 3. Create wecom-replier skill ────────────────────────────
function createWecomReplierSkill(openclawHome) {
  const skillDir  = path.join(openclawHome, "workspace", "skills", "wecom-replier");
  const skillFile = path.join(skillDir, "SKILL.md");

  if (fs.existsSync(skillFile)) {
    ok(`wecom-replier skill already exists, skipping.`);
    return;
  }

  fs.mkdirSync(skillDir, { recursive: true });

  const content = `---
name: wecom-replier
description: Defines reply formatting rules for WeChat Work (WeCom) messages.
---

## Reply Rules

When responding to a \`【WeCom Message】\`, reply normally. Do not execute any curl commands.

## Sending Media

Append special tags at the end of your text reply to send media files:

| 类型 | 格式 | 示例 |
|------|------|------|
| 🖼️ 图片 | \`[IMAGE:/绝对路径/图片.png]\` | \`[IMAGE:/tmp/screenshot.png]\` |
| 🎤 语音 | \`[VOICE:/绝对路径/语音.amr]\` | \`[VOICE:/tmp/recording.amr]\` |
| 🎬 视频 | \`[VIDEO:/绝对路径/视频.mp4]\` | \`[VIDEO:/tmp/clips.mp4]\` |
| 📎 文件 | \`[FILE:/绝对路径/文件.pdf]\` | \`[FILE:/tmp/doc.pdf]\` |

### 注意

- 语音仅支持 **amr** 格式
- 图片支持 **png/jpg**
- 视频支持 **mp4**
- 文件会通过 WeCom API 发送

The webhook bridge will automatically detect these tags and deliver the files.
`;

  fs.writeFileSync(skillFile, content, "utf-8");
  ok(`wecom-replier skill created at: ${skillFile}`);
}

// ── 4. Update TOOLS.md ─────────────────────────────────────────
function updateToolsMd(openclawHome) {
  const toolsPath = path.join(openclawHome, "workspace", "TOOLS.md");
  const templatePath = path.join(__dirname, "TOOLS.md.template");

  let bridgeSection = "";
  if (fs.existsSync(templatePath)) {
    bridgeSection = fs.readFileSync(templatePath, "utf-8");
    // Replace placeholders
    const bridgePath = path.join(__dirname, "bridge.js");
    const bridgePort = process.env.BRIDGE_PORT || "3000";
    bridgeSection = bridgeSection
      .replace(/\{\{BRIDGE_PATH\}\}/g, bridgePath)
      .replace(/\{\{BRIDGE_PORT\}\}/g, bridgePort);
  } else {
    // Fallback: inline content
    warn("TOOLS.md.template not found, using inline content.");
    bridgeSection = `### WeCom Bridge

**Bridge 路径:** ${path.join(__dirname, "bridge.js")}
**端口:** ${process.env.BRIDGE_PORT || "3000"}

**发送格式:** [IMAGE:/path], [VOICE:/path.amr], [VIDEO:/path.mp4], [FILE:/path]
**接收格式:** ✅ 文字 ✅ 图片 ✅ 语音 ✅ 视频 ✅ 文件

**定时任务:** sessionTarget 设为 main

`;
  }

  let content = "";
  if (fs.existsSync(toolsPath)) {
    content = fs.readFileSync(toolsPath, "utf-8");
    if (content.includes("### WeCom Bridge")) {
      ok("TOOLS.md already has WeCom Bridge section, skipping.");
      return;
    }
  }

  content += "\n" + bridgeSection;
  fs.writeFileSync(toolsPath, content, "utf-8");
  ok("TOOLS.md updated with WeCom Bridge info.");
}

// ── 5. Detect sessions directory ─────────────────────────────────
function detectSessionsDir(openclawHome) {
  const sessionsPath = path.join(openclawHome, "agents", "main", "sessions");
  // The directory may not exist yet if no session has been run
  // Return it anyway — bridge.js will handle the case gracefully
  return sessionsPath;
}


// ── 5. Create .env from .env.example (if not exists) ───────────
function createEnvFile(token) {
  const envExample = path.join(__dirname, ".env.example");
  const envFile    = path.join(__dirname, ".env");

  if (fs.existsSync(envFile)) {
    ok(`.env already exists, skipping.`);
    return;
  }

  if (!fs.existsSync(envExample)) {
    warn(`.env.example not found, skipping .env creation.`);
    return;
  }

  let content = fs.readFileSync(envExample, "utf-8");

  // Pre-fill OPENCLAW_TOKEN with the generated token
  if (token) {
    content = content.replace(
      /^OPENCLAW_TOKEN=.*$/m,
      `OPENCLAW_TOKEN=${token}`
    );
  }

  fs.writeFileSync(envFile, content, "utf-8");
  ok(`.env created from .env.example.`);
  if (token) {
    ok(`OPENCLAW_TOKEN pre-filled in .env (matches openclaw.json).`);
  }
}

// ── Main ──────────────────────────────────────────────────────
async function main() {
  console.log(`\n${BOLD}🔧 WeCom ↔ OpenClaw Bridge — Setup${RESET}`);
  hr();

  // Step 1: Find OpenClaw
  const openclawHome = detectOpenClawHome();
  if (!openclawHome) {
    fail("OpenClaw installation not found (~/.openclaw).");
    warn("Please install OpenClaw first, then re-run: npm run setup");
    console.log("");
    process.exit(0); // Non-fatal: don't block npm install
  }
  ok(`OpenClaw found at: ${openclawHome}`);

  // Step 2: Configure openclaw.json
  const token = configureOpenClawJson(openclawHome);

  // Step 3: Create wecom-replier skill
  createWecomReplierSkill(openclawHome);

  // Step 4: Update TOOLS.md
  updateToolsMd(openclawHome);

  // Step 5: Create .env
  createEnvFile(token);

  // Step 6: Detect public IP
  info("Detecting public IP address...");
  const bridgePort = process.env.BRIDGE_PORT || "3000";
  const publicIp   = await getPublicIp();
  const callbackUrl = publicIp
    ? `http://${publicIp}:${bridgePort}/wecom`
    : `http://YOUR_SERVER_IP:${bridgePort}/wecom`;
  if (publicIp) ok(`Public IP detected: ${publicIp}`);
  else warn("Could not detect public IP (no internet access?). Fill in manually.");

  // Step 7: Detect sessions directory
  const sessionsDir = detectSessionsDir(openclawHome);
  ok(`Sessions directory: ${sessionsDir}`);

  // Summary
  hr();
  console.log(`\n${GREEN}${BOLD}Setup complete! Next steps:${RESET}\n`);

  console.log(`  ${BOLD}1.${RESET} Fill in your WeCom credentials in ${CYAN}scripts/.env${RESET}`);
  console.log(`     (WECOM_TOKEN, WECOM_AES_KEY, CORP_ID, CORP_SECRET, AGENT_ID)\n`);

  console.log(`  ${BOLD}2.${RESET} Restart OpenClaw to load the new wecom-replier skill:`);
  console.log(`     ${CYAN}openclaw gateway restart${RESET}\n`);

  console.log(`  ${BOLD}3.${RESET} Start the bridge:`);
  console.log(`     ${CYAN}npm start${RESET}  (or: pm2 start bridge.js --name wecom-bridge)\n`);

  console.log(`  ${BOLD}4.${RESET} Set the WeCom callback URL in the admin console:`);
  console.log(`     ${CYAN}${callbackUrl}${RESET}\n`);
}

main();
