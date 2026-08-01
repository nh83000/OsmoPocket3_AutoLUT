export type YuvMatrixInput = {
  matrix: string | null;
  fullRange: boolean | null;
};

export type YuvToRgbCoefficients = {
  kr: number;
  kb: number;
  fullRange: boolean;
};

const MATRIX_COEFFICIENTS: Record<string, { kr: number; kb: number }> = {
  bt709: { kr: 0.2126, kb: 0.0722 },
  bt470bg: { kr: 0.299, kb: 0.114 },
  smpte170m: { kr: 0.299, kb: 0.114 },
  'bt2020-ncl': { kr: 0.2627, kb: 0.0593 },
};

/**
 * La quasi-totalité des vidéos H.264/H.265 grand public (dont la Pocket 3) utilisent BT.709 en
 * "limited range" (studio). On lit les métadonnées réelles du fichier quand elles existent, et on
 * ne suppose BT.709/limited-range que lorsqu'elles sont absentes.
 */
export function resolveYuvToRgbCoefficients(colorSpace: YuvMatrixInput): YuvToRgbCoefficients {
  const key = colorSpace.matrix ?? 'bt709';
  const coefficients = MATRIX_COEFFICIENTS[key] ?? MATRIX_COEFFICIENTS.bt709!;
  return {
    kr: coefficients.kr,
    kb: coefficients.kb,
    fullRange: colorSpace.fullRange === true,
  };
}
