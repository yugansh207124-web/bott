const http = require("http");
const { Client, GatewayIntentBits, Partials, ChannelType } = require("discord.js");

const {
  DISCORD_BOT_TOKEN,
  WORKER_URL,
  INGEST_SECRET,
  OWNER_USER_ID,
  PORT = 3000,
} = process.env;

if (!DISCORD_BOT_TOKEN || !WORKER_URL || !INGEST_SECRET) {
  console.error("Missing env: DISCORD_BOT_TOKEN, WORKER_URL, INGEST_SECRET");
  process.exit(1);
}

// Stats tracking
const startTime = Date.now();
let processedCount = 0;
let lastActivity = null;
let lastError = null;

function formatUptime(ms) {
  const seconds = Math.floor((ms / 1000) % 60);
  const minutes = Math.floor((ms / (1000 * 60)) % 60);
  const hours = Math.floor((ms / (1000 * 60 * 60)) % 24);
  const days = Math.floor(ms / (1000 * 60 * 60 * 24));
  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  parts.push(`${seconds}s`);
  return parts.join(" ");
}

function timeAgo(date) {
  if (!date) return "None yet";
  const diff = Math.floor((Date.now() - date.getTime()) / 1000);
  if (diff < 5) return "Just now";
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
  );
}

// Discord Client
const client = new Client({
  intents: [GatewayIntentBits.DirectMessages, GatewayIntentBits.MessageContent],
  partials: [Partials.Channel],
});

client.on("ready", () => console.log(`logged in as ${client.user.tag}`));
client.on("error", (err) => {
  lastError = err.message;
  console.error("client error:", err.message);
});
client.on("shardError", (err) => {
  lastError = err.message;
  console.error("shard error:", err.message);
});

client.on("messageCreate", async (message) => {
  if (message.author.bot || message.channel.type !== ChannelType.DM) return;
  if (OWNER_USER_ID && message.author.id !== OWNER_USER_ID) return;

  const attachments = [...message.attachments.values()];
  const images = attachments
    .filter((a) => a.contentType?.startsWith("image/"))
    .map((a) => a.url);
  const files = attachments
    .filter((a) => !a.contentType?.startsWith("image/"))
    .map((a) => a.url);
  const text = (message.content ?? "").trim();

  if (!text && !images.length && !files.length) return;

  try {
    const res = await fetch(`${WORKER_URL}/ingest`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Ingest-Secret": INGEST_SECRET,
      },
      body: JSON.stringify({
        who: message.author.username,
        text,
        images,
        files,
      }),
    });
    const data = await res.json().catch(() => ({}));
    const reply = res.ok
      ? data.saved
        ? `Saved.\n\n${data.summary ?? ""}`
        : data.summary ?? ""
      : `Failed: ${data.error ?? res.status}`;
    await message.reply(reply.slice(0, 1900));

    processedCount++;
    lastActivity = new Date();
  } catch (err) {
    lastError = err.message;
    console.error("ingest error:", err.message);
    await message.reply("Failed: could not reach the worker.").catch(() => {});
  }
});

client.login(DISCORD_BOT_TOKEN);

