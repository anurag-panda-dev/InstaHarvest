/**
 * InstaHarvest — profile grid (posts / reels) harvester.
 * Scrolls the rendered grid until it stops growing, collecting shortcodes,
 * thumbnails and media type. Virtualized-friendly: rows are captured as they
 * mount and deduped by shortcode.
 */
import * as S from '../selectors.js';
import { PATTERNS } from '../selectors.js';
import {
  text,
  largestSrcset,
  shortcodeFromHref,
  clickElement,
  pageScroller,
  atBottom
} from '../dom-utils.js';
import { humanPause, sleep } from '../pacing.js';

function tabsPacing(pacing) {
  return { min: pacing?.min ?? 700, max: pacing?.max ?? 1200 };
}

async function activateTab(tab, pacing) {
  const pattern = tab === 'reels' ? PATTERNS.reelsTab : PATTERNS.postsTab;
  const tabs = S.selectAll('tab');
  const target = tabs.find((el) => pattern.test(text(el)));
  if (!target) {
    if (tab === 'reels') S.reportBroken('tab', 'reels tab not found');
    return false;
  }
  const selected = target.getAttribute('aria-selected') === 'true';
  if (selected) return true;
  clickElement(target);
  await humanPause(tabsPacing(pacing).min, tabsPacing(pacing).max);

  const deadline = Date.now() + 7000;
  while (Date.now() < deadline) {
    const active = S.select('tabSelected');
    if (active && pattern.test(text(active))) return true;
    await sleep(300);
  }
  await sleep(600);
  return true;
}

async function waitForTabContent(tab, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const links = S.selectAll('gridLink');
    const relevant = links.filter((a) => {
      const sc = shortcodeFromHref(a.getAttribute('href'));
      if (!sc) return false;
      if (tab === 'reels') return /\/reel\//.test(a.getAttribute('href') || '');
      return true;
    });
    if (relevant.length) return true;
    await sleep(500);
  }
  return false;
}

function tileInfo(link) {
  const href = link.getAttribute('href') || '';
  const shortcode = shortcodeFromHref(href);
  if (!shortcode) return null;

  const img = S.select('gridImage', link);
  const video = S.select('gridVideo', link);
  const isReel = /\/reel\//.test(href);
  const isCarousel = Boolean(S.select('carouselIcon', link));

  const type = isReel ? 'reel' : isCarousel ? 'carousel' : video ? 'video' : 'image';
  const thumbnail = (img && largestSrcset(img)) || (video && (video.poster || '')) || '';

  return {
    shortcode,
    url: `https://www.instagram.com${isReel ? '/reel/' : '/p/'}${shortcode}/`,
    type,
    thumbnail,
    alt: img ? (img.getAttribute('alt') || '').slice(0, 300) : '',
    source: 'grid'
  };
}

function collectPosts(map, scope, tab) {
  const links = S.selectAll('gridLink', scope);
  for (const link of links) {
    if (S.closest('dialog', link)) continue;
    const href = link.getAttribute('href') || '';
    if (tab === 'reels' && !/\/reel\//.test(href)) continue;
    const info = tileInfo(link);
    if (!info) continue;
    if (!map.has(info.shortcode)) {
      map.set(info.shortcode, info);
    } else {
      const existing = map.get(info.shortcode);
      if (!existing.thumbnail && info.thumbnail) existing.thumbnail = info.thumbnail;
    }
  }
  return map;
}

export async function harvestGrid({
  tab = 'posts',
  maxPosts = 0,
  pacing = { min: 700, max: 1200 },
  onProgress = () => {},
  shouldAbort = () => false
} = {}) {
  if (tab === 'reels') {
    const switched = await activateTab(tab, pacing);
    if (switched) await waitForTabContent(tab, 12000);
  }

  const scroller = pageScroller();
  const map = new Map();
  collectPosts(map, document, tab);

  if (!map.size) {
    const main = S.select('main') || document.body;
    if (PATTERNS.noPosts.test(main ? main.innerText : '')) {
      onProgress({ count: 0, total: 0, message: 'This profile has no posts visible.' });
      return { posts: [], stopped: 'empty', rounds: 0, tab };
    }
    S.reportBroken('gridLink', `${tab} grid`);
    onProgress({ count: 0, total: 0, message: 'No grid links found — the selector may need an update.' });
    return { posts: [], stopped: 'no-grid', rounds: 0, tab };
  }

  onProgress({ count: map.size, total: maxPosts || null, message: 'Scrolling the grid…' });

  let stable = 0;
  let rounds = 0;
  let stopped = 'stable';
  const maxRounds = 250;

  while (true) {
    if (shouldAbort()) {
      stopped = 'aborted';
      break;
    }
    if (maxPosts && map.size >= maxPosts) {
      stopped = 'max';
      break;
    }
    if (rounds >= maxRounds) {
      stopped = 'max-rounds';
      break;
    }

    const before = map.size;
    const delta = Math.round((scroller === document.scrollingElement ? window.innerHeight : scroller.clientHeight) * 0.85);
    if (scroller === document.scrollingElement || scroller === document.documentElement) {
      window.scrollBy(0, delta);
    } else {
      scroller.scrollBy(0, delta);
    }

    await humanPause(pacing.min, pacing.max);
    collectPosts(map, document, tab);
    rounds++;

    if (map.size > before) stable = 0;
    else stable++;

    onProgress({
      count: map.size,
      total: maxPosts || null,
      rounds,
      message: stable > 0 ? 'Waiting for more tiles…' : 'Scrolling the grid…'
    });

    if (stable >= 4) {
      stopped = atBottom(scroller) ? 'bottom' : 'stable';
      break;
    }
  }

  const posts = Array.from(map.values()).slice(0, maxPosts || undefined);
  onProgress({ count: posts.length, total: posts.length, message: 'Grid collected.' });
  return { posts, stopped, rounds, tab };
}
