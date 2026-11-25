import test from 'node:test';
import assert from 'node:assert/strict';
import { runTuning, TUNING_HORIZON, TUNING_TRIALS } from '../src/tuning.js';
import { createSimulation, DEFAULT_PARAMS } from '../src/simulation.js';
import { controlFields } from '../src/control-fields.js';

test('tuning compares fixed-start physical trials, retains a genuine improvement and records each round', async () => {
  const streamed = [];
  const speed = DEFAULT_PARAMS.speed;
  const run = await runTuning({ speed }, trial => streamed.push(trial.index));
  assert.deepEqual(streamed, Array.from({ length: TUNING_TRIALS }, (_, i) => i));
  const baseline = run.trials[0], best = run.trials[run.bestIndex];
  assert.deepEqual(baseline.params, { ...DEFAULT_PARAMS, p: 0, i: 0, d: 0, speed, commandDelayMs: 0, startOffsetMm: 0 });
  assert.ok(baseline.metrics.lossFraction > 0.1);
  assert.ok(best.metrics.lossFraction < baseline.metrics.lossFraction);
  assert.ok(best.metrics.pathProgress > baseline.metrics.pathProgress * 1.1);
  assert.ok(best.score > baseline.score + 20);
  assert.ok(run.trials.some(t => t.params.i > 0));
  assert.ok(run.trials.some(t => t.params.d > 0));
  assert.equal(new Set(run.trials.map(t => JSON.stringify(t.params))).size, TUNING_TRIALS);
  const initial = baseline.frames[0];
  for (const t of run.trials) {
    assert.equal(t.params.speed, speed);
    for (const { key, min, max, step } of controlFields) {
      const value = t.params[key];
      assert.ok(value >= min && value <= max);
      const steps = (value - min) / step;
      assert.ok(Math.abs(steps - Math.round(steps)) < 1e-8, key + ' must fit the student input step');
    }
    assert.equal(t.metrics.lossCount, t.frames.at(-1).lossCount);
    assert.equal(t.metrics.longestLoss, t.frames.at(-1).longestLoss);
    assert.ok(Math.abs(t.metrics.lossFraction * t.horizon - t.frames.at(-1).lostTime) < 1e-8);
    assert.deepEqual(t.frames[0], initial);
    assert.ok(t.frames.at(-1).time > TUNING_HORIZON - 0.001);
    assert.equal(t.frames.length, 2401);
    for (let k = 1; k < t.frames.length; k++) {
      assert.ok(Math.abs(t.frames[k].time - t.frames[k - 1].time - 0.01) < 1e-8);
    }
    assert.equal(t.score <= 100 && t.score >= 0, true);
    assert.equal(run.trials[t.bestIndex].score, Math.max(...run.trials.slice(0, t.index + 1).map(v => v.score)));
  }
  for (const frame of baseline.frames) {
    assert.equal(frame.leftCommand, frame.rightCommand);
    assert.equal(frame.searching, false);
  }
  assert.equal(baseline.metrics.lossCount, 1);
  assert.ok(baseline.metrics.longestLoss > 10);
  // A complete replay must account for the same losses as the 100 Hz controller.
  for (const trial of run.trials) {
    // Each reading remains active for the interval following its timestamp.
    assert.ok(Math.abs(trial.frames.slice(0, -1).filter(s => s.lineLost).length / 100 - trial.metrics.lostTime) < 1e-8);
    for (const frame of trial.frames) assert.equal(frame.sensors.some(Boolean), !frame.lineLost);
  }
});

test('an unmarked custom course never scores for moving away from its start', async () => {
  const custom = { kind: 'custom', width: 80, height: 40, physicalWidth: 0.8, mask: new Uint8Array(3200),
    startPose: { x: 0.13, y: -0.04, heading: 0.6 } };
  const run = await runTuning({ course: custom, physical: { wheelRadius: 0.046, sensorForward: 0.14 }, speed: 15 });
  assert.equal(run.bestIndex, 0);
  for (const t of run.trials) {
    assert.equal(t.frames[0].courseKind, 'custom');
    assert.equal(t.frames[0].lineLost, true);
    assert.ok(Math.abs(t.frames[0].x - (0.13 - Math.sin(0.6) * (0.1588 - 0.14))) < 1e-8);
    assert.ok(Math.abs(t.metrics.lossFraction - 1) < 1e-8);
    assert.equal(t.metrics.pathProgress, 0);
    assert.equal(t.score, 0);
    assert.equal(t.improved, false);
  }
});

test('invalid or stationary requested tuning speed is rejected', async () => {
  for (const speed of [0, -1, 10.5, 24, 61, NaN]) await assert.rejects(runTuning({ speed }), RangeError);
});

test('AI trials reproduce the manual mounting, recovery, command delay and starting offset', async () => {
  const options = { ...DEFAULT_PARAMS, speed: 23, sensorOrder: 's8-left', recovery: false, commandDelayMs: 80, startOffsetMm: 12 };
  const run = await runTuning(options);
  const trial = run.trials[1]; // Nonzero gain makes a reversed mounting directly observable.
  assert.equal(trial.params.sensorOrder, options.sensorOrder);
  assert.equal(trial.params.recovery, options.recovery);
  for (const candidate of run.trials) {
    assert.equal(candidate.params.commandDelayMs, options.commandDelayMs);
    assert.equal(candidate.params.startOffsetMm, options.startOffsetMm);
  }
  const sim = await createSimulation();
  try {
    sim.reset(undefined, { ...options, ...trial.params });
    for (let i = 0; i < TUNING_HORIZON * 100; i++) sim.step(0.01, { ...options, ...trial.params });
    const last = trial.frames.at(-1);
    assert.ok(Math.abs(sim.state.x - last.x) < 1e-8);
    assert.ok(Math.abs(sim.state.y - last.y) < 1e-8);
    assert.equal(sim.state.lossCount, last.lossCount);
    assert.equal(sim.state.lostTime, last.lostTime);
  } finally {
    sim.dispose();
  }
});

test('fast P-only runs expose loss, and disabling firmware search allows sustained departure', async () => {
  const sim = await createSimulation();
  function measure(overrides) {
    const params = { ...DEFAULT_PARAMS, p: 1, i: 0, d: 0, speed: 10, ...overrides };
    sim.reset(undefined, params);
    const { lostTime, longestLoss, lossCount } = sim.step(TUNING_HORIZON, params);
    return { lostTime, longestLoss, lossCount };
  }
  try {
    const normal = measure({});
    const fast = measure({ speed: 23 });
    const unsteered = measure({ p: 0 });
    const noSearch = measure({ p: 0, recovery: false });
    const assisted = measure({ p: 0.1 });
    assert.ok(fast.lostTime > normal.lostTime + 0.5);
    assert.ok(fast.lossCount > 1);
    assert.deepEqual(unsteered, noSearch);
    assert.ok(unsteered.longestLoss > 10 && unsteered.lossCount === 1);
    assert.ok(assisted.lossCount > 1 && assisted.longestLoss < 1);
  } finally {
    sim.dispose();
  }
});
