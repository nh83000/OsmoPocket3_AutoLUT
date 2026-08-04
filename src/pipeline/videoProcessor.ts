// src/pipeline/videoProcessor.ts
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

export class UnsupportedVideoError extends Error {}

export type ProcessingProgress = {
  processedFrames: number;
  totalFrames: number | null;
};

export type ProcessVideoOptions = {
  file: File;
  lut: ParsedCubeLut;
  onProgress?: (progress: ProcessingProgress) => void;
};

export type ProcessVideoResult = {
  blob: Blob;
  fileName: string;
  /** `true` si une piste audio source existait mais n'a pas pu être copiée (codec inconnu, par ex.). */
  audioDropped: boolean;
};

const MINIMUM_OUTPUT_BITRATE = 20_000_000;
/** On vise au moins le bitrate source, avec 10% de marge, pour ne jamais recompresser plus fort que l'original. */
const BITRATE_HEADROOM = 1.1;

export async function processVideo(options: ProcessVideoOptions): Promise<ProcessVideoResult> {
  const { file, lut, onProgress } = options;

  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });

  let frameProcessor: FrameProcessor | undefined;
  let output: Output | undefined;

  try {
    const videoTrack = await input.getPrimaryVideoTrack();
    if (!videoTrack) throw new Error('Aucune piste vidéo trouvée dans ce fichier.');

    const support = await checkVideoTrackSupport(videoTrack);
    if (!support.supported) throw new UnsupportedVideoError(support.message);

    const audioTrack = await input.getPrimaryAudioTrack();

    const target = new BufferTarget();
    output = new Output({ format: new Mp4OutputFormat(), target });

    const sourceBitrate = (await videoTrack.getAverageBitrate()) ?? (await videoTrack.getBitrate()) ?? MINIMUM_OUTPUT_BITRATE;
    const targetBitrate = Math.max(sourceBitrate * BITRATE_HEADROOM, MINIMUM_OUTPUT_BITRATE);

    const videoSource = new VideoSampleSource({
      codec: 'avc',
      quality: new Quality({ bitrate: targetBitrate, bitrateMode: 'variable' }),
    });
    output.addVideoTrack(videoSource, { rotation: await videoTrack.getRotation() });

    let audioPacketSource: EncodedAudioPacketSource | null = null;
    let audioDone: Promise<void> = Promise.resolve();
    let audioDropped = false;
    if (audioTrack) {
      const audioCodec = await audioTrack.getCodec();
      if (audioCodec) {
        audioPacketSource = new EncodedAudioPacketSource(audioCodec);
        output.addAudioTrack(audioPacketSource);
        audioDone = copyAudioPackets(audioTrack, new EncodedPacketSink(audioTrack), audioPacketSource);
      } else {
        audioDropped = true;
        console.warn(`Piste audio ignorée : codec non reconnu pour "${file.name}".`);
      }
    }

    await output.start();

    const width = await videoTrack.getCodedWidth();
    const height = await videoTrack.getCodedHeight();
    frameProcessor = new FrameProcessor(width, height);
    frameProcessor.setLut(lut);

    // 'prefer-software' garantit des VideoFrame décodées dont les plans sont lisibles via
    // copyTo()/allocationSize() : sur certains GPU/pilotes Windows, le décodage matériel HEVC 10 bits
    // retourne des frames avec format === null (données uniquement accessibles côté GPU), ce qui casse
    // l'extraction manuelle des plans YUV nécessaire au pipeline de précision.
    const videoSampleSink = new VideoSampleSink(videoTrack, { hardwareAcceleration: 'prefer-software' });
    const stats = await videoTrack.computePacketStats(200);
    const duration = await input.computeDuration();
    const estimatedTotalFrames = Math.round(stats.averagePacketRate * duration);

    let processedFrames = 0;
    for await (const sample of videoSampleSink.samples()) {
      try {
        await frameProcessor.process(sample);

        const outputSample = new VideoSample(frameProcessor.outputCanvas, {
          timestamp: sample.timestamp,
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

      processedFrames++;
      onProgress?.({
        processedFrames,
        totalFrames: Number.isFinite(estimatedTotalFrames) && estimatedTotalFrames > 0 ? estimatedTotalFrames : null,
      });
    }

    videoSource.close();
    await audioDone;
    audioPacketSource?.close();

    await output.finalize();

    if (!target.buffer) throw new Error("La sortie n'a pas pu être générée.");

    return {
      blob: new Blob([target.buffer], { type: 'video/mp4' }),
      fileName: buildOutputFileName(file.name),
      audioDropped,
    };
  } catch (error) {
    await output?.cancel().catch(() => {});
    throw error;
  } finally {
    frameProcessor?.dispose();
    input.dispose();
  }
}

async function copyAudioPackets(
  audioTrack: InputAudioTrack,
  sink: EncodedPacketSink,
  source: EncodedAudioPacketSource,
): Promise<void> {
  let isFirstPacket = true;
  for await (const packet of sink.packets()) {
    if (isFirstPacket) {
      const decoderConfig = await audioTrack.getDecoderConfig();
      await source.add(packet, decoderConfig ? { decoderConfig } : undefined);
      isFirstPacket = false;
    } else {
      await source.add(packet);
    }
  }
}

function buildOutputFileName(originalName: string): string {
  const dotIndex = originalName.lastIndexOf('.');
  const base = dotIndex === -1 ? originalName : originalName.slice(0, dotIndex);
  return `${base}_graded.mp4`;
}
