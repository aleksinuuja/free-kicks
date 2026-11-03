// DOM overlay: stats, hints, power label, result banner, new-spot button.

const $ = (id) => document.getElementById(id);

const el = {
  shots: $('stat-shots'),
  goals: $('stat-goals'),
  streak: $('stat-streak'),
  newSpot: $('new-spot-btn'),
  info: $('info'),
  hint: $('hint'),
  power: $('power-label'),
  result: $('result'),
  resultText: $('result-text'),
};

export const newSpotButton = el.newSpot;

export function setStats({ shots, goals, streak }) {
  el.shots.textContent = shots;
  el.goals.textContent = goals;
  el.streak.textContent = streak;
}

export function setInfo(text) {
  el.info.textContent = text;
}

let hintTimer = 0;
export function setHint(text) {
  clearTimeout(hintTimer);
  el.hint.textContent = text;
  el.hint.classList.remove('flash');
}

/** Briefly highlights a hint, then restores `restore`. */
export function flashHint(text, restore) {
  setHint(text);
  void el.hint.offsetWidth; // restart animation
  el.hint.classList.add('flash');
  hintTimer = setTimeout(() => setHint(restore), 1400);
}

export function showPower(power, x, y) {
  el.power.hidden = false;
  el.power.textContent = `${Math.round(power * 100)}%`;
  el.power.style.transform = `translate(${x}px, ${y - 64}px) translate(-50%, -50%)`;
}

export function hidePower() {
  el.power.hidden = true;
}

export function showResult(kind) {
  el.resultText.textContent = kind;
  el.result.className = kind.toLowerCase();
  el.result.hidden = false;
}

export function hideResult() {
  el.result.hidden = true;
}
