import '@fontsource/shippori-mincho/latin-500.css';
import '@fontsource/shippori-mincho/latin-700.css';
import '@fontsource/shippori-mincho/latin-800.css';
import '@fontsource-variable/figtree/wght.css';
import './styles.css';
import { App } from './App';

const canvas = document.getElementById('scene');

try {
  if (!(canvas instanceof HTMLCanvasElement)) throw new Error('Canvas element #scene is missing.');
  const app = new App(canvas);
  app.run();
  // Handy for poking at the scene from the console; stripped from production builds.
  if (import.meta.env.DEV) (window as unknown as { depthwise: App }).depthwise = app;
} catch (error) {
  console.error(error);
  // Most likely WebGL is disabled or unsupported. Say so instead of leaving a dead button.
  const label = document.getElementById('start-label');
  const note = document.querySelector('.title__note');
  if (label) label.textContent = 'Tidak bisa dimulai';
  if (note) note.textContent = 'Browser ini tidak bisa menjalankan WebGL. Coba browser lain atau nyalakan akselerasi grafis.';
}
