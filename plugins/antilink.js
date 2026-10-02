// plugins/antilink.js
// X NOBITA XD - reliable AntiLink plugin for Baileys v7

const LINK_REGEX = /(?:https?:\/\/|www\.)[^\s]+|(?:chat\.whatsapp\.com|wa\.me|t\.me|telegram\.me|discord\.gg|bit\.ly|tinyurl\.com)\/[^\s]+|\b(?:[a-z0-9-]+\.)+(?:com|net|org|io|gg|xyz|me|app|online|site|link|dev|co|in|info|biz|ly)\b[^\s]*/i;

function unwrapMessage(message) {
  let current = message;
  for (let i = 0; i < 12 && current; i++) {
    if (current.ephemeralMessage?.message) current = current.ephemeralMessage.message;
    else if (current.viewOnceMessage?.message) current = current.viewOnceMessage.message;
    else if (current.viewOnceMessageV2?.message) current = current.viewOnceMessageV2.message;
    else if (current.viewOnceMessageV2Extension?.message) current = current.viewOnceMessageV2Extension.message;
    else if (current.documentWithCaptionMessage?.message) current = current.documentWithCaptionMessage.message;
    else if (current.editedMessage?.message) current = current.editedMessage.message;
    else break;
  }
  return current || message;
}

function extractText(message) {
  const m = unwrapMessage(message);
  if (!m) return "";
  return String(
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.imageMessage?.caption ||
    m.videoMessage?.caption ||
    m.documentMessage?.caption ||
    m.documentWithCaptionMessage?.message?.documentMessage?.caption ||
    m.buttonsResponseMessage?.selectedDisplayText ||
    m.buttonsResponseMessage?.selectedButtonId ||
    m.listResponseMessage?.title ||
    m.listResponseMessage?.singleSelectReply?.selectedRowId ||
    ""
  );
}

function numberOf(jid = "") {
  return String(jid).split("@")[0].split(":")[0].replace(/\D/g, "");
}

function sameJid(a, b) {
  if (!a || !b) return false;
  if (String(a) === String(b)) return true;
  const na = numberOf(a);
  const nb = numberOf(b);
  return !!na && !!nb && na === nb;
}

function findParticipant(participants, jid) {
  if (!jid) return null;
  return (participants || []).find(p =>
    sameJid(p?.id, jid) ||
    sameJid(p?.lid, jid)
  ) || null;
}

function isAdminParticipant(p) {
  return !!p && (p.admin === "admin" || p.admin === "superadmin");
}

