const http = require("http");
const { Client, GatewayIntentBits, Partials, ChannelType } = require("discord.js");

const {
  DISCORD_BOT_TOKEN,
  WORKER_URL,
  INGEST_SECRET,
  OWNER_USER_ID,
  GUILD_ID,
  ALLOWED_USER_IDS = "",
  LOCKDOWN = "on",
  PORT = 3000,
} = process.env;

if (!DISCORD_BOT_TOKEN || !WORKER_URL || !INGEST_SECRET) {
  console.error("Missing env: DISCORD_BOT_TOKEN, WORKER_URL, INGEST_SECRET");
  process.exit(1);
}

// Health route: Render needs a listening port, and the pinger hits /health.
http
  .createServer((req, res) => {
    if (req.url === "/health") {
      res.writeHead(200, { "Content-Type": "text/plain" });
      return res.end("ok");
    }
    res.writeHead(404);
    res.end();
  })
  .listen(PORT, () => console.log(`health on ${PORT}`));

const client = new Client({
  intents: [
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
  partials: [Partials.Channel], // needed so DM events fire
});

client.on("ready", () => console.log(`logged in as ${client.user.tag}`));
client.on("error", (err) => console.error("client error:", err.message));
client.on("shardError", (err) => console.error("shard error:", err.message));

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
  } catch (err) {
    console.error("ingest error:", err.message);
    await message.reply("Failed: could not reach the worker.").catch(() => {});
  }
});

// Lockdown: anyone who joins the server who is not allowed is kicked straight away.
// Set LOCKDOWN=off to stop kicking. Allowed IDs: the owner plus ALLOWED_USER_IDS (comma-separated).
const ALLOWED = new Set(
  [OWNER_USER_ID, ...ALLOWED_USER_IDS.split(",")].map((s) => (s || "").trim()).filter(Boolean)
);

client.on("guildMemberAdd", async (member) => {
  if (LOCKDOWN === "off") return;
  if (GUILD_ID && member.guild.id !== GUILD_ID) return;
  if (ALLOWED.has(member.id)) return;
  try {
    await member.kick("Not on the allowed list");
    console.log(`kicked ${member.user.tag} (${member.id})`);
  } catch (err) {
    console.error("kick failed:", err.message);
  }
});

client.login(DISCORD_BOT_TOKEN);
