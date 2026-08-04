import { parseCubeLut, type ParsedCubeLut } from './lut/cubeParser';
import { UnsupportedVideoError, processVideo } from './pipeline/videoProcessor';
import { VideoDropzone } from './ui/dropzone';
import { LutSelector, type LutOption } from './ui/lutSelector';
import { generatePreview } from './ui/preview';
import { ProcessingQueue, type QueueItem } from './ui/queue';
import './style.css';

const BUILT_IN_LUTS = [
  { name: 'DJI Osmo Pocket 3 — D-Log M vers Rec.709', file: 'dji-dlogm-rec709.cube' },
  { name: 'DJI Osmo Pocket 3 — Spring Pro', file: 'dji-dlogm-spring-pro.cube' },
  { name: 'DJI Osmo Pocket 3 — Summer Pro', file: 'dji-dlogm-summer-pro.cube' },
  { name: 'DJI Osmo Pocket 3 — Autumn Pro', file: 'dji-dlogm-autumn-pro.cube' },
  { name: 'DJI Osmo Pocket 3 — Winter Pro', file: 'dji-dlogm-winter-pro.cube' },
];

async function loadBuiltInLuts(): Promise<LutOption[]> {
  return Promise.all(
    BUILT_IN_LUTS.map(async (preset) => {
      const response = await fetch(`${import.meta.env.BASE_URL}luts/${preset.file}`);
      if (!response.ok) throw new Error(`Impossible de charger le LUT intégré "${preset.file}" (${response.status}).`);
      return { name: preset.name, lut: parseCubeLut(await response.text()) };
    }),
  );
}

async function main(): Promise<void> {
  const app = document.querySelector<HTMLDivElement>('#app');
  if (!app) throw new Error('#app introuvable dans index.html.');

  const lutSelector = new LutSelector(await loadBuiltInLuts());
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

      item.status = 'done';
      item.progress = 1;
      // Remplace le nom source par le nom de sortie ("..._graded.mp4") : le libellé déjà affiché dans
      // la file ne change pas rétroactivement, seul le nom utilisé par le bouton de téléchargement.
      item.fileName = result.fileName;
      item.blob = result.blob;
      item.audioDropped = result.audioDropped;
      item.colorPipelineFallback = result.colorPipelineFallback;
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

void main().catch((error) => {
  console.error(error);
  const app = document.querySelector<HTMLDivElement>('#app');
  if (app) {
    app.textContent = `Erreur au chargement de l'application : ${(error as Error).message}`;
  }
});
