/**
 * InstaHarvest — side panel UI.
 * Thin view over the worker's snapshot; owns exports (reads IndexedDB directly).
 */
import { MSG } from '../messages.js';
import { PRESETS, VERSION } from '../storage/schema.js';
import { formatDuration, formatNumber } from '../pacing.js';
import * as db from '../storage/db.js';
import { exportJson, exportCsv } from '../storage/export.js';

const $ = (id) => document.getElementById(id);

const el = {
  statusBadge: $('statusBadge'),
  themeBtn: $('themeBtn'),
  profileInput: $('profileInput'),
  startBtn: $('startBtn'),
  setupError: $('setupError'),
  presetHint: $('presetHint'),
  customBox: $('customBox'),
  progressCard: $('progressCard'),
  jobMeta: $('jobMeta'),
  jobProfile: $('jobProfile'),
  jobState: $('jobState'),
  jobBar: $('jobBar'),
  stepsList: $('stepsList'),
  jobMessage: $('jobMessage'),
  jobError: $('jobError'),
  jobErrorText: $('jobErrorText'),
  retryInlineBtn: $('retryInlineBtn'),
  selectorsWarning: $('selectorsWarning'),
  confirmCard: $('confirmCard'),
  confirmTitle: $('confirmTitle'),
  confirmInstruction: $('confirmInstruction'),
  confirmWarning: $('confirmWarning'),
  confirmBtn: $('confirmBtn'),
  openBtn: $('openBtn'),
  skipBtn: $('skipBtn'),
  cancelBtn: $('cancelBtn'),
  controlsCard: $('controlsCard'),
  pauseBtn: $('pauseBtn'),
  resumeBtn: $('resumeBtn'),
  retryBtn: $('retryBtn'),
  stopBtn: $('stopBtn'),
  newBtn: $('newBtn'),
  debugBtn: $('debugBtn'),
  sessionNote: $('sessionNote'),
  exportProfile: $('exportProfile'),
  exportCounts: $('exportCounts'),
  exportJsonBtn: $('exportJsonBtn'),
  exportCsvBtn: $('exportCsvBtn'),
  exportNote: $('exportNote'),
  logToggle: $('logToggle'),
  logBody: $('logBody'),
  logList: $('logList'),
  logCount: $('logCount'),
  clearLogBtn: $('clearLogBtn'),
  pacingMin: $('pacingMin'),
  pacingMax: $('pacingMax'),
  pacingMinVal: $('pacingMinVal'),
  pacingMaxVal: $('pacingMaxVal'),
  setMaxPosts: $('setMaxPosts'),
  setMaxFollowers: $('setMaxFollowers'),
  setMaxFollowing: $('setMaxFollowing'),
  setMaxLikers: $('setMaxLikers'),
  setMaxComments: $('setMaxComments'),
  setMaxProfiles: $('setMaxProfiles'),
  setMaxMinutes: $('setMaxMinutes'),
  setWarnMinutes: $('setWarnMinutes'),
  saveSettingsBtn: $('saveSettingsBtn'),
  settingsNote: $('settingsNote'),
  versionText: $('versionText'),
  capPosts: $('capPosts'),
  capFollowers: $('capFollowers'),
  capFollowing: $('capFollowing'),
  capLikers: $('capLikers'),
  capComments: $('capComments'),
  customChecks: Array.from(document.querySelectorAll('[data-res]')),
  presetChips: Array.from(document.querySelectorAll('[data-preset]'))
};

const BADGE = {
  idle: ['Idle', 'badge-idle'],
  running: ['Running', 'badge-running'],
  waiting: ['Waiting for you', 'badge-waiting'],
  paused: ['Paused', 'badge-paused'],
  done: ['Done', 'badge-done'],
  stopped: ['Stopped', 'badge-stopped']
};

const STATE_LABEL = {
  pending: 'pending',
  running: 'running',
  waiting_for_user: 'waiting for you',
  waiting: 'waiting for you',
  done: 'done',
  skipped: 'skipped',
  error: 'error',
  stopped: 'stopped'
};

