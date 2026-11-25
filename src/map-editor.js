import './map-editor.css';
import { languagePickerHtml, onLanguageChange, registerTranslations, t } from './i18n.js';
import {
  autoThreshold,
  contoursFromMask,
  makeSvg,
  maskForPath,
  readMapSvg,
  suggestStart,
  thresholdMask,
  VECTOR_MESSAGES,
} from './map-vector.js';

const MAP_TEXT = {
  ...VECTOR_MESSAGES,
  '賽道編輯器': 'Track editor',
  '關閉賽道編輯器': 'Close the track editor',
  '地圖工具': 'Map tools',
  '賽道來源': 'Track source',
  '手繪': 'Draw',
  '相片轉 SVG': 'Photo to SVG',
  '用手指或滑鼠畫黑線。每次提筆可以另畫一段，亦可以畫分岔。': 'Draw a black line with your finger or mouse. Lift to start a new section or add a branch.',
  '新畫線寬': 'New stroke width',
  '輸入座標畫線': 'Draw using coordinates',
  '各點座標（x,y）': 'Points (x,y)',
  '由左上角起計，x 向右、y 向下，用地圖闊度同高度嘅百分比表示。例如 10,75 50,25 90,75。': 'Measure from the top left. Use percentages of the map width for x (right) and height for y (down). For example, 10,75 50,25 90,75.',
  '加入線段': 'Add stroke',
  '請輸入至少兩個唔同嘅點，每個 x,y 都喺 0 至 100 之間，點同點之間用空格分開。': 'Enter at least two distinct x,y points, separated by spaces. Each coordinate must be between 0 and 100.',
  '復原一筆': 'Undo stroke',
  '清空畫布': 'Clear canvas',
  '從正上方拍攝，先裁走賽道以外嘅背景。相片只會喺呢部裝置處理。': 'Take the photo from above and crop it to the track. The image is processed on this device.',
  '選擇地圖檔案': 'Choose map file',
  'JPG、PNG 或本工具匯出嘅 SVG': 'JPG, PNG, or SVG exported by this editor',
  '黑白門檻': 'Black/white threshold',
  '原相係深底白線': 'Light line on a dark background',
  '地圖實際闊度': 'Physical map width',
  '設定起點及方向': 'Set starting point and heading',
  '箭嘴標示起步時感測器位置同車頭方向。': 'The arrow marks the starting sensor position and heading.',
  '方向': 'Heading', '反轉方向': 'Reverse heading',
  '地圖預覽': 'Map preview', '賽道預覽': 'Track preview', '原相': 'Original',
  '賽道畫布，可用滑鼠或觸控繪畫。設定起點時可用方向鍵微調。': 'Track canvas. Draw with a mouse or touch. Use the arrow keys to adjust the starting point.',
  '下載 SVG': 'Download SVG', '套用賽道': 'Apply track',
  '在線上按低，再向車頭方向拖曳。可用方向鍵微調起點。': 'Press on the line and drag in the direction the car should face. Use the arrow keys for fine adjustments.',
  '未搵到賽道線。試調高門檻，或切換深底白線。': 'No line was found. Raise the threshold or choose a light line on a dark background.',
  '大部分地圖都變成黑色。請比較原相，調低門檻或切換深底白線。': 'Most of the map is black. Check the original photo, lower the threshold or invert the colours.',
  '黑色部分會成為循線感測器讀取嘅賽道。': 'The black areas are the track the sensors will detect.',
  '選擇地圖相片，即可預覽轉換後嘅黑線。': 'Choose a track photo to preview its black-line outline.',
  '在淺色畫布畫第一段黑線。': 'Draw the first black line on the canvas.',
  '已更新起點同車頭方向。': 'Starting point and heading updated.',
  '已加入黑線。可以繼續畫，或設定起點。': 'Stroke added. Keep drawing or set the starting point.',
  '正在讀取地圖…': 'Reading map…',
  '已載入 SVG 嘅賽道、尺寸同起點。': 'Loaded the SVG track, scale and starting point.',
  '未能讀取檔案。': 'Could not read the file.',
  '未能讀取相片。請用 JPG 或 PNG 再試。': 'Could not read the photo. Try a JPG or PNG file.',
  '已復原上次改動。': 'Last edit undone.',
  '畫布已清空，可用「復原一筆」取回。': 'Canvas cleared. Use Undo stroke to restore it.',
  '在線上由起點向前拖曳，或點一下按線段方向自動放置。': 'Drag along the line from the starting point, or tap to follow the local line direction.',
  '可以繼續編輯賽道。': 'You can continue editing the track.',
  '已匯出向量賽道，包含地圖尺寸同起點。': 'Exported the SVG track with its scale and starting point.',
  '正在套用賽道…': 'Applying track…',
  '未能套用賽道。': 'Could not apply the track.',
  '手繪賽道': 'Hand-drawn track', '相片賽道': 'Photo track', '自訂賽道': 'Custom track',
};
registerTranslations(MAP_TEXT);
const mapText = text => t(text, MAP_TEXT[text] ?? text);
const courseName = draft => draft.generatedName ? mapText(draft.generatedName) : draft.name;

