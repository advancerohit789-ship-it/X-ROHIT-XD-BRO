const botSettings = require('../botSettings');

const DEFAULTS = {
  autotyping: false,
  autoread: false,
  autostoryview: false
};

const ROMANTIC_REACTIONS = [
  '💗','❤️','🩷','💕','💞','💓','💖','💘','💝','💟','❣️','❤️‍🔥','❤️‍🩹',
  '🥰','😍','🥺','😘','😚','😙','😗','😻','🫶🏻','🫂','💋','💌','💍','🫀','💒',
  '🌸','🌷','🌹','🌺','🌻','🌼','🪷','💐','🦋','🌙','⭐','🌟','✨','💫','🫧',
  '🎀','🪽','☁️','🌈','🩵','💙','💜','🤍','🤎','🖤','🧡','💛','💚','🍀','🌿',
  '🪻','🌱','🌌','🌠','☀️','🌤️','🫶','🤗','😊','☺️','🥹','😽','🫰🏻'
];

function getSettings(botJid) {
  return botSettings.get(botJid).automation;
}

function statusText(name, botJid) {
  return getSettings(botJid)[name] ? '𝑶𝑵 🟢' : '𝑶𝑭𝑭 🔴';
}

function ownerDenied(reply) {
  return reply('🚫💗 ᴏɴʟʏ ᴏᴡɴᴇʀ ᴄᴀɴ ᴜsᴇ ᴛʜɪs ᴄᴏᴍᴍᴀɴᴅ 🌸 |');
}

async function automationCommand(name, args, reply, isOwner, botJid) {
  if (!Object.prototype.hasOwnProperty.call(DEFAULTS, name)) return;
  if (!isOwner) return ownerDenied(reply);

  const option = String(args?.[0] || '').trim().toLowerCase();
  if (option === 'on' || option === 'off') {
    const value = option === 'on';
    const current = getSettings(botJid)[name];
    if (current === value) {
      return reply(value
        ? '⚠️💗 ᴀᴜᴛᴏᴛʏᴘɪɴɢ ɪs ᴀʟʀᴇᴀᴅʏ ᴇɴᴀʙʟᴇᴅ 🌸 |'.replace('ᴀᴜᴛᴏᴛʏᴘɪɴɢ', name === 'autotyping' ? 'ᴀᴜᴛᴏᴛʏᴘɪɴɢ' : name)
        : `⚠️💗 ${name} ɪs ᴀʟʀᴇᴀᴅʏ ᴅɪsᴀʙʟᴇᴅ 🌷 |`);
    }
    botSettings.update(botJid, s => { s.automation[name] = value; return s; });
    const labels = {
      autotyping: ['⌨️💗 ᴀᴜᴛᴏᴛʏᴘɪɴɢ ᴇɴᴀʙʟᴇᴅ ✓ 🌸 |','⌨️💗 ᴀᴜᴛᴏᴛʏᴘɪɴɢ ᴅɪsᴀʙʟᴇᴅ ✓ 🌷 |'],
      autoread: ['👀💗 ᴀᴜᴛᴏʀᴇᴀᴅ ᴇɴᴀʙʟᴇᴅ ✓ 🌸 |','👀🌷 ᴀᴜᴛᴏʀᴇᴀᴅ ᴅɪsᴀʙʟᴇᴅ ✓ 💗 |'],
      autostoryview: ['👀💗 ᴀᴜᴛᴏsᴛᴏʀʏᴠɪᴇᴡ ᴇɴᴀʙʟᴇᴅ ✓ 🌸 |','👀🌷 ᴀᴜᴛᴏsᴛᴏʀʏᴠɪᴇᴡ ᴅɪsᴀʙʟᴇᴅ ✓ 💗 |']
    };
    return reply(labels[name][value ? 0 : 1]);
  }
  if (option === 'status') return reply(`⚡ ${name.toUpperCase()} : ${statusText(name, botJid)} 🌸 |`);
  return reply(`🥺💗 ᴜsᴇ .${name} on ᴏʀ .${name} off 🌸 |`);
}

