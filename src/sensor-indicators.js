import * as THREE from 'three';

const PITCH = 0.0115;
const STOCK_ROW = new THREE.Vector3(0, 0.1659, 0.01975);
const channelX = index => (index - 3.5) * PITCH;
const near = (value, target, tolerance = 0.00025) => Math.abs(value - target) < tolerance;

function matchesOptics(parts, board) {
  // Require the circumference of every barrel in all four quadrants. Its
  // lower rim is 9.6 mm below the top copper/laminate face.
  const quadrants = new Uint8Array(16);
  let complete = 0;
  for (const {positions} of parts) {
    for (let j = 0; j < positions.length; j += 3) {
      if (!near(positions[j + 2], board.top - 0.0096)) continue;
      const x = positions[j] - board.x;
      const index = Math.round(x / PITCH + 3.5);
      if (index < 0 || index > 7) continue;
      const y = board.front - positions[j + 1];
      const row = y < 0.0084 ? 0 : 1;
      const k = row * 8 + index;
      if (quadrants[k] === 15) continue;
      const dx = x - channelX(index), dy = y - (row ? 0.0122 : 0.0046);
      if (!near(Math.hypot(dx, dy), 0.0029, 0.00035)) continue;
      quadrants[k] |= 1 << (Number(dx > 0) + 2 * Number(dy > 0));
      if (quadrants[k] === 15 && ++complete === 16) return true;
    }
  }
  return false;
}

// STL has no assembly names. Use the actual long straight front/rear PCB
// edges, on both faces, before considering the optical pattern. Cap stored
// candidates so even an unrelated repetitive mesh has bounded memory/work.
function flattenedBoards(part) {
  const {positions, indices} = part;
  const front = [], rear = [];
  const count = indices?.length || positions.length / 3;
  function edge(a, b) {
    const width = Math.abs(positions[a] - positions[b]);
    const list = near(width, .084) ? front : near(width, .074) ? rear : null;
    if (!list || !near(positions[a + 1], positions[b + 1]) || !near(positions[a + 2], positions[b + 2])) return;
    const x = (positions[a] + positions[b]) / 2, y = positions[a + 1], z = positions[a + 2];
    if (!list.some(e => near(e.x, x) && near(e.y, y) && near(e.z, z))) list.push({x, y, z});
  }
  for (let j = 0; j + 2 < count; j += 3) {
    const a = 3 * (indices?.[j] ?? j);
    const b = 3 * (indices?.[j + 1] ?? j + 1);
    const c = 3 * (indices?.[j + 2] ?? j + 2);
    edge(a, b); edge(b, c); edge(c, a);
    if (front.length + rear.length > 128) return [];
  }
  const has = (list, x, y, z) => list.some(e => near(e.x, x) && near(e.y, y) && near(e.z, z));
  return front.filter(({x, y, z}) => has(front, x, y, z - .0016) &&
    has(rear, x, y - .033, z) && has(rear, x, y - .033, z - .0016))
    .map(({x, y, z}) => ({x, front: y, top: z}));
}

// The STEP importer may split one body into separate B-rep faces. Identify
// the PCB by its 90 × 33 mm outline and both rows of eight optics below it.
// Placement then follows the imported board, including an edited axle origin.
function findImportedRow(model) {
  let parts = (model.parts ?? []).filter(part => part.group === 'chassis' &&
    /^line_follower(?::\d+)?$/i.test(part.name) && part.positions?.length);
  const boards = [];
  for (const part of parts) {
    const box = new THREE.Box3().setFromArray(part.positions);
    const size = box.getSize(new THREE.Vector3());
    if (near(size.x, 0.090) && near(size.y, 0.033) && (near(size.z, 0) || near(size.z, 0.0016))) {
      boards.push({ x: (box.min.x + box.max.x) / 2, front: box.max.y, top: box.max.z });
    }
  }
  if (!boards.length && model.parts?.length === 1 && model.parts[0].group === 'chassis' && model.parts[0].positions?.length) {
    parts = model.parts;
    const candidates = flattenedBoards(parts[0]);
    if (candidates.length !== 1) return null;
    boards.push(candidates[0]);
  }
  for (const board of boards) {
    if (matchesOptics(parts, board)) return new THREE.Vector3(board.x, board.front - 0.0013, board.top);
  }
  return null;
}