function createAntiLinkHandler({ sock, modes, warns, quotedContact, getBotNumber }) {
  const handled = new Set();

  return async function moderateAntiLink(msg) {
    try {
      const groupJid = msg?.key?.remoteJid;
      if (!groupJid || !groupJid.endsWith("@g.us")) return false;

      const mode = modes.get(groupJid);
      if (!mode) return false;

      const body = extractText(msg?.message);
      if (!body || !LINK_REGEX.test(body)) return false;

      const messageKey = `${groupJid}:${msg?.key?.id || ""}:${msg?.key?.participant || ""}`;
      if (handled.has(messageKey)) return true;
      handled.add(messageKey);
      if (handled.size > 5000) handled.delete(handled.values().next().value);

      const metadata = await sock.groupMetadata(groupJid);
      const participants = metadata?.participants || [];

      const senderJid =
        msg?.key?.participant ||
        msg?.participant ||
        msg?.key?.senderPn ||
        msg?.key?.senderLid ||
        "";

      const sender = findParticipant(participants, senderJid);
      if (!senderJid && !sender) return false;

      // Never moderate group admins.
      if (isAdminParticipant(sender)) return false;

      // Never moderate the bot itself.
      const botCandidates = [
        typeof getBotNumber === "function" ? getBotNumber() : "",
        sock?.user?.id,
        sock?.user?.lid
      ].filter(Boolean);

      const senderIsBot = botCandidates.some(candidate =>
        sameJid(candidate, senderJid) ||
        sameJid(candidate, sender?.id) ||
        sameJid(candidate, sender?.lid)
      );
      if (senderIsBot) return false;

      // Find the bot in group participants. Prefer exact id/lid, then phone-number match.
      const botParticipant = participants.find(p =>
        botCandidates.some(candidate =>
          sameJid(candidate, p?.id) || sameJid(candidate, p?.lid)
        )
      );

      // Baileys groupMetadata must contain the bot participant. Without admin rights
      // WhatsApp will reject deletion/removal, so fail safely instead of touching users.
      if (!isAdminParticipant(botParticipant)) {
        console.log(`⚠️ AntiLink: bot is not detected as group admin in ${groupJid}`);
        return false;
      }

      const targetJid = sender?.id || senderJid;
      const targetNumber = numberOf(targetJid) || numberOf(sender?.lid) || "member";
      const mention = `@${targetNumber}`;

      // Delete FIRST, then send the notice. This is the important part for delete mode.
      try {
        await sock.sendMessage(groupJid, { delete: msg.key });
        console.log(`🗑️ AntiLink: deleted link from ${targetJid}`);
      } catch (e) {
        console.log(`⚠️ AntiLink delete failed: ${e?.message || e}`);
      }

      if (mode === "delete") {
        await sock.sendMessage(
          groupJid,
          {
            text: `*🗑️ ${mention} 𝐋ɪɴᴋ 𝐃ᴇʟᴇᴛᴇᴅ — 𝐏ʟᴇᴀsᴇ 𝐃ᴏɴ'ᴛ! 🌷💗*`,
            mentions: [targetJid]
          },
          { quoted: quotedContact }
        );
        return true;
      }

      if (mode === "kick") {
        try {
          await sock.groupParticipantsUpdate(groupJid, [targetJid], "remove");
        } catch (e) {
          console.log(`⚠️ AntiLink kick failed: ${e?.message || e}`);
        }
        await sock.sendMessage(
          groupJid,
          {
            text: `*🥀 ${mention} 𝐊ɪᴄᴋᴇᴅ — 𝐋ɪɴᴋ 𝐃ᴇᴛᴇᴄᴛᴇᴅ! 🥺💗*`,
            mentions: [targetJid]
          },
          { quoted: quotedContact }
        );
        return true;
      }

      // WARN mode: 3 links = kick.
      const warnKey = `${groupJid}:${targetJid || targetNumber}`;
      const warnCount = (warns.get(warnKey) || 0) + 1;

      if (warnCount >= 3) {
        warns.delete(warnKey);
        try {
          await sock.groupParticipantsUpdate(groupJid, [targetJid], "remove");
        } catch (e) {
          console.log(`⚠️ AntiLink warn-kick failed: ${e?.message || e}`);
        }
        await sock.sendMessage(
          groupJid,
          {
            text: `*🥀 ${mention} 𝐊ɪᴄᴋᴇᴅ — 𝟑 𝐖ᴀʀɴs 𝐂ᴏᴍᴘʟᴇᴛᴇ! 🥺💗*`,
            mentions: [targetJid]
          },
          { quoted: quotedContact }
        );
      } else {
        warns.set(warnKey, warnCount);
        const warning = warnCount === 1
          ? `*⚠️ ${mention} 𝐖ᴀʀɴ 𝟏 — 𝐏ʟᴇᴀsᴇ 𝐃ᴏɴ'ᴛ 𝐒ᴇɴᴅ 𝐋ɪɴᴋs! 🥺💗*`
          : `*⚠️ ${mention} 𝐖ᴀʀɴ 𝟐 — 𝐍ᴇxᴛ 𝐋ɪɴᴋ = 𝐊ɪᴄᴋ! 🥺🥀*`;

        await sock.sendMessage(
          groupJid,
          { text: warning, mentions: [targetJid] },
          { quoted: quotedContact }
        );
      }

      return true;
    } catch (e) {
      console.log(`⚠️ AntiLink error: ${e?.message || e}`);
      return false;
    }
  };
}

module.exports = {
  createAntiLinkHandler,
  unwrapMessage,
  extractText,
  numberOf
};
