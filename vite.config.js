import { defineConfig } from 'vite';

// Relative base so the build works from any GitHub Pages sub-path (user.github.io/<repo>/).
export default defineConfig({
  base: './',
  build: { chunkSizeWarningLimit: 800 }, // three.js alone is ~600 kB
});
