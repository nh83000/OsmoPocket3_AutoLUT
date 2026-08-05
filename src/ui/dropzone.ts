export class VideoDropzone {
  readonly element: HTMLElement;
  private onFilesCallback: ((files: File[]) => void) | null = null;

  constructor() {
    this.element = document.createElement('div');
    this.element.className = 'dropzone';
    this.element.innerHTML =
      '<svg class="dropzone__icon" width="32" height="32" viewBox="0 0 24 24" fill="none" ' +
      'stroke="currentColor" stroke-width="1.5" aria-hidden="true">' +
      '<path d="M12 16V4M12 4L7 9M12 4l5 5" stroke-linecap="round" stroke-linejoin="round"/>' +
      '<path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" stroke-linecap="round" stroke-linejoin="round"/>' +
      '</svg>' +
      '<p class="dropzone__title">Glissez vos fichiers .mp4 ici</p>' +
      '<p class="dropzone__hint">ou cliquez pour en choisir</p>';

    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'video/mp4,.mp4';
    fileInput.multiple = true;
    fileInput.hidden = true;

    this.element.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => {
      if (fileInput.files) this.onFilesCallback?.(Array.from(fileInput.files));
      fileInput.value = '';
    });

    this.element.addEventListener('dragover', (event) => {
      event.preventDefault();
      this.element.classList.add('dropzone--active');
    });
    this.element.addEventListener('dragleave', () => {
      this.element.classList.remove('dropzone--active');
    });
    this.element.addEventListener('drop', (event) => {
      event.preventDefault();
      this.element.classList.remove('dropzone--active');
      const files = Array.from(event.dataTransfer?.files ?? []).filter((file) =>
        file.name.toLowerCase().endsWith('.mp4'),
      );
      if (files.length > 0) this.onFilesCallback?.(files);
    });

    this.element.appendChild(fileInput);
  }

  onFiles(callback: (files: File[]) => void): void {
    this.onFilesCallback = callback;
  }
}
