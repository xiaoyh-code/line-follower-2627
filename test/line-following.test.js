import test from 'node:test';
import assert from 'node:assert/strict';
import {createSimulation, DEFAULT_PARAMS, commandSpeedMs, MOTOR_PROFILE} from '../src/simulation.js';
import {observeLine, sensorRawBit, sensorRegisterByte, updateCommands} from '../src/line-controller.js';
import {makeCourseSampler} from '../src/track.js';

// Stock Arduino power-on settings used by tests of the original program.
const firmwareDefaults = { ...DEFAULT_PARAMS, p: 1, i: 0, d: 0, speed: 10 };

async function withSimulator(check, options) {
  const sim = await createSimulation(options);
  try { await check(sim); }
  finally { sim.dispose(); }
}

function drive(sim, seconds, params = DEFAULT_PARAMS) {
  let lost = 0;
  for (let tick = 0; tick < Math.round(seconds * 100); tick++) {
    sim.step(0.01, params);
    if (sim.state.lineLost) lost++;
  }
  return lost;
}

test('the library example prints S1 first; the packed byte has S1 in bit 0 and black reads high', () => {
  // In the original example 1 0 0 0 1 0 0 0 means black at S1 and S5.
  const state = {sensors: [true, false, false, false, true, false, false, false], lastError: 0};
  assert.equal(state.sensors.map(sensorRawBit).join(''), '10001000');
  assert.equal(sensorRegisterByte(state.sensors), 0x11);
  observeLine(state);
  assert.equal(state.error, -3);
  assert.equal(state.lineLost, false);
  // The same digits written as a binary integer 0b10001000 are black at S4 and S8.
  state.sensors = [false, false, false, true, false, false, false, true];
  assert.equal(sensorRegisterByte(state.sensors), 0x88);
  assert.equal(state.sensors.map(sensorRawBit).join(''), '00010001');
  observeLine(state);
  assert.equal(state.error, 3);
  state.sensors.fill(false);
  observeLine(state);
  assert.equal(sensorRegisterByte(state.sensors), 0x00);
  assert.equal(state.lineLost, true);
  state.sensors.fill(true);
  observeLine(state);
  assert.equal(sensorRegisterByte(state.sensors), 0xff);
  assert.equal(state.lineLost, false);
  assert.equal(state.error, 0);
});

test('the lesson shows the individual PID contributions before the correction limit', () => {
  const state = { error: 4, lastError: 2, integral: 1.96, lineLost: false };
  const gains = { ...DEFAULT_PARAMS, p: 1, i: .5, d: .005, speed: 10 };
  updateCommands(state, gains, .01);
  assert.deepEqual([state.pTerm, state.iTerm, state.dTerm, state.correction], [4, 1, 1, 6]);
  assert.deepEqual([state.leftCommand, state.rightCommand], [16, 4]);
  updateCommands(state, { ...gains, p: 4 }, .01);
  assert.equal(state.pTerm, 16);
  assert.equal(state.correction, 8);
});

test('centred probes acquire the line and default gains complete the course', () => withSimulator(sim => {
  assert.deepEqual(sim.state.sensors, [false, false, false, true, true, false, false, false]);
  assert.deepEqual([DEFAULT_PARAMS.p, DEFAULT_PARAMS.i, DEFAULT_PARAMS.d, DEFAULT_PARAMS.speed], [2, 0, 1.5, 7]);
  assert.equal(sim.state.commandDelayMs, 0);
  assert.equal(sim.state.startOffsetMm, 0);
  const lost = drive(sim, 50);
  assert.equal(lost, 0);
  assert.equal(sim.state.laps, 1);
  assert.ok(sim.state.lapTime > 40 && sim.state.lapTime < 50);
}));

test('zeroing gains during a firmware search releases both targets and the physical turn decays', () => withSimulator(sim => {
  const params = { ...DEFAULT_PARAMS, sensorOrder: 's8-left' };
  sim.reset(undefined, params);
  const s = sim.state;
  while (s.time < 12 && !s.searching) sim.step(.01, params);
  assert.equal(s.searching, true);
  assert.notEqual(s.leftCommand, s.rightCommand);
  const openLoop = { ...params, p: 0, i: 0, d: 0 };
  sim.step(.01, openLoop);
  assert.deepEqual([s.leftCommand, s.rightCommand, s.searching], [params.speed, params.speed, false]);
  assert.deepEqual([s.integral, s.correction, s.derivative], [0, 0, 0]);
  assert.equal(s.leftTargetMs, s.rightTargetMs);
  assert.ok(Math.abs(s.leftWheelSpeed - s.rightWheelSpeed) > .05);
  sim.step(.8, openLoop);
  assert.ok(Math.abs(s.leftWheelSpeed - s.rightWheelSpeed) < .005);
}));

