// Live config: a mutable copy of the defaults, overlaid with values saved in
// localStorage. Game code reads `config.<group>.<key>` every frame, so edits
// made through the admin panel apply immediately.

import DEFAULTS from './config.defaults.js';

const STORAGE_KEY = 'free-kicks.config.v1';
const listeners = new Set();

export const config = JSON.parse(JSON.stringify(DEFAULTS));

/** Copies values from `src` into `dst`, but only keys that exist in the
 *  defaults and have the same type, so stale or malformed data is ignored. */
function mergeKnown(dst, src, ref = DEFAULTS) {
  if (!src || typeof src !== 'object') return;
  for (const key of Object.keys(ref)) {
    if (!(key in src)) continue;
    if (ref[key] && typeof ref[key] === 'object') mergeKnown(dst[key], src[key], ref[key]);
    else if (typeof src[key] === typeof ref[key]) dst[key] = src[key];
  }
}

/** Only the values that differ from the defaults, so changed defaults still reach players. */
function overrides(cur, ref = DEFAULTS) {
  const out = {};
  for (const key of Object.keys(ref)) {
    if (ref[key] && typeof ref[key] === 'object') {
      const sub = overrides(cur[key], ref[key]);
      if (Object.keys(sub).length) out[key] = sub;
    } else if (cur[key] !== ref[key]) out[key] = cur[key];
  }
  return out;
}

export function saveConfig() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides(config)));
  } catch {
    /* storage unavailable (private mode etc.) – values still apply for this session */
  }
}

export function resetConfig() {
  mergeKnown(config, DEFAULTS);
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {}
  notifyConfigChange();
}

export function exportConfig() {
  return JSON.stringify(config, null, 2);
}

/** Throws if the text is not valid JSON. */
export function importConfig(text) {
  mergeKnown(config, JSON.parse(text));
  saveConfig();
  notifyConfigChange();
}

/** `path` is e.g. "wall.count", or undefined when everything may have changed. */
export function onConfigChange(fn) {
  listeners.add(fn);
}

export function notifyConfigChange(path) {
  for (const fn of listeners) fn(path);
}

// Load saved values on startup (normal and admin mode).
try {
  mergeKnown(config, JSON.parse(localStorage.getItem(STORAGE_KEY)));
} catch {}
