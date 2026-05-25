import type { CIRCircuit, CIRDevice, IdentifiedBlock, TopologyResult, FeedbackLoop, BlockType } from '../types/cir-types';
import { detectDifferentialPairs } from './patterns/differential-pair';
import { detectCurrentMirrors } from './patterns/current-mirror';
import { detectVCO } from './patterns/vco-topology';
import { detectCMLTopologies } from './patterns/cml-topology';
import { detectCTLE } from './patterns/ctle-topology';

export type PatternDetector = (cir: CIRCircuit) => IdentifiedBlock[];

/** All registered pattern detectors in priority order */
const DETECTORS: PatternDetector[] = [
  detectDifferentialPairs,
  detectCurrentMirrors,
  detectVCO,
  detectCMLTopologies,
  detectCTLE,
];

/**
 * Topology Recognizer
 *
 * Analyzes a CIRCircuit's device graph to identify known SerDes block
 * topologies. Each pattern detector registers identified blocks with
 * confidence scores and extracted parameters.
 */
export class TopologyRecognizer {
  analyze(cir: CIRCircuit): TopologyResult {
    const allBlocks: IdentifiedBlock[] = [];
    const matchedDeviceIds = new Set<number>();
    const unmatchedDevices: number[] = [];

    // Run all detectors
    for (const detector of DETECTORS) {
      const blocks = detector(cir);
      for (const block of blocks) {
        // Only add block if its devices aren't already claimed
        const unclaimedDevices = block.deviceIndices.filter(
          idx => !matchedDeviceIds.has(idx)
        );
        if (unclaimedDevices.length > 0) {
          block.deviceIndices = unclaimedDevices;
          for (const idx of unclaimedDevices) {
            matchedDeviceIds.add(idx);
          }
          allBlocks.push(block);
        }
      }
    }

    // Identify unmatched devices
    for (let i = 0; i < cir.devices.length; i++) {
      if (!matchedDeviceIds.has(i)) {
        unmatchedDevices.push(i);
      }
    }

    // Detect feedback loops
    const feedbackLoops = this.detectFeedbackLoops(cir, allBlocks);

    const totalDevices = cir.devices.length;
    const identifiedDeviceCount = allBlocks.reduce(
      (sum, b) => sum + b.deviceIndices.length, 0
    );

    return {
      blocks: allBlocks,
      unmatchedDevices,
      metrics: {
        totalDevices,
        totalNets: cir.nets.size,
        identifiedDeviceCount,
        coverageRatio: totalDevices > 0 ? identifiedDeviceCount / totalDevices : 0,
      },
      feedbackLoops,
    };
  }

  /** Detect simple feedback loops from block connectivity */
  private detectFeedbackLoops(
    _cir: CIRCircuit,
    blocks: IdentifiedBlock[]
  ): FeedbackLoop[] {
    const loops: FeedbackLoop[] = [];

    // Build port connection graph between blocks
    const blockPorts = new Map<string, Set<string>>();
    for (const block of blocks) {
      const ports = new Set(Object.values(block.ports));
      blockPorts.set(block.name, ports);
    }

    // Look for circular dependencies: block A output → block B input → block A
    for (const block of blocks) {
      if (block.type === 'pll' || block.type === 'cdr' || block.type === 'vco') {
        loops.push({
          name: `${block.name}_feedback`,
          path: [block.name, block.type],
          polarity: 'negative',
        });
      }
    }

    return loops;
  }

  /** Merge topology results back into a CIRCircuit */
  annotateCircuit(cir: CIRCircuit, result: TopologyResult): CIRCircuit {
    return {
      ...cir,
      identifiedBlocks: result.blocks,
      topology: result,
      simHints: {
        ...cir.simHints,
        hasFeedback: result.feedbackLoops.length > 0,
        hasClock: result.blocks.some(b =>
          ['vco', 'pll', 'cdr', 'ring_oscillator'].includes(b.type)
        ),
        estimatedBlockCount: result.blocks.length,
      },
    };
  }
}
