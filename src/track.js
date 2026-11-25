// Ground and vehicle coordinates are metres. +Y is forward, +X is vehicle right.
export const TRACK_WIDTH = 0.021;
export function makeSensorPositions(forward = 0.1588, pitch = 0.0115) {
  return Array.from({ length: 8 }, (_, channel) => ({
    x: (3.5 - channel) * pitch,
    y: forward,
  }));
}
export const SENSOR_POSITIONS = makeSensorPositions();

export const START_POSE = { x: 0, y: -0.76, heading: -Math.PI / 2 };

// Each cubic continues the preceding segment. The top section changes curvature twice.
const curves = [
  [[0.18, -0.76], [0.39, -0.76], [0.58, -0.76]],
  [[0.90, -0.76], [1.15, -0.50], [1.15, -0.18]],
  [[1.15, -0.04], [1.15, 0.08], [1.15, 0.21]],
  [[1.15, 0.53], [0.91, 0.76], [0.59, 0.76]],
  [[0.29, 0.76], [0.22, 0.52], [-0.08, 0.52]],
  [[-0.34, 0.52], [-0.36, 0.70], [-0.62, 0.70]],
  [[-0.94, 0.70], [-1.15, 0.46], [-1.15, 0.16]],
  [[-1.15, 0.03], [-1.15, -0.09], [-1.15, -0.22]],
  [[-1.15, -0.53], [-0.89, -0.76], [-0.58, -0.76]],
  [[-0.39, -0.76], [-0.18, -0.76], [0, -0.76]],
];

export const TRACK_POINTS = [];
let start = [START_POSE.x, START_POSE.y];
for (const [c1, c2, end] of curves) {
  for (let j = 0; j < 32; j++) {
    const t = j / 32;
    const u = 1 - t;
    const cubic = (i) => u ** 3 * start[i] + 3 * u * u * t * c1[i]
      + 3 * u * t * t * c2[i] + t ** 3 * end[i];
    TRACK_POINTS.push({ x: cubic(0), y: cubic(1) });
  }
  start = end;
}

let arcLength = 0;
const segments = TRACK_POINTS.map(({ x, y }, i) => {
  const end = TRACK_POINTS[(i + 1) % TRACK_POINTS.length];
  const dx = end.x - x;
  const dy = end.y - y;
  const length = Math.hypot(dx, dy);
  const segment = { x, y, dx, dy, length, inverseSquare: 1 / (length * length), arc: arcLength };
  arcLength += length;
  return segment;
});
export const TRACK_LENGTH = arcLength;

// All probes sample the same polyline used for drawing the tape. Cache segment
// candidates by cell, so eight probes do not scan the entire circuit every tick.
const cellSize = 0.08;
const cells = new Map();
const key = (cx, cy) => (cx + 128) * 512 + cy + 128;
for (const s of segments) {
  const margin = TRACK_WIDTH / 2;
  const xmin = Math.floor((Math.min(s.x, s.x + s.dx) - margin) / cellSize);
  const xmax = Math.floor((Math.max(s.x, s.x + s.dx) + margin) / cellSize);
  const ymin = Math.floor((Math.min(s.y, s.y + s.dy) - margin) / cellSize);
  const ymax = Math.floor((Math.max(s.y, s.y + s.dy) + margin) / cellSize);
  for (let cx = xmin; cx <= xmax; cx++) {
    for (let cy = ymin; cy <= ymax; cy++) {
      const id = key(cx, cy);
      if (!cells.has(id)) cells.set(id, []);
      cells.get(id).push(s);
    }
  }
}

function project(x, y, s) {
  return Math.max(0, Math.min(1, ((x - s.x) * s.dx + (y - s.y) * s.dy) * s.inverseSquare));
}

export function tapeAt(x, y) {
  const nearby = cells.get(key(Math.floor(x / cellSize), Math.floor(y / cellSize)));
  if (!nearby) return false;
  const threshold = (TRACK_WIDTH / 2) ** 2;
  for (const s of nearby) {
    const t = project(x, y, s);
    if ((x - s.x - t * s.dx) ** 2 + (y - s.y - t * s.dy) ** 2 <= threshold) return true;
  }
  return false;
}

// Photo/drawing masks are row-major, from the top-left. The renderer centres
// the same rectangle at the world origin and uses its width as the scale.
export function makeCourseSampler(course) {
  if (course == null) return tapeAt;
  const { kind, width, height, physicalWidth, mask, startPose } = course;
  if (kind !== 'custom' || !Number.isInteger(width) || width <= 0
      || !Number.isInteger(height) || height <= 0 || !(physicalWidth > 0) || !Number.isFinite(physicalWidth)
      || !(mask instanceof Uint8Array) || mask.length !== width * height
      || !startPose || ![startPose.x, startPose.y, startPose.heading].every(Number.isFinite)) {
    throw new TypeError('Invalid custom course dimensions, tape mask or start pose');
  }
  const pixelsPerMetre = width / physicalWidth;
  return (x, y) => {
    const col = Math.floor(width / 2 + x * pixelsPerMetre);
    const row = Math.floor(height / 2 - y * pixelsPerMetre);
    return col >= 0 && col < width && row >= 0 && row < height && mask[row * width + col] === 1;
  };
}

// Used for lap scoring only. The controller only has access to the eight probe bits.
export function nearestTrack(x, y) {
  let best = Infinity;
  let arc = 0;
  for (const s of segments) {
    const t = project(x, y, s);
    const distance2 = (x - s.x - t * s.dx) ** 2 + (y - s.y - t * s.dy) ** 2;
    if (distance2 < best) {
      best = distance2;
      arc = s.arc + t * s.length;
    }
  }
  return { distance: Math.sqrt(best), fraction: arc / TRACK_LENGTH };
}
