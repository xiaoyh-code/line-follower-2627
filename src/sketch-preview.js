import { highlightArduino } from './arduino-code.js';
import { localize } from './i18n.js';

export function setupSketchPreview(section) {
  const preview = section.querySelector('#sketch-preview');
  const select = preview.querySelector('select');
  const status = preview.querySelector('[role=status]');
  const pre = preview.querySelector('pre');
  const code = pre.querySelector('code');
  for (const link of section.querySelectorAll('a[download$=".ino"]')) {
    select.add(new Option(link.download, link.href));
  }

  let pending;
  let displayed;
  async function showSource() {
    pending?.abort();
    if (!preview.open || !select.value) return;
    const url = select.value;
    const request = new AbortController();
    pending = request;
    if (displayed === url) {
      pre.hidden = false;
      status.hidden = true;
      return;
    }
    pre.hidden = true;
    status.textContent = localize('載入程式中…');
    status.hidden = false;
    try {
      const response = await fetch(url, { signal: request.signal });
      if (!response.ok || response.headers.get('content-type')?.includes('text/html')) {
        throw new Error('Sketch unavailable');
      }
      const source = await response.text();
      if (request.signal.aborted) return;
      code.textContent = source;
      highlightArduino(code);
      displayed = url;
      status.hidden = true;
      pre.hidden = false;
      pre.scrollTo(0, 0);
    } catch {
      if (!request.signal.aborted) status.textContent = localize('未能載入。收起再打開可以重試。');
    }
  }
  preview.addEventListener('toggle', showSource);
  select.addEventListener('change', showSource);
}
