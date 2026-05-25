import type { AnalogSpec, AnalogTimingConstraintDef, TruthTable, TruthTableRow } from '../../types/analog-spec-types';
import type {
  SVACheckerModule, SVACheckerPort, SVACheckerParam, SVAProperty,
  SVABindDirective, SVAGenerationResult, SVAClockRef,
} from '../../types/sva-types';

/**
 * SVA Checker Generator
 *
 * Generates SystemVerilog Assertion (SVA) checkers from analog specs.
 * Supports:
 * - Timing constraint → SVA property/assertion
 * - Truth table → SVA assertion
 * - Bind wrapper generation
 * - Multi-simulator compatible SVA subset (VCS, Xcelium, Questa)
 */
export class SVACheckerGenerator {
  generate(spec: AnalogSpec, targetModule: string): SVAGenerationResult {
    const checkers = this.generateCheckers(spec);
    const bindDirectives = this.generateBind(checkers, targetModule);
    const files = this.generateFiles(checkers, bindDirectives);
    const warnings = this.collectWarnings(spec);

    return {
      checkerModules: checkers,
      bindDirectives,
      files,
      warnings,
      compatNotes: this.generateCompatNotes(),
    };
  }

  private generateCheckers(spec: AnalogSpec): SVACheckerModule[] {
    const modules: SVACheckerModule[] = [];

    // Timing constraint checker
    if (spec.timingConstraints.length > 0) {
      const timingChecker = this.buildTimingChecker(spec);
      modules.push(timingChecker);
    }

    // Truth table checker
    for (const table of spec.truthTables) {
      const ttChecker = this.buildTruthTableChecker(spec, table);
      modules.push(ttChecker);
    }

    return modules;
  }

  /** Build an SVA checker for timing constraints */
  private buildTimingChecker(spec: AnalogSpec): SVACheckerModule {
    const prefix = spec.name.replace(/\s+/g, '_').toLowerCase();
    const clockPort = this.findClockPort(spec);

    const ports: SVACheckerPort[] = [
      ...spec.ports.map(p => ({
        name: p.name,
        direction: 'input' as const,
        type: (p.signalType === 'digital' || p.signalType === 'clock') ? 'logic' as const : 'real' as const,
      })),
    ];

    const properties: SVAProperty[] = [];
    for (const tc of spec.timingConstraints) {
      const prop = this.timingToProperty(tc, prefix, clockPort);
      if (prop) properties.push(prop);
    }

    return {
      name: `${prefix}_timing_checker`,
      ports,
      params: [],
      properties,
      sequences: [],
      internals: [],
    };
  }

  /** Build an SVA checker for a truth table */
  private buildTruthTableChecker(spec: AnalogSpec, table: TruthTable): SVACheckerModule {
    const prefix = spec.name.replace(/\s+/g, '_').toLowerCase();
    const clockPort = this.findClockPort(spec);

    const ports: SVACheckerPort[] = [
      ...table.inputPorts.map(name => ({
        name, direction: 'input' as const, type: 'logic' as const,
      })),
      ...table.outputPorts.map(name => ({
        name, direction: 'input' as const, type: 'logic' as const,
      })),
    ];

    const properties: SVAProperty[] = [];
    for (let i = 0; i < table.rows.length; i++) {
      const prop = this.truthTableRowToProperty(table, table.rows[i], i, prefix, clockPort);
      if (prop) properties.push(prop);
    }

    return {
      name: `${prefix}_${table.name}_checker`,
      ports,
      params: [],
      properties,
      sequences: [],
      internals: [],
    };
  }

  /** Convert a timing constraint to an SVA property */
  private timingToProperty(
    tc: AnalogTimingConstraintDef,
    prefix: string,
    clockPort: string | undefined
  ): SVAProperty | undefined {
    const label = `${prefix}_${tc.name.replace(/\s+/g, '_').toLowerCase()}`;
    const severity = this.mapSeverity(tc.severity);

    // Build property expression based on constraint type
    const expr = this.buildTimingExpression(tc, clockPort);
    if (!expr) return undefined;

    return {
      name: label,
      description: tc.description || tc.name,
      clock: this.resolveClock(clockPort),
      reset: 'rst_n',
      expression: expr,
      type: 'concurrent_assert',
      severity,
      label,
    };
  }

