import { describe, expect, it } from 'vitest';
import { resolveYuvToRgbCoefficients } from './colorSpace';

describe('resolveYuvToRgbCoefficients', () => {
  it('uses BT.709 coefficients for matrix "bt709"', () => {
    const result = resolveYuvToRgbCoefficients({ matrix: 'bt709', fullRange: false });
    expect(result.kr).toBeCloseTo(0.2126);
    expect(result.kb).toBeCloseTo(0.0722);
    expect(result.fullRange).toBe(false);
  });

  it('uses BT.601 coefficients for matrix "smpte170m"', () => {
    const result = resolveYuvToRgbCoefficients({ matrix: 'smpte170m', fullRange: false });
    expect(result.kr).toBeCloseTo(0.299);
    expect(result.kb).toBeCloseTo(0.114);
  });

  it('uses BT.2020 coefficients for matrix "bt2020-ncl"', () => {
    const result = resolveYuvToRgbCoefficients({ matrix: 'bt2020-ncl', fullRange: false });
    expect(result.kr).toBeCloseTo(0.2627);
    expect(result.kb).toBeCloseTo(0.0593);
  });

  it('defaults to BT.709 when matrix is null (most consumer H.264/H.265 footage)', () => {
    const result = resolveYuvToRgbCoefficients({ matrix: null, fullRange: null });
    expect(result.kr).toBeCloseTo(0.2126);
  });

  it('only reports fullRange true when explicitly declared true', () => {
    expect(resolveYuvToRgbCoefficients({ matrix: 'bt709', fullRange: null }).fullRange).toBe(false);
    expect(resolveYuvToRgbCoefficients({ matrix: 'bt709', fullRange: true }).fullRange).toBe(true);
  });
});
