function createUploadState() {
  return {
    file: null,
    fileName: "",
    fileSize: 0,
    previewUrl: "",
    loading: false,
    error: "",
    successMessage: "",
    scene: null,
    usage: null,
    interaction: {}
  };
}

state.upload = state.upload || createUploadState();

const baseRenderPreviewCard = renderPreviewCard;

function escapeUploadHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatUploadBytes(bytes) {
  if (!bytes) return "0 KB";
  if (bytes >= 1024 * 1024) return `${format(bytes / (1024 * 1024), 2)} MB`;
  return `${format(bytes / 1024, 0)} KB`;
}

function readUploadFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("图片读取失败"));
    reader.readAsDataURL(file);
  });
}

function loadUploadImageMeta(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({
      width: img.naturalWidth,
      height: img.naturalHeight
    });
    img.onerror = () => reject(new Error("图片尺寸读取失败"));
    img.src = url;
  });
}

async function uploadFileToPayload(file) {
  const imageDataUrl = await readUploadFileAsDataUrl(file);
  const meta = await loadUploadImageMeta(imageDataUrl);
  return {
    fileName: file.name,
    mimeType: file.type || "image/*",
    width: meta.width,
    height: meta.height,
    imageDataUrl,
    byteLength: file.size
  };
}

function resetUploadState(keepPreview = true) {
  const snapshot = keepPreview ? {
    file: state.upload.file,
    fileName: state.upload.fileName,
    fileSize: state.upload.fileSize,
    previewUrl: state.upload.previewUrl
  } : {};

  state.upload = {
    ...createUploadState(),
    ...snapshot
  };
}

function normalizeAdjustableType(type) {
  return type === "slider" ? "range" : type;
}

function createSceneInteractionState(scene) {
  const next = {};
  (scene?.simulation?.adjustables || []).forEach((item) => {
    const key = `${item.component_id}.${item.param}`;
    const component = (scene.components || []).find((entry) => entry.id === item.component_id);
    const fallback = component?.params?.[item.param];
    const initial = item.initial ?? fallback;
    const type = normalizeAdjustableType(item.type);

    if (type === "toggle") {
      next[key] = Boolean(initial);
      return;
    }

    if (type === "range") {
      const min = Number(item.min ?? 0);
      const max = Number(item.max ?? 1);
      next[key] = clamp(Number(initial ?? min), min, max);
    }
  });
  return next;
}

function getSceneInteractiveValue(componentId, param, fallback) {
  const key = `${componentId}.${param}`;
  return Object.prototype.hasOwnProperty.call(state.upload.interaction, key)
    ? state.upload.interaction[key]
    : fallback;
}

function getResolvedSceneComponent(component) {
  const params = { ...(component.params || {}) };
  Object.entries(state.upload.interaction || {}).forEach(([key, value]) => {
    if (!key.startsWith(`${component.id}.`)) return;
    params[key.slice(component.id.length + 1)] = value;
  });
  return { ...component, params };
}

function flattenSceneValue(target, prefix, value) {
  if (value == null) return;
  if (typeof value === "number" || typeof value === "boolean") {
    target[prefix] = value;
    return;
  }
  if (typeof value !== "object" || Array.isArray(value)) return;
  Object.entries(value).forEach(([key, child]) => {
    flattenSceneValue(target, `${prefix}_${key}`, child);
  });
}

function buildSceneContext(scene) {
  const context = {};
  (scene?.components || []).forEach((component) => {
    const current = getResolvedSceneComponent(component);
    const prefix = current.id.replace(/-/g, "_");
    flattenSceneValue(context, prefix, current.params || {});

    if (current.type === "variable_resistor") {
      const min = Number(current.params?.resistance_min_ohm ?? current.params?.min_ohm ?? 0);
      const max = Number(current.params?.resistance_max_ohm ?? current.params?.max_ohm ?? min);
      const ratio = Number(
        current.params?.slider_ratio ??
        current.params?.slider_position ??
        current.params?.position ??
        current.params?.slider ??
        current.params?.value_ratio ??
        0
      );
      if (Number.isFinite(min) && Number.isFinite(max)) {
        context[`${prefix}_resistance_ohm`] = min + (max - min) * ratio;
      }
    }
  });
  return context;
}

function evaluateSceneExpression(expression, context) {
  if (!expression) return null;
  const trimmed = String(expression).trim();
  if (!trimmed || !/^[\w\s.+\-*/%()?:<>=!&|,]+$/.test(trimmed)) return null;

  try {
    const keys = Object.keys(context);
    const fn = new Function(...keys, `return (${trimmed});`);
    return fn(...keys.map((key) => context[key]));
  } catch {
    return null;
  }
}

function getSceneHighlights(scene) {
  const active = {
    wires: new Set(),
    components: new Set()
  };
  const context = buildSceneContext(scene);

  (scene?.simulation?.highlights || []).forEach((highlight) => {
    const matched = highlight.when ? evaluateSceneExpression(highlight.when, context) : true;
    if (!matched) return;
    (highlight.wire_ids || []).forEach((id) => active.wires.add(id));
    (highlight.component_ids || []).forEach((id) => active.components.add(id));
  });

  return active;
}

function getComponentAdjustables(scene, componentId) {
  return (scene?.simulation?.adjustables || []).filter((item) => item.component_id === componentId);
}

function hasComponentInteractionChanged(scene, component) {
  return getComponentAdjustables(scene, component.id).some((item) => {
    const key = `${item.component_id}.${item.param}`;
    if (!Object.prototype.hasOwnProperty.call(state.upload.interaction, key)) return false;
    const original = item.initial ?? component.params?.[item.param];
    return state.upload.interaction[key] !== original;
  });
}

function renderScenePrimitive(item, extraClass = "") {
  const stroke = item.stroke || "#1f2e2b";
  const fill = item.fill ?? "none";
  const strokeWidth = item.stroke_width ?? 2.8;
  const classes = ["scene-primitive", extraClass, item.class_name || ""].filter(Boolean).join(" ");

  if (item.type === "line") {
    return `<line class="${classes}" x1="${item.x1}" y1="${item.y1}" x2="${item.x2}" y2="${item.y2}" stroke="${stroke}" stroke-width="${strokeWidth}" />`;
  }
  if (item.type === "rect") {
    return `<rect class="${classes}" x="${item.x}" y="${item.y}" width="${item.width ?? item.w}" height="${item.height ?? item.h}" rx="${item.rx ?? 0}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}" />`;
  }
  if (item.type === "circle") {
    return `<circle class="${classes}" cx="${item.cx}" cy="${item.cy}" r="${item.r}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}" />`;
  }
  if (item.type === "polyline") {
    const points = (item.points || []).map((point) => `${point.x},${point.y}`).join(" ");
    return `<polyline class="${classes}" points="${points}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" />`;
  }
  if (item.type === "polygon") {
    const points = (item.points || []).map((point) => `${point.x},${point.y}`).join(" ");
    return `<polygon class="${classes}" points="${points}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" />`;
  }
  if (item.type === "path") {
    return `<path class="${classes}" d="${item.d}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" />`;
  }
  return "";
}

function inferSceneEndpoints(component, bbox, center) {
  const anchors = component.anchors || {};
  const left = anchors.left || anchors.negative || { x: bbox[0], y: center.y };
  const right = anchors.right || anchors.positive || { x: bbox[0] + bbox[2], y: center.y };
  const top = anchors.top || { x: center.x, y: bbox[1] };
  const bottom = anchors.bottom || { x: center.x, y: bbox[1] + bbox[3] };
  return { left, right, top, bottom };
}

function renderFallbackLamp(component, cls, bbox, center, endpoints) {
  const r = Math.max(10, Math.min(bbox[2], bbox[3]) / 2);
  return `
    <g class="${cls}">
      <line x1="${endpoints.left.x}" y1="${endpoints.left.y}" x2="${center.x - r}" y2="${center.y}" class="scene-line"></line>
      <line x1="${center.x + r}" y1="${center.y}" x2="${endpoints.right.x}" y2="${endpoints.right.y}" class="scene-line"></line>
      <circle cx="${center.x}" cy="${center.y}" r="${r + 10}" class="scene-glow"></circle>
      <circle cx="${center.x}" cy="${center.y}" r="${r}" class="scene-shell"></circle>
      <line x1="${center.x - r * 0.58}" y1="${center.y - r * 0.58}" x2="${center.x + r * 0.58}" y2="${center.y + r * 0.58}" class="scene-line"></line>
      <line x1="${center.x - r * 0.58}" y1="${center.y + r * 0.58}" x2="${center.x + r * 0.58}" y2="${center.y - r * 0.58}" class="scene-line"></line>
    </g>
  `;
}

function renderFallbackMeter(component, cls, bbox, center, endpoints) {
  const label = escapeUploadHtml(component.label || (component.type === "ammeter" ? "A" : "V"));
  const r = Math.max(12, Math.min(bbox[2], bbox[3]) / 2);
  const horizontal = Math.abs(endpoints.right.x - endpoints.left.x) >= Math.abs(endpoints.bottom.y - endpoints.top.y);

  return `
    <g class="${cls}">
      ${horizontal
        ? `
          <line x1="${endpoints.left.x}" y1="${endpoints.left.y}" x2="${center.x - r}" y2="${center.y}" class="scene-line"></line>
          <line x1="${center.x + r}" y1="${center.y}" x2="${endpoints.right.x}" y2="${endpoints.right.y}" class="scene-line"></line>
        `
        : `
          <line x1="${endpoints.top.x}" y1="${endpoints.top.y}" x2="${center.x}" y2="${center.y - r}" class="scene-line"></line>
          <line x1="${center.x}" y1="${center.y + r}" x2="${endpoints.bottom.x}" y2="${endpoints.bottom.y}" class="scene-line"></line>
        `}
      <circle cx="${center.x}" cy="${center.y}" r="${r}" class="scene-shell"></circle>
      <text x="${center.x}" y="${center.y + 6}" text-anchor="middle" class="scene-inline-label">${label}</text>
    </g>
  `;
}

