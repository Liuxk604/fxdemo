# 电路题 1:1 复刻方案

## 目标

最终目标不是“识别成某个模板”，而是：

1. 用户上传任意电路图物理题图片
2. 通过三方多模态 API 识别元件、文字、节点和走线
3. 输出一份可机读的中间表示
4. 在前端 1:1 复刻出原题电路图
5. 同时生成可交互、可调参、可讲解的模拟实验

这要求中间层同时满足两类需求：

- 语义正确：知道电路怎么连、参数是什么、哪些元件可调
- 视觉正确：知道原题里每条线怎么拐、元件怎么摆、文字写在哪

所以不能只用“纯 netlist”，也不能只用“纯 SVG”。需要一套混合表示。

## 结论

推荐使用三层结构：

1. `vision layer`
   原始视觉识别结果。保存检测框、OCR、线段、置信度、裁剪图证据。
2. `scene layer`
   面向 1:1 复刻的绘图层。保存画布、元件视觉位置、锚点、走线折点、标签位置、样式。
3. `simulation layer`
   面向交互求解的电路语义层。保存节点、连接关系、元件参数、测量对象、可调参数、求解公式。

前端渲染以 `scene layer` 为主，交互计算以 `simulation layer` 为主，排障与人工校验以 `vision layer` 为主。

## 为什么单一 JSON 不够

如果只保留这种结构：

```json
{
  "components": ["battery", "switch", "lamp"],
  "connections": [["battery+", "lamp.a"], ["lamp.b", "switch.a"]]
}
```

它只能告诉你“谁和谁连接”，不能告诉你：

- 原题的导线是直线、折线还是回环
- 电压表画在支路左边还是右边
- 滑动变阻器的滑片是竖着还是横着
- 电源正负极长短线具体落在哪
- 题目中的文字标注在哪里
- 是否存在“等效电路图”和“原图画法”不一致

而“1:1 复刻”恰恰需要这些信息。

所以建议使用：

- 主文件：`scene.json`
- 可选辅文件：`overlay.svg`

其中：

- `scene.json` 负责结构化语义和大多数几何信息
- `overlay.svg` 负责高保真路径细节、特殊手绘符号、暂时无法规范化的装饰细节

如果项目想先只保留一个文件，也可以把 SVG path 数据嵌入 `scene.json` 的 `drawing` 字段里。

## 推荐中间协议

一个题目输出一个 `CircuitSceneDocument`：

```text
source image
  -> vision.json
  -> scene.json
  -> optional overlay.svg
```

其中 `scene.json` 是核心。

## scene.json 顶层结构

```json
{
  "version": "1.0",
  "document_id": "problem_001",
  "source": {},
  "canvas": {},
  "vision": {},
  "components": [],
  "wires": [],
  "junctions": [],
  "labels": [],
  "netlist": {},
  "simulation": {},
  "interaction": {},
  "rendering": {},
  "validation": {}
}
```

### 1. source

保存原图信息。

关键字段：

- `file_name`
- `mime_type`
- `image_width`
- `image_height`
- `upload_time`
- `problem_text`

### 2. canvas

定义前端 1:1 复刻所使用的基准坐标系。

关键字段：

- `view_box`
- `unit`
- `background`
- `original_aspect_ratio`

建议前端统一在原图像素坐标系上渲染。也就是题图是 `1180x1430`，画布就直接用 `0 0 1180 1430`。

这样最容易做 1:1 复刻。

### 3. vision

保存多模态模型的原始识别结果和证据，不直接参与渲染，但用于复核。

关键字段：

- `ocr_blocks`
- `component_detections`
- `wire_segments`
- `confidence`
- `issues`
- `evidence_crops`

这个层必须保留。因为模型识别错时，后续才能知道是 OCR 错、元件分类错，还是连线跟踪错。

### 4. components

保存每个元件的视觉信息和语义信息。

每个元件至少包含：

- `id`
- `type`
- `bbox`
- `center`
- `rotation`
- `symbol_variant`
- `anchors`
- `params`
- `label_refs`
- `style`
- `sim_ref`

#### type 建议枚举

- `battery`
- `cell`
- `switch`
- `lamp`
- `resistor`
- `variable_resistor`
- `ammeter`
- `voltmeter`
- `capacitor`
- `inductor`
- `rheostat_slider`
- `ground`
- `fuse`
- `unknown_component`

#### anchors 的意义

元件连接不应该只靠 bbox 推断，必须明确端点锚点。

例如：

```json
{
  "anchors": {
    "left": { "x": 120, "y": 210 },
    "right": { "x": 220, "y": 210 }
  }
}
```

对于电表、灯泡、开关、滑动变阻器，都要定义锚点。

### 5. wires

这是 1:1 复刻的核心。

每条导线不能只存“连到谁”，必须存“怎么画过去”。

每条导线建议包含：

- `id`
- `from`
- `to`
- `net_id`
- `route`
- `stroke`
- `topology_role`

其中 `route` 必须支持：

- `polyline`
- `path`
- `arc`

推荐格式：

```json
{
  "route": {
    "kind": "polyline",
    "points": [
      { "x": 120, "y": 210 },
      { "x": 120, "y": 120 },
      { "x": 300, "y": 120 }
    ]
  }
}
```

对于复杂题图，还要允许：

```json
{
  "route": {
    "kind": "svg_path",
    "d": "M120 210 L120 120 Q120 100 140 100 L300 100"
  }
}
```

这就是为什么光有连接关系不够。

### 6. junctions

保存节点圆点、分叉点、交叉不连接点。

建议区分：

- `connected_dot`
- `cross_without_join`
- `terminal_marker`

