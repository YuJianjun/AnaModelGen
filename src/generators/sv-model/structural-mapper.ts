import type { CIRCircuit, CIRDevice, CIRPort } from '../../types/cir-types';
import type { PrimitiveInstance, GeneratedSVModel, PrimitivePort, PrimitiveParam } from '../../types/primitive-types';
import { primitiveLibrary } from '../../primitives/primitive-registry';

/**
 * Structural Mapper
 *
 * Maps CIR devices to primitive instances based on device type.
 * Produces a GeneratedSVModel ready for code rendering.
 */
export class StructuralMapper {
  map(cir: CIRCircuit): GeneratedSVModel {
    const instances: PrimitiveInstance[] = [];
    const internalNets = new Set<string>();
    const warnings: string[] = [];

    for (const device of cir.devices) {
      const primName = this.mapDeviceType(device);
      if (!primName) {
        warnings.push(`No primitive mapping for ${device.name} (type: ${device.type})`);
        continue;
      }

      const primDef = primitiveLibrary.get(primName);
      if (!primDef) {
        warnings.push(`Primitive not found: ${primName}`);
        continue;
      }

      const paramOverrides = this.extractParams(device, primDef);
      const portConnections = this.buildConnections(device, cir);

      instances.push({
        instanceName: device.name.replace(/\./g, '_'),
        primitiveName: primName,
        portConnections,
        paramOverrides,
      });

      // Track internal nets
      for (const net of Object.values(portConnections)) {
        if (!cir.ports.some(p => p.name === net)) {
          internalNets.add(net);
        }
      }
    }

    return {
      name: cir.name + '_model',
      ports: this.cirPortsToPrimitive(cir.ports),
      params: this.extractTopParams(cir),
      instances,
      internalNets: Array.from(internalNets).map(n => ({ name: n, type: 'wire' })),
      metadata: {
        sourceCircuit: cir.name,
        generatedAt: new Date(),
        primitiveCount: instances.length,
        totalInstances: instances.length,
        warnings,
      },
    };
  }

  /** Map CIR device type to primitive name */
  private mapDeviceType(device: CIRDevice): string | null {
    switch (device.type) {
      case 'vsource':
      case 'vpulse': return null; // power supplies are implicit
      case 'isource':
      case 'ipulse': return null;
      default:
        // Fall back to generic device mapping based on type
        return null;
    }
  }

  /** Extract device parameters that match primitive parameters */
  private extractParams(device: CIRDevice, primDef: import('../../types/primitive-types').PrimitiveDef): Record<string, string | number> {
    const overrides: Record<string, string | number> = {};
    for (const pdef of primDef.params) {
      const deviceParam = device.params[pdef.name];
      if (deviceParam !== undefined) {
        overrides[pdef.name] = deviceParam;
      }
    }
    return overrides;
  }

  /** Build port connections from device terminals */
  private buildConnections(device: CIRDevice, cir: CIRCircuit): Record<string, string> {
    const connections: Record<string, string> = {};
    for (const [term, net] of Object.entries(device.terminals)) {
      // Map SPICE terminal names to primitive port names
      const mappedTerm = this.mapTerminal(term, device.type);
      if (mappedTerm) {
        connections[mappedTerm] = net;
      }
    }
    return connections;
  }

  /** Map SPICE terminal names to primitive port names */
  private mapTerminal(term: string, _type: string): string | null {
    const mapping: Record<string, string> = {
      d: 'drain', g: 'gate', s: 'source', b: 'bulk',
      p: 'plus', n: 'minus',
      cp: 'ctrl_p', cn: 'ctrl_n',
    };
    return mapping[term] || term;
  }

  /** Convert CIR ports to primitive ports */
  private cirPortsToPrimitive(cirPorts: CIRPort[]): PrimitivePort[] {
    return cirPorts.map(p => ({
      name: p.name,
      direction: p.direction as PrimitivePort['direction'],
      svType: p.signalType === 'digital' || p.signalType === 'clock' ? 'logic' : 'real',
      description: p.description,
    }));
  }

  /** Extract top-level parameters */
  private extractTopParams(_cir: CIRCircuit): PrimitiveParam[] {
    return [
      { name: 'ENABLE_ANALOG', svType: 'logic', defaultValue: 1, description: 'Enable analog behavior' },
    ];
  }

  /** Find all unique nets for a device (for internal net detection) */
  private getDeviceNets(device: CIRDevice): string[] {
    return Object.values(device.terminals).filter(n => n !== '0' && !n.toUpperCase().startsWith('VDD') && !n.toUpperCase().startsWith('VSS'));
  }
}