function renderFallbackResistor(component, cls, bbox, endpoints) {
  const horizontal = Math.abs(endpoints.right.x - endpoints.left.x) >= Math.abs(endpoints.bottom.y - endpoints.top.y);

  if (horizontal) {
    const y = (endpoints.left.y + endpoints.right.y) / 2;
    return `
      <g class="${cls}">
        <line x1="${endpoints.left.x}" y1="${y}" x2="${bbox[0]}" y2="${y}" class="scene-line"></line>
        <rect x="${bbox[0]}" y="${bbox[1]}" width="${bbox[2]}" height="${bbox[3]}" rx="4" class="scene-shell"></rect>
        <line x1="${bbox[0] + bbox[2]}" y1="${y}" x2="${endpoints.right.x}" y2="${y}" class="scene-line"></line>
      </g>
    `;
  }

  const x = (endpoints.top.x + endpoints.bottom.x) / 2;
  return `
    <g class="${cls}">
      <line x1="${x}" y1="${endpoints.top.y}" x2="${x}" y2="${bbox[1]}" class="scene-line"></line>
      <rect x="${bbox[0]}" y="${bbox[1]}" width="${bbox[2]}" height="${bbox[3]}" rx="4" class="scene-shell"></rect>
      <line x1="${x}" y1="${bbox[1] + bbox[3]}" x2="${x}" y2="${endpoints.bottom.y}" class="scene-line"></line>
    </g>
  `;
}

function renderFallbackVariableResistor(component, cls, bbox, endpoints) {
  const track = component.interactive?.track || component.interactive?.slider || null;
  const ratio = clamp(Number(
    component.params?.slider_ratio ??
    component.params?.slider_position ??
    component.params?.position ??
    component.params?.slider ??
    component.params?.value_ratio ??
    0.5
  ), 0, 1);

  let slider;
  if (track && Number.isFinite(track.x1) && Number.isFinite(track.y1) && Number.isFinite(track.x2) && Number.isFinite(track.y2)) {
    slider = {
      x: track.x1 + (track.x2 - track.x1) * ratio,
      y: track.y1 + (track.y2 - track.y1) * ratio
    };
  } else if (component.interactive?.handle) {
    slider = component.interactive.handle;
  } else {
    const horizontal = Math.abs(endpoints.right.x - endpoints.left.x) >= Math.abs(endpoints.bottom.y - endpoints.top.y);
    slider = horizontal
      ? { x: bbox[0] + bbox[2] * ratio, y: bbox[1] - 18 }
      : { x: bbox[0] + bbox[2] + 18, y: bbox[1] + bbox[3] * ratio };
  }

  const center = { x: bbox[0] + bbox[2] / 2, y: bbox[1] + bbox[3] / 2 };
  return `
    ${renderFallbackResistor(component, cls, bbox, endpoints)}
    <g class="${cls}">
      <line x1="${slider.x}" y1="${slider.y}" x2="${center.x}" y2="${center.y}" class="scene-line"></line>
      <polygon points="${center.x},${center.y} ${center.x - 8},${center.y - 14} ${center.x + 8},${center.y - 14}" class="scene-arrow"></polygon>
    </g>
  `;
}

function renderFallbackBattery(component, cls, bbox, center, endpoints) {
  const positive = component.anchors?.positive || endpoints.right;
  const negative = component.anchors?.negative || endpoints.left;
  const horizontal = Math.abs(positive.x - negative.x) >= Math.abs(positive.y - negative.y);

  if (horizontal) {
    return `
      <g class="${cls}">
        <line x1="${endpoints.left.x}" y1="${center.y}" x2="${negative.x}" y2="${center.y}" class="scene-line"></line>
        <line x1="${negative.x}" y1="${bbox[1] + 8}" x2="${negative.x}" y2="${bbox[1] + bbox[3] - 8}" class="scene-line"></line>
        <line x1="${positive.x}" y1="${bbox[1]}" x2="${positive.x}" y2="${bbox[1] + bbox[3]}" class="scene-line"></line>
        <line x1="${positive.x}" y1="${center.y}" x2="${endpoints.right.x}" y2="${center.y}" class="scene-line"></line>
      </g>
    `;
  }

  return `
    <g class="${cls}">
      <line x1="${center.x}" y1="${endpoints.top.y}" x2="${center.x}" y2="${negative.y}" class="scene-line"></line>
      <line x1="${bbox[0] + 8}" y1="${negative.y}" x2="${bbox[0] + bbox[2] - 8}" y2="${negative.y}" class="scene-line"></line>
      <line x1="${bbox[0]}" y1="${positive.y}" x2="${bbox[0] + bbox[2]}" y2="${positive.y}" class="scene-line"></line>
      <line x1="${center.x}" y1="${positive.y}" x2="${center.x}" y2="${endpoints.bottom.y}" class="scene-line"></line>
    </g>
  `;
}

function renderFallbackSwitch(component, cls, bbox, center, endpoints) {
  const closed = Boolean(component.params?.closed);
  const pivot = component.interactive?.pivot || endpoints.left;
  const contact = component.interactive?.contact || endpoints.right;
  const openTip = component.interactive?.open_tip || { x: contact.x - 16, y: contact.y - 16 };
  const target = closed ? { x: contact.x - 3, y: contact.y } : openTip;
  const horizontal = Math.abs(contact.x - pivot.x) >= Math.abs(contact.y - pivot.y);

  return `
    <g class="${cls}">
      ${horizontal
        ? `
          <line x1="${endpoints.left.x}" y1="${pivot.y}" x2="${pivot.x}" y2="${pivot.y}" class="scene-line"></line>
          <line x1="${contact.x}" y1="${contact.y}" x2="${endpoints.right.x}" y2="${contact.y}" class="scene-line"></line>
        `
        : `
          <line x1="${contact.x}" y1="${endpoints.top.y}" x2="${contact.x}" y2="${contact.y}" class="scene-line"></line>
          <line x1="${pivot.x}" y1="${pivot.y}" x2="${pivot.x}" y2="${endpoints.bottom.y}" class="scene-line"></line>
        `}
      <circle cx="${pivot.x}" cy="${pivot.y}" r="4.6" class="scene-node ${closed ? "scene-node--live" : ""}"></circle>
      <circle cx="${contact.x}" cy="${contact.y}" r="4.6" class="scene-node ${closed ? "scene-node--live" : ""}"></circle>
      <line x1="${pivot.x}" y1="${pivot.y}" x2="${target.x}" y2="${target.y}" class="scene-line"></line>
    </g>
  `;
}

function renderSceneFallbackComponent(component, active) {
  const current = getResolvedSceneComponent(component);
  const bbox = current.bbox || [0, 0, 60, 40];
  const center = current.center || { x: bbox[0] + bbox[2] / 2, y: bbox[1] + bbox[3] / 2 };
  const endpoints = inferSceneEndpoints(current, bbox, center);
  const cls = active ? "scene-component scene-component--active" : "scene-component";

  if (current.type === "lamp") return renderFallbackLamp(current, cls, bbox, center, endpoints);
  if (current.type === "ammeter" || current.type === "voltmeter") return renderFallbackMeter(current, cls, bbox, center, endpoints);
  if (current.type === "resistor") return renderFallbackResistor(current, cls, bbox, endpoints);
  if (current.type === "variable_resistor") return renderFallbackVariableResistor(current, cls, bbox, endpoints);
  if (current.type === "battery") return renderFallbackBattery(current, cls, bbox, center, endpoints);
  if (current.type === "switch") return renderFallbackSwitch(current, cls, bbox, center, endpoints);

  return `<g class="${cls}"><rect x="${bbox[0]}" y="${bbox[1]}" width="${bbox[2]}" height="${bbox[3]}" rx="6" class="scene-shell"></rect></g>`;
}

function renderSceneComponent(scene, component, activeHighlights) {
  const current = getResolvedSceneComponent(component);
  const active = activeHighlights.components.has(current.id);
  const changed = hasComponentInteractionChanged(scene, current);

  if (current.primitives?.length && !changed) {
    return `
      <g class="scene-component ${active ? "scene-component--active" : ""}">
        ${current.primitives.map((item) => renderScenePrimitive(item, active ? "scene-primitive--active" : "")).join("")}
      </g>
    `;
  }

  return renderSceneFallbackComponent(current, active);
}

function getWireComponentId(ref) {
  if (!ref || typeof ref !== "string") return "";
  const index = ref.indexOf(".");
  return index === -1 ? ref : ref.slice(0, index);
}

function shouldSkipWire(scene, wire) {
  const fromId = getWireComponentId(wire.from);
  const toId = getWireComponentId(wire.to);
  if (!fromId || fromId !== toId) return false;
  const component = (scene?.components || []).find((entry) => entry.id === fromId);
  if (!component) return false;
  if (component.type === "switch") return true;

  if (component.type === "variable_resistor") {
    const points = wire.route?.points || [];
    let total = 0;
    for (let index = 1; index < points.length; index += 1) {
      total += Math.abs((points[index]?.x ?? 0) - (points[index - 1]?.x ?? 0));
      total += Math.abs((points[index]?.y ?? 0) - (points[index - 1]?.y ?? 0));
    }
    return total <= 12;
  }

  return false;
}

function renderSceneWire(scene, wire, activeHighlights) {
  if (shouldSkipWire(scene, wire)) return "";

  const active = activeHighlights.wires.has(wire.id);
  const cls = active ? "scene-wire scene-wire--active" : "scene-wire";
  const stroke = wire.style?.color || "#1f2e2b";
  const width = wire.style?.width || 2.8;

  if (wire.route?.kind === "svg_path" && wire.route?.d) {
    return `<path class="${cls}" d="${wire.route.d}" stroke="${stroke}" stroke-width="${width}" />`;
  }

  const points = (wire.route?.points || []).map((point) => `${point.x},${point.y}`).join(" ");
  return `<polyline class="${cls}" points="${points}" stroke="${stroke}" stroke-width="${width}" />`;
}

function renderSceneLabel(label) {
  const fontSize = Number(label.font_size || 18);
  const x = label.position?.x ?? 0;
  const y = label.position?.y ?? 0;
  const rotate = Number(label.rotation || 0);
  const transform = rotate ? ` transform="rotate(${rotate} ${x} ${y})"` : "";
  return `<text x="${x}" y="${y}" text-anchor="${label.text_anchor || "middle"}" font-size="${fontSize}" class="scene-label scene-label--upload"${transform}>${escapeUploadHtml(label.text || "")}</text>`;
}

