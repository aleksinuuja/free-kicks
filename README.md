# Free Kicks

Casual 3D free-kick game for mobile browsers. Three.js + Vite, no backend.

```sh
npm install
npm run dev        # http://localhost:5173 (also exposed on your LAN for phone testing)
npm run build      # static files in dist/
```

## How to play

1. **Drag from the ball**: direction = aim, length = power (arrow + % label).
2. **Tap the big ball**: low = more lift, left side = bends right, right side = bends left.
   Tap outside the ball to re-aim.
3. Tap anywhere (or wait 1.5 s) to retry. **Spot** button toggles same / random position.

## Tuning

All feel values are in [`src/config.defaults.js`](src/config.defaults.js).

- Open the game with `?admin` (e.g. `http://localhost:5173/?admin`) for a live tuning panel.
- Every change is saved to localStorage and is also used in normal (non-admin) mode.
- **Export JSON** copies the current values; paste them over the object in
  `config.defaults.js` to bake them in. **Reset to defaults** clears the saved values.

## Deploy (GitHub Pages)

Push to `main`; `.github/workflows/deploy.yml` builds and publishes `dist/`.
In the repo settings, set **Pages → Source** to **GitHub Actions**.

## Code map

| File | What |
| --- | --- |
| `src/main.js` | game loop and shot flow (aim → strike → flight → result) |
| `src/physics.js` | ball flight (gravity, drag, Magnus, spin decay) and collisions |
| `src/actors.js` | wall defenders and keeper (meshes, animation, colliders) |
| `src/world.js` | renderer, pitch, goal, stands, ball mesh, aim arrow |
| `src/input.js` | drag-to-aim and strike-point picker |
| `src/hud.js` | stats, hints, result banner |
| `src/config*.js`, `src/admin.js` | tuning config, persistence, lil-gui panel |
