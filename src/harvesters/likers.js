/**
 * InstaHarvest — likers (user-paced Confirm flow).
 *
 * We never auto-open a likers modal. The user opens the post, clicks the
 * "N others" link, then presses Confirm; we verify the dialog and reuse the
 * shared virtualized-list harvester.
 */
import * as S from '../selectors.js';
import { text, usernameFromHref } from '../dom-utils.js';
import { harvestVirtualList } from './list.js';

function countRows(dlg) {
  const seen = new Set();
  for (const link of S.selectAll('listRowLink', dlg)) {
    const username = usernameFromHref(link.getAttribute('href'));
    if (username) seen.add(username);
  }
  return seen.size;
}

/**
 * Lists can be nested inside a post dialog. The topmost dialog is the last
 * one in document order, and is the only one worth classifying/harvesting.
 */
function topDialog() {
  return S.selectLast('dialog');
}

function classifyDialog(dlg) {
  if (!dlg) return '';
  const heading = text(S.select('likersHeading', dlg)).toLowerCase();
  if (/^followers/.test(heading)) return 'followers';
  if (/^following/.test(heading)) return 'following';
  if (/^likes?\b/.test(heading)) return 'likers';

  const body = text(dlg).slice(0, 600).toLowerCase();
  if (/liked by/.test(body) && !S.select('postArticle', dlg)) return 'likers';
  return '';
}

export function checkDialogOpen(resource = 'likers') {
  const dlg = topDialog();
  if (!dlg) return { open: false, reason: 'no-dialog', kind: '', count: 0 };
  const kind = classifyDialog(dlg);
  const open = kind === resource;
  return {
    open,
    kind,
    reason: open ? null : kind ? `wrong-dialog:${kind}` : 'unrecognized-dialog',
    count: open ? countRows(dlg) : 0
  };
}

export async function harvestLikers({
  maxItems = 200,
  pacing = { min: 700, max: 1200 },
  onProgress = () => {},
  shouldAbort = () => false
} = {}) {
  const status = checkDialogOpen('likers');
  if (!status.open) {
    if (status.kind) {
      throw new Error(`That looks like the ${status.kind} list, not the likers list. Open “N others” under the post likes, then press Confirm again.`);
    }
    throw new Error('The likers list is not open. Open the post, click “N others” under the likes, then press Confirm.');
  }

  return harvestVirtualList({
    dialog: topDialog(),
    maxItems,
    maxRounds: 80,
    stableRounds: 4,
    pacing,
    onProgress,
    shouldAbort
  });
}
