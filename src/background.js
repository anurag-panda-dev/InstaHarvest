/**
 * InstaHarvest — service worker.
 *
 * Owns job state, step queue, caps, message routing and IndexedDB persistence.
 * Performs NO network calls. The panel is a thin view over `snapshot()`.
 */
import { MSG, ACTIVE_JOB_STATES } from './messages.js';
import * as db from './storage/db.js';
import { buildConfig, normalizeUsername, profileUrl, VERSION } from './storage/schema.js';
import { humanPause, sleep, nowIso, todayKey } from './pacing.js';

const MAX_LOG = 250;

const state = {
  settings: null,
  daily: null,
  job: null,
  tabId: null,
  running: false,
  booted: false,
  pendingConfirm: null,
  lastBroadcast: 0,
  lastProgressSave: 0,
  recentProfiles: []
};

class ControlError extends Error {
  constructor(kind) {
    super(kind);
    this.kind = kind;
  }
}

/** Elapsed active time only — paused/stopped idle time never counts. */
function activeMs(job) {
  if (!job) return 0;
  let ms = Number(job.activeMs) || 0;
  if (job.segmentStartedAt) {
    ms += Math.max(0, Date.now() - new Date(job.segmentStartedAt).getTime());
  }
  return ms;
}

function closeSegment(job) {
  if (!job) return;
  job.activeMs = activeMs(job);
  job.segmentStartedAt = '';
}

function openSegment(job) {
  if (job && !job.segmentStartedAt) job.segmentStartedAt = nowIso();
}

// ---------------------------------------------------------------- lifecycle

try {
  chrome.sidePanel?.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
} catch {
  /* older Chrome */
}

chrome.runtime.onInstalled.addListener(() => {
  try {
    chrome.sidePanel?.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  } catch {
    /* ignore */
  }
});

chrome.action?.onClicked?.addListener?.(async (tab) => {
  try {
    await chrome.sidePanel.open({ windowId: tab.windowId });
  } catch {
    /* panel already open or API unavailable */
  }
});

chrome.runtime.onStartup.addListener(() => {
  boot().catch(() => {});
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  try {
    await boot();
  } catch {
    return;
  }
  const job = state.job;
  if (!job || !ACTIVE_JOB_STATES.includes(job.state)) return;
  if (tabId !== state.tabId && tabId !== job.tabId) return;
  state.tabId = null;
  if (state.pendingConfirm) state.pendingConfirm.resolve('pause');
  state.pendingConfirm = null;
  job.state = 'paused';
  job.pausedAt = nowIso();
  job.pauseReason = 'The Instagram tab was closed.';
  job.confirm = null;
  closeSegment(job);
  for (const step of job.steps) {
    if (step.state === 'running' || step.state === 'waiting_for_user') step.state = 'pending';
  }
  log('warn', 'The Instagram tab was closed. Reopen instagram.com and press Resume.');
  await syncDailyMinutes({ force: true });
  await saveJob();
  broadcast(true);
});

async function boot() {
  if (state.booted) return state;
  state.settings = await db.getSettings();
  state.daily = await db.getDaily(todayKey());
  state.job = (await db.getActiveJob()) || (await db.getLatestJob());
  if (state.job) {
    state.job.steps = state.job.steps || [];
    state.job.confirmAck = state.job.confirmAck || {};
    state.job.selectorsBroken = state.job.selectorsBroken || {};
    state.job.log = state.job.log || [];
    if (!Array.isArray(state.job.gridShortcodes)) state.job.gridShortcodes = undefined;
  }
  await refreshRecentProfiles();
  state.booted = true;
  return state;
}

async function refreshRecentProfiles() {
  try {
    state.recentProfiles = (await db.getProfiles()).slice(0, 6);
  } catch {
    state.recentProfiles = [];
  }
}

async function refreshDaily() {
  state.daily = await db.getDaily(todayKey());
  return state.daily;
}

let dailySyncChain = Promise.resolve();

function syncDailyMinutes(options = {}) {
  const run = () => syncDailyMinutesNow(options);
  dailySyncChain = dailySyncChain.then(run, run);
  return dailySyncChain;
}

async function syncDailyMinutesNow({ force = false } = {}) {
  const job = state.job;
  if (!job) return;
  const elapsed = activeMs(job) / 60000;
  const accrued = job.minutesAccrued || 0;
  const delta = elapsed - accrued;
  if (!force && delta < 0.75) return;
  const daily = await db.getDaily(todayKey());
  daily.minutes = Number((daily.minutes + Math.max(0, delta)).toFixed(2));
  job.minutesAccrued = elapsed;
  state.daily = daily;
  await db.saveDaily(daily);
}

// ---------------------------------------------------------------- messages

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.type) return false;

  if (!isWorkerMessage(message.type)) {
    return false;
  }

  handleMessage(message, sender)
    .then((data) => sendResponse({ ok: true, data }))
    .catch((err) => sendResponse({ ok: false, error: err?.message || String(err) }));

  return true;
});

const WORKER_TYPES = new Set([
  MSG.GET_STATE,
  MSG.START_JOB,
  MSG.PAUSE,
  MSG.RESUME,
  MSG.STOP,
  MSG.CONFIRM,
  MSG.SKIP_STEP,
  MSG.OPEN_FOR_ME,
  MSG.SAVE_SETTINGS,
  MSG.CLEAR_LOG,
  MSG.RESET_JOB,
  MSG.RETRY_STEP,
  MSG.PROGRESS,
  MSG.LOG,
  MSG.SELECTOR_BROKEN,
  MSG.READY,
  MSG.SESSION_LOST
]);

