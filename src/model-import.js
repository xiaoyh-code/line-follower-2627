import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { DEFAULT_PHYSICAL, PHYSICAL_LIMITS } from './simulation.js';
import { languagePickerHtml, onLanguageChange, registerTranslations, t } from './i18n.js';
import './model-import.css';

const MODEL_TEXT = {
  '匯入車身模型': 'Import vehicle model', '關閉模型匯入': 'Close model importer', '關閉': 'Close',
  '車身檔案': 'Vehicle file', '選擇車身檔案': 'Choose vehicle file',
  '支援 STEP、STP 及 STL，每個檔案最多 64 MiB。檔案只會在這部裝置處理。': 'Choose a STEP, STP or STL file, up to 64 MiB. Files are processed on this device.',
  '模型方向、輪軸及感測器位置預覽': 'Preview of the vehicle orientation, axle and sensor positions',
  '圓圈及橫線標示車輪與輪軸': 'Circles and axle line mark the wheels',
  '感測器橫列及車頭方向箭咀': 'Sensor row and forward arrow',
  '方向及輪軸': 'Orientation and axle', '車頂方向': 'Up axis', '車頭方向': 'Forward axis',
  'STL 原始單位': 'STL source units', '毫米': 'Millimetres', '厘米': 'Centimetres', '米': 'Metres', '英寸': 'Inches',
  '輪軸距車尾（車長 %）': 'Axle position from rear (% of length)', '循線車尺寸': 'Vehicle dimensions',
  '車輪直徑': 'Wheel diameter', '左右輪中心距': 'Wheel centre spacing',
  '輪軸至感測器前距': 'Sensor distance ahead of axle', '感測器間距': 'Sensor spacing',
  '可轉動輪件': 'Rotating wheel assemblies',
  '多零件模型可選擇左右車輪。一體式模型可保持固定外觀，車輪運動仍按上方尺寸計算。': 'Select the wheel parts for a multi-part model. A one-piece model can keep a fixed appearance while the dimensions above still drive the physics.',
  '左輪組件': 'Left wheel assembly', '右輪組件': 'Right wheel assembly',
  '按已選輪件量度輪軸': 'Measure axle from selected wheels', '固定外觀': 'Fixed appearance',
  '取消': 'Cancel', '套用車身模型': 'Apply vehicle model',
  '未能從 STEP 讀取實體，請確認檔案包含可顯示的零件。': 'The STEP file has no readable solids. Check that it contains visible parts.',
  '模型面數過多，請先在 CAD 軟件簡化零件，再重新匯出。': 'The model has too many triangles. Simplify the parts in your CAD software and export again.',
  'STEP 解析失敗。': 'Could not parse the STEP file.',
  'STEP 轉換器未能載入或記憶體不足，請重新選擇檔案。': 'The STEP converter could not load or ran out of memory. Choose the file again.',
  '請選擇非空白並小於或等於 64 MiB 的檔案。': 'Choose a non-empty file no larger than 64 MiB.',
  '請選擇 STEP、STP 或 STL 檔案。': 'Choose a STEP, STP or STL file.',
  'STL 面數過多，請先簡化網格。': 'The STL has too many triangles. Simplify its mesh first.',
  'STL 檔案的標頭或長度不完整。': 'The STL header or file length is invalid.',
  'STL 沒有可用的三角面，或模型面數過多。': 'The STL has no usable triangles or exceeds the triangle limit.',
  '檔案沒有可顯示的零件。': 'The file contains no visible parts.',
  '零件坐標包含無效數值。': 'A part contains invalid coordinates.',
  '零件含有無效的網格索引。': 'A part contains an invalid mesh index.',
  '模型尺寸為零。': 'The model has zero size.', '無法解析檔案。': 'Could not parse the file.',
  '左右輪須選用兩組獨立零件。': 'Choose separate parts for the left and right wheels.',
  '按目前的車頭方向，左輪應在右輪左側。請檢查方向與輪件。': 'With this heading, the left wheel must be to the left of the right wheel. Check the axes and selected parts.',
  '量得的輪徑或輪距超出支援範圍。請檢查單位、方向及輪件。': 'The measured diameter or spacing is outside the supported range. Check the units, axes and selected parts.',
  '已按左右輪件的外框更新直徑、中心距及輪軸位置。': 'Wheel diameter, spacing and axle position were updated from the selected wheel bounds.',
  '正在套用模型…': 'Applying model…', '無法套用模型。': 'Could not apply the model.',
};
registerTranslations(MODEL_TEXT);
const modelText = text => t(text, MODEL_TEXT[text] ?? text);
const modelInfo = source => source.name + ' · ' + source.parts.length +
  t(' 個網格', source.parts.length === 1 ? ' mesh' : ' meshes');

