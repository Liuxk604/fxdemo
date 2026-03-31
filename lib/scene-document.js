const DEFAULT_STROKE = "#1f2e2b";

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
    Math.max(12, toNumber(bbox[2], 60)),
    Math.max(12, toNumber(bbox[3], 40))
  ];
}

function inferCenter(bbox, center) {
  return ensurePoint(center, bbox[0] + bbox[2] / 2, bbox[1] + bbox[3] / 2);
}

function normalizeAnchorMap(anchors, bbox, center) {
  const next = {};
  Object.entries(anchors || {}).forEach(([key, value]) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return;
    if (Object.prototype.hasOwnProperty.call(value, "x") || Object.prototype.hasOwnProperty.call(value, "y")) {
      next[key] = ensurePoint(value, center.x, center.y);
    }
  });

  if (!next.left) next.left = { x: bbox[0], y: center.y };
  if (!next.right) next.right = { x: bbox[0] + bbox[2], y: center.y };
  return next;
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
  const { left, right, top, bottom } = getComponentEndpoints(component);
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
        { type: "circle", cx: pivot.x, cy: pivot.y, r: 4.6, fill: DEFAULT_STROKE, stroke_width: 0 },
        { type: "circle", cx: contact.x, cy: contact.y, r: 4.6, fill: DEFAULT_STROKE, stroke_width: 0 },
        { type: "line", x1: pivot.x, y1: pivot.y, x2: target.x, y2: target.y, stroke_width: 4 }
      ]
    : [
        { type: "line", x1: pivot.x, y1: top.y, x2: pivot.x, y2: pivot.y, stroke_width: 4 },
        { type: "line", x1: contact.x, y1: contact.y, x2: contact.x, y2: bottom.y, stroke_width: 4 },
        { type: "circle", cx: pivot.x, cy: pivot.y, r: 4.6, fill: DEFAULT_STROKE, stroke_width: 0 },
        { type: "circle", cx: contact.x, cy: contact.y, r: 4.6, fill: DEFAULT_STROKE, stroke_width: 0 },
        { type: "line", x1: pivot.x, y1: pivot.y, x2: target.x, y2: target.y, stroke_width: 4 }
      ];
}

function synthesizePrimitives(component) {
  if (ensureArray(component.primitives).length) return ensureArray(component.primitives);
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
      stroke: item.stroke || DEFAULT_STROKE,
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
      stroke: item.stroke || DEFAULT_STROKE,
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
      stroke: item.stroke || DEFAULT_STROKE,
      stroke_width: toNumber(item.stroke_width, 4),
      fill: item.fill ?? "none"
    };
  }

  if (item.type === "polyline" || item.type === "polygon") {
    return {
      type: item.type,
      points: ensureArray(item.points).map((point) => ensurePoint(point, 0, 0)),
      stroke: item.stroke || DEFAULT_STROKE,
      stroke_width: toNumber(item.stroke_width, 4),
      fill: item.fill ?? "none"
    };
  }

  if (item.type === "path") {
    return {
      type: "path",
      d: item.d || "",
      stroke: item.stroke || DEFAULT_STROKE,
      stroke_width: toNumber(item.stroke_width, 4),
      fill: item.fill ?? "none"
    };
  }

  return null;
}

function parseTargetPath(target) {
  const match = String(target || "").trim().match(/^([A-Za-z0-9_-]+)\.params\.([A-Za-z0-9_]+)$/);
  if (!match) return null;
  return {
    component_id: match[1],
    param: match[2]
  };
}

function normalizeAdjustable(item, index) {
  const target = parseTargetPath(item?.target);
  const type = item?.type === "boolean"
    ? "toggle"
    : item?.type === "slider"
      ? "range"
      : item?.type;
  const componentId = item?.component_id || target?.component_id || null;
  const param = item?.param || target?.param || null;

  return {
    id: item?.id || `adjustable_${index + 1}`,
    label: item?.label || "",
    type: type || "range",
    component_id: componentId,
    param,
    target: item?.target || (componentId && param ? `${componentId}.params.${param}` : null),
    min: item?.min != null ? toNumber(item.min, 0) : undefined,
    max: item?.max != null ? toNumber(item.max, 1) : undefined,
    step: item?.step != null ? toNumber(item.step, 0.01) : undefined,
    initial: item?.initial ?? null
  };
}

