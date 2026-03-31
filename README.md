# fxdemo1

飞象 Circuit Lab 演示项目。

本项目面向中学物理电学场景，目标是将电路图题目转化为可交互、可调参、可演示的数字化电路实验页面。

## 项目简介

系统支持两类使用方式：

- 固定题目实验
  - 内置 `题目1 / 题目2 / 题目3` 三个高保真交互示例
- 上传题目实验
  - 用户上传电路图题目图片
  - 服务端解析图像并生成结构化 `scene`
  - 前端将 `scene` 渲染为可交互电路图界面

## 核心能力

- 电路图图片解析
- 电路元件识别
- 结构化中间态生成
- 服务端几何标准化与拓扑修正
- SVG 电路图渲染
- 开关、滑动变阻器等交互控制
- 关键参数面板展示

## 产品特点

- 目标不是生成“等效电路图”，而是尽量贴近原题版式进行交互复刻
- 上传页与固定题目页采用统一的实验界面风格
- 上传链路包含错误处理、超时控制与重试机制
- 对导线走向、元件锚点、参数提取做了专门优化

## 技术架构

整体流程如下：

```text
image -> parser prompt -> scene json -> scene normalizer -> SVG renderer -> interaction layer
```

### 主要模块

- `server.js`
  - 本地静态资源服务
  - 健康检查接口
  - 上传解析接口 `/api/parse-circuit`

- `lib/circuit-parser.js`
  - 负责调用多模态模型
  - 构造解析与修复 prompt
  - 提取并校验模型输出 JSON

- `lib/scene-document.js`
  - 统一 scene 数据结构
  - 规范组件、导线、标签和 primitives

- `lib/scene-normalizer.js`
  - 服务端几何修正
  - 锚点吸附、导线归并、连接修正

- `upload-v2.js`
  - 上传页主逻辑
  - 图片上传、结果请求、上传页渲染与交互

- `app.js`
  - 固定题目实验页逻辑

- `styles.css`
  - 全站样式与实验页 UI

## 本地运行

### 环境要求

- Node.js 18 或以上

### 环境变量

项目根目录放置 `.env` 文件：

```env
OPENAI_API_KEY=your_api_key
OPENAI_BASE_URL=https://api.yunxicode.online
OPENAI_MODEL=gpt-5.4
OPENAI_PARSE_MODE=quality
OPENAI_REASONING_EFFORT=low
OPENAI_IMAGE_DETAIL=high
OPENAI_PARSE_REPAIR_PASS=true
```

### 启动服务

```powershell
node server.js
```

### 访问地址

```text
http://localhost:8080
```

## 目录结构

```text
fxdemo1/
├─ app.js
├─ upload-v2.js
├─ styles.css
├─ server.js
├─ index.html
├─ lib/
│  ├─ circuit-parser.js
│  ├─ scene-document.js
│  └─ scene-normalizer.js
├─ public/
├─ test/
└─ README.md
```

## 上传实验

上传页当前固定使用 `GPT-5.4` 进行图像解析与结构化生成。

上传结果会经过两层处理：

- 模型输出原始 `scene`
- 服务端进行标准化与几何修正，再返回前端渲染

关键参数面板优先展示实验语义信息，例如：

- 开关状态
- 电流表
- 电压表
- 滑动变阻器
- 电源
- 定值电阻
- 灯泡

## 固定题目实验

仓库内置的 `题目1 / 题目2 / 题目3` 为高保真交互样例，用于展示：

- 电路图交互表现
- 电流路径高亮
- 参数变化反馈
- 实验页面整体 UI / UX

## 接口

### `GET /api/health`

返回服务健康状态。

### `POST /api/parse-circuit`

输入图片数据并返回解析后的 `scene` 结果。

请求体包含：

- `fileName`
- `mimeType`
- `width`
- `height`
- `byteLength`
- `imageDataUrl`

## License

本仓库用于演示与开发验证。
