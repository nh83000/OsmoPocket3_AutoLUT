import { parseCubeLut, type ParsedCubeLut } from './lut/cubeParser';
import { UnsupportedVideoError, buildOutputFileName, processVideo } from './pipeline/videoProcessor';
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

type PendingEntry = { file: File; lut: ParsedCubeLut; item: QueueItem };

async function main(): Promise<void> {
  const app = document.querySelector<HTMLDivElement>('#app');
  if (!app) throw new Error('#app introuvable dans index.html.');

  const lutSelector = new LutSelector(await loadBuiltInLuts());
  const dropzone = new VideoDropzone();
  const queue = new ProcessingQueue();
  const previewContainer = document.createElement('div');
  previewContainer.className = 'preview';

  const startButton = document.createElement('button');
  startButton.type = 'button';
  startButton.className = 'start-button';
  startButton.textContent = 'Lancer le traitement';
  startButton.disabled = true;

  app.append(lutSelector.element, dropzone.element, previewContainer, startButton, queue.element);

  // Fichiers déposés mais pas encore traités : le traitement ne démarre plus automatiquement, il
  // faut cliquer sur `startButton`. Une entrée quitte cette file dès qu'elle est prise en charge,
  // qu'un nouveau dépôt puisse s'ajouter par-dessus sans retraiter ce qui est déjà en cours/fini.
  const pending = new Map<string, PendingEntry>();
  let isProcessing = false;

  const refreshStartButton = (): void => {
    startButton.disabled = isProcessing || pending.size === 0;
    startButton.textContent = isProcessing ? 'Traitement en cours…' : 'Lancer le traitement';
  };

  dropzone.onFiles((files) => {
    void showPreview(files[0]!, lutSelector.selectedLut, previewContainer);

    for (const file of files) {
      const item: QueueItem = {
        id: crypto.randomUUID(),
        fileName: buildOutputFileName(file.name),
        status: 'waiting',
        progress: 0,
      };
      queue.addItem(item);
      // Le LUT sélectionné au moment du dépôt est celui appliqué à ce fichier, même si la sélection
      // change ensuite avant de cliquer sur "Lancer le traitement".
      pending.set(item.id, { file, lut: lutSelector.selectedLut, item });
    }
    refreshStartButton();
  });

  startButton.addEventListener('click', () => {
    if (isProcessing) return;
    isProcessing = true;
    refreshStartButton();
    void processPending(pending, queue).finally(() => {
      isProcessing = false;
      refreshStartButton();
    });
  });
}

async function showPreview(file: File, lut: ParsedCubeLut, previewContainer: HTMLElement): Promise<void> {
  try {
    const { beforeCanvas, afterCanvas } = await generatePreview(file, lut);
    previewContainer.replaceChildren(toDisplayCanvas(beforeCanvas), toDisplayCanvas(afterCanvas));
  } catch (error) {
    console.error('Aperçu impossible :', error);
  }
}

async function processPending(pending: Map<string, PendingEntry>, queue: ProcessingQueue): Promise<void> {
  for (const [id, { file, lut, item }] of pending) {
    pending.delete(id);

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
