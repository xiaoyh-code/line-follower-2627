import './pid-step.css';
import { math, showMath } from './math.js';
import { onLanguageChange, t } from './i18n.js';
import { CONTROL_PERIOD, sensorRawBit, sensorRegisterByte } from './line-controller.js';

const captions = {
  waiting: ['第一個 10 ms 控制週期會喺開始行車或者撳單步掣後顯示。', 'Start the car or take one step to inspect its first 10 ms control update.'],
  timing: ['取樣時間', 'Sample time'],
  sensors: ['探頭由車頭左至右排列。原始讀數 1 代表黑線，0 代表白底。', 'Sensors are shown from left to right facing forward. A raw bit of 1 means black tape and 0 means white.'],
  bits: ['原始 bit', 'Raw bit'],
  weights: ['權重', 'Weight'],
  example: ['Example 輸出（S1 → S8）', 'Example output (S1 → S8)'],
  register: ['I²C 暫存器（bit 7 → 0）', 'I²C register (bit 7 → 0)'],
  error: ['循線偏差', 'Line error'],
  proportional: ['P · 比例', 'P · Proportional'],
  integral: ['I · 積分', 'I · Integral'],
  derivative: ['D · 微分', 'D · Derivative'],
  correction: ['轉向修正', 'Steering correction'],
  motors: ['左右輪邏輯指令', 'Logical wheel commands'],
  trunc: ['箭咀由左至右顯示原值 → 向零截整 → 限於 0–23 後送出嘅指令。', 'Read each arrow as raw value → truncated towards zero → final command limited to 0–23.'],
};

// Retain enough precision to show which side of an integer the motor mixer
// truncates, including a value one floating-point unit below a whole number.
function number(value, preserveTruncation = false) {
  const compact = Number(value.toFixed(6));
  const shown = preserveTruncation && Math.trunc(compact) !== Math.trunc(value) ? value : compact;
  return String(shown);
}
const tex = String.raw;
function mathNumber(value, preserveTruncation = false) {
  return number(value, preserveTruncation).replace(/e([+-]?\d+)$/, (_, exponent) => tex`\times 10^{${Number(exponent)}}`);
}
const factor = value => value < 0 ? '(' + mathNumber(value) + ')' : mathNumber(value);
const signed = value => value > 0 ? '+' + number(value) : number(value).replace('-', '−');
function sum(values) {
  return values.map((v, i) => i === 0 ? mathNumber(v) : (v < 0 ? '-' : '+') + mathNumber(Math.abs(v))).join('');
}
const relation = (...values) => values.some(value => Math.abs(value - Number(value.toFixed(6))) > 1e-10) ? '\\approx ' : '=';