function renderUploadScene(scene) {
  if (!scene) {
    return `
      <div class="scene-stage scene-stage--upload">
        <div class="upload-empty">
          <div class="upload-empty__icon">+</div>
          <div class="upload-empty__title">上传电路题图片</div>
          <div class="upload-empty__desc">支持 JPG / JPEG / PNG。选择后会自动识别元件、导线和文字，并生成可交互电路图。</div>
        </div>
        ${state.upload.loading ? `
          <div class="upload-loading-mask">
            <div class="upload-spinner"></div>
            <strong>正在生成交互电路图</strong>
            <span>正在识别元件、导线和文字位置，通常需要 20 到 60 秒。</span>
          </div>
        ` : ""}
      </div>
    `;
  }

  const highlights = getSceneHighlights(scene);
  const viewBox = scene.canvas?.view_box || [0, 0, scene.source?.image_width || 1200, scene.source?.image_height || 800];

  return `
    <div class="scene-stage scene-stage--upload">
      <svg viewBox="${viewBox.join(" ")}" aria-label="上传题目电路图">
        ${(scene.wires || []).map((wire) => renderSceneWire(scene, wire, highlights)).join("")}
        ${(scene.junctions || []).map((junction) => {
          const kind = String(junction.kind || "");
          return kind.includes("connected")
            ? `<circle cx="${junction.x}" cy="${junction.y}" r="${junction.radius || 4.2}" class="scene-node scene-node--solid"></circle>`
            : "";
        }).join("")}
        ${(scene.components || []).map((component) => renderSceneComponent(scene, component, highlights)).join("")}
        ${(scene.labels || []).map((label) => renderSceneLabel(label)).join("")}
      </svg>
      ${state.upload.loading ? `
        <div class="upload-loading-mask">
          <div class="upload-spinner"></div>
          <strong>正在生成交互电路图</strong>
          <span>正在识别元件、导线和文字位置，通常需要 20 到 60 秒。</span>
        </div>
      ` : ""}
    </div>
  `;
}

function collectComponentCounts(scene) {
  const counts = {};
  (scene?.components || []).forEach((component) => {
    counts[component.type] = (counts[component.type] || 0) + 1;
  });
  return counts;
}

function summarizeComponents(scene) {
  const counts = collectComponentCounts(scene);
  const labels = {
    battery: "电源",
    switch: "开关",
    lamp: "灯泡",
    resistor: "定值电阻",
    variable_resistor: "滑动变阻器",
    ammeter: "电流表",
    voltmeter: "电压表"
  };

  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([type, count]) => `${labels[type] || type} × ${count}`);
}

function renderUploadStructure(scene) {
  const structureLines = summarizeComponents(scene);
  const adjustables = scene?.simulation?.adjustables || [];

  return `
    <div class="kv-list">
      <div class="kv-item"><span>组件总数</span><strong>${scene?.components?.length || 0}</strong></div>
      <div class="kv-item"><span>导线总数</span><strong>${scene?.wires?.length || 0}</strong></div>
      <div class="kv-item"><span>文字标注</span><strong>${scene?.labels?.length || 0}</strong></div>
      <div class="kv-item"><span>可交互项</span><strong>${adjustables.length}</strong></div>
      <div class="kv-item"><span>识别结构</span><strong>${escapeUploadHtml(structureLines.slice(0, 3).join(" / ") || "暂无")}</strong></div>
    </div>
  `;
}

function renderUploadMeasurements(scene) {
  const measurements = scene?.simulation?.measurements || [];
  if (!measurements.length) {
    const adjustables = scene?.simulation?.adjustables || [];
    if (!adjustables.length) {
      return `
        <ul class="fact-list">
          <li>当前结果以电路结构复刻为主，暂未识别出可调元件。</li>
          <li>如需更高保真度，优先检查开关、滑阻、电源与关键节点是否贴合原图。</li>
        </ul>
      `;
    }

    return `
      <ul class="fact-list">
        ${adjustables.map((item) => `<li>可交互元件：${escapeUploadHtml(item.label || item.component_id)}</li>`).join("")}
      </ul>
    `;
  }

  const context = buildSceneContext(scene);
  return `
    <div class="kv-list">
      ${measurements.map((item) => {
        const value = evaluateSceneExpression(item.expr, context);
        return `<div class="kv-item"><span>${escapeUploadHtml(item.label || item.id)}</span><strong>${value == null ? "--" : `${format(value)}${escapeUploadHtml(item.unit || "")}`}</strong></div>`;
      }).join("")}
    </div>
  `;
}

function renderUploadAdjustables(scene) {
  const adjustables = scene?.simulation?.adjustables || [];
  if (!adjustables.length) {
    return `<div class="hint">当前结果没有返回可调参数，先展示静态复刻结果。</div>`;
  }

  return adjustables.map((item) => {
    const component = (scene.components || []).find((entry) => entry.id === item.component_id);
    const type = normalizeAdjustableType(item.type);
    const value = getSceneInteractiveValue(item.component_id, item.param, component?.params?.[item.param]);
    const label = escapeUploadHtml(item.label || component?.label || item.component_id);

    if (type === "toggle") {
      return `<button class="control-btn ${value ? "control-btn--on" : "control-btn--off"}" data-action="upload-toggle-adjustable" data-component="${item.component_id}" data-param="${item.param}">${label}：${value ? "闭合" : "断开"}</button>`;
    }

    if (type === "range") {
      return `
        <label class="slider-panel">
          <span>${label}：${format(Number(value), 2)}</span>
          <input type="range" min="${item.min ?? 0}" max="${item.max ?? 1}" step="${item.step ?? 0.01}" value="${value ?? item.min ?? 0}" data-action="upload-range-adjustable" data-component="${item.component_id}" data-param="${item.param}" />
        </label>
      `;
    }

    return "";
  }).join("");
}

function buildUploadFooter(scene) {
  if (!scene) {
    return "上传后会自动识别元件、导线和文字，并生成可交互电路图。";
  }

  const structureLines = summarizeComponents(scene);
  const dims = `${scene.source?.image_width || "--"} × ${scene.source?.image_height || "--"}`;
  return `${scene.summary || "已生成一版电路复刻结果。"} 当前识别到 ${scene.components?.length || 0} 个组件、${scene.wires?.length || 0} 条导线，题图尺寸 ${dims}。${structureLines.length ? ` 结构包括：${structureLines.join("、")}。` : ""}`;
}

renderPreviewCard = function renderPreviewCardOverride() {
  if (state.selectedCase !== "upload") {
    return baseRenderPreviewCard();
  }

  if (!state.upload.previewUrl) {
    return `
      <div class="preview-card preview-card--placeholder">
        <div class="preview-card__title">上传题图</div>
        <div class="preview-card__placeholder">等待上传</div>
      </div>
    `;
  }

  return `
    <div class="preview-card">
      <div class="preview-card__title">原始题图</div>
      <img src="${state.upload.previewUrl}" alt="${escapeUploadHtml(state.upload.fileName || "上传题图")}" />
      <div class="preview-card__meta">${escapeUploadHtml(state.upload.fileName)}${state.upload.fileSize ? ` · ${formatUploadBytes(state.upload.fileSize)}` : ""}</div>
    </div>
  `;
};

renderUploadPage = function renderUploadPageOverride() {
  const scene = state.upload.scene;
  const title = scene?.title || "上传题目：通用识别与 1:1 复刻";
  const desc = scene?.summary || "上传任意电路题图片，自动识别元件、导线、节点和文字，生成可交互的 HTML / SVG 电路图。";
  const adjustables = scene?.simulation?.adjustables || [];
  const badges = [
    state.upload.loading ? "状态：生成中" : scene ? "状态：生成成功" : "状态：待上传",
    scene ? `组件：${scene.components?.length || 0}` : "输入：任意题图",
    scene ? `交互：${adjustables.length}` : "模型：gpt-5.4"
  ];

  return {
    title,
    desc,
    badges,
    accentIndex: 2,
    svg: `
      ${state.upload.successMessage ? `<div class="upload-status upload-status--success">${escapeUploadHtml(state.upload.successMessage)}</div>` : ""}
      ${state.upload.error ? `<div class="upload-status upload-status--error">${escapeUploadHtml(state.upload.error)}</div>` : ""}
      ${renderUploadScene(scene)}
    `,
    footerTitle: "生成说明",
    footerDesc: state.upload.loading
      ? "正在调用大模型识别题图，请等待结果返回。"
      : buildUploadFooter(scene),
    parametersTitle: "识别结构",
    parameters: scene ? renderUploadStructure(scene) : `
      <div class="kv-list">
        <div class="kv-item"><span>识别方式</span><strong>题图 -> scene JSON</strong></div>
        <div class="kv-item"><span>输出格式</span><strong>SVG / HTML</strong></div>
        <div class="kv-item"><span>目标</span><strong>1:1 复刻</strong></div>
      </div>
    `,
    lawsTitle: "交互与测量",
    laws: scene ? renderUploadMeasurements(scene) : `
      <ul class="fact-list">
        <li>优先识别电源、开关、电阻、滑阻、电表和关键节点。</li>
        <li>尽量保持原题中的导线走向和相对位置，而不是重画成等效图。</li>
        <li>返回结果支持后续继续增强调参与实验逻辑。</li>
      </ul>
    `,
    controls: `
      <div class="control-stack">
        <input class="hidden-input" id="upload-input" type="file" accept=".jpg,.jpeg,.png,image/jpeg,image/png" />
        <button class="control-btn" data-action="upload-open" ${state.upload.loading ? "disabled" : ""}>${state.upload.loading ? "识别中..." : scene ? "重新上传题图" : "上传题图"}</button>
        ${scene ? renderUploadAdjustables(scene) : `<div class="hint">选择图片后会自动开始识别，不需要再额外点击解析按钮。</div>`}
      </div>
    `
  };
};

