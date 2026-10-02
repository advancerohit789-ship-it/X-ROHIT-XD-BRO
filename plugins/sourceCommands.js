const fs = require('fs');
const path = require('path');
const os = require('os');
const { exec } = require('child_process');
const { downloadContentFromMessage } = require('@whiskeysockets/baileys');

const CHECKS = {
  stupidcheck:['🤪','STUPID'], uncleancheck:['🤢','UNCLEAN'], hotcheck:['🔥','HOT'], smartcheck:['🧠','SMART'],
  greatcheckcase:['⭐','GREAT'], evilcheck:['😈','EVIL'], dogcheck:['🐕','DOG'], coolcheck:['😎','COOL'],
  gaycheck:['🏳️‍🌈','GAY'], waifucheck:['💕','WAIFU']
};
const pick = a => a[Math.floor(Math.random()*a.length)];
const pct = () => Math.floor(Math.random()*100);
const jidOf = (msg) => msg.key.participant || msg.participant || msg.key.senderPn || msg.key.senderLid || msg.key.remoteJid || '';
const ctx = msg => msg.message?.extendedTextMessage?.contextInfo || msg.message?.imageMessage?.contextInfo || msg.message?.videoMessage?.contextInfo || msg.message?.stickerMessage?.contextInfo || {};
const targetOf = msg => ctx(msg).mentionedJid?.[0] || ctx(msg).participant || jidOf(msg);
const mention = jid => `@${String(jid).split('@')[0].split(':')[0]}`;
const bold = s => `**${s}**`;

// Existing X NOBITA style: bold uppercase + small-cap lowercase.
const XN_UPPER = "𝐀𝐁𝐂𝐃𝐄𝐅𝐆𝐇𝐈𝐉𝐊𝐋𝐌𝐍𝐎𝐏𝐐𝐑𝐒𝐓𝐔𝐕𝐖𝐗𝐘𝐙";
const XN_LOWER = "ᴀʙᴄᴅᴇғɢʜɪᴊᴋʟᴍɴᴏᴘǫʀsᴛᴜᴠᴡxʏᴢ";
const XN_STYLE = (value) => String(value).replace(/[A-Za-z]/g, ch => {
  const code = ch.charCodeAt(0);
  return ch >= 'A' && ch <= 'Z' ? XN_UPPER[code - 65] : XN_LOWER[code - 97];
});
const XN_FONT_COMMANDS = new Set([
  'stupidcheck','uncleancheck','hotcheck','smartcheck','greatcheckcase','evilcheck','dogcheck','coolcheck','gaycheck','waifucheck',
  'gali','roast','ship','hack','couple','flirt','compliment','tareef','respect','goodword','insult',
  '8ball','coinflip','flip','dice','roll','rps','slot','guess','tictactoe','ttt','surrender','giveup','wcg','wordchain',
  'laugh','shy','sad','moon','anger','happy','confused','heart','cool','fire','star','thumbsup',
  'readmore','textreadmore','calc','calculate','tovn','read','sticker','take','steal','wm','swm','takefull','toimg',
  'bass','blown','deep','earrape','fast','fat','nightcore','reverse','robot','slow','smooth','squirrel'
]);
const styleXNResult = (command, result) => {
  if (!XN_FONT_COMMANDS.has(command) || !result || typeof result.text !== 'string') return result;
  return { ...result, text: XN_STYLE(result.text) };
};
const style = (title, result, icon='💗') => `${icon} ${bold(title)} — 👤 ${mention(result?.target || '')}\n📊 ${bold(String(result?.text ?? result))} 🌸`;

