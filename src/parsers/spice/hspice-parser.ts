import type {
  SPICENetlist, SPICEDevice, SPICEDeviceType, SPICEModelCard, SPICEModelType,
  SPICESubcircuit, SPICESubcircuitInstance, SPICEControl, SPICEInclude,
  SPICEParamDef, SPICENode, FlattenedNetlist
} from '../../types/spice-types';

/**
 * HSPICE Parser
 *
 * Parses HSPICE netlist text into a structured AST (SPICENetlist).
 * Handles: .SUBCKT/.ENDS hierarchy, .MODEL cards, .PARAM definitions,
 * device instances (M/R/C/L/D/Q/X/E/G/F/H/B), continuation lines,
 * comments, global nodes, and hierarchical naming.
 */
export class HSPICEParser {
  /** Parse HSPICE source text into an AST */
  parse(source: string): SPICENetlist {
    const lines = this.preprocess(source);
    const netlist: SPICENetlist = {
      devices: [],
      subcircuitInstances: [],
      modelCards: [],
      params: [],
      controls: [],
      includes: [],
      nodes: [],
      subcircuitDefinitions: new Map(),
      lineCount: lines.length,
    };

    let i = 0;
    while (i < lines.length) {
      const rawLine = lines[i];
      const trimmed = rawLine.trim();

      if (trimmed === '' || trimmed.startsWith('*') || trimmed.startsWith('//')) {
        i++;
        continue;
      }

      // Title line: first line of netlist (if not a command)
      if (i === 0 && !trimmed.startsWith('.')) {
        netlist.title = trimmed;
        i++;
        continue;
      }

      if (trimmed.startsWith('.SUBCKT') || trimmed.startsWith('.subckt')) {
        const result = this.parseSubcircuit(lines, i);
        if (result) {
          const { subcircuit, nextLine } = result;
          netlist.subcircuitDefinitions.set(subcircuit.name.toUpperCase(), subcircuit);
          i = nextLine;
        } else {
          i++;
        }
        continue;
      }

      if (trimmed.startsWith('.ENDS') || trimmed.startsWith('.ends')) {
        // Should be caught by parseSubcircuit, but skip if orphaned
        i++;
        continue;
      }

      if (trimmed.startsWith('.MODEL') || trimmed.startsWith('.model')) {
        const model = this.parseModelCard(trimmed);
        if (model) {
          netlist.modelCards.push(model);
        }
        i++;
        continue;
      }

      if (trimmed.startsWith('.PARAM') || trimmed.startsWith('.param')) {
        const params = this.parseParamLine(trimmed);
        netlist.params.push(...params);
        i++;
        continue;
      }

      if (trimmed.startsWith('.INCLUDE') || trimmed.startsWith('.include') ||
          trimmed.startsWith('.LIB') || trimmed.startsWith('.lib')) {
        const inc = this.parseInclude(trimmed);
        if (inc) netlist.includes.push(inc);
        i++;
        continue;
      }

      if (trimmed.startsWith('.')) {
        const ctrl = this.parseControl(trimmed);
        netlist.controls.push(ctrl);
        i++;
        continue;
      }

      // Device line
      const element = this.parseDeviceLine(trimmed);
      if (element) {
        if ('type' in element) {
          netlist.devices.push(element);
          this.extractNodesFromDevice(element, netlist.nodes);
        } else {
          netlist.subcircuitInstances.push(element);
        }
      }
      i++;
    }

    this.dedupNodes(netlist.nodes);
    return netlist;
  }

  /** Preprocess: join continuation lines, strip comments */
  private preprocess(source: string): string[] {
    const rawLines = source.split(/\r?\n/);
    const joined: string[] = [];
    let accumulator = '';

    for (const raw of rawLines) {
      // Strip inline comments ($ comments in HSPICE)
      const noInlineComment = this.stripInlineComment(raw);
      const trimmed = noInlineComment.trimEnd();

      if (trimmed === '' || trimmed === '*') {
        if (accumulator) {
          joined.push(accumulator);
          accumulator = '';
        }
        continue;
      }

      // Continuation line starts with '+'
      if (trimmed.startsWith('+') && accumulator) {
        accumulator += ' ' + trimmed.substring(1).trim();
      } else {
        if (accumulator) joined.push(accumulator);
        accumulator = trimmed;
      }
    }
    if (accumulator) joined.push(accumulator);

    return joined;
  }

