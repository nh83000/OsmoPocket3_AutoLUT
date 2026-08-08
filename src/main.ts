import { parseCubeLut, type ParsedCubeLut } from './lut/cubeParser';
import { generateClipPreview } from './pipeline/clipPreview';
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
  // Presetpro : à utiliser en 2e passe, sur une vidéo déjà convertie
  { name: 'Presetpro — Agfa Ultra 100 (sur Rec.709 déjà converti)', file: 'presetpro-agfa-ultra-100.cube' },
  { name: 'Presetpro — Moody Stock (sur Rec.709 déjà converti)', file: 'presetpro-moody-stock.cube' },
  { name: 'Presetpro — Polaroid Color (sur Rec.709 déjà converti)', file: 'presetpro-polaroid-color.cube' },
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

type PendingEntry = { file: File; item: QueueItem };

type PreviewEntry = {
  file: File;
  card: HTMLElement;
  nameElement: HTMLElement;
  beforeFigure: HTMLElement;
  afterFigure: HTMLElement;
  timelineInput: HTMLInputElement;
  clipButton: HTMLButtonElement;
  clipStatus: HTMLElement;
  clipVideo: HTMLVideoElement;
  errorElement: HTMLElement;
  duration: number; // 0 tant que pas encore connue
  timestamp: number;
};

async function main(): Promise<void> {
  const app = document.querySelector<HTMLDivElement>('#app');
  if (!app) throw new Error('#app introuvable dans index.html.');

  const header = document.createElement('header');
  header.className = 'app-header';
  header.innerHTML =
    '<h1>Convertisseur LUT — DJI Osmo Pocket 3</h1>' +
    '<p class="app-header__subtitle">Tout se passe dans votre navigateur : rien n\'est envoyé sur internet.</p>';

  const lutSelector = new LutSelector(await loadBuiltInLuts());
  const dropzone = new VideoDropzone();
  const queue = new ProcessingQueue();

  const previewSection = buildStep('2', 'Aperçu');
  previewSection.hidden = true;
  const previewScroll = document.createElement('div');
  previewScroll.className = 'preview-scroll';
  previewSection.appendChild(previewScroll);

  const startButton = document.createElement('button');
  startButton.type = 'button';
  startButton.className = 'button button--primary start-button';
  startButton.textContent = 'Lancer le traitement';
  startButton.disabled = true;

  app.append(
    header,
    buildStep('1', 'Choisir un LUT et déposer vos vidéos', lutSelector.element, dropzone.element),
    previewSection,
    buildStep('3', 'Traiter et télécharger', startButton, queue.element),
  );

  const pending = new Map<string, PendingEntry>(); // fichiers en attente du clic sur "Lancer le traitement"
  const previewEntries = new Map<string, PreviewEntry>();
  let isProcessing = false;

  // File d'attente séquentielle pour les rendus d'aperçu : chaque aperçu ouvre un contexte WebGL
  // temporaire, et le navigateur en limite le nombre simultané, donc on évite le concurrent.
  let previewRenderChain: Promise<void> = Promise.resolve();
  const scheduleRenderPreviews = (entries: PreviewEntry[], lut: ParsedCubeLut): void => {
    previewRenderChain = previewRenderChain
      .then(() => renderPreviews(entries, lut))
      .catch((error) => console.error('Erreur lors du rendu des aperçus :', error));
  };

  const refreshStartButton = (): void => {
    startButton.disabled = isProcessing || pending.size === 0;
    startButton.textContent = isProcessing ? 'Traitement en cours…' : 'Lancer le traitement';
  };

  dropzone.onFiles((files) => {
    const newPreviewEntries: PreviewEntry[] = [];

    for (const file of files) {
      const item: QueueItem = {
        id: crypto.randomUUID(),
        fileName: buildOutputFileName(file.name),
        status: 'waiting',
        progress: 0,
      };
      queue.addItem(item);
      pending.set(item.id, { file, item });

      const built = buildPreviewCard(item.fileName);
      previewScroll.appendChild(built.card);
      const previewEntry: PreviewEntry = { file, duration: 0, timestamp: 0, ...built };
      previewEntries.set(item.id, previewEntry);
      newPreviewEntries.push(previewEntry);

      built.timelineInput.addEventListener('change', () => {
        previewEntry.timestamp = Number(built.timelineInput.value);
        scheduleRenderPreviews([previewEntry], lutSelector.selectedLut);
      });

      built.clipButton.addEventListener('click', () => {
        void generateClip(previewEntry, lutSelector.selectedLut);
      });
    }

    previewSection.hidden = false;
    scheduleRenderPreviews(newPreviewEntries, lutSelector.selectedLut);
    refreshStartButton();
  });

  lutSelector.onChange((lut) => {
    scheduleRenderPreviews([...previewEntries.values()], lut);
  });

  queue.onRename((id, newName) => {
    const previewEntry = previewEntries.get(id);
    if (previewEntry) {
      previewEntry.nameElement.textContent = newName;
      previewEntry.nameElement.title = newName;
    }
  });

  queue.onRemove((id) => {
    pending.delete(id);
    const previewEntry = previewEntries.get(id);
    if (previewEntry) {
      if (previewEntry.clipVideo.src) URL.revokeObjectURL(previewEntry.clipVideo.src);
      previewEntry.card.remove();
    }
    previewEntries.delete(id);
    refreshStartButton();
  });

  startButton.addEventListener('click', () => {
    if (isProcessing) return;
    isProcessing = true;
    refreshStartButton();
    void processPending(pending, queue, lutSelector.selectedLut).finally(() => {
      isProcessing = false;
      refreshStartButton();
    });
  });
}

