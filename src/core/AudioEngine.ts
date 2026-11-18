import { clamp } from './math';

/** D major pentatonic across two octaves. */
const SCALE = [293.66, 329.63, 369.99, 440.0, 493.88, 587.33, 659.25, 739.99, 880.0];

type Bus = 'music' | 'sfx';

/**
 * Everything you hear is synthesised here with the Web Audio API: a drifting pad, wind,
 * a sparse generative melody, the airship engine and all sound effects. No audio files.
 */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private buses: Record<Bus, GainNode> | null = null;
  private echo: GainNode | null = null;
  private engine: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private muted = false;
  private nextNote = 3;
  private degree = 3;
  private clock = 0;

  /** Call from a user gesture; browsers refuse to start audio otherwise. */
  start(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const Ctor: typeof AudioContext | undefined =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;

    try {
      const ctx = new Ctor();
      this.ctx = ctx;

      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -14;
      limiter.ratio.value = 6;
      limiter.connect(ctx.destination);

      const master = ctx.createGain();
      master.gain.value = this.muted ? 0 : 0.85;
      master.connect(limiter);
      this.master = master;

      const music = ctx.createGain();
      music.gain.value = 0.55;
      music.connect(master);
      const sfx = ctx.createGain();
      sfx.gain.value = 0.8;
      sfx.connect(master);
      this.buses = { music, sfx };

      // Feedback delay for a sense of open air.
      const delay = ctx.createDelay(1);
      delay.delayTime.value = 0.36;
      const feedback = ctx.createGain();
      feedback.gain.value = 0.34;
      const damping = ctx.createBiquadFilter();
      damping.type = 'lowpass';
      damping.frequency.value = 2100;
      const send = ctx.createGain();
      send.gain.value = 0.5;
      send.connect(delay);
      delay.connect(damping);
      damping.connect(feedback);
      feedback.connect(delay);
      damping.connect(master);
      this.echo = send;

      this.noise = this.makeNoise(ctx);
      this.startPad(ctx, music);
      this.startWind(ctx, music);
      this.engine = this.startEngine(ctx, music);
    } catch {
      this.ctx = null; // Audio is a nicety; the experience works without it.
    }
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.ctx && this.master) {
      this.master.gain.setTargetAtTime(muted ? 0 : 0.85, this.ctx.currentTime, 0.06);
    }
  }

  suspend(): void {
    void this.ctx?.suspend();
  }

  resume(): void {
    void this.ctx?.resume();
  }

  /** Drives the generative melody and the engine hum. */
  update(dt: number, night: number, shipSpeed: number): void {
    if (!this.ctx || !this.engine) return;
    this.clock += dt;
    this.engine.gain.setTargetAtTime(clamp(shipSpeed / 18, 0, 1) * 0.07, this.ctx.currentTime, 0.25);

    if (this.clock < this.nextNote) return;
    // Wander up and down the scale; nights are slower and sit lower.
    this.degree = clamp(this.degree + Math.round((Math.random() - 0.5) * 4), 0, SCALE.length - 1);
    const octave = night > 0.6 ? 0.5 : 1;
    this.bell((SCALE[this.degree] as number) * octave, 0.05, 2.4, 'music');
    this.nextNote = this.clock + (2.2 + Math.random() * 3.4) * (1 + night * 0.7);
  }

  // ------------------------------------------------------------ sound effects

  click(): void {
    this.tone('sine', 620, 880, 0.06, 0.07);
  }

  tick(final = false): void {
    this.tone('triangle', final ? 1040 : 520, final ? 1040 : 520, final ? 0.32 : 0.1, 0.12);
  }

  slide(): void {
    this.burst(900, 0.09, 0.13);
    this.tone('sine', 170, 110, 0.09, 0.14);
  }

  /** Lantern tones, one per lantern. */
  note(index: number): void {
    this.bell(SCALE[clamp(index, 0, 4)] as number, 0.17, 1.0, 'sfx');
  }

  /** A climbing chime: each call in a streak rings higher. */
  chime(step: number): void {
    this.bell(SCALE[clamp(step, 0, SCALE.length - 1)] as number, 0.14, 1.5, 'sfx');
  }

  miss(): void {
    this.tone('triangle', 170, 105, 0.2, 0.12);
  }

  fail(): void {
    this.tone('sawtooth', 124, 96, 0.36, 0.07);
    this.tone('sawtooth', 131, 101, 0.36, 0.07);
  }

  success(): void {
    [0, 2, 3, 5, 7, 8].forEach((degree, i) => {
      this.bell(SCALE[degree] as number, 0.13, 1.8, 'sfx', i * 0.085);
    });
  }

  /** The thud of a rubber stamp. */
  stamp(): void {
    this.burst(240, 0.14, 0.5);
    this.tone('sine', 120, 52, 0.16, 0.4);
  }

  /** A soft footfall on grass or stone. */
  step(): void {
    this.burst(420 + Math.random() * 260, 0.06, 0.05);
  }

  /** A springy little jump. */
  hop(): void {
    this.tone('sine', 330, 560, 0.14, 0.06);
  }

  /** Feet back on the ground. */
  land(): void {
    this.burst(260, 0.1, 0.12);
  }

  /** Air rushing past, lasting roughly `duration` seconds. */
  whoosh(duration: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.buses || !this.noise) return;
    const now = ctx.currentTime;
    const source = ctx.createBufferSource();
    source.buffer = this.noise;
    source.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 0.9;
    filter.frequency.setValueAtTime(320, now);
    filter.frequency.linearRampToValueAtTime(1300, now + duration * 0.45);
    filter.frequency.linearRampToValueAtTime(380, now + duration);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(0.09, now + duration * 0.35);
    gain.gain.linearRampToValueAtTime(0.0001, now + duration);
    source.connect(filter).connect(gain).connect(this.buses.sfx);
    source.start(now);
    source.stop(now + duration + 0.05);
  }

  // ------------------------------------------------------------ building blocks

  private bell(frequency: number, level: number, duration: number, bus: Bus, delay = 0): void {
    const ctx = this.ctx;
    if (!ctx || !this.buses) return;
    const start = ctx.currentTime + delay;
    const envelope = ctx.createGain();
    envelope.gain.setValueAtTime(0.0001, start);
    envelope.gain.exponentialRampToValueAtTime(level, start + 0.008);
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    envelope.connect(this.buses[bus]);
    if (this.echo) envelope.connect(this.echo);

    // A fundamental plus two quiet partials reads as a soft bell.
    for (const [ratio, amount] of [
      [1, 1],
      [2, 0.32],
      [3.01, 0.11],
    ] as const) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = frequency * ratio;
      const partial = ctx.createGain();
      partial.gain.value = amount;
      osc.connect(partial).connect(envelope);
      osc.start(start);
      osc.stop(start + duration + 0.05);
    }
  }

  private tone(type: OscillatorType, from: number, to: number, duration: number, level: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.buses) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(from, now);
    osc.frequency.exponentialRampToValueAtTime(Math.max(to, 1), now + duration);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(level, now + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = type === 'sawtooth' ? 620 : 6000;
    osc.connect(filter).connect(gain).connect(this.buses.sfx);
    osc.start(now);
    osc.stop(now + duration + 0.05);
  }

  private burst(frequency: number, duration: number, level: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.buses || !this.noise) return;
    const now = ctx.currentTime;
    const source = ctx.createBufferSource();
    source.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = frequency;
    filter.Q.value = 0.8;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(level, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    source.connect(filter).connect(gain).connect(this.buses.sfx);
    source.start(now, Math.random());
    source.stop(now + duration + 0.05);
  }

  private makeNoise(ctx: AudioContext): AudioBuffer {
    const buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  private startPad(ctx: AudioContext, out: AudioNode): void {
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 640;
    const gain = ctx.createGain();
    gain.gain.value = 0.045;
    filter.connect(gain).connect(out);

    const sweep = ctx.createOscillator();
    sweep.frequency.value = 0.06;
    const depth = ctx.createGain();
    depth.gain.value = 260;
    sweep.connect(depth).connect(filter.frequency);
    sweep.start();

    for (const frequency of [146.83, 220.0, 369.99]) {
      for (const detune of [-6, 7]) {
        const osc = ctx.createOscillator();
        osc.type = 'triangle';
        osc.frequency.value = frequency;
        osc.detune.value = detune;
        osc.connect(filter);
        osc.start();
      }
    }
  }

  private startWind(ctx: AudioContext, out: AudioNode): void {
    const source = ctx.createBufferSource();
    source.buffer = this.noise;
    source.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 480;
    filter.Q.value = 0.5;
    const gain = ctx.createGain();
    gain.gain.value = 0.05;
    const gust = ctx.createOscillator();
    gust.frequency.value = 0.09;
    const depth = ctx.createGain();
    depth.gain.value = 0.028;
    gust.connect(depth).connect(gain.gain);
    gust.start();
    source.connect(filter).connect(gain).connect(out);
    source.start();
  }

  private startEngine(ctx: AudioContext, out: AudioNode): GainNode {
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 210;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    filter.connect(gain).connect(out);
    for (const frequency of [55, 82.6]) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = frequency;
      osc.connect(filter);
      osc.start();
    }
    return gain;
  }
}
