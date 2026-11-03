// Low-poly players: the defensive wall and the goalkeeper, including their
// collision capsules and simple animation.

import * as THREE from 'three';
import { makeCapsule } from './physics.js';

const MODEL_HEIGHT = 1.8; // height the player mesh is built at, before scaling
const SHOULDER_Y = 1.48;
const SHOULDER_X = 0.3;
const ARM_LENGTH = 0.66;

const SKINS = [0xe0ac69, 0x8d5524, 0xc68642, 0xf1c27d, 0x6b4226];

const WALL_KIT = { shirt: 0xd8402f, shorts: 0xf3f3f3, socks: 0xd8402f, boots: 0x1b1b1b, hair: 0x2a1c12 };
const KEEPER_KIT = {
  shirt: 0xf2b630,
  shorts: 0x22252b,
  socks: 0xf2b630,
  boots: 0x1b1b1b,
  hair: 0x3b2a1a,
  skin: 0xc68642,
  gloves: 0x35c2f0,
};

// ── Mesh building ────────────────────────────────────────────────────────────

const materials = new Map();
function mat(color) {
  if (!materials.has(color)) {
    materials.set(color, new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.85 }));
  }
  return materials.get(color);
}

function part(parent, geometry, color, x, y, z) {
  const mesh = new THREE.Mesh(geometry, mat(color));
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  parent.add(mesh);
  return mesh;
}

const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);

/** Builds a ~1.8 m player, feet at y = 0, facing +z. */
function buildPlayer(kit) {
  const root = new THREE.Group();
  for (const s of [-1, 1]) {
    part(root, box(0.15, 0.09, 0.26), kit.boots, s * 0.11, 0.045, 0.04);
    part(root, box(0.14, 0.42, 0.15), kit.socks, s * 0.11, 0.3, 0);
    part(root, box(0.16, 0.36, 0.17), kit.skin, s * 0.11, 0.68, 0);
  }
  part(root, box(0.4, 0.22, 0.23), kit.shorts, 0, 0.92, 0);
  part(root, box(0.46, 0.56, 0.25), kit.shirt, 0, 1.25, 0);
  part(root, new THREE.IcosahedronGeometry(0.13, 1), kit.skin, 0, 1.66, 0);
  part(root, box(0.24, 0.07, 0.24), kit.hair, 0, 1.765, -0.015);

  const arms = [];
  for (const s of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(s * SHOULDER_X, SHOULDER_Y, 0);
    pivot.userData.side = s;
    part(pivot, box(0.13, 0.24, 0.14), kit.shirt, 0, -0.1, 0);
    part(pivot, box(0.1, 0.42, 0.11), kit.skin, 0, -0.4, 0);
    if (kit.gloves) part(pivot, box(0.15, 0.15, 0.12), kit.gloves, 0, -0.62, 0);
    root.add(pivot);
    arms.push(pivot);
  }
  return { root, arms };
}

/** spread: 0 = arms down, π/2 = horizontal, π = straight up. */
function setArms(arms, spread) {
  for (const a of arms) a.rotation.z = a.userData.side * spread;
}

function disposeTree(obj) {
  obj.traverse((o) => o.geometry?.dispose());
}

// ── Wall ─────────────────────────────────────────────────────────────────────

const DEFENDER_SPACING = 0.56;

export class Wall {
  constructor(scene) {
    this.group = new THREE.Group();
    scene.add(this.group);
    this.defenders = [];
    this.colliders = [];
    this.builtFor = '';
    this.kicked = false;
    this.time = 0;
  }

  /** (Re)builds the meshes if count or height changed. */
  ensureBuilt(cfg) {
    const count = Math.round(cfg.count);
    const key = `${count}/${cfg.height}`;
    if (key === this.builtFor) return;
    this.builtFor = key;

    for (const d of this.defenders) {
      this.group.remove(d.root);
      disposeTree(d.root);
    }
    this.defenders = [];
    for (let i = 0; i < count; i++) {
      const { root, arms } = buildPlayer({ ...WALL_KIT, skin: SKINS[(i * 3) % SKINS.length] });
      root.scale.setScalar(cfg.height / MODEL_HEIGHT);
      this.group.add(root);
      this.defenders.push({
        root,
        arms,
        base: new THREE.Vector3(),
        jumpAt: 0,
        y: 0,
        collider: makeCapsule('wall', 0.25, 0.35, 0.7),
      });
    }
    this.colliders = this.defenders.map((d) => d.collider);
  }

