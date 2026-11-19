import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { mulberry32 } from '../src/core/math';
import { RAINBOW_TIME, WEATHER_KINDS, WeatherCycle, isWeatherKind } from '../src/world/Weather';
import { Wildlife, type Habitat } from '../src/world/Wildlife';

const run = (cycle: WeatherCycle, seconds: number, step = 0.1): void => {
  for (let t = 0; t < seconds; t += step) cycle.update(step);
};

describe('weather cycle', () => {
  it('starts settled on the requested kind', () => {
    const cycle = new WeatherCycle(mulberry32(1), 'hujan');
    expect(cycle.kind).toBe('hujan');
    expect(cycle.level.rain).toBe(1);
  });

  it('eases into rain instead of switching at once', () => {
    const cycle = new WeatherCycle(mulberry32(1));
    cycle.set('hujan');
    cycle.update(0.5);
    expect(cycle.level.rain).toBeGreaterThan(0);
    expect(cycle.level.rain).toBeLessThan(0.5);
    run(cycle, 30);
    expect(cycle.level.rain).toBeGreaterThan(0.95);
  });

  it('only shows a rainbow after rain clears', () => {
    const cycle = new WeatherCycle(mulberry32(2), 'mendung');
    cycle.set('cerah');
    run(cycle, 20);
    expect(cycle.rainbow).toBeLessThan(0.01);

    cycle.set('hujan', true);
    cycle.set('cerah');
    expect(cycle.rainbowDue).toBe(true);
    run(cycle, 20);
    expect(cycle.rainbow).toBeGreaterThan(0.9);
    run(cycle, RAINBOW_TIME);
    expect(cycle.rainbow).toBeLessThan(0.05);
  });

  it('changes on its own over time, but not while locked', () => {
    const free = new WeatherCycle(mulberry32(3));
    const seen = new Set<string>();
    for (let t = 0; t < 6000; t += 1) {
      const changed = free.update(1);
      if (changed) seen.add(changed);
    }
    expect(seen.size).toBeGreaterThanOrEqual(3);

    const locked = new WeatherCycle(mulberry32(3), 'kabut');
    locked.locked = true;
    run(locked, 1000, 1);
    expect(locked.kind).toBe('kabut');
  });

  it('recognises valid kinds only', () => {
    for (const kind of WEATHER_KINDS) expect(isWeatherKind(kind)).toBe(true);
    expect(isWeatherKind('salju')).toBe(false);
    expect(isWeatherKind(null)).toBe(false);
  });
});

describe('wildlife', () => {
  const flat: Habitat = {
    area: { ground: { heightAt: () => 1, rimRadius: () => 30 }, blockers: [], platforms: [] },
    origin: new THREE.Vector3(),
    spots: [
      { x: 0, z: 0 },
      { x: 12, z: 12 },
      { x: -12, z: 10 },
    ],
  };
  const calm = { rain: 0, night: 0 };

  it('flushes birds when someone walks up, and lets them land again later', () => {
    const wildlife = new Wildlife([flat], 3, 0, 7);
    const far = new THREE.Vector3(100, 0, 100);
    wildlife.update(0.1, 0, [far], calm, null);

    // Walk right through every bird's spot.
    let flushed = 0;
    for (const spot of flat.spots) {
      const me = new THREE.Vector3(spot.x, 1, spot.z);
      for (let i = 0; i < 5; i++) flushed += wildlife.update(0.1, i * 0.1, [me], calm, me);
    }
    expect(flushed).toBeGreaterThan(0);

    // Leave, and give them time to come back.
    let time = 1;
    for (let i = 0; i < 600; i++) wildlife.update(0.1, (time += 0.1), [far], calm, null);
    expect(wildlife.grounded).toBe(3);
  });

  it('keeps birds in the air while it rains', () => {
    const wildlife = new Wildlife([flat], 3, 0, 7);
    let time = 0;
    for (let i = 0; i < 400; i++) wildlife.update(0.1, (time += 0.1), [], { rain: 1, night: 0 }, null);
    expect(wildlife.grounded).toBe(0);
  });
});
