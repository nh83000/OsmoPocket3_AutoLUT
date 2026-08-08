import { describe, expect, it } from 'vitest';
import { checkVideoTrackSupport } from './hevcSupport';
import type { InputVideoTrack } from 'mediabunny';

function fakeTrack(canDecode: boolean, codec: string | null): InputVideoTrack {
  return {
    canDecode: async () => canDecode,
    getCodec: async () => codec,
  } as unknown as InputVideoTrack;
}

describe('checkVideoTrackSupport', () => {
  it('reports supported when the browser can decode the track', async () => {
    const result = await checkVideoTrackSupport(fakeTrack(true, 'hevc'));
    expect(result.supported).toBe(true);
  });

  it('gives an actionable HEVC-specific message when unsupported', async () => {
    const result = await checkVideoTrackSupport(fakeTrack(false, 'hevc'));
    expect(result.supported).toBe(false);
    expect(result.message).toMatch(/HEVC Video Extensions/);
  });

  it('gives a generic message for other unsupported codecs', async () => {
    const result = await checkVideoTrackSupport(fakeTrack(false, 'av1'));
    expect(result.supported).toBe(false);
    expect(result.message).toMatch(/av1/);
  });
});
