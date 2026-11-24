/**
 * InstaHarvest — shared virtualized-list harvester.
 *
 * One implementation, reused for followers, following and likers:
 *  - MutationObserver captures rows as they mount (lists are virtualized)
 *  - gentle scroll-by, randomized pause, stable-round termination
 *  - dedupe via Map keyed by username
 */
import * as S from '../selectors.js';
import {
  text,
  largestSrcset,
  usernameFromHref,
  absoluteUrl,
  findScrollable,
  clickElement,
  atBottom
} from '../dom-utils.js';
import { humanPause } from '../pacing.js';

const SKIP_NAME = /^(follow|following|remove|verified|follow back|message)$/i;
const COUNT_ONLY = /^[\d.,]+\s*[kmb]?$/i;

function extractRow(link) {
  const username = usernameFromHref(link.getAttribute('href'));
  if (!username) return null;
  const img = S.select('listRowImage', link);
  const avatar = img ? largestSrcset(img) : '';
  if (!img) return null; // rows always carry an avatar; avoids stray links

  const spans = S.selectAll('listRowText', link)
    .map((el) => text(el))
    .filter((t) => t && t.length < 200);

  const nameParts = spans.filter((t) => {
    if (t.replace(/^@/, '') === username) return false;
    if (SKIP_NAME.test(t)) return false;
    if (COUNT_ONLY.test(t)) return false;
    return true;
  });

  const fullName = nameParts.sort((a, b) => b.length - a.length)[0] || '';
  const verified = Boolean(S.select('rowVerified', link));

  return {
    username,
    fullName,
    avatar,
    verified,
    profileUrl: absoluteUrl(`/${username}/`)
  };
}

function mergeRow(map, row) {
  if (!row) return false;
  const existing = map.get(row.username);
  if (!existing) {
    map.set(row.username, row);
    return true;
  }
  let changed = false;
  if (row.fullName && row.fullName.length > (existing.fullName || '').length) {
    existing.fullName = row.fullName;
    changed = true;
  }
  if (row.avatar && !existing.avatar) {
    existing.avatar = row.avatar;
    changed = true;
  }
  if (row.verified && !existing.verified) {
    existing.verified = true;
    changed = true;
  }
  return changed;
}

export async function harvestVirtualList({
  dialog,
  maxItems = 0,
  maxRounds = 90,
  stableRounds = 4,
  pacing = { min: 700, max: 1200 },
  onProgress = () => {},
  shouldAbort = () => false
} = {}) {
  const dlg = dialog || S.select('dialog');
  if (!dlg) {
    throw new Error('No list dialog is open. Open it on Instagram, then press Confirm.');
  }

  const map = new Map();
  const harvestRows = () => {
    const links = S.selectAll('listRowLink', dlg);
    let grown = false;
    for (const link of links) {
      const row = extractRow(link);
      if (mergeRow(map, row)) grown = true;
    }
    return grown;
  };

  const observer = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (node.nodeType !== 1) continue;
        const links = S.matches('anyHref', node) ? [node] : S.selectAll('anyHref', node);
        for (const link of links) mergeRow(map, extractRow(link));
      }
    }
    harvestRows();
  });
  observer.observe(dlg, { childList: true, subtree: true });

  harvestRows();
  onProgress({ count: map.size, total: maxItems || null, message: 'Capturing rows as they mount…' });

  const scroller = findScrollable(dlg);
  let stable = 0;
  let rounds = 0;
  let stopped = 'stable';

  while (true) {
    if (shouldAbort()) {
      stopped = 'aborted';
      break;
    }
    if (!dlg.isConnected) {
      stopped = 'closed';
      break;
    }
    if (maxItems && map.size >= maxItems) {
      stopped = 'max';
      break;
    }
    if (rounds >= maxRounds) {
      stopped = 'max-rounds';
      break;
    }

    const before = map.size;
    const target = scroller || dlg;
    const delta = Math.round(((target.clientHeight || window.innerHeight) * 0.9));
    if (target === document.scrollingElement || target === document.documentElement) {
      window.scrollBy(0, delta);
    } else if (typeof target.scrollBy === 'function') {
      target.scrollBy(0, delta);
    } else {
      target.scrollTop += delta;
    }

    await humanPause(pacing.min, pacing.max);
    harvestRows();
    rounds++;

    if (map.size > before) stable = 0;
    else stable++;

    onProgress({
      count: map.size,
      total: maxItems || null,
      rounds,
      message: stable ? 'Checking for more rows…' : 'Scrolling the list…'
    });

    if (stable >= stableRounds) {
      stopped = atBottom(target) ? 'bottom' : 'stable';
      break;
    }
  }

  observer.disconnect();
  const users = Array.from(map.values()).slice(0, maxItems || undefined);
  onProgress({ count: users.length, total: users.length, message: 'List captured.' });
  return { users, stopped, rounds, count: users.length };
}

export async function openListDialog(resource, pacing = { min: 700, max: 1200 }) {
  const selName = resource === 'following' ? 'followingLink' : 'followersLink';
  const link = S.select(selName);
  if (!link) {
    S.reportBroken(selName, 'openListDialog');
    throw new Error(`Could not find the ${resource} link on this profile. Open the list manually, then press Confirm.`);
  }
  clickElement(link);
  await humanPause(pacing.min, pacing.max);

  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (S.select('dialog')) return true;
    await humanPause(400, 700);
  }
  return Boolean(S.select('dialog'));
}

export function harvestFollowList(resource, options = {}) {
  return harvestVirtualList({ ...options, dialog: S.selectLast('dialog') });
}
