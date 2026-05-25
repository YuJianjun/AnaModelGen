/**
 * SVA Checker Types
 *
 * Types for generating SystemVerilog Assertion (SVA) checkers
 * from analog specification timing constraints and truth tables.
 */

import type { TimingConstraintType, TruthTable } from './analog-spec-types';

/** SVA property type */
export type SVAPropertyType =
  | 'immediate_assert'       // assert(expression);
  | 'concurrent_assert'      // assert property (@(posedge clk) ...);
  | 'assume'                 // assume property (...);
  | 'cover'                  // cover property (...);
  | 'restrict';              // restrict property (...);

/** SVA operator for timing expressions */
export type SVATimingOp =
  | '##'                     // cycle delay
  | '##[m:n]'                // cycle delay range
  | '|->'                    // overlapped implication
  | '|=>'                    // non-overlapped implication
  | 'throughout'             // signal stability throughout sequence
  | 'within'                 // sequence within another sequence
  | 'ended';                 // sequence end point

/** Clock edge type for SVA */
export type SVAClockEdge = 'posedge' | 'negedge' | 'edge';

/** SVA expression - a single condition expression */
export interface SVAExpression {
  /** Expression string (e.g., "a == 1'b1", "cdr_lock", "$rose(ready)") */
  expr: string;
  /** Whether this uses $system functions */
  hasSystemFunc: boolean;
  /** System functions used */
  systemFuncs: string[];
}

/** Single SVA sequence (a temporal expression) */
export interface SVASequence {
  /** Sequence name */
  name: string;
  /** Sequence definition (temporal expression) */
  expression: string;
  /** Clock context */
  clock: SVAClockRef;
  /** Reset condition */
  reset?: SVAExpression;
}

/** Clock reference for SVA */
export interface SVAClockRef {
  /** Clock signal name */
  signal: string;
  /** Clock edge */
  edge: SVAClockEdge;
}

/** SVA property definition */
export interface SVAProperty {
  /** Property name */
  name: string;
  /** Description */
  description?: string;
  /** Clock context */
  clock: SVAClockRef;
  /** Reset condition (disable iff) */
  reset?: string;
  /** Property expression (the core temporal/logical expression) */
  expression: string;
  /** Whether this is an assume vs assert vs cover */
  type: SVAPropertyType;
  /** Severity level */
  severity: 'fatal' | 'error' | 'warning' | 'info';
  /** Label for the assertion statement */
  label: string;
  /** Action block on failure (optional) */
  onFailure?: string;
  /** Action block on success (optional) */
  onSuccess?: string;
  /** Enable condition (property only active when this is true) */
  enable?: string;
}

/** Complete SVA checker module definition */
export interface SVACheckerModule {
  /** Checker name */
  name: string;
  /** Ports */
  ports: SVACheckerPort[];
  /** Parameters */
  params: SVACheckerParam[];
  /** Properties */
  properties: SVAProperty[];
  /** Sequences (for complex temporal expressions) */
  sequences: SVASequence[];
  /** Internal signals/registers */
  internals: SVACheckerInternal[];
  /** Generated SV code */
  code?: string;
}

/** Checker port */
export interface SVACheckerPort {
  /** Port name */
  name: string;
  /** Direction */
  direction: 'input' | 'output';
  /** Data type */
  type: 'logic' | 'real' | 'wire';
  /** Width */
  width?: number;
  /** Description */
  description?: string;
}

/** Checker parameter */
export interface SVACheckerParam {
  /** Parameter name */
  name: string;
  /** Default value */
  defaultValue: string | number;
  /** Type */
  type: 'int' | 'real' | 'time' | 'string';
  /** Description */
  description?: string;
}

/** Checker internal signal */
export interface SVACheckerInternal {
  /** Signal name */
  name: string;
  /** Data type */
  type: 'logic' | 'real' | 'int' | 'time';
  /** Width */
  width?: number;
  /** Description */
  description?: string;
}

/** Bind directive: connects checker to target module */
export interface SVABindDirective {
  /** Target module name */
  targetModule: string;
  /** Checker module name */
  checkerModule: string;
  /** Instance name for the bind */
  instanceName: string;
  /** Port connections (checker port → target signal) */
  portConnections: Record<string, string>;
  /** Auto-connect (use .*) */
  autoConnect: boolean;
}

/** Mapping from timing constraint type to SVA property pattern */
export interface TimingToSVAMapping {
  /** Timing constraint type */
  constraintType: TimingConstraintType;
  /** SVA property template string (with {{placeholders}}) */
  propertyTemplate: string;
  /** Required signals for this template */
  requiredSignals: string[];
  /** SVA expression builder function name */
  builderName: string;
  /** Whether this needs a local variable */
  needsLocalVar: boolean;
}

/** Result from SVA generation */
export interface SVAGenerationResult {
  /** Generated checker modules */
  checkerModules: SVACheckerModule[];
  /** Bind directives */
  bindDirectives: SVABindDirective[];
  /** Generated files */
  files: Array<{
    /** File name */
    name: string;
    /** File content */
    content: string;
    /** File type */
    type: 'checker' | 'bind' | 'package';
  }>;
  /** Warnings during generation */
  warnings: string[];
  /** Simulator compatibility notes */
  compatNotes: string[];
}

/** SVA compatibility level per simulator */
export type SVACompatLevel = 'full' | 'partial' | 'unsupported';

export interface SVACompatMatrix {
  propertyTypes: Record<string, SVACompatLevel>;
  systemFunctions: Record<string, SVACompatLevel>;
  operators: Record<string, SVACompatLevel>;
  localVariables: boolean;
  checkerConstruct: boolean;
}