async function parseUploadedFile(file) {
  resetUploadState(true);
  state.upload.loading = true;
  state.upload.error = "";
  state.upload.successMessage = "";
  state.upload.file = file;
  state.upload.fileName = file.name;
  state.upload.fileSize = file.size;
  renderApp();

  try {
    const payload = await uploadFileToPayload(file);
    const response = await fetch("/api/parse-circuit", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();
    if (!response.ok || !data.ok) {
      throw new Error(data.error || "生成失败");
    }

    state.upload.scene = data.scene;
    state.upload.usage = data.usage || null;
    state.upload.interaction = createSceneInteractionState(data.scene);
    state.upload.successMessage = "生成成功，已输出可交互电路图。";
  } catch (error) {
    state.upload.error = error.message || "生成失败";
  } finally {
    state.upload.loading = false;
    renderApp();
  }
}

function renderSceneComponent(scene, component, activeHighlights) {
  const current = getResolvedSceneComponent(component);
  const active = activeHighlights.components.has(current.id);
  const changed = hasComponentInteractionChanged(scene, current);
  const forceFallback = current.type === "switch";

  if (current.primitives?.length && !changed && !forceFallback) {
    return `
      <g class="scene-component ${active ? "scene-component--active" : ""}">
        ${current.primitives.map((item) => renderScenePrimitive(item, active ? "scene-primitive--active" : "")).join("")}
      </g>
    `;
  }

  return renderSceneFallbackComponent(current, active);
}

function renderSceneWire(wire, activeHighlights) {
  const active = activeHighlights.wires.has(wire.id);
  const cls = active ? "scene-wire scene-wire--active" : "scene-wire";
  const stroke = wire.style?.color || "#1f2e2b";
  const width = wire.style?.width || 2.8;

  if (wire.route?.kind === "svg_path" && wire.route?.d) {
    return `<path class="${cls}" d="${wire.route.d}" stroke="${stroke}" stroke-width="${width}" />`;
  }

  const points = (wire.route?.points || []).map((point) => `${point.x},${point.y}`).join(" ");
  return `<polyline class="${cls}" points="${points}" stroke="${stroke}" stroke-width="${width}" />`;
}

function renderUploadScene(scene) {
  if (!scene) {
    return `
      <div class="scene-stage scene-stage--upload">
        <div class="upload-empty">
          <div class="upload-empty__icon">+</div>
          <div class="upload-empty__title">上传电路题图片</div>
          <div class="upload-empty__desc">支持 JPG / JPEG / PNG。选择后会自动识别元件、导线和文字，并生成可交互的电路图。</div>
        </div>
        ${state.upload.loading ? `
          <div class="upload-loading-mask">
            <div class="upload-spinner"></div>
            <strong>正在生成交互电路图</strong>
            <span>正在识别元件、导线和文字位置，通常需要 20 到 60 秒。</span>
          </div>
        ` : ""}
      </div>
    `;
  }

  const highlights = getSceneHighlights(scene);
  const viewBox = scene.canvas?.view_box || [0, 0, scene.source?.image_width || 1200, scene.source?.image_height || 800];

  return `
    <div class="scene-stage scene-stage--upload">
      <svg viewBox="${viewBox.join(" ")}" aria-label="上传题目电路图">
        ${(scene.wires || []).map((wire) => renderSceneWire(wire, highlights)).join("")}
        ${(scene.junctions || []).map((junction) => {
          const kind = String(junction.kind || "");
          return kind.includes("connected")
            ? `<circle cx="${junction.x}" cy="${junction.y}" r="${junction.radius || 4.2}" class="scene-node scene-node--solid"></circle>`
            : "";
        }).join("")}
        ${(scene.components || []).map((component) => renderSceneComponent(scene, component, highlights)).join("")}
        ${(scene.labels || []).map((label) => renderSceneLabel(label)).join("")}
      </svg>
      ${state.upload.loading ? `
        <div class="upload-loading-mask">
          <div class="upload-spinner"></div>
          <strong>正在生成交互电路图</strong>
          <span>正在识别元件、导线和文字位置，通常需要 20 到 60 秒。</span>
        </div>
      ` : ""}
    </div>
  `;
}

function summarizeComponents(scene) {
  const counts = collectComponentCounts(scene);
  const labels = {
    battery: "电源",
    switch: "开关",
    lamp: "灯泡",
    resistor: "定值电阻",
    variable_resistor: "滑动变阻器",
    ammeter: "电流表",
    voltmeter: "电压表"
  };

  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([type, count]) => `${labels[type] || type} x ${count}`);
}

function renderUploadStructure(scene) {
  const structureLines = summarizeComponents(scene);
  const adjustables = scene?.simulation?.adjustables || [];

  return `
    <div class="kv-list">
      <div class="kv-item"><span>组件总数</span><strong>${scene?.components?.length || 0}</strong></div>
      <div class="kv-item"><span>导线总数</span><strong>${scene?.wires?.length || 0}</strong></div>
      <div class="kv-item"><span>文字标注</span><strong>${scene?.labels?.length || 0}</strong></div>
      <div class="kv-item"><span>可交互项</span><strong>${adjustables.length}</strong></div>
      <div class="kv-item"><span>识别结构</span><strong>${escapeUploadHtml(structureLines.slice(0, 3).join(" / ") || "暂无")}</strong></div>
    </div>
  `;
}

function renderUploadMeasurements(scene) {
  const measurements = scene?.simulation?.measurements || [];
  if (!measurements.length) {
    const adjustables = scene?.simulation?.adjustables || [];
    if (!adjustables.length) {
      return `
        <ul class="fact-list">
          <li>当前结果以电路结构复刻为主，暂未识别出可调元件。</li>
          <li>如需更高还原度，优先检查开关、滑阻、电源与关键节点是否贴合原图。</li>
        </ul>
      `;
    }

    return `
      <ul class="fact-list">
        ${adjustables.map((item) => `<li>可交互元件：${escapeUploadHtml(item.label || item.component_id)}</li>`).join("")}
      </ul>
    `;
  }

  const context = buildSceneContext(scene);
  return `
    <div class="kv-list">
      ${measurements.map((item) => {
        const value = evaluateSceneExpression(item.expr, context);
        return `<div class="kv-item"><span>${escapeUploadHtml(item.label || item.id)}</span><strong>${value == null ? "--" : `${format(value)}${escapeUploadHtml(item.unit || "")}`}</strong></div>`;
      }).join("")}
    </div>
  `;
}

function renderUploadAdjustables(scene) {
  const adjustables = scene?.simulation?.adjustables || [];
  if (!adjustables.length) {
    return `<div class="hint">当前结果没有返回可调参数，先展示静态复刻结果。</div>`;
  }

  return adjustables.map((item) => {
    const component = (scene.components || []).find((entry) => entry.id === item.component_id);
    const type = normalizeAdjustableType(item.type);
    const value = getSceneInteractiveValue(item.component_id, item.param, component?.params?.[item.param]);
    const label = escapeUploadHtml(item.label || component?.label || item.component_id);

    if (type === "toggle") {
      return `<button class="control-btn ${value ? "control-btn--on" : "control-btn--off"}" data-action="upload-toggle-adjustable" data-component="${item.component_id}" data-param="${item.param}">${label}：${value ? "闭合" : "断开"}</button>`;
    }

    if (type === "range") {
      return `
        <label class="slider-panel">
          <span>${label}：${format(Number(value), 2)}</span>
          <input type="range" min="${item.min ?? 0}" max="${item.max ?? 1}" step="${item.step ?? 0.01}" value="${value ?? item.min ?? 0}" data-action="upload-range-adjustable" data-component="${item.component_id}" data-param="${item.param}" />
        </label>
      `;
    }

    return "";
  }).join("");
}

function buildUploadFooter(scene) {
  if (!scene) {
    return "上传后会自动识别元件、导线和文字，并生成可交互电路图。";
  }

  const structureLines = summarizeComponents(scene);
  const dims = `${scene.source?.image_width || "--"} x ${scene.source?.image_height || "--"}`;
  return `${scene.summary || "已生成一版电路复刻结果。"} 当前识别到 ${scene.components?.length || 0} 个组件、${scene.wires?.length || 0} 条导线，题图尺寸 ${dims}。${structureLines.length ? ` 结构包括：${structureLines.join("，")}。` : ""}`;
}

renderPreviewCard = function renderPreviewCardOverride() {
  if (state.selectedCase !== "upload") {
    return baseRenderPreviewCard();
  }

  if (!state.upload.previewUrl) {
    return `
      <div class="preview-card preview-card--placeholder">
        <div class="preview-card__title">上传题图</div>
        <div class="preview-card__placeholder">等待上传</div>
      </div>
    `;
  }

  return `
    <div class="preview-card">
      <div class="preview-card__title">原始题图</div>
      <img src="${state.upload.previewUrl}" alt="${escapeUploadHtml(state.upload.fileName || "上传题图")}" />
      <div class="preview-card__meta">${escapeUploadHtml(state.upload.fileName)}${state.upload.fileSize ? ` 路 ${formatUploadBytes(state.upload.fileSize)}` : ""}</div>
    </div>
  `;
};

renderUploadPage = function renderUploadPageOverride() {
  const scene = state.upload.scene;
  const title = scene?.title || "上传题目：通用识别与 1:1 复刻";
  const desc = scene?.summary || "上传任意电路题图片，自动识别元件、导线、节点和文字，生成可交互的 HTML / SVG 电路图。";
  const adjustables = scene?.simulation?.adjustables || [];
  const badges = [
    state.upload.loading ? "状态：生成中" : scene ? "状态：生成成功" : "状态：待上传",
    scene ? `组件：${scene.components?.length || 0}` : "输入：任意题图",
    scene ? `交互：${adjustables.length}` : "模型：gpt-5.4"
  ];

  return {
    title,
    desc,
    badges,
    accentIndex: 2,
    svg: `
      ${state.upload.successMessage ? `<div class="upload-status upload-status--success">${escapeUploadHtml(state.upload.successMessage)}</div>` : ""}
      ${state.upload.error ? `<div class="upload-status upload-status--error">${escapeUploadHtml(state.upload.error)}</div>` : ""}
      ${renderUploadScene(scene)}
    `,
    footerTitle: "生成说明",
    footerDesc: state.upload.loading
      ? "正在调用大模型识别题图，请等待结果返回。"
      : buildUploadFooter(scene),
    parametersTitle: "识别结构",
    parameters: scene ? renderUploadStructure(scene) : `
      <div class="kv-list">
        <div class="kv-item"><span>识别方式</span><strong>题图 -> scene JSON</strong></div>
        <div class="kv-item"><span>输出格式</span><strong>SVG / HTML</strong></div>
        <div class="kv-item"><span>目标</span><strong>1:1 复刻</strong></div>
      </div>
    `,
    lawsTitle: "交互与测量",
    laws: scene ? renderUploadMeasurements(scene) : `
      <ul class="fact-list">
        <li>优先识别电源、开关、电阻、滑阻、电表和关键节点。</li>
        <li>尽量保持原题中的导线走向和相对位置，而不是重画成等效图。</li>
        <li>返回结果支持后续继续增强调参与实验逻辑。</li>
      </ul>
    `,
    controls: `
      <div class="control-stack">
        <input class="hidden-input" id="upload-input" type="file" accept=".jpg,.jpeg,.png,image/jpeg,image/png" />
        <button class="control-btn" data-action="upload-open" ${state.upload.loading ? "disabled" : ""}>${state.upload.loading ? "识别中..." : scene ? "重新上传题图" : "上传题图"}</button>
        ${scene ? renderUploadAdjustables(scene) : `<div class="hint">选择图片后会自动开始识别，不需要再额外点击解析按钮。</div>`}
      </div>
    `
  };
};

