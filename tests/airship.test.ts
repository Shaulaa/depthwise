import { describe, expect, it } from 'vitest';
import { Airship } from '../src/world/Airship';

describe('airship fade', () => {
  it('recompiles its material when it turns see-through and when it turns solid again', () => {
    const ship = new Airship();
    const material = (ship as unknown as { material: { version: number; transparent: boolean; opacity: number } }).material;
    const start = material.version;

    ship.fadeTo(0.16, 1);
    expect(material.transparent).toBe(true);
    expect(material.opacity).toBeLessThan(1);
    const faded = material.version;
    expect(faded).toBeGreaterThan(start);

    // Staying see-through must not recompile every frame.
    ship.fadeTo(0.16, 0.016);
    expect(material.version).toBe(faded);

    for (let i = 0; i < 200; i++) ship.fadeTo(1, 0.05);
    expect(material.transparent).toBe(false);
    expect(material.opacity).toBe(1);
    expect(material.version).toBeGreaterThan(faded);
  });
});
