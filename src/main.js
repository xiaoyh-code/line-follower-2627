import { controlFields } from './control-fields.js';
import { localize } from './i18n.js';
import { createSimulation, DEFAULT_PARAMS } from './simulation.js';
import { CLASSROOM_COMMAND_DELAY_MS, CONTROL_PERIOD, sensorRawBit, sensorRegisterByte } from './line-controller.js';
import { setupHeadingHistory } from './heading-history.js';
import { setupPidStepView } from './pid-step-view.js';
import { TRACK_POINTS, TRACK_WIDTH } from './track.js';
import { createView } from './view.js';
import { setupMapEditor } from './map-editor.js';
import { setupStartOffset } from './start-offset.js';
import { setupTrialPanel } from './trials-ui.js';

const byId = id => document.getElementById(id);
const steeringTrials = new Map([['pd', { p: 2, d: 1.5 }], ['swing', { p: 4, d: 0.01 }], ['p', { p: 4, d: 0 }]]);
const params = { ...DEFAULT_PARAMS, commandDelayMs: CLASSROOM_COMMAND_DELAY_MS, startOffsetMm: 15 };
const urlOptions = new URLSearchParams(location.search);
const initialTrial = urlOptions.get('trial');
const status = byId('stage-state');
const runButton = byId('run');
const resetButton = byId('reset');
const stepButton = byId('step');
const nextStepButton = byId('step-next');
const stepDetails = byId('step-terms');
const headingHistory = setupHeadingHistory(byId('heading-history'));
const renderPidStep = setupPidStepView(byId('step-calculation'));
const manualRateControl = byId('manual-rate');
const exportButton = byId('export');
const timeLabel = byId('sim-time');
const lineStatus = byId('line-status');
const errorLabel = byId('line-error');
const steeringLabel = byId('steer-output');
const termLabels = ['step-p', 'step-i', 'step-d'].map(byId);
const leftWheel = byId('left-wheel');
const rightWheel = byId('right-wheel');
const lapCount = byId('lap-count');
const lapLabel = byId('lap-label');
const openMapButton = byId('open-map');
const defaultMapButton = byId('default-map');
const openModelButton = byId('open-model');
const defaultModelButton = byId('default-model');
const cameraButtons = [...document.querySelectorAll('[data-camera]')];
const recording = [];
const sensorLights = [];
const csvTicks = Math.round(0.1 / CONTROL_PERIOD); // One continuous CSV row every 100 ms.
const recordingWindow = 15 * 60;
let sim;
let view;
let running = false;
let currentCourse = null;
let currentModel = null;
let modelImporter;
let activeCamera = ['follow', 'overview', 'top', 'sensor', 'heading'].includes(urlOptions.get('view')) ? urlOptions.get('view') : 'heading';
let manualCamera = activeCamera;
let manualTrail = true;
let trialTrail = true;
let mode = 'manual';
let trialOrigin;
let trials;
let frameId = 0;
let lastFrame = null;
let playbackRate = 1;
let manualTime = 0;
let nextControlIndex = 0;

function setText(node, value) {
  if (!node.hasAttribute('data-no-i18n')) value = localize(value);
  if (node.textContent !== value) node.textContent = value;
}

function setStatus(kind, text) {
  status.dataset.state = kind;
  setText(byId('state-label'), text);
}

