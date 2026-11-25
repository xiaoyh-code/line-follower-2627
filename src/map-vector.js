// A bit marks a black cell. Trace its four exposed edges with black on the
// right; at a diagonal touch, take the right turn to keep outlines separate.
export function contoursFromMask(mask, width, height) {
  const stride = width + 1;
  const edges = new Uint8Array(stride * (height + 1));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (!mask[i]) continue;
      const a = y * stride + x;
      if (!y || !mask[i - width]) edges[a] |= 1;
      if (x === width - 1 || !mask[i + 1]) edges[a + 1] |= 2;
      if (y === height - 1 || !mask[i + width]) edges[a + stride + 1] |= 4;
      if (!x || !mask[i - 1]) edges[a + stride] |= 8;
    }
  }
  const step = [1, stride, -1, -stride];
  const paths = [];
  for (let start = 0; start < edges.length; start++) {
    while (edges[start]) {
      let p = start;
      let direction = Math.log2(edges[p] & -edges[p]);
      const vertices = [[p % stride, Math.floor(p / stride)]];
      do {
        edges[p] &= ~(1 << direction);
        p += step[direction];
        if (p === start) break;
        const order = [(direction + 1) % 4, direction, (direction + 3) % 4, (direction + 2) % 4];
        const next = order.find((d) => edges[p] & (1 << d));
        if (next === undefined) throw new Error('賽道邊界未能連接。');
        if (next !== direction) vertices.push([p % stride, Math.floor(p / stride)]);
        direction = next;
      } while (true);
      // Simplify staircase edges by less than one cell. The final physics
      // mask is resampled from these exact polygons after simplification.
      if (vertices.length >= 3) {
        const simplified = simplifyRing(vertices, 0.62);
        paths.push('M' + simplified.map((p) => p.join(' ')).join('L') + 'Z');
      }
    }
  }
  return paths.join('');
}

function simplifyRing(points, tolerance) {
  if (points.length < 6) return points;
  const start = points[0];
  let opposite = 1;
  let max = 0;
  for (let i = 1; i < points.length; i++) {
    const distance = (points[i][0] - start[0]) ** 2 + (points[i][1] - start[1]) ** 2;
    if (distance > max) {
      max = distance;
      opposite = i;
    }
  }
  const ring = points.concat([start]);
  const keep = new Uint8Array(ring.length);
  keep[0] = keep[opposite] = keep[points.length] = 1;
  const stack = [
    [0, opposite],
    [opposite, points.length],
  ];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = ring[a];
    const dx = ring[b][0] - ax,
      dy = ring[b][1] - ay;
    const length2 = dx * dx + dy * dy;
    let split = -1;
    let largest = tolerance * tolerance;
    for (let i = a + 1; i < b; i++) {
      const px = ring[i][0] - ax,
        py = ring[i][1] - ay;
      const t = length2 ? Math.max(0, Math.min(1, (px * dx + py * dy) / length2)) : 0;
      const d = (px - t * dx) ** 2 + (py - t * dy) ** 2;
      if (d > largest) {
        largest = d;
        split = i;
      }
    }
    if (split !== -1) {
      keep[split] = 1;
      stack.push([a, split], [split, b]);
    }
  }
  const result = points.filter((_, i) => keep[i]);
  return result.length >= 3 ? result : points;
}

export function thresholdMask(gray, width, height, threshold, invert = false) {
  const mask = new Uint8Array(gray.length);
  for (let i = 0; i < gray.length; i++)
    mask[i] = Number((invert ? 255 - gray[i] : gray[i]) <= threshold);
  const minimumArea = Math.max(3, Math.round(gray.length / 80000));
  const queue = new Int32Array(gray.length);
  for (let i = 0; i < mask.length; i++) {
    if (mask[i] !== 1) continue;
    let begin = 0,
      end = 1;
    queue[0] = i;
    mask[i] = 2;
    while (begin < end) {
      const p = queue[begin++],
        x = p % width;
      if (x && mask[p - 1] === 1) {
        mask[p - 1] = 2;
        queue[end++] = p - 1;
      }
      if (x < width - 1 && mask[p + 1] === 1) {
        mask[p + 1] = 2;
        queue[end++] = p + 1;
      }
      if (p >= width && mask[p - width] === 1) {
        mask[p - width] = 2;
        queue[end++] = p - width;
      }
      if (p < width * (height - 1) && mask[p + width] === 1) {
        mask[p + width] = 2;
        queue[end++] = p + width;
      }
    }
    if (end < minimumArea) for (let j = 0; j < end; j++) mask[queue[j]] = 0;
  }
  for (let i = 0; i < mask.length; i++) mask[i] = Number(mask[i] === 2);
  return mask;
}

export function autoThreshold(gray, invert = false) {
  const counts = new Uint32Array(256);
  let total = 0;
  for (const v of gray) {
    const n = invert ? 255 - v : v;
    counts[n]++;
    total += n;
  }
  let sum = 0,
    weight = 0,
    best = -1,
    low = 0,
    high = 0;
  for (let i = 0; i < 255; i++) {
    weight += counts[i];
    sum += counts[i] * i;
    if (!weight || weight === gray.length) continue;
    const difference = sum / weight - (total - sum) / (gray.length - weight);
    const variance = weight * (gray.length - weight) * difference ** 2;
    if (variance > best) {
      best = variance;
      low = high = i;
    } else if (variance === best) high = i;
  }
  return best < 0 ? 128 : Math.round((low + high) / 2);
}

export function maskForPath(path, width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (path) ctx.fill(new Path2D(path), 'evenodd');
  const pixels = ctx.getImageData(0, 0, width, height).data;
  const mask = new Uint8Array(width * height);
  for (let i = 0; i < mask.length; i++) mask[i] = Number(pixels[4 * i + 3] >= 128);
  return mask;
}

