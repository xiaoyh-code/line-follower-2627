import {
  BufferAttribute, BufferGeometry, CanvasTexture, Group, LinearFilter, Line, LineBasicMaterial,
  Matrix4, Mesh, MeshBasicMaterial, PlaneGeometry, Quaternion, SphereGeometry, SRGBColorSpace, Vector3,
} from 'three';
import { onLanguageChange, t } from './i18n.js';

const width = 640;
const height = 664;
const panelWidth = .58;
const panelHeight = panelWidth * height / width;
const headerHeight = 104;
const bodyFont = '"Fira Sans", "PingFang HK", "Noto Sans TC", sans-serif';
const monoFont = '"Fira Code", monospace';
const ink = '#f4f7ff';
const muted = '#b6c6de';
const blue = '#a4c6ff';

export function createXrCourseControls({ span, ranges, params, onChange, onReplay, onExit }) {
  const canvas = document.createElement('canvas');
  canvas.width = width * 1.5;
  canvas.height = height * 1.5;
  const ctx = canvas.getContext('2d');
  ctx.scale(1.5, 1.5);
  ctx.textBaseline = 'middle';

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.minFilter = LinearFilter;
  texture.generateMipmaps = false;
  const panel = new Mesh(new PlaneGeometry(panelWidth, panelHeight), new MeshBasicMaterial({
    map: texture, transparent: true, alphaTest: .015, depthWrite: false, toneMapped: false,
  }));
  panel.name = 'XR tuning panel';

  const group = new Group();
  group.position.set(span / 2 + .24, .44, .1);
  group.rotation.y = -.39;
  group.add(panel);
  const toPanel = new Matrix4();
  const orientation = new Quaternion();
  const pointers = new Map();
  const beamMaterial = new LineBasicMaterial({ color: 0x4578cf, toneMapped: false });
  const dotGeometry = new SphereGeometry(.005, 8, 6);
  const dotMaterial = new MeshBasicMaterial({ color: 0x9fc8ff, toneMapped: false });
  let collapsed = false;
  let runState = 'playing';
  let lossCount;
  let values = { p: params.p, i: params.i, d: params.d, speed: params.speed };

  function makeButton(x, y, w, h, action, disabled) {
    return { x, y, w, h, action, disabled };
  }

  const disclosure = makeButton(508, 26, 100, 52, () => {
    collapsed = !collapsed;
    draw();
  });
  const replay = makeButton(32, 592, 280, 56, onReplay, () => runState === 'running');
  const exit = makeButton(476, 592, 132, 56, onExit);
  const rows = [
    ['p', 'P · 比例', 'P · Proportional'],
    ['i', 'I · 積分', 'I · Integral'],
    ['d', 'D · 微分', 'D · Derivative'],
    ['speed', '車速指令', 'Base speed'],
  ].map(([key, zh, en], index) => {
    const range = ranges[key];
    const { min, max, step, digits = String(step).split('.')[1]?.length ?? 0 } = range;
    const y = 104 + 108 * index;
    const minus = makeButton(348, y + 2, 70, 52,
      () => change(key, values[key] - step), () => values[key] <= min);
    const plus = makeButton(538, y + 2, 70, 52,
      () => change(key, values[key] + step), () => values[key] >= max);
    const slider = makeButton(32, y + 62, 576, 44,
      x => change(key, min + (max - min) * Math.max(0, Math.min(1, (x - 46) / 548))));
    return { key, label: [zh, en], min, max, step, digits, y, minus, plus, slider };
  });
  const expandedTargets = [disclosure, ...rows.flatMap(({ minus, plus, slider }) => [minus, plus, slider]), replay, exit];
  const collapsedTargets = [disclosure];

  function change(key, value) {
    const { min, max, step } = ranges[key];
    const clamped = Math.max(min, Math.min(max, value));
    const digits = rows.find(row => row.key === key).digits;
    const next = Number((min + Math.round((clamped - min) / step) * step).toFixed(digits));
    if (next === values[key]) return;
    values = { ...values, [key]: next };
    draw();
    onChange(values);
  }

  function rounded(x, y, w, h, radius, fill, border) {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, radius);
    ctx.fillStyle = fill;
    ctx.fill();
    if (border) {
      ctx.lineWidth = 2;
      ctx.strokeStyle = border;
      ctx.stroke();
    }
  }

  function text(label, x, y, font, color = ink, align = 'left') {
    ctx.font = font;
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.fillText(label, x, y);
  }

  function isHovered(target) {
    for (const pointer of pointers.values()) {
      if (pointer.target === target) return true;
    }
    return false;
  }

  function drawButton(button, label, { primary = false, size = 25 } = {}) {
    const { x, y, w, h } = button;
    const disabled = button.disabled?.();
    const hovered = !disabled && isHovered(button);
    rounded(x, y, w, h, 12,
      disabled ? '#15233b' : hovered ? '#2c4978' : primary ? '#164498' : '#1c2d4b',
      disabled ? '#3b4e6d' : hovered ? '#bdd5ff' : '#8298b9');
    text(label, x + w / 2, y + h / 2, `600 ${size}px ${bodyFont}`, disabled ? '#8298b9' : ink, 'center');
  }

  function draw() {
    ctx.clearRect(0, 0, width, height);
    rounded(2, 2, width - 4, (collapsed ? headerHeight : height) - 4, 24, '#13213a', '#8298b9');
    rounded(32, 24, 44, 5, 3, '#ff8e9c');
    text(t('循線調校', 'Tune the controller'), 32, 53, `700 36px ${bodyFont}`);
    if (!collapsed) {
      text(t('揀數值後會由起點重跑', 'Select a value to rerun from the start'), 32, 83, `400 23px ${bodyFont}`, muted);
    }
    drawButton(disclosure, collapsed ? t('展開', 'Show') : t('收起', 'Hide'));

    if (!collapsed) {
      for (const row of rows) {
        const { key, label, min, max, digits, y, minus, plus, slider } = row;
        text(t(...label), 32, y + 28, `600 30px ${bodyFont}`);
        text(values[key].toFixed(digits), 478, y + 28, `600 30px ${monoFont}`, blue, 'center');
        drawButton(minus, '−', { size: 33 });
        drawButton(plus, '+', { size: 33 });
        const position = 46 + 548 * (values[key] - min) / (max - min);
        const focused = isHovered(slider);
        if (focused) rounded(slider.x, slider.y, slider.w, slider.h, 10, '#263c60', '#bdd5ff');
        rounded(46, y + 80, 548, 8, 4, '#8298b9');
        if (position > 46) rounded(46, y + 80, position - 46, 8, 4, '#a4c6ff');
        ctx.beginPath();
        ctx.arc(position, y + 84, 11, 0, 2 * Math.PI);
        ctx.fillStyle = ink;
        ctx.fill();
      }

      const status = {
        running: t('正在重算…', 'Calculating replay…'),
        playing: t('正在播放', 'Replay playing'),
        finished: lossCount == null ? t('重播完畢', 'Replay complete') :
          t(`重播完畢 · 失線 ${lossCount} 次`, `Replay complete · Line losses ${lossCount}`),
        failed: t('未能重算，請再試', 'Could not calculate the replay'),
      };
      text(status[runState], 32, 562, `500 25px ${bodyFont}`, runState === 'failed' ? '#ffa2af' : muted);
      drawButton(replay, runState === 'failed' ? t('再試一次', 'Try again') : t('由頭重播', 'Restart replay'), { primary: true });
      drawButton(exit, t('離開 VR', 'Exit VR'));
    }
    texture.needsUpdate = true;
  }

  function makePointer() {
    const beamGeometry = new BufferGeometry();
    beamGeometry.setAttribute('position', new BufferAttribute(new Float32Array(6), 3));
    const beam = new Line(beamGeometry, beamMaterial);
    beam.frustumCulled = false;
    const dot = new Mesh(dotGeometry, dotMaterial);
    beam.visible = dot.visible = false;
    group.add(beam, dot);
    return { beam, dot, origin: new Vector3(), direction: new Vector3(), point: new Vector3() };
  }

  function pick(transform, pointer) {
    const { origin, direction, point } = pointer;
    const { position, orientation: rotation } = transform;
    origin.copy(position).applyMatrix4(toPanel);
    orientation.copy(rotation);
    direction.set(0, 0, -1).applyQuaternion(orientation).transformDirection(toPanel);
    const distance = direction.z < -.00001 ? -origin.z / direction.z : -1;
    point.copy(origin).addScaledVector(direction, distance);
    const x = (point.x / panelWidth + .5) * width;
    const y = (.5 - point.y / panelHeight) * height;
    pointer.overPanel = distance >= 0 && distance <= 3 && x >= 0 && x <= width && y >= 0 && y <= (collapsed ? headerHeight : height);
    pointer.x = x;
    pointer.target = pointer.overPanel ? (collapsed ? collapsedTargets : expandedTargets).find(button =>
      x >= button.x && x <= button.x + button.w && y >= button.y && y <= button.y + button.h) : null;
    if (!pointer.overPanel) point.copy(origin).addScaledVector(direction, .6);
  }

  function getPose(frame, source, reference) {
    try { return frame?.getPose(source.targetRaySpace, reference)?.transform; }
    catch { return null; }
  }

  function removePointer(pointer) {
    group.remove(pointer.beam, pointer.dot);
    pointer.beam.geometry.dispose();
  }

  function update(frame, reference, inputSources) {
    group.updateWorldMatrix(true, false);
    toPanel.copy(group.matrixWorld).invert();
    let redraw = false;
    for (const source of inputSources) {
      if (source.targetRayMode !== 'tracked-pointer') continue;
      let pointer = pointers.get(source);
      if (!pointer) {
        pointer = makePointer();
        pointers.set(source, pointer);
      }
      const transform = getPose(frame, source, reference);
      const previousTarget = pointer.target;
      pointer.transform = transform;
      pointer.beam.visible = Boolean(transform);
      if (transform) {
        pick(transform, pointer);
        const { beam, dot, origin, point } = pointer;
        const positions = beam.geometry.attributes.position;
        positions.setXYZ(0, origin.x, origin.y, origin.z);
        positions.setXYZ(1, point.x, point.y, point.z);
        positions.needsUpdate = true;
        dot.visible = pointer.overPanel;
        dot.position.copy(point);
        dot.position.z += .006;
      } else {
        pointer.dot.visible = false;
        pointer.target = null;
      }
      redraw ||= pointer.target !== previousTarget;
    }
    for (const [source, pointer] of pointers) {
      if (Array.prototype.includes.call(inputSources, source)) continue;
      redraw ||= Boolean(pointer.target);
      removePointer(pointer);
      pointers.delete(source);
    }
    if (redraw) draw();
  }

  function select(event, reference) {
    const source = event.inputSource;
    if (!source?.targetRaySpace || source.targetRayMode === 'screen') return false;
    const transform = getPose(event.frame, source, reference) ?? pointers.get(source)?.transform;
    if (!transform) return false;
    group.updateWorldMatrix(true, false);
    toPanel.copy(group.matrixWorld).invert();
    const pickResult = { origin: new Vector3(), direction: new Vector3(), point: new Vector3() };
    pick(transform, pickResult);
    const { target, x, overPanel } = pickResult;
    if (target && !target.disabled?.()) target.action(x);
    return overPanel;
  }

  function setRunState(state, losses) {
    if (runState === state && lossCount === losses) return;
    runState = state;
    lossCount = losses;
    draw();
  }

  const stopListening = onLanguageChange(draw);

  function dispose() {
    stopListening();
    group.removeFromParent();
    for (const pointer of pointers.values()) removePointer(pointer);
    pointers.clear();
    panel.geometry.dispose();
    panel.material.dispose();
    texture.dispose();
    beamMaterial.dispose();
    dotGeometry.dispose();
    dotMaterial.dispose();
  }

  draw();
  return { group, update, select, setRunState, dispose };
}
