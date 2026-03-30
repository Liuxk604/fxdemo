const fs = require("node:fs/promises");
const path = require("node:path");
const { loadEnvFile } = require("./load-env");

const DEFAULT_BASE_URL = "https://api.yunxicode.online";
const DEFAULT_MODEL = "gpt-5.4";
const DEFAULT_PARSE_MODE = "fast";

loadEnvFile();

function parseBooleanEnv(value, fallback = false) {
  if (value == null || value === "") return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function getEnvConfig() {
  return {
    apiKey: process.env.OPENAI_API_KEY || "",
    baseUrl: (process.env.OPENAI_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, ""),
    model: process.env.OPENAI_MODEL || DEFAULT_MODEL,
    serviceTier: process.env.OPENAI_SERVICE_TIER || "",
    parseMode: process.env.OPENAI_PARSE_MODE || DEFAULT_PARSE_MODE,
    reasoningEffort: process.env.OPENAI_REASONING_EFFORT || "",
    imageDetail: process.env.OPENAI_IMAGE_DETAIL || "",
    repairPass: process.env.OPENAI_PARSE_REPAIR_PASS
  };
}

function getMimeType(fileName) {
  const ext = path.extname(fileName).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  return "application/octet-stream";
}

function readPngSize(buffer) {
  if (buffer.length < 24) throw new Error("Failed to read PNG dimensions");
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20)
  };
}

function readJpegSize(buffer) {
  let offset = 2;
  while (offset < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }

    const marker = buffer[offset + 1];
    const blockLength = buffer.readUInt16BE(offset + 2);
    const isSizeMarker = [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker);
    if (isSizeMarker) {
      return {
        height: buffer.readUInt16BE(offset + 5),
        width: buffer.readUInt16BE(offset + 7)
      };
    }
    offset += 2 + blockLength;
  }
  throw new Error("Failed to read JPEG dimensions");
}

function getImageMetaFromBuffer(buffer, fileName = "") {
  const ext = path.extname(fileName).toLowerCase();
  if (ext === ".png" || buffer.slice(0, 8).toString("hex") === "89504e470d0a1a0a") {
    return readPngSize(buffer);
  }
  if (ext === ".jpg" || ext === ".jpeg" || (buffer[0] === 0xff && buffer[1] === 0xd8)) {
    return readJpegSize(buffer);
  }
  throw new Error("Unsupported image format");
}

async function fileToDataPayload(filePath) {
  const buffer = await fs.readFile(filePath);
  const fileName = path.basename(filePath);
  const mimeType = getMimeType(fileName);
  const { width, height } = getImageMetaFromBuffer(buffer, fileName);

  return {
    fileName,
    mimeType,
    width,
    height,
    byteLength: buffer.length,
    imageDataUrl: `data:${mimeType};base64,${buffer.toString("base64")}`
  };
}

