import type { ParsedCubeLut } from '../lut/cubeParser';

// RGBA16F plutôt que RGB16F : WebGL2 garantit son filtrage LINEAR nativement, sans extension.
export function createLutTexture(gl: WebGL2RenderingContext, lut: ParsedCubeLut): WebGLTexture {
  const texture = gl.createTexture();
  if (!texture) throw new Error('Impossible de créer la texture WebGL pour le LUT.');

  gl.bindTexture(gl.TEXTURE_3D, texture);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);

  const voxelCount = lut.size * lut.size * lut.size;
  const rgba = new Float32Array(voxelCount * 4);
  for (let i = 0; i < voxelCount; i++) {
    rgba[i * 4] = lut.data[i * 3]!;
    rgba[i * 4 + 1] = lut.data[i * 3 + 1]!;
    rgba[i * 4 + 2] = lut.data[i * 3 + 2]!;
    rgba[i * 4 + 3] = 1.0;
  }

  gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA16F, lut.size, lut.size, lut.size, 0, gl.RGBA, gl.FLOAT, rgba);
  gl.bindTexture(gl.TEXTURE_3D, null);

  return texture;
}