  /** Strip inline HSPICE comments (text after $ not inside quotes) */
  private stripInlineComment(line: string): string {
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      if (line[i] === '"' || line[i] === "'") inQuotes = !inQuotes;
      if (line[i] === '$' && !inQuotes) {
        return line.substring(0, i);
      }
    }
    return line;
  }

  /** Parse a .SUBCKT block (including .ENDS) */
  private parseSubcircuit(lines: string[], startIdx: number): { subcircuit: SPICESubcircuit; nextLine: number } | null {
    const header = lines[startIdx].trim();
    const parts = this.tokenizeLine(header);
    if (parts.length < 2) return null;

    const name = parts[1];
    const ports = parts.slice(2).filter(p => !p.startsWith('.') && !p.includes('='));

    const sub: SPICESubcircuit = {
      name,
      ports,
      devices: [],
      subcircuitInstances: [],
      modelCards: [],
      params: [],
      internalNodes: [],
    };

    let i = startIdx + 1;
    while (i < lines.length) {
      const raw = lines[i].trim();
      if (raw === '' || raw.startsWith('*') || raw.startsWith('//')) {
        i++;
        continue;
      }
      if (raw.startsWith('.ENDS') || raw.startsWith('.ends')) {
        const endName = this.tokenizeLine(raw)[1];
        if (!endName || endName.toUpperCase() === name.toUpperCase()) {
          return { subcircuit: sub, nextLine: i + 1 };
        }
      }
      if (raw.startsWith('.SUBCKT') || raw.startsWith('.subckt')) {
        // Nested subcircuit (unusual but possible)
        const result = this.parseSubcircuit(lines, i);
        if (result) {
          sub.subcircuitInstances.push(...result.subcircuit.subcircuitInstances);
          result.subcircuit.subcircuitInstances.forEach(si => sub.devices.push(...result.subcircuit.devices));
          i = result.nextLine;
          continue;
        }
      }

      if (raw.startsWith('.MODEL') || raw.startsWith('.model')) {
        const model = this.parseModelCard(raw);
        if (model) sub.modelCards.push(model);
        i++; continue;
      }

      if (raw.startsWith('.PARAM') || raw.startsWith('.param')) {
        const params = this.parseParamLine(raw);
        sub.params.push(...params);
        i++; continue;
      }

      if (raw.startsWith('.')) {
        // Skip other control statements inside subcircuit
        i++; continue;
      }

      const element = this.parseDeviceLine(raw);
      if (element) {
        if ('type' in element) {
          sub.devices.push(element);
        } else {
          sub.subcircuitInstances.push(element);
        }
      }
      i++;
    }

    // If we fall through without hitting .ENDS, return what we have
    return { subcircuit: sub, nextLine: i };
  }

  /** Parse a model card: .MODEL <name> <type> [params...] */
  private parseModelCard(line: string): SPICEModelCard | null {
    const parts = this.tokenizeLine(line);
    if (parts.length < 3) return null;

    const name = parts[1];
    const type = parts[2].toLowerCase() as SPICEModelType;
    const params: Record<string, number | string> = {};

    // Remaining tokens are param=value pairs
    for (let i = 3; i < parts.length; i++) {
      const eqIdx = parts[i].indexOf('=');
      if (eqIdx > 0) {
        const pName = parts[i].substring(0, eqIdx).toUpperCase();
        let pValue: string | number = parts[i].substring(eqIdx + 1);
        // Try to parse as number
        const numVal = this.parseNumeric(pValue);
        if (numVal !== null) pValue = numVal;
        params[pName] = pValue;
      }
    }

    return { name, type, params, rawText: line };
  }

  /** Parse .PARAM line */
  private parseParamLine(line: string): SPICEParamDef[] {
    const parts = this.tokenizeLine(line);
    const params: SPICEParamDef[] = [];

    for (let i = 1; i < parts.length; i++) {
      const eqIdx = parts[i].indexOf('=');
      if (eqIdx > 0) {
        const name = parts[i].substring(0, eqIdx);
        const value = parts[i].substring(eqIdx + 1);
        params.push({
          name,
          value,
          isExpression: /[+\-*/()]/.test(value) || /^['"]/.test(value),
        });
      }
    }
    return params;
  }

  /** Parse .INCLUDE or .LIB */
  private parseInclude(line: string): SPICEInclude | null {
    const parts = this.tokenizeLine(line);
    if (parts.length < 2) return null;

    const directive = parts[0].substring(1).toLowerCase();
    const path = parts[1].replace(/['"]/g, '');

    if (directive === 'include') {
      return { type: 'include', path };
    } else if (directive === 'lib') {
      return { type: 'lib', path, sectionName: parts.length > 2 ? parts[2].replace(/['"]/g, '') : undefined };
    }
    return null;
  }

  /** Parse a control line (anything starting with . that's not already handled) */
  private parseControl(line: string): SPICEControl {
    const parts = this.tokenizeLine(line);
    const cmd = parts[0].substring(1).toLowerCase();
    const params: Record<string, string | number> = {};

    for (let i = 1; i < parts.length; i++) {
      const eqIdx = parts[i].indexOf('=');
      if (eqIdx > 0) {
        params[parts[i].substring(0, eqIdx).toLowerCase()] = parts[i].substring(eqIdx + 1);
      } else {
        params[i.toString()] = parts[i];
      }
    }

    const knownTypes = ['options', 'temp', 'dc', 'ac', 'tran', 'ic', 'nodeset',
      'probe', 'print', 'plot', 'meas', 'save', 'sensor', 'fft', 'noise'];
    const type = knownTypes.includes(cmd) ? cmd as SPICEControl['type'] : 'other';

    return { type, rawText: line, params };
  }

  /** Parse a device/instance line */
  private parseDeviceLine(line: string): SPICEDevice | SPICESubcircuitInstance | null {
    if (line.startsWith('.')) return null;
    if (line.startsWith('*') || line.startsWith('//')) return null;

    const parts = this.tokenizeLine(line);
    if (parts.length < 2) return null;

    const elementName = parts[0];
    const firstChar = elementName[0].toUpperCase();

    // Determine element type from first character
    if (firstChar === 'M') {
      return this.parseMOSFET(elementName, parts);
    } else if (firstChar === 'R') {
      return this.parseResistor(elementName, parts);
    } else if (firstChar === 'C') {
      return this.parseCapacitor(elementName, parts);
    } else if (firstChar === 'L') {
      return this.parseInductor(elementName, parts);
    } else if (firstChar === 'D') {
      return this.parseDiode(elementName, parts);
    } else if (firstChar === 'Q') {
      return this.parseBJT(elementName, parts);
    } else if (firstChar === 'X') {
      return this.parseSubcircuitInstance(elementName, parts);
    } else if (firstChar === 'V') {
      return this.parseVSource(elementName, parts);
    } else if (firstChar === 'I') {
      return this.parseISource(elementName, parts);
    } else if (firstChar === 'E') {
      return this.parseVCVS(elementName, parts);
    } else if (firstChar === 'G') {
      return this.parseVCCS(elementName, parts);
    } else if (firstChar === 'H') {
      return this.parseCCVS(elementName, parts);
    } else if (firstChar === 'F') {
      return this.parseCCCS(elementName, parts);
    } else if (firstChar === 'B') {
      return this.parseBehavioral(elementName, parts);
    }

    // Default: unknown device type
    return this.parseGenericDevice(elementName, parts);
  }

  /** MOSFET: M<name> <drain> <gate> <source> <bulk> <model> [W=<val> L=<val> ...] */
  private parseMOSFET(name: string, parts: string[]): SPICEDevice {
    const terminals: Record<string, string> = {
      d: parts[1], g: parts[2], s: parts[3], b: parts.length > 4 ? parts[4] : parts[3],
    };
    const modelName = parts[5];
    const params: Record<string, number | string> = {};

    for (let i = 6; i < parts.length; i++) {
      this.extractParam(parts[i], params);
    }

    return { name, type: 'nmos', terminals, params, modelName,
      rawText: parts.join(' ') };
  }

  /** Resistor: R<name> <n+> <n-> <value> [model] */
  private parseResistor(name: string, parts: string[]): SPICEDevice {
    const terminals: Record<string, string> = { p: parts[1], n: parts[2] };
    const params: Record<string, number | string> = {};
    let nextIdx = 3;

    if (nextIdx < parts.length) {
      const val = this.parseNumeric(parts[nextIdx]);
      params.R = val !== null ? val : parts[nextIdx];
      nextIdx++;
    }

    // Optional model name
    if (nextIdx < parts.length && !parts[nextIdx].includes('=')) {
      params.modelName = parts[nextIdx];
      nextIdx++;
    }

    for (let i = nextIdx; i < parts.length; i++) {
      this.extractParam(parts[i], params);
    }

    return { name, type: 'resistor', terminals, params, rawText: parts.join(' ') };
  }

  /** Capacitor: C<name> <n+> <n-> <value> [model] */
  private parseCapacitor(name: string, parts: string[]): SPICEDevice {
    const terminals: Record<string, string> = { p: parts[1], n: parts[2] };
    const params: Record<string, number | string> = {};
    let nextIdx = 3;

    if (nextIdx < parts.length) {
      const val = this.parseNumeric(parts[nextIdx]);
      params.C = val !== null ? val : parts[nextIdx];
      nextIdx++;
    }
    if (nextIdx < parts.length && !parts[nextIdx].includes('=')) {
      params.modelName = parts[nextIdx];
      nextIdx++;
    }
    for (let i = nextIdx; i < parts.length; i++) {
      this.extractParam(parts[i], params);
    }

    return { name, type: 'capacitor', terminals, params, rawText: parts.join(' ') };
  }

  /** Inductor: L<name> <n+> <n-> <value> */
  private parseInductor(name: string, parts: string[]): SPICEDevice {
    const terminals: Record<string, string> = { p: parts[1], n: parts[2] };
    const params: Record<string, number | string> = {};
    if (parts.length > 3) {
      const val = this.parseNumeric(parts[3]);
      params.L = val !== null ? val : parts[3];
    }
    return { name, type: 'inductor', terminals, params, rawText: parts.join(' ') };
  }

  /** Diode: D<name> <n+> <n-> <model> [area] */
  private parseDiode(name: string, parts: string[]): SPICEDevice {
    const terminals: Record<string, string> = { p: parts[1], n: parts[2] };
    const params: Record<string, number | string> = {};
    const modelName = parts.length > 3 ? parts[3] : undefined;
    for (let i = 4; i < parts.length; i++) this.extractParam(parts[i], params);
    return { name, type: 'diode', terminals, params, modelName, rawText: parts.join(' ') };
  }

  /** BJT: Q<name> <c> <b> <e> [s] <model> [area] */
  private parseBJT(name: string, parts: string[]): SPICEDevice {
    const terminals: Record<string, string> = { c: parts[1], b: parts[2], e: parts[3] };
    const params: Record<string, number | string> = {};
    const modelName = parts.length > 4 ? parts[4] : undefined;
    for (let i = 5; i < parts.length; i++) this.extractParam(parts[i], params);
    return { name, type: 'npn', terminals, params, modelName, rawText: parts.join(' ') };
  }

  /** Voltage source: V<name> <n+> <n-> [DC/AC/TRAN value] [params...] */
  private parseVSource(name: string, parts: string[]): SPICEDevice {
    const terminals: Record<string, string> = { p: parts[1], n: parts[2] };
    const params: Record<string, number | string> = {};
    for (let i = 3; i < parts.length; i++) this.extractParam(parts[i], params);

    // Detect pulse/sin/PWL types
    if (name.includes('PULSE') || params.TYPE === 'PULSE') {
      return { name, type: 'vpulse', terminals, params, rawText: parts.join(' ') };
    }
    if (name.includes('SIN') || params.TYPE === 'SIN') {
      return { name, type: 'vsin', terminals, params, rawText: parts.join(' ') };
    }
    if (name.includes('PWL') || params.TYPE === 'PWL') {
      return { name, type: 'vpwlf', terminals, params, rawText: parts.join(' ') };
    }
    return { name, type: 'vsource', terminals, params, rawText: parts.join(' ') };
  }

  /** Current source: I<name> <n+> <n-> [DC/AC/TRAN value] [params...] */
  private parseISource(name: string, parts: string[]): SPICEDevice {
    const terminals: Record<string, string> = { p: parts[1], n: parts[2] };
    const params: Record<string, number | string> = {};
    for (let i = 3; i < parts.length; i++) this.extractParam(parts[i], params);
    return { name, type: 'isource', terminals, params, rawText: parts.join(' ') };
  }

  /** VCVS: E<name> <n+> <n-> <nc+> <nc-> <gain> */
  private parseVCVS(name: string, parts: string[]): SPICEDevice {
    const terminals: Record<string, string> = { p: parts[1], n: parts[2] };
    const params: Record<string, number | string> = {};
    if (parts.length > 3) {
      terminals.cp = parts[3]; // control+
      terminals.cn = parts[4]; // control-
      const val = this.parseNumeric(parts[5]);
      params.GAIN = val !== null ? val : parts[5];
    }
    for (let i = 6; i < parts.length; i++) this.extractParam(parts[i], params);
    return { name, type: 'vcvs', terminals, params, rawText: parts.join(' ') };
  }

  /** VCCS: G<name> <n+> <n-> <nc+> <nc-> <transconductance> */
  private parseVCCS(name: string, parts: string[]): SPICEDevice {
    const terminals: Record<string, string> = { p: parts[1], n: parts[2] };
    const params: Record<string, number | string> = {};
    if (parts.length > 3) {
      terminals.cp = parts[3];
      terminals.cn = parts[4];
      const val = this.parseNumeric(parts[5]);
      params.GM = val !== null ? val : parts[5];
    }
    for (let i = 6; i < parts.length; i++) this.extractParam(parts[i], params);
    return { name, type: 'vccs', terminals, params, rawText: parts.join(' ') };
  }

  /** CCVS: H<name> <n+> <n-> <vsource_name> <gain> */
  private parseCCVS(name: string, parts: string[]): SPICEDevice {
    const terminals: Record<string, string> = { p: parts[1], n: parts[2] };
    const params: Record<string, number | string> = {};
    if (parts.length > 3) {
      terminals.vs = parts[3];
      const val = this.parseNumeric(parts[4]);
      params.GAIN = val !== null ? val : parts[4];
    }
    return { name, type: 'ccvs', terminals, params, rawText: parts.join(' ') };
  }

  /** CCCS: F<name> <n+> <n-> <vsource_name> <gain> */
  private parseCCCS(name: string, parts: string[]): SPICEDevice {
    const terminals: Record<string, string> = { p: parts[1], n: parts[2] };
    const params: Record<string, number | string> = {};
    if (parts.length > 3) {
      terminals.vs = parts[3];
      const val = this.parseNumeric(parts[4]);
      params.GAIN = val !== null ? val : parts[4];
    }
    return { name, type: 'cccs', terminals, params, rawText: parts.join(' ') };
  }

  /** Behavioral source: B<name> <n+> <n-> [V=expr / I=expr] */
  private parseBehavioral(name: string, parts: string[]): SPICEDevice {
    const terminals: Record<string, string> = { p: parts[1], n: parts[2] };
    const params: Record<string, number | string> = {};
    for (let i = 3; i < parts.length; i++) {
      const eqIdx = parts[i].indexOf('=');
      if (eqIdx > 0) {
        params[parts[i].substring(0, eqIdx).toUpperCase()] = parts[i].substring(eqIdx + 1);
      }
    }
    const isVoltage = 'V' in params;
    return { name, type: isVoltage ? 'bv' : 'bi', terminals, params, rawText: parts.join(' ') };
  }

  /** Subcircuit instance: X<name> <n1> <n2> ... <subcircuit_name> [PARAMS: ...] */
  private parseSubcircuitInstance(name: string, parts: string[]): SPICESubcircuitInstance {
    // Subcircuit name is the last non-parameter token
    let subcircuitNameIdx = parts.length - 1;
    const paramOverrides: Record<string, number | string> = {};

    // Check for PARAMS: syntax (HSPICE specific)
    const paramsIdx = parts.findIndex(p => p.toUpperCase() === 'PARAMS:');
    if (paramsIdx > 0) {
      subcircuitNameIdx = paramsIdx - 1;
      for (let i = paramsIdx + 1; i < parts.length; i++) {
        this.extractParam(parts[i], paramOverrides);
      }
    }

    const subcircuitName = parts[subcircuitNameIdx];
    const connections = parts.slice(1, subcircuitNameIdx);

    return { name, subcircuitName, connections, params: paramOverrides, rawText: parts.join(' ') };
  }

  /** Generic device (fallback for unknown element types) */
  private parseGenericDevice(name: string, _parts: string[]): SPICEDevice {
    return {
      name,
      type: 'unknown',
      terminals: {},
      params: {},
      rawText: _parts.join(' '),
    };
  }

  /** Tokenize a single line: split by whitespace, handle parenthesized lists */
  private tokenizeLine(line: string): string[] {
    const tokens: string[] = [];
    let current = '';
    let inParen = 0;
    let inQuote = false;

    for (const ch of line) {
      if (ch === '"' || ch === "'") {
        inQuote = !inQuote;
        current += ch;
      } else if (inQuote) {
        current += ch;
      } else if (ch === '(') {
        inParen++;
        current += ch;
      } else if (ch === ')') {
        inParen--;
        current += ch;
      } else if (/\s/.test(ch) && inParen === 0) {
        if (current) {
          tokens.push(current);
          current = '';
        }
      } else {
        current += ch;
      }
    }
    if (current) tokens.push(current);
    return tokens;
  }

  /** Extract param=value from a token string */
  private extractParam(token: string, target: Record<string, number | string>): void {
    const eqIdx = token.indexOf('=');
    if (eqIdx > 0) {
      const pName = token.substring(0, eqIdx).toUpperCase();
      let pValue: string | number = token.substring(eqIdx + 1);
      const numVal = this.parseNumeric(pValue);
      if (numVal !== null) pValue = numVal;
      target[pName] = pValue;
    }
  }

  /** Try to parse a numeric value (with SI suffix) */
  private parseNumeric(value: string): number | null {
    const trimmed = value.replace(/'/g, '').trim();
    if (trimmed === '') return null;

    const match = trimmed.match(/^(-?\d*\.?\d+(?:[eE][+-]?\d+)?)\s*([fFpPnNuUmMkKgGtT]?)$/);
    if (!match) return null;

    const num = parseFloat(match[1]);
    if (isNaN(num)) return null;

    const suffix = match[2].toLowerCase();
    const multipliers: Record<string, number> = {
      f: 1e-15, p: 1e-12, n: 1e-9, u: 1e-6, m: 1e-3,
      k: 1e3, meg: 1e6, g: 1e9, t: 1e12,
    };

    return suffix ? num * (multipliers[suffix] ?? 1) : num;
  }

  /** Extract node names from device terminals and add to node list */
  private extractNodesFromDevice(device: SPICEDevice, nodes: SPICENode[]): void {
    for (const [, netName] of Object.entries(device.terminals)) {
      if (netName === '0' || netName.toUpperCase() === 'GND' || netName.toUpperCase() === 'GND!') continue;
      if (!nodes.some(n => n.name === netName)) {
        nodes.push({
          name: netName,
          global: netName.endsWith('!'),
          numeric: /^\d+$/.test(netName),
          hierarchical: netName.includes('.'),
        });
      }
    }
  }

  /** Remove duplicate nodes */
  private dedupNodes(nodes: SPICENode[]): void {
    const seen = new Set<string>();
    let writeIdx = 0;
    for (let i = 0; i < nodes.length; i++) {
      if (!seen.has(nodes[i].name)) {
        seen.add(nodes[i].name);
        nodes[writeIdx++] = nodes[i];
      }
    }
    nodes.length = writeIdx;
  }
}
