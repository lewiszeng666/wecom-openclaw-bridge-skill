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

If you generate or capture an image file, append the following tag at the end of your text reply:

\`[IMAGE:/absolute/path/to/image.png]\`

Example: Here is the screenshot you requested. \`[IMAGE:/tmp/screenshot.png]\`

The webhook bridge will automatically detect this tag, upload the image, and deliver it to the user.
`;

  fs.writeFileSync(skillFile, content, "utf-8");
  ok(`wecom-replier skill created at: ${skillFile}`);
}
// ── 4. Detect sessions directory ─────────────────────────────────
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

  // Step 4: Create .env
  createEnvFile(token);

  // Step 5: Detect public IP
  info("Detecting public IP address...");
  const bridgePort = process.env.BRIDGE_PORT || "3000";
  const publicIp   = await getPublicIp();
  const callbackUrl = publicIp
    ? `http://${publicIp}:${bridgePort}/wecom`
    : `http://YOUR_SERVER_IP:${bridgePort}/wecom`;
  if (publicIp) ok(`Public IP detected: ${publicIp}`);
  else warn("Could not detect public IP (no internet access?). Fill in manually.");

  // Step 6: Detect sessions directory
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
