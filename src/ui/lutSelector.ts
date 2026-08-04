import { parseCubeLut, type ParsedCubeLut } from '../lut/cubeParser';

export type LutOption = {
  name: string;
  lut: ParsedCubeLut;
};

export class LutSelector {
  readonly element: HTMLElement;
  private readonly select: HTMLSelectElement;
  private readonly fileInput: HTMLInputElement;
  private options: LutOption[];
  private onChangeCallback: ((lut: ParsedCubeLut) => void) | null = null;

  constructor(builtInOptions: LutOption[]) {
    this.options = builtInOptions;

    this.element = document.createElement('div');
    this.element.className = 'lut-selector';

    this.select = document.createElement('select');
    this.select.addEventListener('change', () => {
      const option = this.options[this.select.selectedIndex];
      if (option) this.onChangeCallback?.(option.lut);
    });

    const addButton = document.createElement('button');
    addButton.type = 'button';
    addButton.textContent = 'Ajouter un LUT (.cube)';
    addButton.addEventListener('click', () => this.fileInput.click());

    const renameButton = document.createElement('button');
    renameButton.type = 'button';
    renameButton.textContent = 'Renommer';
    renameButton.addEventListener('click', () => this.renameSelected());

    this.fileInput = document.createElement('input');
    this.fileInput.type = 'file';
    this.fileInput.accept = '.cube';
    this.fileInput.hidden = true;
    this.fileInput.addEventListener('change', () => void this.handleFileSelected());

    this.element.append(this.select, renameButton, addButton, this.fileInput);
    this.renderOptions();
  }

  onChange(callback: (lut: ParsedCubeLut) => void): void {
    this.onChangeCallback = callback;
  }

  get selectedLut(): ParsedCubeLut {
    return this.options[this.select.selectedIndex]!.lut;
  }

  private async handleFileSelected(): Promise<void> {
    const file = this.fileInput.files?.[0];
    if (!file) return;

    try {
      const lut = parseCubeLut(await file.text());
      this.options.push({ name: file.name, lut });
      this.renderOptions();
      this.select.selectedIndex = this.options.length - 1;
      this.onChangeCallback?.(lut);
    } catch (error) {
      alert(`Fichier .cube invalide : ${(error as Error).message}`);
    } finally {
      this.fileInput.value = '';
    }
  }

  private renameSelected(): void {
    const option = this.options[this.select.selectedIndex];
    if (!option) return;

    const newName = prompt('Nouveau nom pour ce LUT :', option.name);
    if (!newName || !newName.trim()) return;

    option.name = newName.trim();
    this.renderOptions();
    this.select.selectedIndex = this.options.indexOf(option);
  }

  private renderOptions(): void {
    this.select.innerHTML = '';
    for (const option of this.options) {
      const optionElement = document.createElement('option');
      optionElement.textContent = option.name;
      this.select.appendChild(optionElement);
    }
  }
}
