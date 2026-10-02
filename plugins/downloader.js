const axios = require('axios');
const yts = require('yt-search');

const HEADERS = {
  Accept: 'application/json, text/plain, */*',
  'Content-Type': 'application/json',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36'
};

function extractVideoId(input) {
  const value = String(input || '').trim();
  const patterns = [
    /(?:youtu\.be\/)([A-Za-z0-9_-]{11})/i,
    /(?:youtube\.com\/watch\?v=)([A-Za-z0-9_-]{11})/i,
    /(?:youtube\.com\/shorts\/)([A-Za-z0-9_-]{11})/i,
    /(?:youtube\.com\/embed\/)([A-Za-z0-9_-]{11})/i,
    /^([A-Za-z0-9_-]{11})$/
  ];
  for (const pattern of patterns) {
    const match = value.match(pattern);
    if (match) return match[1];
  }
  return null;
}

function isYouTubeUrl(input) {
  return !!extractVideoId(input);
}

function toYouTubeUrl(id) {
  return `https://www.youtube.com/watch?v=${id}`;
}

async function searchYouTube(query) {
  const result = await yts(query);
  if (!result?.videos?.length) throw new Error('No songs found.');
  return result.videos[0];
}

async function retryRequest(fn, attempts = 2) {
  let lastError;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (i + 1 < attempts) await new Promise(resolve => setTimeout(resolve, 800 * (i + 1)));
    }
  }
  throw lastError;
}

// Miku source: ytmp3.gg -> convert1s polling
async function mikuYtMp3(youtubeUrl) {
  const cleanUrl = toYouTubeUrl(extractVideoId(youtubeUrl));
  const dmca = await axios.get('https://dmca.ytmp3.gg/api/check', {
    params: { url: cleanUrl }, headers: HEADERS, timeout: 30000
  });
  if (dmca.data?.blocked) throw new Error(dmca.data.message || 'Content blocked.');

  const convert = await axios.post(
    'https://ytdl.convert1s.com/api/v2/download',
    { url: cleanUrl, output: { type: 'audio', format: 'mp3', quality: '128kbps' } },
    { headers: HEADERS, timeout: 30000 }
  );

  const statusUrl = convert.data?.statusUrl;
  if (!statusUrl) throw new Error('Miku downloader returned no status URL.');

  for (let i = 0; i < 40; i++) {
    const status = await axios.get(statusUrl, { headers: HEADERS, timeout: 30000 });
    if (status.data?.status === 'completed' && status.data?.downloadUrl) {
      return { downloadUrl: status.data.downloadUrl, title: convert.data.title || status.data.title, source: 'Miku' };
    }
    if (status.data?.status === 'error') throw new Error('Miku conversion failed.');
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  throw new Error('Miku downloader timed out.');
}

// Knight source: EliteProTech -> Yupra -> Okatsu
async function knightElite(youtubeUrl) {
  const res = await axios.get(
    `https://eliteprotech-apis.zone.id/ytdown?url=${encodeURIComponent(youtubeUrl)}&format=mp3`,
    { ...HEADERS, timeout: 60000 }
  );
  if (res.data?.success && res.data?.downloadURL) {
    return { downloadUrl: res.data.downloadURL, title: res.data.title, source: 'Knight/EliteProTech' };
  }
  throw new Error('EliteProTech returned no download.');
}

async function knightYupra(youtubeUrl) {
  const res = await axios.get(
    `https://api.yupra.my.id/api/downloader/ytmp3?url=${encodeURIComponent(youtubeUrl)}`,
    { headers: HEADERS, timeout: 60000 }
  );
  if (res.data?.success && res.data?.data?.download_url) {
    return { downloadUrl: res.data.data.download_url, title: res.data.data.title, source: 'Knight/Yupra' };
  }
  throw new Error('Yupra returned no download.');
}

async function knightOkatsu(youtubeUrl) {
  const res = await axios.get(
    `https://okatsu-rolezapiiz.vercel.app/downloader/ytmp3?url=${encodeURIComponent(youtubeUrl)}`,
    { headers: HEADERS, timeout: 60000 }
  );
  if (res.data?.dl) {
    return { downloadUrl: res.data.dl, title: res.data.title, source: 'Knight/Okatsu' };
  }
  throw new Error('Okatsu returned no download.');
}

// Knight play.js source: Keith MD fallback
async function knightKeith(youtubeUrl) {
  const res = await axios.get(
    `https://apis-keith.vercel.app/download/dlmp3?url=${encodeURIComponent(youtubeUrl)}`,
    { headers: HEADERS, timeout: 60000 }
  );
  const data = res.data;
  const downloadUrl = data?.result?.downloadUrl;
  if (!data?.status || !downloadUrl) throw new Error('Keith downloader returned no download.');
  return { downloadUrl, title: data.result.title, source: 'Knight/Keith' };
}

async function downloadBuffer(url) {
  const response = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: 90000,
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
    decompress: true,
    validateStatus: status => status >= 200 && status < 400,
    headers: {
      'User-Agent': HEADERS['User-Agent'],
      Accept: '*/*',
      'Accept-Encoding': 'identity'
    }
  });
  const buffer = Buffer.from(response.data);
  if (!buffer.length) throw new Error('Downloaded audio is empty.');
  const contentType = String(response.headers?.['content-type'] || '').toLowerCase();
  if (contentType.includes('text/html') || contentType.includes('application/json')) {
    throw new Error('Downloader returned an invalid response.');
  }
  return { buffer, contentType };
}