function buildPrompt(meta) {
  const schema = {
    version: "1.0",
    title: "Question title",
    summary: "One sentence summary of the circuit and interaction",
    source: {
      file_name: meta.fileName,
      mime_type: meta.mimeType,
      image_width: meta.width,
      image_height: meta.height
    },
    canvas: {
      view_box: [0, 0, meta.width, meta.height],
      unit: "px"
    },
    components: [
      {
        id: "switch_1",
        type: "switch",
        label: "S",
        bbox: [0, 0, 0, 0],
        center: { x: 0, y: 0 },
        rotation: 0,
        anchors: {
          left: { x: 0, y: 0 },
          right: { x: 0, y: 0 }
        },
        params: {
          closed: false
        },
        interactive: {
          kind: "toggle_switch",
          pivot: { x: 0, y: 0 },
          contact: { x: 0, y: 0 },
          open_tip: { x: 0, y: 0 }
        },
        primitives: [
          {
            type: "line",
            x1: 0,
            y1: 0,
            x2: 0,
            y2: 0,
            stroke: "#1f2e2b",
            stroke_width: 4
          }
        ],
        confidence: 0.95
      }
    ],
    wires: [
      {
        id: "wire_1",
        from: "switch_1.left",
        to: "battery_1.positive",
        route: {
          kind: "polyline",
          points: [{ x: 0, y: 0 }, { x: 0, y: 0 }]
        },
        style: {
          color: "#1f2e2b",
          width: 4.5
        },
        current_candidate: true,
        confidence: 0.95
      }
    ],
    junctions: [
      {
        id: "junction_1",
        x: 0,
        y: 0,
        kind: "connected_dot",
        radius: 4.2
      }
    ],
    labels: [
      {
        id: "label_1",
        text: "S",
        position: { x: 0, y: 0 },
        font_size: 20,
        rotation: 0,
        text_anchor: "middle",
        belongs_to: "switch_1"
      }
    ],
    simulation: {
      summary: "How to interact with the circuit",
      adjustables: [
        {
          id: "adj_switch_1",
          label: "Switch",
          type: "toggle",
          component_id: "switch_1",
          param: "closed",
          initial: false
        }
      ],
      measurements: [
        {
          id: "m_1",
          label: "Battery voltage",
          unit: "V",
          expr: "switch_1_closed ? battery_1_voltage_v : 0",
          description: "Optional measurement"
        }
      ],
      highlights: [
        {
          id: "highlight_1",
          when: "switch_1_closed",
          wire_ids: ["wire_1"],
          component_ids: ["switch_1"]
        }
      ]
    }
  };

  return [
    "You are a high-precision multimodal parser for middle-school physics circuit diagrams.",
    "Your job is to convert the uploaded image into a scene JSON that can reconstruct the ORIGINAL circuit drawing as closely as possible.",
    "",
    "Hard requirements:",
    "1. Preserve the original topology and original visual layout. Do NOT simplify into an equivalent circuit.",
    "2. Use the original image pixel coordinate system. Every coordinate must live in that system.",
    "3. Keep wire routes close to the real drawn path. Prefer more segments over oversimplification. Do not reroute wires to make the drawing cleaner.",
    "4. Detect common components when visible: battery, switch, lamp, resistor, variable_resistor, ammeter, voltmeter.",
    "5. Include all visible labels that belong to the circuit drawing.",
    "6. For each component, provide non-empty primitives whenever possible so the front-end can draw the same symbol geometry.",
    "7. If a switch is open, provide pivot/contact/open_tip. If a variable resistor exists, provide slider, handle, or track geometry.",
    "8. Only use simulation.adjustables for real interactive parts such as switches and sliders. Adjustable types must be toggle or range.",
    "9. simulation.measurements.expr must be a plain expression using variable names, numbers, booleans, operators, and parentheses only.",
    "10. Variable naming rule for expressions: replace hyphens in component id with underscores, then append param name. Example: switch_1_closed, battery_1_voltage_v.",
    "11. If a value is unknown, leave params empty or omit the measurement. Do not invent fake measurements.",
    "12. Make sure every open switch, battery plate, meter circle, resistor box, branch rail, and junction matches the picture location instead of a clean schematic redraw.",
    "13. Return valid JSON only. No markdown. No commentary.",
    "",
    `Image size: ${meta.width} x ${meta.height} pixels.`,
    "",
    "Preferred primitive patterns:",
    "- lamp: outer circle + 2 cross lines",
    "- switch: pivot dot + contact dot + lever line",
    "- battery: short plate + long plate",
    "- resistor: rectangular body or the textbook symbol that matches the image",
    "- variable_resistor: resistor body + slider/arrow",
    "- ammeter/voltmeter: circle outline",
    "",
    "JSON schema example:",
    JSON.stringify(schema, null, 2)
  ].join("\n");
}

