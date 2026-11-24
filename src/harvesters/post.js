/**
 * InstaHarvest — post detail harvester.
 *
 * Opens a post (modal click first, full-page navigation as fallback),
 * reads caption/counts/timestamp, walks every carousel slide, optionally
 * builds the comment tree, then closes the post view.
 */
import * as S from '../selectors.js';
import { PATTERNS } from '../selectors.js';
import {
  text,
  parseCount,
  mediaInfo,
  clickElement,
  visibleRect,
  intersectArea,
  isDisabled,
  shortcodeFromHref,
  usernameFromHref,
  absoluteUrl
} from '../dom-utils.js';
import { humanPause, sleep } from '../pacing.js';
import { harvestComments } from './comments.js';

function dialogShortcode() {
  const dlg = S.select('dialog');
  if (!dlg) return '';
  for (const link of S.selectAll('postPermalink', dlg)) {
    const sc = shortcodeFromHref(link.getAttribute('href'));
    if (sc) return sc;
  }
  return '';
}

function pageShortcode() {
  const match = location.pathname.match(/\/(?:p|reels?)\/([A-Za-z0-9_-]+)/);
  return match ? match[1] : '';
}

function currentPacing(pacing) {
  return { min: pacing?.min ?? 700, max: pacing?.max ?? 1200 };
}

async function waitForPostOpen(shortcode, timeoutMs = 9000) {
  const deadline = Date.now() + timeoutMs;
  let blindOpen = 0;
  while (Date.now() < deadline) {
    const dlgSc = dialogShortcode();
    if (dlgSc === shortcode) return { opened: true, standalone: false };
    if (dlgSc && dlgSc !== shortcode) return { opened: false, wrongPost: true };
    if (pageShortcode() === shortcode && !S.select('dialog')) {
      return { opened: true, standalone: true };
    }
    if (S.select('dialog') && !dlgSc) {
      blindOpen++;
      if (blindOpen >= 6) return { opened: true, standalone: false };
    }
    await sleep(350);
  }
  return { opened: false, standalone: false };
}

export async function openPost(shortcode, pacing) {
  if (!shortcode) throw new Error('Missing post shortcode.');

  if (dialogShortcode() === shortcode) return { opened: true, alreadyOpen: true, standalone: false };
  if (pageShortcode() === shortcode && !S.select('dialog')) {
    return { opened: true, alreadyOpen: true, standalone: true };
  }

  if (S.select('dialog')) {
    await closePost(pacing);
  }

  const links = S.selectAll('postPermalink');
  const target = links.find(
    (link) => !S.closest('dialog', link) && shortcodeFromHref(link.getAttribute('href')) === shortcode
  );

  if (target) {
    clickElement(target);
    const result = await waitForPostOpen(shortcode);
    if (result.opened) return result;
    if (result.wrongPost) throw new Error('Instagram opened a different post than expected. Close it and press Retry.');
    throw new Error('The post view did not open. The post may be unavailable (removed, private or region-locked).');
  }

  // Fallback: open the post as a full page. The worker will re-run this step
  // after the navigation completes.
  const targetUrl = absoluteUrl(`/p/${shortcode}/`);
  setTimeout(() => {
    location.assign(targetUrl);
  }, 80);
  return { navigating: true };
}

export async function closePost(pacing) {
  if (!S.select('dialog')) return true;
  const btn = S.select('dialogClose');
  if (btn) {
    clickElement(btn);
    const cfg = currentPacing(pacing);
    await humanPause(cfg.min, cfg.max);
    if (!S.select('dialog')) return true;
  }
  try {
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true })
    );
  } catch {
    /* ignore */
  }
  await humanPause(400, 700);
  if (!S.select('dialog')) return true;
  history.back();
  await sleep(1100);
  return !S.select('dialog');
}

function pickActiveMedia(scope) {
  const nodes = S.selectAll('carouselMedia', scope);
  let best = null;
  let bestScore = 0;
  const viewport = { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };

  for (const node of nodes) {
    const info = mediaInfo(node);
    if (!info || !info.url) continue;
    const rect = visibleRect(node);
    if (!rect) continue;
    if (rect.width < 150 || rect.height < 150) continue;

    const overlap = intersectArea(rect, viewport);
    if (!overlap) continue;

    const nearCenter = 1 - Math.min(
      1,
      Math.abs(rect.left + rect.width / 2 - window.innerWidth / 2) / window.innerWidth
    );
    const score = rect.width * rect.height * (0.6 + nearCenter * 0.4);
    if (score > bestScore) {
      bestScore = score;
      best = info;
    }
  }
  return best;
}

async function harvestCarousel(scope, pacing, onProgress) {
  const slides = [];
  const seen = new Set();
  const capture = () => {
    const media = pickActiveMedia(scope);
    if (media && media.url && !seen.has(media.url)) {
      seen.add(media.url);
      slides.push(media);
    }
    return media;
  };

  capture();
  let stagnant = 0;

  for (let index = 0; index < 20; index++) {
    const next = S.select('carouselNext', scope);
    if (!next || isDisabled(next)) break;

    const before = pickActiveMedia(scope);
    clickElement(next);
    await humanPause(pacing.min, pacing.max);
    const after = capture();
    onProgress({
      count: slides.length,
      message: `Captured slide ${slides.length}…`,
      phase: 'carousel'
    });

    if (before && after && before.url === after.url) {
      stagnant++;
      if (stagnant >= 2) break;
    } else {
      stagnant = 0;
    }
  }

  return slides;
}

