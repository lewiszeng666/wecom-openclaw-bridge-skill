---
name: wecom-openclaw-bridge
description: Integrates WeChat Work (WeCom) with OpenClaw for bidirectional messaging (text & images).
homepage: https://github.com/lewiszeng666/wecom-openclaw-bridge-skill
version: 1.1.0
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
      - scripts/.env.example
---

# WeChat Work (WeCom) ↔ OpenClaw Integration Skill

This skill helps developers quickly deploy a middleware bridge on a server with an existing OpenClaw installation. It connects a custom WeChat Work (WeCom) application to OpenClaw, enabling stable, reliable, bidirectional messaging with support for both text and images.

## Features

- **Stable & Reliable**: Uses a polling mechanism to check OpenClaw's session logs, avoiding the unreliability and timeouts associated with AI-initiated callbacks.
- **Full-Featured**: Supports sending and receiving both text and image messages.
- **Secure by Default**: All credentials are stored in a `.env` file that is excluded from version control via `.gitignore`.
- **Simple Deployment**: Get up and running in three easy steps.
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
3.  After creation, note the `AgentId` and `Secret`.
4.  Go to **My Company** → **Company Information** and note the `Corporation ID (CorpID)`.
5.  Return to the app details page, find **Receive Messages** → **Set API**.
6.  **URL**: Leave blank for now. Fill this in after Step 2.
7.  **Token**: Click "Generate" and copy the value.
8.  **EncodingAESKey**: Click "Generate" and copy the value.
9.  **Do not click "Save" yet.**

### Step 2: Deploy the Webhook Bridge

1.  Copy the entire `scripts/` folder from this skill to your server, e.g., `/home/ubuntu/wecom-bridge`.
2.  Navigate into that directory and install dependencies:
    ```bash
    cd /home/ubuntu/wecom-bridge
    npm install
    ```
3.  Create your local configuration file from the template:
    ```bash
    cp .env.example .env
    ```
4.  Edit `.env` and fill in all required values:

    | Variable | Source |
    |---|---|
    | `WECOM_TOKEN` | Token generated in the WeCom backend. |
    | `WECOM_AES_KEY` | EncodingAESKey generated in the WeCom backend. |
    | `CORP_ID` | Your Corporation ID. |
    | `CORP_SECRET` | Your app's Secret. |
    | `AGENT_ID` | Your app's AgentId (a number). |
    | `OPENCLAW_TOKEN` | The `hooks.token` value from `~/.openclaw/openclaw.json`. |

5.  Start the bridge (using `pm2` for persistent background execution):
    ```bash
    npm install -g pm2
    pm2 start bridge.js --name wecom-bridge
    ```

6.  **Firewall / Security Group**: Ensure the following ports are configured correctly on your server or cloud provider:

    | Port | Direction | Action | Reason |
    |---|---|---|---|
    | **3000** (or your `BRIDGE_PORT`) | Inbound from public internet | **Open** | WeChat Work's servers must be able to reach the bridge. |
    | **18789** (OpenClaw gateway) | Inbound from public internet | **Keep closed** | OpenClaw only listens on localhost; exposing it publicly is a security risk. |

7.  **Trusted IP Whitelist**: In the WeCom Admin Console, go to **My Company** → **Security & Management** → **Trusted IPs**, and add your server's public IP address. Without this, the bridge will receive a `60020` error when trying to send messages back to users.
    > The bridge's startup log (`npm start`) will print the exact IP to add.

8.  Return to the WeCom admin console, enter `http://YOUR_PUBLIC_IP:3000/wecom` as the URL, and click **Save**. You should see `✅ URL validation successful` in the bridge logs (`pm2 logs wecom-bridge`).

### Step 3: Configure OpenClaw

1.  **Enable Webhooks**: Edit `~/.openclaw/openclaw.json`. The `hooks.token` here must match `OPENCLAW_TOKEN` in your `.env`.
    ```json
    {
      "hooks": {
        "enabled": true,
        "token": "a_very_long_and_random_string_you_generate"
      }
    }
    ```
2.  **Create a Replier Skill**: Teaches OpenClaw how to format image replies.
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

- **Credential Security**: All sensitive credentials (`WECOM_SECRET`, `OPENCLAW_TOKEN`, etc.) are stored in a `.env` file on your server. This file is listed in `.gitignore` and will never be committed to version control.
- **Data Flow**: Messages are relayed through the `bridge.js` service on your own server to your OpenClaw instance. No data passes through any third-party service.
- **External Endpoints**: `bridge.js` only communicates with `https://qyapi.weixin.qq.com` (WeChat Work's official API) and your local OpenClaw instance.

## Trust Statement

By installing and using this skill, you understand and agree that your WeChat Work message data will be processed by the `bridge.js` service that you deploy and will be sent to your OpenClaw instance. Ensure you trust the security of the environment where you deploy this service.

