import type { VideoSample } from 'mediabunny';
import type { ParsedCubeLut } from '../lut/cubeParser';
import { resolveYuvToRgbCoefficients } from './colorSpace';
import { createLutTexture } from './lutTexture';
import { RGBA_FRAGMENT_SHADER_SOURCE, VERTEX_SHADER_SOURCE, buildFragmentShaderSource } from './shaders';

type LumaBitDepth = 8 | 10;

type ProgramBundle = {
  program: WebGLProgram;
  uniforms: {
    yTexture: WebGLUniformLocation;
    uTexture: WebGLUniformLocation;
    vTexture: WebGLUniformLocation;
    lutTexture: WebGLUniformLocation;
    kr: WebGLUniformLocation;
    kb: WebGLUniformLocation;
    fullRange: WebGLUniformLocation;
    lutSize: WebGLUniformLocation;
    intensity: WebGLUniformLocation;
  };
};

type RgbaProgramBundle = {
  program: WebGLProgram;
  uniforms: {
    sourceTexture: WebGLUniformLocation;
    lutTexture: WebGLUniformLocation;
    lutSize: WebGLUniformLocation;
    intensity: WebGLUniformLocation;
  };
};

// Que du 8 bits (H.264) ou du 10 bits (H.265 D-Log M) sur la Pocket 3 ; le 12 bits est traité comme du 10 bits.
function detectSourceBitDepth(format: string | null): LumaBitDepth {
  return format !== null && (format.includes('P10') || format.includes('P12')) ? 10 : 8;
}

export class FrameProcessor {
  private readonly gl: WebGL2RenderingContext;
  private readonly canvas: OffscreenCanvas | HTMLCanvasElement;
  private readonly programs = new Map<LumaBitDepth, ProgramBundle>();
  private readonly yTexture: WebGLTexture;
  private readonly uTexture: WebGLTexture;
  private readonly vTexture: WebGLTexture;
  private readonly sourceTexture: WebGLTexture;
  private readonly vao: WebGLVertexArrayObject;
  private quadBuffer!: WebGLBuffer;
  private lutTexture: WebGLTexture | null = null;
  private lutSize = 0;
  private rgbaProgram: RgbaProgramBundle | null = null;
  private lastFrameUsedFallback = false;
  private intensity = 1;

  constructor(width: number, height: number) {
    this.canvas =
      typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(width, height) : createFallbackCanvas(width, height);

    const gl = this.canvas.getContext('webgl2') as WebGL2RenderingContext | null;
    if (!gl) throw new Error("WebGL2 n'est pas disponible dans ce navigateur.");
    this.gl = gl;

    this.yTexture = this.createLumaTexture();
    this.uTexture = this.createChromaTexture();
    this.vTexture = this.createChromaTexture();
    this.sourceTexture = this.createChromaTexture();
    this.vao = this.createFullscreenQuad();
  }

  get outputCanvas(): OffscreenCanvas | HTMLCanvasElement {
    return this.canvas;
  }

  /** `true` si la dernière frame traitée a dû passer par le chemin de secours RGBA (voir `process()`). */
  get usedFallbackPath(): boolean {
    return this.lastFrameUsedFallback;
  }

  setLut(lut: ParsedCubeLut): void {
    if (this.lutTexture) this.gl.deleteTexture(this.lutTexture);
    this.lutTexture = createLutTexture(this.gl, lut);
    this.lutSize = lut.size;
  }

  /** @param intensity - Dosage du LUT entre 0 (image plate d'origine) et 1 (LUT plein). */
  setIntensity(intensity: number): void {
    this.intensity = intensity;
  }

  async process(sample: VideoSample): Promise<void> {
    if (!this.lutTexture) throw new Error('Aucun LUT chargé : appeler setLut() avant process().');

    try {
      await this.processPreciseFrame(sample);
      this.lastFrameUsedFallback = false;
    } catch (error) {
      // copyTo()/allocationSize() peuvent échouer avant tout rendu GPU (frame opaque, ou conversion
      // refusée par le navigateur) : rien n'est encore dessiné, on peut basculer sans risque en RGBA.
      console.warn(
        "Extraction précise des plans YUV impossible pour cette frame, bascule vers le mode de compatibilité couleur :",
        error,
      );
      this.lastFrameUsedFallback = true;
      this.processOpaqueFrame(sample);
    }
  }