function readDetail(scope, shortcode) {
  const links = S.selectAll('postPermalink', scope);
  const isReel = links.some((link) => /\/reel\//.test(link.getAttribute('href') || ''));

  let author = '';
  for (const link of S.selectAll('postAuthorLink', scope)) {
    const candidate = usernameFromHref(link.getAttribute('href'));
    if (candidate) {
      author = candidate;
      break;
    }
  }

  let caption = '';
  const headings = S.selectAll('postCaption', scope)
    .filter((el) => !S.closest('commentItem', el))
    .map((el) => text(el))
    .filter((t) => t && t.length <= 2400 && t.replace(/^@/, '') !== author);
  if (headings.length) {
    caption = headings.sort((a, b) => b.length - a.length)[0];
  }
  if (author && caption.toLowerCase().startsWith(author.toLowerCase() + ' ')) {
    caption = caption.slice(author.length + 1).trim();
  }

  let likeCount = null;
  let commentCount = null;
  let likedByOthers = null;

  for (const el of S.selectAll('postTextCandidates', scope)) {
    const t = text(el);
    if (!t || t.length > 90) continue;

    const likeMatch = t.match(PATTERNS.likesCount);
    if (likeMatch && likeCount == null) {
      const value = parseCount(likeMatch[1]);
      if (Number.isFinite(value)) likeCount = value;
    }

    const commentMatch = t.match(PATTERNS.commentsCount);
    if (commentMatch && commentCount == null) {
      const value = parseCount(commentMatch[1]);
      if (Number.isFinite(value)) commentCount = value;
    }

    const viewAll = t.match(PATTERNS.viewAllComments);
    if (viewAll && commentCount == null) {
      const value = parseCount(viewAll[1]);
      if (Number.isFinite(value)) commentCount = value;
    }

    const others = t.match(/and\s+([\d.,]+\s*[kmb]?)\s+others?/i);
    if (others && likedByOthers == null) {
      const value = parseCount(others[1]);
      if (Number.isFinite(value)) likedByOthers = value;
    }
  }

  let timestamp = '';
  const times = S.selectAll('postTime', scope);
  const permalinkTime = times.find((t) => S.closest('postPermalink', t));
  const timeEl = permalinkTime || times[0];
  if (timeEl) timestamp = timeEl.getAttribute('datetime') || text(timeEl);

  const hasNext = Boolean(S.select('carouselNext', scope));
  const mediaNow = pickActiveMedia(scope);
  const hasVideo = mediaNow ? mediaNow.type === 'video' : false;
  const type = isReel ? 'reel' : hasNext ? 'carousel' : hasVideo ? 'video' : 'image';

  return {
    shortcode,
    url: absoluteUrl(`${isReel ? '/reel/' : '/p/'}${shortcode}/`),
    author,
    caption,
    likeCount,
    commentCount,
    likedByOthers,
    timestamp,
    type,
    thumbnail: mediaNow ? mediaNow.url : '',
    scrapedAt: new Date().toISOString()
  };
}

export async function harvestPost({
  shortcode,
  includeCarousel = true,
  includeComments = false,
  maxComments = 300,
  pacing = { min: 700, max: 1200 },
  onProgress = () => {},
  shouldAbort = () => false
} = {}) {
  const pacingCfg = currentPacing(pacing);
  const opened = await openPost(shortcode, pacingCfg);
  if (opened.navigating) return { navigating: true, shortcode };

  const dialog = S.select('dialog');
  const standalone = !dialog;
  const scope = dialog || S.select('main') || document.body;

  onProgress({ count: 0, total: 1, message: 'Reading post details…', phase: 'detail' });
  const post = readDetail(scope, shortcode);

  if (includeCarousel) {
    post.carousel = await harvestCarousel(scope, pacingCfg, onProgress);
  } else if (post.thumbnail) {
    post.carousel = [{ type: post.type === 'video' || post.type === 'reel' ? 'video' : 'image', url: post.thumbnail }];
  }

  let comments = null;
  if (includeComments) {
    onProgress({ count: 0, total: maxComments, message: 'Opening comment threads…', phase: 'comments' });
    try {
      comments = await harvestComments({
        scope,
        shortcode,
        max: maxComments,
        pacing: pacingCfg,
        onProgress,
        shouldAbort
      });
    } catch (err) {
      comments = { tree: [], flat: [], truncated: false, warning: `Comments could not be read: ${err.message}` };
    }
  }

  if (!standalone) await closePost(pacingCfg);

  onProgress({ count: 1, total: 1, message: 'Post saved.', phase: 'detail' });
  return { post, comments, standalone };
}

export async function openPostForUser(shortcode, pacing) {
  const result = await openPost(shortcode, currentPacing(pacing));
  return result;
}
