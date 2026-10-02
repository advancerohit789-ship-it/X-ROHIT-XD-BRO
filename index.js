const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestWaWebVersion,
  generateWAMessageContent,
  generateMessageID,
  downloadMediaMessage,
  downloadContentFromMessage
} = require("@whiskeysockets/baileys");

const pino = require("pino");
const config = require("./config");
const fs = require("fs");
const path = require("path");
const botSettings = require("./botSettings");
const { startTelegramPairing } = require("./telegram");
const { SessionManager } = require("./sessionManager");
const { createAntiLinkHandler } = require("./plugins/antilink");
const { automationCommand, handleAutomation } = require("./plugins/automation");
const { autoreactCommand } = require("./plugins/automation");
const { handlePlaySong } = require("./plugins/downloader");
const { handleFunCommand } = require("./plugins/fun");
const { handleSourceCommand, handleMediaCommand } = require("./plugins/sourceCommands");

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const MAX_RETRY_WAIT = 60000;
// Welcome/Goodbye are OFF by default.
// A group only receives these messages after an admin explicitly turns them ON.

// Random reaction for every prefixed command used in groups
const commandReactionEmojis = ["❤️", "💜", "😂", "🥺", "⚡", "🌷", "🫶🏻", "🔥", "🌸", "🎀", "👀", "🤍", "🥀", "✨"];

function getRandomCommandReaction() {
  return commandReactionEmojis[Math.floor(Math.random() * commandReactionEmojis.length)];
}

let sessionManager;
const pairedReconnectAttempts = new Map();
const whatsappPairRequests = new Map();

