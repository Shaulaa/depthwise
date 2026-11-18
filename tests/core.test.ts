import { describe, expect, it } from 'vitest';
import { DayNight, PHASES, clockLabel, phaseLabel } from '../src/core/DayNight';
import { TAU, damp, fbm, formatTime, makeNoise2D, mulberry32, shortestAngle, smoothstep } from '../src/core/math';

describe('math helpers', () => {
  it('smoothstep clamps and also works as a falling ramp', () => {
    expect(smoothstep(0, 1, -1)).toBe(0);
    expect(smoothstep(0, 1, 2)).toBe(1);
    expect(smoothstep(0, 1, 0.5)).toBeCloseTo(0.5);
    expect(smoothstep(1, 0, 0.25)).toBeGreaterThan(smoothstep(1, 0, 0.75));
    expect(smoothstep(1, 0, 2)).toBe(0);
  });

  it('shortestAngle takes the short way round the circle', () => {
    expect(shortestAngle(0, Math.PI / 2)).toBeCloseTo(Math.PI / 2);
    expect(shortestAngle(0.1, TAU - 0.1)).toBeCloseTo(-0.2);
    expect(shortestAngle(TAU * 3, 0.3)).toBeCloseTo(0.3);
    expect(Math.abs(shortestAngle(0, Math.PI * 1.5))).toBeLessThanOrEqual(Math.PI);
  });

  it('damp approaches the target without overshooting, whatever the frame time', () => {
    expect(damp(0, 10, 5, 0)).toBe(0);
    expect(damp(0, 10, 5, 0.016)).toBeGreaterThan(0);
    expect(damp(0, 10, 5, 100)).toBeCloseTo(10);
    // Two half steps land where one full step does.
    expect(damp(damp(0, 10, 5, 0.05), 10, 5, 0.05)).toBeCloseTo(damp(0, 10, 5, 0.1));
  });

  it('mulberry32 is deterministic per seed and stays in [0, 1)', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const c = mulberry32(43);
    const first = [a(), a(), a()];
    expect([b(), b(), b()]).toEqual(first);
    expect([c(), c(), c()]).not.toEqual(first);
    for (let i = 0; i < 1000; i++) {
      const value = a();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('noise is repeatable, bounded and continuous', () => {
    const noise = makeNoise2D(7);
    expect(noise(1.5, 2.5)).toBe(makeNoise2D(7)(1.5, 2.5));
    for (let i = 0; i < 400; i++) {
      const value = fbm(noise, i * 0.37 - 40, i * 0.53 - 60);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
    expect(Math.abs(noise(3.2, 4.1) - noise(3.2001, 4.1))).toBeLessThan(0.01);
    // Negative coordinates must not break the lattice lookup.
    expect(Number.isFinite(noise(-1234.5, -0.25))).toBe(true);
  });

  it('formats elapsed time as m:ss.s', () => {
    expect(formatTime(0)).toBe('0:00.0');
    expect(formatTime(9.44)).toBe('0:09.4');
    expect(formatTime(75.5)).toBe('1:15.5');
    expect(formatTime(-3)).toBe('0:00.0');
  });
});

describe('day and night', () => {
  it('labels the clock and the phase of the day', () => {
    expect(clockLabel(0)).toBe('00.00');
    expect(clockLabel(0.5)).toBe('12.00');
    expect(clockLabel(0.75)).toBe('18.00');
    expect(phaseLabel(0.5)).toBe('Siang');
    expect(phaseLabel(0.95)).toBe('Malam');
    expect(phaseLabel(0.05)).toBe('Malam');
    expect(phaseLabel(0.27)).toBe('Fajar');
  });

  it('gives every preset the label it is named after', () => {
    for (const phase of PHASES) expect(phaseLabel(phase.time)).toBe(phase.label);
  });

  it('keeps light values sane through a whole day', () => {
    const day = new DayNight();
    day.paused = true;
    for (let i = 0; i < 200; i++) {
      day.time = i / 200;
      day.update(0);
      expect(day.night).toBeGreaterThanOrEqual(0);
      expect(day.night).toBeLessThanOrEqual(1);
      expect(day.lightIntensity).toBeGreaterThanOrEqual(0);
      expect(day.lightIntensity).toBeLessThan(4);
      expect(day.lightDir.length()).toBeCloseTo(1);
      // The light never drops to the horizon, so shadows stay finite.
      expect(day.lightDir.y).toBeGreaterThan(0.1);
      for (const color of [day.top, day.horizon, day.fog, day.waterDeep, day.waterShallow]) {
        expect(Number.isFinite(color.r + color.g + color.b)).toBe(true);
      }
    }
  });

  it('is bright at noon, dark at midnight, and advances when running', () => {
    const day = new DayNight();
    day.paused = true;
    day.time = 0.5;
    day.update(0);
    const noon = day.lightIntensity;
    expect(day.night).toBe(0);
    day.time = 0;
    day.update(0);
    expect(day.night).toBe(1);
    expect(day.lightIntensity).toBeLessThan(noon);

    day.paused = false;
    day.time = 0.99;
    day.update(day.dayLength * 0.02);
    expect(day.time).toBeCloseTo(0.01); // wraps past midnight
  });
});
