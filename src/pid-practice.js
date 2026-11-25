import { equation, math } from './math.js';
import { onLanguageChange, registerTranslations, t } from './i18n.js';

// Register each phrase with the same translator used by the simulator. Language
// changes update text nodes in place, preserving answers and keyboard focus.
function copy(zh, en) {
  registerTranslations({ [zh]: en });
  return t(zh, en);
}

const numericFields = [
  { key: 'integral', label: ['更新後嘅積分', 'Updated integral'], unit: ['偏差·s', 'error·s'], answer: .4,
    hint: ['將今次偏差乘以 Δt，再加落原有積分。', 'Multiply the current error by Δt and add it to the stored integral.'] },
  { key: 'derivative', label: ['偏差變化率', 'Derivative'], unit: ['偏差/s', 'error/s'], answer: 10,
    hint: ['用今次偏差減上次偏差，再除以 Δt。', 'Subtract the previous error from the current error, then divide by Δt.'] },
  { key: 'correction', label: ['轉向修正', 'Steering correction'], unit: ['單位', 'units'], answer: 5.4,
    hint: ['分別用 Kp、Ki、Kd 乘以偏差、新積分同變化率，再將三項相加。', 'Multiply the error, updated integral and derivative by their respective gains, then add the three terms.'] },
  { key: 'left', label: ['左輪邏輯速度', 'Left logical speed'], unit: ['單位', 'units'], answer: 25.4,
    hint: ['左輪用基礎速度加修正量。呢題容許超過 23。', 'Add the correction to the base speed. This exercise allows values above 23.'] },
  { key: 'right', label: ['右輪邏輯速度', 'Right logical speed'], unit: ['單位', 'units'], answer: 14.6,
    hint: ['右輪用基礎速度減修正量。', 'Subtract the correction from the base speed for the right wheel.'] },
];

const codeFields = [
  { key: 'error', label: ['第 1 格 · 偏差', 'Blank 1 · Error'],
    options: ['target - position', 'position - target', 'position - previousError'], answer: 'position - target',
    hint: ['呢段程式規定位置喺目標右邊時偏差為正。', 'A position to the right of the target must give a positive error.'] },
  { key: 'divisor', label: ['第 2 格 · 變化率嘅分母', 'Blank 2 · Derivative denominator'],
    options: ['dt', 'error', 'previousError'], answer: 'dt',
    hint: ['變化率量度每秒偏差改變幾多。揀代表經過時間嘅變數。', 'The derivative measures change in error per second. Choose the variable for elapsed time.'] },
  { key: 'left', label: ['第 3 格 · 左輪修正項', 'Blank 3 · Left wheel adjustment'],
    options: ['integral', 'derivative', 'correction'], answer: 'correction',
    hint: ['左右輪方向相反，但用同一個由三項 PID 合成嘅轉向量。', 'Both wheels use the combined PID adjustment, with opposite signs.'] },
];

function numericField(field) {
  const id = 'q19-' + field.key;
  return `<div class="practice-field">
    <label for="${id}">${copy(...field.label)} <small>(<span>${copy(...field.unit)}</span>)</small></label>
    <input type="number" step="any" inputmode="decimal" id="${id}" name="${field.key}" required aria-invalid="false">
    <small class="practice-feedback" id="${id}-feedback" hidden></small>
  </div>`;
}

function codeBlank(field) {
  const id = 'q20-' + field.key;
  return `<select id="${id}" name="${field.key}" required aria-invalid="false">
    <option value="">${copy('揀答案', 'Choose an answer')}</option>
    ${field.options.map(option => `<option value="${option}" data-no-i18n>${option}</option>`).join('')}
  </select>`;
}

function codeLine(prefix, field) {
  const id = 'q20-' + field.key;
  return `<div class="practice-code-line practice-field"><label for="${id}"><span class="visually-hidden">${copy(...field.label)} </span><code>${prefix}</code></label> ${codeBlank(field)}
    <small class="practice-feedback" id="${id}-feedback" hidden></small></div>`;
}

function actions() {
  return `<div class="practice-actions"><button type="submit">${copy('核對答案', 'Check answers')}</button>
    <button type="reset">${copy('重新作答', 'Try again')}</button>
    <span class="practice-status" role="status" aria-atomic="true"></span></div>`;
}

function bindExercise(form, prefix, fields) {
  const controls = fields.map(field => form.querySelector('#' + prefix + '-' + field.key));
  const status = form.querySelector('.practice-status');
  const solution = form.querySelector('.practice-solution');
  let score = null;
  function updateStatus() {
    status.textContent = score === null ? '' : t(`答啱 ${score} / ${fields.length} 格`, `${score} of ${fields.length} correct`);
  }
  onLanguageChange(updateStatus);

  function clearFeedback(control) {
    control.setAttribute('aria-invalid', 'false');
    control.removeAttribute('aria-describedby');
    delete control.dataset.result;
    const feedback = form.querySelector('#' + control.id + '-feedback');
    feedback.hidden = true;
    feedback.textContent = '';
  }
  for (const control of controls) control.addEventListener('input', () => {
    clearFeedback(control);
    score = null;
    updateStatus();
  });
  form.addEventListener('reset', () => {
    controls.forEach(clearFeedback);
    score = null;
    updateStatus();
    if (solution) { solution.open = false; solution.hidden = true; }
    controls[0].focus();
  });
  form.addEventListener('submit', event => {
    event.preventDefault();
    let firstInvalid = null;
    let allFilled = true;
    score = 0;
    fields.forEach((field, index) => {
      const control = controls[index];
      const feedback = form.querySelector('#' + control.id + '-feedback');
      const filled = control.value !== '';
      const numeric = control.type === 'number';
      const correct = numeric
        ? filled && Math.abs(control.valueAsNumber - field.answer) < 1e-8
        : control.value === field.answer;
      if (!filled) allFilled = false;
      if (correct) score++;
      else if (!firstInvalid) firstInvalid = control;
      control.dataset.result = correct ? 'correct' : 'incorrect';
      control.setAttribute('aria-invalid', String(!correct));
      if (correct) control.removeAttribute('aria-describedby');
      else control.setAttribute('aria-describedby', feedback.id);
      let message;
      if (correct) message = copy('答啱', 'Correct');
      else if (filled) message = copy(...field.hint);
      else message = numeric ? copy('請輸入數值。', 'Enter a number.') : copy('請選擇一項。', 'Choose an option.');
      feedback.textContent = message;
      feedback.hidden = false;
    });
    updateStatus();
    if (solution && allFilled) solution.hidden = false;
    firstInvalid?.focus();
  });
}