  /** Lines the wall up `cfg.distance` from the ball, on the line towards `aimPoint`. */
  layout(ballPos, aimPoint, cfg) {
    this.ensureBuilt(cfg);
    const dir = new THREE.Vector3(aimPoint.x - ballPos.x, 0, aimPoint.z - ballPos.z).normalize();
    const side = new THREE.Vector3(-dir.z, 0, dir.x);
    const centre = ballPos.clone().setY(0).addScaledVector(dir, cfg.distance);
    const n = this.defenders.length;

    this.defenders.forEach((d, i) => {
      d.base.copy(centre).addScaledVector(side, (i - (n - 1) / 2) * DEFENDER_SPACING);
      d.root.position.copy(d.base);
      d.root.rotation.y = Math.atan2(ballPos.x - d.base.x, ballPos.z - d.base.z);
    });
    this.reset(cfg);
  }

  reset(cfg) {
    this.kicked = false;
    this.time = 0;
    for (const d of this.defenders) d.y = 0;
    this.apply(cfg);
  }

  kick(cfg) {
    this.kicked = true;
    this.time = 0;
    for (const d of this.defenders) d.jumpAt = cfg.jumpTiming + Math.random() * 0.06;
  }

  update(dt, cfg, gravity) {
    if (this.kicked) {
      this.time += dt;
      const v0 = Math.sqrt(2 * gravity * cfg.jumpHeight);
      for (const d of this.defenders) {
        const t = this.time - d.jumpAt;
        d.y = t > 0 ? Math.max(0, v0 * t - 0.5 * gravity * t * t) : 0;
      }
    }
    this.apply(cfg);
  }

  apply(cfg) {
    const h = cfg.height;
    for (const d of this.defenders) {
      d.root.position.y = d.y;
      setArms(d.arms, d.y > 0 ? 0.45 : 0.12);
      d.collider.a.set(d.base.x, 0.28 + d.y, d.base.z);
      d.collider.b.set(d.base.x, h - 0.2 + d.y, d.base.z);
    }
  }
}

// ── Keeper ───────────────────────────────────────────────────────────────────
//
// The keeper is a pivot at the hips that can translate within the goal plane
// and rotate (lean) around the z axis. Local frame: +y along the body towards
// the head, +x to the keeper's side.

const HIP = 0.98;
const HAND_REACH = 1.12; // hip → hands with arms overhead
const READY_SPREAD = 0.55;
const DIVE_SPREAD = 2.85;
const GROUND_HIP = 0.3; // hip height when lying on the ground

const lerp = THREE.MathUtils.lerp;
const clamp = THREE.MathUtils.clamp;

export class Keeper {
  constructor(scene) {
    const { root, arms } = buildPlayer(KEEPER_KIT);
    root.position.y = -HIP;
    this.pivot = new THREE.Group();
    this.pivot.add(root);
    scene.add(this.pivot);
    this.arms = arms;

    this.home = new THREE.Vector2(0, HIP);
    this.c = new THREE.Vector2(); // current hip position (x, y)
    this.from = new THREE.Vector2();
    this.to = new THREE.Vector2();
    this.z = 0.35;
    this.angle = 0; // lean: 0 = upright, +π/2 = lying towards +x
    this.diveAngle = 0;
    this.spread = READY_SPREAD;
    this.phase = 'ready'; // ready → waiting → diving → falling
    this.t = 0;
    this.idle = 0;

    this.torso = makeCapsule('keeper', 0.22, 0.3, 0.6);
    this.armL = makeCapsule('keeper', 0.12, 0.3, 0.6);
    this.armR = makeCapsule('keeper', 0.12, 0.3, 0.6);
    this.colliders = [this.torso, this.armL, this.armR];
  }

