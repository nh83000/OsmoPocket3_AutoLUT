export class VideoDropzone {
  readonly element: HTMLElement;
  private onFilesCallback: ((files: File[]) => void) | null = null;

  constructor() {
    this.element = document.createElement('div');
    this.element.className = 'dropzone';
    this.element.textContent = 'Glissez vos fichiers .mp4 ici, ou cliquez pour en choisir.';

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