function isWorkerMessage(type) {
  return WORKER_TYPES.has(type);
}

async function handleMessage(message, sender) {
  const { type, payload = {} } = message;

  switch (type) {
    case MSG.GET_STATE:
      await boot();
      await refreshRecentProfiles();
      maybeAutoResume();
      return snapshot();

    case MSG.START_JOB:
      return startJob(payload);

    case MSG.PAUSE:
      return pauseJob();

    case MSG.RESUME:
      return resumeJob();

    case MSG.STOP:
      return stopJob('Stopped by you');

    case MSG.RETRY_STEP:
      return retryStep(payload);

    case MSG.CONFIRM:
      return onConfirm(payload);

    case MSG.SKIP_STEP:
      return onSkip(payload);

    case MSG.OPEN_FOR_ME:
      return onOpenForMe();

    case MSG.CLEAR_LOG:
      if (state.job) {
        state.job.log = [];
        await saveJob();
        broadcast(true);
      }
      return snapshot();

    case MSG.RESET_JOB:
      return resetJob();

    case MSG.SAVE_SETTINGS:
      return saveSettings(payload);

    case MSG.PROGRESS:
      await onProgress(payload);
      return true;

    case MSG.LOG:
      await boot();
      if (payload?.message) log(payload.level || 'info', payload.message);
      return true;

    case MSG.SELECTOR_BROKEN:
      await boot();
      await onSelectorBroken(payload);
      return true;

    case MSG.READY:
      return true;

    case MSG.SESSION_LOST:
      await pauseJob('The Instagram session looked signed out, so the harvest paused.');
      return true;

    default:
      return null;
  }
}

// ---------------------------------------------------------------- broadcasting

function stepLabel(step) {
  if (!step) return 'Step';
  if (step.kind === 'profile') return 'Profile details';
  if (step.kind === 'grid') return step.tab === 'reels' ? 'Reels grid' : 'Posts grid';
  if (step.kind === 'list') return step.resource === 'followers' ? 'Followers' : 'Following';
  if (step.kind === 'post') return `Post ${step.shortcode}`;
  if (step.kind === 'likers') return `Likers for ${step.shortcode}`;
  return step.kind;
}

function snapshot() {
  const job = state.job;
  const elapsedMs = activeMs(job);
  const daily = state.daily ? { ...state.daily } : null;
  if (daily && job && ACTIVE_JOB_STATES.includes(job.state)) {
    const live = activeMs(job) / 60000;
    daily.effectiveMinutes = Number((daily.minutes + Math.max(0, live - (job.minutesAccrued || 0))).toFixed(1));
  }
  return {
    version: VERSION,
    job: job ? { ...job, elapsedMs } : null,
    settings: state.settings,
    daily,
    tabId: state.tabId,
    running: state.running,
    pendingConfirm: Boolean(state.pendingConfirm),
    recentProfiles: state.recentProfiles
  };
}

function broadcast(force = false) {
  const now = Date.now();
  if (!force && now - state.lastBroadcast < 220) return;
  state.lastBroadcast = now;
  chrome.runtime.sendMessage({ type: MSG.STATE, payload: snapshot() }).catch(() => {});
}

function log(level, message, extra = {}) {
  const job = state.job;
  if (!job) return;
  job.log = job.log || [];
  job.log.push({ ts: nowIso(), level, message, ...extra });
  if (job.log.length > MAX_LOG) job.log.splice(0, job.log.length - MAX_LOG);
  broadcast();
}

async function saveJob() {
  if (!state.job) return;
  state.job.updatedAt = nowIso();
  await db.put('jobs', state.job);
}

// ---------------------------------------------------------------- content bridge

function sendOnce(tabId, type, payload, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error('The Instagram tab did not respond in time.'));
    }, timeoutMs);

    try {
      chrome.tabs.sendMessage(tabId, { type, payload }, (response) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        const err = chrome.runtime.lastError;
        if (err) {
          reject(new Error(err.message));
          return;
        }
        if (!response) {
          reject(new Error('No response from the content script.'));
          return;
        }
        if (response.ok === false) {
          reject(new Error(response.error || 'The content script could not finish the task.'));
          return;
        }
        resolve(response.data);
      });
    } catch (err) {
      settled = true;
      clearTimeout(timer);
      reject(err);
    }
  });
}

async function ensureContent(tabId, { reload = false } = {}) {
  if (!tabId) throw new Error('No Instagram tab is attached.');
  try {
    return await sendOnce(tabId, MSG.PING, {}, 2500);
  } catch {
    if (reload) {
      try {
        await chrome.tabs.reload(tabId);
      } catch {
        /* ignore */
      }
    }
    const deadline = Date.now() + 35000;
    while (Date.now() < deadline) {
      await sleep(800);
      const tab = await chrome.tabs.get(tabId).catch(() => null);
      if (!tab) throw new Error('The Instagram tab was closed.');
      try {
        return await sendOnce(tabId, MSG.PING, {}, 2500);
      } catch {
        /* retry */
      }
    }
    throw new Error('Could not reach the Instagram tab. Reload instagram.com and try again.');
  }
}

const TRANSPORT_ERROR = /Receiving end does not exist|message port closed|The message port closed|No response from|did not respond|Could not establish|Extension context invalidated/i;

