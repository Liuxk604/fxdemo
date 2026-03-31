const q1 = {
  source: "manual_fine_grained_q1",
  viewBox: "120 52 560 330",
  batteryVoltage: 1.5,
  lamps: [
    { id: "L1", cx: 285, cy: 192, r: 24 },
    { id: "L2", cx: 520, cy: 192, r: 24 },
    { id: "L3", cx: 285, cy: 326, r: 24 }
  ],
  geometry: {
    leftX: 170,
    centerX: 420,
    rightX: 640,
    topY: 96,
    midY: 192,
    bottomY: 326,
    switchPivotX: 480,
    switchContactX: 538,
    switchOpenTipX: 522,
    switchOpenTipY: 294,
    batteryShortX: 580,
    batteryLongX: 602,
    batteryShortTop: 308,
    batteryShortBottom: 344,
    batteryLongTop: 298,
    batteryLongBottom: 354,
    batteryEndX: 640
  }
};

const q2 = {
  source: "manual_fine_grained_q2",
  viewBox: "160 76 560 420",
  geometry: {
    leftX: 210,
    sourceX: 340,
    v3X: 430,
    centerX: 520,
    rightX: 650,
    topY: 96,
    centerY: 288,
    bottomY: 456,
    v2Cy: 276,
    v3Cy: 184,
    a1Cx: 430,
    a2Cx: 586,
    a3Cy: 228,
    v1Cy: 388,
    switchTopY: 132,
    switchOpenTipX: 316,
    switchOpenTipY: 164,
    batteryShortY: 236,
    batteryLongY: 266,
    batteryShortLeft: 324,
    batteryShortRight: 356,
    batteryLongLeft: 313,
    batteryLongRight: 367,
    r3Top: 126,
    r3Bottom: 186,
    r1Top: 332,
    r1Bottom: 394,
    r2Top: 126,
    r2Bottom: 234,
    meterR: 28,
    resistorW: 34,
    sliderRightX: 580,
    sliderLeftX: 536,
    sliderTopY: 144,
    sliderBottomY: 180
  }
};

const q3 = {
  source: "manual_fine_grained_q3",
  viewBox: "150 72 560 320",
  batteryVoltage: 12,
  r1: 10,
  r2Min: 2,
  r2Max: 50,
  geometry: {
    leftX: 180,
    centerX: 430,
    rightX: 700,
    topY: 120,
    bottomY: 352,
    r1X: 286,
    r1Y: 106,
    r1W: 92,
    r1H: 28,
    r2X: 500,
    r2Y: 106,
    r2W: 112,
    r2H: 28,
    voltmeterCx: 306,
    voltmeterCy: 210,
    meterR: 28,
    batteryShortX: 332,
    batteryLongX: 354,
    batteryShortTop: 334,
    batteryShortBottom: 370,
    batteryLongTop: 324,
    batteryLongBottom: 380,
    switchPivotX: 560,
    switchContactX: 620,
    switchOpenTipX: 604,
    switchOpenTipY: 316,
    sliderTopY: 68,
    sliderBottomY: 106,
    sliderMinX: 520,
    sliderMaxX: 592,
    sliderLoopTopY: 78,
    sliderLoopRightX: 612
  }
};

const state = {
  selectedCase: "q1",
  q1: { switchClosed: false },
  q2: { switchClosed: false, slider: 62 },
  q3: { switchClosed: false, slider: 25 }
};

const caseMeta = {
  q1: { title: "题目1原图", image: "public/题目1.jpg" },
  q2: { title: "题目2原图", image: "public/题目2.jpg" },
  q3: { title: "题目3原图", image: "public/题目3.png" },
  upload: { title: "上传题目", image: "" }
};

const app = document.getElementById("app");

