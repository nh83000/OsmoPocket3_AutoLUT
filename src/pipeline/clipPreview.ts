// src/pipeline/clipPreview.ts
import {
  ALL_FORMATS,
  BlobSource,
  BufferTarget,
  EncodedAudioPacketSource,
  EncodedPacketSink,
  Input,
  Mp4OutputFormat,
  Output,
  Quality,
  VideoSample,
  VideoSampleSink,
  VideoSampleSource,
  type InputAudioTrack,
} from 'mediabunny';
import { FrameProcessor } from '../color/frameProcessor';
import type { ParsedCubeLut } from '../lut/cubeParser';
import { checkVideoTrackSupport } from './hevcSupport';
import { UnsupportedVideoError, computeTargetBitrate } from './videoProcessor';

export type ClipPreviewOptions = {
  file: File;
  lut: ParsedCubeLut;
  /** Point de départ de l'extrait, en secondes. Sera ramené dans les bornes de la vidéo. */
  startTime: number;
  /** Durée souhaitée de l'extrait, en secondes. */
  clipDuration?: number;
};

const DEFAULT_CLIP_DURATION = 8;

/**
 * Génère un court extrait de la vidéo avec le LUT appliqué (image + son), pour un vrai aperçu en
 * mouvement sans attendre le traitement complet du fichier. Réutilise le même pipeline de précision
 * couleur que `processVideo`, juste borné à une fenêtre temporelle.
 */
export async function generateClipPreview(options: ClipPreviewOptions): Promise<Blob> {
  const { file, lut, clipDuration = DEFAULT_CLIP_DURATION } = options;

  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });

  let frameProcessor: FrameProcessor | undefined;
  let output: Output | undefined;

  try {
    const videoTrack = await input.getPrimaryVideoTrack();
    if (!videoTrack) throw new Error('Aucune piste vidéo trouvée dans ce fichier.');

    const support = await checkVideoTrackSupport(videoTrack);
    if (!support.supported) throw new UnsupportedVideoError(support.message);

    const duration = await input.computeDuration();
    const clipStart = Math.max(0, Math.min(options.startTime, Math.max(duration - 0.1, 0)));
    const clipEnd = Math.min(clipStart + clipDuration, duration);

    const audioTrack = await input.getPrimaryAudioTrack();

    const target = new BufferTarget();
    output = new Output({ format: new Mp4OutputFormat(), target });

    const targetBitrate = await computeTargetBitrate(videoTrack);
    const videoSource = new VideoSampleSource({
      codec: 'avc',
      quality: new Quality({ bitrate: targetBitrate, bitrateMode: 'variable' }),
    });
    output.addVideoTrack(videoSource, { rotation: await videoTrack.getRotation() });

    let audioPacketSource: EncodedAudioPacketSource | null = null;
    let audioDone: Promise<void> = Promise.resolve();
    if (audioTrack) {
      const audioCodec = await audioTrack.getCodec();
      if (audioCodec) {
        audioPacketSource = new EncodedAudioPacketSource(audioCodec);
        output.addAudioTrack(audioPacketSource);
        audioDone = copyAudioClipPackets(audioTrack, new EncodedPacketSink(audioTrack), audioPacketSource, clipStart, clipEnd);
      }
    }

    await output.start();

    const width = await videoTrack.getCodedWidth();
    const height = await videoTrack.getCodedHeight();
    frameProcessor = new FrameProcessor(width, height);
    frameProcessor.setLut(lut);

    // Voir le commentaire équivalent dans videoProcessor.ts au sujet du choix de 'no-preference'.
    const videoSampleSink = new VideoSampleSink(videoTrack, { hardwareAcceleration: 'no-preference' });

    for await (const sample of videoSampleSink.samples(clipStart, clipEnd)) {
      try {
        await frameProcessor.process(sample);

        const outputSample = new VideoSample(frameProcessor.outputCanvas, {
          // Ramené à zéro : l'extrait est un fichier indépendant qui doit commencer à t=0, pas au
          // temps où il se trouvait dans la vidéo source.
          timestamp: Math.max(0, sample.timestamp - clipStart),
          duration: sample.duration,
          colorSpace: { primaries: 'bt709', transfer: 'bt709', matrix: 'bt709', fullRange: false },
        });
        try {
          await videoSource.add(outputSample);
        } finally {
          outputSample.close();
        }
      } finally {
        sample.close();
      }
    }

    videoSource.close();
    await audioDone;
    audioPacketSource?.close();

    await output.finalize();

    if (!target.buffer) throw new Error("L'extrait n'a pas pu être généré.");
    return new Blob([target.buffer], { type: 'video/mp4' });
  } catch (error) {
    await output?.cancel().catch(() => {});
    throw error;
  } finally {
    frameProcessor?.dispose();
    input.dispose();
  }
}

async function copyAudioClipPackets(
  audioTrack: InputAudioTrack,
  sink: EncodedPacketSink,
  source: EncodedAudioPacketSource,
  clipStart: number,
  clipEnd: number,
): Promise<void> {
  const startPacket = await sink.getPacket(clipStart);
  if (!startPacket) return;
  const endPacket = await sink.getPacket(clipEnd);

  let isFirstPacket = true;
  for await (const packet of sink.packets(startPacket, endPacket ?? undefined)) {
    // Même donnée encodée (aucune perte), seule l'étiquette de temps est ramenée à zéro pour
    // correspondre au début du fichier d'extrait indépendant.
    const rebased = packet.clone({ timestamp: Math.max(0, packet.timestamp - clipStart) });
    if (isFirstPacket) {
      const decoderConfig = await audioTrack.getDecoderConfig();
      await source.add(rebased, decoderConfig ? { decoderConfig } : undefined);
      isFirstPacket = false;
    } else {
      await source.add(rebased);
    }
  }
}