async function parseUploadedFile(file) {
  resetUploadState(true);
  state.upload.loading = true;
  state.upload.error = "";
  state.upload.successMessage = "";
  state.upload.file = file;
  state.upload.fileName = file.name;
  state.upload.fileSize = file.size;
  renderApp();

  try {
    const payload = await uploadFileToPayload(file);
    const response = await fetch("/api/parse-circuit", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();
    if (!response.ok || !data.ok) {
      throw new Error(data.error || "生成失败");
    }

    state.upload.scene = data.scene;
    state.upload.usage = data.usage || null;
    state.upload.interaction = createSceneInteractionState(data.scene);
    state.upload.successMessage = "生成成功，已输出可交互电路图。";
  } catch (error) {
    state.upload.error = error.message || "生成失败";
  } finally {
    state.upload.loading = false;
    renderApp();
  }
}

app.addEventListener("click", (event) => {
  const actionBtn = event.target.closest("[data-action]");
  if (!actionBtn) return;

  if (actionBtn.dataset.action === "upload-open") {
    const input = document.getElementById("upload-input");
    if (input && !state.upload.loading) input.click();
    return;
  }

  if (actionBtn.dataset.action === "upload-toggle-adjustable") {
    const key = `${actionBtn.dataset.component}.${actionBtn.dataset.param}`;
    state.upload.interaction[key] = !state.upload.interaction[key];
    renderApp();
  }
});

app.addEventListener("input", (event) => {
  const target = event.target;
  if (target?.dataset?.action !== "upload-range-adjustable") return;
  const key = `${target.dataset.component}.${target.dataset.param}`;
  state.upload.interaction[key] = Number(target.value);
  renderApp();
});

app.addEventListener("change", async (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement) || target.id !== "upload-input") return;
  const file = target.files?.[0];
  if (!file) return;

  if (state.upload.previewUrl && state.upload.previewUrl.startsWith("blob:")) {
    URL.revokeObjectURL(state.upload.previewUrl);
  }

  state.upload.previewUrl = URL.createObjectURL(file);
  state.selectedCase = "upload";
  renderApp();
  await parseUploadedFile(file);
});

function renderSceneComponent(scene, component, activeHighlights) {
  const current = getResolvedSceneComponent(component);
  const active = activeHighlights.components.has(current.id);
  const changed = hasComponentInteractionChanged(scene, current);

  if (current.primitives?.length && !changed) {
    return `
      <g class="scene-component ${active ? "scene-component--active" : ""}">
        ${current.primitives.map((item) => renderScenePrimitive(item, active ? "scene-primitive--active" : "")).join("")}
      </g>
    `;
  }

  return renderSceneFallbackComponent(current, active);
}

function renderSceneWire(wire, activeHighlights) {
  const active = activeHighlights.wires.has(wire.id);
  const cls = active ? "scene-wire scene-wire--active" : "scene-wire";
  const stroke = wire.style?.color || "#1f2e2b";
  const width = wire.style?.width || 2.8;

  if (wire.route?.kind === "svg_path" && wire.route?.d) {
    return `<path class="${cls}" d="${wire.route.d}" stroke="${stroke}" stroke-width="${width}" />`;
  }

  const points = (wire.route?.points || []).map((point) => `${point.x},${point.y}`).join(" ");
  return `<polyline class="${cls}" points="${points}" stroke="${stroke}" stroke-width="${width}" />`;
}

function renderUploadScene(scene) {
  if (!scene) {
    return `
      <div class="scene-stage scene-stage--upload">
        <div class="upload-empty">
          <div class="upload-empty__icon">+</div>
          <div class="upload-empty__title">上传电路题图片</div>
          <div class="upload-empty__desc">支持 JPG / JPEG / PNG。选择后会自动识别元件、导线和文字，并生成可交互的电路图。</div>
        </div>
        ${state.upload.loading ? `
          <div class="upload-loading-mask">
            <div class="upload-spinner"></div>
            <strong>正在生成交互电路图</strong>
            <span>正在识别元件、导线和文字位置，通常需要 20 到 60 秒。</span>
          </div>
        ` : ""}
      </div>
    `;
  }

  const highlights = getSceneHighlights(scene);
  const viewBox = scene.canvas?.view_box || [0, 0, scene.source?.image_width || 1200, scene.source?.image_height || 800];

  return `
    <div class="scene-stage scene-stage--upload">
      <svg viewBox="${viewBox.join(" ")}" aria-label="上传题目电路图">
        ${(scene.wires || []).map((wire) => renderSceneWire(wire, highlights)).join("")}
        ${(scene.junctions || []).map((junction) => {
          const kind = String(junction.kind || "");
          return kind.includes("connected")
            ? `<circle cx="${junction.x}" cy="${junction.y}" r="${junction.radius || 4.2}" class="scene-node scene-node--solid"></circle>`
            : "";
        }).join("")}
        ${(scene.components || []).map((component) => renderSceneComponent(scene, component, highlights)).join("")}
        ${(scene.labels || []).map((label) => renderSceneLabel(label)).join("")}
      </svg>
      ${state.upload.loading ? `
        <div class="upload-loading-mask">
          <div class="upload-spinner"></div>
          <strong>正在生成交互电路图</strong>
          <span>正在识别元件、导线和文字位置，通常需要 20 到 60 秒。</span>
        </div>
      ` : ""}
    </div>
  `;
}

function summarizeComponents(scene) {
  const counts = collectComponentCounts(scene);
  const labels = {
    battery: "电源",
    switch: "开关",
    lamp: "灯泡",
    resistor: "定值电阻",
    variable_resistor: "滑动变阻器",
    ammeter: "电流表",
    voltmeter: "电压表"
  };

  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([type, count]) => `${labels[type] || type} x ${count}`);
}

function renderUploadStructure(scene) {
  const structureLines = summarizeComponents(scene);
  const adjustables = scene?.simulation?.adjustables || [];

  return `
    <div class="kv-list">
      <div class="kv-item"><span>组件总数</span><strong>${scene?.components?.length || 0}</strong></div>
      <div class="kv-item"><span>导线总数</span><strong>${scene?.wires?.length || 0}</strong></div>
      <div class="kv-item"><span>文字标注</span><strong>${scene?.labels?.length || 0}</strong></div>
      <div class="kv-item"><span>可交互项</span><strong>${adjustables.length}</strong></div>
      <div class="kv-item"><span>识别结构</span><strong>${escapeUploadHtml(structureLines.slice(0, 3).join(" / ") || "暂无")}</strong></div>
    </div>
  `;
}

function renderUploadMeasurements(scene) {
  const measurements = scene?.simulation?.measurements || [];
  if (!measurements.length) {
    const adjustables = scene?.simulation?.adjustables || [];
    if (!adjustables.length) {
      return `
        <ul class="fact-list">
          <li>当前结果以电路结构复刻为主，暂未识别出可调元件。</li>
          <li>如需更高还原度，优先检查开关、滑阻、电源与关键节点是否贴合原图。</li>
        </ul>
      `;
    }

    return `
      <ul class="fact-list">
        ${adjustables.map((item) => `<li>可交互元件：${escapeUploadHtml(item.label || item.component_id)}</li>`).join("")}
      </ul>
    `;
  }

  const context = buildSceneContext(scene);
  return `
    <div class="kv-list">
      ${measurements.map((item) => {
        const value = evaluateSceneExpression(item.expr, context);
        return `<div class="kv-item"><span>${escapeUploadHtml(item.label || item.id)}</span><strong>${value == null ? "--" : `${format(value)}${escapeUploadHtml(item.unit || "")}`}</strong></div>`;
      }).join("")}
    </div>
  `;
}

function renderUploadAdjustables(scene) {
  const adjustables = scene?.simulation?.adjustables || [];
  if (!adjustables.length) {
    return `<div class="hint">当前结果没有返回可调参数，先展示静态复刻结果。</div>`;
  }

  return adjustables.map((item) => {
    const component = (scene.components || []).find((entry) => entry.id === item.component_id);
    const type = normalizeAdjustableType(item.type);
    const value = getSceneInteractiveValue(item.component_id, item.param, component?.params?.[item.param]);
    const label = escapeUploadHtml(item.label || component?.label || item.component_id);

    if (type === "toggle") {
      return `<button class="control-btn ${value ? "control-btn--on" : "control-btn--off"}" data-action="upload-toggle-adjustable" data-component="${item.component_id}" data-param="${item.param}">${label}：${value ? "闭合" : "断开"}</button>`;
    }

    if (type === "range") {
      return `
        <label class="slider-panel">
          <span>${label}：${format(Number(value), 2)}</span>
          <input type="range" min="${item.min ?? 0}" max="${item.max ?? 1}" step="${item.step ?? 0.01}" value="${value ?? item.min ?? 0}" data-action="upload-range-adjustable" data-component="${item.component_id}" data-param="${item.param}" />
        </label>
      `;
    }

    return "";
  }).join("");
}

function buildUploadFooter(scene) {
  if (!scene) {
    return "上传后会自动识别元件、导线和文字，并生成可交互电路图。";
  }

  const structureLines = summarizeComponents(scene);
  const dims = `${scene.source?.image_width || "--"} x ${scene.source?.image_height || "--"}`;
  return `${scene.summary || "已生成一版电路复刻结果。"} 当前识别到 ${scene.components?.length || 0} 个组件、${scene.wires?.length || 0} 条导线，题图尺寸 ${dims}。${structureLines.length ? ` 结构包括：${structureLines.join("，")}。` : ""}`;
}

