import type { PrimitiveDef, PrimitiveLibrary, PrimitivePort, PrimitiveParam, PrimitiveInstance } from '../types/primitive-types';
import type { BlockType } from '../types/cir-types';

/** Embedded SV template strings for each primitive */
const SV_TEMPLATES: Record<string, string> = {
  vco_model: `// VCO behavioral model
module vco_model #(
  parameter real GAIN     = 1e9,   // VCO gain (Hz/V)
  parameter real FCENTER  = 5e9,   // Center frequency (Hz)
  parameter real AMPLITUDE = 1.0,  // Output amplitude (V)
  parameter real PNOISE   = -150,  // Phase noise (dBc/Hz @ 1MHz)
  parameter real KVCO     = 100e6  // Tuning sensitivity
)(
  input  real vtune,
  output real out_p,
  output real out_n
);
  // Internal: frequency integration
  real freq, phase, inst_phase;
  always @(vtune) begin
    freq = FCENTER + GAIN * vtune;
  end
  // Phase accumulator (time-domain integration)
  real phase_acc;
  always #(1.0/(FCENTER*32)) begin
    phase_acc = phase_acc + 2.0 * 3.14159 * freq / (FCENTER*32);
    out_p = AMPLITUDE * $sin(phase_acc);
    out_n = -out_p;
  end
endmodule`,

  cdr_model: `// CDR behavioral model (bang-bang type)
module cdr_model #(
  parameter real ACQ_TIME  = 5e-6,  // Max lock acquisition time (s)
  parameter real JITTER_TOL = 0.3,  // Jitter tolerance (UI)
  parameter real LOOP_BW   = 10e6,  // Loop bandwidth (Hz)
  parameter integer ACQ_STEPS = 500 // Max acquisition steps
)(
  input  logic clk,
  input  logic rst_n,
  input  real  data_in_p,
  input  real  data_in_n,
  output real  clk_recovered,
  output logic lock
);
  real phase_error;
  int acq_counter;
  logic locked;

  always @(posedge clk or negedge rst_n) begin
    if (!rst_n) begin
      lock <= 0;
      acq_counter <= 0;
      locked <= 0;
    end else begin
      // Simplified acquisition behavior
      if (!locked) begin
        acq_counter <= acq_counter + 1;
        if (acq_counter >= ACQ_STEPS) begin
          locked <= 1;
          lock <= 1;
        end
      end
    end
  end
endmodule`,

  ctle_model: `// CTLE behavioral model (continuous-time linear equalizer)
module ctle_model #(
  parameter real DC_GAIN    = 0.0,   // DC gain (dB)
  parameter real PEAKING    = 6.0,   // Peaking gain (dB)
  parameter real BANDWIDTH  = 10e9,  // -3dB bandwidth (Hz)
  parameter real ZERO_FREQ  = 2e9,   // Zero frequency (Hz)
  parameter real SETTLE_TIME = 100e-9 // Settling time (s)
)(
  input  real vin_p,
  input  real vin_n,
  input  logic enable,
  output real vout_p,
  output real vout_n,
  output real peaking_db
);
  // Frequency domain: H(s) = DC_GAIN * (1 + s/wz) / (1 + s/wp)
  // Simplified time-domain model
  real gain_linear;

  always @(*) begin
    if (enable) begin
      gain_linear = $pow(10.0, (DC_GAIN + PEAKING) / 20.0);
      vout_p = gain_linear * vin_p;
      vout_n = gain_linear * vin_n;
      peaking_db = PEAKING;
    end else begin
      vout_p = vin_p;
      vout_n = vin_n;
      peaking_db = 0;
    end
  end
endmodule`,

  dfe_model: `// DFE behavioral model (decision-feedback equalizer)
module dfe_model #(
  parameter integer NUM_TAPS  = 5,    // Number of DFE taps
  parameter real TAP_WEIGHTS  = 0.1,  // Default tap weight
  parameter real SLICER_OFFSET = 0.0, // Slicer offset (V)
  parameter real CONV_TIME    = 1e-6  // Adaptation convergence time (s)
)(
  input  logic clk,
  input  logic rst_n,
  input  real  data_in,
  input  logic adapt_en,
  output logic data_out,
  output real  eq_error
);
  real taps[0:NUM_TAPS-1];
  real dfe_sum;
  int i;

  always @(posedge clk or negedge rst_n) begin
    if (!rst_n) begin
      for (i = 0; i < NUM_TAPS; i++) taps[i] = 0;
      data_out <= 0;
    end else begin
      // Tap adaptation (LMS-like)
      if (adapt_en) begin
        for (i = 0; i < NUM_TAPS; i++) begin
          taps[i] = taps[i] + 0.01 * eq_error;
        end
      end
      // Decision (slicer)
      data_out <= (data_in - dfe_sum) > SLICER_OFFSET;
    end
  end
endmodule`,

  tx_driver: `// TX driver behavioral model
module tx_driver #(
  parameter real SWING      = 0.8,   // Differential swing (Vpp)
  parameter real PRE_TAP    = 0.0,   // Pre-emphasis tap weight
  parameter real POST_TAP   = 0.0,   // De-emphasis tap weight
  parameter real IMPEDANCE  = 50.0,  // Output impedance (Ohm)
  parameter integer DATA_RATE_GBPS = 10 // Data rate (Gbps)
)(
  input  logic clk,
  input  logic data_in,
  input  logic [2:0] swing_ctrl,
  output real out_p,
  output real out_n,
  output real impedance
);
  real out_swing;

  always @(*) begin
    out_swing = SWING * (1.0 + 0.1 * swing_ctrl);
    impedance = IMPEDANCE;
  end

  always @(posedge clk) begin
    out_p <= data_in ? out_swing/2 : -out_swing/2;
    out_n <= data_in ? -out_swing/2 : out_swing/2;
  end
endmodule`,

  serializer: `// Serializer (parallel-to-serial)
module serializer #(
  parameter integer WIDTH = 40,     // Parallel data width
  parameter real DATA_RATE = 10e9   // Serial data rate (bps)
)(
  input  logic clk_ser,
  input  logic clk_par,
  input  logic rst_n,
  input  logic [WIDTH-1:0] data_par,
  input  logic data_valid,
  output logic data_ser,
  output logic data_ready
);
  logic [WIDTH-1:0] shift_reg;
  logic [$clog2(WIDTH)-1:0] bit_cnt;
  logic sending;

  always @(posedge clk_par or negedge rst_n) begin
    if (!rst_n) begin
      data_ready <= 1;
    end else if (data_valid && data_ready) begin
      shift_reg <= data_par;
      sending <= 1;
      bit_cnt <= 0;
      data_ready <= 0;
    end else if (sending && bit_cnt == WIDTH-1) begin
      sending <= 0;
      data_ready <= 1;
    end
  end

  always @(posedge clk_ser or negedge rst_n) begin
    if (!rst_n) begin
      data_ser <= 0;
    end else if (sending) begin
      data_ser <= shift_reg[WIDTH-1];
      shift_reg <= {shift_reg[WIDTH-2:0], 1'b0};
      bit_cnt <= bit_cnt + 1;
    end
  end
endmodule`,

  deserializer: `// Deserializer (serial-to-parallel)
module deserializer #(
  parameter integer WIDTH = 40
)(
  input  logic clk_ser,
  input  logic clk_par,
  input  logic rst_n,
  input  logic data_ser,
  output logic [WIDTH-1:0] data_par,
  output logic data_valid
);
  logic [WIDTH-1:0] shift_reg;
  logic [$clog2(WIDTH)-1:0] bit_cnt;
  logic framing;

  always @(posedge clk_ser or negedge rst_n) begin
    if (!rst_n) begin
      shift_reg <= 0;
      bit_cnt <= 0;
      framing <= 1;
    end else begin
      shift_reg <= {shift_reg[WIDTH-2:0], data_ser};
      if (bit_cnt == WIDTH-1) begin
        bit_cnt <= 0;
        framing <= 1;
      end else begin
        bit_cnt <= bit_cnt + 1;
      end
    end
  end

  always @(posedge clk_par) begin
    if (framing) begin
      data_par <= shift_reg;
      data_valid <= 1;
    end else begin
      data_valid <= 0;
    end
  end
endmodule`,
};

