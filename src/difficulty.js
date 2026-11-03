// Keeper difficulty: Dumbass / Normal / Super.
//
// Normal is config.keeper as tuned in the admin panel; the other two are derived
// from it, so tuning Normal moves all three. The choice is remembered per device.

const STORAGE_KEY = 'free-kicks.difficulty';

export const LEVELS = [
  { id: 'dumbass', label: 'Dumbass' },
  { id: 'normal', label: 'Normal' },
  { id: 'super', label: 'Super' },
];

// wrongWay:  chance of diving the wrong way when beaten by a more central shot.
// guessWrong: chance of guessing the wrong way on any shot, before reading it at all.
// fumbleEaseFloor: fumble odds scale with how easy the shot was (keeper.fumbleChance
//   for the easiest); a floor of 1 makes every easy shot fumble at the full chance.
const MODS = {
  dumbass: (k) => ({
    ...k,
    reactionDelay: k.reactionDelay + 0.12, // slow to read it
    diveSpeed: k.diveSpeed * 0.7,
    reach: k.reach * 0.7,
    skillRandomness: Math.min(1, k.skillRandomness + 0.45), // often beaten...
    perfectZone: k.perfectZone * 1.8,
    catchSpeed: k.catchSpeed * 0.6, // ...parries what he should catch...
    fumbleChance: 0.5, // ...and lets in half of the easy ones
    fumbleEaseFloor: 1,
    wrongWay: 0.5,
    guessWrong: 0.25, // and sometimes just guesses, wrongly
  }),
  normal: (k) => ({ ...k, wrongWay: 0.2, guessWrong: 0, fumbleEaseFloor: 0 }),
  super: (k) => ({
    ...k,
    reactionDelay: k.reactionDelay * 0.6,
    diveSpeed: k.diveSpeed * 1.25,
    reach: k.reach * 1.15,
    skillRandomness: k.skillRandomness * 0.35,
    // perfectZone unchanged: perfect shots still beat him
    catchSpeed: k.catchSpeed * 1.3,
    fumbleChance: k.fumbleChance * 0.25,
    fumbleEaseFloor: 0,
    wrongWay: 0.05,
    guessWrong: 0,
  }),
};

let current = 'normal';
try {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (MODS[saved]) current = saved;
} catch {}

export const getDifficulty = () => LEVELS.find((l) => l.id === current);

/** Cycles Dumbass → Normal → Super → Dumbass; returns the new level. */
export function nextDifficulty() {
  const i = LEVELS.findIndex((l) => l.id === current);
  current = LEVELS[(i + 1) % LEVELS.length].id;
  try {
    localStorage.setItem(STORAGE_KEY, current);
  } catch {}
  return getDifficulty();
}

/** Keeper settings for the current difficulty, derived from config.keeper. */
export const keeperSettings = (base) => MODS[current](base);
