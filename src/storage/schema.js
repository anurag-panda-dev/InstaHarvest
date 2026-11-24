/**
 * InstaHarvest — schema, defaults and presets.
 * Pure data + tiny pure helpers, shared by worker and panel.
 */
import { clamp } from '../pacing.js';

export const VERSION = '1.0.0';

export const RESOURCE_KEYS = ['profile', 'posts', 'reels', 'followers', 'following', 'comments', 'likers'];

export const DEFAULT_RESOURCES = {
  profile: true,
  posts: true,
  reels: false,
  followers: false,
  following: false,
  comments: false,
  likers: false,
  carousel: true
};

export const PRESETS = {
  quick: {
    id: 'quick',
    label: 'Quick',
    hint: 'Header + first 12 posts. Good first run.',
    resources: { ...DEFAULT_RESOURCES },
    caps: { maxPosts: 12 }
  },
  deep: {
    id: 'deep',
    label: 'Deep',
    hint: 'Everything: posts, reels, followers, following, comments, likers.',
    resources: {
      profile: true,
      posts: true,
      reels: true,
      followers: true,
      following: true,
      comments: true,
      likers: true,
      carousel: true
    },
    caps: { maxPosts: 0 }
  },
  custom: {
    id: 'custom',
    label: 'Custom',
    hint: 'Choose each resource and set your own caps.',
    resources: { ...DEFAULT_RESOURCES },
    caps: {}
  }
};

export const DEFAULT_SETTINGS = {
  preset: 'quick',
  theme: 'auto',
  pacing: { min: 700, max: 1200 },
  caps: {
    maxPosts: 12,
    maxFollowers: 2000,
    maxFollowing: 2000,
    maxLikersPerPost: 200,
    maxCommentsPerPost: 300
  },
  limits: {
    maxProfilesPerDay: 5,
    maxMinutesPerDay: 45,
    sessionWarnMinutes: 25
  },
  custom: {
    resources: { ...DEFAULT_RESOURCES }
  },
  lastUsername: ''
};

export function mergeSettings(saved) {
  const s = saved || {};
  return {
    ...DEFAULT_SETTINGS,
    ...s,
    pacing: { ...DEFAULT_SETTINGS.pacing, ...(s.pacing || {}) },
    caps: { ...DEFAULT_SETTINGS.caps, ...(s.caps || {}) },
    limits: { ...DEFAULT_SETTINGS.limits, ...(s.limits || {}) },
    custom: {
      ...DEFAULT_SETTINGS.custom,
      ...(s.custom || {}),
      resources: { ...DEFAULT_SETTINGS.custom.resources, ...((s.custom && s.custom.resources) || {}) }
    }
  };
}

/**
 * Build a frozen job config from settings + start overrides.
 */
export function buildConfig(settings, overrides = {}) {
  const merged = mergeSettings(settings);
  const presetId = overrides.preset || merged.preset || 'quick';
  const preset = PRESETS[presetId] || PRESETS.quick;

  const resources = {
    ...DEFAULT_RESOURCES,
    ...(presetId === 'custom' ? merged.custom.resources : preset.resources),
    ...(overrides.resources || {})
  };

  const caps = {
    ...merged.caps,
    ...(preset.caps || {}),
    ...(overrides.caps || {})
  };

  const pacing = {
    min: clamp(overrides.pacing?.min ?? merged.pacing.min, 700, 2000),
    max: clamp(overrides.pacing?.max ?? merged.pacing.max, 700, 2000)
  };
  if (pacing.max < pacing.min) pacing.max = pacing.min;

  return {
    preset: presetId,
    resources,
    caps: {
      maxPosts: Math.max(0, Number(caps.maxPosts) || 0),
      maxFollowers: Math.max(0, Number(caps.maxFollowers) || 0),
      maxFollowing: Math.max(0, Number(caps.maxFollowing) || 0),
      maxLikersPerPost: Math.max(0, Number(caps.maxLikersPerPost) || 0),
      maxCommentsPerPost: Math.max(0, Number(caps.maxCommentsPerPost) || 0)
    },
    pacing,
    limits: { ...merged.limits }
  };
}

const RESERVED_PATHS = new Set([
  'p', 'reel', 'reels', 'explore', 'direct', 'accounts', 'stories', 'about',
  'legal', 'api', 'developer', 'directory', 'challenge', 'emails', 'session'
]);

export function normalizeUsername(input) {
  if (!input) return '';
  let raw = String(input).trim();
  if (!raw) return '';
  raw = raw.split('?')[0].replace(/\/+$/, '');
  try {
    if (/^https?:\/\//i.test(raw)) raw = new URL(raw).pathname;
  } catch {
    /* leave as-is */
  }
  raw = raw.replace(/^\/+/, '').replace(/\/.*$/, '').replace(/^@/, '');
  if (!/^[A-Za-z0-9._]{1,40}$/.test(raw)) return '';
  if (RESERVED_PATHS.has(raw.toLowerCase())) return '';
  return raw;
}

export function profileUrl(username) {
  return `https://www.instagram.com/${encodeURIComponent(username)}/`;
}

export function isActiveJobState(state) {
  return ['running', 'waiting', 'paused'].includes(state);
}
