# fxdemo1

飞象老师笔试 Demo。

目标不是“生成一个等效电路”，而是：

`用户上传任意电路图物理题图片 -> 大模型识别元件/走线/标注 -> 输出结构化中间态 -> 前端 1:1 复刻为可交互 HTML/SVG 电路图`

当前仓库处于“方案已跑通一半，但上传题目链路仍未达到可交付”的状态。题目 1/2/3 的固定 Demo 可以正常展示和交互；真正困难集中在“上传题目”的真实识别与高还原复刻。

## 当前实现

- 固定题目页：
  - `题目1 / 题目2 / 题目3` 仍然保留为手工实现的高保真交互 Demo
  - 题目 2、题目 3 的开关默认状态已改为“断开”
- 上传题目页：
  - 本地 `Node` 服务代理第三方 `OpenAI Responses API`
  - 图片上传后调用多模态模型识别，返回 `scene json`
  - 前端根据 `scene json` 渲染 SVG 电路图
  - 支持开关 toggle、滑片 range 等基础交互
  - 已加入加载状态与“生成成功 / 生成失败”提示
- 当前额外尝试：
  - 增加了上传页专用的 `upload-final.js`
  - 尝试在“模型输出 -> 前端渲染”之间加一层几何/拓扑修正
  - 针对 `test3` 这类“定值电阻 + 滑动变阻器 + 电压表 + 电源 + 开关”的教材图，尝试做模板化中间态重建

## 运行方式

项目根目录放置 `.env`，运行时自动读取：

```text
OPENAI_API_KEY=...
OPENAI_BASE_URL=https://api.yunxicode.online
OPENAI_MODEL=gpt-5.4
OPENAI_REASONING_EFFORT=low
OPENAI_PARSE_REPAIR_PASS=true
```

启动本地服务：

```powershell
node server.js
```

访问：

```text
http://localhost:8080
```

## 主要文件

- `server.js`
  - 静态资源服务
  - `/api/parse-circuit` 接口代理
- `lib/circuit-parser.js`
  - 第三方 Responses API 调用
  - prompt 构造
  - 一次解析 + repair pass
  - 输出标准化 `scene`
- `app.js`
  - 固定题目 1/2/3 的页面与交互
- `upload.js`
  - 上传题目页的历史实现
  - 这个文件已经积累了多轮覆盖式修改，内部存在多套重复定义
- `upload-final.js`
  - 当前新增的“上传页最终覆盖层”
  - 目的是不再继续直接污染 `upload.js`
  - 负责上传页最终 UI 文案、渲染覆盖、以及部分 scene 规范化
- `styles.css`
  - 页面样式
- `docs/circuit-scene.example.json`
  - 更理想的中间态 schema 参考
- `scripts/test-samples.js`
  - 调用解析链路批量生成样本 scene

## 当前中间态设计

当前真正的设计目标已经不是：

`image -> 直接生成 svg`

而是：

`image -> raw scene -> topology/geometry normalizer -> interactive svg`

现有 `scene` 关键结构：

- `components`
  - 元件类型、bbox、anchors、params、interactive、primitives
- `wires`
  - from / to / polyline route
- `labels`
  - OCR 文本及归属元件
- `simulation`
  - adjustables / measurements / highlights

已经明确的结论是：只靠一个粗糙的 `scene`，前端直接渲染，无法稳定做到教材图的 1:1 复刻。必须在中间加一层“拓扑 + 几何”规范化。

## 已确认的核心问题

### 1. 根因不在渲染，而在“中间态太弱”

上传题目失败的主要原因不是 SVG 画法不够精细，而是模型输出的 `scene` 本身就有这些问题：

- 元件识别对了，但锚点错了
- 支路数量对了，但连接关系错了
- 识别成了“等效电路”而不是原图拓扑
- 电路线端点没有严格落在真实节点上
- 元件 bbox、label、wire route 彼此不一致

所以页面上看到的“断线、重叠、错位”，本质上是前端把一个逻辑上已经有问题的中间态画出来了。

### 2. `test3` 的真实根因已经定位

`test3` 总是生成不好，不是随机问题，而是一个稳定结构性问题：

- 模型把滑动变阻器当成了“普通二端电阻 + 一根装饰箭头”
- 但教材图中的滑动变阻器是“三端结构”
- 真正接入电路的是“左端 + 滑片 tap”，不是“左端 + 右端”

如果中间态仍然使用：

- `left`
- `right`
- `slider`

而不显式区分：

- `body_left`
- `body_right`
- `tap`

那么最终渲染几乎必然会出现：

- 滑片接线错误
- 右侧导线接错端
- 顶部短线断开
- 滑片移动时导线不跟着动