function buildSettings() {
  for (const setting of controlFields) {
    const { key, label, symbol, description, min, max, step, digits } = setting;
    const section = document.createElement('div');
    section.className = 'setting';
    section.innerHTML = `
      <div class="setting-heading">
        <label class="setting-name" for="${key}">${label}<code>${symbol}</code></label>
        <div class="setting-number"><input id="${key}-number" aria-label="${label}數值 ${symbol}" aria-describedby="${key}-help" type="number"
          inputmode="${digits ? 'decimal' : 'numeric'}" min="${min}" max="${max}" step="${step}"></div>
      </div>
      <p id="${key}-help">${description}</p>
      <input class="slider" id="${key}" type="range" min="${min}" max="${max}" step="${step}" aria-describedby="${key}-help">
      <div class="limits" aria-hidden="true"><span>${min}</span><span>${max}</span></div>`;
    byId('control-body').append(section);
    const slider = byId(key);
    const number = byId(key + '-number');
    const update = (value, formatNumber = true) => {
      const clamped = Math.max(min, Math.min(max, value));
      const snapped = Number((min + Math.round((clamped - min) / step) * step).toFixed(digits));
      params[key] = snapped;
      slider.value = String(snapped);
      slider.style.setProperty('--fill', `${100 * (snapped - min) / (max - min)}%`);
      if (formatNumber) number.value = snapped.toFixed(digits);
    };
    slider.addEventListener('input', () => update(slider.valueAsNumber));
    number.addEventListener('input', () => {
      if (Number.isFinite(number.valueAsNumber) && number.validity.valid) update(number.valueAsNumber, false);
    });
    const finishEdit = () => update(Number.isFinite(number.valueAsNumber) ? number.valueAsNumber : params[key]);
    number.addEventListener('change', finishEdit);
    number.addEventListener('blur', finishEdit);
    number.addEventListener('keydown', event => {
      // Some IMEs send 229 on the final composition event, including Safari.
      if (event.key === 'Enter' && !event.isComposing && event.keyCode !== 229) number.blur();
    });
    update(params[key]);
  }
}

function buildSensors() {
  byId('sensors').replaceChildren();
  for (let i = 0; i < 8; i++) {
    const channel = params.sensorOrder === 's8-left' ? 8 - i : i + 1;
    const sensor = document.createElement('div');
    sensor.className = 'sensor';
    sensor.setAttribute('role', 'listitem');
    sensor.setAttribute('aria-label', `S${channel}，讀取中`);
    sensor.innerHTML = `<span class="sensor-lamp sensor-bit" aria-hidden="true">—</span><span class="sensor-name" aria-hidden="true">S${channel}</span>`;
    byId('sensors').append(sensor);
    sensorLights[channel - 1] = sensor;
  }
}

const pidNumber = new Intl.NumberFormat('en', {
  minimumFractionDigits: 2, maximumFractionDigits: 6, useGrouping: false,
});

function formatPidValue(value) {
  if (value === 0) return '0.00';
  // A small integral or residual still has a sign and magnitude in this tick.
  if (Math.abs(value) < 0.0000005) return value.toExponential(2);
  return pidNumber.format(value);
}

function appliedPidCorrection(state) {
  if (state.searching) return '';
  return formatPidValue(state.lineLost ? 0 : state.correction);
}

function updateReadings(state) {
  const whole = Math.floor((state.time + 1e-8) * 100);
  const pad = number => String(number).padStart(2, '0');
  setText(timeLabel, `${pad(Math.floor(whole / 6000))}:${pad(Math.floor(whole / 100) % 60)}.${pad(whole % 100)}`);
  setText(leftWheel, (state.leftWheelSpeed * 100).toFixed(1));
  setText(rightWheel, (state.rightWheelSpeed * 100).toFixed(1));
  setText(lapCount, state.canCountLaps ? String(state.laps) : '—');
  setText(lapLabel, state.canCountLaps ? '完成圈數' : '圈數（不適用）');
  setText(errorLabel, state.lineLost ? '—' : state.error.toFixed(1));
  setText(steeringLabel, appliedPidCorrection(state) || '—');
  [state.pTerm, state.iTerm, state.dTerm].forEach((value, index) => {
    setText(termLabels[index], value == null || state.lineLost ? '—' : formatPidValue(value));
  });
  renderPidStep(state);
  const reading = !state.lineLost ? '偵測到線' : state.searching ? '失線 · 搜線中' : '八路失線';
  setText(lineStatus, reading);
  setText(byId('line-reading'), reading);
  byId('loss-indicator').dataset.found = String(!state.lineLost);
  setText(byId('loss-count'), String(state.lossCount));
  setText(byId('loss-total'), state.lostTime.toFixed(2));
  setText(byId('loss-longest'), state.longestLoss.toFixed(2));
  setText(byId('left-command'), String(state.leftCommand));
  setText(byId('right-command'), String(state.rightCommand));
  lineStatus.dataset.found = String(!state.lineLost);
  state.sensors.forEach((active, i) => {
    const light = sensorLights[i];
    if (light.dataset.active === String(Boolean(active))) return;
    light.dataset.active = String(Boolean(active));
    light.firstElementChild.textContent = String(sensorRawBit(active));
    light.setAttribute('aria-label', localize(`S${i + 1}，${active ? '1，黑線' : '0，白底'}`));
  });
}