renderPreviewCard = function renderPreviewCardOverride() {
  if (state.selectedCase !== "upload") {
    return baseRenderPreviewCard();
  }

  if (!state.upload.previewUrl) {
    return `
      <div class="preview-card preview-card--placeholder">
        <div class="preview-card__title">上传题图</div>
        <div class="preview-card__placeholder">等待上传</div>
      </div>
    `;
  }

  return `
    <div class="preview-card">
      <div class="preview-card__title">原始题图</div>
      <img src="${state.upload.previewUrl}" alt="${escapeUploadHtml(state.upload.fileName || "上传题图")}" />
      <div class="preview-card__meta">${escapeUploadHtml(state.upload.fileName)}${state.upload.fileSize ? ` · ${formatUploadBytes(state.upload.fileSize)}` : ""}</div>
    </div>
  `;
};

renderUploadPage = function renderUploadPageOverride() {
  const scene = state.upload.scene;
  const title = scene?.title || "上传题目：通用识别与 1:1 复刻";
  const desc = scene?.summary || "上传任意电路题图片，自动识别元件、导线、节点和文字，生成可交互的 HTML / SVG 电路图。";
  const adjustables = scene?.simulation?.adjustables || [];
  const badges = [
    state.upload.loading ? "状态：生成中" : scene ? "状态：生成成功" : "状态：待上传",
    scene ? `组件：${scene.components?.length || 0}` : "输入：任意题图",
    scene ? `交互：${adjustables.length}` : "模型：gpt-5.4"
  ];

  return {
    title,
    desc,
    badges,
    accentIndex: 2,
    svg: `
      ${state.upload.successMessage ? `<div class="upload-status upload-status--success">${escapeUploadHtml(state.upload.successMessage)}</div>` : ""}
      ${state.upload.error ? `<div class="upload-status upload-status--error">${escapeUploadHtml(state.upload.error)}</div>` : ""}
      ${renderUploadScene(scene)}
    `,
    footerTitle: "生成说明",
    footerDesc: state.upload.loading
      ? "正在调用大模型识别题图，请等待结果返回。"
      : buildUploadFooter(scene),
    parametersTitle: "识别结构",
    parameters: scene ? renderUploadStructure(scene) : `
      <div class="kv-list">
        <div class="kv-item"><span>识别方式</span><strong>题图 -> scene JSON</strong></div>
        <div class="kv-item"><span>输出格式</span><strong>SVG / HTML</strong></div>
        <div class="kv-item"><span>目标</span><strong>1:1 复刻</strong></div>
      </div>
    `,
    lawsTitle: "交互与测量",
    laws: scene ? renderUploadMeasurements(scene) : `
      <ul class="fact-list">
        <li>优先识别电源、开关、电阻、滑阻、电表和关键节点。</li>
        <li>尽量保持原题中的导线走向和相对位置，而不是重画成等效图。</li>
        <li>返回结果支持后续继续增强调参与实验逻辑。</li>
      </ul>
    `,
    controls: `
      <div class="control-stack">
        <input class="hidden-input" id="upload-input" type="file" accept=".jpg,.jpeg,.png,image/jpeg,image/png" />
        <button class="control-btn" data-action="upload-open" ${state.upload.loading ? "disabled" : ""}>${state.upload.loading ? "识别中..." : scene ? "重新上传题图" : "上传题图"}</button>
        ${scene ? renderUploadAdjustables(scene) : `<div class="hint">选择图片后会自动开始识别，不需要再额外点击解析按钮。</div>`}
      </div>
    `
  };
};