function format(num, digits = 2) {
  return Number(num).toFixed(digits).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function q1Solve() {
  if (!state.q1.switchClosed) {
    return {
      switchText: "断开",
      eqResistance: Infinity,
      totalCurrent: 0,
      lamps: { L1: false, L2: false, L3: false },
      conclusion: "开关断开，电路开路，三盏灯均不发光。"
    };
  }
  const branchResistance = 6;
  const eqResistance = branchResistance / 3;
  const branchCurrent = q1.batteryVoltage / branchResistance;
  return {
    switchText: "闭合",
    eqResistance,
    totalCurrent: branchCurrent * 3,
    lamps: { L1: true, L2: true, L3: true },
    conclusion: "闭合后，三盏灯构成并联，三灯均发光，亮度相同。"
  };
}

function q2State() {
  const position = state.q2.slider >= 67 ? "上" : state.q2.slider <= 33 ? "下" : "中";
  return {
    switchText: state.q2.switchClosed ? "闭合" : "断开",
    sliderText: `R3 滑片偏${position}`,
    conclusion: state.q2.switchClosed
      ? "已闭合开关 S，可继续调节 R3 滑片位置观察电路结构。"
      : "开关断开时，电路保持结构展示状态。"
  };
}

function q3Solve() {
  const r2Value = q3.r2Min + (state.q3.slider / 100) * (q3.r2Max - q3.r2Min);
  if (!state.q3.switchClosed) {
    return {
      switchText: "断开",
      r2Value,
      current: 0,
      voltageV: 0,
      conclusion: "开关断开时，电流为 0，电压表示数归零。"
    };
  }
  const current = q3.batteryVoltage / (q3.r1 + r2Value);
  const voltageV = current * q3.r1;
  return {
    switchText: "闭合",
    r2Value,
    current,
    voltageV,
    conclusion: `闭合后，R1 与 R2 串联，电压表测量 R1 两端电压，当前示数约为 ${format(voltageV)}V。`
  };
}

function renderTabs() {
  const items = [
    { id: "q1", index: "01", title: "题目1", desc: "串并联判断" },
    { id: "q2", index: "02", title: "题目2", desc: "多表联动" },
    { id: "q3", index: "03", title: "题目3", desc: "滑变实验" },
    { id: "upload", index: "UP", title: "上传题目", desc: "1:1复刻" }
  ];
  return `
    <div class="tabs">
      <div class="tabs__label">Experiments</div>
      ${items.map((item) => `
        <button class="tab ${item.id === "upload" ? "tab--upload" : ""} ${state.selectedCase === item.id ? "active" : ""}" data-case="${item.id}">
          <span class="tab__index">${item.index}</span>
          <span class="tab__content">
            <strong>${item.title}</strong>
            <span>${item.desc}</span>
          </span>
        </button>
      `).join("")}
    </div>
  `;
}

function lampSymbol({ id, cx, cy, r }, active) {
  return `
    <g>
      <circle cx="${cx}" cy="${cy}" r="${r + 10}" fill="rgba(255,216,94,${active ? 0.40 : 0})" class="lamp-glow"></circle>
      <circle cx="${cx}" cy="${cy}" r="${r}" class="lamp-shell"></circle>
      <line x1="${cx - 14}" y1="${cy - 14}" x2="${cx + 14}" y2="${cy + 14}" class="lamp-cross"></line>
      <line x1="${cx - 14}" y1="${cy + 14}" x2="${cx + 14}" y2="${cy - 14}" class="lamp-cross"></line>
      <text x="${cx}" y="${cy - 42}" text-anchor="middle" class="label">${id}</text>
    </g>
  `;
}

function meterVertical(x, cy, r, label, topY, bottomY, active = false) {
  return `
    <g class="${active ? "active-component" : ""}">
      <line x1="${x}" y1="${topY}" x2="${x}" y2="${cy - r}" class="component-line"></line>
      <line x1="${x}" y1="${cy + r}" x2="${x}" y2="${bottomY}" class="component-line"></line>
      <circle cx="${x}" cy="${cy}" r="${r}" class="lamp-shell"></circle>
      <circle cx="${x}" cy="${cy}" r="${r + 10}" fill="rgba(255,216,94,${active ? 0.26 : 0})" class="component-glow"></circle>
      <text x="${x}" y="${cy + 8}" text-anchor="middle" class="label">${label}</text>
    </g>
  `;
}

function meterHorizontal(cx, y, r, label, leftX, rightX, active = false) {
  return `
    <g class="${active ? "active-component" : ""}">
      <line x1="${leftX}" y1="${y}" x2="${cx - r}" y2="${y}" class="component-line"></line>
      <line x1="${cx + r}" y1="${y}" x2="${rightX}" y2="${y}" class="component-line"></line>
      <circle cx="${cx}" cy="${y}" r="${r}" class="lamp-shell"></circle>
      <circle cx="${cx}" cy="${y}" r="${r + 10}" fill="rgba(255,216,94,${active ? 0.26 : 0})" class="component-glow"></circle>
      <text x="${cx}" y="${y + 8}" text-anchor="middle" class="label">${label}</text>
    </g>
  `;
}

function resistorVertical(x, topY, bottomY, width, label, labelDx = 34, labelDy = 4, active = false) {
  const h = bottomY - topY;
  return `
    <g class="${active ? "active-component" : ""}">
      <rect x="${x - width / 2}" y="${topY}" width="${width}" height="${h}" rx="4" fill="#ffffff" stroke="#1f2e2b" stroke-width="4"></rect>
      <text x="${x + labelDx}" y="${topY + h / 2 + labelDy}" class="label">${label}</text>
    </g>
  `;
}

function resistorHorizontal(x, y, width, height, label, labelDx = 0, labelDy = -14, active = false) {
  return `
    <g class="${active ? "active-component" : ""}">
      <rect x="${x}" y="${y}" width="${width}" height="${height}" rx="4" fill="#ffffff" stroke="#1f2e2b" stroke-width="4"></rect>
      <text x="${x + width / 2 + labelDx}" y="${y + labelDy}" text-anchor="middle" class="label">${label}</text>
    </g>
  `;
}

function q1BaseWires() {
  const g = q1.geometry;
  const l1 = q1.lamps[0];
  const l2 = q1.lamps[1];
  const l3 = q1.lamps[2];
  return `
    <path class="wire" d="M${g.leftX} ${g.topY} L${g.rightX} ${g.topY}"></path>
    <path class="wire" d="M${g.leftX} ${g.topY} L${g.leftX} ${g.bottomY}"></path>
    <path class="wire" d="M${g.rightX} ${g.topY} L${g.rightX} ${g.bottomY}"></path>
    <path class="wire" d="M${g.leftX} ${g.midY} L${l1.cx - l1.r} ${g.midY}"></path>
    <path class="wire" d="M${l1.cx + l1.r} ${g.midY} L${g.centerX} ${g.midY}"></path>
    <path class="wire" d="M${g.centerX} ${g.midY} L${l2.cx - l2.r} ${g.midY}"></path>
    <path class="wire" d="M${l2.cx + l2.r} ${g.midY} L${g.rightX} ${g.midY}"></path>
    <path class="wire" d="M${g.leftX} ${g.bottomY} L${l3.cx - l3.r} ${g.bottomY}"></path>
    <path class="wire" d="M${l3.cx + l3.r} ${g.bottomY} L${g.centerX} ${g.bottomY}"></path>
    <path class="wire" d="M${g.centerX} ${g.midY} L${g.centerX} ${g.bottomY}"></path>
    <path class="wire" d="M${g.centerX} ${g.bottomY} L${g.switchPivotX} ${g.bottomY}"></path>
    <path class="wire" d="M${g.switchContactX} ${g.bottomY} L${g.batteryShortX} ${g.bottomY}"></path>
    <path class="wire" d="M${g.batteryLongX} ${g.bottomY} L${g.batteryEndX} ${g.bottomY}"></path>
  `;
}

function q1LivePaths() {
  if (!state.q1.switchClosed) return "";
  const g = q1.geometry;
  return `
    <path class="current-path" d="M${g.batteryEndX} ${g.bottomY} L${g.rightX} ${g.bottomY} L${g.rightX} ${g.topY} L${g.leftX} ${g.topY} L${g.leftX} ${g.midY} L${g.centerX} ${g.midY} L${g.centerX} ${g.bottomY} L${g.switchPivotX} ${g.bottomY} L${g.switchContactX} ${g.bottomY} L${g.batteryShortX} ${g.bottomY}"></path>
    <path class="current-path" d="M${g.batteryEndX} ${g.bottomY} L${g.rightX} ${g.bottomY} L${g.rightX} ${g.midY} L${g.centerX} ${g.midY} L${g.centerX} ${g.bottomY} L${g.switchPivotX} ${g.bottomY} L${g.switchContactX} ${g.bottomY} L${g.batteryShortX} ${g.bottomY}"></path>
    <path class="current-path" d="M${g.batteryEndX} ${g.bottomY} L${g.rightX} ${g.bottomY} L${g.rightX} ${g.topY} L${g.leftX} ${g.topY} L${g.leftX} ${g.bottomY} L${g.centerX} ${g.bottomY} L${g.switchPivotX} ${g.bottomY} L${g.switchContactX} ${g.bottomY} L${g.batteryShortX} ${g.bottomY}"></path>
  `;
}

function q1Particles() {
  return "";
}

function q1SwitchSymbol() {
  const g = q1.geometry;
  const x2 = state.q1.switchClosed ? g.switchContactX - 5 : g.switchOpenTipX;
  const y2 = state.q1.switchClosed ? g.bottomY : g.switchOpenTipY;
  const lineClass = state.q1.switchClosed ? "component-line component-line--live" : "component-line";
  return `
    <g class="switch-hit" data-action="toggle-q1-switch">
      <circle cx="${g.switchPivotX}" cy="${g.bottomY}" r="5.8" class="node ${state.q1.switchClosed ? "live" : ""}"></circle>
      <circle cx="${g.switchContactX}" cy="${g.bottomY}" r="5.8" class="node ${state.q1.switchClosed ? "live" : ""}"></circle>
      <line x1="${g.switchPivotX + 5}" y1="${g.bottomY}" x2="${x2}" y2="${y2}" class="${lineClass}"></line>
      <text x="${(g.switchPivotX + g.switchContactX) / 2}" y="${g.bottomY - 42}" text-anchor="middle" class="label">S</text>
      <rect x="${g.switchPivotX - 20}" y="${g.bottomY - 56}" width="106" height="84" rx="18" fill="transparent"></rect>
    </g>
  `;
}

function q1BatterySymbol() {
  const g = q1.geometry;
  const lineClass = state.q1.switchClosed ? "component-line component-line--live" : "component-line";
  return `
    <g>
      <line x1="${g.batteryShortX}" y1="${g.batteryShortTop}" x2="${g.batteryShortX}" y2="${g.batteryShortBottom}" class="${lineClass}"></line>
      <line x1="${g.batteryLongX}" y1="${g.batteryLongTop}" x2="${g.batteryLongX}" y2="${g.batteryLongBottom}" class="${lineClass}"></line>
    </g>
  `;
}

function q1NodeDots() {
  const g = q1.geometry;
  const dots = [[g.leftX, g.midY], [g.rightX, g.midY], [g.centerX, g.midY], [g.centerX, g.bottomY]];
  return dots.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="5.8" class="node ${state.q1.switchClosed ? "live" : ""}"></circle>`).join("");
}

function q2BaseWires() {
  const g = q2.geometry;
  return `
    <path class="wire" d="M${g.leftX} ${g.topY} L${g.rightX} ${g.topY}"></path>
    <path class="wire" d="M${g.leftX} ${g.bottomY} L${g.sourceX} ${g.bottomY}"></path>
    <path class="wire" d="M${g.centerX} ${g.bottomY} L${g.rightX} ${g.bottomY}"></path>
    <path class="wire" d="M${g.v3X} ${g.centerY} L${g.centerX} ${g.centerY}"></path>
  `;
}

function q2LivePaths() {
  if (!state.q2.switchClosed) return "";
  const g = q2.geometry;
  return `
    <path class="current-path" d="M${g.sourceX} ${g.topY} L${g.rightX} ${g.topY}"></path>
    <path class="current-path" d="M${g.sourceX} ${g.switchTopY} L${g.sourceX} ${g.bottomY}"></path>
    <path class="current-path" d="M${g.sourceX} ${g.bottomY} L${g.rightX} ${g.bottomY}"></path>
    <path class="current-path" d="M${g.centerX} ${g.topY} L${g.centerX} ${g.centerY} L${g.centerX} ${g.bottomY}"></path>
    <path class="current-path" d="M${g.v3X} ${g.centerY} L${g.centerX} ${g.centerY}"></path>
    <path class="current-path" d="M${g.centerX} ${g.centerY} L${g.rightX} ${g.centerY}"></path>
    <path class="current-path" d="M${g.rightX} ${g.topY} L${g.rightX} ${g.bottomY}"></path>
  `;
}

function q2Particles() {
  return "";
}

function q2SwitchSymbol() {
  const g = q2.geometry;
  const x2 = state.q2.switchClosed ? g.sourceX : g.switchOpenTipX;
  const y2 = state.q2.switchClosed ? g.switchTopY + 2 : g.switchOpenTipY;
  const lineClass = state.q2.switchClosed ? "component-line component-line--live" : "component-line";
  return `
    <g class="switch-hit" data-action="toggle-q2-switch">
      <circle cx="${g.sourceX}" cy="${g.topY}" r="5.5" class="node ${state.q2.switchClosed ? "live" : ""}"></circle>
      <circle cx="${g.sourceX}" cy="${g.switchTopY}" r="5.5" class="node ${state.q2.switchClosed ? "live" : ""}"></circle>
      <line x1="${g.sourceX - 2}" y1="${g.topY + 6}" x2="${x2}" y2="${y2}" class="${lineClass}"></line>
      <text x="${g.sourceX - 34}" y="${g.topY + 14}" class="label">S</text>
      <rect x="${g.sourceX - 42}" y="${g.topY - 18}" width="78" height="82" rx="18" fill="transparent"></rect>
    </g>
  `;
}

function q2BatterySymbol() {
  const g = q2.geometry;
  const lineClass = state.q2.switchClosed ? "component-line component-line--live" : "component-line";
  return `
    <g>
      <line x1="${g.sourceX}" y1="${g.switchTopY}" x2="${g.sourceX}" y2="${g.batteryShortY - 12}" class="${lineClass}"></line>
      <line x1="${g.batteryShortLeft}" y1="${g.batteryShortY}" x2="${g.batteryShortRight}" y2="${g.batteryShortY}" class="${lineClass}"></line>
      <line x1="${g.batteryLongLeft}" y1="${g.batteryLongY}" x2="${g.batteryLongRight}" y2="${g.batteryLongY}" class="${lineClass}"></line>
      <line x1="${g.sourceX}" y1="${g.batteryLongY + 12}" x2="${g.sourceX}" y2="${g.bottomY}" class="${lineClass}"></line>
      <text x="${g.sourceX - 40}" y="${g.batteryLongY + 48}" class="sub-label">E, r</text>
    </g>
  `;
}

function q2SliderSymbol() {
  const g = q2.geometry;
  const y = g.sliderBottomY - (state.q2.slider / 100) * (g.sliderBottomY - g.sliderTopY);
  const lineClass = state.q2.switchClosed ? "component-line component-line--live" : "component-line";
  return `
    <g class="slider-hit" data-action="q2-slider-handle">
      <line x1="${g.sliderRightX}" y1="${y}" x2="${g.sliderLeftX}" y2="${y}" class="${lineClass}"></line>
      <polygon points="${g.sliderLeftX},${y} ${g.sliderLeftX + 10},${y - 6} ${g.sliderLeftX + 10},${y + 6}" fill="${state.q2.switchClosed ? "#d18d00" : "#1f2e2b"}"></polygon>
      <circle cx="${g.sliderRightX}" cy="${y}" r="8.5" fill="${state.q2.switchClosed ? "#ffd86f" : "#1ea36e"}" stroke="#ffffff" stroke-width="3"></circle>
      <rect x="${g.sliderLeftX - 10}" y="${g.sliderTopY - 18}" width="${g.sliderRightX - g.sliderLeftX + 28}" height="${g.sliderBottomY - g.sliderTopY + 36}" rx="16" fill="transparent"></rect>
    </g>
  `;
}

function q2NodeDots() {
  const g = q2.geometry;
  const dots = [
    [g.sourceX, g.topY],
    [g.v3X, g.topY],
    [g.centerX, g.topY],
    [g.rightX, g.topY],
    [g.centerX, g.centerY],
    [g.rightX, g.centerY],
    [g.sourceX, g.bottomY],
    [g.centerX, g.bottomY]
  ];
  return dots.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="5.6" class="node ${state.q2.switchClosed ? "live" : ""}"></circle>`).join("");
}

