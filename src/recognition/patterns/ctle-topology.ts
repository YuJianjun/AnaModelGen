import type { CIRCircuit, IdentifiedBlock } from '../../types/cir-types';

/**
 * CTLE (Continuous-Time Linear Equalizer) Detector
 *
 * Pattern: source-degenerated differential pair with RC network.
 * Key features:
 * 1. Differential pair (source-coupled NMOS)
 * 2. Degeneration resistor between source and tail
 * 3. Degeneration capacitor in parallel with resistor
 * 4. Load resistors on drains
 */
export function detectCTLE(cir: CIRCircuit): IdentifiedBlock[] {
  const blocks: IdentifiedBlock[] = [];
  const nfets = cir.devices.filter(d => d.type === 'nmos');
  const resistors = cir.devices.filter(d => d.type === 'resistor');
  const capacitors = cir.devices.filter(d => d.type === 'capacitor');

  // Find source-coupled pairs
  for (let i = 0; i < nfets.length; i++) {
    for (let j = i + 1; j < nfets.length; j++) {
      const m1 = nfets[i];
      const m2 = nfets[j];

      if (m1.terminals['s'] !== m2.terminals['s']) continue;
      if (m1.terminals['g'] === m2.terminals['g']) continue;
      if (m1.terminals['d'] === m2.terminals['d']) continue;

      const tailNet = m1.terminals['s'];
      const drain1 = m1.terminals['d'];
      const drain2 = m2.terminals['d'];

      // Check for degeneration resistor between sources
      const degenResistor = resistors.filter(r =>
        r.terminals['p'] === tailNet || r.terminals['n'] === tailNet
      );

      // Check for degeneration capacitor
      const degenCapacitor = capacitors.filter(c =>
        c.terminals['p'] === tailNet || c.terminals['n'] === tailNet
      );

      // Check for load resistors on drains
      const loadResistors = resistors.filter(r =>
        r.terminals['p'] === drain1 || r.terminals['n'] === drain1 ||
        r.terminals['p'] === drain2 || r.terminals['n'] === drain2
      );

      const deviceIndices = [
        cir.devices.indexOf(m1),
        cir.devices.indexOf(m2),
        ...degenResistor.map(r => cir.devices.indexOf(r)),
        ...degenCapacitor.map(c => cir.devices.indexOf(c)),
        ...loadResistors.map(r => cir.devices.indexOf(r)),
      ].filter(i => i >= 0);

      const hasDegeneration = degenResistor.length > 0 || degenCapacitor.length > 0;
      const hasLoad = loadResistors.length > 0;

      if (hasDegeneration && hasLoad) {
        blocks.push({
          type: 'ctle',
          name: `ctle_${m1.name}`,
          deviceIndices,
          ports: {
            inp: m1.terminals['g'],
            inn: m2.terminals['g'],
            outp: drain1,
            outn: drain2,
            tail: tailNet,
          },
          extractedParams: {
            degenResistors: degenResistor.length,
            degenCapacitors: degenCapacitor.length,
            loadResistors: loadResistors.length,
          },
          confidence: 0.7,
          hasFeedback: false,
          subBlocks: [],
          hierarchyDepth: 0,
        });
      }
    }
  }

  return blocks;
}
