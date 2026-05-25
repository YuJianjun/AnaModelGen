import type { CIRCircuit, IdentifiedBlock, CIRDevice } from '../../types/cir-types';

/**
 * Differential Pair Detector
 *
 * Pattern: Two source-coupled MOSFETs with same W/L (or ratio 1:1).
 * M1(d, g, s, b) and M2(d, g, s, b) where M1.s === M2.s (shared source).
 */
export function detectDifferentialPairs(cir: CIRCircuit): IdentifiedBlock[] {
  const blocks: IdentifiedBlock[] = [];
  const mosfets = cir.devices.filter(d => d.type === 'nmos' || d.type === 'pmos');

  for (let i = 0; i < mosfets.length; i++) {
    for (let j = i + 1; j < mosfets.length; j++) {
      const m1 = mosfets[i];
      const m2 = mosfets[j];

      // Same type (both NMOS or both PMOS)
      if (m1.type !== m2.type) continue;

      // Shared source net
      if (m1.terminals['s'] !== m2.terminals['s']) continue;

      // Same bulk connection
      if (m1.terminals['b'] !== m2.terminals['b']) continue;

      // Different gate nets (differential inputs)
      if (m1.terminals['g'] === m2.terminals['g']) continue;

      // Different drain nets (differential outputs)
      if (m1.terminals['d'] === m2.terminals['d']) continue;

      const m1Idx = cir.devices.indexOf(m1);
      const m2Idx = cir.devices.indexOf(m2);

      const w1 = tryParseParam(m1.params['W']);
      const w2 = tryParseParam(m2.params['W']);

      blocks.push({
        type: 'differential_pair',
        name: `diffpair_${m1.name}_${m2.name}`,
        deviceIndices: [m1Idx, m2Idx],
        ports: {
          inp: m1.terminals['g'],
          inn: m2.terminals['g'],
          outp: m1.terminals['d'],
          outn: m2.terminals['d'],
          tail: m1.terminals['s'],
        },
        extractedParams: {
          widthRatio: w1 !== null && w2 !== null ? w1 / w2 : 1,
          confidence: 0.8,
        },
        confidence: 0.8,
        hasFeedback: false,
        subBlocks: [],
        hierarchyDepth: 0,
      });
    }
  }

  return blocks;
}

function tryParseParam(val: string | number | undefined): number | null {
  if (typeof val === 'number') return val;
  if (typeof val === 'string') {
    const n = parseFloat(val);
    return isNaN(n) ? null : n;
  }
  return null;
}
