/**
 * InstaHarvest — DOM utilities shared by harvesters.
 * Contains NO CSS selectors (those live in selectors.js); only DOM math,
 * media resolution and text parsing. Structural queries go through
 * `selectors.js` so every selector keeps a name, fallbacks and `lastVerified`.
 */
import * as S from './selectors.js';

export function text(el) {
  if (!el) return '';
  return (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
}

export function rawText(el) {
  if (!el) return '';
  return (el.textContent || '').trim();
}

export function parseCount(input) {
  if (input == null) return null;
  if (typeof input === 'number') return Number.isFinite(input) ? input : null;
  const raw = String(input).replace(/\u00a0/g, ' ').trim();
  const match = raw.match(/(\d[\d.,]*)\s*([kmb])?/i);
  if (!match) return null;
  const numPart = match[1];
  const suffix = (match[2] || '').toLowerCase();
  let value;
  if (suffix) {
    const normalized = numPart.replace(/,/g, '.');
    value = parseFloat(normalized);
    if (!Number.isFinite(value)) return null;
    const mult = suffix === 'k' ? 1e3 : suffix === 'm' ? 1e6 : 1e9;
    return Math.round(value * mult);
  }
  const cleaned = numPart.replace(/[.,](?=\d{3}\b)/g, '').replace(/,/g, '');
  value = parseFloat(cleaned);
  return Number.isFinite(value) ? Math.round(value) : null;
}

export function isVisible(el) {
  if (!el || !el.isConnected) return false;
  const rect = el.getBoundingClientRect();
  if (rect.width < 4 || rect.height < 4) return false;
  const style = getComputedStyle(el);
  if (style.visibility === 'hidden' || style.display === 'none') return false;
  return Number(style.opacity || '1') > 0.01;
}

export function visibleRect(el) {
  if (!el) return null;
  const rect = el.getBoundingClientRect();
  if (rect.width < 4 || rect.height < 4) return null;
  return rect;
}

export function intersectArea(a, b) {
  if (!a || !b) return 0;
  const x = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
  const y = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  return x * y;
}

export function absoluteUrl(path) {
  if (!path) return '';
  try {
    return new URL(path, location.origin).href;
  } catch {
    return path;
  }
}

export function largestSrcset(img) {
  if (!img) return '';
  const srcset = img.getAttribute('srcset') || img.getAttribute('data-srcset');
  if (srcset) {
    let best = null;
    let bestW = -1;
    for (const part of srcset.split(',')) {
      const bits = part.trim().split(/\s+/);
      if (!bits[0]) continue;
      const descriptor = bits[1] || '';
      let weight = 1;
      const wMatch = descriptor.match(/^(\d+)w$/);
      const xMatch = descriptor.match(/^([\d.]+)x$/);
      if (wMatch) weight = Number(wMatch[1]);
      else if (xMatch) weight = Number(xMatch[1]) * 1000;
      if (weight > bestW) {
        bestW = weight;
        best = bits[0];
      }
    }
    if (best) return absoluteUrl(best);
  }
  const src = img.currentSrc || img.getAttribute('src') || img.getAttribute('data-src');
  return src ? absoluteUrl(src) : '';
}

export function mediaInfo(el) {
  if (!el) return null;
  if (el.tagName === 'IMG') {
    const url = largestSrcset(el);
    if (!url) return null;
    return {
      type: 'image',
      url,
      width: el.naturalWidth || Math.round(el.getBoundingClientRect().width) || null,
      height: el.naturalHeight || Math.round(el.getBoundingClientRect().height) || null,
      alt: (el.getAttribute('alt') || '').slice(0, 300)
    };
  }
  if (el.tagName === 'VIDEO') {
    const url = el.poster || el.currentSrc || el.getAttribute('src') || '';
    const source = S.select('sourceTag', el);
    const finalUrl = url || (source && source.getAttribute('src')) || '';
    if (!finalUrl) return null;
    return {
      type: 'video',
      url: absoluteUrl(finalUrl),
      width: el.videoWidth || Math.round(el.getBoundingClientRect().width) || null,
      height: el.videoHeight || Math.round(el.getBoundingClientRect().height) || null,
      alt: ''
    };
  }
  return null;
}

const RESERVED_SEGMENTS = new Set([
  'p', 'reel', 'reels', 'explore', 'direct', 'accounts', 'stories', 'about',
  'legal', 'api', 'developer', 'directory', 'challenge', 'emails', 'session',
  'liked_by'
]);

/**
 * Extract a username from a profile-like href (`/user/`, `/user`).
 */
export function usernameFromHref(href) {
  if (!href) return '';
  let path = href;
  try {
    path = new URL(href, location.origin).pathname;
  } catch {
    /* keep */
  }
  const match = path.match(/^\/([A-Za-z0-9._]{1,40})\/?$/);
  if (!match) return '';
  const candidate = match[1];
  if (RESERVED_SEGMENTS.has(candidate.toLowerCase())) return '';
  return candidate;
}

export function shortcodeFromHref(href) {
  if (!href) return '';
  const match = String(href).match(/\/(?:p|reels?)\/([A-Za-z0-9_-]+)/);
  return match ? match[1] : '';
}

export function hashId(...parts) {
  const input = parts.map((p) => (p == null ? '' : String(p))).join('|');
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

export function clickElement(el) {
  if (!el) return false;
  try {
    el.scrollIntoView({ block: 'center', inline: 'center' });
  } catch {
    /* ignore */
  }
  try {
    el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true, view: window }));
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    return true;
  } catch {
    try {
      el.click();
      return true;
    } catch {
      return false;
    }
  }
}