const glyphs = {
  S: [15, 16, 16, 14, 1, 1, 30], 1: [4, 12, 4, 4, 4, 4, 14],
  2: [14, 17, 1, 2, 4, 8, 31], 3: [30, 1, 1, 14, 1, 1, 30],
  4: [2, 6, 10, 18, 31, 2, 2], 5: [31, 16, 16, 30, 1, 1, 30],
  6: [14, 16, 16, 30, 17, 17, 14], 7: [31, 1, 2, 4, 8, 8, 8],
  8: [14, 17, 17, 14, 17, 17, 14],
};

function channelLabels() {
  // A single silkscreen strip contains both channel orders. UV offset selects
  // the matching row without mirroring the lettering or creating 8 textures.
  const cell = 22, width = 8 * cell, height = 18;
  const pixels = new Uint8Array(width * height * 4);
  for (let order = 0; order < 2; order++) {
    for (let i = 0; i < 8; i++) {
      const label = 'S' + (order ? 8 - i : i + 1);
      for (let c = 0; c < 2; c++) {
        glyphs[label[c]].forEach((bits, row) => {
          for (let x = 0; x < 5; x++) {
            if (!(bits & (16 >> x))) continue;
            const ix = i * cell + 5 + c * 6 + x;
            const iy = order * 9 + 7 - row;
            pixels.fill(255, (iy * width + ix) * 4, (iy * width + ix) * 4 + 4);
          }
        });
      }
    }
  }
  const map = new THREE.DataTexture(pixels, width, height);
  map.minFilter = map.magFilter = THREE.LinearFilter;
  map.repeat.y = 0.5;
  map.needsUpdate = true;
  const material = new THREE.MeshBasicMaterial({color: '#e0edf0', map, transparent: true, depthWrite: false});
  const labels = new THREE.Mesh(new THREE.PlaneGeometry(8 * PITCH, 0.0044), material);
  labels.name = 'sensor-channel-labels';
  labels.position.set(0, -0.0045, 0.00008);
  return labels;
}

function packageRow(name, width, depth, height, centreZ, material) {
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(width, depth, height), material, 8);
  mesh.name = name;
  const matrix = new THREE.Matrix4();
  for (let i = 0; i < 8; i++) mesh.setMatrixAt(i, matrix.makeTranslation(channelX(i), 0, centreZ));
  return mesh;
}

const OFF = new THREE.Color('#263a42');
const LIT_EDGE = new THREE.Color('#55f1db');
const LIT_CORE = new THREE.Color('#eefff8');
const indicatorRows = new WeakMap();

export function createSensorIndicators(vehicleModel = null) {
  const row = vehicleModel ? findImportedRow(vehicleModel) : STOCK_ROW;
  if (!row) return null;
  const group = new THREE.Group();
  group.name = 'line-sensor-indicators';
  group.position.copy(row);
  const cases = packageRow('sensor-led-cases', 0.0043, 0.00235, 0.00045, 0.000225,
    new THREE.MeshStandardMaterial({color: '#79888b', metalness: 0.25, roughness: 0.65}));
  const windows = packageRow('sensor-led-windows', 0.00345, 0.00195, 0.00032, 0.00061,
    new THREE.MeshBasicMaterial({toneMapped: false}));
  const cores = packageRow('sensor-led-cores', 0.0024, 0.0012, 0.00005, 0.000795,
    new THREE.MeshBasicMaterial({toneMapped: false}));
  const labels = channelLabels();
  group.add(cases, windows, cores, labels);
  indicatorRows.set(group, {windows, cores, labels, mask: -1});
  updateSensorIndicators(group, null);
  return group;
}

export function updateSensorIndicators(group, sensors, sensorOrder = 's1-left') {
  if (!group) return;
  const data = indicatorRows.get(group);
  const reversed = sensorOrder === 's8-left';
  data.labels.material.map.offset.y = reversed ? 0.5 : 0;
  let mask = 0;
  for (let i = 0; i < 8; i++) if (sensors?.[reversed ? 7 - i : i]) mask |= 1 << i;
  if (mask === data.mask) return;
  data.mask = mask;
  for (let i = 0; i < 8; i++) {
    const on = mask & (1 << i);
    data.windows.setColorAt(i, on ? LIT_EDGE : OFF);
    data.cores.setColorAt(i, on ? LIT_CORE : OFF);
  }
  data.windows.instanceColor.needsUpdate = true;
  data.cores.instanceColor.needsUpdate = true;
}