function renderQ1() {
  const result = q1Solve();
  return {
    title: "题目1：串并联电路判断",
    desc: "观察开关闭合前后，三盏灯的发光状态与并联关系。",
    badges: [
      `开关：${result.switchText}`,
      `等效电阻：${Number.isFinite(result.eqResistance) ? `${format(result.eqResistance)}Ω` : "∞"}`,
      `状态：${state.q1.switchClosed ? "三灯均亮" : "三灯熄灭"}`
    ],
    accentIndex: 2,
    svg: `
      <svg viewBox="${q1.viewBox}" aria-label="题目1电路图" class="${state.q1.switchClosed ? "circuit-live" : ""}">
        <defs>
          <clipPath id="clip-q1"><rect x="0" y="0" width="900" height="520" rx="0"></rect></clipPath>
        </defs>
        ${q1BaseWires()}
        ${q1LivePaths()}
        ${lampSymbol(q1.lamps[0], result.lamps.L1)}
        ${lampSymbol(q1.lamps[1], result.lamps.L2)}
        ${lampSymbol(q1.lamps[2], result.lamps.L3)}
        ${q1SwitchSymbol()}
        ${q1BatterySymbol()}
        ${q1NodeDots()}
        <text x="590" y="285" text-anchor="middle" class="sub-label">电源</text>
      </svg>
    `,
    footerTitle: "实验结论",
    footerDesc: result.conclusion,
    controls: `
      <div class="control-stack">
        <button class="control-btn ${state.q1.switchClosed ? "control-btn--on" : "control-btn--off"}" data-action="toggle-q1-switch">开关</button>
      </div>
    `,
    parameters: `
      <div class="kv-list">
        <div class="kv-item"><span>电源电压</span><strong>${format(q1.batteryVoltage)}V</strong></div>
        <div class="kv-item"><span>单灯阻值</span><strong>6Ω</strong></div>
        <div class="kv-item"><span>总电流</span><strong>${format(result.totalCurrent)}A</strong></div>
      </div>
    `,
    laws: `
      <ul class="fact-list">
        <li>并联电路中，各支路两端电压相等。</li>
        <li>当开关闭合时，三盏灯都直接接在电源两端。</li>
        <li>同规格灯泡并联时，亮度相同。</li>
      </ul>
    `
  };
}