test('zero speed holds position, and reset clears the previous run', () => withSimulator(sim => {
  const {x, y} = sim.state;
  drive(sim, 3, {...DEFAULT_PARAMS, speed: 0});
  assert.ok(Math.hypot(sim.state.x - x, sim.state.y - y) < 0.001);
  drive(sim, 5);
  assert.ok(Math.hypot(sim.state.x - x, sim.state.y - y) > 0.25);
  sim.reset();
  assert.equal(sim.state.time, 0);
  assert.equal(sim.state.laps, 0);
  assert.deepEqual([sim.state.x, sim.state.y], [x, y]);
}));

function shortStrip() {
  // A 1 × 0.5 m mat. The 10 mm stripe sits right of centre, above the axle.
  const width = 400, height = 200;
  const mask = new Uint8Array(width * height);
  for (let row = 12; row <= 60; row++) {
    for (let col = 209; col <= 212; col++) mask[row * width + col] = 1;
  }
  return { kind: 'custom', width, height, physicalWidth: 1, mask, startPose: { x: 0, y: 0, heading: 0 } };
}

test('custom mask uses centred metres, top-left rows and the physical aspect ratio', () => {
  const read = makeCourseSampler(shortStrip());
  assert.equal(read(0.029, 0.159), true);
  for (const [x, y] of [[0.029, -0.159], [-0.029, 0.159], [0.529, 0.159], [0.029, 0.251]]) {
    assert.equal(read(x, y), false);
  }
});

test('one paused period crosses exactly one controller sample from every physics phase', () => withSimulator(sim => {
  for (const initialTime of [0, .0027, .0049, .0061, .0088]) {
    const state = sim.reset();
    sim.step(initialTime);
    let previousTime = state.time;
    let previousSample = state.controlTime ?? 0;
    for (let n = 0; n < 14; n++) {
      sim.step(.010);
      assert.ok(Math.abs(state.time - previousTime - .010) < 1e-10);
      assert.ok(Math.abs(state.controlTime - previousSample - .010) < 1e-10);
      assert.ok(state.time + 1e-10 >= state.controlTime && state.time - state.controlTime < .010);
      previousTime = state.time;
      previousSample = state.controlTime;
    }
  }
}));

test('manual steps retain the sensor sample, PID history and inputs that set the wheel commands', () => withSimulator(sim => {
  const state = sim.setCourse(shortStrip());
  const params = { ...DEFAULT_PARAMS, p: 1, i: .5, d: .005, speed: 10 };
  sim.step(.01, params);
  const firstGains = state.controlGains;
  assert.deepEqual(state.sensors.map(Number), [0, 0, 0, 0, 0, 0, 1, 0]);
  assert.deepEqual([state.previousError, state.previousIntegral, state.error], [0, 0, 5]);
  assert.deepEqual([state.pTerm, state.iTerm, state.dTerm, state.correction], [5, .025, 2.5, 7.525]);
  assert.deepEqual([state.leftCommand, state.rightCommand], [17, 2]);
  sim.step(.01, params);
  assert.equal(state.controlGains, firstGains);
  assert.deepEqual([state.previousError, state.previousIntegral, state.derivative], [5, .05, 0]);
  params.p = 0; params.i = 0; params.d = 0;
  sim.step(.002, params);
  assert.equal(state.controlGains.p, 1);
  sim.step(.008, params);
  assert.equal(state.controlGains.p, 0);
  assert.deepEqual([state.leftCommand, state.rightCommand], [10, 10]);
  sim.reset();
  assert.deepEqual([state.controlTime, state.controlGains, state.previousError, state.previousIntegral], [null, null, null, null]);
}));

test('integral gain changes steering and position, and a stopped controller clears its history', () => withSimulator(sim => {
  sim.step(4, firmwareDefaults);
  const reference = { x: sim.state.x, y: sim.state.y, wheel: sim.state.leftWheelSpeed };
  sim.reset();
  sim.step(4, { ...firmwareDefaults, i: 0.6 });
  assert.ok(Math.abs(sim.state.integral) > 1);
  assert.ok(Math.hypot(sim.state.x - reference.x, sim.state.y - reference.y) > 0.005);
  assert.ok(Math.abs(sim.state.leftWheelSpeed - reference.wheel) > 0.004);
  sim.step(0.01, { ...firmwareDefaults, i: 0.6, speed: 0 });
  assert.equal(sim.state.integral, 0);
  sim.reset();
  assert.equal(sim.state.integral, 0);
}));

