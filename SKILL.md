---
name: wecom-openclaw-bridge
description: Enterprise-grade bridge for multi-channel WeCom to multi-instance OpenClaw messaging.
homepage: https://github.com/lewiszeng666/wecom-openclaw-bridge-skill
version: 3.1.0
metadata:
  clawdbot:
    emoji: "🌉"
    requires:
      bins:
        - node
        - npm
    files:
      - scripts/bridge.js
      - scripts/session-proxy.js
      - scripts/channels.json.example
---
# WeChat Work (WeCom) ↔ OpenClaw Multi-Channel Bridge

This skill provides a robust, enterprise-grade bridge to connect one or more WeChat Work (WeCom) applications to one or more OpenClaw instances. It enables stable, bidirectional messaging (text & images) with support for both local and remote OpenClaw deployments.

## Three-Step Deployment Guide

Full setup instructions are in the [README.md](README.md) file.

### Step 1: Configure WeChat Work Backend

1.  Log in to the [WeChat Work Admin Console](https://work.weixin.qq.com/wework_admin/frame).
2.  Navigate to **App Management** → **Custom** → **Create App**.
3.  After creation, note the `AgentId` and `Secret`.
4.  Go to **My Company** → **Company Information** and note the `Corporation ID (CorpID)`.
5.  Return to the app details page, find **Receive Messages** → **Set API**.
6.  **URL**: Leave blank for now. Fill this in after Step 2.
7.  **Token**: Click "Generate" and copy the value.
8.  **EncodingAESKey**: Click "Generate" and copy the value.
9.  **Do not click "Save" yet.**

### Step 2: Deploy the Webhook Bridge

1.  Copy the `scripts/` folder to your server and install dependencies:
    ```bash
    cd scripts/
    npm install
    ```
2.  Create your configuration file:
    ```bash
    cp channels.json.example channels.json
    ```
3.  Edit `channels.json` and fill in your credentials.
4.  Start the bridge (using `pm2` for production):
    ```bash
    npm install -g pm2
    pm2 start bridge.js --name wecom-bridge
    ```
5.  Return to the WeCom admin console, enter `http://YOUR_PUBLIC_IP:3000/wecom/<channel-path>` as the URL, and click **Save**.

### Step 3: Configure OpenClaw

1.  **Enable Webhooks**: Ensure `hooks.enabled` is `true` in `~/.openclaw/openclaw.json` and that the `token` matches the one in `channels.json`.
2.  **Image Reply Skill**: To teach OpenClaw how to send images, create a simple skill:
    ```bash
    mkdir -p ~/.openclaw/workspace/skills/wecom-replier
    cat > ~/.openclaw/workspace/skills/wecom-replier/SKILL.md << 'EOF'
    ---
    name: wecom-replier
    description: Defines rules for replying to WeChat Work.
    ---
    ## Reply Rules
    When you need to reply with an image, append a special tag to the end of your text response: `[IMAGE:/path/to/your/image.png]`
    The webhook bridge will automatically detect this and send the image.
    EOF
    ```
3.  **Restart OpenClaw** to apply changes:
    ```bash
    openclaw gateway restart
    ```

## Remote OpenClaw Setup

If you have OpenClaw on a remote machine, deploy `session-proxy.js` on that machine. See the [README.md](README.md) for detailed instructions.
