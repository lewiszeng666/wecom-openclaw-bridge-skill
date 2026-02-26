# OpenClaw & WeChat Work (WeCom) Integration Skill

[![ClawHub](https://img.shields.io/badge/ClawHub-wecom--openclaw--bridge-blue)](https://clawhub.club/skills/wecom-openclaw-bridge) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

This repository contains a standard OpenClaw Skill for integrating WeChat Work (also known as WeCom) with your OpenClaw agent. It enables seamless, bidirectional communication, allowing you to chat with your agent and receive responses (including text and images) directly within your WeCom application.

The integration is designed for stability and reliability, using a webhook bridge that polls OpenClaw's session logs instead of relying on direct AI callbacks, which can be prone to timeouts.

## Features

- **Stable & Reliable**: Uses a robust polling mechanism for message retrieval.
- **Text & Image Support**: Send and receive both text and image messages.
- **Easy Deployment**: A simple, three-step setup process gets you up and running in minutes.
- **Non-Intrusive**: No modifications to the OpenClaw core are required.
- **Self-Hosted**: The entire communication bridge runs on your own server, ensuring data privacy.

## How It Works

The communication flows as follows:

```
WeCom User → WeCom Server → [Public Internet] → Your Server (Webhook Bridge) → [Local] → OpenClaw Agent
```

The `bridge.js` middleware handles:
1.  Receiving and decrypting messages from WeCom.
2.  Waking up the OpenClaw agent with the user's query.
3.  Polling the agent's session logs for the latest reply.
4.  Parsing the reply (including text and image paths).
5.  Uploading images to WeCom's temporary media storage.
6.  Sending the final text and image(s) back to the user.

## Installation

### Prerequisites

- A server with OpenClaw already installed and running.
- A public IP address for your server.
- Node.js (v16+) and npm installed.
- Admin access to your WeChat Work (WeCom) account.

### Setup Guide

Full, detailed instructions are available in the [SKILL.md](SKILL.md) file. The process involves:

1.  **Configuring your WeCom App**: Create a new app and obtain the necessary credentials (`CorpID`, `AgentId`, `Secret`, `Token`, `EncodingAESKey`).
2.  **Deploying the Webhook Bridge**: Copy the `scripts/bridge.js` and `scripts/package.json` to your server, run `npm install`, and fill in your credentials in the `CONFIG` section of `bridge.js`.
3.  **Configuring OpenClaw**: Enable webhooks in your `openclaw.json` and create a simple `wecom-replier` skill to instruct the agent on how to format image replies.

## Usage

Once deployed, you can start a conversation with your OpenClaw agent by sending a message to the custom application you created in WeCom.

To have the agent send an image, the agent's response text must include a special tag:

```
Here is the screenshot you requested: [IMAGE:/path/to/your/image.png]
```

The bridge will automatically detect this tag, upload the specified image file, and send it to the user.

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.
