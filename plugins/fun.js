const romantic = ['💗','❤️','🩷','💕','💞','💓','💖','💘','💝','🥰','😍','🥺','😘','🫶🏻','🌸','🌷','🌹','🦋','✨','🎀'];
const truths = [
  '𝐖ʜᴀᴛ ɪs ʏᴏᴜʀ ʙɪɢɢᴇsᴛ sᴇᴄʀᴇᴛ? 👀',
  '𝐖ʜᴏ ᴡᴀs ʏᴏᴜʀ ғɪʀsᴛ ᴄʀᴜsʜ? 💗',
  '𝐇ᴀᴠᴇ ʏᴏᴜ ᴇᴠᴇʀ ʟɪᴋᴇᴅ sᴏᴍᴇᴏɴᴇ ɪɴ ᴛʜɪs ɢʀᴏᴜᴘ? 🌸',
  '𝐖ʜᴀᴛ ɪs ᴏɴᴇ ᴛʜɪɴɢ ʏᴏᴜ ᴄᴀɴɴᴏᴛ ʟɪᴠᴇ ᴡɪᴛʜᴏᴜᴛ? 🫶🏻'
];
const dares = [
  '𝐒ᴇɴᴅ ᴀ ᴄᴜᴛᴇ ᴠᴏɪᴄᴇ ᴍᴇssᴀɢᴇ ᴛᴏ sᴏᴍᴇᴏɴᴇ. 💗',
  '𝐒ᴇɴᴅ ʏᴏᴜʀ ʟᴀsᴛ ᴜsᴇᴅ ᴇᴍᴏᴊɪ ᴛᴏ ᴛʜᴇ ɢʀᴏᴜᴘ. 🌸',
  '𝐓ᴀɢ ʏᴏᴜʀ ᴄʀᴜsʜ ᴡɪᴛʜ ᴀ ʜᴇᴀʀᴛ. 🫶🏻',
  '𝐒ᴀʏ “𝐈 𝐋ᴏᴠᴇ 𝐘ᴏᴜ” ɪɴ ᴀ ᴄᴜᴛᴇ ᴡᴀʏ. 💞'
];
const jokes = [
  '𝐖ʜʏ ᴅɪᴅ ᴛʜᴇ ᴘʀᴏɢʀᴀᴍᴍᴇʀ ɢᴏ ᴛᴏ ᴛʜᴇ ᴘᴀʀᴛʏ? 𝐇ᴇ ʜᴀᴅ ᴛᴏ ᴄᴏᴍᴍɪᴛ! 😂',
  '𝐈 ᴛᴏʟᴅ ᴍʏ ᴄᴏᴍᴘᴜᴛᴇʀ ɪ ɴᴇᴇᴅᴇᴅ ᴀ ʙʀᴇᴀᴋ… ɴᴏᴡ ɪᴛ ᴡᴏɴ’ᴛ sᴛᴏᴘ sᴇɴᴅɪɴɢ ᴍᴇ ᴇʀʀᴏʀs. 😭'
];
const quiz = [
  ['𝐖ʜɪᴄʜ ᴘʟᴀɴᴇᴛ ɪs ᴋɴᴏᴡɴ ᴀs ᴛʜᴇ 𝐑ᴇᴅ 𝐏ʟᴀɴᴇᴛ?', 'Mars 🌍'],
  ['𝐇ᴏᴡ ᴍᴀɴʏ ᴅᴀʏs ᴀʀᴇ ɪɴ ᴀ ᴡᴇᴇᴋ?', '7 📅'],
  ['𝐖ʜɪᴄʜ ᴀɴɪᴍᴀʟ ɪs ᴋɴᴏᴡɴ ᴀs ᴛʜᴇ 𝐊ɪɴɢ ᴏғ 𝐓ʜᴇ 𝐉ᴜɴɢʟᴇ?', 'Lion 🦁']
];
const eight = ['𝐘ᴇs, ᴅᴇғɪɴɪᴛᴇʟʏ! 💗','𝐀ʙsᴏʟᴜᴛᴇʟʏ ʏᴇs! 🌸','𝐌ᴀʏʙᴇ… ᴛʀʏ ᴀɢᴀɪɴ. 🦋','𝐃ᴏᴜʙᴛғᴜʟ, ʙᴜᴛ ɴᴇᴠᴇʀ ɢɪᴠᴇ ᴜᴘ. 💞'];
const pick = a => a[Math.floor(Math.random()*a.length)];
const pct = () => Math.floor(Math.random()*41)+60;
const nameFromMsg = (msg) => {
  const ctx = msg.message?.extendedTextMessage?.contextInfo || {};
  const q = ctx.participant || '';
  return q ? `@${q.split('@')[0]}` : '𝐔sᴇʀ';
};

