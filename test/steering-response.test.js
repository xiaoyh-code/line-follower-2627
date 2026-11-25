import test from 'node:test';
import assert from 'node:assert/strict';
import { createSimulation, DEFAULT_PARAMS } from '../src/simulation.js';
import { CLASSROOM_COMMAND_DELAY_MS } from '../src/line-controller.js';
import { START_POSE } from '../src/track.js';

test('command transport preserves issued pairs and starts with an empty queue on every reset', async () => {
  const params = { ...DEFAULT_PARAMS, p: 2, d: 1.5, speed: 7, commandDelayMs: CLASSROOM_COMMAND_DELAY_MS, startOffsetMm: 15 };
  const sim = await createSimulation({ params });
  try {
    for (let run = 0; run < 2; run++) {
      const s = sim.reset(undefined, params);
      assert.equal(s.commandDelayMs, 120);
      assert.equal(s.startOffsetMm, 15);
      assert.ok(Math.abs(s.x - START_POSE.x) < 1e-12);
      assert.ok(Math.abs(s.y - START_POSE.y - .015) < 1e-12);
      assert.ok(Math.abs(s.headingDeg) < 1e-9);
      const issued = [];
      for (let i = 0; i < 24; i++) {
        sim.step(.01, { ...params, speed: 7 + i % 12 });
        issued.push([s.leftCommand, s.rightCommand]);
        assert.deepEqual([s.leftAppliedCommand, s.rightAppliedCommand], i < 12 ? [0, 0] : issued[i - 12]);
      }
    }
    const pose = { x: 0, y: 0, heading: 0 };
    const mat = { kind: 'custom', startPose: pose, physicalWidth: .5, width: 2, height: 2, mask: new Uint8Array(4) };
    sim.setCourse(mat, params);
    assert.equal(sim.state.x, -.015);
    assert.equal(sim.state.y, 0);
    assert.equal(sim.state.headingDeg, 90);
    sim.reset(pose, params);
    assert.equal(sim.state.startOffsetMm, 0);
    assert.equal(sim.state.x, pose.x);
    assert.equal(sim.state.y, pose.y);
    const time = sim.step(.01, params).time;
    assert.throws(() => sim.reset(undefined, { ...params, commandDelayMs: 15 }), RangeError);
    assert.equal(sim.state.time, time);
  } finally {
    sim.dispose();
  }
});

// Only observe two stretches whose tape tangent is world +X. Normal cornering
// between the launch and the first return must not count as oscillation.
function measureStraights(sim, params) {
  const s = sim.reset(undefined, params);
  const launch = [], returning = [];
  let passedFirstBend = false;
  for (let i = 0; i < 12000; i++) {
    sim.step(.01, params);
    if (s.x + sim.physical.sensorForward > .58) passedFirstBend = true;
    if (!passedFirstBend) launch.push(s.headingDeg);
    const onReturn = s.time > 20 && s.x >= -.45 && s.x <= .42 && Math.abs(s.y + .76) < .066 && Math.abs(s.headingDeg) < 45;
    if (onReturn) returning.push(s.headingDeg);
    else if (returning.length) break;
  }
  assert.ok(launch.length > 200 && returning.length > 400, 'car traversed both straight sections');
  assert.equal(s.laps, 1);
  return [launch, returning].map(headings => {
    // Require alternate excursions beyond +1° and −1° to exclude solver jitter.
    let previousSide = 0, reversals = 0;
    for (const heading of headings) {
      const side = heading > 1 ? 1 : heading < -1 ? -1 : 0;
      if (side && previousSide && side !== previousSide) reversals++;
      if (side) previousSide = side;
    }
    return { span: Math.max(...headings) - Math.min(...headings), reversals };
  });
}

test('with the classroom delay, higher P and smaller D produce a wider swing and line loss', async () => {
  const sim = await createSimulation();
  try {
    const shared = { ...DEFAULT_PARAMS, i: 0, speed: 7, startOffsetMm: 15, commandDelayMs: CLASSROOM_COMMAND_DELAY_MS };
    const [baselineLaunch, baselineReturn] = measureStraights(sim, { ...shared, p: 2, d: 1.5 });
    assert.ok(baselineLaunch.span < 14 && baselineReturn.span < 11);
    assert.equal(sim.state.lossCount, 0);
    for (const d of [0, .01]) {
      const [launch, returning] = measureStraights(sim, { ...shared, p: 4, d });
      assert.ok(launch.reversals >= 5 && launch.span > 30);
      assert.ok(returning.reversals >= 10 && returning.span > 30);
      assert.ok(sim.state.lossCount > 0);
    }
  } finally {
    sim.dispose();
  }
});
