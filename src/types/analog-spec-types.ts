/**
 * Analog Specification Types
 *
 * Types for parsing analog design specifications (Markdown format)
 * into structured timing constraints, truth tables, and interface definitions.
 */

type PortDirection = 'input' | 'output' | 'inout';

/** Source format for the analog spec */
export type AnalogSpecFormat = 'markdown' | 'json' | 'yaml' | 'excel';

/** Analog spec document (top-level) */
export interface AnalogSpec {
  /** Spec title */
  name: string;
  /** Document version */
  version?: string;
  /** Circuit type */
  circuitType?: 'serdes' | 'pll' | 'adc' | 'dac' | 'ldo' | 'comparator' | 'opamp' | 'mix' | 'custom';
  /** Operating conditions */
  operatingConditions?: OperatingConditions;
  /** Port/interface definitions */
  ports: AnalogPortSpec[];
  /** Timing constraints */
  timingConstraints: AnalogTimingConstraintDef[];
  /** Truth tables */
  truthTables: TruthTable[];
  /** Behavioral descriptions */
  behaviors?: BehavioralDescription[];
  /** Power/performance targets */
  targets?: PerformanceTarget[];
  /** Additional notes */
  notes?: string;
}

/** Operating conditions (PVT) */
export interface OperatingConditions {
  /** Process corners */
  process?: string[];
  /** Voltage range */
  voltage?: { min: number; max: number; unit: 'V' | 'mV' };
  /** Temperature range */
  temperature?: { min: number; max: number; unit: 'C' };
  /** Typical values */
  typical?: {
    voltage?: number;
    temperature?: number;
  };
}

/** Analog port specification */
export interface AnalogPortSpec {
  /** Port name */
  name: string;
  /** Direction */
  direction: PortDirection;
  /** Signal type */
  signalType: 'analog' | 'digital' | 'clock' | 'supply' | 'ground' | 'bias' | 'reference';
  /** Description */
  description?: string;
  /** Voltage range */
  voltageRange?: { min: number; max: number; unit: string };
  /** Current capability */
  currentCapability?: { min?: number; max?: number; unit: string };
  /** Input impedance (for analog inputs) */
  inputImpedance?: { value: number; unit: 'Ohm' | 'kOhm' | 'MOhm' | 'fF' | 'pF' };
  /** Differential pair info */
  differential?: {
    positive: string;
    negative: string;
    commonModeRange?: { min: number; max: number; unit: string };
  };
  /** Clock frequency (if clock port) */
  clockFrequency?: { value: number; unit: 'Hz' | 'kHz' | 'MHz' | 'GHz' };
}

/** Timing constraint type */
export type TimingConstraintType =
  | 'propagation_delay'       // tpd: input→output combinational delay
  | 'setup_time'              // tsu: data setup before clock
  | 'hold_time'               // th: data hold after clock
  | 'clock_to_output'         // tco: clock edge → output valid
  | 'pulse_width'             // Minimum pulse width
  | 'rise_time'               // tr: 20%-80% rise time
  | 'fall_time'               // tf: 80%-20% fall time
  | 'settling_time'           // ts: settling to within X%
  | 'lock_time'               // PLL/CDR lock acquisition time
  | 'recovery_time'           // Recovery after async signal deassertion
  | 'removal_time'            // Removal before async signal assertion
  | 'skew'                    // Clock/data skew
  | 'jitter'                  // Cycle-to-cycle or period jitter
  | 'duty_cycle'              // Clock duty cycle constraint
  | 'bandwidth'               // -3dB bandwidth
  | 'slew_rate'               // Output slew rate constraint
  | 'monotonic'               // Output must be monotonic
  | 'glitch_free'             // No glitches allowed
  | 'power_up_sequence'       // Power-up sequence timing
  | 'custom';                 // User-defined

/** Timing constraint definition */
export interface AnalogTimingConstraintDef {
  /** Constraint name */
  name: string;
  /** Constraint type */
  type: TimingConstraintType;
  /** Description */
  description?: string;
  /** Value with unit */
  value: {
    min?: number;
    typ?: number;
    max?: number;
    unit: 'ps' | 'ns' | 'us' | 'ms' | 's' | 'MHz' | 'GHz' | 'mV' | 'V' | 'mA' | 'dB' | 'UI' | 'ppm' | 'percent' | string;
  };
  /** From node/port */
  from?: string;
  /** To node/port */
  to?: string;
  /** Clock domain reference (for sequential constraints) */
  clockDomain?: string;
  /** Condition/context for this constraint */
  condition?: string;
  /** Corner (PVT) applicability */
  corners?: string[];
  /** Severity */
  severity?: 'fatal' | 'error' | 'warning' | 'info';
  /** Raw spec text for reference */
  rawText?: string;
}

/** Truth table row */
export interface TruthTableRow {
  /** Condition (optional, for complex tables) */
  condition?: string;
  /** Input values keyed by port name */
  inputs: Record<string, string>;
  /** Output values keyed by port name */
  outputs: Record<string, string>;
  /** Delay (for timing-aware truth tables) */
  delay?: string;
  /** Description of this row */
  description?: string;
}

/** Truth table definition */
export interface TruthTable {
  /** Table name */
  name: string;
  /** Description */
  description?: string;
  /** Input port names (ordered) */
  inputPorts: string[];
  /** Output port names (ordered) */
  outputPorts: string[];
  /** Internal state ports (for sequential truth tables) */
  statePorts?: string[];
  /** DOM Table rows */
  rows: TruthTableRow[];
  /** Whether this is combinational or sequential */
  type: 'combinational' | 'sequential';
  /** Default output values (when no row matches) */
  defaultOutputs?: Record<string, string>;
  /** Clock domain (for sequential) */
  clockDomain?: string;
  /** Reset condition */
  resetCondition?: string;
}

/** Behavioral description (natural language with structured extraction) */
export interface BehavioralDescription {
  /** Block/component name */
  componentName: string;
  /** Description text */
  description: string;
  /** Intended function (classified) */
  function: string;
  /** Key behavioral equations (extracted) */
  equations?: string[];
  /** Operating modes */
  modes?: Array<{
    name: string;
    condition: string;
    behavior: string;
  }>;
}

/** Performance target */
export interface PerformanceTarget {
  /** Metric name */
  metric: string;
  /** Target value */
  target: string;
  /** Unit */
  unit: string;
  /** Corner */
  corner?: string;
  /** Priority */
  priority?: 'must_have' | 'should_have' | 'nice_to_have';
}

/** Parsed analog spec result */
export interface ParsedAnalogSpec {
  /** Original format */
  format: AnalogSpecFormat;
  /** Parsed spec */
  spec: AnalogSpec;
  /** Metadata */
  metadata: {
    sourceFile?: string;
    parseTimestamp: Date;
    warnings: string[];
    errors: string[];
  };
}