const FILE_LIMIT = 64 * 1024 * 1024;
const TRIANGLE_LIMIT = 1_500_000;
const axes = ['+X', '-X', '+Y', '-Y', '+Z', '-Z'];
const measures = [
  ['wheelRadius', '車輪直徑', 2000],
  ['halfAxle', '左右輪中心距', 2000],
  ['sensorForward', '輪軸至感測器前距', 1000],
  ['sensorPitch', '感測器間距', 1000],
];
const savedSources = new WeakMap();

// Runs inside a cancellable, local classic worker. Transfer mesh buffers rather
// than copying the large nested arrays produced by OpenCascade onto the UI thread.
function readStepInWorker() {
  self.onmessage = async ({ data }) => {
    try {
      const engine = await self.occtimportjs({ locateFile: () => data.wasm });
      const result = engine.ReadStepFile(new Uint8Array(data.buffer), {
        linearUnit: 'millimeter', linearDeflectionType: 'bounding_box_ratio', linearDeflection: 0.003, angularDeflection: 0.5,
      });
      if (!result.success || !result.meshes?.length) throw new Error('未能從 STEP 讀取實體，請確認檔案包含可顯示的零件。');
      const parts = [];
      const transfers = [];
      const originalToPart = new Map();
      let triangles = 0;
      for (const [originalId, m] of result.meshes.entries()) {
        const coords = m.attributes?.position?.array;
        const index = m.index?.array;
        if (!coords?.length || !index?.length) continue;
        triangles += index.length / 3;
        if (triangles > data.limit) throw new Error('模型面數過多，請先在 CAD 軟件簡化零件，再重新匯出。');
        const positions = new Float32Array(coords);
        const indices = new Uint32Array(index);
        const normals = m.attributes.normal?.array?.length === coords.length ? new Float32Array(m.attributes.normal.array) : null;
        const color = Array.isArray(m.color)
          ? '#' + m.color.slice(0, 3).map(c => Math.round(Math.max(0, Math.min(1, c)) * 255).toString(16).padStart(2, '0')).join('')
          : '#a5b7c3';
        originalToPart.set(originalId, parts.length);
        parts.push({ name: m.name || '', color, positions, indices, normals });
        transfers.push(positions.buffer, indices.buffer);
        if (normals) transfers.push(normals.buffer);
      }
      const groups = [];
      function collect(node) {
        const ids = (node.meshes || []).map(i => originalToPart.get(i)).filter(i => i !== undefined);
        for (const child of node.children || []) ids.push(...collect(child));
        const unique = [...new Set(ids)];
        if (node.name && unique.length && (unique.length < parts.length || !node.children?.length)) {
          groups.push({ name: node.name, ids: unique });
          for (const i of unique) if (!parts[i].name) parts[i].name = node.name;
        }
        return unique;
      }
      if (result.root) collect(result.root);
      self.postMessage({ parts, groups }, transfers);
    } catch (error) {
      self.postMessage({ error: error.message || 'STEP 解析失敗。' });
    }
  };
}

async function parseStep(buffer, signal) {
  const [glue, wasm] = await Promise.all([
    import('occt-import-js/dist/occt-import-js.js?raw'),
    import('occt-import-js/dist/occt-import-js.wasm?url'),
  ]);
  signal.throwIfAborted();
  const script = new Blob([glue.default, '\n;', '(', readStepInWorker.toString(), ')();'], { type: 'text/javascript' });
  const blobURL = URL.createObjectURL(script);
  let worker;
  try {
    worker = new Worker(blobURL);
    return await new Promise((resolve, reject) => {
      const abort = () => reject(new DOMException('Cancelled', 'AbortError'));
      signal.addEventListener('abort', abort, { once: true });
      worker.onmessage = ({ data }) => {
        signal.removeEventListener('abort', abort);
        if (data.error) reject(new Error(data.error));
        else resolve(data);
      };
      worker.onerror = () => {
        signal.removeEventListener('abort', abort);
        reject(new Error('STEP 轉換器未能載入或記憶體不足，請重新選擇檔案。'));
      };
      worker.postMessage({ buffer, wasm: new URL(wasm.default, document.baseURI).href, limit: TRIANGLE_LIMIT }, [buffer]);
    });
  } finally {
    worker?.terminate();
    URL.revokeObjectURL(blobURL);
  }
}

