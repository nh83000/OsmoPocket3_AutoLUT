import { describe, expect, it } from 'vitest';
import { parseCubeLut } from './cubeParser';

const MINIMAL_2X2X2_CUBE = `
# Commentaire à ignorer
TITLE "Test"
LUT_3D_SIZE 2

0.0 0.0 0.0
1.0 0.0 0.0
0.0 1.0 0.0
1.0 1.0 0.0
0.0 0.0 1.0
1.0 0.0 1.0
0.0 1.0 1.0
1.0 1.0 1.0
`;

describe('parseCubeLut', () => {
  it('parses a minimal valid 2x2x2 cube', () => {
    const result = parseCubeLut(MINIMAL_2X2X2_CUBE);
    expect(result.size).toBe(2);
    expect(result.data.length).toBe(2 * 2 * 2 * 3);
    expect(Array.from(result.data.slice(0, 3))).toEqual([0, 0, 0]);
    expect(Array.from(result.data.slice(-3))).toEqual([1, 1, 1]);
    expect(result.domainMin).toEqual([0, 0, 0]);
    expect(result.domainMax).toEqual([1, 1, 1]);
  });

  it('parses custom DOMAIN_MIN/DOMAIN_MAX', () => {
    const withDomain = `LUT_3D_SIZE 2\nDOMAIN_MIN 0.1 0.1 0.1\nDOMAIN_MAX 0.9 0.9 0.9\n${MINIMAL_2X2X2_CUBE.split('\n').slice(5).join('\n')}`;
    const result = parseCubeLut(withDomain);
    expect(result.domainMin).toEqual([0.1, 0.1, 0.1]);
    expect(result.domainMax).toEqual([0.9, 0.9, 0.9]);
  });

  it('throws when LUT_3D_SIZE is missing', () => {
    expect(() => parseCubeLut('0.0 0.0 0.0\n1.0 1.0 1.0')).toThrow(/LUT_3D_SIZE/);
  });

  it('throws when the data row count does not match LUT_3D_SIZE', () => {
    expect(() => parseCubeLut('LUT_3D_SIZE 2\n0.0 0.0 0.0\n1.0 1.0 1.0')).toThrow(/invalide/);
  });

  it('throws on a malformed data row', () => {
    expect(() => parseCubeLut('LUT_3D_SIZE 2\nnot a number here\n' + '0 0 0\n'.repeat(7))).toThrow(
      /Ligne de données invalide/,
    );
  });

  it('throws on LUT_1D_SIZE (1D LUTs unsupported)', () => {
    expect(() => parseCubeLut('LUT_1D_SIZE 2\n0 0 0\n1 1 1')).toThrow(/LUT 1D/);
  });
});
