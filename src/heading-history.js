import './heading-history.css';

const WINDOW_SECONDS = 4;

export function setupHeadingHistory(host) {
  const trace = host.querySelector('polyline');
  const marker = host.querySelector('circle');
  const range = host.querySelector('[data-range]');
  const current = host.querySelector('[data-current]');
  const upper = host.querySelector('[data-upper]');
  const lower = host.querySelector('[data-lower]');
  const left = host.querySelector('[data-left-time]');
  const right = host.querySelector('[data-right-time]');
  const samples = [];
  let dirty = false;
  let nextPaint = 0;

  function reset() {
    samples.length = 0;
    dirty = false;
    nextPaint = 0;
    trace.setAttribute('points', '');
    marker.style.display = 'none';
    range.textContent = current.textContent = '—';
    upper.textContent = '+5°';
    lower.textContent = '−5°';
    left.textContent = '0 s';
    right.textContent = '4 s';
  }

  function add({ time, headingDeg }) {
    if (!Number.isFinite(time) || !Number.isFinite(headingDeg)) return;
    const last = samples.at(-1);
    if (last && time <= last.time) return;
    const delta = last ? ((headingDeg - last.raw + 540) % 360) - 180 : 0;
    const angle = last ? last.angle + delta : 0;
    samples.push({ time, raw: headingDeg, angle });
    const start = Math.max(0, time - WINDOW_SECONDS);
    while (samples[0].time < start - 1e-7) samples.shift();
    dirty = true;
  }

  function draw(immediate = false) {
    const now = performance.now();
    if (!dirty || (!immediate && now < nextPaint)) return;
    dirty = false;
    nextPaint = now + 80; // Paint at most 12.5 times per second during playback.
    const start = Math.max(0, samples.at(-1).time - WINDOW_SECONDS);

    const reference = samples[0].angle;
    const offsets = samples.map(point => point.angle - reference);
    const min = Math.min(...offsets), max = Math.max(...offsets);
    // Symmetric scale; a five-degree minimum keeps sensor noise from filling the plot.
    const peak = Math.max(5, Math.abs(min), Math.abs(max));
    const limit = 5 * 2 ** Math.ceil(Math.log2(peak / 5));
    const points = samples.map((point, i) => {
      const x = 1000 * (point.time - start) / WINDOW_SECONDS;
      const y = 50 - 48 * offsets[i] / limit;
      return x.toFixed(2) + ',' + y.toFixed(2);
    });
    trace.setAttribute('points', points.join(' '));
    const [cx, cy] = points.at(-1).split(',');
    marker.setAttribute('cx', cx);
    marker.setAttribute('cy', cy);
    marker.style.display = '';
    upper.textContent = '+' + limit + '°';
    lower.textContent = '−' + limit + '°';
    const relative = Number(offsets.at(-1).toFixed(1));
    current.textContent = (relative > 0 ? '+' : '') + relative.toFixed(1) + '°';
    range.textContent = samples.length > 1 ? (max - min).toFixed(1) + '°' : '—';
    left.textContent = start.toFixed(1) + ' s';
    right.textContent = (start + WINDOW_SECONDS).toFixed(1) + ' s';
  }

  reset();
  return { add, draw, reset };
}