/** List of all SerDes primitives with metadata */
const SERDES_PRIMITIVES: PrimitiveDef[] = [
  {
    name: 'vco_model',
    displayName: 'VCO Behavioral Model',
    category: 'oscillator',
    mappedBlockTypes: ['vco', 'pll'],
    description: 'Voltage-controlled oscillator behavioral model with phase noise',
    ports: [
      { name: 'vtune', direction: 'input', svType: 'real', description: 'Tuning voltage' },
      { name: 'out_p', direction: 'output', svType: 'real', description: 'Positive output' },
      { name: 'out_n', direction: 'output', svType: 'real', description: 'Negative output' },
    ],
    params: [
      { name: 'GAIN', svType: 'real', defaultValue: 1e9, description: 'VCO gain (Hz/V)', unit: 'Hz/V' },
      { name: 'FCENTER', svType: 'real', defaultValue: 5e9, description: 'Center frequency', unit: 'Hz' },
      { name: 'KVCO', svType: 'real', defaultValue: 100e6, description: 'Tuning sensitivity', unit: 'Hz/V' },
    ],
    behaviorType: 'behavioral',
    simulatorCompat: { vcs: true, xcelium: true, questa: true, verilator: false },
    templatePath: 'vco_model.sv',
    supportsSpeedScaling: true,
    tags: ['serdes', 'pll', 'clock'],
    version: '1.0.0',
  },
  {
    name: 'cdr_model',
    displayName: 'CDR Behavioral Model',
    category: 'pll_cdr',
    mappedBlockTypes: ['cdr', 'bang_bang_pd', 'phase_detector'],
    description: 'Clock and data recovery behavioral model',
    ports: [
      { name: 'clk', direction: 'input', svType: 'logic', description: 'Reference clock' },
      { name: 'rst_n', direction: 'input', svType: 'logic', description: 'Active-low reset' },
      { name: 'data_in_p', direction: 'input', svType: 'real', description: 'Positive data input' },
      { name: 'data_in_n', direction: 'input', svType: 'real', description: 'Negative data input' },
      { name: 'clk_recovered', direction: 'output', svType: 'real', description: 'Recovered clock' },
      { name: 'lock', direction: 'output', svType: 'logic', description: 'Lock indicator' },
    ],
    params: [
      { name: 'ACQ_TIME', svType: 'real', defaultValue: 5e-6, description: 'Max acquisition time', unit: 's' },
      { name: 'JITTER_TOL', svType: 'real', defaultValue: 0.3, description: 'Jitter tolerance', unit: 'UI' },
      { name: 'LOOP_BW', svType: 'real', defaultValue: 10e6, description: 'Loop bandwidth', unit: 'Hz' },
    ],
    behaviorType: 'event_driven',
    simulatorCompat: { vcs: true, xcelium: true, questa: true, verilator: false },
    templatePath: 'cdr_model.sv',
    supportsSpeedScaling: true,
    tags: ['serdes', 'cdr', 'clock_recovery'],
    version: '1.0.0',
  },
  {
    name: 'ctle_model',
    displayName: 'CTLE Behavioral Model',
    category: 'equalizer',
    mappedBlockTypes: ['ctle', 'source_degenerated_diff_pair'],
    description: 'Continuous-time linear equalizer with peaking control',
    ports: [
      { name: 'vin_p', direction: 'input', svType: 'real', description: 'Positive input' },
      { name: 'vin_n', direction: 'input', svType: 'real', description: 'Negative input' },
      { name: 'enable', direction: 'input', svType: 'logic', description: 'Enable signal' },
      { name: 'vout_p', direction: 'output', svType: 'real', description: 'Positive output' },
      { name: 'vout_n', direction: 'output', svType: 'real', description: 'Negative output' },
      { name: 'peaking_db', direction: 'output', svType: 'real', description: 'Current peaking gain' },
    ],
    params: [
      { name: 'DC_GAIN', svType: 'real', defaultValue: 0.0, description: 'DC gain', unit: 'dB' },
      { name: 'PEAKING', svType: 'real', defaultValue: 6.0, description: 'Peaking gain', unit: 'dB' },
      { name: 'BANDWIDTH', svType: 'real', defaultValue: 10e9, description: '-3dB bandwidth', unit: 'Hz' },
      { name: 'ZERO_FREQ', svType: 'real', defaultValue: 2e9, description: 'Zero frequency', unit: 'Hz' },
    ],
    behaviorType: 'behavioral',
    simulatorCompat: { vcs: true, xcelium: true, questa: true, verilator: false },
    templatePath: 'ctle_model.sv',
    supportsSpeedScaling: true,
    serDesParams: { maxDataRateGbps: 28, eqTaps: 1, jitterModeling: false, adaptation: false },
    tags: ['serdes', 'equalizer', 'rx'],
    version: '1.0.0',
  },
  {
    name: 'dfe_model',
    displayName: 'DFE Behavioral Model',
    category: 'equalizer',
    mappedBlockTypes: ['dfe', 'dfe_tap'],
    description: 'Decision-feedback equalizer with LMS adaptation',
    ports: [
      { name: 'clk', direction: 'input', svType: 'logic', description: 'Clock' },
      { name: 'rst_n', direction: 'input', svType: 'logic', description: 'Reset' },
      { name: 'data_in', direction: 'input', svType: 'real', description: 'Analog input' },
      { name: 'adapt_en', direction: 'input', svType: 'logic', description: 'Adaptation enable' },
      { name: 'data_out', direction: 'output', svType: 'logic', description: 'Sliced output' },
      { name: 'eq_error', direction: 'output', svType: 'real', description: 'Equalization error' },
    ],
    params: [
      { name: 'NUM_TAPS', svType: 'integer', defaultValue: 5, description: 'Number of DFE taps' },
      { name: 'SLICER_OFFSET', svType: 'real', defaultValue: 0.0, description: 'Slicer offset', unit: 'V' },
    ],
    behaviorType: 'mixed',
    simulatorCompat: { vcs: true, xcelium: true, questa: true, verilator: false },
    templatePath: 'dfe_model.sv',
    supportsSpeedScaling: true,
    serDesParams: { maxDataRateGbps: 28, eqTaps: 5, jitterModeling: false, adaptation: true },
    tags: ['serdes', 'equalizer', 'rx'],
    version: '1.0.0',
  },
  {
    name: 'tx_driver',
    displayName: 'TX Driver Behavioral Model',
    category: 'driver',
    mappedBlockTypes: ['tx_driver', 'cml_driver', 'resistive_load_diff_pair'],
    description: 'Differential TX driver with programmable swing and equalization',
    ports: [
      { name: 'clk', direction: 'input', svType: 'logic', description: 'Clock' },
      { name: 'data_in', direction: 'input', svType: 'logic', description: 'Digital data input' },
      { name: 'swing_ctrl', direction: 'input', svType: 'logic', width: 3, description: 'Swing control' },
      { name: 'out_p', direction: 'output', svType: 'real', description: 'Positive output' },
      { name: 'out_n', direction: 'output', svType: 'real', description: 'Negative output' },
      { name: 'impedance', direction: 'output', svType: 'real', description: 'Output impedance' },
    ],
    params: [
      { name: 'SWING', svType: 'real', defaultValue: 0.8, description: 'Differential swing', unit: 'V' },
      { name: 'IMPEDANCE', svType: 'real', defaultValue: 50.0, description: 'Output impedance', unit: 'Ohm' },
    ],
    behaviorType: 'mixed',
    simulatorCompat: { vcs: true, xcelium: true, questa: true, verilator: false },
    templatePath: 'tx_driver.sv',
    supportsSpeedScaling: true,
    serDesParams: { maxDataRateGbps: 28, eqTaps: 2, jitterModeling: false, adaptation: false },
    tags: ['serdes', 'driver', 'tx'],
    version: '1.0.0',
  },
  {
    name: 'serializer',
    displayName: 'Serializer (P2S)',
    category: 'digital_interface',
    mappedBlockTypes: ['serializer_mux'],
    description: 'Parallel-to-serial converter',
    ports: [
      { name: 'clk_ser', direction: 'input', svType: 'logic', description: 'Serial clock' },
      { name: 'clk_par', direction: 'input', svType: 'logic', description: 'Parallel clock' },
      { name: 'rst_n', direction: 'input', svType: 'logic', description: 'Reset' },
      { name: 'data_par', direction: 'input', svType: 'logic', width: 40, description: 'Parallel data' },
      { name: 'data_valid', direction: 'input', svType: 'logic', description: 'Data valid' },
      { name: 'data_ser', direction: 'output', svType: 'logic', description: 'Serial data' },
      { name: 'data_ready', direction: 'output', svType: 'logic', description: 'Ready for data' },
    ],
    params: [
      { name: 'WIDTH', svType: 'integer', defaultValue: 40, description: 'Parallel data width' },
    ],
    behaviorType: 'structural',
    simulatorCompat: { vcs: true, xcelium: true, questa: true, verilator: true },
    templatePath: 'serializer.sv',
    supportsSpeedScaling: true,
    tags: ['serdes', 'digital', 'tx'],
    version: '1.0.0',
  },
  {
    name: 'deserializer',
    displayName: 'Deserializer (S2P)',
    category: 'digital_interface',
    mappedBlockTypes: ['deserializer_dff'],
    description: 'Serial-to-parallel converter',
    ports: [
      { name: 'clk_ser', direction: 'input', svType: 'logic', description: 'Serial clock' },
      { name: 'clk_par', direction: 'input', svType: 'logic', description: 'Parallel clock' },
      { name: 'rst_n', direction: 'input', svType: 'logic', description: 'Reset' },
      { name: 'data_ser', direction: 'input', svType: 'logic', description: 'Serial data' },
      { name: 'data_par', direction: 'output', svType: 'logic', width: 40, description: 'Parallel data' },
      { name: 'data_valid', direction: 'output', svType: 'logic', description: 'Data valid' },
    ],
    params: [
      { name: 'WIDTH', svType: 'integer', defaultValue: 40, description: 'Parallel data width' },
    ],
    behaviorType: 'structural',
    simulatorCompat: { vcs: true, xcelium: true, questa: true, verilator: true },
    templatePath: 'deserializer.sv',
    supportsSpeedScaling: true,
    tags: ['serdes', 'digital', 'rx'],
    version: '1.0.0',
  },
];

