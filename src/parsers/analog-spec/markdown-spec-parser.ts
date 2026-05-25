import type {
  AnalogSpec, AnalogPortSpec, AnalogTimingConstraintDef, TruthTable, TruthTableRow,
  OperatingConditions, PerformanceTarget, AnalogSpecFormat, TimingConstraintType,
  ParsedAnalogSpec
} from '../../types/analog-spec-types';

/**
 * Markdown Analog Spec Parser
 *
 * Parses Markdown-format analog design specifications into structured
 * AnalogSpec objects. Handles sections for:
 * - Port/interface definitions     (| port | dir | type | ... |)
 * - Timing constraints             (### Section \n - name: value)
 * - Truth tables                   (| in1 | in2 | out | ... |)
 * - Operating conditions           (Process / Voltage / Temperature)
 * - Performance targets            (| metric | target | ... |)
 */
export class MarkdownAnalogSpecParser {
  private warnings: string[] = [];
  private errors: string[] = [];

  parse(source: string): ParsedAnalogSpec {
    this.warnings = [];
    this.errors = [];

    const spec: AnalogSpec = {
      name: this.extractName(source),
      version: this.extractVersion(source),
      ports: [],
      timingConstraints: [],
      truthTables: [],
    };

    this.parseSections(source, spec);

    return {
      format: 'markdown',
      spec,
      metadata: {
        parseTimestamp: new Date(),
        warnings: this.warnings,
        errors: this.errors,
      },
    };
  }

