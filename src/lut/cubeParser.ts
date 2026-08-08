export type ParsedCubeLut = {
  size: number;
  /** Triplets RGB à plat, ordonnés rouge-plus-vite (index = (r + g*size + b*size*size) * 3). */
  data: Float32Array;
  domainMin: [number, number, number];
  domainMax: [number, number, number];
};

export function parseCubeLut(text: string): ParsedCubeLut {
  let size: number | null = null;
  let domainMin: [number, number, number] = [0, 0, 0];
  let domainMax: [number, number, number] = [1, 1, 1];
  const rows: number[] = [];

  const lines = text.split(/\r\n|\r|\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#') || line.startsWith('TITLE')) continue;

    if (line.startsWith('LUT_1D_SIZE')) {
      throw new Error('Les LUT 1D ne sont pas prises en charge, seulement les LUT 3D (.cube avec LUT_3D_SIZE).');
    }

    if (line.startsWith('LUT_3D_SIZE')) {
      const value = Number(line.split(/\s+/)[1]);
      if (!Number.isInteger(value) || value < 2 || value > 256) {
        throw new Error(`LUT_3D_SIZE invalide : "${line}"`);
      }
      size = value;
      continue;
    }

    if (line.startsWith('DOMAIN_MIN')) {
      domainMin = parseTriplet(line, 'DOMAIN_MIN');
      continue;
    }

    if (line.startsWith('DOMAIN_MAX')) {
      domainMax = parseTriplet(line, 'DOMAIN_MAX');
      continue;
    }

    const parts = line.split(/\s+/);
    if (parts.length !== 3 || parts.some((p) => Number.isNaN(Number(p)))) {
      throw new Error(`Ligne de données invalide : "${rawLine}"`);
    }
    rows.push(Number(parts[0]), Number(parts[1]), Number(parts[2]));
  }

  if (size === null) {
    throw new Error('Fichier .cube invalide : LUT_3D_SIZE manquant.');
  }

  const expectedRows = size * size * size;
  if (rows.length !== expectedRows * 3) {
    throw new Error(
      `Fichier .cube invalide : ${rows.length / 3} lignes de données trouvées, ${expectedRows} attendues pour LUT_3D_SIZE ${size}.`,
    );
  }

  return { size, data: new Float32Array(rows), domainMin, domainMax };
}

function parseTriplet(line: string, keyword: string): [number, number, number] {
  const values = line.split(/\s+/).slice(1).map(Number);
  if (values.length !== 3 || values.some((v) => Number.isNaN(v))) {
    throw new Error(`${keyword} invalide : "${line}"`);
  }
  return [values[0]!, values[1]!, values[2]!];
}