async function autoreactCommand(args, reply, isOwner, botJid) {
  if (!isOwner) return ownerDenied(reply);
  const option = String(args?.[0] || '').trim().toLowerCase();
  const enabled = botSettings.get(botJid).autoreact;
  if (option === 'on') {
    if (enabled) return reply('⚠️💗 ᴀᴜᴛᴏʀᴇᴀᴄᴛ ɪs ᴀʟʀᴇᴀᴅʏ ᴇɴᴀʙʟᴇᴅ 🌸 |');
    botSettings.update(botJid, s => { s.autoreact = true; return s; });
    return reply('💞🌸 ᴀᴜᴛᴏʀᴇᴀᴄᴛ ᴇɴᴀʙʟᴇᴅ ✓ 💗 |');
  }
  if (option === 'off') {
    if (!enabled) return reply('⚠️💗 ᴀᴜᴛᴏʀᴇᴀᴄᴛ ɪs ᴀʟʀᴇᴀᴅʏ ᴅɪsᴀʙʟᴇᴅ 🌷 |');
    botSettings.update(botJid, s => { s.autoreact = false; return s; });
    return reply('🌷💗 ᴀᴜᴛᴏʀᴇᴀᴄᴛ ᴅɪsᴀʙʟᴇᴅ ✓ 🦋 |');
  }
  if (option === 'status') return reply(`💞💗 ᴀᴜᴛᴏʀᴇᴀᴄᴛ : ${enabled ? '𝑶𝑵 🟢' : '𝑶𝑭𝑭 🔴'} |`);
  return reply('🥺💗 ᴜsᴇ .autoreact on ᴏʀ .autoreact off 🌸 |');
}

const lastReaction = new Map();
const reactedMessages = new Set();
const lastTyping = new Map();
const lastRead = new Map();
const lastStory = new Map();

function randomReaction(botJid) {
  let r;
  const prev = lastReaction.get(botJid);
  do { r = ROMANTIC_REACTIONS[Math.floor(Math.random() * ROMANTIC_REACTIONS.length)]; }
  while (ROMANTIC_REACTIONS.length > 1 && r === prev);
  lastReaction.set(botJid, r);
  return r;
}

async function handleAutomation(sock, msg, botJid) {
  if (!msg?.key || msg.key.fromMe || !msg.key.remoteJid) return;
  const jid = msg.key.remoteJid;
  const settings = botSettings.get(botJid);

  if (jid === 'status@broadcast') {
    if (!settings.autostoryview || !msg.key.id || typeof sock.readMessages !== 'function') return;
    const key = `${botJid}:${msg.key.id}`;
    if (lastStory.has(key)) return;
    lastStory.set(key, true);
    try { await sock.readMessages([msg.key]); } catch (e) { console.log(`[AUTOSTORYVIEW] ${e.message}`); }
    return;
  }

  if (settings.autoread && msg.key.id && typeof sock.readMessages === 'function') {
    const key = `${jid}:${msg.key.id}`;
    if (!lastRead.has(key)) {
      lastRead.set(key, true);
      try { await sock.readMessages([msg.key]); } catch (e) { console.log(`[AUTOREAD] ${e.message}`); }
    }
  }

  if (settings.autoreact && msg.key.id) {
    const key = `${jid}:${msg.key.id}`;
    if (!reactedMessages.has(key)) {
      reactedMessages.add(key);
      if (reactedMessages.size > 10000) reactedMessages.delete(reactedMessages.values().next().value);
      try { await sock.sendMessage(jid, { react: { text: randomReaction(botJid), key: msg.key } }); }
      catch (e) { console.log(`[AUTOREACT] ${e.message}`); }
    }
  }

  if (settings.autotyping && typeof sock.sendPresenceUpdate === 'function') {
    const key = `${botJid}:${jid}`;
    const now = Date.now();
    if ((lastTyping.get(key) || 0) + 2500 <= now) {
      lastTyping.set(key, now);
      try {
        await sock.sendPresenceUpdate('composing', jid);
        setTimeout(() => Promise.resolve(sock.sendPresenceUpdate('paused', jid)).catch(() => {}), 900);
      } catch (e) { console.log(`[AUTOTYPING] ${e.message}`); }
    }
  }
}

module.exports = { automationCommand, autoreactCommand, handleAutomation };
