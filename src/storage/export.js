/**
 * InstaHarvest — JSON + CSV export (built in the panel from IndexedDB).
 */
import * as db from './db.js';
import { VERSION } from './schema.js';

function flattenComments(shortcode, nodes, parentId = null, out = []) {
  for (const node of nodes || []) {
    out.push({
      shortcode,
      id: node.id,
      parent_id: parentId || '',
      depth: node.depth ?? 0,
      author: node.author?.username || '',
      full_name: node.author?.fullName || '',
      avatar: node.author?.avatar || '',
      text: node.text || '',
      timestamp: node.timestamp || ''
    });
    if (node.children?.length) flattenComments(shortcode, node.children, node.id, out);
  }
  return out;
}

export async function buildBundle(profileUsername) {
  if (!profileUsername) throw new Error('No profile selected yet.');

  const [profile, followers, following, posts, comments, likers] = await Promise.all([
    db.get('profiles', profileUsername),
    db.get('followers', profileUsername),
    db.get('following', profileUsername),
    db.getAllBy('posts', 'byProfile', profileUsername),
    db.getAllBy('comments', 'byProfile', profileUsername),
    db.getAllBy('likers', 'byProfile', profileUsername)
  ]);

  const commentsBy = new Map(comments.map((row) => [row.shortcode, row]));
  const likersBy = new Map(likers.map((row) => [row.shortcode, row]));

  const postsOut = posts
    .slice()
    .sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || '')))
    .map((post) => {
      const commentRow = commentsBy.get(post.shortcode);
      const likerRow = likersBy.get(post.shortcode);
      return {
        shortcode: post.shortcode,
        url: post.url || `https://www.instagram.com/p/${post.shortcode}/`,
        type: post.type || 'image',
        caption: post.caption || '',
        author: post.author || '',
        likeCount: post.likeCount ?? null,
        commentCount: post.commentCount ?? null,
        timestamp: post.timestamp || '',
        thumbnail: post.thumbnail || '',
        carousel: post.carousel || [],
        scrapedAt: post.scrapedAt || '',
        comments: commentRow ? { tree: commentRow.tree || [], truncated: !!commentRow.truncated } : null,
        likers: likerRow ? { users: likerRow.users || [], done: !!likerRow.done } : null
      };
    });

  const commentTotal = comments.reduce((sum, row) => sum + (row.flat?.length || 0), 0);
  const likersTotal = likers.reduce((sum, row) => sum + (row.users?.length || 0), 0);

  return {
    generator: 'InstaHarvest',
    version: VERSION,
    exportedAt: new Date().toISOString(),
    profileUsername,
    profile: profile
      ? {
          username: profile.details?.username || profileUsername,
          fullName: profile.details?.fullName || '',
          bio: profile.details?.bio || '',
          profilePic: profile.details?.profilePic || '',
          counts: profile.details?.counts || profile.counts || {},
          verified: Boolean(profile.details?.verified),
          externalLink: profile.details?.externalLink || '',
          category: profile.details?.category || '',
          sourceUrl: profile.details?.sourceUrl || '',
          scrapedAt: profile.scrapedAt || ''
        }
      : { username: profileUsername },
    counts: {
      followers: followers?.users?.length || 0,
      following: following?.users?.length || 0,
      posts: postsOut.length,
      comments: commentTotal,
      likers: likersTotal
    },
    followers: followers?.users || [],
    following: following?.users || [],
    posts: postsOut
  };
}

export function bundleToJson(bundle) {
  return JSON.stringify(bundle, null, 2);
}

const CSV_HEADERS = {
  followers: ['username', 'full_name', 'avatar', 'verified', 'profile_url'],
  following: ['username', 'full_name', 'avatar', 'verified', 'profile_url'],
  posts: [
    'shortcode',
    'url',
    'type',
    'author',
    'caption',
    'like_count',
    'comment_count',
    'timestamp',
    'thumbnail',
    'carousel_items'
  ],
  comments: ['shortcode', 'id', 'parent_id', 'depth', 'author', 'full_name', 'avatar', 'text', 'timestamp'],
  likers: ['shortcode', 'username', 'full_name', 'avatar', 'profile_url']
};