async function callContent(tabId, type, payload = {}, { timeoutMs = 25 * 60 * 1000 } = {}) {
  let lastError;
  let busyWaits = 0;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await sendOnce(tabId, type, payload, timeoutMs);
    } catch (err) {
      lastError = err;
      if (/busy with another task/i.test(err.message)) {
        busyWaits++;
        if (busyWaits > 160) throw err;
        await sleep(1500);
        attempt--;
        continue;
      }
      if (!TRANSPORT_ERROR.test(err.message)) throw err;
      await ensureContent(tabId, { reload: true }).catch(() => {});
      await sleep(900);
    }
  }
  throw lastError;
}

async function findInstagramTab() {
  const tabs = await chrome.tabs.query({
    url: ['https://www.instagram.com/*', 'https://instagram.com/*']
  });
  if (!tabs.length) return null;
  return tabs.find((t) => t.active) || tabs[0];
}

async function resolveTab() {
  if (state.tabId) {
    const tab = await chrome.tabs.get(state.tabId).catch(() => null);
    if (tab && /instagram\.com/i.test(tab.url || '')) return tab;
  }
  const tab = await findInstagramTab();
  if (tab) state.tabId = tab.id;
  return tab || null;
}

async function navigateTabToProfile(tabId, username) {
  const target = profileUrl(username);
  const normalize = (value) => (value || '').replace(/[?#].*$/, '').replace(/\/+$/, '').toLowerCase();
  let tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab) throw new Error('The Instagram tab was closed.');

  if (normalize(tab.url) !== normalize(target)) {
    await chrome.tabs.update(tabId, { url: target, active: true });
    await sleep(1400);
  }

  await ensureContent(tabId);

  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const current = await chrome.tabs.get(tabId).catch(() => null);
    if (current && normalize(current.url).startsWith(normalize(target))) break;
    await sleep(500);
  }
  await humanPause(700, 1200);
  try {
    await callContent(tabId, MSG.CLOSE_VIEWS, {}, { timeoutMs: 15000 });
  } catch {
    /* dialogs are optional */
  }
}

async function verifySession(tabId) {
  await ensureContent(tabId, { reload: true });
  return callContent(tabId, MSG.CHECK_SESSION, {}, { timeoutMs: 20000 });
}

// ---------------------------------------------------------------- job control

function buildSteps(config) {
  const steps = [];
  const push = (step) => {
    steps.push({ state: 'pending', count: 0, total: null, message: '', ...step });
  };
  if (config.resources.profile) push({ id: 'profile', kind: 'profile' });
  if (config.resources.posts) push({ id: 'grid-posts', kind: 'grid', tab: 'posts' });
  if (config.resources.reels) push({ id: 'grid-reels', kind: 'grid', tab: 'reels' });
  if (config.resources.followers) push({ id: 'list-followers', kind: 'list', resource: 'followers' });
  if (config.resources.following) push({ id: 'list-following', kind: 'list', resource: 'following' });
  return steps;
}

async function ensureDerivedSteps() {
  const job = state.job;
  if (!job) return;
  const cfg = job.config;
  let shortcodes = job.gridShortcodes;
  if (!Array.isArray(shortcodes)) {
    const posts = await db.getAllBy('posts', 'byProfile', job.profileUsername);
    shortcodes = posts.map((p) => p.shortcode).filter(Boolean);
  }
  const needDetail = cfg.resources.posts || cfg.resources.reels;

  if (needDetail) {
    for (const shortcode of shortcodes) {
      const id = `post-${shortcode}`;
      if (job.steps.some((s) => s.id === id)) continue;
      job.steps.push({
        id,
        kind: 'post',
        shortcode,
        includeCarousel: cfg.resources.carousel !== false,
        includeComments: Boolean(cfg.resources.comments),
        state: 'pending',
        count: 0,
        total: 1,
        message: ''
      });
    }
  }

  if (cfg.resources.comments) {
    for (const step of job.steps) {
      if (step.kind === 'post') step.includeComments = true;
    }
  }

  if (cfg.resources.likers) {
    for (const shortcode of shortcodes) {
      const id = `likers-${shortcode}`;
      if (job.steps.some((s) => s.id === id)) continue;
      job.steps.push({
        id,
        kind: 'likers',
        shortcode,
        resource: 'likers',
        state: 'pending',
        count: 0,
        total: cfg.caps.maxLikersPerPost || 0,
        message: ''
      });
    }
  }

  await saveJob();
}