let snapshot = null;
let activePreset = 'quick';
let prefsLoaded = false;
let lastExportUsername = '';
let lastLogCount = -1;
let busyAction = false;

init().catch((err) => showSetupError(err.message));

async function init() {
  el.versionText.textContent = VERSION;
  bindEvents();
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === MSG.STATE && message.payload) apply(message.payload);
  });
  const snap = await send(MSG.GET_STATE);
  apply(snap);

  setInterval(() => {
    if (lastExportUsername && document.visibilityState === 'visible') {
      refreshExportCounts(lastExportUsername);
    }
  }, 5000);
}

function send(type, payload) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type, payload }, (response) => {
      const err = chrome.runtime.lastError;
      if (err) {
        reject(new Error(err.message));
        return;
      }
      if (!response) {
        reject(new Error('No response from the service worker.'));
        return;
      }
      if (response.ok === false) {
        reject(new Error(response.error || 'Request failed.'));
        return;
      }
      resolve(response.data);
    });
  });
}

async function act(fn, button) {
  if (busyAction) return;
  busyAction = true;
  const prior = button ? button.textContent : '';
  if (button) button.disabled = true;
  try {
    await fn();
  } catch (err) {
    showSetupError(err.message);
  } finally {
    busyAction = false;
    if (button) {
      button.disabled = false;
      if (prior) button.textContent = prior;
    }
    if (snapshot) renderSetup();
  }
}

// ------------------------------------------------------------------ rendering

function apply(snap) {
  if (!snap) return;
  snapshot = snap;
  if (snap.settings) {
    applyTheme(snap.settings.theme || 'auto');
    if (!prefsLoaded) {
      populateSettings(snap.settings);
      prefsLoaded = true;
    }
  }
  renderStatus();
  renderSetup();
  renderProgress();
  renderConfirm();
  renderControls();
  renderLog();
  renderExport();
}

function renderStatus() {
  const job = snapshot?.job;
  const key = job ? job.state : 'idle';
  const [label, cls] = BADGE[key] || BADGE.idle;
  el.statusBadge.textContent = label;
  el.statusBadge.className = `badge ${cls}`;
}

function isActive(job) {
  return Boolean(job && ['running', 'waiting', 'paused'].includes(job.state));
}

function renderSetup() {
  const job = snapshot?.job;
  const active = isActive(job);
  el.startBtn.disabled = active;
  for (const chip of el.presetChips) {
    chip.classList.toggle('active', chip.dataset.preset === activePreset);
    chip.disabled = active;
  }
  const preset = PRESETS[activePreset] || PRESETS.quick;
  el.presetHint.textContent = preset.hint;
  if (activePreset === 'custom' && !el.customBox.open) el.customBox.open = true;
}

function aggregateState(steps) {
  const states = steps.map((step) => step.state);
  if (states.includes('error')) return 'error';
  if (states.includes('waiting_for_user')) return 'waiting';
  if (states.includes('running')) return 'running';
  if (states.includes('stopped')) return 'stopped';
  if (states.length && states.every((s) => s === 'done' || s === 'skipped')) return 'done';
  return 'pending';
}

function groupsFor(job) {
  const steps = job.steps || [];
  const groups = [];
  const add = (key, label, filter) => {
    const subset = steps.filter(filter);
    if (subset.length) groups.push({ key, label, steps: subset });
  };
  add('profile', 'Profile details', (s) => s.kind === 'profile');
  add('posts', 'Posts grid', (s) => s.kind === 'grid' && s.tab === 'posts');
  add('reels', 'Reels grid', (s) => s.kind === 'grid' && s.tab === 'reels');
  add('followers', 'Followers', (s) => s.kind === 'list' && s.resource === 'followers');
  add('following', 'Following', (s) => s.kind === 'list' && s.resource === 'following');
  add('details', 'Post details', (s) => s.kind === 'post');
  add('comments', 'Comments', (s) => s.kind === 'post' && s.includeComments);
  add('likers', 'Likers', (s) => s.kind === 'likers');
  return groups;
}

