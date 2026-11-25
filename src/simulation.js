import loadMujoco from '@mujoco/mujoco';
import { makeCourseSampler, makeSensorPositions, nearestTrack, START_POSE } from './track.js';
import { CONTROL_PERIOD, DEFAULT_PARAMS, MAX_COMMAND, observeLine, updateCommands } from './line-controller.js';

export { DEFAULT_PARAMS };
export const DEFAULT_PHYSICAL = Object.freeze({
  wheelRadius: 0.034, halfAxle: 0.09065, sensorForward: 0.1588,
  sensorPitch: 0.0115, casterForward: 0.1087, wheelHalfWidth: 0.01325,
});
export const PHYSICAL_LIMITS = Object.freeze({
  wheelRadius: [0.005, 0.15], halfAxle: [0.015, 0.30], sensorForward: [0.01, 0.60],
  sensorPitch: [0.001, 0.05], casterForward: [0.005, 0.60], wheelHalfWidth: [0.001, 0.12],
});

const STEP = 0.002;
const CONTROL_STEPS = Math.round(CONTROL_PERIOD / STEP);
const CONTROL_MS = CONTROL_PERIOD * 1000;
const SENSOR_HEIGHT = 0.0101; // Lowest optical components in the Fusion assembly.
// Hiwonder plastic-shaft 1:42 TT profile at 6 V. The board's 4x decoding
// is provisional until checked against a real revolution. Register 0x33 sets
// counts per 10 ms. The estimated 90 ms response still needs a bench step test.
export const MOTOR_PROFILE = Object.freeze({
  encoderCountsPerTurn: 1008, noLoadRpm: 150, torqueLimitNm: 1.2 * 0.0980665,
  commandPeriodSeconds: 0.01, responseTimeSeconds: 0.09,
});
const MAX_SHAFT_SPEED = MOTOR_PROFILE.noLoadRpm * 2 * Math.PI / 60;
const COMMAND_RESPONSE = -Math.expm1(-STEP / MOTOR_PROFILE.responseTimeSeconds);
const SERVO_GAIN = 0.018; // Estimated torque per rad/s speed error, not the board's internal PID.
const clamp = (x, min, max) => Math.min(max, Math.max(min, x));

export function commandSpeedMs(command, physical = DEFAULT_PHYSICAL) {
  const rate = clamp(Math.trunc(command), -MAX_COMMAND, MAX_COMMAND) * 2 * Math.PI /
    (MOTOR_PROFILE.encoderCountsPerTurn * MOTOR_PROFILE.commandPeriodSeconds);
  return clamp(rate, -MAX_SHAFT_SPEED, MAX_SHAFT_SPEED) * physical.wheelRadius;
}

function validateStartSettings(params) {
  const delay = params.commandDelayMs ?? 0;
  if (!Number.isInteger(delay) || delay < 0 || delay > 200 || delay % CONTROL_MS !== 0) {
    throw new RangeError('Command delay must be 0–200 ms in 10 ms increments');
  }
  if (!Number.isFinite(params.startOffsetMm ?? 0)) {
    throw new RangeError('Starting offset must be a finite distance in millimetres');
  }
}

function resolvePhysical(overrides) {
  if (overrides != null && (typeof overrides !== 'object' || Array.isArray(overrides))) {
    throw new TypeError('Expected vehicle dimensions in metres');
  }
  const physical = { ...DEFAULT_PHYSICAL, ...overrides };
  if (overrides?.casterForward === undefined) {
    physical.casterForward = DEFAULT_PHYSICAL.casterForward * (physical.sensorForward / DEFAULT_PHYSICAL.sensorForward);
  }
  if (overrides?.wheelHalfWidth === undefined) {
    const widthScale = Math.min(physical.halfAxle / DEFAULT_PHYSICAL.halfAxle, physical.wheelRadius / DEFAULT_PHYSICAL.wheelRadius);
    physical.wheelHalfWidth = DEFAULT_PHYSICAL.wheelHalfWidth * widthScale;
  }
  for (const [key, [min, max]] of Object.entries(PHYSICAL_LIMITS)) {
    const value = physical[key];
    if (!Number.isFinite(value) || value < min || value > max) {
      throw new RangeError(`Invalid ${key}: expected ${min} to ${max} metres`);
    }
  }
  if (physical.wheelHalfWidth >= physical.halfAxle) throw new RangeError('Wheel widths overlap at the axle centre');
  return Object.freeze(physical);
}