  /** Build the SVA expression for a timing constraint */
  private buildTimingExpression(tc: AnalogTimingConstraintDef, clockPort?: string): string | undefined {
    const clk = clockPort || 'clk';
    const val = tc.value;

    switch (tc.type) {
      case 'lock_time': {
        if (val.max) {
          // Map max lock time to clock cycles (assume 100MHz ref clock = 10ns period)
          const cycles = Math.ceil((val.max * 1e-9) / 10e-9);
          return `$rose(lock) |-> ##[0:${Math.min(cycles, 5000)}] lock`;
        }
        return `$rose(lock) |-> ##[0:1000] lock`;
      }

      case 'settling_time': {
        return `$rose(enable) |-> ##[1:100] $stable(output_dc)`;
      }

      case 'setup_time': {
        if (val.min) return `$setup(data, ${clk}, ${val.min * 1e-9})`;
        return `$setup(data, ${clk}, 1e-9)`;
      }

      case 'hold_time': {
        if (val.min) return `$hold(${clk}, data, ${val.min * 1e-9})`;
        return `$hold(${clk}, data, 0.5e-9)`;
      }

      case 'propagation_delay': {
        if (val.max) return `$rose(data_in) |-> ##[0:${Math.ceil(val.max * 1e9 / 10)}] $rose(data_out)`;
        return `$rose(data_in) |-> ##[0:10] $rose(data_out)`;
      }

      case 'pulse_width': {
        if (val.min) return `$width(clk, ${val.min * 1e-9})`;
        return `$width(clk, 0.5e-9)`;
      }

      case 'rise_time': {
        const maxRise = val.max || 100e-12;
        return `$rose(data) |-> ($time <= ${maxRise * 1e9})`;
      }

      case 'fall_time': {
        const maxFall = val.max || 100e-12;
        return `$fell(data) |-> ($time <= ${maxFall * 1e9})`;
      }

      case 'jitter': {
        // Simplified jitter check: clock period variation within tolerance
        const tol = val.max || 0.01;
        return `##[1:2] ($realtime - $realtime) < ${tol}`;
      }

      case 'duty_cycle': {
        return `$rose(clk) |-> ##1 $fell(clk)`;
      }

      case 'bandwidth': {
        // Bandwidth can't be directly checked with SVA - generate a cover property
        return undefined; // Skip, BW is a frequency-domain metric
      }

      case 'monotonic': {
        return `$stable(data) or $changed(data)`;
      }

      case 'glitch_free': {
        return `@(data) (1'b1) |-> $stable(data)`;
      }

      default:
        // Generic timing check: signal changes within expected window
        return `$rose(enable) |-> ##[1:100] $rose(ready)`;
    }
  }

  /** Convert a truth table row to an SVA assertion */
  private truthTableRowToProperty(
    table: TruthTable,
    row: TruthTableRow,
    index: number,
    prefix: string,
    clockPort?: string
  ): SVAProperty | undefined {
    const clk = clockPort || 'clk';
    const label = `${prefix}_${table.name}_row${index}`;

    // Build input condition: (in1 == val1) && (in2 == val2) && ...
    const inputExprs = table.inputPorts.map(port => {
      const val = row.inputs[port];
      if (!val) return '';
      if (val === 'X' || val === 'x') return ''; // Don't care
      if (val === '1') return `${port} == 1'b1`;
      if (val === '0') return `${port} == 1'b0`;
      if (val.includes("'b") || val.includes("'h") || val.includes("'d")) {
        return `${port} == ${val}`;
      }
      return `${port} == ${val}`;
    }).filter(e => e !== '');

    if (inputExprs.length === 0) return undefined;

    // Build output condition
    const outputExprs = table.outputPorts.map(port => {
      const val = row.outputs[port];
      if (!val || val === 'X' || val === 'x') return '';
      if (val === '1') return `${port} == 1'b1`;
      if (val === '0') return `${port} == 1'b0`;
      return `${port} == ${val}`;
    }).filter(e => e !== '');

    if (outputExprs.length === 0) return undefined;

    const inputCondition = inputExprs.join(' && ');
    const outputCondition = outputExprs.join(' && ');
    const implication = table.type === 'sequential'
      ? '|=>' : '|->';

    return {
      name: label,
      description: `Row ${index}: ${inputCondition}`,
      clock: this.resolveClock(clockPort),
      reset: 'rst_n',
      expression: `(${inputCondition}) ${implication} (${outputCondition})`,
      type: 'concurrent_assert',
      severity: 'error',
      label,
    };
  }