export function setupPidStepView(host) {
  // The UI is entirely read-only. Keep its live values out of the global
  // translator's mutation observer; a locale change refreshes the same tick.
  host.setAttribute('data-no-i18n', '');
  const caption = key => `<span data-copy="${key}"></span>`;
  const formula = key => `<div class="tick-formula" data-value="${key}"></div>`;
  const row = (label, body) => `<div class="tick-row"><div class="tick-label">${caption(label)}</div><div>${body}</div></div>`;
  const cells = (tag, key, scope = '') => Array.from({ length: 8 }, (_, i) =>
    `<${tag} data-${key}="${i}"${scope}>${tag === 'th' ? 'S' + (i + 1) : '—'}</${tag}>`).join('');
  host.innerHTML = `
    <p data-waiting>${caption('waiting')}</p>
    <div data-sample hidden>
      <div class="tick-time">${caption('timing')} <b data-value="time"></b><span>${math`\Delta t=${CONTROL_PERIOD.toFixed(3)}\,\mathrm{s}`}</span></div>
      <table class="tick-sensors">
        <caption>${caption('sensors')}</caption>
        <thead><tr><td></td>${cells('th', 'channel', ' scope="col"')}</tr></thead>
        <tbody><tr><th scope="row">${caption('bits')}</th>${cells('td', 'bit')}</tr>
          <tr><th scope="row">${caption('weights')}</th>${cells('td', 'weight')}</tr></tbody>
      </table>
      ${row('example', formula('example'))}
      ${row('register', formula('register'))}
      ${row('error', formula('error'))}
      <div data-pid>
        ${row('proportional', formula('p'))}
        ${row('integral', formula('area') + formula('i'))}
        ${row('derivative', formula('slope') + formula('d'))}
        ${row('correction', formula('sum') + formula('clamp'))}
      </div>
      <p class="tick-branch" data-branch hidden></p>
      ${row('motors', formula('left') + formula('right') + '<p class="tick-hint" data-rounding>' + caption('trunc') + '</p>')}
    </div>`;

  const details = host.closest('details');
  for (const el of details?.querySelectorAll('[data-tex]') ?? []) showMath(el, el.dataset.tex);
  const find = key => host.querySelector('[data-' + key + ']');
  const waiting = find('waiting'), sample = find('sample'), pid = find('pid');
  const branch = find('branch'), rounding = find('rounding');
  const channels = [...host.querySelectorAll('[data-channel]')];
  const bits = [...host.querySelectorAll('[data-bit]')];
  const weights = [...host.querySelectorAll('[data-weight]')];
  const values = Object.fromEntries([...host.querySelectorAll('[data-value]')].map(el => [el.dataset.value, el]));
  let latest = null;

  function show(el, value) {
    delete el.dataset.renderedTex;
    if (el.textContent !== value) el.textContent = value;
  }

  function render() {
    if (details && !details.open) return;
    const s = latest;
    const ready = s?.controlTime != null && s.controlGains != null;
    waiting.hidden = ready;
    sample.hidden = !ready;
    if (!ready) return;
    const g = s.controlGains, dt = CONTROL_PERIOD.toFixed(3);
    show(values.time, s.controlTime.toFixed(3) + ' s');
    const detected = [];
    for (let i = 0; i < 8; i++) {
      const channel = s.sensorOrder === 's8-left' ? 7 - i : i;
      const weight = 2 * channel - 7;
      const onBlack = s.sensors[channel];
      show(channels[i], 'S' + (channel + 1));
      show(bits[i], String(sensorRawBit(onBlack)));
      show(weights[i], signed(weight));
      bits[i].toggleAttribute('data-lit', onBlack);
      if (onBlack) detected.push(weight);
    }
    const byte = sensorRegisterByte(s.sensors);
    show(values.example, s.sensors.map(sensorRawBit).join(' '));
    show(values.register, '0b' + byte.toString(2).padStart(8, '0') + ' = 0x' + byte.toString(16).padStart(2, '0').toUpperCase());
    if (detected.length) {
      showMath(values.error, tex`e_k=\dfrac{${sum(detected)}}{${detected.length}}-0${relation(s.error)}${mathNumber(s.error)}`);
    } else {
      show(values.error, t('八路都讀到 0（白底），今次冇探頭見到黑線。', 'All eight raw bits are 0 (white). No probe detected the black line.'));
    }

    const closedLoop = g.speed > 0 && (g.p !== 0 || g.i !== 0 || g.d !== 0) && !s.lineLost;
    pid.hidden = !closedLoop;
    branch.hidden = closedLoop;
    rounding.hidden = !closedLoop;
    if (closedLoop) {
      showMath(values.p, tex`u_P=${mathNumber(g.p)}\times ${factor(s.error)}${relation(s.error, s.pTerm)}${mathNumber(s.pTerm)}`);
      showMath(values.area, tex`A_k=\operatorname{clip}(${mathNumber(s.previousIntegral)}+${factor(s.error)}\times ${dt},\allowbreak -20,20)${relation(s.previousIntegral, s.error, s.integral)}${mathNumber(s.integral)}`);
      showMath(values.i, tex`u_I=${mathNumber(g.i)}\times ${factor(s.integral)}${relation(s.integral, s.iTerm)}${mathNumber(s.iTerm)}`);
      showMath(values.slope, tex`r_k=\dfrac{${mathNumber(s.error)}-${factor(s.previousError)}}{${dt}}${relation(s.error, s.previousError, s.derivative)}${mathNumber(s.derivative)}`);
      showMath(values.d, tex`u_D=${mathNumber(g.d)}\times ${factor(s.derivative)}${relation(s.derivative, s.dTerm)}${mathNumber(s.dTerm)}`);
      const total = s.pTerm + s.iTerm + s.dTerm;
      showMath(values.sum, tex`u_P+u_I+u_D=${sum([s.pTerm, s.iTerm, s.dTerm])}${relation(s.pTerm, s.iTerm, s.dTerm, total)}${mathNumber(total)}`);
      showMath(values.clamp, tex`u=\operatorname{clip}(${mathNumber(total)},-8,8)${relation(total, s.correction)}${mathNumber(s.correction)}`);
      // Label the unrounded request separately from the final integer command.
      const leftMix = g.speed + s.correction, rightMix = g.speed - s.correction;
      showMath(values.left, tex`L_{\mathrm{raw}}=${mathNumber(g.speed)}+${factor(s.correction)}${relation(s.correction, leftMix)}${mathNumber(leftMix, true)}\to ${Math.trunc(leftMix)}\to ${s.leftCommand}`);
      showMath(values.right, tex`R_{\mathrm{raw}}=${mathNumber(g.speed)}-${factor(s.correction)}${relation(s.correction, rightMix)}${mathNumber(rightMix, true)}\to ${Math.trunc(rightMix)}\to ${s.rightCommand}`);
    } else {
      let reason;
      if (!g.speed) reason = t('基礎速度 B = 0。控制器清零積分同轉向修正，發出停車指令。', 'Base speed B = 0. The controller clears the integral and correction and commands both wheels to stop.');
      else if (g.p === 0 && g.i === 0 && g.d === 0) reason = t('三個增益都係 0，所以 u = 0。兩輪都用基礎速度 B 直行。', 'All three gains are zero, so u = 0. Both wheels receive the base speed B.');
      else if (s.searching) reason = t('失線令積分清零。按上次偏差 ', 'Line loss clears the integral. The previous error of ') + number(s.previousError) + t('，控制器套用固定搜線指令。', ' selects a fixed pair of search commands.');
      else reason = t('失線令積分清零。今次控制器按基礎速度 B 直行。', 'Line loss clears the integral. For this update both wheels receive the base speed B.');
      show(branch, reason);
      const source = !s.searching && g.speed > 0 ? 'B = ' : '';
      showMath(values.left, 'L = ' + source + s.leftCommand);
      showMath(values.right, 'R = ' + source + s.rightCommand);
    }
  }

  function translate() {
    for (const el of host.querySelectorAll('[data-copy]')) el.textContent = t(...captions[el.dataset.copy]);
    render();
  }
  details?.addEventListener('toggle', render);
  onLanguageChange(translate);
  translate();
  return state => { latest = state; render(); };
}