export function suggestStart(mask, width, height, physicalWidth, requested) {
  const scale = width / physicalWidth;
  // City-block distance finds the centre of the nearest piece of tape.
  // The distance term prevents picking a boundary pixel as the start.
  const depth = new Uint16Array(mask.length);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (mask[i]) depth[i] = 1 + Math.min(x ? depth[i - 1] : 0, y ? depth[i - width] : 0);
    }
  for (let y = height - 1; y >= 0; y--)
    for (let x = width - 1; x >= 0; x--) {
      const i = y * width + x;
      if (depth[i])
        depth[i] = Math.min(
          depth[i],
          1 + (x === width - 1 ? 0 : depth[i + 1]),
          1 + (y === height - 1 ? 0 : depth[i + width]),
        );
    }
  const aim = requested || { x: width / 2, y: height * 0.72 };
  let best = -Infinity,
    chosen = -1;
  for (let i = 0; i < depth.length; i++) {
    if (!depth[i]) continue;
    const x = i % width,
      y = Math.floor(i / width);
    const score = -Math.hypot(x - aim.x, y - aim.y) + Math.min(depth[i], scale * 0.018) * 2.5;
    if (score > best) {
      best = score;
      chosen = i;
    }
  }
  if (chosen === -1) return null;
  const x = (chosen % width) + 0.5,
    y = Math.floor(chosen / width) + 0.5;
  const radius = Math.max(6, Math.round(scale * 0.065));
  let xx = 0,
    yy = 0,
    xy = 0,
    sx = 0,
    sy = 0,
    n = 0;
  for (let py = Math.max(0, Math.floor(y - radius)); py < Math.min(height, y + radius); py++) {
    for (let px = Math.max(0, Math.floor(x - radius)); px < Math.min(width, x + radius); px++) {
      const dx = px + 0.5 - x,
        dy = py + 0.5 - y;
      if (dx * dx + dy * dy > radius * radius || !mask[py * width + px]) continue;
      xx += dx * dx;
      yy += dy * dy;
      xy += dx * dy;
      sx += dx;
      sy += dy;
      n++;
    }
  }
  const phi = 0.5 * Math.atan2(2 * (xy - (sx * sy) / n), xx - yy - (sx * sx - sy * sy) / n);
  let angle = (Math.atan2(Math.cos(phi), -Math.sin(phi)) * 180) / Math.PI;
  if (Math.abs(Math.cos(phi)) < 0.25 && Math.sin(phi) > 0) angle += 180;
  return { x, y, angle: (Math.round(angle) + 360) % 360 };
}

export function makeSvg(draft) {
  const { width, height, physicalWidth, path, marker } = draft;
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' +
    width +
    ' ' +
    height +
    '" width="' +
    width +
    '" height="' +
    height +
    '" data-line-lab="1" data-width-metres="' +
    physicalWidth +
    '" data-start="' +
    [marker.x, marker.y, marker.angle].join(' ') +
    '"><rect width="100%" height="100%" fill="#fff"/><path data-ink="1" fill="#141819" fill-rule="evenodd" d="' +
    path +
    '"/></svg>'
  );
}

export function readMapSvg(text) {
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const root = doc.documentElement;
  if (root.localName !== 'svg' || root.getAttribute('data-line-lab') !== '1')
    throw new Error('請選用實驗室匯出嘅 SVG，或上載 PNG／JPG 相片。');
  const [, , width, height] = (root.getAttribute('viewBox') || '').trim().split(/\s+/).map(Number);
  const physicalWidth = Number(root.getAttribute('data-width-metres'));
  if (
    ![width, height].every((v) => Number.isInteger(v) && v > 0 && v <= 1024) ||
    !Number.isFinite(physicalWidth) ||
    physicalWidth < 0.3 ||
    physicalWidth > 12
  )
    throw new Error('SVG 嘅畫布尺寸無效。');
  const path = root.querySelector('path[data-ink="1"]')?.getAttribute('d') || '';
  // Only our numeric outline syntax enters the newly constructed document.
  if (!/^M[MLZ\d .-]+Z$/.test(path)) throw new Error('SVG 入面未有可讀嘅賽道線。');
  const corners = path.matchAll(/([ML])(-?[\d.]+) (-?[\d.]+)/g);
  for (const [, , rawX, rawY] of corners) {
    const x = Number(rawX),
      y = Number(rawY);
    if (!Number.isFinite(x + y) || x < 0 || y < 0 || x > width || y > height)
      throw new Error('SVG 賽道座標超出畫布。');
  }
  const [x, y, angle] = (root.getAttribute('data-start') || '').trim().split(/\s+/).map(Number);
  const marker =
    [x, y, angle].every(Number.isFinite) && x >= 0 && y >= 0 && x <= width && y <= height
      ? { x, y, angle: ((angle % 360) + 360) % 360 }
      : null;
  return { width, height, physicalWidth, path, marker };
}
// Exposed with the validator so the same rejection is explained in either
// classroom language without changing how imported SVG data is sanitised.
export const VECTOR_MESSAGES = {
  '賽道邊界未能連接。': 'The track outline has an open boundary.',
  '請選用實驗室匯出嘅 SVG，或上載 PNG／JPG 相片。': 'Choose an SVG exported by this lab, or a PNG or JPG photo.',
  'SVG 嘅畫布尺寸無效。': 'The SVG canvas dimensions are invalid.',
  'SVG 入面未有可讀嘅賽道線。': 'The SVG contains no readable track outline.',
  'SVG 賽道座標超出畫布。': 'The SVG track extends beyond the canvas.',
};

