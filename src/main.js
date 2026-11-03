// Game loop and shot flow:  aim → strike → flight → result → (reset) aim

import './style.css';
import * as THREE from 'three';
import { config, onConfigChange } from './config.js';
import { createWorld, aimSun, createBallMesh, createAimArrow, createBallRing, createTrail } from './world.js';
import { Wall, Keeper } from './actors.js';
import { BallBody, stepBall, predictCrossing, GOAL_COLLIDERS, BALL_RADIUS, GOAL } from './physics.js';
import { AimInput, StrikePicker } from './input.js';
import * as hud from './hud.js';

const KEEPER_Z = 0.35; // keeper stands just in front of the goal line
const RESULT_HOLD = 1.5; // s before auto-reset
const PHYSICS_DT = 1 / 240;
const BALL_SCREEN_Y = 0.62; // where the ball sits below screen centre (0 = centre, 1 = bottom edge)
const DEFAULT_SPOT = { x: -4, z: 22 };
const HINT_AIM = 'Pull back from the ball to aim & set power';

const { degToRad, lerp, clamp } = THREE.MathUtils;

// ── Scene setup ──────────────────────────────────────────────────────────────

const canvas = document.getElementById('game');
const { renderer, scene, camera, sun } = createWorld(canvas);

const ball = new BallBody();
const ballMesh = createBallMesh();
const arrow = createAimArrow();
const ring = createBallRing();
const trail = createTrail();
scene.add(ballMesh, arrow.group, ring.mesh, trail.line);

const wall = new Wall(scene);
const keeper = new Keeper(scene);

const game = {
  phase: 'aim', // 'aim' | 'strike' | 'flight' | 'result'
  spot: { ...DEFAULT_SPOT },
  aim: null, // { yaw, power } relative to the line ball → goal centre
  keeperReacted: false,
  resultTime: 0,
  stats: { shots: 0, goals: 0, streak: 0 },
};

/** Shot direction where 0 = straight at the goal centre (-z), + = towards +x. */
const yawToGoal = (spot) => Math.atan2(-spot.x, spot.z);

// ── Layout ───────────────────────────────────────────────────────────────────

function layoutWall() {
  // The wall covers the near-post side; the keeper shades the far side.
  const side = game.spot.x >= 0 ? 1 : -1;
  wall.layout(ball.pos, new THREE.Vector3(side * 2.4, 0, 0), config.wall);
}

function layoutShot() {
  const { x, z } = game.spot;
  ball.reset(x, z);
  syncBallMesh(0);
  layoutWall();
  keeper.reset((x >= 0 ? -1 : 1) * 0.6, KEEPER_Z);
  updateCamera();
  aimSun(sun, new THREE.Vector3(x / 2, 0, z / 2));
  hud.setInfo(`Free kick · ${Math.round(Math.hypot(x, z))} m`);
}

function updateCamera() {
  const c = config.camera;
  const { x, z } = game.spot;
  const fwd = new THREE.Vector3(-x, 0, -z).normalize();
  camera.fov = c.fov;
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.position.set(x - fwd.x * c.distance, c.height, z - fwd.z * c.distance);

  // Pitch the camera down just enough that the ball sits at BALL_SCREEN_Y.
  const ballDrop = Math.atan2(c.height - BALL_RADIUS, c.distance);
  const pitch = ballDrop - Math.atan(BALL_SCREEN_Y * Math.tan(degToRad(c.fov / 2)));
  const target = camera.position.clone().addScaledVector(fwd, 10);
  target.y -= 10 * Math.tan(pitch);
  camera.lookAt(target);
  camera.updateProjectionMatrix();
}

function randomSpot() {
  for (;;) {
    const dist = 18 + Math.random() * 14; // 18–32 m from goal centre
    const ang = degToRad((Math.random() * 2 - 1) * 32);
    const spot = { x: Math.sin(ang) * dist, z: Math.cos(ang) * dist };
    const insideBox = spot.z < 17.5 && Math.abs(spot.x) < 21;
    if (!insideBox) return spot;
  }
}

// ── Flow ─────────────────────────────────────────────────────────────────────

