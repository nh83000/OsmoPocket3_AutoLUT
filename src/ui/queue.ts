export type QueueItemStatus = 'waiting' | 'processing' | 'done' | 'error';

export type QueueItem = {
  id: string;
  fileName: string;
  status: QueueItemStatus;
  progress: number;
  errorMessage?: string;
  audioDropped?: boolean;
};

export class ProcessingQueue {
  readonly element: HTMLElement;
  private readonly itemElements = new Map<string, HTMLElement>();

  constructor() {
    this.element = document.createElement('ul');
    this.element.className = 'queue';
  }

  addItem(item: QueueItem): void {
    const listItem = document.createElement('li');
    listItem.className = 'queue-item';

    const name = document.createElement('span');
    name.className = 'queue-item__name';
    name.textContent = item.fileName;

    const progress = document.createElement('progress');
    progress.className = 'queue-item__progress';
    progress.max = 100;

    const status = document.createElement('span');
    status.className = 'queue-item__status';

    listItem.append(name, progress, status);
    this.itemElements.set(item.id, listItem);
    this.element.appendChild(listItem);
    this.updateItem(item);
  }

  updateItem(item: QueueItem): void {
    const listItem = this.itemElements.get(item.id);
    if (!listItem) return;

    const progressElement = listItem.querySelector('.queue-item__progress') as HTMLProgressElement;
    progressElement.value = Math.round(item.progress * 100);

    listItem.querySelector('.queue-item__status')!.textContent = describeStatus(item);
    listItem.classList.toggle('queue-item--error', item.status === 'error');
    listItem.classList.toggle('queue-item--done', item.status === 'done');
  }
}

function describeStatus(item: QueueItem): string {
  switch (item.status) {
    case 'waiting':
      return 'En attente';
    case 'processing':
      return `Traitement… ${Math.round(item.progress * 100)}%`;
    case 'done':
      return item.audioDropped ? 'Terminé (sans audio : codec non reconnu)' : 'Terminé, téléchargé';
    case 'error':
      return `Erreur : ${item.errorMessage ?? 'inconnue'}`;
  }
}
