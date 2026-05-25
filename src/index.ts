export * from './types/spice-types';
export * from './types/cir-types';
export * from './types/primitive-types';
export * from './types/analog-spec-types';
export * from './types/sva-types';

import { HSPICEParser } from './parsers/spice/hspice-parser';
import { HSPICEFlattener } from './parsers/spice/hspice-flattener';
import { CircuitGraphBuilder } from './cir/circuit-graph';
import { MarkdownAnalogSpecParser } from './parsers/analog-spec/markdown-spec-parser';
import { TopologyRecognizer } from './recognition/topology-recognizer';
import { primitiveLibrary } from './primitives/primitive-registry';
import { StructuralMapper } from './generators/sv-model/structural-mapper';
import { SVModelGenerator } from './generators/sv-model/sv-model-generator';
import { SVACheckerGenerator } from './generators/sva-checker/sva-checker-generator';

export class AnaModelGen {
  private hspiceParser = new HSPICEParser();
  private flattener = new HSPICEFlattener();
  private cirBuilder = new CircuitGraphBuilder();
  private specParser = new MarkdownAnalogSpecParser();
  private recognizer = new TopologyRecognizer();
  private mapper = new StructuralMapper();
  private svModelGen = new SVModelGenerator();
  private svaCheckerGen = new SVACheckerGenerator();

  parseSPICE(source: string, topName?: string) {
    const netlist = this.hspiceParser.parse(source);
    const flattened = this.flattener.flatten(netlist, topName);
    const cir = this.cirBuilder.build(flattened);
    const topology = this.recognizer.analyze(cir);
    return { netlist, flattened, cir, topology };
  }

  generateModel(source: string, topName?: string) {
    const { cir } = this.parseSPICE(source, topName);
    const mapped = this.mapper.map(cir);
    const svCode = this.svModelGen.generate(mapped);
    return { svCode, cir, primitiveCatalog: primitiveLibrary.renderCatalog(), warnings: mapped.metadata.warnings };
  }

  parseAnalogSpec(markdown: string) {
    return this.specParser.parse(markdown);
  }

  generateCheckers(analogSpec: ReturnType<MarkdownAnalogSpecParser['parse']>, modelName: string) {
    return this.svaCheckerGen.generate(analogSpec.spec, modelName);
  }

  getPrimitiveCatalog() {
    return primitiveLibrary.renderCatalog();
  }
}

export default AnaModelGen;