async function startJob(payload) {
  await boot();
  if (state.job && ACTIVE_JOB_STATES.includes(state.job.state)) {
    throw new Error('A harvest is already in progress. Pause or stop it first.');
  }

  const username = normalizeUsername(payload.username);
  if (!username) throw new Error('Enter a valid Instagram username or profile URL.');

  const config = buildConfig(state.settings, {
    preset: payload.preset,
    resources: payload.resources,
    caps: payload.caps,
    pacing: payload.pacing
  });

  if ((config.resources.comments || config.resources.likers) && !(config.resources.posts || config.resources.reels)) {
    throw new Error('Enable Posts or Reels first — comments and likers are attached to posts.');
  }

  const steps = buildSteps(config);
  if (!steps.length) {
    throw new Error('Select at least one resource to harvest (profile, posts, reels, followers or following).');
  }

  await refreshDaily();
  const limits = config.limits;
  if (limits.maxProfilesPerDay && state.daily.profiles >= limits.maxProfilesPerDay) {
    throw new Error(`Daily limit reached (${state.daily.profiles}/${limits.maxProfilesPerDay} profiles). Try again tomorrow, or raise the limit in Settings.`);
  }
  if (limits.maxMinutesPerDay && state.daily.minutes >= limits.maxMinutesPerDay) {
    throw new Error(`Daily time limit reached (${limits.maxMinutesPerDay} min). Take a break and continue tomorrow.`);
  }

  const tab = await resolveTab();
  if (!tab) throw new Error('Open instagram.com in a tab (signed in), then press Start.');

  const session = await verifySession(tab.id);
  if (!session.loggedIn) {
    throw new Error('You appear to be signed out of Instagram. Log in on instagram.com, then try again.');
  }

  state.settings = await db.saveSettings({
    ...state.settings,
    preset: config.preset,
    pacing: config.pacing,
    caps: config.caps,
    lastUsername: username,
    custom: { resources: config.resources }
  });

  const now = nowIso();
  const job = {
    id: `job_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    profileUsername: username,
    config,
    steps,
    state: 'running',
    createdAt: now,
    startedAt: now,
    activeMs: 0,
    segmentStartedAt: now,
    updatedAt: now,
    finishedAt: '',
    pausedAt: '',
    log: [],
    confirmAck: {},
    selectorsBroken: {},
    gridShortcodes: [],
    errorStreak: 0,
    sessionWarned: false,
    minutesAccrued: 0,
    tabId: tab.id,
    tabUrl: profileUrl(username)
  };

  state.job = job;
  state.tabId = tab.id;

  state.daily.profiles = Number(state.daily.profiles || 0) + 1;
  await db.saveDaily(state.daily);

  log('info', `Started a ${config.preset} harvest for @${username}.`);
  await saveJob();
  broadcast(true);

  try {
    await navigateTabToProfile(tab.id, username);
  } catch (err) {
    job.state = 'paused';
    job.pausedAt = nowIso();
    job.pauseReason = err.message || 'Could not open the profile page.';
    await saveJob();
    broadcast(true);
    throw err;
  }
  // Let a previous loop's finally release the single-run flag first.
  if (state.running) {
    const deadline = Date.now() + 5000;
    while (state.running && Date.now() < deadline) await sleep(100);
  }
  runJob();
  return snapshot();
}

async function pauseJob(reason) {
  await boot();
  const job = state.job;
  if (!job || !ACTIVE_JOB_STATES.includes(job.state)) return snapshot();

  job.state = 'paused';
  job.pausedAt = nowIso();
  job.pauseReason = reason || '';
  if (state.pendingConfirm) state.pendingConfirm.resolve('pause');
  state.pendingConfirm = null;
  if (job.confirm) {
    const step = job.steps.find((s) => s.id === job.confirm.stepId);
    if (step) step.state = 'pending';
    job.confirm = null;
  }
  for (const step of job.steps) {
    if (step.state === 'running' || step.state === 'waiting_for_user') step.state = 'pending';
  }
  closeSegment(job);
  await syncDailyMinutes({ force: true });
  await saveJob();
  await abortContent();
  log('info', reason || 'Paused. Resume when you are ready.');
  broadcast(true);
  return snapshot();
}

async function resumeJob() {
  await boot();
  const job = state.job;
  if (!job) throw new Error('There is no harvest to resume.');
  if (job.state === 'done') throw new Error('This harvest is already complete. Start a new one.');
  if (job.state === 'running') return snapshot();

  const tab = await resolveTab();
  if (!tab) throw new Error('Open instagram.com in a tab, then press Resume.');
  state.tabId = tab.id;

  job.state = 'running';
  job.pausedAt = '';
  job.pauseReason = '';
  job.confirm = null;
  job.errorStreak = 0;
  job.message = '';
  openSegment(job);
  for (const step of job.steps) {
    if (step.state === 'running' || step.state === 'waiting_for_user') step.state = 'pending';
  }
  await saveJob();
  await ensureContent(tab.id).catch(() => {});
  log('info', 'Resumed.');
  broadcast(true);
  runJob();
  return snapshot();
}

async function stopJob(reason) {
  await boot();
  const job = state.job;
  if (!job) return snapshot();
  if (job.state === 'stopped' || job.state === 'done') return snapshot();

  job.state = 'stopped';
  job.finishedAt = nowIso();
  job.stopReason = reason || 'Stopped.';
  job.message = job.stopReason;
  if (state.pendingConfirm) state.pendingConfirm.resolve('stop');
  state.pendingConfirm = null;
  job.confirm = null;
  for (const step of job.steps) {
    if (step.state === 'running' || step.state === 'waiting_for_user') step.state = 'pending';
  }
  closeSegment(job);
  await syncDailyMinutes({ force: true });
  await abortContent();
  log('warn', reason || 'Harvest stopped.');
  await saveJob();
  broadcast(true);
  return snapshot();
}

async function retryStep() {
  await boot();
  const job = state.job;
  if (!job) throw new Error('There is no harvest to retry.');
  const errored = job.steps.filter((s) => s.state === 'error');
  if (!errored.length) throw new Error('No failed step to retry.');
  for (const step of errored) {
    step.state = 'pending';
    step.error = '';
    step.message = '';
  }
  job.state = 'running';
  job.errorStreak = 0;
  job.finishedAt = '';
  job.message = '';
  openSegment(job);
  const tab = await resolveTab();
  if (!tab) throw new Error('Open instagram.com in a tab, then retry.');
  state.tabId = tab.id;
  await ensureContent(tab.id).catch(() => {});
  await saveJob();
  log('info', 'Retrying failed steps.');
  broadcast(true);
  runJob();
  return snapshot();
}

async function resetJob() {
  await boot();
  if (state.job && ACTIVE_JOB_STATES.includes(state.job.state)) {
    throw new Error('Stop the running harvest before starting a new one.');
  }
  if (state.job) {
    await db.del('jobs', state.job.id).catch(() => {});
  }
  state.job = null;
  state.pendingConfirm = null;
  state.tabId = null;
  broadcast(true);
  return snapshot();
}

async function saveSettings(payload) {
  await boot();
  state.settings = await db.saveSettings({ ...state.settings, ...payload });
  broadcast(true);
  return state.settings;
}

async function onProgress(payload) {
  await boot();
  const job = state.job;
  if (!job || !payload) return;
  if (job.state === 'running' && state.running) {
    const capMessage = checkCaps();
    if (capMessage) {
      await stopJob(capMessage);
      return;
    }
  }
  const step = payload.stepId ? job.steps.find((s) => s.id === payload.stepId) : null;
  if (step) {
    if (Number.isFinite(payload.count)) step.count = payload.count;
    if (Number.isFinite(payload.total)) step.total = payload.total;
    if (payload.message) step.message = payload.message;
    if (payload.phase) step.phase = payload.phase;
  }
  if (payload.message) job.progressMessage = payload.message;
  const now = Date.now();
  if (now - state.lastProgressSave > 1500) {
    state.lastProgressSave = now;
    await saveJob();
  }
  broadcast();
  maybeAutoResume();
}

async function onSelectorBroken(info) {
  const job = state.job;
  if (!job) return;
  const name = info?.selector || 'unknown';
  job.selectorsBroken = job.selectorsBroken || {};
  const prior = job.selectorsBroken[name] || { count: 0 };
  job.selectorsBroken[name] = {
    ...info,
    count: prior.count + 1,
    firstSeenAt: prior.firstSeenAt || nowIso(),
    lastSeenAt: nowIso()
  };
  log('warn', `Selector “${name}” returned no nodes — Instagram may have changed its UI.`);
  await saveJob();
  broadcast(true);
}

async function abortContent() {
  if (!state.tabId) return;
  try {
    await sendOnce(state.tabId, MSG.ABORT, {}, 3000);
  } catch {
    /* tab gone / worker restart */
  }
}

// ---------------------------------------------------------------- confirm flow

function confirmSpec(step, warning = '') {
  const job = state.job;
  const username = job.profileUsername;
  const hint = warning ? { warning } : {};

  if (step.kind === 'list') {
    const resource = step.resource;
    return {
      stepId: step.id,
      resource,
      shortcode: null,
      title: `Open the ${resource} list`,
      instruction: `On the Instagram tab, open @${username}'s profile and click “${resource}”. Leave the list open, then press Confirm.`,
      action: { type: MSG.OPEN_LIST_UI, payload: { resource } },
      ...hint
    };
  }

  if (step.kind === 'likers') {
    return {
      stepId: step.id,
      resource: 'likers',
      shortcode: step.shortcode,
      title: `Open likers for this post`,
      instruction:
        `Open the post on the Instagram tab, then click the “N others” link under the likes. ` +
        `When the likes list is open, press Confirm.`,
      action: { type: MSG.OPEN_POST_UI, payload: { shortcode: step.shortcode } },
      postUrl: `https://www.instagram.com/p/${step.shortcode}/`,
      ...hint
    };
  }

  return {
    stepId: step.id,
    title: 'Confirm',
    instruction: 'Press Confirm when the list is open on Instagram.',
    ...hint
  };
}

