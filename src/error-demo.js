import './error-demo.css';
import { onLanguageChange, t } from './i18n.js';
import { sensorRawBit } from './line-controller.js';
import { showMath } from './math.js';
import { createProbeLab } from './probe-lab.js';

const gains = { p: 1, i: 0, d: 0, speed: 7 };
const center = 94;
const pitch = 14;
const sensorY = channel => center + (channel - 3.5) * pitch;
const weights = Array.from({ length: 8 }, (_, i) => i * 2 - 7);
const signed = value => value > 0 ? '+' + value : String(value).replace('-', '−');

// Positions at the sensor row are expressed in probe pitches from the car centre.
// The 21 mm tape spans about 1.83 of the classroom board's 11.5 mm pitches.
const offsets = [0, 1, 2, 3.5, 5.45];
const tapeWidth = pitch * 21 / 11.5;
const sequences = [1, -1].map(side => {
  const lab = createProbeLab();
  return offsets.map(offset => {
    const position = center + side * offset * pitch;
    const mask = weights.reduce((bits, _, channel) => {
      const overTape = Math.abs(sensorY(channel) - position) <= tapeWidth / 2;
      return bits | (sensorRawBit(overTape) << channel);
    }, 0);
    return { position, side, ...lab.step(mask, gains) };
  });
});

function carPlate(sample, miniature = false) {
  const { position, side, sensors } = sample;
  const view = miniature ? '24 23 182 142' : '0 0 284 188';
  return `<svg class="error-car" viewBox="${view}" aria-hidden="true" focusable="false">
    <rect class="error-ground" width="284" height="188"/>
    <path class="error-grid" d="M0 47H284M0 94H284M0 141H284M42 0V188M94 0V188M146 0V188M198 0V188"/>
    <path class="error-tape" stroke-width="${tapeWidth}" d="M-14 ${position - side * 13} Q66 ${position - side * 11} 139 ${position} T296 ${position + side * 28}"/>
    <path class="error-chassis" d="M62 49H112L127 66V122L112 139H62Q55 139 55 132V56Q55 49 62 49Z"/>
    <path class="error-axle" d="M74 34V154M30 94H208"/>
    <rect class="error-wheel" x="57" y="25" width="34" height="27" rx="5"/>
    <rect class="error-wheel" x="57" y="136" width="34" height="27" rx="5"/>
    <path class="error-nose" d="M96 85L106 94L96 103"/>
    <rect class="error-board" x="128" y="36" width="22" height="116" rx="5"/>
    ${sensors.map((lit, channel) => `<circle class="error-lamp${lit ? ' is-lit' : ''}" cx="139" cy="${sensorY(channel)}" r="${lit ? 5 : 3.7}"/>`).join('')}
    ${miniature ? '' : `<text class="error-wheel-label" x="74" y="43">L</text>
      <text class="error-wheel-label" x="74" y="154">R</text>
      <rect class="error-column" x="214" y="31" width="64" height="126" rx="5"/>
      ${sensors.map((lit, channel) => `<text class="${lit ? 'is-lit' : ''}" x="224" y="${sensorY(channel)}" dominant-baseline="central">S${channel + 1} <tspan x="251">${signed(weights[channel])}</tspan></text>`).join('')}`}
  </svg>`;
}

export function errorDemoHtml(say) {
  return `<div class="error-demo" id="error-demo" tabindex="-1" aria-labelledby="error-demo-title">
    <h4 id="error-demo-title">${say('黑線經過車頭探頭', 'Black tape under the car')}</h4>
    <label class="error-direction"><span>${say('黑線偏向', 'Tape moves to the')}</span>
      <select>
        <option value="0">${say('車身右邊', 'Car’s right')}</option>
        <option value="1">${say('車身左邊', 'Car’s left')}</option>
      </select>
    </label>
    <figure>
      <figcaption class="error-orientation">
        <span>${say('俯視 · 上面係車身左側', 'Top view · car’s left side at top')}</span>
        <span>${say('車頭 →', 'Forward →')}</span>
      </figcaption>
      <div class="error-plate" role="img" data-no-i18n></div>
    </figure>
    <div class="error-snapshots" role="group" aria-label="${say('依序選擇黑線位置', 'Select a tape position in sequence')}"></div>
    <div class="error-readout" aria-live="polite" aria-atomic="true">
      <div class="error-bits">
        <span>${say('探頭讀數（S1 → S8）', 'Probe readings (S1 → S8)')}</span>
        <code data-no-i18n></code>
      </div>
      <div class="error-arithmetic" data-no-i18n></div>
      <div class="error-wheels">
        <span>${say('左輪', 'Left wheel')} <span class="error-wheel-work"><span data-left-work data-no-i18n></span><b data-left data-no-i18n></b></span></span>
        <span>${say('右輪', 'Right wheel')} <span class="error-wheel-work"><span data-right-work data-no-i18n></span><b data-right data-no-i18n></b></span></span>
        <strong data-turn data-no-i18n></strong>
      </div>
    </div>
    <p class="error-gains">${say('純 P 示範', 'P-only example')} <code>P = ${gains.p} · I = D = 0 · B = ${gains.speed}</code></p>
  </div>`;
}

