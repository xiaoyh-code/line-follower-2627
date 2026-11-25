import { CONTROL_PERIOD, DEFAULT_PARAMS, observeLine, updateCommands } from './line-controller.js';

// The probe exercise uses the worked example to expose all three PID terms.
export const PROBE_DEFAULTS = Object.freeze({ p: 1, i: 0.5, d: 0.005, speed: 10 });

export function createProbeLab() {
  let ticks;
  let state;

  function reset() {
    ticks = 0;
    state = {
      sensors: Array(8).fill(false), sensorOrder: DEFAULT_PARAMS.sensorOrder,
      controlTime: null, controlGains: null, lastError: 0, integral: 0,
      leftCommand: 0, rightCommand: 0,
    };
    return state;
  }

  function step(mask, params = PROBE_DEFAULTS) {
    if (!Number.isInteger(mask) || mask < 0 || mask > 255) throw new RangeError('Expected an 8-bit sensor register.');
    // Keep the last sampled state intact while assembling the next control update.
    const next = {
      ...state,
      sensors: Array.from({ length: 8 }, (_, i) => Boolean(mask & (1 << i))),
      sensorOrder: params.sensorOrder ?? DEFAULT_PARAMS.sensorOrder,
    };
    observeLine(next);
    updateCommands(next, { ...PROBE_DEFAULTS, ...params }, CONTROL_PERIOD);
    next.controlTime = ++ticks * CONTROL_PERIOD;
    state = next;
    return state;
  }

  reset();
  return { step, reset, get state() { return state; } };
}
