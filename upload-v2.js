(() => {
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
  const DEFAULT_STROKE = "#1f2e2b";

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
    if (type === "boolean") return "toggle";
    if (type === "slider") return "range";
    return type;
  }

  function parseAdjustableTarget(target) {
    const match = String(target || "").trim().match(/^([A-Za-z0-9_-]+)\.params\.([A-Za-z0-9_]+)$/);
    if (!match) return null;
    return {
      component_id: match[1],
      param: match[2]
    };
  }

  function getAdjustableBinding(item) {
    const target = parseAdjustableTarget(item?.target);
    return {
      componentId: item?.component_id || target?.component_id || null,
      param: item?.param || target?.param || null
    };
  }

  function createSceneInteractionState(scene) {
    const next = {};
    (scene?.simulation?.adjustables || []).forEach((item) => {
      const binding = getAdjustableBinding(item);
      if (!binding.componentId || !binding.param) return;
      const key = `${binding.componentId}.${binding.param}`;
      const component = (scene.components || []).find((entry) => entry.id === binding.componentId);
      const fallback = component?.params?.[binding.param];
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

  function cloneScene(scene) {
    return JSON.parse(JSON.stringify(scene || {}));
  }

  function delay(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  function isTransientFetchError(error) {
    const message = String(error?.message || "").toLowerCase();
    return message.includes("failed to fetch") || message.includes("networkerror") || message.includes("load failed");
  }

  async function fetchJsonWithRetry(url, options = {}, retries = 1) {
    let lastError = null;

    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        const response = await fetch(url, options);
        const raw = await response.text();
        let data = null;

        try {
          data = raw ? JSON.parse(raw) : null;
        } catch {
          throw new Error(`Server returned non-JSON response (${response.status})`);
        }

        return { response, data };
      } catch (error) {
        lastError = error;
        if (!isTransientFetchError(error) || attempt >= retries) break;
        await delay(600 * (attempt + 1));
      }
    }

    throw lastError;
  }

  async function checkLocalServiceHealth() {
    try {
      const { response, data } = await fetchJsonWithRetry("/api/health", {
        method: "GET",
        cache: "no-store"
      }, 0);
      return response.ok && data?.ok;
    } catch {
      return false;
    }
  }

  function sceneNumber(value, fallback = 0) {
    const next = Number(value);
    return Number.isFinite(next) ? next : fallback;
  }

  function scenePoint(point, fallbackX = 0, fallbackY = 0) {
    return {
      x: sceneNumber(point?.x, fallbackX),
      y: sceneNumber(point?.y, fallbackY)
    };
  }

  function sceneBBox(bbox) {
    if (!Array.isArray(bbox) || bbox.length !== 4) return [0, 0, 60, 40];
    return [
      sceneNumber(bbox[0], 0),
      sceneNumber(bbox[1], 0),
      Math.max(12, sceneNumber(bbox[2], 60)),
      Math.max(12, sceneNumber(bbox[3], 40))
    ];
  }

  function sceneCenter(component) {
    const bbox = sceneBBox(component?.bbox);
    return scenePoint(component?.center, bbox[0] + bbox[2] / 2, bbox[1] + bbox[3] / 2);
  }

  function componentById(scene, componentId) {
    return (scene?.components || []).find((item) => item.id === componentId) || null;
  }

  function resolvedComponentGeometry(scene, componentId) {
    return (scene?.resolved?.component_geometry || []).find((item) => item.id === componentId) || null;
  }

  function resolvedRouteGraph(scene, wireId) {
    return (scene?.resolved?.route_graph || []).find((item) => item.id === wireId) || null;
  }

  function componentAnchor(scene, ref) {
    if (!ref || typeof ref !== "string") return null;
    const resolvedAnchor = scene?.resolved?.ports?.[ref];
    if (resolvedAnchor) return scenePoint(resolvedAnchor);
    const [componentId, anchorName] = ref.split(".");
    if (!anchorName) {
      const junction = (scene?.junctions || []).find((item) => item.id === ref);
      if (junction) return { x: sceneNumber(junction.x, 0), y: sceneNumber(junction.y, 0) };
    }
    const component = componentById(scene, componentId);
    if (!component) return null;
    const bbox = sceneBBox(component.bbox);
    const center = sceneCenter(component);
    const anchor = component.anchors?.[anchorName];
    if (anchor) return scenePoint(anchor, center.x, center.y);
    if (anchorName === "left") return { x: bbox[0], y: center.y };
    if (anchorName === "right") return { x: bbox[0] + bbox[2], y: center.y };
    if (anchorName === "top") return { x: center.x, y: bbox[1] };
    if (anchorName === "bottom") return { x: center.x, y: bbox[1] + bbox[3] };
    return center;
  }

  function dedupePolyline(points) {
    const next = [];
    (points || []).forEach((point) => {
      const current = scenePoint(point);
      const prev = next[next.length - 1];
      if (!prev || prev.x !== current.x || prev.y !== current.y) next.push(current);
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
      if (prev.x !== current.x && prev.y !== current.y) {
        next.push({ x: current.x, y: prev.y });
      }
      next.push(current);
    }
    return dedupePolyline(next);
  }

  function simplifyOrthogonalPolyline(points) {
    const stack = [];
    dedupePolyline(points).forEach((point) => {
      stack.push(scenePoint(point));
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

  function uploadModelConfig() {
    return {
      label: "Poe GPT-5.4",
      model: "gpt-5.4",
      parseMode: "quality",
      repairPass: true
    };
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
    const normalized = simplifyOrthogonalPolyline(orthogonalizePolyline(points));
    if (normalized.length <= 3) return normalized;

    const start = normalized[0];
    const end = normalized[normalized.length - 1];
    if (!start || !end) return normalized;
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
      simplifyOrthogonalPolyline([start, { x: end.x, y: start.y }, end]),
      simplifyOrthogonalPolyline([start, { x: start.x, y: end.y }, end])
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

  function normalizeWirePolyline(points) {
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

  function collectScenePoints(scene) {
    const points = [];

    (scene?.wires || []).forEach((wire) => {
      (wire?.route?.points || []).forEach((point) => points.push(scenePoint(point)));
    });

    (scene?.components || []).forEach((component) => {
      const bbox = sceneBBox(component.bbox);
      const center = sceneCenter(component);
      points.push({ x: bbox[0], y: bbox[1] });
      points.push({ x: bbox[0] + bbox[2], y: bbox[1] + bbox[3] });
      points.push(center);
      Object.values(component.anchors || {}).forEach((anchor) => {
        if (anchor && typeof anchor === "object" && !Array.isArray(anchor)) {
          points.push(scenePoint(anchor, center.x, center.y));
        }
      });
    });

    (scene?.labels || []).forEach((label) => {
      if (label?.position) points.push(scenePoint(label.position));
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

  function snapWireEndpoints(scene) {
    (scene?.wires || []).forEach((wire) => {
      if (wire?.route?.kind !== "polyline") return;
      const points = dedupePolyline(wire.route.points || []);
      if (!points.length) return;
      const start = componentAnchor(scene, wire.from);
      const end = componentAnchor(scene, wire.to);
      if (start) {
        const startIndex = nearestPolylinePointIndex(points, start);
        if (startIndex >= 0) points[startIndex] = start;
      }
      if (end) {
        const endIndex = nearestPolylinePointIndex(points, end);
        if (endIndex >= 0) points[endIndex] = end;
      }
      wire.route.points = normalizeWirePolyline(points);
    });
  }

  function getWireEndpointPoints(scene, componentId) {
    const points = [];
    (scene?.wires || []).forEach((wire) => {
      const routePoints = wire?.route?.points || [];
      if (!routePoints.length) return;
      if (String(wire.from || "").startsWith(`${componentId}.`)) points.push(routePoints[0]);
      if (String(wire.to || "").startsWith(`${componentId}.`)) points.push(routePoints[routePoints.length - 1]);
    });
    return points.filter(Boolean);
  }

  function prepareSwitch(scene, component) {
    const bbox = sceneBBox(component.bbox);
    const center = sceneCenter(component);
    const wirePoints = getWireEndpointPoints(scene, component.id);
    const anchorLeft = scenePoint(component.anchors?.left, bbox[0], center.y);
    const anchorRight = scenePoint(component.anchors?.right, bbox[0] + bbox[2], center.y);
    const spanX = wirePoints.length
      ? Math.max(...wirePoints.map((point) => point.x)) - Math.min(...wirePoints.map((point) => point.x))
      : Math.abs(anchorRight.x - anchorLeft.x);
    const spanY = wirePoints.length
      ? Math.max(...wirePoints.map((point) => point.y)) - Math.min(...wirePoints.map((point) => point.y))
      : Math.abs(anchorRight.y - anchorLeft.y);
    const horizontal = spanX >= spanY;

    if (horizontal) {
      const ordered = (wirePoints.length ? wirePoints : [anchorLeft, anchorRight]).slice().sort((a, b) => a.x - b.x);
      const left = scenePoint(ordered[0], anchorLeft.x, anchorLeft.y);
      const rightBase = scenePoint(ordered[ordered.length - 1], anchorRight.x, anchorRight.y);
      const y = Math.round((ordered.reduce((sum, point) => sum + point.y, 0) / ordered.length) || center.y);
      const right = { x: rightBase.x, y };
      const gap = Math.max(14, Math.min(24, (right.x - left.x) * 0.22 || 18));
      component.anchors = {
        ...(component.anchors || {}),
        left: { x: left.x, y },
        right
      };
      component.interactive = {
        kind: "toggle_switch",
        pivot: { x: left.x, y },
        contact: { x: right.x - gap, y },
        open_tip: {
          x: right.x - Math.round(gap * 0.18),
          y: component.interactive?.open_tip?.y ?? (y - gap)
        }
      };
      component.prefer_fallback = true;
      return;
    }

    const ordered = (wirePoints.length ? wirePoints : [anchorLeft, anchorRight]).slice().sort((a, b) => a.y - b.y);
    const top = scenePoint(ordered[0], center.x, bbox[1]);
    const bottom = scenePoint(ordered[ordered.length - 1], center.x, bbox[1] + bbox[3]);
    const x = Math.round((ordered.reduce((sum, point) => sum + point.x, 0) / ordered.length) || center.x);
    const gap = Math.max(14, Math.min(24, (bottom.y - top.y) * 0.22 || 18));
    component.anchors = {
      ...(component.anchors || {}),
      top: { x, y: top.y },
      bottom: { x, y: bottom.y },
      left: { x, y: top.y },
      right: { x, y: bottom.y }
    };
    component.interactive = {
      kind: "toggle_switch",
      pivot: { x, y: bottom.y - Math.round(gap * 0.45) },
      contact: { x, y: top.y + Math.round(gap * 0.45) },
      open_tip: {
        x: component.interactive?.open_tip?.x ?? (x - gap),
        y: component.interactive?.open_tip?.y ?? (top.y + gap)
      }
    };
    component.prefer_fallback = true;
  }

  function resolveSliderSource(component) {
    const bbox = sceneBBox(component.bbox);
    const center = sceneCenter(component);
    const rawSlider = component.anchors?.slider
      ? scenePoint(component.anchors.slider, center.x, bbox[1] - 20)
      : null;
    const verticalLine = (component.primitives || []).find((item) =>
      item.type === "line" &&
      Math.abs(sceneNumber(item.x1) - sceneNumber(item.x2)) <= 6 &&
      Math.min(sceneNumber(item.y1), sceneNumber(item.y2)) <= bbox[1] + 6
    );
    return { rawSlider, verticalLine };
  }

  function ensureAdjustable(scene, adjustable) {
    scene.simulation = scene.simulation || {};
    scene.simulation.adjustables = scene.simulation.adjustables || [];
    const exists = scene.simulation.adjustables.some((item) => {
      const binding = getAdjustableBinding(item);
      return binding.componentId === adjustable.component_id && binding.param === adjustable.param;
    });
    if (!exists) scene.simulation.adjustables.push(adjustable);
  }

  function retargetTapWires(scene, component) {
    const bbox = sceneBBox(component.bbox);
    const tap = component.anchors?.tap;
    if (!tap) return;

    const rightRef = `${component.id}.right`;
    const sliderRef = `${component.id}.slider`;
    const tapRef = `${component.id}.tap`;
    const sliderX = tap.x;

    (scene?.wires || []).forEach((wire) => {
      if (wire?.route?.kind !== "polyline") return;
      const points = dedupePolyline(wire.route.points || []);
      if (!points.length) return;
      const touchesUpperBranch = points.some((point, index) =>
        index > 0 &&
        index < points.length - 1 &&
        point.y <= bbox[1] + 4 &&
        Math.abs(point.x - sliderX) <= 16
      );
      const comesFromAbove = points.some((point) => point.y <= bbox[1] - 2);
      const shouldRetarget = touchesUpperBranch || comesFromAbove;
      if (!shouldRetarget) return;

      if (wire.from === rightRef || wire.from === sliderRef) {
        wire.from = tapRef;
        points[0] = scenePoint(tap);
      }
      if (wire.to === rightRef || wire.to === sliderRef) {
        wire.to = tapRef;
        points[points.length - 1] = scenePoint(tap);
      }
      wire.route.points = orthogonalizePolyline(points);
    });
  }

  function prepareVariableResistor(scene, component) {
    const bbox = sceneBBox(component.bbox);
    const center = sceneCenter(component);
    const horizontal = bbox[2] >= bbox[3];
    if (!horizontal) {
      component.prefer_fallback = true;
      return;
    }

    const { rawSlider, verticalLine } = resolveSliderSource(component);
    const handleX = clamp(
      rawSlider?.x ?? sceneNumber(verticalLine?.x1, center.x),
      bbox[0] + 10,
      bbox[0] + bbox[2] - 10
    );
    const branchY = sceneNumber(component.anchors?.left?.y, center.y);
    const tapY = Math.min(
      rawSlider?.y ?? Number.POSITIVE_INFINITY,
      verticalLine ? Math.min(sceneNumber(verticalLine.y1), sceneNumber(verticalLine.y2)) : Number.POSITIVE_INFINITY,
      bbox[1] - 18
    );
    const ratio = clamp(
      Number(
        component.params?.slider_position ??
        component.params?.slider_ratio ??
        ((handleX - bbox[0]) / Math.max(1, bbox[2]))
      ),
      0,
      1
    );

    component.anchors = {
      ...(component.anchors || {}),
      left: scenePoint(component.anchors?.left, bbox[0], branchY),
      right: scenePoint(component.anchors?.right, bbox[0] + bbox[2], branchY),
      body_left: { x: bbox[0], y: branchY },
      body_right: { x: bbox[0] + bbox[2], y: branchY },
      slider: { x: handleX, y: branchY },
      tap: { x: handleX, y: tapY }
    };
    component.params = {
      ...(component.params || {}),
      slider_position: ratio,
      connection_mode: component.params?.connection_mode || "tap_to_right"
    };
    component.interactive = {
      kind: "slider",
      axis: "x",
      track: {
        x1: bbox[0] + 10,
        y1: tapY,
        x2: bbox[0] + bbox[2] - 10,
        y2: tapY
      },
      handle: {
        x: bbox[0] + 10 + (bbox[2] - 20) * ratio,
        y: tapY
      }
    };
    component.prefer_fallback = true;

    ensureAdjustable(scene, {
      id: `adj_${component.id}`,
      label: component.label ? `${component.label} 滑片` : "滑片 P",
      type: "range",
      component_id: component.id,
      param: "slider_position",
      target: `${component.id}.params.slider_position`,
      min: 0,
      max: 1,
      step: 0.01,
      initial: ratio
    });

    retargetTapWires(scene, component);
  }

  function prepareMeter(component) {
    const primitives = component.primitives || [];
    const circleOnly = primitives.length > 0 && primitives.every((item) => item.type === "circle");
    if (circleOnly) component.prefer_fallback = true;
  }

  function classifySceneTemplate(scene) {
    const counts = (scene.components || []).reduce((acc, component) => {
      acc[component.type] = (acc[component.type] || 0) + 1;
      return acc;
    }, {});

    if (
      counts.variable_resistor === 1 &&
      counts.voltmeter >= 1 &&
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

  function prepareUploadSceneV2(rawScene) {
    const scene = cloneScene(rawScene);
    scene.simulation = scene.simulation || {};
    scene.simulation.adjustables = scene.simulation.adjustables || [];
    const hasServerResolved = Boolean(scene?.resolved?.component_geometry?.length || scene?.resolved?.ports);
    if (!hasServerResolved) {
      snapWireEndpoints(scene);

      (scene.components || []).forEach((component) => {
        if (component.type === "switch") prepareSwitch(scene, component);
        if (component.type === "variable_resistor") prepareVariableResistor(scene, component);
        if (component.type === "ammeter" || component.type === "voltmeter") prepareMeter(component);
      });

      snapWireEndpoints(scene);
    }

    scene.render_view_box = scene?.resolved?.render_view_box || scene.render_view_box || computeRenderViewBox(scene);
    scene.normalization = {
      ...(scene.normalization || {}),
      template: scene.normalization?.template || classifySceneTemplate(scene),
      note: scene.validation?.quality_gate_passed
        ? "已按新版中间态做锚点吸附、滑片建模和导线端点校正。"
        : "当前结果已做基础归一化，但校验仍提示存在结构风险，建议结合原图人工复核。"
    };
    scene.normalization = {
      ...(scene.normalization || {}),
      template: scene.normalization?.template || classifySceneTemplate(scene),
      note: scene.normalization?.note || (scene.validation?.quality_gate_passed
        ? "Server-normalized scene is ready for interaction rendering."
        : "Server normalization completed, but validation still reports structural risk.")
    };
    return scene;
  }

  function getResolvedSceneComponent(component) {
    const geometry = resolvedComponentGeometry(state.upload.scene, component.id);
    const params = { ...(component.params || {}) };
    Object.entries(state.upload.interaction || {}).forEach(([key, value]) => {
      if (!key.startsWith(`${component.id}.`)) return;
      params[key.slice(component.id.length + 1)] = value;
    });
    if (component.type === "variable_resistor") {
      const ratio = Number(params.slider_position ?? params.slider_ratio ?? params.position);
      if (Number.isFinite(ratio)) {
        params.slider_position = ratio;
        params.slider_ratio = ratio;
      }
    }
    return {
      ...component,
      bbox: geometry?.bbox || component.bbox,
      center: geometry?.center || component.center,
      anchors: geometry?.anchors || component.anchors,
      interactive: geometry?.interactive || component.interactive,
      prefer_fallback: geometry?.prefer_fallback ?? component.prefer_fallback,
      params
    };
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
          0
        );
        if (Number.isFinite(min) && Number.isFinite(max)) {
          context[`${prefix}_resistance_ohm`] = min + (max - min) * ratio;
        }
      }
    });
    return context;
  }

  function normalizeExpression(expression) {
    return String(expression || "")
      .replace(/([A-Za-z0-9_-]+)\.params\.([A-Za-z0-9_]+)/g, (_, componentId, param) => `${componentId.replace(/-/g, "_")}_${param}`);
  }

  function evaluateSceneExpression(expression, context) {
    const trimmed = normalizeExpression(expression).trim();
    if (!trimmed || !/^[\w\s.+\-*/%()?:<>=!&|,]+$/.test(trimmed)) return null;
    try {
      const keys = Object.keys(context);
      const fn = new Function(...keys, `return (${trimmed});`);
      return fn(...keys.map((key) => context[key]));
    } catch {
      return null;
    }
  }

  function formatSceneValue(value, unit = "", digits = 2) {
    if (typeof value === "boolean") return value ? "是" : "否";
    if (value == null || value === "") return "";
    const num = Number(value);
    if (Number.isFinite(num)) return `${format(num, digits)}${unit}`;
    return `${value}${unit}`;
  }

  function findNumericParam(component, keys) {
    for (const key of keys) {
      const value = Number(component?.params?.[key]);
      if (Number.isFinite(value)) return value;
    }
    return null;
  }

  function summarizedLabels(components, fallbackPrefix) {
    const labels = components
      .map((component, index) => String(component?.label || "").trim() || `${fallbackPrefix}${index + 1}`)
      .filter(Boolean);
    if (!labels.length) return "";
    return labels.length <= 3 ? labels.join(" / ") : `${labels.slice(0, 3).join(" / ")} 等 ${labels.length} 个`;
  }

  function measurementEntries(scene) {
    const context = buildSceneContext(scene);
    return (scene?.simulation?.measurements || [])
      .map((item, index) => {
        const value = evaluateSceneExpression(item.expr, context);
        if (value == null || Number.isNaN(value)) return null;
        const label = String(item.label || item.id || `测量${index + 1}`).trim();
        if (!label) return null;
        return {
          key: `measurement:${item.id || index}`,
          label,
          value: formatSceneValue(value, item.unit || "", 2)
        };
      })
      .filter(Boolean);
  }

  function uploadParameterEntries(scene) {
    const measurements = measurementEntries(scene);
    const components = (scene?.components || []).map((component) => getResolvedSceneComponent(component));
    const entries = [...measurements];

    const switches = components.filter((component) => component.type === "switch");
    if (switches.length) {
      entries.push({
        key: "switches",
        label: "开关",
        value: switches
          .map((component, index) => `${String(component.label || "").trim() || `S${index + 1}`} ${component.params?.closed ? "闭合" : "断开"}`)
          .join(" / ")
      });
    }

    const voltmeters = components.filter((component) => component.type === "voltmeter");
    if (voltmeters.length) {
      entries.push({
        key: "voltmeters",
        label: "电压表",
        value: summarizedLabels(voltmeters, "V") || "已识别"
      });
    }

    const ammeters = components.filter((component) => component.type === "ammeter");
    if (ammeters.length) {
      entries.push({
        key: "ammeters",
        label: "电流表",
        value: summarizedLabels(ammeters, "A") || "已识别"
      });
    }

    const rheostats = components.filter((component) => component.type === "variable_resistor");
    if (rheostats.length) {
      entries.push({
        key: "rheostats",
        label: "滑动变阻器",
        value: rheostats.map((component, index) => {
          const ratio = Number(component.params?.slider_position ?? component.params?.slider_ratio ?? component.params?.position);
          const label = String(component.label || "").trim() || `R${index + 1}`;
          return Number.isFinite(ratio) ? `${label} ${format(ratio * 100, 0)}%` : `${label} 已识别`;
        }).join(" / ")
      });
    }

    const batteries = components.filter((component) => component.type === "battery");
    if (batteries.length) {
      entries.push({
        key: "batteries",
        label: "电源",
        value: batteries.map((component, index) => {
          const label = String(component.label || "").trim() || `E${index + 1}`;
          const voltage = findNumericParam(component, ["voltage_v", "emf_v", "battery_voltage_v", "value_v", "voltage"]);
          return Number.isFinite(voltage) ? `${label} ${format(voltage, 2)}V` : `${label} 已识别`;
        }).join(" / ")
      });
    }

    const fixedResistors = components.filter((component) => component.type === "resistor");
    if (fixedResistors.length) {
      const known = fixedResistors
        .map((component, index) => {
          const resistance = findNumericParam(component, ["resistance_ohm", "value_ohm", "ohm"]);
          if (!Number.isFinite(resistance)) return null;
          const label = String(component.label || "").trim() || `R${index + 1}`;
          return `${label} ${format(resistance, 2)}Ω`;
        })
        .filter(Boolean);
      entries.push({
        key: "resistors",
        label: "定值电阻",
        value: known.length ? known.join(" / ") : summarizedLabels(fixedResistors, "R") || `${fixedResistors.length} 个`
      });
    }

    const lamps = components.filter((component) => component.type === "lamp");
    if (lamps.length) {
      entries.push({
        key: "lamps",
        label: "灯泡",
        value: summarizedLabels(lamps, "L") || `${lamps.length} 个`
      });
    }

    const deduped = [];
    const seen = new Set();
    entries.forEach((entry) => {
      const key = `${entry.label}:${entry.value}`;
      if (seen.has(key)) return;
      seen.add(key);
      deduped.push(entry);
    });
    return deduped.slice(0, 8);
  }

  function renderUploadParameters(scene) {
    const entries = uploadParameterEntries(scene);
    if (!entries.length) {
      return `<div class="kv-item"><span>实验参数</span><strong>未识别到可用数据</strong></div>`;
    }

    return `
      <div class="kv-list kv-list--meter-grid">
        ${entries.map((entry) => `
          <div class="kv-item kv-item--compact">
            <span>${escapeUploadHtml(entry.label)}</span>
            <strong>${escapeUploadHtml(entry.value)}</strong>
          </div>
        `).join("")}
      </div>
    `;
  }

  function getSceneHighlights(scene) {
    const active = {
      wires: new Set(),
      components: new Set()
    };
    const context = buildSceneContext(scene);
    const highlights = [
      ...(scene?.simulation?.highlights || []),
      ...(scene?.interaction?.highlights || [])
    ];

    highlights.forEach((highlight) => {
      const matched = highlight.when ? evaluateSceneExpression(highlight.when, context) : true;
      if (!matched) return;
      (highlight.wire_ids || highlight.target_wire_ids || []).forEach((id) => active.wires.add(id));
      (highlight.component_ids || highlight.target_component_ids || []).forEach((id) => active.components.add(id));
    });

    return active;
  }

  function renderPrimitive(item, extraClass = "") {
    const stroke = item.stroke || DEFAULT_STROKE;
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

  function inferComponentEndpoints(component) {
    const bbox = sceneBBox(component.bbox);
    const center = sceneCenter(component);
    const anchors = component.anchors || {};
    const left = anchors.left || anchors.negative || { x: bbox[0], y: center.y };
    const right = anchors.right || anchors.positive || { x: bbox[0] + bbox[2], y: center.y };
    const top = anchors.top || { x: center.x, y: bbox[1] };
    const bottom = anchors.bottom || { x: center.x, y: bbox[1] + bbox[3] };
    return { bbox, center, left, right, top, bottom };
  }

  function resolveComponentGeometry(component) {
    const current = getResolvedSceneComponent(component);
    const bbox = sceneBBox(current.bbox);
    const center = sceneCenter(current);
    const anchors = { ...(current.anchors || {}) };
    const interactive = current.interactive ? { ...current.interactive } : null;

    if (current.type === "variable_resistor") {
      const ratio = clamp(Number(current.params?.slider_position ?? current.params?.slider_ratio ?? 0.5), 0, 1);
      const track = interactive?.track || {
        x1: bbox[0] + 10,
        y1: bbox[1] - 18,
        x2: bbox[0] + bbox[2] - 10,
        y2: bbox[1] - 18
      };
      const handleX = track.x1 + (track.x2 - track.x1) * ratio;
      const handleY = track.y1 + (track.y2 - track.y1) * ratio;
      anchors.left = scenePoint(anchors.left, bbox[0], bbox[1] + bbox[3] / 2);
      anchors.right = scenePoint(anchors.right, bbox[0] + bbox[2], bbox[1] + bbox[3] / 2);
      anchors.body_left = scenePoint(anchors.body_left, bbox[0], anchors.left.y);
      anchors.body_right = scenePoint(anchors.body_right, bbox[0] + bbox[2], anchors.right.y);
      anchors.tap = { x: handleX, y: handleY };
      anchors.slider = { x: handleX, y: anchors.left.y };
      return {
        bbox,
        center,
        anchors,
        interactive: {
          ...(interactive || {}),
          track,
          handle: { x: handleX, y: handleY }
        }
      };
    }

    if (current.type === "battery") {
      const negative = scenePoint(anchors.negative || anchors.left, bbox[0], center.y);
      const positive = scenePoint(anchors.positive || anchors.right, bbox[0] + bbox[2], center.y);
      const horizontal = Math.abs(positive.x - negative.x) >= Math.abs(positive.y - negative.y);
      if (horizontal) {
        const leftX = Math.min(negative.x, positive.x);
        const rightX = Math.max(negative.x, positive.x);
        anchors.left = { x: leftX, y: center.y };
        anchors.right = { x: rightX, y: center.y };
      } else {
        const topY = Math.min(negative.y, positive.y);
        const bottomY = Math.max(negative.y, positive.y);
        anchors.top = { x: center.x, y: topY };
        anchors.bottom = { x: center.x, y: bottomY };
      }
      anchors.negative = negative;
      anchors.positive = positive;
    }

    if (current.type === "switch") {
      const left = scenePoint(anchors.left, bbox[0], center.y);
      const right = scenePoint(anchors.right, bbox[0] + bbox[2], center.y);
      const top = scenePoint(anchors.top, center.x, bbox[1]);
      const bottom = scenePoint(anchors.bottom, center.x, bbox[1] + bbox[3]);
      const switchInteractive = interactive || {};
      const pivot = scenePoint(switchInteractive.pivot, left.x, left.y);
      const contact = scenePoint(switchInteractive.contact, right.x, right.y);
      return {
        bbox,
        center,
        anchors: {
          ...anchors,
          left,
          right,
          top,
          bottom
        },
        interactive: {
          ...switchInteractive,
          pivot,
          contact,
          open_tip: scenePoint(switchInteractive.open_tip, contact.x - 18, contact.y - 18)
        }
      };
    }

    return {
      bbox,
      center,
      anchors,
      interactive
    };
  }

  function renderFallbackLamp(component, active) {
    const { bbox, center, left, right } = inferComponentEndpoints(component);
    const r = Math.max(10, Math.min(bbox[2], bbox[3]) / 2);
    return `
      <g class="scene-component ${active ? "scene-component--active" : ""}">
        <line x1="${left.x}" y1="${left.y}" x2="${center.x - r}" y2="${center.y}" class="scene-line"></line>
        <line x1="${center.x + r}" y1="${center.y}" x2="${right.x}" y2="${right.y}" class="scene-line"></line>
        <circle cx="${center.x}" cy="${center.y}" r="${r}" class="scene-shell"></circle>
        <line x1="${center.x - r * 0.58}" y1="${center.y - r * 0.58}" x2="${center.x + r * 0.58}" y2="${center.y + r * 0.58}" class="scene-line"></line>
        <line x1="${center.x - r * 0.58}" y1="${center.y + r * 0.58}" x2="${center.x + r * 0.58}" y2="${center.y - r * 0.58}" class="scene-line"></line>
      </g>
    `;
  }

  function renderFallbackMeter(component, active) {
    const { bbox, center, anchors } = resolveComponentGeometry(component);
    const left = anchors.left || { x: bbox[0], y: center.y };
    const right = anchors.right || { x: bbox[0] + bbox[2], y: center.y };
    const top = anchors.top || { x: center.x, y: bbox[1] };
    const bottom = anchors.bottom || { x: center.x, y: bbox[1] + bbox[3] };
    const horizontal = Math.abs(right.x - left.x) >= Math.abs(bottom.y - top.y);
    const r = Math.max(12, Math.min(bbox[2], bbox[3]) / 2);
    return horizontal
      ? `
        <g class="scene-component ${active ? "scene-component--active" : ""}">
          <line x1="${left.x}" y1="${left.y}" x2="${center.x - r}" y2="${center.y}" class="scene-line"></line>
          <line x1="${center.x + r}" y1="${center.y}" x2="${right.x}" y2="${right.y}" class="scene-line"></line>
          <circle cx="${center.x}" cy="${center.y}" r="${r}" class="scene-shell"></circle>
          <text x="${center.x}" y="${center.y + 7}" text-anchor="middle" class="scene-inline-label">${escapeUploadHtml(component.label || (component.type === "ammeter" ? "A" : "V"))}</text>
        </g>
      `
      : `
        <g class="scene-component ${active ? "scene-component--active" : ""}">
          <line x1="${top.x}" y1="${top.y}" x2="${center.x}" y2="${center.y - r}" class="scene-line"></line>
          <line x1="${center.x}" y1="${center.y + r}" x2="${bottom.x}" y2="${bottom.y}" class="scene-line"></line>
          <circle cx="${center.x}" cy="${center.y}" r="${r}" class="scene-shell"></circle>
          <text x="${center.x}" y="${center.y + 7}" text-anchor="middle" class="scene-inline-label">${escapeUploadHtml(component.label || (component.type === "ammeter" ? "A" : "V"))}</text>
        </g>
      `;
  }

  function renderFallbackResistor(component, active) {
    const { bbox, left, right, top, bottom } = inferComponentEndpoints(component);
    const horizontal = Math.abs(right.x - left.x) >= Math.abs(bottom.y - top.y);
    return horizontal
      ? `
        <g class="scene-component ${active ? "scene-component--active" : ""}">
          <line x1="${left.x}" y1="${left.y}" x2="${bbox[0]}" y2="${left.y}" class="scene-line"></line>
          <rect x="${bbox[0]}" y="${bbox[1]}" width="${bbox[2]}" height="${bbox[3]}" rx="4" class="scene-shell"></rect>
          <line x1="${bbox[0] + bbox[2]}" y1="${right.y}" x2="${right.x}" y2="${right.y}" class="scene-line"></line>
        </g>
      `
      : `
        <g class="scene-component ${active ? "scene-component--active" : ""}">
          <line x1="${top.x}" y1="${top.y}" x2="${top.x}" y2="${bbox[1]}" class="scene-line"></line>
          <rect x="${bbox[0]}" y="${bbox[1]}" width="${bbox[2]}" height="${bbox[3]}" rx="4" class="scene-shell"></rect>
          <line x1="${bottom.x}" y1="${bbox[1] + bbox[3]}" x2="${bottom.x}" y2="${bottom.y}" class="scene-line"></line>
        </g>
      `;
  }

  function renderFallbackBattery(component, active) {
    const { bbox, center, anchors } = resolveComponentGeometry(component);
    const negative = scenePoint(anchors.negative || anchors.left, bbox[0], center.y);
    const positive = scenePoint(anchors.positive || anchors.right, bbox[0] + bbox[2], center.y);
    const horizontal = Math.abs(positive.x - negative.x) >= Math.abs(positive.y - negative.y);
    return horizontal
      ? `
        <g class="scene-component ${active ? "scene-component--active" : ""}">
          <line x1="${Math.min(negative.x, positive.x) - 18}" y1="${center.y}" x2="${Math.min(negative.x, positive.x)}" y2="${center.y}" class="scene-line"></line>
          <line x1="${Math.min(negative.x, positive.x)}" y1="${bbox[1] + 8}" x2="${Math.min(negative.x, positive.x)}" y2="${bbox[1] + bbox[3] - 8}" class="scene-line"></line>
          <line x1="${Math.max(negative.x, positive.x)}" y1="${bbox[1]}" x2="${Math.max(negative.x, positive.x)}" y2="${bbox[1] + bbox[3]}" class="scene-line"></line>
          <line x1="${Math.max(negative.x, positive.x)}" y1="${center.y}" x2="${Math.max(negative.x, positive.x) + 18}" y2="${center.y}" class="scene-line"></line>
        </g>
      `
      : `
        <g class="scene-component ${active ? "scene-component--active" : ""}">
          <line x1="${center.x}" y1="${Math.min(negative.y, positive.y) - 18}" x2="${center.x}" y2="${Math.min(negative.y, positive.y)}" class="scene-line"></line>
          <line x1="${bbox[0] + 8}" y1="${Math.min(negative.y, positive.y)}" x2="${bbox[0] + bbox[2] - 8}" y2="${Math.min(negative.y, positive.y)}" class="scene-line"></line>
          <line x1="${bbox[0]}" y1="${Math.max(negative.y, positive.y)}" x2="${bbox[0] + bbox[2]}" y2="${Math.max(negative.y, positive.y)}" class="scene-line"></line>
          <line x1="${center.x}" y1="${Math.max(negative.y, positive.y)}" x2="${center.x}" y2="${Math.max(negative.y, positive.y) + 18}" class="scene-line"></line>
        </g>
      `;
  }

  function renderFallbackSwitch(component, active) {
    const { anchors, interactive } = resolveComponentGeometry(component);
    const left = anchors.left;
    const right = anchors.right;
    const top = anchors.top;
    const bottom = anchors.bottom;
    const pivot = interactive.pivot;
    const contact = interactive.contact;
    const openTip = interactive.open_tip;
    const closed = Boolean(component.params?.closed);
    const target = closed ? { x: contact.x - 3, y: contact.y } : openTip;
    const horizontal = Math.abs(contact.x - pivot.x) >= Math.abs(contact.y - pivot.y);
    return horizontal
      ? `
        <g class="scene-component ${active ? "scene-component--active" : ""}">
          ${Math.abs(left.x - pivot.x) > 1 || Math.abs(left.y - pivot.y) > 1 ? `<line x1="${left.x}" y1="${left.y}" x2="${pivot.x}" y2="${pivot.y}" class="scene-line"></line>` : ""}
          ${Math.abs(contact.x - right.x) > 1 || Math.abs(contact.y - right.y) > 1 ? `<line x1="${contact.x}" y1="${contact.y}" x2="${right.x}" y2="${right.y}" class="scene-line"></line>` : ""}
          <circle cx="${pivot.x}" cy="${pivot.y}" r="4.6" class="scene-node scene-node--solid"></circle>
          <circle cx="${contact.x}" cy="${contact.y}" r="3.8" class="scene-node scene-node--solid"></circle>
          <line x1="${pivot.x}" y1="${pivot.y}" x2="${target.x}" y2="${target.y}" class="scene-line"></line>
        </g>
      `
      : `
        <g class="scene-component ${active ? "scene-component--active" : ""}">
          ${Math.abs(top.x - contact.x) > 1 || Math.abs(top.y - contact.y) > 1 ? `<line x1="${top.x}" y1="${top.y}" x2="${contact.x}" y2="${contact.y}" class="scene-line"></line>` : ""}
          ${Math.abs(pivot.x - bottom.x) > 1 || Math.abs(pivot.y - bottom.y) > 1 ? `<line x1="${pivot.x}" y1="${pivot.y}" x2="${bottom.x}" y2="${bottom.y}" class="scene-line"></line>` : ""}
          <circle cx="${pivot.x}" cy="${pivot.y}" r="4.6" class="scene-node scene-node--solid"></circle>
          <circle cx="${contact.x}" cy="${contact.y}" r="3.8" class="scene-node scene-node--solid"></circle>
          <line x1="${pivot.x}" y1="${pivot.y}" x2="${target.x}" y2="${target.y}" class="scene-line"></line>
        </g>
      `;
  }

  function resolvedTap(component) {
    return resolveComponentGeometry(component).anchors.tap;
  }

  function renderFallbackVariableResistor(component, active) {
    const { bbox, anchors, interactive } = resolveComponentGeometry(component);
    const cls = active ? "scene-component scene-component--active" : "scene-component";
    const track = interactive.track;
    const tap = anchors.tap;
    const bodyLeft = anchors.body_left;
    const bodyRight = anchors.body_right;
    return `
      <g class="${cls}">
        <line x1="${bodyLeft.x - 18}" y1="${bodyLeft.y}" x2="${bodyLeft.x}" y2="${bodyLeft.y}" class="scene-line"></line>
        <rect x="${bbox[0]}" y="${bbox[1]}" width="${bbox[2]}" height="${bbox[3]}" rx="4" class="scene-shell"></rect>
        <line x1="${bodyRight.x}" y1="${bodyRight.y}" x2="${bodyRight.x + 18}" y2="${bodyRight.y}" class="scene-line"></line>
        <line x1="${tap.x}" y1="${tap.y}" x2="${tap.x}" y2="${bbox[1] + 2}" class="scene-line"></line>
        <polygon points="${tap.x},${bbox[1] + 4} ${tap.x - 7},${bbox[1] - 8} ${tap.x + 7},${bbox[1] - 8}" class="scene-arrow"></polygon>
        <text x="${tap.x}" y="${track.y1 - 12}" text-anchor="middle" class="scene-inline-label">P</text>
        <circle cx="${bodyLeft.x}" cy="${bodyLeft.y}" r="4.2" class="scene-node scene-node--solid"></circle>
        ${component.params?.connection_mode === "tap_to_right" ? `<line x1="${bodyRight.x}" y1="${bodyRight.y}" x2="${bodyRight.x + 10}" y2="${bodyRight.y}" class="scene-line"></line>` : ""}
      </g>
    `;
  }

  function renderSceneFallbackComponent(component, active) {
    if (component.type === "lamp") return renderFallbackLamp(component, active);
    if (component.type === "ammeter" || component.type === "voltmeter") return renderFallbackMeter(component, active);
    if (component.type === "resistor") return renderFallbackResistor(component, active);
    if (component.type === "variable_resistor") return renderFallbackVariableResistor(component, active);
    if (component.type === "battery") return renderFallbackBattery(component, active);
    if (component.type === "switch") return renderFallbackSwitch(component, active);
    return "";
  }

  function renderSceneLabel(label) {
    const component = componentById(state.upload.scene, label.belongs_to);
    if (component) {
      if (component.type === "ammeter" || component.type === "voltmeter") return "";
      if (component.type === "variable_resistor" && String(label.text || "").trim().toUpperCase() === "P") return "";
    }
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

    if (current.type === "variable_resistor") {
      return renderFallbackVariableResistor(current, active);
    }

    if (current.prefer_fallback || current.type === "switch") {
      return renderSceneFallbackComponent(current, active);
    }

    if (current.primitives?.length) {
      return `
        <g class="scene-component ${active ? "scene-component--active" : ""}">
          ${current.primitives.map((item) => renderPrimitive(item, active ? "scene-primitive--active" : "")).join("")}
        </g>
      `;
    }

    return renderSceneFallbackComponent(current, active);
  }

  function renderSceneWire(scene, wire, activeHighlights) {
    const resolvedWire = resolvedRouteGraph(scene, wire.id);
    const hidden = resolvedWire?.hidden ?? wire?.hidden;
    const topologyRole = resolvedWire?.topology_role ?? wire?.topology_role;
    if (hidden || topologyRole === "internal_symbol") return "";
    const active = activeHighlights.wires.has(wire.id);
    const cls = active ? "scene-wire scene-wire--active" : "scene-wire";
    const stroke = wire.style?.color || wire.stroke?.color || DEFAULT_STROKE;
    const width = wire.style?.width || wire.stroke?.width || 2.8;
    const route = resolvedWire?.route || wire.route;

    if (route?.kind === "svg_path" && route?.d) {
      return `<path class="${cls}" d="${route.d}" stroke="${stroke}" stroke-width="${width}" />`;
    }

    const points = normalizeWirePolyline(route?.points || []);
    if (!points.length) return "";

    const fromComponentId = String(wire.from || "").split(".")[0];
    const toComponentId = String(wire.to || "").split(".")[0];
    const fromAnchor = String(wire.from || "").split(".")[1];
    const toAnchor = String(wire.to || "").split(".")[1];
    const fromComponent = componentById(scene, fromComponentId);
    const toComponent = componentById(scene, toComponentId);

    if (fromComponent?.type === "variable_resistor" && (fromAnchor === "tap" || fromAnchor === "slider")) {
      points[0] = resolvedTap(getResolvedSceneComponent(fromComponent));
    }
    if (toComponent?.type === "variable_resistor" && (toAnchor === "tap" || toAnchor === "slider")) {
      points[points.length - 1] = resolvedTap(getResolvedSceneComponent(toComponent));
    }

    const pointText = normalizeWirePolyline(points).map((point) => `${point.x},${point.y}`).join(" ");
    return `<polyline class="${cls}" points="${pointText}" stroke="${stroke}" stroke-width="${width}" />`;
  }

  function renderValidationList(scene) {
    const issues = scene?.validation?.issues || [];
    if (!issues.length) {
      return `<ul class="fact-list"><li>结构校验通过，可以直接进入交互渲染。</li></ul>`;
    }

    return `
      <ul class="fact-list">
        ${issues.slice(0, 4).map((issue) => `<li>${escapeUploadHtml(issue.message || issue.code || "存在待复核项")}</li>`).join("")}
      </ul>
    `;
  }

  function uploadMeta(scene) {
    if (!scene) {
      return {
        title: "上传题目",
        desc: "上传题图后生成可交互电路实验。"
      };
    }

    return {
      title: scene.title || "上传题目",
      desc: scene.summary || "已生成电路图复刻结果。"
    };
  }

  function uploadSummary(scene) {
    const counts = (scene?.components || []).reduce((acc, component) => {
      acc[component.type] = (acc[component.type] || 0) + 1;
      return acc;
    }, {});

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
      .map(([type, count]) => `${labels[type] || type} x ${count}`)
      .join(" / ");
  }

  function renderUploadAdjustables(scene) {
    const adjustables = (scene?.simulation?.adjustables || []).filter((item, index, list) => {
      const binding = getAdjustableBinding(item);
      if (!binding.componentId || !binding.param) return false;
      return list.findIndex((entry) => {
        const other = getAdjustableBinding(entry);
        return other.componentId === binding.componentId && other.param === binding.param;
      }) === index;
    });
    if (!adjustables.length) {
      return "";
    }

    return adjustables.map((item) => {
      const binding = getAdjustableBinding(item);
      if (!binding.componentId || !binding.param) return "";
      const component = (scene.components || []).find((entry) => entry.id === binding.componentId);
      const value = getSceneInteractiveValue(binding.componentId, binding.param, component?.params?.[binding.param]);
      const type = normalizeAdjustableType(item.type);
      const label = escapeUploadHtml(item.label || component?.label || binding.componentId);

      if (type === "toggle") {
        return `<button class="control-btn ${value ? "control-btn--on" : "control-btn--off"}" data-action="upload-toggle-adjustable" data-component="${binding.componentId}" data-param="${binding.param}">${label}：${value ? "闭合" : "断开"}</button>`;
      }

      return `
        <label class="slider-panel">
          <span>${label}：${format(Number(value), 2)}</span>
          <input type="range" min="${item.min ?? 0}" max="${item.max ?? 1}" step="${item.step ?? 0.01}" value="${value ?? item.min ?? 0}" data-action="upload-range-adjustable" data-component="${binding.componentId}" data-param="${binding.param}" />
        </label>
      `;
    }).join("");
  }

  function renderUploadScene(scene) {
    if (!scene) {
      return `
        <div class="scene-stage scene-stage--upload">
          <div class="upload-empty">
            <div class="upload-empty__icon">+</div>
            <div class="upload-empty__title">上传电路题图片</div>
            <div class="upload-empty__desc">支持 JPG / JPEG / PNG。</div>
          </div>
          ${state.upload.loading ? `
            <div class="upload-loading-mask">
              <div class="upload-spinner"></div>
              <strong>正在生成交互电路图</strong>
              <span>正在识别元件、导线和题图结构，预计需要1-2分钟，请稍候。</span>
            </div>
          ` : ""}
        </div>
      `;
    }

    const highlights = getSceneHighlights(scene);
    const viewBox = scene.render_view_box || computeRenderViewBox(scene);
    return `
      <div class="scene-stage scene-stage--upload">
        <svg viewBox="${viewBox.join(" ")}" preserveAspectRatio="xMidYMid meet" aria-label="上传题目电路图">
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
            <span>正在识别元件、导线和题图结构，请稍候。</span>
          </div>
        ` : ""}
      </div>
    `;
  }

  renderPreviewCard = function renderPreviewCardV2() {
    if (state.selectedCase !== "upload") return baseRenderPreviewCard();

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
      </div>
    `;
  };

  renderUploadPage = function renderUploadPageV2() {
    const scene = state.upload.scene;
    const meta = uploadMeta(scene);

    return {
      title: meta.title,
      desc: meta.desc,
      badges: [],
      accentIndex: 0,
      svg: `
        ${state.upload.successMessage ? `<div class="upload-status upload-status--success">${escapeUploadHtml(state.upload.successMessage)}</div>` : ""}
        ${state.upload.error ? `<div class="upload-status upload-status--error">${escapeUploadHtml(state.upload.error)}</div>` : ""}
        ${renderUploadScene(scene)}
      `,
      footerTitle: "生成说明",
      footerDesc: state.upload.loading
        ? "正在调用多模态模型识别题图，请等待结果返回。"
        : (scene?.normalization?.note || "当前结果已完成上传页归一化。"),
      parametersTitle: "关键参数",
      parameters: scene ? renderUploadParameters(scene) : ``,
      lawsTitle: "校验与交互",
      laws: scene ? renderValidationList(scene) : `
        <ul class="fact-list">
          <li>优先识别电源、开关、电阻、滑片、电表和关键节点。</li>
          <li>先输出 scene 中间态，再做拓扑修正和导线吸附，最后进入渲染。</li>
          <li>上传页不再依赖多层覆盖脚本，而是使用一套独立实现。</li>
        </ul>
      `,
      controls: `
        <div class="control-stack">
          <input class="hidden-input" id="upload-input" type="file" accept=".jpg,.jpeg,.png,image/jpeg,image/png" />
          <button class="control-btn" data-action="upload-open" ${state.upload.loading ? "disabled" : ""}>${state.upload.loading ? "识别中..." : scene ? "重新上传题图" : "上传题图"}</button>
          ${scene ? renderUploadAdjustables(scene) : ``}
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
      const modelConfig = uploadModelConfig();
      const { response, data } = await fetchJsonWithRetry("/api/parse-circuit", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          ...payload,
          provider: "openai",
          modelOverride: modelConfig.model,
          parseMode: modelConfig.parseMode,
          repairPass: modelConfig.repairPass
        })
      }, 1);
      if (!response.ok || !data.ok) {
        throw new Error(data.error || "生成失败");
      }

      const preparedScene = prepareUploadSceneV2(data.scene);
      state.upload.scene = preparedScene;
      state.upload.usage = data.usage || null;
      state.upload.interaction = createSceneInteractionState(preparedScene);
      state.upload.successMessage = preparedScene.validation?.quality_gate_passed
        ? `生成成功，已使用 ${modelConfig.label} 输出可交互电路图。`
        : `已使用 ${modelConfig.label} 生成结果，但存在待复核的结构问题。`;
    } catch (error) {
      if (isTransientFetchError(error)) {
        const healthy = await checkLocalServiceHealth();
        state.upload.error = healthy
          ? "请求本地解析服务时连接被中断，请重试一次。"
          : "无法连接本地解析服务，请确认 `node server.js` 仍在运行后重试。";
      } else {
      state.upload.error = error.message || "生成失败";
      }
    } finally {
      state.upload.loading = false;
      renderApp();
    }
  }

  if (!window.__uploadV2Bound) {
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

    window.__uploadV2Bound = true;
  }

  renderApp();
})();

