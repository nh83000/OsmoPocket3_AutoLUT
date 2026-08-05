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
  // Presetpro : LUT "look" génériques, pensées pour une entrée déjà en Rec.709 (pas du D-Log M brut) —
  // à utiliser en 2e passe, sur une vidéo déjà convertie par le LUT DJI ci-dessus.
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
type PreviewEntry = { file: File; nameElement: HTMLElement; beforeFigure: HTMLElement; afterFigure: HTMLElement };

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

  const previewSection = buildStep('2', 'Aperçu avant/après');
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

  // Fichiers déposés mais pas encore traités : le traitement ne démarre plus automatiquement, il
  // faut cliquer sur `startButton`. Une entrée quitte cette file dès qu'elle est prise en charge,
  // qu'un nouveau dépôt puisse s'ajouter par-dessus sans retraiter ce qui est déjà en cours/fini.
  const pending = new Map<string, PendingEntry>();
  // Un aperçu par vidéo déposée, gardé pour toute la session (même après traitement) et régénéré
  // dès que la sélection de LUT change, pour que l'aperçu affiché corresponde toujours à ce qui sera
  // réellement appliqué au clic sur "Lancer le traitement".
  const previewEntries = new Map<string, PreviewEntry>();
  let isProcessing = false;

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

      const { card, nameElement, beforeFigure, afterFigure } = buildPreviewCard(item.fileName);
      previewScroll.appendChild(card);
      const previewEntry: PreviewEntry = { file, nameElement, beforeFigure, afterFigure };
      previewEntries.set(item.id, previewEntry);
      newPreviewEntries.push(previewEntry);
    }

    previewSection.hidden = false;
    // Rendu séquentiel, pas concurrent : chaque aperçu ouvre temporairement son propre contexte
    // WebGL, et le navigateur en limite le nombre simultané (~8-16). Avec plusieurs fichiers déposés
    // d'un coup, les traiter un par un évite de dépasser cette limite.
    void renderPreviews(newPreviewEntries, lutSelector.selectedLut);
    refreshStartButton();
  });

  lutSelector.onChange((lut) => {
    void renderPreviews([...previewEntries.values()], lut);
  });

  // Le nom modifiable dans la file (étape 3) fait foi ; on le répercute au-dessus de l'aperçu
  // correspondant (étape 2) pour que les deux restent synchronisés.
  queue.onRename((id, newName) => {
    const previewEntry = previewEntries.get(id);
    if (previewEntry) {
      previewEntry.nameElement.textContent = newName;
      previewEntry.nameElement.title = newName;
    }
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

function buildPreviewCard(
  fileName: string,
): { card: HTMLElement; nameElement: HTMLElement; beforeFigure: HTMLElement; afterFigure: HTMLElement } {
  const card = document.createElement('div');
  card.className = 'preview-card';

  const nameElement = document.createElement('p');
  nameElement.className = 'preview-card__name';
  nameElement.textContent = fileName;
  nameElement.title = fileName;

  const row = document.createElement('div');
  row.className = 'preview';
  const beforeFigure = buildPreviewFigure('Avant');
  const afterFigure = buildPreviewFigure('Après');
  row.append(beforeFigure, afterFigure);

  card.append(nameElement, row);
  return { card, nameElement, beforeFigure, afterFigure };
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
      const { beforeCanvas, afterCanvas } = await generatePreview(entry.file, lut);
      setPreviewFigureCanvas(entry.beforeFigure, toDisplayCanvas(beforeCanvas));
      setPreviewFigureCanvas(entry.afterFigure, toDisplayCanvas(afterCanvas));
    } catch (error) {
      console.error(`Aperçu impossible pour "${entry.file.name}" :`, error);
    }
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