function record(state) {
  if (recording.at(-1)?.time === state.time) return;
  const gains = state.controlGains ?? params;
  const values = [
    state.time.toFixed(3), gains.p, gains.i, gains.d, gains.speed, Number(!state.lineLost),
    state.lineLost ? '' : state.error.toFixed(2), ...state.sensors.map(Number),
    (state.leftWheelSpeed * 100).toFixed(3), (state.rightWheelSpeed * 100).toFixed(3),
    (state.speedMs * 100).toFixed(3), state.x.toFixed(5), state.y.toFixed(5), state.canCountLaps ? state.laps : '',
    state.integral.toFixed(4), state.courseKind, currentModel ? 'custom' : 'fusion',
    (sim.physical.wheelRadius * 2000).toFixed(2), (sim.physical.halfAxle * 2000).toFixed(2),
    (sim.physical.sensorForward * 1000).toFixed(2), (sim.physical.sensorPitch * 1000).toFixed(2),
    params.sensorOrder, Number(params.recovery), state.leftCommand, state.rightCommand,
    Number(state.searching), state.lossCount, state.lostTime.toFixed(2), state.longestLoss.toFixed(2), appliedPidCorrection(state),
    ...state.sensors.map(sensorRawBit), '0x' + sensorRegisterByte(state.sensors).toString(16).padStart(2, '0').toUpperCase(),
    state.commandDelayMs, state.startOffsetMm, state.headingDeg.toFixed(3), state.leftAppliedCommand, state.rightAppliedCommand,
  ];
  recording.push({ time: state.time, line: values.join(',') });
  while (recording[0].time < state.time - recordingWindow) recording.shift();
  exportButton.disabled = false;
}