/** Primitive library: manages registration, lookup, and template rendering */
export class PrimitiveLibraryRegistry {
  private primitives = new Map<string, PrimitiveDef>();
  private blockTypeIndex = new Map<BlockType, PrimitiveDef[]>();

  constructor() {
    this.registerDefaults();
  }

  private registerDefaults(): void {
    for (const prim of SERDES_PRIMITIVES) {
      this.register(prim);
    }
  }

  register(prim: PrimitiveDef): void {
    this.primitives.set(prim.name, prim);
    for (const bt of prim.mappedBlockTypes) {
      const existing = this.blockTypeIndex.get(bt) || [];
      existing.push(prim);
      this.blockTypeIndex.set(bt, existing);
    }
  }

  get(name: string): PrimitiveDef | undefined {
    return this.primitives.get(name);
  }

  findByBlockType(bt: BlockType): PrimitiveDef[] {
    return this.blockTypeIndex.get(bt) || [];
  }

  getAll(): PrimitiveDef[] {
    return Array.from(this.primitives.values());
  }

  /** Render a primitive instance to SystemVerilog code */
  renderInstance(inst: PrimitiveInstance): string {
    const def = this.primitives.get(inst.primitiveName);
    if (!def) return `// Unknown primitive: ${inst.primitiveName}\n`;

    const lines: string[] = [];
    const paramStrs: string[] = [];
    const portStrs: string[] = [];

    for (const [name, val] of Object.entries(inst.paramOverrides)) {
      paramStrs.push(`  .${name}(${val})`);
    }

    for (const [port, net] of Object.entries(inst.portConnections)) {
      portStrs.push(`  .${port}(${net})`);
    }

    lines.push(`${inst.primitiveName} #(`);
    lines.push(paramStrs.join(',\n'));
    lines.push(`) ${inst.instanceName} (`);
    lines.push(portStrs.join(',\n'));
    lines.push(');');

    return lines.join('\n');
  }

  /** Render a full primitive SV module definition */
  renderTemplate(name: string): string {
    const template = SV_TEMPLATES[name];
    if (!template) return `// Template not found: ${name}\n`;
    return template;
  }

  /** Render the full library as a report/debug output */
  renderCatalog(): string {
    const lines: string[] = ['// Primitive Library Catalog', `// Total: ${this.primitives.size} primitives`, ''];
    for (const prim of this.getAll()) {
      lines.push(`// ${prim.name}: ${prim.displayName} (${prim.category})`);
    }
    return lines.join('\n');
  }
}

export const primitiveLibrary = new PrimitiveLibraryRegistry();