function renderQ2() {
  const g = q2.geometry;
  const s = q2State();
  const lineClass = state.q2.switchClosed ? "component-line component-line--live" : "component-line";
  return {
    title: "题目2：多电表联动分析",
    desc: "观察滑动变阻器位置变化后，电流表与电压表的联动趋势。",
    badges: [`开关：${s.switchText}`, s.sliderText, `结构：V2 / S / E,r / V3 / R3 / A3 / R1 / A2 / R2 / V1`],
    accentIndex: 2,
    svg: `
      <svg viewBox="${q2.viewBox}" aria-label="题目2电路图" class="${state.q2.switchClosed ? "circuit-live" : ""}">
        <defs>
          <clipPath id="clip-q2"><rect x="0" y="0" width="980" height="620" rx="0"></rect></clipPath>
        </defs>
        ${q2BaseWires()}
        ${q2LivePaths()}
        ${meterVertical(g.leftX, g.v2Cy, g.meterR, 'V2', g.topY, g.bottomY, state.q2.switchClosed)}
        ${q2SwitchSymbol()}
        ${q2BatterySymbol()}
        ${meterVertical(g.v3X, g.v3Cy, g.meterR, 'V3', g.topY, g.centerY, state.q2.switchClosed)}

        <line x1="${g.centerX}" y1="${g.topY}" x2="${g.centerX}" y2="${g.r3Top}" class="${lineClass}"></line>
        ${resistorVertical(g.centerX, g.r3Top, g.r3Bottom, g.resistorW, 'R3', 24, -18, state.q2.switchClosed)}
        <line x1="${g.centerX}" y1="${g.r3Bottom}" x2="${g.centerX}" y2="${g.a3Cy - g.meterR}" class="${lineClass}"></line>
        ${meterVertical(g.centerX, g.a3Cy, g.meterR, 'A3', g.a3Cy - g.meterR, g.centerY, state.q2.switchClosed)}
        ${q2SliderSymbol()}

        <line x1="${g.centerX}" y1="${g.centerY}" x2="${g.centerX}" y2="${g.r1Top}" class="${lineClass}"></line>
        ${resistorVertical(g.centerX, g.r1Top, g.r1Bottom, g.resistorW, 'R1', 34, 4, state.q2.switchClosed)}
        <line x1="${g.centerX}" y1="${g.r1Bottom}" x2="${g.centerX}" y2="${g.bottomY}" class="${lineClass}"></line>

        <line x1="${g.rightX}" y1="${g.topY}" x2="${g.rightX}" y2="${g.r2Top}" class="${lineClass}"></line>
        ${resistorVertical(g.rightX, g.r2Top, g.r2Bottom, g.resistorW, 'R2', 30, 8, state.q2.switchClosed)}
        <line x1="${g.rightX}" y1="${g.r2Bottom}" x2="${g.rightX}" y2="${g.centerY}" class="${lineClass}"></line>
        ${meterVertical(g.rightX, g.v1Cy, g.meterR, 'V1', g.centerY, g.bottomY, state.q2.switchClosed)}

        ${meterHorizontal(g.a1Cx, g.bottomY, g.meterR, 'A1', g.sourceX, g.centerX, state.q2.switchClosed)}
        ${meterHorizontal(g.a2Cx, g.centerY, g.meterR, 'A2', g.centerX, g.rightX, state.q2.switchClosed)}
        ${q2NodeDots()}
      </svg>
    `,
    footerTitle: "实验结论",
    footerDesc: `${s.conclusion} 可直接在电路图中拖动 R3 的滑片。`,
    controls: `
      <div class="control-stack">
        <button class="control-btn ${state.q2.switchClosed ? "control-btn--on" : "control-btn--off"}" data-action="toggle-q2-switch">开关</button>
        <label class="slider-panel">
          <span>R3 滑片位置</span>
          <input type="range" min="0" max="100" value="${state.q2.slider}" data-action="q2-slider-range" />
        </label>
        <div class="mini-actions">
          <button class="chip-btn ${state.q2.slider < 34 ? "active" : ""}" data-action="q2-slider-low">R3较小</button>
          <button class="chip-btn ${state.q2.slider >= 34 && state.q2.slider <= 66 ? "active" : ""}" data-action="q2-slider-mid">R3居中</button>
          <button class="chip-btn ${state.q2.slider > 66 ? "active" : ""}" data-action="q2-slider-high">R3较大</button>
        </div>
        <div class="hint">支持按钮预设与图内拖动两种方式。</div>
      </div>
    `,
    parameters: `
      <div class="kv-list">
        <div class="kv-item"><span>R3滑片</span><strong>${format(state.q2.slider, 0)}%</strong></div>
        <div class="kv-item"><span>开关状态</span><strong>${s.switchText}</strong></div>
        <div class="kv-item"><span>联动重点</span><strong>电流 / 电压</strong></div>
      </div>
    `,
    laws: `
      <ul class="fact-list">
        <li>滑动变阻器接入电阻变化，会影响总电流与分路电流。</li>
        <li>多表题的关键是先找主干、支路和测量对象。</li>
        <li>看清并联与串联关系后，再判断示数变化方向。</li>
      </ul>
    `
  };
}