const SENSOR_OFFSET = 0.1588;
const limit = (v, min, max) => Math.min(max, Math.max(min, v));
const blank = (source = 'draw') => ({
  source,
  name: source === 'draw' ? '手繪賽道' : '相片賽道',
  generatedName: source === 'draw' ? '手繪賽道' : '相片賽道',
  width: 900,
  height: 600,
  physicalWidth: 2.4,
  path: '',
  mask: null,
  marker: null,
  history: [],
  brush: 21,
  threshold: 128,
  invert: false,
  gray: null,
  thumbnail: '',
});

function drawPath(draft, points) {
  const canvas = document.createElement('canvas');
  canvas.width = draft.width;
  canvas.height = draft.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (draft.path) ctx.fill(new Path2D(draft.path), 'evenodd');
  ctx.lineWidth = (draft.brush * draft.width) / (1000 * draft.physicalWidth);
  ctx.lineJoin = ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (const p of points.slice(1)) ctx.lineTo(p.x, p.y);
  if (points.length === 1) {
    ctx.arc(points[0].x, points[0].y, ctx.lineWidth / 2, 0, 2 * Math.PI);
    ctx.fill();
  } else ctx.stroke();
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  const mask = new Uint8Array(canvas.width * canvas.height);
  for (let i = 0; i < mask.length; i++) mask[i] = Number(pixels[i * 4 + 3] >= 128);
  return contoursFromMask(mask, canvas.width, canvas.height);
}

function refreshMask(draft, suggested, angle) {
  draft.mask = maskForPath(draft.path, draft.width, draft.height);
  const old = draft.marker;
  if (old && draft.mask[Math.floor(old.y) * draft.width + Math.floor(old.x)]) return;
  draft.marker = suggestStart(
    draft.mask,
    draft.width,
    draft.height,
    draft.physicalWidth,
    suggested || old,
  );
  if (draft.marker && Number.isFinite(angle)) draft.marker.angle = angle;
}

function drawStart(points, draft) {
  let distance = 0;
  const desired = (0.17 * draft.width) / draft.physicalWidth;
  let target = points[0],
    angle;
  for (let i = 1; i < points.length; i++) {
    const dx = points[i].x - points[i - 1].x,
      dy = points[i].y - points[i - 1].y;
    const length = Math.hypot(dx, dy);
    if (!length) continue;
    const fraction = Math.min(1, (desired - distance) / length);
    target = { x: points[i - 1].x + dx * fraction, y: points[i - 1].y + dy * fraction };
    angle = (Math.round((Math.atan2(dx, -dy) * 180) / Math.PI) + 360) % 360;
    distance += length;
    if (distance >= desired) break;
  }
  return { target, angle };
}

function loadPhoto(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file),
      image = new Image();
    image.onload = () => {
      try {
        const factor = Math.min(1, 900 / Math.max(image.naturalWidth, image.naturalHeight));
        const width = Math.max(1, Math.round(image.naturalWidth * factor)),
          height = Math.max(1, Math.round(image.naturalHeight * factor));
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(image, 0, 0, width, height);
        const pixels = ctx.getImageData(0, 0, width, height).data,
          gray = new Uint8Array(width * height);
        for (let i = 0; i < gray.length; i++)
          gray[i] = Math.round(
            0.2126 * pixels[i * 4] + 0.7152 * pixels[i * 4 + 1] + 0.0722 * pixels[i * 4 + 2],
          );
        resolve({ width, height, gray, thumbnail: canvas.toDataURL('image/jpeg', 0.86) });
      } catch (error) {
        reject(error);
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('未能讀取相片。請用 JPG 或 PNG 再試。'));
    };
    image.src = url;
  });
}

