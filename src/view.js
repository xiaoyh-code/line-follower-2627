import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { createSensorIndicators, updateSensorIndicators } from './sensor-indicators.js';

const AXLE_HALF_WIDTH = 0.09065;
const AXLE_HEIGHT = 0.034;
const COLOR = {
  desk: '#151e2b',
  deskGrid: '#243146',
  mat: '#253247',
  matEdge: '#182337',
  matGrid: '#35465e',
  ruler: '#94a4ba',
  lane: '#f2f4f8',
  tape: '#19191c',
  startMark: '#e30c1a',
};

const LIGHT_COLOR = {
  ...COLOR,
  desk: '#dce3ef', deskGrid: '#c8d3e2', mat: '#b9c7da', matEdge: '#8c9eb7',
  matGrid: '#cad5e5', ruler: '#657790',
};

function sceneColour(material, name) {
  if (Object.hasOwn(COLOR, name)) material.userData.paletteRole = name;
  return material;
}

function flatMesh(geometry, color, z = 0) {
  const material = sceneColour(new THREE.MeshBasicMaterial({ color: COLOR[color] ?? color, side: THREE.DoubleSide }), color);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.z = z;
  return mesh;
}

function lineSegments(points, color, z) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
  const lines = new THREE.LineSegments(geometry, sceneColour(new THREE.LineBasicMaterial({ color: COLOR[color] ?? color }), color));
  lines.position.z = z;
  return lines;
}

