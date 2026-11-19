import * as THREE from 'three';

/** Seconds between readouts, so the numbers are steady enough to read. */
const INTERVAL = 0.5;

/**
 * Frame rate and render cost, shown with `?stats`. Meant for checking the game on a real phone:
 * the readout can be screenshotted and compared between devices.
 */
export class PerfStats {
  private readonly element: HTMLElement;
  private readonly gpu: string;
  private frames = 0;
  private time = 0;
  private worst = 0;
  private readonly size = new THREE.Vector2();

  constructor(private readonly renderer: THREE.WebGLRenderer) {
    // The composer renders several passes per frame; count them all rather than only the last.
    renderer.info.autoReset = false;
    const gl = renderer.getContext();
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    this.gpu = debug ? String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)) : 'GPU tidak diketahui';

    this.element = document.createElement('pre');
    this.element.className = 'perf';
    this.element.setAttribute('aria-hidden', 'true');
    document.body.append(this.element);
  }

  /** Call right before rendering a frame. */
  begin(): void {
    this.renderer.info.reset();
  }

  /** Call after rendering, with the real (unclamped) time since the last frame. */
  end(elapsed: number, pixelRatio: number): void {
    this.frames++;
    this.time += elapsed;
    this.worst = Math.max(this.worst, elapsed);
    if (this.time < INTERVAL) return;

    const fps = this.frames / this.time;
    const { calls, triangles } = this.renderer.info.render;
    const size = this.renderer.getDrawingBufferSize(this.size);
    this.element.textContent = [
      `${fps.toFixed(0)} fps  (paling lambat ${(this.worst * 1000).toFixed(0)} ms)`,
      `${calls} draw call, ${(triangles / 1000).toFixed(0)}k segitiga`,
      `resolusi ${size.x}×${size.y} @ ${pixelRatio.toFixed(2)}x`,
      this.gpu,
    ].join('\n');
    this.frames = 0;
    this.time = 0;
    this.worst = 0;
  }
}