test('custom course replacement, loss, reset and restoration use the selected tape', () => withSimulator(sim => {
  const custom = shortStrip();
  sim.step(4, { ...DEFAULT_PARAMS, i: 0.6 });
  const s = sim.setCourse(custom);
  assert.deepEqual([s.time, s.x, s.y, s.integral, s.courseKind, s.canCountLaps], [0, 0, 0, 0, 'custom', false]);
  assert.deepEqual(s.sensors, [false, false, false, false, false, false, true, false]);
  sim.step(0.01, { ...DEFAULT_PARAMS, i: 1, d: 0 });
  assert.ok(s.integral > 0);
  sim.step(0.8, { ...DEFAULT_PARAMS, i: 1, d: 0 });
  assert.equal(s.lineLost, true);
  assert.equal(s.integral, 0);
  assert.equal(s.laps, 0);
  assert.throws(() => sim.setCourse({ ...custom, mask: new Uint8Array(2) }), /Invalid custom course/);
  assert.equal(s.courseKind, 'custom');
  sim.reset();
  assert.equal(s.sensors[6], true);
  sim.setCourse(null);
  assert.equal(s.courseKind, 'default');
  assert.equal(s.canCountLaps, true);
  assert.deepEqual(s.sensors, [false, false, false, true, true, false, false, false]);
}));

test('the classroom controller integrates at saturation and clamps to ±20 even with Ki zero', () => {
  const s = { sensors: [true, false, false, false, false, false, false, false], lastError: 0, integral: 0 };
  observeLine(s);
  for (let i = 0; i < 400; i++) updateCommands(s, { ...firmwareDefaults, p: 4 }, .01);
  assert.equal(s.correction, -8);
  assert.equal(s.integral, -20);
  assert.deepEqual([s.leftCommand, s.rightCommand], [2, 18]);
});

test('native mixer truncates before clamping; search retains last error and uses fixed board commands', () => {
  const s = { sensors: [true, true, true, true, true, true, false, true], lastError: 0, integral: 0 };
  // Seven black probes, all except S7 at +5: weighted error = −5/7.
  observeLine(s);
  updateCommands(s, firmwareDefaults, .01);
  assert.equal(s.error, -5 / 7);
  assert.deepEqual([s.leftCommand, s.rightCommand], [9, 10]);
  s.sensors.fill(false);
  observeLine(s);
  updateCommands(s, firmwareDefaults, .01);
  assert.equal(s.searching, true);
  assert.deepEqual([s.leftCommand, s.rightCommand, s.integral, s.lastError], [3, 23, 0, -5 / 7]);
  updateCommands(s, { ...firmwareDefaults, recovery: false }, .01);
  assert.deepEqual([s.leftCommand, s.rightCommand, s.searching], [10, 10, false]);
  s.sensors[7] = true;
  observeLine(s);
  updateCommands(s, { ...firmwareDefaults, p: 4, speed: 23 }, .01);
  assert.equal(s.derivative, (7 + 5 / 7) / .01);
  assert.deepEqual([s.leftCommand, s.rightCommand], [23, 15]);
});

test('the same board command targets the same shaft RPM and scales linear speed with uploaded wheel radius', async () => {
  const runs = [];
  for (const wheelRadius of [0.034, 0.055]) {
    await withSimulator(sim => {
      sim.step(0.9);
      const a = sim.state.leftAngle;
      sim.step(0.002);
      const shaftSpeed = -(sim.state.leftAngle - a) / 0.002;
      assert.ok(Math.abs(shaftSpeed * wheelRadius - sim.state.leftWheelSpeed) < 0.001);
      const target = commandSpeedMs(DEFAULT_PARAMS.speed, sim.physical);
      assert.ok(Math.abs(sim.state.leftWheelSpeed - target) < 0.02 * target);
      assert.equal(sim.state.leftEncoderCount, Math.trunc(-sim.state.leftAngle * MOTOR_PROFILE.encoderCountsPerTurn / (2 * Math.PI)));
      runs.push(shaftSpeed);
    }, { physical: { wheelRadius } });
  }
  assert.ok(Math.abs(runs[0] - runs[1]) < 0.05);
});

