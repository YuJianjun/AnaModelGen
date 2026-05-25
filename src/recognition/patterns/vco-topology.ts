import type { CIRCircuit, IdentifiedBlock, CIRDevice } from '../../types/cir-types';

/**
 * VCO Topology Detectors
 *
 * Two types:
 * 1. Ring oscillator: odd number of inverters/delays in a loop
 * 2. LC oscillator: cross-coupled NMOS pair + inductor + capacitor
 */

/** Detect ring oscillator: 3+ inverters in a feedback loop */
function detectRingOscillator(cir: CIRCircuit): IdentifiedBlock[] {
  // Find inverters: NMOS + PMOS pair sharing gate and drain
  const nfets = cir.devices.filter(d => d.type === 'nmos');
  const pfets = cir.devices.filter(d => d.type === 'pmos');
  const inverters: Array<{ name: string; in: string; out: string; devices: number[] }> = [];

  for (const nfet of nfets) {
    for (const pfet of pfets) {
      if (nfet.terminals['g'] !== pfet.terminals['g']) continue;
      if (nfet.terminals['d'] !== pfet.terminals['d']) continue;

      const nIdx = cir.devices.indexOf(nfet);
      const pIdx = cir.devices.indexOf(pfet);
      inverters.push({
        name: `inv_${nfet.name}_${pfet.name}`,
        in: nfet.terminals['g'],
        out: nfet.terminals['d'],
        devices: [nIdx, pIdx],
      });
    }
  }

  // Look for rings: inverter.out → next.inverter.in forming a cycle
  if (inverters.length >= 3) {
    // Build adjacency: out → in
    const outMap = new Map<string, typeof inverters[0]>();
    for (const inv of inverters) {
      outMap.set(inv.out, inv);
    }

    // Find the longest chain that loops back
    for (const start of inverters) {
      const visited = new Set<string>();
      const chain: typeof inverters = [];
      let current = start;
      let count = 0;

      while (count < 10 && !visited.has(current.name)) {
        visited.add(current.name);
        chain.push(current);
        const nextIn = current.out;
        current = outMap.get(nextIn) as typeof inverters[0];
        if (!current) break;
        count++;
      }

      if (chain.length >= 3 && current?.out === start.in) {
        const deviceIndices = chain.flatMap(inv => inv.devices);
        const uniqueIndices = [...new Set(deviceIndices)];

        return [{
          type: 'ring_oscillator',
          name: `ring_osc_${chain.length}stage`,
          deviceIndices: uniqueIndices,
          ports: {
            supply: chain[0].out, // approximate
          },
          extractedParams: {
            stageCount: chain.length,
            confidence: 0.7,
          },
          confidence: 0.7,
          hasFeedback: true,
          subBlocks: [],
          hierarchyDepth: 0,
        }];
      }
    }
  }

  return [];
}

/** Detect LC oscillator: cross-coupled pair + inductor(s) */
function detectLCOscillator(cir: CIRCircuit): IdentifiedBlock[] {
  const inductors = cir.devices.filter(d => d.type === 'inductor');
  const capacitors = cir.devices.filter(d => d.type === 'capacitor');
  const nfets = cir.devices.filter(d => d.type === 'nmos');

  // Look for cross-coupled NMOS pair
  for (let i = 0; i < nfets.length; i++) {
    for (let j = i + 1; j < nfets.length; j++) {
      const m1 = nfets[i];
      const m2 = nfets[j];

      // Cross-coupled: M1.g → M2.d and M2.g → M1.d
      if (m1.terminals['g'] !== m2.terminals['d']) continue;
      if (m2.terminals['g'] !== m1.terminals['d']) continue;
      if (m1.terminals['s'] !== m2.terminals['s']) continue;

      // Check for inductors on the drains
      const m1d = m1.terminals['d'];
      const m2d = m2.terminals['d'];
      const hasInductorOnDrain = inductors.some(l =>
        l.terminals['p'] === m1d || l.terminals['p'] === m2d ||
        l.terminals['p']?.includes(m1d) || l.terminals['p']?.includes(m2d)
      );

      // Check for capacitor in LC tank
      const lcCap = capacitors.filter(c =>
        c.terminals['p'] === m1d || c.terminals['n'] === m1d
      );

      const m1Idx = cir.devices.indexOf(m1);
      const m2Idx = cir.devices.indexOf(m2);
      const lcIndices = inductors
        .filter(l => l.terminals['p'] === m1d || l.terminals['p'] === m2d)
        .map(l => cir.devices.indexOf(l));
      const capIndices = lcCap.map(c => cir.devices.indexOf(c));

      const allIndices = [m1Idx, m2Idx, ...lcIndices, ...capIndices].filter(i => i >= 0);

      if (hasInductorOnDrain && allIndices.length > 2) {
        return [{
          type: 'lc_oscillator',
          name: `lc_osc_${m1.name}_${m2.name}`,
          deviceIndices: allIndices,
          ports: {
            outp: m1d,
            outn: m2d,
            tail: m1.terminals['s'],
          },
          extractedParams: {
            hasLCtank: 1,
            confidence: 0.75,
          },
          confidence: 0.75,
          hasFeedback: true,
          subBlocks: [],
          hierarchyDepth: 0,
        }];
      }
    }
  }

  return [];
}

/** Combined VCO detector */
export function detectVCO(cir: CIRCircuit): IdentifiedBlock[] {
  const ring = detectRingOscillator(cir);
  if (ring.length > 0) return ring;

  const lc = detectLCOscillator(cir);
  if (lc.length > 0) return lc;

  return [];
}
