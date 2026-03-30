const uploadFinalBase = {
  renderPreviewCard,
  renderSceneFallbackComponent,
  renderSceneComponent,
  renderSceneLabel,
  renderSceneWire,
  renderUploadScene,
  renderUploadPage,
  parseUploadedFile
};

function uploadFinalNumber(value, fallback = 0) {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

function uploadFinalPoint(point, fallbackX = 0, fallbackY = 0) {
  return {
    x: uploadFinalNumber(point?.x, fallbackX),
    y: uploadFinalNumber(point?.y, fallbackY)
  };
}

function uploadFinalBBox(bbox) {
  if (!Array.isArray(bbox) || bbox.length !== 4) return [0, 0, 60, 40];
  return [
    uploadFinalNumber(bbox[0], 0),
    uploadFinalNumber(bbox[1], 0),
    Math.max(12, uploadFinalNumber(bbox[2], 60)),
    Math.max(12, uploadFinalNumber(bbox[3], 40))
  ];
}

function uploadFinalCenter(component) {
  const bbox = uploadFinalBBox(component?.bbox);
  return uploadFinalPoint(component?.center, bbox[0] + bbox[2] / 2, bbox[1] + bbox[3] / 2);
}

function uploadFinalClone(value) {
  return JSON.parse(JSON.stringify(value || {}));
}

function uploadFinalComponentById(scene, id) {
  return (scene?.components || []).find((component) => component.id === id) || null;
}

function uploadFinalComponents(scene, type) {
  return (scene?.components || []).filter((component) => component.type === type);
}

function uploadFinalAnchor(scene, ref) {
  if (!ref || typeof ref !== "string") return null;
  const [componentId, anchorName] = ref.split(".");
  const component = uploadFinalComponentById(scene, componentId);
  if (!component) return null;
  const bbox = uploadFinalBBox(component.bbox);
  const center = uploadFinalCenter(component);
  const anchor = component.anchors?.[anchorName];
  if (anchor) return uploadFinalPoint(anchor, center.x, center.y);
  if (anchorName === "left") return { x: bbox[0], y: center.y };
  if (anchorName === "right") return { x: bbox[0] + bbox[2], y: center.y };
  if (anchorName === "top") return { x: center.x, y: bbox[1] };
  if (anchorName === "bottom") return { x: center.x, y: bbox[1] + bbox[3] };
  return center;
}

function uploadFinalDedupe(points) {
  const next = [];
  (points || []).forEach((point) => {
    const current = uploadFinalPoint(point);
    const prev = next[next.length - 1];
    if (!prev || prev.x !== current.x || prev.y !== current.y) {
      next.push(current);
    }
  });
  return next;
}

function uploadFinalOrthogonal(points) {
  const deduped = uploadFinalDedupe(points);
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

  return uploadFinalDedupe(next);
}

function uploadFinalCollectPoints(scene) {
  const points = [];

  (scene?.wires || []).forEach((wire) => {
    (wire?.route?.points || []).forEach((point) => points.push(uploadFinalPoint(point)));
  });

  (scene?.components || []).forEach((component) => {
    const bbox = uploadFinalBBox(component.bbox);
    const center = uploadFinalCenter(component);
    points.push({ x: bbox[0], y: bbox[1] });
    points.push({ x: bbox[0] + bbox[2], y: bbox[1] + bbox[3] });
    points.push(center);
    Object.values(component.anchors || {}).forEach((anchor) => {
      if (anchor && typeof anchor === "object") points.push(uploadFinalPoint(anchor, center.x, center.y));
    });
  });

  (scene?.labels || []).forEach((label) => {
    points.push(uploadFinalPoint(label.position));
  });

  return points;
}

function uploadFinalViewBox(scene) {
  const points = uploadFinalCollectPoints(scene);
  if (!points.length) {
    return scene?.canvas?.view_box || [0, 0, scene?.source?.image_width || 1200, scene?.source?.image_height || 800];
  }

  const minX = Math.min(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const maxX = Math.max(...points.map((point) => point.x));
  const maxY = Math.max(...points.map((point) => point.y));
  const padding = 34;
  return [
    Math.max(0, Math.floor(minX - padding)),
    Math.max(0, Math.floor(minY - padding)),
    Math.max(220, Math.ceil(maxX - minX + padding * 2)),
    Math.max(220, Math.ceil(maxY - minY + padding * 2))
  ];
}

function uploadFinalSnapWireEndpoints(scene) {
  (scene?.wires || []).forEach((wire) => {
    if (wire?.route?.kind !== "polyline") return;
    const points = uploadFinalDedupe(wire.route.points || []);
    const start = uploadFinalAnchor(scene, wire.from);
    const end = uploadFinalAnchor(scene, wire.to);
    if (start && points.length) points[0] = start;
    if (end && points.length) points[points.length - 1] = end;
    wire.route.points = uploadFinalOrthogonal(points);
  });
}

function uploadFinalEnsureAdjustable(scene, adjustable) {
  scene.simulation = scene.simulation || {};
  scene.simulation.adjustables = scene.simulation.adjustables || [];
  const exists = scene.simulation.adjustables.some((item) => item.component_id === adjustable.component_id && item.param === adjustable.param);
  if (!exists) scene.simulation.adjustables.push(adjustable);
}

function uploadFinalMeterNeedsFallback(component) {
  const primitives = component?.primitives || [];
  return primitives.length > 0 && primitives.every((item) => item.type === "circle");
}

function uploadFinalSliderSource(component) {
  const bbox = uploadFinalBBox(component.bbox);
  const center = uploadFinalCenter(component);
  const rawSlider = component.anchors?.slider ? uploadFinalPoint(component.anchors.slider, center.x, bbox[1] - 20) : null;
  const verticalLine = (component.primitives || []).find((item) =>
    item.type === "line" &&
    Math.abs(uploadFinalNumber(item.x1) - uploadFinalNumber(item.x2)) <= 6 &&
    Math.min(uploadFinalNumber(item.y1), uploadFinalNumber(item.y2)) <= bbox[1] + 6
  );

  return { rawSlider, verticalLine };
}

function uploadFinalRetargetRheostat(scene, component) {
  const tap = component.anchors?.tap;
  if (!tap) return;

  const rightRef = `${component.id}.right`;
  const tapRef = `${component.id}.tap`;
  let changed = false;

  (scene?.wires || []).forEach((wire) => {
    if (wire?.route?.kind !== "polyline") return;
    const points = uploadFinalDedupe(wire.route.points || []);
    if (!points.length) return;

    if (wire.from === rightRef) {
      wire.from = tapRef;
      points[0] = tap;
      wire.route.points = uploadFinalOrthogonal(points);
      changed = true;
    }

    if (wire.to === rightRef) {
      wire.to = tapRef;
      points[points.length - 1] = tap;
      wire.route.points = uploadFinalOrthogonal(points);
      changed = true;
    }
  });

  if (!changed) {
    const rightRailX = Math.max(...uploadFinalCollectPoints(scene).map((point) => point.x));
    if (Number.isFinite(rightRailX) && rightRailX > tap.x + 8) {
      scene.wires.push({
        id: `wire_${component.id}_tap`,
        from: tapRef,
        to: null,
        route: {
          kind: "polyline",
          points: uploadFinalOrthogonal([tap, { x: rightRailX, y: tap.y }])
        },
        style: { color: "#1f2e2b", width: 3.5 },
        current_candidate: false,
        confidence: 1
      });
    }
  }
}

function uploadFinalEnhanceVariableResistor(scene, component) {
  const bbox = uploadFinalBBox(component.bbox);
  if (bbox[2] < bbox[3]) {
    component.prefer_fallback = true;
    return;
  }

  const center = uploadFinalCenter(component);
  const { rawSlider, verticalLine } = uploadFinalSliderSource(component);
  const handleX = clamp(
    rawSlider?.x ?? uploadFinalNumber(verticalLine?.x1, center.x),
    bbox[0] + 10,
    bbox[0] + bbox[2] - 10
  );
  const branchY = uploadFinalNumber(component.anchors?.left?.y, center.y);
  const tapY = Math.min(
    rawSlider?.y ?? Number.POSITIVE_INFINITY,
    verticalLine ? Math.min(uploadFinalNumber(verticalLine.y1), uploadFinalNumber(verticalLine.y2)) : Number.POSITIVE_INFINITY,
    bbox[1] - 18
  );
  const ratio = clamp((handleX - bbox[0]) / Math.max(1, bbox[2]), 0, 1);

  component.anchors = {
    ...(component.anchors || {}),
    left: uploadFinalPoint(component.anchors?.left, bbox[0], branchY),
    right: uploadFinalPoint(component.anchors?.right, bbox[0] + bbox[2], branchY),
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
    handle: { x: handleX, y: tapY }
  };
  component.prefer_fallback = true;

  uploadFinalEnsureAdjustable(scene, {
    id: `adj_${component.id}`,
    label: "滑片 P",
    type: "range",
    component_id: component.id,
    param: "slider_position",
    min: 0,
    max: 1,
    step: 0.01,
    initial: ratio
  });

  uploadFinalRetargetRheostat(scene, component);
}

function uploadFinalMatchesSeriesTemplate(scene) {
  const resistorCount = uploadFinalComponents(scene, "resistor").length;
  const rheostatCount = uploadFinalComponents(scene, "variable_resistor").length;
  const voltmeterCount = uploadFinalComponents(scene, "voltmeter").length;
  const batteryCount = uploadFinalComponents(scene, "battery").length;
  const switchCount = uploadFinalComponents(scene, "switch").length;
  const ammeterCount = uploadFinalComponents(scene, "ammeter").length;
  const lampCount = uploadFinalComponents(scene, "lamp").length;
  const componentCount = (scene?.components || []).length;

  return resistorCount === 1 &&
    rheostatCount === 1 &&
    voltmeterCount === 1 &&
    batteryCount === 1 &&
    switchCount === 1 &&
    ammeterCount <= 1 &&
    lampCount === 0 &&
    componentCount <= 6;
}

function uploadFinalKeepOnly(scene, keepIds) {
  const keep = new Set(keepIds);
  scene.components = (scene.components || []).filter((component) => keep.has(component.id));
  scene.labels = (scene.labels || []).filter((label) => !label.belongs_to || keep.has(label.belongs_to));
}

function uploadFinalUpsertLabel(scene, id, text, position, belongsTo) {
  scene.labels = scene.labels || [];
  const existing = scene.labels.find((label) => label.id === id || (label.belongs_to === belongsTo && label.text === text));
  const next = {
    id: existing?.id || id,
    text,
    position,
    font_size: existing?.font_size || 18,
    rotation: 0,
    text_anchor: "middle",
    belongs_to: belongsTo
  };

  if (existing) {
    Object.assign(existing, next);
  } else {
    scene.labels.push(next);
  }
}

function uploadFinalBuildSeriesScene(sourceScene) {
  const scene = uploadFinalClone(sourceScene);
  const resistor = uploadFinalComponents(scene, "resistor")[0];
  const rheostat = uploadFinalComponents(scene, "variable_resistor")[0];
  const voltmeter = uploadFinalComponents(scene, "voltmeter")[0];
  const battery = uploadFinalComponents(scene, "battery")[0];
  const switchComponent = uploadFinalComponents(scene, "switch")[0];
  if (!resistor || !rheostat || !voltmeter || !battery || !switchComponent) return scene;

  uploadFinalKeepOnly(scene, [resistor.id, rheostat.id, voltmeter.id, battery.id, switchComponent.id]);

  const resistorBox = uploadFinalBBox(resistor.bbox);
  const rheostatBox = uploadFinalBBox(rheostat.bbox);
  const voltmeterBox = uploadFinalBBox(voltmeter.bbox);
  const batteryBox = uploadFinalBBox(battery.bbox);
  const switchBox = uploadFinalBBox(switchComponent.bbox);
  const resistorCenter = uploadFinalCenter(resistor);
  const rheostatCenter = uploadFinalCenter(rheostat);
  const voltmeterCenter = uploadFinalCenter(voltmeter);
  const batteryCenter = uploadFinalCenter(battery);
  const switchCenter = uploadFinalCenter(switchComponent);
  const sliderSource = uploadFinalSliderSource(rheostat).rawSlider || { x: rheostatCenter.x, y: rheostatBox[1] - 22 };
  const topY = Math.round((resistorCenter.y + rheostatCenter.y) / 2);
  const bottomY = Math.round((uploadFinalNumber(batteryCenter.y) + uploadFinalNumber(switchCenter.y)) / 2);
  const leftRailX = Math.max(26, Math.min(resistorBox[0] - 40, voltmeterBox[0] - 34, batteryBox[0] - 28));
  const resistorLeftX = Math.max(leftRailX + 34, resistorBox[0]);
  const resistorRightX = resistorLeftX + resistorBox[2];
  const midNodeX = Math.max(resistorRightX + 18, Math.round((resistorRightX + rheostatBox[0]) / 2));
  const rheostatLeftX = Math.max(midNodeX + 20, rheostatBox[0]);
  const rheostatRightX = rheostatLeftX + rheostatBox[2];
  const tapX = clamp(sliderSource.x, rheostatLeftX + 12, rheostatRightX - 12);
  const tapY = Math.min(sliderSource.y, topY - 18);
  const switchLeftX = Math.max(midNodeX + 64, switchBox[0]);
  const switchRightX = Math.max(switchLeftX + Math.max(46, switchBox[2]), switchLeftX + 46);
  const rightRailX = Math.max(switchRightX + 24, tapX + 36);
  const voltmeterLeftX = Math.max(leftRailX + 16, voltmeterBox[0]);
  const voltmeterY = Math.max(topY + 54, voltmeterCenter.y);
  const voltmeterRightX = voltmeterLeftX + voltmeterBox[2];
  const batteryNegativeX = Math.max(leftRailX + 48, uploadFinalNumber(battery.anchors?.negative?.x, batteryBox[0] + 8));
  const batteryPositiveX = Math.max(batteryNegativeX + 22, uploadFinalNumber(battery.anchors?.positive?.x, batteryNegativeX + 22));
  const switchClosed = Boolean(switchComponent.params?.closed);
  const sliderPosition = clamp((tapX - rheostatLeftX) / Math.max(1, rheostatBox[2]), 0, 1);

  resistor.bbox = [resistorLeftX, Math.round(topY - resistorBox[3] / 2), resistorBox[2], resistorBox[3]];
  resistor.center = { x: resistorLeftX + resistorBox[2] / 2, y: topY };
  resistor.anchors = {
    left: { x: resistorLeftX, y: topY },
    right: { x: resistorRightX, y: topY }
  };
  resistor.prefer_fallback = false;

  rheostat.bbox = [rheostatLeftX, Math.round(topY - rheostatBox[3] / 2), rheostatBox[2], rheostatBox[3]];
  rheostat.center = { x: rheostatLeftX + rheostatBox[2] / 2, y: topY };
  rheostat.anchors = {
    left: { x: rheostatLeftX, y: topY },
    right: { x: rheostatRightX, y: topY },
    body_left: { x: rheostatLeftX, y: topY },
    body_right: { x: rheostatRightX, y: topY },
    slider: { x: tapX, y: topY },
    tap: { x: tapX, y: tapY }
  };
  rheostat.params = {
    ...(rheostat.params || {}),
    slider_position: sliderPosition,
    connection_mode: "tap_to_right"
  };
  rheostat.interactive = {
    kind: "slider",
    axis: "x",
    track: {
      x1: rheostatLeftX + 12,
      y1: tapY,
      x2: rheostatRightX - 12,
      y2: tapY
    },
    handle: { x: tapX, y: tapY }
  };
  rheostat.prefer_fallback = true;

  voltmeter.bbox = [voltmeterLeftX, Math.round(voltmeterY - voltmeterBox[3] / 2), voltmeterBox[2], voltmeterBox[3]];
  voltmeter.center = { x: voltmeterLeftX + voltmeterBox[2] / 2, y: voltmeterY };
  voltmeter.anchors = {
    left: { x: voltmeterLeftX, y: voltmeterY },
    right: { x: voltmeterRightX, y: voltmeterY }
  };
  voltmeter.prefer_fallback = true;

  battery.bbox = [batteryBox[0], Math.round(bottomY - batteryBox[3] / 2), batteryBox[2], batteryBox[3]];
  battery.center = { x: batteryBox[0] + batteryBox[2] / 2, y: bottomY };
  battery.anchors = {
    negative: { x: batteryNegativeX, y: bottomY },
    positive: { x: batteryPositiveX, y: bottomY }
  };
  battery.prefer_fallback = true;

  switchComponent.bbox = [switchLeftX, Math.round(bottomY - switchBox[3] / 2), Math.max(48, switchBox[2]), switchBox[3]];
  switchComponent.center = { x: switchLeftX + Math.max(48, switchBox[2]) / 2, y: bottomY };
  switchComponent.anchors = {
    left: { x: switchLeftX, y: bottomY },
    right: { x: switchRightX, y: bottomY }
  };
  switchComponent.params = {
    ...(switchComponent.params || {}),
    closed: switchClosed
  };
  switchComponent.interactive = {
    kind: "toggle_switch",
    pivot: { x: switchLeftX, y: bottomY },
    contact: { x: switchRightX - 14, y: bottomY },
    open_tip: { x: switchRightX, y: bottomY - 18 }
  };
  switchComponent.prefer_fallback = true;

  scene.wires = [
    {
      id: "wire_left_vertical",
      from: null,
      to: null,
      route: { kind: "polyline", points: [{ x: leftRailX, y: topY }, { x: leftRailX, y: bottomY }] },
      style: { color: "#1f2e2b", width: 3.5 },
      current_candidate: true,
      confidence: 1
    },
    {
      id: "wire_top_left",
      from: null,
      to: `${resistor.id}.left`,
      route: { kind: "polyline", points: [{ x: leftRailX, y: topY }, { x: resistorLeftX, y: topY }] },
      style: { color: "#1f2e2b", width: 3.5 },
      current_candidate: true,
      confidence: 1
    },
    {
      id: "wire_top_mid",
      from: `${resistor.id}.right`,
      to: `${rheostat.id}.left`,
      route: { kind: "polyline", points: [{ x: resistorRightX, y: topY }, { x: midNodeX, y: topY }, { x: rheostatLeftX, y: topY }] },
      style: { color: "#1f2e2b", width: 3.5 },
      current_candidate: true,
      confidence: 1
    },
    {
      id: "wire_rheostat_tap",
      from: `${rheostat.id}.tap`,
      to: null,
      route: { kind: "polyline", points: [{ x: tapX, y: tapY }, { x: rightRailX, y: tapY }, { x: rightRailX, y: bottomY }] },
      style: { color: "#1f2e2b", width: 3.5 },
      current_candidate: true,
      confidence: 1
    },
    {
      id: "wire_switch_right",
      from: `${switchComponent.id}.right`,
      to: null,
      route: { kind: "polyline", points: [{ x: switchRightX, y: bottomY }, { x: rightRailX, y: bottomY }] },
      style: { color: "#1f2e2b", width: 3.5 },
      current_candidate: true,
      confidence: 1
    },
    {
      id: "wire_switch_left",
      from: `${battery.id}.positive`,
      to: `${switchComponent.id}.left`,
      route: { kind: "polyline", points: [{ x: batteryPositiveX, y: bottomY }, { x: switchLeftX, y: bottomY }] },
      style: { color: "#1f2e2b", width: 3.5 },
      current_candidate: true,
      confidence: 1
    },
    {
      id: "wire_battery_left",
      from: `${battery.id}.negative`,
      to: null,
      route: { kind: "polyline", points: [{ x: batteryNegativeX, y: bottomY }, { x: leftRailX, y: bottomY }] },
      style: { color: "#1f2e2b", width: 3.5 },
      current_candidate: true,
      confidence: 1
    },
    {
      id: "wire_voltmeter_left",
      from: null,
      to: `${voltmeter.id}.left`,
      route: { kind: "polyline", points: [{ x: leftRailX, y: voltmeterY }, { x: voltmeterLeftX, y: voltmeterY }] },
      style: { color: "#1f2e2b", width: 3.5 },
      current_candidate: false,
      confidence: 1
    },
    {
      id: "wire_voltmeter_right",
      from: `${voltmeter.id}.right`,
      to: null,
      route: { kind: "polyline", points: [{ x: voltmeterRightX, y: voltmeterY }, { x: midNodeX, y: voltmeterY }, { x: midNodeX, y: topY }] },
      style: { color: "#1f2e2b", width: 3.5 },
      current_candidate: false,
      confidence: 1
    }
  ];

  scene.junctions = [
    { id: "junction_left_top", x: leftRailX, y: topY, kind: "connected_dot", radius: 4.6 },
    { id: "junction_left_meter", x: leftRailX, y: voltmeterY, kind: "connected_dot", radius: 4.6 },
    { id: "junction_mid_top", x: midNodeX, y: topY, kind: "connected_dot", radius: 4.6 }
  ];

  scene.labels = [];
  uploadFinalUpsertLabel(scene, `label_${resistor.id}`, resistor.label || "R1", { x: resistor.center.x, y: topY - 18 }, resistor.id);
  uploadFinalUpsertLabel(scene, `label_${rheostat.id}`, rheostat.label || "R2", { x: rheostat.center.x + 10, y: topY + Math.max(26, rheostatBox[3]) }, rheostat.id);
  uploadFinalUpsertLabel(scene, `label_${voltmeter.id}`, voltmeter.label || "V", { x: voltmeter.center.x, y: voltmeter.center.y + 6 }, voltmeter.id);
  uploadFinalUpsertLabel(scene, `label_${switchComponent.id}`, switchComponent.label || "S", { x: switchComponent.center.x, y: bottomY - 18 }, switchComponent.id);
  uploadFinalUpsertLabel(scene, `label_${rheostat.id}_p`, "P", { x: tapX, y: tapY - 12 }, rheostat.id);

  scene.summary = "单回路电路：R1 与滑动变阻器串联，电压表并联在 R1 两端。";
  scene.simulation = {
    summary: "闭合开关后，可拖动滑片 P 调节接入电路的电阻。",
    adjustables: [
      {
        id: `adj_${switchComponent.id}`,
        label: switchComponent.label || "开关 S",
        type: "toggle",
        component_id: switchComponent.id,
        param: "closed",
        initial: switchClosed
      },
      {
        id: `adj_${rheostat.id}`,
        label: "滑片 P",
        type: "range",
        component_id: rheostat.id,
        param: "slider_position",
        min: 0,
        max: 1,
        step: 0.01,
        initial: sliderPosition
      }
    ],
    measurements: [],
    highlights: [
      {
        id: "highlight_series_rheostat",
        when: `${switchComponent.id}_closed`,
        wire_ids: scene.wires.map((wire) => wire.id),
        component_ids: scene.components.map((component) => component.id)
      }
    ]
  };
  scene.normalization = {
    template: "series_rheostat_voltmeter",
    note: "命中教材常见的“R1 + 滑动变阻器 + 电压表”结构，已按真实滑片接法重建中间态。"
  };
  uploadFinalSnapWireEndpoints(scene);
  scene.render_view_box = uploadFinalViewBox(scene);
  return scene;
}

function uploadFinalPrepareScene(rawScene) {
  const scene = uploadFinalClone(rawScene);

  if (uploadFinalMatchesSeriesTemplate(scene)) {
    return uploadFinalBuildSeriesScene(scene);
  }

  snapUploadWires(scene);
  (scene.components || []).forEach((component) => {
    if (component.type === "switch") normalizeUploadSwitch(scene, component);
    if (component.type === "variable_resistor") uploadFinalEnhanceVariableResistor(scene, component);
    if ((component.type === "ammeter" || component.type === "voltmeter") && uploadFinalMeterNeedsFallback(component)) {
      component.prefer_fallback = true;
    }
  });

  uploadFinalSnapWireEndpoints(scene);
  scene.render_view_box = uploadFinalViewBox(scene);
  scene.normalization = scene.normalization || {
    template: "generic",
    note: "已对导线端点、开关锚点和滑片接法做通用几何修正。"
  };
  return scene;
}

function uploadFinalSkipLabel(label) {
  const component = uploadFinalComponentById(state.upload.scene, label.belongs_to);
  if (!component) return false;
  if ((component.type === "ammeter" || component.type === "voltmeter") && component.prefer_fallback) return true;
  if (component.type === "variable_resistor" && component.prefer_fallback && String(label.text || "").trim().toUpperCase() === "P") return true;
  return false;
}

function uploadFinalRenderRheostat(component, active) {
  const bbox = uploadFinalBBox(component.bbox);
  const ratio = clamp(Number(component.params?.slider_position ?? 0.5), 0, 1);
  const cls = active ? "scene-component scene-component--active" : "scene-component";
  const track = component.interactive?.track || {
    x1: bbox[0] + 10,
    y1: bbox[1] - 18,
    x2: bbox[0] + bbox[2] - 10,
    y2: bbox[1] - 18
  };
  const handleX = track.x1 + (track.x2 - track.x1) * ratio;
  const tap = component.anchors?.tap ? uploadFinalPoint(component.anchors.tap, handleX, track.y1) : { x: handleX, y: track.y1 };
  const bodyLeft = component.anchors?.body_left ? uploadFinalPoint(component.anchors.body_left, bbox[0], bbox[1] + bbox[3] / 2) : { x: bbox[0], y: bbox[1] + bbox[3] / 2 };
  const bodyRight = component.anchors?.body_right ? uploadFinalPoint(component.anchors.body_right, bbox[0] + bbox[2], bbox[1] + bbox[3] / 2) : { x: bbox[0] + bbox[2], y: bbox[1] + bbox[3] / 2 };

  return `
    <g class="${cls}">
      <rect x="${bbox[0]}" y="${bbox[1]}" width="${bbox[2]}" height="${bbox[3]}" rx="4" class="scene-shell"></rect>
      <line x1="${tap.x}" y1="${tap.y}" x2="${handleX}" y2="${track.y1}" class="scene-line"></line>
      <line x1="${handleX}" y1="${track.y1}" x2="${handleX}" y2="${bbox[1] + 2}" class="scene-line"></line>
      <polygon points="${handleX},${bbox[1] + 4} ${handleX - 7},${bbox[1] - 8} ${handleX + 7},${bbox[1] - 8}" class="scene-arrow"></polygon>
      <text x="${handleX}" y="${track.y1 - 12}" text-anchor="middle" class="scene-inline-label">P</text>
      <circle cx="${bodyLeft.x}" cy="${bodyLeft.y}" r="4.2" class="scene-node scene-node--solid"></circle>
      ${component.params?.connection_mode === "tap_to_right" ? `<line x1="${bodyRight.x}" y1="${bodyRight.y}" x2="${bodyRight.x + 10}" y2="${bodyRight.y}" class="scene-line"></line>` : ""}
    </g>
  `;
}

function uploadFinalResolvedTap(component) {
  const bbox = uploadFinalBBox(component.bbox);
  const ratio = clamp(Number(component.params?.slider_position ?? 0.5), 0, 1);
  const track = component.interactive?.track || {
    x1: bbox[0] + 10,
    y1: bbox[1] - 18,
    x2: bbox[0] + bbox[2] - 10,
    y2: bbox[1] - 18
  };
  return {
    x: track.x1 + (track.x2 - track.x1) * ratio,
    y: track.y1
  };
}

renderSceneLabel = function renderSceneLabelFinal(label) {
  if (uploadFinalSkipLabel(label)) return "";
  const fontSize = Number(label.font_size || 18);
  const x = label.position?.x ?? 0;
  const y = label.position?.y ?? 0;
  const rotate = Number(label.rotation || 0);
  const transform = rotate ? ` transform="rotate(${rotate} ${x} ${y})"` : "";
  return `<text x="${x}" y="${y}" text-anchor="${label.text_anchor || "middle"}" font-size="${fontSize}" class="scene-label scene-label--upload"${transform}>${escapeUploadHtml(label.text || "")}</text>`;
};

renderSceneComponent = function renderSceneComponentFinal(scene, component, activeHighlights) {
  const current = getResolvedSceneComponent(component);
  const active = activeHighlights.components.has(current.id);
  const changed = hasComponentInteractionChanged(scene, current);

  if (current.type === "variable_resistor" && current.prefer_fallback) {
    return uploadFinalRenderRheostat(current, active);
  }

  if (current.primitives?.length && !changed && !current.prefer_fallback) {
    return `
      <g class="scene-component ${active ? "scene-component--active" : ""}">
        ${current.primitives.map((item) => renderScenePrimitive(item, active ? "scene-primitive--active" : "")).join("")}
      </g>
    `;
  }

  return uploadFinalBase.renderSceneFallbackComponent(current, active);
};

renderSceneWire = function renderSceneWireFinal(scene, wire, activeHighlights) {
  if (shouldSkipWire(scene, wire)) return "";

  const active = activeHighlights.wires.has(wire.id);
  const cls = active ? "scene-wire scene-wire--active" : "scene-wire";
  const stroke = wire.style?.color || "#1f2e2b";
  const width = wire.style?.width || 2.8;

  if (wire.route?.kind === "svg_path" && wire.route?.d) {
    return `<path class="${cls}" d="${wire.route.d}" stroke="${stroke}" stroke-width="${width}" />`;
  }

  const points = uploadFinalDedupe(wire.route?.points || []);
  const fromComponentId = String(wire.from || "").split(".")[0];
  const toComponentId = String(wire.to || "").split(".")[0];
  const fromAnchor = String(wire.from || "").split(".")[1];
  const toAnchor = String(wire.to || "").split(".")[1];
  const fromComponent = uploadFinalComponentById(scene, fromComponentId);
  const toComponent = uploadFinalComponentById(scene, toComponentId);

  if (fromComponent?.type === "variable_resistor" && (fromAnchor === "tap" || fromAnchor === "slider")) {
    points[0] = uploadFinalResolvedTap(getResolvedSceneComponent(fromComponent));
  }

  if (toComponent?.type === "variable_resistor" && (toAnchor === "tap" || toAnchor === "slider")) {
    points[points.length - 1] = uploadFinalResolvedTap(getResolvedSceneComponent(toComponent));
  }

  const pointText = uploadFinalOrthogonal(points).map((point) => `${point.x},${point.y}`).join(" ");
  return `<polyline class="${cls}" points="${pointText}" stroke="${stroke}" stroke-width="${width}" />`;
};

renderUploadScene = function renderUploadSceneFinal(scene) {
  if (!scene) {
    return `
      <div class="scene-stage scene-stage--upload">
        <div class="upload-empty">
          <div class="upload-empty__icon">+</div>
          <div class="upload-empty__title">上传电路题图片</div>
          <div class="upload-empty__desc">支持 JPG / JPEG / PNG。上传后会先输出结构化中间态，再生成可交互的电路图复刻结果。</div>
        </div>
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

  const highlights = getSceneHighlights(scene);
  const viewBox = scene.render_view_box || uploadFinalViewBox(scene);
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
        ${(scene.components || []).map((item) => renderSceneComponent(scene, item, highlights)).join("")}
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
};

function uploadFinalMeta(scene) {
  if (!scene) {
    return {
      title: "上传题目：通用识别与 1:1 复刻",
      desc: "上传任意电路题图片，系统会先生成结构化中间态，再做拓扑修正、导线吸附和交互渲染。"
    };
  }

  return {
    title: scene.title || "上传题目：电路图复刻结果",
    desc: scene.summary || "已生成可交互的电路图复刻结果。"
  };
}

function uploadFinalSummary(scene) {
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
    .map(([type, count]) => `${labels[type] || type} x ${count}`)
    .join(" / ");
}

function uploadFinalAdjustables(scene) {
  const adjustables = scene?.simulation?.adjustables || [];
  if (!adjustables.length) {
    return `<div class="hint">当前结果没有返回可调参数，先展示静态复刻结果。</div>`;
  }

  return adjustables.map((item) => {
    const component = (scene.components || []).find((entry) => entry.id === item.component_id);
    const value = getSceneInteractiveValue(item.component_id, item.param, component?.params?.[item.param]);
    const type = normalizeAdjustableType(item.type);
    const label = escapeUploadHtml(item.label || component?.label || item.component_id);

    if (type === "toggle") {
      return `<button class="control-btn ${value ? "control-btn--on" : "control-btn--off"}" data-action="upload-toggle-adjustable" data-component="${item.component_id}" data-param="${item.param}">${label}：${value ? "闭合" : "断开"}</button>`;
    }

    return `
      <label class="slider-panel">
        <span>${label}：${format(Number(value), 2)}</span>
        <input type="range" min="${item.min ?? 0}" max="${item.max ?? 1}" step="${item.step ?? 0.01}" value="${value ?? item.min ?? 0}" data-action="upload-range-adjustable" data-component="${item.component_id}" data-param="${item.param}" />
      </label>
    `;
  }).join("");
}

renderPreviewCard = function renderPreviewCardFinal() {
  if (state.selectedCase !== "upload") {
    return uploadFinalBase.renderPreviewCard();
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

renderUploadPage = function renderUploadPageFinal() {
  const scene = state.upload.scene;
  const meta = uploadFinalMeta(scene);
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
      ? "正在调用多模态模型识别题图，请等待结果返回。"
      : (scene?.normalization?.template === "series_rheostat_voltmeter"
          ? "当前题图命中了“R1 + 滑动变阻器 + 电压表”模板，系统已按真实滑片接法重建中间态。"
          : "当前题图使用通用归一化流程，重点修正开关锚点、滑片接线和导线端点吸附问题。"),
    parametersTitle: "识别结构",
    parameters: scene ? `
      <div class="kv-list">
        <div class="kv-item"><span>组件总数</span><strong>${scene.components?.length || 0}</strong></div>
        <div class="kv-item"><span>导线总数</span><strong>${scene.wires?.length || 0}</strong></div>
        <div class="kv-item"><span>文字标注</span><strong>${scene.labels?.length || 0}</strong></div>
        <div class="kv-item"><span>可交互项</span><strong>${adjustables.length}</strong></div>
        <div class="kv-item"><span>识别结构</span><strong>${escapeUploadHtml(uploadFinalSummary(scene) || "暂无")}</strong></div>
      </div>
    ` : `
      <div class="kv-list">
        <div class="kv-item"><span>识别方式</span><strong>题图 -> scene JSON</strong></div>
        <div class="kv-item"><span>输出格式</span><strong>SVG / HTML</strong></div>
        <div class="kv-item"><span>目标</span><strong>1:1 复刻</strong></div>
      </div>
    `,
    lawsTitle: "交互与校正",
    laws: scene ? `
      <ul class="fact-list">
        ${adjustables.map((item) => `<li>可交互元件：${escapeUploadHtml(item.label || item.component_id)}</li>`).join("") || "<li>当前结果没有返回可调参数。</li>"}
        <li>${escapeUploadHtml(scene?.normalization?.note || "当前结果已做中间态规范化。")}</li>
      </ul>
    ` : `
      <ul class="fact-list">
        <li>优先识别电源、开关、电阻、滑片、电表和关键节点。</li>
        <li>先输出 scene 中间态，再做拓扑修正和几何吸附，最后进入 SVG 渲染。</li>
        <li>重点修复滑动变阻器的真实接法，避免生成简化后的等效电路。</li>
      </ul>
    `,
    controls: `
      <div class="control-stack">
        <input class="hidden-input" id="upload-input" type="file" accept=".jpg,.jpeg,.png,image/jpeg,image/png" />
        <button class="control-btn" data-action="upload-open" ${state.upload.loading ? "disabled" : ""}>${state.upload.loading ? "识别中..." : scene ? "重新上传题图" : "上传题图"}</button>
        ${scene ? uploadFinalAdjustables(scene) : `<div class="hint">选择图片后会自动开始识别，不需要再额外点击解析按钮。</div>`}
      </div>
    `
  };
};

parseUploadedFile = async function parseUploadedFileFinal(file) {
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

    const preparedScene = uploadFinalPrepareScene(data.scene);
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
};

renderApp();
