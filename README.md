# AnaModelGen — Analog Model Generator

> **从 HSPICE 网表和 Markdown 规格文档自动生成 SystemVerilog 模拟行为模型与断言检查器**

AnaModelGen 是一个面向高速模拟电路的建模工具链。它读取 HSPICE 晶体管级网表和 Markdown 格式的设计规格，自动生成可综合/可仿真的 SystemVerilog 行为级模型以及 SVA (SystemVerilog Assertion) 时序检查器——弥合模拟电路设计与数字验证之间的鸿沟。

---

## 目录

- [背景与动机](#背景与动机)
- [业界现状](#业界现状)
- [目标](#目标)
- [核心架构](#核心架构)
- [流水线详解](#流水线详解)
- [快速开始](#快速开始)
- [项目结构](#项目结构)
- [配置](#配置)
- [与业界方案的对比](#与业界方案的对比)
- [路线图](#路线图)
- [许可证](#许可证)

---

## 背景与动机

### 问题

在先进制程 (7nm/5nm/3nm) 的 High Speed PHY 设计中，存在一个长期存在的效率瓶颈：

```
模拟设计团队 (SPICE/FineSim)
    ↓ 交付 .sp 网表 + .doc/.pdf 规格书
    ↓ 人工阅读 → 手动编写
数字验证团队 (SystemVerilog/VCS)
    ↓ 需要：行为模型 + 断言检查器
```

- **模拟设计** 交付的是 HSPICE 晶体管级网表和自由格式的规格文档 (Markdown/Word/PDF)
- **数字验证** 需要的是可仿真的 SystemVerilog 行为模型和 SVA 断言来搭建 UVM 验证环境
- 这个过程完全依赖人工解读和手动编码，极易出错，且每次网表变更都需要重新同步

**典型后果**：
- 模型与网表行为不一致
- 时序约束被遗漏或误解
- 模型交付延迟，阻塞验证进度
- 迭代成本高（一次网表改动 → 全部手动重做）

### 解决方案

AnaModelGen 通过两条路径解决这个问题：

1. **自底向上**：从 SPICE 网表自动提取电路拓扑，映射到预定义的模拟原语库，生成行为模型
2. **自顶向下**：从 Markdown 规格文档解析时序约束和真值表，自动生成 SVA 断言检查器

两条路径的输出可组合使用，形成完整的验证闭合。

---

## 业界现状

目前行业内应对该问题的主要方式：

### 1. 纯手工建模 (Industry Baseline)

**方式**：工程师阅读 SPICE 网表和规格文档，手动编写 SystemVerilog 行为模型和断言。

**优点**：灵活性最高，建模经验丰富的工程师可以捕捉复杂非线性行为。

**缺点**：
- 人力成本极高，熟练工程师仍需 2-4 周完成一个中等复杂度的 SerDes 模型
- 一致性无法保证，模型行为与网表之间存在语义鸿沟
- 版本同步困难，网表更新后模型不同步是常态
- 人为引入 bug 的概率高

### 2. 商业 EDA 方案

| 工具 | 厂商 | 能力 | 局限 |
|------|------|------|------|
| XMODEL | XMOD Technologies | 从 SPICE 自动提取行为级 Verilog-A/SystemVerilog 模型 | 商业许可昂贵；模型抽象层次固定；对数字团队不透明 |
| Cadence Liberate + AMS Designer | Cadence | 特征化提取 + AMS 混合信号仿真 | 主要用于库特征化，不直接生成验证用模型 |
| Synopsys VCS + AMS | Synopsys | 支持混合信号仿真；VCS 支持 real-number modeling | 需要手动编写 wreal 模型，不提供自动提取 |
| MathWorks HDL Coder | MathWorks | 从 Simulink 模型生成 HDL | 需要先在 Simulink 中重建模拟行为，额外工作量大 |

**共性局限**：
- 缺乏从自由格式规格文档直接生成 SVA 断言的能力
- 扩展性有限——难以处理 SerDes PHY 级别的电路规模
- 工具链集成成本高，通常需要专门的 EDA 团队维护

### 3. 学术与开源探索

- **模拟电路自动综合** 方向（如：NASA 的 FAAS, Berkeley 的 AGRA）——主要面向自动化综合，而非验证模型生成
- **电路特征化到行为模型** —— 如通过多次 SPICE 仿真采点训练回归模型或神经网络，但缺乏可解释性且需要大量仿真资源
- **SVA 断言自动生成** —— 已有少量学术工作从 Verilog RTL 生成断言，但从 **自然语言/Markdown 规格** 生成 SVA 的工作尚属空白

### 4. 混合信号验证方法论

业界近年推动的 **real-number modeling (RNM)** 和 **wreal** 标准（IEEE 1800-2017）提供了更好的抽象基础，但仍需要工程师手动编写模型。AnaModelGen 的架构天然兼容 RNM 输出——这是与最新行业标准对齐的设计决策。

---

## 目标

### 核心目标

1. **从 HSPICE 网表自动生成 SystemVerilog 行为模型**，覆盖 SerDes PHY 典型模块（CTLE、VCO、CDR、DFE、TX Driver、Serializer、Deserializer 等）
2. **从 Markdown 规格文档自动生成 SVA 断言检查器**，覆盖时序约束、真值表验证、PVT 条件
3. **保持模型的可读性与可维护性**——生成的代码符合人工编写风格，支持手动微调
4. **多仿真器兼容**——生成的代码在 VCS、Xcelium、Questa 上无修改运行
5. **可扩展的拓扑识别**——新电路类型可通过注册 Pattern Detector 扩展

### 非目标

- 不会替代 SPICE 仿真进行精度验证
- 不承诺 100% 的拓扑识别覆盖率（特定电路需要手动标注）
- 不是模拟电路综合工具（不生成版图或物理实现）

---

## 核心架构

```
                    ┌─────────────────────┐
                    │   Markdown 规格文档   │
                    │  (serdes-ctle-spec.md)│
                    └──────────┬──────────┘
                               │
                    ┌──────────▼──────────┐
                    │  MarkdownSpecParser  │
                    │  (规格解析器)         │
                    │  → 端口定义          │
                    │  → 时序约束          │
                    │  → 真值表            │
                    │  → PVT工况           │
                    └──────────┬──────────┘
                               │ ParsedAnalogSpec
                               │
                    ┌──────────▼──────────┐
                    │ SVACheckerGenerator  │
                    │ (SVA 检查器生成器)    │
                    │  → 时序断言          │
                    │  → 真值表断言        │
                    │  → Bind 封装         │
                    └──────────┬──────────┘
                               │
                     ┌─────────▼─────────┐
                     │  checkers.sv       │
                     │  bind_checkers.sv  │
                     └───────────────────┘


                    ┌─────────────────────┐
                    │   HSPICE 网表文件     │
                    │  (serdes-ctle.sp)    │
                    └──────────┬──────────┘
                               │
                    ┌──────────▼──────────┐
                    │    HSPICEParser      │
                    │  (HSPICE 解析器)     │
                    │  → 器件实例          │
                    │  → .SUBCKT 层级      │
                    │  → .MODEL / .PARAM   │
                    └──────────┬──────────┘
                               │ SPICENetlist
                               │
                    ┌──────────▼──────────┐
                    │  HSPICEFlattener     │
                    │  (层级展开器)         │
                    │  → 递归展平子电路     │
                    │  → 参数传播          │
                    └──────────┬──────────┘
                               │ FlattenedNetlist
                               │
                    ┌──────────▼──────────┐
                    │ CircuitGraphBuilder  │
                    │ (电路图构建器)        │
                    │  → CIR 中间表示      │
                    │  → 信号分类          │
                    │  → 电源/地识别       │
                    └──────────┬──────────┘
                               │
                    ┌──────────▼──────────┐
                    │ TopologyRecognizer   │
                    │  (拓扑识别器)        │
                    │  → 差分对识别        │
                    │  → 电流镜识别        │
                    │  → VCO 拓扑         │
                    │  → CML 拓扑         │
                    │  → CTLE 拓扑        │
                    └──────────┬──────────┘
                               │ IdentifiedBlock[]
                               │
                    ┌──────────▼──────────┐
                    │  StructuralMapper    │
                    │  (结构映射器)         │
                    │  → 器件→原语映射     │
                    └──────────┬──────────┘
                               │
                    ┌──────────▼──────────┐
                    │  PrimitiveLibrary    │
                    │  (原语库)            │
                    │  → VCO/CDR/CTLE/DFE │
                    │  → TX Driver/SerDes  │
                    └──────────┬──────────┘
                               │
                    ┌──────────▼──────────┐
                    │  SVModelGenerator    │
                    │  (SV 模型生成器)     │
                    │  → SystemVerilog 代码│
                    └──────────┬──────────┘
                               │
                     ┌─────────▼─────────┐
                     │  serdes_phy_model.sv│
                     └───────────────────┘
```

---

## 流水线详解

### Phase 0: SPICE 解析

**`HSPICEParser`** 将 HSPICE 网表文本解析为结构化 AST (`SPICENetlist`)：

| 特性 | 支持 |
|------|------|
| 器件类型 | M (MOSFET), R, C, L, D, Q, X, V, I, E, G, F, H, B |
| 层次化 | `.SUBCKT` / `.ENDS` 嵌套 |
| 参数 | `.PARAM`, 行内参数, 模型参数 |
| 模型卡 | `.MODEL` (nmos, pmos, npn, res, cap 等) |
| 控制语句 | `.TRAN`, `.AC`, `.DC`, `.MEAS`, `.OPTIONS` |
| 续行 | `+` 续行符 |
| 注释 | `$` 行内注释, `*` 行注释 |
| SI 后缀 | f/p/n/u/m/k/meg/g/t |

**`HSPICEFlattener`** 递归展开 `.SUBCKT` 层级，将子电路内的器件通过实例前缀重命名（如 `XCTLE.M1`）并传播参数覆盖，生成单层网表 (`FlattenedNetlist`)。

### Phase 1: 电路中间表示 (CIR)

**`CircuitGraphBuilder`** 将扁平网表转换为电路图中间表示 (`CIRCircuit`)：

- 构建器件节点和网线 (node) 的连通图
- 信号自动分类：`supply`, `ground`, `clock`, `analog`, `digital`, `bias`
- 电源/地自动识别：`VDD`/`VCC`/`VSS`/`GND` 等
- 端口方向推断

CIR 是连接 SPICE 解析和模型生成的核心桥梁，确保后续阶段不依赖 SPICE 语法细节。

### Phase 2: 拓扑识别

**`TopologyRecognizer`** 以插件化方式运行多个 Pattern Detector：

| 检测器 | 功能 | 文件 |
|--------|------|------|
| `detectDifferentialPairs` | 识别差分对（共源级、尾电流源、负载） | `differential-pair.ts` |
| `detectCurrentMirrors` | 识别电流镜（基本型、共源共栅型） | `current-mirror.ts` |
| `detectVCO` | 识别环形振荡器和 LC 振荡器拓扑 | `vco-topology.ts` |
| `detectCMLTopologies` | 识别 CML 驱动器、锁存器、缓冲器 | `cml-topology.ts` |
| `detectCTLE` | 识别源极退化差分对 CTLE 结构 | `ctle-topology.ts` |

每个检测器返回 `IdentifiedBlock[]`，包含：
- 块类型（`BlockType`：涵盖 36+ 种 SerDes 子电路类型）
- 置信度评分 (0-1)
- 提取的关键参数
- 是否包含反馈回路

**扩展方式**：实现 `PatternDetector` 接口 (`(cir: CIRCircuit) => IdentifiedBlock[]`) 并注册到 `DETECTORS` 列表即可。

### Phase 3: 原语库

**`PrimitiveLibraryRegistry`** 管理预定义的 SystemVerilog 原语模型：

| 原语 | 用途 | 行为类型 |
|------|------|----------|
| `vco_model` | 压控振荡器，含相位噪声建模 | behavioral |
| `cdr_model` | 时钟数据恢复（bang-bang 型） | event_driven |
| `ctle_model` | 连续时间线性均衡器（CTLE） | behavioral |
| `dfe_model` | 判决反馈均衡器（含 LMS 自适应） | mixed |
| `tx_driver` | 差分 TX 驱动器，可编程摆幅 | mixed |
| `serializer` | 并行转串行 (P2S) | structural |
| `deserializer` | 串行转并行 (S2P) | structural |

每个原语包含：
- SV 端口定义（`logic`, `real`, `wreal` 类型）
- 参数化接口（支持不同速率/工艺角配置）
- 内嵌的 SystemVerilog 模板代码
- 多仿真器兼容性注释（VCS / Xcelium / Questa / Verilator）

### Phase 4: 结构映射 + SV 代码生成

**`StructuralMapper`** 将 CIR 器件映射到原语实例（当前按器件类型映射）。

**`SVModelGenerator`** 将映射结果渲染为 SystemVerilog 代码：
- 生成 `module` 封装
- 端口声明（`real` 用于模拟信号，`logic` 用于数字/时钟信号）
- 参数化接口
- 内部网线声明
- 原语实例化

### Phase 5: 规格解析 + SVA 生成 (并行流水线)

**`MarkdownAnalogSpecParser`** 解析 Markdown 规格文档中的结构化信息：

| 章节 | 产出 |
|------|------|
| `## Interface` | 端口列表（名称、方向、信号类型） |
| `## Timing Constraints` | 时序约束（升降时间、建立保持、锁定时钟等） |
| `## Truth Tables` | 真值表（组合/时序，自动区分输入输出列） |
| `## Operating Conditions` | PVT 工况（工艺角、电压、温度） |
| `## Performance Targets` | 性能目标（数据率、功耗、面积） |

**`SVACheckerGenerator`** 将解析后的规格生成 SVA 断言代码：

| 输入 | SVA 产出 |
|------|----------|
| 时序约束 | `assert property (@(posedge clk) ...)` |
| 真值表 | `assert property (in_cond |-> out_cond)` |
| 绑定关系 | `bind target_module checker_module (.*)` |

支持的系统函数：`$setup`, `$hold`, `$width`, `$rose`, `$fell`, `$stable`, `$changed`, `$realtime`。

---

## 快速开始

### 安装

```bash
git clone <repo-url>
cd AnaModelGen
npm install
npm run build
```

### 运行测试

```bash
npm test
```

测试覆盖：
- HSPICE 解析器（含子电路、续行、注释、SI 后缀）
- 层级展开器
- 电路图构建
- 拓扑识别（差分对、电流镜、CML）
- 规格文档解析
- SVA 生成
- 端到端流水线

### 使用示例

```typescript
import AnaModelGen from 'ana-model-gen';
import * as fs from 'fs';

const gen = new AnaModelGen();

// === 路径一：从 SPICE 生成 SV 行为模型 ===
const spiceSource = fs.readFileSync('serdes-ctle.sp', 'utf-8');
const { svCode, cir, warnings } = gen.generateModel(spiceSource, 'serdes_phy');
console.log(svCode);  // SystemVerilog 行为模型

// 单独查看拓扑分析结果
const { topology, netlist, flattened, cir: cirFull } = gen.parseSPICE(spiceSource, 'serdes_phy');
console.log(`识别到 ${topology.blocks.length} 个模块`);
console.log(`覆盖率: ${(topology.metrics.coverageRatio * 100).toFixed(1)}%`);

// === 路径二：从规格文档生成 SVA 检查器 ===
const specMarkdown = fs.readFileSync('serdes-ctle-spec.md', 'utf-8');
const parsedSpec = gen.parseAnalogSpec(specMarkdown);
const svaResult = gen.generateCheckers(parsedSpec, 'serdes_phy_model');

for (const file of svaResult.files) {
  console.log(`=== ${file.name} ===`);
  console.log(file.content);
}

// === 查看原语库目录 ===
console.log(gen.getPrimitiveCatalog().slice(0, 500));
```

---

## 项目结构

```
AnaModelGen/
├── src/
│   ├── index.ts                          # 主入口 + AnaModelGen 门面类
│   ├── config/
│   │   └── default.ts                    # 全局配置
│   ├── types/
│   │   ├── spice-types.ts                # HSPICE AST 类型
│   │   ├── cir-types.ts                  # 电路中间表示 (CIR) 类型
│   │   ├── analog-spec-types.ts          # 模拟规格文档类型
│   │   ├── primitive-types.ts            # 原语库类型
│   │   └── sva-types.ts                  # SVA 断言类型
│   ├── parsers/
│   │   ├── spice/
│   │   │   ├── hspice-parser.ts          # HSPICE 网表解析器
│   │   │   └── hspice-flattener.ts       # HSPICE 层级展开器
│   │   └── analog-spec/
│   │       └── markdown-spec-parser.ts   # Markdown 规格解析器
│   ├── cir/
│   │   └── circuit-graph.ts              # 电路图构建器
│   ├── recognition/
│   │   ├── topology-recognizer.ts        # 拓扑识别器（核心）
│   │   └── patterns/
│   │       ├── differential-pair.ts      # 差分对检测
│   │       ├── current-mirror.ts         # 电流镜检测
│   │       ├── vco-topology.ts           # VCO 检测
│   │       ├── cml-topology.ts           # CML 检测
│   │       └── ctle-topology.ts          # CTLE 检测
│   ├── primitives/
│   │   └── primitive-registry.ts         # 原语库注册器 + SV 模板
│   └── generators/
│       ├── sv-model/
│       │   ├── structural-mapper.ts      # 结构映射器
│       │   └── sv-model-generator.ts     # SV 代码生成器
│       └── sva-checker/
│           └── sva-checker-generator.ts  # SVA 检查器生成器
├── tests/
│   ├── analog-modeling.test.ts           # 集成测试
│   └── fixtures/
│       ├── serdes-ctle.sp                # CTLE HSPICE 网表夹具
│       └── serdes-ctle-spec.md           # CTLE Markdown 规格夹具
├── tsconfig.json
├── jest.config.js
├── package.json
└── README.md
```

---

## 配置

通过 `AnaModelGenConfig` 控制模型生成行为：

```typescript
interface AnaModelGenConfig {
  modelFidelity: 'functional' | 'behavioral' | 'structural';
  svaCompat: 'vcs' | 'xcelium' | 'questa' | 'multi';
  svaSeverity: 'error' | 'warning' | 'info';
}
```

| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| `modelFidelity` | `functional` | 模型保真度：功能级/行为级/结构级 |
| `svaCompat` | `multi` | SVA 兼容模式 |
| `svaSeverity` | `error` | 断言失败严重级别 |

---

## 与业界方案的对比

| 维度 | 纯手工建模 | 商业 EDA (XMODEL/Liberate) | AnaModelGen |
|------|-----------|---------------------------|-------------|
| 建模速度 | 2-4 周 | 1-3 天 (需额外配置) | 毫秒级 |
| 人力投入 | 高 | 中 (需工艺库准备) | 低 |
| 精度 | 取决于工程师 | 高 (基于仿真特征化) | 功能级/行为级 |
| SVA 生成 | 完全手动 | 不支持 | 自动从规格文档生成 |
| 拓扑识别 | N/A | 不支持 | 5+ 种 SerDes 拓扑 |
| 真值表→断言 | 手动 | 不支持 | 自动 |
| 规格变更追踪 | 人工比对 | N/A | 重新解析即可 |
| 开源 | N/A | 否 | ✅ MIT |
| 多仿真器 | 需手动调整 | 绑定特定工具链 | VCS/Xcelium/Questa |
| 学习成本 | 高 | 高 | 低 (TypeScript API) |

---

## 路线图

- [x] HSPICE 网表解析器 (含 .SUBCKT / .MODEL / .PARAM)
- [x] 电路层级展开器
- [x] CIR 电路中间表示
- [x] 拓扑识别框架 + 5 种 Pattern Detector
- [x] 原语库 (VCO/CDR/CTLE/DFE/TX Driver/Serializer/Deserializer)
- [x] SV 行为模型代码生成器
- [x] Markdown 规格解析器
- [x] SVA 断言生成器
- [ ] Primitive 映射增强 (更多器件类型→原语映射)
- [ ] 支持更多 SPICE 方言 (Spectre, PSpice)
- [ ] 波形驱动的特征化提取 (自动参数提取)
- [ ] 支持 YAML/JSON 规格输入
- [ ] Verilog-AMS 输出格式支持
- [ ] SVA 覆盖率驱动的拓扑验证
- [ ] VSCode 扩展 (语法高亮、模型预览)

---

## 许可证

MIT

---

*AnaModelGen — Analog Model Generation for Digital Verification*