function requestConfirm(step, spec) {
  if (state.job.confirmAck[step.id]) return Promise.resolve('confirm');
  return new Promise((resolve) => {
    state.job.state = 'waiting';
    step.state = 'waiting_for_user';
    state.job.confirm = { ...spec, at: Date.now() };
    state.pendingConfirm = {
      stepId: step.id,
      resolve: (answer) => {
        if (state.job) openSegment(state.job);
        resolve(answer);
      }
    };
    closeSegment(state.job);
    saveJob()
      .then(() => broadcast(true))
      .catch(() => broadcast(true));
  }).then(async (answer) => {
    state.pendingConfirm = null;
    const job = state.job;
    if (!job) throw new ControlError('stop');
    if (job.confirm) job.confirm = null;

    if (answer === 'confirm') {
      job.confirmAck[step.id] = true;
      job.state = 'running';
      step.state = 'running';
      await saveJob();
      broadcast(true);
      return 'confirm';
    }
    if (answer === 'skip') {
      job.state = 'running';
      step.state = 'skipped';
      await saveJob();
      broadcast(true);
      return 'skip';
    }
    if (answer === 'stop') throw new ControlError('stop');
    throw new ControlError('pause');
  });
}

async function onConfirm(payload) {
  await boot();
  const job = state.job;
  if (!job) throw new Error('There is no active harvest.');

  const stepId = payload?.stepId || job.confirm?.stepId;
  if (!stepId) throw new Error('Nothing is waiting for confirmation.');

  if (state.pendingConfirm && state.pendingConfirm.stepId === stepId) {
    state.pendingConfirm.resolve('confirm');
    return snapshot();
  }

  // Worker restarted while waiting: acknowledge and re-run the step.
  job.confirmAck[stepId] = true;
  const step = job.steps.find((s) => s.id === stepId);
  if (step) step.state = 'pending';
  job.confirm = null;
  job.state = 'running';
  openSegment(job);
  const tab = await resolveTab();
  if (!tab) throw new Error('Open instagram.com in a tab, then confirm again.');
  state.tabId = tab.id;
  await saveJob();
  runJob();
  broadcast(true);
  return snapshot();
}