const roasts = [
'Tumhara dimaag loading mein rehta hai shayad.','Tumhari soch 2G internet se bhi slow hai.','Tum itne confuse rehte ho ke Google bhi answer na de.','Tumhari logic dekh kar calculator bhi hang ho jaye.','Tumhari personality airplane mode par hai.','Tumhare ideas expired biscuits jese hain.','Tumhari planning weather forecast jesi hai — kabhi sahi nahi.','Tum itne boring ho ke wallpaper bhi change ho jaye.','Tumhari baatein YouTube ads jesi hain — skip karne ka dil karta hai.','Tumhara dimaag software update ka wait kar raha hai.','Tumhari thinking buffering mein rehti hai.','Tumhara logic broken calculator jesa hai.'
];
const flirts = ['tumhari smile dekh kar lagta hai chand bhi jealous ho jaye.','tumhari vibe bohat hi dangerous cute hai.','tum online aate ho to lagta hai wifi bhi fast ho gaya.','tumhari baat karte karte waqt ka pata hi nahi chalta.','lagta hai tumhari smile me koi secret magic hai.','tumhari vibe bilkul soft music jaisi hai.','tumhari smile addictive hai.','tumhari presence ek good morning jaisi fresh lagti hai.'];
const compliments = ['tumhari vibe bohat positive hai.','tumhari personality bohat classy hai.','tumhari smile full sunshine jaisi hai.','tumhari presence group ko lively bana deti hai.','tumhari thinking bohat unique hai.','tumhari kindness bohat rare hai.','tumhari baat me ek special charm hai.','tum sach me ek amazing insan ho.'];
const insults = ['tumhara dimaag lagta hai abhi loading screen par atka hua hai.','tumhari logic dekh kar calculator bhi confuse ho jata hai.','tum wo update ho jo kabhi install nahi hota.','tumhari soch wifi signal jaisi weak hai.','tumhara dimaag airplane mode par chal raha hai.','tumhari thinking buffering par chal rahi hai.'];
const eight = ['Yes, definitely! ✅','It is certain ✅','Without a doubt ✅','Most likely ✅','Outlook good ✅','Signs point to yes ✅','Reply hazy, try again 🔄','Ask again later 🔄','Cannot predict now 🔄','My reply is no ❌','Very doubtful ❌'];
const rps = ['Rock','Paper','Scissors'];

async function mediaBufferFromQuoted(msg) {
  const c = ctx(msg); const qm = c.quotedMessage; if (!qm) return null;
  const type = Object.keys(qm)[0]; if (!type) return null;
  const stream = await downloadContentFromMessage(qm[type], type.replace('Message','').toLowerCase());
  const chunks=[]; for await (const ch of stream) chunks.push(ch); return Buffer.concat(chunks);
}

