// Custom ball physics: gravity, quadratic air drag, Magnus force from spin,
// spin decay, and simple sphere-vs-capsule / plane collisions.
//
// World coordinates: metres. The goal line is z = 0, the goal is centred on
// x = 0 and the net extends into negative z. The pitch is +z, y is up.

import * as THREE from 'three';

export const BALL_RADIUS = 0.11;

export const GOAL = {
  halfWidth: 3.66, // inner half-width (7.32 m goal)
  height: 2.44, // inner height
  postRadius: 0.06,
  depth: 2.0, // net depth
};

// Centre lines of the posts / crossbar.
export const FRAME_X = GOAL.halfWidth + GOAL.postRadius;
export const FRAME_Y = GOAL.height + GOAL.postRadius;

const R = BALL_RADIUS;

/** Collider: capsule from `a` to `b` with radius `r`. `kind` is recorded on hit. */
export function makeCapsule(kind, r, restitution, friction) {
  return { kind, r, restitution, friction, a: new THREE.Vector3(), b: new THREE.Vector3() };
}

function capsule(kind, a, b) {
  const c = makeCapsule(kind, GOAL.postRadius, 0.7, 0.9);
  c.a.copy(a);
  c.b.copy(b);
  return c;
}

export const GOAL_COLLIDERS = [
  capsule('post', new THREE.Vector3(-FRAME_X, 0, 0), new THREE.Vector3(-FRAME_X, FRAME_Y, 0)),
  capsule('post', new THREE.Vector3(FRAME_X, 0, 0), new THREE.Vector3(FRAME_X, FRAME_Y, 0)),
  capsule('post', new THREE.Vector3(-FRAME_X, FRAME_Y, 0), new THREE.Vector3(FRAME_X, FRAME_Y, 0)),
];

export class BallBody {
  constructor() {
    this.pos = new THREE.Vector3();
    this.prev = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.spin = new THREE.Vector3(); // angular velocity (rad/s)
    this.reset(0, 20);
  }

  reset(x, z) {
    this.pos.set(x, R, z);
    this.prev.copy(this.pos);
    this.vel.set(0, 0, 0);
    this.spin.set(0, 0, 0);
    this.time = 0;
    this.onGround = true;
    this.touched = { wall: false, keeper: false, post: false, net: false };
    this.crossed = null; // null | 'goal' | 'out'
  }

  copyFrom(o) {
    this.pos.copy(o.pos);
    this.vel.copy(o.vel);
    this.spin.copy(o.spin);
    this.onGround = o.onGround;
    return this;
  }
}

// ── Integration ──────────────────────────────────────────────────────────────

const _acc = new THREE.Vector3();
const _magnus = new THREE.Vector3();

function integrate(b, dt, cfg) {
  const { gravity, airDrag, magnus } = cfg.physics;
  const v = b.vel;
  const speed = v.length();

  _acc.set(0, -gravity, 0);
  _acc.addScaledVector(v, -airDrag * speed); // drag ∝ v²
  _magnus.crossVectors(b.spin, v).multiplyScalar(magnus); // Magnus ∝ ω × v
  _acc.add(_magnus);

  v.addScaledVector(_acc, dt);
  b.pos.addScaledVector(v, dt);

  // Spin decays over flight time; much faster once the ball is on the grass.
  const decay = cfg.shot.spinDecay + (b.onGround ? 6 : 0);
  b.spin.multiplyScalar(Math.exp(-decay * dt));
}

function collideGround(b, dt, cfg) {
  if (b.pos.y < R) {
    b.pos.y = R;
    if (b.vel.y < 0) {
      const impact = -b.vel.y;
      b.vel.y = impact * cfg.physics.restitution;
      if (b.vel.y < 0.5) b.vel.y = 0; // settle instead of micro-bouncing
      const grip = 1 - 0.15 * Math.min(1, impact / 5); // grass grabs on hard bounces
      b.vel.x *= grip;
      b.vel.z *= grip;
    }
  }
  b.onGround = b.pos.y <= R + 1e-4 && b.vel.y === 0;

  if (b.onGround) {
    const h = Math.hypot(b.vel.x, b.vel.z);
    if (h > 0) {
      const s = Math.max(0, h - cfg.physics.groundFriction * dt) / h;
      b.vel.x *= s;
      b.vel.z *= s;
    }
  }
}

// ── Collisions ───────────────────────────────────────────────────────────────

