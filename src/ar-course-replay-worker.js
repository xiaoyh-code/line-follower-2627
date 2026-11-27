import { CLASSROOM_COMMAND_DELAY_MS, CONTROL_PERIOD } from './line-controller.js';
import { createSimulation, DEFAULT_PARAMS } from './simulation.js';

const RECORD_SECONDS = 20;
// Sample at 25 fps while retaining every classroom control and physics step.
const SAMPLE_PERIOD = 4 * CONTROL_PERIOD;

function readFrame(state, time) {
  const { x, y, z, quaternion, leftAngle, rightAngle } = state;
  return { time, x, y, z, quaternion: [...quaternion], leftAngle, rightAngle };
}

let simulation;

self.onmessage = async ({ data: { course = null, physical, params } }) => {
  try {
    const settings = { ...DEFAULT_PARAMS, commandDelayMs: CLASSROOM_COMMAND_DELAY_MS, ...params };
    if (simulation) simulation.reset(undefined, settings);
    else simulation = await createSimulation({ course, physical, params: settings });
    const frames = [readFrame(simulation.state, 0)];
    const frameCount = Math.round(RECORD_SECONDS / SAMPLE_PERIOD);
    for (let frame = 1; frame <= frameCount; frame++) {
      frames.push(readFrame(simulation.step(SAMPLE_PERIOD, settings), frame * SAMPLE_PERIOD));
    }
    const { lossCount, lostTime } = simulation.state;
    self.postMessage({ frames, duration: RECORD_SECONDS, lossCount, lostTime });
  } catch (error) {
    self.postMessage({ error: String(error?.message || error) });
  }
};
