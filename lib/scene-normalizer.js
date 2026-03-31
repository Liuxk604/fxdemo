const {
  ensureArray,
  ensurePoint,
  ensureBBox,
  inferCenter,
  toNumber,
  validateSceneDocument
} = require("./scene-document");

function clone(value) {
  return JSON.parse(JSON.stringify(value ?? null));
}

function parseAnchorRef(ref) {
  if (!ref || typeof ref !== "string") return null;
  const [componentId, anchor] = String(ref).split(".");
  if (!componentId) return null;
  return {
    componentId,
    anchor: anchor || null
  };
}

function normalizeAdjustableType(type) {
  if (type === "boolean") return "toggle";
  if (type === "slider") return "range";
  return type;
}

function getAdjustableBinding(item) {
  const target = String(item?.target || "").match(/^([A-Za-z0-9_-]+)\.params\.([A-Za-z0-9_]+)$/);
  return {
    componentId: item?.component_id || target?.[1] || null,
    param: item?.param || target?.[2] || null
  };
}

function pointEquals(a, b, epsilon = 0.5) {
  return Math.abs((a?.x || 0) - (b?.x || 0)) <= epsilon && Math.abs((a?.y || 0) - (b?.y || 0)) <= epsilon;
}

function dedupePolyline(points) {
  const next = [];
  ensureArray(points).forEach((point) => {
    const current = ensurePoint(point, 0, 0);
    const prev = next[next.length - 1];
    if (!prev || !pointEquals(prev, current)) next.push(current);
  });
  return next;
}

function orthogonalizePolyline(points) {
  const deduped = dedupePolyline(points);
  if (deduped.length <= 1) return deduped;
  const next = [deduped[0]];
  for (let index = 1; index < deduped.length; index += 1) {
    const prev = next[next.length - 1];
    const current = deduped[index];
    if (!pointEquals(prev, current) && prev.x !== current.x && prev.y !== current.y) {
      next.push({ x: current.x, y: prev.y });
    }
    next.push(current);
  }
  return dedupePolyline(next);
}

function simplifyPolyline(points) {
  const stack = [];
  dedupePolyline(points).forEach((point) => {
    stack.push(point);
    let reduced = true;
    while (reduced && stack.length >= 3) {
      reduced = false;
      const a = stack[stack.length - 3];
      const b = stack[stack.length - 2];
      const c = stack[stack.length - 1];
      const sameVertical = a.x === b.x && b.x === c.x;
      const sameHorizontal = a.y === b.y && b.y === c.y;
      if (sameVertical || sameHorizontal) {
        stack.splice(stack.length - 2, 1);
        reduced = true;
      }
    }
  });
  return dedupePolyline(stack);
}

function normalizePolyline(points) {
  return orthogonalizePolyline(points);
}

function nearestPolylinePointIndex(points, anchor, tolerance = 18) {
  let bestIndex = -1;
  let bestDistance = Number.POSITIVE_INFINITY;
  points.forEach((point, index) => {
    const distance = Math.hypot(point.x - anchor.x, point.y - anchor.y);
    if (distance <= tolerance && distance < bestDistance) {
      bestIndex = index;
      bestDistance = distance;
    }
  });
  return bestIndex;
}

function snapPolylineEndpoint(points, anchor, side) {
  const normalized = dedupePolyline(points);
  if (!anchor) return normalized;

  const index = nearestPolylinePointIndex(normalized, anchor);
  if (index === -1) {
    return side === "start"
      ? [anchor, ...normalized]
      : [...normalized, anchor];
  }

  return side === "start"
    ? [anchor, ...normalized.slice(index + 1)]
    : [...normalized.slice(0, index), anchor];
}

function componentById(scene, componentId) {
  return ensureArray(scene?.components).find((item) => item.id === componentId) || null;
}

