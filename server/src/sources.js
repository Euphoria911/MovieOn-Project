import { bad, httpUrl } from './util.js';

/**
 * Video sources are either:
 *  - "file":  a direct MP4 / HLS (.m3u8) URL played by our own <video>/hls.js player, or
 *  - "embed": the OFFICIAL embed player of VK Video (iframe), for videos whose owner/licensor
 *             allows embedding and exported the embed code from VK ("Export" / "Copy embed code").
 *
 * We deliberately do NOT extract direct media URLs from VK pages: that circumvents the
 * platform's player and terms, and most "free movies" uploaded by users are unlicensed.
 */
export const EMBED_HOSTS = ['vkvideo.ru', 'vk.ru', 'vk.com'];

const stripHost = (h) => h.toLowerCase().replace(/^(www|m)\./, '');

export function isEmbedHost(url) {
  try {
    return EMBED_HOSTS.includes(stripHost(new URL(url).hostname));
  } catch {
    return false;
  }
}

/** 'embed' | 'file' for an already-stored URL. */
export function sourceKind(url) {
  if (!url || !isEmbedHost(url)) return 'file';
  try {
    return new URL(url).pathname === '/video_ext.php' ? 'embed' : 'file';
  } catch {
    return 'file';
  }
}

/**
 * Validate and normalise an admin-supplied source URL.
 * Returns { url, kind } or null when empty. Throws 400 for VK page links / malformed embeds.
 */
export function normalizeSource(value, name = 'videoUrl', opts = {}) {
  const url = httpUrl(value, name, opts);
  if (!url) return null;
  const u = new URL(url);
  if (!isEmbedHost(url)) return { url, kind: 'file' };

  if (u.protocol !== 'https:' || u.pathname !== '/video_ext.php') {
    throw bad(
      `${name}: this looks like a VK page link. Paste the official embed link instead ` +
      '(in VK open the video → Share/Export → copy the iframe src: ' +
      'https://vkvideo.ru/video_ext.php?oid=…&id=…&hash=…). Direct stream links are not extracted.',
    );
  }
  const oid = u.searchParams.get('oid');
  const id = u.searchParams.get('id');
  const hash = u.searchParams.get('hash');
  const hd = u.searchParams.get('hd');
  if (!/^-?\d{1,12}$/.test(oid ?? '') || !/^\d{1,12}$/.test(id ?? '')) {
    throw bad(`${name}: embed link must contain numeric oid and id`);
  }
  if (hash && !/^[a-f0-9]{8,64}$/i.test(hash)) throw bad(`${name}: embed hash is malformed`);
  if (hd && !/^[1-5]$/.test(hd)) throw bad(`${name}: hd must be 1–5`);

  // Rebuild from validated parts only (drops autoplay/js_api/etc. injected by third parties).
  const out = new URL('https://' + stripHost(u.hostname) + '/video_ext.php');
  out.searchParams.set('oid', oid);
  out.searchParams.set('id', id);
  if (hash) out.searchParams.set('hash', hash);
  if (hd) out.searchParams.set('hd', hd);
  return { url: out.toString(), kind: 'embed' };
}

/** Embedded third-party sources need a recorded licence/permission statement. */
export function requireRightsNote(kind, rightsNote, what = 'title') {
  if (kind === 'embed' && (rightsNote ?? '').trim().length < 3) {
    throw bad(
      `An embedded VK source requires a rights note on the ${what} ` +
      '(who owns/licenses the video and that embedding is permitted).',
    );
  }
}