function vehicleXML(physical) {
  const { wheelRadius, halfAxle, wheelHalfWidth, casterForward } = physical;
  const sx = halfAxle / DEFAULT_PHYSICAL.halfAxle;
  const sy = casterForward / DEFAULT_PHYSICAL.casterForward;
  const sz = wheelRadius / DEFAULT_PHYSICAL.wheelRadius;
  // Scale the three second moments of the reference chassis while retaining its assumed mass.
  const dx = 0.000975 * (sx * sx - 1);
  const dy = 0.001825 * (sy * sy - 1);
  const dz = 0.000175 * (sz * sz - 1);
  const wheel = (name, x) => `
  <body name="${name}" pos="${x} 0 ${wheelRadius}">
    <joint name="${name}" type="hinge" axis="-1 0 0" damping="0.00002" armature="0.00003"/>
    <geom type="cylinder" size="${wheelRadius} ${wheelHalfWidth}" quat="0.70710678 0 0.70710678 0"
          mass="0.035" friction="1.1 0.001 0.0001"/>
  </body>`;

  return `
<mujoco model="Fusion line follower">
  <compiler angle="radian"/>
  <option timestep="${STEP}" integrator="implicitfast"/>
  <default><geom condim="3" solref="0.009 1"/></default>
  <worldbody>
    <geom name="floor" type="plane" size="3 2 0.1" friction="0.85 0.001 0.0001"/>
    <body name="chassis">
      <freejoint/>
      <!-- Mass, friction and torque approximate a classroom robot. -->
      <inertial pos="0 ${0.041 * sy} ${0.045 * sz}" mass="0.46" diaginertia="${0.002 + dy + dz} ${0.00115 + dx + dz} ${0.0028 + dx + dy}"/>
      <geom type="box" pos="0 ${0.046 * sy} ${0.043 * sz}" size="${0.068 * sx} ${0.095 * sy} ${0.012 * sz}"/>
      <!-- A low-drag sphere approximates the free caster ball. -->
      <geom name="front_caster" type="sphere" pos="0 ${casterForward} ${0.00999 * sz}" size="${0.00966 * sz}" friction="0.012 0.0001 0.0001" priority="1"/>
      ${wheel('left', -halfAxle)}
      ${wheel('right', halfAxle)}
    </body>
  </worldbody>
  <actuator>
    <motor name="left_drive" joint="left"/>
    <motor name="right_drive" joint="right"/>
  </actuator>
</mujoco>`;
}

let enginePromise;
function getEngine() {
  if (!enginePromise) {
    enginePromise = (async () => {
      if (typeof window === 'undefined' && typeof WorkerGlobalScope === 'undefined') return loadMujoco();
      // Asset import lets Vite copy the binary and resolve the GitHub Pages base URL.
      const { default: wasmUrl } = await import('@mujoco/mujoco/mujoco.wasm?url');
      return loadMujoco({ locateFile: () => wasmUrl });
    })().catch(error => {
      enginePromise = undefined;
      throw error;
    });
  }
  return enginePromise;
}

