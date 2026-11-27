import * as THREE from 'three';
import { USDZExporter } from 'three/addons/exporters/USDZExporter.js';
import { strFromU8, strToU8, unzipSync, zipSync } from 'three/addons/libs/fflate.module.js';
import { makeCourseSampler, START_POSE, TRACK_POINTS } from './track.js';

const REFERENCE_SENSOR_FORWARD = 0.1588;
const REFERENCE_HALF_AXLE = 0.09065;
const REFERENCE_WHEEL_RADIUS = 0.034;
const TABLETOP_SPAN = 0.90;
const BASE_THICKNESS = 0.012;
const PAPER_THICKNESS = 0.003;

function stockMap() {
  const width = 768;
  const physicalWidth = 2 * Math.max(...TRACK_POINTS.map(({ x }) => Math.abs(x))) + 0.30;
  const physicalHeight = 2 * Math.max(...TRACK_POINTS.map(({ y }) => Math.abs(y))) + 0.30;
  const height = Math.round(width * physicalHeight / physicalWidth);
  const mask = new Uint8Array(width * height);
  const tapeAt = makeCourseSampler();
  for (let row = 0; row < height; row++) {
    const y = (0.5 - (row + 0.5) / height) * physicalHeight;
    for (let col = 0; col < width; col++) {
      const x = ((col + 0.5) / width - 0.5) * physicalWidth;
      mask[row * width + col] = Number(tapeAt(x, y));
    }
  }
  return { width, height, physicalWidth, physicalHeight, mask };
}

function addCourseSheet(parent, map) {
  const { width, height, physicalWidth, physicalHeight, mask } = map;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { alpha: false });
  const image = context.createImageData(width, height);
  for (let i = 0; i < mask.length; i++) {
    const pixel = i * 4;
    const luma = mask[i] ? 18 : 247;
    image.data[pixel] = image.data[pixel + 1] = image.data[pixel + 2] = luma;
    image.data[pixel + 3] = 255;
  }
  context.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;

  // A single textured sheet keeps the white floor and every black mask pixel
  // coplanar without competing geometry, even for noisy photo inputs.
  const base = new THREE.Mesh(
    new THREE.BoxGeometry(physicalWidth + 0.024, physicalHeight + 0.024, BASE_THICKNESS),
    new THREE.MeshStandardMaterial({ color: '#738ba7', roughness: 0.82 }),
  );
  base.name = 'CourseBase';
  base.position.z = BASE_THICKNESS / 2;
  const sheet = new THREE.Mesh(
    new THREE.PlaneGeometry(physicalWidth, physicalHeight),
    new THREE.MeshStandardMaterial({
      map: texture, roughness: 0.94, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -3,
    }),
  );
  sheet.name = 'TrackMask';
  sheet.position.z = BASE_THICKNESS + PAPER_THICKNESS;
  parent.add(base, sheet);
}

async function fusionParts() {
  const response = await fetch(new URL('models/car.json', document.baseURI));
  if (!response.ok) throw new Error('Failed to load the Fusion car for AR export.');
  const { parts } = await response.json();
  return parts;
}

function addCar(parent, parts, pose, physical, course, startOffsetMm) {
  const car = new THREE.Group();
  car.name = 'StartVehicle';
  const leftWheel = new THREE.Group();
  const rightWheel = new THREE.Group();
  leftWheel.name = 'ReplayLeftWheel';
  rightWheel.name = 'ReplayRightWheel';
  const halfAxle = physical?.halfAxle ?? REFERENCE_HALF_AXLE;
  const wheelRadius = physical?.wheelRadius ?? REFERENCE_WHEEL_RADIUS;
  leftWheel.position.set(-halfAxle, 0, wheelRadius);
  rightWheel.position.set(halfAxle, 0, wheelRadius);
  car.add(leftWheel, rightWheel);

  const materials = new Map();
  for (const [index, part] of parts.entries()) {
    if (!part.positions?.length) continue;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(part.positions, 3));
    if (part.indices?.length) {
      geometry.setIndex(ArrayBuffer.isView(part.indices)
        ? new THREE.BufferAttribute(part.indices, 1)
        : part.indices);
    }
    if (part.normals?.length === part.positions.length) {
      geometry.setAttribute('normal', new THREE.Float32BufferAttribute(part.normals, 3));
    } else {
      geometry.computeVertexNormals();
    }
    const partParent = part.group === 'leftWheel' ? leftWheel : part.group === 'rightWheel' ? rightWheel : car;
    if (partParent !== car) geometry.translate(-partParent.position.x, 0, -wheelRadius);
    const color = part.color || '#8c9699';
    if (!materials.has(color)) {
      materials.set(color, new THREE.MeshStandardMaterial({ color, metalness: 0.13, roughness: 0.63 }));
    }
    const mesh = new THREE.Mesh(geometry, materials.get(color));
    mesh.name = 'Part' + index;
    partParent.add(mesh);
  }
  const bounds = new THREE.Box3().setFromObject(car);
  if (bounds.isEmpty()) throw new Error('The vehicle has no meshes to export.');
  const shift = course ? REFERENCE_SENSOR_FORWARD - (physical?.sensorForward ?? REFERENCE_SENSOR_FORWARD) : 0;
  const offset = startOffsetMm / 1000;
  const { x, y, heading } = pose;
  car.position.set(
    x - Math.sin(heading) * shift - Math.cos(heading) * offset,
    y + Math.cos(heading) * shift - Math.sin(heading) * offset,
    BASE_THICKNESS + PAPER_THICKNESS - bounds.min.z,
  );
  car.rotation.z = heading;
  parent.add(car);
  return { car, leftWheel, rightWheel, groundZ: car.position.z };
}

