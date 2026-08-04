import { parseCubeLut, type ParsedCubeLut } from './lut/cubeParser';
import { UnsupportedVideoError, processVideo } from './pipeline/videoProcessor';
import { VideoDropzone } from './ui/dropzone';
import { LutSelector } from './ui/lutSelector';
import { generatePreview } from './ui/preview';
import { ProcessingQueue, type QueueItem } from './ui/queue';
import './style.css';

async function main(): Promise<void> {
  const app = document.querySelector<HTMLDivElement>('#app');
  if (!app) throw new Error('#app introuvable dans index.html.');

  const defaultLutResponse = await fetch(`${import.meta.env.BASE_URL}luts/dji-dlogm-rec709.cube`);
  const defaultLut = parseCubeLut(await defaultLutResponse.text());

  const lutSelector = new LutSelector({ name: 'DJI Osmo Pocket 3 — D-Log M vers Rec.709', lut: defaultLut });
  const dropzone = new VideoDropzone();
  const queue = new ProcessingQueue();
  const previewContainer = document.createElement('div');
  previewContainer.className = 'preview';

  app.append(lutSelector.element, dropzone.element, previewContainer, queue.element);

  dropzone.onFiles((files) => {
    void handleFiles(files, lutSelector.selectedLut, queue, previewContainer);
  });
}

async function handleFiles(
  files: File[],
  lut: ParsedCubeLut,
  queue: ProcessingQueue,
  previewContainer: HTMLElement,
): Promise<void> {
  try {
    const { beforeCanvas, afterCanvas } = await generatePreview(files[0]!, lut);
    previewContainer.replaceChildren(toDisplayCanvas(beforeCanvas), toDisplayCanvas(afterCanvas));
  } catch (error) {
    console.error('Aperçu impossible :', error);
  }

  for (const file of files) {
    const item: QueueItem = { id: crypto.randomUUID(), fileName: file.name, status: 'waiting', progress: 0 };
    queue.addItem(item);

    item.status = 'processing';
    queue.updateItem(item);

    try {
      const result = await processVideo({
        file,
        lut,
        onProgress: ({ processedFrames, totalFrames }) => {
          item.progress = totalFrames ? Math.min(processedFrames / totalFrames, 1) : 0;
          queue.updateItem(item);
        },
      });

      downloadBlob(result.blob, result.fileName);
      item.status = 'done';
      item.progress = 1;
      item.audioDropped = result.audioDropped;
    } catch (error) {
      item.status = 'error';
      item.errorMessage = error instanceof UnsupportedVideoError ? error.message : (error as Error).message;
    }

    queue.updateItem(item);
  }
}

function toDisplayCanvas(canvas: HTMLCanvasElement | OffscreenCanvas): HTMLCanvasElement {
  if (canvas instanceof HTMLCanvasElement) {
    canvas.classList.add('preview__canvas');
    return canvas;
  }

  const displayCanvas = document.createElement('canvas');
  displayCanvas.width = canvas.width;
  displayCanvas.height = canvas.height;
  displayCanvas.classList.add('preview__canvas');

  const context = displayCanvas.getContext('2d');
  if (!context) throw new Error("Contexte 2D indisponible pour afficher l'aperçu.");
  context.drawImage(canvas, 0, 0);

  return displayCanvas;
}

function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

void main().catch((error) => {
  console.error(error);
  const app = document.querySelector<HTMLDivElement>('#app');
  if (app) {
    app.textContent = `Erreur au chargement de l'application : ${(error as Error).message}`;
  }
});
