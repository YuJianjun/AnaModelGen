# SerDes CTLE Specification

**Version**: 1.0

## Circuit Type
- serdes

## Interface

| Port | Direction | Type | Description |
|------|-----------|------|-------------|
| dinp | input | analog | Differential input positive |
| dinn | input | analog | Differential input negative |
| doutp | output | analog | Differential output positive |
| doutn | output | analog | Differential output negative |
| clk | input | clock | Reference clock |
| rst_n | input | digital | Active-low reset |

## Timing Constraints

| Parameter | Value | Description |
|-----------|-------|-------------|
| Settling time | < 100ns | CTLE settling from enable |
| Bandwidth | > 10GHz | -3dB bandwidth |
| Peaking gain | 6dB | Maximum peaking at Nyquist |
| Lock time | < 5us | CDR lock acquisition |
| Jitter tolerance | > 0.3UI | At 10MHz jitter frequency |

## Truth Tables

### CTLE Mode Control

| Mode[1:0] | Peaking_dB | Description |
|-----------|------------|-------------|
| 00 | 0 | Bypass |
| 01 | 3 | Low boost |
| 10 | 6 | Medium boost |
| 11 | 12 | High boost |

## Operating Conditions

**Process**: TT, FF, SS
**Voltage**: 1.08V to 1.32V
**Temperature**: -40C to 125C

## Performance Targets

| Metric | Target | Unit | Corner |
|--------|--------|------|-------|
| Data rate | 10 | Gbps | TT |
| Power | 50 | mW | FF |
| Area | 0.01 | mm2 | TT |
