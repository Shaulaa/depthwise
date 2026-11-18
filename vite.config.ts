import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base so the build works from a sub-path such as GitHub Pages (/depthwise/).
  base: './',
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 900,
  },
});
