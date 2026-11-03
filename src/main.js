// Game loop and shot flow:  aim → strike → flight → result → (reset) aim

import './style.css';
import * as THREE from 'three';
import { config, onConfigChange } from './config.js';
import { createWorld, aimSun, createBallMesh, createAimArrow, createBallRing, createTrail } from './world.js';
import { Wall, Keeper } from './actors.js';
import { BallBody, stepBall, predictCrossing, GOAL_COLLIDERS, BALL_RADIUS, GOAL } from './physics.js';
import { AimInput, OrbitInput, StrikePicker } from './input.js';
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
  wallCount: null, // set by "New spot"; null = config.wall.count
  aim: null, // { yaw, power } relative to the line ball → goal centre
  keeperReacted: false,
  resultTime: 0,
  stats: { shots: 0, goals: 0, streak: 0 },
};

// Look-around: dragging the field swings the camera around the ball; it eases
// back to the normal view on release. Purely cosmetic.
const UP = new THREE.Vector3(0, 1, 0);
const ORBIT_MAX_YAW = degToRad(80);
const orbit = { yaw: 0, lift: 0, active: false };
const callout = { active: false, time: 0 }; // "Fumble!" label next to the keeper

/** Shot direction where 0 = straight at the goal centre (-z), + = towards +x. */
const yawToGoal = (spot) => Math.atan2(-spot.x, spot.z);

// ── Layout ───────────────────────────────────────────────────────────────────

function layoutWall() {
  // The wall covers the near-post side; the keeper shades the far side.
  const side = game.spot.x >= 0 ? 1 : -1;
  wall.layout(ball.pos, new THREE.Vector3(side * 2.4, 0, 0), config.wall, wallCount());
}

/** Random spots pick their own wall size; otherwise the configured one is used. */
const wallCount = () => game.wallCount ?? config.wall.count;

function layoutShot() {
  const { x, z } = game.spot;
  ball.reset(x, z);
  syncBallMesh(0);
  layoutWall();
  keeper.reset((x >= 0 ? -1 : 1) * 0.6, KEEPER_Z);
  updateCamera();
  aimSun(sun, new THREE.Vector3(x / 2, 0, z / 2));
  hud.setInfo(`Free kick · ${Math.round(Math.hypot(x, z))} m · ${wallCount()} in the wall`);
}

function updateCamera() {
  const c = config.camera;
  const { x, z } = game.spot;
  // Behind the ball looking at goal, swung around the ball by the look-around orbit.
  const fwd = new THREE.Vector3(-x, 0, -z).normalize().applyAxisAngle(UP, orbit.yaw);
  const height = c.height + orbit.lift;
  camera.fov = c.fov;
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.position.set(x - fwd.x * c.distance, height, z - fwd.z * c.distance);

  // Pitch the camera down just enough that the ball sits at BALL_SCREEN_Y.
  const ballDrop = Math.atan2(height - BALL_RADIUS, c.distance);
  const pitch = ballDrop - Math.atan(BALL_SCREEN_Y * Math.tan(degToRad(c.fov / 2)));
  const target = camera.position.clone().addScaledVector(fwd, 10);
  target.y -= 10 * Math.tan(pitch);
  camera.lookAt(target);
  camera.updateProjectionMatrix();
}

function randomSpot() {
  for (;;) {
    const dist = rand(17, 38); // m from goal centre
    const ang = degToRad(rand(-32, 32));
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
  hud.hideCallout();
  callout.active = false;
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
  game.keeperTouched = false;
  game.held = false;
  game.fumbled = false;
  game.keeperBeaten = false;
  game.punched = false;
  game.easyShot = true;
  game.shotEase = 0;
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
  const home = keeper.home;
  const target = {
    x: clamp(pred.x, -GOAL.halfWidth - 0.6, GOAL.halfWidth + 0.6),
    y: clamp(pred.y, 0.15, GOAL.height + 0.3),
  };

  // Shot quality: how close to a post (high or low doesn't matter) and how fast.
  const postGap = GOAL.halfWidth - Math.abs(pred.x); // m inside the post; negative = wide
  const placement = clamp(1 - postGap / GOAL.halfWidth, 0, 1); // 0 = centre, 1 = at the post
  const pace = clamp((pred.speed - 12) / 16, 0, 1);
  const onTarget = postGap > 0 && pred.y < GOAL.height;
  // Fumbles are only for shots he should have had: slow or central. The easier the
  // shot, the likelier (up to keeper.fumbleChance for a slow one dead centre).
  game.easyShot = pace < 0.35 || placement < 0.4;
  game.shotEase = (1 - placement) * (1 - pace);

  // Near-perfect placement always beats him: he dives short and late and can't touch it.
  if (onTarget && postGap < k.perfectZone) {
    game.keeperBeaten = true;
    keeper.dive({ x: home.x + (target.x - home.x) * 0.7, y: home.y + (target.y - home.y) * 0.7 }, k, pred.t + 0.1);
    return;
  }

  // Otherwise easy shots (difficulty < 0.15) are always read; beyond that the odds grow.
  const difficulty = placement * (0.5 + 0.5 * pace);
  const beatChance = clamp((difficulty - 0.15) / 0.7, 0, 1) * clamp(0.3 + k.skillRandomness, 0, 1);
  const beaten = Math.random() < beatChance;

  if (!beaten) {
    keeper.dive(target, k, pred.t); // good read: right place, right time (reach still limits)
    return;
  }
  // Misread: dives short and late, and now and then the wrong way.
  const f = Math.random() < 0.3 ? -0.6 : rand(0.35, 0.7);
  const misread = { x: home.x + (target.x - home.x) * f, y: home.y + (target.y - home.y) * Math.abs(f) };
  keeper.dive(misread, k, pred.t + rand(0.1, 0.25));
}

/** First touch on the keeper: fumble, solid catch, or a punch away. */
function onKeeperContact(speedBefore) {
  game.keeperTouched = true;
  const k = config.keeper;
  if (game.easyShot && Math.random() < k.fumbleChance * game.shotEase) {
    // Right place, right time... and it squirms through into the net.
    game.fumbled = true;
    ball.pos.y = Math.min(ball.pos.y, GOAL.height - 0.3);
    ball.vel.set((clamp(ball.pos.x, -3.2, 3.2) - ball.pos.x) * 3, 1, -3.5);
    ball.spin.set(0, 0, 0);
    callout.active = true;
    callout.time = 0;
    hud.showCallout('Fumble!');
    return;
  }

  // Save: slow shots are caught, hard ones fisted away; around catchSpeed it can go either way.
  const catchOdds = clamp((k.catchSpeed + 4 - speedBefore) / 8, 0, 1);
  if (Math.random() < catchOdds) {
    game.held = true; // solid save: ball stays in his grip (see update loop)
    ball.vel.set(0, 0, 0);
    ball.spin.set(0, 0, 0);
    keeper.gather();
  } else {
    // Punch: out towards the field, wide of the goal and up, then it bounces away.
    game.punched = true;
    const side = Math.sign(ball.pos.x) || (Math.random() < 0.5 ? -1 : 1);
    ball.vel.set(side * rand(2.5, 5.5), rand(2.5, 5), rand(7, 10.5));
    ball.spin.set(rand(-15, 15), rand(-15, 15), 0);
  }
  if (game.phase === 'flight') finish('SAVED');
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
    // Aim is screen-relative, so include any look-around swing of the camera.
    game.aim = { yaw: aim.yaw + orbit.yaw, power: aim.power };
    arrow.show(ball.pos, yawToGoal(game.spot) + game.aim.yaw, aim.power);
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
    enterStrike();
  },
});

