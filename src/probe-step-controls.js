import { controlFields } from './control-fields.js';
import { createProbeLab, PROBE_DEFAULTS } from './probe-lab.js';
import { setupPidStepView } from './pid-step-view.js';
import { onLanguageChange, t } from './i18n.js';

export function setupProbeSteps(section) {
  const controls = section.querySelector('#probe-controls');
  controls.innerHTML = controlFields.map(({ key, label, min, max, step, digits }) => `
    <label for="probe-${key}"><span><b>${key === 'speed' ? 'B' : key.toUpperCase()}</b> <span>${label}</span></span>
      <input id="probe-${key}" name="${key}" type="number" required min="${min}" max="${max}" step="${step}"
        inputmode="${digits ? 'decimal' : 'numeric'}" value="${PROBE_DEFAULTS[key]}">
    </label>`).join('');
  const fields = [...controls.querySelectorAll('input')];
  const details = section.querySelector('#probe-tick');
  const report = section.querySelector('#probe-wheel-report');
  const render = setupPidStepView(section.querySelector('#probe-pid-view'));
  const lab = createProbeLab();

  function showReport() {
    const s = lab.state;
    report.textContent = s.controlTime == null ? '' :
      [s.controlTime.toFixed(3) + ' s', t('左輪 ', 'Left ') + s.leftCommand, t('右輪 ', 'Right ') + s.rightCommand].join(' · ');
  }
  onLanguageChange(showReport);
  return {
    step(mask) {
      const invalid = fields.find(input => !input.validity.valid);
      if (invalid) {
        invalid.focus();
        invalid.reportValidity();
        return;
      }
      const params = Object.fromEntries(fields.map(input => [input.name, input.valueAsNumber]));
      const sample = lab.step(mask, params);
      details.hidden = false;
      details.open = true;
      render(sample);
      showReport();
    },
    reset() {
      render(lab.reset());
      details.open = false;
      details.hidden = true;
      showReport();
    },
  };
}