async function readFile(file, signal) {
  if (!file.size || file.size > FILE_LIMIT) throw new Error('請選擇非空白並小於或等於 64 MiB 的檔案。');
  const type = file.name.split('.').pop().toLowerCase();
  if (!['stp', 'step', 'stl'].includes(type)) throw new Error('請選擇 STEP、STP 或 STL 檔案。');
  const buffer = await file.arrayBuffer();
  signal.throwIfAborted();
  let parts, groups = [];
  if (type === 'stl') {
    const bytes = new DataView(buffer);
    const count = buffer.byteLength >= 84 ? bytes.getUint32(80, true) : 0;
    const binary = buffer.byteLength >= 84 && count * 50 + 84 === buffer.byteLength;
    if (binary && count > TRIANGLE_LIMIT) throw new Error('STL 面數過多，請先簡化網格。');
    if (!binary && !/^\s*solid\b/i.test(new TextDecoder().decode(buffer.slice(0, 160)))) throw new Error('STL 檔案的標頭或長度不完整。');
    const { STLLoader } = await import('three/addons/loaders/STLLoader.js');
    const geometry = new STLLoader().parse(buffer);
    const positions = geometry.getAttribute('position')?.array;
    if (!positions?.length || positions.length / 9 > TRIANGLE_LIMIT) throw new Error('STL 沒有可用的三角面，或模型面數過多。');
    parts = [{ name: file.name, color: '#a5b7c3', positions, normals: geometry.getAttribute('normal')?.array }];
    geometry.dispose();
  } else {
    ({ parts, groups } = await parseStep(buffer, signal));
  }
  signal.throwIfAborted();
  if (!parts.length) throw new Error('檔案沒有可顯示的零件。');
  const bounds = new THREE.Box3();
  for (const [i, part] of parts.entries()) {
    if (!part.name) { part.generatedNumber = i + 1; part.name = 'Part ' + (i + 1); }
    const position = new THREE.BufferAttribute(part.positions, 3);
    part.bounds = new THREE.Box3().setFromBufferAttribute(position);
    if (![...part.bounds.min.toArray(), ...part.bounds.max.toArray()].every(Number.isFinite)) {
      throw new Error('零件坐標包含無效數值。');
    }
    if (part.indices?.some(index => index >= position.count)) throw new Error('零件含有無效的網格索引。');
    bounds.union(part.bounds);
  }
  if (bounds.getSize(new THREE.Vector3()).length() === 0) throw new Error('模型尺寸為零。');
  const covered = new Set(groups.flatMap(g => g.ids));
  parts.forEach((part, i) => {
    if (!covered.has(i)) groups.push({ name: part.name, ids: [i], generatedNumber: part.generatedNumber });
  });
  for (const g of groups) {
    g.bounds = new THREE.Box3();
    for (const i of g.ids) g.bounds.union(parts[i].bounds);
  }
  return { name: file.name, type, parts, groups, bounds };
}

function axisVector(key) {
  const axis = new THREE.Vector3();
  axis.setComponent('XYZ'.indexOf(key[1]), key[0] === '-' ? -1 : 1);
  return axis;
}