function enterAim() {
  game.phase = 'aim';
  aimInput.enabled = true;
  hud.setHint(HINT_AIM);
}

/** Retry: always the same spot until "New spot" is pressed. */
function resetShot() {
  hud.hideResult();
  layoutShot();
  enterAim();
}

async function enterStrike() {
  game.phase = 'strike';
  aimInput.enabled = false;
  hud.setHint('');
  const strike = await strikePicker.pick();
  if (strike) kick(strike);
  else {
    arrow.hide();
    enterAim();
  }
}

function kick(strike) {
  const s = config.shot;
  const p = game.aim.power;
  const curved = s.powerCurve === 'eased' ? p * p * (3 - 2 * p) : p;
  const speed = lerp(s.minPower, s.maxPower, curved);
  // Lift from contact geometry: the kick pushes through the contact point towards the
  // ball's centre, so striking a depth d below centre launches at asin(d / R).
  // Centre or above = flat (above adds topspin instead, see below).
  const depth = clamp(-strike.v, 0, 1);
  const lift = Math.asin(depth) * s.liftScale;
  const side = Math.sign(strike.u) * Math.abs(strike.u) ** s.spinCurve;
  const yaw = yawToGoal(game.spot) + game.aim.yaw;

  const fwd = new THREE.Vector3(Math.sin(yaw), 0, -Math.cos(yaw));
  const right = new THREE.Vector3(Math.cos(yaw), 0, Math.sin(yaw));
  ball.vel.copy(fwd).multiplyScalar(Math.cos(lift) * speed).setY(Math.sin(lift) * speed);

  // Sidespin about the vertical axis: tap left (u < 0) → ω.y < 0 → bends right.
  // Top/backspin about the `right` axis: tap high → topspin (dips).
  ball.spin.set(0, side * s.maxSpin, 0).addScaledVector(right, -strike.v * s.maxSpin * s.topspin);

  wall.kick(config.wall);
  game.keeperReacted = false;
  game.phase = 'flight';
  game.stats.shots++;
  hud.setStats(game.stats);
  arrow.hide();
  trail.reset();
}

function keeperReact() {
  game.keeperReacted = true;
  const pred = predictCrossing(ball, KEEPER_Z, config);
  if (!pred) return;
  const k = config.keeper;
  const target = {
    x: clamp(pred.x + gaussian() * k.skillRandomness * 0.9, -GOAL.halfWidth - 0.6, GOAL.halfWidth + 0.6),
    y: clamp(pred.y + gaussian() * k.skillRandomness * 0.4, 0.15, GOAL.height + 0.3),
  };
  keeper.dive(target, k, pred.t);
}

function checkResult() {
  if (ball.crossed === 'goal') return finish('GOAL');
  const t = ball.touched;
  const otherwise = t.keeper ? 'SAVED' : t.wall ? 'BLOCKED' : 'MISS';
  const speed = ball.vel.length();
  if (
    ball.crossed === 'out' ||
    (ball.vel.z > 0.5 && (t.keeper || t.wall || t.post)) || // bounced back out
    (ball.onGround && speed < 0.8) ||
    ball.time > 4
  ) {
    finish(otherwise);
  }
}

function finish(kind) {
  game.phase = 'result';
  game.resultTime = 0;
  const st = game.stats;
  if (kind === 'GOAL') {
    st.goals++;
    st.streak++;
  } else st.streak = 0;
  hud.setStats(st);
  hud.showResult(kind);
}

// ── Input ────────────────────────────────────────────────────────────────────

const _proj = new THREE.Vector3();
const aimInput = new AimInput({
  element: canvas,
  settings: config.input,
  getBallScreen() {
    _proj.copy(ball.pos).project(camera);
    return { x: ((_proj.x + 1) / 2) * window.innerWidth, y: ((1 - _proj.y) / 2) * window.innerHeight };
  },
  onChange(aim) {
    arrow.show(ball.pos, yawToGoal(game.spot) + aim.yaw, aim.power);
    hud.showPower(aim.power, aim.x, aim.y);
    hud.setHint('');
  },
  onRelease(aim) {
    hud.hidePower();
    if (!aim) {
      arrow.hide();
      hud.setHint(HINT_AIM);
      return;
    }
    game.aim = aim;
    enterStrike();
  },
  onMiss() {
    hud.flashHint('Start the drag on the ball', HINT_AIM);
  },
});

