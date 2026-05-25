import type { CIRCircuit, IdentifiedBlock } from '../../types/cir-types';

/**
 * Current Mirror Detector
 *
 * Pattern: Two MOSFETs with shared gate and shared source.
 * M1(d, g, s, b) and M2(d, g, s, b) where M1.g === M2.g (shared gate)
 * and M1.s === M2.s (shared source).
 *
 * Diode-connected: M1.d === M1.g (reference side)
 */
export function detectCurrentMirrors(cir: CIRCircuit): IdentifiedBlock[] {
  const blocks: IdentifiedBlock[] = [];
  const mosfets = cir.devices.filter(d => d.type === 'nmos' || d.type === 'pmos');

  for (let i = 0; i < mosfets.length; i++) {
    for (let j = i + 1; j < mosfets.length; j++) {
      const m1 = mosfets[i];
      const m2 = mosfets[j];

      if (m1.type !== m2.type) continue;
      if (m1.terminals['g'] !== m2.terminals['g']) continue;
      if (m1.terminals['s'] !== m2.terminals['s']) continue;

      // Check diode-connection on at least one device
      const m1Diode = m1.terminals['d'] === m1.terminals['g'];
      const m2Diode = m2.terminals['d'] === m2.terminals['g'];
      if (!m1Diode && !m2Diode) continue;

      const refDevice = m1Diode ? m1 : m2;
      const mirrorDevice = m1Diode ? m2 : m1;
      const m1Idx = cir.devices.indexOf(m1);
      const m2Idx = cir.devices.indexOf(m2);

      const wRef = tryParseParam(refDevice.params['W']);
      const wMirror = tryParseParam(mirrorDevice.params['W']);
      const lRef = tryParseParam(refDevice.params['L']);
      const lMirror = tryParseParam(mirrorDevice.params['L']);

      const ratioRef = wRef !== null && lRef !== null ? wRef / lRef : 1;
      const ratioMirror = wMirror !== null && lMirror !== null ? wMirror / lMirror : 1;
      const mirrorRatio = ratioRef > 0 ? ratioMirror / ratioRef : 1;

      blocks.push({
        type: 'current_mirror',
        name: `cmirror_${m1.name}_${m2.name}`,
        deviceIndices: [m1Idx, m2Idx],
        ports: {
          ref_in: refDevice.terminals['d'],
          ref_gate: refDevice.terminals['g'],
          mirror_out: mirrorDevice.terminals['d'],
          source: mirrorDevice.terminals['s'],
        },
        extractedParams: {
          mirrorRatio,
          confidence: 0.85,
        },
        confidence: 0.85,
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