function coordinates(source, form) {
  const up = axisVector(form.up);
  const forward = axisVector(form.forward);
  const right = new THREE.Vector3().crossVectors(forward, up);
  const matrix = new THREE.Matrix4().set(
    ...right.toArray(), 0, ...forward.toArray(), 0, ...up.toArray(), 0, 0, 0, 0, 1,
  );
  const unit = source.type === 'stl' ? Number(form.unit) : 0.001;
  matrix.scale(new THREE.Vector3(unit, unit, unit));
  const box = source.bounds.clone().applyMatrix4(matrix);
  let centerX = (box.max.x + box.min.x) / 2;
  if (form.left !== '' && form.right !== '') {
    const centers = [form.left, form.right].map(id => source.groups[Number(id)].bounds.getCenter(new THREE.Vector3()).applyMatrix4(matrix));
    centerX = (centers[0].x + centers[1].x) / 2;
  }
  matrix.setPosition(-centerX, -(box.min.y + (box.max.y - box.min.y) * form.axle / 100), -box.min.z);
  return { matrix, box, size: box.getSize(new THREE.Vector3()) };
}

function compile(source, form) {
  const { matrix } = coordinates(source, form);
  const normalMatrix = new THREE.Matrix3().getNormalMatrix(matrix);
  const left = new Set(source.groups[Number(form.left)]?.ids);
  const right = new Set(source.groups[Number(form.right)]?.ids);
  if (form.left === '') left.clear();
  if (form.right === '') right.clear();
  const parts = source.parts.map((part, i) => {
    const positions = new THREE.BufferAttribute(part.positions.slice(), 3).applyMatrix4(matrix).array;
    const normals = part.normals?.length ? new THREE.BufferAttribute(part.normals.slice(), 3).applyNormalMatrix(normalMatrix).array : undefined;
    const group = left.has(i) ? 'leftWheel' : right.has(i) ? 'rightWheel' : 'chassis';
    return { name: part.name, color: part.color, group, positions, normals, indices: part.indices };
  });
  const physical = Object.fromEntries(measures.map(([key, , mm]) => [key, form[key] / mm]));
  return { kind: 'custom', name: source.name, parts, physical };
}

function defaults() {
  return {
    up: '+Z', forward: '+Y', unit: '0.001', axle: 35, left: '', right: '',
    ...Object.fromEntries(measures.map(([key, , mm]) => [key, +(DEFAULT_PHYSICAL[key] * mm).toFixed(2)])),
  };
}

function makePreview(container) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(36, 1, 0.001, 100);
  camera.up.set(0, 0, 1);
  const controls = new OrbitControls(camera, renderer.domElement);
  const visual = new THREE.Group();
  visual.matrixAutoUpdate = false;
  const guide = new THREE.Group();
  scene.add(visual, guide, new THREE.HemisphereLight(0xffffff, 0x647482, 2.6));
  const light = new THREE.DirectionalLight(0xffe9ce, 2.4);
  light.position.set(1, -2, 3);
  scene.add(light);
  container.append(renderer.domElement);
  const render = () => renderer.render(scene, camera);
  controls.addEventListener('change', render);
  const resize = () => {
    if (!container.clientWidth || !container.clientHeight) return;
    renderer.setSize(container.clientWidth, container.clientHeight, false);
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    render();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(container);
  const materials = new Map();
  const guideMaterials = [new THREE.LineBasicMaterial(), new THREE.LineBasicMaterial()];
  const [axleGuide, sensorGuide] = guideMaterials;
  for (const material of guideMaterials) material.depthTest = false;
  function updateGuideColors() {
    const style = getComputedStyle(container);
    axleGuide.color.setStyle(style.getPropertyValue('--accent').trim());
    sensorGuide.color.setStyle(style.getPropertyValue('--warning').trim());
    render();
  }
  updateGuideColors();
  document.addEventListener('themechange', updateGuideColors);
  function clearGroup(group) {
    for (const child of [...group.children]) {
      group.remove(child);
      child.geometry?.dispose();
    }
  }
  function line(points, material) {
    const mesh = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points.map(p => new THREE.Vector3(...p))),
      material);
    mesh.renderOrder = 2;
    guide.add(mesh);
  }
  resize();
  return {
    load(source) {
      clearGroup(visual);
      for (const p of source.parts) {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(p.positions, 3));
        if (p.indices) g.setIndex(new THREE.BufferAttribute(p.indices, 1));
        if (p.normals) g.setAttribute('normal', new THREE.BufferAttribute(p.normals, 3));
        else g.computeVertexNormals();
        if (!materials.has(p.color)) materials.set(p.color, new THREE.MeshStandardMaterial({ color: p.color, roughness: .72, side: THREE.DoubleSide }));
        visual.add(new THREE.Mesh(g, materials.get(p.color)));
      }
    },
    update(source, form, fit) {
      const { matrix, size } = coordinates(source, form);
      visual.matrix.copy(matrix);
      visual.matrixWorldNeedsUpdate = true;
      clearGroup(guide);
      const half = form.halfAxle / 2000, radius = form.wheelRadius / 2000;
      const sensor = form.sensorForward / 1000, pitch = form.sensorPitch / 1000;
      line([[-half, 0, radius], [half, 0, radius]], axleGuide);
      for (const x of [-half, half]) {
        const ring = Array.from({ length: 49 }, (_, i) => [x, radius * Math.cos(Math.PI * i / 24), radius * (1 + Math.sin(Math.PI * i / 24))]);
        line(ring, axleGuide);
      }
      line([[-3.5 * pitch, sensor, .01], [3.5 * pitch, sensor, .01]], sensorGuide);
      const tip = sensor + Math.max(size.y * .15, .018);
      line([[0, sensor, .01], [0, tip, .01]], sensorGuide);
      line([[-pitch * .7, tip - pitch, .01], [0, tip, .01], [pitch * .7, tip - pitch, .01]], sensorGuide);
      if (fit) {
        const bounds = source.bounds.clone().applyMatrix4(matrix);
        bounds.expandByPoint(new THREE.Vector3(-half, -radius, 0));
        bounds.expandByPoint(new THREE.Vector3(half, tip, 2 * radius));
        const c = bounds.getCenter(new THREE.Vector3());
        const distance = bounds.getSize(new THREE.Vector3()).length() * 1.7 / Math.min(camera.aspect, 1);
        camera.near = Math.max(.00001, distance * .001);
        camera.far = distance * 30;
        camera.position.copy(c).add(new THREE.Vector3(.95, .95, .72).normalize().multiplyScalar(distance));
        camera.updateProjectionMatrix();
        controls.target.copy(c);
        controls.update();
      }
      render();
      return size;
    },
    dispose() {
      observer.disconnect(); controls.dispose(); clearGroup(visual); clearGroup(guide);
      document.removeEventListener('themechange', updateGuideColors);
      for (const m of [...materials.values(), ...guideMaterials]) m.dispose();
      renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove();
    },
  };
}