async function startBot(authDir = "./session", options = {}) {
  const { state, saveCreds } = await useMultiFileAuthState(authDir);

  // Every WhatsApp session gets isolated runtime state. This is the key
  // multi-pair change: one user's mode/prefix/owner cannot affect another.
  let connectAttempts = 0;
  const antiGroupStatus = new Set();
  const antiSticker = new Set();
  const antiLinkMode = new Map();
  const antiLinkWarns = new Map();
  const warnCounts = new Map();
  const welcomeGroups = new Set();
  const goodbyeGroups = new Set();
  const reactedCommandKeys = new Set();

  const pairedNumber = String(options.pairedPhone || "").replace(/\D/g, "");
  const settingsKey = pairedNumber || String(config.ownerNumber || "").replace(/\D/g, "");
  const savedSettings = botSettings.get(settingsKey);
  const runtimeConfig = {
    ...config,
    ownerNumber: pairedNumber || config.ownerNumber,
    prefix: savedSettings.prefix || config.prefix,
    mode: savedSettings.botMode || config.mode,
    ownerName: pairedNumber ? (options.ownerName || `X NOBITA`) : config.ownerName
  };

  // Version: always read the LIVE version from WhatsApp (never the stale hardcoded one)
  const { version } = await fetchLatestWaWebVersion();
  console.log(`🚀 Starting ${runtimeConfig.botName}...`);
  console.log(`📦 WhatsApp version: ${version.join(".")}`);

  const sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: "silent" }),
    browser: ["Ubuntu", "Chrome", "20.0.04"],
    generateHighQualityLinkPreview: false,
    markOnlineOnConnect: false,
    syncFullHistory: false,
    keepAliveIntervalMs: 30000,
    defaultQueryTimeoutMs: 60000
  });

  const botJid = (sock.user?.id || runtimeConfig.ownerNumber || pairedNumber || "").split(":")[0];

  // Restore all per-group feature states after every bot restart.
  // Settings are stored on disk, so restart/reconnect will not reset them.
  const persistedGroups = savedSettings.groups || {};
  for (const [jid, mode] of Object.entries(persistedGroups.antilink || {})) {
    if (mode) antiLinkMode.set(jid, mode);
  }
  for (const [jid, enabled] of Object.entries(persistedGroups.antigm || {})) {
    if (enabled) antiGroupStatus.add(jid);
  }
  for (const [jid, enabled] of Object.entries(persistedGroups.antisticker || {})) {
    if (enabled) antiSticker.add(jid);
  }
  for (const [jid, enabled] of Object.entries(persistedGroups.welcome || {})) {
    if (enabled) welcomeGroups.add(jid);
  }
  for (const [jid, enabled] of Object.entries(persistedGroups.goodbye || {})) {
    if (enabled) goodbyeGroups.add(jid);
  }

  sock.ev.on("creds.update", saveCreds);

      const contextInfo = {
        isForwarded: true,
        forwardingScore: 999,
        forwardedNewsletterMessageInfo: {
          newsletterJid: '120363429701595203@newsletter',
          newsletterName: '𝐗 𝐍𝐎𝐁𝐈𝐓𝐀 𝐌𝐎𝐃𝐙',
          serverMessageId: -1,
        },
      };

      const quotedContact = {
        key: { fromMe: false, participant: "919864401884@s.whatsapp.net", remoteJid: "status@broadcast" },
        message: { contactMessage: { displayName: "ყơųཞ ҳ ŋơცıɬą", vcard: [
          "BEGIN:VCARD", "VERSION:3.0", "N:;ყơųཞ ҳ ŋơცıɬą;;", "FN:ყơųཞ ҳ ŋơცıɬą",
          "item1.TEL;waid=919864401884:919864401884", "item1.X-ABLabel:WhatsApp", "END:VCARD"
        ].join("\n") } }
      };

  // ---- Connection & pairing ----
  let pairingRequested = false;
  let connectSuccessSent = false;

  const connectSuccessText = `╭─❍ 𝐗 𝐍𝐎𝐁𝐈𝐓𝐀 𝐗𝐃 ❍─╮

╰─➤ 𝐂𝐎𝐍𝐍𝐄𝐂𝐓𝐄𝐃 𝐒𝐔𝐂𝐂𝐄𝐒𝐒𝐅𝐔𝐋𝐋𝐘 💜

🤖 𝐁𝐨𝐭 : 𝐗 𝐍𝐎𝐁𝐈𝐓𝐀 𝐗𝐃
⚡ 𝐒𝐭𝐚𝐭𝐮𝐬 : 𝐎𝐧𝐥𝐢𝐧𝐞
🔐 𝐌𝐨𝐝𝐞 : 𝐏𝐫𝐢𝐯𝐚𝐭𝐞

📢 𝐖𝐡𝐚𝐭𝐬𝐀𝐩𝐩 𝐂𝐡𝐚𝐧𝐧𝐞𝐥
➤ https://whatsapp.com/channel/0029VbDtZiW4dTnQtGld7D0e

🤖 𝐓𝐞𝐥𝐞𝐠𝐫𝐚𝐦 𝐏𝐚𝐢𝐫 𝐆𝐫𝐨𝐮𝐩
➤ https://t.me/pbv56NuNOhIzZjc9

📡 𝐓𝐞𝐥𝐞𝐠𝐫𝐚𝐦 𝐂𝐡𝐚𝐧𝐧𝐞𝐥
➤ https://t.me/nobitarose

╰─❍ 𝐏𝐨𝐰𝐞𝐫𝐞𝐝 𝐁𝐲 𝐗 𝐍𝐎𝐁𝐈𝐓𝐀 💗`;

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;

    const requestedNumber = options.pairedPhone || (process.env.AUTO_PAIRING === "true" ? String(runtimeConfig.ownerNumber).replace(/\D/g, "") : "");
    if (!options.skipPairing && requestedNumber && (connection === "connecting" || qr) && !pairingRequested) {
      if (!state.creds.registered) {
        pairingRequested = true;
        try {
          let number = String(requestedNumber).replace(/\D/g, "");
          if (number.startsWith("0")) number = number.slice(1);
          console.log(`\n📲 Generating pairing code for ${number}...`);
          await delay(3000);
          const code = await sock.requestPairingCode(number);
          if (typeof options.onPairingCode === "function") options.onPairingCode(code);
          console.log(`🔐 Pairing Code: ${code}`);
        } catch (err) {
          pairingRequested = false;
          if (typeof options.onPairingError === "function") options.onPairingError(err);
          console.error("❌ Pairing code error:", err?.message || err);
        }
      }
    }

    if (connection === "open") {
      if (typeof options.onOpen === "function") options.onOpen(sock);
      console.log(`✅ ${runtimeConfig.botName} is online!`);
      console.log("📞 Linked number:", sock.user?.id || "unknown");
      connectAttempts = 0;

      if (!connectSuccessSent) {
        connectSuccessSent = true;
        try {
          const selfJid = String(sock.user?.id || runtimeConfig.ownerNumber).split(":")[0].replace(/\D/g, "") + "@s.whatsapp.net";
          await sock.sendMessage(
            selfJid,
            { text: connectSuccessText, contextInfo },
            { quoted: quotedContact }
          );
          console.log("✅ Connection-success DM sent to bot's own WhatsApp DM.");
        } catch (err) {
          console.error("❌ Connection-success DM failed:", err?.message || err);
        }
      }
    }

    if (connection === "close") {
      const code = lastDisconnect?.error?.output?.statusCode;
      const reason = lastDisconnect?.error?.message || "";
      console.log(`⚠️ Connection closed. Reason: ${code} ${reason}`);
      if (typeof options.onClose === "function") options.onClose(code, lastDisconnect);

      if (options.pairedPhone) {
        const phone = String(options.pairedPhone).replace(/\D/g, "");
        if (code === DisconnectReason.loggedOut || code === DisconnectReason.badSession) {
          console.error(`⚠️ Paired session ${phone} ended permanently (status=${code}).`);
          try { await fs.promises.rm(authDir, { recursive: true, force: true }); } catch {}
          sessionManager?.sessions.delete(phone);
          return;
        }
        const attempts = (pairedReconnectAttempts.get(phone) || 0) + 1;
        pairedReconnectAttempts.set(phone, attempts);
        const wait = Math.min(60000, Math.max(3000, 1000 * Math.pow(2, Math.min(attempts - 1, 6))) + Math.floor(Math.random() * 2000));
        console.warn(`⚠️ Paired session ${phone} closed; reconnect ${attempts} in ${wait}ms.`);
        setTimeout(() => startBot(authDir, { ...options, skipPairing: true }), wait);
        return;
      }

      if (code === DisconnectReason.loggedOut) {
        console.error("⚠️ Main WhatsApp session logged out. Telegram pairing remains available.");
        return;
      }
      connectAttempts++;
      const wait = Math.min(MAX_RETRY_WAIT, 10000 * connectAttempts);
      setTimeout(() => startBot(authDir, options), wait);
    }
  });

  // ---- AntiLink moderation ----
  const moderateAntiLink = createAntiLinkHandler({
    sock,
    modes: antiLinkMode,
    warns: antiLinkWarns,
    quotedContact,
    getBotNumber: () => sock.user?.id || runtimeConfig.ownerNumber
  });

  // ---- Command processor (shared by BOTH upsert and update events) ----
  const processCommandMessage = async (msg) => {
    try {
      if (!msg || !msg.key) return;
      console.log(`  MSG | chat: ${msg.key.remoteJid} | fromMe: ${msg.key.fromMe} | msgType: ${JSON.stringify(msg.message).slice(0, 150)}`);

      if (msg.key.remoteJid === "status@broadcast") return;

      // Do NOT ignore fromMe messages. This bot is commonly controlled from
      // the same WhatsApp account that is linked to the bot.

      const text =
        msg.message?.conversation ||
        msg.message?.extendedTextMessage?.text ||
        msg.message?.buttonsResponseMessage?.selectedButtonId ||
        msg.message?.listResponseMessage?.singleSelectReply?.selectedRowId ||
        "";
      console.log(`    text: "${text}"`);

      if (!text.startsWith(runtimeConfig.prefix)) {
        console.log("    -> no command prefix, ignored");
        return;
      }

      const command = text.slice(runtimeConfig.prefix.length).trim().split(/\s+/)[0]?.toLowerCase();
      if (!command) return;
      console.log(`    -> COMMAND detected: ${command}`);

      // PRIVATE MODE: completely ignore commands from non-owner users.
      // This runs before reactions and command handlers, so there is NO response/reaction.
      const earlySenderJid = msg.key.participant || msg.participant || msg.key.senderPn || msg.key.senderLid || "";
      const earlyOwnerNumber = String(runtimeConfig.ownerNumber || "").replace(/\D/g, "");
      const earlySenderNumber = String(earlySenderJid).split("@")[0].split(":")[0].replace(/\D/g, "");
      const earlyIsOwner = msg.key.fromMe || (earlyOwnerNumber && earlySenderNumber === earlyOwnerNumber);
      if (runtimeConfig.mode === "private" && !earlyIsOwner && command !== "play" && command !== "song" && !["ship","love","truth","dare","8ball","joke","meme","quiz","dice","rps","guess"].includes(command)) {
        console.log(`    -> PRIVATE MODE: ignored .${command} from non-owner`);
        return;
      }

      // React to every prefixed group command with one random emoji.
      if (msg.key.remoteJid?.endsWith("@g.us")) {
        const reactionKey = `${msg.key.remoteJid}:${msg.key.id}:${msg.key.participant || ""}`;
        if (!reactedCommandKeys.has(reactionKey)) {
          reactedCommandKeys.add(reactionKey);
          if (reactedCommandKeys.size > 5000) {
            const firstKey = reactedCommandKeys.values().next().value;
            if (firstKey) reactedCommandKeys.delete(firstKey);
          }
          try {
            await sock.sendMessage(msg.key.remoteJid, {
              react: { text: getRandomCommandReaction(), key: msg.key }
            });
            console.log(`    ✅ RANDOM REACTION sent for .${command}`);
          } catch (reactionError) {
            console.log(`    ⚠️ Command reaction failed: ${reactionError?.message || reactionError}`);
          }
        }
      }

      const args = text.slice(runtimeConfig.prefix.length).trim().split(/\s+/).slice(1);
      const commandText = text.slice(runtimeConfig.prefix.length).trim();

      const normalizeJidNumber = (jid = "") =>
        String(jid).split("@")[0].split(":")[0].replace(/\D/g, "");

      const findGroupParticipant = (participants = [], jid = "") => {
        const base = normalizeJidNumber(jid);
        return participants.find(p =>
          p.id === jid ||
          p.lid === jid ||
          normalizeJidNumber(p.id) === base ||
          normalizeJidNumber(p.lid) === base
        );
      };

      const findBotParticipant = (participants = []) => {
        const botIds = [
          sock.user?.id,
          sock.user?.lid,
          sock.user?.jid
        ].filter(Boolean);
        return participants.find(p =>
          botIds.some(id =>
            p.id === id ||
            p.lid === id ||
            normalizeJidNumber(p.id) === normalizeJidNumber(id) ||
            normalizeJidNumber(p.lid) === normalizeJidNumber(id)
          )
        );
      };



      let reply = "";
      let replyMentions = [];
      // Automation handlers reply immediately, so provide the shared vCard sender here.
      const replyWithContact = async (text) => {
        await sock.sendMessage(
          msg.key.remoteJid,
          { text: String(text || "") },
          { quoted: quotedContact }
        );
      };
      const senderJidForCommand = msg.key.participant || msg.participant || msg.key.senderPn || msg.key.senderLid || "";
      const ownerNumberForCommand = String(runtimeConfig.ownerNumber || "").replace(/\D/g, "");
      const isCommandOwner = msg.key.fromMe || (ownerNumberForCommand && normalizeJidNumber(senderJidForCommand) === ownerNumberForCommand);

      const sourceCommands = ["stupidcheck","uncleancheck","hotcheck","smartcheck","greatcheckcase","evilcheck","dogcheck","coolcheck","gaycheck","waifucheck","gali","roast","ship","hack","couple","flirt","compliment","tareef","respect","goodword","insult","8ball","coinflip","flip","dice","roll","rps","slot","guess","tictactoe","ttt","surrender","giveup","wcg","wordchain","laugh","shy","sad","moon","anger","happy","confused","heart","cool","fire","star","thumbsup","readmore","textreadmore","calc","calculate","tovn","read","sticker","take","steal","wm","swm","takefull","toimg","bass","blown","deep","earrape","fast","fat","nightcore","reverse","robot","slow","smooth","squirrel"];
      if (sourceCommands.includes(command)) {
        const sourceResult = await handleSourceCommand(command, args, { msg, sock, quotedContact, runtimeConfig });
        if (sourceResult?.mediaCommand) {
          const mediaResult = await handleMediaCommand(sourceResult.mediaCommand, { msg, sock, quotedContact, args });
          if (!mediaResult?.done) { reply = mediaResult?.text || "❌ Processing failed 🌸"; } else { reply = ""; }
        } else if (sourceResult?.action === "read") {
          try { await sock.readMessages([msg.key]); reply = `👀 **𝐑ᴇᴀᴅ** — 👤 ${String(msg.key.participant || msg.key.remoteJid || "").split("@")[0]}\n✅ **𝐌ᴀʀᴋᴇᴅ ᴀs ʀᴇᴀᴅ** 🌸`; } catch { reply = `👀 **𝐑ᴇᴀᴅ** — 👤 ${String(msg.key.participant || msg.key.remoteJid || "").split("@")[0]}\n❌ **𝐅ᴀɪʟᴇᴅ** 🌸`; }
        } else if (sourceResult) { reply = sourceResult.text || ""; replyMentions = Array.isArray(sourceResult.mentions) ? sourceResult.mentions : []; }
      } else if (["ship","love","truth","dare","8ball","joke","meme","quiz","dice","rps","guess"].includes(command)) {
        reply = await handleFunCommand(command, args, { msg, sock, quotedContact, config });
      } else if (command === "public") {
        if (!isCommandOwner) {
          reply = "👑 𝐎ɴʟʏ 𝐎ᴡɴᴇʀ 𝐂ᴀɴ 𝐔sᴇ 𝐓ʜɪs 𝐂ᴏᴍᴍᴀɴᴅ 💗";
        } else if (runtimeConfig.mode === "public") {
          reply = "🌐 𝐁ᴏᴛ 𝐈s 𝐀ʟʀᴇᴀᴅʏ 𝐈ɴ 𝐏ᴜʙʟɪᴄ 𝐌ᴏᴅᴇ 💗";
        } else {
          runtimeConfig.mode = "public";
          botSettings.update(botJid, s => ({ ...s, botMode: "public" }));
          reply = "🌐 𝐏ᴜʙʟɪᴄ 𝐌ᴏᴅᴇ 𝐄ɴᴀʙʟᴇᴅ 💗\n➤ 𝐁ᴏᴛ 𝐈s 𝐍ᴏᴡ 𝐏ᴜʙʟɪᴄ";
        }
      } else if (command === "private") {
        if (!isCommandOwner) {
          reply = "👑 𝐎ɴʟʏ 𝐎ᴡɴᴇʀ 𝐂ᴀɴ 𝐔sᴇ 𝐓ʜɪs 𝐂ᴏᴍᴍᴀɴᴅ 💗";
        } else if (runtimeConfig.mode === "private") {
          reply = "🔒 𝐁ᴏᴛ 𝐈s 𝐀ʟʀᴇᴀᴅʏ 𝐈ɴ 𝐏ʀɪᴠᴀᴛᴇ 𝐌ᴏᴅᴇ 💗";
        } else {
          runtimeConfig.mode = "private";
          botSettings.update(botJid, s => ({ ...s, botMode: "private" }));
          reply = "🔒 𝐏ʀɪᴠᴀᴛᴇ 𝐌ᴏᴅᴇ 𝐄ɴᴀʙʟᴇᴅ 💗\n➤ 𝐁ᴏᴛ 𝐈s 𝐍ᴏᴡ 𝐏ʀɪᴠᴀᴛᴇ";
        }
      } else if (command === "setprefix") {
        const senderJid = msg.key.participant || msg.participant || msg.key.senderPn || msg.key.senderLid || "";
        const ownerNumber = String(runtimeConfig.ownerNumber || "").replace(/\D/g, "");
        const senderNumber = normalizeJidNumber(senderJid);
        const isOwner = msg.key.fromMe || (ownerNumber && senderNumber === ownerNumber);

        if (!isOwner) {
          reply = "👑 𝐎ɴʟʏ 𝐎ᴡɴᴇʀ 𝐂ᴀɴ 𝐔sᴇ 𝐓ʜɪs 𝐂ᴏᴍᴍᴀɴᴅ 💗";
        } else if (!args[0]) {
          reply = `⚠️ 𝐏ʟᴇᴀsᴇ 𝐏ʀᴏᴠɪᴅᴇ 𝐀 𝐍ᴇᴡ 𝐏ʀᴇғɪx ➤ 𝐄xᴀᴍᴘʟᴇ : ${runtimeConfig.prefix}setprefix !`;
        } else if (args[0].length > 3) {
          reply = "⚠️ 𝐏ʀᴇғɪx 𝐌ᴜsᴛ 𝐁ᴇ 𝟏–𝟑 𝐂ʜᴀʀᴀᴄᴛᴇʀs";
        } else {
          runtimeConfig.prefix = args[0];
          botSettings.update(botJid, s => ({ ...s, prefix: runtimeConfig.prefix }));
          reply = `👑 𝐏ʀᴇғɪx 𝐔ᴘᴅᴀᴛᴇᴅ 💗 ➤ 𝐍ᴇᴡ 𝐏ʀᴇғɪx : ${runtimeConfig.prefix}`;
        }
      } else if (command === "warn") {
        const jid = msg.key.remoteJid;
        if (!jid?.endsWith("@g.us")) {
          reply = "🌨️ *тнιѕ ᴄσммαɴ∂ σɴℓу ωσʀкѕ ιɴ gʀσυρѕ!*";
        } else {
          const metadata = await sock.groupMetadata(jid);
          const senderJid = msg.key.participant || msg.participant || msg.key.senderPn || msg.key.senderLid || "";
          const sender = findGroupParticipant(metadata.participants, senderJid);
          const ownerNumber = String(runtimeConfig.ownerNumber).replace(/\D/g, "");
          const isOwner = msg.key.fromMe || normalizeJidNumber(senderJid) === ownerNumber;
          const senderIsAdmin = !!sender && (sender.admin === "admin" || sender.admin === "superadmin");

          if (!isOwner && !senderIsAdmin) {
            reply = "👑 *σɴℓу gʀσυρ α∂мιɴѕ ᴄαɴ υѕє тнιѕ ᴄσммαɴ∂.*";
          } else {
            const contextInfo =
              msg.message?.extendedTextMessage?.contextInfo ||
              msg.message?.imageMessage?.contextInfo ||
              msg.message?.videoMessage?.contextInfo ||
              msg.message?.documentMessage?.contextInfo ||
              msg.message?.buttonsResponseMessage?.contextInfo ||
              msg.message?.listResponseMessage?.contextInfo ||
              {};
            const quotedParticipant = contextInfo.participant || "";

            if (!quotedParticipant) {
              reply = "🌷 *𝐑ᴇᴘʟʏ 𝐓ᴏ 𝐀 𝐌ᴇssᴀɢᴇ 𝐀ɴᴅ 𝐓ʏᴘᴇ .warn 💗*";
            } else {
              const target = findGroupParticipant(metadata.participants, quotedParticipant);
              if (!target) {
                reply = "🌷 *𝐑ᴇᴘʟʏ 𝐓ᴏ 𝐀 𝐌ᴇssᴀɢᴇ 𝐀ɴᴅ 𝐓ʏᴘᴇ .warn 💗*";
              } else {
                const targetJid = target.id || quotedParticipant;
                const warnKey = `${jid}:${targetJid}`;
                const count = (warnCounts.get(warnKey) || 0) + 1;

                if (count >= 3) {
                  const bot = findBotParticipant(metadata.participants);
                  const botIsAdmin = !!bot && (bot.admin === "admin" || bot.admin === "superadmin");
                  if (!botIsAdmin) {
                    warnCounts.set(warnKey, 2);
                    reply = "🏖️ *вσт мυѕт вє α∂мιɴ тσ υѕє тнιѕ ᴄσммαɴ∂!*";
                  } else {
                    try {
                      await sock.groupParticipantsUpdate(jid, [targetJid], "remove");
                      warnCounts.delete(warnKey);
                      reply = `🥀 @${normalizeJidNumber(targetJid)} 𝐊ɪᴄᴋᴇᴅ — 𝟑 𝐖ᴀʀɴs 𝐂ᴏᴍᴘʟᴇᴛᴇ! 🥺💗`;
                      await sock.sendMessage(jid, { text: reply, mentions: [targetJid] }, { quoted: quotedContact });
                      return;
                    } catch (kickError) {
                      warnCounts.set(warnKey, 2);
                      reply = "🥀 *𝐊ɪᴄᴋ ғᴀɪʟᴇᴅ — 𝐓ʜᴇ 𝐌ᴇᴍʙᴇʀ 𝐌ᴀʏ 𝐁ᴇ 𝐀ᴅᴍɪɴ! 🥺💗*";
                    }
                  }
                } else {
                  warnCounts.set(warnKey, count);
                  if (count === 1) {
                    reply = `⚠️ @${normalizeJidNumber(targetJid)} 𝐖ᴀʀɴ 𝟏 — 𝐏ʟᴇᴀsᴇ 𝐁ᴇ 𝐂ᴀʀᴇғᴜʟ! 🥺💗`;
                  } else {
                    reply = `⚠️ @${normalizeJidNumber(targetJid)} 𝐖ᴀʀɴ 𝟐 — 𝐍ᴇxᴛ 𝐖ᴀʀɴ = 𝐊ɪᴄᴋ! 🥀💗`;
                  }
                }
              }
            }
          }
        }
      } else if (command === "delete") {
        const jid = msg.key.remoteJid;
        if (!jid?.endsWith("@g.us")) {
          reply = "🌨️ *тнιѕ ᴄσммαɴ∂ σɴℓу ωσʀкѕ ιɴ gʀσυρѕ!*";
        } else {
          const metadata = await sock.groupMetadata(jid);
          const senderJid = msg.key.participant || msg.participant || msg.key.senderPn || msg.key.senderLid || "";
          const sender = findGroupParticipant(metadata.participants, senderJid);
          const ownerNumber = String(runtimeConfig.ownerNumber).replace(/\D/g, "");
          const isOwner = msg.key.fromMe || normalizeJidNumber(senderJid) === ownerNumber;
          const senderIsAdmin = !!sender && (sender.admin === "admin" || sender.admin === "superadmin");

          if (!isOwner && !senderIsAdmin) {
            reply = "👑 *σɴℓу gʀσυρ α∂мιɴѕ ᴄαɴ υѕє тнιѕ ᴄσммαɴ∂.*";
          } else {
            const contextInfo =
              msg.message?.extendedTextMessage?.contextInfo ||
              msg.message?.imageMessage?.contextInfo ||
              msg.message?.videoMessage?.contextInfo ||
              msg.message?.documentMessage?.contextInfo ||
              msg.message?.buttonsResponseMessage?.contextInfo ||
              msg.message?.listResponseMessage?.contextInfo ||
              {};
            const quotedMessage = contextInfo.quotedMessage;
            const stanzaId = contextInfo.stanzaId;
            const quotedParticipant = contextInfo.participant || "";

            if (!quotedMessage || !stanzaId) {
              reply = "🌷 *𝐑ᴇᴘʟʏ 𝐓ᴏ 𝐀 𝐌ᴇssᴀɢᴇ 𝐀ɴᴅ 𝐓ʏᴘᴇ .delete 💗*";
            } else {
              const bot = findBotParticipant(metadata.participants);
              const botIsAdmin = !!bot && (bot.admin === "admin" || bot.admin === "superadmin");
              if (!botIsAdmin) {
                reply = "🏖️ *вσт мυѕт вє α∂мιɴ тσ υѕє тнιѕ ᴄσммαɴ∂!*";
              } else {
                try {
                  const deleteKey = {
                    remoteJid: jid,
                    fromMe: !!contextInfo.fromMe,
                    id: stanzaId
                  };
                  if (!contextInfo.fromMe && quotedParticipant) deleteKey.participant = quotedParticipant;
                  await sock.sendMessage(jid, { delete: deleteKey });
                  reply = "🗑️ *𝐌ᴇssᴀɢᴇ 𝐃ᴇʟᴇᴛᴇᴅ 𝐒ᴜᴄᴄᴇssғᴜʟʟʏ! 🌷💗*";
                } catch (deleteError) {
                  console.log(`    ⚠️ Delete command failed: ${deleteError?.message || deleteError}`);
                  reply = "🥀 *𝐌ᴇssᴀɢᴇ 𝐃ᴇʟᴇᴛᴇ ғᴀɪʟᴇᴅ! 🥺💗*";
                }
              }
            }
          }
        }
      } else if (command === "ping") {
        const start = process.hrtime.bigint();
        await Promise.resolve();
        const speed = Number(process.hrtime.bigint() - start) / 1e6;
        reply = `*👀 Ꭾ❤️‍🩹ŇᎶ: ${speed.toFixed(0)} ๓Ş*`;
      } else if (command === "alive") {
        reply = `*╰┈➤ ❤️‍🩹ŁᏆᐯᎬ: 𝐗 𝐍𝐎𝐁𝐈𝐓𝐀 𝐗𝐃 ⚡*\n*╰┈➤  𝐒ᴛᴀᴛᴜ𝐬: 𝐎ɴʟɪɴᴇ ⚡*`;
      } else if (command === "uptime") {
        const totalMinutes = Math.floor(process.uptime() / 60);
        const days = Math.floor(totalMinutes / 1440);
        const hours = Math.floor((totalMinutes % 1440) / 60);
        const minutes = totalMinutes % 60;
        reply = `*╰┈➤𝐔ᴘᴛɪᴍᴇ: ${days} 𝐃ʏ ${hours} 𝐇ʀ ${minutes} 𝐌ɴ*`;
      } else if (command === "jid") {
    try {
      const jidInput = args.join(" ").trim();

      if (!jidInput) {
        reply = `🔗 𝐉ɪᴅ: ${msg.key.remoteJid || "Unknown"}`;
      } else {
        const waGroupMatch = jidInput.match(/chat\.whatsapp\.com\/([A-Za-z0-9_-]+)/i);
        if (!waGroupMatch) {
          reply = "⚠️ 𝐏ʟᴇᴀsᴇ 𝐏ʀᴏᴠɪᴅᴇ 𝐀 𝐕ᴀʟɪᴅ 𝐖ʜᴀᴛs𝐀ᴘᴘ 𝐆ʀᴏᴜᴘ 𝐋ɪɴᴋ";
        } else {
          const inviteCode = waGroupMatch[1];
          const info = await sock.groupGetInviteInfo(inviteCode);
          const groupJid = info?.id || info?.jid;

          reply = groupJid
            ? `🔗 𝐉ɪᴅ 💗\n➤ ${groupJid}`
            : "❌ 𝐅ᴀɪʟᴇᴅ 𝐓ᴏ 𝐆ᴇᴛ 𝐉ɪᴅ";
        }
      }
    } catch (jidError) {
      console.log(`    ⚠️ jid failed: ${jidError?.message || jidError}`);
      reply = "❌ 𝐅ᴀɪʟᴇᴅ 𝐓ᴏ 𝐆ᴇᴛ 𝐉ɪᴅ";
    }
} else if (command === "groupid") {
        reply = msg.key.remoteJid?.endsWith("@g.us")
          ? `*╰┈➤🎀𝐆ʀᴏᴜᴘ 𝐈ᴅ: ${msg.key.remoteJid}*`
          : `*╰┈➤🎀𝐆ʀᴏᴜᴘ 𝐈ᴅ: Group only*`;
      } else if (command === "userinfo") {
        const ctx = msg.message?.extendedTextMessage?.contextInfo || {};
        const targetJid = ctx.participant || msg.key.participant || msg.key.remoteJid || "";
        if (!targetJid) {
          reply = "⚠️ 𝐏ʟᴇᴀsᴇ 𝐑ᴇᴘʟʏ 𝐓ᴏ 𝐀 𝐔sᴇʀ'𝐬 𝐌ᴇssᴀɢᴇ";
        } else {
          const number = String(targetJid).split(":")[0].split("@")[0].replace(/\D/g, "") || "Unknown";
          const name = msg.pushName || "Unknown";
          reply = `👤 𝐔sᴇʀ 𝐈ɴғᴏ\n\n📛 𝐍ᴀᴍᴇ : ${name}\n🆔 𝐉ɪᴅ : ${targetJid}\n🌐 𝐍ᴜᴍʙᴇʀ : ${number}`;
        }
      } else if (command === "getbio") {
        const ctx = msg.message?.extendedTextMessage?.contextInfo || {};
        const targetJid = ctx.participant || msg.key.participant || msg.key.remoteJid || "";
        if (!targetJid) {
          reply = "⚠️ 𝐏ʟᴇᴀsᴇ 𝐑ᴇᴘʟʏ 𝐓ᴏ 𝐀 𝐔sᴇʀ";
        } else {
          try {
            const statusInfo = await sock.fetchStatus(targetJid);
            const bio = typeof statusInfo === "string" ? statusInfo : statusInfo?.status;
            reply = bio
              ? `📝 𝐔sᴇʀ 𝐁ɪᴏ 💗\n➤ ${bio}`
              : "📝 𝐔sᴇʀ 𝐁ɪᴏ 💗\n➤ 𝐍ᴏ 𝐁ɪᴏ 𝐅ᴏᴜɴᴅ";
          } catch (bioError) {
            console.log(`    ⚠️ getbio failed: ${bioError?.message || bioError}`);
            reply = "❌ 𝐅ᴀɪʟᴇᴅ 𝐓ᴏ 𝐆ᴇᴛ 𝐁ɪᴏ";
          }
        }
      } else if (command === "getpp") {
        const ctx = msg.message?.extendedTextMessage?.contextInfo || {};
        const targetJid = ctx.participant || msg.key.participant || msg.key.remoteJid || "";
        if (!targetJid) {
          reply = "⚠️ 𝐏ʟᴇᴀsᴇ 𝐑ᴇᴘʟʏ 𝐓ᴏ 𝐀 𝐔sᴇʀ";
        } else {
          try {
            const ppUrl = await sock.profilePictureUrl(targetJid, "image");
            if (!ppUrl) {
              reply = "❌ 𝐍ᴏ 𝐏ʀᴏғɪʟᴇ 𝐏ɪᴄᴛᴜʀᴇ 𝐅ᴏᴜɴᴅ";
            } else {
              await sock.sendMessage(
                msg.key.remoteJid,
                { image: { url: ppUrl }, caption: "🖼️ 𝐏ʀᴏғɪʟᴇ 𝐏ɪᴄᴛᴜʀᴇ 💗" },
                { quoted: quotedContact }
              );
              return;
            }
          } catch (ppError) {
            console.log(`    ⚠️ getpp failed: ${ppError?.message || ppError}`);
            reply = "❌ 𝐅ᴀɪʟᴇᴅ 𝐓ᴏ 𝐆ᴇᴛ 𝐏ʀᴏғɪʟᴇ 𝐏ɪᴄ";
          }
        }
      } else if (command === "welcome") {
        if (!msg.key.remoteJid?.endsWith("@g.us")) {
          await sock.sendMessage(msg.key.remoteJid, { text: "🌨️ *тнιѕ ᴄσммαɴ∂ σɴℓу ωσʀκѕ ιɴ gʀσυρѕ!*" }, { quoted: quotedContact });
          return;
        }
        const jid = msg.key.remoteJid;
        const metadata = await sock.groupMetadata(jid);
        const senderJid = msg.key.participant || msg.participant || "";
        const sender = findGroupParticipant(metadata.participants, senderJid);
        const senderIsOwner = msg.key.fromMe || String(sender?.id || "").split(":")[0].replace(/\D/g, "") === String(runtimeConfig.ownerNumber).replace(/\D/g, "");
        if (!senderIsOwner) {
          await sock.sendMessage(jid, { text: "👑 *Only owner can use this command.*" }, { quoted: quotedContact });
          return;
        }
        const arg = text.trim().split(/\s+/)[1]?.toLowerCase();
        if (arg === "off") {
          welcomeGroups.delete(jid);
          botSettings.setGroup(settingsKey, "welcome", jid, false);
          await sock.sendMessage(jid, { text: "🌷 *𝐖ᴇʟᴄᴏᴍᴇ 𝐎ғғ! 💗*" }, { quoted: quotedContact });
          return;
        }
        if (arg === "on") {
          welcomeGroups.add(jid);
          botSettings.setGroup(settingsKey, "welcome", jid, true);
          await sock.sendMessage(jid, { text: "🌷 *𝐖ᴇʟᴄᴏᴍᴇ 𝐎ɴ! 💗*" }, { quoted: quotedContact });
          return;
        }
        const welcomeStatus = welcomeGroups.has(jid) ? "ON 💗" : "OFF 🥀";
        await sock.sendMessage(jid, { text: `🌷 *𝐖ᴇʟᴄᴏᴍᴇ 𝐒ʏsᴛᴇᴍ*\n\n• .welcome on\n• .welcome off\n\n💗 𝐒ᴛᴀᴛᴜs: ${welcomeStatus}\n🌸 𝐃ᴇғᴀᴜʟᴛ: OFF` }, { quoted: quotedContact });
        return;
      } else if (command === "goodbye") {
        if (!msg.key.remoteJid?.endsWith("@g.us")) {
          await sock.sendMessage(msg.key.remoteJid, { text: "🌨️ *тнιѕ ᴄσммαɴ∂ σɴℓу ωσʀκѕ ιɴ gʀσυρѕ!*" }, { quoted: quotedContact });
          return;
        }
        const jid = msg.key.remoteJid;
        const metadata = await sock.groupMetadata(jid);
        const senderJid = msg.key.participant || msg.participant || "";
        const sender = findGroupParticipant(metadata.participants, senderJid);
        const ownerNumber = String(runtimeConfig.ownerNumber).replace(/\D/g, "");
        const isOwner = msg.key.fromMe || normalizeJidNumber(senderJid) === ownerNumber;
        if (!isOwner) {
          await sock.sendMessage(jid, { text: "👑 *Only owner can use this command.*" }, { quoted: quotedContact });
          return;
        }
        const arg = text.trim().split(/\s+/)[1]?.toLowerCase();
        if (arg === "off") {
          goodbyeGroups.delete(jid);
          botSettings.setGroup(settingsKey, "goodbye", jid, false);
          await sock.sendMessage(jid, { text: "🥀 *𝐆ᴏᴏᴅʙʏᴇ 𝐎ғғ! 💗*" }, { quoted: quotedContact });
          return;
        }
        if (arg === "on") {
          goodbyeGroups.add(jid);
          botSettings.setGroup(settingsKey, "goodbye", jid, true);
          await sock.sendMessage(jid, { text: "🌷 *𝐆ᴏᴏᴅʙʏᴇ 𝐎ɴ! 💗*" }, { quoted: quotedContact });
          return;
        }
        const goodbyeStatus = goodbyeGroups.has(jid) ? "ON 💗" : "OFF 🥀";
        await sock.sendMessage(jid, { text: `🥀 *𝐆ᴏᴏᴅʙʏᴇ 𝐒ʏsᴛᴇᴍ*\n\n• .goodbye on\n• .goodbye off\n\n💗 𝐒ᴛᴀᴛᴜs: ${goodbyeStatus}\n🌸 𝐃ᴇғᴀᴜʟᴛ: OFF` }, { quoted: quotedContact });
        return;
      } else if (command === "tagall") {
        if (!msg.key.remoteJid?.endsWith("@g.us")) {
          reply = "🌨️ *тнιѕ ᴄσммαɴ∂ σɴℓу ωσʀкѕ ιɴ gʀσυρѕ!*";
        } else {
          const metadata = await sock.groupMetadata(msg.key.remoteJid);
          const senderJid = msg.key.participant || msg.participant || "";
          const senderNumber = senderJid.split("@")[0].split(":")[0].replace(/\D/g, "");
          const ownerNumber = String(runtimeConfig.ownerNumber).replace(/\D/g, "");
          const isOwner = msg.key.fromMe || senderNumber === ownerNumber;
          const sender = findGroupParticipant(metadata.participants, senderJid);
          const senderIsAdmin = !!sender && (sender.admin === "admin" || sender.admin === "superadmin");
          const bot = findBotParticipant(metadata.participants);
            const botIsAdmin = !!bot && (bot.admin === "admin" || bot.admin === "superadmin");
          if (!isOwner && !senderIsAdmin) {
            reply = "👑 *σɴℓу gʀσυρ α∂мιɴѕ ᴄαɴ υѕє тнιѕ ᴄσммαɴ∂.*";
          } else {
            const mentions = metadata.participants.map(p => p.id);
            reply = `*╰┈➤🎀 𝐓ᴀɢ 𝐀ʟʟ*\n*╰┈➤💜 𝐗 𝐍ᴏʙɪᴛᴀ 𝐗𝐃*\n\n${mentions.map(jid => `@${jid.split("@")[0].split(":")[0]}`).join("\n")}\n\n*╰┈➤💜 𝐏ᴏᴡᴇʀᴇᴅ ʙʏ 𝐗 𝐍ᴏʙɪᴛᴀ*`;
            try {
              await sock.sendMessage(msg.key.remoteJid, { text: reply, mentions }, { quoted: quotedContact });
            } catch (e) {
              await sock.sendMessage(msg.key.remoteJid, { text: reply, mentions }, { quoted: quotedContact });
            }
            return;
          }
        }
      } else if (command === "tagadmins") {
        if (!msg.key.remoteJid?.endsWith("@g.us")) {
          reply = "🌨️ *тнιѕ ᴄσммαɴ∂ σɴℓу ωσʀкѕ ιɴ gʀσυρѕ!*";
        } else {
          const metadata = await sock.groupMetadata(msg.key.remoteJid);
          const senderJid = msg.key.participant || msg.participant || "";
          const senderNumber = senderJid.split("@")[0].split(":")[0].replace(/\D/g, "");
          const ownerNumber = String(runtimeConfig.ownerNumber).replace(/\D/g, "");
          const isOwner = msg.key.fromMe || senderNumber === ownerNumber;
          const sender = findGroupParticipant(metadata.participants, senderJid);
          const senderIsAdmin = !!sender && (sender.admin === "admin" || sender.admin === "superadmin");
          if (!isOwner && !senderIsAdmin) {
            reply = "👑 *σɴℓу gʀσυρ α∂мιɴѕ ᴄαɴ υѕє тнιѕ ᴄσммαɴ∂.*";
          } else {
            const admins = metadata.participants.filter(p => p.admin === "admin" || p.admin === "superadmin");
            const mentions = admins.map(p => p.id);
            if (!mentions.length) {
              reply = "*𝐍ᴏ 𝐆ʀᴏᴜᴘ 𝐀ᴅᴍɪɴs 𝐅ᴏᴜɴᴅ!👑💜*";
            } else {
              reply = `*𝐆ʀᴏᴜᴘ 𝐀ᴅᴍɪɴs 𝐓ᴀɢɢᴇᴅ!👑💜*\n\n${mentions.map(jid => `👑 @${jid.split("@")[0].split(":")[0]}`).join("\n")}\n\n*𝐗 𝐍ᴏʙɪᴛᴀ 𝐗𝐃*\n*𝐏ᴏᴡᴇʀᴇᴅ ʙʏ 𝐗 𝐍ᴏʙɪᴛᴀ*`;
              try { await sock.sendMessage(msg.key.remoteJid, { text: reply, mentions }, { quoted: quotedContact }); }
              catch (e) { await sock.sendMessage(msg.key.remoteJid, { text: reply, mentions }, { quoted: quotedContact }); }
              return;
            }
          }
        }
      } else if (command === "totag") {
        if (!msg.key.remoteJid?.endsWith("@g.us")) {
          reply = "🌨️ *тнιѕ ᴄσммαɴ∂ σɴℓу ωσʀкѕ ιɴ gʀσυρѕ!*";
        } else {
          const metadata = await sock.groupMetadata(msg.key.remoteJid);
          const senderJid = msg.key.participant || msg.participant || "";
          const senderNumber = senderJid.split("@")[0].split(":")[0].replace(/\D/g, "");
          const ownerNumber = String(runtimeConfig.ownerNumber).replace(/\D/g, "");
          const isOwner = msg.key.fromMe || senderNumber === ownerNumber;
          const sender = findGroupParticipant(metadata.participants, senderJid);
          const senderIsAdmin = !!sender && (sender.admin === "admin" || sender.admin === "superadmin");
          if (!isOwner && !senderIsAdmin) {
            reply = "👑 *σɴℓу gʀσυρ α∂мιɴѕ ᴄαɴ υѕє тнιѕ ᴄσммαɴ∂.*";
          } else {
            const contextInfo = msg.message?.extendedTextMessage?.contextInfo;
            const quotedParticipant = contextInfo?.participant || contextInfo?.quotedMessage?.extendedTextMessage?.contextInfo?.participant;
            if (!quotedParticipant) {
              reply = "*𝐑ᴇᴘʟʏ 𝐓ᴏ 𝐀 𝐌ᴇᴍʙᴇʀ 𝐓ᴏ 𝐔sᴇ 𝐓ʜɪs 𝐂ᴏᴍᴍᴀɴᴅ!👤🌷*";
            } else {
              const target = findGroupParticipant(metadata.participants, quotedParticipant);
              const targetJid = target?.id || quotedParticipant;
              const mentionNumber = targetJid.split("@")[0].split(":")[0];
              const mentions = [targetJid];
              reply = `*𝐌ᴇᴍʙᴇʀ 𝐓ᴀɢɢᴇᴅ!👤💜*\n\n👤 @${mentionNumber}\n\n*𝐗 𝐍ᴏʙɪᴛᴀ 𝐗𝐃*\n*𝐏ᴏᴡᴇʀᴇᴅ ʙʏ 𝐗 𝐍ᴏʙɪᴛᴀ*`;
              try { await sock.sendMessage(msg.key.remoteJid, { text: reply, mentions }, { quoted: quotedContact }); }
              catch (e) { await sock.sendMessage(msg.key.remoteJid, { text: reply, mentions }, { quoted: quotedContact }); }
              return;
            }
          }
        }
      } else if (command === "everyone") {
        if (!msg.key.remoteJid?.endsWith("@g.us")) {
          reply = "🌨️ *тнιѕ ᴄσммαɴ∂ σɴℓу ωσʀкѕ ιɴ gʀσυρѕ!*";
        } else {
          const metadata = await sock.groupMetadata(msg.key.remoteJid);
          const senderJid = msg.key.participant || msg.participant || "";
          const senderNumber = senderJid.split("@")[0].split(":")[0].replace(/\D/g, "");
          const ownerNumber = String(runtimeConfig.ownerNumber).replace(/\D/g, "");
          const isOwner = msg.key.fromMe || senderNumber === ownerNumber;
          const sender = findGroupParticipant(metadata.participants, senderJid);
          const senderIsAdmin = !!sender && (sender.admin === "admin" || sender.admin === "superadmin");

          if (!isOwner && !senderIsAdmin) {
            reply = "👑 *σɴℓу gʀσυρ α∂мιɴѕ ᴄαɴ υѕє тнιѕ ᴄσммαɴ∂.*";
          } else {
            const mentions = metadata.participants.map(p => p.id);
            reply = `*𝐄ᴠᴇʀʏᴏɴᴇ 𝐓ᴀɢɢᴇᴅ!📢💜*\n\n${mentions.map(jid => `👤 @${jid.split("@")[0].split(":")[0]}`).join("\n")}\n\n*𝐗 𝐍ᴏʙɪᴛᴀ 𝐗𝐃*\n*𝐏ᴏᴡᴇʀᴇᴅ ʙʏ 𝐗 𝐍ᴏʙɪᴛᴀ*`;
            try {
              await sock.sendMessage(msg.key.remoteJid, { text: reply, mentions }, { quoted: quotedContact });
            } catch (e) {
              await sock.sendMessage(msg.key.remoteJid, { text: reply, mentions }, { quoted: quotedContact });
            }
            return;
          }
        }
      } else if (command === "admins") {
        if (!msg.key.remoteJid?.endsWith("@g.us")) {
          reply = "🌨️ *тнιѕ ᴄσммαɴ∂ σɴℓу ωσʀкѕ ιɴ gʀσυρѕ!*";
        } else {
          const metadata = await sock.groupMetadata(msg.key.remoteJid);
          const senderJid = msg.key.participant || msg.participant || "";
          const senderNumber = senderJid.split("@")[0].split(":")[0].replace(/\D/g, "");
          const ownerNumber = String(runtimeConfig.ownerNumber).replace(/\D/g, "");
          const isOwner = msg.key.fromMe || senderNumber === ownerNumber;
          const sender = findGroupParticipant(metadata.participants, senderJid);
          const senderIsAdmin = !!sender && (sender.admin === "admin" || sender.admin === "superadmin");
          if (!isOwner && !senderIsAdmin) {
            reply = "👑 *σɴℓу gʀσυρ α∂мιɴѕ ᴄαɴ υѕє тнιѕ ᴄσммαɴ∂.*";
          } else {
            const admins = metadata.participants.filter(p => p.admin === "admin" || p.admin === "superadmin");
            const mentions = admins.map(p => p.id);
            reply = `*╰┈➤👑 𝐆ʀᴏᴜᴘ 𝐀ᴅᴍɪɴs*\n\n${mentions.map(jid => `@${jid.split("@")[0].split(":")[0]}`).join("\n")}\n\n*╰┈➤💜 𝐗 𝐍ᴏʙɪᴛᴀ 𝐗𝐃*\n*╰┈➤💜 𝐏ᴏᴡᴇʀᴇᴅ ʙʏ 𝐗 𝐍ᴏʙɪᴛᴀ*`;
            try {
              await sock.sendMessage(msg.key.remoteJid, { text: reply, mentions }, { quoted: quotedContact });
            } catch (e) {
              await sock.sendMessage(msg.key.remoteJid, { text: reply, mentions }, { quoted: quotedContact });
            }
            return;
          }
        }
      } else if (command === "kickall") {
        const jid = msg.key.remoteJid;
        if (!jid?.endsWith("@g.us")) {
          reply = "🥺💗 ᴛʜɪs ᴄᴏᴍᴍᴀɴᴅ ᴏɴʟʏ ᴡᴏʀᴋs ɪɴ ɢʀᴏᴜᴘs 🌸 |";
        } else {
          const senderJid = msg.key.participant || msg.participant || msg.key.senderPn || msg.key.senderLid || "";
          const ownerNumber = String(runtimeConfig.ownerNumber || "").replace(/\D/g, "");
          const senderNumber = normalizeJidNumber(senderJid);
          const isOwner = Boolean(msg.key.fromMe) || (ownerNumber && senderNumber === ownerNumber);
          if (!isOwner) {
            reply = "🚫💗 ᴏɴʟʏ ᴏᴡɴᴇʀ ᴄᴀɴ ᴜsᴇ ᴛʜɪs ᴄᴏᴍᴍᴀɴᴅ 🌸 |";
          } else {
            try {
              const metadata = await sock.groupMetadata(jid);
              const bot = findBotParticipant(metadata.participants || []);
              const botIsAdmin = !!bot && (bot.admin === "admin" || bot.admin === "superadmin");
              if (!botIsAdmin) {
                reply = "🥺💔 ʙᴏᴛ ᴍᴜsᴛ ʙᴇ ᴀɴ ᴀᴅᴍɪɴ ᴛᴏ ᴜsᴇ ᴋɪᴄᴋᴀʟʟ 🌸 |";
              } else {
                const targets = (metadata.participants || [])
                  .filter((p) => {
                    const isAdmin = p.admin === "admin" || p.admin === "superadmin";
                    const pId = String(p.id || "");
                    const pLid = String(p.lid || "");
                    const botId = String(bot?.id || "");
                    const botLid = String(bot?.lid || "");
                    const isBot = Boolean(bot) && (
                      (botId && (pId === botId || normalizeJidNumber(pId) === normalizeJidNumber(botId))) ||
                      (botLid && (pLid === botLid || normalizeJidNumber(pLid) === normalizeJidNumber(botLid)))
                    );
                    return !isAdmin && !isBot && p.id;
                  })
                  .map((p) => p.id);
                if (!targets.length) {
                  reply = "┏❐ 《 💗 𝐊𝐈𝐂𝐊𝐀𝐋𝐋 》 ❐\n┣◆ 🌸 𝐍ᴏ ɴᴏɴ-ᴀᴅᴍɪɴ ᴍᴇᴍʙᴇʀ ғᴏᴜɴᴅ\n┗❐";
                } else {
                  await sock.groupParticipantsUpdate(jid, targets, "remove");
                  reply = `┏❐ 《 💥 𝐊𝐈𝐂𝐊𝐀𝐋𝐋 》 ❐\n┣◆ 🦋 𝐑ᴇᴍᴏᴠᴇᴅ : ${targets.length} ᴍᴇᴍʙᴇʀ${targets.length === 1 ? "" : "s"}\n┣◆ ⚡ 𝐒ᴛᴀᴛᴜs : 𝐒ᴜᴄᴄᴇss\n┗❐`;
                }
              }
            } catch (kickAllError) {
              console.log(`    ⚠️ Kickall failed: ${kickAllError?.message || kickAllError}`);
              reply = "🥀💔 ᴋɪᴄᴋᴀʟʟ ғᴀɪʟᴇᴅ 🌸 |";
            }
          }
        }
      } else if (command === "kick") {
        if (!msg.key.remoteJid?.endsWith("@g.us")) {
          reply = "🌨️ *тнιѕ ᴄσммαɴ∂ σɴℓу ωσʀкѕ ιɴ gʀσυρѕ!*";
        } else {
          const metadata = await sock.groupMetadata(msg.key.remoteJid);
          const senderJid = msg.key.participant || msg.participant || "";
          const senderNumber = senderJid.split("@")[0].split(":")[0].replace(/\D/g, "");
          const ownerNumber = String(runtimeConfig.ownerNumber).replace(/\D/g, "");
          const isOwner = msg.key.fromMe || senderNumber === ownerNumber;
          const sender = findGroupParticipant(metadata.participants, senderJid);
          const senderIsAdmin = !!sender && (sender.admin === "admin" || sender.admin === "superadmin");

          if (!isOwner && !senderIsAdmin) {
            reply = "👑 *σɴℓу gʀσυρ α∂мιɴѕ ᴄαɴ υѕє тнιѕ ᴄσммαɴ∂.*";
          } else {
            const bot = findBotParticipant(metadata.participants);
            const botIsAdmin = !!bot && (bot.admin === "admin" || bot.admin === "superadmin");

            if (!botIsAdmin) {
              reply = "🏖️ *вσт мυѕт вє α∂мιɴ тσ υѕє тнιѕ ᴄσммαɴ∂!*";
            } else {
              const mentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
              const quotedParticipant = msg.message?.extendedTextMessage?.contextInfo?.participant || "";
              const targetJid = mentioned[0] || quotedParticipant || "";
              const targetNumber = targetJid.split("@")[0].split(":")[0].replace(/\D/g, "");
              const target = metadata.participants.find(p =>
                p.id === targetJid ||
                p.id?.split("@")[0].split(":")[0].replace(/\D/g, "") === targetNumber
              );

              if (!targetJid || !target) {
                reply = "*╰┈➤🥀 𝐑ᴇᴘʟʏ ᴛᴏ ᴀ ᴍᴇᴍʙᴇʀ ᴏʀ ᴛᴀɢ ᴛʜᴇᴍ ᴛᴏ ᴋɪᴄᴋ!*";
              } else {
                const targetIsAdmin = target.admin === "admin" || target.admin === "superadmin";
                const targetIsBot = !!bot && (target.id === bot.id || target.lid === bot.id || target.id === bot.lid || normalizeJidNumber(target.id) === normalizeJidNumber(bot.id) || normalizeJidNumber(target.lid) === normalizeJidNumber(bot.id));
                const targetIsOwner = target.id?.split("@")[0].split(":")[0].replace(/\D/g, "") === ownerNumber;

                if (targetIsBot) {
                  reply = "*╰┈➤🥀 𝐈 ᴄᴀɴ'ᴛ ᴋɪᴄᴋ ᴍʏsᴇʟғ!*";
                } else if (targetIsOwner || targetIsAdmin) {
                  reply = "*╰┈➤🥀 𝐀ᴅᴍɪɴ/𝐎ᴡɴᴇʀ ᴄᴀɴ'ᴛ ʙᴇ ᴋɪᴄᴋᴇᴅ!*";
                } else {
                  try {
                    await sock.groupParticipantsUpdate(msg.key.remoteJid, [target.id], "remove");
                    reply = `*╰┈➤🥀 𝐊ɪᴄᴋᴇᴅ*\n*╰┈➤👤 @${target.id.split("@")[0].split(":")[0]}*\n*╰┈➤💜 𝐗 𝐍ᴏʙɪᴛᴀ 𝐗𝐃*\n\n*╰┈➤💜 𝐏ᴏᴡᴇʀᴇᴅ ʙʏ 𝐗 𝐍ᴏʙɪᴛᴀ*`;
                    try {
                      await sock.sendMessage(msg.key.remoteJid, { text: reply, mentions: [target.id] }, { quoted: quotedContact });
                    } catch (e) {
                      await sock.sendMessage(msg.key.remoteJid, { text: reply, mentions: [target.id] });
                    }
                    return;
                  } catch (kickError) {
                    reply = `*╰┈➤🥀 𝐊ɪᴄᴋ ғᴀɪʟᴇᴅ: ${kickError?.message || "Unknown error"}*`;
                  }
                }
              }
            }
          }
        }
      } else if (command === "add") {
        if (!msg.key.remoteJid?.endsWith("@g.us")) {
          reply = "🌨️ *тнιѕ ᴄσммαɴ∂ σɴℓу ωσʀκѕ ιɴ gʀσυρѕ!*";
        } else {
          const metadata = await sock.groupMetadata(msg.key.remoteJid);
          const senderJid = msg.key.participant || msg.participant || "";
          const senderNumber = senderJid.split("@")[0].split(":")[0].replace(/\D/g, "");
          const ownerNumber = String(runtimeConfig.ownerNumber).replace(/\D/g, "");
          const isOwner = msg.key.fromMe || senderNumber === ownerNumber;
          const sender = findGroupParticipant(metadata.participants, senderJid);
          const senderIsAdmin = !!sender && (sender.admin === "admin" || sender.admin === "superadmin");
          if (!isOwner && !senderIsAdmin) {
            reply = "👑 *σɴℓу gʀσυρ α∂мιɴѕ ᴄαɴ υѕє тнιѕ ᴄσммαɴ∂.*";
          } else {
            const bot = findBotParticipant(metadata.participants);
            const botIsAdmin = !!bot && (bot.admin === "admin" || bot.admin === "superadmin");
            if (!botIsAdmin) {
              reply = "🏖️ *вσт мυѕт вє α∂мιɴ тσ υѕє тнιѕ ᴄσммαɴ∂!*";
            } else if (!args[0]) {
              reply = `*╰┈➤📛 𝐔sᴀɢᴇ: ${runtimeConfig.prefix}add 917XXXXXXXXX*`;
            } else {
              const cleanNumber = String(args[0]).replace(/\D/g, "");
              if (!cleanNumber || cleanNumber.length < 7) {
                reply = "*╰┈➤📛 𝐈ɴᴠᴀʟɪᴅ 𝐍ᴜᴍʙᴇʀ!*";
              } else {
                const targetJid = `${cleanNumber}@s.whatsapp.net`;
                try {
                  await sock.groupParticipantsUpdate(msg.key.remoteJid, [targetJid], "add");
                  reply = `*╰┈➤🎀 𝐀ᴅᴅᴇᴅ: @${cleanNumber}*\n*╰┈➤💜 𝐗 𝐍ᴏʙɪᴛᴀ 𝐗𝐃*`;
                  try {
                    await sock.sendMessage(msg.key.remoteJid, { text: reply, mentions: [targetJid] }, { quoted: quotedContact });
                  } catch (e) {
                    await sock.sendMessage(msg.key.remoteJid, { text: reply, mentions: [targetJid] });
                  }
                  return;
                } catch (addError) {
                  reply = "*╰┈➤🥀 𝐀ᴅᴅ ғᴀɪʟᴇᴅ! 𝐏ʟᴇᴀsᴇ ᴄʜᴇᴄᴋ ᴛʜᴇ 𝐍ᴜᴍʙᴇʀ.*";
                }
              }
            }
          }
        }
      } else if (command === "unlock") {
        if (!msg.key.remoteJid?.endsWith("@g.us")) {
          reply = "*𝐓ʜɪs 𝐂ᴏᴍᴍᴀɴᴅ 𝐎ɴʟʏ 𝐖ᴏʀᴋs 𝐈ɴ 𝐆ʀᴏᴜᴘs!🌨️❤️‍🩹*";
        } else {
          const metadata = await sock.groupMetadata(msg.key.remoteJid);
          const senderJid =
            msg.key.participant ||
            msg.participant ||
            msg.key.senderPn ||
            msg.key.senderLid ||
            "";
          const senderNumber = normalizeJidNumber(senderJid);
          const ownerNumber = String(runtimeConfig.ownerNumber).replace(/\D/g, "");
          const botIds = [
            sock.user?.id,
            sock.user?.lid,
            sock.user?.jid
          ].filter(Boolean);
          const isBotAccount = botIds.some(id =>
            id === senderJid ||
            normalizeJidNumber(id) === senderNumber
          );
          const isOwner = Boolean(msg.key.fromMe) || senderNumber === ownerNumber || isBotAccount;
          const sender = findGroupParticipant(metadata.participants, senderJid);
          const senderIsAdmin = !!sender && (sender.admin === "admin" || sender.admin === "superadmin");

          if (!isOwner && !senderIsAdmin) {
            reply = "*𝐎ɴʟʏ 𝐎ᴡɴᴇʀ 𝐂ᴀɴ 𝐔sᴇ 𝐓ʜɪs 𝐂ᴏᴍᴍᴀɴᴅ!👑💜*";
          } else {
            const bot = findBotParticipant(metadata.participants);
            const botIsAdmin = !!bot && (bot.admin === "admin" || bot.admin === "superadmin");
            if (!botIsAdmin) {
              reply = "*вσт мυѕт вє α∂мιɴ тσ υѕє тнιѕ ᴄσммαɴ∂!🏖️💜*";
            } else {
              try {
                await sock.groupSettingUpdate(msg.key.remoteJid, "unlocked");
                reply = "*𝐆ʀᴏᴜᴘ 𝐒ᴇᴛᴛɪɴɢs 𝐔ɴʟᴏᴄᴋᴇᴅ!🔓💋❤️‍🩹*";
              } catch (e) {
                reply = "*𝐆ʀᴏᴜᴘ 𝐒ᴇᴛᴛɪɴɢs 𝐔ɴʟᴏᴄᴋ ғᴀɪʟᴇᴅ!🥀❤️‍🩹*";
              }
            }
          }
        }
      } else if (command === "setgpp") {
        if (!msg.key.remoteJid?.endsWith("@g.us")) {
          reply = "*𝐓ʜɪs 𝐂ᴏᴍᴍᴀɴᴅ 𝐎ɴʟʏ 𝐖ᴏʀᴋs 𝐈ɴ 𝐆ʀᴏᴜᴘs!🌨️❤️‍🩹*";
        } else {
          const metadata = await sock.groupMetadata(msg.key.remoteJid);
          const senderJid = msg.key.participant || msg.participant || "";
          const senderNumber = normalizeJidNumber(senderJid);
          const ownerNumber = String(runtimeConfig.ownerNumber).replace(/\D/g, "");
          const isOwner = msg.key.fromMe || senderNumber === ownerNumber;
          const sender = findGroupParticipant(metadata.participants, senderJid);
          const senderIsAdmin = !!sender && (sender.admin === "admin" || sender.admin === "superadmin");

          if (!isOwner && !senderIsAdmin) {
            reply = "👑 *σɴℓу gʀσυρ α∂мιɴѕ ᴄαɴ υѕє тнιѕ ᴄσммαɴ∂.*";
          } else {
            const bot = findBotParticipant(metadata.participants);
            const botIsAdmin = !!bot && (bot.admin === "admin" || bot.admin === "superadmin");

            if (!botIsAdmin) {
              reply = "*вσт мυѕт вє α∂мιɴ тσ υѕє тнιѕ ᴄσммαɴ∂!🏖️💜*";
            } else {
              const contextInfo = msg.message?.extendedTextMessage?.contextInfo;
              const quotedMessage = contextInfo?.quotedMessage;
              const imageMessage = quotedMessage?.imageMessage;

              if (!imageMessage) {
                reply = "*𝐑ᴇᴘʟʏ ᴛᴏ ᴀɴ 𝐈ᴍᴀɢᴇ 𝐓ᴏ 𝐒ᴇᴛ 𝐆ʀᴏᴜᴘ 𝐃𝐏!🖼️🌷*";
              } else {
                try {
                  const mediaMsg = {
                    key: {
                      remoteJid: msg.key.remoteJid,
                      id: contextInfo?.stanzaId || msg.key.id,
                      participant: contextInfo?.participant || senderJid
                    },
                    message: { imageMessage }
                  };

                  const buffer = await downloadMediaMessage(
                    mediaMsg,
                    "buffer",
                    {},
                    {
                      logger: pino({ level: "silent" }),
                      reuploadRequest: sock.updateMediaMessage
                    }
                  );

                  await sock.updateProfilePicture(msg.key.remoteJid, buffer);
                  reply = "*𝐆ʀᴏᴜᴘ 𝐃𝐏 𝐔ᴘᴅᴀᴛᴇᴅ 𝐒ᴜᴄᴄᴇssғᴜʟʟʏ!🖼️💜*";
                } catch (e) {
                  console.error("setgpp error:", e?.message || e);
                  reply = "*𝐆ʀᴏᴜᴘ 𝐃𝐏 𝐔ᴘᴅᴀᴛᴇ ғᴀɪʟᴇᴅ!🥀❤️‍🩹*";
                }
              }
            }
          }
        }
      } else if (command === "groupdp") {
        if (!msg.key.remoteJid?.endsWith("@g.us")) {
          reply = "🌨️ *тнιѕ ᴄσммαɴ∂ σɴℓу ωσʀкѕ ιɴ gʀσυρѕ!*";
        } else {
          const metadata = await sock.groupMetadata(msg.key.remoteJid);
          const senderJid = msg.key.participant || msg.participant || "";
          const senderNumber = normalizeJidNumber(senderJid);
          const ownerNumber = String(runtimeConfig.ownerNumber).replace(/\D/g, "");
          const isOwner = msg.key.fromMe || senderNumber === ownerNumber;
          const sender = findGroupParticipant(metadata.participants, senderJid);
          const senderIsAdmin = !!sender && (sender.admin === "admin" || sender.admin === "superadmin");

          if (!isOwner && !senderIsAdmin) {
            reply = "👑 *σɴℓу gʀσυρ α∂мιɴѕ ᴄαɴ υѕє тнιѕ ᴄσммαɴ∂.*";
          } else {
            const bot = findBotParticipant(metadata.participants);
            const botIsAdmin = !!bot && (bot.admin === "admin" || bot.admin === "superadmin");
            if (!botIsAdmin) {
              reply = "🏖️ *вσт мυѕт вє α∂мιɴ тσ υѕє тнιѕ ᴄσммαɴ∂!*";
            } else {
              const contextInfo = msg.message?.extendedTextMessage?.contextInfo;
              const imageMessage = contextInfo?.quotedMessage?.imageMessage;
              if (!imageMessage) {
                reply = "*𝐑ᴇᴘʟʏ ᴛᴏ ᴀɴ 𝐈ᴍᴀɢᴇ ᴛᴏ 𝐒ᴇᴛ 𝐆ʀᴏᴜᴘ 𝐃𝐏!🖼️🌷*";
              } else {
                try {
                  const mediaMsg = {
                    key: {
                      remoteJid: msg.key.remoteJid,
                      id: contextInfo?.stanzaId || msg.key.id,
                      participant: contextInfo?.participant || senderJid
                    },
                    message: { imageMessage }
                  };
                  const buffer = await downloadMediaMessage(
                    mediaMsg,
                    "buffer",
                    {},
                    {
                      logger: pino({ level: "silent" }),
                      reuploadRequest: sock.updateMediaMessage
                    }
                  );
                  await sock.updateProfilePicture(msg.key.remoteJid, buffer);
                  reply = "*𝐆ʀᴏᴜᴘ 𝐃𝐏 𝐔ᴘᴅᴀᴛᴇᴅ 𝐒ᴜᴄᴄᴇssғᴜʟʟʏ!🖼️💜*";
                } catch (e) {
                  console.error("groupdp error:", e?.message || e);
                  reply = "*𝐆ʀᴏᴜᴘ 𝐃𝐏 𝐔ᴘᴅᴀᴛᴇ ғᴀɪʟᴇᴅ!🥀❤️‍🩹*";
                }
              }
            }
          }
        }
      } else if (command === "subject") {
        if (!msg.key.remoteJid?.endsWith("@g.us")) {
          reply = "*𝐓ʜɪs 𝐂ᴏᴍᴍᴀɴᴅ 𝐎ɴʟʏ 𝐖ᴏʀᴋs 𝐈ɴ 𝐆ʀᴏᴜᴘs!🌨️❤️‍🩹*";
        } else {
          const metadata = await sock.groupMetadata(msg.key.remoteJid);
          const senderJid = msg.key.participant || msg.participant || "";
          const senderNumber = normalizeJidNumber(senderJid);
          const ownerNumber = String(runtimeConfig.ownerNumber).replace(/\D/g, "");
          const isOwner = msg.key.fromMe || senderNumber === ownerNumber;
          const sender = findGroupParticipant(metadata.participants, senderJid);
          const senderIsAdmin = !!sender && (sender.admin === "admin" || sender.admin === "superadmin");

          if (!isOwner && !senderIsAdmin) {
            reply = "*𝐎ɴʟʏ 𝐆ʀᴏᴜᴘ 𝐀ᴅᴍɪɴs 𝐂ᴀɴ 𝐔sᴇ 𝐓ʜɪs 𝐂ᴏᴍᴍᴀɴᴅ!👑💜*";
          } else {
            const bot = findBotParticipant(metadata.participants);
            const botIsAdmin = !!bot && (bot.admin === "admin" || bot.admin === "superadmin");

            if (!botIsAdmin) {
              reply = "*𝐁ᴏᴛ 𝐌ᴜsᴛ 𝐁ᴇ 𝐀ᴅᴍɪɴ 𝐓ᴏ 𝐔sᴇ 𝐓ʜɪs 𝐂ᴏᴍᴍᴀɴᴅ!🏖️💜*";
            } else if (!args.length) {
              reply = "*𝐏ʟᴇᴀsᴇ 𝐏ʀᴏᴠɪᴅᴇ 𝐀 𝐍ᴇᴡ 𝐆ʀᴏᴜᴘ 𝐍ᴀᴍᴇ!🌷💜*";
            } else {
              try {
                await sock.groupUpdateSubject(msg.key.remoteJid, args.join(" "));
                reply = "*𝐆ʀᴏᴜᴘ 𝐍ᴀᴍᴇ 𝐔ᴘᴅᴀᴛᴇᴅ 𝐒ᴜᴄᴄᴇssғᴜʟʟʏ!🌸💜*";
              } catch (e) {
                console.error("subject error:", e?.message || e);
                reply = "*𝐆ʀᴏᴜᴘ 𝐍ᴀᴍᴇ 𝐔ᴘᴅᴀᴛᴇ ғᴀɪʟᴇᴅ!🥀❤️‍🩹*";
              }
            }
          }
        }
      } else if (command === "desc") {
        if (!msg.key.remoteJid?.endsWith("@g.us")) {
          reply = "*𝐓ʜɪs 𝐂ᴏᴍᴍᴀɴᴅ 𝐎ɴʟʏ 𝐖ᴏʀᴋs 𝐈ɴ 𝐆ʀᴏᴜᴘs!🌨️❤️‍🩹*";
        } else {
          const metadata = await sock.groupMetadata(msg.key.remoteJid);
          const senderJid = msg.key.participant || msg.participant || "";
          const senderNumber = normalizeJidNumber(senderJid);
          const ownerNumber = String(runtimeConfig.ownerNumber).replace(/\D/g, "");
          const isOwner = msg.key.fromMe || senderNumber === ownerNumber;
          const sender = findGroupParticipant(metadata.participants, senderJid);
          const senderIsAdmin = !!sender && (sender.admin === "admin" || sender.admin === "superadmin");

          if (!isOwner && !senderIsAdmin) {
            reply = "*𝐎ɴʟʏ 𝐆ʀᴏᴜᴘ 𝐀ᴅᴍɪɴs 𝐂ᴀɴ 𝐔sᴇ 𝐓ʜɪs 𝐂ᴏᴍᴍᴀɴᴅ!👑💜*";
          } else {
            const bot = findBotParticipant(metadata.participants);
            const botIsAdmin = !!bot && (bot.admin === "admin" || bot.admin === "superadmin");

            if (!botIsAdmin) {
              reply = "*𝐁ᴏᴛ 𝐌ᴜsᴛ 𝐁ᴇ 𝐀ᴅᴍɪɴ 𝐓ᴏ 𝐔sᴇ 𝐓ʜɪs 𝐂ᴏᴍᴍᴀɴᴅ!🏖️💜*";
            } else if (!args.length) {
              reply = "*𝐏ʟᴇᴀsᴇ 𝐏ʀᴏᴠɪᴅᴇ 𝐀 𝐍ᴇᴡ 𝐆ʀᴏᴜᴘ 𝐃ᴇsᴄʀɪᴘᴛɪᴏɴ!🌷💜*";
            } else {
              try {
                await sock.groupUpdateDescription(msg.key.remoteJid, args.join(" "));
                reply = "*𝐆ʀᴏᴜᴘ 𝐃ᴇsᴄʀɪᴘᴛɪᴏɴ 𝐔ᴘᴅᴀᴛᴇᴅ 𝐒ᴜᴄᴄᴇssғᴜʟʟʏ!📝💜*";
              } catch (e) {
                console.error("desc error:", e?.message || e);
                reply = "*𝐆ʀᴏᴜᴘ 𝐃ᴇsᴄʀɪᴘᴛɪᴏɴ 𝐔ᴘᴅᴀᴛᴇ ғᴀɪʟᴇᴅ!🥀❤️‍🩹*";
              }
            }
          }
        }
      } else if (command === "groupinfo") {
        if (!msg.key.remoteJid?.endsWith("@g.us")) {
          reply = "*𝐓ʜɪs 𝐂ᴏᴍᴍᴀɴᴅ 𝐎ɴʟʏ 𝐖ᴏʀᴋs 𝐈ɴ 𝐆ʀᴏᴜᴘs!🌨️❤️‍🩹*";
        } else {
          const metadata = await sock.groupMetadata(msg.key.remoteJid);
          const senderJid = msg.key.participant || msg.participant || "";
          const senderNumber = normalizeJidNumber(senderJid);
          const ownerNumber = String(runtimeConfig.ownerNumber).replace(/\D/g, "");
          const isOwner = msg.key.fromMe || senderNumber === ownerNumber;
          const sender = findGroupParticipant(metadata.participants, senderJid);
          const senderIsAdmin = !!sender && (sender.admin === "admin" || sender.admin === "superadmin");

          if (!isOwner && !senderIsAdmin) {
            reply = "*𝐎ɴʟʏ 𝐆ʀᴏᴜᴘ 𝐀ᴅᴍɪɴs 𝐂ᴀɴ 𝐔sᴇ 𝐓ʜɪs 𝐂ᴏᴍᴍᴀɴᴅ!👑💜*";
          } else {
            const admins = metadata.participants.filter(p => p.admin === "admin" || p.admin === "superadmin");
            const groupOwner = metadata.owner || metadata.subjectOwner || "Unknown";
            const ownerTag = groupOwner && groupOwner.includes("@") ? `@${groupOwner.split("@")[0].split(":")[0]}` : groupOwner;
            const mentions = groupOwner && groupOwner.includes("@") ? [groupOwner] : [];
            reply = `*╰┈➤👥 𝐆ʀᴏᴜᴘ 𝐈ɴғᴏ*\n\n*╰┈➤🌸 𝐍ᴀᴍᴇ:* ${metadata.subject || "Unknown"}\n*╰┈➤🆔 𝐈ᴅ:* ${msg.key.remoteJid}\n*╰┈➤👑 𝐎ᴡɴᴇʀ:* ${ownerTag}\n*╰┈➤👥 𝐌ᴇᴍʙᴇʀs:* ${metadata.participants.length}\n*╰┈➤🛡️ 𝐀ᴅᴍɪɴs:* ${admins.length}\n\n*╰┈➤💜 𝐗 𝐍ᴏʙɪᴛᴀ 𝐗𝐃*\n*╰┈➤💜 𝐏ᴏᴡᴇʀᴇᴅ ʙʏ 𝐗 𝐍ᴏʙɪᴛᴀ*`;
            try {
              await sock.sendMessage(msg.key.remoteJid, { text: reply, mentions }, { quoted: quotedContact });
            } catch (e) {
              await sock.sendMessage(msg.key.remoteJid, { text: reply, mentions }, { quoted: quotedContact });
            }
            return;
          }
        }
      } else if (command === "invite") {
        if (!msg.key.remoteJid?.endsWith("@g.us")) {
          reply = "*𝐓ʜɪs 𝐂ᴏᴍᴍᴀɴᴅ 𝐎ɴʟʏ 𝐖ᴏʀᴋs 𝐈ɴ 𝐆ʀᴏᴜᴘs!🌨️❤️‍🩹*";
        } else {
          const metadata = await sock.groupMetadata(msg.key.remoteJid);
          const senderJid = msg.key.participant || msg.participant || "";
          const senderNumber = normalizeJidNumber(senderJid);
          const ownerNumber = String(runtimeConfig.ownerNumber).replace(/\D/g, "");
          const isOwner = msg.key.fromMe || senderNumber === ownerNumber;
          const sender = findGroupParticipant(metadata.participants, senderJid);
          const senderIsAdmin = !!sender && (sender.admin === "admin" || sender.admin === "superadmin");

          if (!isOwner && !senderIsAdmin) {
            reply = "*𝐎ɴʟʏ 𝐆ʀᴏᴜᴘ 𝐀ᴅᴍɪɴs 𝐂ᴀɴ 𝐔sᴇ 𝐓ʜɪs 𝐂ᴏᴍᴍᴀɴᴅ!👑💜*";
          } else {
            const bot = findBotParticipant(metadata.participants);
            const botIsAdmin = !!bot && (bot.admin === "admin" || bot.admin === "superadmin");

            if (!botIsAdmin) {
              reply = "*𝐁ᴏᴛ 𝐌ᴜsᴛ 𝐁ᴇ 𝐀ᴅᴍɪɴ 𝐓ᴏ 𝐔sᴇ 𝐓ʜɪs 𝐂ᴏᴍᴍᴀɴᴅ!🏖️💜*";
            } else {
              try {
                const inviteCode = await sock.groupInviteCode(msg.key.remoteJid);
                const inviteLink = `https://chat.whatsapp.com/${inviteCode}`;
                reply = `*𝐆ʀᴏᴜᴘ 𝐈ɴᴠɪᴛᴇ 𝐋ɪɴᴋ 𝐆ᴇɴᴇʀᴀᴛᴇᴅ!🔗💜*\n\n${inviteLink}`;
              } catch (e) {
                console.error("invite error:", e?.message || e);
                reply = "*𝐆ʀᴏᴜᴘ 𝐈ɴᴠɪᴛᴇ 𝐋ɪɴᴋ 𝐆ᴇɴᴇʀᴀᴛᴇ ғᴀɪʟᴇᴅ!🥀❤️‍🩹*";
              }
            }
          }
        }
      } else if (command === "revoke") {
        if (!msg.key.remoteJid?.endsWith("@g.us")) {
          reply = "*𝐓ʜɪs 𝐂ᴏᴍᴍᴀɴᴅ 𝐎ɴʟʏ 𝐖ᴏʀᴋs 𝐈ɴ 𝐆ʀᴏᴜᴘs!🌨️❤️‍🩹*";
        } else {
          const metadata = await sock.groupMetadata(msg.key.remoteJid);
          const senderJid = msg.key.participant || msg.participant || "";
          const senderNumber = normalizeJidNumber(senderJid);
          const ownerNumber = String(runtimeConfig.ownerNumber).replace(/\D/g, "");
          const isOwner = msg.key.fromMe || senderNumber === ownerNumber;
          const sender = findGroupParticipant(metadata.participants, senderJid);
          const senderIsAdmin = !!sender && (sender.admin === "admin" || sender.admin === "superadmin");

          if (!isOwner && !senderIsAdmin) {
            reply = "*𝐎ɴʟʏ 𝐆ʀᴏᴜᴘ 𝐀ᴅᴍɪɴs 𝐂ᴀɴ 𝐔sᴇ 𝐓ʜɪs 𝐂ᴏᴍᴍᴀɴᴅ!👑💜*";
          } else {
            const bot = findBotParticipant(metadata.participants);
            const botIsAdmin = !!bot && (bot.admin === "admin" || bot.admin === "superadmin");

            if (!botIsAdmin) {
              reply = "*𝐁ᴏᴛ 𝐌ᴜsᴛ 𝐁ᴇ 𝐀ᴅᴍɪɴ 𝐓ᴏ 𝐔sᴇ 𝐓ʜɪs 𝐂ᴏᴍᴍᴀɴᴅ!🏖️💜*";
            } else {
              try {
                await sock.groupRevokeInvite(msg.key.remoteJid);
                reply = "*𝐆ʀᴏᴜᴘ 𝐈ɴᴠɪᴛᴇ 𝐋ɪɴᴋ 𝐑ᴇᴠᴏᴋᴇᴅ 𝐒ᴜᴄᴄᴇssғᴜʟʟʏ!♻️💜*";
              } catch (revokeError) {
                console.error("revoke error:", revokeError?.message || revokeError);
                reply = "*𝐆ʀᴏᴜᴘ 𝐈ɴᴠɪᴛᴇ 𝐋ɪɴᴋ 𝐑ᴇᴠᴏᴋᴇ ғᴀɪʟᴇᴅ!🥀❤️‍🩹*";
              }
            }
          }
        }
      } else if (command === "requests") {
        if (!msg.key.remoteJid?.endsWith("@g.us")) {
          reply = "*𝐓ʜɪs 𝐂ᴏᴍᴍᴀɴᴅ 𝐎ɴʟʏ 𝐖ᴏʀᴋs 𝐈ɴ 𝐆ʀᴏᴜᴘs!🌨️❤️‍🩹*";
        } else {
          const metadata = await sock.groupMetadata(msg.key.remoteJid);
          const senderJid = msg.key.participant || msg.participant || "";
          const senderNumber = normalizeJidNumber(senderJid);
          const ownerNumber = String(runtimeConfig.ownerNumber).replace(/\D/g, "");
          const isOwner = msg.key.fromMe || senderNumber === ownerNumber;
          const sender = findGroupParticipant(metadata.participants, senderJid);
          const senderIsAdmin = !!sender && (sender.admin === "admin" || sender.admin === "superadmin");

          if (!isOwner && !senderIsAdmin) {
            reply = "*𝐎ɴʟʏ 𝐆ʀᴏᴜᴘ 𝐀ᴅᴍɪɴs 𝐂ᴀɴ 𝐔sᴇ 𝐓ʜɪs 𝐂ᴏᴍᴍᴀɴᴅ!👑💜*";
          } else {
            try {
              const requests = await sock.groupRequestParticipantsList(msg.key.remoteJid);
              if (!requests || !requests.length) {
                reply = "*𝐍ᴏ 𝐉ᴏɪɴ 𝐑ᴇǫᴜᴇsᴛs 𝐅ᴏᴜɴᴅ!📩💜*";
              } else {
                const mentions = requests.map(r => r.jid || r.id).filter(Boolean);
                const list = mentions.map(jid => `👤 @${jid.split("@")[0].split(":")[0]}`).join("\n");
                reply = `*𝐉ᴏɪɴ 𝐑ᴇǫᴜᴇsᴛs 📩💜*\n\n${list}\n\n*𝐗 𝐍ᴏʙɪᴛᴀ 𝐗𝐃*`;
                try {
                  await sock.sendMessage(msg.key.remoteJid, { text: reply, mentions }, { quoted: quotedContact });
                } catch (e) {
                  await sock.sendMessage(msg.key.remoteJid, { text: reply, mentions }, { quoted: quotedContact });
                }
                return;
              }
            } catch (e) {
              console.error("requests error:", e?.message || e);
              reply = "*𝐉ᴏɪɴ 𝐑ᴇǫᴜᴇsᴛs 𝐅ᴀɪʟᴇᴅ!🥀❤️‍🩹*";
            }
          }
        }
      } else if (command === "approve") {
        if (!msg.key.remoteJid?.endsWith("@g.us")) {
          reply = "*𝐓ʜɪs 𝐂ᴏᴍᴍᴀɴᴅ 𝐎ɴʟʏ 𝐖ᴏʀᴋs 𝐈ɴ 𝐆ʀᴏᴜᴘs!🌨️❤️‍🩹*";
        } else {
          const jid = msg.key.remoteJid;
          const metadata = await sock.groupMetadata(jid);
          const senderJid = msg.key.participant || msg.participant || "";
          const senderNumber = normalizeJidNumber(senderJid);
          const ownerNumber = String(runtimeConfig.ownerNumber).replace(/\D/g, "");
          const isOwner = msg.key.fromMe || senderNumber === ownerNumber;
          const sender = findGroupParticipant(metadata.participants, senderJid);
          const senderIsAdmin = !!sender && (sender.admin === "admin" || sender.admin === "superadmin");

          if (!isOwner && !senderIsAdmin) {
            reply = "*𝐎ɴʟʏ 𝐆ʀᴏᴜᴘ 𝐀ᴅᴍɪɴs 𝐂ᴀɴ 𝐔sᴇ 𝐓ʜɪs 𝐂ᴏᴍᴍᴀɴᴅ!👑💜*";
          } else {
            const context = msg.message?.extendedTextMessage?.contextInfo || {};
            const mentioned = context.mentionedJid || [];
            let target = mentioned[0] || "";
            if (!target && context.participant) target = context.participant;
            if (!target) {
              reply = "*𝐏ʟᴇᴀsᴇ 𝐌ᴇɴᴛɪᴏɴ 𝐀 𝐉ᴏɪɴ 𝐑ᴇǫᴜᴇsᴛ 𝐌ᴇᴍʙᴇʀ 𝐓ᴏ 𝐀ᴘᴘʀᴏᴠᴇ!📩🌷*";
            } else {
              const targetJid = target.includes("@") ? target : `${target}@s.whatsapp.net`;
              const bot = findBotParticipant(metadata.participants);
              const botIsAdmin = !!bot && (bot.admin === "admin" || bot.admin === "superadmin");
              if (!botIsAdmin) {
                reply = "*𝐁ᴏᴛ 𝐌ᴜsᴛ 𝐁ᴇ 𝐀ᴅᴍɪɴ 𝐓ᴏ 𝐔sᴇ 𝐓ʜɪs 𝐂ᴏᴍᴍᴀɴᴅ!🏖️💜*";
              } else {
                try {
                  await sock.groupRequestParticipantsUpdate(jid, [targetJid], "approve");
                  reply = `*𝐉ᴏɪɴ 𝐑ᴇǫᴜᴇsᴛ 𝐀ᴘᴘʀᴏᴠᴇᴅ 𝐒ᴜᴄᴄᴇssғᴜʟʟʏ!✅💜*\n\n👤 @${targetJid.split("@")[0].split(":")[0]}`;
                  try {
                    await sock.sendMessage(jid, { text: reply, mentions: [targetJid] }, { quoted: quotedContact });
                  } catch (e) {
                    await sock.sendMessage(jid, { text: reply, mentions: [targetJid] });
                  }
                  return;
                } catch (e) {
                  console.error("approve error:", e?.message || e);
                  reply = "*𝐉ᴏɪɴ 𝐑ᴇǫᴜᴇsᴛ 𝐀ᴘᴘʀᴏᴠᴇ ғᴀɪʟᴇᴅ!🥀❤️‍🩹*";
                }
              }
            }
          }
        }
      } else if (command === "reject") {
        if (!msg.key.remoteJid?.endsWith("@g.us")) {
          reply = "*𝐓ʜɪs 𝐂ᴏᴍᴍᴀɴᴅ 𝐎ɴʟʏ 𝐖ᴏʀᴋs 𝐈ɴ 𝐆ʀᴏᴜᴘs!🌨️❤️‍🩹*";
        } else {
          const jid = msg.key.remoteJid;
          const metadata = await sock.groupMetadata(jid);
          const senderJid = msg.key.participant || msg.participant || "";
          const senderNumber = normalizeJidNumber(senderJid);
          const ownerNumber = String(runtimeConfig.ownerNumber).replace(/\D/g, "");
          const isOwner = msg.key.fromMe || senderNumber === ownerNumber;
          const sender = findGroupParticipant(metadata.participants, senderJid);
          const senderIsAdmin = !!sender && (sender.admin === "admin" || sender.admin === "superadmin");

          if (!isOwner && !senderIsAdmin) {
            reply = "*𝐎ɴʟʏ 𝐆ʀᴏᴜᴘ 𝐀ᴅᴍɪɴs 𝐂ᴀɴ 𝐔sᴇ 𝐓ʜɪs 𝐂ᴏᴍᴍᴀɴᴅ!👑💜*";
          } else {
            const context = msg.message?.extendedTextMessage?.contextInfo || {};
            const mentioned = context.mentionedJid || [];
            let target = mentioned[0] || "";
            if (!target && context.participant) target = context.participant;
            if (!target) {
              reply = "*𝐑ᴇᴘʟʏ 𝐓ᴏ 𝐀 𝐉ᴏɪɴ 𝐑ᴇǫᴜᴇsᴛ 𝐎ʀ 𝐌ᴇɴᴛɪᴏɴ 𝐀 𝐌ᴇᴍʙᴇʀ 𝐓ᴏ 𝐑ᴇᴊᴇᴄᴛ!📩🌷*";
            } else {
              const targetJid = target.includes("@") ? target : `${target}@s.whatsapp.net`;
              const bot = findBotParticipant(metadata.participants);
              const botIsAdmin = !!bot && (bot.admin === "admin" || bot.admin === "superadmin");
              if (!botIsAdmin) {
                reply = "*𝐁ᴏᴛ 𝐌ᴜsᴛ 𝐁ᴇ 𝐀ᴅᴍɪɴ 𝐓ᴏ 𝐔sᴇ 𝐓ʜɪs 𝐂ᴏᴍᴍᴀɴᴅ!🏖️💜*";
              } else {
                try {
                  await sock.groupRequestParticipantsUpdate(jid, [targetJid], "reject");
                  reply = `*𝐉ᴏɪɴ 𝐑ᴇǫᴜᴇsᴛ 𝐑ᴇᴊᴇᴄᴛᴇᴅ 𝐒ᴜᴄᴄᴇssғᴜʟʟʏ!❌💜*\n\n👤 @${targetJid.split("@")[0].split(":")[0]}`;
                  try {
                    await sock.sendMessage(jid, { text: reply, mentions: [targetJid] }, { quoted: quotedContact });
                  } catch (e) {
                    await sock.sendMessage(jid, { text: reply, mentions: [targetJid] });
                  }
                  return;
                } catch (e) {
                  console.error("reject error:", e?.message || e);
                  reply = "*𝐉ᴏɪɴ 𝐑ᴇǫᴜᴇsᴛ 𝐑ᴇᴊᴇᴄᴛ ғᴀɪʟᴇᴅ!🥀❤️‍🩹*";
                }
              }
            }
          }
        }
      } else if (command === "poll") {
        if (!msg.key.remoteJid?.endsWith("@g.us")) {
          reply = "*𝐓ʜɪs 𝐂ᴏᴍᴍᴀɴᴅ 𝐎ɴʟʏ 𝐖ᴏʀᴋs 𝐈ɴ 𝐆ʀᴏᴜᴘs!🌨️❤️‍🩹*";
        } else {
          const metadata = await sock.groupMetadata(msg.key.remoteJid);
          const senderJid = msg.key.participant || msg.participant || "";
          const senderNumber = normalizeJidNumber(senderJid);
          const ownerNumber = String(runtimeConfig.ownerNumber).replace(/\D/g, "");
          const isOwner = msg.key.fromMe || senderNumber === ownerNumber;
          const sender = findGroupParticipant(metadata.participants, senderJid);
          const senderIsAdmin = !!sender && (sender.admin === "admin" || sender.admin === "superadmin");

          if (!isOwner && !senderIsAdmin) {
            reply = "*𝐎ɴʟʏ 𝐆ʀᴏᴜᴘ 𝐀ᴅᴍɪɴs 𝐂ᴀɴ 𝐔sᴇ 𝐓ʜɪs 𝐂ᴏᴍᴍᴀɴᴅ!👑💜*";
          } else if (!args.length) {
            reply = `*𝐔sᴀɢᴇ: ${runtimeConfig.prefix}poll 𝐐ᴜᴇsᴛɪᴏɴ | 𝐎ᴘᴛɪᴏɴ𝟏 | 𝐎ᴘᴛɪᴏɴ𝟐 | ...* 📊🌷`;
          } else {
            const pollText = text.slice(runtimeConfig.prefix.length).trim().slice(command.length).trim();
            const parts = pollText.split("|").map(p => p.trim()).filter(Boolean);
            const question = parts[0];
            const options = parts.slice(1);

            if (!question || options.length < 2) {
              reply = `*𝐔sᴀɢᴇ: ${runtimeConfig.prefix}poll 𝐐ᴜᴇsᴛɪᴏɴ | 𝐎ᴘᴛɪᴏɴ𝟏 | 𝐎ᴘᴛɪᴏɴ𝟐 | ...* 📊🌷`;
            } else if (options.length > 12) {
              reply = "*𝐌ᴀxɪᴍᴜᴍ 𝟏𝟐 𝐎ᴘᴛɪᴏɴs 𝐀ʟʟᴏᴡᴇᴅ!📊🌷*";
            } else {
              try {
                await sock.sendMessage(
                  msg.key.remoteJid,
                  { poll: { name: question, values: options, selectableCount: 1 } },
                  { quoted: quotedContact }
                );
                reply = "*𝐏ᴏʟʟ 𝐂ʀᴇᴀᴛᴇᴅ 𝐒ᴜᴄᴄᴇssғᴜʟʟʏ!📊💜*\n\n*𝐗 𝐍ᴏʙɪᴛᴀ 𝐗𝐃*\n*𝐏ᴏᴡᴇʀᴇᴅ ʙʏ 𝐗 𝐍ᴏʙɪᴛᴀ*";
              } catch (e) {
                console.error("poll error:", e?.message || e);
                reply = "*𝐏ᴏʟʟ 𝐂ʀᴇᴀᴛᴇ ғᴀɪʟᴇᴅ!🥀❤️‍🩹*";
              }
            }
          }
        }
      } else if (command === "lock") {
        if (!msg.key.remoteJid?.endsWith("@g.us")) {
          reply = "*𝐓ʜɪs 𝐂ᴏᴍᴍᴀɴᴅ 𝐎ɴʟʏ 𝐖ᴏʀᴋs 𝐈ɴ 𝐆ʀᴏᴜᴘs!🌨️❤️‍🩹*";
        } else {
          const senderJid = msg.key.participant || msg.participant || "";
          const senderNumber = senderJid.split("@")[0].split(":")[0].replace(/\D/g, "");
          const ownerNumber = String(runtimeConfig.ownerNumber).replace(/\D/g, "");
          const isOwner = msg.key.fromMe || senderNumber === ownerNumber;

          if (!isOwner) {
            reply = "*𝐎ɴʟʏ 𝐎ᴡɴᴇʀ 𝐂ᴀɴ 𝐔sᴇ 𝐓ʜɪs 𝐂ᴏᴍᴍᴀɴᴅ!👑💜*";
          } else {
            const metadata = await sock.groupMetadata(msg.key.remoteJid);
            const bot = findBotParticipant(metadata.participants);
            const botIsAdmin = !!bot && (bot.admin === "admin" || bot.admin === "superadmin");

            if (!botIsAdmin) {
              reply = "*вσт мυѕт вє α∂мιɴ тσ υѕє тнιѕ ᴄσммαɴ∂!🏖️💜*";
            } else {
              try {
                await sock.groupSettingUpdate(msg.key.remoteJid, "locked");
                reply = "*𝐆ʀᴏᴜᴘ 𝐒ᴇᴛᴛɪɴɢs 𝐋ᴏᴄᴋᴇᴅ!🔐💜*";
              } catch (lockError) {
                reply = "*𝐆ʀᴏᴜᴘ 𝐒ᴇᴛᴛɪɴɢs 𝐋ᴏᴄᴋ ғᴀɪʟᴇᴅ!🥀❤️‍🩹*";
              }
            }
          }
        }
      } else if (command === "close") {
        if (!msg.key.remoteJid?.endsWith("@g.us")) {
          reply = "*𝐓ʜɪs 𝐂ᴏᴍᴍᴀɴᴅ 𝐎ɴʟʏ 𝐖ᴏʀᴋs 𝐈ɴ 𝐆ʀᴏᴜᴘs!🌨️❤️‍🩹*";
        } else {
          const senderJid = msg.key.participant || msg.participant || "";
          const senderNumber = senderJid.split("@")[0].split(":")[0].replace(/\D/g, "");
          const ownerNumber = String(runtimeConfig.ownerNumber).replace(/\D/g, "");
          const isOwner = msg.key.fromMe || senderNumber === ownerNumber;
          if (!isOwner) {
            reply = "*𝐎ɴʟʏ 𝐎ᴡɴᴇʀ 𝐂ᴀɴ 𝐔sᴇ 𝐓ʜɪs 𝐂ᴏᴍᴍᴀɴᴅ!👑💜*";
          } else {
            const metadata = await sock.groupMetadata(msg.key.remoteJid);
            const bot = findBotParticipant(metadata.participants);
            const botIsAdmin = !!bot && (bot.admin === "admin" || bot.admin === "superadmin");
            if (!botIsAdmin) {
              reply = "*вσт мυѕт вє α∂мιɴ тσ υѕє тнιѕ ᴄσммαɴ∂!🏖️💜*";
            } else {
              try {
                await sock.groupSettingUpdate(msg.key.remoteJid, "announcement");
                reply = "*𝐆ʀᴏᴜᴘ 𝐂ʟᴏsᴇᴅ 𝐒ᴜᴄᴄᴇssғᴜʟʟʏ!🔒❤️‍🩹*";
              } catch (e) {
                reply = "*𝐆ʀᴏᴜᴘ 𝐂ʟᴏsᴇ ғᴀɪʟᴇᴅ!🥀❤️‍🩹*";
              }
            }
          }
        }
      } else if (command === "open") {
        if (!msg.key.remoteJid?.endsWith("@g.us")) {
          reply = "*𝐓ʜɪs 𝐂ᴏᴍᴍᴀɴᴅ 𝐎ɴʟʏ 𝐖ᴏʀᴋs 𝐈ɴ 𝐆ʀᴏᴜᴘs!🌨️❤️‍🩹*";
        } else {
          const senderJid = msg.key.participant || msg.participant || "";
          const senderNumber = senderJid.split("@")[0].split(":")[0].replace(/\D/g, "");
          const ownerNumber = String(runtimeConfig.ownerNumber).replace(/\D/g, "");
          const isOwner = msg.key.fromMe || senderNumber === ownerNumber;

          if (!isOwner) {
            reply = "*𝐎ɴʟʏ 𝐎ᴡɴᴇʀ 𝐂ᴀɴ 𝐔sᴇ 𝐓ʜɪs 𝐂ᴏᴍᴍᴀɴᴅ!👑💜*";
          } else {
            const metadata = await sock.groupMetadata(msg.key.remoteJid);
            const bot = findBotParticipant(metadata.participants);
            const botIsAdmin = !!bot && (bot.admin === "admin" || bot.admin === "superadmin");

            if (!botIsAdmin) {
              reply = "*вσт мυѕт вє α∂мιɴ тσ υѕє тнιѕ ᴄσммαɴ∂!🏖️💜*";
            } else {
              try {
                await sock.groupSettingUpdate(msg.key.remoteJid, "not_announcement");
                reply = "*𝐆ʀᴏᴜᴘ 𝐎ᴘᴇɴᴇᴅ 𝐒ᴜᴄᴄᴇssғᴜʟʟʏ!🌸💜*";
              } catch (openError) {
                reply = "*𝐆ʀᴏᴜᴘ 𝐎ᴘᴇɴ ғᴀɪʟᴇᴅ!🥀❤️‍🩹*";
              }
            }
          }
        }
      } else if (command === "demote") {
        if (!msg.key.remoteJid?.endsWith("@g.us")) {
          reply = "*𝐓ʜɪs 𝐂ᴏᴍᴍᴀɴᴅ 𝐎ɴʟʏ 𝐖ᴏʀᴋs 𝐈ɴ 𝐆ʀᴏᴜᴘs!🌨️❤️‍🩹*";
        } else {
          const senderJid = msg.key.participant || msg.participant || "";
          const senderNumber = senderJid.split("@")[0].split(":")[0].replace(/\D/g, "");
          const ownerNumber = String(runtimeConfig.ownerNumber).replace(/\D/g, "");
          const isOwner = msg.key.fromMe || senderNumber === ownerNumber;

          if (!isOwner) {
            reply = "*𝐎ɴʟʏ 𝐎ᴡɴᴇʀ 𝐂ᴀɴ 𝐔sᴇ 𝐓ʜɪs 𝐂ᴏᴍᴍᴀɴᴅ!👑💜*";
          } else {
            const metadata = await sock.groupMetadata(msg.key.remoteJid);
            const bot = findBotParticipant(metadata.participants);
            const botIsAdmin = !!bot && (bot.admin === "admin" || bot.admin === "superadmin");

            if (!botIsAdmin) {
              reply = "🏖️ *вσт мυѕт вє α∂мιɴ тσ υѕє тнιѕ ᴄσммαɴ∂!*";
            } else {
              const mentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
              const quotedParticipant = msg.message?.extendedTextMessage?.contextInfo?.participant || "";
              const targetJid = mentioned[0] || quotedParticipant || "";
              const targetNumber = targetJid.split("@")[0].split(":")[0].replace(/\D/g, "");
              const target = metadata.participants.find(p =>
                p.id === targetJid ||
                p.id?.split("@")[0].split(":")[0].replace(/\D/g, "") === targetNumber
              );

              if (!targetJid || !target) {
                reply = "*𝐏ʟᴇᴀsᴇ 𝐑ᴇᴘʟʏ 𝐎ʀ 𝐌ᴇɴᴛɪᴏɴ 𝐀 𝐌ᴇᴍʙᴇʀ!🥀💜*";
              } else if (!(target.admin === "admin" || target.admin === "superadmin")) {
                reply = "*𝐌ᴇᴍʙᴇʀ 𝐈s 𝐀ʟʀᴇᴀᴅʏ 𝐍ᴏᴛ 𝐀ᴅᴍɪɴ!🥀💜*";
              } else if (target.admin === "superadmin") {
                reply = "*𝐆ʀᴏᴜᴘ 𝐎ᴡɴᴇʀ 𝐂ᴀɴ'ᴛ 𝐁ᴇ 𝐃ᴇᴍᴏᴛᴇᴅ!👑🥀*";
              } else {
                try {
                  await sock.groupParticipantsUpdate(msg.key.remoteJid, [target.id], "demote");
                  reply = `*𝐀ᴅᴍɪɴ 𝐃ᴇᴍᴏᴛᴇᴅ 𝐒ᴜᴄᴄᴇssғᴜʟʟʏ!🥀❤️‍🩹*\n\n👤 @${targetNumber}`;
                  try {
                    await sock.sendMessage(
                      msg.key.remoteJid,
                      { text: reply, mentions: [target.id] },
                      { quoted: quotedContact }
                    );
                  } catch (e) {
                    await sock.sendMessage(msg.key.remoteJid, { text: reply, mentions: [target.id] });
                  }
                  return;
                } catch (demoteError) {
                  reply = "*𝐃ᴇᴍᴏᴛᴇ ғᴀɪʟᴇᴅ!🥀❤️‍🩹*";
                }
              }
            }
          }
        }
      } else if (command === "promote") {
        if (!msg.key.remoteJid?.endsWith("@g.us")) {
          reply = "*𝐓ʜɪs 𝐂ᴏᴍᴍᴀɴᴅ 𝐎ɴʟʏ 𝐖ᴏʀᴋs 𝐈ɴ 𝐆ʀᴏᴜᴘs!🌨️❤️‍🩹*";
        } else {
          const senderJid = msg.key.participant || msg.participant || "";
          const senderNumber = senderJid.split("@")[0].split(":")[0].replace(/\D/g, "");
          const ownerNumber = String(runtimeConfig.ownerNumber).replace(/\D/g, "");
          const isOwner = msg.key.fromMe || senderNumber === ownerNumber;

          if (!isOwner) {
            reply = "*𝐎ɴʟʏ 𝐎ᴡɴᴇʀ 𝐂ᴀɴ 𝐔sᴇ 𝐓ʜɪs 𝐂ᴏᴍᴍᴀɴᴅ!👑💜*";
          } else {
            const metadata = await sock.groupMetadata(msg.key.remoteJid);
            const bot = findBotParticipant(metadata.participants);
            const botIsAdmin = !!bot && (bot.admin === "admin" || bot.admin === "superadmin");

            if (!botIsAdmin) {
              reply = "🏖️ *вσт мυѕт вє α∂мιɴ тσ υѕє тнιѕ ᴄσммαɴ∂!*";
            } else {
              const mentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
              const quotedParticipant = msg.message?.extendedTextMessage?.contextInfo?.participant || "";
              const targetJid = mentioned[0] || quotedParticipant || "";
              const targetNumber = targetJid.split("@")[0].split(":")[0].replace(/\D/g, "");
              const target = metadata.participants.find(p =>
                p.id === targetJid ||
                p.id?.split("@")[0].split(":")[0].replace(/\D/g, "") === targetNumber
              );

              if (!targetJid || !target) {
                reply = "*𝐑ᴇᴘʟʏ ᴛᴏ ᴀ 𝐌ᴇᴍʙᴇʀ ᴏʀ 𝐓ᴀɢ 𝐓ʜᴇᴍ ᴛᴏ 𝐏ʀᴏᴍᴏᴛᴇ!👑💜*";
              } else if (target.admin === "admin" || target.admin === "superadmin") {
                reply = "*𝐌ᴇᴍʙᴇʀ 𝐀ʟʀᴇᴀᴅʏ 𝐀ᴅᴍɪɴ!👑💜*";
              } else {
                try {
                  await sock.groupParticipantsUpdate(msg.key.remoteJid, [target.id], "promote");
                  reply = `*𝐌ᴇᴍʙᴇʀ 𝐏ʀᴏᴍᴏᴛᴇᴅ 𝐒ᴜᴄᴄᴇssғᴜʟʟʏ!👑💜*\n\n👤 @${targetNumber}`;
                  try {
                    await sock.sendMessage(msg.key.remoteJid, { text: reply, mentions: [target.id] }, { quoted: quotedContact });
                  } catch (e) {
                    await sock.sendMessage(msg.key.remoteJid, { text: reply, mentions: [target.id] });
                  }
                  return;
                } catch (promoteError) {
                  reply = "*𝐏ʀᴏᴍᴏᴛᴇ 𝐅ᴀɪʟᴇᴅ!🥀❤️‍🩹*";
                }
              }
            }
          }
        }
      } else if (command === "antilink") {
        if (!msg.key.remoteJid?.endsWith("@g.us")) {
          reply = "*👑 𝐎ɴʟʏ 𝐎ᴡɴᴇʀ 𝐂ᴀɴ 𝐔sᴇ 𝐓ʜɪs 𝐂ᴏᴍᴍᴀɴᴅ! 💗*";
        } else {
          const senderJid = msg.key.participant || msg.participant || "";
          const senderNumber = normalizeJidNumber(senderJid);
          const ownerNumber = String(runtimeConfig.ownerNumber).replace(/\D/g, "");
          const isOwner = msg.key.fromMe || senderNumber === ownerNumber;
          if (!isOwner) {
            reply = "*👑 𝐎ɴʟʏ 𝐎ᴡɴᴇʀ 𝐂ᴀɴ 𝐔sᴇ 𝐓ʜɪs 𝐂ᴏᴍᴍᴀɴᴅ! 💗*";
          } else {
            const action = commandText.slice(command.length).trim().toLowerCase();
            if (!action) {
              reply = `*🌷 𝐔sᴀɢᴇ: ${runtimeConfig.prefix}antilink warn on / kick / delete / off 💗*`;
            } else if (action === "warn on") {
              antiLinkMode.set(msg.key.remoteJid, "warn");
              botSettings.setGroup(settingsKey, "antilink", msg.key.remoteJid, "warn");
              reply = "*🔗 𝐀ɴᴛɪʟɪɴᴋ 𝐖ᴀʀɴ 𝐌ᴏᴅᴇ 𝐄ɴᴀʙʟᴇᴅ! ⚠️💗*";
            } else if (action === "kick") {
              antiLinkMode.set(msg.key.remoteJid, "kick");
              botSettings.setGroup(settingsKey, "antilink", msg.key.remoteJid, "kick");
              reply = "*🔗 𝐀ɴᴛɪʟɪɴᴋ 𝐊ɪᴄᴋ 𝐌ᴏᴅᴇ 𝐄ɴᴀʙʟᴇᴅ! 🥀💗*";
            } else if (action === "delete") {
              antiLinkMode.set(msg.key.remoteJid, "delete");
              botSettings.setGroup(settingsKey, "antilink", msg.key.remoteJid, "delete");
              reply = "*🔗 𝐀ɴᴛɪʟɪɴᴋ 𝐃ᴇʟᴇᴛᴇ 𝐌ᴏᴅᴇ 𝐄ɴᴀʙʟᴇᴅ! 🗑️💗*";
            } else if (action === "off") {
              antiLinkMode.delete(msg.key.remoteJid);
              botSettings.setGroup(settingsKey, "antilink", msg.key.remoteJid, false);
              for (const key of antiLinkWarns.keys()) if (key.startsWith(`${msg.key.remoteJid}:`)) antiLinkWarns.delete(key);
              reply = "*🔗 𝐀ɴᴛɪʟɪɴᴋ 𝐃ɪsᴀʙʟᴇᴅ! 🌷💗*";
            } else {
              reply = `*🌷 𝐔sᴀɢᴇ: ${runtimeConfig.prefix}antilink warn on / kick / delete / off 💗*`;
            }
          }
        }
      } else if (command === "antisticker") {
        if (!msg.key.remoteJid?.endsWith("@g.us")) {
          reply = "*𝐓ʜɪs 𝐂ᴏᴍᴍᴀɴᴅ 𝐎ɴʟʏ 𝐖ᴏʀᴋs 𝐈ɴ 𝐆ʀᴏᴜᴘs!🌨️❤️‍🩹*";
        } else {
          const senderJid = msg.key.participant || msg.participant || "";
          const senderNumber = normalizeJidNumber(senderJid);
          const ownerNumber = String(runtimeConfig.ownerNumber).replace(/\D/g, "");
          const isOwner = msg.key.fromMe || senderNumber === ownerNumber;
          const metadata = await sock.groupMetadata(msg.key.remoteJid);
          const sender = findGroupParticipant(metadata.participants, senderJid);
          const senderIsAdmin = !!sender && (sender.admin === "admin" || sender.admin === "superadmin");

          if (!isOwner && !senderIsAdmin) {
            reply = "👑 *σɴℓу gʀσυρ α∂мιɴѕ ᴄαɴ υѕє тнιѕ ᴄσммαɴ∂.*";
          } else {
            const bot = findBotParticipant(metadata.participants);
            const botIsAdmin = !!bot && (bot.admin === "admin" || bot.admin === "superadmin");
            if (!botIsAdmin) {
              reply = "🏖️ *вσт мυѕт вє α∂мιɴ тσ υѕє тнιѕ ᴄσммαɴ∂!*";
            } else {
              const action = commandText.slice(command.length).trim().toLowerCase();
              if (action === "on") {
                antiSticker.add(msg.key.remoteJid);
                botSettings.setGroup(settingsKey, "antisticker", msg.key.remoteJid, true);
                reply = "*𝐀ɴᴛɪ 𝐒ᴛɪᴄᴋᴇʀ 𝐄ɴᴀʙʟᴇᴅ!🛡️💜*";
              } else if (action === "off") {
                antiSticker.delete(msg.key.remoteJid);
                botSettings.setGroup(settingsKey, "antisticker", msg.key.remoteJid, false);
                reply = "*𝐀ɴᴛɪ 𝐒ᴛɪᴄᴋᴇʀ 𝐃ɪsᴀʙʟᴇᴅ!🛡️💜*";
              } else {
                reply = `*𝐔sᴀɢᴇ: ${runtimeConfig.prefix}antisticker on/off 🌷💜*`;
              }
            }
          }
        }
      } else if (command === "antigm") {
        if (!msg.key.remoteJid?.endsWith("@g.us")) {
          reply = "*𝐓ʜɪs 𝐂ᴏᴍᴍᴀɴᴅ 𝐎ɴʟʏ 𝐖ᴏʀᴋs 𝐈ɴ 𝐆ʀᴏᴜᴘs!🌨️❤️‍🩹*";
        } else {
          const senderJid = msg.key.participant || msg.participant || "";
          const senderNumber = normalizeJidNumber(senderJid);
          const ownerNumber = String(runtimeConfig.ownerNumber).replace(/\D/g, "");
          const isOwner = msg.key.fromMe || senderNumber === ownerNumber;
          const metadata = await sock.groupMetadata(msg.key.remoteJid);
          const sender = findGroupParticipant(metadata.participants, senderJid);
          const senderIsAdmin = !!sender && (sender.admin === "admin" || sender.admin === "superadmin");
          if (!isOwner && !senderIsAdmin) {
            reply = "👑 *σɴℓу gʀσυρ α∂мιɴѕ ᴄαɴ υѕє тнιѕ ᴄσммαɴ∂.*";
          } else {
            const action = commandText.slice(command.length).trim().toLowerCase();
            if (action === "on") {
              antiGroupStatus.add(msg.key.remoteJid);
              botSettings.setGroup(settingsKey, "antigm", msg.key.remoteJid, true);
              reply = "*𝐀ɴᴛɪ 𝐆ʀᴏᴜᴘ 𝐌ᴇssᴀɢᴇ 𝐄ɴᴀʙʟᴇᴅ!🛡️💜*";
            } else if (action === "off") {
              antiGroupStatus.delete(msg.key.remoteJid);
              botSettings.setGroup(settingsKey, "antigm", msg.key.remoteJid, false);
              reply = "*𝐀ɴᴛɪ 𝐆ʀᴏᴜᴘ 𝐌ᴇssᴀɢᴇ 𝐃ɪsᴀʙʟᴇᴅ!🛡️💜*";
            } else {
              reply = `*𝐔sᴀɢᴇ: ${runtimeConfig.prefix}antigm on/off 🌷💜*`;
            }
          }
        }
      } else if (command === "vv") {
        const ctx = msg.message?.extendedTextMessage?.contextInfo || {};
        const quotedMessage = ctx.quotedMessage || null;

        if (!quotedMessage) {
          reply = `🥺💗 ʀᴇᴘʟʏ ᴛᴏ ᴀ ᴠɪᴇᴡ ᴏɴᴄᴇ ᴍᴇᴅɪᴀ 🌸 | 𝐗 𝐍ᴏʙɪᴛᴀ 𝐗ᴅ 🫶🏻`;
        } else {
          try {
            let inner = quotedMessage;

            const wrapper =
              inner.viewOnceMessageV2 ||
              inner.viewOnceMessageV2Extension ||
              inner.viewOnceMessage;

            if (wrapper?.message) inner = wrapper.message;
            if (inner.ephemeralMessage?.message) inner = inner.ephemeralMessage.message;
            if (inner.documentWithCaptionMessage?.message) inner = inner.documentWithCaptionMessage.message;

            let mediaType = null;
            let mediaMsg = null;

            if (inner.imageMessage) {
              mediaType = "image";
              mediaMsg = inner.imageMessage;
            } else if (inner.videoMessage) {
              mediaType = "video";
              mediaMsg = inner.videoMessage;
            } else if (inner.audioMessage) {
              mediaType = "audio";
              mediaMsg = inner.audioMessage;
            }

            if (!mediaMsg) {
              reply = `😔💔 ᴜɴsᴜᴘᴘᴏʀᴛᴇᴅ ᴠɪᴇᴡ ᴏɴᴄᴇ ᴍᴇᴅɪᴀ 🌹 | 𝐗 𝐍ᴏʙɪᴛᴀ 𝐗ᴅ`;
            } else {
              await sock.sendMessage(msg.key.remoteJid, { react: { text: "⏳", key: msg.key } });

              const stream = await downloadContentFromMessage(mediaMsg, mediaType);
              const chunks = [];
              for await (const chunk of stream) chunks.push(chunk);
              const buffer = Buffer.concat(chunks);
              const caption = mediaMsg.caption || "";

              if (mediaType === "image") {
                await sock.sendMessage(
                  msg.key.remoteJid,
                  { image: buffer, caption: caption || "📸💞 ᴠɪᴇᴡ ᴏɴᴄᴇ ɪᴍᴀɢᴇ ✓ 🌷 | 𝐗 𝐍ᴏʙɪᴛᴀ 𝐗ᴅ 🫶🏻" },
                  { quoted: quotedContact }
                );
              } else if (mediaType === "video") {
                await sock.sendMessage(
                  msg.key.remoteJid,
                  { video: buffer, caption: caption || "🎥💕 ᴠɪᴇᴡ ᴏɴᴄᴇ ᴠɪᴅᴇᴏ ✓ 🦋 | 𝐗 𝐍ᴏʙɪᴛᴀ 𝐗ᴅ 🫶🏻", mimetype: mediaMsg.mimetype || "video/mp4" },
                  { quoted: quotedContact }
                );
              } else {
                await sock.sendMessage(
                  msg.key.remoteJid,
                  { audio: buffer, mimetype: mediaMsg.mimetype || "audio/ogg; codecs=opus", ptt: !!mediaMsg.ptt },
                  { quoted: quotedContact }
                );
              }

              await sock.sendMessage(msg.key.remoteJid, { react: { text: "💗", key: msg.key } });
              reply = mediaType === "image"
                ? `📸💗 ᴠɪᴇᴡ ᴏɴᴄᴇ ɪᴍᴀɢᴇ ✓ 🌸 | 𝐗 𝐍ᴏʙɪᴛᴀ 𝐗ᴅ 🫶🏻`
                : mediaType === "video"
                  ? `🎥💕 ᴠɪᴇᴡ ᴏɴᴄᴇ ᴠɪᴅᴇᴏ ✓ 🦋 | 𝐗 𝐍ᴏʙɪᴛᴀ 𝐗ᴅ 💞`
                  : `🎵💗 ᴠɪᴇᴡ ᴏɴᴄᴇ ᴀᴜᴅɪᴏ ✓ 🌷 | 𝐗 𝐍ᴏʙɪᴛᴀ 𝐗ᴅ 💞`;
            }
          } catch (vvError) {
            console.log(`    ⚠️ VV command failed: ${vvError?.message || vvError}`);
            await sock.sendMessage(msg.key.remoteJid, { react: { text: "❌", key: msg.key } });
            reply = `🥺💔 ᴠɪᴇᴡ ᴏɴᴄᴇ ғᴀɪʟᴇᴅ 🌷 | 𝐗 𝐍ᴏʙɪᴛᴀ 𝐗ᴅ`;
          }
        }
      } else if (command === "url") {
        const ctx = msg.message?.extendedTextMessage?.contextInfo || {};
        const quotedMessage = ctx.quotedMessage || null;
        let mediaSource = quotedMessage;
        if (mediaSource?.ephemeralMessage?.message) mediaSource = mediaSource.ephemeralMessage.message;
        if (mediaSource?.viewOnceMessageV2?.message) mediaSource = mediaSource.viewOnceMessageV2.message;
        if (mediaSource?.viewOnceMessage?.message) mediaSource = mediaSource.viewOnceMessage.message;
        if (mediaSource?.viewOnceMessageV2Extension?.message) mediaSource = mediaSource.viewOnceMessageV2Extension.message;
        if (mediaSource?.documentWithCaptionMessage?.message) mediaSource = mediaSource.documentWithCaptionMessage.message;
        const mediaKey = mediaSource
          ? ["imageMessage", "videoMessage", "audioMessage", "documentMessage", "stickerMessage"].find(k => mediaSource[k])
          : null;

        if (!quotedMessage || !mediaKey) {
          reply = `🥺💗 ʀᴇᴘʟʏ ᴛᴏ ᴀ ᴍᴇᴅɪᴀ ᴡɪᴛʜ ${runtimeConfig.prefix}url 🌸 | 𝐗 𝐍ᴏʙɪᴛᴀ 𝐗ᴅ 🫶🏻`;
        } else {
          try {
            await sock.sendMessage(
              msg.key.remoteJid,
              { text: `⏳💞 ᴜᴘʟᴏᴀᴅɪɴɢ ᴍᴇᴅɪᴀ... 🦋 | 𝐗 𝐍ᴏʙɪᴛᴀ 𝐗ᴅ 💗` },
              { quoted: quotedContact }
            );

            // Download the quoted media directly from its media node.
            let inner = quotedMessage;
            if (inner.ephemeralMessage?.message) inner = inner.ephemeralMessage.message;
            if (inner.viewOnceMessageV2?.message) inner = inner.viewOnceMessageV2.message;
            if (inner.viewOnceMessage?.message) inner = inner.viewOnceMessage.message;
            if (inner.viewOnceMessageV2Extension?.message) inner = inner.viewOnceMessageV2Extension.message;
            if (inner.documentWithCaptionMessage?.message) inner = inner.documentWithCaptionMessage.message;

            const mediaNode = inner[mediaKey] || {};
            if (!mediaNode?.mediaKey) throw new Error("Quoted media data is unavailable");

            let mediaType = mediaKey.replace("Message", "");
            if (mediaType === "sticker") mediaType = "sticker";

            const stream = await downloadContentFromMessage(mediaNode, mediaType);
            const chunks = [];
            for await (const chunk of stream) chunks.push(chunk);
            const buffer = Buffer.concat(chunks);
            if (!buffer.length) throw new Error("Empty media buffer");

            const mime = mediaNode.mimetype || "application/octet-stream";
            const ext = (mime.split("/")[1] || "bin").split(";")[0].replace(/[^a-z0-9]/gi, "") || "bin";
            const filename = `x-nobita.${ext}`;

            // Try several public uploaders. A failure on one service must not stop
            // the command before the remaining fallbacks are attempted.
            const uploaders = [
              {
                name: "Catbox",
                url: "https://catbox.moe/user/api.php",
                makeForm: () => {
                  const form = new FormData();
                  form.append("reqtype", "fileupload");
                  form.append("fileToUpload", new Blob([buffer], { type: mime }), filename);
                  return form;
                },
                parse: async (response) => {
                  const text = (await response.text()).trim();
                  return /^https?:\/\//i.test(text) ? text : "";
                }
              },
              {
                name: "Tmpfiles",
                url: "https://tmpfiles.org/api/v1/upload",
                makeForm: () => {
                  const form = new FormData();
                  form.append("file", new Blob([buffer], { type: mime }), filename);
                  return form;
                },
                parse: async (response) => {
                  const data = await response.json().catch(() => null);
                  const u = data?.data?.url || "";
                  return u ? u.replace("tmpfiles.org/", "tmpfiles.org/dl/") : "";
                }
              },
              {
                name: "Uguu",
                url: "https://uguu.se/upload.php",
                makeForm: () => {
                  const form = new FormData();
                  form.append("files[]", new Blob([buffer], { type: mime }), filename);
                  return form;
                },
                parse: async (response) => {
                  const data = await response.json().catch(() => null);
                  return data?.files?.[0]?.url || "";
                }
              },
              {
                name: "0x0",
                url: "https://0x0.st",
                makeForm: () => {
                  const form = new FormData();
                  form.append("file", new Blob([buffer], { type: mime }), filename);
                  return form;
                },
                parse: async (response) => {
                  const text = (await response.text()).trim();
                  return /^https?:\/\//i.test(text) ? text : "";
                }
              }
            ];

            let generatedUrl = "";
            let lastUploadError = "";

            for (const uploader of uploaders) {
              try {
                const controller = new AbortController();
                const timer = setTimeout(() => controller.abort(), 30000);
                try {
                  const upload = await fetch(uploader.url, {
                    method: "POST",
                    body: uploader.makeForm(),
                    headers: { "User-Agent": "X-NOBITA-XD/1.0" },
                    signal: controller.signal
                  });
                  generatedUrl = await uploader.parse(upload);
                  if (generatedUrl) {
                    console.log(`    ✅ ${uploader.name} upload successful: ${generatedUrl}`);
                    break;
                  }
                  lastUploadError = `${uploader.name}: HTTP ${upload.status}`;
                  console.log(`    ⚠️ ${uploader.name} upload rejected: HTTP ${upload.status}`);
                } finally {
                  clearTimeout(timer);
                }
              } catch (uploadError) {
                const cause = uploadError?.cause?.code || uploadError?.cause?.message || "";
                lastUploadError = `${uploader.name}: ${uploadError?.message || uploadError}${cause ? ` (${cause})` : ""}`;
                console.log(`    ⚠️ ${lastUploadError}`);
              }
            }

            if (!generatedUrl) {
              throw new Error(lastUploadError || "All uploaders failed");
            }

            reply = `🔗💗 ᴍᴇᴅɪᴀ ᴜʀʟ ɢᴇɴᴇʀᴀᴛᴇᴅ ✓ 🌹 | 𝐗 𝐍ᴏʙɪᴛᴀ 𝐗ᴅ 🫶🏻\n${generatedUrl}`;
          } catch (urlError) {
            console.log(`    ⚠️ URL command failed: ${urlError?.message || urlError}`);
            reply = `🥺💔 ᴍᴇᴅɪᴀ ᴜᴘʟᴏᴀᴅ ғᴀɪʟᴇᴅ 🌷 | 𝐗 𝐍ᴏʙɪᴛᴀ 𝐗ᴅ`;
          }
        }
      } else if (command === "gstatus") {
        if (!msg.key.remoteJid?.endsWith("@g.us")) {
          reply = "*𝐓ʜɪs 𝐂ᴏᴍᴍᴀɴᴅ 𝐎ɴʟʏ 𝐖ᴏʀᴋs 𝐈ɴ 𝐆ʀᴏᴜᴘs!🌨️❤️‍🩹*";
        } else {
          const senderJid = msg.key.participant || msg.participant || "";
          const senderNumber = senderJid.split("@")[0].split(":")[0].replace(/\D/g, "");
          const ownerNumber = String(runtimeConfig.ownerNumber).replace(/\D/g, "");
          const isOwner = msg.key.fromMe || senderNumber === ownerNumber;

          if (!isOwner) {
            reply = "*𝐎ɴʟʏ 𝐎ᴡɴᴇʀ 𝐂ᴀɴ 𝐔sᴇ 𝐓ʜɪs 𝐂ᴏᴍᴍᴀɴᴅ!👑💜*";
          } else {
            const caption = commandText.slice(command.length).trim();
            const ctx = msg.message?.extendedTextMessage?.contextInfo || {};
            let quotedMessage = ctx.quotedMessage;
            if (quotedMessage?.viewOnceMessageV2?.message) quotedMessage = quotedMessage.viewOnceMessageV2.message;
            if (quotedMessage?.viewOnceMessage?.message) quotedMessage = quotedMessage.viewOnceMessage.message;
            if (quotedMessage?.documentWithCaptionMessage?.message) quotedMessage = quotedMessage.documentWithCaptionMessage.message;
            const mediaKey = quotedMessage ? ["imageMessage","videoMessage","audioMessage","documentMessage","audioMessage"].find(k => quotedMessage[k]) : null;
            const mediaTypes = ["imageMessage", "videoMessage", "audioMessage", "documentMessage"];

            if (!caption && !quotedMessage) {
              reply = `*𝐆ʀᴏᴜᴘ 𝐒ᴛᴀᴛᴜs 𝐔sᴀɢᴇ!🌷❤️‍🩹*\n\n*${runtimeConfig.prefix}gstatus 𝐘ᴏᴜʀ 𝐓ᴇxᴛ*`;
            } else {
              try {
                let storyData;
                if (quotedMessage && mediaTypes.includes(mediaKey)) {
                  const quotedMsg = {
                    key: { remoteJid: msg.key.remoteJid, id: ctx.stanzaId, participant: ctx.participant || msg.key.participant },
                    message: quotedMessage
                  };
                  const buffer = await downloadMediaMessage(
                    quotedMsg,
                    "buffer",
                    {},
                    { logger: pino({ level: "silent" }), reuploadRequest: sock.updateMediaMessage }
                  );
                  if (mediaKey === "imageMessage") {
                    storyData = { image: buffer, caption: caption || quotedMessage.imageMessage?.caption || "" };
                  } else if (mediaKey === "videoMessage") {
                    storyData = { video: buffer, caption: caption || quotedMessage.videoMessage?.caption || "" };
                  } else if (mediaKey === "audioMessage") {
                    storyData = { audio: buffer, mimetype: quotedMessage.audioMessage?.mimetype || "audio/mp4", ptt: !!quotedMessage.audioMessage?.ptt };
                  } else {
                    storyData = { document: buffer, mimetype: quotedMessage.documentMessage?.mimetype || "application/octet-stream", fileName: quotedMessage.documentMessage?.fileName || "file" };
                  }
                } else {
                  storyData = {
                    text: caption,
                    backgroundColor: Math.floor(Math.random() * 0xffffff),
                    font: 1
                  };
                }

                const waMsgContent = await generateWAMessageContent(storyData, { upload: sock.waUploadToServer });
                await sock.relayMessage(
                  msg.key.remoteJid,
                  { groupStatusMessageV2: { message: waMsgContent.message || waMsgContent } },
                  { messageId: generateMessageID() }
                );
                reply = "*𝐆ʀᴏᴜᴘ 𝐒ᴛᴀᴛᴜs 𝐒ᴇᴛᴜᴘ 𝐃ᴏɴᴇ!💋❤️‍🩹*";
              } catch (gstatusError) {
                console.error("gstatus error:", gstatusError?.message || gstatusError);
                reply = "*𝐆ʀᴏᴜᴘ 𝐒ᴛᴀᴛᴜs 𝐒ᴇᴛᴜᴘ 𝐅ᴀɪʟᴇᴅ!🥀❤️‍🩹*";
              }
            }
          }
        }
      } else if (command === "leave") {
        if (!msg.key.remoteJid?.endsWith("@g.us")) {
          reply = "*𝐓ʜɪs 𝐂ᴏᴍᴍᴀɴᴅ 𝐎ɴʟʏ 𝐖ᴏʀᴋs 𝐈ɴ 𝐆ʀᴏᴜᴘs!🌨️❤️‍🩹*";
        } else {
          const senderJid = msg.key.participant || msg.participant || "";
          const senderNumber = normalizeJidNumber(senderJid);
          const ownerNumber = String(runtimeConfig.ownerNumber).replace(/\D/g, "");
          const isOwner = msg.key.fromMe || senderNumber === ownerNumber;
          if (!isOwner) {
            reply = "*𝐎ɴʟʏ 𝐎ᴡɴᴇʀ 𝐂ᴀɴ 𝐔sᴇ 𝐓ʜɪs 𝐂ᴏᴍᴍᴀɴᴅ!👑💜*";
          } else {
            try {
              reply = "*𝐋ᴇғᴛ 𝐓ʜᴇ 𝐆ʀᴏᴜᴘ 𝐒ᴜᴄᴄᴇssғᴜʟʟʏ!🚪💜*\n\n*𝐗 𝐍ᴏʙɪᴛᴀ 𝐗𝐃*\n*𝐏ᴏᴡᴇʀᴇᴅ ʙʏ 𝐗 𝐍ᴏʙɪᴛᴀ*";
              try {
                await sock.sendMessage(msg.key.remoteJid, { text: reply }, { quoted: quotedContact });
              } catch (e) {
                await sock.sendMessage(msg.key.remoteJid, { text: reply, ...(replyMentions.length ? { mentions: replyMentions } : {}) }, { quoted: quotedContact });
              }
              await sock.groupLeave(msg.key.remoteJid);
              return;
            } catch (leaveError) {
              console.error("leave error:", leaveError?.message || leaveError);
              reply = "*𝐆ʀᴏᴜᴘ 𝐋ᴇᴀᴠᴇ ғᴀɪʟᴇᴅ!🥀❤️‍🩹*";
            }
          }
        }
      } else if (command === "gmenu") {
        if (!msg.key.remoteJid?.endsWith("@g.us")) {
          reply = "🌨️ *тнιѕ ᴄσммαɴ∂ σɴℓу ωσʀкѕ ιɴ gʀσυρѕ!*";
        } else {
          const metadata = await sock.groupMetadata(msg.key.remoteJid);
          const senderJid = msg.key.participant || msg.participant || "";
          const senderNumber = senderJid.split("@")[0].split(":")[0].replace(/\D/g, "");
          const ownerNumber = String(runtimeConfig.ownerNumber).replace(/\D/g, "");
          const isOwner = msg.key.fromMe || senderNumber === ownerNumber;
          const sender = findGroupParticipant(metadata.participants, senderJid);
          const senderIsAdmin = !!sender && (sender.admin === "admin" || sender.admin === "superadmin");
          if (!isOwner && !senderIsAdmin) {
            reply = "👑 *σɴℓу gʀσυρ α∂мιɴѕ ᴄαɴ υѕє тнιѕ ᴄσммαɴ∂.*";
          } else {
            reply = `*╰┈➤📋 𝐆ʀᴏᴜᴘ 𝐌ᴇɴᴜ*\n\n*╰┈➤💜 𝐗 𝐍ᴏʙɪᴛᴀ 𝐗𝐃*\n\n╰┈➤ ${runtimeConfig.prefix}tagall\n╰┈➤ ${runtimeConfig.prefix}admins\n╰┈➤ ${runtimeConfig.prefix}kick\n╰┈➤ ${runtimeConfig.prefix}add\n╰┈➤ ${runtimeConfig.prefix}gstatus\n╰┈➤ ${runtimeConfig.prefix}promote\n╰┈➤ ${runtimeConfig.prefix}demote\n╰┈➤ ${runtimeConfig.prefix}open\n╰┈➤ ${runtimeConfig.prefix}close\n╰┈➤ ${runtimeConfig.prefix}lock\n╰┈➤ ${runtimeConfig.prefix}unlock\n╰┈➤ ${runtimeConfig.prefix}setgpp\n╰┈➤ ${runtimeConfig.prefix}subject\n╰┈➤ ${runtimeConfig.prefix}desc\n╰┈➤ ${runtimeConfig.prefix}groupinfo\n╰┈➤ ${runtimeConfig.prefix}invite\n╰┈➤ ${runtimeConfig.prefix}revoke\n╰┈➤ ${runtimeConfig.prefix}requests\n╰┈➤ ${runtimeConfig.prefix}approve\n╰┈➤ ${runtimeConfig.prefix}reject\n╰┈➤ ${runtimeConfig.prefix}leave\n╰┈➤ ${runtimeConfig.prefix}poll\n╰┈➤ ${runtimeConfig.prefix}everyone\n╰┈➤ ${runtimeConfig.prefix}tagadmins\n╰┈➤ ${runtimeConfig.prefix}totag\n╰┈➤ ${runtimeConfig.prefix}groupdp\n\n*╰┈➤💜 𝐏ᴏᴡᴇʀᴇᴅ ʙʏ 𝐗 𝐍ᴏʙɪᴛᴀ*`;
          }
        }
      } else if (command === "play" || command === "song") {
        await handlePlaySong(sock, msg, args, quotedContact);
        return;
      } else if (command === "autotyping") {
        await automationCommand("autotyping", args, replyWithContact, isCommandOwner, botJid);
        return;
      } else if (command === "autoreact") {
        await autoreactCommand(args, replyWithContact, isCommandOwner, botJid);
        return;
      } else if (command === "autoread") {
        await automationCommand("autoread", args, replyWithContact, isCommandOwner, botJid);
        return;
      } else if (command === "autostoryview") {
        await automationCommand("autostoryview", args, replyWithContact, isCommandOwner, botJid);
        return;
      } else if (command === "owner") {
        reply = `*╰┈➤ 👑𝐎ᴡɴᴇʀ: ${runtimeConfig.ownerName}*`;
      } else if (command === "pair") {
        // WhatsApp-side pairing: only the current bot owner can create another session.
        if (!isCommandOwner) {
          reply = "👑 *Only owner can use this command.*";
        } else {
          const targetPhone = String(args[0] || "").replace(/\D/g, "");
          if (!targetPhone || !/^\d{8,15}$/.test(targetPhone)) {
            reply = `╭━━〔 🔐 𝑿 𝑵𝑶𝑩𝑰𝑻𝑨 𝑿𝑫 𝑷𝑨𝑰𝑹 〕━━╮\n\n📌 𝑼𝒔𝒆: ${runtimeConfig.prefix}pair <number>\n📱 𝑬𝒙𝒂𝒎𝒑𝒍𝒆: ${runtimeConfig.prefix}pair 919876543210\n\n⚠️ Include country code, without + sign.\n\n╰━━〔 𝑿 𝑵𝑶𝑩𝑰𝑻𝑨 𝑿𝑫 〕━━╯`;
          } else if (targetPhone === String(runtimeConfig.ownerNumber || "").replace(/\D/g, "")) {
            reply = "⚠️ *That number is already the current bot session.*";
          } else if (sessionManager?.isRunning(targetPhone)) {
            reply = `💚 *+${targetPhone} is already connected.*`;
          } else if (whatsappPairRequests.has(targetPhone) || sessionManager?.status(targetPhone) === "starting") {
            reply = `⏳ *Pairing is already in progress for +${targetPhone}.*`;
          } else if (!sessionManager || typeof sessionManager.start !== "function") {
            reply = "❌ *Multi-pair session manager is not available.*";
          } else {
            const pairJid = msg.key.remoteJid;
            whatsappPairRequests.set(targetPhone, Date.now());
            let resolvePairCode;
            let rejectPairCode;
            const pairCodePromise = new Promise((resolve, reject) => {
              resolvePairCode = resolve;
              rejectPairCode = reject;
            });

            reply = `⏳ *Generating pairing code...*\n\n📱 Number ➜ +${targetPhone}\n🔄 Please wait...`;

            // Start the isolated session asynchronously, then send the actual code.
            sessionManager.start(targetPhone, {
              skipPairing: false,
              pairedPhone: targetPhone,
              isPairingFlow: true,
              onPairingCode: resolvePairCode,
              onPairingError: rejectPairCode
            }).then(async (newSock) => {
              try {
                if (!newSock || typeof newSock.requestPairingCode !== "function") {
                  throw new Error("WhatsApp socket was not created");
                }
                const code = await Promise.race([
                  pairCodePromise,
                  new Promise((_, reject) => setTimeout(() => reject(new Error("Pairing code generation timed out")), 30000))
                ]);
                const rawCode = String(code || "").replace(/\s+/g, "");
                const formattedCode = rawCode.match(/.{1,4}/g)?.join("-") || rawCode;
                const pairOutput = `╭━━〔 🔐 𝑿 𝑵𝑶𝑩𝑰𝑻𝑨 𝑿𝑫 𝑷𝑨𝑰𝑹 〕━━╮\n\n📱 𝑵𝒖𝒎𝒃𝒆𝒓 ➜ +${targetPhone}\n\n🔑 𝑷𝒂𝒊𝒓𝒊𝒏𝒈 𝑪𝒐𝒅𝒆\n➜ *${formattedCode}*\n\n📲 𝑾𝒉𝒂𝒕𝒔𝑨𝒑𝒑 → 𝑺𝒆𝒕𝒕𝒊𝒏𝒈𝒔 → 𝑳𝒊𝒏𝒌𝒆𝒅 𝑫𝒆𝒗𝒊𝒄𝒆𝒔 → 𝑳𝒊𝒏𝒌 𝒘𝒊𝒕𝒉 𝒑𝒉𝒐𝒏𝒆 𝒏𝒖𝒎𝒃𝒆𝒓\n\n⏳ 𝑼𝒔𝒆 𝒕𝒉𝒆 𝒄𝒐𝒅𝒆 𝒃𝒆𝒇𝒐𝒓𝒆 𝒊𝒕 𝒆𝒙𝒑𝒊𝒓𝒆𝒔.\n⚠️ 𝑫𝒐 𝒏𝒐𝒕 𝒔𝒉𝒂𝒓𝒆 𝒕𝒉𝒊𝒔 𝒄𝒐𝒅𝒆.\n\n╰━━〔 💗 𝑿 𝑵𝑶𝑩𝑰𝑻𝑨 𝑿𝑫 〕━━╯`;
                await sock.sendMessage(pairJid, { text: pairOutput }, { quoted: quotedContact });
              } catch (e) {
                await sock.sendMessage(pairJid, { text: `❌ *PAIR FAILED*\n\n📱 Number ➜ +${targetPhone}\n💬 Reason ➜ ${e?.message || e}\n\n🔁 Try again: ${runtimeConfig.prefix}pair ${targetPhone}` }, { quoted: quotedContact }).catch(() => {});
                await sessionManager.remove(targetPhone).catch(() => {});
              } finally {
                whatsappPairRequests.delete(targetPhone);
              }
            }).catch(async (e) => {
              whatsappPairRequests.delete(targetPhone);
              await sock.sendMessage(pairJid, { text: `❌ *PAIR FAILED*\n\n📱 Number ➜ +${targetPhone}\n💬 Reason ➜ ${e?.message || e}\n\n🔁 Try again: ${runtimeConfig.prefix}pair ${targetPhone}` }, { quoted: quotedContact }).catch(() => {});
              await sessionManager.remove(targetPhone).catch(() => {});
            });
          }
        }
      } else if (command === "block" || command === "unblock") {
        if (!isCommandOwner) {
          reply = "🚫💗 ᴏɴʟʏ ᴏᴡɴᴇʀ ᴄᴀɴ ᴜsᴇ ᴛʜɪs ᴄᴏᴍᴍᴀɴᴅ 🌸 |";
        } else {
          const blockContext = msg.message?.extendedTextMessage?.contextInfo || msg.message?.imageMessage?.contextInfo || msg.message?.videoMessage?.contextInfo || msg.message?.documentMessage?.contextInfo || msg.message?.audioMessage?.contextInfo || {};
          const quotedParticipant = blockContext.participant || "";
          const numberArg = args.find(a => /\d{5,}/.test(String(a))) || "";
          let targetJid = quotedParticipant;
          if (!targetJid && numberArg) {
            const targetNumber = String(numberArg).replace(/\D/g, "");
            if (targetNumber.length >= 5) targetJid = `${targetNumber}@s.whatsapp.net`;
          }
          if (!targetJid) {
            reply = `🥺💗 ʀᴇᴘʟʏ ᴛᴏ ᴀ ᴜsᴇʀ ᴏʀ ᴜsᴇ ${runtimeConfig.prefix}${command} <number> 🌸 |`;
          } else {
            try {
              const targetNumber = normalizeJidNumber(targetJid);
              if (targetNumber && targetNumber === ownerNumberForCommand) {
                reply = `⚠️💗 ᴏᴡɴᴇʀ ᴄᴀɴɴᴏᴛ ʙᴇ ${command === "block" ? "ʙʟᴏᴄᴋᴇᴅ" : "ᴜɴʙʟᴏᴄᴋᴇᴅ"} 🌷 |`;
              } else {
                await sock.updateBlockStatus(targetJid, command === "block" ? "block" : "unblock");
                reply = command === "block" ? "🔒💗 ᴜsᴇʀ ʙʟᴏᴄᴋᴇᴅ ✓ 🌸 |" : "🔓💗 ᴜsᴇʀ ᴜɴʙʟᴏᴄᴋᴇᴅ ✓ 🌸 |";
              }
            } catch (blockError) {
              console.log(`    ⚠️ ${command} failed: ${blockError?.message || blockError}`);
              reply = command === "block" ? "🥺💔 ᴜsᴇʀ ʙʟᴏᴄᴋ ғᴀɪʟᴇᴅ 🌹 |" : "🥺💔 ᴜsᴇʀ ᴜɴʙʟᴏᴄᴋ ғᴀɪʟᴇᴅ 🌹 |";
            }
          }
        }
      } else if (command === "bot" || command === "botlink") {
        reply = `💗 𝐗 𝐍𝐎𝐁𝐈𝐓𝐀 𝐗𝐃\n\n🐰 𝐁𝐨𝐭 𝐏𝐚𝐢𝐫 𝐆𝐫𝐨𝐮𝐩\n💕 𝐉𝐨𝐢𝐧 𝐇𝐞𝐫𝐞 ↓\n\n🔗 https://t.me/pbv56NuNOhIzZjc9\n\n🌷 𝐏𝐚𝐢𝐫 𝐘𝐨𝐮𝐫 𝐁𝐨𝐭 ✨`;
      } else if (command === "menu") {
        const uptimeSec = Math.floor(process.uptime());
        const d = Math.floor(uptimeSec / 86400);
        const h = Math.floor((uptimeSec % 86400) / 3600);
        const m = Math.floor((uptimeSec % 3600) / 60);
        const used = process.memoryUsage().rss / 1024 / 1024;
        const total = 126 * 1024;
        const ramPct = Math.min(99, Math.max(1, Math.round((used / total) * 100)));
        const bar = "█".repeat(Math.round(ramPct / 10)) + "░".repeat(10 - Math.round(ramPct / 10));
        reply = `┏❐ 《 🌷 *𝐗 𝐍𝐎𝐁𝐈𝐓𝐀 𝐗𝐃* 🌷 》 ❐
┃ 👑 *ᴏᴡɴᴇʀ* : 𝐗 𝐍ᴏʙɪᴛᴀ
┃ ⚙️ *ᴍᴏᴅᴇ* : ${runtimeConfig.mode}
┃ 🖥️ *ʜᴏꜱᴛ* : Panel
┃ ⚡ *ꜱᴘᴇᴇᴅ* : -- ms
┃ 🔰 *ᴘʀᴇғɪx* : ${runtimeConfig.prefix}
┃ 🧠 *ᴄᴏʀᴇs* : ${require("os").cpus().length}
┃ ⏱️ *ᴜᴘᴛɪᴍᴇ* : ${d}d ${h}h ${m}m
┃ 📦 *ᴠᴇʀsɪᴏɴ* : 1.1.1
┃ 🔗 *ꜱᴇꜱꜱɪᴏɴ* : 1/15
┃ 💾 *ᴜꜱᴀɢᴇ* : ${used.toFixed(0)} MB of 126 GB
┃ 📊 *ʀᴀᴍ* : [${bar}] ${ramPct}%
┗❐

┏❐ 《 📋 *MENU* 》 ❐
┣◆ 🏓 ${runtimeConfig.prefix}ping
┣◆ 💚 ${runtimeConfig.prefix}alive
┣◆ ⏱️ ${runtimeConfig.prefix}uptime
┣◆ 📋 ${runtimeConfig.prefix}menu
┣◆ 👑 ${runtimeConfig.prefix}owner
┣◆ 🆔 ${runtimeConfig.prefix}groupid
┗❐

┏❐ 《 👑 *OWNER* 》 ❐
┣◆ ⚙️ ${runtimeConfig.prefix}setprefix
┣◆ 🔗 ${runtimeConfig.prefix}pair <number>
┣◆ 🌐 ${runtimeConfig.prefix}public
┣◆ 🔒 ${runtimeConfig.prefix}private
┣◆ 🚫 ${runtimeConfig.prefix}block
┣◆ ✅ ${runtimeConfig.prefix}unblock
┗❐

┏❐ 《 🎵 *PLAYLIST* 》 ❐
┣◆ 🎶 ${runtimeConfig.prefix}play
┣◆ 🎧 ${runtimeConfig.prefix}song
┗❐

┏❐ 《 👥 *GROUP* 》 ❐
┣◆ ⚡ ${runtimeConfig.prefix}kickall
┣◆ 📢 ${runtimeConfig.prefix}tagall
┣◆ 👮 ${runtimeConfig.prefix}admins
┣◆ 👢 ${runtimeConfig.prefix}kick
┣◆ ➕ ${runtimeConfig.prefix}add
┣◆ 📊 ${runtimeConfig.prefix}gstatus
┣◆ ⬆️ ${runtimeConfig.prefix}promote
┣◆ ⬇️ ${runtimeConfig.prefix}demote
┣◆ 🔓 ${runtimeConfig.prefix}open
┣◆ 🔒 ${runtimeConfig.prefix}close
┣◆ 🔐 ${runtimeConfig.prefix}lock
┣◆ 🔓 ${runtimeConfig.prefix}unlock
┣◆ 🖼️ ${runtimeConfig.prefix}setgpp
┣◆ ✏️ ${runtimeConfig.prefix}subject
┣◆ 📝 ${runtimeConfig.prefix}desc
┣◆ ℹ️ ${runtimeConfig.prefix}groupinfo
┣◆ 🔗 ${runtimeConfig.prefix}invite
┣◆ ♻️ ${runtimeConfig.prefix}revoke
┣◆ 📩 ${runtimeConfig.prefix}requests
┣◆ ✅ ${runtimeConfig.prefix}approve
┣◆ ❌ ${runtimeConfig.prefix}reject
┣◆ 🚪 ${runtimeConfig.prefix}leave
┣◆ 📢 ${runtimeConfig.prefix}everyone
┣◆ 👮 ${runtimeConfig.prefix}tagadmins
┣◆ 🏷️ ${runtimeConfig.prefix}totag
┣◆ 🖼️ ${runtimeConfig.prefix}groupdp
┣◆ 🛡️ ${runtimeConfig.prefix}antigm
┣◆ 🚫 ${runtimeConfig.prefix}antisticker
┣◆ 🔗 ${runtimeConfig.prefix}antilink
┣◆ 👋 ${runtimeConfig.prefix}welcome
┣◆ 🏃 ${runtimeConfig.prefix}goodbye
┣◆ ⚠️ ${runtimeConfig.prefix}warn
┣◆ 🗑️ ${runtimeConfig.prefix}delete
┗❐

┏❐ 《 🤖 *AUTOMATION* 》 ❐
┣◆ ⌨️ ${runtimeConfig.prefix}autotyping
┣◆ ❤️ ${runtimeConfig.prefix}autoreact
┣◆ 👀 ${runtimeConfig.prefix}autoread
┣◆ 📖 ${runtimeConfig.prefix}autostoryview
┗❐

┏❐ 《 🛠️ *TOOLS* 》 ❐
┣◆ 👁️ ${runtimeConfig.prefix}vv
┣◆ 🔗 ${runtimeConfig.prefix}url
┣◆ 🆔 ${runtimeConfig.prefix}jid
┣◆ 👤 ${runtimeConfig.prefix}userinfo
┣◆ 🖼️ ${runtimeConfig.prefix}getpp
┣◆ 📝 ${runtimeConfig.prefix}getbio
┣◆ 🤖 ${runtimeConfig.prefix}bot
┣◆ 🔗 ${runtimeConfig.prefix}botlink
┗❐

┏❐ 《 🎮 *FUN & GAMES* 》 ❐
┣◆ 💕 ${runtimeConfig.prefix}ship
┣◆ 💖 ${runtimeConfig.prefix}love
┣◆ ❓ ${runtimeConfig.prefix}truth
┣◆ 🔥 ${runtimeConfig.prefix}dare
┣◆ 🎱 ${runtimeConfig.prefix}8ball
┣◆ 😂 ${runtimeConfig.prefix}joke
┣◆ 🖼️ ${runtimeConfig.prefix}meme
┣◆ 🧠 ${runtimeConfig.prefix}quiz
┣◆ 🎲 ${runtimeConfig.prefix}dice
┣◆ ✊ ${runtimeConfig.prefix}rps
┣◆ 🔮 ${runtimeConfig.prefix}guess
┗❐

┏❐ 《 🧪 *CHECK ZONE* 》 ❐
┣◆ 🤪 ${runtimeConfig.prefix}stupidcheck
┣◆ 😈 ${runtimeConfig.prefix}uncleancheck
┣◆ 🔥 ${runtimeConfig.prefix}hotcheck
┣◆ 🧠 ${runtimeConfig.prefix}smartcheck
┣◆ 🌟 ${runtimeConfig.prefix}greatcheckcase
┣◆ 😈 ${runtimeConfig.prefix}evilcheck
┣◆ 🐶 ${runtimeConfig.prefix}dogcheck
┣◆ 😎 ${runtimeConfig.prefix}coolcheck
┣◆ 🌈 ${runtimeConfig.prefix}gaycheck
┣◆ 💕 ${runtimeConfig.prefix}waifucheck
┗❐

┏❐ 《 😂 *ROAST & REACTION* 》 ❐
┣◆ 🤬 ${runtimeConfig.prefix}gali
┣◆ 🔥 ${runtimeConfig.prefix}roast
┣◆ 🧑‍💻 ${runtimeConfig.prefix}hack
┣◆ 😂 ${runtimeConfig.prefix}laugh
┣◆ 🫣 ${runtimeConfig.prefix}shy
┣◆ 😢 ${runtimeConfig.prefix}sad
┣◆ 🌙 ${runtimeConfig.prefix}moon
┣◆ 😡 ${runtimeConfig.prefix}anger
┣◆ 😍 ${runtimeConfig.prefix}happy
┣◆ 😵 ${runtimeConfig.prefix}confused
┣◆ ❤️ ${runtimeConfig.prefix}heart
┣◆ 😎 ${runtimeConfig.prefix}cool
┣◆ 🔥 ${runtimeConfig.prefix}fire
┣◆ ⭐ ${runtimeConfig.prefix}star
┣◆ 👍 ${runtimeConfig.prefix}thumbsup
┗❐

┏❐ 《 💕 *SOCIAL* 》 ❐
┣◆ 💑 ${runtimeConfig.prefix}couple
┣◆ 😉 ${runtimeConfig.prefix}flirt
┣◆ 🥰 ${runtimeConfig.prefix}compliment
┣◆ 🌹 ${runtimeConfig.prefix}tareef
┣◆ 🤝 ${runtimeConfig.prefix}respect
┣◆ 💚 ${runtimeConfig.prefix}goodword
┣◆ 😤 ${runtimeConfig.prefix}insult
┗❐

┏❐ 《 🎲 *MINI GAMES* 》 ❐
┣◆ 🪙 ${runtimeConfig.prefix}coinflip
┣◆ 🔄 ${runtimeConfig.prefix}flip
┣◆ 🎲 ${runtimeConfig.prefix}roll
┣◆ 🎰 ${runtimeConfig.prefix}slot
┣◆ ❌ ${runtimeConfig.prefix}tictactoe
┣◆ ⭕ ${runtimeConfig.prefix}ttt
┣◆ 🏳️ ${runtimeConfig.prefix}surrender
┣◆ 🏃 ${runtimeConfig.prefix}giveup
┣◆ 🏆 ${runtimeConfig.prefix}wcg
┣◆ 🔤 ${runtimeConfig.prefix}wordchain
┗❐

┏❐ 《 📝 *TEXT TOOLS* 》 ❐
┣◆ 📖 ${runtimeConfig.prefix}readmore
┣◆ 📜 ${runtimeConfig.prefix}textreadmore
┣◆ 🧮 ${runtimeConfig.prefix}calc
┣◆ 🔢 ${runtimeConfig.prefix}calculate
┣◆ 🔄 ${runtimeConfig.prefix}tovn
┣◆ 📖 ${runtimeConfig.prefix}read
┗❐

┏❐ 《 🖼️ *MEDIA FUN* 》 ❐
┣◆ 🧩 ${runtimeConfig.prefix}sticker
┣◆ 🏷️ ${runtimeConfig.prefix}take
┣◆ 🥷 ${runtimeConfig.prefix}steal
┣◆ ✍️ ${runtimeConfig.prefix}wm
┣◆ 🖋️ ${runtimeConfig.prefix}swm
┣◆ 🏷️ ${runtimeConfig.prefix}takefull
┣◆ 🖼️ ${runtimeConfig.prefix}toimg
┗❐

┏❐ 《 🎧 *AUDIO FX* 》 ❐
┣◆ 🔊 ${runtimeConfig.prefix}bass
┣◆ 💥 ${runtimeConfig.prefix}blown
┣◆ 🌊 ${runtimeConfig.prefix}deep
┣◆ 📢 ${runtimeConfig.prefix}earrape
┣◆ ⚡ ${runtimeConfig.prefix}fast
┣◆ 🐘 ${runtimeConfig.prefix}fat
┣◆ 🌙 ${runtimeConfig.prefix}nightcore
┣◆ 🔄 ${runtimeConfig.prefix}reverse
┣◆ 🤖 ${runtimeConfig.prefix}robot
┣◆ 🐢 ${runtimeConfig.prefix}slow
┣◆ ✨ ${runtimeConfig.prefix}smooth
┣◆ 🐿️ ${runtimeConfig.prefix}squirrel
┗❐`
      } else {
        reply = `💗 Oops... Unknown Command 🦋\n❝ ${command} ❞ — Try ${runtimeConfig.prefix}menu 🌸`;
      }

      try {
        if (command === "menu" && fs.existsSync("./assets/x-nobita-xd-menu.jpg")) {
          await sock.sendMessage(
            msg.key.remoteJid,
            {
              image: fs.readFileSync("./assets/x-nobita-xd-menu.jpg"),
              caption: reply,
              contextInfo
            },
            { quoted: quotedContact }
          );
        } else {
          await sock.sendMessage(msg.key.remoteJid, { text: reply, ...(replyMentions.length ? { mentions: replyMentions } : {}) }, { quoted: quotedContact });
        }
      } catch (quoteError) {
        console.log(`    ⚠️ vCard quote failed, sending normal reply: ${quoteError?.message || quoteError}`);
        await sock.sendMessage(msg.key.remoteJid, { text: reply }, { quoted: quotedContact });
      }
      console.log(`    ✅ REPLIED to ${msg.key.remoteJid}`);
    } catch (err) {
      console.log(`    ❌ Error: ${err?.message || err}`);
    }
  };

  // ---- Event 1: new incoming messages ----
  sock.ev.on("messages.upsert", async (data) => {
    console.log("[upsert] type:", data.type);
    for (const msg of data.messages || []) {
      if (!msg?.message) {
        // WhatsApp sometimes sends a placeholder ("message absent") that it
        // fills in LATER via messages.update — do nothing here, see Event 2.
        console.log(`  [upsert] message without content at ${msg?.key?.remoteJid} (type: ${data.type})`);
        continue;
      }
      try {
        const jid = msg.key.remoteJid;
        if (jid?.endsWith("@g.us") && antiGroupStatus.has(jid) && msg.message?.groupStatusMessageV2) {
          console.log(`🛡️ AntiGM: deleting group status in ${jid}`);
          try {
            await sock.sendMessage(jid, { delete: msg.key });
          } catch (deleteError) {
            console.log(`⚠️ AntiGM delete failed: ${deleteError?.message || deleteError}`);
          }
          continue;
        }
        if (jid?.endsWith("@g.us") && antiSticker.has(jid) && msg.message?.stickerMessage) {
          console.log(`🛡️ AntiSticker: deleting sticker in ${jid}`);
          try {
            await sock.sendMessage(jid, { delete: msg.key });
          } catch (deleteError) {
            console.log(`⚠️ AntiSticker delete failed: ${deleteError?.message || deleteError}`);
          }
          continue;
        }
      } catch (antiError) {
        console.log(`⚠️ AntiGM detection error: ${antiError?.message || antiError}`);
      }
      if (await moderateAntiLink(msg)) continue;
      await handleAutomation(sock, msg, botJid);
      await processCommandMessage(msg);
    }
  });

  // ---- Event 2: messages being filled in after decryption (fixes empty-text bug) ----
  // In LID-migrated accounts, WhatsApp first sends a placeholder with NO text
  // inside messages.upsert; the real message arrives a moment later via
  // messages.update with update.message filled. Handling BOTH events is required.
  sock.ev.on("messages.update", async (updates) => {
    for (const update of updates || []) {
      if (!update?.key || !update.message) continue;
      // only care about updates that ADD a message (decrypted text or protected media)
      const jid = update.key.remoteJid;
      if (jid?.endsWith("@g.us") && antiSticker.has(jid) && update.message?.stickerMessage) {
        console.log(`🛡️ AntiSticker: deleting hydrated sticker in ${jid}`);
        try {
          await sock.sendMessage(jid, { delete: update.key });
        } catch (deleteError) {
          console.log(`⚠️ AntiSticker delete failed: ${deleteError?.message || deleteError}`);
        }
        continue;
      }
      if (await moderateAntiLink({ key: update.key, message: update.message })) continue;
      if (jid?.endsWith("@g.us") && antiGroupStatus.has(jid) && (
        update.message?.groupStatusMessageV2 ||
        update.message?.groupStatusMessage ||
        update.message?.messageContextInfo?.groupStatusMessageV2 ||
        update.message?.messageContextInfo?.groupStatusMessage
      )) {
        console.log(`🛡️ AntiGM: deleting hydrated group status in ${jid}`);
        try {
          await sock.sendMessage(jid, { delete: update.key });
        } catch (deleteError) {
          console.log(`⚠️ AntiGM delete failed: ${deleteError?.message || deleteError}`);
        }
        continue;
      }
      const hasText =
        update.message.conversation ||
        update.message.extendedTextMessage?.text ||
        update.message.buttonsResponseMessage?.selectedButtonId ||
        update.message.listResponseMessage?.singleSelectReply?.selectedRowId;
      await handleAutomation(sock, { key: update.key, message: update.message }, botJid);
      if (hasText) {
        console.log("[update] message hydrated");
        await processCommandMessage({ key: update.key, message: update.message });
      }
    }
  });

  // ---- Welcome system (Levanter-style) ----
  const welcomeText = (groupName, mention) =>
    `*Hay Darling* ${mention}  _WELCOME TO_ ${groupName}\n` +
    `🌷 **তোমার জন্য রইলো একগুচ্ছ ভালোবাসা.!!🥹*\n` +
    `*এই পরিবারে তোমার প্রতিটি মুহূর্ত হোক সুন্দর.💋*\n` +
    `🌙 *Stay Happy • Stay Connected • Keep Smiling*`;

  const sendWelcome = async (groupJid, participantJid) => {
    try {
      const metadata = await sock.groupMetadata(groupJid);
      const groupName = metadata.subject || "Our Group";
      const mention = `@${participantJid.split("@")[0]}`;
      let ppUrl = null;
      try { ppUrl = await sock.profilePictureUrl(participantJid, "image"); } catch (_) {}
      const caption = welcomeText(groupName, mention);
      const message = ppUrl
        ? { image: { url: ppUrl }, caption, mentions: [participantJid] }
        : { text: caption, mentions: [participantJid] };
      await sock.sendMessage(groupJid, message, { quoted: quotedContact });
      console.log(`🌷 Welcome sent to ${participantJid} in ${groupName}`);
    } catch (err) {
      console.log(`⚠️ Welcome failed: ${err?.message || err}`);
    }
  };

  const sendGoodbye = async (groupJid, participantJid) => {
    try {
      const mention = `@${participantJid.split("@")[0]}`;
      let ppUrl = null;
      try { ppUrl = await sock.profilePictureUrl(participantJid, "image"); } catch (_) {}
      const caption = `_Good By_ ${mention} _We will never miss you....!!👻✌️_`;
      const message = ppUrl
        ? { image: { url: ppUrl }, caption, mentions: [participantJid], contextInfo }
        : { text: caption, mentions: [participantJid], contextInfo };
      await sock.sendMessage(groupJid, message, { quoted: quotedContact });
      console.log(`🥀 Goodbye sent to ${participantJid}`);
    } catch (err) {
      console.log(`⚠️ Goodbye failed: ${err?.message || err}`);
    }
  };

  sock.ev.on("group-participants.update", async (update) => {
    try {
      if (!update?.id || !update?.participants?.length) return;
      if (update.action === "add") {
        // Only groups that explicitly enabled welcome receive it.
        if (!welcomeGroups.has(update.id)) return;
        for (const participant of update.participants) {
          const jid = typeof participant === "string" ? participant : participant?.id;
          if (jid) await sendWelcome(update.id, jid);
        }
      } else if (update.action === "remove") {
        // Only groups that explicitly enabled goodbye receive it.
        if (!goodbyeGroups.has(update.id)) return;
        for (const participant of update.participants) {
          const jid = typeof participant === "string" ? participant : participant?.id;
          if (jid) await sendGoodbye(update.id, jid);
        }
      }
    } catch (err) {
      console.log(`⚠️ Welcome/Goodbye event error: ${err?.message || err}`);
    }
  });

  // Extra safety: group-participant metadata uses the 'participant' key;
  // also bind on m.update to confirm live message delivery.
  sock.ev.on("messaging-history.set", () => {
    console.log("📂 Messaging history loaded.");
  });

  // IMPORTANT: return the live WhatsApp socket to SessionManager.
  // Without this, Telegram /pair sees "WhatsApp socket was not created"
  // even though the Baileys socket was actually initialized.
  return sock;
}

// Multi-pair Telegram control: every paired number gets its own session.
sessionManager = new SessionManager({
  startSession: (authDir, options = {}) => startBot(authDir, options),
  sessionsDir: path.join(process.cwd(), "sessions")
});

global.__nobitaSessionManager = sessionManager;
global.__nobitaStartSession = (authDir, options = {}) => startBot(authDir, options);

startTelegramPairing();

(async () => {
  await sessionManager.startAll();

  const mainCreds = path.join(process.cwd(), "session", "creds.json");
  if (fs.existsSync(mainCreds)) {
    startBot().catch((err) => console.error("Main session error:", err));
  } else if (sessionManager.sessions.size === 0) {
    startBot().catch((err) => {
      console.error("❌ Fatal error:", err);
      process.exit(1);
    });
  }
})().catch((err) => {
  console.error("Fatal session-manager startup error:", err);
  process.exit(1);
});