  private async processPreciseFrame(sample: VideoSample): Promise<void> {
    const lumaBitDepth = detectSourceBitDepth(sample.format);
    // Cast nécessaire : le typage ambiant de copyTo()/allocationSize() ne connaît pas 'I420P10' (gap
    // dans les types de mediabunny), alors que la valeur est bien supportée à l'exécution.
    const targetFormat = (lumaBitDepth === 8 ? 'I420' : 'I420P10') as unknown as VideoPixelFormat;
    const bundle = this.getOrCreateProgram(lumaBitDepth);
    const coefficients = resolveYuvToRgbCoefficients(sample.colorSpace);

    const byteSize = sample.allocationSize({ format: targetFormat });
    const buffer = new Uint8Array(byteSize);
    const layout = await sample.copyTo(buffer, { format: targetFormat });

    this.uploadPlanes(buffer, layout, sample.codedWidth, sample.codedHeight, lumaBitDepth);

    const gl = this.gl;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.useProgram(bundle.program);
    gl.bindVertexArray(this.vao);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.yTexture);
    gl.uniform1i(bundle.uniforms.yTexture, 0);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.uTexture);
    gl.uniform1i(bundle.uniforms.uTexture, 1);

    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.vTexture);
    gl.uniform1i(bundle.uniforms.vTexture, 2);

    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_3D, this.lutTexture);
    gl.uniform1i(bundle.uniforms.lutTexture, 3);

    gl.uniform1f(bundle.uniforms.kr, coefficients.kr);
    gl.uniform1f(bundle.uniforms.kb, coefficients.kb);
    gl.uniform1i(bundle.uniforms.fullRange, coefficients.fullRange ? 1 : 0);
    gl.uniform1f(bundle.uniforms.lutSize, this.lutSize);
    gl.uniform1f(bundle.uniforms.intensity, this.intensity);

    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteTexture(this.yTexture);
    gl.deleteTexture(this.uTexture);
    gl.deleteTexture(this.vTexture);
    gl.deleteTexture(this.sourceTexture);
    if (this.lutTexture) gl.deleteTexture(this.lutTexture);
    for (const bundle of this.programs.values()) gl.deleteProgram(bundle.program);
    if (this.rgbaProgram) gl.deleteProgram(this.rgbaProgram.program);
    gl.deleteBuffer(this.quadBuffer);
    gl.deleteVertexArray(this.vao);
  }

  private processOpaqueFrame(sample: VideoSample): void {
    const gl = this.gl;

    // toVideoFrame() se ferme séparément du sample d'origine.
    const videoFrame = sample.toVideoFrame();
    try {
      gl.bindTexture(gl.TEXTURE_2D, this.sourceTexture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, videoFrame);
      gl.bindTexture(gl.TEXTURE_2D, null);
    } finally {
      videoFrame.close();
    }

    const bundle = this.getOrCreateRgbaProgram();

    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.useProgram(bundle.program);
    gl.bindVertexArray(this.vao);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.sourceTexture);
    gl.uniform1i(bundle.uniforms.sourceTexture, 0);

    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_3D, this.lutTexture);
    gl.uniform1i(bundle.uniforms.lutTexture, 3);

    gl.uniform1f(bundle.uniforms.lutSize, this.lutSize);
    gl.uniform1f(bundle.uniforms.intensity, this.intensity);

    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  private getOrCreateRgbaProgram(): RgbaProgramBundle {
    if (this.rgbaProgram) return this.rgbaProgram;

    const program = this.compileProgram(RGBA_FRAGMENT_SHADER_SOURCE);
    const bundle: RgbaProgramBundle = {
      program,
      uniforms: {
        sourceTexture: this.getUniformLocation(program, 'uSourceTexture'),
        lutTexture: this.getUniformLocation(program, 'uLutTexture'),
        lutSize: this.getUniformLocation(program, 'uLutSize'),
        intensity: this.getUniformLocation(program, 'uIntensity'),
      },
    };
    this.rgbaProgram = bundle;
    return bundle;
  }

  private uploadPlanes(
    buffer: Uint8Array,
    layout: PlaneLayout[],
    width: number,
    height: number,
    lumaBitDepth: LumaBitDepth,
  ): void {
    const gl = this.gl;
    const bytesPerSample = lumaBitDepth === 8 ? 1 : 2;
    const chromaWidth = Math.ceil(width / 2);
    const chromaHeight = Math.ceil(height / 2);
    const maxCodeValue = lumaBitDepth === 8 ? 255 : 1023;

    gl.bindTexture(gl.TEXTURE_2D, this.yTexture);
    if (lumaBitDepth === 8) {
      const yPlane = new Uint8Array(this.extractTightPlane(buffer, layout[0]!, width, height, 1));
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, width, height, 0, gl.RED, gl.UNSIGNED_BYTE, yPlane);
    } else {
      const yPlane = new Uint16Array(this.extractTightPlane(buffer, layout[0]!, width, height, 2));
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16UI, width, height, 0, gl.RED_INTEGER, gl.UNSIGNED_SHORT, yPlane);
    }

    const uPlane = this.normalizeChromaPlane(buffer, layout[1]!, chromaWidth, chromaHeight, bytesPerSample, maxCodeValue);
    gl.bindTexture(gl.TEXTURE_2D, this.uTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16F, chromaWidth, chromaHeight, 0, gl.RED, gl.FLOAT, uPlane);

    const vPlane = this.normalizeChromaPlane(buffer, layout[2]!, chromaWidth, chromaHeight, bytesPerSample, maxCodeValue);
    gl.bindTexture(gl.TEXTURE_2D, this.vTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16F, chromaWidth, chromaHeight, 0, gl.RED, gl.FLOAT, vPlane);

    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  /** Copie un plan en respectant le stride retourné par copyTo(), qui peut différer de width*bytesPerSample. */
  private extractTightPlane(
    buffer: Uint8Array,
    planeLayout: PlaneLayout,
    width: number,
    height: number,
    bytesPerSample: 1 | 2,
  ): ArrayBuffer {
    const tightRowBytes = width * bytesPerSample;
    const output = new Uint8Array(tightRowBytes * height);
    for (let row = 0; row < height; row++) {
      const sourceStart = planeLayout.offset + row * planeLayout.stride;
      output.set(buffer.subarray(sourceStart, sourceStart + tightRowBytes), row * tightRowBytes);
    }
    return output.buffer;
  }

  private normalizeChromaPlane(
    buffer: Uint8Array,
    planeLayout: PlaneLayout,
    width: number,
    height: number,
    bytesPerSample: 1 | 2,
    maxCodeValue: number,
  ): Float32Array {
    const tight = this.extractTightPlane(buffer, planeLayout, width, height, bytesPerSample);
    const pixelCount = width * height;
    const source = bytesPerSample === 1 ? new Uint8Array(tight) : new Uint16Array(tight);
    const output = new Float32Array(pixelCount);
    for (let i = 0; i < pixelCount; i++) output[i] = source[i]! / maxCodeValue;
    return output;
  }

  private getOrCreateProgram(lumaBitDepth: LumaBitDepth): ProgramBundle {
    const cached = this.programs.get(lumaBitDepth);
    if (cached) return cached;

    const program = this.compileProgram(buildFragmentShaderSource(lumaBitDepth));
    const bundle: ProgramBundle = {
      program,
      uniforms: {
        yTexture: this.getUniformLocation(program, 'uYTexture'),
        uTexture: this.getUniformLocation(program, 'uUTexture'),
        vTexture: this.getUniformLocation(program, 'uVTexture'),
        lutTexture: this.getUniformLocation(program, 'uLutTexture'),
        kr: this.getUniformLocation(program, 'uKr'),
        kb: this.getUniformLocation(program, 'uKb'),
        fullRange: this.getUniformLocation(program, 'uFullRange'),
        lutSize: this.getUniformLocation(program, 'uLutSize'),
        intensity: this.getUniformLocation(program, 'uIntensity'),
      },
    };
    this.programs.set(lumaBitDepth, bundle);
    return bundle;
  }

  private getUniformLocation(program: WebGLProgram, name: string): WebGLUniformLocation {
    const location = this.gl.getUniformLocation(program, name);
    if (!location) throw new Error(`Uniform WebGL introuvable : ${name}`);
    return location;
  }

  private compileProgram(fragmentSource: string): WebGLProgram {
    const gl = this.gl;
    const vertexShader = this.compileShader(gl.VERTEX_SHADER, VERTEX_SHADER_SOURCE);
    const fragmentShader = this.compileShader(gl.FRAGMENT_SHADER, fragmentSource);

    const program = gl.createProgram();
    if (!program) throw new Error('Impossible de créer le programme WebGL.');
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const info = gl.getProgramInfoLog(program);
      gl.deleteProgram(program);
      throw new Error(`Échec de la liaison du programme WebGL : ${info}`);
    }

    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);
    return program;
  }

  private compileShader(type: number, source: string): WebGLShader {
    const gl = this.gl;
    const shader = gl.createShader(type);
    if (!shader) throw new Error('Impossible de créer un shader WebGL.');
    gl.shaderSource(shader, source);
    gl.compileShader(shader);

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const info = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      throw new Error(`Échec de la compilation du shader WebGL : ${info}`);
    }

    return shader;
  }

  private createLumaTexture(): WebGLTexture {
    return this.createPlaneTexture(this.gl.NEAREST);
  }

  private createChromaTexture(): WebGLTexture {
    return this.createPlaneTexture(this.gl.LINEAR);
  }

  private createPlaneTexture(filter: number): WebGLTexture {
    const gl = this.gl;
    const texture = gl.createTexture();
    if (!texture) throw new Error('Impossible de créer une texture de plan vidéo.');
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindTexture(gl.TEXTURE_2D, null);
    return texture;
  }

  private createFullscreenQuad(): WebGLVertexArrayObject {
    const gl = this.gl;
    const vao = gl.createVertexArray();
    if (!vao) throw new Error('Impossible de créer le VAO.');
    gl.bindVertexArray(vao);

    const buffer = gl.createBuffer();
    if (!buffer) throw new Error('Impossible de créer le buffer.');
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    const vertices = new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    gl.bindVertexArray(null);
    this.quadBuffer = buffer;
    return vao;
  }
}

function createFallbackCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}