async function onSkip(payload) {
  await boot();
  const job = state.job;
  if (!job) return snapshot();
  const stepId = payload?.stepId || job.confirm?.stepId;

  if (state.pendingConfirm && state.pendingConfirm.stepId === stepId) {
    state.pendingConfirm.resolve('skip');
    return snapshot();
  }

  if (stepId) {
    const step = job.steps.find((s) => s.id === stepId);
    if (step) step.state = 'skipped';
    job.confirm = null;
    job.state = 'running';
    openSegment(job);
    await saveJob();
    runJob();
    broadcast(true);
  }
  return snapshot();
}

async function onOpenForMe() {
  await boot();
  const job = state.job;
  const spec = job?.confirm;
  if (!spec?.action) throw new Error('There is nothing to open right now.');

  const tab = await resolveTab();
  if (!tab) throw new Error('Open instagram.com in a tab first.');
  state.tabId = tab.id;
  await ensureContent(tab.id);

  const action = spec.action;
  if (action.type === MSG.OPEN_LIST_UI) {
    await callContent(tab.id, MSG.CLOSE_VIEWS, {}, { timeoutMs: 20000 }).catch(() => {});
    await navigateTabToProfile(tab.id, job.profileUsername);
  }
  const data = await callContent(tab.id, action.type, action.payload || {}, { timeoutMs: 90000 });
  if (action.type === MSG.OPEN_POST_UI && data?.navigating) {
    await ensureContent(tab.id).catch(() => {});
  }
  return { action, data };
}

// ---------------------------------------------------------------- job loop

function checkCaps() {
  const job = state.job;
  if (!job) return '';
  const cfg = job.config;
  const elapsedMin = activeMs(job) / 60000;
  const dailyMinutes = (state.daily?.minutes || 0) + Math.max(0, elapsedMin - (job.minutesAccrued || 0));

  if (cfg.limits.maxMinutesPerDay && dailyMinutes >= cfg.limits.maxMinutesPerDay) {
    return `Daily time cap reached (${cfg.limits.maxMinutesPerDay} min). Take a break and continue tomorrow.`;
  }

  if (!job.sessionWarned && cfg.limits.sessionWarnMinutes && elapsedMin >= cfg.limits.sessionWarnMinutes) {
    job.sessionWarned = true;
    log('warn', `You have been harvesting for ${Math.round(elapsedMin)} minutes. Consider taking a break.`);
  }
  return '';
}

async function runJob() {
  if (state.running) return;
  await boot();
  if (state.running) return;
  if (!state.job || state.job.state !== 'running') return;

  state.running = true;
  openSegment(state.job);
  await refreshDaily();

  const runJobId = state.job.id;
  try {
    while (state.job && state.job.id === runJobId && state.job.state === 'running') {
      const capMessage = checkCaps();
      if (capMessage) {
        await stopJob(capMessage);
        break;
      }
      await syncDailyMinutes();
      if (!state.job || state.job.id !== runJobId) break;

      const step = state.job.steps.find((s) => ['pending', 'running', 'waiting_for_user'].includes(s.state));
      if (!step) {
        await finishJob();
        break;
      }

      step.state = 'running';
      step.startedAt = step.startedAt || nowIso();
      step.message = step.message || 'Working…';
      await saveJob();
      broadcast(true);

      try {
        await executeStep(step);
        const current = state.job;
        if (!current || current.id !== runJobId) break;
        if (current.state === 'running') {
          if (step.state !== 'skipped') {
            step.state = 'done';
            step.finishedAt = nowIso();
          }
          current.errorStreak = 0;
        } else if (step.state === 'running') {
          // Paused/stopped mid-task: keep the unit resumable.
          step.state = current.state === 'stopped' ? 'stopped' : 'pending';
        }
      } catch (err) {
        const current = state.job;
        if (err instanceof ControlError) {
          step.state = err.kind === 'stop' ? 'stopped' : 'pending';
          step.message = err.kind === 'pause' ? 'Paused.' : 'Stopped.';
          break;
        }
        if (!current || current.id !== runJobId) break;
        if (current.state !== 'running') {
          // The user paused/stopped (or the tab closed) while this step was in flight.
          step.state = current.state === 'stopped' ? 'stopped' : 'pending';
          step.message = current.state === 'stopped' ? 'Stopped.' : 'Paused.';
          break;
        }
        step.state = 'error';
        step.error = err?.message || String(err);
        step.message = step.error;
        current.errorStreak = (current.errorStreak || 0) + 1;
        log('error', `${stepLabel(step)} failed: ${step.error}`);
        if (current.errorStreak >= 3) {
          await stopJob('Stopped after 3 consecutive errors — Instagram may be rate limiting or the UI changed.');
          break;
        }
      }

      await saveJob();
      broadcast(true);
      await humanPause(350, 800);
    }
  } finally {
    state.running = false;
    await saveJob().catch(() => {});
    broadcast(true);
  }
}

async function finishJob() {
  const job = state.job;
  if (!job) return;
  const failed = job.steps.filter((s) => s.state === 'error').length;
  job.state = 'done';
  job.finishedAt = nowIso();
  job.message = failed
    ? `Finished with ${failed} failed step${failed === 1 ? '' : 's'}. Press Retry to re-run ${failed === 1 ? 'it' : 'them'}.`
    : 'Harvest complete.';
  closeSegment(job);
  await syncDailyMinutes({ force: true });
  if (failed) log('warn', `${failed} step${failed === 1 ? '' : 's'} failed.`);
  else log('success', 'Harvest complete. Export JSON or CSV from the panel.');
  await saveJob();
  await refreshRecentProfiles();
  broadcast(true);
}