function buildRepairPrompt(meta, draftScene) {
  return [
    "You are reviewing a draft reconstruction of a physics circuit diagram.",
    "Compare the image to the draft JSON and CORRECT the draft so that it matches the image more faithfully.",
    "",
    "Repair priorities:",
    "1. Fix wrong topology first: missing branches, wrong branch order, wrong battery insertion point, wrong switch placement, wrong meter placement, wrong node connections.",
    "2. Fix geometry second: wire routes, rail positions, component bbox, anchors, label positions, and symbol orientation.",
    "3. Keep the original drawing style from the image. Do NOT tidy or simplify the circuit.",
    "4. Preserve existing ids when possible so the front-end remains stable.",
    "5. If the draft already has good primitives, keep them; otherwise replace them with corrected primitives.",
    "6. For textbook line diagrams, battery plates and switch lever geometry must visually match the source image.",
    "7. Return the full corrected JSON only.",
    "",
    `Image size: ${meta.width} x ${meta.height} pixels.`,
    "",
    "Draft scene JSON to correct:",
    JSON.stringify(draftScene, null, 2)
  ].join("\n");
}

function extractOutputText(apiResponse) {
  const parts = [];
  for (const item of apiResponse.output || []) {
    for (const content of item.content || []) {
      if (content.type === "output_text" && content.text) {
        parts.push(content.text);
      }
    }
  }
  return parts.join("\n").trim();
}

function extractJsonObject(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("No JSON object found in model response");
  }
  return JSON.parse(text.slice(start, end + 1));
}

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