export function csvEscape(value) {
  if (value == null) return '';
  const text = String(value);
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function toCsv(headers, rows) {
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map((key) => csvEscape(row[key])).join(','));
  }
  return lines.join('\r\n');
}

export function buildCsvFiles(bundle) {
  const users = (list) =>
    (list || []).map((user) => ({
      username: user.username || '',
      full_name: user.fullName || '',
      avatar: user.avatar || '',
      verified: user.verified ? 'true' : 'false',
      profile_url: user.profileUrl || `https://www.instagram.com/${user.username || ''}/`
    }));

  const posts = (bundle.posts || []).map((post) => ({
    shortcode: post.shortcode,
    url: post.url,
    type: post.type,
    author: post.author,
    caption: post.caption,
    like_count: post.likeCount ?? '',
    comment_count: post.commentCount ?? '',
    timestamp: post.timestamp,
    thumbnail: post.thumbnail,
    carousel_items: (post.carousel || []).map((item) => item.url).join(' | ')
  }));

  const comments = [];
  for (const post of bundle.posts || []) {
    if (!post.comments?.tree) continue;
    for (const row of flattenComments(post.shortcode, post.comments.tree)) comments.push(row);
  }

  const likers = [];
  for (const post of bundle.posts || []) {
    for (const user of post.likers?.users || []) {
      likers.push({
        shortcode: post.shortcode,
        username: user.username || '',
        full_name: user.fullName || '',
        avatar: user.avatar || '',
        profile_url: user.profileUrl || `https://www.instagram.com/${user.username || ''}/`
      });
    }
  }

  const files = [];
  const push = (name, key, rows) => {
    if (!rows.length) return;
    files.push({ name, content: toCsv(CSV_HEADERS[key], rows) });
  };

  push('followers.csv', 'followers', users(bundle.followers));
  push('following.csv', 'following', users(bundle.following));
  push('posts.csv', 'posts', posts);
  push('comments.csv', 'comments', comments);
  push('likers.csv', 'likers', likers);

  return files;
}

