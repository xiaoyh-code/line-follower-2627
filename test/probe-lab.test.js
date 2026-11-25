import test from 'node:test';
import assert from 'node:assert/strict';
import { sensorRegisterByte } from '../src/line-controller.js';
import { createProbeLab } from '../src/probe-lab.js';

test('a probe step samples one register and uses the previous 10 ms PID history', () => {
  const lab = createProbeLab();
  const params = { p: 1, i: 0.5, d: 0.005, speed: 10 };
  assert.equal(lab.state.controlTime, null);

  const centred = lab.step(0x18, params); // S4 and S5.
  assert.equal(centred.controlTime, 0.010);
  assert.equal(centred.error, 0);
  assert.deepEqual([centred.leftCommand, centred.rightCommand], [10, 10]);

  const turn = lab.step(0x88, params); // S4 and S8.
  assert.equal(turn.controlTime, 0.020);
  assert.equal(turn.error, 3);
  assert.equal(turn.previousError, 0);
  assert.equal(turn.previousIntegral, 0);
  assert.deepEqual([turn.pTerm, turn.iTerm, turn.dTerm], [3, 0.015, 1.5]);
  assert.deepEqual([turn.leftCommand, turn.rightCommand], [14, 5]);

  const held = lab.step(0x88, params);
  assert.equal(held.previousIntegral, 0.03);
  assert.equal(held.previousError, 3);
  assert.deepEqual([held.pTerm, held.iTerm, held.dTerm], [3, 0.03, 0]);
  assert.deepEqual([held.leftCommand, held.rightCommand], [13, 6]);

  const otherSide = lab.step(0x11, { ...params, p: 2, i: 0, d: 0 });
  assert.equal(otherSide.error, -3);
  assert.deepEqual([otherSide.leftCommand, otherSide.rightCommand], [4, 16]);
  assert.equal(sensorRegisterByte(centred.sensors), 0x18);
  assert.equal(sensorRegisterByte(turn.sensors), 0x88);
  assert.equal(turn.controlGains.p, 1);
  assert.equal(turn.controlTime, 0.020);
});

test('probe reset and invalid input do not carry or advance PID history', () => {
  const lab = createProbeLab();
  const one = lab.step(1);
  for (const mask of [NaN, -1, 0.5, 256]) assert.throws(() => lab.step(mask), RangeError);
  assert.equal(lab.state, one);
  const reset = lab.reset();
  assert.equal(lab.state, reset);
  assert.equal(reset.controlTime, null);
  assert.equal(reset.controlGains, null);
  const next = lab.step(0xff);
  assert.equal(next.controlTime, 0.010);
  assert.equal(next.lineLost, false);
  assert.equal(next.error, 0);
  assert.equal(next.previousError, 0);
  assert.equal(next.previousIntegral, 0);
});

test('all-white samples, firmware search, open-loop and stop use the vehicle control branches', () => {
  const lab = createProbeLab();
  const empty = lab.step(0);
  assert.equal(empty.lineLost, true);
  assert.equal(empty.searching, false);
  assert.deepEqual([empty.leftCommand, empty.rightCommand], [10, 10]);
  lab.step(0x80);
  const search = lab.step(0);
  assert.equal(search.searching, true);
  assert.deepEqual([search.leftCommand, search.rightCommand], [23, 3]);
  const straight = lab.step(0, { recovery: false });
  assert.equal(straight.searching, false);
  assert.deepEqual([straight.leftCommand, straight.rightCommand], [10, 10]);
  const openLoop = lab.step(0, { p: 0, i: 0, d: 0 });
  assert.equal(openLoop.searching, false);
  assert.deepEqual([openLoop.leftCommand, openLoop.rightCommand], [10, 10]);
  const stop = lab.step(0x88, { speed: 0 });
  assert.deepEqual([stop.leftCommand, stop.rightCommand], [0, 0]);
  assert.equal(stop.lastError, 0);
  assert.equal(stop.integral, 0);
});
