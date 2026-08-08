import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseCubeLut } from './cubeParser';

describe('parseCubeLut against the real DJI LUT', () => {
  it('parses the DJI D-Log M to Rec.709 LUT as a 33^3 table', () => {
    const text = readFileSync('public/luts/dji-dlogm-rec709.cube', 'utf-8');
    const result = parseCubeLut(text);

    expect(result.size).toBe(33);
    expect(result.data.length).toBe(33 * 33 * 33 * 3);
    // Première ligne de données du fichier DJI : 0.000000 0.000000 0.000000
    expect(Array.from(result.data.slice(0, 3))).toEqual([0, 0, 0]);
  });
});