async function handleFunCommand(command, args, { msg }) {
  const user = nameFromMsg(msg);
  const p = (text) => text;
  switch (command) {
    case 'ship': {
      const n = nameFromMsg(msg); const v = pct();
      return p(`┏❐ 《 💗 𝐒𝐇𝐈𝐏 𝐌𝐀𝐓𝐂𝐇 》 ❐\n┣◆ 👤 𝐗 𝐍ᴏʙɪᴛᴀ × ${n}\n┣◆ 💞 𝐋ᴏᴠᴇ : ${v}%\n┣◆ 🌸 𝐌ᴀᴛᴄʜ : ${v >= 85 ? '𝐏ᴇʀғᴇᴄᴛ 𝐂ᴏᴜᴘʟᴇ 💗' : v >= 70 ? '𝐂ᴜᴛᴇ 𝐌ᴀᴛᴄʜ 🌷' : '𝐉ᴜsᴛ 𝐅ʀɪᴇɴᴅs 🦋'}\n┗❐`, []);
    }
    case 'love': { const v=pct(); return p(`┏❐ 《 🫶🏻 𝐋𝐎𝐕𝐄 𝐌𝐄𝐓𝐄𝐑 》 ❐\n┣◆ 💗 𝐋ᴏᴠᴇ : ${v}%\n┣◆ 🌷 𝐒ᴛᴀᴛᴜs : ${v>=85?'𝐌ᴀᴅʟʏ 𝐈ɴ 𝐋ᴏᴠᴇ':v>=70?'𝐂ᴜᴛᴇ 𝐋ᴏᴠᴇ':'𝐉ᴜsᴛ 𝐒ᴛᴀʀᴛɪɴɢ'} 💞\n┗❐`); }
    case 'truth': return p(`┏❐ 《 🎯 𝐓𝐑𝐔𝐓𝐇 》 ❐\n┣◆ 💗 𝐐ᴜᴇsᴛɪᴏɴ :\n┣◆ ❝ ${pick(truths)} ❞\n┗❐`);
    case 'dare': return p(`┏❐ 《 🔥 𝐃𝐀𝐑𝐄 》 ❐\n┣◆ 🫶🏻 𝐘ᴏᴜʀ 𝐃ᴀʀᴇ :\n┣◆ 🌸 ${pick(dares)}\n┗❐`);
    case '8ball': {
      if (!args.length) return p('🥺💗 ᴜsᴀɢᴇ: .8ball <question> 🌸 |');
      return p(`┏❐ 《 🎱 𝐌𝐀𝐆𝐈𝐂 𝟖 𝐁𝐀𝐋𝐋 》 ❐\n┣◆ ❓ 𝐐ᴜᴇsᴛɪᴏɴ : ${args.join(' ')}\n┣◆ 💗 𝐀ɴsᴡᴇʀ : ${pick(eight)}\n┗❐`);
    }
    case 'joke': return p(`┏❐ 《 😂 𝐑𝐀𝐍𝐃𝐎𝐌 𝐉𝐎𝐊𝐄 》 ❐\n┣◆ 🌸 ${pick(jokes)}\n┗❐`);
    case 'meme': return p('┏❐ 《 🖼️ 𝐌𝐄𝐌𝐄 》 ❐\n┣◆ 😂 𝐑ᴀɴᴅᴏᴍ ᴍᴇᴍᴇ ᴄᴏᴍᴍᴀɴᴅ ʀᴇᴀᴅʏ! 🌸\n┗❐');
    case 'quiz': { const q=pick(quiz); return p(`┏❐ 《 🧠 𝐐𝐔𝐈𝐙 》 ❐\n┣◆ ❓ ${q[0]}\n┣◆ 💗 𝐀ɴsᴡᴇʀ : ${q[1]}\n┗❐`); }
    case 'dice': return p(`┏❐ 《 🎲 𝐃𝐈𝐂𝐄 》 ❐\n┣◆ 🌸 𝐘ᴏᴜ ʀᴏʟʟᴇᴅ : ${Math.floor(Math.random()*6)+1}\n┣◆ 💗 𝐆ᴏᴏᴅ ʟᴜᴄᴋ!\n┗❐`);
    case 'rps': { const a=['𝐑ᴏᴄᴋ','𝐏ᴀᴘᴇʀ','𝐒ᴄɪssᴏʀs']; const you=pick(a), bot=pick(a); const win=(you==='𝐑ᴏᴄᴋ'&&bot==='𝐒ᴄɪssᴏʀs')||(you==='𝐏ᴀᴘᴇʀ'&&bot==='𝐑ᴏᴄᴋ')||(you==='𝐒ᴄɪssᴏʀs'&&bot==='𝐏ᴀᴘᴇʀ'); return p(`┏❐ 《 ✊ 𝐑𝐏𝐒 》 ❐\n┣◆ 👤 𝐘ᴏᴜ : ${you}\n┣◆ 🤖 𝐁ᴏᴛ : ${bot}\n┣◆ 🏆 𝐑ᴇsᴜʟᴛ : ${you===bot?'𝐃ʀᴀᴡ 💞':win?'𝐘ᴏᴜ 𝐖ɪɴ! 💗':'𝐁ᴏᴛ 𝐖ɪɴs! 🌸'}\n┗❐`); }
    case 'guess': return p('┏❐ 《 🔢 𝐆𝐔𝐄𝐒𝐒 𝐆𝐀𝐌𝐄 》 ❐\n┣◆ 🌸 𝐈’ᴍ ᴛʜɪɴᴋɪɴɢ ᴏғ ᴀ ɴᴜᴍʙᴇʀ 𝟏–𝟏𝟎𝟎\n┣◆ 💗 𝐔sᴀɢᴇ : .guess <number>\n┗❐');
    default: return p('🥺💗 ᴜɴᴋɴᴏᴡɴ ғᴜɴ ᴄᴏᴍᴍᴀɴᴅ 🌸 |');
  }
}
module.exports = { handleFunCommand };
