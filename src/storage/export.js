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