async function parseUploadedFile(file) {
  resetUploadState(true);
  state.upload.loading = true;
  state.upload.error = "";
  state.upload.successMessage = "";
  state.upload.file = file;
  state.upload.fileName = file.name;
  state.upload.fileSize = file.size;
  renderApp();

  try {
    const payload = await uploadFileToPayload(file);
    const response = await fetch("/api/parse-circuit", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();
    if (!response.ok || !data.ok) {
      throw new Error(data.error || "生成失败");
    }

    state.upload.scene = data.scene;
    state.upload.usage = data.usage || null;
    state.upload.interaction = createSceneInteractionState(data.scene);
    state.upload.successMessage = "生成成功，已输出可交互电路图。";
  } catch (error) {
    state.upload.error = error.message || "生成失败";
  } finally {
    state.upload.loading = false;
    renderApp();
  }
}

function cloneUploadScene(scene) {
  return JSON.parse(JSON.stringify(scene || {}));
}

function getUploadComponentById(scene, componentId) {
  return (scene?.components || []).find((entry) => entry.id === componentId) || null;
}

function getUploadWireEndpointPoints(scene, componentId) {
  const points = [];
  (scene?.wires || []).forEach((wire) => {
    const routePoints = wire?.route?.points || [];
    if (!routePoints.length) return;
    if (String(wire.from || "").startsWith(`${componentId}.`)) {
      points.push(routePoints[0]);
    }
    if (String(wire.to || "").startsWith(`${componentId}.`)) {
      points.push(routePoints[routePoints.length - 1]);
    }
  });
  return points.filter(Boolean);
}

function normalizeUploadSwitch(scene, component) {
  const bbox = component.bbox || [0, 0, 60, 40];
  const center = component.center || { x: bbox[0] + bbox[2] / 2, y: bbox[1] + bbox[3] / 2 };
  const wirePoints = getUploadWireEndpointPoints(scene, component.id);
  const anchorLeft = component.anchors?.left || { x: bbox[0], y: center.y };
  const anchorRight = component.anchors?.right || { x: bbox[0] + bbox[2], y: center.y };
  const spanX = wirePoints.length ? Math.max(...wirePoints.map((point) => point.x)) - Math.min(...wirePoints.map((point) => point.x)) : Math.abs(anchorRight.x - anchorLeft.x);
  const spanY = wirePoints.length ? Math.max(...wirePoints.map((point) => point.y)) - Math.min(...wirePoints.map((point) => point.y)) : Math.abs(anchorRight.y - anchorLeft.y);
  const horizontal = spanX >= spanY;

  if (horizontal) {
    const ordered = (wirePoints.length ? wirePoints : [anchorLeft, anchorRight]).slice().sort((a, b) => a.x - b.x);
    const left = ordered[0];
    const rightBase = ordered[ordered.length - 1];
    const y = Math.round((ordered.reduce((sum, point) => sum + point.y, 0) / ordered.length) || center.y);
    const right = { x: rightBase.x, y };
    const gap = Math.max(14, Math.min(22, (right.x - left.x) * 0.24 || 16));
    component.anchors = {
      ...component.anchors,
      left: { x: left.x, y },
      right
    };
    component.interactive = {
      kind: "toggle_switch",
      pivot: { x: left.x, y },
      contact: { x: right.x - gap, y },
      open_tip: {
        x: right.x,
        y: component.interactive?.open_tip?.y ?? (y - gap)
      }
    };
    component.prefer_fallback = true;
    return;
  }

  const ordered = (wirePoints.length ? wirePoints : [anchorLeft, anchorRight]).slice().sort((a, b) => a.y - b.y);
  const top = ordered[0];
  const bottom = ordered[ordered.length - 1];
  const x = Math.round((ordered.reduce((sum, point) => sum + point.x, 0) / ordered.length) || center.x);
  const contactY = component.interactive?.contact?.y ?? Math.round(top.y + Math.max(18, (bottom.y - top.y) * 0.35));
  component.anchors = {
    ...component.anchors,
    top: { x, y: top.y },
    bottom: { x, y: bottom.y }
  };
  component.interactive = {
    kind: "toggle_switch",
    pivot: { x, y: bottom.y },
    contact: { x, y: contactY },
    open_tip: {
      x: component.interactive?.open_tip?.x ?? (x - 20),
      y: component.interactive?.open_tip?.y ?? Math.max(top.y + 10, contactY - 10)
    }
  };
  component.prefer_fallback = true;
}

function inferVariableResistorTrack(component) {
  const bbox = component.bbox || [0, 0, 60, 40];
  const candidates = (component.primitives || []).filter((item) => item.type === "line");
  const vertical = candidates.find((item) => Math.abs((item.x1 ?? 0) - (item.x2 ?? 0)) <= 6 && Math.min(item.y1 ?? 0, item.y2 ?? 0) < bbox[1]);
  if (vertical) {
    return {
      x1: vertical.x1,
      y1: Math.min(vertical.y1, vertical.y2),
      x2: vertical.x2,
      y2: Math.max(vertical.y1, vertical.y2)
    };
  }
  if (component.anchors?.slider) {
    return {
      x1: component.anchors.slider.x,
      y1: bbox[1] - 36,
      x2: component.anchors.slider.x,
      y2: bbox[1] - 4
    };
  }
  return null;
}

function enhanceUploadVariableResistor(scene, component) {
  const track = inferVariableResistorTrack(component);
  if (!track) return;

  const handle = component.anchors?.slider
    ? { x: component.anchors.slider.x, y: component.anchors.slider.y }
    : { x: track.x2, y: track.y2 };

  const ratioDenominator = (track.y2 - track.y1) || 1;
  const inferredRatio = clamp((handle.y - track.y1) / ratioDenominator, 0, 1);

  component.params = {
    ...(component.params || {}),
    slider_position: Number.isFinite(Number(component.params?.slider_position))
      ? Number(component.params.slider_position)
      : inferredRatio
  };
  component.interactive = {
    kind: "slider",
    track,
    handle
  };
  component.prefer_fallback = true;

  scene.simulation = scene.simulation || {};
  scene.simulation.adjustables = scene.simulation.adjustables || [];
  const exists = scene.simulation.adjustables.some((item) => item.component_id === component.id && item.param === "slider_position");
  if (!exists) {
    scene.simulation.adjustables.push({
      id: `adj_${component.id}`,
      label: "P",
      type: "range",
      component_id: component.id,
      param: "slider_position",
      min: 0,
      max: 1,
      step: 0.01,
      initial: component.params.slider_position
    });
  }
}

function enhanceUploadMeter(component) {
  const primitives = component.primitives || [];
  const circleOnly = primitives.length > 0 && primitives.every((item) => item.type === "circle");
  if (circleOnly) {
    component.prefer_fallback = true;
  }
}

function prepareUploadScene(scene) {
  const next = cloneUploadScene(scene);
  (next.components || []).forEach((component) => {
    if (component.type === "switch") {
      normalizeUploadSwitch(next, component);
    }
    if (component.type === "variable_resistor") {
      enhanceUploadVariableResistor(next, component);
    }
    if (component.type === "ammeter" || component.type === "voltmeter") {
      enhanceUploadMeter(component);
    }
  });
  return next;
}

function shouldSkipUploadLabel(label) {
  const component = getUploadComponentById(state.upload.scene, label.belongs_to);
  if (!component) return false;
  if ((component.type === "ammeter" || component.type === "voltmeter") && component.prefer_fallback) {
    return true;
  }
  return false;
}

function renderSceneLabel(label) {
  if (shouldSkipUploadLabel(label)) return "";
  const fontSize = Number(label.font_size || 18);
  const x = label.position?.x ?? 0;
  const y = label.position?.y ?? 0;
  const rotate = Number(label.rotation || 0);
  const transform = rotate ? ` transform="rotate(${rotate} ${x} ${y})"` : "";
  return `<text x="${x}" y="${y}" text-anchor="${label.text_anchor || "middle"}" font-size="${fontSize}" class="scene-label scene-label--upload"${transform}>${escapeUploadHtml(label.text || "")}</text>`;
}

function renderSceneComponent(scene, component, activeHighlights) {
  const current = getResolvedSceneComponent(component);
  const active = activeHighlights.components.has(current.id);
  const changed = hasComponentInteractionChanged(scene, current);

  if (current.primitives?.length && !changed && !current.prefer_fallback) {
    return `
      <g class="scene-component ${active ? "scene-component--active" : ""}">
        ${current.primitives.map((item) => renderScenePrimitive(item, active ? "scene-primitive--active" : "")).join("")}
      </g>
    `;
  }

  return renderSceneFallbackComponent(current, active);
}

async function parseUploadedFile(file) {
  resetUploadState(true);
  state.upload.loading = true;
  state.upload.error = "";
  state.upload.successMessage = "";
  state.upload.file = file;
  state.upload.fileName = file.name;
  state.upload.fileSize = file.size;
  renderApp();

  try {
    const payload = await uploadFileToPayload(file);
    const response = await fetch("/api/parse-circuit", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();
    if (!response.ok || !data.ok) {
      throw new Error(data.error || "生成失败");
    }

    const preparedScene = prepareUploadScene(data.scene);
    state.upload.scene = preparedScene;
    state.upload.usage = data.usage || null;
    state.upload.interaction = createSceneInteractionState(preparedScene);
    state.upload.successMessage = "生成成功，已输出可交互电路图。";
  } catch (error) {
    state.upload.error = error.message || "生成失败";
  } finally {
    state.upload.loading = false;
    renderApp();
  }
}

renderApp();

function clusterUploadValues(values, tolerance = 10) {
  const sorted = values
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b);

  if (!sorted.length) return [];

  const groups = [[sorted[0]]];
  for (let index = 1; index < sorted.length; index += 1) {
    const value = sorted[index];
    const group = groups[groups.length - 1];
    const mean = group.reduce((sum, item) => sum + item, 0) / group.length;
    if (Math.abs(value - mean) <= tolerance) {
      group.push(value);
    } else {
      groups.push([value]);
    }
  }

  return groups.map((group) => Math.round(group.reduce((sum, item) => sum + item, 0) / group.length));
}

function collectUploadRoutePoints(scene) {
  return (scene?.wires || []).flatMap((wire) => wire?.route?.points || []);
}

function inferUploadRails(scene) {
  const points = collectUploadRoutePoints(scene);
  const xClusters = clusterUploadValues(points.map((point) => point.x), 12);
  if (xClusters.length < 2) return { left: null, right: null };
  return {
    left: xClusters[0],
    right: xClusters[xClusters.length - 1]
  };
}

function inferUploadLevels(scene) {
  const points = collectUploadRoutePoints(scene);
  return clusterUploadValues(points.map((point) => point.y), 10);
}

function snapToClosest(value, targets, tolerance = 14) {
  let best = value;
  let bestDistance = tolerance + 1;
  targets.forEach((target) => {
    const distance = Math.abs(value - target);
    if (distance < bestDistance) {
      best = target;
      bestDistance = distance;
    }
  });
  return best;
}

function dedupeUploadPolyline(points) {
  const next = [];
  points.forEach((point) => {
    const prev = next[next.length - 1];
    if (!prev || prev.x !== point.x || prev.y !== point.y) {
      next.push(point);
    }
  });
  return next;
}

function snapUploadWires(scene) {
  const rails = inferUploadRails(scene);
  const levels = inferUploadLevels(scene);
  const xTargets = [rails.left, rails.right].filter((value) => Number.isFinite(value));

  (scene?.wires || []).forEach((wire) => {
    if (wire.route?.kind !== "polyline") return;
    const points = (wire.route.points || []).map((point) => ({
      x: snapToClosest(point.x, xTargets, 16),
      y: snapToClosest(point.y, levels, 10)
    }));
    wire.route.points = dedupeUploadPolyline(points);
  });

  return rails;
}

function hasUploadWireNear(scene, point, tolerance = 10) {
  return (scene?.wires || []).some((wire) =>
    (wire?.route?.points || []).some((entry) =>
      Math.abs(entry.x - point.x) <= tolerance && Math.abs(entry.y - point.y) <= tolerance
    )
  );
}

function addSyntheticUploadWire(scene, id, points) {
  if (!scene.wires) scene.wires = [];
  if (scene.wires.some((wire) => wire.id === id)) return;
  scene.wires.push({
    id,
    from: null,
    to: null,
    route: {
      kind: "polyline",
      points: dedupeUploadPolyline(points)
    },
    style: {
      color: "#1f2e2b",
      width: 3.5
    },
    current_candidate: false,
    confidence: 1
  });
}

function enhanceUploadVariableResistor(scene, component) {
  const bbox = component.bbox || [0, 0, 60, 40];
  const track = inferVariableResistorTrack(component);
  if (!track) return;

  const rails = inferUploadRails(scene);
  const leftY = component.anchors?.left?.y ?? Math.round(bbox[1] + bbox[3] / 2);
  const handleRatio = Number.isFinite(Number(component.params?.slider_position))
    ? Number(component.params.slider_position)
    : 1;
  const handle = {
    x: track.x1,
    y: track.y1 + (track.y2 - track.y1) * clamp(handleRatio, 0, 1)
  };

  component.anchors = {
    ...(component.anchors || {}),
    left: {
      x: Number.isFinite(rails.left) ? rails.left : (component.anchors?.left?.x ?? bbox[0]),
      y: leftY
    },
    right: {
      x: Number.isFinite(rails.right) ? rails.right : (component.anchors?.right?.x ?? (bbox[0] + bbox[2])),
      y: leftY
    },
    tap: {
      x: track.x1,
      y: track.y1
    }
  };
  component.params = {
    ...(component.params || {}),
    slider_position: clamp(handleRatio, 0, 1)
  };
  component.interactive = {
    kind: "slider",
    track,
    handle
  };
  component.prefer_fallback = true;

  scene.simulation = scene.simulation || {};
  scene.simulation.adjustables = scene.simulation.adjustables || [];
  const exists = scene.simulation.adjustables.some((item) => item.component_id === component.id && item.param === "slider_position");
  if (!exists) {
    scene.simulation.adjustables.push({
      id: `adj_${component.id}`,
      label: "P",
      type: "range",
      component_id: component.id,
      param: "slider_position",
      min: 0,
      max: 1,
      step: 0.01,
      initial: component.params.slider_position
    });
  }

  const tapPoint = component.anchors.tap;
  if (Number.isFinite(rails.right) && !hasUploadWireNear(scene, tapPoint, 10)) {
    addSyntheticUploadWire(scene, `wire_${component.id}_tap`, [
      tapPoint,
      { x: rails.right, y: tapPoint.y }
    ]);
  }
}

function normalizeUploadSwitch(scene, component) {
  const bbox = component.bbox || [0, 0, 60, 40];
  const center = component.center || { x: bbox[0] + bbox[2] / 2, y: bbox[1] + bbox[3] / 2 };
  const points = getUploadWireEndpointPoints(scene, component.id);
  const left = component.anchors?.left || { x: bbox[0], y: center.y };
  const right = component.anchors?.right || { x: bbox[0] + bbox[2], y: center.y };
  const spanX = points.length ? Math.max(...points.map((point) => point.x)) - Math.min(...points.map((point) => point.x)) : Math.abs(right.x - left.x);
  const spanY = points.length ? Math.max(...points.map((point) => point.y)) - Math.min(...points.map((point) => point.y)) : Math.abs(right.y - left.y);
  const horizontal = spanX >= spanY;

  if (horizontal) {
    const ordered = (points.length ? points : [left, right]).slice().sort((a, b) => a.x - b.x);
    const start = ordered[0];
    const end = ordered[ordered.length - 1];
    const y = Math.round((ordered.reduce((sum, point) => sum + point.y, 0) / ordered.length) || center.y);
    component.anchors = {
      ...(component.anchors || {}),
      left: { x: start.x, y },
      right: { x: end.x, y }
    };
    component.interactive = {
      kind: "toggle_switch",
      pivot: { x: start.x, y },
      contact: { x: end.x - 14, y },
      open_tip: {
        x: end.x,
        y: component.interactive?.open_tip?.y ?? (y - 18)
      }
    };
    component.prefer_fallback = true;
    return;
  }

  const ordered = (points.length ? points : [left, right]).slice().sort((a, b) => a.y - b.y);
  const top = ordered[0];
  const bottom = ordered[ordered.length - 1];
  const x = Math.round((ordered.reduce((sum, point) => sum + point.x, 0) / ordered.length) || center.x);
  component.anchors = {
    ...(component.anchors || {}),
    top: { x, y: top.y },
    bottom: { x, y: bottom.y }
  };
  component.interactive = {
    kind: "toggle_switch",
    pivot: { x, y: bottom.y },
    contact: { x, y: Math.round(top.y + Math.max(14, (bottom.y - top.y) * 0.35)) },
    open_tip: {
      x: component.interactive?.open_tip?.x ?? (x - 18),
      y: component.interactive?.open_tip?.y ?? Math.round(top.y + 24)
    }
  };
  component.prefer_fallback = true;
}

function prepareUploadScene(scene) {
  const next = cloneUploadScene(scene);
  snapUploadWires(next);
  (next.components || []).forEach((component) => {
    if (component.type === "switch") normalizeUploadSwitch(next, component);
    if (component.type === "variable_resistor") enhanceUploadVariableResistor(next, component);
    if (component.type === "ammeter" || component.type === "voltmeter") enhanceUploadMeter(component);
  });
  return next;
}

function summarizeComponents(scene) {
  const counts = collectComponentCounts(scene);
  const labels = {
    battery: "电源",
    switch: "开关",
    lamp: "灯泡",
    resistor: "定值电阻",
    variable_resistor: "滑动变阻器",
    ammeter: "电流表",
    voltmeter: "电压表"
  };

  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([type, count]) => `${labels[type] || type} x ${count}`);
}

