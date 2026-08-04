// src/ui/preview.ts
import { ALL_FORMATS, BlobSource, Input, VideoSampleSink } from 'mediabunny';
import { FrameProcessor } from '../color/frameProcessor';
import type { ParsedCubeLut } from '../lut/cubeParser';

export type PreviewResult = {
  beforeCanvas: HTMLCanvasElement;
  afterCanvas: OffscreenCanvas | HTMLCanvasElement;
};

export async function generatePreview(file: File, lut: ParsedCubeLut): Promise<PreviewResult> {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  const videoTrack = await input.getPrimaryVideoTrack();
  if (!videoTrack) throw new Error('Aucune piste vidéo trouvée dans ce fichier.');

  const duration = await input.computeDuration();
  const previewTimestamp = Math.min(1, duration / 2);

  const sink = new VideoSampleSink(videoTrack, { hardwareAcceleration: 'prefer-hardware' });
  const sample = await sink.getSample(previewTimestamp);
  if (!sample) throw new Error("Impossible d'extraire une image d'aperçu de cette vidéo.");

  // "Avant" : rendu tel-quel via le chemin d'affichage standard du navigateur — c'est voulu ici,
  // on veut montrer l'image plate D-Log M telle qu'elle apparaît normalement. Ce chemin n'est PAS
  // utilisé pour le traitement réel (Task 7/9), qui lit les plans bruts pour préserver la précision.
  const beforeCanvas = document.createElement('canvas');
  beforeCanvas.width = await videoTrack.getDisplayWidth();
  beforeCanvas.height = await videoTrack.getDisplayHeight();
  const beforeContext = beforeCanvas.getContext('2d');
  if (!beforeContext) throw new Error("Contexte 2D indisponible pour l'aperçu.");
  sample.drawWithFit(beforeContext, { fit: 'fill' });

  const frameProcessor = new FrameProcessor(await videoTrack.getCodedWidth(), await videoTrack.getCodedHeight());
  frameProcessor.setLut(lut);
  await frameProcessor.process(sample);

  sample.close();
  input.dispose();

  return { beforeCanvas, afterCanvas: frameProcessor.outputCanvas };
}
