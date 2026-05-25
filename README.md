# AnaModelGen — Analog Model Generator

> Generate SystemVerilog analog behavioral models and SVA assertion checkers from HSPICE netlists and Markdown analog specifications.

AnaModelGen is a modeling toolchain for high-speed analog circuits (SerDes PHY). It reads HSPICE transistor-level netlists and Markdown-format design specifications, then automatically generates synthesizable/simulatable SystemVerilog behavioral models and SVA (SystemVerilog Assertion) timing checkers — bridging the gap between analog circuit design and digital verification.

---

## Table of Contents

- [Background & Motivation](#background--motivation)
- [Industry Landscape](#industry-landscape)
- [Goals](#goals)
- [Core Architecture](#core-architecture)
- [Pipeline Details](#pipeline-details)
- [Quick Start](#quick-start)
- [Project Structure](#project-structure)
- [Configuration](#configuration)
- [Comparison with Industry Solutions](#comparison-with-industry-solutions)
- [Roadmap](#roadmap)
- [License](#license)

---

## Background & Motivation

### The Problem

In advanced process node (7nm/5nm/3nm) High-Speed PHY designs, there is a longstanding efficiency bottleneck:

```
Analog Design Team (SPICE/FineSim)
    ↓ delivers .sp netlists + .doc/.pdf spec sheets
    ↓ manual reading → manual coding
Digital Verification Team (SystemVerilog/VCS)
    ↓ needs: behavioral models + assertion checkers
```

- **Analog design** delivers HSPICE transistor-level netlists and free-form specification documents (Markdown/Word/PDF)
- **Digital verification** needs simulatable SystemVerilog behavioral models and SVA assertions to build UVM verification environments
- This process relies entirely on manual interpretation and coding, is error-prone, and requires re-synchronization every time the netlist changes

**Typical consequences:**
- Model behavior inconsistent with netlist behavior
- Timing constraints missed or misinterpreted
- Model delivery delayed, blocking verification progress
- High iteration cost (one netlist change → full manual redo)

### The Solution

AnaModelGen solves this through two complementary paths:

1. **Bottom-up**: Automatically extract circuit topology from SPICE netlists, map to a predefined analog primitive library, and generate behavioral models
2. **Top-down**: Parse timing constraints and truth tables from Markdown specification documents, and automatically generate SVA assertion checkers

The outputs of both paths can be combined for complete verification closure.

---

## Industry Landscape

Current approaches to this problem in the industry:

### 1. Manual Modeling (Industry Baseline)

**Approach**: Engineers read SPICE netlists and spec documents, then manually write SystemVerilog behavioral models and assertions.

**Advantages**: Maximum flexibility; experienced modeling engineers can capture complex nonlinear behavior.

**Disadvantages:**
- Extremely high labor cost; a skilled engineer still needs 2-4 weeks for a moderately complex SerDes model
- Consistency cannot be guaranteed; semantic gap exists between model behavior and netlist behavior
- Version synchronization is difficult; models often fall out of sync after netlist updates
- High probability of human-introduced bugs

### 2. Commercial EDA Solutions

| Tool | Vendor | Capability | Limitation |
|------|--------|------------|------------|
| XMODEL | XMOD Technologies | Automatically extracts behavioral Verilog-A/SystemVerilog models from SPICE | Expensive commercial license; fixed abstraction level; opaque to digital teams |
| Cadence Liberate + AMS Designer | Cadence | Characterization extraction + AMS mixed-signal simulation | Primarily for library characterization, does not directly generate verification models |
| Synopsys VCS + AMS | Synopsys | Supports mixed-signal simulation; VCS supports real-number modeling | Requires manual wreal model writing; no automatic extraction |
| MathWorks HDL Coder | MathWorks | Generates HDL from Simulink models | Requires rebuilding analog behavior in Simulink first; significant additional effort |

**Common limitations:**
- No ability to directly generate SVA assertions from free-form specification documents
- Limited scalability — difficult to handle SerDes PHY-scale circuits
- High toolchain integration cost; often requires dedicated EDA team maintenance

### 3. Academic & Open-Source Exploration

- **Analog circuit auto-synthesis** direction (e.g., NASA's FAAS, Berkeley's AGRA) — primarily targets automated synthesis, not verification model generation
- **Circuit characterization to behavioral models** — e.g., training regression models or neural networks via multiple SPICE simulation data points, but lacks interpretability and requires significant simulation resources
- **SVA assertion auto-generation** — limited academic work exists for generating assertions from Verilog RTL, but generating SVA from **natural language/Markdown specifications** remains an open gap

### 4. Mixed-Signal Verification Methodology

The industry's recent push toward **real-number modeling (RNM)** and the **wreal** standard (IEEE 1800-2017) provides a better abstraction foundation, but still requires engineers to manually write models. AnaModelGen's architecture is natively compatible with RNM output — a design decision aligned with the latest industry standards.

---

## Goals

### Core Goals

1. **Automatically generate SystemVerilog behavioral models from HSPICE netlists**, covering typical SerDes PHY modules (CTLE, VCO, CDR, DFE, TX Driver, Serializer, Deserializer, etc.)
2. **Automatically generate SVA assertion checkers from Markdown specification documents**, covering timing constraints, truth table verification, and PVT conditions
3. **Maintain model readability and maintainability** — generated code follows human-written style and supports manual tuning
4. **Multi-simulator compatibility** — generated code runs unmodified on VCS, Xcelium, and Questa
5. **Extensible topology recognition** — new circuit types can be added by registering a Pattern Detector

### Non-Goals

- Will not replace SPICE simulation for accuracy verification
- Does not guarantee 100% topology recognition coverage (specific circuits may require manual annotation)
- Not an analog circuit synthesis tool (does not generate layout or physical implementation)

---

## Core Architecture

```
                    ┌─────────────────────────┐
                    │  Markdown Spec Document  │
                    │  (serdes-ctle-spec.md)   │
                    └──────────┬──────────────┘
                               │
                    ┌──────────▼──────────────┐
                    │  MarkdownSpecParser      │
                    │  (Spec Parser)           │
                    │  → Port definitions      │
                    │  → Timing constraints    │
                    │  → Truth tables          │
                    │  → PVT conditions        │
                    └──────────┬──────────────┘
                               │ ParsedAnalogSpec
                               │
                    ┌──────────▼──────────────┐
                    │ SVACheckerGenerator      │
                    │ (SVA Checker Generator)  │
                    │  → Timing assertions     │
                    │  → Truth table assertions│
                    │  → Bind wrappers         │
                    └──────────┬──────────────┘
                               │
                     ┌─────────▼──────────────┐
                     │  checkers.sv            │
                     │  bind_checkers.sv       │
                     └────────────────────────┘


                    ┌─────────────────────────┐
                    │   HSPICE Netlist File    │
                    │  (serdes-ctle.sp)        │
                    └──────────┬──────────────┘
                               │
                    ┌──────────▼──────────────┐
                    │    HSPICEParser          │
                    │  (HSPICE Parser)         │
                    │  → Device instances      │
                    │  → .SUBCKT hierarchy     │
                    │  → .MODEL / .PARAM       │
                    └──────────┬──────────────┘
                               │ SPICENetlist
                               │
                    ┌──────────▼──────────────┐
                    │  HSPICEFlattener         │
                    │  (Hierarchy Flattener)   │
                    │  → Recursive flatten     │
                    │  → Parameter propagation │
                    └──────────┬──────────────┘
                               │ FlattenedNetlist
                               │
                    ┌──────────▼──────────────┐
                    │ CircuitGraphBuilder      │
                    │ (Circuit Graph Builder)  │
                    │  → CIR intermediate rep │
                    │  → Signal classification │
                    │  → Supply/ground detect  │
                    └──────────┬──────────────┘
                               │
                    ┌──────────▼──────────────┐
                    │ TopologyRecognizer       │
                    │  (Topology Recognizer)   │
                    │  → Differential pair     │
                    │  → Current mirror        │
                    │  → VCO topology          │
                    │  → CML topology          │
                    │  → CTLE topology         │
                    └──────────┬──────────────┘
                               │ IdentifiedBlock[]
                               │
                    ┌──────────▼──────────────┐
                    │  StructuralMapper        │
                    │  (Structural Mapper)     │
                    │  → Device→primitive map  │
                    └──────────┬──────────────┘
                               │
                    ┌──────────▼──────────────┐
                    │  PrimitiveLibrary        │
                    │  (Primitive Library)     │
                    │  → VCO/CDR/CTLE/DFE      │
                    │  → TX Driver/SerDes      │
                    └──────────┬──────────────┘
                               │
                    ┌──────────▼──────────────┐
                    │  SVModelGenerator        │
                    │  (SV Model Generator)    │
                    │  → SystemVerilog code    │
                    └──────────┬──────────────┘
                               │
                     ┌─────────▼──────────────┐
                     │  serdes_phy_model.sv    │
                     └────────────────────────┘
```

---

## Pipeline Details

### Phase 0: SPICE Parsing

**`HSPICEParser`** parses HSPICE netlist text into a structured AST (`SPICENetlist`):

| Feature | Support |
|---------|---------|
| Device types | M (MOSFET), R, C, L, D, Q, X, V, I, E, G, F, H, B |
| Hierarchy | `.SUBCKT` / `.ENDS` nesting |
| Parameters | `.PARAM`, inline parameters, model parameters |
| Model cards | `.MODEL` (nmos, pmos, npn, res, cap, etc.) |
| Control statements | `.TRAN`, `.AC`, `.DC`, `.MEAS`, `.OPTIONS` |
| Continuation lines | `+` continuation character |
| Comments | `$` inline comments, `*` line comments |
| SI suffixes | f/p/n/u/m/k/meg/g/t |

**`HSPICEFlattener`** recursively expands `.SUBCKT` hierarchy, renaming internal devices with instance prefixes (e.g., `XCTLE.M1`) and propagating parameter overrides, producing a single-level netlist (`FlattenedNetlist`).

### Phase 1: Circuit Intermediate Representation (CIR)

**`CircuitGraphBuilder`** converts the flattened netlist into a circuit graph intermediate representation (`CIRCircuit`):

- Builds a connectivity graph of device nodes and nets
- Automatic signal classification: `supply`, `ground`, `clock`, `analog`, `digital`, `bias`
- Automatic supply/ground detection: `VDD`/`VCC`/`VSS`/`GND`, etc.
- Port direction inference

CIR is the core bridge connecting SPICE parsing and model generation, ensuring downstream stages are independent of SPICE syntax details.

### Phase 2: Topology Recognition

**`TopologyRecognizer`** runs multiple Pattern Detectors in a plugin architecture:

| Detector | Function | File |
|----------|----------|------|
| `detectDifferentialPairs` | Identifies differential pairs (common-source, tail current, load) | `differential-pair.ts` |
| `detectCurrentMirrors` | Identifies current mirrors (basic, cascode) | `current-mirror.ts` |
| `detectVCO` | Identifies ring oscillators and LC oscillator topologies | `vco-topology.ts` |
| `detectCMLTopologies` | Identifies CML drivers, latches, and buffers | `cml-topology.ts` |
| `detectCTLE` | Identifies source-degenerated differential pair CTLE structures | `ctle-topology.ts` |

Each detector returns `IdentifiedBlock[]`, containing:
- Block type (`BlockType`: covers 36+ SerDes subcircuit types)
- Confidence score (0-1)
- Extracted key parameters
- Whether the block contains a feedback loop

**Extensibility**: Implement the `PatternDetector` interface (`(cir: CIRCircuit) => IdentifiedBlock[]`) and register it in the `DETECTORS` list.

### Phase 3: Primitive Library

**`PrimitiveLibraryRegistry`** manages predefined SystemVerilog primitive models:

| Primitive | Purpose | Behavior Type |
|-----------|---------|---------------|
| `vco_model` | Voltage-controlled oscillator with phase noise modeling | behavioral |
| `cdr_model` | Clock and data recovery (bang-bang type) | event_driven |
| `ctle_model` | Continuous-time linear equalizer (CTLE) | behavioral |
| `dfe_model` | Decision-feedback equalizer with LMS adaptation | mixed |
| `tx_driver` | Differential TX driver with programmable swing | mixed |
| `serializer` | Parallel-to-serial converter (P2S) | structural |
| `deserializer` | Serial-to-parallel converter (S2P) | structural |

Each primitive includes:
- SV port definitions (`logic`, `real`, `wreal` types)
- Parameterized interface (supports different data rates / process corners)
- Embedded SystemVerilog template code
- Multi-simulator compatibility annotations (VCS / Xcelium / Questa / Verilator)

### Phase 4: Structural Mapping + SV Code Generation

**`StructuralMapper`** maps CIR devices to primitive instances (currently by device type).

**`SVModelGenerator`** renders the mapping result into SystemVerilog code:
- Generates `module` wrapper
- Port declarations (`real` for analog signals, `logic` for digital/clock signals)
- Parameterized interface
- Internal net declarations
- Primitive instantiation

### Phase 5: Spec Parsing + SVA Generation (Parallel Pipeline)

**`MarkdownAnalogSpecParser`** parses structured information from Markdown specification documents:

| Section | Output |
|---------|--------|
| `## Interface` | Port list (name, direction, signal type) |
| `## Timing Constraints` | Timing constraints (rise/fall time, setup/hold, lock time, etc.) |
| `## Truth Tables` | Truth tables (combinational/sequential, auto-detect I/O columns) |
| `## Operating Conditions` | PVT conditions (process corners, voltage, temperature) |
| `## Performance Targets` | Performance targets (data rate, power, area) |

**`SVACheckerGenerator`** generates SVA assertion code from the parsed specification:

| Input | SVA Output |
|-------|------------|
| Timing constraints | `assert property (@(posedge clk) ...)` |
| Truth tables | `assert property (in_cond |-> out_cond)` |
| Bind relationships | `bind target_module checker_module (.*)` |

Supported system functions: `$setup`, `$hold`, `$width`, `$rose`, `$fell`, `$stable`, `$changed`, `$realtime`.

---

## Quick Start

### Installation

```bash
git clone <repo-url>
cd AnaModelGen
npm install
npm run build
```

### Run Tests

```bash
npm test
```

Test coverage:
- HSPICE parser (subcircuits, continuation lines, comments, SI suffixes)
- Hierarchy flattener
- Circuit graph builder
- Topology recognition (differential pair, current mirror, CML)
- Spec document parsing
- SVA generation
- End-to-end pipeline

### Usage Example

```typescript
import AnaModelGen from 'ana-model-gen';
import * as fs from 'fs';

const gen = new AnaModelGen();

// === Path 1: Generate SV behavioral model from SPICE ===
const spiceSource = fs.readFileSync('serdes-ctle.sp', 'utf-8');
const { svCode, cir, warnings } = gen.generateModel(spiceSource, 'serdes_phy');
console.log(svCode);  // SystemVerilog behavioral model

// View topology analysis results separately
const { topology, netlist, flattened, cir: cirFull } = gen.parseSPICE(spiceSource, 'serdes_phy');
console.log(`Identified ${topology.blocks.length} blocks`);
console.log(`Coverage: ${(topology.metrics.coverageRatio * 100).toFixed(1)}%`);

// === Path 2: Generate SVA checkers from spec document ===
const specMarkdown = fs.readFileSync('serdes-ctle-spec.md', 'utf-8');
const parsedSpec = gen.parseAnalogSpec(specMarkdown);
const svaResult = gen.generateCheckers(parsedSpec, 'serdes_phy_model');

for (const file of svaResult.files) {
  console.log(`=== ${file.name} ===`);
  console.log(file.content);
}

// === View primitive library catalog ===
console.log(gen.getPrimitiveCatalog().slice(0, 500));
```

---

## Project Structure

```
AnaModelGen/
├── src/
│   ├── index.ts                          # Entry point + AnaModelGen facade
│   ├── config/
│   │   └── default.ts                    # Global configuration
│   ├── types/
│   │   ├── spice-types.ts                # HSPICE AST types
│   │   ├── cir-types.ts                  # Circuit Intermediate Representation types
│   │   ├── analog-spec-types.ts          # Analog specification types
│   │   ├── primitive-types.ts            # Primitive library types
│   │   └── sva-types.ts                  # SVA assertion types
│   ├── parsers/
│   │   ├── spice/
│   │   │   ├── hspice-parser.ts          # HSPICE netlist parser
│   │   │   └── hspice-flattener.ts       # HSPICE hierarchy flattener
│   │   └── analog-spec/
│   │       └── markdown-spec-parser.ts   # Markdown spec parser
│   ├── cir/
│   │   └── circuit-graph.ts              # Circuit graph builder
│   ├── recognition/
│   │   ├── topology-recognizer.ts        # Topology recognizer (core)
│   │   └── patterns/
│   │       ├── differential-pair.ts      # Differential pair detection
│   │       ├── current-mirror.ts         # Current mirror detection
│   │       ├── vco-topology.ts           # VCO detection
│   │       ├── cml-topology.ts           # CML detection
│   │       └── ctle-topology.ts          # CTLE detection
│   ├── primitives/
│   │   └── primitive-registry.ts         # Primitive library registry + SV templates
│   └── generators/
│       ├── sv-model/
│       │   ├── structural-mapper.ts      # Structural mapper
│       │   └── sv-model-generator.ts     # SV code generator
│       └── sva-checker/
│           └── sva-checker-generator.ts  # SVA checker generator
├── tests/
│   ├── analog-modeling.test.ts           # Integration tests
│   └── fixtures/
│       ├── serdes-ctle.sp                # CTLE HSPICE netlist fixture
│       └── serdes-ctle-spec.md           # CTLE Markdown spec fixture
├── tsconfig.json
├── jest.config.js
├── package.json
└── README.md
```

---

## Configuration

Control model generation behavior via `AnaModelGenConfig`:

```typescript
interface AnaModelGenConfig {
  modelFidelity: 'functional' | 'behavioral' | 'structural';
  svaCompat: 'vcs' | 'xcelium' | 'questa' | 'multi';
  svaSeverity: 'error' | 'warning' | 'info';
}
```

| Option | Default | Description |
|--------|---------|-------------|
| `modelFidelity` | `functional` | Model fidelity: functional/behavioral/structural |
| `svaCompat` | `multi` | SVA compatibility mode |
| `svaSeverity` | `error` | Assertion failure severity level |

---

## Comparison with Industry Solutions

| Dimension | Manual Modeling | Commercial EDA (XMODEL/Liberate) | AnaModelGen |
|-----------|----------------|----------------------------------|-------------|
| Modeling speed | 2-4 weeks | 1-3 days (requires additional setup) | Milliseconds |
| Human effort | High | Medium (requires PDK preparation) | Low |
| Accuracy | Engineer-dependent | High (simulation-based characterization) | Functional/behavioral |
| SVA generation | Fully manual | Not supported | Auto from spec documents |
| Topology recognition | N/A | Not supported | 5+ SerDes topologies |
| Truth table → assertion | Manual | Not supported | Automatic |
| Spec change tracking | Manual diff | N/A | Re-parse and done |
| Open source | N/A | No | MIT |
| Multi-simulator | Manual adjustment | Vendor-locked toolchain | VCS/Xcelium/Questa |
| Learning curve | High | High | Low (TypeScript API) |

---

## Roadmap

- [x] HSPICE netlist parser (.SUBCKT / .MODEL / .PARAM)
- [x] Circuit hierarchy flattener
- [x] CIR circuit intermediate representation
- [x] Topology recognition framework + 5 Pattern Detectors
- [x] Primitive library (VCO/CDR/CTLE/DFE/TX Driver/Serializer/Deserializer)
- [x] SV behavioral model code generator
- [x] Markdown spec parser
- [x] SVA assertion generator
- [ ] Enhanced primitive mapping (more device types → primitive mapping)
- [ ] Support for more SPICE dialects (Spectre, PSpice)
- [ ] Waveform-driven characterization extraction (automatic parameter extraction)
- [ ] YAML/JSON spec input support
- [ ] Verilog-AMS output format support
- [ ] SVA coverage-driven topology verification
- [ ] VSCode extension (syntax highlighting, model preview)

---

## License

MIT

---

*AnaModelGen — Analog Model Generation for Digital Verification*