function buildChineseUploadMeta(scene) {
  if (!scene) {
    return {
      title: "上传题目：通用识别与 1:1 复刻",
      desc: "上传任意电路题图片，自动识别元件、导线、节点和文字，生成可交互的 HTML / SVG 电路图。"
    };
  }

  const components = scene.components || [];
  const resistorLabels = components
    .filter((item) => item.type === "resistor" || item.type === "variable_resistor")
    .map((item) => item.label)
    .filter(Boolean);
  const parts = [];
  if (resistorLabels.length) parts.push(resistorLabels.join("、"));
  if (components.some((item) => item.type === "voltmeter")) parts.push("电压表");
  if (components.some((item) => item.type === "ammeter")) parts.push("电流表");
  if (components.some((item) => item.type === "switch")) parts.push("开关");
  if (components.some((item) => item.type === "battery")) parts.push("电源");

  const title = parts.length
    ? `含${parts.join("、")}的电路图复刻结果`
    : "上传题目：电路图复刻结果";

  const desc = `已识别 ${components.length || 0} 个组件、${scene.wires?.length || 0} 条导线。当前结果会先按教材电路图的母线、支路和元件锚点做几何归一化，再生成可交互电路图。`;
  return { title, desc };
}

function renderUploadStructure(scene) {
  const structureLines = summarizeComponents(scene);
  const adjustables = scene?.simulation?.adjustables || [];

  return `
    <div class="kv-list">
      <div class="kv-item"><span>组件总数</span><strong>${scene?.components?.length || 0}</strong></div>
      <div class="kv-item"><span>导线总数</span><strong>${scene?.wires?.length || 0}</strong></div>
      <div class="kv-item"><span>文字标注</span><strong>${scene?.labels?.length || 0}</strong></div>
      <div class="kv-item"><span>可交互项</span><strong>${adjustables.length}</strong></div>
      <div class="kv-item"><span>识别结构</span><strong>${escapeUploadHtml(structureLines.slice(0, 3).join(" / ") || "暂无")}</strong></div>
    </div>
  `;
}

function renderUploadMeasurements(scene) {
  const adjustables = scene?.simulation?.adjustables || [];
  if (!adjustables.length) {
    return `
      <ul class="fact-list">
        <li>当前结果以电路结构复刻为主，暂未识别出可调元件。</li>
        <li>如果仍有断线或重叠，下一步应在中间态先做“拓扑校验 + 几何吸附”，再进入 SVG 渲染。</li>
      </ul>
    `;
  }

  return `
    <ul class="fact-list">
      ${adjustables.map((item) => `<li>可交互元件：${escapeUploadHtml(item.label || item.component_id)}</li>`).join("")}
    </ul>
  `;
}

function buildUploadFooter(scene) {
  if (!scene) {
    return "上传后会自动识别元件、导线和文字，并生成可交互电路图。";
  }

  return "当前链路是：图片识别 -> scene 中间态 -> 几何归一化 -> SVG 渲染。现在主要问题不在上传流程，而在模型输出的 scene 仍有局部拓扑和锚点误差，所以前端需要继续补一层约束和校验。";
}

function renderUploadScene(scene) {
  if (!scene) {
    return `
      <div class="scene-stage scene-stage--upload">
        <div class="upload-empty">
          <div class="upload-empty__icon">+</div>
          <div class="upload-empty__title">上传电路题图片</div>
          <div class="upload-empty__desc">支持 JPG / JPEG / PNG。选择后会自动识别元件、导线和文字，并生成可交互的电路图。</div>
        </div>
        ${state.upload.loading ? `
          <div class="upload-loading-mask">
            <div class="upload-spinner"></div>
            <strong>正在生成交互电路图</strong>
            <span>正在识别元件、导线和文字位置，通常需要 20 到 60 秒。</span>
          </div>
        ` : ""}
      </div>
    `;
  }

  const highlights = getSceneHighlights(scene);
  const viewBox = scene.canvas?.view_box || [0, 0, scene.source?.image_width || 1200, scene.source?.image_height || 800];
  return `
    <div class="scene-stage scene-stage--upload">
      <svg viewBox="${viewBox.join(" ")}" aria-label="上传题目电路图">
        ${(scene.wires || []).map((wire) => renderSceneWire(wire, highlights)).join("")}
        ${(scene.junctions || []).map((junction) => {
          const kind = String(junction.kind || "");
          return kind.includes("connected")
            ? `<circle cx="${junction.x}" cy="${junction.y}" r="${junction.radius || 4.2}" class="scene-node scene-node--solid"></circle>`
            : "";
        }).join("")}
        ${(scene.components || []).map((component) => renderSceneComponent(scene, component, highlights)).join("")}
        ${(scene.labels || []).map((label) => renderSceneLabel(label)).join("")}
      </svg>
      ${state.upload.loading ? `
        <div class="upload-loading-mask">
          <div class="upload-spinner"></div>
          <strong>正在生成交互电路图</strong>
          <span>正在识别元件、导线和文字位置，通常需要 20 到 60 秒。</span>
        </div>
      ` : ""}
    </div>
  `;
}

renderPreviewCard = function renderPreviewCardOverride() {
  if (state.selectedCase !== "upload") {
    return baseRenderPreviewCard();
  }

  if (!state.upload.previewUrl) {
    return `
      <div class="preview-card preview-card--placeholder">
        <div class="preview-card__title">上传题图</div>
        <div class="preview-card__placeholder">等待上传</div>
      </div>
    `;
  }

  return `
    <div class="preview-card">
      <div class="preview-card__title">原始题图</div>
      <img src="${state.upload.previewUrl}" alt="${escapeUploadHtml(state.upload.fileName || "上传题图")}" />
      <div class="preview-card__meta">${escapeUploadHtml(state.upload.fileName)}${state.upload.fileSize ? ` · ${formatUploadBytes(state.upload.fileSize)}` : ""}</div>
    </div>
  `;
};

renderUploadPage = function renderUploadPageOverride() {
  const scene = state.upload.scene;
  const meta = buildChineseUploadMeta(scene);
  const adjustables = scene?.simulation?.adjustables || [];
  const badges = [
    state.upload.loading ? "状态：生成中" : scene ? "状态：生成成功" : "状态：待上传",
    scene ? `组件：${scene.components?.length || 0}` : "输入：任意题图",
    scene ? `交互：${adjustables.length}` : "模型：gpt-5.4"
  ];

  return {
    title: meta.title,
    desc: meta.desc,
    badges,
    accentIndex: 2,
    svg: `
      ${state.upload.successMessage ? `<div class="upload-status upload-status--success">${escapeUploadHtml(state.upload.successMessage)}</div>` : ""}
      ${state.upload.error ? `<div class="upload-status upload-status--error">${escapeUploadHtml(state.upload.error)}</div>` : ""}
      ${renderUploadScene(scene)}
    `,
    footerTitle: "生成说明",
    footerDesc: state.upload.loading
      ? "正在调用大模型识别题图，请等待结果返回。"
      : buildUploadFooter(scene),
    parametersTitle: "识别结构",
    parameters: scene ? renderUploadStructure(scene) : `
      <div class="kv-list">
        <div class="kv-item"><span>识别方式</span><strong>题图 -> scene JSON</strong></div>
        <div class="kv-item"><span>输出格式</span><strong>SVG / HTML</strong></div>
        <div class="kv-item"><span>目标</span><strong>1:1 复刻</strong></div>
      </div>
    `,
    lawsTitle: "交互与测量",
    laws: scene ? renderUploadMeasurements(scene) : `
      <ul class="fact-list">
        <li>优先识别电源、开关、电阻、滑阻、电表和关键节点。</li>
        <li>先输出 scene 中间态，再做几何归一化，最后进入 SVG 渲染。</li>
        <li>避免断线和重叠的关键，不是继续堆 prompt，而是补拓扑校验和坐标吸附。</li>
      </ul>
    `,
    controls: `
      <div class="control-stack">
        <input class="hidden-input" id="upload-input" type="file" accept=".jpg,.jpeg,.png,image/jpeg,image/png" />
        <button class="control-btn" data-action="upload-open" ${state.upload.loading ? "disabled" : ""}>${state.upload.loading ? "识别中..." : scene ? "重新上传题图" : "上传题图"}</button>
        ${scene ? renderUploadAdjustables(scene) : `<div class="hint">选择图片后会自动开始识别，不需要再额外点击解析按钮。</div>`}
      </div>
    `
  };
};

async function parseUploadedFile(file) {
  resetUploadState(true);
  state.upload.loading = true;
  state.upload.error = "";
  state.upload.successMessage = "";
  state.upload.file = file;
  state.upload.fileName = file.name;
  state.upload.fileSize = file.size;
  renderApp();

  try {
    const payload = await uploadFileToPayload(file);
    const response = await fetch("/api/parse-circuit", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();
    if (!response.ok || !data.ok) {
      throw new Error(data.error || "生成失败");
    }

    const preparedScene = prepareUploadScene(data.scene);
    state.upload.scene = preparedScene;
    state.upload.usage = data.usage || null;
    state.upload.interaction = createSceneInteractionState(preparedScene);
    state.upload.successMessage = "生成成功，已输出可交互电路图。";
  } catch (error) {
    state.upload.error = error.message || "生成失败";
  } finally {
    state.upload.loading = false;
    renderApp();
  }
}

renderApp();