function componentAnchor(scene, ref) {
  const parsed = parseAnchorRef(ref);
  if (!parsed) return null;
  if (!parsed.anchor) {
    const junction = ensureArray(scene?.junctions).find((item) => item.id === ref || item.id === parsed.componentId);
    if (junction) return { x: toNumber(junction.x, 0), y: toNumber(junction.y, 0) };
  }
  const component = componentById(scene, parsed.componentId);
  if (!component) return null;
  const bbox = ensureBBox(component.bbox);
  const center = inferCenter(bbox, component.center);
  const anchor = component.anchors?.[parsed.anchor];
  if (anchor) return ensurePoint(anchor, center.x, center.y);
  if (parsed.anchor === "left") return { x: bbox[0], y: center.y };
  if (parsed.anchor === "right") return { x: bbox[0] + bbox[2], y: center.y };
  if (parsed.anchor === "top") return { x: center.x, y: bbox[1] };
  if (parsed.anchor === "bottom") return { x: center.x, y: bbox[1] + bbox[3] };
  return center;
}

function collectScenePoints(scene) {
  const points = [];
  ensureArray(scene?.wires).forEach((wire) => {
    ensureArray(wire?.route?.points).forEach((point) => points.push(ensurePoint(point, 0, 0)));
  });
  ensureArray(scene?.components).forEach((component) => {
    const bbox = ensureBBox(component.bbox);
    const center = inferCenter(bbox, component.center);
    points.push({ x: bbox[0], y: bbox[1] });
    points.push({ x: bbox[0] + bbox[2], y: bbox[1] + bbox[3] });
    points.push(center);
    Object.values(component.anchors || {}).forEach((anchor) => {
      if (anchor && typeof anchor === "object" && !Array.isArray(anchor)) {
        points.push(ensurePoint(anchor, center.x, center.y));
      }
    });
  });
  ensureArray(scene?.labels).forEach((label) => {
    if (label?.position) points.push(ensurePoint(label.position, 0, 0));
  });
  return points;
}

