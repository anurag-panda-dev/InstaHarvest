/**
 * InstaHarvest — the only file allowed to contain DOM selectors.
 *
 * Maintenance policy (see README):
 *  - ARIA roles, aria-* attributes, href patterns, visible text, structure only.
 *  - No obfuscated class names (e.g. ._aagv, .x1i10hfl) — they rotate.
 *  - Every entry lists fallbacks and a lastVerified date.
 *  - On total failure the content script emits SELECTOR_BROKEN with the name,
 *    so a developer can fix exactly one place.
 */

export const LAST_VERIFIED = '2026-11-24';

const def = (name, description, query, fallbacks = []) => ({
  name,
  description,
  query,
  fallbacks,
  lastVerified: LAST_VERIFIED
});

export const SELECTORS = {
  // ---------- session & page ----------
  loginLink: def(
    'loginLink',
    'Login link (present when signed out)',
    'a[href*="/accounts/login"]',
    ['a[href*="/accounts/login/"]', 'form[action*="login"]']
  ),
  sessionNav: def(
    'sessionNav',
    'Navigation markers for a signed-in session',
    'nav a[href="/"], nav a[href^="/direct/"], a[href="/direct/inbox/"]',
    ['nav[aria-label="Primary"]', 'a[aria-label="Home" i]', 'a[aria-label="Direct" i]', 'nav[role="navigation"]']
  ),
  main: def('main', 'Main content region', 'main', ['div[role="main"]', 'body']),
  anyDiv: def('anyDiv', 'Generic div, used to find the dialog scroll container', 'div'),
  anyButton: def('anyButton', 'Buttons inside the page', 'button, [role="button"]'),

  // ---------- profile header ----------
  profileHeader: def('profileHeader', 'Profile header block', 'header', [
    'main header',
    'main > div > header',
    'main section'
  ]),
  profileAvatar: def('profileAvatar', 'Profile avatar image', 'header img[alt*="profile picture" i]', [
    'header img[srcset]',
    'main img[alt*="profile" i]'
  ]),
  profileUsername: def('profileUsername', 'Profile username heading', 'header h2', [
    'header h1',
    'main h1'
  ]),
  profileBioSpans: def('profileBioSpans', 'Header spans that may hold name/bio text', 'header span[dir="auto"]', [
    'header span'
  ]),
  verifiedBadge: def(
    'verifiedBadge',
    'Verified badge',
    'header svg[aria-label*="Verified" i], header [aria-label*="Verified" i]'
  ),
  externalLink: def(
    'externalLink',
    'External link in bio',
    'header a[href^="http"]:not([href*="instagram.com"])',
    ['header a[rel~="nofollow"]', 'header a[href^="https://l.instagram.com"]']
  ),
  statsLabel: def('statsLabel', 'Follower/following/post stat labels', 'header span', [
    'header div',
    'main span'
  ]),
  followersLink: def('followersLink', 'Link that opens the followers list', 'header a[href$="/followers/"]', [
    'header a[href*="/followers"]',
    'a[href*="/followers"]',
    'a[href="/followers/"]'
  ]),
  followingLink: def('followingLink', 'Link that opens the following list', 'header a[href$="/following/"]', [
    'header a[href*="/following"]',
    'a[href*="/following"]',
    'a[href="/following/"]'
  ]),
  metaTitle: def('metaTitle', 'og:title meta tag', 'meta[property="og:title"]', [
    'meta[name="twitter:title"]'
  ]),
  metaDescription: def('metaDescription', 'og:description meta tag', 'meta[property="og:description"]', [
    'meta[name="description"]'
  ]),
  metaImage: def('metaImage', 'og:image meta tag', 'meta[property="og:image"]'),

  // ---------- grid ----------
  gridLink: def(
    'gridLink',
    'Links to individual posts/reels in the profile grid',
    'main a[href*="/p/"], main a[href*="/reel/"], main a[href*="/reels/"]',
    [
      'article a[href*="/p/"], article a[href*="/reel/"], article a[href*="/reels/"]',
      'a[href*="/p/"]',
      'a[href*="/reel/"]',
      'a[href*="/reels/"]'
    ]
  ),
  gridImage: def('gridImage', 'Thumbnail image inside a grid tile', 'img[srcset], img[src]'),
  gridVideo: def('gridVideo', 'Video inside a grid tile', 'video'),
  carouselIcon: def(
    'carouselIcon',
    'Carousel indicator icon on a grid tile',
    'svg[aria-label*="Carousel" i], svg[aria-label*="Sidecar" i], [aria-label*="Carousel" i]'
  ),
  tab: def('tab', 'Profile tabs (Posts / Reels / Tagged)', '[role="tab"]', ['a[role="tab"]']),
  tabSelected: def('tabSelected', 'Currently selected profile tab', '[role="tab"][aria-selected="true"]'),
  pageEnd: def('pageEnd', 'Generic end-of-feed sentinel', 'div[role="progressbar"]'),

  // ---------- dialogs / virtualized lists ----------
  dialog: def('dialog', 'Open modal dialog', 'div[role="dialog"]', ['[role="dialog"]']),
  anyHref: def('anyHref', 'Any anchor carrying an href', 'a[href]'),
  sourceTag: def('sourceTag', 'Media <source> element', 'source'),
  scrollDescendants: def(
    'scrollDescendants',
    'Elements that may scroll inside a list region',
    'div, ul, section'
  ),
  pageScrollCandidates: def(
    'pageScrollCandidates',
    'Page-level containers that may own the scrollbar',
    'main, main div, body > div'
  ),
  listItem: def('listItem', 'List item inside a comment/reply list', 'li'),
  nestedLists: def('nestedLists', 'Nested reply list', 'ul'),
  postArticle: def('postArticle', 'Article container of a post view', 'article'),
  dialogClose: def(
    'dialogClose',
    'Close button of a dialog',
    '[role="dialog"] [aria-label="Close" i], [role="dialog"] button[aria-label*="close" i]',
    ['[role="dialog"] svg[aria-label*="close" i]', 'button[aria-label="Close" i]']
  ),
  dialogHeading: def('dialogHeading', 'Dialog heading', '[role="dialog"] h1, [role="dialog"] h2'),
  listRowLink: def('listRowLink', 'Rows inside a followers/following/likers dialog', '[role="dialog"] a[href^="/"]', [
    '[role="dialog"] a'
  ]),
  listRowImage: def('listRowImage', 'Avatar inside a list row', 'img'),
  listRowText: def('listRowText', 'Text spans inside a list row', 'span'),
  rowVerified: def('rowVerified', 'Verified badge inside a list row', 'svg[aria-label*="Verified" i], [aria-label*="Verified" i]'),
  scrollCandidate: def('scrollCandidate', 'Elements that may be the dialog scroll container', 'div'),

  // ---------- post view ----------
  postAuthorLink: def(
    'postAuthorLink',
    'Author link in a post view',
    '[role="dialog"] header a[href^="/"], article header a[href^="/"]',
    ['[role="dialog"] a[href^="/"]', 'article a[href^="/"]']
  ),
  postTime: def('postTime', 'Post timestamp', 'time[datetime]'),
  postPermalink: def('postPermalink', 'Permalink links for posts/reels', 'a[href^="/p/"], a[href^="/reel/"]'),
  postCaption: def('postCaption', 'Caption element in a post view', '[role="dialog"] h1, article h1', [
    '[role="dialog"] div[dir="auto"]',
    'article div[dir="auto"]'
  ]),
  postTextCandidates: def(
    'postTextCandidates',
    'Text elements in a post view used for like/comment counts',
    '[role="dialog"] a[href*="liked_by"], [role="dialog"] span, [role="dialog"] div[dir="auto"], article span'
  ),
  likesLink: def(
    'likesLink',
    'Link that opens the likers list',
    '[role="dialog"] a[href*="liked_by"], article a[href*="liked_by"]',
    ['[role="dialog"] a[href*="/liked_by/"]']
  ),
  carouselNext: def(
    'carouselNext',
    'Carousel next button',
    '[role="dialog"] button[aria-label="Next" i], [role="dialog"] [aria-label="Next" i]',
    ['[role="dialog"] button[aria-label*="next" i]', 'button[aria-label*="next" i]']
  ),
  carouselPrev: def(
    'carouselPrev',
    'Carousel previous button',
    '[role="dialog"] button[aria-label="Previous" i], [role="dialog"] [aria-label="Previous" i]',
    ['[role="dialog"] button[aria-label*="prev" i]']
  ),
  carouselMedia: def(
    'carouselMedia',
    'Images/videos inside the post media area',
    '[role="dialog"] img[srcset], [role="dialog"] img[src], [role="dialog"] video',
    ['article img[srcset]', 'article video']
  ),
  postMediaImg: def('postMediaImg', 'Post images', 'img[srcset], img[src]'),
  postMediaVideo: def('postMediaVideo', 'Post videos', 'video'),

  // ---------- comments ----------
  commentList: def('commentList', 'Comment list container', '[role="dialog"] ul, article ul', ['ul']),
  commentItem: def('commentItem', 'Comment list item', 'li'),
  commentAuthor: def('commentAuthor', 'Comment author profile link', 'a[href^="/"]'),
  commentText: def('commentText', 'Comment text span', 'span[dir="auto"]'),
  commentTime: def('commentTime', 'Comment timestamp', 'time[datetime]'),
  commentAction: def(
    'commentAction',
    'Buttons/role=button elements inside comments',
    '[role="dialog"] button, [role="dialog"] [role="button"], [role="dialog"] span[role="button"]',
    ['article button', 'ul li span']
  ),

  // ---------- likers ----------
  likersHeading: def('likersHeading', 'Heading of the likers dialog', '[role="dialog"] h1, [role="dialog"] h2'),
  anyTextCandidate: def(
    'anyTextCandidate',
    'Text-bearing elements used for label matching',
    'button, [role="button"], a, span, div, li, h1, h2, h3'
  )
};

