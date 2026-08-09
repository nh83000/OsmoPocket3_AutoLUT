// src/ui/preview.ts
import { ALL_FORMATS, BlobSource, Input, VideoSample, VideoSampleSink } from 'mediabunny';
import { FrameProcessor } from '../color/frameProcessor';
import type { ParsedCubeLut } from '../lut/cubeParser';
import { checkVideoTrackSupport } from '../pipeline/hevcSupport';
import { UnsupportedVideoError } from '../pipeline/videoProcessor';

export type PreviewResult = {
  beforeCanvas: HTMLCanvasElement;
  afterCanvas: OffscreenCanvas | HTMLCanvasElement;
  /** Durée totale de la vidéo, en secondes — utile pour dimensionner un curseur de timeline. */
  duration: number;
};

/** @param timestamp - Position à prévisualiser, en secondes. Par défaut, le milieu de la vidéo. */
export async function generatePreview(
  file: File,
  lut: ParsedCubeLut,
  intensity: number,
  timestamp?: number,
): Promise<PreviewResult> {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });

  let sample: VideoSample | null = null;
  let frameProcessor: FrameProcessor | undefined;

  try {
    const videoTrack = await input.getPrimaryVideoTrack();
    if (!videoTrack) throw new Error('Aucune piste vidéo trouvée dans ce fichier.');

    const support = await checkVideoTrackSupport(videoTrack);
    if (!support.supported) throw new UnsupportedVideoError(support.message);

    const duration = await input.computeDuration();
    const previewTimestamp = timestamp ?? Math.min(1, duration / 2);

    const sink = new VideoSampleSink(videoTrack, { hardwareAcceleration: 'no-preference' });
    sample = await sink.getSample(previewTimestamp);
    if (!sample) throw new Error("Impossible d'extraire une image d'aperçu de cette vidéo.");

    // "Avant" : rendu brut tel qu'affiché normalement (image plate D-Log M), sans passer par le LUT.
    const beforeCanvas = document.createElement('canvas');
    beforeCanvas.width = await videoTrack.getDisplayWidth();
    beforeCanvas.height = await videoTrack.getDisplayHeight();
    const beforeContext = beforeCanvas.getContext('2d');
    if (!beforeContext) throw new Error("Contexte 2D indisponible pour l'aperçu.");
    sample.drawWithFit(beforeContext, { fit: 'fill' });

    frameProcessor = new FrameProcessor(await videoTrack.getCodedWidth(), await videoTrack.getCodedHeight());
    frameProcessor.setLut(lut);
    frameProcessor.setIntensity(intensity);
    await frameProcessor.process(sample);

    return { beforeCanvas, afterCanvas: frameProcessor.outputCanvas, duration };
  } finally {
    sample?.close();
    frameProcessor?.dispose();
    input.dispose();
  }
}
