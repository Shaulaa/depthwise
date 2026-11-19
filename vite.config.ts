import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base so the build works from a sub-path such as GitHub Pages (/depthwise/).
  base: './',
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 900,
    rolldownOptions: {
      output: {
        // Three.js and GSAP change far less often than the game itself. Keeping them in their own
        // chunk lets returning visitors reuse the cached copy after every deploy.
        codeSplitting: {
          groups: [{ name: 'vendor', test: /node_modules[\\/](three|gsap)[\\/]/ }],
        },
      },
    },
  },
});