// Dragging anywhere else on the field looks around (while aiming or watching the shot).
new OrbitInput({
  element: canvas,
  canStart: (e) =>
    game.phase === 'flight' || (game.phase === 'aim' && aimInput.pointerId !== e.pointerId),
  onStart() {
    orbit.active = true;
  },
  onMove(dx, dy) {
    orbit.yaw = clamp(orbit.yaw + dx * 0.006, -ORBIT_MAX_YAW, ORBIT_MAX_YAW);
    orbit.lift = clamp(orbit.lift + dy * 0.012, -config.camera.height + 0.6, 6);
  },
  onEnd() {
    orbit.active = false;
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
  game.wallCount = 2 + Math.floor(Math.random() * 4); // 2–5 defenders
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
  if (path === 'wall.count') game.wallCount = null; // the slider wins over a random spot's wall
  if (!path || /^wall\.(count|height|distance)$/.test(path)) {
    if (game.phase === 'aim' || game.phase === 'strike') layoutWall();
    else wall.ensureBuilt(config.wall, wallCount()); // applied fully on next reset
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

    // After a fumble or punch, or when beaten by a near-perfect shot, the keeper no longer touches the ball.
    const colliders = () => [...GOAL_COLLIDERS, ...wall.colliders, ...(game.fumbled || game.punched || game.keeperBeaten ? [] : keeper.colliders)];
    let active = colliders();
    const steps = Math.ceil(dt / PHYSICS_DT);
    for (let i = 0; i < steps && !game.held; i++) {
      const speedBefore = ball.vel.length();
      stepBall(ball, dt / steps, config, active);
      if (ball.touched.keeper && !game.keeperTouched) {
        onKeeperContact(speedBefore);
        active = colliders();
      }
    }
    if (game.held) keeper.holdPoint(ball.pos); // caught: ball stays in his grip

    trail.push(ball.pos);
    if (game.phase === 'flight') checkResult();
  } else {
    keeper.update(dt);
  }

  if (game.phase === 'result') {
    game.resultTime += dt;
    if (game.resultTime > RESULT_HOLD) resetShot();
  }

  if (!orbit.active && (orbit.yaw !== 0 || orbit.lift !== 0)) {
    const k = Math.exp(-3 * dt); // ease back to the normal view
    orbit.yaw = Math.abs(orbit.yaw) < 1e-4 ? 0 : orbit.yaw * k;
    orbit.lift = Math.abs(orbit.lift) < 1e-3 ? 0 : orbit.lift * k;
  }
  updateCamera();

  if (callout.active) {
    callout.time += dt;
    if (callout.time > 1.6) {
      callout.active = false;
      hud.hideCallout();
    } else {
      _proj.copy(keeper.torso.b).project(camera);
      hud.moveCallout(((_proj.x + 1) / 2) * window.innerWidth, ((1 - _proj.y) / 2) * window.innerHeight);
    }
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

function rand(a, b) {
  return a + (b - a) * Math.random();
}

hud.setStats(game.stats);
resize();
layoutShot();
enterAim();

if (new URLSearchParams(window.location.search).has('admin')) {
  import('./admin.js').then((m) => m.createAdminPanel());
}

// Dev-only handle for poking at the game from the console or test scripts (stripped from builds).
if (import.meta.env.DEV) window.__fk = { game, ball, keeper, config, onKeeperContact };