function computeRenderViewBox(scene) {
  const points = collectScenePoints(scene);
  if (!points.length) {
    return scene?.canvas?.view_box || [0, 0, scene?.source?.image_width || 1200, scene?.source?.image_height || 800];
  }
  const minX = Math.min(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const maxX = Math.max(...points.map((point) => point.x));
  const maxY = Math.max(...points.map((point) => point.y));
  const padding = 36;
  return [
    Math.max(0, Math.floor(minX - padding)),
    Math.max(0, Math.floor(minY - padding)),
    Math.max(220, Math.ceil(maxX - minX + padding * 2)),
    Math.max(220, Math.ceil(maxY - minY + padding * 2))
  ];
}

function ensureAdjustable(scene, adjustable) {
  scene.simulation = scene.simulation || {};
  scene.simulation.adjustables = ensureArray(scene.simulation.adjustables);
  const exists = scene.simulation.adjustables.some((item) => {
    const binding = getAdjustableBinding(item);
    return binding.componentId === adjustable.component_id && binding.param === adjustable.param;
  });
  if (!exists) scene.simulation.adjustables.push(adjustable);
}

function dedupeAdjustables(scene) {
  const seen = new Set();
  scene.simulation = scene.simulation || {};
  scene.simulation.adjustables = ensureArray(scene.simulation.adjustables).filter((item, index) => {
    const binding = getAdjustableBinding(item);
    const type = normalizeAdjustableType(item?.type);
    if (!binding.componentId || !binding.param) return false;
    const component = componentById(scene, binding.componentId);
    const canonicalParam = component?.type === "variable_resistor" && ["slider_position", "slider_ratio", "position"].includes(binding.param)
      ? "slider_position"
      : binding.param;
    const key = `${binding.componentId}.${canonicalParam}.${type || "range"}`;
    if (seen.has(key)) return false;
    seen.add(key);
    item.type = type || "range";
    item.component_id = binding.componentId;
    item.param = canonicalParam;
    item.target = `${binding.componentId}.params.${canonicalParam}`;
    if (!item.id) item.id = `adjustable_${index + 1}`;
    return true;
  });
}

function getConnectedWireEndpointPoints(scene, componentId) {
  const points = [];
  ensureArray(scene?.wires).forEach((wire) => {
    const routePoints = ensureArray(wire?.route?.points);
    const from = parseAnchorRef(wire?.from);
    const to = parseAnchorRef(wire?.to);
    if (from?.componentId === componentId && to?.componentId !== componentId && routePoints.length) {
      points.push(routePoints[0]);
    }
    if (to?.componentId === componentId && from?.componentId !== componentId && routePoints.length) {
      points.push(routePoints[routePoints.length - 1]);
    }
  });
  return points.map((point) => ensurePoint(point, 0, 0));
}

function normalizeSwitch(scene, component) {
  const bbox = ensureBBox(component.bbox);
  const center = inferCenter(bbox, component.center);
  const wirePoints = getConnectedWireEndpointPoints(scene, component.id);
  const anchorLeft = ensurePoint(component.anchors?.left, bbox[0], center.y);
  const anchorRight = ensurePoint(component.anchors?.right, bbox[0] + bbox[2], center.y);
  const anchorTop = ensurePoint(component.anchors?.top, center.x, bbox[1]);
  const anchorBottom = ensurePoint(component.anchors?.bottom, center.x, bbox[1] + bbox[3]);
  const spanX = wirePoints.length
    ? Math.max(...wirePoints.map((point) => point.x)) - Math.min(...wirePoints.map((point) => point.x))
    : Math.abs(anchorRight.x - anchorLeft.x);
  const spanY = wirePoints.length
    ? Math.max(...wirePoints.map((point) => point.y)) - Math.min(...wirePoints.map((point) => point.y))
    : Math.abs(anchorBottom.y - anchorTop.y);
  const horizontal = spanX >= spanY;

  if (horizontal) {
    const ordered = (wirePoints.length ? wirePoints : [anchorLeft, anchorRight]).slice().sort((a, b) => a.x - b.x);
    const left = ensurePoint(ordered[0], anchorLeft.x, anchorLeft.y);
    const rightBase = ensurePoint(ordered[ordered.length - 1], anchorRight.x, anchorRight.y);
    const y = Math.round((ordered.reduce((sum, point) => sum + point.y, 0) / Math.max(ordered.length, 1)) || center.y);
    const right = { x: rightBase.x, y };
    const gap = Math.max(14, Math.min(24, (right.x - left.x) * 0.22 || 18));
    component.anchors = {
      ...(component.anchors || {}),
      left: { x: left.x, y },
      right,
      top: { x: (left.x + right.x) / 2, y: bbox[1] },
      bottom: { x: (left.x + right.x) / 2, y: bbox[1] + bbox[3] }
    };
    component.interactive = {
      kind: "toggle_switch",
      pivot: { x: left.x, y },
      contact: { x: right.x - gap, y },
      open_tip: {
        x: right.x - Math.round(gap * 0.18),
        y: toNumber(component.interactive?.open_tip?.y, y - gap)
      }
    };
  } else {
    const ordered = (wirePoints.length ? wirePoints : [anchorTop, anchorBottom]).slice().sort((a, b) => a.y - b.y);
    const top = ensurePoint(ordered[0], center.x, anchorTop.y);
    const bottom = ensurePoint(ordered[ordered.length - 1], center.x, anchorBottom.y);
    const x = Math.round((ordered.reduce((sum, point) => sum + point.x, 0) / Math.max(ordered.length, 1)) || center.x);
    const gap = Math.max(14, Math.min(24, (bottom.y - top.y) * 0.22 || 18));
    component.anchors = {
      ...(component.anchors || {}),
      left: { x, y: top.y },
      right: { x, y: bottom.y },
      top: { x, y: top.y },
      bottom: { x, y: bottom.y }
    };
    component.interactive = {
      kind: "toggle_switch",
      pivot: { x, y: bottom.y - Math.round(gap * 0.45) },
      contact: { x, y: top.y + Math.round(gap * 0.45) },
      open_tip: {
        x: toNumber(component.interactive?.open_tip?.x, x - gap),
        y: toNumber(component.interactive?.open_tip?.y, top.y + gap)
      }
    };
  }

  component.prefer_fallback = true;
  ensureAdjustable(scene, {
    id: `adj_${component.id}`,
    label: component.label || "Switch",
    type: "toggle",
    component_id: component.id,
    param: "closed",
    target: `${component.id}.params.closed`,
    initial: Boolean(component.params?.closed)
  });
}

function findVariableResistorSliderSource(component) {
  const bbox = ensureBBox(component.bbox);
  const center = inferCenter(bbox, component.center);
  const sliderAnchor = component.anchors?.slider
    ? ensurePoint(component.anchors.slider, center.x, bbox[1] - 20)
    : null;
  const tapAnchor = component.anchors?.tap
    ? ensurePoint(component.anchors.tap, center.x, bbox[1] - 20)
    : null;
  const axisLine = ensureArray(component.primitives).find((item) => (
    item.type === "line" &&
    (
      Math.abs(toNumber(item.x1, 0) - toNumber(item.x2, 0)) <= 6 ||
      Math.abs(toNumber(item.y1, 0) - toNumber(item.y2, 0)) <= 6
    )
  ));
  return {
    sliderAnchor,
    tapAnchor,
    axisLine
  };
}

function normalizeVariableResistorConnections(scene, component) {
  const sliderAnchors = new Set(["slider", "slider_top", "slider_contact", "tap"]);
  scene.wires = ensureArray(scene.wires).filter((wire) => {
    const from = parseAnchorRef(wire?.from);
    const to = parseAnchorRef(wire?.to);
    if (!from || !to) return true;
    const isSelfWire = from.componentId === component.id && to.componentId === component.id;
    if (isSelfWire && (sliderAnchors.has(from.anchor) || sliderAnchors.has(to.anchor))) {
      wire.topology_role = "internal_symbol";
      wire.hidden = true;
      return true;
    }
    return true;
  });

  ensureArray(scene.wires).forEach((wire) => {
    const from = parseAnchorRef(wire?.from);
    const to = parseAnchorRef(wire?.to);
    if (from?.componentId === component.id && sliderAnchors.has(from.anchor) && to?.componentId !== component.id) {
      wire.from = `${component.id}.tap`;
    }
    if (to?.componentId === component.id && sliderAnchors.has(to.anchor) && from?.componentId !== component.id) {
      wire.to = `${component.id}.tap`;
    }
  });
}

function normalizeVariableResistor(scene, component) {
  const bbox = ensureBBox(component.bbox);
  const center = inferCenter(bbox, component.center);
  const left = ensurePoint(component.anchors?.left, bbox[0], center.y);
  const right = ensurePoint(component.anchors?.right, bbox[0] + bbox[2], center.y);
  const top = ensurePoint(component.anchors?.top, center.x, bbox[1]);
  const bottom = ensurePoint(component.anchors?.bottom, center.x, bbox[1] + bbox[3]);
  const horizontal = Math.abs(right.x - left.x) >= Math.abs(bottom.y - top.y);
  const sliderSource = findVariableResistorSliderSource(component);

  if (horizontal) {
    const minX = bbox[0] + 10;
    const maxX = bbox[0] + bbox[2] - 10;
    const sourceX = sliderSource.sliderAnchor?.x ?? sliderSource.tapAnchor?.x ?? toNumber(sliderSource.axisLine?.x1, center.x);
    const tapY = Math.min(
      sliderSource.tapAnchor?.y ?? Number.POSITIVE_INFINITY,
      sliderSource.sliderAnchor?.y ?? Number.POSITIVE_INFINITY,
      sliderSource.axisLine
        ? Math.min(toNumber(sliderSource.axisLine?.y1, bbox[1] - 18), toNumber(sliderSource.axisLine?.y2, bbox[1] - 18))
        : Number.POSITIVE_INFINITY,
      bbox[1] - 18
    );
    const ratio = Math.max(
      0,
      Math.min(
        1,
        Number(
          component.params?.slider_position ??
          component.params?.slider_ratio ??
          ((sourceX - minX) / Math.max(1, maxX - minX))
        )
      )
    );
    const handleX = minX + (maxX - minX) * ratio;
    const branchY = ensurePoint(component.anchors?.left, left.x, center.y).y;

    component.anchors = {
      ...(component.anchors || {}),
      left: { x: bbox[0], y: branchY },
      right: { x: bbox[0] + bbox[2], y: branchY },
      body_left: { x: bbox[0], y: branchY },
      body_right: { x: bbox[0] + bbox[2], y: branchY },
      slider: { x: handleX, y: branchY },
      slider_top: { x: handleX, y: tapY },
      tap: { x: handleX, y: tapY }
    };
    component.interactive = {
      kind: "slider",
      axis: "x",
      track: {
        x1: minX,
        y1: tapY,
        x2: maxX,
        y2: tapY
      },
      handle: {
        x: handleX,
        y: tapY
      }
    };
    component.params = {
      ...(component.params || {}),
      slider_position: ratio,
      slider_ratio: ratio,
      connection_mode: component.params?.connection_mode || "tap_to_right"
    };
  } else {
    const minY = bbox[1] + 10;
    const maxY = bbox[1] + bbox[3] - 10;
    const sourceY = sliderSource.sliderAnchor?.y ?? sliderSource.tapAnchor?.y ?? toNumber(sliderSource.axisLine?.y1, center.y);
    const tapX = Math.min(
      sliderSource.tapAnchor?.x ?? Number.POSITIVE_INFINITY,
      sliderSource.sliderAnchor?.x ?? Number.POSITIVE_INFINITY,
      sliderSource.axisLine
        ? Math.min(toNumber(sliderSource.axisLine?.x1, bbox[0] - 18), toNumber(sliderSource.axisLine?.x2, bbox[0] - 18))
        : Number.POSITIVE_INFINITY,
      bbox[0] - 18
    );
    const ratio = Math.max(
      0,
      Math.min(
        1,
        Number(
          component.params?.slider_position ??
          component.params?.slider_ratio ??
          ((sourceY - minY) / Math.max(1, maxY - minY))
        )
      )
    );
    const handleY = minY + (maxY - minY) * ratio;
    const branchX = ensurePoint(component.anchors?.top, center.x, top.y).x;

    component.anchors = {
      ...(component.anchors || {}),
      top: { x: branchX, y: bbox[1] },
      bottom: { x: branchX, y: bbox[1] + bbox[3] },
      body_top: { x: branchX, y: bbox[1] },
      body_bottom: { x: branchX, y: bbox[1] + bbox[3] },
      slider: { x: branchX, y: handleY },
      slider_left: { x: tapX, y: handleY },
      tap: { x: tapX, y: handleY }
    };
    component.interactive = {
      kind: "slider",
      axis: "y",
      track: {
        x1: tapX,
        y1: minY,
        x2: tapX,
        y2: maxY
      },
      handle: {
        x: tapX,
        y: handleY
      }
    };
    component.params = {
      ...(component.params || {}),
      slider_position: ratio,
      slider_ratio: ratio,
      connection_mode: component.params?.connection_mode || "tap_to_bottom"
    };
  }

  component.prefer_fallback = true;
  ensureAdjustable(scene, {
    id: `adj_${component.id}`,
    label: component.label ? `${component.label} slider` : "Slider P",
    type: "range",
    component_id: component.id,
    param: "slider_position",
    target: `${component.id}.params.slider_position`,
    min: 0,
    max: 1,
    step: 0.01,
    initial: Number(component.params?.slider_position ?? 0.5)
  });
  normalizeVariableResistorConnections(scene, component);
}

function normalizeBattery(component) {
  const bbox = ensureBBox(component.bbox);
  const center = inferCenter(bbox, component.center);
  const negative = ensurePoint(component.anchors?.negative || component.anchors?.left, bbox[0], center.y);
  const positive = ensurePoint(component.anchors?.positive || component.anchors?.right, bbox[0] + bbox[2], center.y);
  const horizontal = Math.abs(positive.x - negative.x) >= Math.abs(positive.y - negative.y);
  if (horizontal) {
    const leftX = Math.min(negative.x, positive.x);
    const rightX = Math.max(negative.x, positive.x);
    component.anchors = {
      ...(component.anchors || {}),
      left: { x: leftX, y: center.y },
      right: { x: rightX, y: center.y },
      negative,
      positive,
      top: { x: center.x, y: bbox[1] },
      bottom: { x: center.x, y: bbox[1] + bbox[3] }
    };
  } else {
    const topY = Math.min(negative.y, positive.y);
    const bottomY = Math.max(negative.y, positive.y);
    component.anchors = {
      ...(component.anchors || {}),
      top: { x: center.x, y: topY },
      bottom: { x: center.x, y: bottomY },
      left: { x: bbox[0], y: center.y },
      right: { x: bbox[0] + bbox[2], y: center.y },
      negative,
      positive
    };
  }
  component.prefer_fallback = true;
}

function normalizeMeter(component) {
  const bbox = ensureBBox(component.bbox);
  const center = inferCenter(bbox, component.center);
  component.anchors = {
    ...(component.anchors || {}),
    left: ensurePoint(component.anchors?.left, bbox[0], center.y),
    right: ensurePoint(component.anchors?.right, bbox[0] + bbox[2], center.y),
    top: ensurePoint(component.anchors?.top, center.x, bbox[1]),
    bottom: ensurePoint(component.anchors?.bottom, center.x, bbox[1] + bbox[3])
  };
  const primitives = ensureArray(component.primitives);
  const circleOnly = primitives.length > 0 && primitives.every((item) => item.type === "circle");
  if (!primitives.length || circleOnly) component.prefer_fallback = true;
}

function normalizeWires(scene) {
  ensureArray(scene.wires).forEach((wire) => {
    if (wire?.route?.kind !== "polyline") return;
    let points = normalizePolyline(wire.route.points || []);
    if (!points.length) {
      const start = componentAnchor(scene, wire.from);
      const end = componentAnchor(scene, wire.to);
      if (start && end) points = normalizePolyline([start, end]);
    }

    const start = componentAnchor(scene, wire.from);
    const end = componentAnchor(scene, wire.to);
    points = snapPolylineEndpoint(points, start, "start");
    points = snapPolylineEndpoint(points, end, "end");

    if (start && end && points.length < 2) {
      points = [start, end];
    }

    wire.route.points = simplifyPolyline(normalizePolyline(points));
  });
}

function classifySceneTemplate(scene) {
  const counts = ensureArray(scene?.components).reduce((acc, component) => {
    acc[component.type] = (acc[component.type] || 0) + 1;
    return acc;
  }, {});

  if (
    counts.variable_resistor === 1 &&
    counts.voltmeter >= 1 &&
    counts.ammeter >= 1 &&
    counts.battery === 1 &&
    counts.switch >= 1 &&
    counts.resistor >= 1
  ) {
    return "rheostat_measurement";
  }

  if (counts.switch >= 3 && counts.resistor >= 2 && counts.battery === 1) {
    return "multi_switch_network";
  }

  return "generic";
}

function buildResolvedPayload(scene, template) {
  const ports = {};
  ensureArray(scene.components).forEach((component) => {
    Object.entries(component.anchors || {}).forEach(([anchor, point]) => {
      if (!point || typeof point !== "object" || Array.isArray(point)) return;
      ports[`${component.id}.${anchor}`] = ensurePoint(point, 0, 0);
    });
  });

  return {
    template,
    render_view_box: scene.render_view_box,
    ports,
    component_geometry: ensureArray(scene.components).map((component) => ({
      id: component.id,
      type: component.type,
      bbox: component.bbox,
      center: component.center,
      anchors: clone(component.anchors),
      interactive: clone(component.interactive),
      prefer_fallback: Boolean(component.prefer_fallback)
    })),
    route_graph: ensureArray(scene.wires).map((wire) => ({
      id: wire.id,
      from: wire.from,
      to: wire.to,
      topology_role: wire.topology_role || null,
      hidden: Boolean(wire.hidden),
      route: clone(wire.route)
    }))
  };
}

function normalizeResolvedScene(scene) {
  const next = clone(scene) || {};
  next.components = ensureArray(next.components);
  next.wires = ensureArray(next.wires);

  dedupeAdjustables(next);

  next.components.forEach((component) => {
    if (component.type === "switch") normalizeSwitch(next, component);
    if (component.type === "variable_resistor") normalizeVariableResistor(next, component);
    if (component.type === "battery") normalizeBattery(component);
    if (component.type === "ammeter" || component.type === "voltmeter") normalizeMeter(component);
  });

  dedupeAdjustables(next);
  normalizeWires(next);
  next.render_view_box = computeRenderViewBox(next);

  const template = classifySceneTemplate(next);
  next.resolved = buildResolvedPayload(next, template);
  next.normalization = {
    ...(next.normalization || {}),
    pipeline: [...new Set([...(ensureArray(next.normalization?.pipeline)), "scene_resolve", "wire_snap"])],
    template,
    note: next.validation?.quality_gate_passed
      ? "Server-side geometry normalization resolved ports, interaction anchors, and wire snapping."
      : "Server-side geometry normalization completed, but validation still reports structural risk."
  };

  const previousValidation = next.validation || {};
  next.validation = {
    ...previousValidation,
    ...validateSceneDocument(next),
    upstream_issues: ensureArray(previousValidation.issues)
  };

  return next;
}

module.exports = {
  normalizeResolvedScene
};
