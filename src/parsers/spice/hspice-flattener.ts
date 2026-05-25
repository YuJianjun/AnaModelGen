import type {
  SPICENetlist, SPICEDevice, SPICESubcircuit, SPICESubcircuitInstance,
  FlattenedNetlist, SPICEDeviceType
} from '../../types/spice-types';

/**
 * HSPICE Hierarchy Flattener
 *
 * Resolves .SUBCKT hierarchy into a single-level device list.
 * Handles: nested subcircuits, parameter propagation, hierarchical naming.
 */
export class HSPICEFlattener {
  private instanceCounter = 0;

  /** Flatten a hierarchical netlist into a single level */
  flatten(netlist: SPICENetlist, topName?: string): FlattenedNetlist {
    this.instanceCounter = 0;

    const allDevices: SPICEDevice[] = [];
    const allModelCards = new Map<string, import('../../types/spice-types').SPICEModelCard>();
    const allNodes = new Set<string>();
    const ports: string[] = [];
    const deviceCounts: Partial<Record<SPICEDeviceType, number>> = {};

    // Populate model cards from netlist
    for (const mc of netlist.modelCards) {
      allModelCards.set(mc.name.toUpperCase(), mc);
    }
    for (const [, sub] of netlist.subcircuitDefinitions) {
      for (const mc of sub.modelCards) {
        allModelCards.set(mc.name.toUpperCase(), mc);
      }
    }

    // If the netlist is a single subcircuit, flatten from there
    if (topName && netlist.subcircuitDefinitions.has(topName.toUpperCase())) {
      const topSub = netlist.subcircuitDefinitions.get(topName.toUpperCase())!;
      ports.push(...topSub.ports);
      this.flattenDevices(topSub.devices, topSub.subcircuitInstances,
        netlist.subcircuitDefinitions, allModelCards, allDevices, allNodes, '', deviceCounts);
    } else {
      // Flatten from top-level devices
      this.flattenDevices(netlist.devices, netlist.subcircuitInstances,
        netlist.subcircuitDefinitions, allModelCards, allDevices, allNodes, '', deviceCounts);
    }

    return {
      name: topName || netlist.title || 'top',
      devices: allDevices,
      modelCards: allModelCards,
      ports,
      nodes: Array.from(allNodes).map(name => ({
        name,
        global: name.endsWith('!'),
        numeric: /^\d+$/.test(name),
        hierarchical: name.includes('.'),
      })),
      deviceCounts,
    };
  }

  /** Recursively flatten devices from subcircuit instances */
  private flattenDevices(
    devices: SPICEDevice[],
    instances: SPICESubcircuitInstance[],
    subcircuitDefs: Map<string, SPICESubcircuit>,
    modelCards: Map<string, import('../../types/spice-types').SPICEModelCard>,
    resultDevices: SPICEDevice[],
    allNodes: Set<string>,
    prefix: string,
    deviceCounts: Partial<Record<SPICEDeviceType, number>>,
  ): void {
    // Count direct devices
    for (const dev of devices) {
      const prefixed: SPICEDevice = {
        ...dev,
        name: prefix ? `${prefix}.${dev.name}` : dev.name,
        terminals: { ...dev.terminals },
        params: { ...dev.params },
      };
      resultDevices.push(prefixed);
      this.countDevice(dev.type, deviceCounts);
    }

    // Flatten subcircuit instances
    for (const inst of instances) {
      const subDef = subcircuitDefs.get(inst.subcircuitName.toUpperCase());
      if (!subDef) continue;

      const instPrefix = prefix ? `${prefix}.${inst.name}` : inst.name;

      // Create terminal mapping: subcircuit port index → actual net
      const terminalMapping: Record<string, string> = {};
      for (let i = 0; i < subDef.ports.length && i < inst.connections.length; i++) {
        terminalMapping[subDef.ports[i]] = inst.connections[i];
        if (inst.connections[i]) allNodes.add(inst.connections[i]);
      }

      // Flatten subcircuit internal devices with renamed terminals
      for (const dev of subDef.devices) {
        const renamedDev: SPICEDevice = {
          ...dev,
          name: `${instPrefix}.${dev.name}`,
          terminals: this.remapTerminals(dev.terminals, terminalMapping),
          params: { ...dev.params, ...inst.params }, // instance params override
        };
        resultDevices.push(renamedDev);
        this.countDevice(dev.type, deviceCounts);
      }

      // Recurse into nested subcircuits
      this.flattenDevices(
        [], subDef.subcircuitInstances,
        subcircuitDefs, modelCards, resultDevices, allNodes, instPrefix, deviceCounts,
      );
    }
  }

  /** Remap subcircuit internal terminal names to parent-level net names */
  private remapTerminals(
    terminals: Record<string, string>,
    mapping: Record<string, string>,
  ): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [term, net] of Object.entries(terminals)) {
      result[term] = mapping[net] ?? net;
    }
    return result;
  }

  /** Count device type occurrences */
  private countDevice(type: SPICEDeviceType, counts: Partial<Record<SPICEDeviceType, number>>): void {
    counts[type] = (counts[type] ?? 0) + 1;
  }
}