export function setupMapEditor({ onApply, getCurrentCourse }) {
  const dlg = document.createElement('dialog');
  dlg.className = 'map-editor';
  dlg.setAttribute('aria-labelledby', 'me-title');
  dlg.innerHTML = `
    <header class="me-head"><h2 id="me-title"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3ZM9 3v15m6-12v15"/></svg>賽道編輯器</h2>${languagePickerHtml()}<button type="button" class="me-close" aria-label="關閉賽道編輯器">×</button></header>
    <div class="me-layout">
      <section class="me-tools" aria-label="地圖工具">
        <div class="me-segments" role="group" aria-label="賽道來源"><button data-mode="draw">手繪</button><button data-mode="photo">相片轉 SVG</button></div>
        <div data-box="draw"><p class="me-note">用手指或滑鼠畫黑線。每次提筆可以另畫一段，亦可以畫分岔。</p>
          <label class="me-label">新畫線寬 <span><input data-ui="brush" type="number" min="5" max="120" step="1" value="21"> mm</span></label>
          <div class="me-pair"><button data-action="undo">復原一筆</button><button data-action="clear">清空畫布</button></div>
          <details class="me-coordinates"><summary id="me-coordinate-title">輸入座標畫線</summary>
            <form aria-labelledby="me-coordinate-title" novalidate>
              <label class="me-label" for="me-points">各點座標（x,y）</label>
              <p class="me-note" id="me-points-hint">由左上角起計，x 向右、y 向下，用地圖闊度同高度嘅百分比表示。例如 10,75 50,25 90,75。</p>
              <input type="text" id="me-points" name="points" aria-describedby="me-points-hint" required autocapitalize="none" spellcheck="false">
              <p class="me-coordinate-error" id="me-points-error" hidden>請輸入至少兩個唔同嘅點，每個 x,y 都喺 0 至 100 之間，點同點之間用空格分開。</p>
              <button type="submit">加入線段</button>
            </form>
          </details></div>
        <div data-box="photo" hidden><p class="me-note">從正上方拍攝，先裁走賽道以外嘅背景。相片只會喺呢部裝置處理。</p>
          <button class="me-file" data-action="file">選擇地圖檔案</button>
          <input data-ui="file" hidden type="file" accept="image/png,image/jpeg,image/svg+xml,.svg">
          <small class="me-muted me-filetype">JPG、PNG 或本工具匯出嘅 SVG</small>
          <div data-box="trace" hidden><label class="me-range-label" for="me-cutoff">黑白門檻 <output data-ui="cutoff">128</output></label>
            <input id="me-cutoff" data-ui="threshold" type="range" min="0" max="255" step="1">
            <label class="me-check"><input type="checkbox" data-ui="invert">原相係深底白線</label></div></div>
        <div class="me-dimensions"><label class="me-label">地圖實際闊度 <span><input data-ui="width" type="number" min="0.3" max="12" step="0.01" value="2.4"> m</span></label>
          <small class="me-muted" data-ui="dimensions"></small></div>
        <div class="me-startbox"><button data-action="place" aria-pressed="false">設定起點及方向</button>
          <p class="me-note" data-ui="start-help">箭嘴標示起步時感測器位置同車頭方向。</p>
          <div class="me-pair me-angle"><label>方向 <span><input data-ui="angle" type="number" min="0" max="359" step="1">°</span></label><button data-action="reverse">反轉方向</button></div></div>
      </section>
      <section class="me-preview" aria-label="地圖預覽"><div class="me-preview-head"><h3>賽道預覽</h3><div class="me-segments me-small" data-box="compare" hidden><button data-show="vector" aria-pressed="true">SVG</button><button data-show="photo" aria-pressed="false">原相</button></div></div>
        <div class="me-board"><svg class="me-canvas" role="img" tabindex="0" aria-label="賽道畫布，可用滑鼠或觸控繪畫。設定起點時可用方向鍵微調。" viewBox="0 0 900 600">
          <rect data-layer="page" width="100%" height="100%" fill="#fdfcfd"/>
          <image data-layer="photo" width="100%" height="100%" preserveAspectRatio="none" hidden/>
          <path data-layer="ink" fill="#141414" fill-rule="evenodd" stroke="none"/>
          <path data-layer="stroke" fill="none" stroke="#141414" stroke-linecap="round" stroke-linejoin="round"/>
          <g data-layer="marker" hidden><circle fill="var(--action-fill)" stroke="var(--action-text)"/><path fill="var(--action-text)" stroke="var(--action-fill)" stroke-linejoin="round"/></g>
        </svg></div>
        <p class="me-feedback" data-ui="feedback" data-no-i18n role="status"></p>
      </section>
    </div>
    <footer class="me-footer"><button data-action="download"><svg aria-hidden="true"><use href="#ic-download"/></svg>下載 SVG</button><button class="me-primary" data-action="apply">套用賽道</button></footer>`;
  document.body.append(dlg);
  const q = (selector) => dlg.querySelector(selector);
  const element = (n) => q('[data-ui="' + n + '"]');
  const layer = (n) => q('[data-layer="' + n + '"]');
  const box = (n) => q('[data-box="' + n + '"]');
  const action = (n) => q('[data-action="' + n + '"]');
  const svg = q('.me-canvas'),
    feedback = element('feedback');
  let draw,
    photo,
    draft,
    placing = false,
    original = false,
    drag = null;
  let committedCourse = null,
    committedDraft = null,
    generation = 0,
    frame = 0,
    pending = false;
  let focusReturn = null;
  let feedbackText = () => '';
  const message = (value) => {
    feedbackText = typeof value === 'function' ? value : () => mapText(value);
    feedback.textContent = feedbackText();
  };

  function markerView() {
    const g = layer('marker'),
      p = draft.marker;
    g.toggleAttribute('hidden', !p || original);
    if (!p) return;
    const unit = Math.max(draft.width, draft.height) / 900;
    g.setAttribute(
      'transform',
      'translate(' + p.x + ' ' + p.y + ') rotate(' + p.angle + ') scale(' + unit + ')',
    );
    const circle = g.querySelector('circle'),
      arrow = g.querySelector('path');
    circle.setAttribute('r', 6);
    circle.setAttribute('stroke-width', 2.5);
    arrow.setAttribute('d', 'M0 -25L8 -12L2 -14L2 -3L-2 -3L-2 -14L-8 -12Z');
    arrow.setAttribute('stroke-width', 1.2);
    element('angle').value = Math.round(p.angle) % 360;
  }

  function update() {
    const src = draft.source,
      hasInk = Boolean(draft.path && draft.marker);
    q('.me-layout').inert = pending;
    for (const btn of dlg.querySelectorAll('[data-mode]'))
      btn.setAttribute('aria-pressed', String(btn.dataset.mode === src));
    box('draw').hidden = src !== 'draw';
    box('photo').hidden = src !== 'photo';
    box('trace').hidden = box('compare').hidden = !draft.gray;
    for (const btn of dlg.querySelectorAll('[data-show]'))
      btn.setAttribute('aria-pressed', String((btn.dataset.show === 'photo') === original));
    action('undo').disabled = !draft.history.length;
    action('clear').disabled = !draft.path;
    action('place').disabled = action('reverse').disabled = element('angle').disabled = !hasInk;
    action('download').disabled = action('apply').disabled = !hasInk || pending;
    action('place').setAttribute('aria-pressed', String(placing));
    element('start-help').textContent = placing
      ? '在線上按低，再向車頭方向拖曳。可用方向鍵微調起點。'
      : '箭嘴標示起步時感測器位置同車頭方向。';
    element('width').value = draft.physicalWidth;
    element('brush').value = draft.brush;
    element('dimensions').textContent = t('地圖高度 ', 'Map height ') +
      ((draft.height / draft.width) * draft.physicalWidth).toFixed(2) + ' m';
    element('invert').checked = draft.invert;
    element('threshold').value = draft.threshold;
    element('cutoff').value = draft.threshold;
    svg.setAttribute('viewBox', '0 0 ' + draft.width + ' ' + draft.height);
    // Explicit numeric bounds keep the sheet aligned when its aspect ratio differs from the viewport.
    for (const n of ['page', 'photo']) {
      layer(n).setAttribute('width', draft.width);
      layer(n).setAttribute('height', draft.height);
    }
    svg.dataset.tool = placing ? 'place' : src;
    const picture = layer('photo');
    picture.toggleAttribute('hidden', !original || !draft.thumbnail);
    if (draft.thumbnail && picture.getAttribute('href') !== draft.thumbnail)
      picture.setAttribute('href', draft.thumbnail);
    if (!draft.thumbnail) picture.removeAttribute('href');
    const ink = layer('ink');
    ink.setAttribute('d', draft.path);
    ink.toggleAttribute('hidden', original);
    markerView();
  }

  function refitPhoto() {
    if (!draft.gray) return;
    const bits = thresholdMask(draft.gray, draft.width, draft.height, draft.threshold, draft.invert);
    draft.path = contoursFromMask(bits, draft.width, draft.height);
    refreshMask(draft);
    let black = 0;
    for (const bit of bits) black += bit;
    const fraction = black / bits.length;
    message(
      !black
        ? '未搵到賽道線。試調高門檻，或切換深底白線。'
        : fraction > 0.55
          ? '大部分地圖都變成黑色。請比較原相，調低門檻或切換深底白線。'
          : '黑色部分會成為循線感測器讀取嘅賽道。',
    );
    update();
  }

  function scheduleTrace() {
    if (frame) cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      frame = 0;
      refitPhoto();
    });
  }

  function flushTrace() {
    if (!frame) return;
    cancelAnimationFrame(frame);
    frame = 0;
    refitPhoto();
  }

  function setMode(value) {
    flushTrace();
    draft = value === 'photo' ? photo : draw;
    placing = original = false;
    message(
      draft.path
        ? () => courseName(draft)
        : value === 'photo'
          ? '選擇地圖相片，即可預覽轉換後嘅黑線。'
          : '在淺色畫布畫第一段黑線。',
    );
    update();
  }

  function point(event) {
    const p = svg.createSVGPoint();
    p.x = event.clientX;
    p.y = event.clientY;
    const local = p.matrixTransform(svg.getScreenCTM().inverse());
    return {
      x: limit(local.x, 0, draft.width - 0.01),
      y: limit(local.y, 0, draft.height - 0.01),
      inside: local.x >= 0 && local.x < draft.width && local.y >= 0 && local.y < draft.height,
    };
  }
  function remember() {
    draft.history.push({ path: draft.path, marker: draft.marker ? { ...draft.marker } : null });
  }
  function commitStroke(points) {
    const path = drawPath(draft, points);
    const preferred = drawStart(points, draft);
    remember();
    draft.path = path;
    refreshMask(draft, preferred.target, preferred.angle);
    message('已加入黑線。可以繼續畫，或設定起點。');
  }
  const coordinates = q('#me-points');
  function coordinateError(invalid) {
    q('#me-points-error').hidden = !invalid;
    coordinates.setAttribute('aria-invalid', String(invalid));
    coordinates.setAttribute('aria-describedby', invalid ? 'me-points-hint me-points-error' : 'me-points-hint');
  }
  coordinates.addEventListener('input', () => coordinateError(false));
  coordinates.form.addEventListener('submit', event => {
    event.preventDefault();
    if (pending || drag || draft.source !== 'draw') return;
    const pairs = coordinates.value.normalize('NFKC').trim().replace(/\s*,\s*/g, ',').split(/\s+/);
    const points = [];
    for (const pair of pairs) {
      const match = /^(\d*\.?\d+),(\d*\.?\d+)$/.exec(pair);
      if (!match || Number(match[1]) > 100 || Number(match[2]) > 100) break;
      points.push({ x: (draft.width - 1) * Number(match[1]) / 100, y: (draft.height - 1) * Number(match[2]) / 100 });
    }
    const valid = points.length === pairs.length && points.some(p => p.x !== points[0].x || p.y !== points[0].y);
    coordinateError(!valid);
    if (!valid) { coordinates.focus(); return; }
    placing = false;
    commitStroke(points);
    coordinates.value = '';
    update();
  });
  function gestureUpdate(event) {
    if (!drag || drag.id !== event.pointerId) return;
    const p = point(event),
      first = drag.points[0];
    if (drag.placing) {
      const dx = p.x - first.x,
        dy = p.y - first.y;
      if (Math.hypot(dx, dy) > 3)
        draft.marker.angle = (Math.round((Math.atan2(dx, -dy) * 180) / Math.PI) + 360) % 360;
      markerView();
    } else if (Math.hypot(drag.last.x - p.x, drag.last.y - p.y) > 0.4) {
      drag.points.push(p);
      drag.last = p;
      drag.stroke += 'L' + p.x.toFixed(2) + ' ' + p.y.toFixed(2);
      layer('stroke').setAttribute('d', drag.stroke);
    }
  }
  svg.addEventListener('pointerdown', (event) => {
    if (drag || pending || original || event.button !== 0 || (!placing && draft.source !== 'draw'))
      return;
    const p = point(event);
    if (!p.inside) return;
    event.preventDefault();
    svg.focus({ preventScroll: true });
    svg.setPointerCapture(event.pointerId);
    drag = {
      id: event.pointerId,
      points: [p],
      last: p,
      placing,
      old: draft.marker ? { ...draft.marker } : null,
      stroke: 'M' + p.x + ' ' + p.y,
    };
    if (placing) {
      draft.marker = suggestStart(draft.mask, draft.width, draft.height, draft.physicalWidth, p);
      markerView();
    } else {
      const el = layer('stroke');
      el.setAttribute('stroke-width', (draft.brush * draft.width) / (draft.physicalWidth * 1000));
      el.setAttribute('d', drag.stroke);
    }
  });
  svg.addEventListener('pointermove', gestureUpdate);
  svg.addEventListener('pointerup', (event) => {
    if (!drag || drag.id !== event.pointerId) return;
    gestureUpdate(event);
    if (drag.placing) message('已更新起點同車頭方向。');
    else commitStroke(drag.points);
    drag = null;
    layer('stroke').setAttribute('d', '');
    update();
  });
  svg.addEventListener('pointercancel', () => {
    if (drag?.placing) draft.marker = drag.old;
    drag = null;
    layer('stroke').setAttribute('d', '');
    markerView();
  });
  svg.addEventListener('keydown', (event) => {
    if (
      !placing ||
      !draft.marker ||
      !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)
    )
      return;
    event.preventDefault();
    const p = draft.marker,
      amount = event.shiftKey ? 10 : 1;
    p.x = limit(
      p.x + (event.key === 'ArrowRight' ? amount : event.key === 'ArrowLeft' ? -amount : 0),
      0,
      draft.width - 1,
    );
    p.y = limit(
      p.y + (event.key === 'ArrowDown' ? amount : event.key === 'ArrowUp' ? -amount : 0),
      0,
      draft.height - 1,
    );
    markerView();
  });

  async function readFile(file) {
    if (!file) return;
    const token = ++generation;
    flushTrace();
    message('正在讀取地圖…');
    try {
      const next = blank('photo');
      const filename = file.name.replace(/\.[^.]+$/, '');
      if (filename) { next.name = filename; next.generatedName = null; }
      if (file.type === 'image/svg+xml' || /\.svg$/i.test(file.name)) {
        Object.assign(next, readMapSvg(await file.text()));
        refreshMask(next);
      } else {
        Object.assign(next, await loadPhoto(file));
        next.threshold = autoThreshold(next.gray);
      }
      if (token !== generation || !dlg.open) return;
      photo = draft = next;
      placing = original = false;
      if (next.gray) refitPhoto();
      else {
        message('已載入 SVG 嘅賽道、尺寸同起點。');
        update();
      }
    } catch (error) {
      if (token === generation) message(error.message || '未能讀取檔案。');
    }
  }
  element('file').addEventListener('change', (event) => {
    const file = event.target.files[0];
    event.target.value = '';
    void readFile(file);
  });
  element('threshold').addEventListener('input', (event) => {
    draft.threshold = Number(event.target.value);
    element('cutoff').value = draft.threshold;
    original = false;
    scheduleTrace();
  });
  element('invert').addEventListener('change', (event) => {
    draft.invert = event.target.checked;
    draft.threshold = autoThreshold(draft.gray, draft.invert);
    original = false;
    refitPhoto();
  });
  element('width').addEventListener('change', (event) => {
    const v = event.target.valueAsNumber;
    if (Number.isFinite(v)) draft.physicalWidth = limit(v, 0.3, 12);
    update();
  });
  element('brush').addEventListener('change', (event) => {
    const v = event.target.valueAsNumber;
    if (Number.isFinite(v)) draft.brush = limit(v, 5, 120);
    update();
  });
  element('angle').addEventListener('change', (event) => {
    const v = event.target.valueAsNumber;
    if (draft.marker && Number.isFinite(v)) draft.marker.angle = ((Math.round(v) % 360) + 360) % 360;
    markerView();
  });

  function course() {
    const { width, height, physicalWidth, marker, mask } = draft;
    const physicalHeight = (physicalWidth * height) / width,
      scale = physicalWidth / width;
    const heading = (-marker.angle * Math.PI) / 180;
    return {
      kind: 'custom',
      name: courseName(draft),
      generatedName: draft.generatedName,
      width,
      height,
      physicalWidth,
      physicalHeight,
      svg: makeSvg(draft),
      mask: mask.slice(),
      startSensorForward: SENSOR_OFFSET,
      startPose: {
        x: (marker.x - width / 2) * scale + SENSOR_OFFSET * Math.sin(heading),
        y: (height / 2 - marker.y) * scale - SENSOR_OFFSET * Math.cos(heading),
        heading,
      },
    };
  }

  dlg.addEventListener('click', async (event) => {
    const btn = event.target.closest('button');
    if (!btn || btn.disabled || pending) return;
    if (btn.classList.contains('me-close')) {
      dlg.close();
      return;
    }
    if (btn.dataset.mode) {
      ++generation;
      setMode(btn.dataset.mode);
      return;
    }
    if (btn.dataset.show) {
      original = btn.dataset.show === 'photo';
      update();
      return;
    }
    const cmd = btn.dataset.action;
    if (cmd === 'file') {
      element('file').click();
      return;
    }
    if (cmd === 'undo') {
      const old = draft.history.pop();
      if (old) {
        Object.assign(draft, old);
        refreshMask(draft);
        placing = false;
        message('已復原上次改動。');
      }
    }
    if (cmd === 'clear') {
      remember();
      draft.path = '';
      draft.mask = null;
      draft.marker = null;
      placing = false;
      message('畫布已清空，可用「復原一筆」取回。');
    }
    if (cmd === 'place') {
      placing = !placing;
      original = false;
      message(placing ? '在線上由起點向前拖曳，或點一下按線段方向自動放置。' : '可以繼續編輯賽道。');
      if (placing) svg.focus({ preventScroll: true });
    }
    if (cmd === 'reverse' && draft.marker) draft.marker.angle = (draft.marker.angle + 180) % 360;
    if (cmd === 'download' || cmd === 'apply') {
      flushTrace();
      if (!draft.marker || !draft.path) return;
      const data = course();
      if (cmd === 'download') {
        const url = URL.createObjectURL(new Blob([data.svg], { type: 'image/svg+xml' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = (data.name || t('賽道', 'Track')) + '.svg';
        document.body.append(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        message('已匯出向量賽道，包含地圖尺寸同起點。');
      } else {
        pending = true;
        update();
        message('正在套用賽道…');
        try {
          await onApply(data);
          committedCourse = data;
          committedDraft = { ...draft, marker: { ...draft.marker }, history: [] };
          dlg.close();
        } catch (error) {
          message(error.message || '未能套用賽道。');
        } finally {
          pending = false;
        }
      }
    }
    update();
  });
  dlg.addEventListener('cancel', (event) => {
    if (pending) event.preventDefault();
  });
  dlg.addEventListener('close', () => {
    ++generation;
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    drag = null;
    layer('stroke').setAttribute('d', '');
    if (focusReturn?.isConnected) focusReturn.focus({ preventScroll: true });
  });

  const unsubscribe = onLanguageChange(() => {
    if (!dlg.open || !draft) return;
    feedback.textContent = feedbackText();
    element('dimensions').textContent = t('地圖高度 ', 'Map height ') +
      ((draft.height / draft.width) * draft.physicalWidth).toFixed(2) + ' m';
  });
  return {
    open() {
      if (dlg.open) return;
      coordinates.value = '';
      coordinateError(false);
      q('.me-coordinates').open = false;
      draw = blank();
      photo = blank('photo');
      const active = getCurrentCourse?.();
      if (active?.kind === 'custom') {
        if (active === committedCourse && committedDraft) {
          const restored = { ...committedDraft, marker: { ...committedDraft.marker }, history: [] };
          if (restored.source === 'draw') draw = restored;
          else photo = restored;
          draft = restored;
        } else {
          try {
            Object.assign(photo, readMapSvg(active.svg), {
              name: active.name || '自訂賽道',
              generatedName: active.generatedName || (active.name ? null : '自訂賽道'),
            });
            refreshMask(photo);
            draft = photo;
          } catch {
            draft = draw;
          }
        }
      } else draft = draw;
      focusReturn = document.activeElement;
      dlg.showModal();
      setMode(draft.source);
    },
    dispose() {
      unsubscribe();
      ++generation;
      if (frame) cancelAnimationFrame(frame);
      if (dlg.open) dlg.close();
      dlg.remove();
    },
  };
}