function toNumber(value, fallback = null) {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

function ensurePoint(point, fallbackX = 0, fallbackY = 0) {
  return {
    x: toNumber(point?.x, fallbackX),
    y: toNumber(point?.y, fallbackY)
  };
}

function ensureBBox(bbox) {
  if (!Array.isArray(bbox) || bbox.length !== 4) return [0, 0, 60, 40];
  return [
    toNumber(bbox[0], 0),
    toNumber(bbox[1], 0),
    toNumber(bbox[2], 60),
    toNumber(bbox[3], 40)
  ];
}

function inferCenter(bbox, center) {
  return ensurePoint(center, bbox[0] + bbox[2] / 2, bbox[1] + bbox[3] / 2);
}

function getComponentEndpoints(component) {
  const bbox = ensureBBox(component.bbox);
  const center = inferCenter(bbox, component.center);
  const anchors = component.anchors || {};

  return {
    bbox,
    center,
    left: ensurePoint(anchors.left, bbox[0], center.y),
    right: ensurePoint(anchors.right, bbox[0] + bbox[2], center.y),
    top: ensurePoint(anchors.top, center.x, bbox[1]),
    bottom: ensurePoint(anchors.bottom, center.x, bbox[1] + bbox[3]),
    positive: ensurePoint(anchors.positive, bbox[0] + bbox[2], center.y),
    negative: ensurePoint(anchors.negative, bbox[0], center.y),
    slider: anchors.slider ? ensurePoint(anchors.slider, center.x, center.y) : null
  };
}

function synthesizeLampPrimitives(component) {
  const { center, left, right, bbox } = getComponentEndpoints(component);
  const r = Math.max(10, Math.min(bbox[2], bbox[3]) / 2);
  return [
    { type: "line", x1: left.x, y1: left.y, x2: center.x - r, y2: center.y, stroke_width: 4 },
    { type: "line", x1: center.x + r, y1: center.y, x2: right.x, y2: right.y, stroke_width: 4 },
    { type: "circle", cx: center.x, cy: center.y, r, fill: "#ffffff", stroke_width: 4 },
    { type: "line", x1: center.x - r * 0.58, y1: center.y - r * 0.58, x2: center.x + r * 0.58, y2: center.y + r * 0.58, stroke_width: 3.2 },
    { type: "line", x1: center.x - r * 0.58, y1: center.y + r * 0.58, x2: center.x + r * 0.58, y2: center.y - r * 0.58, stroke_width: 3.2 }
  ];
}

function synthesizeMeterPrimitives(component) {
  const { center, left, right, top, bottom, bbox } = getComponentEndpoints(component);
  const horizontal = Math.abs(right.x - left.x) >= Math.abs(bottom.y - top.y);
  const r = Math.max(12, Math.min(bbox[2], bbox[3]) / 2);
  return horizontal
    ? [
        { type: "line", x1: left.x, y1: left.y, x2: center.x - r, y2: center.y, stroke_width: 4 },
        { type: "line", x1: center.x + r, y1: center.y, x2: right.x, y2: right.y, stroke_width: 4 },
        { type: "circle", cx: center.x, cy: center.y, r, fill: "#ffffff", stroke_width: 4 }
      ]
    : [
        { type: "line", x1: top.x, y1: top.y, x2: center.x, y2: center.y - r, stroke_width: 4 },
        { type: "line", x1: center.x, y1: center.y + r, x2: bottom.x, y2: bottom.y, stroke_width: 4 },
        { type: "circle", cx: center.x, cy: center.y, r, fill: "#ffffff", stroke_width: 4 }
      ];
}

function synthesizeResistorPrimitives(component) {
  const { bbox, left, right, top, bottom } = getComponentEndpoints(component);
  const horizontal = Math.abs(right.x - left.x) >= Math.abs(bottom.y - top.y);
  if (horizontal) {
    const y = (left.y + right.y) / 2;
    return [
      { type: "line", x1: left.x, y1: y, x2: bbox[0], y2: y, stroke_width: 4 },
      { type: "rect", x: bbox[0], y: bbox[1], width: bbox[2], height: bbox[3], rx: 4, fill: "#ffffff", stroke_width: 4 },
      { type: "line", x1: bbox[0] + bbox[2], y1: y, x2: right.x, y2: y, stroke_width: 4 }
    ];
  }
  const x = (top.x + bottom.x) / 2;
  return [
    { type: "line", x1: x, y1: top.y, x2: x, y2: bbox[1], stroke_width: 4 },
    { type: "rect", x: bbox[0], y: bbox[1], width: bbox[2], height: bbox[3], rx: 4, fill: "#ffffff", stroke_width: 4 },
    { type: "line", x1: x, y1: bbox[1] + bbox[3], x2: x, y2: bottom.y, stroke_width: 4 }
  ];
}

function synthesizeVariableResistorPrimitives(component) {
  const primitives = synthesizeResistorPrimitives(component);
  const { bbox, center, slider } = getComponentEndpoints(component);
  const handle = slider || ensurePoint(component.interactive?.handle, bbox[0] + bbox[2] * 0.8, bbox[1] + bbox[3] * 0.3);
  primitives.push(
    { type: "line", x1: handle.x, y1: handle.y, x2: center.x, y2: center.y, stroke_width: 3.6 },
    {
      type: "polyline",
      points: [
        { x: center.x - 8, y: center.y - 14 },
        { x: center.x, y: center.y },
        { x: center.x + 8, y: center.y - 14 }
      ],
      stroke_width: 3.6
    }
  );
  return primitives;
}

function synthesizeBatteryPrimitives(component) {
  const { bbox, center, left, right, top, bottom, positive, negative } = getComponentEndpoints(component);
  const horizontal = Math.abs(right.x - left.x) >= Math.abs(bottom.y - top.y);
  if (horizontal) {
    return [
      { type: "line", x1: left.x, y1: center.y, x2: negative.x, y2: center.y, stroke_width: 4 },
      { type: "line", x1: negative.x, y1: bbox[1] + 8, x2: negative.x, y2: bbox[1] + bbox[3] - 8, stroke_width: 4 },
      { type: "line", x1: positive.x, y1: bbox[1], x2: positive.x, y2: bbox[1] + bbox[3], stroke_width: 4 },
      { type: "line", x1: positive.x, y1: center.y, x2: right.x, y2: center.y, stroke_width: 4 }
    ];
  }
  return [
    { type: "line", x1: center.x, y1: top.y, x2: center.x, y2: negative.y, stroke_width: 4 },
    { type: "line", x1: bbox[0] + 8, y1: negative.y, x2: bbox[0] + bbox[2] - 8, y2: negative.y, stroke_width: 4 },
    { type: "line", x1: bbox[0], y1: positive.y, x2: bbox[0] + bbox[2], y2: positive.y, stroke_width: 4 },
    { type: "line", x1: center.x, y1: positive.y, x2: center.x, y2: bottom.y, stroke_width: 4 }
  ];
}

function synthesizeSwitchPrimitives(component) {
  const { bbox, center, left, right, top, bottom } = getComponentEndpoints(component);
  const pivot = ensurePoint(component.interactive?.pivot, left.x, left.y);
  const contact = ensurePoint(component.interactive?.contact, right.x, right.y);
  const openTip = ensurePoint(component.interactive?.open_tip, contact.x - 18, contact.y - 18);
  const closed = Boolean(component.params?.closed);
  const target = closed ? { x: contact.x - 3, y: contact.y } : openTip;
  const horizontal = Math.abs(contact.x - pivot.x) >= Math.abs(contact.y - pivot.y);
  return horizontal
    ? [
        { type: "line", x1: left.x, y1: pivot.y, x2: pivot.x, y2: pivot.y, stroke_width: 4 },
        { type: "line", x1: contact.x, y1: contact.y, x2: right.x, y2: contact.y, stroke_width: 4 },
        { type: "circle", cx: pivot.x, cy: pivot.y, r: 4.6, fill: "#1f2e2b", stroke_width: 0 },
        { type: "circle", cx: contact.x, cy: contact.y, r: 4.6, fill: "#1f2e2b", stroke_width: 0 },
        { type: "line", x1: pivot.x, y1: pivot.y, x2: target.x, y2: target.y, stroke_width: 4 }
      ]
    : [
        { type: "line", x1: pivot.x, y1: top.y, x2: pivot.x, y2: pivot.y, stroke_width: 4 },
        { type: "line", x1: contact.x, y1: contact.y, x2: contact.x, y2: bottom.y, stroke_width: 4 },
        { type: "circle", cx: pivot.x, cy: pivot.y, r: 4.6, fill: "#1f2e2b", stroke_width: 0 },
        { type: "circle", cx: contact.x, cy: contact.y, r: 4.6, fill: "#1f2e2b", stroke_width: 0 },
        { type: "line", x1: pivot.x, y1: pivot.y, x2: target.x, y2: target.y, stroke_width: 4 }
      ];
}

function synthesizePrimitives(component) {
  if (ensureArray(component.primitives).length) {
    return ensureArray(component.primitives);
  }
  if (component.type === "lamp") return synthesizeLampPrimitives(component);
  if (component.type === "ammeter" || component.type === "voltmeter") return synthesizeMeterPrimitives(component);
  if (component.type === "resistor") return synthesizeResistorPrimitives(component);
  if (component.type === "variable_resistor") return synthesizeVariableResistorPrimitives(component);
  if (component.type === "battery") return synthesizeBatteryPrimitives(component);
  if (component.type === "switch") return synthesizeSwitchPrimitives(component);
  return [];
}

function normalizePrimitive(item) {
  if (!item || typeof item !== "object") return null;

  if (item.type === "line") {
    return {
      type: "line",
      x1: toNumber(item.x1, 0),
      y1: toNumber(item.y1, 0),
      x2: toNumber(item.x2, 0),
      y2: toNumber(item.y2, 0),
      stroke: item.stroke || "#1f2e2b",
      stroke_width: toNumber(item.stroke_width, 4),
      fill: item.fill ?? "none"
    };
  }

  if (item.type === "rect") {
    return {
      type: "rect",
      x: toNumber(item.x, 0),
      y: toNumber(item.y, 0),
      width: toNumber(item.width ?? item.w, 0),
      height: toNumber(item.height ?? item.h, 0),
      rx: toNumber(item.rx, 0),
      stroke: item.stroke || "#1f2e2b",
      stroke_width: toNumber(item.stroke_width, 4),
      fill: item.fill ?? "none"
    };
  }

  if (item.type === "circle") {
    return {
      type: "circle",
      cx: toNumber(item.cx, 0),
      cy: toNumber(item.cy, 0),
      r: toNumber(item.r, 0),
      stroke: item.stroke || "#1f2e2b",
      stroke_width: toNumber(item.stroke_width, 4),
      fill: item.fill ?? "none"
    };
  }

  if (item.type === "polyline" || item.type === "polygon") {
    return {
      type: item.type,
      points: ensureArray(item.points).map((point) => ensurePoint(point, 0, 0)),
      stroke: item.stroke || "#1f2e2b",
      stroke_width: toNumber(item.stroke_width, 4),
      fill: item.fill ?? "none"
    };
  }

  if (item.type === "path") {
    return {
      type: "path",
      d: item.d || "",
      stroke: item.stroke || "#1f2e2b",
      stroke_width: toNumber(item.stroke_width, 4),
      fill: item.fill ?? "none"
    };
  }

  return null;
}

function normalizeAdjustable(item) {
  return {
    ...item,
    type: item.type === "slider" ? "range" : item.type
  };
}

function normalizeJunctionKind(kind) {
  if (!kind) return "connected_dot";
  const value = String(kind).toLowerCase();
  if (value.includes("connected")) return "connected_dot";
  if (value.includes("dot")) return "connected_dot";
  return value;
}

function normalizeScene(scene, meta) {
  const components = ensureArray(scene.components).map((component, index) => {
    const bbox = ensureBBox(component.bbox);
    const center = inferCenter(bbox, component.center);
    const normalized = {
      id: component.id || `component_${index + 1}`,
      type: component.type || "unknown_component",
      label: component.label || "",
      bbox,
      center,
      rotation: toNumber(component.rotation, 0),
      anchors: component.anchors || {},
      params: component.params || {},
      interactive: component.interactive || null,
      primitives: ensureArray(component.primitives).map(normalizePrimitive).filter(Boolean),
      confidence: component.confidence ?? null
    };
    normalized.primitives = synthesizePrimitives(normalized);
    return normalized;
  });

  return {
    version: scene.version || "1.0",
    title: scene.title || meta.fileName,
    summary: scene.summary || "",
    source: {
      file_name: meta.fileName,
      mime_type: meta.mimeType,
      image_width: meta.width,
      image_height: meta.height
    },
    canvas: {
      view_box: scene.canvas?.view_box || [0, 0, meta.width, meta.height],
      unit: scene.canvas?.unit || "px"
    },
    components,
    wires: ensureArray(scene.wires).map((wire, index) => ({
      id: wire.id || `wire_${index + 1}`,
      from: wire.from || null,
      to: wire.to || null,
      route: wire.route || { kind: "polyline", points: [] },
      style: {
        color: wire.style?.color || "#1f2e2b",
        width: toNumber(wire.style?.width, 4.5)
      },
      current_candidate: Boolean(wire.current_candidate),
      confidence: wire.confidence ?? null
    })),
    junctions: ensureArray(scene.junctions).map((junction, index) => ({
      id: junction.id || `junction_${index + 1}`,
      x: toNumber(junction.x, 0),
      y: toNumber(junction.y, 0),
      kind: normalizeJunctionKind(junction.kind),
      radius: toNumber(junction.radius, 4.2)
    })),
    labels: ensureArray(scene.labels).map((label, index) => ({
      id: label.id || `label_${index + 1}`,
      text: label.text || "",
      position: ensurePoint(label.position, 0, 0),
      font_size: toNumber(label.font_size, 18),
      rotation: toNumber(label.rotation, 0),
      text_anchor: label.text_anchor || "middle",
      belongs_to: label.belongs_to || null
    })),
    simulation: {
      summary: scene.simulation?.summary || scene.summary || "",
      adjustables: ensureArray(scene.simulation?.adjustables).map(normalizeAdjustable),
      measurements: ensureArray(scene.simulation?.measurements),
      highlights: ensureArray(scene.simulation?.highlights)
    }
  };
}

function resolveParserOptions(meta) {
  const config = getEnvConfig();
  const parseMode = (typeof meta?.parseMode === "string" && meta.parseMode.trim()) || config.parseMode || DEFAULT_PARSE_MODE;
  const fastMode = String(parseMode).toLowerCase() === "fast";

  return {
    model: (typeof meta?.modelOverride === "string" && meta.modelOverride.trim()) || config.model,
    serviceTier: (typeof meta?.serviceTier === "string" && meta.serviceTier.trim()) || config.serviceTier || "",
    reasoningEffort: (typeof meta?.reasoningEffort === "string" && meta.reasoningEffort.trim()) || config.reasoningEffort || (fastMode ? "low" : "medium"),
    imageDetail: (typeof meta?.imageDetail === "string" && meta.imageDetail.trim()) || config.imageDetail || (fastMode ? "low" : "high"),
    fastMode,
    repairPass: typeof meta?.repairPass === "boolean"
      ? meta.repairPass
      : parseBooleanEnv(config.repairPass, !fastMode)
  };
}

async function callResponsesApi(payload) {
  const config = getEnvConfig();
  if (!config.apiKey) {
    throw new Error("Missing OPENAI_API_KEY in environment");
  }

  const response = await fetch(`${config.baseUrl}/v1/responses`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const responseText = await response.text();
  let parsed;
  try {
    parsed = JSON.parse(responseText);
  } catch {
    throw new Error(`Upstream did not return JSON: ${responseText.slice(0, 200)}`);
  }

  if (!response.ok) {
    throw new Error(parsed?.error?.message || "Upstream parse request failed");
  }

  return parsed;
}

async function requestSceneJson(meta, prompt, options) {
  const apiResponse = await callResponsesApi({
    model: options.model,
    store: false,
    service_tier: options.serviceTier || undefined,
    reasoning: options.reasoningEffort ? { effort: options.reasoningEffort } : undefined,
    instructions: "You are a precise multimodal parser for physics circuit diagrams. Return valid JSON only.",
    text: {
      verbosity: options.fastMode ? "low" : "medium"
    },
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: prompt
          },
          {
            type: "input_image",
            image_url: meta.imageDataUrl,
            detail: options.imageDetail
          }
        ]
      }
    ]
  });

  const text = extractOutputText(apiResponse);
  return {
    scene: extractJsonObject(text),
    usage: apiResponse.usage || null,
    rawText: text
  };
}

function mergeUsage(primary, secondary) {
  if (!primary && !secondary) return null;
  return {
    input_tokens: (primary?.input_tokens || 0) + (secondary?.input_tokens || 0),
    output_tokens: (primary?.output_tokens || 0) + (secondary?.output_tokens || 0),
    total_tokens: (primary?.total_tokens || 0) + (secondary?.total_tokens || 0)
  };
}

async function parseCircuitImage(meta) {
  const options = resolveParserOptions(meta);
  const firstPass = await requestSceneJson(meta, buildPrompt(meta), options);
  const repairedPass = options.repairPass
    ? await requestSceneJson(meta, buildRepairPrompt(meta, firstPass.scene), options)
    : null;
  const sourceScene = repairedPass?.scene || firstPass.scene;
  const finalScene = normalizeScene(sourceScene, meta);
  return {
    scene: finalScene,
    usage: mergeUsage(firstPass.usage, repairedPass?.usage || null),
    rawText: repairedPass?.rawText || firstPass.rawText
  };
}

module.exports = {
  fileToDataPayload,
  getImageMetaFromBuffer,
  parseCircuitImage
};