async function _handleSourceCommand(command, args, { msg, sock, quotedContact, runtimeConfig }) {
  const chat = msg.key.remoteJid; const target = targetOf(msg); const user = mention(jidOf(msg)); const text = args.join(' ');

  if (CHECKS[command]) {
    const [emoji, name] = CHECKS[command]; const n=pct(); const level=n<25?'LOW 📉':n<50?'MEDIUM ➡️':n<75?'HIGH 📈':'EXTREME 🚀';
    return { text:`${emoji} ${bold(`${name} CHECK`)} — 👤 ${mention(target)}\n📊 ${bold(`${n}% • ${level}`)} 🌸`, mentions:[target] };
  }
  if (command==='readmore'||command==='textreadmore') {
    const more='\u200E'.repeat(4001); return { text:`${bold('📖 READ MORE')} — ${text.split('|')[0]||''}${more}${text.split('|').slice(1).join('|')||''} 🌸` };
  }
  if (command==='gali') {
    const lines=['💀 bkl habshi ki paidaawar 😈','🤡 salay tata madarchod randwe gando','💀 teri mkc bc laudy gando bsdk'];
    return {text:`😈 ${bold('GALI')} — 👤 ${mention(target)}\n💬 ${bold(pick(lines))} 🌸`,mentions:[target]};
  }
  if (command==='roast') return {text:`🔥 ${bold('ROAST')} — 👤 ${mention(target)}\n💬 ${bold(pick(roasts))} 🌸`,mentions:[target]};
  if (command==='flirt') return {text:`💗 ${bold('FLIRT')} — 👤 ${mention(target)}\n✨ ${bold(pick(flirts))} 🌸`,mentions:[target]};
  if (['compliment','tareef','respect','goodword'].includes(command)) return {text:`🌸 ${bold(command.toUpperCase())} — 👤 ${mention(target)}\n💗 ${bold(pick(compliments))} ✨`,mentions:[target]};
  if (command==='insult') return {text:`😈 ${bold('INSULT')} — 👤 ${mention(target)}\n💬 ${bold(pick(insults))} 🌸`,mentions:[target]};
  if (command==='hack') return {text:`☠️ ${bold('HACK PRANK')} — 👤 ${mention(target)}\n😂 ${bold('Just kidding! Entertainment prank only.')} 🌸`,mentions:[target]};
  if (command==='ship'||command==='couple') {
    if (!chat.endsWith('@g.us')) return {text:`💞 ${bold(command==='ship'?'SHIP MATCH':'COUPLE')} — 👤 ${user}\n⚠️ ${bold('Group only')} 🌸`};
    const metadata=await sock.groupMetadata(chat); const members=(metadata.participants||[]).filter(p=>!p.admin);
    if(members.length<2) return {text:`💞 ${bold(command==='ship'?'SHIP MATCH':'COUPLE')} — 👤 ${user}\n⚠️ ${bold('Not enough members')} 🌸`};
    const p1=pick(members), p2=pick(members.filter(x=>x.id!==p1.id)); const n=pct();
    return {text:`💞 ${bold(command==='ship'?'SHIP MATCH':'COUPLE')} — 👥 ${mention(p1.id)} × ${mention(p2.id)}\n💗 ${bold(`Compatibility : ${n}%`)} 🌸`,mentions:[p1.id,p2.id]};
  }
  if (command==='8ball') return {text:`🎱 ${bold('8BALL')} — 👤 ${user}\n🔮 ${bold(text ? pick(eight) : 'Ask a yes/no question!')} 🌸`};
  if (command==='coinflip'||command==='flip') return {text:`🪙 ${bold('COIN FLIP')} — 👤 ${user}\n🎲 ${bold(Math.random()<.5?'Heads':'Tails')} 🌸`};
  if (command==='dice'||command==='roll') return {text:`🎲 ${bold('DICE ROLL')} — 👤 ${user}\n🎯 ${bold(String(Math.floor(Math.random()*6)+1))} 🌸`};
  if (command==='rps') { const you=pick(rps), bot=pick(rps); const win=(you==='Rock'&&bot==='Scissors')||(you==='Paper'&&bot==='Rock')||(you==='Scissors'&&bot==='Paper'); return {text:`✊ ${bold('RPS')} — 👤 ${user}\n🏆 ${bold(`You: ${you} • Bot: ${bot} • ${you===bot?'Draw':win?'You Win':'Bot Wins'}`)} 🌸`}; }
  if (command==='slot') { const a=['🍒','🍋','7️⃣','💎','⭐']; const r=[pick(a),pick(a),pick(a)]; return {text:`🎰 ${bold('SLOT')} — 👤 ${user}\n🎯 ${bold(r.join(' | '))} 🌸`}; }
  if (command==='guess') { const n=Math.floor(Math.random()*100)+1; return {text:`🔢 ${bold('GUESS GAME')} — 👤 ${user}\n🎯 ${bold(`Number: ${n} • Try .guess <number>`)} 🌸`}; }
  if (command==='tictactoe'||command==='ttt') { global.__xNobitaTTT=global.__xNobitaTTT||new Map(); if(global.__xNobitaTTT.has(chat)) return {text:`🎮 ${bold('TIC TAC TOE')} — 👤 ${user}\n⚠️ ${bold('Game already active.')} 🌸`}; global.__xNobitaTTT.set(chat,{players:[jidOf(msg)],board:Array(9).fill(' '),turn:0}); return {text:`🎮 ${bold('TIC TAC TOE')} — 👤 ${user}\n📝 ${bold('Game started • another player reply with .ttt')} 🌸`}; }
  if (command==='surrender'||command==='giveup') { if(global.__xNobitaTTT?.has(chat)){global.__xNobitaTTT.delete(chat);return {text:`🏳️ ${bold('SURRENDER')} — 👤 ${user}\n💗 ${bold('Game ended.')} 🌸`};} return {text:`🏳️ ${bold('SURRENDER')} — 👤 ${user}\n⚠️ ${bold('No active game.')} 🌸`}; }
  if (command==='wcg'||command==='wordchain') { global.__xNobitaWC=global.__xNobitaWC||new Map(); const start=pick(['apple','elephant','tiger','robot','ocean','ninja','dragon','laptop']); global.__xNobitaWC.set(chat,{last:start,used:new Set([start]),players:{}}); return {text:`🔗 ${bold('WORD CHAIN')} — 👤 ${user}\n🔤 ${bold(`Starting word: ${start.toUpperCase()} • Next: ${start.slice(-1).toUpperCase()}`)} 🌸`}; }
  if (['laugh','shy','sad','moon','anger','happy','confused','heart','cool','fire','star','thumbsup'].includes(command)) { const map={laugh:'😂',shy:'😊',sad:'😢',moon:'🌙',anger:'😡',happy:'😊',confused:'😕',heart:'❤️',cool:'😎',fire:'🔥',star:'⭐',thumbsup:'👍'}; return {text:`${map[command]} ${bold(command.toUpperCase())} — 👤 ${user}\n✨ ${bold('Mood sent successfully')} 🌸`}; }
  if(command==='calc'||command==='calculate'){ if(!text)return {text:`🧮 ${bold('CALCULATOR')} — 👤 ${user}\n⚠️ ${bold('Use .calc 25*4+10')} 🌸`}; try{const safe=text.replace(/[^0-9+\-*/().% ]/g,''); const result=Function(`"use strict";return (${safe})`)(); return {text:`🧮 ${bold('CALCULATOR')} — 👤 ${user}\n✨ ${bold(`${text} = ${result}`)} 🌸`};}catch{return {text:`🧮 ${bold('CALCULATOR')} — 👤 ${user}\n❌ ${bold('Invalid expression')} 🌸`};} }
  if(command==='tovn'){return {text:`🎵 ${bold('TOVN')} — 👤 ${user}\n✨ ${bold('Reply to audio/video with .tovn')} 🌸`};}
  if(command==='read'){return {text:`👀 ${bold('READ')} — 👤 ${user}\n✨ ${bold('Message marked as read')} 🌸`, action:'read'};}

  if(command==='sticker'||command==='take'||command==='steal'||command==='wm'||command==='swm'||command==='takefull'||command==='toimg'||['bass','blown','deep','earrape','fast','fat','nightcore','reverse','robot','slow','smooth','squirrel'].includes(command)) {
    return {mediaCommand:command};
  }
  return null;
}

