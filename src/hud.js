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
  resultSub: $('result-sub'),
  replay: $('replay'),
  fade: $('fade'),
  again: $('again-btn'),
  replayNew: $('replay-new-btn'),
  callout: $('callout'),
};

export const newSpotButton = el.newSpot;
export const againButton = el.again;
export const replayNewButton = el.replayNew;

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

export function showResult(kind, sub = 'Tap to retry') {
  el.resultText.textContent = kind;
  el.resultSub.textContent = sub;
  el.resultSub.hidden = !sub;
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

/** Goal celebration mode: hides the in-play HUD (New spot, hints) so only the replay buttons lead on. */
export function setCelebrating(on) {
  document.body.classList.toggle('celebrating', on);
}

export function showReplay() {
  el.replay.hidden = false;
}

export function hideReplay() {
  el.replay.hidden = true;
  setFade(0);
}

/** 0 = clear, 1 = black (cuts between replay angles). */
export function setFade(f) {
  el.fade.style.opacity = f;
}