// Web Status Server
http
  .createServer((req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

    // Standard healthcheck endpoint for pinger/Render
    if (url.pathname === "/health") {
      res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end("ok");
    }

    // JSON status API
    if (url.pathname === "/status.json") {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(
        JSON.stringify({
          status: client.isReady() ? "online" : "connecting",
          uptime_ms: Date.now() - startTime,
          uptime: formatUptime(Date.now() - startTime),
          bot: client.user ? client.user.tag : null,
          ping_ms: client.ws?.ping ?? -1,
          processed_messages: processedCount,
          last_activity: lastActivity ? lastActivity.toISOString() : null,
          last_error: lastError,
        })
      );
    }

    // Serve HTML status page for all other routes
    const isOnline = client.isReady();
    const botTag = isOnline && client.user ? client.user.tag : "Connecting to Discord...";
    const botAvatar = isOnline && client.user ? client.user.displayAvatarURL({ size: 128 }) : null;
    const uptimeStr = formatUptime(Date.now() - startTime);
    const ping = client.ws?.ping ?? -1;

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="refresh" content="30">
  <title>${escapeHtml(botTag)} &middot; Status</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: #0b0f19;
      color: #e2e8f0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .card {
      background: #111827;
      border: 1px solid #1f2937;
      border-radius: 16px;
      max-width: 480px;
      width: 100%;
      padding: 28px;
      box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.5);
    }
    .header {
      display: flex;
      align-items: center;
      gap: 16px;
      margin-bottom: 24px;
    }
    .avatar {
      width: 56px;
      height: 56px;
      border-radius: 50%;
      background: #1f2937;
      border: 2px solid #374151;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 24px;
      overflow: hidden;
    }
    .avatar img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
    .title-group {
      flex: 1;
    }
    h1 {
      font-size: 1.25rem;
      font-weight: 700;
      color: #f8fafc;
      letter-spacing: -0.01em;
    }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 10px;
      border-radius: 9999px;
      font-size: 0.75rem;
      font-weight: 600;
      margin-top: 4px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .badge-online {
      background: rgba(16, 185, 129, 0.15);
      color: #34d399;
      border: 1px solid rgba(16, 185, 129, 0.3);
    }
    .badge-connecting {
      background: rgba(245, 158, 11, 0.15);
      color: #fbbf24;
      border: 1px solid rgba(245, 158, 11, 0.3);
    }
    .pulse-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: currentColor;
      box-shadow: 0 0 8px currentColor;
      animation: pulse 2s infinite ease-in-out;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.4; transform: scale(0.85); }
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 12px;
      margin-bottom: 24px;
    }
    .stat {
      background: #1e293b;
      border: 1px solid #334155;
      border-radius: 10px;
      padding: 12px 14px;
    }
    .stat-label {
      font-size: 0.75rem;
      color: #94a3b8;
      font-weight: 500;
      margin-bottom: 4px;
    }
    .stat-val {
      font-size: 1.05rem;
      font-weight: 700;
      color: #f1f5f9;
      font-variant-numeric: tabular-nums;
    }
    .footer {
      border-top: 1px solid #1f2937;
      padding-top: 16px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 0.8rem;
      color: #64748b;
    }
    .btn-refresh {
      background: #1f2937;
      color: #cbd5e1;
      border: 1px solid #374151;
      border-radius: 6px;
      padding: 6px 12px;
      font-size: 0.75rem;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.15s ease;
      text-decoration: none;
    }
    .btn-refresh:hover {
      background: #374151;
      color: #fff;
    }
    .error-box {
      background: rgba(239, 68, 68, 0.1);
      border: 1px solid rgba(239, 68, 68, 0.3);
      color: #f87171;
      border-radius: 8px;
      padding: 10px 12px;
      font-size: 0.8rem;
      margin-bottom: 16px;
      word-break: break-word;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <div class="avatar">
        ${botAvatar ? `<img src="${escapeHtml(botAvatar)}" alt="Bot Avatar">` : `🤖`}
      </div>
      <div class="title-group">
        <h1>${escapeHtml(botTag)}</h1>
        <div class="badge ${isOnline ? "badge-online" : "badge-connecting"}">
          <span class="pulse-dot"></span>
          ${isOnline ? "Online & Listening" : "Connecting..."}
        </div>
      </div>
    </div>

    ${lastError ? `<div class="error-box"><strong>Notice:</strong> ${escapeHtml(lastError)}</div>` : ""}

    <div class="grid">
      <div class="stat">
        <div class="stat-label">Uptime</div>
        <div class="stat-val">${escapeHtml(uptimeStr)}</div>
      </div>
      <div class="stat">
        <div class="stat-label">Discord Gateway Ping</div>
        <div class="stat-val">${ping >= 0 ? `${ping}ms` : "N/A"}</div>
      </div>
      <div class="stat">
        <div class="stat-label">Notes Processed</div>
        <div class="stat-val">${processedCount}</div>
      </div>
      <div class="stat">
        <div class="stat-label">Last Ingest</div>
        <div class="stat-val">${escapeHtml(timeAgo(lastActivity))}</div>
      </div>
    </div>

    <div class="footer">
      <span>Auto-refreshes every 30s</span>
      <a href="/" class="btn-refresh">Refresh Now</a>
    </div>
  </div>
</body>
</html>`;

    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html);
  })
  .listen(PORT, () => console.log(`health & status server on port ${PORT}`));
