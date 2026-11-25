import { commandSpeedMs, createSimulation, DEFAULT_PARAMS } from './simulation.js';
import { nearestTrack, TRACK_LENGTH } from './track.js';
import { controlFields } from './control-fields.js';

export const TUNING_TRIALS = 8;
export const TUNING_HORIZON = 24;
const SAMPLE_PERIOD = 0.01;
const COVERAGE_CELL = 0.03;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function snapshot(state) {
  return { ...state, quaternion: [...state.quaternion], sensors: [...state.sensors] };
}

// Sample the actual chassis path. A controller cannot earn forward distance by
// spinning its wheels in place, moving backwards, or crossing the unmarked mat.
function evaluate(sim, params, isDefault) {
  const s = sim.reset(undefined, params);
  let previousX = s.x;
  let previousY = s.y;
  let previousOnLine = !s.lineLost;
  let previousArc = isDefault ? nearestTrack(s.x, s.y).fraction * TRACK_LENGTH : 0;
  let previousDifference = 0;
  let onLineDistance = 0, pathProgress = 0, squaredError = 0, visible = 0, wheelVariation = 0;
  const frames = [snapshot(s)];
  const coverage = new Map();
  const steps = Math.round(TUNING_HORIZON / SAMPLE_PERIOD);
  for (let tick = 1; tick <= steps; tick++) {
    sim.step(SAMPLE_PERIOD, params);
    const [qx, qy, qz, qw] = s.quaternion;
    const forwardX = 2 * (qx * qy - qz * qw), forwardY = 1 - 2 * (qx * qx + qz * qz);
    const dx = s.x - previousX, dy = s.y - previousY;
    const forward = Math.max(0, dx * forwardX + dy * forwardY);
    const active = s.sensors.filter(Boolean).length;
    if (active) {
      visible++;
      squaredError += s.error ** 2;
    }
    // More than four active probes may indicate an intersection or a solid
    // patch. A completely filled mat provides no directional line signal.
    const confidence = clamp((8 - active) / 4, 0, 1);
    const distance = active && previousOnLine ? confidence * forward : 0;
    onLineDistance += distance;
    if (isDefault) {
      const arc = nearestTrack(s.x, s.y).fraction * TRACK_LENGTH;
      let advance = arc - previousArc;
      if (advance < -TRACK_LENGTH / 2) advance += TRACK_LENGTH;
      if (advance > TRACK_LENGTH / 2) advance -= TRACK_LENGTH;
      pathProgress += clamp(advance, -distance, distance);
      previousArc = arc;
    } else if (distance > 0) {
      // Imported/drawn courses can branch or end. Count spatial coverage, with
      // a bounded allowance in each cell to discount repeated search circles.
      const key = Math.floor(s.x / COVERAGE_CELL) + ',' + Math.floor(s.y / COVERAGE_CELL);
      const used = coverage.get(key) || 0;
      const increment = Math.min(distance, Math.max(0, COVERAGE_CELL * Math.SQRT2 - used));
      coverage.set(key, used + increment);
      pathProgress += increment;
    }
    const difference = s.rightWheelSpeed - s.leftWheelSpeed;
    wheelVariation += Math.abs(difference - previousDifference);
    previousX = s.x; previousY = s.y;
    previousOnLine = Boolean(active); previousDifference = difference;
    // Preserve every 10 ms control reading and its corresponding pose. A
    // one-tick sensor transition must still be available during slow replay.
    frames.push(snapshot(s));
  }

  const targetSpeed = commandSpeedMs(params.speed, sim.physical);
  const targetDistance = targetSpeed * TUNING_HORIZON;
  pathProgress = Math.max(0, pathProgress);
  const coverageRatio = targetDistance > 0 ? clamp(pathProgress / targetDistance, 0, 1) : 0;
  const rmsError = visible ? Math.sqrt(squaredError / visible) : 7;
  const lossFraction = clamp(s.lostTime / TUNING_HORIZON, 0, 1);
  const stability = 1 / (1 + wheelVariation / (TUNING_HORIZON * (1 + targetSpeed)));
  const tracking = 1 - rmsError / 7;
  const quality = 0.35 + 0.30 * (1 - lossFraction) + 0.25 * tracking + 0.10 * stability;
  const score = Math.round(1000 * coverageRatio * quality) / 10;
  return { params, score, horizon: TUNING_HORIZON, metrics: {
    lossFraction, lostTime: s.lostTime, longestLoss: s.longestLoss, lossCount: s.lossCount,
    rmsError, onLineDistance, pathProgress, stability,
  }, frames };
}

