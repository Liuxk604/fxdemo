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

function polylineBendCount(points) {
  const normalized = dedupePolyline(points);
  let bends = 0;
  for (let index = 1; index < normalized.length - 1; index += 1) {
    const prev = normalized[index - 1];
    const current = normalized[index];
    const next = normalized[index + 1];
    const entersHorizontal = prev.y === current.y;
    const exitsHorizontal = current.y === next.y;
    if (entersHorizontal !== exitsHorizontal) bends += 1;
  }
  return bends;
}

function collapseDetourToElbow(points, tolerance = 18) {
  const normalized = simplifyPolyline(orthogonalizePolyline(points));
  if (normalized.length <= 3) return normalized;

  const start = normalized[0];
  const end = normalized[normalized.length - 1];
  if (pointEquals(start, end)) return [start];
  if (start.x === end.x || start.y === end.y) return [start, end];

  const interior = normalized.slice(1, -1);
  const minX = Math.min(start.x, end.x) - tolerance;
  const maxX = Math.max(start.x, end.x) + tolerance;
  const minY = Math.min(start.y, end.y) - tolerance;
  const maxY = Math.max(start.y, end.y) + tolerance;
  const staysInCorridor = interior.every((point) =>
    point.x >= minX &&
    point.x <= maxX &&
    point.y >= minY &&
    point.y <= maxY
  );

  if (!staysInCorridor || polylineBendCount(normalized) < 2) {
    return normalized;
  }

  const focus = interior[Math.floor(interior.length / 2)] || interior[0];
  const candidates = [
    simplifyPolyline([start, { x: end.x, y: start.y }, end]),
    simplifyPolyline([start, { x: start.x, y: end.y }, end])
  ];

  candidates.sort((left, right) => {
    const leftElbow = left[1] || start;
    const rightElbow = right[1] || start;
    const leftScore = Math.abs(leftElbow.x - focus.x) + Math.abs(leftElbow.y - focus.y);
    const rightScore = Math.abs(rightElbow.x - focus.x) + Math.abs(rightElbow.y - focus.y);
    return leftScore - rightScore;
  });

  return candidates[0];
}