const _closest = new THREE.Vector3();
const _ab = new THREE.Vector3();
const _n = new THREE.Vector3();

function collideCapsule(b, c) {
  _ab.subVectors(c.b, c.a);
  const len2 = _ab.lengthSq();
  const t = len2 > 0 ? THREE.MathUtils.clamp(_n.subVectors(b.pos, c.a).dot(_ab) / len2, 0, 1) : 0;
  _closest.copy(c.a).addScaledVector(_ab, t);

  _n.subVectors(b.pos, _closest);
  const dist = _n.length();
  const minDist = c.r + R;
  if (dist >= minDist) return false;

  if (dist < 1e-6) _n.set(0, 0, 1);
  else _n.divideScalar(dist);
  b.pos.copy(_closest).addScaledVector(_n, minDist);

  const vn = b.vel.dot(_n);
  if (vn < 0) {
    b.vel.addScaledVector(_n, -vn); // strip normal component
    b.vel.multiplyScalar(c.friction); // lose some tangential speed
    b.vel.addScaledVector(_n, -vn * c.restitution); // bounce
  }
  b.spin.multiplyScalar(0.4);
  return true;
}

// Net: an open-fronted box behind the goal line. Uses the previous position to
// know which side of each panel the ball came from.
const NET_E = 0.12;
const NET_DAMP = 0.45;

function collideNet(b) {
  const p = b.pos;
  const q = b.prev;
  const v = b.vel;
  const W = FRAME_X;
  const H = FRAME_Y;
  const D = GOAL.depth;
  let hit = false;

  const inDepth = p.z < 0 && p.z > -D;

  // Back panel (from inside).
  if (q.z > -D + R && p.z <= -D + R && Math.abs(p.x) < W && p.y < H) {
    p.z = -D + R;
    v.z = -v.z * NET_E;
    hit = true;
  }

  // Side panels (from inside or outside).
  if (inDepth && p.y < H) {
    for (const s of [-1, 1]) {
      const was = s * q.x;
      const now = s * p.x;
      if (was < W - R && now >= W - R) {
        p.x = s * (W - R);
        v.x = -v.x * NET_E;
        hit = true;
      } else if (was > W + R && now <= W + R) {
        p.x = s * (W + R);
        v.x = -v.x * NET_E;
        hit = true;
      }
    }
  }

  // Roof (from below or above).
  if (inDepth && Math.abs(p.x) < W) {
    if (q.y < H - R && p.y >= H - R) {
      p.y = H - R;
      v.y = -v.y * NET_E;
      hit = true;
    } else if (q.y > H + R && p.y <= H + R) {
      p.y = H + R;
      v.y = -v.y * 0.3;
      hit = true;
    }
  }

  if (hit) {
    v.multiplyScalar(NET_DAMP);
    b.spin.multiplyScalar(0.3);
  }
  return hit;
}

// ── Public API ───────────────────────────────────────────────────────────────

/** Advances the ball by one (small) step and records what it touched. */
export function stepBall(b, dt, cfg, colliders) {
  b.prev.copy(b.pos);
  b.time += dt;

  integrate(b, dt, cfg);
  collideGround(b, dt, cfg);

  for (const c of colliders) {
    if (collideCapsule(b, c)) b.touched[c.kind] = true;
  }
  if (collideNet(b)) b.touched.net = true;

  // Whole ball over the goal line?
  if (b.crossed === null) {
    if (b.prev.z >= -R && b.pos.z < -R) {
      b.crossed = Math.abs(b.pos.x) < FRAME_X && b.pos.y < FRAME_Y ? 'goal' : 'out';
    } else if (Math.abs(b.pos.x) > 45 || b.pos.z > 70) {
      b.crossed = 'out';
    }
  }
}

const _sim = new BallBody();

/** Predicts where the ball (ignoring players) will cross the plane z = planeZ.
 *  Returns { x, y, t } or null if it won't get there within 3 s. */
export function predictCrossing(b, planeZ, cfg) {
  if (b.vel.z >= 0) return null;
  const sim = _sim.copyFrom(b);
  const dt = 1 / 120;
  for (let t = 0; t < 3; t += dt) {
    integrate(sim, dt, cfg);
    collideGround(sim, dt, cfg);
    if (sim.pos.z <= planeZ) return { x: sim.pos.x, y: sim.pos.y, t };
    if (sim.vel.z >= 0) return null;
  }
  return null;
}