function normalizeWireRoute(route) {
  const kind = route?.kind === "svg_path" || route?.kind === "path"
    ? "svg_path"
    : route?.kind === "arc"
      ? "arc"
      : "polyline";

  if (kind === "svg_path") {
    return {
      kind,
      d: route?.d || ""
    };
  }

  return {
    kind,
    points: ensureArray(route?.points).map((point) => ensurePoint(point, 0, 0))
  };
}

function normalizeJunctionKind(kind) {
  if (!kind) return "connected_dot";
  const value = String(kind).toLowerCase();
  if (value.includes("connected")) return "connected_dot";
  if (value.includes("dot")) return "connected_dot";
  return value;
}

function normalizeVision(vision) {
  return {
    confidence: toNumber(vision?.confidence, null),
    ocr_blocks: ensureArray(vision?.ocr_blocks).map((item, index) => ({
      id: item?.id || `ocr_${index + 1}`,
      text: item?.text || "",
      bbox: ensureBBox(item?.bbox),
      confidence: toNumber(item?.confidence, null)
    })),
    component_detections: ensureArray(vision?.component_detections).map((item, index) => ({
      id: item?.id || `det_${index + 1}`,
      type: item?.type || "unknown_component",
      bbox: ensureBBox(item?.bbox),
      confidence: toNumber(item?.confidence, null)
    })),
    wire_segments: ensureArray(vision?.wire_segments).map((item, index) => ({
      id: item?.id || `seg_${index + 1}`,
      kind: item?.kind || "line",
      points: ensureArray(item?.points).map((point) => Array.isArray(point)
        ? [toNumber(point[0], 0), toNumber(point[1], 0)]
        : [toNumber(point?.x, 0), toNumber(point?.y, 0)]
      ),
      confidence: toNumber(item?.confidence, null)
    })),
    issues: ensureArray(vision?.issues),
    evidence_crops: ensureArray(vision?.evidence_crops)
  };
}

function normalizeNetlist(netlist) {
  return {
    nodes: ensureArray(netlist?.nodes).map((item, index) => ({
      id: item?.id || `node_${index + 1}`,
      meaning: item?.meaning || ""
    })),
    edges: ensureArray(netlist?.edges).map((item, index) => ({
      id: item?.id || `edge_${index + 1}`,
      component_id: item?.component_id || null,
      from_node: item?.from_node || null,
      to_node: item?.to_node || null
    })),
    component_refs: ensureArray(netlist?.component_refs)
  };
}

function normalizeInteraction(interaction) {
  return {
    click_targets: ensureArray(interaction?.click_targets),
    drag_targets: ensureArray(interaction?.drag_targets),
    highlights: ensureArray(interaction?.highlights)
  };
}

function normalizeRendering(rendering) {
  return {
    prefer_symbol_library: rendering?.prefer_symbol_library !== false,
    prefer_original_geometry: rendering?.prefer_original_geometry !== false,
    fallback_overlay_svg: rendering?.fallback_overlay_svg || null,
    z_order: ensureArray(rendering?.z_order)
  };
}

function distance(a, b) {
  return Math.hypot((a?.x || 0) - (b?.x || 0), (a?.y || 0) - (b?.y || 0));
}

function bboxOverlapArea(a, b) {
  const ax2 = a[0] + a[2];
  const ay2 = a[1] + a[3];
  const bx2 = b[0] + b[2];
  const by2 = b[1] + b[3];
  const overlapWidth = Math.max(0, Math.min(ax2, bx2) - Math.max(a[0], b[0]));
  const overlapHeight = Math.max(0, Math.min(ay2, by2) - Math.max(a[1], b[1]));
  return overlapWidth * overlapHeight;
}

function resolveAnchorPoint(scene, ref) {
  if (!ref || typeof ref !== "string") return null;
  const [componentId, anchorName] = ref.split(".");
  const component = (scene.components || []).find((item) => item.id === componentId);
  if (!component && !anchorName) {
    const junction = (scene.junctions || []).find((item) => item.id === ref);
    if (junction) return { x: toNumber(junction.x, 0), y: toNumber(junction.y, 0) };
  }
  if (!component) return null;
  const bbox = ensureBBox(component.bbox);
  const center = inferCenter(bbox, component.center);
  const anchor = component.anchors?.[anchorName];
  if (anchor) return ensurePoint(anchor, center.x, center.y);
  if (anchorName === "left") return { x: bbox[0], y: center.y };
  if (anchorName === "right") return { x: bbox[0] + bbox[2], y: center.y };
  if (anchorName === "top") return { x: center.x, y: bbox[1] };
  if (anchorName === "bottom") return { x: center.x, y: bbox[1] + bbox[3] };
  return null;
}