function groupMetrics(group) {
  const { key, steps } = group;
  const state = aggregateState(steps);
  const count = steps.reduce((sum, s) => sum + (Number(s.count) || 0), 0);
  const doneSteps = steps.filter((s) => ['done', 'skipped', 'error', 'stopped'].includes(s.state)).length;
  const totalSteps = steps.length;
  const capTotal = steps.reduce((max, s) => Math.max(max, Number(s.total) || 0), 0);
  const comments = steps.reduce((sum, s) => sum + (Number(s.commentCount) || 0), 0);
  const active = steps.find((s) => s.state === 'running') || steps.find((s) => s.state === 'waiting_for_user') || steps[steps.length - 1];

  let counter = '';
  if (key === 'profile') counter = doneSteps ? 'saved' : '—';
  else if (key === 'posts' || key === 'reels') counter = `${formatNumber(count)} posts`;
  else if (key === 'followers' || key === 'following') {
    counter = capTotal ? `${formatNumber(count)} / ${formatNumber(capTotal)}` : formatNumber(count);
  } else if (key === 'likers') counter = `${doneSteps}/${totalSteps} posts · ${formatNumber(count)} likers`;
  else if (key === 'details') counter = `${doneSteps}/${totalSteps} posts`;
  else if (key === 'comments') counter = `${doneSteps}/${totalSteps} posts · ${formatNumber(comments)} comments`;

  return { state, count, counter, message: active?.message || '', error: steps.find((s) => s.state === 'error')?.error || '' };
}

function renderProgress() {
  const job = snapshot?.job;
  if (!job) {
    el.progressCard.hidden = true;
    return;
  }
  el.progressCard.hidden = false;

  const presetLabel = PRESETS[job.config?.preset]?.label || job.config?.preset || '';
  el.jobProfile.textContent = `@${job.profileUsername}`;

  const stateKey = job.state === 'waiting' ? 'waiting' : job.state;
  el.jobState.textContent = STATE_LABEL[stateKey] || stateKey;
  el.jobState.className = `state-pill state-${stateKey === 'waiting_for_user' ? 'waiting' : stateKey}`;

  const steps = job.steps || [];
  const finished = steps.filter((s) => ['done', 'skipped'].includes(s.state)).length;
  const pct = steps.length ? Math.round((finished / steps.length) * 100) : 0;
  el.jobBar.style.width = `${pct}%`;

  const elapsed = formatDuration(job.elapsedMs || 0);
  const daily = snapshot.daily;
  const minutes = daily ? Math.max(daily.minutes || 0, daily.effectiveMinutes || 0) : 0;
  const limit = job.config?.limits?.maxMinutesPerDay;
  const remaining = steps.length - finished;
  let eta = '';
  if (job.state === 'running' && finished > 0 && remaining > 0) {
    const average = (job.elapsedMs || 0) / finished;
    eta = ` · ~${formatDuration(average * remaining)} left`;
  }
  el.jobMeta.textContent = `${presetLabel} · ${elapsed}${limit ? ` · ${Math.round(minutes)}/${limit} min today` : ''}${eta}`;

  el.stepsList.textContent = '';
  for (const group of groupsFor(job)) {
    const metrics = groupMetrics(group);
    const row = document.createElement('div');
    row.className = 'step-row';
    if (metrics.state === 'running' || metrics.state === 'waiting') row.classList.add('is-active');
    if (metrics.state === 'error') row.classList.add('is-error');

    const label = document.createElement('div');
    label.className = 'step-label';
    label.textContent = group.label;
    const pill = document.createElement('span');
    pill.className = `state-pill state-${metrics.state === 'waiting' ? 'waiting' : metrics.state}`;
    pill.textContent = STATE_LABEL[metrics.state] || metrics.state;
    label.append(' ', pill);

    const counter = document.createElement('div');
    counter.className = 'step-count';
    counter.textContent = metrics.counter;

    const msg = document.createElement('div');
    msg.className = 'step-msg';
    msg.textContent = metrics.error || metrics.message || '';

    row.append(label, counter, msg);
    el.stepsList.append(row);
  }

  const message = job.message || job.progressMessage || '';
  el.jobMessage.textContent = message;
  el.jobMessage.hidden = !message;

  const errored = steps.find((s) => s.state === 'error');
  if (errored) {
    el.jobErrorText.textContent = `${errored.error || 'A step failed.'} — press Retry to try again.`;
    el.jobError.hidden = false;
  } else {
    el.jobError.hidden = true;
  }

  const broken = Object.entries(job.selectorsBroken || {});
  if (broken.length) {
    const [name, info] = broken[0];
    el.selectorsWarning.hidden = false;
    el.selectorsWarning.textContent =
      `Instagram's UI may have changed — selector “${name}” (${info.description || 'unknown'}) returned no nodes. ` +
      'The harvest keeps going; update selectors.js to fix that resource.';
  } else {
    el.selectorsWarning.hidden = true;
  }
}

