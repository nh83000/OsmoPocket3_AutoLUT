export type QueueItemStatus = 'waiting' | 'processing' | 'done' | 'error';

export type QueueItem = {
  id: string;
  fileName: string;
  status: QueueItemStatus;
  progress: number;
  errorMessage?: string;
  audioDropped?: boolean;
  colorPipelineFallback?: boolean;
  blob?: Blob;
};

export class ProcessingQueue {
  readonly element: HTMLElement;
  private readonly itemElements = new Map<string, HTMLElement>();
  private readonly items = new Map<string, QueueItem>();
  private onRenameCallback: ((id: string, newName: string) => void) | null = null;

  constructor() {
    this.element = document.createElement('ul');
    this.element.className = 'queue';
  }

  /** Appelé à chaque frappe dans le champ de nom d'un élément (id, nouvelle valeur). */
  onRename(callback: (id: string, newName: string) => void): void {
    this.onRenameCallback = callback;
  }

  addItem(item: QueueItem): void {
    const listItem = document.createElement('li');
    listItem.className = 'queue-item';

    const row = document.createElement('div');
    row.className = 'queue-item__row';

    // Champ libre plutôt qu'un simple libellé : l'utilisateur peut renommer le fichier de sortie à
    // tout moment (avant ou après traitement). C'est cette valeur, pas `item.fileName`, qui fait
    // foi au moment du téléchargement — `updateItem()` ne la réécrit donc jamais après coup.
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'queue-item__name';
    nameInput.value = item.fileName;
    nameInput.title = 'Nom du fichier à télécharger';
    nameInput.addEventListener('input', () => this.onRenameCallback?.(item.id, nameInput.value));

    const status = document.createElement('span');
    status.className = 'queue-item__status badge';

    const downloadButton = document.createElement('button');
    downloadButton.type = 'button';
    downloadButton.className = 'queue-item__download button button--accent';
    downloadButton.textContent = 'Télécharger';
    downloadButton.hidden = true;
    downloadButton.addEventListener('click', () => {
      const current = this.items.get(item.id);
      if (current?.blob) downloadBlob(current.blob, nameInput.value.trim() || current.fileName);
    });

    const progress = document.createElement('progress');
    progress.className = 'queue-item__progress';
    progress.max = 100;

    row.append(nameInput, status, downloadButton);
    listItem.append(row, progress);
    this.itemElements.set(item.id, listItem);
    this.element.appendChild(listItem);
    this.updateItem(item);
  }

  updateItem(item: QueueItem): void {
    const listItem = this.itemElements.get(item.id);
    if (!listItem) return;
    this.items.set(item.id, item);

    const progressElement = listItem.querySelector('.queue-item__progress') as HTMLProgressElement;
    progressElement.value = Math.round(item.progress * 100);
    progressElement.hidden = item.status !== 'processing';

    const statusElement = listItem.querySelector('.queue-item__status')!;
    statusElement.textContent = describeStatus(item);
    statusElement.className = `queue-item__status badge badge--${item.status}`;
    listItem.classList.toggle('queue-item--error', item.status === 'error');
    listItem.classList.toggle('queue-item--done', item.status === 'done');

    const downloadButton = listItem.querySelector('.queue-item__download') as HTMLButtonElement;
    downloadButton.hidden = !(item.status === 'done' && item.blob);
  }
}

function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

function describeStatus(item: QueueItem): string {
  switch (item.status) {
    case 'waiting':
      return 'En attente';
    case 'processing':
      return `Traitement… ${Math.round(item.progress * 100)}%`;
    case 'done': {
      const notes: string[] = [];
      if (item.audioDropped) notes.push('sans audio : codec non reconnu');
      if (item.colorPipelineFallback) notes.push('mode compatibilité couleur');
      return notes.length > 0 ? `Terminé (${notes.join(', ')})` : 'Terminé';
    }
    case 'error':
      return `Erreur : ${item.errorMessage ?? 'inconnue'}`;
  }
}
