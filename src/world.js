// Static scene: renderer, lights, pitch, goal, surroundings. Plus the ball
// mesh and the small 3D helpers (aim arrow, ball ring, shot trail).

import * as THREE from 'three';
import { BALL_RADIUS, GOAL, FRAME_X, FRAME_Y } from './physics.js';

const LINE_W = 0.12;
const LINE_COLOR = 0xf2f5ef;

export function createWorld(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const scene = new THREE.Scene();
  const sky = new THREE.Color(0xa8d6f2);
  scene.background = sky;
  scene.fog = new THREE.Fog(sky, 70, 170);

  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 400);

  scene.add(new THREE.HemisphereLight(0xeef7ff, 0x4d7a3c, 1.4));
  const sun = new THREE.DirectionalLight(0xfff3dc, 2.2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -26, right: 26, top: 26, bottom: -26, near: 1, far: 100 });
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  scene.add(sun, sun.target);

  buildPitch(scene);
  buildGoal(scene);
  buildSurroundings(scene);

  return { renderer, scene, camera, sun };
}

/** Keeps the shadow frustum centred on the action. */
export function aimSun(sun, centre) {
  sun.target.position.copy(centre);
  sun.position.copy(centre).add(new THREE.Vector3(-12, 30, 14));
}

// ── Pitch ────────────────────────────────────────────────────────────────────

function buildPitch(scene) {
  // Mowing stripes: a 1×2 px texture repeated, one stripe every 5 m.
  const c = document.createElement('canvas');
  c.width = 1;
  c.height = 2;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#4e9a3b';
  ctx.fillRect(0, 0, 1, 1);
  ctx.fillStyle = '#458c34';
  ctx.fillRect(0, 1, 1, 1);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1, 12); // 120 m / 10 m per stripe pair

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(160, 120), new THREE.MeshLambertMaterial({ map: tex }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.z = 20; // spans z = -40…80, stripe edges land on the goal line
  ground.receiveShadow = true;
  scene.add(ground);

  const lineMat = new THREE.MeshLambertMaterial({ color: LINE_COLOR });
  const flat = (geo, x, z) => {
    const m = new THREE.Mesh(geo, lineMat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, 0.01, z);
    m.receiveShadow = true;
    scene.add(m);
    return m;
  };
  const hLine = (x1, x2, z) => flat(new THREE.PlaneGeometry(x2 - x1 + LINE_W, LINE_W), (x1 + x2) / 2, z);
  const vLine = (x, z1, z2) => flat(new THREE.PlaneGeometry(LINE_W, z2 - z1), x, (z1 + z2) / 2);

  hLine(-34, 34, 0); // goal line
  vLine(-34, 0, 75); // touchlines
  vLine(34, 0, 75);
  hLine(-34, 34, 52.5); // halfway line
  for (const s of [-1, 1]) {
    vLine(s * 9.16, 0, 5.5); // goal area
    vLine(s * 20.16, 0, 16.5); // penalty area
  }
  hLine(-9.16, 9.16, 5.5);
  hLine(-20.16, 20.16, 16.5);
  flat(new THREE.CircleGeometry(0.13, 16), 0, 11); // penalty spot

  // Penalty arc: radius 9.15 around the spot, outside the box only.
  const half = Math.acos(5.5 / 9.15);
  flat(
    new THREE.RingGeometry(9.15 - LINE_W / 2, 9.15 + LINE_W / 2, 48, 1, -Math.PI / 2 - half, half * 2),
    0,
    11,
  );
  // Centre circle.
  flat(new THREE.RingGeometry(9.15 - LINE_W / 2, 9.15 + LINE_W / 2, 64), 0, 52.5);
}

// ── Goal ─────────────────────────────────────────────────────────────────────

function netTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const ctx = c.getContext('2d');
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.lineWidth = 2;
  ctx.strokeRect(0, 0, 32, 32);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