  private extractName(source: string): string {
    const match = source.match(/^#\s+(.+)/m);
    return match ? match[1].trim() : 'unnamed_spec';
  }

  private extractVersion(source: string): string | undefined {
    const match = source.match(/\*\*Version\*\*:?\s*(\S+)/i);
    return match ? match[1] : undefined;
  }

  private parseSections(source: string, spec: AnalogSpec): void {
    // Split into sections by ## headings
    const sections = source.split(/(?=^##\s)/m);

    for (const section of sections) {
      const headerMatch = section.match(/^##\s+(.+)/m);
      if (!headerMatch) continue;

      const header = headerMatch[1].trim().toLowerCase();

      if (header.includes('interface') || header.includes('port')) {
        spec.ports = this.parsePortTable(section);
      } else if (header.includes('timing') || header.includes('constraint')) {
        spec.timingConstraints = this.parseTimingConstraints(section);
      } else if (header.includes('truth table') || header.includes('truth_table')) {
        const table = this.parseTruthTable(section);
        if (table) spec.truthTables.push(table);
      } else if (header.includes('operating') || header.includes('pvt')) {
        spec.operatingConditions = this.parseOperatingConditions(section);
      } else if (header.includes('performance') || header.includes('target')) {
        spec.targets = this.parsePerformanceTargets(section);
      } else if (header.includes('circuit type')) {
        const ct = this.parseCircuitType(section);
        if (ct) spec.circuitType = ct;
      }
    }
  }

  /** Parse | port | dir | type | description | ... table */
  private parsePortTable(section: string): AnalogPortSpec[] {
    const ports: AnalogPortSpec[] = [];
    const rows = this.parseTableRows(section);
    // Skip header row (first row)
    const dataRows = rows.slice(1);

    for (const row of dataRows) {
      if (row.length < 3) continue;
      const portsRow = {
        name: row[0].trim(),
        direction: this.normalizeDirection(row[1].trim()),
        signalType: this.inferSignalType(row[2].trim()),
        description: row[3]?.trim(),
      };

      // Check for differential pair
      if (row[4]?.toLowerCase().includes('diff') || row[5]?.toLowerCase().includes('diff')) {
        portsRow.signalType = 'analog';
      }

      ports.push(portsRow);
    }

    return ports;
  }

  /** Parse timing constraints section */
  private parseTimingConstraints(section: string): AnalogTimingConstraintDef[] {
    const constraints: AnalogTimingConstraintDef[] = [];

    // Try table format first
    const tableRows = this.parseTableRows(section);
    const dataRows = tableRows.length > 1 && tableRows[0].length >= 3 ? tableRows.slice(1) : tableRows;
    if (dataRows.length > 0) {
      for (const row of dataRows) {
        constraints.push({
          name: row[0].trim(),
          type: this.inferConstraintType(row[0], row[1] || ''),
          value: this.parseTimingValue(row[1] || ''),
          description: row[2]?.trim(),
          rawText: row.join(' | '),
        });
      }
      return constraints;
    }

    // Fallback: list format (- name: value)
    const listItems = section.match(/^-\s+(.+?):\s+(.+)$/gm);
    if (listItems) {
      for (const item of listItems) {
        const match = item.match(/^-\s+(.+?):\s+(.+)$/);
        if (!match) continue;

        constraints.push({
          name: match[1].trim(),
          type: this.inferConstraintType(match[1], match[2]),
          value: this.parseTimingValue(match[2]),
          rawText: item,
        });
      }
    }

    // Also check for key: value format under headings
    const kvItems = section.match(/^\*\*(.+?)\*\*:?\s*(.+)$/gm);
    if (kvItems && constraints.length === 0) {
      for (const item of kvItems) {
        const match = item.match(/^\*\*(.+?)\*\*:?\s*(.+)$/);
        if (!match) continue;
        constraints.push({
          name: match[1].trim(),
          type: this.inferConstraintType(match[1], match[2]),
          value: this.parseTimingValue(match[2]),
          rawText: item,
        });
      }
    }

    return constraints;
  }

  /** Parse a truth table from markdown table */
  private parseTruthTable(section: string): TruthTable | null {
    const rows = this.parseTableRows(section);
    if (rows.length < 2) return null;

    const header = rows[0];
    const dataRows = rows.slice(1);

    // Determine input and output columns
    const inputIndices: number[] = [];
    const outputIndices: number[] = [];
    const stateIndices: number[] = [];

    for (let i = 0; i < header.length; i++) {
      const h = header[i].toLowerCase().trim();
      if (h.startsWith('in') || h.includes('input') || h.includes('ctrl') || h.includes('mode') || h.includes('sel')) {
        inputIndices.push(i);
      } else if (h.includes('state') || h.includes('current') || h.includes('prev')) {
        stateIndices.push(i);
      } else if (h.startsWith('out') || h.includes('output') || h.includes('result')) {
        outputIndices.push(i);
      } else if (h.includes('description') || h.includes('comment')) {
        // skip description columns
      } else if (h === 'delay') {
        // special column
      } else {
        // Ambiguous column - treat as output if checking typical truth table layouts
        outputIndices.push(i);
      }
    }

    const parsedRows: TruthTableRow[] = dataRows.map(row => {
      const inputs: Record<string, string> = {};
      const outputs: Record<string, string> = {};

      for (const idx of inputIndices) {
        if (idx < row.length) inputs[header[idx].trim()] = row[idx].trim().replace(/`/g, '');
      }
      for (const idx of outputIndices) {
        if (idx < row.length) outputs[header[idx].trim()] = row[idx].trim().replace(/`/g, '');
      }

      const inputPorts = inputIndices.map(i => header[i].trim());
      const outputPorts = outputIndices.map(i => header[i].trim());

      // Use header-based detection of sequential vs combinational
      const isSequential = stateIndices.length > 0 ||
        section.toLowerCase().includes('sequential') ||
        section.toLowerCase().includes('state');

      return { inputs, outputs };
    });

    return {
      name: 'truth_table',
      inputPorts: inputIndices.map(i => header[i].trim()),
      outputPorts: outputIndices.map(i => header[i].trim()),
      statePorts: stateIndices.map(i => header[i].trim()),
      rows: parsedRows,
      type: stateIndices.length > 0 ? 'sequential' : 'combinational',
    };
  }

  /** Parse operating conditions */
  private parseOperatingConditions(section: string): OperatingConditions | undefined {
    const cond: OperatingConditions = {};

    const processMatch = section.match(/\*\*Process\*\*:?\s*(.+)$/im);
    if (processMatch) {
      cond.process = processMatch[1].split(/[,/]/).map(s => s.trim());
    }

    const voltageMatch = section.match(/\*\*Voltage\*\*:?\s*(.+?)(?:V|mV)/i)
      || section.match(/voltage.*?(\d+\.?\d*)\s*[-~to]+\s*(\d+\.?\d*)\s*(V|mV)/im);
    if (voltageMatch) {
      const v1 = parseFloat(voltageMatch[1]);
      const v2 = voltageMatch[2] ? parseFloat(voltageMatch[2]) : v1;
      const unit = (voltageMatch[3] || 'V').toUpperCase() as 'V' | 'mV';
      cond.voltage = { min: Math.min(v1, v2), max: Math.max(v1, v2), unit };
    }

    const tempMatch = section.match(/\*\*Temperature\*\*:?\s*(.+?)(?:C)/i)
      || section.match(/temperature.*?(-?\d+\.?\d*)\s*[-~to]+\s*(-?\d+\.?\d*)\s*(C)/im);
    if (tempMatch) {
      const t1 = parseFloat(tempMatch[1]);
      const t2 = tempMatch[2] ? parseFloat(tempMatch[2]) : t1;
      cond.temperature = { min: Math.min(t1, t2), max: Math.max(t1, t2), unit: 'C' };
    }

    return cond.voltage || cond.temperature || cond.process ? cond : undefined;
  }

  /** Parse performance targets table */
  private parsePerformanceTargets(section: string): PerformanceTarget[] {
    const targets: PerformanceTarget[] = [];
    const rows = this.parseTableRows(section);
    const dataRows = rows.slice(1);

    for (const row of dataRows) {
      if (row.length < 2) continue;
      targets.push({
        metric: row[0].trim(),
        target: row[1].trim(),
        unit: row[2]?.trim() || '',
        corner: row[3]?.trim(),
      });
    }

    return targets;
  }

  /** Extract circuit type from spec */
  private parseCircuitType(section: string): AnalogSpec['circuitType'] {
    const match = section.match(/^-\s+(serdes|pll|adc|dac|ldo|comparator|opamp|mix)/im);
    if (match) {
      const val = match[1].toLowerCase();
      if (['serdes', 'pll', 'adc', 'dac', 'ldo', 'comparator', 'opamp', 'mix'].includes(val)) {
        return val as NonNullable<AnalogSpec['circuitType']>;
      }
    }
    return undefined;
  }

  /** Parse markdown table into rows (including header, excluding separator) */
  private parseTableRows(section: string): string[][] {
    const rows: string[][] = [];
    const tableLines = section.split('\n').filter(line =>
      line.trim().startsWith('|') && line.includes('|', 1)
    );

    // Skip separator lines (| --- | --- |)
    const dataLines = tableLines.filter(line => !line.includes('---'));

    for (const line of dataLines) {
      const cells = line.split('|')
        .filter((_, i, arr) => i > 0 && i < arr.length)
        .map(c => c.trim());
      if (cells.length > 0) rows.push(cells);
    }

    return rows;
  }

  /** Infer constraint type from name and value */
  private inferConstraintType(name: string, value: string): TimingConstraintType {
    const lower = name.toLowerCase();
    const valLower = value.toLowerCase();

    if (lower.includes('lock') || lower.includes('acq')) return 'lock_time';
    if (lower.includes('setup') || lower.includes('tsu')) return 'setup_time';
    if (lower.includes('hold') || lower.includes('th')) return 'hold_time';
    if (lower.includes('propagation') || lower.includes('tpd')) return 'propagation_delay';
    if (lower.includes('clock-to-q') || lower.includes('tco')) return 'clock_to_output';
    if (lower.includes('pulse') || lower.includes('pw')) return 'pulse_width';
    if (lower.includes('rise') || lower.includes('tr')) return 'rise_time';
    if (lower.includes('fall') || lower.includes('tf')) return 'fall_time';
    if (lower.includes('settl')) return 'settling_time';
    if (lower.includes('recovery')) return 'recovery_time';
    if (lower.includes('removal')) return 'removal_time';
    if (lower.includes('skew')) return 'skew';
    if (lower.includes('jitter')) return 'jitter';
    if (lower.includes('duty')) return 'duty_cycle';
    if (lower.includes('bandwidth') || lower.includes('bw')) return 'bandwidth';
    if (lower.includes('slew')) return 'slew_rate';
    if (lower.includes('monotonic')) return 'monotonic';
    if (lower.includes('glitch')) return 'glitch_free';
    if (lower.includes('power') || lower.includes('sequence')) return 'power_up_sequence';
    return 'custom';
  }

  /** Parse timing value with unit */
  private parseTimingValue(value: string): AnalogTimingConstraintDef['value'] {
    const valStr = value.replace(/[<>]/g, '').trim();
    const unitMatch = valStr.match(/(\d+\.?\d*)\s*(ps|ns|us|ms|s|Hz|kHz|MHz|GHz|dB|mV|V|mA|UI|ppm|%)/i);
    const rangeMatch = valStr.match(/(\d+\.?\d*)\s*[-~to]+\s*(\d+\.?\d*)\s*(ps|ns|us|ms|s|Hz|kHz|MHz|GHz|dB)/i);

    if (rangeMatch) {
      const v1 = parseFloat(rangeMatch[1]);
      const v2 = parseFloat(rangeMatch[2]);
      const unit = rangeMatch[3].toLowerCase() as AnalogTimingConstraintDef['value']['unit'];
      return { min: Math.min(v1, v2), typ: (v1 + v2) / 2, max: Math.max(v1, v2), unit };
    }

    if (unitMatch) {
      const num = parseFloat(unitMatch[1]);
      const unitRaw = unitMatch[2];
      // Normalize unit
      const unit = unitRaw.toLowerCase() as AnalogTimingConstraintDef['value']['unit'];
      return { min: num, typ: num, max: num, unit };
    }

    return { unit: 'custom' };
  }

  /** Normalize direction string */
  private normalizeDirection(dir: string): AnalogPortSpec['direction'] {
    const d = dir.toLowerCase();
    if (d === 'i' || d === 'in' || d === 'input') return 'input';
    if (d === 'o' || d === 'out' || d === 'output') return 'output';
    if (d === 'io' || d === 'inout' || d === 'bidir') return 'inout';
    return 'inout';
  }

  /** Infer signal type from description */
  private inferSignalType(type: string): AnalogPortSpec['signalType'] {
    const t = type.toLowerCase();
    if (t.includes('analog') || t.includes('diff') || t.includes('vip') || t.includes('vin')) return 'analog';
    if (t.includes('digital') || t.includes('data') || t.includes('bit')) return 'digital';
    if (t.includes('clock') || t.includes('clk')) return 'clock';
    if (t.includes('supply') || t.includes('vdd') || t.includes('vcc')) return 'supply';
    if (t.includes('ground') || t.includes('gnd') || t.includes('vss')) return 'ground';
    if (t.includes('bias') || t.includes('vref') || t.includes('vcm')) return 'bias';
    return 'analog';
  }
}
