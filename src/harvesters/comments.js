/**
 * InstaHarvest — comment thread builder.
 *
 * Steps: expand "Load more comments" (bounded), click every "View N replies"
 * (bounded), then walk the nested <ul>/<li> structure into a tree.
 */
import * as S from '../selectors.js';
import { PATTERNS } from '../selectors.js';
import {
  text,
  clickElement,
  largestSrcset,
  usernameFromHref,
  hashId,
  nodeTextWithout
} from '../dom-utils.js';
import { humanPause } from '../pacing.js';

const SKIP_TEXT = /^(reply|replies|view\s+.*repl(y|ies).*|hide replies|liked by .*|[\d.,]+\s*[kmb]?\s*likes?|[\d.,]+\s*[kmb]?)$/i;

async function clickLoadMore({ scope, max, pacing, shouldAbort, onProgress }) {
  let clicks = 0;
  for (let round = 0; round < 25; round++) {
    if (shouldAbort()) break;
    const button = S.findText(scope, PATTERNS.loadMoreComments, { maxTextLength: 60 });
    if (!button) break;
    clickElement(button);
    clicks++;
    await humanPause(pacing.min, pacing.max);
    onProgress({ message: 'Loading more comments…', phase: 'load-more' });
    if (clicks >= 25) break;
  }
  return clicks;
}

async function expandReplies({ scope, pacing, shouldAbort, onProgress, maxClicks = 250 }) {
  let clicks = 0;
  for (let round = 0; round < 14; round++) {
    if (shouldAbort()) break;
    const buttons = Array.from(
      new Set([
        ...S.findAllText(scope, PATTERNS.viewReplies, { maxTextLength: 40 }),
        ...S.findAllText(scope, PATTERNS.viewMoreReplies, { maxTextLength: 40 })
      ])
    );
    if (!buttons.length) break;

    for (const button of buttons) {
      if (shouldAbort()) break;
      if (clicks >= maxClicks) break;
      clickElement(button);
      clicks++;
      await humanPause(pacing.min, pacing.max);
    }
    onProgress({ message: `Expanded ${clicks} reply threads…`, phase: 'replies' });
    await humanPause(pacing.min, pacing.max);
  }
  return clicks;
}

function findRootList(scope) {
  const lists = S.selectAll('commentList', scope);
  for (const list of lists) {
    if (list.tagName !== 'UL') continue;
    if (S.closest('commentItem', list)) continue; // nested reply list
    if (!S.select('listItem', list)) continue;
    return list;
  }
  return null;
}

function commentText(li, author) {
  const spans = S.selectAll('commentText', li)
    .map((el) => text(el))
    .filter(Boolean);

  const candidates = spans.filter((t) => {
    if (t.replace(/^@/, '') === author) return false;
    if (SKIP_TEXT.test(t)) return false;
    if (t.length > 2200) return false;
    return true;
  });

  if (candidates.length) return candidates.sort((a, b) => b.length - a.length)[0];

  const fallback = nodeTextWithout(li, [S.select('commentAuthor', li), S.select('commentTime', li)]);
  if (fallback && fallback.length <= 2200 && !SKIP_TEXT.test(fallback)) return fallback;
  return '';
}

function parseComment(li, { depth, parentId, shortcode, index }) {
  const authorLink = S.select('commentAuthor', li);
  const author = usernameFromHref(authorLink ? authorLink.getAttribute('href') : '') || '';
  const timeEl = S.select('commentTime', li);
  const content = commentText(li, author);
  const avatarEl = S.select('listRowImage', li);
  const avatar = avatarEl ? largestSrcset(avatarEl) : '';

  if (!author && !content) return null;

  const timestamp = timeEl ? timeEl.getAttribute('datetime') || text(timeEl) : '';
  const id = hashId(shortcode, depth, index, author, timestamp, content.slice(0, 80));

  return {
    id,
    parentId: parentId || null,
    depth,
    author: {
      username: author,
      fullName: '',
      avatar,
      profileUrl: author ? `https://www.instagram.com/${author}/` : ''
    },
    text: content,
    timestamp
  };
}

function childLists(li) {
  const lists = [];
  for (const el of S.selectAll('nestedLists', li)) {
    if (S.closest('commentItem', el) === li) lists.push(el);
  }
  return lists;
}

export async function harvestComments({
  scope,
  shortcode = '',
  max = 300,
  pacing = { min: 700, max: 1200 },
  onProgress = () => {},
  shouldAbort = () => false
} = {}) {
  if (!scope) return { tree: [], flat: [], truncated: false };

  await clickLoadMore({ scope, max, pacing, shouldAbort, onProgress });
  await expandReplies({ scope, pacing, shouldAbort, onProgress });

  const root = findRootList(scope);
  if (!root) {
    S.reportBroken('commentList', 'harvestComments');
    return { tree: [], flat: [], truncated: false, warning: 'No comment list found in this post view.' };
  }

  const flat = [];
  let truncated = false;

  const walk = (ul, depth, parentId) => {
    const items = Array.from(ul.children).filter((el) => el.tagName === 'LI');
    let index = 0;
    for (const li of items) {
      if (flat.length >= max) {
        truncated = true;
        return;
      }
      const node = parseComment(li, { depth, parentId, shortcode, index: index++ });
      if (!node) continue;
      flat.push(node);
      const replies = childLists(li);
      if (replies.length) {
        for (const replyList of replies) {
          walk(replyList, depth + 1, node.id);
        }
      }
      onProgress({ count: flat.length, total: max, message: 'Reading comment threads…', phase: 'comments' });
    }
  };

  walk(root, 0, null);

  // Build tree from flat list (children keyed by parentId).
  const byId = new Map(flat.map((node) => [node.id, { ...node, children: [] }]));
  const tree = [];
  for (const node of byId.values()) {
    if (node.parentId && byId.has(node.parentId)) {
      byId.get(node.parentId).children.push(node);
    } else {
      tree.push(node);
    }
  }

  return { tree, flat, truncated };
}