function buildStep(number: string, title: string, ...children: HTMLElement[]): HTMLElement {
  const section = document.createElement('section');
  section.className = 'step';

  const heading = document.createElement('h2');
  heading.className = 'step__heading';
  const badge = document.createElement('span');
  badge.className = 'step__number';
  badge.textContent = number;
  heading.append(badge, title);

  section.append(heading, ...children);
  return section;
}

function buildPreviewCard(fileName: string): {
  card: HTMLElement;
  nameElement: HTMLElement;
  beforeFigure: HTMLElement;
  afterFigure: HTMLElement;
  timelineInput: HTMLInputElement;
  clipButton: HTMLButtonElement;
  clipStatus: HTMLElement;
  clipVideo: HTMLVideoElement;
  errorElement: HTMLElement;
} {
  const card = document.createElement('div');
  card.className = 'preview-card';

  const nameElement = document.createElement('p');
  nameElement.className = 'preview-card__name';
  nameElement.textContent = fileName;
  nameElement.title = fileName;

  const errorElement = document.createElement('p');
  errorElement.className = 'preview-card__error';
  errorElement.hidden = true;

  const row = document.createElement('div');
  row.className = 'preview';
  const beforeFigure = buildPreviewFigure('Avant');
  const afterFigure = buildPreviewFigure('Après');
  row.append(beforeFigure, afterFigure);

  const timelineInput = document.createElement('input');
  timelineInput.type = 'range';
  timelineInput.className = 'preview-clip__timeline';
  timelineInput.disabled = true;
  timelineInput.title = "Position à prévisualiser dans la vidéo";

  const clipButton = document.createElement('button');
  clipButton.type = 'button';
  clipButton.className = 'preview-clip__button button button--ghost';
  clipButton.textContent = 'Générer un extrait vidéo';
  clipButton.disabled = true;

  const clipStatus = document.createElement('span');
  clipStatus.className = 'preview-clip__status';

  const clipActions = document.createElement('div');
  clipActions.className = 'preview-clip__actions';
  clipActions.append(clipButton, clipStatus);

  const clipVideo = document.createElement('video');
  clipVideo.className = 'preview-clip__video';
  clipVideo.controls = true;
  clipVideo.hidden = true;

  const clipSection = document.createElement('div');
  clipSection.className = 'preview-clip';
  clipSection.append(timelineInput, clipActions, clipVideo);

  card.append(nameElement, errorElement, row, clipSection);
  return { card, nameElement, beforeFigure, afterFigure, timelineInput, clipButton, clipStatus, clipVideo, errorElement };
}

function buildPreviewFigure(label: string): HTMLElement {
  const figure = document.createElement('figure');
  figure.className = 'preview__figure';
  const caption = document.createElement('figcaption');
  caption.className = 'preview__caption';
  caption.textContent = label;
  figure.appendChild(caption);
  return figure;
}

function setPreviewFigureCanvas(figure: HTMLElement, canvas: HTMLCanvasElement): void {
  figure.querySelector('canvas')?.remove();
  figure.appendChild(canvas);
}

async function renderPreviews(entries: PreviewEntry[], lut: ParsedCubeLut): Promise<void> {
  for (const entry of entries) {
    try {
      const isFirstRender = entry.duration === 0;
      const { beforeCanvas, afterCanvas, duration } = await generatePreview(
        entry.file,
        lut,
        isFirstRender ? undefined : entry.timestamp,
      );
      setPreviewFigureCanvas(entry.beforeFigure, toDisplayCanvas(beforeCanvas));
      setPreviewFigureCanvas(entry.afterFigure, toDisplayCanvas(afterCanvas));
      entry.errorElement.hidden = true;

      if (isFirstRender) {
        entry.duration = duration;
        entry.timestamp = Math.max(0, Math.min(duration / 2, Math.max(duration - 0.1, 0)));
        entry.timelineInput.min = '0';
        entry.timelineInput.max = duration.toFixed(2);
        entry.timelineInput.step = '0.1';
        entry.timelineInput.value = entry.timestamp.toFixed(2);
        entry.timelineInput.disabled = false;
        entry.clipButton.disabled = false;
      }
    } catch (error) {
      console.error(`Aperçu impossible pour "${entry.file.name}" :`, error);
      entry.errorElement.textContent = error instanceof Error ? error.message : 'Aperçu impossible pour cette vidéo.';
      entry.errorElement.hidden = false;
    }
  }
}

async function generateClip(entry: PreviewEntry, lut: ParsedCubeLut): Promise<void> {
  entry.clipButton.disabled = true;
  entry.clipStatus.textContent = 'Génération en cours…';

  try {
    const blob = await generateClipPreview({ file: entry.file, lut, startTime: entry.timestamp });
    if (entry.clipVideo.src) URL.revokeObjectURL(entry.clipVideo.src);
    entry.clipVideo.src = URL.createObjectURL(blob);
    entry.clipVideo.hidden = false;
    entry.clipStatus.textContent = '';
  } catch (error) {
    entry.clipStatus.textContent = `Erreur : ${(error as Error).message}`;
    console.error(`Extrait impossible pour "${entry.file.name}" :`, error);
  } finally {
    entry.clipButton.disabled = false;
  }
}

async function processPending(pending: Map<string, PendingEntry>, queue: ProcessingQueue, lut: ParsedCubeLut): Promise<void> {
  for (const [id, { file, item }] of pending) {
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