function buildGoal(scene) {
  const W = FRAME_X;
  const H = FRAME_Y;
  const D = GOAL.depth;
  const r = GOAL.postRadius;

  const frameMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35 });
  const barMat = new THREE.MeshStandardMaterial({ color: 0xcfd4d8, roughness: 0.6 });
  const bar = (len, radius, material, x, y, z, rot) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, len, 12), material);
    m.position.set(x, y, z);
    if (rot === 'x') m.rotation.z = Math.PI / 2;
    if (rot === 'z') m.rotation.x = Math.PI / 2;
    m.castShadow = true;
    scene.add(m);
  };

  for (const s of [-1, 1]) {
    bar(H + r, r, frameMat, s * W, (H + r) / 2, 0); // post
    bar(H, r * 0.4, barMat, s * W, H / 2, -D); // back stanchion
    bar(D, r * 0.4, barMat, s * W, H, -D / 2, 'z'); // roof edge
    bar(D, r * 0.4, barMat, s * W, 0.02, -D / 2, 'z'); // ground bar
  }
  bar(2 * W + 2 * r, r, frameMat, 0, H, 0, 'x'); // crossbar
  bar(2 * W, r * 0.4, barMat, 0, H, -D, 'x');
  bar(2 * W, r * 0.4, barMat, 0, 0.02, -D, 'x');

  const tex = netTexture();
  const netMat = new THREE.MeshBasicMaterial({
    map: tex,
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const CELL = 0.14;
  const panel = (w, h, x, y, z, rx, ry) => {
    const geo = new THREE.PlaneGeometry(w, h);
    const uv = geo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * w) / CELL, (uv.getY(i) * h) / CELL);
    const m = new THREE.Mesh(geo, netMat);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, 0);
    m.renderOrder = 1;
    scene.add(m);
  };
  panel(2 * W, H, 0, H / 2, -D, 0, 0); // back
  panel(D, H, -W, H / 2, -D / 2, 0, Math.PI / 2); // sides
  panel(D, H, W, H / 2, -D / 2, 0, Math.PI / 2);
  panel(2 * W, D, 0, H, -D / 2, -Math.PI / 2, 0); // roof
}

// ── Surroundings: boards and stands with a blocky crowd ──────────────────────

function buildSurroundings(scene) {
  const boardColors = [0x1f4e8c, 0x2a7a5a, 0x1f4e8c, 0xe0e4e8];
  for (let i = 0; i < 16; i++) {
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(6, 0.9, 0.15),
      new THREE.MeshLambertMaterial({ color: boardColors[i % boardColors.length] }),
    );
    m.position.set(-45 + i * 6, 0.45, -5);
    scene.add(m);
  }

  const stepMat = [new THREE.MeshLambertMaterial({ color: 0x59636e }), new THREE.MeshLambertMaterial({ color: 0x4c5560 })];
  const crowdColors = [0xd8402f, 0xf2f2f2, 0x2a6fd6, 0xf2b630, 0x2f2f36, 0x3aa35b, 0xe07fa8].map(
    (c) => new THREE.Color(c),
  );
  const fanGeo = new THREE.BoxGeometry(0.42, 0.6, 0.35);
  const fans = new THREE.InstancedMesh(fanGeo, new THREE.MeshLambertMaterial(), 2600);
  let fanCount = 0;
  const m4 = new THREE.Matrix4();

  // A stand of 5 rising steps, built along +x (front row at z = 0), then placed.
  const stand = (length, x, z, rotY) => {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.rotation.y = rotY;
    g.updateMatrixWorld();
    for (let i = 0; i < 5; i++) {
      const h = 1.4 * (i + 1);
      const step = new THREE.Mesh(new THREE.BoxGeometry(length, h, 2.6), stepMat[i % 2]);
      step.position.set(0, h / 2, -i * 2.6);
      g.add(step);
      for (let fx = -length / 2 + 0.5; fx < length / 2 - 0.3; fx += 0.6) {
        if (Math.random() < 0.18 || fanCount >= fans.count) continue;
        m4.makeTranslation(fx + (Math.random() - 0.5) * 0.15, h + 0.3, -i * 2.6 + 0.2).premultiply(g.matrixWorld);
        fans.setMatrixAt(fanCount, m4);
        fans.setColorAt(fanCount, crowdColors[(Math.random() * crowdColors.length) | 0]);
        fanCount++;
      }
    }
    scene.add(g);
  };

  stand(100, 0, -9, 0); // behind the goal
  stand(90, -40, 30, Math.PI / 2); // left side
  stand(90, 40, 30, -Math.PI / 2); // right side

  fans.count = fanCount;
  fans.instanceMatrix.needsUpdate = true;
  if (fans.instanceColor) fans.instanceColor.needsUpdate = true;
  scene.add(fans);
}

// ── Ball ─────────────────────────────────────────────────────────────────────

