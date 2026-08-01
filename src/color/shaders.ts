/** Un seul triangle plein écran (pas de buffer d'index nécessaire). */
export const VERTEX_SHADER_SOURCE = `#version 300 es
layout(location = 0) in vec2 aPosition;
out vec2 vTexCoord;

void main() {
  vTexCoord = aPosition * 0.5 + 0.5;
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

/**
 * Construit le fragment shader pour une profondeur de luminance donnée.
 *
 * - Le plan Y (luminance) est échantillonné en NEAREST à sa résolution native : 8 bits via un
 *   sampler2D classique (R8), 10 bits via un usampler2D entier (R16UI, valeurs divisées par 1023
 *   dans le shader). Comme il n'y a pas de sur-échantillonnage sur la luminance, NEAREST ne perd
 *   rien.
 * - Les plans U/V (chrominance, sous-échantillonnés en 4:2:0) sont TOUJOURS fournis en flottant
 *   normalisé (R16F) pour profiter du filtrage LINEAR du GPU — WebGL2 n'autorise pas LINEAR sur
 *   les textures entières, et la chrominance a justement besoin d'un sur-échantillonnage
 *   bilinéaire correct pour ne pas introduire de blocs visibles.
 */
export function buildFragmentShaderSource(lumaBitDepth: 8 | 10): string {
  const isIntegerLuma = lumaBitDepth === 10;
  const lumaSamplerType = isIntegerLuma ? 'usampler2D' : 'sampler2D';
  const lumaMaxCodeValue = (2 ** lumaBitDepth - 1).toFixed(1);
  const sampleY = isIntegerLuma
    ? `float(texture(uYTexture, vTexCoord).r) / ${lumaMaxCodeValue}`
    : `texture(uYTexture, vTexCoord).r`;

  return `#version 300 es
precision highp float;
${isIntegerLuma ? 'precision highp usampler2D;' : ''}

in vec2 vTexCoord;
out vec4 fragColor;

uniform ${lumaSamplerType} uYTexture;
uniform sampler2D uUTexture;
uniform sampler2D uVTexture;
uniform sampler3D uLutTexture;
uniform float uKr;
uniform float uKb;
uniform bool uFullRange;
uniform float uLutSize;

void main() {
  float yRaw = ${sampleY};
  float uRaw = texture(uUTexture, vTexCoord).r;
  float vRaw = texture(uVTexture, vTexCoord).r;

  float y;
  float cb;
  float cr;
  if (uFullRange) {
    y = yRaw;
    cb = uRaw - 0.5;
    cr = vRaw - 0.5;
  } else {
    // Plage "limited range" (studio) : noir = 16/255, blanc = 235/255, chroma centrée sur 128/255.
    y = (yRaw - 16.0 / 255.0) * (255.0 / 219.0);
    cb = (uRaw - 128.0 / 255.0) * (255.0 / 224.0);
    cr = (vRaw - 128.0 / 255.0) * (255.0 / 224.0);
  }

  float kg = 1.0 - uKr - uKb;
  float r = y + 2.0 * (1.0 - uKr) * cr;
  float b = y + 2.0 * (1.0 - uKb) * cb;
  float g = y - (2.0 * uKb * (1.0 - uKb) / kg) * cb - (2.0 * uKr * (1.0 - uKr) / kg) * cr;

  vec3 rgb = clamp(vec3(r, g, b), 0.0, 1.0);

  // Demi-texel de marge pour ne pas échantillonner hors table aux bords 0.0 et 1.0 du LUT.
  float lutScale = (uLutSize - 1.0) / uLutSize;
  float lutOffset = 0.5 / uLutSize;
  vec3 lutCoord = rgb * lutScale + lutOffset;

  fragColor = vec4(texture(uLutTexture, lutCoord).rgb, 1.0);
}
`;
}
