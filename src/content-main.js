/**
 * InstaHarvest — content script.
 *
 * The ONLY component that touches the DOM. Loads harvester modules lazily,
 * runs exactly one task at a time, streams progress to the worker and honors
 * ABORT between paced actions.
 */
import { MSG } from './messages.js';
import * as S from './selectors.js';

const MODULES = {
  session: 'src/harvesters/session.js',
  profile: 'src/harvesters/profile.js',
  grid: 'src/harvesters/grid.js',
  list: 'src/harvesters/list.js',
  post: 'src/harvesters/post.js',
  comments: 'src/harvesters/comments.js',
  likers: 'src/harvesters/likers.js'
};

const modules = {};
let busy = false;
let abortRequested = false;
let currentStepId = null;
let pacingCfg = { min: 700, max: 1200 };

function send(type, payload) {
  try {
    chrome.runtime.sendMessage({ type, payload }).catch(() => {});
  } catch {
    /* extension context invalidated */
  }
}

function progress(payload = {}) {
  send(MSG.PROGRESS, { ...payload, stepId: currentStepId });
}

function log(level, message, extra = {}) {
  send(MSG.LOG, { level, message, stepId: currentStepId, ...extra });
}

S.onSelectorBroken((info) => {
  send(MSG.SELECTOR_BROKEN, { ...info, stepId: currentStepId });
  log('warn', `Selector “${info.selector}” returned nothing (${info.description}).`);
});

async function load(name) {
  if (!modules[name]) {
    const path = MODULES[name];
    if (!path) throw new Error(`Unknown module: ${name}`);
    const url = chrome.runtime.getURL(path);
    modules[name] = await import(url);
  }
  return modules[name];
}

async function loadAll() {
  await Promise.all(Object.keys(MODULES).map((name) => load(name)));
  return modules;
}

function ensurePacing(payload) {
  if (payload && payload.pacing && Number.isFinite(payload.pacing.min)) {
    pacingCfg = {
      min: Math.max(700, Number(payload.pacing.min) || 700),
      max: Math.max(700, Number(payload.pacing.max) || 1200)
    };
  }
  return pacingCfg;
}

async function withTask(payload, fn) {
  if (busy) throw new Error('The content script is busy with another task.');
  abortRequested = false;
  busy = true;
  currentStepId = payload?.stepId || null;
  ensurePacing(payload);
  try {
    return await fn();
  } finally {
    busy = false;
    currentStepId = null;
  }
}

const shouldAbort = () => abortRequested;

async function handleTask(type, payload = {}) {
  const [session, profile, grid, list, post, likers] = await Promise.all([
    load('session'),
    load('profile'),
    load('grid'),
    load('list'),
    load('post'),
    load('likers')
  ]);

  switch (type) {
    case MSG.CHECK_SESSION:
      return session.checkSession();

    case MSG.HARVEST_PROFILE:
      return withTask(payload, () => profile.harvestProfile());

    case MSG.HARVEST_GRID:
      return withTask(payload, () =>
        grid.harvestGrid({
          tab: payload.tab || 'posts',
          maxPosts: Number(payload.maxPosts) || 0,
          pacing: pacingCfg,
          onProgress: progress,
          shouldAbort
        })
      );

    case MSG.CHECK_DIALOG:
      return likers.checkDialogOpen(payload.resource || 'likers');

    case MSG.HARVEST_LIST: {
      const resource = payload.resource || 'followers';
      if (resource === 'likers') {
        return withTask(payload, () =>
          likers.harvestLikers({
            maxItems: Number(payload.maxItems) || 0,
            pacing: pacingCfg,
            onProgress: progress,
            shouldAbort
          })
        );
      }
      return withTask(payload, async () => {
        const result = await list.harvestFollowList(resource, {
          maxItems: Number(payload.maxItems) || 0,
          pacing: pacingCfg,
          onProgress: progress,
          shouldAbort
        });
        if (result.stopped !== 'aborted') {
          try {
            await post.closePost(pacingCfg);
          } catch {
            /* non-fatal */
          }
        }
        return result;
      });
    }

    case MSG.HARVEST_POST:
      return withTask(payload, () =>
        post.harvestPost({
          shortcode: payload.shortcode,
          includeCarousel: payload.includeCarousel !== false,
          includeComments: Boolean(payload.includeComments),
          maxComments: Number(payload.maxComments) || 300,
          pacing: pacingCfg,
          onProgress: progress,
          shouldAbort
        })
      );

    case MSG.HARVEST_COMMENTS: {
      const comments = await load('comments');
      const opened = await post.openPost(payload.shortcode, pacingCfg);
      if (opened.navigating) return { navigating: true, shortcode: payload.shortcode };
      const scope = S.select('dialog') || S.select('main') || document.body;
      const result = await withTask(payload, () =>
        comments.harvestComments({
          scope,
          shortcode: payload.shortcode,
          max: Number(payload.maxComments) || 300,
          pacing: pacingCfg,
          onProgress: progress,
          shouldAbort
        })
      );
      await post.closePost(pacingCfg);
      return result;
    }

    case MSG.OPEN_LIST_UI: {
      const resource = payload.resource === 'following' ? 'following' : 'followers';
      const opened = await list.openListDialog(resource, pacingCfg);
      return { opened, status: likers.checkDialogOpen(resource) };
    }

    case MSG.OPEN_POST_UI: {
      const opened = await post.openPostForUser(payload.shortcode, pacingCfg);
      return opened;
    }

    case MSG.CLOSE_VIEWS: {
      for (let i = 0; i < 3; i++) {
        if (!S.select('dialog')) break;
        await post.closePost(pacingCfg);
      }
      return { dialogOpen: Boolean(S.select('dialog')) };
    }

    default:
      throw new Error(`Unknown message type: ${type}`);
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.type) return false;

  if (message.type === MSG.ABORT) {
    abortRequested = true;
    sendResponse({ ok: true, data: { aborting: true } });
    return false;
  }

  if (message.type === MSG.PING) {
    loadAll()
      .then(() => {
        sendResponse({
          ok: true,
          data: {
            url: location.href,
            dialogOpen: Boolean(S.select('dialog')),
            ready: true
          }
        });
      })
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (!handleableTypes.has(message.type)) return false;

  handleTask(message.type, message.payload || {})
    .then((data) => sendResponse({ ok: true, data }))
    .catch((err) => {
      const text = err?.message || String(err);
      log('error', text);
      sendResponse({ ok: false, error: text, stack: err?.stack || '' });
    });
  return true;
});

const handleableTypes = new Set([
  MSG.CHECK_SESSION,
  MSG.HARVEST_PROFILE,
  MSG.HARVEST_GRID,
  MSG.CHECK_DIALOG,
  MSG.HARVEST_LIST,
  MSG.HARVEST_POST,
  MSG.HARVEST_COMMENTS,
  MSG.OPEN_LIST_UI,
  MSG.OPEN_POST_UI,
  MSG.CLOSE_VIEWS
]);

// Warm the module cache and announce readiness (worker ignores if idle).
loadAll()
  .then(() => {
    send(MSG.READY, { url: location.href });
  })
  .catch((err) => log('error', `Content script failed to initialise: ${err.message}`));