function renderConfirm() {
  const confirm = snapshot?.job?.confirm;
  if (!confirm) {
    el.confirmCard.hidden = true;
    return;
  }
  el.confirmCard.hidden = false;
  el.confirmTitle.textContent = confirm.title || 'Confirm';
  el.confirmInstruction.textContent = confirm.instruction || '';
  if (confirm.warning) {
    el.confirmWarning.textContent = confirm.warning;
    el.confirmWarning.hidden = false;
  } else {
    el.confirmWarning.hidden = true;
  }
  el.openBtn.hidden = !confirm.action;
  el.openBtn.textContent = confirm.resource === 'likers' ? 'Open the post' : `Open ${confirm.resource || 'list'}`;
}

function renderControls() {
  const job = snapshot?.job;
  if (!job) {
    el.controlsCard.hidden = true;
    return;
  }
  el.controlsCard.hidden = false;
  const active = isActive(job);
  const errored = (job.steps || []).some((s) => s.state === 'error');

  el.pauseBtn.hidden = !(job.state === 'running' || job.state === 'waiting');
  el.resumeBtn.hidden = job.state !== 'paused';
  el.stopBtn.hidden = !active;
  el.newBtn.hidden = !(job.state === 'done' || job.state === 'stopped');
  el.retryBtn.hidden = !errored || job.state === 'running';

  const limits = job.config?.limits || {};
  const daily = snapshot.daily || {};
  const minutes = Math.max(daily.minutes || 0, daily.effectiveMinutes || 0);
  const profiles = daily.profiles || 0;
  const warnAt = limits.sessionWarnMinutes || 25;

  const parts = [];
  if (limits.maxMinutesPerDay) {
    parts.push(`${Math.round(minutes)}/${limits.maxMinutesPerDay} min today`);
  }
  if (limits.maxProfilesPerDay) {
    parts.push(`${profiles}/${limits.maxProfilesPerDay} profiles today`);
  }
  if (minutes >= warnAt) {
    parts.push('You have been at this a while — consider a short break.');
  }
  el.sessionNote.textContent = parts.join(' · ');
  el.sessionNote.hidden = !parts.length;
}

function renderLog() {
  const job = snapshot?.job;
  const log = job?.log || [];
  el.logCount.textContent = String(log.length);
  if (!log.length) {
    el.logList.textContent = 'No activity yet.';
    return;
  }
  el.logList.textContent = '';
  for (const entry of log.slice(-120)) {
    const li = document.createElement('li');
    li.className = `log-${entry.level || 'info'}`;
    const time = document.createElement('span');
    time.className = 'log-time';
    time.textContent = new Date(entry.ts).toLocaleTimeString([], { hour12: false });
    const level = document.createElement('span');
    level.className = 'log-level';
    level.textContent = entry.level || 'info';
    const msg = document.createElement('span');
    msg.textContent = entry.message;
    li.append(time, level, msg);
    el.logList.append(li);
  }
  if (log.length !== lastLogCount && !el.logBody.hidden) {
    el.logList.scrollTop = el.logList.scrollHeight;
  }
  lastLogCount = log.length;
}

function renderExport() {
  const job = snapshot?.job;
  const username =
    job?.profileUsername ||
    snapshot?.settings?.lastUsername ||
    snapshot?.recentProfiles?.[0]?.profileUsername ||
    '';

  el.exportProfile.textContent = username ? `@${username}` : '—';
  const hasUser = Boolean(username);
  el.exportJsonBtn.disabled = !hasUser;
  el.exportCsvBtn.disabled = !hasUser;

  if (username && username !== lastExportUsername) {
    lastExportUsername = username;
    refreshExportCounts(username);
  } else if (!username) {
    lastExportUsername = '';
    el.exportCounts.textContent = 'No data yet.';
  }
}

