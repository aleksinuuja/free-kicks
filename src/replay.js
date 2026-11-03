// Goal replays.
//
// Every shot is recorded frame by frame (ball, keeper pose, wall jumps). After a
// goal, the recording is played back in a loop from several camera angles: real
// time at first, easing into slow motion as the ball reaches the goal. Playback
// only reads the recording, so it always shows exactly what happened (the keeper's
// random decisions are not re-rolled).

import * as THREE from 'three';
import { GOAL } from './physics.js';

const { clamp, lerp, smoothstep } = THREE.MathUtils;

const PRE_ROLL = 0.4; // s of the stationary ball before the kick
const FADE = 0.25; // s fade between angles

// ── Recorder ─────────────────────────────────────────────────────────────────

export class Recorder {
  constructor() {
    this.frames = [];
    this.events = {};
    this.t = 0;
    this.active = false;
  }

  start() {
    this.frames = [];
    this.events = {};
    this.t = 0;
    this.active = true;
  }

  stop() {
    this.active = false;
  }

  /** Marks an event (e.g. 'cross', 'fumble') at the current shot time. */
  mark(name) {
    if (this.active && !(name in this.events)) this.events[name] = this.t;
  }

  capture(dt, ballMesh, keeper, wall) {
    if (!this.active) return;
    this.t += dt;
    this.frames.push({
      t: this.t,
      p: ballMesh.position.clone(),
      q: ballMesh.quaternion.clone(),
      k: [keeper.c.x, keeper.c.y, keeper.angle, keeper.spread, keeper.forward],
      w: wall.defenders.map((d) => d.y),
    });
  }

  get duration() {
    return this.frames.length ? this.frames[this.frames.length - 1].t : 0;
  }

  /** Index i such that frames[i].t <= t < frames[i + 1].t (clamped). */
  #find(t) {
    const f = this.frames;
    let lo = 0;
    let hi = f.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (f[mid].t <= t) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  /** Ball position at shot time t. */
  ballAt(t, out) {
    const f = this.frames;
    const i = this.#find(t);
    const a = f[i];
    const b = f[Math.min(i + 1, f.length - 1)];
    const s = b.t > a.t ? clamp((t - a.t) / (b.t - a.t), 0, 1) : 0;
    return out.lerpVectors(a.p, b.p, s);
  }

  /** Puts the ball, keeper and wall where they were at shot time t. */
  restore(t, ballMesh, keeper, wall, wallCfg) {
    const f = this.frames;
    if (!f.length) return;
    const i = this.#find(t);
    const a = f[i];
    const b = f[Math.min(i + 1, f.length - 1)];
    const s = b.t > a.t ? clamp((t - a.t) / (b.t - a.t), 0, 1) : 0;

    ballMesh.position.lerpVectors(a.p, b.p, s);
    ballMesh.quaternion.slerpQuaternions(a.q, b.q, s);

    keeper.c.set(lerp(a.k[0], b.k[0], s), lerp(a.k[1], b.k[1], s));
    keeper.angle = lerp(a.k[2], b.k[2], s);
    keeper.spread = lerp(a.k[3], b.k[3], s);
    keeper.forward = lerp(a.k[4], b.k[4], s);
    keeper.apply();

    wall.defenders.forEach((d, j) => (d.y = lerp(a.w[j] ?? 0, b.w[j] ?? 0, s)));
    wall.apply(wallCfg);
  }
}

// ── Camera angles ────────────────────────────────────────────────────────────
//
// Each angle: when it starts (shot time), its field of view, and where the camera
// sits / looks given the ball position and the shot context `c`.

const GOAL_CENTRE = new THREE.Vector3(0, 1, 0);