function validateSceneDocument(scene) {
  const issues = [];
  const componentIds = new Set();
  const referencedComponents = new Set();

  (scene.components || []).forEach((component) => {
    if (componentIds.has(component.id)) {
      issues.push({
        code: "duplicate_component_id",
        severity: "error",
        message: `Duplicate component id: ${component.id}`
      });
    }
    componentIds.add(component.id);
  });

  for (let index = 0; index < (scene.components || []).length; index += 1) {
    const left = scene.components[index];
    const leftBox = ensureBBox(left.bbox);
    for (let inner = index + 1; inner < (scene.components || []).length; inner += 1) {
      const right = scene.components[inner];
      const rightBox = ensureBBox(right.bbox);
      const overlapArea = bboxOverlapArea(leftBox, rightBox);
      if (overlapArea > 36) {
        issues.push({
          code: "component_bbox_overlap",
          severity: "warning",
          message: `Components ${left.id} and ${right.id} overlap in layout space`
        });
      }
    }
  }

  (scene.wires || []).forEach((wire) => {
    if (wire?.hidden || wire?.topology_role === "internal_symbol") return;
    const route = wire.route || {};
    const points = ensureArray(route.points);

    ["from", "to"].forEach((side) => {
      const ref = wire[side];
      if (!ref || typeof ref !== "string") return;
      const componentId = ref.split(".")[0];
      referencedComponents.add(componentId);
      const junctionExists = (scene.junctions || []).some((junction) => junction.id === ref || junction.id === componentId);
      if (!componentIds.has(componentId) && !junctionExists) {
        issues.push({
          code: "missing_wire_component_ref",
          severity: "error",
          message: `Wire ${wire.id} references missing component ${ref}`
        });
        return;
      }

      if (route.kind === "polyline" && points.length) {
        const anchor = resolveAnchorPoint(scene, ref);
        const nearestDistance = anchor
          ? Math.min(...points.map((point) => distance(anchor, point)))
          : Number.POSITIVE_INFINITY;
        if (anchor && nearestDistance > 18) {
          issues.push({
            code: "wire_endpoint_not_snapped",
            severity: "warning",
            message: `Wire ${wire.id} does not pass through ${ref}`
          });
        }

        const endpoint = side === "from" ? points[0] : points[points.length - 1];
        if (anchor && endpoint && distance(anchor, endpoint) > 1.5) {
          issues.push({
            code: "wire_endpoint_dangling",
            severity: "warning",
            message: `Wire ${wire.id} endpoint is not locked to ${ref}`
          });
        }
      }
    });

    if (route.kind === "polyline") {
      if (points.length < 2) {
        issues.push({
          code: "wire_too_short",
          severity: "warning",
          message: `Wire ${wire.id} has too few route points`
        });
      }

      for (let index = 1; index < points.length; index += 1) {
        const prev = points[index - 1];
        const next = points[index];
        if (prev.x !== next.x && prev.y !== next.y) {
          issues.push({
            code: "wire_has_diagonal_segment",
            severity: "info",
            message: `Wire ${wire.id} contains a diagonal segment`
          });
          break;
        }
      }
    }
  });

  (scene.simulation?.adjustables || []).forEach((item) => {
    if (!item.component_id || !componentIds.has(item.component_id)) {
      issues.push({
        code: "adjustable_missing_component",
        severity: "error",
        message: `Adjustable ${item.id} references a missing component`
      });
    }
    if (!item.param) {
      issues.push({
        code: "adjustable_missing_param",
        severity: "error",
        message: `Adjustable ${item.id} is missing a param`
      });
    }
  });

  (scene.components || []).forEach((component) => {
    if (component.type !== "variable_resistor") return;
    const hasSliderAdjustable = (scene.simulation?.adjustables || []).some((item) =>
      item.component_id === component.id && item.param === "slider_position"
    );
    if (hasSliderAdjustable && !component.anchors?.tap) {
      issues.push({
        code: "rheostat_missing_tap_anchor",
        severity: "warning",
        message: `Variable resistor ${component.id} has slider control but no tap anchor`
      });
    }
  });

  const hasError = issues.some((item) => item.severity === "error");
  const hasWarning = issues.some((item) => item.severity === "warning");
  const allComponentsConnected = (scene.components || []).every((component) =>
    referencedComponents.has(component.id) ||
    (scene.netlist?.edges || []).some((edge) => edge.component_id === component.id)
  );

  return {
    topology_consistent: !hasError,
    all_components_connected: allComponentsConnected,
    ocr_verified: !ensureArray(scene.vision?.issues).length,
    manual_review_required: hasError || hasWarning,
    quality_gate_passed: !hasError,
    issues
  };
}