function q3BaseWires() {
  const g = q3.geometry;
  return `
    <path class="wire" d="M${g.leftX} ${g.topY} L${g.rightX} ${g.topY}"></path>
    <path class="wire" d="M${g.leftX} ${g.topY} L${g.leftX} ${g.bottomY}"></path>
    <path class="wire" d="M${g.rightX} ${g.topY} L${g.rightX} ${g.bottomY}"></path>
    <path class="wire" d="M${g.leftX} ${g.bottomY} L${g.batteryShortX} ${g.bottomY}"></path>
    <path class="wire" d="M${g.batteryLongX} ${g.bottomY} L${g.switchPivotX} ${g.bottomY}"></path>
    <path class="wire" d="M${g.switchContactX} ${g.bottomY} L${g.rightX} ${g.bottomY}"></path>
    <path class="wire" d="M${g.leftX} ${g.topY} L${g.r1X} ${g.topY}"></path>
    <path class="wire" d="M${g.r1X + g.r1W} ${g.topY} L${g.centerX} ${g.topY}"></path>
    <path class="wire" d="M${g.centerX} ${g.topY} L${g.r2X} ${g.topY}"></path>
    <path class="wire" d="M${g.r2X + g.r2W} ${g.topY} L${g.rightX} ${g.topY}"></path>
    <path class="wire" d="M${g.leftX} ${g.voltmeterCy} L${g.voltmeterCx - g.meterR} ${g.voltmeterCy}"></path>
    <path class="wire" d="M${g.voltmeterCx + g.meterR} ${g.voltmeterCy} L${g.centerX} ${g.voltmeterCy} L${g.centerX} ${g.topY}"></path>
  `;
}

