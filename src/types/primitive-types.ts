/**
 * Primitive Library Types
 *
 * Defines the structure for the analog primitive library.
 * Each primitive is a pre-verified SystemVerilog module that models
 * an analog device or circuit behavior.
 */

import type { BlockType } from './cir-types';

/** Primitive category */
export type PrimitiveCategory =
  | 'passive'           // R, C, L, transmission line
  | 'active_device'     // MOS, BJT, diode
  | 'source'            // V/I sources, PWL
  | 'controlled_source' // VCVS, VCCS, CCVS, CCCS
  | 'amplifier'         // OpAmp, OTA, differential pair
  | 'comparator'
  | 'mixer'
  | 'filter'
  | 'oscillator'        // VCO, ring osc, LC osc
  | 'pll_cdr'           // PLL, CDR, phase detector
  | 'equalizer'         // CTLE, DFE
  | 'driver'            // CML driver, TX driver
  | 'buffer'            // RX buffer, repeater
  | 'digital_interface' // Serializer, deserializer
  | 'reference'         // Bandgap, bias generator
  | 'calibration'       // Impedance/offset calibration
  | 'misc';

/** Primitive port direction for SV generation */
export type PrimitivePortDirection = 'input' | 'output' | 'inout';

/** SV port type for multi-simulator compatibility */
export type SVPortType = 'logic' | 'wire' | 'real' | 'wreal';

/** Primitive port definition */
export interface PrimitivePort {
  /** Port name */
  name: string;
  /** Direction */
  direction: PrimitivePortDirection;
  /** SV type */
  svType: SVPortType;
  /** Width (for logic ports) */
  width?: number;
  /** Description */
  description?: string;
  /** Default value */
  defaultValue?: string;
}

/** Primitive parameter definition */
export interface PrimitiveParam {
  /** Parameter name */
  name: string;
  /** SV type */
  svType: 'real' | 'integer' | 'string' | 'logic';
  /** Default value */
  defaultValue: string | number;
  /** Description */
  description?: string;
  /** Valid range */
  range?: { min?: number; max?: number };
  /** Unit (V, A, Hz, s, F, H, Ohm) */
  unit?: string;
}

/** Behavior model type */
export type BehaviorType =
  | 'structural'      // Direct device-to-primitive mapping
  | 'behavioral'      // Algebraic/differential equation based
  | 'table_based'     // Lookup table (NLDM-like)
  | 'event_driven'    // Event-driven (XMODEL style)
  | 'mixed';          // Combination of above

/** Simulator compatibility flags */
export interface SimulatorCompat {
  vcs: boolean;
  xcelium: boolean;
  questa: boolean;
  verilator: boolean;
}

/** Primitive definition */
export interface PrimitiveDef {
  /** Unique primitive name */
  name: string;
  /** Display name */
  displayName: string;
  /** Category */
  category: PrimitiveCategory;
  /** Block type mapping (which recognized blocks use this) */
  mappedBlockTypes: BlockType[];
  /** Description */
  description: string;
  /** Ports */
  ports: PrimitivePort[];
  /** Parameters */
  params: PrimitiveParam[];
  /** Behavior model type */
  behaviorType: BehaviorType;
  /** Simulator compatibility */
  simulatorCompat: SimulatorCompat;
  /** SV template file path (relative to primitives/models/sv/) */
  templatePath: string;
  /** Whether this primitive supports parameterization for different SerDes speeds */
  supportsSpeedScaling: boolean;
  /** Key behavioral parameters for SerDes modeling */
  serDesParams?: {
    /** Max data rate supported (Gbps) */
    maxDataRateGbps?: number;
    /** Number of equalization taps */
    eqTaps?: number;
    /** Jitter modeling support */
    jitterModeling?: boolean;
    /** Adaptation support */
    adaptation?: boolean;
  };
  /** Tags for search/grouping */
  tags: string[];
  /** Version */
  version: string;
}

/** Primitive library - collection of all available primitives */
export interface PrimitiveLibrary {
  /** Library name */
  name: string;
  /** Library version */
  version: string;
  /** All registered primitives */
  primitives: Map<string, PrimitiveDef>;
  /** Index by block type for topology mapping */
  blockTypeIndex: Map<BlockType, PrimitiveDef[]>;
  /** Index by category */
  categoryIndex: Map<PrimitiveCategory, PrimitiveDef[]>;
}

/** Instance of a primitive in a generated model */
export interface PrimitiveInstance {
  /** Instance name */
  instanceName: string;
  /** Primitive definition reference */
  primitiveName: string;
  /** Port connections: primitive port → net name */
  portConnections: Record<string, string>;
  /** Parameter overrides */
  paramOverrides: Record<string, string | number>;
  /** Comment/annotation */
  comment?: string;
}

/** Complete generated model structure */
export interface GeneratedSVModel {
  /** Model name */
  name: string;
  /** Model ports */
  ports: PrimitivePort[];
  /** Model parameters */
  params: PrimitiveParam[];
  /** Primitive instances inside */
  instances: PrimitiveInstance[];
  /** Internal nets */
  internalNets: Array<{
    name: string;
    type: 'real' | 'logic' | 'wire';
    width?: number;
  }>;
  /** Generated SV code */
  code?: string;
  /** Generation metadata */
  metadata: {
    sourceCircuit?: string;
    generatedAt: Date;
    primitiveCount: number;
    totalInstances: number;
    warnings: string[];
  };
}