function ribbon(points, width) {
  const positions = [];
  const indices = [];
  const count = points.length;
  for (let i = 0; i < count; i++) {
    const prev = points[(i + count - 1) % count];
    const next = points[(i + 1) % count];
    const dx = next.x - prev.x;
    const dy = next.y - prev.y;
    const halfWidth = width / (2 * Math.hypot(dx, dy));
    const nx = -dy * halfWidth;
    const ny = dx * halfWidth;
    positions.push(points[i].x + nx, points[i].y + ny, 0, points[i].x - nx, points[i].y - ny, 0);
    const a = 2 * i;
    const b = 2 * ((i + 1) % count);
    indices.push(a, a + 1, b, b, a + 1, b + 1);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function roundedRect(width, height, radius) {
  const x = width / 2;
  const y = height / 2;
  const shape = new THREE.Shape();
  shape.moveTo(-x + radius, -y);
  shape.lineTo(x - radius, -y);
  shape.quadraticCurveTo(x, -y, x, -y + radius);
  shape.lineTo(x, y - radius);
  shape.quadraticCurveTo(x, y, x - radius, y);
  shape.lineTo(-x + radius, y);
  shape.quadraticCurveTo(-x, y, -x, y - radius);
  shape.lineTo(-x, -y + radius);
  shape.quadraticCurveTo(-x, -y, -x + radius, -y);
  return shape;
}

function addDesk(scene) {
  const desk = flatMesh(new THREE.PlaneGeometry(40, 40), 'desk', -0.030);
  scene.add(desk);
  const grid = [];
  for (let i = -8; i <= 8; i += 0.25) {
    grid.push(i, -8, 0, i, 8, 0, -8, i, 0, 8, i, 0);
  }
  scene.add(lineSegments(grid, 'deskGrid', -0.029));
}

// Use the exact same ink cells as the eight probes. Texture rows for the
// bottom-left UV origin run in the opposite direction to image rows.
function makeMapSurface(course) {
  const {width, height, mask, physicalWidth, physicalHeight} = course;
  const pixels = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = ((height - 1 - y) * width + x) * 4;
      const ink = mask[y * width + x];
      pixels[offset] = ink ? 25 : 242;
      pixels[offset + 1] = ink ? 25 : 244;
      pixels[offset + 2] = ink ? 28 : 248;
      pixels[offset + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(pixels, width, height);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  const sheet = new THREE.Mesh(new THREE.PlaneGeometry(physicalWidth, physicalHeight),
    new THREE.MeshLambertMaterial({map: texture}));
  sheet.position.z = -0.0015;
  sheet.receiveShadow = true;
  return sheet;
}

function addCourse(scene, points, width, custom) {
  const bounds = new THREE.Box2();
  if (custom) {
    bounds.min.set(-custom.physicalWidth / 2, -custom.physicalHeight / 2);
    bounds.max.set(custom.physicalWidth / 2, custom.physicalHeight / 2);
    bounds.expandByScalar(0.055);
  } else {
    points.forEach(({x, y}) => bounds.expandByPoint(new THREE.Vector2(x, y)));
    bounds.expandByScalar(0.215);
  }
  const center = bounds.getCenter(new THREE.Vector2());
  const size = bounds.getSize(new THREE.Vector2());

  const shape = roundedRect(size.x, size.y, 0.052);
  const edge = flatMesh(new THREE.ExtrudeGeometry(shape, {depth: 0.020, bevelEnabled: false}), 'matEdge', -0.025);
  edge.position.set(center.x, center.y, -0.025);
  scene.add(edge);
  const mat = flatMesh(new THREE.ShapeGeometry(shape), 'mat', -0.0045);
  mat.position.set(center.x, center.y, -0.0045);
  scene.add(mat);

  const inset = 0.032;
  const xMin = bounds.min.x + inset;
  const xMax = bounds.max.x - inset;
  const yMin = bounds.min.y + inset;
  const yMax = bounds.max.y - inset;
  const tickMarks = [];
  const paperGrid = [];
  for (let i = Math.ceil(xMin * 10); i <= Math.floor(xMax * 10); i++) {
    const x = i / 10;
    const len = i % 5 === 0 ? 0.025 : 0.010;
    tickMarks.push(x, yMin, 0, x, yMin + len, 0, x, yMax, 0, x, yMax - len, 0);
    if (i % 2 === 0) paperGrid.push(x, yMin, 0, x, yMax, 0);
  }
  for (let i = Math.ceil(yMin * 10); i <= Math.floor(yMax * 10); i++) {
    const y = i / 10;
    const len = i % 5 === 0 ? 0.025 : 0.010;
    tickMarks.push(xMin, y, 0, xMin + len, y, 0, xMax, y, 0, xMax - len, y, 0);
    if (i % 2 === 0) paperGrid.push(xMin, y, 0, xMax, y, 0);
  }
  scene.add(lineSegments(paperGrid, 'matGrid', -0.004));
  scene.add(lineSegments(tickMarks, 'ruler', -0.0035));

  const laneWidth = Math.max(0.225, width * 7);
  if (custom) {
    scene.add(makeMapSurface(custom));
  } else {
    const lane = new THREE.Mesh(
      ribbon(points, laneWidth),
      sceneColour(new THREE.MeshLambertMaterial({color: COLOR.lane, side: THREE.DoubleSide}), 'lane'),
    );
    lane.position.z = -0.0015;
    lane.receiveShadow = true;
    scene.add(lane);
    scene.add(flatMesh(ribbon(points, width), 'tape', -0.0005));
  }

  const start = custom ? custom.startPose : points[0];
  const tangent = custom ? start.heading + Math.PI / 2 : Math.atan2(points[1].y - start.y, points[1].x - start.x);
  const marks = new THREE.Group();
  const probeOffset = custom ? custom.startSensorForward ?? 0.1588 : 0;
  marks.position.set(start.x + Math.cos(tangent) * probeOffset, start.y + Math.sin(tangent) * probeOffset, 0);
  marks.rotation.z = tangent;
  for (const side of [-1, 1]) {
    const marker = flatMesh(new THREE.PlaneGeometry(0.016, laneWidth * 0.32), 'startMark', 0.0001);
    marker.position.y = side * laneWidth * 0.34;
    marks.add(marker);
  }
  scene.add(marks);
  return {center, bounds};
}

function disposeMeshes(root) {
  const materials = new Set();
  root.traverse(object => {
    if (object.isInstancedMesh) object.dispose();
    object.geometry?.dispose();
    if (object.material) materials.add(object.material);
  });
  materials.forEach(material => {
    material.map?.dispose();
    material.dispose();
  });
}

function addLighting(scene, center) {
  const ambient = new THREE.HemisphereLight(0xffffff, 0x9caeb6, 1.5);
  ambient.position.set(0, 0, 1);
  scene.add(ambient);
  const key = new THREE.DirectionalLight(0xffffff, 2);
  key.position.set(center.x - 1.4, center.y - 2.2, 3.5);
  key.target.position.set(center.x, center.y, 0);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  Object.assign(key.shadow.camera, {left: -2, right: 2, top: 2, bottom: -2, near: 0.2, far: 9});
  key.shadow.normalBias = 0.0008;
  key.shadow.bias = -0.0001;
  scene.add(key, key.target);
  const fill = new THREE.DirectionalLight(0xc7e3f6, 1.1);
  fill.position.set(1, 1.3, 2);
  scene.add(fill);
  return {key, ambient, fill};
}

function createTrail(scene) {
  const capacity = 4096;
  // Each segment has its own colour on both ends. A loss boundary never
  // smears across a neighbouring tracked section as vertex colours interpolate.
  const positions = new THREE.BufferAttribute(new Float32Array(capacity * 12), 3).setUsage(THREE.DynamicDrawUsage);
  const colours = new THREE.BufferAttribute(new Float32Array(capacity * 12), 3).setUsage(THREE.DynamicDrawUsage);
  const indices = new Uint16Array(capacity * 6);
  for (let i = 0; i < capacity; i++) {
    const a = i * 4, start = i * 6;
    indices[start] = a; indices[start + 1] = a + 1; indices[start + 2] = a + 2;
    indices[start + 3] = a + 2; indices[start + 4] = a + 1; indices[start + 5] = a + 3;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', positions);
  geometry.setAttribute('color', colours);
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.setDrawRange(0, 0);
  const material = new THREE.MeshBasicMaterial({vertexColors: true, side: THREE.DoubleSide});
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.z = 0.0008;
  mesh.frustumCulled = false;
  scene.add(mesh);

  const tracked = new THREE.Color();
  const lost = new THREE.Color();
  const lostSegments = new Uint8Array(capacity);
  let count = 0, hasAnchor = false, anchorX = 0, anchorY = 0, anchorLossCount = 0;
  let lastNX = 0, lastNY = 0, sameLoss = false;

  function colourSegment(index) {
    const c = lostSegments[index] ? lost : tracked;
    for (let i = 4 * index; i < 4 * index + 4; i++) colours.setXYZ(i, c.r, c.g, c.b);
  }

  return {
    mesh,
    setColours(trackedColour, lostColour) {
      tracked.set(trackedColour);
      lost.set(lostColour);
      for (let i = 0; i < count; i++) colourSegment(i);
      colours.needsUpdate = true;
    },
    reset() {
      count = 0;
      hasAnchor = false;
      geometry.setDrawRange(0, 0);
    },
    add(state) {
      const {x, y, lineLost, lossCount} = state;
      if (hasAnchor) {
        // A counter change may represent one or more brief events between
        // samples. Mark only spans whose endpoints belong to the same loss.
        sameLoss = sameLoss && lineLost === true && lossCount === anchorLossCount;
        const dx = x - anchorX, dy = y - anchorY;
        const distance = Math.hypot(dx, dy);
        if (distance < 0.006) return;
        if (count === capacity) {
          positions.array.copyWithin(0, 256 * 12);
          colours.array.copyWithin(0, 256 * 12);
          lostSegments.copyWithin(0, 256);
          count -= 256;
        }
        const nx = -dy * 0.004 / distance, ny = dx * 0.004 / distance;
        if (!count) { lastNX = nx; lastNY = ny; }
        const i = count * 4;
        positions.setXYZ(i, anchorX + lastNX, anchorY + lastNY, 0);
        positions.setXYZ(i + 1, anchorX - lastNX, anchorY - lastNY, 0);
        positions.setXYZ(i + 2, x + nx, y + ny, 0);
        positions.setXYZ(i + 3, x - nx, y - ny, 0);
        lostSegments[count] = sameLoss;
        colourSegment(count);
        lastNX = nx; lastNY = ny;
        count++;
        positions.needsUpdate = colours.needsUpdate = true;
        geometry.setDrawRange(0, count * 6);
      }
      hasAnchor = true;
      anchorX = x; anchorY = y;
      anchorLossCount = lossCount;
      sameLoss = lineLost === true;
    },
  };
}

const GHOST_STYLES = {
  earlier: { width: 1.6, order: 1, opacity: 0.96, dashed: true },
  bestOutline: { width: 6, order: 2, opacity: 1, dashed: false },
  best: { width: 3.8, order: 3, opacity: 1, dashed: false },
  selected: { width: 2.1, order: 4, opacity: 1, dashed: false },
};

// Project real CAD vertices onto a small number of lateral sections. A
// translucent footprint keeps an imported assembly lightweight during replay.
function ghostFootprint(parts, bounds, physical) {
  const sections = Array.from({length: 32}, () => ({left: null, right: null}));
  const length = Math.max(0.001, bounds.max.y - bounds.min.y);
  for (const part of parts) {
    if (part.group !== 'chassis') continue;
    const vertices = part.positions;
    for (let i = 0; i < vertices.length; i += 3) {
      const x = vertices[i], y = vertices[i + 1];
      const index = Math.max(0, Math.min(31, Math.floor((y - bounds.min.y) / length * 32)));
      const section = sections[index];
      if (!section.left || x < section.left[0]) section.left = [x, y];
      if (!section.right || x > section.right[0]) section.right = [x, y];
    }
  }
  const valid = sections.filter(section => section.left);
  let hull = [...valid.map(section => section.right), ...valid.reverse().map(section => section.left)];
  if (hull.length < 3) {
    hull = [[bounds.min.x, bounds.min.y], [bounds.max.x, bounds.min.y],
      [bounds.max.x, bounds.max.y], [bounds.min.x, bounds.max.y]];
  }
  const radius = physical?.wheelRadius ?? AXLE_HEIGHT;
  const halfAxle = physical?.halfAxle ?? AXLE_HALF_WIDTH;
  const height = Math.max(radius * 0.4, Math.min(radius * 1.2, bounds.max.z * 0.55));
  const bottom = Math.min(0.006, height * 0.18);
  const top = height + bottom;
  const edges = [];
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i], b = hull[(i + 1) % hull.length];
    edges.push(...a, top, ...b, top);
  }
  // Wheel rectangles and a front chevron convey both axle and heading.
  for (const side of [-1, 1]) {
    const x = side * halfAxle;
    const w = Math.min(halfAxle * 0.12, radius * 0.30);
    const wheel = [[x - w, -radius], [x + w, -radius], [x + w, radius], [x - w, radius]];
    for (let i = 0; i < wheel.length; i++) {
      edges.push(...wheel[i], bottom, ...wheel[(i + 1) % wheel.length], bottom);
    }
  }
  const nose = bounds.max.y - length * 0.12;
  const tail = nose - length * 0.16;
  edges.push(-halfAxle * 0.27, tail, top, 0, nose, top, 0, nose, top, halfAxle * 0.27, tail, top);
  return {hull, edges, top, radius: Math.max(length / 2, halfAxle)};
}

function makeGhostBody(template, color) {
  const group = new THREE.Group();
  const shape = new THREE.Shape(template.hull.map(([x, y]) => new THREE.Vector2(x, y)));
  const body = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshBasicMaterial({
    color, transparent: true, opacity: 0.17, depthWrite: false, side: THREE.DoubleSide,
  }));
  body.position.z = template.top;
  const outline = lineSegments(template.edges, color, 0);
  outline.material.transparent = true;
  outline.material.opacity = 0.93;
  outline.material.depthWrite = false;
  outline.renderOrder = 4;
  group.add(body, outline);
  return group;
}

function createGhostHistory(scene, colours) {
  const layer = new THREE.Group();
  scene.add(layer);
  let moving = [];
  let footprint;
  const q = new THREE.Quaternion();

  function clear() {
    disposeMeshes(layer);
    layer.clear();
    moving = [];
  }

  function updatePose(time, replay, livePosition) {
    if (!layer.visible) return;
    for (let i = 0; i < moving.length; i++) {
      const {body, frames} = moving[i];
      // Across a manual run, a few fixed illustrations explain the prior
      // traces. In replay each ghost follows the same experiment clock.
      const t = replay ? time : frames[0].time + (frames.at(-1).time - frames[0].time) * (i + 1) / (moving.length + 1);
      let low = 0, high = frames.length - 1;
      while (low < high) {
        const mid = (low + high) >>> 1;
        if (frames[mid].time < t) low = mid + 1;
        else high = mid;
      }
      const b = frames[low], a = frames[Math.max(0, low - 1)];
      const f = b.time > a.time ? Math.max(0, Math.min(1, (t - a.time) / (b.time - a.time))) : 0;
      body.position.set(a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f, a.z + (b.z - a.z) * f);
      body.quaternion.fromArray(a.quaternion).slerp(q.fromArray(b.quaternion), f);
      const gap = Math.hypot(body.position.x - livePosition.x, body.position.y - livePosition.y);
      const separation = Math.min(1, gap / footprint.radius);
      body.children[0].material.opacity = 0.025 + 0.145 * separation;
      body.children[1].material.opacity = 0.38 + 0.55 * separation;
    }
  }

  return {
    layer, clear, updatePose,
    setVehicle(template) { clear(); footprint = template; },
    setTrials(trials, best, active) {
      clear();
      const runs = trials.filter(trial => trial.frames?.length > 1);
      if (!runs.length) return;
      for (const run of runs) {
        const isBest = run.index === best, isActive = run.index === active;
        // White edged in navy reads on both tape and paper, even when the
        // current (narrower) run is drawn over its centre.
        const styles = isBest ? ['bestOutline', 'best'] : [];
        if (isActive) styles.push('selected');
        if (!styles.length) styles.push('earlier');
        const points = [];
        let last;
        for (const point of run.frames) {
          if (last && Math.hypot(point.x - last.x, point.y - last.y) < 0.003) continue;
          points.push(point.x, point.y, 0.00025);
          last = point;
        }
        if (points.length < 6) continue;
        for (const kind of styles) {
          const style = GHOST_STYLES[kind];
          const geo = new LineGeometry();
          geo.setPositions(points);
          const material = new LineMaterial({
            color: colours[kind], linewidth: style.width, transparent: true, opacity: style.opacity,
            dashed: style.dashed, dashSize: 0.025, gapSize: 0.016, depthWrite: false,
          });
          material.userData.ghostRole = kind;
          const path = new Line2(geo, material);
          path.renderOrder = style.order;
          if (style.dashed) path.computeLineDistances();
          layer.add(path);
        }
      }
      if (!footprint) return;
      // Keep the live CAD unobscured: only comparisons use substitute cars.
      // Baseline, best and latest comparative rounds are distinct when possible.
      const comparisons = runs.filter(run => run.index !== active);
      const bestRun = comparisons.find(run => run.index === best);
      const shortlist = new Set([bestRun, comparisons[0], ...comparisons.slice(-2).reverse()]);
      for (const run of [...shortlist].filter(Boolean).slice(0, 3)) {
        const kind = run.index === best ? 'best' : 'earlier';
        const body = makeGhostBody(footprint, colours[kind]);
        for (const part of body.children) {
          part.material.userData.ghostRole = kind === 'best' && part.isLineSegments ? 'bestOutline' : kind;
        }
        layer.add(body);
        moving.push({body, frames: run.frames});
      }
    },
  };
}

async function loadFusionParts(signal) {
  const response = await fetch(new URL('models/car.json', document.baseURI), {signal});
  if (!response.ok) throw new Error('無法載入 Fusion 車架模型。');
  const {parts} = await response.json();
  if (!Array.isArray(parts) || parts.length === 0) throw new Error('Fusion 車架模型未有可顯示嘅零件。');
  return parts;
}

function buildVehicle(parts, physical) {
  const chassis = new THREE.Group();
  const leftWheel = new THREE.Group();
  const rightWheel = new THREE.Group();
  const halfAxle = physical?.halfAxle ?? AXLE_HALF_WIDTH;
  const radius = physical?.wheelRadius ?? AXLE_HEIGHT;
  leftWheel.position.set(-halfAxle, 0, radius);
  rightWheel.position.set(halfAxle, 0, radius);
  chassis.add(leftWheel, rightWheel);
  const groups = {chassis, leftWheel, rightWheel};
  const materials = new Map();
  const batches = new Map();
  for (const part of parts) {
    const group = groups[part.group];
    if (!group || !part.positions?.length) continue;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(part.positions, 3));
    if (part.indices?.length) {
      geometry.setIndex(ArrayBuffer.isView(part.indices)
        ? new THREE.BufferAttribute(part.indices, 1) : part.indices);
    }
    if (part.normals?.length === part.positions.length) {
      geometry.setAttribute('normal', new THREE.Float32BufferAttribute(part.normals, 3));
    } else {
      geometry.computeVertexNormals();
    }
    if (part.group !== 'chassis') geometry.translate(-group.position.x, 0, -radius);
    const color = part.color || '#8c9699';
    if (!materials.has(color)) {
      materials.set(color, new THREE.MeshStandardMaterial({color, metalness: 0.13, roughness: 0.63, side: THREE.DoubleSide}));
    }
    // A STEP assembly can contain hundreds of screws and electronic parts.
    // Batch surfaces which share a material and a motion group for classroom GPUs.
    const key = part.group + ':' + color + ':' + Boolean(geometry.index);
    if (!batches.has(key)) batches.set(key, {group, material: materials.get(color), geometries: []});
    batches.get(key).geometries.push(geometry);
  }
  for (const {group, material, geometries} of batches.values()) {
    const geometry = geometries.length === 1 ? geometries[0] : mergeGeometries(geometries);
    if (geometries.length > 1) geometries.forEach(part => part.dispose());
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  return groups;
}

export function createView(container, {trackPoints, trackWidth}) {
  const renderer = new THREE.WebGLRenderer({antialias: true, powerPreference: 'high-performance'});
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  const canvas = renderer.domElement;
  canvas.style.cssText = 'display:block;width:100%;height:100%;';
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', 'Fusion 循線車同賽道嘅即時三維視圖');
  container.append(canvas);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(COLOR.desk);
  const deskLayer = new THREE.Group();
  addDesk(deskLayer);
  scene.add(deskLayer);
  const courseLayer = new THREE.Group();
  scene.add(courseLayer);
  let {center, bounds} = addCourse(courseLayer, trackPoints, trackWidth, null);
  const {key, ambient, fill} = addLighting(scene, center);
  let light = document.documentElement.dataset.theme === 'light';
  const trails = {manual: createTrail(scene), trial: createTrail(scene)};
  let channel = 'manual';
  let showTrail = true;
  let replayTime = 0;
  let activeTrial = null;
  let nextFrame = 0;
  trails.trial.mesh.visible = false;
  const ghostColours = {};
  const ghosts = createGhostHistory(scene, ghostColours);
  const car = new THREE.Group();
  let vehicle;
  let fusionParts;
  let vehicleScale = 1;
  const sensorFocus = new THREE.Vector3(0, 0.157, 0.01975);
  let sensorSpan = 0.108;
  let sensorMinHeight = 0.054;
  // The starting tangent also supplies a sensible pose while physics is loading.
  const start = trackPoints[0];
  car.position.set(start.x, start.y, 0);
  car.rotation.z = Math.atan2(start.x - trackPoints[1].x, trackPoints[1].y - start.y);
  scene.add(car);

  const camera = new THREE.OrthographicCamera(-2, 2, 2, -2, 0.01, 60);
  camera.up.set(0, 0, 1);
  camera.position.set(center.x + 1, center.y - 3, 2.7);
  const controls = new OrbitControls(camera, canvas);
  controls.minZoom = 0.55;
  controls.maxZoom = 15;
  controls.maxPolarAngle = Math.PI * 0.47;
  controls.zoomToCursor = true;
  controls.target.set(center.x, center.y, 0);
  const abort = new AbortController();
  let mode = 'overview';
  let aspect = 1;
  let disposed = false;
  let followYaw = car.rotation.z;
  let lastTime = performance.now();
  const target = new THREE.Vector3();
  const offset = new THREE.Vector3();
  const forward = new THREE.Vector3();
  const zAxis = new THREE.Vector3(0, 0, 1);
  const cameraRight = new THREE.Vector3();
  const cameraUp = new THREE.Vector3();

  function draw() {
    if (!disposed) renderer.render(scene, camera);
  }

  function themeMaterials(group) {
    const palette = light ? LIGHT_COLOR : COLOR;
    group.traverse(object => {
      const material = object.material;
      if (!material) return;
      const {paletteRole, ghostRole} = material.userData;
      if (paletteRole) material.color.set(palette[paletteRole]);
      if (ghostRole) material.color.set(ghostColours[ghostRole]);
    });
  }

  function applyTheme() {
    light = document.documentElement.dataset.theme === 'light';
    const css = getComputedStyle(document.documentElement);
    ghostColours.selected = css.getPropertyValue('--trial-current').trim();
    ghostColours.best = css.getPropertyValue('--trial-best').trim();
    ghostColours.bestOutline = css.getPropertyValue('--trial-best-outline').trim();
    ghostColours.earlier = css.getPropertyValue('--trial-previous').trim();
    const lost = css.getPropertyValue('--trail-lost').trim();
    for (const trail of Object.values(trails)) trail.setColours(ghostColours.selected, lost);
    scene.background.set((light ? LIGHT_COLOR : COLOR).desk);
    themeMaterials(deskLayer);
    themeMaterials(courseLayer);
    themeMaterials(ghosts.layer);
    key.intensity = light ? 1.8 : 2;
    ambient.intensity = light ? 1.42 : 1.5;
    fill.intensity = light ? 1.0 : 1.1;
    draw();
  }


  function clearReplay() {
    activeTrial = null;
    nextFrame = 0;
    replayTime = 0;
    trails.trial.reset();
  }

  function plotReplay(state) {
    // The replay may skip animation frames or seek backwards. Reconstruct
    // from recorded positions so the trail never cuts across an unseen bend.
    if (state.time < replayTime) {
      nextFrame = 0;
      trails.trial.reset();
    }
    const frames = activeTrial?.frames;
    while (frames && nextFrame < frames.length && frames[nextFrame].time <= state.time) {
      const frame = frames[nextFrame++];
      trails.trial.add(frame);
    }
    trails.trial.add(state);
    replayTime = state.time;
    ghosts.updatePose(replayTime, true, car.position);
  }

  function frame() {
    let height;
    if (mode === 'sensor') {
      height = Math.max(sensorMinHeight, sensorSpan / aspect);
    } else if (mode === 'heading') {
      // Keep the full vehicle in frame at any heading, even on a narrow display.
      height = 0.5 * vehicleScale / Math.min(1, aspect);
    } else if (mode === 'follow') {
      height = Math.max(0.57, 0.84 / aspect) * vehicleScale;
    } else {
      camera.updateMatrixWorld();
      cameraRight.setFromMatrixColumn(camera.matrixWorld, 0);
      cameraUp.setFromMatrixColumn(camera.matrixWorld, 1);
      const width = bounds.max.x - bounds.min.x;
      const depth = bounds.max.y - bounds.min.y;
      const projectedWidth = Math.abs(cameraRight.x) * width + Math.abs(cameraRight.y) * depth;
      const projectedHeight = Math.abs(cameraUp.x) * width + Math.abs(cameraUp.y) * depth;
      height = Math.max(projectedHeight, projectedWidth / aspect) * 1.13;
    }
    camera.left = -height * aspect / 2;
    camera.right = height * aspect / 2;
    camera.top = height / 2;
    camera.bottom = -height / 2;
    camera.updateProjectionMatrix();
  }

  function updateFollow(snap = false) {
    forward.set(0, 1, 0).applyQuaternion(car.quaternion);
    const yaw = Math.atan2(-forward.x, forward.y);
    const now = performance.now();
    const dt = Math.max(0, (now - lastTime) / 1000);
    lastTime = now;
    const delta = Math.atan2(Math.sin(yaw - followYaw), Math.cos(yaw - followYaw));
    followYaw += snap ? delta : delta * (1 - Math.exp(-5 * dt));
    target.set(car.position.x, car.position.y, car.position.z + 0.038 * vehicleScale);
    target.addScaledVector(forward, 0.065 * vehicleScale);
    offset.set(0.78, 0.84, 0.71).multiplyScalar(vehicleScale).applyAxisAngle(zAxis, followYaw);
    camera.position.copy(target).add(offset);
    camera.lookAt(target);
  }

  function updateHeadingCamera() {
    // World +Y stays at the top. The axle tracks the centre while the nose can swing.
    camera.position.copy(car.position);
    camera.position.z += 2 * vehicleScale;
    camera.up.set(0, 1, 0);
    camera.lookAt(car.position);
  }

  function updateSensorCamera() {
    // Read the PCB from the nose side. Its channel row stays horizontal as the
    // rover turns; the small tilt also reveals the line just ahead of the board.
    target.copy(sensorFocus).applyQuaternion(car.quaternion).add(car.position);
    offset.set(0, 0.14, 1).multiplyScalar(Math.max(0.25, sensorSpan * 2)).applyQuaternion(car.quaternion);
    camera.up.set(0, 1, 0).applyQuaternion(car.quaternion);
    camera.position.copy(target).add(offset);
    camera.lookAt(target);
  }

  function setCamera(value) {
    if (!['overview', 'follow', 'top', 'heading', 'sensor'].includes(value)) return;
    mode = value;
    // The course-scale shadow map cannot resolve overlapping PCB surfaces
    // at millimetre scale. The close-up retains all three scene lights.
    key.castShadow = mode !== 'sensor';
    camera.zoom = 1;
    camera.up.set(0, 0, 1);
    controls.enabled = mode === 'top' || mode === 'overview';
    controls.enableRotate = mode === 'overview';
    canvas.style.touchAction = controls.enabled ? 'none' : 'pan-y';
    if (mode === 'sensor') {
      updateSensorCamera();
    } else if (mode === 'heading') {
      updateHeadingCamera();
    } else if (mode === 'follow') {
      updateFollow(true);
    } else {
      controls.target.set(center.x, center.y, 0);
      offset.set(mode === 'top' ? 0 : 0.74, mode === 'top' ? -0.001 : -2.7, mode === 'top' ? 4 : 2.75);
      camera.position.copy(controls.target).add(offset);
      camera.lookAt(controls.target);
      controls.update();
    }
    frame();
    draw();
  }

  function resize() {
    const width = Math.max(1, Math.round(container.clientWidth));
    const height = Math.max(1, Math.round(container.clientHeight));
    renderer.setSize(width, height, false);
    aspect = width / height;
    frame();
    draw();
  }

  controls.addEventListener('change', draw);
  document.addEventListener('themechange', applyTheme);
  applyTheme();
  setCamera('overview');
  const observer = new ResizeObserver(resize);
  observer.observe(container);
  resize();
  function setModel(model) {
    const parts = model ? model.parts : fusionParts;
    const next = buildVehicle(parts, model?.physical);
    const box = new THREE.Box3().setFromObject(next.chassis);
    const size = box.getSize(new THREE.Vector3());
    vehicleScale = model ? Math.min(12, Math.max(0.15, Math.max(size.x, size.y, size.z) / 0.21)) : 1;
    next.indicators = createSensorIndicators(model);
    if (next.indicators) {
      const row = new THREE.Box3().setFromObject(next.indicators);
      const width = row.max.x - row.min.x;
      sensorFocus.copy(next.indicators.position);
      sensorFocus.y -= width * 0.11;
      sensorSpan = width * 1.32;
      sensorMinHeight = width * 0.66;
      next.chassis.add(next.indicators);
    } else {
      const pitch = model?.physical?.sensorPitch ?? 0.0115;
      sensorFocus.set(0, model?.physical?.sensorForward ?? 0.1588, 0.0101);
      sensorSpan = Math.max(0.040, 9.5 * pitch);
      sensorMinHeight = sensorSpan * 0.5;
    }
    if (vehicle) {
      car.remove(vehicle.chassis);
      disposeMeshes(vehicle.chassis);
    }
    vehicle = next;
    car.add(vehicle.chassis);
    trails.manual.reset();
    clearReplay();
    ghosts.setVehicle(ghostFootprint(parts, box, model?.physical));
    setCamera(mode);
  }
  const ready = loadFusionParts(abort.signal).then(parts => {
    fusionParts = parts;
    setModel(null);
  });

  return {
    ready,
    setModel,
    setCamera,
    resize,
    setGhosts(trials, bestId = null, activeId = null, activeRecord = null) {
      // In a new round the worker can finish before its classroom replay.
      // Only already-driven positions from that record may reach the screen.
      const runs = activeRecord
        ? (trials ?? []).filter(trial => trial.index !== activeRecord.index)
        : trials ?? [];
      const nextTrial = activeRecord ?? runs.find(trial => trial.index === activeId) ?? null;
      if (nextTrial !== activeTrial) {
        clearReplay();
        activeTrial = nextTrial;
      }
      ghosts.setTrials(runs, bestId, activeId);
      themeMaterials(ghosts.layer);
      ghosts.updatePose(replayTime, channel === 'trial', car.position);
      draw();
    },
    setGhostVisibility(visible) {
      ghosts.layer.visible = Boolean(visible);
      ghosts.updatePose(replayTime, channel === 'trial', car.position);
      draw();
    },
    setTrailChannel(value) {
      if (value !== 'manual' && value !== 'trial') return;
      trails[channel].mesh.visible = false;
      channel = value;
      trails[channel].mesh.visible = showTrail;
      ghosts.updatePose(replayTime, channel === 'trial', car.position);
      draw();
    },
    setCourse(course) {
      const custom = course?.kind === 'custom' ? course : null;
      disposeMeshes(courseLayer);
      courseLayer.clear();
      ({center, bounds} = addCourse(courseLayer, trackPoints, trackWidth, custom));
      themeMaterials(courseLayer);
      trails.manual.reset();
      clearReplay();
      ghosts.clear();
      setCamera(mode);
    },
    setTrail(visible) {
      showTrail = Boolean(visible);
      trails[channel].mesh.visible = showTrail;
      draw();
    },
    resetTrail() {
      trails[channel].reset();
      if (channel === 'trial') {
        replayTime = 0;
        nextFrame = 0;
      }
      draw();
    },
    render(state) {
      if (disposed || !state) return;
      car.position.set(state.x, state.y, state.z);
      car.quaternion.fromArray(state.quaternion);
      if (vehicle) {
        vehicle.leftWheel.rotation.x = state.leftAngle;
        vehicle.rightWheel.rotation.x = state.rightAngle;
        if (vehicle.indicators) updateSensorIndicators(vehicle.indicators, state.sensors, state.sensorOrder);
      }
      if (channel === 'trial') {
        plotReplay(state);
      } else trails.manual.add(state);
      if (mode === 'follow') updateFollow();
      if (mode === 'heading') updateHeadingCamera();
      if (mode === 'sensor') updateSensorCamera();
      draw();
    },
    dispose() {
      disposed = true;
      abort.abort();
      observer.disconnect();
      document.removeEventListener('themechange', applyTheme);
      controls.dispose();
      disposeMeshes(scene);
      key.shadow.map?.dispose();
      renderer.dispose();
      canvas.remove();
    },
  };
}