function normalizeSceneDocument(scene, meta) {
  const components = ensureArray(scene?.components).map((component, index) => {
    const bbox = ensureBBox(component?.bbox);
    const center = inferCenter(bbox, component?.center);
    const normalized = {
      id: component?.id || `component_${index + 1}`,
      type: component?.type || "unknown_component",
      label: component?.label || "",
      bbox,
      center,
      rotation: toNumber(component?.rotation, 0),
      symbol_variant: component?.symbol_variant || "",
      anchors: normalizeAnchorMap(component?.anchors, bbox, center),
      params: component?.params || {},
      label_refs: ensureArray(component?.label_refs),
      style: component?.style || {},
      sim_ref: component?.sim_ref || "",
      interactive: component?.interactive || null,
      primitives: ensureArray(component?.primitives).map(normalizePrimitive).filter(Boolean),
      confidence: component?.confidence ?? null
    };
    normalized.primitives = synthesizePrimitives(normalized);
    return normalized;
  });

  const document = {
    version: scene?.version || "1.0",
    title: scene?.title || meta.fileName,
    summary: scene?.summary || "",
    source: {
      file_name: meta.fileName,
      mime_type: meta.mimeType,
      image_width: meta.width,
      image_height: meta.height,
      byte_length: meta.byteLength || null
    },
    canvas: {
      view_box: scene?.canvas?.view_box || [0, 0, meta.width, meta.height],
      unit: scene?.canvas?.unit || "px",
      background: scene?.canvas?.background || "#ffffff",
      original_aspect_ratio: meta.height ? meta.width / meta.height : null
    },
    vision: normalizeVision(scene?.vision),
    components,
    wires: ensureArray(scene?.wires).map((wire, index) => ({
      id: wire?.id || `wire_${index + 1}`,
      from: wire?.from || null,
      to: wire?.to || null,
      net_id: wire?.net_id || null,
      route: normalizeWireRoute(wire?.route),
      style: {
        color: wire?.style?.color || DEFAULT_STROKE,
        width: toNumber(wire?.style?.width, 4.5)
      },
      stroke: wire?.stroke || null,
      topology_role: wire?.topology_role || null,
      current_candidate: Boolean(wire?.current_candidate),
      confidence: wire?.confidence ?? null
    })),
    junctions: ensureArray(scene?.junctions).map((junction, index) => ({
      id: junction?.id || `junction_${index + 1}`,
      x: toNumber(junction?.x, 0),
      y: toNumber(junction?.y, 0),
      kind: normalizeJunctionKind(junction?.kind),
      radius: toNumber(junction?.radius, 4.2)
    })),
    labels: ensureArray(scene?.labels).map((label, index) => ({
      id: label?.id || `label_${index + 1}`,
      text: label?.text || "",
      position: ensurePoint(label?.position, 0, 0),
      bbox: ensureBBox(label?.bbox),
      font_size: toNumber(label?.font_size, 18),
      rotation: toNumber(label?.rotation, 0),
      text_anchor: label?.text_anchor || "middle",
      belongs_to: label?.belongs_to || null
    })),
    netlist: normalizeNetlist(scene?.netlist),
    simulation: {
      summary: scene?.simulation?.summary || scene?.summary || "",
      adjustables: ensureArray(scene?.simulation?.adjustables).map(normalizeAdjustable),
      measurements: ensureArray(scene?.simulation?.measurements),
      initial_state: scene?.simulation?.initial_state || {},
      constraints: ensureArray(scene?.simulation?.constraints),
      solver_hint: scene?.simulation?.solver_hint || null,
      highlights: ensureArray(scene?.simulation?.highlights)
    },
    interaction: normalizeInteraction(scene?.interaction),
    rendering: normalizeRendering(scene?.rendering),
    validation: scene?.validation || {},
    normalization: {
      pipeline: ["vision_parse", "scene_normalize", "validation"],
      template: scene?.normalization?.template || "raw",
      note: scene?.normalization?.note || "Scene normalized from model output."
    }
  };

  document.validation = {
    ...validateSceneDocument(document),
    ...(scene?.validation || {})
  };
  return document;
}

module.exports = {
  normalizeSceneDocument,
  validateSceneDocument,
  ensureArray,
  ensurePoint,
  ensureBBox,
  inferCenter,
  toNumber
};
