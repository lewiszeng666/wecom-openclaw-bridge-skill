# OpenClaw & WeChat Work (WeCom) Integration Skill

[![ClawHub](https://img.shields.io/badge/ClawHub-wecom--openclaw--bridge-blue)](https://clawhub.club/skills/wecom-openclaw-bridge) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

This repository contains a standard OpenClaw Skill for integrating WeChat Work (WeCom) with your OpenClaw agent. It enables seamless, bidirectional communication, allowing you to chat with your agent and receive responses (including text and images) directly within your WeCom application.

## Features

- **Stable & Reliable**: Uses a robust session-log polling mechanism instead of fragile AI callbacks.
- **Text & Image Support**: Send and receive both text and image messages.
- **Secure by Default**: All credentials live in a `.env` file that is excluded from version control via `.gitignore`.
- **Easy Deployment**: A simple, three-step setup process.
- **Non-Intrusive**: No modifications to the OpenClaw core are required.

## How It Works

```
WeCom User → WeCom Server → [Public Internet] → Your Server (bridge.js) → [Local] → OpenClaw Agent
```

The `bridge.js` middleware handles:
1.  Receiving and decrypting messages from WeCom.
2.  Waking up the OpenClaw agent with the user's query.
3.  Polling the agent's session logs for the latest reply.
4.  Parsing the reply (including text and image paths).
5.  Uploading images to WeCom's temporary media storage.
6.  Sending the final text and image(s) back to the user.

## Repository Structure

```
wecom-openclaw-bridge-skill/
├── .gitignore            # Prevents .env from being committed
├── SKILL.md              # ClawHub skill definition
├── README.md             # This file
├── LICENSE               # MIT License
└── scripts/
    ├── bridge.js         # Webhook middleware (main program)
    ├── package.json      # Node.js dependencies
    └── .env.example      # Configuration template — copy to .env and fill in
```

## Quick Start

### Prerequisites

- A server with OpenClaw installed and running.
- A public IP address for your server.
- Node.js (v16+) and npm installed.
- Admin access to your WeChat Work account.

### Setup

```bash
# 1. Copy the scripts/ folder to your server, then install dependencies
cd scripts/
npm install

# 2. Create your config file from the template
cp .env.example .env

# 3. Edit .env and fill in your credentials
nano .env

# 4. Start the bridge
npm start
```

Full step-by-step instructions (including WeCom backend configuration and OpenClaw setup) are in [SKILL.md](SKILL.md).

## Configuration

All configuration is done in the `scripts/.env` file. Copy `scripts/.env.example` to `scripts/.env` and fill in your values. **Never commit your `.env` file.**

| Variable | Required | Description |
|---|---|---|
| `WECOM_TOKEN` | Yes | WeCom App API Token |
| `WECOM_AES_KEY` | Yes | WeCom App EncodingAESKey |
| `CORP_ID` | Yes | Your WeCom Corporation ID |
| `CORP_SECRET` | Yes | Your WeCom App Secret |
| `AGENT_ID` | Yes | Your WeCom App AgentId |
| `OPENCLAW_TOKEN` | Yes | The `hooks.token` from `openclaw.json` |
| `BRIDGE_PORT` | No | Port for the bridge (default: `3000`) |
| `OPENCLAW_PORT` | No | OpenClaw webhook port (default: `18789`) |
| `SESSIONS_DIR` | No | Path to OpenClaw sessions directory |

## Usage

Once deployed, send a message to your WeCom custom app to start a conversation with your OpenClaw agent.

To have the agent send an image, include this tag in its response:

```
Here is the screenshot: [IMAGE:/path/to/your/image.png]
```

The bridge will automatically upload the image and send it to the user.

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.