export function isDisabled(el) {
  if (!el) return true;
  if (el.disabled) return true;
  if (el.getAttribute('aria-disabled') === 'true') return true;
  if (el.hasAttribute('data-disabled')) return true;
  const style = getComputedStyle(el);
  return Number(style.opacity || '1') < 0.2;
}

export function findScrollable(root) {
  if (!root) return null;
  const candidates = [];
  const nodes = [root, ...S.selectAll('scrollDescendants', root)];
  for (const node of nodes) {
    if (!node) continue;
    if (node.scrollHeight <= node.clientHeight + 8) continue;
    if (node === root) {
      candidates.push(node);
      continue;
    }
    const style = getComputedStyle(node);
    const overflowY = style.overflowY;
    const rect = node.getBoundingClientRect();
    if (rect.width > 80 && rect.height > 100 &&
        (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay' ||
         node.getAttribute('role') === 'dialog')) {
      candidates.push(node);
    }
  }
  if (!candidates.length) return root.scrollHeight > root.clientHeight + 8 ? root : null;
  candidates.sort((a, b) => b.scrollHeight - b.clientHeight - (a.scrollHeight - a.clientHeight));
  return candidates[0];
}

export function pageScroller() {
  const doc = document.scrollingElement || document.documentElement;
  if (doc && doc.scrollHeight > doc.clientHeight + 8) return doc;
  for (const el of S.selectAll('pageScrollCandidates')) {
    if (el.scrollHeight > el.clientHeight + 40) {
      const style = getComputedStyle(el);
      if (style.overflowY === 'auto' || style.overflowY === 'scroll' || style.overflowY === 'overlay') return el;
    }
  }
  return doc;
}

export function scrollBy(el, amount) {
  const target = el || pageScroller();
  if (!target) return;
  const top = target === document.scrollingElement || target === document.documentElement ? window.innerHeight * 0.85 : target.clientHeight * 0.9;
  const delta = Number.isFinite(amount) ? amount : Math.round(top);
  if (target === document.scrollingElement || target === document.documentElement) {
    window.scrollBy(0, delta);
  } else {
    target.scrollBy(0, delta);
  }
}

export function atBottom(el) {
  const target = el || pageScroller();
  if (!target) return true;
  if (target === document.scrollingElement || target === document.documentElement) {
    return window.scrollY + window.innerHeight >= target.scrollHeight - 80;
  }
  return target.scrollTop + target.clientHeight >= target.scrollHeight - 60;
}

export function directChildren(el, tagName) {
  if (!el) return [];
  return Array.from(el.children).filter((child) => !tagName || child.tagName === tagName.toUpperCase());
}

export function nodeTextWithout(el, excludeEls) {
  if (!el) return '';
  const exclude = new Set((excludeEls || []).filter(Boolean));
  let out = '';
  const walk = (node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      out += node.nodeValue + ' ';
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    if (exclude.has(node)) return;
    if (['BUTTON', 'TIME', 'SVG'].includes(node.tagName)) return;
    for (const child of node.childNodes) walk(child);
  };
  for (const child of el.childNodes) walk(child);
  return out.replace(/\s+/g, ' ').trim();
}