async function maybeAutoResume() {
  const job = state.job;
  if (!job || job.state !== 'running' || state.running) return;
  if (!job.steps?.length) return;
  try {
    const tab = await resolveTab();
    if (!tab) {
      job.state = 'paused';
      job.pausedAt = nowIso();
      job.pauseReason = 'Open instagram.com in a tab, then press Resume.';
      closeSegment(job);
      await saveJob();
      broadcast(true);
      return;
    }
    openSegment(job);
    await ensureContent(tab.id).catch(() => {});
    runJob();
  } catch {
    /* leave it paused for the user */
  }
}

// ---------------------------------------------------------------- step execution

function capForList(resource, cfg) {
  if (resource === 'followers') return cfg.caps.maxFollowers;
  if (resource === 'following') return cfg.caps.maxFollowing;
  if (resource === 'likers') return cfg.caps.maxLikersPerPost;
  return 0;
}

async function listStep(step) {
  const job = state.job;
  const cfg = job.config;
  const tabId = state.tabId;
  const base = { pacing: cfg.pacing, stepId: step.id };

  let warning = '';
  let confirmed = false;
  for (let attempt = 0; attempt < 3; attempt++) {
    const spec = confirmSpec(step, warning);
    const answer = await requestConfirm(step, spec);
    if (answer === 'skip') return 'skip';
    step.message = `Checking that the ${step.resource} list is open…`;
    broadcast();
    const status = await callContent(tabId, MSG.CHECK_DIALOG, { resource: step.resource });
    if (status.open) {
      confirmed = true;
      break;
    }
    delete job.confirmAck[step.id];
    warning = `The ${step.resource} list is still not open on Instagram. Click “${step.resource}” on the profile, leave it open, then press Confirm again.`;
    log('warn', `The ${step.resource} dialog was not detected — asking again.`);
  }
  if (!confirmed) {
    throw new Error(`The ${step.resource} list never opened. Open it manually and press Retry.`);
  }

  step.message = `Harvesting ${step.resource}…`;
  broadcast();

  let data;
  for (let attempt = 0; attempt < 3; attempt++) {
    data = await callContent(
      tabId,
      MSG.HARVEST_LIST,
      { ...base, resource: step.resource, maxItems: capForList(step.resource, cfg) },
      { timeoutMs: 45 * 60 * 1000 }
    );
    if (!data?.navigating) break;
    await ensureContent(tabId);
    await humanPause(1200, 2000);
  }

  const users = data?.users || [];
  const merged = await mergeUsers(step.resource, users);
  const complete = data?.stopped !== 'aborted';
  await db.put(step.resource, {
    profileUsername: job.profileUsername,
    users: merged,
    count: merged.length,
    complete,
    updatedAt: nowIso()
  });

  step.count = merged.length;
  const cap = capForList(step.resource, cfg);
  step.total = cap || merged.length;
  step.message = `${merged.length} accounts saved${complete ? '' : ' (paused early)'}.`;
  log('success', `${stepLabel(step)} saved: ${merged.length} accounts.`);
  return 'done';
}

async function mergeUsers(resource, users) {
  const job = state.job;
  const key = job.profileUsername;
  const existing = (await db.get(resource, key)) || { users: [] };
  const map = new Map();
  for (const user of existing.users || []) {
    if (user?.username) map.set(user.username, user);
  }
  for (const user of users || []) {
    if (!user?.username) continue;
    const prior = map.get(user.username) || {};
    map.set(user.username, {
      ...prior,
      ...user,
      fullName: user.fullName || prior.fullName || '',
      avatar: user.avatar || prior.avatar || ''
    });
  }
  return Array.from(map.values());
}

async function postStep(step) {
  const job = state.job;
  const cfg = job.config;
  const tabId = state.tabId;
  const base = { pacing: cfg.pacing, stepId: step.id };

  step.message = 'Opening the post…';
  broadcast();

  let data;
  for (let attempt = 0; attempt < 3; attempt++) {
    data = await callContent(
      tabId,
      MSG.HARVEST_POST,
      {
        ...base,
        shortcode: step.shortcode,
        includeCarousel: step.includeCarousel !== false,
        includeComments: Boolean(step.includeComments),
        maxComments: cfg.caps.maxCommentsPerPost
      },
      { timeoutMs: 25 * 60 * 1000 }
    );
    if (!data?.navigating) break;
    await ensureContent(tabId);
    await humanPause(1400, 2200);
  }
  if (!data || data.navigating) throw new Error('Could not open this post. It may be unavailable.');

  const post = data.post || {};
  const key = [job.profileUsername, step.shortcode];
  const existing = (await db.get('posts', key)) || {};
  await db.put('posts', {
    ...existing,
    ...post,
    profileUsername: job.profileUsername,
    shortcode: step.shortcode,
    detailScrapedAt: nowIso(),
    carousel: post.carousel || existing.carousel || []
  });

  if (data.comments) {
    const flat = data.comments.flat || [];
    step.commentCount = flat.length;
    await db.put('comments', {
      profileUsername: job.profileUsername,
      shortcode: step.shortcode,
      tree: data.comments.tree || [],
      flat,
      truncated: Boolean(data.comments.truncated),
      scrapedAt: nowIso()
    });
    if (data.comments.warning) log('warn', data.comments.warning);
  }

  step.count = 1;
  step.total = 1;
  step.message = data.standalone ? 'Post saved (full page).' : 'Post saved.';
  log('info', `Post ${step.shortcode} saved${step.commentCount ? ` with ${step.commentCount} comments` : ''}.`);

  if (data.standalone) {
    await navigateTabToProfile(tabId, job.profileUsername);
  }
  return 'done';
}

