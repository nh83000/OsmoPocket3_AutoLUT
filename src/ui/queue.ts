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
  private onRemoveCallback: ((id: string) => void) | null = null;

  constructor() {
    this.element = document.createElement('ul');
    this.element.className = 'queue';
  }

  onRename(callback: (id: string, newName: string) => void): void {
    this.onRenameCallback = callback;
  }

  onRemove(callback: (id: string) => void): void {
    this.onRemoveCallback = callback;
  }

  addItem(item: QueueItem): void {
    const listItem = document.createElement('li');
    listItem.className = 'queue-item';

    const row = document.createElement('div');
    row.className = 'queue-item__row';

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'queue-item__name';
    nameInput.value = item.fileName;
    nameInput.title = 'Nom du fichier à télécharger';
    nameInput.addEventListener('input', () => this.onRenameCallback?.(item.id, nameInput.value));

    const status = document.createElement('span');
    status.className = 'queue-item__status badge';

    const shareButton = document.createElement('button');
    shareButton.type = 'button';
    shareButton.className = 'queue-item__share button button--accent';
    shareButton.textContent = 'Enregistrer dans la pellicule';
    shareButton.hidden = true;
    shareButton.addEventListener('click', async () => {
      const current = this.items.get(item.id);
      if (!current?.blob) return;
      const fileName = nameInput.value.trim() || current.fileName;
      const file = new File([current.blob], fileName, { type: current.blob.type || 'video/mp4' });
      try {
        await navigator.share({ files: [file] });
      } catch (error) {
        // AbortError : l'utilisateur a annulé la feuille de partage, rien à signaler.
        if (error instanceof Error && error.name !== 'AbortError') console.warn('Partage impossible :', error);
      }
    });

    const downloadButton = document.createElement('button');
    downloadButton.type = 'button';
    downloadButton.className = 'queue-item__download button button--accent';
    downloadButton.textContent = 'Télécharger';
    downloadButton.hidden = true;
    downloadButton.addEventListener('click', () => {
      const current = this.items.get(item.id);
      if (current?.blob) downloadBlob(current.blob, nameInput.value.trim() || current.fileName);
    });

    const removeButton = document.createElement('button');
    removeButton.type = 'button';
    removeButton.className = 'queue-item__remove button button--ghost';
    removeButton.textContent = 'Supprimer';
    removeButton.title = 'Retirer cette vidéo de la file';
    removeButton.addEventListener('click', () => {
      this.itemElements.delete(item.id);
      this.items.delete(item.id);
      listItem.remove();
      this.onRemoveCallback?.(item.id);
    });

    const progress = document.createElement('progress');
    progress.className = 'queue-item__progress';
    progress.max = 100;

    row.append(nameInput, status, shareButton, downloadButton, removeButton);
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

    const shareButton = listItem.querySelector('.queue-item__share') as HTMLButtonElement;
    shareButton.hidden = !(item.status === 'done' && item.blob && isMobileDevice() && supportsFileShare(item.blob.type));

    const removeButton = listItem.querySelector('.queue-item__remove') as HTMLButtonElement;
    removeButton.disabled = item.status === 'processing';
  }
}

function isMobileDevice(): boolean {
  const uaData = (navigator as unknown as { userAgentData?: { mobile?: boolean } }).userAgentData;
  if (uaData && typeof uaData.mobile === 'boolean') return uaData.mobile;
  const ua = navigator.userAgent;
  if (/Android|iPhone|iPod|iPad/i.test(ua)) return true;
  // iPadOS se fait passer pour un Mac dans son user agent, mais reste tactile contrairement à un vrai Mac.
  return /Macintosh/i.test(ua) && navigator.maxTouchPoints > 1;
}

function supportsFileShare(mimeType: string): boolean {
  if (typeof navigator.share !== 'function' || typeof navigator.canShare !== 'function') return false;
  try {
    const probe = new File([], 'probe.mp4', { type: mimeType || 'video/mp4' });
    return navigator.canShare({ files: [probe] });
  } catch {
    return false;
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