function normalizePolyline(points) {
  return collapseDetourToElbow(orthogonalizePolyline(points));
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
  const padding = 18;
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

function clampNumber(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function getCanvasBounds(scene) {
  const viewBox = Array.isArray(scene?.canvas?.view_box) && scene.canvas.view_box.length === 4
    ? scene.canvas.view_box
    : [0, 0, scene?.source?.image_width || 1200, scene?.source?.image_height || 800];
  return {
    minX: toNumber(viewBox[0], 0),
    minY: toNumber(viewBox[1], 0),
    maxX: toNumber(viewBox[0], 0) + toNumber(viewBox[2], scene?.source?.image_width || 1200),
    maxY: toNumber(viewBox[1], 0) + toNumber(viewBox[3], scene?.source?.image_height || 800)
  };
}

function clampPointToBounds(point, bounds, padding = 0) {
  return {
    x: clampNumber(toNumber(point?.x, bounds.minX), bounds.minX + padding, bounds.maxX - padding),
    y: clampNumber(toNumber(point?.y, bounds.minY), bounds.minY + padding, bounds.maxY - padding)
  };
}

function clampBBoxToBounds(bbox, bounds) {
  const width = clampNumber(toNumber(bbox?.[2], 60), 12, Math.max(12, bounds.maxX - bounds.minX));
  const height = clampNumber(toNumber(bbox?.[3], 40), 12, Math.max(12, bounds.maxY - bounds.minY));
  const x = clampNumber(toNumber(bbox?.[0], bounds.minX), bounds.minX, bounds.maxX - width);
  const y = clampNumber(toNumber(bbox?.[1], bounds.minY), bounds.minY, bounds.maxY - height);
  return [x, y, width, height];
}

function pointNearBBox(point, bbox, padding = 48) {
  return point.x >= bbox[0] - padding &&
    point.x <= bbox[0] + bbox[2] + padding &&
    point.y >= bbox[1] - padding &&
    point.y <= bbox[1] + bbox[3] + padding;
}

function clampSpan(value, fallback, min, max) {
  const next = toNumber(value, fallback);
  if (!Number.isFinite(next)) return fallback;
  return clampNumber(next, min, max);
}

function getConnectedWireEndpointPoints(scene, componentId, bbox = null) {
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
  const normalized = points.map((point) => ensurePoint(point, 0, 0));
  if (!bbox) return normalized;
  const nearby = normalized.filter((point) => pointNearBBox(point, bbox, clampSpan(Math.max(bbox[2], bbox[3]), 48, 32, 72)));
  return nearby.length ? nearby : normalized;
}

function bboxOutOfBounds(bbox, bounds, padding = 2) {
  return bbox[0] < bounds.minX - padding ||
    bbox[1] < bounds.minY - padding ||
    bbox[0] + bbox[2] > bounds.maxX + padding ||
    bbox[1] + bbox[3] > bounds.maxY + padding;
}

function componentMaxOverlap(scene, component) {
  const bbox = ensureBBox(component.bbox);
  let maxOverlap = 0;
  ensureArray(scene?.components).forEach((other) => {
    if (!other || other.id === component.id) return;
    const right = ensureBBox(other.bbox);
    const overlapWidth = Math.max(0, Math.min(bbox[0] + bbox[2], right[0] + right[2]) - Math.max(bbox[0], right[0]));
    const overlapHeight = Math.max(0, Math.min(bbox[1] + bbox[3], right[1] + right[3]) - Math.max(bbox[1], right[1]));
    maxOverlap = Math.max(maxOverlap, overlapWidth * overlapHeight);
  });
  return maxOverlap;
}

function componentNeedsGeometryRescue(scene, component, options = {}) {
  const bounds = getCanvasBounds(scene);
  const bbox = ensureBBox(component.bbox);
  const center = inferCenter(bbox, component.center);
  const maxOverlap = componentMaxOverlap(scene, component);
  const area = bbox[2] * bbox[3];
  const anchors = component.anchors || {};
  const anchorValues = Object.values(anchors).filter((point) => point && typeof point === "object" && !Array.isArray(point));
  const anchorsOutside = anchorValues.some((point) =>
    point.x < bounds.minX - 6 ||
    point.x > bounds.maxX + 6 ||
    point.y < bounds.minY - 6 ||
    point.y > bounds.maxY + 6
  );

  if (bboxOutOfBounds(bbox, bounds) || anchorsOutside) return true;
  if (maxOverlap > (options.maxOverlap ?? 36)) return true;
  if (bbox[2] > (options.maxWidth ?? 9999) || bbox[3] > (options.maxHeight ?? 9999)) return true;
  if (area > (options.maxArea ?? 999999)) return true;
  if (!Number.isFinite(center.x) || !Number.isFinite(center.y)) return true;
  if (options.requireInteractive && !component.interactive) return true;
  return false;
}

function normalizeSwitch(scene, component) {
  const bbox = ensureBBox(component.bbox);
  const center = inferCenter(bbox, component.center);
  const bounds = getCanvasBounds(scene);
  const wirePoints = getConnectedWireEndpointPoints(scene, component.id, bbox);
  const anchorLeft = ensurePoint(component.anchors?.left, bbox[0], center.y);
  const anchorRight = ensurePoint(component.anchors?.right, bbox[0] + bbox[2], center.y);
  const anchorTop = ensurePoint(component.anchors?.top, center.x, bbox[1]);
  const anchorBottom = ensurePoint(component.anchors?.bottom, center.x, bbox[1] + bbox[3]);
  const bboxHorizontal = bbox[2] >= bbox[3];
  const spanX = wirePoints.length >= 2
    ? Math.max(...wirePoints.map((point) => point.x)) - Math.min(...wirePoints.map((point) => point.x))
    : Math.abs(anchorRight.x - anchorLeft.x);
  const spanY = wirePoints.length >= 2
    ? Math.max(...wirePoints.map((point) => point.y)) - Math.min(...wirePoints.map((point) => point.y))
    : Math.abs(anchorBottom.y - anchorTop.y);
  const suspiciousHorizontalSpan = spanX > clampSpan(bbox[2] * 3, 120, 96, 180);
  const suspiciousVerticalSpan = spanY > clampSpan(bbox[3] * 3, 120, 96, 180);
  const useWirePoints = wirePoints.length >= 2 && !(suspiciousHorizontalSpan || suspiciousVerticalSpan);
  const needsRescue = componentNeedsGeometryRescue(scene, component, {
    maxWidth: 96,
    maxHeight: 96,
    maxArea: 5200,
    requireInteractive: true
  }) || suspiciousHorizontalSpan || suspiciousVerticalSpan;

  if (!needsRescue) {
    component.anchors = {
      ...(component.anchors || {}),
      left: ensurePoint(component.anchors?.left, bbox[0], center.y),
      right: ensurePoint(component.anchors?.right, bbox[0] + bbox[2], center.y),
      top: ensurePoint(component.anchors?.top, center.x, bbox[1]),
      bottom: ensurePoint(component.anchors?.bottom, center.x, bbox[1] + bbox[3])
    };
    component.interactive = {
      ...(component.interactive || {}),
      pivot: ensurePoint(component.interactive?.pivot, component.anchors.left.x, component.anchors.left.y),
      contact: ensurePoint(component.interactive?.contact, component.anchors.right.x, component.anchors.right.y),
      open_tip: ensurePoint(component.interactive?.open_tip, component.anchors.right.x - 18, component.anchors.right.y - 18)
    };
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
    return;
  }

  const horizontal = useWirePoints ? spanX >= spanY : bboxHorizontal;

  if (horizontal) {
    const ordered = (useWirePoints ? wirePoints : [anchorLeft, anchorRight]).slice().sort((a, b) => a.x - b.x);
    const y = clampNumber(
      Math.round((ordered.reduce((sum, point) => sum + point.y, 0) / Math.max(ordered.length, 1)) || center.y),
      bounds.minY + 16,
      bounds.maxY - 16
    );
    const halfWidth = clampSpan(
      useWirePoints ? spanX / 2 : bbox[2] / 2,
      bbox[2] / 2,
      18,
      48
    );
    const left = clampPointToBounds({ x: center.x - halfWidth, y }, bounds, 8);
    const right = clampPointToBounds({ x: center.x + halfWidth, y }, bounds, 8);
    const gap = Math.max(14, Math.min(24, (right.x - left.x) * 0.22 || 18));
    component.bbox = clampBBoxToBounds([left.x, y - 18, Math.max(24, right.x - left.x), 36], bounds);
    component.center = { x: (left.x + right.x) / 2, y };
    component.anchors = {
      ...(component.anchors || {}),
      left: { x: left.x, y },
      right,
      top: { x: (left.x + right.x) / 2, y: component.bbox[1] },
      bottom: { x: (left.x + right.x) / 2, y: component.bbox[1] + component.bbox[3] }
    };
    component.interactive = {
      kind: "toggle_switch",
      pivot: { x: left.x, y },
      contact: { x: right.x - gap, y },
      open_tip: {
        x: right.x - Math.round(gap * 0.18),
        y: clampNumber(toNumber(component.interactive?.open_tip?.y, y - gap), bounds.minY + 8, bounds.maxY - 8)
      }
    };
  } else {
    const ordered = (useWirePoints ? wirePoints : [anchorTop, anchorBottom]).slice().sort((a, b) => a.y - b.y);
    const x = clampNumber(
      Math.round((ordered.reduce((sum, point) => sum + point.x, 0) / Math.max(ordered.length, 1)) || center.x),
      bounds.minX + 16,
      bounds.maxX - 16
    );
    const halfHeight = clampSpan(
      useWirePoints ? spanY / 2 : bbox[3] / 2,
      bbox[3] / 2,
      18,
      48
    );
    const top = clampPointToBounds({ x, y: center.y - halfHeight }, bounds, 8);
    const bottom = clampPointToBounds({ x, y: center.y + halfHeight }, bounds, 8);
    const gap = Math.max(14, Math.min(24, (bottom.y - top.y) * 0.22 || 18));
    component.bbox = clampBBoxToBounds([x - 18, top.y, 36, Math.max(24, bottom.y - top.y)], bounds);
    component.center = { x, y: (top.y + bottom.y) / 2 };
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
        x: clampNumber(toNumber(component.interactive?.open_tip?.x, x - gap), bounds.minX + 8, bounds.maxX - 8),
        y: clampNumber(toNumber(component.interactive?.open_tip?.y, top.y + gap), bounds.minY + 8, bounds.maxY - 8)
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

function normalizeLamp(scene, component) {
  const bbox = ensureBBox(component.bbox);
  const bounds = getCanvasBounds(scene);
  if (!componentNeedsGeometryRescue(scene, component, { maxWidth: 72, maxHeight: 72, maxArea: 5200 })) {
    return;
  }
  const wirePoints = getConnectedWireEndpointPoints(scene, component.id, bbox);
  const bboxHorizontal = bbox[2] >= bbox[3];
  const spanX = wirePoints.length >= 2
    ? Math.max(...wirePoints.map((point) => point.x)) - Math.min(...wirePoints.map((point) => point.x))
    : bbox[2];
  const spanY = wirePoints.length >= 2
    ? Math.max(...wirePoints.map((point) => point.y)) - Math.min(...wirePoints.map((point) => point.y))
    : bbox[3];
  const horizontal = wirePoints.length >= 2 ? spanX >= spanY : bboxHorizontal;
  const center = wirePoints.length >= 2
    ? clampPointToBounds({
        x: horizontal
          ? (Math.min(...wirePoints.map((point) => point.x)) + Math.max(...wirePoints.map((point) => point.x))) / 2
          : Math.round((wirePoints.reduce((sum, point) => sum + point.x, 0) / wirePoints.length) || inferCenter(bbox, component.center).x),
        y: horizontal
          ? Math.round((wirePoints.reduce((sum, point) => sum + point.y, 0) / wirePoints.length) || inferCenter(bbox, component.center).y)
          : (Math.min(...wirePoints.map((point) => point.y)) + Math.max(...wirePoints.map((point) => point.y))) / 2
      }, bounds, 10)
    : clampPointToBounds(inferCenter(bbox, component.center), bounds, 10);
  const radius = clampSpan(Math.min(bbox[2], bbox[3]) / 2, 18, 14, 26);
  const lead = 10;

  component.bbox = clampBBoxToBounds([center.x - radius, center.y - radius, radius * 2, radius * 2], bounds);
  component.center = center;
  if (horizontal) {
    component.anchors = {
      ...(component.anchors || {}),
      left: clampPointToBounds({ x: center.x - radius - lead, y: center.y }, bounds, 6),
      right: clampPointToBounds({ x: center.x + radius + lead, y: center.y }, bounds, 6),
      top: clampPointToBounds({ x: center.x, y: center.y - radius }, bounds, 6),
      bottom: clampPointToBounds({ x: center.x, y: center.y + radius }, bounds, 6)
    };
  } else {
    component.anchors = {
      ...(component.anchors || {}),
      top: clampPointToBounds({ x: center.x, y: center.y - radius - lead }, bounds, 6),
      bottom: clampPointToBounds({ x: center.x, y: center.y + radius + lead }, bounds, 6),
      left: clampPointToBounds({ x: center.x - radius, y: center.y }, bounds, 6),
      right: clampPointToBounds({ x: center.x + radius, y: center.y }, bounds, 6)
    };
  }
  component.prefer_fallback = true;
}

function normalizeResistor(scene, component) {
  const bbox = ensureBBox(component.bbox);
  const bounds = getCanvasBounds(scene);
  if (!componentNeedsGeometryRescue(scene, component, { maxWidth: 140, maxHeight: 64, maxArea: 7200 })) {
    return;
  }
  const wirePoints = getConnectedWireEndpointPoints(scene, component.id, bbox);
  const bboxHorizontal = bbox[2] >= bbox[3];
  const spanX = wirePoints.length >= 2
    ? Math.max(...wirePoints.map((point) => point.x)) - Math.min(...wirePoints.map((point) => point.x))
    : bbox[2];
  const spanY = wirePoints.length >= 2
    ? Math.max(...wirePoints.map((point) => point.y)) - Math.min(...wirePoints.map((point) => point.y))
    : bbox[3];
  const horizontal = wirePoints.length >= 2 ? spanX >= spanY : bboxHorizontal;
  const rawCenter = inferCenter(bbox, component.center);
  const center = wirePoints.length >= 2
    ? clampPointToBounds({
        x: horizontal
          ? (Math.min(...wirePoints.map((point) => point.x)) + Math.max(...wirePoints.map((point) => point.x))) / 2
          : Math.round((wirePoints.reduce((sum, point) => sum + point.x, 0) / wirePoints.length) || rawCenter.x),
        y: horizontal
          ? Math.round((wirePoints.reduce((sum, point) => sum + point.y, 0) / wirePoints.length) || rawCenter.y)
          : (Math.min(...wirePoints.map((point) => point.y)) + Math.max(...wirePoints.map((point) => point.y))) / 2
      }, bounds, 10)
    : clampPointToBounds(rawCenter, bounds, 10);
  const bodyWidth = clampSpan(horizontal ? bbox[2] : bbox[3], 58, 34, 88);
  const bodyHeight = clampSpan(horizontal ? bbox[3] : bbox[2], 24, 18, 34);
  const lead = 10;

  if (horizontal) {
    component.bbox = clampBBoxToBounds([center.x - bodyWidth / 2, center.y - bodyHeight / 2, bodyWidth, bodyHeight], bounds);
    component.center = center;
    component.anchors = {
      ...(component.anchors || {}),
      left: clampPointToBounds({ x: center.x - bodyWidth / 2 - lead, y: center.y }, bounds, 6),
      right: clampPointToBounds({ x: center.x + bodyWidth / 2 + lead, y: center.y }, bounds, 6),
      top: clampPointToBounds({ x: center.x, y: center.y - bodyHeight / 2 }, bounds, 6),
      bottom: clampPointToBounds({ x: center.x, y: center.y + bodyHeight / 2 }, bounds, 6)
    };
  } else {
    component.bbox = clampBBoxToBounds([center.x - bodyHeight / 2, center.y - bodyWidth / 2, bodyHeight, bodyWidth], bounds);
    component.center = center;
    component.anchors = {
      ...(component.anchors || {}),
      top: clampPointToBounds({ x: center.x, y: center.y - bodyWidth / 2 - lead }, bounds, 6),
      bottom: clampPointToBounds({ x: center.x, y: center.y + bodyWidth / 2 + lead }, bounds, 6),
      left: clampPointToBounds({ x: center.x - bodyHeight / 2, y: center.y }, bounds, 6),
      right: clampPointToBounds({ x: center.x + bodyHeight / 2, y: center.y }, bounds, 6)
    };
  }
  component.prefer_fallback = true;
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
  const needsRescue = componentNeedsGeometryRescue(scene, component, {
    maxWidth: 180,
    maxHeight: 90,
    maxArea: 9000,
    requireInteractive: true
  });

  if (!needsRescue) {
    const ratio = Math.max(
      0,
      Math.min(
        1,
        Number(component.params?.slider_position ?? component.params?.slider_ratio ?? 0.5)
      )
    );
    const track = component.interactive?.track || (
      horizontal
        ? {
            x1: bbox[0] + 10,
            y1: bbox[1] - 18,
            x2: bbox[0] + bbox[2] - 10,
            y2: bbox[1] - 18
          }
        : {
            x1: bbox[0] - 18,
            y1: bbox[1] + 10,
            x2: bbox[0] - 18,
            y2: bbox[1] + bbox[3] - 10
          }
    );
    const handle = component.interactive?.handle || (
      horizontal
        ? { x: track.x1 + (track.x2 - track.x1) * ratio, y: track.y1 }
        : { x: track.x1, y: track.y1 + (track.y2 - track.y1) * ratio }
    );
    component.anchors = {
      ...(component.anchors || {}),
      body_left: ensurePoint(component.anchors?.body_left, left.x, left.y),
      body_right: ensurePoint(component.anchors?.body_right, right.x, right.y),
      slider: horizontal
        ? { x: handle.x, y: left.y }
        : { x: top.x, y: handle.y },
      tap: { x: handle.x, y: handle.y }
    };
    if (horizontal) {
      component.anchors.slider_top = { x: handle.x, y: handle.y };
    } else {
      component.anchors.slider_left = { x: handle.x, y: handle.y };
    }
    component.interactive = {
      ...(component.interactive || {}),
      track,
      handle
    };
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
      initial: Number(component.params?.slider_position ?? component.params?.slider_ratio ?? 0.5)
    });
    normalizeVariableResistorConnections(scene, component);
    return;
  }

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
  const scene = arguments[0] && arguments[1] ? arguments[0] : null;
  const current = arguments[1] || arguments[0];
  const bbox = ensureBBox(current.bbox);
  const center = inferCenter(bbox, current.center);
  if (scene && !componentNeedsGeometryRescue(scene, current, { maxWidth: 80, maxHeight: 120, maxArea: 4800 })) {
    current.prefer_fallback = true;
    return;
  }
  const negative = ensurePoint(current.anchors?.negative || current.anchors?.left, bbox[0], center.y);
  const positive = ensurePoint(current.anchors?.positive || current.anchors?.right, bbox[0] + bbox[2], center.y);
  const horizontal = Math.abs(positive.x - negative.x) >= Math.abs(positive.y - negative.y);
  if (horizontal) {
    const leftX = Math.min(negative.x, positive.x);
    const rightX = Math.max(negative.x, positive.x);
    current.bbox = [leftX, center.y - 18, Math.max(18, rightX - leftX), 36];
    current.center = { x: (leftX + rightX) / 2, y: center.y };
    current.anchors = {
      ...(current.anchors || {}),
      left: { x: leftX, y: center.y },
      right: { x: rightX, y: center.y },
      negative,
      positive,
      top: { x: (leftX + rightX) / 2, y: center.y - 18 },
      bottom: { x: (leftX + rightX) / 2, y: center.y + 18 }
    };
  } else {
    const topY = Math.min(negative.y, positive.y);
    const bottomY = Math.max(negative.y, positive.y);
    current.bbox = [center.x - 18, topY, 36, Math.max(18, bottomY - topY)];
    current.center = { x: center.x, y: (topY + bottomY) / 2 };
    current.anchors = {
      ...(current.anchors || {}),
      top: { x: center.x, y: topY },
      bottom: { x: center.x, y: bottomY },
      left: { x: bbox[0], y: center.y },
      right: { x: bbox[0] + bbox[2], y: center.y },
      negative,
      positive
    };
  }
  current.prefer_fallback = true;
}

function normalizeMeter(scene, component) {
  const bbox = ensureBBox(component.bbox);
  const bounds = getCanvasBounds(scene);
  if (!componentNeedsGeometryRescue(scene, component, { maxWidth: 60, maxHeight: 60, maxArea: 3600 })) {
    component.anchors = {
      ...(component.anchors || {}),
      left: ensurePoint(component.anchors?.left, bbox[0], inferCenter(bbox, component.center).y),
      right: ensurePoint(component.anchors?.right, bbox[0] + bbox[2], inferCenter(bbox, component.center).y),
      top: ensurePoint(component.anchors?.top, inferCenter(bbox, component.center).x, bbox[1]),
      bottom: ensurePoint(component.anchors?.bottom, inferCenter(bbox, component.center).x, bbox[1] + bbox[3])
    };
    const primitives = ensureArray(component.primitives);
    const circleOnly = primitives.length > 0 && primitives.every((item) => item.type === "circle");
    if (!primitives.length || circleOnly) component.prefer_fallback = true;
    return;
  }
  const wirePoints = getConnectedWireEndpointPoints(scene, component.id, bbox);
  const bboxHorizontal = bbox[2] >= bbox[3];
  const spanX = wirePoints.length >= 2
    ? Math.max(...wirePoints.map((point) => point.x)) - Math.min(...wirePoints.map((point) => point.x))
    : bbox[2];
  const spanY = wirePoints.length >= 2
    ? Math.max(...wirePoints.map((point) => point.y)) - Math.min(...wirePoints.map((point) => point.y))
    : bbox[3];
  const horizontal = wirePoints.length >= 2 ? spanX >= spanY : bboxHorizontal;
  const rawCenter = inferCenter(bbox, component.center);
  const center = wirePoints.length >= 2
    ? clampPointToBounds({
        x: horizontal
          ? (Math.min(...wirePoints.map((point) => point.x)) + Math.max(...wirePoints.map((point) => point.x))) / 2
          : Math.round((wirePoints.reduce((sum, point) => sum + point.x, 0) / wirePoints.length) || rawCenter.x),
        y: horizontal
          ? Math.round((wirePoints.reduce((sum, point) => sum + point.y, 0) / wirePoints.length) || rawCenter.y)
          : (Math.min(...wirePoints.map((point) => point.y)) + Math.max(...wirePoints.map((point) => point.y))) / 2
      }, bounds, 10)
    : clampPointToBounds(rawCenter, bounds, 10);
  const radius = clampSpan(Math.min(bbox[2], bbox[3]) / 2, 18, 14, 28);
  const halfLine = radius + 10;

  component.bbox = clampBBoxToBounds([center.x - radius, center.y - radius, radius * 2, radius * 2], bounds);
  component.center = center;
  component.anchors = {
    ...(component.anchors || {}),
    left: horizontal
      ? clampPointToBounds({ x: center.x - halfLine, y: center.y }, bounds, 6)
      : clampPointToBounds(ensurePoint(component.anchors?.left, center.x - radius, center.y), bounds, 6),
    right: horizontal
      ? clampPointToBounds({ x: center.x + halfLine, y: center.y }, bounds, 6)
      : clampPointToBounds(ensurePoint(component.anchors?.right, center.x + radius, center.y), bounds, 6),
    top: horizontal
      ? clampPointToBounds(ensurePoint(component.anchors?.top, center.x, center.y - radius), bounds, 6)
      : clampPointToBounds({ x: center.x, y: center.y - halfLine }, bounds, 6),
    bottom: horizontal
      ? clampPointToBounds(ensurePoint(component.anchors?.bottom, center.x, center.y + radius), bounds, 6)
      : clampPointToBounds({ x: center.x, y: center.y + halfLine }, bounds, 6)
  };
  const primitives = ensureArray(component.primitives);
  const circleOnly = primitives.length > 0 && primitives.every((item) => item.type === "circle");
  if (!primitives.length || circleOnly) component.prefer_fallback = true;
}

function sanitizeSceneGeometry(scene) {
  const bounds = getCanvasBounds(scene);

  ensureArray(scene.components).forEach((component) => {
    component.bbox = clampBBoxToBounds(ensureBBox(component.bbox), bounds);
    component.center = clampPointToBounds(inferCenter(component.bbox, component.center), bounds, 6);
    Object.entries(component.anchors || {}).forEach(([key, point]) => {
      if (!point || typeof point !== "object" || Array.isArray(point)) return;
      component.anchors[key] = clampPointToBounds(point, bounds, 6);
    });

    if (component.interactive?.pivot) component.interactive.pivot = clampPointToBounds(component.interactive.pivot, bounds, 6);
    if (component.interactive?.contact) component.interactive.contact = clampPointToBounds(component.interactive.contact, bounds, 6);
    if (component.interactive?.open_tip) component.interactive.open_tip = clampPointToBounds(component.interactive.open_tip, bounds, 6);
    if (component.interactive?.handle) component.interactive.handle = clampPointToBounds(component.interactive.handle, bounds, 6);
    if (component.interactive?.track) {
      component.interactive.track = {
        x1: clampNumber(toNumber(component.interactive.track.x1, bounds.minX), bounds.minX, bounds.maxX),
        y1: clampNumber(toNumber(component.interactive.track.y1, bounds.minY), bounds.minY, bounds.maxY),
        x2: clampNumber(toNumber(component.interactive.track.x2, bounds.minX), bounds.minX, bounds.maxX),
        y2: clampNumber(toNumber(component.interactive.track.y2, bounds.minY), bounds.minY, bounds.maxY)
      };
    }
  });

  ensureArray(scene.wires).forEach((wire) => {
    if (wire?.route?.kind !== "polyline") return;
    wire.route.points = ensureArray(wire.route.points).map((point) => clampPointToBounds(point, bounds, 2));
  });
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
    if (component.type === "lamp") normalizeLamp(next, component);
    if (component.type === "resistor") normalizeResistor(next, component);
    if (component.type === "switch") normalizeSwitch(next, component);
    if (component.type === "variable_resistor") normalizeVariableResistor(next, component);
    if (component.type === "battery") normalizeBattery(next, component);
    if (component.type === "ammeter" || component.type === "voltmeter") normalizeMeter(next, component);
  });

  dedupeAdjustables(next);
  sanitizeSceneGeometry(next);
  normalizeWires(next);
  sanitizeSceneGeometry(next);
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