export const TEXT_CANDIDATE_SELECTOR = SELECTORS.anyTextCandidate.query;

export const PATTERNS = {
  followers: /^followers$/i,
  following: /^following$/i,
  posts: /^posts$/i,
  loadMoreComments: /^(load|view)\s+more\s+comments?$/i,
  viewAllComments: /^view\s+all\s+([\d.,]+\s*[kmb]?)\s*comments?$/i,
  viewReplies: /^view\s+(all\s+)?(\d+\s+)?repl(y|ies)(\s*\(\d+\))?$/i,
  viewMoreReplies: /^view\s+(more\s+)?repl(y|ies)(\s*\(\d+\))?$/i,
  hideReplies: /^hide\s+repl(y|ies)$/i,
  likesCount: /^([\d.,]+\s*[kmb]?)\s+likes?$/i,
  commentsCount: /^([\d.,]+\s*[kmb]?)\s+comments?$/i,
  likedByOthers: /and\s+[\d.,]+\s*others?/i,
  likedBy: /liked\s+by/i,
  reelsTab: /^reels?$/i,
  postsTab: /^posts?$/i,
  taggedTab: /^tagged$/i,
  noPosts: /no posts yet/i,
  close: /^close$/i,
  next: /^next$/i,
  prev: /^previous$/i,
  follow: /^follow$/i,
  followingBtn: /^following$/i,
  likes: /likes?$/i
};