export function mountPidPractice(host) {
  if (!host) return;
  host.id = 'worksheet';
  host.setAttribute('aria-labelledby', 'worksheet-title');
  host.innerHTML = `
    <h2 id="worksheet-title">${copy('工作紙練習', 'Worksheet practice')}</h2>
    <a class="practice-source" href="/worksheets/f5-pid-calculation.pdf">${copy('原工作紙第 19–20 題（英文 PDF）', 'Original English Q19–20 (PDF)')}</a>
    <article class="practice-exercise" id="worksheet-q19" tabindex="-1" aria-labelledby="q19-title">
      <h3 id="q19-title" class="practice-heading"><span>Q19</span> ${copy('計一次完整 PID 更新', 'Calculate one complete PID update')}</h3>
      <p>${copy('用以下數據計出新積分、偏差變化率、轉向修正同左右輪邏輯速度。保留小數。', 'Calculate the updated integral, derivative, correction and both logical wheel speeds. Keep the decimals.')}</p>
      <dl class="practice-givens">
        <div><dt>${copy('今次偏差', 'Current error')}</dt><dd>+2</dd></div>
        <div><dt>${copy('上次偏差', 'Previous error')}</dt><dd>+1</dd></div>
        <div><dt>${math`\Delta t`}</dt><dd>${math`0.10\,\mathrm{s}`}</dd></div>
        <div><dt>${copy('原有積分', 'Stored integral')}</dt><dd>0.20 <span>${copy('偏差·s', 'error·s')}</span></dd></div>
        <div><dt>${copy('增益', 'Gains')}</dt><dd>${math`K_P=2,\allowbreak\;K_I=1,\allowbreak\;K_D=0.10`}</dd></div>
        <div><dt>${copy('基礎邏輯速度', 'Base logical speed')}</dt><dd>20 <span>${copy('單位', 'units')}</span></dd></div>
      </dl>
      <p class="practice-note">${copy('Q19 用 0.10 s 更新一次，輪速指令可以保留小數及超出 23。模擬車每 0.010 s 更新一次，摩打指令取整後限制喺 0–23。', 'Q19 uses a 0.10 s interval and permits fractional wheel speeds above 23. The simulator updates every 0.010 s and limits integer motor commands to 0–23.')}</p>
      <form class="practice-form" aria-labelledby="q19-title" novalidate>
        <div class="practice-fields">${numericFields.map(numericField).join('')}</div>
        ${actions()}
        <details class="practice-solution" hidden><summary>${copy('睇計算步驟', 'Show worked solution')}</summary>
          <ol>
            <li><span>${copy('更新積分', 'Update the integral')}</span> ${equation`A_k=0.20+2\times 0.10=0.40`}</li>
            <li><span>${copy('計偏差變化率', 'Find the derivative')}</span> ${equation`r_k=\dfrac{2-1}{0.10}=10`}</li>
            <li><span>${copy('計三項貢獻', 'Calculate each contribution')}</span> ${equation`u_P=2\times 2=4`}
              ${equation`u_I=1\times 0.40=0.40`}
              ${equation`u_D=0.10\times 10=1`}</li>
            <li><span>${copy('合計修正量', 'Sum the correction')}</span> ${equation`u=4+0.40+1=5.40`}</li>
            <li><span>${copy('計兩邊輪速', 'Find both wheel speeds')}</span> ${equation`L=20+5.40=25.40`}
              ${equation`R=20-5.40=14.60`}</li>
          </ol>
        </details>
      </form>
    </article>
    <article class="practice-exercise" id="worksheet-q20" tabindex="-1" aria-labelledby="q20-title">
      <h3 id="q20-title" class="practice-heading"><span>Q20</span> ${copy('補完控制程式', 'Complete the control calculation')}</h3>
      <p>${copy('程式已確認輸入有效、探頭見到線，而且 dt 大於 0。目標位置 target = 0。補完以下三格。', 'The code has checked input validity, line presence and a positive dt. The target position is 0. Complete the three blanks.')}</p>
      <form class="practice-form" aria-labelledby="q20-title" novalidate>
        <div class="practice-code">
          ${codeLine('error =', codeFields[0])}
          <div class="practice-code-line"><code>integral = clamp(integral + error * dt, lowerI, upperI)</code></div>
          ${codeLine('derivative = (error - previousError) /', codeFields[1])}
          <div class="practice-code-line"><code>correction = Kp*error + Ki*integral + Kd*derivative</code></div>
          ${codeLine('leftLogical = base +', codeFields[2])}
          <div class="practice-code-line"><code>rightLogical = base - correction</code></div>
        </div>
        ${actions()}
      </form>
    </article>`;
  bindExercise(host.querySelector('#worksheet-q19 form'), 'q19', numericFields);
  bindExercise(host.querySelector('#worksheet-q20 form'), 'q20', codeFields);
}