// Every replayable candidate must also be exactly representable by the manual controls.
const gainFields = controlFields.filter(field => field.key !== 'speed');
function gains(p, i, d) {
  const result = { p, i, d };
  for (const { key, min, max, step, digits } of gainFields) {
    const bounded = clamp(result[key], min, max);
    result[key] = Number((min + Math.round((bounded - min) / step) * step).toFixed(digits));
  }
  return result;
}

function propose(history, bestIndex) {
  if (!history.length) return gains(0, 0, 0);
  const champion = history[bestIndex];
  const { p, i, d } = champion.params;
  const { lossFraction, rmsError } = champion.metrics;
  // First obtain steering authority from the measured baseline, then bracket P
  // and probe the derivative and integral terms against the measured champion.
  switch (history.length) {
    case 1: return gains(0.6 + 0.12 * rmsError + 0.9 * lossFraction, 0, 0);
    case 2: return gains(Math.max(0.4, p * 1.7), i, d);
    case 3: return gains(Math.max(0.2, p * 0.65), i, d);
    case 4: return gains(p, i, 0.005 + 0.0025 * rmsError);
    case 5: return gains(p, 0.15 + 0.08 * rmsError, d);
    case 6: {
      const tried = history.filter(t => t.params.p === p && t.params.i === i).map(t => t.params.d);
      return gains(p, i, Math.max(0.02, ...tried.map(value => value + 0.01)));
    }
    default: {
      // Use neighbouring scores on each parameter to select the best untried
      // local refinement. All scores come from this course and this vehicle.
      const neighbours = [
        gains(p + 0.2, i, d), gains(p - 0.2, i, d), gains(p, i + 0.1, d), gains(p, i - 0.1, d),
        gains(p, i, d + 0.01), gains(p, i, d - 0.01),
      ];
      const distance = (a, b) => (a.p - b.p) ** 2 + (2 * (a.i - b.i)) ** 2 + (40 * (a.d - b.d)) ** 2;
      let best = null, highest = -Infinity;
      for (const candidate of neighbours) {
        if (history.some(t => distance(t.params, candidate) === 0)) continue;
        let sum = 0, weights = 0;
        for (const t of history) {
          const weight = 1 / (0.02 + distance(t.params, candidate));
          sum += t.score * weight;
          weights += weight;
        }
        const estimate = sum / weights;
        if (estimate > highest) { highest = estimate; best = candidate; }
      }
      return best ?? gains(p, i + 0.3, d + 0.01);
    }
  }
}

export async function runTuning({
  course = null, physical, speed, sensorOrder = DEFAULT_PARAMS.sensorOrder, recovery = DEFAULT_PARAMS.recovery,
  commandDelayMs = 0, startOffsetMm = 0,
}, onTrial = () => {}) {
  if (!Number.isInteger(speed) || speed <= 0 || speed > 23) {
    const error = new RangeError('Base speed command must be a whole number from 1 to 23.');
    error.code = 'INVALID_SPEED';
    throw error;
  }
  const sim = await createSimulation({ course, physical });
  const trials = [];
  let bestIndex = 0;
  try {
    for (let index = 0; index < TUNING_TRIALS; index++) {
      const params = { ...propose(trials, bestIndex), speed, sensorOrder, recovery, commandDelayMs, startOffsetMm };
      const trial = { index, ...evaluate(sim, params, !course) };
      trial.improved = index > 0 && trial.score > trials[bestIndex].score;
      if (trial.improved) bestIndex = index;
      trial.bestIndex = bestIndex;
      trials.push(trial);
      onTrial(trial);
    }
    return { trials, bestIndex, total: TUNING_TRIALS, horizon: TUNING_HORIZON };
  } finally {
    sim.dispose();
  }
}