async function _handleMediaCommand(command,{msg,sock,quotedContact,args}){
  const chat=msg.key.remoteJid; const c=ctx(msg); const qm=c.quotedMessage; if(!qm) return {text:`🎬 ${bold(command.toUpperCase())} — 👤 ${mention(jidOf(msg))}\n⚠️ ${bold('Reply to the required media first.')} 🌸`};
  const type=Object.keys(qm)[0]; const mime=qm[type]?.mimetype||'';
  try{
    const media=await mediaBufferFromQuoted(msg); if(!media) throw new Error('media unavailable');
    if(command==='sticker'){
      if(!/image|video/.test(mime)) return {text:`🎨 ${bold('STICKER')} — 👤 ${mention(jidOf(msg))}\n⚠️ ${bold('Reply to an image/video.')} 🌸`};
      await sock.sendMessage(chat,{sticker:media},{quoted:quotedContact}); return {done:true};
    }
    if(['take','steal','wm','swm','takefull'].includes(command)){
      if(!/webp|sticker/.test(mime) && !qm.stickerMessage) return {text:`🏷️ ${bold(command.toUpperCase())} — 👤 ${mention(jidOf(msg))}\n⚠️ ${bold('Reply to a sticker.')} 🌸`};
      await sock.sendMessage(chat,{sticker:media},{quoted:quotedContact}); return {done:true};
    }
    if(command==='toimg'){
      const input=path.join(os.tmpdir(),`xnobita-${Date.now()}.webp`), output=path.join(os.tmpdir(),`xnobita-${Date.now()}.png`); fs.writeFileSync(input,media);
      await new Promise((resolve,reject)=>exec(`ffmpeg -y -i "${input}" "${output}"`,e=>e?reject(e):resolve())); const image=fs.readFileSync(output); await sock.sendMessage(chat,{image},{quoted:quotedContact}); fs.rmSync(input,{force:true});fs.rmSync(output,{force:true}); return {done:true};
    }
    const filters={bass:'equalizer=f=54:width_type=o:width=2:g=20',blown:'acrusher=.1:1:64:0:log',deep:'atempo=1,asetrate=29666',earrape:'volume=12',fast:'atempo=1.63,asetrate=44100',fat:'atempo=1.6,asetrate=22100',nightcore:'atempo=1.06,asetrate=55125',reverse:'areverse',robot:"afftfilt=real='hypot(re,im)*sin(0)':imag='hypot(re,im)*cos(0):win_size=512:overlap=0.75",slow:'atempo=0.7,asetrate=44100',smooth:'atempo=0.95',squirrel:'atempo=0.5,asetrate=65100'};
    if(filters[command]){const input=path.join(os.tmpdir(),`xnobita-${Date.now()}.mp3`),output=path.join(os.tmpdir(),`xnobita-${Date.now()}-out.mp3`);fs.writeFileSync(input,media);await new Promise((resolve,reject)=>exec(`ffmpeg -y -i "${input}" -af "${filters[command]}" "${output}"`,e=>e?reject(e):resolve()));const audio=fs.readFileSync(output);await sock.sendMessage(chat,{audio,mimetype:'audio/mpeg'},{quoted:quotedContact});fs.rmSync(input,{force:true});fs.rmSync(output,{force:true});return {done:true};}
  }catch(e){return {text:`❌ ${bold(command.toUpperCase())} — 👤 ${mention(jidOf(msg))}\n⚠️ ${bold(e.message||'Processing failed')} 🌸`};}
}
async function handleSourceCommand(command, args, context) {
  return styleXNResult(command, await _handleSourceCommand(command, args, context));
}

async function handleMediaCommand(command, context) {
  return styleXNResult(command, await _handleMediaCommand(command, context));
}

module.exports={handleSourceCommand,handleMediaCommand};
