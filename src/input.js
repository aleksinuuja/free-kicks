// Two-step shot input:
//   1. AimInput      – pull back from the ball (slingshot): opposite direction = aim, length = power
//   2. StrikePicker  – tap an enlarged ball: where you hit it sets lift/curve

const GRAB_RADIUS = 90; // px around the ball where a drag may start
const MIN_POWER = 0.05; // shorter drags are treated as a cancel
const MAX_YAW = Math.PI / 3;

export class AimInput {
  /**
   * @param {object} o
   * @param {HTMLElement} o.element      surface to listen on
   * @param {object} o.settings          config.input (read live)
   * @param {() => {x:number,y:number}} o.getBallScreen
   * @param {(aim) => void} o.onChange   aim = { yaw, power, x, y }
   * @param {(aim|null) => void} o.onRelease
   */
  constructor(o) {
    Object.assign(this, o);
    this.enabled = false;
    this.pointerId = null;
    this.element.addEventListener('pointerdown', this.#down);
    this.element.addEventListener('pointermove', this.#move);
    this.element.addEventListener('pointerup', this.#up);
    this.element.addEventListener('pointercancel', this.#cancel);
  }

  #down = (e) => {
    if (!this.enabled || this.pointerId !== null) return;
    const ball = this.getBallScreen();
    if (Math.hypot(e.clientX - ball.x, e.clientY - ball.y) > GRAB_RADIUS) return;
    this.pointerId = e.pointerId;
    this.startX = e.clientX;
    this.startY = e.clientY;
    this.aim = null;
    this.element.setPointerCapture(e.pointerId);
  };

  #move = (e) => {
    if (e.pointerId !== this.pointerId) return;
    const dx = e.clientX - this.startX;
    const dy = e.clientY - this.startY;
    const len = Math.hypot(dx, dy);
    const power = Math.min(1, len / this.settings.maxDragLength);
    // Slingshot: pull back from the ball, the shot goes the opposite way.
    let yaw = Math.atan2(-dx, dy) * this.settings.dragSensitivity;
    yaw = Math.max(-MAX_YAW, Math.min(MAX_YAW, yaw));
    this.aim = { yaw, power, x: e.clientX, y: e.clientY };
    this.onChange(this.aim);
  };

  #up = (e) => {
    if (e.pointerId !== this.pointerId) return;
    this.pointerId = null;
    const aim = this.aim && this.aim.power >= MIN_POWER ? this.aim : null;
    this.onRelease(aim);
  };

  #cancel = (e) => {
    if (e.pointerId !== this.pointerId) return;
    this.pointerId = null;
    this.onRelease(null);
  };
}

/** Free drag used for looking around. Reports pixel deltas. */
export class OrbitInput {
  constructor({ element, canStart, onStart, onMove, onEnd }) {
    Object.assign(this, { element, canStart, onStart, onMove, onEnd });
    this.pointerId = null;
    element.addEventListener('pointerdown', (e) => {
      if (this.pointerId !== null || !this.canStart(e)) return;
      this.pointerId = e.pointerId;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      element.setPointerCapture(e.pointerId);
      this.onStart();
    });
    element.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.pointerId) return;
      this.onMove(e.clientX - this.lastX, e.clientY - this.lastY);
      this.lastX = e.clientX;
      this.lastY = e.clientY;
    });
    const end = (e) => {
      if (e.pointerId !== this.pointerId) return;
      this.pointerId = null;
      this.onEnd();
    };
    element.addEventListener('pointerup', end);
    element.addEventListener('pointercancel', end);
  }
}

/**
 * Enlarged-ball overlay. `pick()` resolves with the strike point
 * { u, v } in the unit disc (u: +right, v: +up), or null if cancelled.
 *
 * It knows nothing about the ball's motion, so a future moving-ball mode can
 * reuse it as-is (e.g. call pick() with a timeout, or move the overlay).
 */
export class StrikePicker {
  constructor(root, settings) {
    this.root = root;
    this.settings = settings;
    this.ballEl = root.querySelector('.strike-ball');
    this.marker = root.querySelector('.strike-marker');
    this.pattern = root.querySelector('.strike-pattern');
    this.resolve = null;
    this.locked = false;
    root.addEventListener('pointerdown', this.#down);
  }

  pick() {
    const size = Math.min(this.settings.tapOverlaySize, window.innerWidth * 0.82, window.innerHeight * 0.5);
    this.ballEl.style.setProperty('--size', `${size}px`);
    // Randomly turn/shift the panel pattern so it never marks the centre:
    // the strike point has to be judged by eye.
    const rnd = (n) => (Math.random() * 2 - 1) * n;
    this.pattern.setAttribute('transform', `translate(${rnd(45)} ${rnd(45)}) rotate(${rnd(180)})`);
    this.marker.hidden = true;
    this.locked = false;
    this.root.hidden = false;
    return new Promise((resolve) => (this.resolve = resolve));
  }

  #down = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!this.resolve || this.locked) return;

    const r = this.ballEl.getBoundingClientRect();
    const radius = r.width / 2;
    let u = (e.clientX - (r.left + radius)) / radius;
    let v = -(e.clientY - (r.top + radius)) / radius;
    const d = Math.hypot(u, v);
    if (d > 1.3) return this.#finish(null); // tapped well outside: cancel
    if (d > 1) {
      u /= d;
      v /= d;
    }

    this.marker.style.left = `${(u + 1) * 50}%`;
    this.marker.style.top = `${(1 - v) * 50}%`;
    this.marker.hidden = false;
    this.locked = true;
    setTimeout(() => this.#finish({ u, v }), 280);
  };

  #finish(result) {
    this.root.hidden = true;
    const resolve = this.resolve;
    this.resolve = null;
    resolve?.(result);
  }
}
