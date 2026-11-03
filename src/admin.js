// Tuning panel. Only loaded when the URL contains ?admin.

import GUI from 'lil-gui';
import {
  config,
  saveConfig,
  resetConfig,
  exportConfig,
  importConfig,
  notifyConfigChange,
} from './config.js';

// [min, max, step, label] for numbers, [options[], label] for dropdowns.
const PANEL = {
  shot: {
    title: 'Shot',
    maxPower: [10, 45, 0.5, 'max power (m/s)'],
    minPower: [0, 20, 0.5, 'min power (m/s)'],
    powerCurve: [['linear', 'eased'], 'power curve'],
    liftScale: [0.1, 1, 0.01, 'lift scale'],
    maxSpin: [0, 120, 1, 'max spin (rad/s)'],
    spinCurve: [1, 4, 0.05, 'spin curve (exp)'],
    topspin: [0, 1, 0.01, 'top/backspin share'],
    spinDecay: [0, 3, 0.01, 'spin decay (1/s)'],
  },
  physics: {
    title: 'Physics',
    gravity: [2, 20, 0.01, 'gravity'],
    airDrag: [0, 0.05, 0.0005, 'air drag'],
    magnus: [0, 0.012, 0.0001, 'Magnus strength'],
    restitution: [0, 1, 0.01, 'bounce'],
    groundFriction: [0, 10, 0.1, 'rolling friction'],
  },
  keeper: {
    title: 'Keeper',
    reactionDelay: [0, 1, 0.01, 'reaction delay (s)'],
    diveSpeed: [1, 15, 0.1, 'dive speed (m/s)'],
    reach: [0, 3.5, 0.05, 'reach (m)'],
    skillRandomness: [0, 1, 0.01, 'skill randomness'],
    perfectZone: [0, 1.5, 0.05, 'perfect zone (m)'],
    catchSpeed: [0, 35, 0.5, 'catch below (m/s)'],
    fumbleChance: [0, 0.5, 0.01, 'fumble chance'],
  },
  wall: {
    title: 'Wall',
    count: [2, 5, 1, 'defenders'],
    distance: [5, 15, 0.05, 'distance (m)'],
    height: [1.5, 2.2, 0.01, 'height (m)'],
    jumpHeight: [0, 1, 0.01, 'jump height (m)'],
    jumpTiming: [-0.2, 0.6, 0.01, 'jump timing (s)'],
  },
  camera: {
    title: 'Camera',
    height: [0.5, 8, 0.05, 'height (m)'],
    distance: [1, 15, 0.1, 'distance (m)'],
    fov: [30, 90, 1, 'field of view (°)'],
  },
  input: {
    title: 'Input',
    dragSensitivity: [0.1, 2, 0.01, 'drag sensitivity'],
    maxDragLength: [60, 500, 5, 'max drag length (px)'],
    tapOverlaySize: [120, 420, 5, 'tap overlay size (px)'],
  },
};

export function createAdminPanel() {
  const gui = new GUI({ title: 'Tuning' });
  if (window.innerWidth < 600) gui.close();

  for (const [group, spec] of Object.entries(PANEL)) {
    const folder = gui.addFolder(spec.title).close();
    for (const [key, s] of Object.entries(spec)) {
      if (key === 'title') continue;
      const ctrl = Array.isArray(s[0])
        ? folder.add(config[group], key, s[0]).name(s[1])
        : folder.add(config[group], key, s[0], s[1], s[2]).name(s[3]);
      ctrl.onChange(() => {
        saveConfig();
        notifyConfigChange(`${group}.${key}`);
      });
    }
  }

  const refresh = () => gui.controllersRecursive().forEach((c) => c.updateDisplay());

  const actions = {
    reset() {
      if (!confirm('Reset all tuning values to defaults?')) return;
      resetConfig();
      refresh();
    },
    async exportJSON() {
      const json = exportConfig();
      try {
        await navigator.clipboard.writeText(json);
        alert('Config copied to clipboard.\nPaste it into src/config.defaults.js to bake it in.');
      } catch {
        // Clipboard API needs a secure context; fall back to a copyable prompt.
        prompt('Copy the config JSON:', json);
      }
    },
    importJSON() {
      const text = prompt('Paste config JSON:');
      if (!text) return;
      try {
        importConfig(text);
        refresh();
      } catch (err) {
        alert(`Could not import: ${err.message}`);
      }
    },
  };

  const tools = gui.addFolder('Save / load');
  tools.add(actions, 'reset').name('Reset to defaults');
  tools.add(actions, 'exportJSON').name('Export JSON (copy)');
  tools.add(actions, 'importJSON').name('Import JSON (paste)');

  return gui;
}
