import type { CIRCircuit, IdentifiedBlock, BlockType } from '../../types/cir-types';
import type { SPICEDeviceType } from '../../types/spice-types';

/**
 * CML (Current-Mode Logic) Topology Detector
 *
 * Detects CML drivers, CML latches, and CML buffers.
 * 
 * CML driver pattern:
 * - Differential pair (2 NMOS shared source)
 * - Resistor loads on drains (or PMOS loads in triode)
 * - Tail current source
 *
 * CML latch pattern:
 * - Clock pair (differential pair with clock inputs)
 * - Cross-coupled latch pair
 * - Tail current source
 */
export function detectCMLTopologies(cir: CIRCircuit): IdentifiedBlock[] {
  const blocks: IdentifiedBlock[] = [];

  const nfets = cir.devices.filter(d => d.type === 'nmos');
  const resistors = cir.devices.filter(d => d.type === 'resistor');
  const nmosLoads = cir.devices.filter(d => d.type === 'pmos');

  // Find differential pairs (source-coupled NMOS)
  const diffPairs: Array<{ m1: typeof cir.devices[0]; m2: typeof cir.devices[0]; tailNet: string }> = [];

  for (let i = 0; i < nfets.length; i++) {
    for (let j = i + 1; j < nfets.length; j++) {
      const m1 = nfets[i];
      const m2 = nfets[j];
      if (m1.terminals['s'] === m2.terminals['s']) {
        diffPairs.push({ m1, m2, tailNet: m1.terminals['s'] });
      }
    }
  }

  // Check each diff pair for CML characteristics
  for (const dp of diffPairs) {
    const m1 = dp.m1;
    const m2 = dp.m2;
    const m1d = m1.terminals['d'];
    const m2d = m2.terminals['d'];

    // Check for resistor loads on drains
    const loadResistors = resistors.filter(r =>
      (r.terminals['p'] === m1d || r.terminals['n'] === m1d) &&
      (r.terminals['p'] === m2d || r.terminals['n'] === m2d)
    );

    // Check for cross-coupled connection (latch detection)
    const isCrossCoupled = nfets.some(n =>
      n.name !== m1.name && n.name !== m2.name &&
      ((n.terminals['g'] === m1d && n.terminals['d'] === m2d) ||
       (n.terminals['g'] === m2d && n.terminals['d'] === m1d))
    );

    const m1Idx = cir.devices.indexOf(m1);
    const m2Idx = cir.devices.indexOf(m2);
    const loadIndices = loadResistors.map(r => cir.devices.indexOf(r));

    const baseIndices = [m1Idx, m2Idx, ...loadIndices].filter(i => i >= 0);

    if (loadResistors.length >= 1) {
      let blockType: BlockType;
      if (isCrossCoupled) {
        blockType = 'cml_latch';
      } else {
        blockType = 'cml_driver';
      }

      blocks.push({
        type: blockType,
        name: `${blockType}_${m1.name}`,
        deviceIndices: baseIndices,
        ports: {
          inp: m1.terminals['g'],
          inn: m2.terminals['g'],
          outp: m1d,
          outn: m2d,
          tail: dp.tailNet,
        },
        extractedParams: {
          hasResistiveLoad: loadResistors.length,
          isCrossCoupled: isCrossCoupled ? 1 : 0,
          confidence: isCrossCoupled ? 0.8 : 0.75,
        },
        confidence: isCrossCoupled ? 0.8 : 0.75,
        hasFeedback: isCrossCoupled,
        subBlocks: [],
        hierarchyDepth: 0,
      });
    }
  }

  return blocks;
}
