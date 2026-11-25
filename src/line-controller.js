// Classroom F5 sketch: integral is bounded even with Ki=0, and lastError is
// retained across a loss. The board accepts signed integer speed commands.
export const DEFAULT_PARAMS = Object.freeze({
  p: 2, i: 0, d: 1.5, speed: 7, recovery: true, sensorOrder: 's1-left',
});
export const MAX_COMMAND = 23;
export const CLASSROOM_COMMAND_DELAY_MS = 120;
export const CONTROL_PERIOD = 0.010;
const MAX_CORRECTION = 8;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const command = value => clamp(Math.trunc(value), 0, MAX_COMMAND);

// state.sensors is indexed S1…S8 and is true where the probe sees black tape.
// The configured classroom board returns 1 for black and 0 for white in register 5.
export const sensorRawBit = onBlack => onBlack ? 1 : 0;

export function sensorRegisterByte(sensors) {
  return sensors.reduce((byte, onBlack, channel) => byte | (sensorRawBit(onBlack) << channel), 0);
}

export function observeLine(state) {
  let sum = 0, count = 0;
  for (let channel = 0; channel < 8; channel++) {
    if (state.sensors[channel]) {
      sum += 2 * channel - 7;
      count++;
    }
  }
  state.lineLost = count === 0;
  state.error = count ? sum / count : state.lastError;
}

export function updateCommands(state, params, dt) {
  const base = command(params.speed ?? DEFAULT_PARAMS.speed);
  const p = params.p ?? DEFAULT_PARAMS.p;
  const i = params.i ?? DEFAULT_PARAMS.i;
  const d = params.d ?? DEFAULT_PARAMS.d;
  // The last control inputs belong to this sample even if the sliders are
  // edited while paused. Unchanged gains are shared by recorded replay frames.
  const gains = state.controlGains;
  if (!gains || p !== gains.p || i !== gains.i || d !== gains.d || base !== gains.speed) {
    state.controlGains = Object.freeze({ p, i, d, speed: base });
  }
  state.previousError = state.lastError;
  state.previousIntegral = state.integral;
  state.recovery = params.recovery ?? DEFAULT_PARAMS.recovery;
  state.searching = false;
  state.pTerm = state.iTerm = state.dTerm = 0;
  let left = base, right = base;
  if (!base) {
    // The classroom simulation explicitly treats a zero base as a stop.
    state.integral = state.lastError = state.correction = state.derivative = 0;
  } else if (p === 0 && i === 0 && d === 0) {
    // Open-loop classroom trial. Continue observing the tape but do not steer,
    // including the sketch's fixed 3/23 search when all eight probes see white.
    state.integral = state.correction = state.derivative = 0;
    if (!state.lineLost) state.lastError = state.error;
  } else if (state.lineLost) {
    state.integral = 0;
    if (state.recovery && state.lastError !== 0) {
      state.searching = true;
      left = state.lastError < 0 ? 3 : MAX_COMMAND;
      right = state.lastError < 0 ? MAX_COMMAND : 3;
    }
  } else {
    state.integral = clamp(state.integral + state.error * dt, -20, 20);
    state.derivative = (state.error - state.lastError) / dt;
    state.pTerm = p * state.error;
    state.iTerm = i * state.integral;
    state.dTerm = d * state.derivative;
    state.correction = clamp(state.pTerm + state.iTerm + state.dTerm, -MAX_CORRECTION, MAX_CORRECTION);
    state.lastError = state.error;
    left = command(base + state.correction);
    right = command(base - state.correction);
  }
  state.leftCommand = left;
  state.rightCommand = right;
}