function exportReadings() {
  if (!recording.length) return;
  const headers = [
    'simulation_time_s', 'p_gain', 'i_gain', 'd_gain', 'base_command_counts_per_10ms', 'line_found', 'line_error',
    ...sensorLights.map((_, i) => `S${i + 1}_on_line`),
    'left_wheel_cm_s', 'right_wheel_cm_s', 'forward_speed_cm_s', 'axle_x_m', 'axle_y_m', 'completed_laps',
    'integrated_error_s', 'course_kind', 'model_kind', 'wheel_diameter_mm', 'wheel_spacing_mm',
    'sensor_ahead_of_axle_mm', 'sensor_pitch_mm',
    'sensor_order', 'search_enabled', 'left_command', 'right_command', 'search_turning', 'loss_count', 'lost_s', 'longest_loss_s', 'pid_correction',
    ...sensorLights.map((_, i) => `S${i + 1}_raw_bit`), 'sensor_register_hex',
    'command_delay_ms','start_offset_left_mm','chassis_heading_deg','left_applied_command','right_applied_command',
  ];
  const csv = [headers.join(','), ...recording.map(sample => sample.line)].join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'line-follower-' + new Date().toISOString().replace(/[:.]/g, '-') + '.csv';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function setCamera(mode) {
  activeCamera = mode;
  view?.setCamera(mode);
  for (const button of cameraButtons) button.setAttribute('aria-pressed', String(button.dataset.camera === mode));
  const hint = byId('camera-hint');
  hint.hidden = mode !== 'overview';
  if (!hint.hidden) {
    setText(hint, window.matchMedia('(pointer: coarse)').matches ? '拖曳旋轉 · 雙指縮放' : '拖曳旋轉 · 滾動縮放');
  }
}

function updateTransport() {
  stepButton.disabled = nextStepButton.disabled = running || mode !== 'manual';
  byId('run-icon').setAttribute('href', running ? '#ic-pause' : '#ic-play');
  setText(byId('run-label'), running ? '暫停模擬' : sim.state.time > 0 ? '繼續模擬' : '開始模擬');
  if (running) setStatus('running', '運行中');
  else if (sim.state.time > 0) setStatus('paused', '已暫停');
  else setStatus('ready', '已就緒');
}

function showError(message, error) {
  running = false;
  runButton.disabled = true;
  resetButton.disabled = true;
  stepButton.disabled = nextStepButton.disabled = true;
  manualRateControl.disabled = true;
  openMapButton.disabled = true;
  defaultMapButton.disabled = true;
  byId('mode-ai').disabled = true;
  for (const id of ['steer-p', 'steer-pd', 'steer-swing', 'start-offset']) byId(id).disabled = true;
  setStatus('error', '模擬未能運行');
  const notice = byId('load-error');
  notice.textContent = message;
  notice.hidden = false;
  console.error(error);
}

function advanceManualTo(target, flushHeading = false) {
  // Read the physical pose on every control boundary. CSV keeps its 10 Hz cadence.
  while (nextControlIndex * CONTROL_PERIOD <= target + 1e-10) {
    const sampleTime = nextControlIndex * CONTROL_PERIOD;
    const state = sim.step(sampleTime - manualTime, params);
    headingHistory.add(state);
    if (nextControlIndex % csvTicks === 0) record(state);
    manualTime = sampleTime;
    nextControlIndex++;
  }
  headingHistory.draw(flushHeading);
  const state = sim.step(target - manualTime, params);
  manualTime = Math.max(target, manualTime);
  view.render(state);
  updateReadings(state);
  return state;
}

function advanceManual(now) {
  // A suspended tab starts a new wall-clock interval when it becomes visible.
  const wallSeconds = lastFrame === null ? 0 : Math.max(0, Math.min((now - lastFrame) / 1000, .1));
  lastFrame = Math.max(now, lastFrame ?? now);
  advanceManualTo(manualTime + wallSeconds * playbackRate);
}

function stepOnce() {
  if (!sim || running || runButton.disabled || mode !== 'manual') return;
  try {
    stepDetails.open = true;
    const state = advanceManualTo(manualTime + CONTROL_PERIOD, true);
    record(state);
    updateTransport();
  } catch (error) {
    showError('模擬中斷，請重新整理頁面再試。已記錄的數據仍可匯出。', error);
  }
}

function frame(now) {
  if (!running) return;
  try {
    advanceManual(now);
    frameId = requestAnimationFrame(frame);
  } catch (error) {
    showError('模擬中斷，請重新整理頁面再試。已記錄的數據仍可匯出。', error);
  }
}

function toggleRunning() {
  if (!sim || runButton.disabled || mode !== 'manual') return;
  running = !running;
  if (running) {
    lastFrame = performance.now();
    frameId = requestAnimationFrame(frame);
  } else {
    cancelAnimationFrame(frameId);
    lastFrame = null;
    headingHistory.draw(true);
    updateReadings(sim.state);
  }
  updateTransport();
}

function restartExperiment(state, setupChanged = false) {
  headingHistory.reset();
  running = false;
  cancelAnimationFrame(frameId);
  lastFrame = null;
  manualTime = 0;
  nextControlIndex = 0;
  recording.length = 0;
  exportButton.disabled = true;
  trialOrigin = structuredClone(state);
  view.setTrailChannel('manual');
  view.resetTrail();
  view.render(state);
  view.setCamera(activeCamera);
  updateReadings(state);
  updateTransport();
  if (mode === 'ai') view.setTrailChannel('trial');
  if (setupChanged) trials.invalidate();
}

function switchMode(next) {
  if (!sim || next === mode) return;
  if (next === 'ai') {
    if (running) toggleRunning();
    manualCamera = activeCamera;
    manualTrail = byId('trail').checked;
  } else {
    trialTrail = byId('trail').checked;
    trials.leave();
  }
  mode = next;
  const ai = next === 'ai';
  headingHistory.reset();
  nextStepButton.hidden = ai;
  stepButton.disabled = nextStepButton.disabled = ai;
  byId('mode-manual').setAttribute('aria-pressed', String(!ai));
  byId('mode-ai').setAttribute('aria-pressed', String(ai));
  for (const id of ['manual-panel', 'manual-actions', 'manual-rate-control', 'manual-export', 'heading-history']) byId(id).hidden = ai;
  for (const id of ['trial-panel', 'trial-actions', 'trial-history']) byId(id).hidden = !ai;
  setText(byId('telemetry-label'), ai ? '重播數據' : '即時數據');
  setText(byId('timer-label'), ai ? '重播時間' : '模擬時間');
  view.setTrailChannel(ai ? 'trial' : 'manual');
  byId('trail').checked = ai ? trialTrail : manualTrail;
  view.setTrail(byId('trail').checked);
  if (ai) {
    setCamera('top');
    trials.enter();
  } else {
    view.render(sim.state);
    setCamera(manualCamera);
    updateReadings(sim.state);
    updateTransport();
  }
}

function applyCourse(course) {
  const nextCourse = course?.kind === 'custom' ? course : null;
  let state;
  try {
    view.setCourse(nextCourse);
    state = sim.setCourse(nextCourse, params);
  } catch (error) {
    view.setCourse(currentCourse);
    view.render(sim.state);
    throw error;
  }
  currentCourse = nextCourse;
  byId('course-name').toggleAttribute('data-no-i18n', Boolean(currentCourse?.name && !currentCourse.generatedName));
  setText(byId('course-name'), currentCourse ? currentCourse.generatedName || currentCourse.name || '自訂地圖' : '預設環線');
  setText(byId('map-action-label'), currentCourse ? '編輯地圖' : '繪製地圖');
  defaultMapButton.hidden = !currentCourse;
  restartExperiment(state, true);
}

async function applyModel(model) {
  if (running) toggleRunning();
  const next = await createSimulation({course: currentCourse, physical: model?.physical});
  try {
    view.setModel(model);
  } catch (error) {
    next.dispose();
    throw error;
  }
  const previous = sim;
  sim = next;
  currentModel = model;
  previous.dispose();
  setText(byId('model-name'), model?.name || '2627_CAR_v2');
  defaultModelButton.hidden = !model;
  restartExperiment(next.reset(undefined, params), true);
}

function resetAtSelectedOffset() {
  if (!sim) return;
  params.startOffsetMm = Number(byId('start-offset').value);
  restartExperiment(sim.reset(undefined, params), true);
}

function setManualGains(values) {
  for (const key of ['p', 'i', 'd', 'speed']) {
    const slider = byId(key);
    slider.value = String(values[key]);
    slider.dispatchEvent(new Event('input'));
  }
}

function useSteeringTrial(name, play) {
  setManualGains({ ...steeringTrials.get(name), i: 0, speed: 7 });
  resetAtSelectedOffset();
  setCamera('heading');
  if (play) {
    toggleRunning();
    byId('viewport-title').scrollIntoView({ block: 'start' });
  }
}

async function modelAction(action) {
  const notice = byId('model-error');
  notice.hidden = true;
  openModelButton.disabled = true;
  defaultModelButton.disabled = true;
  if (running) toggleRunning();
  if (mode === 'ai') trials.stop();
  try {
    await action();
  } catch (error) {
    notice.textContent = '未能載入車模工具，請重新嘗試。';
    notice.hidden = false;
    console.error(error);
  } finally {
    openModelButton.disabled = false;
    defaultModelButton.disabled = false;
  }
}

async function initialize(updateArScene) {
  buildSettings();
  buildSensors();
  trials = setupTrialPanel({
    getInputs: () => ({ course: currentCourse, physical: sim?.physical, speed: params.speed, recovery: params.recovery, sensorOrder: params.sensorOrder, commandDelayMs: params.commandDelayMs, startOffsetMm: params.startOffsetMm, manualGains: params }),
    renderOrigin: () => { view.render(trialOrigin); updateReadings(trialOrigin); },
    renderFrame: state => { view.render(state); updateReadings(state); },
    resetTrail: () => view.resetTrail(),
    showGhosts: (records, champion, current, playing) => view.setGhosts(records, champion, current, playing),
    setGhostVisibility: visible => view.setGhostVisibility(visible),
    setStatus,
    applyGains: gains => {
      for (const key of ['p', 'i', 'd']) {
        const slider = byId(key);
        slider.value = String(gains[key]);
        slider.dispatchEvent(new Event('input'));
      }
    },
  });
  byId('mode-manual').addEventListener('click', () => switchMode('manual'));
  byId('mode-ai').addEventListener('click', () => switchMode('ai'));
  runButton.addEventListener('click', toggleRunning);
  stepButton.addEventListener('click', stepOnce);
  nextStepButton.addEventListener('click', stepOnce);
  manualRateControl.addEventListener('change', () => {
    if (running) advanceManual(performance.now());
    playbackRate = Number(manualRateControl.value);
  });
  resetButton.addEventListener('click', () => restartExperiment(sim.reset(undefined, params)));
  setupStartOffset(byId('start-offset'), params.startOffsetMm);
  const refreshAr = () => updateArScene({ course: currentCourse, model: currentModel, startOffsetMm: params.startOffsetMm });
  byId('start-offset').addEventListener('change', () => {
    resetAtSelectedOffset();
    if (currentCourse || currentModel) refreshAr();
  });
  byId('steer-p').addEventListener('click', () => useSteeringTrial('p', true));
  byId('steer-swing').addEventListener('click', () => useSteeringTrial('swing', true));
  byId('steer-pd').addEventListener('click', () => useSteeringTrial('pd', true));
  openModelButton.addEventListener('click', () => modelAction(async () => {
    if (!modelImporter) {
      const {setupModelImporter} = await import('./model-import.js');
      modelImporter = setupModelImporter({onApply: applyArModel, getCurrentModel: () => currentModel});
    }
    modelImporter.open(openModelButton);
  }));
  async function applyArModel(model) {
    await applyModel(model);
    refreshAr();
  }
  function applyArCourse(course) {
    applyCourse(course);
    refreshAr();
  }
  defaultModelButton.addEventListener('click', () => modelAction(() => applyArModel(null)));
  const editor = setupMapEditor({ onApply: applyArCourse, getCurrentCourse: () => currentCourse });
  openMapButton.addEventListener('click', () => {
    if (running) toggleRunning();
    if (mode === 'ai') trials.stop();
    editor.open();
  });
  defaultMapButton.addEventListener('click', () => {
    applyArCourse(null);
    openMapButton.focus();
  });
  exportButton.addEventListener('click', exportReadings);
  cameraButtons.forEach(button => button.addEventListener('click', () => setCamera(button.dataset.camera)));
  byId('trail').addEventListener('change', event => view?.setTrail(event.target.checked));
  document.addEventListener('visibilitychange', () => { lastFrame = null; });
  try {
    view = createView(byId('scene'), { trackPoints: TRACK_POINTS, trackWidth: TRACK_WIDTH });
  } catch (error) {
    showError('未能建立 3D 視窗，請使用支援 WebGL 2 的瀏覽器並開啟圖像加速。', error);
    return;
  }
  setCamera(activeCamera);
  view.setTrail(byId('trail').checked);
  try {
    [sim] = await Promise.all([createSimulation({params}), view.ready]);
    trialOrigin = structuredClone(sim.state);
    view.render(sim.state);
    updateReadings(sim.state);
    updateTransport();
    runButton.disabled = false;
    resetButton.disabled = false;
    manualRateControl.disabled = false;
    openMapButton.disabled = false;
    defaultMapButton.disabled = false;
    openModelButton.disabled = false;
    byId('mode-ai').disabled = false;
    for (const id of ['steer-p', 'steer-pd', 'steer-swing', 'start-offset']) byId(id).disabled = false;
    if (steeringTrials.has(initialTrial)) useSteeringTrial(initialTrial, false);
  } catch (error) {
    showError('未能載入車身模型或物理引擎，請檢查網絡連線並重新整理頁面。', error);
  }
}

export { initialize as initializeSimulator };