// ---- broken-selector reporting ----

let reporter = () => {};
const misses = new Map();

export function onSelectorBroken(fn) {
  reporter = typeof fn === 'function' ? fn : () => {};
}

export function getSelectorMisses() {
  return Array.from(misses.entries()).map(([name, count]) => ({ name, count }));
}

export function clearSelectorMisses() {
  misses.clear();
}

function noteMiss(name, context) {
  const key = context ? `${name} (${context})` : name;
  misses.set(key, (misses.get(key) || 0) + 1);
  return null;
}

export function reportBroken(name, context = '') {
  const sel = SELECTORS[name];
  if (!sel) return;
  reporter({
    selector: name,
    description: sel.description,
    query: sel.query,
    fallbacks: sel.fallbacks,
    lastVerified: sel.lastVerified,
    context,
    url: typeof location !== 'undefined' ? location.href : ''
  });
}

// ---- resolution helpers ----

function queryOne(selector, root) {
  try {
    return root.querySelector(selector);
  } catch {
    return null;
  }
}

function queryAll(selector, root) {
  try {
    return Array.from(root.querySelectorAll(selector));
  } catch {
    return [];
  }
}

/**
 * First matching element using primary query then fallbacks.
 */
export function select(name, root = document) {
  const entry = SELECTORS[name];
  if (!entry) return null;
  const direct = queryOne(entry.query, root);
  if (direct) return direct;
  for (const fb of entry.fallbacks) {
    const el = queryOne(fb, root);
    if (el) return el;
  }
  return noteMiss(name);
}