### 3. `upload.js` 已经非常脏

`upload.js` 内部存在多次重复覆盖：

- `renderUploadScene`
- `renderUploadPage`
- `renderSceneComponent`
- `renderSceneLabel`
- `parseUploadedFile`

文件后面的定义会覆盖前面的定义，导致：

- 很难判断当前线上真正生效的是哪一版
- 一次小改动可能意外回滚之前的行为
- 中文文案、fallback 渲染、交互状态很容易互相打架

所以本次没有继续直接整理 `upload.js`，而是新增了 `upload-final.js` 作为最后一层覆盖。

## 这次 session 做过的关键尝试

### 已做

- 保留了题目 1/2/3 的固定交互 Demo，不再让用户额外上传这三题
- 把题目 2、题目 3 的开关默认改为“断开”
- 增加上传页加载态与成功提示
- 将上传页文案统一为中文
- 新增 `upload-final.js`，不再继续在 `upload.js` 上叠加历史逻辑
- 为上传页增加一层新的场景规范化逻辑
- 对 `test3` 增加了模板识别与模板化重建尝试

### 已验证但结论不理想

- 降低推理强度可以提升速度，但不能根治结构错误
- `service_tier = fast` 在当前三方 provider 上基本无效
- `gpt-5.4-instant` 当前 provider 不可用
- 继续“改 prompt”很容易带来识别风格漂移，用户明确要求不要再靠 prompt hack

### 这次新增但还未成功闭环的内容

- `upload-final.js` 中已经加入：
  - 通用 `scene` 几何修正
  - `test3` 模板识别
  - 滑动变阻器 `tap` 建模
  - 上传页最终渲染覆盖
- 但用户反馈最终页面效果仍然“不行”，说明当前模板重建和前端最终呈现之间，仍然没有达到可接受质量

## 当前最难的点

### 难点 1：教材图不是“电学求解图”，而是“版式图”

用户要的是“1:1 原图复刻”，不是“电路求解正确即可”。

这意味着必须同时满足：

- 元件识别正确
- 连接关系正确
- 版式位置正确
- 导线拐点正确
- 标注位置基本一致
- 开关、滑片、电表符号视觉样式接近教材

任何一个环节偷懒，最后看起来都会像“乱了”。

### 难点 2：只用通用 LLM 直接产出高质量 scene，不稳定

模型可以理解“这是什么电路”，但不稳定的点在于：

- 对 anchor 的精确坐标把握不稳定
- 对导线 route 的精确复刻不稳定
- 对滑动变阻器、开关、电表这种教材符号的拓扑语义不稳定

所以最终一定要把 pipeline 改成：

- vision 识别
- raw scene
- rule-based / template-based normalizer
- renderer

而不是让大模型一个步骤全包。

### 难点 3：需要模板库，而不是一个万能 prompt

目前看，最靠谱的方向不是继续提示模型“更仔细一些”，而是建立“教材常见电路模板库”，例如：

- 双导轨并联支路
- 单回路串联 + 电压表跨接
- 多开关矩形网络
- 滑动变阻器串联接法
- 滑动变阻器分压接法

识别阶段输出“粗 scene + 模板候选”，再由 normalizer 重建成稳定布局。

## 推荐的重启方向

下一个 session 最好不要直接在当前上传页上继续修 UI 细节，而是按下面顺序重建：

### 第一优先级

- 先把 `upload.js` / `upload-final.js` 的实际生效链路理清
- 明确只保留一套上传页渲染入口
- 停止多层重复覆盖

### 第二优先级

- 重做中间态 schema
- 对滑动变阻器明确建模：
  - `body_left`
  - `body_right`
  - `tap`
  - `track`
  - `handle`
  - `connection_mode`

### 第三优先级

- 为常见教材图建立模板 normalizer
- 至少优先支持：
  - `test2` 的多开关矩形图
  - `test3` 的串联滑动变阻器图

### 第四优先级

- normalizer 输出“干净、确定”的 scene
- 前端只负责渲染，不再承担纠错责任

## 对下一个 AI 的直接提醒

- 不要再继续堆 prompt
- 不要再把 `test3` 当成“普通 variable_resistor + decorative arrow”
- 不要继续在 `upload.js` 中追加第 N 套覆盖实现
- 先把“图片 -> 中间态 -> 拓扑修正 -> UI”拆清楚
- 如果要快速出效果，优先做“模板识别 + 模板重建”，而不是通用大一统方案

## Git 状态说明

当前仓库不是一个干净工作树，已经存在较多改动和未跟踪文件。

本次会提交一个文档整理 commit，方便重启 session 后继续接手。出于安全考虑，不会把 `.env` 中的明文 API key 提交进 git。