test('changing the wheel spacing changes the physical turn on the same course', async () => {
  const poses = [];
  for (const halfAxle of [0.06, 0.14]) {
    await withSimulator(sim => {
      sim.step(3.9, firmwareDefaults);
      poses.push([sim.state.x, sim.state.y]);
    }, { physical: { halfAxle } });
  }
  assert.ok(Math.hypot(poses[0][0] - poses[1][0], poses[0][1] - poses[1][1]) > 0.005);
});

test('custom course marker stays beneath a custom sensor bank when changing vehicles', () => withSimulator(sim => {
  assert.ok(Math.abs(sim.state.y - (0.1588 - 0.055)) < 1e-8);
  assert.equal(sim.state.lineLost, false);
  // With S1 on the left, a 19 mm pitch puts S6 (28.5 mm right) on the stripe rather than S7.
  assert.deepEqual(sim.state.sensors, [false, false, false, false, false, true, false, false]);
  sim.reset({ x: 0, y: 0, heading: 0 });
  assert.equal(sim.state.lineLost, true);
  sim.reset();
  assert.equal(sim.state.sensors[5], true);
}, { course: shortStrip(), physical: { sensorForward: 0.055, sensorPitch: 0.019 } }));

test('invalid custom dimensions reject before disturbing a running simulation', () => withSimulator(async sim => {
  for (const physical of [{ wheelRadius: NaN }, { halfAxle: 0 }, { sensorPitch: 2 }, { sensorForward: -1 },
    { halfAxle: 0.05, wheelHalfWidth: 0.06 }]) {
    await assert.rejects(createSimulation({ physical }), RangeError);
  }
  sim.step(0.1);
  assert.ok(sim.state.speedMs > 0);
}));

test('the sensor mounting option reverses channels without silently inverting the firmware mixer', () => withSimulator(sim => {
  sim.setCourse(shortStrip());
  sim.step(.01, firmwareDefaults);
  assert.deepEqual([sim.state.error, sim.state.leftCommand, sim.state.rightCommand], [5, 15, 5]);
  assert.deepEqual([sim.state.leftBoardCommand, sim.state.rightBoardCommand], [-15, 5]);
  const params = { ...firmwareDefaults, sensorOrder: 's8-left' };
  sim.reset(undefined, params);
  assert.equal(sim.state.sensors[1], true);
  sim.step(.01, params);
  assert.deepEqual([sim.state.error, sim.state.leftCommand, sim.state.rightCommand], [-5, 5, 15]);
}));

test('off-line duration and longest outage include short losses between animation frames', () => withSimulator(sim => {
  drive(sim, 20, { ...DEFAULT_PARAMS, speed: 23 });
  assert.ok(sim.state.lossCount >= 3);
  assert.ok(sim.state.lostTime > sim.state.longestLoss);
  assert.ok(sim.state.longestLoss > 0.01);
  const pose = { x: 3, y: 2, heading: 0 };
  sim.reset(pose);
  assert.deepEqual([sim.state.lossCount, sim.state.lostTime, sim.state.longestLoss], [0, 0, 0]);
  sim.step(.002);
  assert.deepEqual([sim.state.lossCount, sim.state.lostTime, sim.state.longestLoss], [1, .002, .002]);
  sim.step(.498);
  assert.deepEqual([sim.state.lossCount, sim.state.lostTime, sim.state.longestLoss], [1, .5, .5]);
}));

test('with all gains zero, either recovery setting drives straight beyond the first bend', () => withSimulator(sim => {
  for (const recovery of [true, false]) {
    const params = { ...firmwareDefaults, p: 0, i: 0, d: 0, recovery };
    const s = sim.reset(undefined, params);
    const startY = s.y;
    sim.step(.008, params);
    assert.equal(s.leftCommand, 0);
    sim.step(.002, params);
    assert.equal(s.leftCommand, params.speed);
    sim.step(.02, params);
    assert.ok(s.leftWheelSpeed > 0 && s.leftWheelSpeed < s.leftTargetMs / 3);
    for (let tick = 3; tick < 2400; tick++) {
      sim.step(.01, params);
      assert.equal(s.leftCommand, params.speed);
      assert.equal(s.rightCommand, params.speed);
      assert.equal(s.searching, false);
    }
    assert.equal(s.lossCount, 1);
    assert.equal(s.lineLost, true);
    assert.equal(s.laps, 0);
    assert.ok(s.longestLoss > 18);
    assert.ok(s.x > 4);
    assert.ok(Math.abs(s.y - startY) < .005);
  }
}));
