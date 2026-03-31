# fxdemo1

飞象 Circuit Lab Demo。

项目目标：

`用户上传任意电路图物理题图片 -> 识别电路结构与关键元件 -> 生成可交互、可调参的模拟电路实验页面`

当前仓库已经包含两部分能力：

- 固定题目 `题目1 / 题目2 / 题目3` 的高保真交互实验
- 上传题目页的图片解析、结构化中间态生成、拓扑校验与 SVG 渲染

## 当前状态

- 上传页当前固定使用 `GPT-5.4`
- 上传后的电路图会经过服务端标准化，再进入前端渲染
- 已补强上传页的关键参数展示，不再显示渲染层内部元数据
- 已加入更稳的上游超时、重试与错误映射
- 已加入导线折线路径收敛，减少不必要的“多次拐弯”
- 题目 `1/2/3` 的既有交互实验继续保留，不再作为上传页的改动目标

## 技术架构

整体链路：

`image -> parser prompt -> scene json -> scene normalizer -> SVG renderer -> interaction layer`

主要模块：

- `server.js`
  - 本地静态资源服务
  - `/api/health`
  - `/api/parse-circuit`

- `lib/circuit-parser.js`
  - 调用 OpenAI Responses API
  - 构造解析 prompt / repair prompt
  - 解析模型输出并提取 JSON
  - 超时、重试、错误映射

- `lib/scene-document.js`
  - 统一 scene document 结构
  - 组件 / 导线 / 标签 / primitives 标准化

- `lib/scene-normalizer.js`
  - 服务端几何修正
  - 端点吸附、导线归并、元件锚点修正
  - 解决部分导线断裂、错位、走线绕行问题

- `upload-v2.js`
  - 上传页主逻辑
  - 图片上传、请求解析、scene 预处理、关键参数面板、上传页 SVG 渲染

- `app.js`
  - 固定题目 `1/2/3` 页面逻辑与交互

- `styles.css`
  - 全站样式
  - 包括主实验页与上传页 UI

## 本地运行

### 1. 环境要求

- Node.js 18+

### 2. 配置 `.env`

示例：

```env
OPENAI_API_KEY=your_api_key
OPENAI_BASE_URL=https://api.yunxicode.online
OPENAI_MODEL=gpt-5.4
OPENAI_PARSE_MODE=quality
OPENAI_REASONING_EFFORT=low
OPENAI_IMAGE_DETAIL=high
OPENAI_PARSE_REPAIR_PASS=true
```

### 3. 启动服务

```powershell
node server.js
```

### 4. 访问页面

```text
http://localhost:8080
```

## 上传页设计原则

上传页不是“等效电路求解器”，而是“原题电路图复刻器”。

当前策略重点是：

- 尽量保留原图拓扑关系
- 尽量保留原图布局比例和连接位置
- 关键导线先保证连通，再优化视觉路径
- 关键参数面板优先展示实验语义信息
  - 开关
  - 电流表
  - 电压表
  - 滑动变阻器
  - 电源
  - 定值电阻
  - 灯泡

## 已解决的问题

- `No JSON object found in model response`
  - 通过加强 JSON 提取与二次严格提示重试缓解

- 低频 `failed fetch`
  - 已区分本地服务不可达与上游模型连接不稳两类错误
  - 服务端已加入超时和重试

- 上传页导线“折来折去”
  - 已加入折线收敛逻辑，优先收敛为更简单的直角路径

- 上传页画布偏小
  - 已收紧 render view box padding，并放大上传页渲染区域

- 上传页关键参数无物理意义
  - 已改为基于识别到的实验元件与测量信息生成

## 当前限制

- 上传页的 1:1 复刻已经能跑通，但仍然不是对所有教材图都完全稳定
- 模型输出质量仍会影响：
  - 组件 bbox
  - 导线端点
  - 分支关系
  - 标签位置
- 某些复杂教材图仍需要进一步做模板化 normalizer

## 后续建议

- 继续强化 scene schema，而不是单纯继续堆 prompt
- 为常见教材电路建立模板化修正层
- 将“识别”和“精修”进一步拆开
- 针对滑动变阻器、多支路、表计跨接这类结构继续补强规则

## Git 说明

- 本仓库可能存在未跟踪测试图片或用户本地文件，请提交前自行确认
- 不要把明文 API Key 提交到公开仓库