function replayClip(vehicle, frames) {
  if (frames.length < 2) return null;
  const { car, leftWheel, rightWheel, groundZ } = vehicle;
  const times = frames.map(({ time }) => time);
  const positions = frames.flatMap(({ x, y, z }) => [x, y, groundZ + z]);
  const orientations = frames.flatMap(({ quaternion }) => quaternion);
  const tracks = [
    new THREE.VectorKeyframeTrack(car.name + '.position', times, positions),
    new THREE.QuaternionKeyframeTrack(car.name + '.quaternion', times, orientations),
  ];
  for (const [wheel, angle] of [[leftWheel, 'leftAngle'], [rightWheel, 'rightAngle']]) {
    if (!wheel.children.length) continue;
    const rotations = frames.flatMap(frame => {
      const halfAngle = frame[angle] / 2;
      return [Math.sin(halfAngle), 0, 0, Math.cos(halfAngle)];
    });
    tracks.push(new THREE.QuaternionKeyframeTrack(wheel.name + '.quaternion', times, rotations));
  }
  return new THREE.AnimationClip('Line-following replay', times.at(-1), tracks);
}

function withQuickLookPlayButton(bytes) {
  const files = unzipSync(bytes);
  const stage = strFromU8(files['model.usda']);
  // Apple's stage metadata holds playback until the viewer taps Play.
  files['model.usda'] = strToU8(stage.replace('\n)\n', '\n\tautoPlay = false\n\tplaybackMode = "none"\n)\n'));

  const aligned = {};
  let offset = 0;
  for (const [filename, data] of Object.entries(files)) {
    // USDZ stores every payload uncompressed and at a 64-byte boundary.
    // The local ZIP header is 30 bytes, plus the filename and 4-byte extra-field header.
    const headerSize = 34 + strToU8(filename).length;
    const padding = (64 - (offset + headerSize) % 64) % 64;
    aligned[filename] = [data, { extra: { 12345: new Uint8Array(padding) } }];
    offset += headerSize + padding + data.length;
  }
  return zipSync(aligned, { level: 0 });
}

export async function createArCourseScene({ course = null, model = null, startOffsetMm = 0, frames = [] } = {}) {
  if (!Number.isFinite(startOffsetMm)) throw new TypeError('Expected a finite start offset in millimetres.');
  if (course) makeCourseSampler(course);
  const map = course ? { ...course, physicalHeight: course.physicalWidth * course.height / course.width } : stockMap();
  const parts = model?.parts ?? await fusionParts();

  const scene = new THREE.Scene();
  const assembly = new THREE.Group();
  assembly.name = 'TabletopCourse';
  assembly.rotation.x = -Math.PI / 2;
  const mapSpan = Math.max(map.physicalWidth, map.physicalHeight) + 0.024;
  const scale = Math.min(1, TABLETOP_SPAN / mapSpan);
  assembly.scale.setScalar(scale);
  scene.add(assembly);
  const dispose = () => {
    const materials = new Set();
    assembly.traverse(object => {
      object.geometry?.dispose();
      if (object.material) materials.add(object.material);
    });
    for (const material of materials) {
      material.map?.dispose();
      material.dispose();
    }
  };
  try {
    addCourseSheet(assembly, map);
    const vehicle = addCar(assembly, parts, course?.startPose ?? START_POSE, model?.physical, course, startOffsetMm);
    const clip = replayClip(vehicle, frames);
    scene.updateMatrixWorld(true);
    return { scene, assembly, clip, span: mapSpan * scale, textureSize: Math.max(map.width, map.height), dispose };
  } catch (error) {
    dispose();
    throw error;
  }
}

export async function encodeArCourseScene({ assembly, clip, textureSize }) {
  // Export just the tabletop. The browser preview can add lighting, a camera,
  // or an XR placement transform without changing the Quick Look package.
  const stage = new THREE.Scene();
  stage.add(assembly.clone());
  stage.updateMatrixWorld(true);
  const bytes = await new USDZExporter().parseAsync(stage, {
    quickLookCompatible: true,
    maxTextureSize: textureSize,
    animations: clip ? [clip] : [],
    animationFrameRate: 25,
  });
  return clip ? withQuickLookPlayButton(bytes) : bytes;
}

export async function exportArCourse(options) {
  const content = await createArCourseScene(options);
  try {
    return await encodeArCourseScene(content);
  } finally {
    content.dispose();
  }
}