  reset(x, z) {
    this.home.set(x, HIP);
    this.c.copy(this.home);
    this.z = z;
    this.angle = 0;
    this.spread = READY_SPREAD;
    this.phase = 'ready';
    this.apply();
  }

  /** Dive so the hands reach `target` ({x, y} in the keeper's plane), as far
   *  as `cfg.reach` allows, timed to finish just before `arriveIn` seconds. */
  dive(target, cfg, arriveIn = 0) {
    const dx = target.x - this.home.x;
    const dy = target.y - this.home.y;
    const lim = Math.PI / 2 + 0.1;
    const ang = clamp(Math.atan2(dx, dy), -lim, lim);
    const ax = Math.sin(ang);
    const ay = Math.cos(ang);

    // Hip position that puts the hands on the target...
    this.to.set(target.x - ax * HAND_REACH, Math.max(GROUND_HIP, target.y - ay * HAND_REACH));
    // ...limited by reach.
    const off = this.to.clone().sub(this.home);
    const dist = off.length();
    if (dist > cfg.reach) this.to.copy(this.home).addScaledVector(off, cfg.reach / dist);

    this.diveAngle = ang;
    this.from.copy(this.c);
    this.duration = Math.max(0.22, Math.min(dist, cfg.reach) / cfg.diveSpeed);
    this.phase = 'waiting';
    this.t = -Math.max(0, arriveIn - this.duration - 0.08);
  }

  update(dt) {
    this.t += dt;
    switch (this.phase) {
      case 'ready':
        this.idle += dt;
        this.c.y = this.home.y + Math.sin(this.idle * 5) * 0.015;
        break;
      case 'waiting':
        if (this.t >= 0) {
          this.phase = 'diving';
          this.t = 0;
        }
        break;
      case 'diving': {
        const p = Math.min(1, this.t / this.duration);
        const e = 1 - (1 - p) ** 3;
        this.c.lerpVectors(this.from, this.to, e);
        this.c.y += Math.sin(Math.PI * p) * 0.12;
        this.angle = this.diveAngle * e;
        this.spread = lerp(READY_SPREAD, DIVE_SPREAD, Math.min(1, p * 2));
        if (p >= 1) {
          this.phase = 'falling';
          this.t = 0;
        }
        break;
      }
      case 'falling': {
        // Land: sideways dives end lying on the grass, jumps land on the feet.
        const sideways = Math.abs(this.diveAngle) > 0.5;
        const k = 1 - Math.exp(-6 * dt);
        if (this.t > 0.15) {
          this.c.y = lerp(this.c.y, sideways ? GROUND_HIP : HIP, k);
          this.angle = lerp(this.angle, sideways ? Math.sign(this.diveAngle) * 1.5 : 0, k);
        }
        break;
      }
    }
    this.apply();
  }

  apply() {
    const { c, z } = this;
    this.pivot.position.set(c.x, c.y, z);
    this.pivot.rotation.z = -this.angle;
    setArms(this.arms, this.spread);

    // Body axis (a) and side axis (b) in world x/y.
    const ax = Math.sin(this.angle);
    const ay = Math.cos(this.angle);
    const bx = ay;
    const by = -ax;
    const toWorld = (lx, ly, out) => out.set(c.x + bx * lx + ax * ly, c.y + by * lx + ay * ly, z);

    toWorld(0, -0.8, this.torso.a);
    toWorld(0, 0.62, this.torso.b);
    const shoulderY = SHOULDER_Y - HIP;
    for (const [arm, s] of [
      [this.armL, -1],
      [this.armR, 1],
    ]) {
      toWorld(s * SHOULDER_X, shoulderY, arm.a);
      toWorld(
        s * (SHOULDER_X + ARM_LENGTH * Math.sin(this.spread)),
        shoulderY - ARM_LENGTH * Math.cos(this.spread),
        arm.b,
      );
    }
  }
}
