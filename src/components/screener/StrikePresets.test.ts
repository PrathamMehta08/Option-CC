import { describe, it, expect } from 'vitest';
import { buildStrikePresets, STRIKE_PRESET_STEPS } from './StrikePresets';

/**
 * The desktop quick-picks mean "at least this far out of the money", so each one
 * moves the near edge of the range and leaves the far edge at the board's own
 * limit. Which edge is near depends on the strategy.
 */
describe('strike quick-picks', () => {
  const bounds: [number, number] = [50, 400];

  it('moves the low edge up for a covered call, sold above spot', () => {
    const presets = buildStrikePresets(100, bounds, 'above');
    expect(presets.map((p) => p.label)).toEqual(['+5%', '+10%', '+15%', '+20%', '+25%']);
    expect(presets[0].range).toEqual([105, 400]);
    expect(presets[4].range).toEqual([125, 400]);
  });

  it('moves the high edge down for a cash-secured put, sold below spot', () => {
    const presets = buildStrikePresets(100, bounds, 'below');
    expect(presets.map((p) => p.label)).toEqual(['-5%', '-10%', '-15%', '-20%', '-25%']);
    expect(presets[0].range).toEqual([50, 95]);
    expect(presets[4].range).toEqual([50, 75]);
  });

  it('rounds to whole numbers, so a preset lands on the slider track', () => {
    // 5% above 319.97 is 335.9685, and a fractional bound leaves the thumb
    // unable to reach its own end.
    const [first] = buildStrikePresets(319.97, [100, 500], 'above');
    expect(first.range).toEqual([336, 500]);
  });

  it('never proposes a range outside the board', () => {
    // A board that stops just above spot: +25% is off the end, so it clamps.
    const presets = buildStrikePresets(100, [90, 110], 'above');
    for (const p of presets) {
      expect(p.range[0]).toBeGreaterThanOrEqual(90);
      expect(p.range[0]).toBeLessThanOrEqual(110);
      expect(p.range[0]).toBeLessThanOrEqual(p.range[1]);
    }
  });

  it('offers the same steps to both strategies, mirrored around spot', () => {
    const above = buildStrikePresets(100, bounds, 'above');
    const below = buildStrikePresets(100, bounds, 'below');
    expect(above).toHaveLength(STRIKE_PRESET_STEPS.length);
    expect(below).toHaveLength(STRIKE_PRESET_STEPS.length);
    above.forEach((a, i) => {
      expect(a.range[0] - 100).toBe(100 - below[i].range[1]);
    });
  });
});
