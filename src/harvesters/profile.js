/**
 * InstaHarvest — profile header harvester.
 * DOM-first with og: meta fallback (also DOM, lives in <head>).
 */
import * as S from '../selectors.js';
import { PATTERNS } from '../selectors.js';
import { text, parseCount, largestSrcset, isVisible } from '../dom-utils.js';

const SKIP_SPAN = /^(follow|following|message|subscribe|edit profile|view shop|contact|email|call|directions|see more|more|follow back)$/i;
const STAT_WORDS = /^(followers?|following|posts?)$/i;

function usernameFromPath() {
  const match = location.pathname.match(/^\/([A-Za-z0-9._]{1,40})\/?$/);
  if (!match) return '';
  return match[1];
}

function parseMeta() {
  const title = S.metaContent('metaTitle');
  const description = S.metaContent('metaDescription');
  const image = S.metaContent('metaImage');
  const out = { username: '', fullName: '', bio: '', counts: {}, profilePic: image };

  const nameMatch = title.match(/^(.*?)\s*\(@([A-Za-z0-9._]+)\)/);
  if (nameMatch) {
    out.fullName = nameMatch[1].trim();
    out.username = nameMatch[2];
  } else if (title) {
    const atMatch = title.match(/@([A-Za-z0-9._]+)/);
    if (atMatch) out.username = atMatch[1];
  }

  const followers = description.match(/([\d.,]+\s*[kmb]?)\s+followers?/i);
  const following = description.match(/([\d.,]+\s*[kmb]?)\s+following/i);
  const posts = description.match(/([\d.,]+\s*[kmb]?)\s+posts?/i);
  if (followers) out.counts.followers = parseCount(followers[1]);
  if (following) out.counts.following = parseCount(following[1]);
  if (posts) out.counts.posts = parseCount(posts[1]);

  const bioMatch = description.match(/[-–—]\s*(.*?)See Instagram photos/i);
  if (bioMatch && bioMatch[1]) out.bio = bioMatch[1].trim().replace(/^["“]|["”]$/g, '');

  return out;
}

function statFromAnchor(name) {
  const anchor = S.select(name);
  if (!anchor) return null;
  const value = parseCount(text(anchor));
  return Number.isFinite(value) ? value : null;
}

function readStat(header, labelPattern, labelWord) {
  const spans = S.selectAll('statsLabel', header);
  for (const el of spans) {
    const t = text(el);
    if (!t || t.length > 24) continue;
    if (!labelPattern.test(t)) continue;
    const candidates = [el.parentElement, el.parentElement?.parentElement, el.parentElement?.parentElement?.parentElement];
    for (const box of candidates) {
      if (!box) continue;
      const boxText = text(box);
      const match = boxText.match(new RegExp(`([\\d.,]+\\s*[kmb]?)\\s*${labelWord}`, 'i'));
      if (match) {
        const value = parseCount(match[1]);
        if (Number.isFinite(value)) return value;
      }
    }
  }
  return null;
}

function decodeExternal(href) {
  if (!href) return '';
  try {
    const url = new URL(href, location.origin);
    if (url.hostname.endsWith('l.instagram.com') || url.searchParams.has('u')) {
      const inner = url.searchParams.get('u');
      if (inner) return decodeURIComponent(inner);
    }
    return url.href;
  } catch {
    return href;
  }
}

function extractHeaderText(header, username, meta) {
  const spans = S.selectAll('profileBioSpans', header).filter((el) => {
    const t = text(el);
    if (!t || t.length > 600) return false;
    if (t.replace(/^@/, '') === username) return false;
    if (STAT_WORDS.test(t.replace(/[\d.,\s]/g, ''))) return false;
    if (SKIP_SPAN.test(t)) return false;
    return isVisible(el) || el.getAttribute('dir') === 'auto';
  });

  const unique = [];
  const seen = new Set();
  for (const el of spans) {
    const t = text(el);
    if (seen.has(t)) continue;
    seen.add(t);
    unique.push({
      el,
      text: t,
      weight: Number.parseInt(getComputedStyle(el).fontWeight, 10) || 400,
      size: Number.parseFloat(getComputedStyle(el).fontSize) || 14
    });
  }

  const usernameEl = S.select('profileUsername', header);
  let fullName = meta.fullName || '';
  if (!fullName) {
    const bold = unique
      .filter((s) => s.weight >= 600 && s.text.length <= 80 && s.text !== username)
      .sort((a, b) => b.size - a.size || b.text.length - a.text.length);
    if (bold.length) fullName = bold[0].text;
  }

  let category = '';
  if (usernameEl) {
    for (const s of unique) {
      if (s.text === fullName) continue;
      if (s.size > 15) continue;
      if (s.el.compareDocumentPosition(usernameEl) & Node.DOCUMENT_POSITION_FOLLOWING) {
        if (!/\n/.test(s.text) && s.text.length <= 40) {
          category = s.text;
          break;
        }
      }
    }
  }

  const remaining = unique.filter((s) => s.text !== fullName && s.text !== category);
  const bio = meta.bio || (remaining.length ? remaining.sort((a, b) => b.text.length - a.text.length)[0].text : '');

  return { fullName: fullName.trim(), bio: bio.trim(), category: category.trim() };
}

export function harvestProfile() {
  const meta = parseMeta();
  const header = S.select('profileHeader');
  const username = usernameFromPath() || meta.username;

  if (!header) {
    S.reportBroken('profileHeader', 'harvestProfile');
  }

  if (!username) {
    throw new Error('Could not identify the profile username. Open the profile page and try again.');
  }

  const details = {
    username,
    fullName: meta.fullName || '',
    bio: meta.bio || '',
    profilePic: meta.profilePic || '',
    counts: { ...meta.counts },
    verified: false,
    externalLink: '',
    category: '',
    sourceUrl: location.href,
    scrapedAt: new Date().toISOString()
  };

  if (header) {
    const textParts = extractHeaderText(header, username, meta);
    if (textParts.fullName) details.fullName = textParts.fullName;
    if (textParts.bio) details.bio = textParts.bio;
    if (textParts.category) details.category = textParts.category;

    const avatar = S.select('profileAvatar', header);
    if (avatar) {
      const url = largestSrcset(avatar);
      if (url) details.profilePic = url;
    }

    const verified = S.select('verifiedBadge', header);
    details.verified = Boolean(verified);

    const link = S.select('externalLink', header);
    if (link) details.externalLink = decodeExternal(link.getAttribute('href'));

    const followers =
      statFromAnchor('followersLink') ?? readStat(header, PATTERNS.followers, 'followers?');
    const following =
      statFromAnchor('followingLink') ?? readStat(header, PATTERNS.following, 'following');
    const posts = readStat(header, PATTERNS.posts, 'posts?');

    if (Number.isFinite(followers)) details.counts.followers = followers;
    if (Number.isFinite(following)) details.counts.following = following;
    if (Number.isFinite(posts)) details.counts.posts = posts;
  }

  if (!details.counts.followers && !details.counts.following && !details.counts.posts) {
    S.reportBroken('statsLabel', 'harvestProfile');
  }

  return details;
}