/**
 * All elements for primary query; if empty, first fallback that matches.
 */
export function selectAll(name, root = document) {
  const entry = SELECTORS[name];
  if (!entry) return [];
  const direct = queryAll(entry.query, root);
  if (direct.length) return direct;
  for (const fb of entry.fallbacks) {
    const list = queryAll(fb, root);
    if (list.length) return list;
  }
  return [];
}

/**
 * Test a single element against a named selector (and its fallbacks).
 */
export function matches(name, el) {
  const entry = SELECTORS[name];
  if (!entry || !el || !el.matches) return false;
  if (el.matches(entry.query)) return true;
  for (const fb of entry.fallbacks) {
    if (el.matches(fb)) return true;
  }
  return false;
}

/**
 * Last matching element — for stacked dialogs where the newest is topmost.
 */
export function selectLast(name, root = document) {
  const list = selectAll(name, root);
  return list.length ? list[list.length - 1] : null;
}

/**
 * Resolve a required element and report a broken selector when missing.
 */
export function requireEl(name, root = document, context = '') {
  const el = select(name, root);
  if (!el) reportBroken(name, context);
  return el;
}

/**
 * Find a visible element whose trimmed text matches `pattern`.
 */
export function findText(root, pattern, options = {}) {
  const {
    selector = TEXT_CANDIDATE_SELECTOR,
    maxTextLength = 120,
    requireVisible = true,
    within = null
  } = options;
  const scope = within || root;
  if (!scope) return null;
  for (const el of queryAll(selector, scope)) {
    if (el.children.length > 2) continue;
    const t = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
    if (!t || t.length > maxTextLength) continue;
    if (!pattern.test(t)) continue;
    if (requireVisible) {
      const rect = el.getBoundingClientRect();
      if (!rect.width || !rect.height) continue;
    }
    return el;
  }
  return null;
}

/**
 * Find all visible elements matching a text pattern.
 */
export function findAllText(root, pattern, options = {}) {
  const {
    selector = TEXT_CANDIDATE_SELECTOR,
    maxTextLength = 120,
    requireVisible = true
  } = options;
  const out = [];
  for (const el of queryAll(selector, root)) {
    const t = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
    if (!t || t.length > maxTextLength) continue;
    if (!pattern.test(t)) continue;
    if (requireVisible) {
      const rect = el.getBoundingClientRect();
      if (!rect.width || !rect.height) continue;
    }
    out.push(el);
  }
  return out;
}

/**
 * closest() by selector name (keeps selector strings in this file only).
 */
export function closest(name, el) {
  const entry = SELECTORS[name];
  if (!entry || !el || !el.closest) return null;
  const direct = el.closest(entry.query);
  if (direct) return direct;
  for (const fb of entry.fallbacks) {
    const found = el.closest(fb);
    if (found) return found;
  }
  return null;
}

export function metaContent(name) {
  const el = select(name);
  return el ? (el.getAttribute('content') || '').trim() : '';
}
