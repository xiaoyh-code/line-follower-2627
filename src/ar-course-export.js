import * as THREE from 'three';
import { USDZExporter } from 'three/addons/exporters/USDZExporter.js';
import { makeCourseSampler, START_POSE, TRACK_POINTS } from './track.js';

const REFERENCE_SENSOR_FORWARD = 0.1588;
const TABLETOP_SPAN = 0.90;
const BASE_THICKNESS = 0.012;
const PAPER_THICKNESS = 0.0003;

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
    new THREE.MeshStandardMaterial({ map: texture, roughness: 0.94 }),
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
    const color = part.color || '#8c9699';
    if (!materials.has(color)) {
      materials.set(color, new THREE.MeshStandardMaterial({ color, metalness: 0.13, roughness: 0.63 }));
    }
    const mesh = new THREE.Mesh(geometry, materials.get(color));
    mesh.name = 'Part' + index;
    car.add(mesh);
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
}

export async function exportArCourse({ course = null, model = null, startOffsetMm = 0 } = {}) {
  if (!Number.isFinite(startOffsetMm)) throw new TypeError('Expected a finite start offset in millimetres.');
  if (course) makeCourseSampler(course);
  const map = course ? { ...course, physicalHeight: course.physicalWidth * course.height / course.width } : stockMap();
  const parts = model?.parts ?? await fusionParts();

  const scene = new THREE.Scene();
  const assembly = new THREE.Group();
  assembly.name = 'TabletopCourse';
  assembly.rotation.x = -Math.PI / 2;
  const span = Math.max(map.physicalWidth, map.physicalHeight) + 0.024;
  assembly.scale.setScalar(Math.min(1, TABLETOP_SPAN / span));
  scene.add(assembly);
  try {
    addCourseSheet(assembly, map);
    addCar(assembly, parts, course?.startPose ?? START_POSE, model?.physical, course, startOffsetMm);
    scene.updateMatrixWorld(true);
    return await new USDZExporter().parseAsync(scene, {
      quickLookCompatible: true,
      maxTextureSize: Math.max(map.width, map.height),
    });
  } finally {
    const materials = new Set();
    scene.traverse(object => {
      object.geometry?.dispose();
      if (object.material) materials.add(object.material);
    });
    for (const material of materials) {
      material.map?.dispose();
      material.dispose();
    }
  }
}
