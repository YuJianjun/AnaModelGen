import { AnaModelGen } from '../src';
import { HSPICEParser } from '../src/parsers/spice/hspice-parser';
import { HSPICEFlattener } from '../src/parsers/spice/hspice-flattener';
import { CircuitGraphBuilder } from '../src/cir/circuit-graph';
import { TopologyRecognizer } from '../src/recognition/topology-recognizer';
import { MarkdownAnalogSpecParser } from '../src/parsers/analog-spec/markdown-spec-parser';
import { SVACheckerGenerator } from '../src/generators/sva-checker/sva-checker-generator';
import { primitiveLibrary } from '../src/primitives/primitive-registry';
import * as fs from 'fs';
import * as path from 'path';

describe('Analog Modeling Pipeline', () => {
  let generator: AnaModelGen;

  beforeAll(() => {
    generator = new AnaModelGen();
  });

  describe('Phase 1: HSPICE Parser', () => {
    const parser = new HSPICEParser();

    test('should parse a simple SPICE netlist', () => {
      const source = `
* Simple test
Vdd vdd vss 1.2V
M1 d g s vss nmos W=10u L=0.18u
R1 d vdd 1k
C1 g vss 1p
      `;
      const netlist = parser.parse(source);
      expect(netlist).toBeDefined();
      expect(netlist.devices.length).toBeGreaterThanOrEqual(2);
    });

    test('should parse subcircuit hierarchy', () => {
      const source = `
.SUBCKT diffpair inp inn outp outn tail vdd vss
M1 outp inp tail vss nmos W=10u L=0.18u
M2 outn inn tail vss nmos W=10u L=0.18u
.ENDS diffpair

.SUBCKT ctle_core vinp vinn voutp voutn vtail vdd vss
XDP vinp vinn voutp voutn tail vdd vss diffpair
Rtail tail vtail 100
Ctail tail vss 1p
.ENDS ctle_core
      `;
      const netlist = parser.parse(source);
      expect(netlist.subcircuitDefinitions.size).toBe(2);
      expect(netlist.subcircuitDefinitions.has('DIFFPAIR')).toBe(true);
      expect(netlist.subcircuitDefinitions.has('CTLE_CORE')).toBe(true);
    });

    test('should handle continuation lines', () => {
      const source = `* Title
M1 d g s vss nmos W=10u
+ L=0.18u M=1
      `;
      const netlist = parser.parse(source);
      expect(netlist.devices.length).toBe(1);
      const m1 = netlist.devices[0];
      expect(m1.params['W']).toBeCloseTo(1e-5, 8);
      expect(m1.params['L']).toBeCloseTo(1.8e-7, 10);
    });

    test('should handle inline comments', () => {
      const source = `* Title
M1 d g s vss nmos W=10u $ this is a comment
R1 d vdd 1k $ also a comment
      `;
      const netlist = parser.parse(source);
      expect(netlist.devices.length).toBe(2);
    });

    test('should parse parameter values with SI suffixes', () => {
      const source = `* Title
R1 n1 n2 1k
C1 n1 gnd 1pF
L1 n1 n2 10nH
      `;
      const netlist = parser.parse(source);
      expect(netlist.devices.length).toBe(3);
      const r1 = netlist.devices.find(d => d.name === 'R1');
      expect(r1).toBeDefined();
      if (r1) expect(r1.params['R']).toBe(1000);
    });

    test('should parse the CTLE test fixture', () => {
      const fixturePath = path.join(__dirname, 'fixtures', 'serdes-ctle.sp');
      const source = fs.readFileSync(fixturePath, 'utf-8');
      const netlist = parser.parse(source);
      expect(netlist.subcircuitDefinitions.size).toBeGreaterThanOrEqual(2);
      // CTLE fixture has all devices inside subcircuits, no top-level devices
      expect(netlist.devices.length).toBe(0);
      expect(netlist.subcircuitDefinitions.has('CTLE_CORE')).toBe(true);
      expect(netlist.subcircuitDefinitions.has('SERDES_PHY')).toBe(true);
    });
  });

  describe('Phase 1.1: HSPICE Flattener', () => {
    const parser = new HSPICEParser();
    const flattener = new HSPICEFlattener();

    test('should flatten hierarchical netlist', () => {
      const source = `
.SUBCKT diffpair inp inn outp outn tail vdd vss
M1 outp inp tail vss nmos W=10u L=0.18u
M2 outn inn tail vss nmos W=10u L=0.18u
.ENDS diffpair

XDP inp inn outp outn tail vdd vss diffpair
Ibias tail vss 1mA
      `;
      const netlist = parser.parse(source);
      const flattened = flattener.flatten(netlist, 'diffpair');
      expect(flattened).toBeDefined();
      expect(flattened.devices.length).toBeGreaterThanOrEqual(2);
      expect(flattened.ports.length).toBeGreaterThanOrEqual(4);
    });
  });

  describe('Phase 1.2: Circuit Graph Builder', () => {
    const parser = new HSPICEParser();
    const flattener = new HSPICEFlattener();
    const builder = new CircuitGraphBuilder();

    test('should build CIR from flattened netlist', () => {
      const source = `
.SUBCKT test_circuit inp inn outp outn vdd vss
R1 outp vdd 500
R2 outn vdd 500
M1 outp inp tail vss nmos W=10u L=0.18u
M2 outn inn tail vss nmos W=10u L=0.18u
.ENDS test_circuit
      `;
      const netlist = parser.parse(source);
      const flattened = flattener.flatten(netlist, 'test_circuit');
      const cir = builder.build(flattened);
      expect(cir).toBeDefined();
      expect(cir.name).toBe('test_circuit');
      expect(cir.devices.length).toBe(4);
      expect(cir.ports.length).toBe(6);
    });
  });

  describe('Phase 3: Topology Recognizer', () => {
    const parser = new HSPICEParser();
    const flattener = new HSPICEFlattener();
    const builder = new CircuitGraphBuilder();
    const recognizer = new TopologyRecognizer();

    test('should identify differential pair', () => {
      const source = `
.SUBCKT test_circ inp inn outp outn tail vdd vss
M1 outp inp tail vss nmos W=10u L=0.18u
M2 outn inn tail vss nmos W=10u L=0.18u
R1 outp vdd 500
R2 outn vdd 500
.ENDS test_circ
      `;
      const netlist = parser.parse(source);
      const flattened = flattener.flatten(netlist, 'test_circ');
      const cir = builder.build(flattened);
      const result = recognizer.analyze(cir);
      const diffPairs = result.blocks.filter(b => b.type === 'differential_pair');
      expect(diffPairs.length).toBeGreaterThanOrEqual(1);
    });

    test('should identify current mirror', () => {
      const source = `
.SUBCKT mirror vdd iref iout
M1 d1 d1 vss vss nmos W=10u L=0.18u
M2 iout d1 vss vss nmos W=20u L=0.18u
Iref d1 vss 10uA
.ENDS mirror
      `;
      const netlist = parser.parse(source);
      const flattened = flattener.flatten(netlist, 'mirror');
      const cir = builder.build(flattened);
      const result = recognizer.analyze(cir);
      const mirrors = result.blocks.filter(b => b.type === 'current_mirror');
      expect(mirrors.length).toBeGreaterThanOrEqual(1);
    });

    test('should identify CML driver', () => {
      const source = `
.SUBCKT cml_drv inp inn outp outn vdd vss
R1 outp vdd 500
R2 outn vdd 500
M1 outp inp tail vss nmos W=10u L=0.18u
M2 outn inn tail vss nmos W=10u L=0.18u
Itail tail vss 1mA
.ENDS cml_drv
      `;
      const netlist = parser.parse(source);
      const flattened = flattener.flatten(netlist, 'cml_drv');
      const cir = builder.build(flattened);
      const result = recognizer.analyze(cir);
      const cml = result.blocks.filter(b => b.type === 'cml_driver' || b.type === 'differential_pair');
      expect(cml.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Phase 2: Primitive Library', () => {
    test('should have SerDes primitives registered', () => {
      const allPrimitives = primitiveLibrary.getAll();
      const serdesNames = allPrimitives.map(p => p.name);
      expect(serdesNames).toContain('vco_model');
      expect(serdesNames).toContain('cdr_model');
      expect(serdesNames).toContain('ctle_model');
      expect(serdesNames).toContain('dfe_model');
      expect(serdesNames).toContain('tx_driver');
      expect(serdesNames).toContain('serializer');
      expect(serdesNames).toContain('deserializer');
    });

    test('should render SV templates', () => {
      const code = primitiveLibrary.renderTemplate('ctle_model');
      expect(code).toContain('module ctle_model');
      expect(code).toContain('PEAKING');
      expect(code).toContain('BANDWIDTH');
    });

    test('should render primitive catalog', () => {
      const catalog = primitiveLibrary.renderCatalog();
      expect(catalog).toContain('vco_model');
      expect(catalog).toContain('cdr_model');
    });
  });

  describe('Phase 4: Analog Spec Parser', () => {
    const specParser = new MarkdownAnalogSpecParser();

    test('should parse port table from markdown spec', () => {
      const source = `
# Test Spec

## Interface

| Port | Direction | Type | Description |
|------|-----------|------|-------------|
| clk | input | clock | Reference clock |
| data_in | input | digital | Input data |
| data_out | output | analog | Output data |
      `;
      const result = specParser.parse(source);
      expect(result.spec.ports.length).toBe(3);
      expect(result.spec.ports[0].name).toBe('clk');
      expect(result.spec.ports[1].name).toBe('data_in');
    });

    test('should parse timing constraints in table format', () => {
      const source = `
# Test Spec

## Timing Constraints

| Parameter | Value | Description |
|-----------|-------|-------------|
| Lock time | < 5us | CDR lock acquisition |
| Bandwidth | > 10GHz | -3dB bandwidth |
| Settling time | < 100ns | CTLE settling |
      `;
      const result = specParser.parse(source);
      expect(result.spec.timingConstraints.length).toBe(3);
      const lockTime = result.spec.timingConstraints.find(tc => tc.name === 'Lock time');
      expect(lockTime).toBeDefined();
      expect(lockTime!.type).toBe('lock_time');
    });

    test('should parse timing constraints in list format', () => {
      const source = `
# Test Spec

## Timing Constraints
- Lock time: < 5us
- Bandwidth: > 10GHz
      `;
      const result = specParser.parse(source);
      expect(result.spec.timingConstraints.length).toBeGreaterThanOrEqual(2);
    });

    test('should parse truth table', () => {
      const source = `
# Test Spec

## Truth Tables

### Mode Control

| Mode[1:0] | Output | Description |
|-----------|--------|-------------|
| 00 | 0 | Bypass |
| 01 | 1 | Enable |
| 10 | 0 | Reserved |
| 11 | 1 | Test mode |
      `;
      const result = specParser.parse(source);
      expect(result.spec.truthTables.length).toBeGreaterThanOrEqual(1);
      if (result.spec.truthTables.length > 0) {
        expect(result.spec.truthTables[0].rows.length).toBe(4);
      }
    });

    test('should parse the CTLE spec fixture', () => {
      const fixturePath = path.join(__dirname, 'fixtures', 'serdes-ctle-spec.md');
      const source = fs.readFileSync(fixturePath, 'utf-8');
      const result = specParser.parse(source);
      expect(result.spec.circuitType).toBe('serdes');
      expect(result.spec.ports.length).toBeGreaterThanOrEqual(4);
      expect(result.spec.timingConstraints.length).toBeGreaterThanOrEqual(3);
      expect(result.spec.truthTables.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Phase 4.1: SVA Checker Generator', () => {
    const specParser = new MarkdownAnalogSpecParser();
    const svaGenerator = new SVACheckerGenerator();

    test('should generate timing checkers from spec', () => {
      const source = `
# Test

## Interface
| Port | Direction | Type | Description |
|------|-----------|------|-------------|
| clk | input | clock | Clock |
| rst_n | input | digital | Reset |

## Timing Constraints
| Parameter | Value | Description |
|-----------|-------|-------------|
| Lock time | < 5us | CDR lock |
| Settling time | < 100ns | CTLE settling |
      `;
      const parsed = specParser.parse(source);
      const result = svaGenerator.generate(parsed.spec, 'test_model');
      expect(result.checkerModules.length).toBeGreaterThanOrEqual(1);
      expect(result.bindDirectives.length).toBeGreaterThanOrEqual(1);
      expect(result.files.length).toBeGreaterThanOrEqual(1);
    });

    test('should generate truth table checkers', () => {
      const source = `
# Test

## Interface
| Port | Direction | Type | Description |
|------|-----------|------|-------------|
| clk | input | clock | Clock |

## Truth Tables

### Mode Ctrl
| Mode | Out | Description |
|------|-----|-------------|
| 0 | 0 | Off |
| 1 | 1 | On |
      `;
      const parsed = specParser.parse(source);
      const result = svaGenerator.generate(parsed.spec, 'test_model');
      expect(result.checkerModules.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('End-to-End: Full Pipeline', () => {
    test('RTLGenerator.parseSPICE should produce CIR', () => {
      const source = `
.SUBCKT test inp inn outp outn vdd vss
R1 outp vdd 500
R2 outn vdd 500
M1 outp inp tail vss nmos W=10u L=0.18u
M2 outn inn tail vss nmos W=10u L=0.18u
.ENDS test
      `;
      const result = generator.parseSPICE(source, 'test');
      expect(result.cir.name).toBe('test');
      expect(result.cir.devices.length).toBeGreaterThan(0);
      expect(result.cir.ports.length).toBeGreaterThan(0);
    });

    test('RTLGenerator.generateAnalogModel should produce SV code', async () => {
      const source = `
.SUBCKT test inp inn outp outn vdd vss
R1 outp vdd 500
R2 outn vdd 500
M1 outp inp tail vss nmos W=10u L=0.18u
M2 outn inn tail vss nmos W=10u L=0.18u
.ENDS test
      `;
      const result = await generator.generateModel(source, 'test');
      expect(result.svCode).toBeDefined();
      expect(result.svCode).toContain('module');
      expect(result.cir).toBeDefined();
      expect(result.primitiveCatalog).toBeDefined();
    });

    test('complete CTLE fixture pipeline should work', async () => {
      const fixturePath = path.join(__dirname, 'fixtures', 'serdes-ctle.sp');
      const source = fs.readFileSync(fixturePath, 'utf-8');
      const result = await generator.generateModel(source, 'serdes_phy');
      expect(result.svCode).toBeDefined();
      expect(result.cir.devices.length).toBeGreaterThan(0);
      expect(result.cir.ports.length).toBeGreaterThan(0);
    });

    test('analog spec + SVA pipeline should work with CTLE spec', () => {
      const specParser = new MarkdownAnalogSpecParser();
      const svaGenerator = new SVACheckerGenerator();
      const fixturePath = path.join(__dirname, 'fixtures', 'serdes-ctle-spec.md');
      const source = fs.readFileSync(fixturePath, 'utf-8');
      const parsed = specParser.parse(source);
      expect(parsed.spec.circuitType).toBe('serdes');
      const svaResult = svaGenerator.generate(parsed.spec, 'serdes_phy_model');
      expect(svaResult.files.length).toBeGreaterThan(0);
      // Verify generated SV code
      // Checker modules contain 'module' + 'assert property'
      // Bind files contain 'bind' (but not necessarily 'module')
      let hasChecker = false;
      let hasBind = false;
      let hasAssert = false;
      for (const file of svaResult.files) {
        if (file.content.includes('module ')) {
          hasChecker = true;
          if (file.content.includes('assert property')) hasAssert = true;
        }
        if (file.content.includes('bind ')) hasBind = true;
      }
      expect(hasChecker).toBe(true);
      expect(hasBind).toBe(true);
      expect(hasAssert).toBe(true);
    });
  });
});