// The local plane at sensor height intersects the track along each reflectance probe's
// downward axis. Store black-tape detections in S1…S8 order; the corresponding
// raw library bit is 1 on black and 0 on the white course background.
function sampleSensors(state, q, tapeAt, sensorPositions, params) {
  const [w, x, y, z] = q.subarray(3, 7);
  const xx = 1 - 2 * (y * y + z * z), xy = 2 * (x * y - z * w), xz = 2 * (x * z + y * w);
  const yx = 2 * (x * y + w * z), yy = 1 - 2 * (x * x + z * z), yz = 2 * (y * z - w * x);
  const zx = 2 * (x * z - w * y), zy = 2 * (y * z + w * x), zz = 1 - 2 * (x * x + y * y);
  state.sensorOrder = params.sensorOrder ?? DEFAULT_PARAMS.sensorOrder;
  for (let i = 0; i < sensorPositions.length; i++) {
    const p = sensorPositions[state.sensorOrder === 's1-left' ? 7 - i : i];
    const height = q[2] + zx * p.x + zy * p.y + zz * SENSOR_HEIGHT;
    const distance = height / zz;
    const cx = q[0] + xx * p.x + xy * p.y + xz * (SENSOR_HEIGHT - distance);
    const cy = q[1] + yx * p.x + yy * p.y + yz * (SENSOR_HEIGHT - distance);
    let black = 0;
    if (zz > 0.25 && distance > 0 && distance <= 0.040) {
      // Five taps approximate the area illuminated by one calibrated probe.
      // Spot size (1.3 mm radial offset at nominal height) and 50% threshold are estimates.
      const spot = 0.0013 * distance / SENSOR_HEIGHT;
      black = Number(tapeAt(cx, cy)) + Number(tapeAt(cx + xx * spot, cy + yx * spot)) +
        Number(tapeAt(cx - xx * spot, cy - yx * spot)) + Number(tapeAt(cx + xy * spot, cy + yy * spot)) +
        Number(tapeAt(cx - xy * spot, cy - yy * spot));
    }
    state.sensors[i] = black >= 3;
  }
  observeLine(state);
}

