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
  callout: $('callout'),
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

export function setHint(text) {
  el.hint.textContent = text;
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

/** Short label that follows a point on screen (e.g. "Fumble!" next to the keeper). */
export function showCallout(text) {
  el.callout.textContent = text;
  el.callout.hidden = false;
}

export function moveCallout(x, y) {
  el.callout.style.transform = `translate(${x + 18}px, ${y}px) translate(0, -50%)`;
}

export function hideCallout() {
  el.callout.hidden = true;
}