export function timestampSlug(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

export function downloadText(filename, text, mime = 'application/json') {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

function sanitizeUsername(username) {
  return String(username || 'profile').replace(/[^A-Za-z0-9._-]/g, '_').replace(/^[._-]+|[._-]+$/g, '') || 'profile';
}

export function postMediaFilename(username, post, index = 1) {
  const date = new Date(post?.timestamp || post?.scrapedAt || '');
  const valid = Number.isFinite(date.getTime());
  const pad = (n) => String(n).padStart(2, '0');
  const datePart = valid
    ? `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
    : 'undated';
  const timePart = valid
    ? `${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}`
    : '000000';
  const suffix = index > 1 ? `_${index}` : '';
  return `${sanitizeUsername(username)}-${datePart}-${timePart}${suffix}`;
}

function extensionFor(item, blob) {
  const type = blob?.type || '';
  if (item?.type === 'video' || type.startsWith('video/')) return 'mp4';
  return 'png';
}

async function imageBlobToPng(blob) {
  if (typeof createImageBitmap !== 'function') return blob;
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d');
    if (!context) return blob;
    context.drawImage(bitmap, 0, 0);
    return await new Promise((resolve) => {
      canvas.toBlob((png) => resolve(png || blob), 'image/png');
    });
  } finally {
    bitmap.close();
  }
}

function crc32(bytes) {
  let crc = -1;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
  }
  return (crc ^ -1) >>> 0;
}

function dosDateTime(date = new Date()) {
  const year = Math.max(1980, date.getFullYear());
  const dosDate = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  return { dosDate, dosTime };
}

function concatBytes(parts) {
  const size = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function createZip(entries) {
  const encoder = new TextEncoder();
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name);
    const data = entry.data instanceof Uint8Array ? entry.data : encoder.encode(String(entry.data));
    const crc = crc32(data);
    const { dosDate, dosTime } = dosDateTime(entry.date);

    const local = new Uint8Array(30);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true);
    lv.setUint16(8, 0, true);
    lv.setUint16(10, dosTime, true);
    lv.setUint16(12, dosDate, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true);
    localParts.push(local, nameBytes, data);

    const central = new Uint8Array(46);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, dosTime, true);
    cv.setUint16(14, dosDate, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint16(30, 0, true);
    cv.setUint16(32, 0, true);
    cv.setUint16(34, 0, true);
    cv.setUint16(36, 0, true);
    cv.setUint32(38, 0, true);
    cv.setUint32(42, offset, true);
    centralParts.push(central, nameBytes);

    offset += 30 + nameBytes.length + data.length;
  }

  const centralData = concatBytes(centralParts);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralData.length, true);
  ev.setUint32(16, offset, true);
  ev.setUint16(20, 0, true);

  return new Blob([concatBytes([...localParts, centralData, end])], { type: 'application/zip' });
}

export async function exportPostImagesZip(profileUsername, onProgress = () => {}) {
  const bundle = await buildBundle(profileUsername);
  const stamp = timestampSlug();
  const entries = [];

  const media = [];
  for (const post of bundle.posts || []) {
    if (post.type === 'video' || post.type === 'reel') continue;
    let items = post.carousel?.length ? post.carousel : [];
    if (!items.length && post.thumbnail && post.type !== 'video' && post.type !== 'reel') {
      items = [{ type: post.type || 'image', url: post.thumbnail }];
    }
    if (!items.length && post.shortcode) {
      const permalink = post.url || `https://www.instagram.com/p/${post.shortcode}/`;
      items = [{ type: 'image', url: `${permalink.replace(/\/$/, '')}/media/?size=l` }];
    }
    let itemIndex = 0;
    for (const item of items) {
      if (item?.type === 'video' || item?.type === 'reel') continue;
      if (item?.url) {
        itemIndex++;
        media.push({ post, item, index: itemIndex });
      }
    }
  }

  let downloaded = 0;
  let mediaSucceeded = 0;
  let failedCount = 0;
  const failures = [];
  for (let i = 0; i < media.length; i++) {
    const { post, item, index } = media[i];
    try {
      const response = await fetch(item.url, { credentials: 'omit' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      const png = await imageBlobToPng(blob);
      const bytes = new Uint8Array(await png.arrayBuffer());
      const baseName = postMediaFilename(profileUsername, post, index);
      entries.push({ name: `${baseName}.png`, data: bytes, date: new Date(post.timestamp || post.scrapedAt || Date.now()) });
      mediaSucceeded++;
    } catch (error) {
      failedCount++;
      failures.push({
        shortcode: post.shortcode || '',
        url: item.url || '',
        error: error?.message || String(error)
      });
    }
    downloaded++;
    onProgress(downloaded, media.length);
  }

  const zip = createZip(entries);
  const name = `instaharvest_${profileUsername}_${stamp}_posts.zip`;
  const url = URL.createObjectURL(zip);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);

  return {
    name,
    bundle,
    candidateCount: media.length,
    mediaCount: mediaSucceeded,
    failedCount,
    failures
  };
}

export const exportZip = exportPostImagesZip;

function encoderForZip(text) {
  return new TextEncoder().encode(text);
}

export async function exportJson(profileUsername) {
  const bundle = await buildBundle(profileUsername);
  const name = `instaharvest_${profileUsername}_${timestampSlug()}.json`;
  downloadText(name, bundleToJson(bundle), 'application/json');
  return { name, bundle };
}

export async function exportCsv(profileUsername) {
  const bundle = await buildBundle(profileUsername);
  const files = buildCsvFiles(bundle);
  const stamp = timestampSlug();
  const names = [];
  for (const file of files) {
    const name = `instaharvest_${profileUsername}_${stamp}_${file.name}`;
    downloadText(name, file.content, 'text/csv');
    names.push(name);
    await new Promise((resolve) => setTimeout(resolve, 350));
  }
  return { names, bundle };
}