function safeFileName(title) {
  return String(title || 'song').replace(/[\\/:*?"<>|\r\n]/g, '').trim().slice(0, 180) || 'song';
}

async function resolveDownload(youtubeUrl) {
  const methods = [
    ['Miku', mikuYtMp3],
    ['Knight/EliteProTech', knightElite],
    ['Knight/Yupra', knightYupra],
    ['Knight/Okatsu', knightOkatsu],
    ['Knight/Keith', knightKeith]
  ];
  const errors = [];
  for (const [name, method] of methods) {
    try {
      const result = await retryRequest(() => method(youtubeUrl), 2);
      const downloaded = await downloadBuffer(result.downloadUrl);
      return { ...result, ...downloaded };
    } catch (error) {
      errors.push(`${name}: ${error?.message || 'failed'}`);
      console.log(`⚠️ Downloader ${name} failed: ${error?.message || error}`);
    }
  }
  throw new Error('All Miku + Knight download sources failed.');
}

async function handlePlaySong(sock, msg, args, quotedContact) {
  const jid = msg.key.remoteJid;
  const input = args.join(' ').trim();
  if (!input) {
    await sock.sendMessage(jid, {
      text: `🥺💗 ᴜsᴀɢᴇ: .play <song name or YouTube URL>\n🌸 ᴇxᴀᴍᴘʟᴇ: .play Shape of You |`
    }, { quoted: quotedContact });
    return true;
  }

  let video;
  try {
    if (isYouTubeUrl(input)) {
      const id = extractVideoId(input);
      video = { url: toYouTubeUrl(id), title: 'YouTube Song', timestamp: 'N/A', thumbnail: null };
    } else {
      video = await searchYouTube(input);
    }

    await sock.sendMessage(jid, {
      text: `🔎💗 ᴅᴏᴡɴʟᴏᴀᴅɪɴɢ: ${video.title || input}\n⏳ ᴘʟᴇᴀsᴇ ᴡᴀɪᴛ... 🌸 |`
    }, { quoted: quotedContact });

    const result = await resolveDownload(video.url);
    const title = safeFileName(result.title || video.title || input);
    const mimetype = result.contentType?.includes('mp4') || result.contentType?.includes('m4a')
      ? 'audio/mp4'
      : 'audio/mpeg';

    await sock.sendMessage(jid, {
      audio: result.buffer,
      mimetype,
      fileName: `${title}.mp3`,
      ptt: false
    }, { quoted: quotedContact });
    return true;
  } catch (error) {
    console.error(`[PLAY/SONG] ${error?.message || error}`);
    await sock.sendMessage(jid, {
      text: `🥺💔 ᴅᴏᴡɴʟᴏᴀᴅ ғᴀɪʟᴇᴅ\n🌸 ᴘʟᴇᴀsᴇ ᴛʀʏ ᴀɢᴀɪɴ ʟᴀᴛᴇʀ |`
    }, { quoted: quotedContact });
    return true;
  }
}

module.exports = { handlePlaySong };