const strikePicker = new StrikePicker(document.getElementById('strike-overlay'), config.input);

// Tap anywhere to retry once the result is up.
window.addEventListener('pointerdown', () => {
  if (game.phase === 'result' && game.resultTime > 0.2) resetShot();
});

// "New spot": random free-kick position. Ignored while a shot is in progress.
hud.newSpotButton.addEventListener('pointerdown', (e) => e.stopPropagation());
hud.newSpotButton.addEventListener('click', () => {
  const idle = game.phase === 'aim' && aimInput.pointerId === null;
  if (!idle && game.phase !== 'result') return;
  game.spot = randomSpot();
  trail.reset();
  resetShot();
});

// Block page scroll / pinch-zoom / double-tap zoom (lil-gui keeps its own scrolling).
document.addEventListener(
  'touchmove',
  (e) => {
    if (!e.target.closest?.('.lil-gui')) e.preventDefault();
  },
  { passive: false },
);
for (const type of ['gesturestart', 'gesturechange', 'dblclick']) {
  document.addEventListener(type, (e) => e.preventDefault());
}

// ── Config changes (admin panel) ─────────────────────────────────────────────

onConfigChange((path) => {
  if (!path || path.startsWith('camera')) updateCamera();
  if (!path || /^wall\.(count|height|distance)$/.test(path)) {
    if (game.phase === 'aim' || game.phase === 'strike') layoutWall();
    else wall.ensureBuilt(config.wall); // applied fully on next reset
  }
});

// ── Loop ─────────────────────────────────────────────────────────────────────

const _axis = new THREE.Vector3();

function syncBallMesh(dt) {
  ballMesh.position.copy(ball.pos);
  if (dt <= 0) return;
  if (ball.onGround) {
    // Roll without slipping.
    const speed = Math.hypot(ball.vel.x, ball.vel.z);
    if (speed > 0.01) {
      _axis.set(ball.vel.z, 0, -ball.vel.x).divideScalar(speed);
      ballMesh.rotateOnWorldAxis(_axis, (speed / BALL_RADIUS) * dt);
    }
  } else {
    const w = ball.spin.length();
    if (w > 0.01) ballMesh.rotateOnWorldAxis(_axis.copy(ball.spin).divideScalar(w), w * dt);
  }
}

function update(dt) {
  const flying = game.phase === 'flight' || game.phase === 'result';

  if (flying) {
    if (game.phase === 'flight' && !game.keeperReacted && ball.time >= config.keeper.reactionDelay) {
      keeperReact();
    }
    wall.update(dt, config.wall, config.physics.gravity);
    keeper.update(dt);

    const colliders = [...GOAL_COLLIDERS, ...wall.colliders, ...keeper.colliders];
    const steps = Math.ceil(dt / PHYSICS_DT);
    for (let i = 0; i < steps; i++) stepBall(ball, dt / steps, config, colliders);

    trail.push(ball.pos);
    if (game.phase === 'flight') checkResult();
  } else {
    keeper.update(dt);
  }

  if (game.phase === 'result') {
    game.resultTime += dt;
    if (game.resultTime > RESULT_HOLD) resetShot();
  }

  syncBallMesh(dt);
  ring.update(ball.pos, performance.now() / 1000, game.phase === 'aim' && aimInput.pointerId === null);
}

function resize() {
  renderer.setSize(window.innerWidth, window.innerHeight);
  updateCamera();
}
window.addEventListener('resize', resize);

let last = performance.now();
renderer.setAnimationLoop((now) => {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  update(dt);
  renderer.render(scene, camera);
});

// ── Start ────────────────────────────────────────────────────────────────────

function gaussian() {
  // Box–Muller
  return Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(2 * Math.PI * Math.random());
}

hud.setStats(game.stats);
resize();
layoutShot();
enterAim();

if (new URLSearchParams(window.location.search).has('admin')) {
  import('./admin.js').then((m) => m.createAdminPanel());
}