async function refreshExportCounts(username) {
  try {
    const [profile, followers, following, posts, comments, likers] = await Promise.all([
      db.get('profiles', username),
      db.get('followers', username),
      db.get('following', username),
      db.getAllBy('posts', 'byProfile', username),
      db.getAllBy('comments', 'byProfile', username),
      db.getAllBy('likers', 'byProfile', username)
    ]);
    const commentTotal = comments.reduce((sum, row) => sum + (row.flat?.length || 0), 0);
    const likerTotal = likers.reduce((sum, row) => sum + (row.users?.length || 0), 0);
    const counts = [
      `${formatNumber(posts.length)} posts`,
      `${formatNumber(followers?.users?.length || 0)} followers`,
      `${formatNumber(following?.users?.length || 0)} following`,
      `${formatNumber(commentTotal)} comments`,
      `${formatNumber(likerTotal)} likers`
    ];
    const when = profile?.scrapedAt ? ` · saved ${new Date(profile.scrapedAt).toLocaleDateString()}` : '';
    el.exportCounts.textContent = counts.join(' · ') + when;
  } catch (err) {
    el.exportCounts.textContent = 'Could not read saved data.';
  }
}

// ------------------------------------------------------------------ settings

function populateSettings(settings) {
  el.profileInput.value = settings.lastUsername || el.profileInput.value || '';
  el.pacingMin.value = String(settings.pacing?.min ?? 700);
  el.pacingMax.value = String(settings.pacing?.max ?? 1200);
  updatePacingLabels();

  const caps = settings.caps || {};
  el.setMaxPosts.value = String(caps.maxPosts ?? 12);
  el.setMaxFollowers.value = String(caps.maxFollowers ?? 2000);
  el.setMaxFollowing.value = String(caps.maxFollowing ?? 2000);
  el.setMaxLikers.value = String(caps.maxLikersPerPost ?? 200);
  el.setMaxComments.value = String(caps.maxCommentsPerPost ?? 300);

  const limits = settings.limits || {};
  el.setMaxProfiles.value = String(limits.maxProfilesPerDay ?? 5);
  el.setMaxMinutes.value = String(limits.maxMinutesPerDay ?? 45);
  el.setWarnMinutes.value = String(limits.sessionWarnMinutes ?? 25);

  activePreset = settings.preset || 'quick';
  const customResources = settings.custom?.resources || {};
  for (const check of el.customChecks) {
    check.checked = Boolean(customResources[check.dataset.res]);
  }

  el.capPosts.value = String(caps.maxPosts ?? 12);
  el.capFollowers.value = String(caps.maxFollowers ?? 2000);
  el.capFollowing.value = String(caps.maxFollowing ?? 2000);
  el.capLikers.value = String(caps.maxLikersPerPost ?? 200);
  el.capComments.value = String(caps.maxCommentsPerPost ?? 300);
}

function updatePacingLabels() {
  el.pacingMinVal.textContent = `${el.pacingMin.value} ms`;
  el.pacingMaxVal.textContent = `${el.pacingMax.value} ms`;
}

function readCustomResources() {
  const out = {};
  for (const check of el.customChecks) out[check.dataset.res] = check.checked;
  return out;
}

function readCustomCaps() {
  const toInt = (value, fallback) => {
    const n = Number.parseInt(value, 10);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  };
  return {
    maxPosts: toInt(el.capPosts.value, 12),
    maxFollowers: toInt(el.capFollowers.value, 2000),
    maxFollowing: toInt(el.capFollowing.value, 2000),
    maxLikersPerPost: toInt(el.capLikers.value, 200),
    maxCommentsPerPost: toInt(el.capComments.value, 300)
  };
}