否则前端无法准确复刻“交叉但不相连”和“交叉且相连”的差别。

### 7. labels

保存所有文字，如：

- `L1`
- `R1`
- `S`
- `V`
- `A`
- `3V`
- `0.5A`
- 题目要求文字

字段建议：

- `id`
- `text`
- `bbox`
- `position`
- `font_size`
- `rotation`
- `belongs_to`

### 8. netlist

这是语义电路层，不关心线怎么画，只关心电怎么连。

关键字段：

- `nodes`
- `edges`
- `component_refs`

示意：

```json
{
  "nodes": [
    { "id": "n1" },
    { "id": "n2" },
    { "id": "n3" }
  ],
  "edges": [
    { "component_id": "battery_1", "from_node": "n1", "to_node": "n2" },
    { "component_id": "lamp_1", "from_node": "n2", "to_node": "n3" }
  ]
}
```

### 9. simulation

定义可调参数、可测量量、初始值和求解目标。

关键字段：

- `adjustables`
- `measurements`
- `initial_state`
- `constraints`
- `solver_hint`

例如：

- 开关是否闭合
- 滑片位置
- 电源电压
- 电阻阻值
- 电压表显示哪个元件两端电压

### 10. interaction

定义 UI 层控制映射。

例如：

- 点击某个开关元件时切换 `switch_1.closed`
- 拖动滑片时更新 `rheostat_1.slider_ratio`
- hover 某个支路时高亮其 net

### 11. rendering

定义渲染策略。

关键字段：

- `prefer_symbol_library`
- `prefer_original_geometry`
- `fallback_overlay_svg`
- `z_order`

这里用来决定：

- 优先用标准元件库重绘
- 还是优先用模型产出的原始 path 复刻

### 12. validation

保存质量检查结果。

关键字段：

- `topology_consistent`
- `all_components_connected`
- `ocr_verified`
- `manual_review_required`

## 核心设计原则

### 原则 1：语义图和视觉图分开

必须允许“同一个电路语义”对应“不同画法”。

例如串联电路：

- 语义层只关心 A 连 B、B 连 C
- 视觉层要保留导线是上绕、下绕、横向还是纵向

### 原则 2：每个元件必须同时有 visual id 和 simulation id

例如：

- `components[i].id = "resistor_1"`
- `components[i].sim_ref = "R1"`

前者给 UI 找对象，后者给求解器找对象。

### 原则 3：导线要存几何路径，不只存节点关系

这是 1:1 复刻最关键的一条。

### 原则 4：必须保留不确定性

模型难免会把：

- 电流表识别成电压表
- 交叉线识别成相连
- 滑片位置识别偏

所以每个核心对象都建议带：

- `confidence`
- `source`
- `evidence_ref`

## 推荐处理链路

### 第一步：视觉解析

用三方多模态 API 做首轮识别，输出：

- 元件列表
- OCR 文本
- 线段/路径
- 连接点候选
- 置信度

输出到 `vision` 层。

### 第二步：拓扑构图

本地程序根据以下信息构图：

- 元件锚点
- 线段交点
- OCR 标签
- 圆点连接标记

得到：

- `junctions`
- `wires`
- `netlist`

### 第三步：仿真建模

把以下元件映射到统一求解模型：

- 电阻、灯泡、电源、开关、电压表、电流表、滑动变阻器

得到：

- `simulation.adjustables`
- `simulation.measurements`
- `simulation.initial_state`

### 第四步：前端复刻

前端分两层渲染：

1. `background/original overlay`
   用于高保真贴近原题视觉
2. `interactive circuit layer`
   用于点击、拖动、高亮、电流动画、参数联动

如果识别质量高，直接根据 `scene` 重绘。
如果某些元件视觉形状不稳定，就把该元件原始 path 作为 `overlay.svg` 贴上去。

## 建议的文件产物

一次识别完成后，服务端建议输出：

```text
/jobs/{jobId}/
  source.png
  vision.json
  scene.json
  overlay.svg
  debug.png
```

其中：

- `scene.json` 给正式前端使用
- `overlay.svg` 给高保真复刻使用
- `debug.png` 给人工校验使用

## 前端怎么消费

前端建议不要直接吃“模型原始文本回答”，而是只吃规范化产物：

1. 拉取 `scene.json`
2. 先渲染 `rendering.fallback_overlay_svg` 或标准元件库
3. 再根据 `components`、`wires`、`labels` 绘制交互层
4. 再根据 `simulation` 绑定控件和求解逻辑

## 最小可行版本

第一阶段只支持：

- 电源
- 开关
- 灯泡
- 电阻
- 滑动变阻器
- 电压表
- 电流表
- 串联 / 并联 / 混联

但协议一开始就按通用格式设计，不要写死题型模板。

## 不建议的做法

### 不要只做模板分类

这只能做演示，无法支撑“任意电路图”。

### 不要只输出 netlist

这无法 1:1 复刻。

### 不要直接让前端解析模型自然语言

这会造成字段不稳定、难排错、难迭代。

## 实施建议

建议工程上拆成四个模块：

1. `vision-adapter`
   调三方多模态 API，拿原始识别结果
2. `scene-normalizer`
   把模型结果规范化成 `scene.json`
3. `circuit-solver`
   根据 `netlist + simulation` 求解
4. `scene-renderer`
   根据 `scene.json + overlay.svg` 1:1 绘制和交互

如果后续继续做，我建议下一步不是继续手写题型，而是先把：

- `scene.json` 协议
- `overlay.svg` 兜底机制
- `scene-renderer` 的输入输出边界

先定死。