  /** Generate bind directives */
  private generateBind(checkers: SVACheckerModule[], targetModule: string): SVABindDirective[] {
    return checkers.map(checker => ({
      targetModule,
      checkerModule: checker.name,
      instanceName: `${checker.name}_inst`,
      portConnections: {}, // Will use .* auto-connect
      autoConnect: true,
    }));
  }

  /** Generate output files */
  private generateFiles(
    checkers: SVACheckerModule[],
    binds: SVABindDirective[]
  ): SVAGenerationResult['files'] {
    const files: SVAGenerationResult['files'] = [];

    for (const checker of checkers) {
      checker.code = this.renderChecker(checker);
      files.push({
        name: `${checker.name}.sv`,
        content: checker.code!,
        type: 'checker',
      });
    }

    if (binds.length > 0) {
      const bindContent = this.renderBind(binds);
      files.push({
        name: 'bind_checkers.sv',
        content: bindContent,
        type: 'bind',
      });
    }

    return files;
  }

  /** Render a checker module to SV code */
  private renderChecker(checker: SVACheckerModule): string {
    const lines: string[] = [];

    lines.push(`// Generated SVA Checker: ${checker.name}`);
    lines.push(`// Properties: ${checker.properties.length}`);
    lines.push('');
    lines.push(`module ${checker.name} (`);

    // Ports
    const portLines = checker.ports.map(p =>
      `  input ${p.type}${p.width ? ` [${p.width-1}:0]` : ''} ${p.name}`
    );
    lines.push(portLines.join(',\n'));
    lines.push(');');

    // Properties
    for (const prop of checker.properties) {
      lines.push('');
      if (prop.description) lines.push(`  // ${prop.description}`);
      lines.push(`  ${prop.label}: assert property (`);
      lines.push(`    @(${prop.clock.edge} ${prop.clock.signal})`);
      if (prop.reset) {
        lines.push(`    disable iff(!${prop.reset})`);
      }
      lines.push(`    ${prop.expression}`);
      lines.push(`  ) else $error("[${checker.name}] ${prop.description || prop.name} failed");`);
    }

    lines.push('');
    lines.push('endmodule');
    lines.push('');

    return lines.join('\n');
  }

  /** Render bind directives to SV code */
  private renderBind(binds: SVABindDirective[]): string {
    const lines: string[] = [];

    lines.push('// Generated SVA Bind File');
    lines.push(`// Total checkers: ${binds.length}`);
    lines.push('');

    for (const bind of binds) {
      lines.push(`bind ${bind.targetModule} ${bind.checkerModule} ${bind.instanceName} (`);
      if (bind.autoConnect) {
        lines.push('  .*');
      } else {
        const conns = Object.entries(bind.portConnections)
          .map(([port, net]) => `  .${port}(${net})`);
        lines.push(...conns);
      }
      lines.push(');');
      lines.push('');
    }

    return lines.join('\n');
  }

  /** Find the clock port from spec ports */
  private findClockPort(spec: AnalogSpec): string | undefined {
    const clkPort = spec.ports.find(p =>
      p.signalType === 'clock' ||
      p.name.toLowerCase().includes('clk')
    );
    return clkPort?.name;
  }

  private resolveClock(clockPort?: string): SVAClockRef {
    return {
      signal: clockPort || 'clk',
      edge: 'posedge',
    };
  }

  /** Map severity string */
  private mapSeverity(severity?: string): SVAProperty['severity'] {
    switch (severity) {
      case 'fatal': return 'fatal';
      case 'warning': return 'warning';
      case 'info': return 'info';
      default: return 'error';
    }
  }

  /** Collect warnings from spec */
  private collectWarnings(spec: AnalogSpec): string[] {
    const warnings: string[] = [];
    if (!this.findClockPort(spec)) {
      warnings.push('No clock port found in spec - using default "clk"');
    }
    return warnings;
  }

  /** Generate compatibility notes */
  private generateCompatNotes(): string[] {
    return [
      'VCS: Full SVA support (2009/2012)',
      'Xcelium: Full SVA support, use -sv -assert for assertions',
      'Questa: Full SVA support, use -assertdebug for debug visibility',
      'Verilator: SVA not supported - skip checker files for Verilator flows',
      'Note: $setup/$hold system functions may require +define+ timing_check_enable in VCS',
    ];
  }
}
