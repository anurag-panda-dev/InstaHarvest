/**
 * InstaHarvest — message protocol constants.
 *
 * Every message is `{ type, payload }`.
 *   panel  ⇄ worker : request / response, plus STATE broadcasts
 *   worker → content: task requests (await a single async response)
 *   content → worker: PROGRESS / LOG / SELECTOR_BROKEN / READY
 */

export const MSG = {
  // ---- panel → worker ----
  GET_STATE: 'GET_STATE',
  START_JOB: 'START_JOB',
  PAUSE: 'PAUSE',
  RESUME: 'RESUME',
  STOP: 'STOP',
  CONFIRM: 'CONFIRM',
  SKIP_STEP: 'SKIP_STEP',
  OPEN_FOR_ME: 'OPEN_FOR_ME',
  SAVE_SETTINGS: 'SAVE_SETTINGS',
  CLEAR_LOG: 'CLEAR_LOG',
  RESET_JOB: 'RESET_JOB',
  RETRY_STEP: 'RETRY_STEP',

  // ---- worker → content ----
  PING: 'PING',
  CHECK_SESSION: 'CHECK_SESSION',
  HARVEST_PROFILE: 'HARVEST_PROFILE',
  HARVEST_GRID: 'HARVEST_GRID',
  HARVEST_LIST: 'HARVEST_LIST',
  CHECK_DIALOG: 'CHECK_DIALOG',
  HARVEST_POST: 'HARVEST_POST',
  HARVEST_COMMENTS: 'HARVEST_COMMENTS',
  OPEN_LIST_UI: 'OPEN_LIST_UI',
  OPEN_POST_UI: 'OPEN_POST_UI',
  CLOSE_VIEWS: 'CLOSE_VIEWS',
  ABORT: 'ABORT',

  // ---- content → worker ----
  READY: 'READY',
  PROGRESS: 'PROGRESS',
  LOG: 'LOG',
  SELECTOR_BROKEN: 'SELECTOR_BROKEN',
  SESSION_LOST: 'SESSION_LOST',

  // ---- worker → panel broadcast ----
  STATE: 'STATE'
};

export const RESOURCE_LABELS = {
  profile: 'Profile details',
  posts: 'Posts grid',
  reels: 'Reels grid',
  followers: 'Followers',
  following: 'Following',
  comments: 'Comments',
  likers: 'Likers'
};

export const ACTIVE_JOB_STATES = ['running', 'waiting', 'paused'];
