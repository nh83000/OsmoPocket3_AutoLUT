import type { InputVideoTrack } from 'mediabunny';

export type VideoSupportCheck = {
  supported: boolean;
  message?: string;
};

export async function checkVideoTrackSupport(videoTrack: InputVideoTrack): Promise<VideoSupportCheck> {
  const supported = await videoTrack.canDecode();
  if (supported) return { supported: true };

  const codec = await videoTrack.getCodec();
  if (codec === 'hevc') {
    return {
      supported: false,
      message:
        "Ce navigateur ne sait pas décoder la vidéo H.265/HEVC de ce fichier. Sur Windows, installez " +
        "l'extension gratuite « HEVC Video Extensions » depuis le Microsoft Store, puis rechargez cette page.",
    };
  }

  return {
    supported: false,
    message: `Ce navigateur ne sait pas décoder le codec vidéo "${codec ?? 'inconnu'}" de ce fichier.`,
  };
}
