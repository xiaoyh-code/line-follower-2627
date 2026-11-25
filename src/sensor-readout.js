// 01_Digital_States prints array indices 0..7. A written register byte starts at bit 7.
export function readSensorDigits(input, order) {
  const digits = input.replace(/\s+/g, '');
  if (!/^[01]{8}$/.test(digits)) return null;
  const channels = [...digits];
  if (order === 'register') channels.reverse();
  const binary = [...channels].reverse().join('');
  const mask = Number.parseInt(binary, 2);
  const hex = mask.toString(16).toUpperCase().padStart(2, '0');
  const indices = bit => channels.flatMap((value, i) => value === bit ? ['S' + (i + 1)] : []);
  return { channels, binary, mask, hex, white: indices('0'), black: indices('1') };
}

export function bindSensorReadout(section, pid) {
  const input = section.querySelector('#sensor-digits');
  const order = section.querySelector('#sensor-format');
  const warning = section.querySelector('#sensor-digits-error');
  const result = section.querySelector('[data-decoded]');
  const toggles = [...section.querySelectorAll('[data-probe]')];
  const readings = toggles.map(button => button.querySelector('[data-channel-reading]'));
  const black = result.querySelector('[data-black]');
  const white = result.querySelector('[data-white]');
  const register = result.querySelector('[data-register]');
  const serial = result.querySelector('[data-serial]');
  const step = section.querySelector('#probe-step');
  let decoded;

  function update() {
    decoded = readSensorDigits(input.value, order.value);
    warning.hidden = Boolean(decoded);
    result.hidden = !decoded;
    step.disabled = !decoded;
    input.setAttribute('aria-invalid', String(!decoded));
    toggles.forEach((button, i) => {
      const bit = decoded?.channels[i];
      readings[i].textContent = bit ?? '—';
      button.setAttribute('aria-pressed', String(bit === '1'));
    });
    if (!decoded) return;
    black.textContent = decoded.black.join(', ') || '∅';
    white.textContent = decoded.white.join(', ') || '∅';
    register.textContent = '0b' + decoded.binary + ' · 0x' + decoded.hex;
    serial.textContent = decoded.channels.join(' ');
  }

  toggles.forEach((button, i) => {
    button.addEventListener('click', () => {
      const channels = decoded ? [...decoded.channels] : Array(8).fill('0');
      channels[i] = channels[i] === '1' ? '0' : '1';
      input.value = (order.value === 'register' ? channels.reverse() : channels).join('');
      update();
    });
  });
  input.addEventListener('input', update);
  order.addEventListener('change', update);
  step.addEventListener('click', () => {
    if (decoded) pid.step(decoded.mask);
  });
  section.querySelector('#probe-reset').addEventListener('click', () => pid.reset());
  update();
}
