// ─────────────────────────────────────────────────────────────────────────────
//  Free-kick tuning defaults
//
//  Every feel-related value in the game lives here.
//  To bake in values tuned with the admin panel (open the game with ?admin):
//    1. Press "Export JSON" in the panel (copies to clipboard)
//    2. Paste it over the object below
//
//  Units: metres, seconds, m/s, radians/s, degrees where noted.
// ─────────────────────────────────────────────────────────────────────────────

export default {
  shot: {
    maxPower: 30, // ball speed (m/s) at 100 % power
    minPower: 8, // ball speed (m/s) at 0 % power
    powerCurve: 'eased', // 'linear' | 'eased' (eased = finer control near both ends)
    // Lift follows contact geometry: centre or above = flat, below = asin(depth) × liftScale
    // (≈ 10° halfway down, 32° at the bottom edge with 0.35).
    liftScale: 0.35, // 1 = pure point-contact geometry; lower = softer, as a foot spreads the contact
    maxSpin: 86, // sidespin (rad/s) when striking the very edge of the ball
    spinCurve: 1.5, // 1 = linear; higher = little curve near the centre, lots at the edge
    topspin: 0.15, // share of maxSpin turned into top/backspin by vertical strike point
    spinDecay: 0.5, // exponential spin decay rate (1/s)
  },
  physics: {
    gravity: 9.81, // m/s²
    airDrag: 0.012, // quadratic drag coefficient (1/m)
    magnus: 0.0065, // Magnus force strength (spin × velocity)
    restitution: 0.55, // ground bounce (0 = dead, 1 = perfect)
    groundFriction: 2.5, // rolling deceleration (m/s²)
  },
  keeper: {
    reactionDelay: 0.22, // s after the kick before the keeper reads the shot
    diveSpeed: 6.5, // m/s of body travel during a dive
    reach: 2.3, // max body travel (m) from the ready position; arms add ~1 m
    skillRandomness: 0.35, // how beatable on hard shots: 0 = only the reach limit beats him, 1 = often misreads
    catchSpeed: 18, // shots slower than this (m/s) at contact are caught, faster ones are parried
    fumbleChance: 0.05, // chance a save squirms through into the net ("Fumble!")
  },
  wall: {
    count: 4, // defenders (2–5) at the default spot; "New spot" picks its own
    distance: 9.15, // m from the ball
    height: 1.85, // defender height (m)
    jumpHeight: 0.35, // m
    jumpTiming: 0.05, // s after the kick before the jump starts
  },
  camera: {
    height: 3, // m above ground
    distance: 6, // m behind the ball
    fov: 50, // vertical field of view (°)
  },
  input: {
    dragSensitivity: 0.5, // screen drag angle → shot angle multiplier
    maxDragLength: 130, // px of pull-back for 100 % power
    tapOverlaySize: 240, // px diameter of the strike-point ball
  },
};