const ANGLES = {
  // High behind the kicker: the whole curl in one frame.
  highCam: {
    start: () => -PRE_ROLL,
    fov: 40,
    place(pos, look, ball, c) {
      pos.set(c.spot.x + c.back.x * 8, 7.5, c.spot.z + c.back.z * 8);
      look.copy(GOAL_CENTRE).lerp(ball, 0.3);
    },
  },
  // Broadcast camera up in the side stand, panning with the ball.
  sideCam: {
    start: () => -PRE_ROLL,
    fov: 30,
    smooth: true,
    place(pos, look, ball, c) {
      pos.set(c.side * 27, 10, c.spot.z * 0.45 + 2);
      look.copy(ball);
    },
  },
  // Chasing the ball, stopping short of the goal to watch it go in.
  ballCam: {
    start: () => -0.2,
    fov: 55,
    place(pos, look, ball, c, st) {
      if (!st.frozen) {
        pos.copy(ball).addScaledVector(c.fwd, -3.2);
        pos.y = ball.y + 0.7;
        if (pos.z < 4) st.frozen = pos.clone();
      } else pos.copy(st.frozen);
      look.copy(ball);
    },
  },
  // Low behind the net: the ball flying at you, the keeper's dive, the net.
  netCam: {
    start: (c) => Math.max(-PRE_ROLL, c.crossT - 1.4),
    fov: 65,
    smooth: true,
    place(pos, look, ball, c) {
      // Well back (portrait screens are narrow) and high enough to see over the
      // advertising boards at z = -5; still under the net roof's line of sight.
      pos.set(clamp(c.cross.x * 0.3, -1.5, 1.5), 2.1, -GOAL.depth - 5);
      // Half on the ball, half on where it goes in, so keeper and ball share the frame.
      look.set(c.cross.x * 0.6, 1, 0).lerp(ball, 0.5);
      look.y = 1.1; // pan only: tilting down would show the boards instead of the goal
    },
  },
};

export const ANGLE_ORDER = ['highCam', 'sideCam', 'ballCam', 'netCam'];

// ── Director ─────────────────────────────────────────────────────────────────

export class ReplayDirector {
  /**
   * @param {THREE.PerspectiveCamera} camera
   * @param {Recorder} rec
   * @param {object} cfg  config.replay (read live)
   */
  constructor(camera, rec, cfg) {
    this.camera = camera;
    this.rec = rec;
    this.cfg = cfg;
    this.look = new THREE.Vector3();
    this._pos = new THREE.Vector3();
    this._target = new THREE.Vector3();
    this._ball = new THREE.Vector3();
  }

  /** @param {{x:number, z:number}} spot  where the kick was taken */
  start(spot) {
    const rec = this.rec;
    const crossT = rec.events.cross ?? rec.duration;
    const cross = rec.ballAt(crossT, new THREE.Vector3());
    const early = rec.ballAt(0.12, new THREE.Vector3());
    const fwd = new THREE.Vector3(early.x - spot.x, 0, early.z - spot.z);
    if (fwd.lengthSq() < 1e-6) fwd.set(-spot.x, 0, -spot.z);
    fwd.normalize();
    const back = new THREE.Vector3(spot.x, 0, spot.z).normalize();

    this.ctx = { spot, crossT, cross, fwd, back, side: spot.x >= 0 ? -1 : 1 };
    this.idx = -1;
    this.next();
  }

  next() {
    const enabled = ANGLE_ORDER.filter((k) => this.cfg[k]);
    const order = enabled.length ? enabled : ['netCam'];
    this.idx = (this.idx + 1) % order.length;
    this.angle = ANGLES[order[this.idx]];
    this.state = {};
    this.tau = this.angle.start(this.ctx);
    this.end = Math.min(this.ctx.crossT + this.cfg.afterGoal, this.rec.duration);
    this.real = 0;
    this.hold = 0;
    this.snap = true;
    this.cut = true; // tells the caller a new angle began (e.g. to reset the trail)
  }

  /** Playback speed at shot time t: 1 until close to the goal, then slow motion. */
  speed(t) {
    const s0 = this.ctx.crossT - this.cfg.slowmoWindow;
    return lerp(1, this.cfg.slowmo, smoothstep(t, s0 - 0.12, s0 + 0.08));
  }

  /** Advances playback; returns { tau, fade, cut } (fade: 0 = clear, 1 = black;
   *  cut: a new angle just began). */
  update(dt) {
    this.real += dt;
    if (this.tau < this.end) this.tau = Math.min(this.end, this.tau + dt * this.speed(this.tau));
    else if ((this.hold += dt) > FADE) this.next();

    const ball = this.rec.ballAt(this.tau, this._ball);
    this.angle.place(this._pos, this._target, ball, this.ctx, this.state);
    if (this.snap || !this.angle.smooth) this.look.copy(this._target);
    else this.look.lerp(this._target, 1 - Math.exp(-10 * dt));
    this.snap = false;

    const cam = this.camera;
    cam.position.copy(this._pos);
    cam.lookAt(this.look);
    cam.fov = this.angle.fov;
    cam.aspect = window.innerWidth / window.innerHeight;
    cam.updateProjectionMatrix();

    const fade = Math.max(1 - this.real / FADE, this.hold / FADE);
    const cut = this.cut;
    this.cut = false;
    return { tau: this.tau, fade: clamp(fade, 0, 1), cut };
  }
}
