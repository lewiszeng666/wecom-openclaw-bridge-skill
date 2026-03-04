# WeChat Work ↔ OpenClaw Bridge

[![ClawHub](https://img.shields.io/badge/ClawHub-wecom--openclaw--bridge-blue)](https://clawhub.club/skills/wecom-openclaw-bridge) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**Version: 3.1.0**

This project provides a robust, enterprise-grade bridge to connect one or more WeChat Work (WeCom) applications to one or more OpenClaw instances. It enables stable, bidirectional messaging (text & images) with support for both local and remote OpenClaw deployments.

![Architecture Diagram](https://your-image-host.com/architecture.png)  *(Placeholder for architecture diagram)*

---

## Features

- **Multi-Channel Routing**: Connect unlimited WeCom apps to different OpenClaw instances.
- **Local & Remote OpenClaw**: Supports OpenClaw running on the same machine or on remote servers.
- **Isolated Message Queues**: Each channel has its own message queue, preventing cross-channel blocking.
- **Per-Channel Logging**: Separate log files for each channel for easier debugging.
- **Centralized Configuration**: Manage all channels from a single `channels.json` file.
- **AccessToken Caching**: Efficiently caches and refreshes WeCom access tokens.
- **Health Check Endpoint**: A `/health` endpoint to monitor bridge status.
- **Image Support**: Send and receive images using a simple tag format.

---

## Quick Start

### Prerequisites

- Node.js (v16+)
- An existing OpenClaw installation
- A WeChat Work (WeCom) account with admin access

### 1. Clone the Repository

```bash
git clone https://github.com/lewiszeng666/wecom-openclaw-bridge-skill.git
cd wecom-openclaw-bridge-skill/scripts
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Configure Channels

Copy the example configuration file:

```bash
cp channels.json.example channels.json
```

Edit `channels.json` to add your WeCom and OpenClaw credentials. See the [Configuration Guide](#configuration) for details.

### 4. Start the Bridge

```bash
# For development
node bridge.js

# For production (using PM2)
npm install -g pm2
pm2 start bridge.js --name wecom-bridge
pm2 startup
pm2 save
```

### 5. Configure WeCom Callback URL

In your WeCom Admin Console, for each application, set the "API Receive" URL to:

```
http://<your-bridge-server-ip>:3000<channel-path>
```

For example, for a channel with `"path": "/wecom/sales"`, the URL would be `http://your-ip:3000/wecom/sales`.

---

## Configuration

All configuration is done in `channels.json`.

### Bridge Configuration

```json
"bridge": {
  "port": 3000,         // Port for the bridge to listen on
  "logDir": "./logs"     // Directory to store log files
}
```

### Channel Configuration (Local OpenClaw)

Use this when the bridge and OpenClaw are on the same machine.

```json
{
  "id": "main",
  "path": "/wecom",
  "wecom": { ... },
  "openclaw": {
    "host": "127.0.0.1",
    "port": 18789,
    "token": "your-openclaw-token",
    "sessionsDir": "/home/ubuntu/.openclaw/agents/main/sessions"
  }
}
```

### Channel Configuration (Remote OpenClaw)

Use this when OpenClaw is on a different machine.

**On the remote OpenClaw machine**, you must first deploy and run `session-proxy.js`:

```bash
# On the remote machine
PROXY_PORT=3001 \
SESSIONS_DIR=/home/ubuntu/.openclaw/agents/main/sessions \
PROXY_AUTH_TOKEN=your-strong-secret-token \
nohup node session-proxy.js > /tmp/session-proxy.log 2>&1 &
```

**In `channels.json` on the bridge machine**, configure the channel as follows:

```json
{
  "id": "remote-team",
  "path": "/wecom/remote-team",
  "wecom": { ... },
  "openclaw": {
    "host": "<remote-machine-ip>",
    "port": 18789, // Still needed for the proxy to know where to forward
    "token": "remote-openclaw-token",
    "sessionsDir": null, // This disables local file polling
    "proxyPort": 3001,
    "proxyAuthToken": "your-strong-secret-token"
  }
}
```

---

## Usage

### Sending Images

To have the agent send an image, include this tag in its response:

```
Here is the screenshot: [IMAGE:/path/to/your/image.png]
```

The bridge will automatically upload the image and send it to the user.

---

## Security & Privacy

- **Credential Security**: All sensitive credentials are stored in `channels.json` on your server. Ensure this file is protected and not publicly accessible.
- **Data Flow**: Messages are relayed through the `bridge.js` service on your own server to your OpenClaw instance. No data passes through any third-party service.
- **External Endpoints**: `bridge.js` only communicates with `https://qyapi.weixin.qq.com` (WeChat Work's official API) and your configured OpenClaw instances (or their proxies).

## Trust Statement

By installing and using this skill, you understand and agree that your WeChat Work message data will be processed by the `bridge.js` service that you deploy and will be sent to your OpenClaw instance. Ensure you trust the security of the environment where you deploy this service.

---

## License

[MIT](LICENSE)
