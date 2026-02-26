---
name: wecom-openclaw-bridge
description: Integrates WeChat Work (WeCom) with OpenClaw for bidirectional messaging (text & images).
homepage: https://github.com/lewiszeng666/wecom-openclaw-bridge-skill
version: 1.0.0
metadata:
  clawdbot:
    emoji: "💼"
    requires:
      env:
        - WECOM_TOKEN
        - WECOM_AES_KEY
        - CORP_ID
        - CORP_SECRET
        - AGENT_ID
        - OPENCLAW_TOKEN
      bins:
        - node
        - npm
    files:
      - scripts/bridge.js
---

# WeChat Work (WeCom) ↔ OpenClaw Integration Skill

This skill helps developers quickly deploy a middleware bridge on a server with an existing OpenClaw installation. It connects a custom WeChat Work (WeCom) application to OpenClaw, enabling stable, reliable, bidirectional messaging with support for both text and images.

## Features

- **Stable & Reliable**: Uses a polling mechanism to check OpenClaw's session logs, avoiding the unreliability and timeouts associated with AI-initiated callbacks.
- **Full-Featured**: Supports sending and receiving both text and image messages.
- **Simple Deployment**: Get up and running in three easy steps with a single configuration file.
- **Non-Intrusive**: Requires no modifications to the OpenClaw core code.

## Architecture

```
WeCom User → WeCom Server → [Public Internet] → Webhook Bridge (Node.js) → [Local Network] → OpenClaw
```

## Prerequisites

- A server with OpenClaw already installed and running.
- A public IP address for the server.
- Node.js (v16+) and npm installed.
- Administrator access to your WeChat Work backend.

---

## Three-Step Deployment Guide

### Step 1: Configure WeChat Work Backend

1.  Log in to the [WeChat Work Admin Console](https://work.weixin.qq.com/wework_admin/frame).
2.  Navigate to **App Management** → **Custom** → **Create App**.
3.  Upload an app logo, enter an app name (e.g., "OpenClaw Assistant"), and set its visibility.
4.  After creation, note the `AgentId` and `Secret`.
5.  Go to **My Company** → **Company Information** and note the `Corporation ID (CorpID)` at the bottom of the page.
6.  Return to the app details page, find **Receive Messages** → **Set API**.
7.  **URL**: Leave this blank for now. You will fill this in after completing Step 2.
8.  **Token**: Click "Generate" and copy the value.
9.  **EncodingAESKey**: Click "Generate" and copy the value.
10. **Do not click "Save" yet**.

### Step 2: Deploy the Webhook Bridge

1.  Copy the `scripts/bridge.js` and `scripts/package.json` files from this skill to a directory on your server, e.g., `/home/ubuntu/wecom-bridge`.
2.  Navigate into that directory and install the dependencies:
    ```bash
    npm install
    ```
3.  Edit the `bridge.js` file and modify the `CONFIG` object at the top, filling in the 6 values obtained in Step 1:

| Variable | Source |
|---|---|
| `WECOM_TOKEN` | The Token generated in the WeCom backend. |
| `WECOM_AES_KEY` | The EncodingAESKey generated in the WeCom backend. |
| `CORP_ID` | Your Corporation ID. |
| `CORP_SECRET` | Your app's Secret. |
| `AGENT_ID` | Your app's AgentId (as a number). |
| `OPENCLAW_TOKEN` | The `hooks.token` value from `~/.openclaw/openclaw.json`. |

4.  Verify that the `SESSIONS_DIR` path is correct. If you installed OpenClaw as a user other than `ubuntu`, update the path accordingly (e.g., `/root/.openclaw/agents/main/sessions`).

5.  Start the bridge service. Using a process manager like `pm2` is recommended to keep it running in the background.
    ```bash
    npm install -g pm2
    pm2 start bridge.js --name wecom-bridge
    ```

6.  Return to the WeChat Work admin console. On the **Set API** page, enter `http://YOUR_PUBLIC_IP:3000/wecom` as the URL, then click **Save**.
    *   If you have a firewall or a cloud provider security group, ensure that TCP traffic on port `3000` is allowed.
    *   Upon successful saving, you should see a `✅ URL validation successful` message in the bridge's logs (`pm2 logs wecom-bridge`).

### Step 3: Configure OpenClaw

1.  **Enable Webhooks**: Edit `~/.openclaw/openclaw.json` to ensure hooks are enabled and a token is set. This token must match the `OPENCLAW_TOKEN` in `bridge.js`.
    ```json
    {
      "hooks": {
        "enabled": true,
        "token": "a_very_long_and_random_string_you_generate"
      }
    }
    ```
2.  **Create a Replier Skill**: To teach OpenClaw how to reply with images, create a simple skill.
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
3.  **Restart OpenClaw** to apply the new configuration and skill:
    ```bash
    openclaw gateway restart
    ```

---

## Security & Privacy

- **Data Flow**: Your messages are relayed through the `bridge.js` service on your server to OpenClaw. Replies from OpenClaw are sent back to WeChat Work via the same bridge. All communication is routed through your own server.
- **Credential Security**: Sensitive information like `WECOM_SECRET` and `OPENCLAW_TOKEN` is stored in the `bridge.js` file on your server. Please ensure your server is secure.
- **External Endpoints**: The `bridge.js` script in this skill accesses the following external endpoints:
    - `https://qyapi.weixin.qq.com`: Used to get access tokens, send messages, and upload temporary media files.

## Trust Statement

By installing and using this skill, you understand and agree that your WeChat Work message data will be processed by the `bridge.js` service that you deploy and will be sent to your OpenClaw instance. Ensure you trust the security of the environment where you deploy this service.
