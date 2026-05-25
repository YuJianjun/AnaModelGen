/**
 * Circuit Intermediate Representation (CIR) Types
 *
 * CIR sits between SPICE parsing and model generation.
 * It represents the circuit as a device graph with topology annotations.
 */

import type { SPICEDeviceType, FlattenedNetlist } from './spice-types';

/** Net (node) in the circuit graph */
export interface CIRNet {
  /** Net name */
  name: string;
  /** Whether this is a port (primary IO) */
  isPort: boolean;
  /** Port direction (if applicable) */
  direction?: 'input' | 'output' | 'inout';
  /** Signal classification */
  signalType?: 'analog' | 'digital' | 'clock' | 'supply' | 'ground' | 'bias' | 'digital_analog';
  /** Connected device terminal keys: [deviceIndex, terminalName] */
  connectedTerminals: Array<[number, string]>;
  /** DC voltage (if known from netlist analysis) */
  dcVoltage?: number;
  /** Whether this net carries differential signal */
  isDifferential?: boolean;
  /** Differential pair complement net name */
  diffComplement?: string;
}

/** Port of the circuit */
export interface CIRPort {
  /** Port name */
  name: string;
  /** Port direction */
  direction: 'input' | 'output' | 'inout';
  /** Signal type classification */
  signalType: 'analog' | 'digital' | 'clock' | 'supply' | 'ground' | 'bias';
  /** Expected logic level (for digital ports) */
  logicLevel?: 'cmos' | 'cml' | 'lvds' | 'custom';
  /** Differential pair */
  differential?: {
    /** Positive terminal name */
    positive: string;
    /** Negative terminal name */
    negative: string;
  };
  /** Description from spec (if available) */
  description?: string;
}

/** Device in the circuit graph */
export interface CIRDevice {
  /** Instance name */
  name: string;
  /** Device type */
  type: SPICEDeviceType;
  /** Original SPICE device type */
  spiceType: string;
  /** Terminal connections: terminal name → net reference */
  terminals: Record<string, string>;
  /** Extracted parameters */
  params: Record<string, number | string>;
  /** Model card reference (if any) */
  modelName?: string;
  /** Whether this device has been mapped to a primitive */
  mapped?: boolean;
  /** Mapped primitive name (after topology recognition) */
  mappedPrimitive?: string;
  /** Group ID for topology recognition */
  groupId?: number;
}

/** Recognized high-level block from topology analysis */
export interface IdentifiedBlock {
  /** Block type identifier */
  type: BlockType;
  /** Human-readable instance name */
  name: string;
  /** Device indices belonging to this block */
  deviceIndices: number[];
  /** Block-level port to circuit net mapping */
  ports: Record<string, string>;
  /** Extracted behavioral parameters */
  extractedParams: Record<string, number>;
  /** Confidence score (0-1) */
  confidence: number;
  /** Whether this block forms a feedback loop */
  hasFeedback: boolean;
  /** Sub-blocks (for hierarchical blocks like PLL containing VCO) */
  subBlocks: IdentifiedBlock[];
  /** Hierarchy depth from top */
  hierarchyDepth: number;
}

/** Recognizable SerDes/PHY block types */
export type BlockType =
  | 'pll'
  | 'cdr'
  | 'vco'
  | 'charge_pump'
  | 'loop_filter'
  | 'ctle'
  | 'dfe_tap'
  | 'dfe'
  | 'cml_driver'
  | 'cml_latch'
  | 'cml_buffer'
  | 'differential_pair'
  | 'current_mirror'
  | 'current_source'
  | 'bandgap'
  | 'bias_generator'
  | 'source_degenerated_diff_pair'
  | 'resistive_load_diff_pair'
  | 'active_load_diff_pair'
  | 'common_source_amp'
  | 'source_follower'
  | 'cascode'
  | 'inverter'
  | 'ring_oscillator'
  | 'lc_oscillator'
  | 'frequency_divider'
  | 'phase_detector'
  | 'bang_bang_pd'
  | 'linear_pd'
  | 'serializer_mux'
  | 'deserializer_dff'
  | 'rx_buffer'
  | 'tx_driver'
  | 'impedance_calib'
  | 'offset_calib'
  | 'power_on_reset'
  | 'startup_circuit'
  | 'level_shifter'
  | 'esd_protection'
  | 'unknown_block';

/** Topology analysis result */
export interface TopologyResult {
  /** All identified blocks */
  blocks: IdentifiedBlock[];
  /** Unmatched devices (not grouped into any block) */
  unmatchedDevices: number[];
  /** Connectivity graph metrics */
  metrics: {
    totalDevices: number;
    totalNets: number;
    identifiedDeviceCount: number;
    coverageRatio: number; // identified / total
  };
  /** Feedback loops detected */
  feedbackLoops: FeedbackLoop[];
}

/** Feedback loop (for PLL, CDR, etc.) */
export interface FeedbackLoop {
  /** Loop name */
  name: string;
  /** Blocks in the loop path (ordered) */
  path: string[];
  /** Whether this is positive or negative feedback */
  polarity: 'positive' | 'negative';
  /** Estimated loop gain (if analyzable) */
  estimatedGain?: number;
}

/** Complete Circuit Intermediate Representation */
export interface CIRCircuit {
  /** Circuit name */
  name: string;
  /** Source information */
  source: {
    /** Original SPICE netlist file path */
    filePath?: string;
    /** Top-level subcircuit or netlist name */
    topName: string;
    /** Whether this came from a .SUBCKT */
    isSubcircuit: boolean;
  };
  /** Ports */
  ports: CIRPort[];
  /** Nets (nodes) */
  nets: Map<string, CIRNet>;
  /** Devices */
  devices: CIRDevice[];
  /** Recognized blocks (populated by topology recognizer) */
  identifiedBlocks?: IdentifiedBlock[];
  /** Topology analysis */
  topology?: TopologyResult;
  /** Build method */
  buildMethod: 'direct' | 'flattened';
  /** Original flattened netlist reference */
  flattenedNetlist?: FlattenedNetlist;
  /** Simulation configuration hints */
  simHints: {
    hasClock: boolean;
    hasFeedback: boolean;
    estimatedBlockCount: number;
    primaryPowerSupply?: string;
    primaryGround?: string;
  };
}
