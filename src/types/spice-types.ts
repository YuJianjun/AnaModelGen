/**
 * SPICE Type Definitions
 * Types for parsing HSPICE netlists into an AST representation.
 */

/** Supported HSPICE device types */
export type SPICEDeviceType =
  // Active devices
  | 'nmos' | 'pmos'           // MOSFET (M element)
  | 'njf' | 'pjf'             // JFET (J element)
  | 'npn' | 'pnp'             // BJT (Q element)
  | 'diode'                    // Diode (D element)
  // Passive devices
  | 'resistor'                 // R element
  | 'capacitor'                // C element
  | 'inductor'                 // L element
  | 'transformer'              // K element (mutual inductance)
  | 'transmission_line'        // T/U element
  // Sources
  | 'vsource'                  // V element (independent voltage source)
  | 'isource'                  // I element (independent current source)
  | 'vpulse'                   // Voltage pulse source
  | 'ipulse'                   // Current pulse source
  | 'vsin'                     // Voltage sinusoidal source
  | 'isin'                     // Current sinusoidal source
  | 'vpwlf'                    // Voltage PWL/Fourier source
  | 'ipwlf'                    // Current PWL/Fourier source
  // Controlled sources
  | 'vcvs'                     // E element (voltage-controlled voltage source)
  | 'vccs'                     // G element (voltage-controlled current source)
  | 'ccvs'                     // H element (current-controlled voltage source)
  | 'cccs'                     // F element (current-controlled current source)
  // Subcircuit
  | 'subcircuit_instance'      // X element (subcircuit instantiation)
  // Digital/IO
  | 'digital_io'               // U element (digital IO model)
  // Behavioral
  | 'bv'                       // B element (arbitrary behavioral voltage source)
  | 'bi'                       // B element (arbitrary behavioral current source)
  | 'unknown';                 // Fallback for unrecognized elements

/** Model type for .MODEL cards */
export type SPICEModelType =
  | 'nmos' | 'pmos'
  | 'npn' | 'pnp'
  | 'njf' | 'pjf'
  | 'd' | 'dio'
  | 'res' | 'cap' | 'ind'
  | 'ur' | 'uco'
  | 'n'
  | string;

/** HSPICE node (net) reference */
export interface SPICENode {
  /** Node name (e.g., "VDD", "net0123", "1", "X1.subnet") */
  name: string;
  /** Whether this is a global node (e.g., "VDD!", "GND!") */
  global: boolean;
  /** Whether this is a numeric node */
  numeric: boolean;
  /** Whether node is hierarchical (dot-separated path) */
  hierarchical: boolean;
}

/** Model card (.MODEL) */
export interface SPICEModelCard {
  /** Model name */
  name: string;
  /** Model type (nmos, pmos, npn, res, etc.) */
  type: SPICEModelType;
  /** Model parameters (e.g., VTO, KP, GAMMA for MOS) */
  params: Record<string, number | string>;
  /** Raw source text */
  rawText: string;
}

/** Parameter definition (.PARAM) */
export interface SPICEParamDef {
  /** Parameter name */
  name: string;
  /** Parameter value (can be expression string) */
  value: string;
  /** Whether it's an expression (vs literal) */
  isExpression: boolean;
}

/** Device instance (the core of SPICE netlist) */
export interface SPICEDevice {
  /** Instance name (e.g., "M1", "Rload", "Xinv") */
  name: string;
  /** Device type */
  type: SPICEDeviceType;
  /** Terminal connections: role → node name */
  terminals: Record<string, string>;
  /** Device parameters (W, L, R, C, M, etc.) */
  params: Record<string, number | string>;
  /** Reference to .MODEL card name (for M, D, Q, J elements) */
  modelName?: string;
  /** Area factor */
  area?: number;
  /** Raw source line for debugging */
  rawText: string;
}

/** Subcircuit definition (.SUBCKT ... .ENDS) */
export interface SPICESubcircuit {
  /** Subcircuit name */
  name: string;
  /** External port nodes */
  ports: string[];
  /** Internal devices */
  devices: SPICEDevice[];
  /** Nested subcircuit instances */
  subcircuitInstances: SPICESubcircuitInstance[];
  /** Model cards defined inside */
  modelCards: SPICEModelCard[];
  /** Internal params */
  params: SPICEParamDef[];
  /** Internal nodes (not exposed as ports) */
  internalNodes: SPICENode[];
}

/** Subcircuit instance (X element) */
export interface SPICESubcircuitInstance {
  /** Instance name (X1, Xpll, etc.) */
  name: string;
  /** Subcircuit definition name */
  subcircuitName: string;
  /** Connection nodes (ordered - matches subcircuit port order) */
  connections: string[];
  /** Parameter overrides */
  params: Record<string, number | string>;
  /** Raw source text */
  rawText: string;
}

/** Control/analysis statement */
export interface SPICEControl {
  /** Statement type */
  type: 'options' | 'temp' | 'dc' | 'ac' | 'tran' | 'ic' | 'nodeset' | 'probe' | 'print' | 'plot' | 'meas' | 'save' | 'sensor' | 'fft' | 'noise' | 'disto' | 'sensitivity' | 'pz' | 'other';
  /** Raw control line */
  rawText: string;
  /** Parsed parameters */
  params: Record<string, string | number>;
}

/** Include/Lib reference */
export interface SPICEInclude {
  /** Type: .INCLUDE or .LIB */
  type: 'include' | 'lib';
  /** File path */
  path: string;
  /** For .LIB, the library section name */
  sectionName?: string;
}

/** Complete HSPICE netlist AST */
export interface SPICENetlist {
  /** Netlist title (first line) */
  title?: string;
  /** Top-level subcircuit (if whole netlist is .SUBCKT) */
  topSubcircuit?: SPICESubcircuit;
  /** Top-level devices */
  devices: SPICEDevice[];
  /** Top-level subcircuit instances */
  subcircuitInstances: SPICESubcircuitInstance[];
  /** Model cards at top level */
  modelCards: SPICEModelCard[];
  /** Parameter definitions */
  params: SPICEParamDef[];
  /** Control statements */
  controls: SPICEControl[];
  /** Include/Lib references */
  includes: SPICEInclude[];
  /** All nodes in the netlist */
  nodes: SPICENode[];
  /** All defined subcircuits (keyed by name) */
  subcircuitDefinitions: Map<string, SPICESubcircuit>;
  /** Raw line count */
  lineCount: number;
}

/** Flattened netlist - all hierarchy resolved into one level */
export interface FlattenedNetlist {
  /** Top-level name */
  name: string;
  /** All devices (with hierarchical prefixing) */
  devices: SPICEDevice[];
  /** All model cards */
  modelCards: Map<string, SPICEModelCard>;
  /** Ports of the design */
  ports: string[];
  /** All internal nodes */
  nodes: SPICENode[];
  /** Instance count per device type (useful for topology) */
  deviceCounts: Partial<Record<SPICEDeviceType, number>>;
}