function applyTheme(theme) {
  const value = ['auto', 'light', 'dark'].includes(theme) ? theme : 'auto';
  document.documentElement.dataset.theme = value;
  el.themeBtn.textContent = value === 'dark' ? '☾' : value === 'light' ? '☀' : '◐';
  el.themeBtn.title = `Theme: ${value}`;
  el.themeBtn.dataset.theme = value;
}

// ------------------------------------------------------------------ events

function bindEvents() {
  el.startBtn.addEventListener('click', () =>
    act(async () => {
      clearSetupError();
      const username = el.profileInput.value.trim();
      if (!username) {
        showSetupError('Enter an Instagram username or profile URL.');
        return;
      }
      const payload = { username, preset: activePreset };
      if (activePreset === 'custom') {
        payload.resources = readCustomResources();
        payload.caps = readCustomCaps();
        if ((payload.resources.comments || payload.resources.likers) && !(payload.resources.posts || payload.resources.reels)) {
          showSetupError('Comments and likers need Posts or Reels enabled.');
          return;
        }
      }
      el.startBtn.textContent = 'Starting…';
      try {
        const snap = await send(MSG.START_JOB, payload);
        apply(snap);
      } finally {
        el.startBtn.textContent = 'Start';
      }
    }, el.startBtn)
  );

  el.profileInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') el.startBtn.click();
  });

  for (const chip of el.presetChips) {
    chip.addEventListener('click', () => {
      if (isActive(snapshot?.job)) return;
      activePreset = chip.dataset.preset;
      renderSetup();
    });
  }

  el.themeBtn.addEventListener('click', () =>
    act(async () => {
      const order = ['auto', 'light', 'dark'];
      const current = el.themeBtn.dataset.theme || 'auto';
      const next = order[(order.indexOf(current) + 1) % order.length];
      applyTheme(next);
      await send(MSG.SAVE_SETTINGS, { theme: next });
    })
  );

  el.confirmBtn.addEventListener('click', () =>
    act(async () => {
      const stepId = snapshot?.job?.confirm?.stepId;
      const snap = await send(MSG.CONFIRM, { stepId });
      apply(snap);
    }, el.confirmBtn)
  );

  el.openBtn.addEventListener('click', () =>
    act(async () => {
      await send(MSG.OPEN_FOR_ME);
    }, el.openBtn)
  );

  el.skipBtn.addEventListener('click', () =>
    act(async () => {
      const stepId = snapshot?.job?.confirm?.stepId;
      const snap = await send(MSG.SKIP_STEP, { stepId });
      apply(snap);
    })
  );

  el.cancelBtn.addEventListener('click', () =>
    act(async () => {
      const snap = await send(MSG.STOP);
      apply(snap);
    })
  );

  el.pauseBtn.addEventListener('click', () =>
    act(async () => {
      const snap = await send(MSG.PAUSE);
      apply(snap);
    }, el.pauseBtn)
  );

  el.resumeBtn.addEventListener('click', () =>
    act(async () => {
      const snap = await send(MSG.RESUME);
      apply(snap);
    }, el.resumeBtn)
  );

  el.stopBtn.addEventListener('click', () =>
    act(async () => {
      const snap = await send(MSG.STOP);
      apply(snap);
    }, el.stopBtn)
  );

  el.newBtn.addEventListener('click', () =>
    act(async () => {
      const snap = await send(MSG.RESET_JOB);
      apply(snap);
    }, el.newBtn)
  );

  const retry = () =>
    act(async () => {
      const snap = await send(MSG.RETRY_STEP);
      apply(snap);
    }, el.retryBtn);

  el.retryBtn.addEventListener('click', retry);
  el.retryInlineBtn.addEventListener('click', retry);

  el.debugBtn.addEventListener('click', () =>
    act(async () => {
      const job = snapshot?.job;
      const debug = {
        version: VERSION,
        exportedAt: new Date().toISOString(),
        job: job
          ? {
              id: job.id,
              profileUsername: job.profileUsername,
              state: job.state,
              config: job.config,
              steps: (job.steps || []).map((s) => ({
                id: s.id,
                kind: s.kind,
                state: s.state,
                count: s.count,
                total: s.total,
                error: s.error || '',
                message: s.message || ''
              })),
              selectorsBroken: job.selectorsBroken || {},
              log: job.log || []
            }
          : null,
        daily: snapshot?.daily || null,
        userAgent: navigator.userAgent
      };
      const text = JSON.stringify(debug, null, 2);
      try {
        await navigator.clipboard.writeText(text);
        el.exportNote.textContent = 'Debug info copied to the clipboard.';
      } catch {
        const blob = new Blob([text], { type: 'text/plain' });
        const anchor = document.createElement('a');
        anchor.href = URL.createObjectURL(blob);
        anchor.download = 'instaharvest_debug.txt';
        anchor.click();
        el.exportNote.textContent = 'Debug info downloaded.';
      }
    })
  );

  el.exportJsonBtn.addEventListener('click', () => doExport('json'));
  el.exportCsvBtn.addEventListener('click', () => doExport('csv'));

  el.logToggle.addEventListener('click', () => {
    const open = el.logBody.hidden;
    el.logBody.hidden = !open;
    el.logToggle.setAttribute('aria-expanded', String(open));
    if (open) el.logList.scrollTop = el.logList.scrollHeight;
  });

  el.clearLogBtn.addEventListener('click', () =>
    act(async () => {
      const snap = await send(MSG.CLEAR_LOG);
      apply(snap);
    })
  );

  el.pacingMin.addEventListener('input', updatePacingLabels);
  el.pacingMax.addEventListener('input', updatePacingLabels);

  el.saveSettingsBtn.addEventListener('click', () =>
    act(async () => {
      let min = Number.parseInt(el.pacingMin.value, 10);
      let max = Number.parseInt(el.pacingMax.value, 10);
      if (min > max) [min, max] = [max, min];
      const caps = {
        maxPosts: Number.parseInt(el.setMaxPosts.value, 10) || 0,
        maxFollowers: Number.parseInt(el.setMaxFollowers.value, 10) || 0,
        maxFollowing: Number.parseInt(el.setMaxFollowing.value, 10) || 0,
        maxLikersPerPost: Number.parseInt(el.setMaxLikers.value, 10) || 0,
        maxCommentsPerPost: Number.parseInt(el.setMaxComments.value, 10) || 0
      };
      const limits = {
        maxProfilesPerDay: Number.parseInt(el.setMaxProfiles.value, 10) || 1,
        maxMinutesPerDay: Number.parseInt(el.setMaxMinutes.value, 10) || 1,
        sessionWarnMinutes: Number.parseInt(el.setWarnMinutes.value, 10) || 25
      };
      const payload = {
        preset: activePreset,
        pacing: { min, max },
        caps,
        limits,
        custom: { resources: readCustomResources() },
        lastUsername: el.profileInput.value.trim() || snapshot?.settings?.lastUsername || ''
      };
      const saved = await send(MSG.SAVE_SETTINGS, payload);
      if (saved) snapshot.settings = saved;
      populateSettings(saved || snapshot.settings);
      el.settingsNote.textContent = 'Saved.';
      setTimeout(() => (el.settingsNote.textContent = ''), 2500);
    }, el.saveSettingsBtn)
  );
}

// ------------------------------------------------------------------ export

async function doExport(kind) {
  if (!lastExportUsername) {
    el.exportNote.textContent = 'Run a harvest first.';
    return;
  }
  el.exportNote.textContent = 'Preparing…';
  try {
    if (kind === 'json') {
      const result = await exportJson(lastExportUsername);
      el.exportNote.textContent = `Saved ${result.name}.`;
    } else {
      const result = await exportCsv(lastExportUsername);
      el.exportNote.textContent = result.names.length
        ? `Saved ${result.names.length} CSV file${result.names.length === 1 ? '' : 's'}.`
        : 'Nothing to export yet.';
    }
  } catch (err) {
    el.exportNote.textContent = err.message;
  }
}

// ------------------------------------------------------------------ small helpers

function showSetupError(message) {
  el.setupError.textContent = message || 'Something went wrong.';
  el.setupError.hidden = false;
}

function clearSetupError() {
  el.setupError.hidden = true;
  el.setupError.textContent = '';
}
