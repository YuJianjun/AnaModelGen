import type { FlattenedNetlist, SPICEDevice } from '../types/spice-types';
import type {
  CIRCircuit, CIRPort, CIRNet, CIRDevice,
} from '../types/cir-types';

/** Known supply and ground net names */
const SUPPLY_NETS = new Set(['VDD', 'VCC', 'VDDA', 'VDDIO', 'VDDQ', 'VPP', 'VNN']);
const GROUND_NETS = new Set(['GND', 'VSS', 'VSSA', 'VEE', '0', 'GND!', 'VSS!']);

/**
 * Circuit Graph Builder
 *
 * Transforms a flattened HSPICE netlist into the Circuit Intermediate
 * Representation (CIR) — a device graph with signal classification.
 */
export class CircuitGraphBuilder {
  /** Build CIRCircuit from a flattened netlist */
  build(flattened: FlattenedNetlist): CIRCircuit {
    const ports = this.buildPorts(flattened);
    const devices = this.buildDevices(flattened);
    const nets = this.buildNets(flattened, devices);
    const supplyNets = this.identifySupplyNets(nets);

    return {
      name: flattened.name,
      source: {
        topName: flattened.name,
        isSubcircuit: false,
      },
      ports,
      nets,
      devices,
      buildMethod: 'flattened',
      flattenedNetlist: flattened,
      simHints: {
        hasClock: false,
        hasFeedback: false,
        estimatedBlockCount: Math.ceil(flattened.devices.length / 20),
        primaryPowerSupply: supplyNets.supply,
        primaryGround: supplyNets.ground,
      },
    };
  }

  /** Build port list from flattened netlist ports */
  private buildPorts(flattened: FlattenedNetlist): CIRPort[] {
    return flattened.ports.map(name => ({
      name,
      direction: this.inferPortDirection(name),
      signalType: this.inferSignalTypeForPort(name),
    }));
  }

  /** Build CIR devices from flattened devices */
  private buildDevices(flattened: FlattenedNetlist): CIRDevice[] {
    return flattened.devices.map((dev, index) => ({
      name: dev.name,
      type: dev.type,
      spiceType: dev.type,
      terminals: dev.terminals,
      params: dev.params,
      modelName: dev.modelName,
      mapped: false,
      groupId: index,
    }));
  }

  /** Build net connectivity graph */
  private buildNets(flattened: FlattenedNetlist, devices: CIRDevice[]): Map<string, CIRNet> {
    const netMap = new Map<string, CIRNet>();
    const portSet = new Set(flattened.ports);

    // Collect all unique net names from device terminals
    const allNetNames = new Set<string>();
    devices.forEach((dev, devIdx) => {
      for (const [term, net] of Object.entries(dev.terminals)) {
        allNetNames.add(net);
        if (!netMap.has(net)) {
          netMap.set(net, {
            name: net,
            isPort: portSet.has(net),
            signalType: this.inferSignalType(net),
            connectedTerminals: [],
          });
        }
        netMap.get(net)!.connectedTerminals.push([devIdx, term]);
      }
    });

    // Mark ports
    for (const portName of flattened.ports) {
      if (!netMap.has(portName)) {
        netMap.set(portName, {
          name: portName,
          isPort: true,
          direction: this.inferPortDirection(portName),
          signalType: this.inferSignalType(portName),
          connectedTerminals: [],
        });
      } else {
        const net = netMap.get(portName)!;
        net.isPort = true;
        net.direction = this.inferPortDirection(portName);
      }
    }

    return netMap;
  }

  /** Identify primary supply and ground nets */
  private identifySupplyNets(nets: Map<string, CIRNet>): { supply?: string; ground?: string } {
    let supply: string | undefined;
    let ground: string | undefined;

    for (const [name, net] of nets) {
      const upper = name.toUpperCase();
      if (SUPPLY_NETS.has(upper)) supply = name;
      if (GROUND_NETS.has(upper)) ground = name;
    }

    return { supply, ground };
  }

  /** Infer port direction from naming conventions */
  private inferPortDirection(name: string): 'input' | 'output' | 'inout' {
    const upper = name.toUpperCase();
    if (GROUND_NETS.has(upper) || SUPPLY_NETS.has(upper)) return 'inout';
    return 'inout'; // conservative default for analog nets
  }

  /** Infer signal type from net name */
  private inferSignalType(name: string): NonNullable<CIRNet['signalType']> {
    const upper = name.toUpperCase();
    if (GROUND_NETS.has(upper)) return 'ground';
    if (SUPPLY_NETS.has(upper)) return 'supply';
    if (upper.includes('CLK') || upper.includes('CK') || upper.includes('CLOCK')) return 'clock';
    if (upper.includes('BIAS') || upper.includes('VREF') || upper.includes('VCM')) return 'bias';
    if (upper.includes('DIN') || upper.includes('DOUT') || upper.includes('DATA') || upper.includes('DIG')) return 'digital';
    return 'analog';
  }

  private inferSignalTypeForPort(name: string): CIRPort['signalType'] {
    const st = this.inferSignalType(name);
    if (st === 'digital_analog') return 'analog';
    return st;
  }
}