// The ball is drawn bigger than its physics body (BALL_RADIUS) so it reads better
// on a phone screen; physics and collisions are unchanged.
export const BALL_VISUAL_RADIUS = BALL_RADIUS * 1.25;
/** Raise the mesh by this much so the bigger ball still sits on the grass. */
export const BALL_VISUAL_LIFT = BALL_VISUAL_RADIUS - BALL_RADIUS;

export function createBallMesh() {
  // Subdivided icosahedron: the triangles around the 12 original vertices form
  // dark pentagon patches.
  const geo = new THREE.IcosahedronGeometry(BALL_VISUAL_RADIUS, 2);
  const base = new THREE.IcosahedronGeometry(1, 0).attributes.position;
  const corners = [];
  for (let i = 0; i < base.count; i++) corners.push(new THREE.Vector3().fromBufferAttribute(base, i).normalize());

  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const v = new THREE.Vector3();
  const dark = new THREE.Color(0x1e2630);
  const light = new THREE.Color(0xf7f7f2);
  for (let t = 0; t < pos.count; t += 3) {
    let isPatch = false;
    for (let k = 0; k < 3 && !isPatch; k++) {
      v.fromBufferAttribute(pos, t + k).normalize();
      isPatch = corners.some((c) => c.dot(v) > 0.999);
    }
    const col = isPatch ? dark : light;
    for (let k = 0; k < 3; k++) col.toArray(colors, (t + k) * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const mesh = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.45 }),
  );
  mesh.castShadow = true;
  return mesh;
}

// ── Aim arrow (flat on the ground) ───────────────────────────────────────────

export function createAimArrow() {
  const group = new THREE.Group();
  const material = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.9,
    depthTest: false,
  });

  // Shaft: unit length along -z, starting at the origin.
  const shaftGeo = new THREE.PlaneGeometry(0.22, 1).rotateX(-Math.PI / 2).translate(0, 0, -0.5);
  const shaft = new THREE.Mesh(shaftGeo, material);

  const headShape = new THREE.Shape();
  headShape.moveTo(-0.32, 0);
  headShape.lineTo(0.32, 0);
  headShape.lineTo(0, 0.55);
  headShape.closePath();
  const head = new THREE.Mesh(new THREE.ShapeGeometry(headShape).rotateX(-Math.PI / 2), material);

  for (const m of [shaft, head]) {
    m.renderOrder = 10;
    group.add(m);
  }
  group.visible = false;

  const low = new THREE.Color(0x5be37d);
  const mid = new THREE.Color(0xffd84a);
  const high = new THREE.Color(0xff5a3c);

  return {
    group,
    /** yaw: 0 = towards -z, positive = towards +x. power: 0…1 */
    show(origin, yaw, power) {
      const start = 0.3;
      const len = 0.5 + power * 3.6;
      group.position.set(origin.x, 0.03, origin.z);
      group.rotation.y = -yaw;
      shaft.position.z = -start;
      shaft.scale.z = len;
      head.position.z = -start - len;
      if (power < 0.5) material.color.lerpColors(low, mid, power * 2);
      else material.color.lerpColors(mid, high, (power - 0.5) * 2);
      group.visible = true;
    },
    hide() {
      group.visible = false;
    },
  };
}

/** Pulsing ring around the ball to show where to start dragging. */
export function createBallRing() {
  const mesh = new THREE.Mesh(
    new THREE.RingGeometry(0.3, 0.38, 40).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false }),
  );
  mesh.renderOrder = 5;
  return {
    mesh,
    update(pos, time, visible) {
      mesh.visible = visible;
      if (!visible) return;
      mesh.position.set(pos.x, 0.02, pos.z);
      const k = (Math.sin(time * 4) + 1) / 2;
      mesh.scale.setScalar(1 + k * 0.25);
      mesh.material.opacity = 0.35 + k * 0.4;
    },
  };
}

/** Faint line showing the last shot's path. */
export function createTrail(maxPoints = 400) {
  const positions = new Float32Array(maxPoints * 3);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setDrawRange(0, 0);
  const line = new THREE.Line(
    geo,
    new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.45 }),
  );
  line.frustumCulled = false;
  let count = 0;
  return {
    line,
    reset() {
      count = 0;
      geo.setDrawRange(0, 0);
    },
    push(p) {
      if (count >= maxPoints) return;
      positions.set([p.x, p.y, p.z], count * 3);
      count++;
      geo.attributes.position.needsUpdate = true;
      geo.setDrawRange(0, count);
    },
  };
}