export async function createSimulation({ onStatus, course = null, physical: overrides, params: initialParams = DEFAULT_PARAMS } = {}) {
  validateStartSettings(initialParams);
  const physical = resolvePhysical(overrides);
  const sensorPositions = makeSensorPositions(physical.sensorForward, physical.sensorPitch);
  let tapeAt = makeCourseSampler(course);
  onStatus?.('Loading MuJoCo');
  const mj = await getEngine();
  const model = mj.MjModel.from_xml_string(vehicleXML(physical));
  let data;
  try {
    data = new mj.MjData(model);
  } catch (error) {
    model.delete();
    throw error;
  }
  const state = {
    x: 0, y: 0, z: 0, headingDeg: 0, quaternion: [0, 0, 0, 1], leftAngle: 0, rightAngle: 0,
    sensors: Array(8).fill(false), time: 0, speedMs: 0, leftWheelSpeed: 0, rightWheelSpeed: 0,
    lineLost: false, laps: 0, lapTime: 0, error: 0, integral: 0, correction: 0, derivative: 0, lastError: 0,
    searching: false, recovery: DEFAULT_PARAMS.recovery, sensorOrder: DEFAULT_PARAMS.sensorOrder,
    leftCommand: 0, rightCommand: 0, leftBoardCommand: 0, rightBoardCommand: 0,
    commandDelayMs: 0, startOffsetMm: 0, leftAppliedCommand: 0, rightAppliedCommand: 0,
    leftTargetMs: 0, rightTargetMs: 0, leftEncoderCount: 0, rightEncoderCount: 0,
    lossCount: 0, lostTime: 0, longestLoss: 0,
    canCountLaps: !course, courseKind: course ? 'custom' : 'default',
  };
  const motorRates = [0, 0];
  const shaftTargets = [0, 0];
  let commandQueue;
  let queueIndex;
  let consecutiveLostSteps = 0;
  let totalLostSteps = 0;
  let maxLostSteps = 0;
  let stepCount = 0;
  let accumulator = 0;
  let nextQuarter = 1;
  let previousFraction = 0;
  let lapStartedAt = 0;
  let disposed = false;

  function readPose() {
    const q = data.qpos;
    const v = data.qvel;
    const [w, x, y, z] = q.subarray(3, 7);
    state.x = q[0]; state.y = q[1]; state.z = q[2];
    state.quaternion[0] = x; state.quaternion[1] = y;
    state.quaternion[2] = z; state.quaternion[3] = w;
    state.leftAngle = -q[7];
    state.rightAngle = -q[8];
    state.leftWheelSpeed = physical.wheelRadius * v[6];
    state.rightWheelSpeed = physical.wheelRadius * v[7];
    const countsPerRadian = MOTOR_PROFILE.encoderCountsPerTurn / (2 * Math.PI);
    // Forward-positive, wiring-normalized encoder telemetry from actual shaft rotation.
    state.leftEncoderCount = Math.trunc(q[7] * countsPerRadian);
    state.rightEncoderCount = Math.trunc(q[8] * countsPerRadian);
    const forwardX = 2 * (x * y - z * w);
    const forwardY = 1 - 2 * (x * x + z * z);
    state.headingDeg = Math.atan2(forwardY, forwardX) * 180 / Math.PI;
    state.speedMs = forwardX * v[0] + forwardY * v[1] + 2 * (y * z + w * x) * v[2];
    state.time = data.time;
  }

  function control(params) {
    sampleSensors(state, data.qpos, tapeAt, sensorPositions, params);
    updateCommands(state, params, CONTROL_PERIOD);
    state.controlTime = stepCount * STEP;
    // Both classroom versions negate the left channel and keep the right
    // positive. The older sketch writes left on M2, the TT revision on M3.
    state.leftBoardCommand = state.leftCommand ? -state.leftCommand : 0;
    state.rightBoardCommand = state.rightCommand;
    state.leftTargetMs = commandSpeedMs(state.leftCommand, physical);
    state.rightTargetMs = commandSpeedMs(state.rightCommand, physical);
    // A classroom delay experiment holds complete wheel-command pairs in order.
    // PID and encoder telemetry retain the issued command for each sensor sample.
    state.leftAppliedCommand = state.leftCommand;
    state.rightAppliedCommand = state.rightCommand;
    if (commandQueue.length) {
      state.leftAppliedCommand = commandQueue[queueIndex];
      state.rightAppliedCommand = commandQueue[queueIndex + 1];
      commandQueue[queueIndex] = state.leftCommand;
      commandQueue[queueIndex + 1] = state.rightCommand;
      queueIndex = (queueIndex + 2) % commandQueue.length;
    }
    shaftTargets[0] = commandSpeedMs(state.leftAppliedCommand, physical) / physical.wheelRadius;
    shaftTargets[1] = commandSpeedMs(state.rightAppliedCommand, physical) / physical.wheelRadius;
  }

  function actuate() {
    const v = data.qvel, ctrl = data.ctrl;
    for (let i = 0; i < 2; i++) {
      motorRates[i] += COMMAND_RESPONSE * (shaftTargets[i] - motorRates[i]);
      const rate = v[6 + i];
      const requested = SERVO_GAIN * (motorRates[i] - rate);
      // Linear DC torque-speed envelope referenced to the catalog torque.
      // Electrical braking is bounded independently of motoring headroom.
      const headroom = requested * rate > 0 ? clamp(1 - Math.abs(rate) / MAX_SHAFT_SPEED, 0, 1) : 1;
      const limit = MOTOR_PROFILE.torqueLimitNm * headroom;
      ctrl[i] = clamp(requested, -limit, limit);
    }
  }

  function scoreLap() {
    const { distance, fraction } = nearestTrack(data.qpos[0], data.qpos[1]);
    if (distance < 0.14) {
      if (nextQuarter <= 3 && Math.abs(fraction - nextQuarter / 4) < 0.035) {
        nextQuarter++;
      } else if (nextQuarter === 4 && previousFraction > 0.9 && fraction < 0.1) {
        state.laps++;
        state.lapTime = data.time - lapStartedAt;
        lapStartedAt = data.time;
        nextQuarter = 1;
      }
    }
    previousFraction = fraction;
  }

  function reset(pose, params = initialParams) {
    if (disposed) return state;
    validateStartSettings(params);
    state.commandDelayMs = params.commandDelayMs ?? 0;
    state.startOffsetMm = pose ? 0 : params.startOffsetMm ?? 0;
    commandQueue = new Int8Array(2 * state.commandDelayMs / CONTROL_MS);
    queueIndex = 0;
    // The editor stores the reference car's axle just behind the selected probe marker.
    const shift = !pose && course ? DEFAULT_PHYSICAL.sensorForward - physical.sensorForward : 0;
    pose = pose ?? course?.startPose ?? START_POSE;
    mj.mj_resetData(model, data);
    // Positive launch offset moves left relative to the selected axle heading.
    const offset = state.startOffsetMm / 1000;
    data.qpos[0] = pose.x - Math.sin(pose.heading) * shift - Math.cos(pose.heading) * offset;
    data.qpos[1] = pose.y + Math.cos(pose.heading) * shift - Math.sin(pose.heading) * offset;
    data.qpos[2] = 0.0005;
    data.qpos[3] = Math.cos(pose.heading / 2);
    data.qpos[6] = Math.sin(pose.heading / 2);
    mj.mj_forward(model, data);
    stepCount = 0;
    accumulator = 0;
    motorRates.fill(0); shaftTargets.fill(0);
    consecutiveLostSteps = 0; totalLostSteps = 0; maxLostSteps = 0;
    nextQuarter = 1;
    previousFraction = 0;
    lapStartedAt = 0;
    state.laps = 0; state.lapTime = 0; state.error = 0; state.integral = 0;
    state.lastError = 0; state.derivative = 0; state.correction = 0; state.searching = false;
    state.pTerm = state.iTerm = state.dTerm = null;
    state.controlTime = state.controlGains = state.previousError = state.previousIntegral = null;
    state.recovery = params.recovery ?? DEFAULT_PARAMS.recovery;
    state.leftCommand = 0; state.rightCommand = 0; state.leftTargetMs = 0; state.rightTargetMs = 0;
    state.leftBoardCommand = 0; state.rightBoardCommand = 0;
    state.leftAppliedCommand = 0; state.rightAppliedCommand = 0;
    state.lossCount = 0; state.longestLoss = 0; state.lostTime = 0;
    readPose();
    sampleSensors(state, data.qpos, tapeAt, sensorPositions, params);
    return state;
  }

  function setCourse(nextCourse = null, params = initialParams) {
    if (disposed) return state;
    // Validate first so a failed import preserves the current course and run.
    validateStartSettings(params);
    tapeAt = makeCourseSampler(nextCourse);
    course = nextCourse;
    state.canCountLaps = !course;
    state.courseKind = course ? 'custom' : 'default';
    return reset(undefined, params);
  }

  function step(dt, params = initialParams) {
    if (disposed || !Number.isFinite(dt) || dt <= 0) return state;
    accumulator += dt;
    // Integrate at a fixed 500 Hz, independently of animation-frame frequency.
    while (accumulator + 1e-12 >= STEP) {
      actuate();
      mj.mj_step(model, data);
      if (state.lineLost) {
        if (!consecutiveLostSteps) state.lossCount++;
        consecutiveLostSteps++;
        totalLostSteps++;
        maxLostSteps = Math.max(maxLostSteps, consecutiveLostSteps);
      } else consecutiveLostSteps = 0;
      stepCount++;
      // handleStart() records micros(). The first integer board command is
      // written after one complete control period, then held until the next.
      if (stepCount % CONTROL_STEPS === 0) control(params);
      if (state.canCountLaps && stepCount % 25 === 0) scoreLap();
      accumulator -= STEP;
    }
    readPose();
    state.lostTime = totalLostSteps * STEP;
    state.longestLoss = maxLostSteps * STEP;
    return state;
  }

  reset();
  onStatus?.('MuJoCo ready');
  return { state, physical, step, reset, setCourse, dispose() {
    if (disposed) return;
    disposed = true;
    data.delete();
    model.delete();
  } };
}
