/**
 * InstaHarvest — pacing helpers.
 *
 * Rule: every automated scroll is followed by 700–1200 ms (configurable),
 * every automated click by 500–1000 ms. Nothing here ever goes faster than
 * the caller's configured minimum.
 */

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function rand(min, max) {
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  return Math.round(lo + Math.random() * (hi - lo));
}

export async function humanPause(min = 700, max = 1200) {
  await sleep(rand(min, max));
}

export async function shortPause() {
  await sleep(rand(500, 900));
}

export function nowIso() {
  return new Date().toISOString();
}

export function todayKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function clamp(n, min, max) {
  const value = Number(n);
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

export function formatDuration(ms) {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${s}s`;
  return `${s}s`;
}

export function formatNumber(n) {
  const value = Number(n);
  if (!Number.isFinite(value)) return '0';
  return value.toLocaleString('en-US');
}