export function setupErrorDemo(host) {
  const direction = host.querySelector('select');
  const plate = host.querySelector('.error-plate');
  const snapshots = host.querySelector('.error-snapshots');
  const digits = host.querySelector('.error-bits code');
  const arithmetic = host.querySelector('.error-arithmetic');
  const leftWork = host.querySelector('[data-left-work]');
  const rightWork = host.querySelector('[data-right-work]');
  const left = host.querySelector('[data-left]');
  const right = host.querySelector('[data-right]');
  const turn = host.querySelector('[data-turn]');
  let selected = 0;

  function render() {
    const sample = sequences[Number(direction.value)][selected];
    const { sensors, error, searching, lineLost, leftCommand, rightCommand, previousError } = sample;
    const channels = weights.flatMap((_, i) => sensors[i] ? [i] : []);
    const lit = channels.map(channel => 'S' + (channel + 1)).join(', ');
    plate.innerHTML = carPlate(sample);
    plate.setAttribute('aria-label', lineLost
      ? t('黑線移出所有探頭範圍。', 'The tape is beyond all eight probes.')
      : t(`${lit} 喺黑線上。`, `${lit} over the black tape.`));
    for (const [index, button] of [...snapshots.children].entries()) {
      const frame = sequences[Number(direction.value)][index];
      const label = frame.lineLost ? t('失線', 'Lost') : signed(frame.error);
      button.setAttribute('aria-pressed', String(index === selected));
      button.setAttribute('aria-label', t(`第 ${index + 1} 格 · ${label}`, `Position ${index + 1} · ${label}`));
      button.innerHTML = carPlate(frame, true) + '<span>' + label + '</span>';
    }
    digits.textContent = sensors.map(sensorRawBit).join('');
    if (lineLost) {
      delete arithmetic.dataset.renderedTex;
      arithmetic.textContent = t(`今次冇新偏差。上次係 ${signed(previousError)}。`, `No new error. Previous error ${signed(previousError)}.`);
    } else {
      const numerator = channels.map((channel, i) => {
        const weight = weights[channel];
        return i && weight > 0 ? '+' + weight : String(weight);
      }).join('');
      const fraction = channels.length > 1 ? `\\dfrac{${numerator}}{${channels.length}}` : numerator;
      showMath(arithmetic, `e = ${fraction}${channels.length > 1 ? ' = ' + (error > 0 ? '+' : '') + error : ''}`);
    }
    const wheelWork = adjustment => lineLost ? '' :
      sample.controlGains.speed + (adjustment < 0 ? ' − ' : ' + ') + Math.abs(adjustment) + ' = ';
    leftWork.textContent = wheelWork(sample.correction);
    rightWork.textContent = wheelWork(-sample.correction);
    left.textContent = String(leftCommand);
    right.textContent = String(rightCommand);
    turn.textContent = leftCommand > rightCommand
      ? (searching ? t('固定指令向右搵線', 'Fixed commands · search right') : t('向右修正', 'Steer right'))
      : leftCommand < rightCommand
        ? (searching ? t('固定指令向左搵線', 'Fixed commands · search left') : t('向左修正', 'Steer left'))
        : t('直行', 'Straight ahead');
  }

  for (let index = 0; index < offsets.length; index++) {
    const button = document.createElement('button');
    button.type = 'button';
    button.addEventListener('click', () => {
      selected = index;
      render();
    });
    snapshots.append(button);
  }
  direction.addEventListener('change', render);
  onLanguageChange(render);
  render();
}