function q3LivePaths() {
  if (!state.q3.switchClosed) return "";
  const g = q3.geometry;
  return `
    <path class="current-path" d="M${g.batteryLongX} ${g.bottomY} L${g.switchPivotX} ${g.bottomY} L${g.switchContactX} ${g.bottomY} L${g.rightX} ${g.bottomY} L${g.rightX} ${g.topY} L${g.leftX} ${g.topY} L${g.leftX} ${g.bottomY} L${g.batteryShortX} ${g.bottomY}"></path>
  `;
}

function q3Particles() {
  return "";
}

function q3BatterySymbol() {
  const g = q3.geometry;
  const lineClass = state.q3.switchClosed ? "component-line component-line--live" : "component-line";
  return `
    <g>
      <line x1="${g.batteryShortX}" y1="${g.batteryShortTop}" x2="${g.batteryShortX}" y2="${g.batteryShortBottom}" class="${lineClass}"></line>
      <line x1="${g.batteryLongX}" y1="${g.batteryLongTop}" x2="${g.batteryLongX}" y2="${g.batteryLongBottom}" class="${lineClass}"></line>
    </g>
  `;
}

function q3SwitchSymbol() {
  const g = q3.geometry;
  const x2 = state.q3.switchClosed ? g.switchContactX - 4 : g.switchOpenTipX;
  const y2 = state.q3.switchClosed ? g.bottomY : g.switchOpenTipY;
  const lineClass = state.q3.switchClosed ? "component-line component-line--live" : "component-line";
  return `
    <g class="switch-hit" data-action="toggle-q3-switch">
      <circle cx="${g.switchPivotX}" cy="${g.bottomY}" r="5.6" class="node ${state.q3.switchClosed ? "live" : ""}"></circle>
      <circle cx="${g.switchContactX}" cy="${g.bottomY}" r="5.6" class="node ${state.q3.switchClosed ? "live" : ""}"></circle>
      <line x1="${g.switchPivotX + 5}" y1="${g.bottomY}" x2="${x2}" y2="${y2}" class="${lineClass}"></line>
      <text x="${(g.switchPivotX + g.switchContactX) / 2}" y="${g.bottomY - 40}" text-anchor="middle" class="label">S</text>
      <rect x="${g.switchPivotX - 18}" y="${g.bottomY - 56}" width="102" height="82" rx="18" fill="transparent"></rect>
    </g>
  `;
}

function q3SliderSymbol() {
  const g = q3.geometry;
  const x = g.sliderMinX + (state.q3.slider / 100) * (g.sliderMaxX - g.sliderMinX);
  const lineClass = state.q3.switchClosed ? "component-line component-line--live" : "component-line";
  return `
    <g class="slider-hit" data-action="q3-slider-handle">
      <path d="M${g.sliderLoopRightX} ${g.topY} L${g.sliderLoopRightX} ${g.sliderLoopTopY} L${x} ${g.sliderLoopTopY} L${x} ${g.sliderTopY}" class="${lineClass}"></path>
      <line x1="${x}" y1="${g.sliderTopY}" x2="${x}" y2="${g.sliderBottomY}" class="${lineClass}"></line>
      <polygon points="${x},${g.sliderBottomY} ${x - 7},${g.sliderBottomY - 10} ${x + 7},${g.sliderBottomY - 10}" fill="${state.q3.switchClosed ? "#d18d00" : "#1f2e2b"}"></polygon>
      <circle cx="${x}" cy="${g.sliderLoopTopY}" r="8.5" fill="${state.q3.switchClosed ? "#ffd86f" : "#1ea36e"}" stroke="#ffffff" stroke-width="3"></circle>
      <rect x="${g.sliderMinX - 18}" y="${g.sliderLoopTopY - 20}" width="${g.sliderLoopRightX - g.sliderMinX + 36}" height="${g.sliderBottomY - g.sliderLoopTopY + 40}" rx="16" fill="transparent"></rect>
      <text x="${x}" y="${g.sliderLoopTopY - 16}" text-anchor="middle" class="label">P</text>
    </g>
  `;
}