async function likersStep(step) {
  const job = state.job;
  const cfg = job.config;
  const tabId = state.tabId;
  const base = { pacing: cfg.pacing, stepId: step.id };

  let warning = '';
  let confirmed = false;
  for (let attempt = 0; attempt < 3; attempt++) {
    const spec = confirmSpec(step, warning);
    const answer = await requestConfirm(step, spec);
    if (answer === 'skip') return 'skip';

    step.message = 'Checking for the likers dialog…';
    broadcast();
    const status = await callContent(tabId, MSG.CHECK_DIALOG, { resource: 'likers' });
    if (status.open) {
      confirmed = true;
      break;
    }
    delete job.confirmAck[step.id];
    warning = 'The likes list was not detected. Open this post, click the “N others” link, then press Confirm again.';
    log('warn', 'Likers dialog not detected — asking again.');
  }
  if (!confirmed) throw new Error('The likers list never opened. Open it manually and press Retry.');

  step.message = 'Harvesting likers…';
  broadcast();

  let data;
  for (let attempt = 0; attempt < 3; attempt++) {
    data = await callContent(
      tabId,
      MSG.HARVEST_LIST,
      { ...base, resource: 'likers', maxItems: cfg.caps.maxLikersPerPost },
      { timeoutMs: 30 * 60 * 1000 }
    );
    if (!data?.navigating) break;
    await ensureContent(tabId);
    await humanPause(1200, 2000);
  }

  const users = data?.users || [];
  const done = data?.stopped !== 'aborted';
  const likersKey = [job.profileUsername, step.shortcode];
  const existing = (await db.get('likers', likersKey)) || { users: [] };
  const map = new Map();
  for (const user of existing.users || []) {
    if (user?.username) map.set(user.username, user);
  }
  for (const user of users) {
    if (!user?.username) continue;
    const prior = map.get(user.username) || {};
    map.set(user.username, {
      ...prior,
      ...user,
      fullName: user.fullName || prior.fullName || '',
      avatar: user.avatar || prior.avatar || ''
    });
  }
  const merged = Array.from(map.values());
  await db.put('likers', {
    profileUsername: job.profileUsername,
    shortcode: step.shortcode,
    users: merged,
    count: merged.length,
    done,
    scrapedAt: nowIso()
  });

  step.count = merged.length;
  step.total = cfg.caps.maxLikersPerPost || merged.length;
  step.message = `${merged.length} likers saved${done ? '' : ' (paused early)'}.`;
  log('success', `Likers for ${step.shortcode}: ${merged.length}.`);

  try {
    await callContent(tabId, MSG.CLOSE_VIEWS, { pacing: cfg.pacing }, { timeoutMs: 20000 });
  } catch {
    /* non-fatal */
  }
  return 'done';
}

async function executeStep(step) {
  const job = state.job;
  const cfg = job.config;
  const tabId = state.tabId;
  if (!tabId) throw new Error('The Instagram tab is not available. Reopen it and press Resume.');
  const base = { pacing: cfg.pacing, stepId: step.id };

  if (step.kind === 'profile' || step.kind === 'grid') {
    await navigateTabToProfile(tabId, job.profileUsername);
  }

  if (step.kind === 'profile') {
    step.message = 'Reading the profile header…';
    broadcast();
    const details = await callContent(tabId, MSG.HARVEST_PROFILE, base, { timeoutMs: 90000 });
    await db.put('profiles', {
      profileUsername: job.profileUsername,
      scrapedAt: nowIso(),
      details,
      counts: details.counts || {},
      fullName: details.fullName || '',
      profilePic: details.profilePic || ''
    });
    step.count = 1;
    step.total = 1;
    step.message = 'Profile saved.';
    log('success', `Profile saved for @${job.profileUsername}.`);
    return 'done';
  }

  if (step.kind === 'grid') {
    step.message = `Collecting ${step.tab}…`;
    broadcast();

    let data;
    for (let attempt = 0; attempt < 3; attempt++) {
      data = await callContent(
        tabId,
        MSG.HARVEST_GRID,
        { ...base, tab: step.tab, maxPosts: cfg.caps.maxPosts || 0 },
        { timeoutMs: 40 * 60 * 1000 }
      );
      if (!data?.navigating) break;
      await ensureContent(tabId);
      await humanPause(1200, 2000);
    }

    const posts = data?.posts || [];
    for (const post of posts) {
      if (!post?.shortcode) continue;
      const key = [job.profileUsername, post.shortcode];
      const existing = await db.get('posts', key);
      await db.put('posts', {
        ...(existing || {}),
        ...post,
        profileUsername: job.profileUsername,
        source: step.tab,
        gridScrapedAt: nowIso()
      });
    }

    step.count = posts.length;
    step.total = posts.length;
    step.message = `${posts.length} ${step.tab} collected${data?.stopped === 'aborted' ? ' (paused early)' : ''}.`;
    log('info', `${stepLabel(step)}: ${posts.length} items.`);
    job.gridShortcodes = Array.isArray(job.gridShortcodes) ? job.gridShortcodes : [];
    for (const post of posts) {
      if (post?.shortcode && !job.gridShortcodes.includes(post.shortcode)) {
        job.gridShortcodes.push(post.shortcode);
      }
    }
    await ensureDerivedSteps();
    return 'done';
  }

  if (step.kind === 'list') {
    return listStep(step);
  }

  if (step.kind === 'post') {
    return postStep(step);
  }

  if (step.kind === 'likers') {
    return likersStep(step);
  }

  throw new Error(`Unknown step kind: ${step.kind}`);
}