export function setupModelImporter({ onApply, getCurrentModel }) {
  const dialog = document.createElement('dialog');
  dialog.className = 'model-import-dialog';
  dialog.setAttribute('aria-labelledby', 'model-import-title');
  dialog.innerHTML = `
    <form class="mi-form">
      <header class="mi-head"><h2 id="model-import-title">匯入車身模型</h2>${languagePickerHtml()}<button type="button" data-close aria-label="關閉模型匯入">關閉</button></header>
      <div class="mi-scroll">
        <div class="mi-file"><button type="button" data-browse>選擇車身檔案</button><input type="file" accept=".step,.stp,.stl" data-file hidden></div>
        <p class="mi-help">支援 STEP、STP 及 STL，每個檔案最多 64 MiB。檔案只會在這部裝置處理。</p>
        <p class="mi-status" role="status" data-status data-no-i18n></p>
        <div data-config hidden>
          <div class="mi-preview" data-preview role="img" aria-label="模型方向、輪軸及感測器位置預覽"></div>
          <p class="mi-legend"><span>圓圈及橫線標示車輪與輪軸</span><span>感測器橫列及車頭方向箭咀</span></p>
          <p class="mi-dimensions" data-dimensions></p>
          <fieldset><legend>方向及輪軸</legend><div class="mi-fields">
            <label>車頂方向<select data-field="up"></select></label>
            <label>車頭方向<select data-field="forward"></select></label>
            <label data-unit-wrap>STL 原始單位<select data-field="unit"><option value="0.001">毫米</option><option value="0.01">厘米</option><option value="1">米</option><option value="0.0254">英寸</option></select></label>
            <label>輪軸距車尾（車長 %）<input data-field="axle" type="number" min="0" max="100" step="any" required></label>
          </div></fieldset>
          <fieldset><legend>循線車尺寸 <small>mm</small></legend><div class="mi-fields" data-measures></div></fieldset>
          <fieldset><legend>可轉動輪件</legend><p class="mi-help">多零件模型可選擇左右車輪。一體式模型可保持固定外觀，車輪運動仍按上方尺寸計算。</p><div class="mi-fields">
            <label>左輪組件<select data-field="left"></select></label><label>右輪組件<select data-field="right"></select></label>
          </div><button type="button" data-measure>按已選輪件量度輪軸</button></fieldset>
        </div>
      </div>
      <footer class="mi-foot"><button type="button" data-cancel>取消</button><button type="submit" data-apply disabled>套用車身模型</button></footer>
    </form>`;
  document.body.append(dialog);
  const el = attr => dialog.querySelector('[data-' + attr + ']');
  let opener;
  const fields = {};
  for (const [key, label, factor] of measures) {
    const wrap = document.createElement('label');
    wrap.textContent = label;
    const input = document.createElement('input');
    input.type = 'number'; input.step = 'any'; input.required = true; input.dataset.field = key;
    input.min = String(+(PHYSICAL_LIMITS[key][0] * factor).toFixed(4));
    input.max = String(+(PHYSICAL_LIMITS[key][1] * factor).toFixed(4));
    wrap.append(input);
    el('measures').append(wrap);
  }
  for (const f of dialog.querySelectorAll('[data-field]')) fields[f.dataset.field] = f;
  for (const axis of axes) fields.up.add(new Option(axis, axis));
  let source = null;
  let values = defaults();
  let preview;
  let job;
  let working = false;
  let applying = false;
  let generation = 0;
  let statusText = () => '';
  const status = (text, error = false) => {
    statusText = typeof text === 'function' ? text : () => modelText(text);
    el('status').textContent = statusText();
    el('status').dataset.error = String(error);
  };
  function buttons() {
    el('apply').disabled = !source || working || applying;
    el('file').disabled = applying;
    el('browse').disabled = applying;
    el('close').disabled = applying;
    el('cancel').disabled = applying;
    el('measure').disabled = values.left === '' || values.right === '' || values.left === values.right;
  }
  function directions() {
    const choices = axes.filter(axis => axis[1] !== values.up[1]);
    if (!choices.includes(values.forward)) values.forward = choices.find(a => a[0] === '+' && a !== '+X') || choices[0];
    fields.forward.replaceChildren(...choices.map(s => new Option(s, s)));
    fields.forward.value = values.forward;
  }
  function wheelOptions() {
    for (const side of ['left', 'right']) {
      fields[side].replaceChildren(new Option('固定外觀', ''));
      source.groups.forEach(({ name, ids, generatedNumber }, i) => {
        const shown = generatedNumber ? t('零件 ', 'Part ') + generatedNumber : name;
        const option = new Option(shown + ' · ' + ids.length + t(' 件', ids.length === 1 ? ' part' : ' parts'), String(i));
        option.setAttribute('data-no-i18n', '');
        fields[side].add(option);
      });
      fields[side].value = values[side];
    }
  }
  function setFields() {
    directions();
    wheelOptions();
    for (const [key, f] of Object.entries(fields)) f.value = String(values[key]);
    el('unit-wrap').hidden = source.type !== 'stl';
  }
  function dimensions() {
    const { size } = coordinates(source, values);
    const [w, l, h] = size.toArray().map(v => Number((v * 1000).toFixed(1)));
    el('dimensions').textContent = t(`模型尺寸　闊 ${w} × 長 ${l} × 高 ${h} mm`, `Model dimensions　W ${w} × L ${l} × H ${h} mm`);
  }
  function redraw(fit = false) {
    if (!source) return;
    dimensions();
    preview?.update(source, values, fit);
    buttons();
  }
  function display(newSource, newValues) {
    source = newSource; values = { ...newValues };
    el('config').hidden = false;
    setFields();
    if (!preview) preview = makePreview(el('preview'));
    preview.load(source);
    redraw(true);
  }
  function stopJob() {
    generation++;
    job?.abort();
    job = null;
    working = false;
  }
  el('browse').addEventListener('click', () => el('file').click());
  el('file').addEventListener('change', async () => {
    const file = el('file').files[0];
    if (!file) return;
    stopJob();
    const token = generation;
    job = new AbortController();
    working = true;
    buttons();
    status(() => t('正在讀取 ', 'Reading ') + file.name + '…');
    try {
      const parsed = await readFile(file, job.signal);
      if (token !== generation) return;
      display(parsed, defaults());
      status(() => modelInfo(parsed));
    } catch (error) {
      if (token !== generation) return;
      status(MODEL_TEXT[error.message] ? error.message : '無法解析檔案。', true);
    } finally {
      if (token === generation) {
        working = false;
        el('file').value = '';
        buttons();
      }
    }
  });
  for (const [key, field] of Object.entries(fields)) {
    field.addEventListener('input', () => {
      if (!source || !field.validity.valid) return;
      values[key] = field.type === 'number' ? field.valueAsNumber : field.value;
      if (key === 'up') directions();
      redraw(['up', 'forward', 'unit'].includes(key));
    });
  }
  function pairedWheels() {
    if (values.left === '' || values.right === '') return null;
    const l = source.groups[Number(values.left)], r = source.groups[Number(values.right)];
    const ids = new Set(l.ids);
    if (r.ids.some(i => ids.has(i))) throw new Error('左右輪須選用兩組獨立零件。');
    return [l, r];
  }
  el('measure').addEventListener('click', () => {
    try {
      const groups = pairedWheels();
      const { matrix, size } = coordinates(source, values);
      const [l, r] = groups.map(g => g.bounds.clone().applyMatrix4(matrix));
      const center = b => b.getCenter(new THREE.Vector3());
      const lc = center(l), rc = center(r);
      if (lc.x >= rc.x) throw new Error('按目前的車頭方向，左輪應在右輪左側。請檢查方向與輪件。');
      const diameter = ((l.max.z - l.min.z) + (r.max.z - r.min.z)) * 500;
      const track = (rc.x - lc.x) * 1000;
      if (diameter < +fields.wheelRadius.min || diameter > +fields.wheelRadius.max || track < +fields.halfAxle.min || track > +fields.halfAxle.max) {
        throw new Error('量得的輪徑或輪距超出支援範圍。請檢查單位、方向及輪件。');
      }
      const axle = Math.max(0, Math.min(100, values.axle + 50 * (lc.y + rc.y) / size.y));
      values.wheelRadius = +diameter.toFixed(2); values.halfAxle = +track.toFixed(2); values.axle = +axle.toFixed(2);
      for (const key of ['wheelRadius', 'halfAxle', 'axle']) fields[key].value = values[key];
      redraw(true);
      status('已按左右輪件的外框更新直徑、中心距及輪軸位置。');
    } catch (error) { status(error.message, true); }
  });
  dialog.querySelector('form').addEventListener('submit', async event => {
    event.preventDefault();
    if (!source || working || applying) return;
    try {
      pairedWheels();
      applying = true; buttons(); status('正在套用模型…');
      await new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
      const model = compile(source, values);
      await onApply(model);
      savedSources.set(model, { source, values: { ...values } });
      dialog.close();
    } catch (error) {
      status(MODEL_TEXT[error.message] ? error.message : '無法套用模型。', true);
    } finally { applying = false; buttons(); }
  });
  const close = () => { if (!applying) dialog.close(); };
  el('cancel').addEventListener('click', close);
  el('close').addEventListener('click', close);
  dialog.addEventListener('cancel', event => { if (applying) event.preventDefault(); });
  dialog.addEventListener('close', () => {
    stopJob(); preview?.dispose(); preview = null; source = null;
    el('config').hidden = true;
    if (opener?.isConnected) opener.focus({ preventScroll: true });
    opener = null;
  });
  const unsubscribe = onLanguageChange(() => {
    if (!dialog.open) return;
    el('status').textContent = statusText();
    if (source) { wheelOptions(); dimensions(); }
  });
  return {
    open(trigger = document.activeElement) {
      if (dialog.open) return;
      opener = trigger;
      dialog.showModal();
      const retained = savedSources.get(getCurrentModel?.());
      if (retained) {
        display(retained.source, retained.values);
        status(() => modelInfo(retained.source));
      } else {
        source = null; values = defaults();
        el('config').hidden = true; status('');
      }
      buttons();
    },
    dispose() {
      unsubscribe();
      stopJob(); if (dialog.open) dialog.close(); preview?.dispose(); preview = null; dialog.remove();
    },
  };
}