function q3NodeDots() {
  const g = q3.geometry;
  const dots = [
    [g.leftX, g.topY],
    [g.leftX, g.voltmeterCy],
    [g.centerX, g.topY],
    [g.rightX, g.topY],
    [g.leftX, g.bottomY],
    [g.switchPivotX, g.bottomY],
    [g.rightX, g.bottomY]
  ];
  return dots.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="5.6" class="node ${state.q3.switchClosed ? "live" : ""}"></circle>`).join("");
}

function renderQ3() {
  const g = q3.geometry;
  const s = q3Solve();
  const lineClass = state.q3.switchClosed ? "component-line component-line--live" : "component-line";
  return {
    title: "题目3：滑动变阻器与电压表",
    desc: "通过改变 R2 接入电阻，观察电压表对 R1 两端电压的测量变化。",
    badges: [`开关：${s.switchText}`, `R2 ≈ ${format(s.r2Value)}Ω`, `电压表 ≈ ${format(s.voltageV)}V`],
    accentIndex: 2,
    svg: `
      <svg viewBox="${q3.viewBox}" aria-label="题目3电路图" class="${state.q3.switchClosed ? "circuit-live" : ""}">
        <defs>
          <clipPath id="clip-q3"><rect x="0" y="0" width="920" height="520" rx="0"></rect></clipPath>
        </defs>
        ${q3BaseWires()}
        ${q3LivePaths()}
        ${resistorHorizontal(g.r1X, g.r1Y, g.r1W, g.r1H, 'R1', 0, -14, state.q3.switchClosed)}
        ${resistorHorizontal(g.r2X, g.r2Y, g.r2W, g.r2H, 'R2', 24, -14, state.q3.switchClosed)}
        ${meterHorizontal(g.voltmeterCx, g.voltmeterCy, g.meterR, 'V', g.leftX, g.centerX, state.q3.switchClosed)}
        ${q3BatterySymbol()}
        ${q3SwitchSymbol()}
        ${q3SliderSymbol()}
        ${state.q3.switchClosed ? `<line x1="${g.r1X + g.r1W}" y1="${g.topY}" x2="${g.centerX}" y2="${g.topY}" class="${lineClass}"></line>` : ""}
        ${state.q3.switchClosed ? `<line x1="${g.centerX}" y1="${g.topY}" x2="${g.r2X}" y2="${g.topY}" class="${lineClass}"></line>` : ""}
        ${q3NodeDots()}
      </svg>
    `,
    footerTitle: "实验结论",
    footerDesc: `${s.conclusion} 可以直接在图中切换开关，并拖动 R2 的滑片 P。`,
    controls: `
      <div class="control-stack">
        <button class="control-btn ${state.q3.switchClosed ? "control-btn--on" : "control-btn--off"}" data-action="toggle-q3-switch">开关</button>
        <label class="slider-panel">
          <span>R2 接入阻值</span>
          <input type="range" min="0" max="100" value="${state.q3.slider}" data-action="q3-slider-range" />
        </label>
        <div class="mini-actions">
          <button class="chip-btn ${state.q3.slider < 34 ? "active" : ""}" data-action="q3-slider-low">R2较小</button>
          <button class="chip-btn ${state.q3.slider >= 34 && state.q3.slider <= 66 ? "active" : ""}" data-action="q3-slider-mid">R2居中</button>
          <button class="chip-btn ${state.q3.slider > 66 ? "active" : ""}" data-action="q3-slider-high">R2较大</button>
        </div>
        <div class="hint">支持按钮预设与图内拖动两种方式。</div>
      </div>
    `,
    parameters: `
      <div class="kv-list">
        <div class="kv-item"><span>R1阻值</span><strong>${q3.r1}Ω</strong></div>
        <div class="kv-item"><span>R2阻值</span><strong>${format(s.r2Value)}Ω</strong></div>
        <div class="kv-item"><span>电流</span><strong>${format(s.current)}A</strong></div>
      </div>
    `,
    laws: `
      <ul class="fact-list">
        <li>串联电路中，总电阻变大时，总电流减小。</li>
        <li>R1 两端电压 = I × R1，因此会随总电流变化。</li>
        <li>滑动变阻器常用于调节电流与分压。</li>
      </ul>
    `
  };
}

function renderUploadPage() {
  return {
    title: "上传题目：生成交互实验",
    desc: "后续将支持上传电路题图片，自动识别并生成 1:1 复刻的模拟电路实验。",
    badges: ["状态：规划中", "输入：题目图片", "输出：交互电路实验"],
    accentIndex: 0,
    svg: `
      <div class="upload-empty">
        <div class="upload-empty__icon">+</div>
        <div class="upload-empty__title">上传电路题图片</div>
        <div class="upload-empty__desc">支持 JPG / PNG。后续这里会接入识图、结构化解析和自动复刻服务。</div>
        <button class="control-btn" disabled>上传题目（即将开放）</button>
      </div>
    `,
    footerTitle: "功能规划",
    footerDesc: "上传题目 → 识别电路结构 → 生成 1:1 交互电路图 → 输出可调参实验。",
    controls: `
      <div class="control-stack">
        <button class="control-btn" disabled>上传题目</button>
        <div class="hint">当前为页面占位，后续将接入自动生成服务。</div>
      </div>
    `,
    parameters: `
      <div class="kv-list">
        <div class="kv-item"><span>识别方式</span><strong>图像 + 结构化JSON</strong></div>
        <div class="kv-item"><span>输出格式</span><strong>SVG / HTML</strong></div>
        <div class="kv-item"><span>后续目标</span><strong>1:1 自动复刻</strong></div>
      </div>
    `,
    laws: `
      <ul class="fact-list">
        <li>识别元件、节点、导线、测量仪表。</li>
        <li>根据拓扑关系生成统一的电路场景。</li>
        <li>在标准布局上叠加交互与参数控制。</li>
      </ul>
    `
  };
}

function renderPreviewCard() {
  const meta = caseMeta[state.selectedCase];
  if (!meta) return "";
  if (!meta.image) {
    return `
      <div class="preview-card preview-card--placeholder">
        <div class="preview-card__title">${meta.title}</div>
        <div class="preview-card__placeholder">上传入口</div>
      </div>
    `;
  }
  return `
    <div class="preview-card">
      <div class="preview-card__title">${meta.title}</div>
      <img src="${meta.image}" alt="${meta.title}" />
    </div>
  `;
}

function getQ2SvgY(clientY) {
  const svg = app.querySelector('svg[aria-label="题目2电路图"]');
  if (!svg) return null;
  const rect = svg.getBoundingClientRect();
  const viewBox = svg.viewBox.baseVal;
  return viewBox.y + ((clientY - rect.top) / rect.height) * viewBox.height;
}

function updateQ2SliderFromPointer(clientY) {
  const y = getQ2SvgY(clientY);
  if (y == null) return;
  const g = q2.geometry;
  const ratio = (g.sliderBottomY - y) / (g.sliderBottomY - g.sliderTopY);
  state.q2.slider = clamp(Math.round(ratio * 100), 0, 100);
  renderApp();
}

function bindQ2SliderDrag(event) {
  event.preventDefault();
  updateQ2SliderFromPointer(event.clientY);
  const move = (moveEvent) => updateQ2SliderFromPointer(moveEvent.clientY);
  const up = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
}

function getQ3SvgX(clientX) {
  const svg = app.querySelector('svg[aria-label="题目3电路图"]');
  if (!svg) return null;
  const rect = svg.getBoundingClientRect();
  const viewBox = svg.viewBox.baseVal;
  return viewBox.x + ((clientX - rect.left) / rect.width) * viewBox.width;
}

function updateQ3SliderFromPointer(clientX) {
  const x = getQ3SvgX(clientX);
  if (x == null) return;
  const g = q3.geometry;
  const ratio = (x - g.sliderMinX) / (g.sliderMaxX - g.sliderMinX);
  state.q3.slider = clamp(Math.round(ratio * 100), 0, 100);
  renderApp();
}

function bindQ3SliderDrag(event) {
  event.preventDefault();
  updateQ3SliderFromPointer(event.clientX);
  const move = (moveEvent) => updateQ3SliderFromPointer(moveEvent.clientX);
  const up = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
}

function renderApp() {
  const current =
    state.selectedCase === "q1" ? renderQ1() :
    state.selectedCase === "q2" ? renderQ2() :
    state.selectedCase === "q3" ? renderQ3() :
    renderUploadPage();
  const parametersTitle = current.parametersTitle || "关键参数";
  app.innerHTML = `
    <section class="stage">
      <div class="dashboard-shell">
        <aside class="sidebar">
          <div class="sidebar-brand">
            <div class="sidebar-brand__mark">CL</div>
            <div class="sidebar-brand__text">
              <strong>飞象Lab</strong>
              <span>Interactive Physics Studio</span>
            </div>
          </div>
          ${renderTabs()}
        </aside>
        <div class="dashboard-main">
          <div class="product-topbar">
            <div class="brand-block">
              <div class="brand-block__tag">飞象老师 · Circuit Lab</div>
              <h1>电路实验工作台</h1>
              <p>用户上传电路图物理题，生成可以调参的模拟电路实验 </p>
            </div>
          </div>
          <div class="workspace">
            <div class="workspace-main">
              <div class="focus-panel">
                <div class="focus-panel__head">
                  <div class="focus-panel__copy">
                    <h2>${current.title}</h2>
                    <p>${current.desc}</p>
                  </div>
                </div>
                <div class="canvas">
                  <div class="canvas__topbar">
                    <div class="canvas__title">
                      <strong>实验画布</strong>
                      <span>保留电路图实现，仅重构页面布局与视觉层次。</span>
                    </div>
                    <div class="canvas__signals">
                      <span></span>
                      <span></span>
                      <span></span>
                    </div>
                  </div>
                  <div class="svg-wrap">${current.svg}</div>
                </div>
              </div>
            </div>
            <aside class="workspace-right">
              ${renderPreviewCard()}
              <div class="panel-card panel-card--feature">
                <div class="panel-card__label">交互控制</div>
                ${current.controls}
              </div>
              <div class="panel-card panel-card--params">
                <div class="panel-card__label">${parametersTitle}</div>
                ${current.parameters}
              </div>
            </aside>
          </div>
        </div>
      </div>
    </section>
  `;
}

app.addEventListener("click", (event) => {
  const caseBtn = event.target.closest("[data-case]");
  if (caseBtn) {
    state.selectedCase = caseBtn.dataset.case;
    renderApp();
    return;
  }

  const actionBtn = event.target.closest("[data-action]");
  if (!actionBtn) return;
  const action = actionBtn.dataset.action;

  if (action === "toggle-q1-switch") state.q1.switchClosed = !state.q1.switchClosed;
  if (action === "toggle-q2-switch") state.q2.switchClosed = !state.q2.switchClosed;
  if (action === "toggle-q3-switch") state.q3.switchClosed = !state.q3.switchClosed;
  if (action === "q2-slider-low") state.q2.slider = 15;
  if (action === "q2-slider-mid") state.q2.slider = 50;
  if (action === "q2-slider-high") state.q2.slider = 85;
  if (action === "q3-slider-low") state.q3.slider = 10;
  if (action === "q3-slider-mid") state.q3.slider = 50;
  if (action === "q3-slider-high") state.q3.slider = 90;

  if (action.startsWith("toggle-") || action.includes("slider-")) {
    renderApp();
  }
});

app.addEventListener("input", (event) => {
  const action = event.target?.dataset?.action;
  if (action === "q2-slider-range") {
    state.q2.slider = Number(event.target.value);
    renderApp();
  }
  if (action === "q3-slider-range") {
    state.q3.slider = Number(event.target.value);
    renderApp();
  }
});

app.addEventListener("pointerdown", (event) => {
  if (event.target.closest('[data-action="q2-slider-handle"]')) {
    bindQ2SliderDrag(event);
    return;
  }
  if (event.target.closest('[data-action="q3-slider-handle"]')) {
    bindQ3SliderDrag(event);
  }
});

renderApp();

