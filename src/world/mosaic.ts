import { TAU, mulberry32 } from '../core/math';

/** Tiles per side of the Pulau Ubin mosaic. */
export const MOSAIC_SIZE = 3;

/**
 * Paints the mosaic of Pulau Ubin: a dusk sky over the archipelago.
 * The sliding puzzle cuts it into tiles; the plaza shows it whole once it has been restored.
 *
 * @param numbered Draw a small numeral in each tile, so tiles can be told apart without
 *   relying on the picture alone.
 */
export function drawMosaic(numbered: boolean): HTMLCanvasElement {
  const size = 768;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const g = canvas.getContext('2d');
  if (!g) return canvas;
  const rng = mulberry32(88);

  const sky = g.createLinearGradient(0, 0, 0, size);
  sky.addColorStop(0, '#1d2560');
  sky.addColorStop(0.36, '#6b4a94');
  sky.addColorStop(0.66, '#ef8459');
  sky.addColorStop(1, '#ffd9a3');
  g.fillStyle = sky;
  g.fillRect(0, 0, size, size);

  g.fillStyle = 'rgba(255,255,255,0.85)';
  for (let i = 0; i < 70; i++) {
    const r = 0.8 + rng() * 2;
    g.beginPath();
    g.arc(rng() * size, rng() * size * 0.42, r, 0, TAU);
    g.fill();
  }

  const sun = g.createRadialGradient(400, 468, 10, 400, 468, 170);
  sun.addColorStop(0, '#fff6d6');
  sun.addColorStop(0.7, '#ffc27a');
  sun.addColorStop(1, 'rgba(255,170,100,0)');
  g.fillStyle = sun;
  g.beginPath();
  g.arc(400, 468, 170, 0, TAU);
  g.fill();

  const cloud = (x: number, y: number, w: number, alpha: number): void => {
    g.fillStyle = `rgba(255,236,224,${alpha})`;
    for (let i = 0; i < 5; i++) {
      g.beginPath();
      g.ellipse(x + (i - 2) * w * 0.22, y + Math.sin(i * 1.7) * 6, w * 0.24, w * 0.085, 0, 0, TAU);
      g.fill();
    }
  };
  cloud(170, 330, 260, 0.5);
  cloud(610, 250, 220, 0.42);
  cloud(360, 660, 420, 0.55);
  cloud(90, 580, 240, 0.4);

  const island = (x: number, y: number, w: number, grass: string, rock: string): void => {
    g.fillStyle = rock;
    g.beginPath();
    g.moveTo(x - w / 2, y);
    g.lineTo(x + w / 2, y);
    g.lineTo(x + w * 0.16, y + w * 0.5);
    g.lineTo(x - w * 0.04, y + w * 0.78);
    g.lineTo(x - w * 0.2, y + w * 0.42);
    g.closePath();
    g.fill();
    g.fillStyle = grass;
    g.beginPath();
    g.ellipse(x, y, w / 2, w * 0.1, 0, 0, TAU);
    g.fill();
  };
  island(160, 150, 210, '#3f9a78', '#2a2456');
  island(600, 520, 250, '#2f8a6c', '#332a5c');
  island(250, 520, 130, '#4aa884', '#3a2f62');

  // Lighthouse on the big island.
  g.fillStyle = '#f6eede';
  g.fillRect(636, 440, 18, 72);
  g.fillStyle = '#e0583d';
  g.fillRect(636, 462, 18, 14);
  g.fillRect(631, 428, 28, 14);
  g.fillStyle = '#fff3c4';
  g.beginPath();
  g.arc(645, 434, 7, 0, TAU);
  g.fill();

  // Airship.
  g.save();
  g.translate(440, 250);
  g.rotate(-0.08);
  g.fillStyle = '#f4ead2';
  g.beginPath();
  g.ellipse(0, 0, 118, 44, 0, 0, TAU);
  g.fill();
  g.fillStyle = '#e0583d';
  for (const x of [-62, 0, 62]) {
    g.beginPath();
    g.ellipse(x, 0, 15, 43 * Math.sqrt(1 - (x / 118) ** 2), 0, 0, TAU);
    g.fill();
  }
  g.fillStyle = '#27325a';
  g.beginPath();
  g.moveTo(-104, -8);
  g.lineTo(-146, -40);
  g.lineTo(-128, 0);
  g.lineTo(-146, 40);
  g.lineTo(-104, 8);
  g.closePath();
  g.fill();
  g.fillStyle = '#8a5d3f';
  g.fillRect(-36, 54, 76, 22);
  g.strokeStyle = '#5e3f2c';
  g.lineWidth = 3;
  for (const x of [-30, 34]) {
    g.beginPath();
    g.moveTo(x, 40);
    g.lineTo(x, 56);
    g.stroke();
  }
  g.restore();

  g.strokeStyle = 'rgba(244,234,210,0.9)';
  g.lineWidth = 8;
  g.strokeRect(20, 20, size - 40, size - 40);

  if (numbered) {
    const cell = size / MOSAIC_SIZE;
    g.font = '600 34px "Figtree Variable", system-ui, sans-serif';
    g.textBaseline = 'top';
    for (let i = 0; i < MOSAIC_SIZE * MOSAIC_SIZE; i++) {
      const x = (i % MOSAIC_SIZE) * cell + 34;
      const y = Math.floor(i / MOSAIC_SIZE) * cell + 32;
      g.fillStyle = 'rgba(20,24,56,0.45)';
      g.fillText(String(i + 1), x + 2, y + 2);
      g.fillStyle = 'rgba(255,248,232,0.92)';
      g.fillText(String(i + 1), x, y);
    }
  }
  return canvas;
}
