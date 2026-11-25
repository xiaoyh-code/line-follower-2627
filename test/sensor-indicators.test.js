import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Color, Matrix4} from 'three';
import {createSensorIndicators, updateSensorIndicators} from '../src/sensor-indicators.js';

const {parts} = JSON.parse(readFileSync(new URL('../public/models/car.json', import.meta.url)));
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-6, `${actual} vs ${expected}`);

test('stock indicator packages sit on the exposed Fusion PCB with the pitch of its eight probes', () => {
  const stock = createSensorIndicators(null);
  const matched = createSensorIndicators({parts});
  for (let i = 0; i < 3; i++) close(stock.position.getComponent(i), matched.position.getComponent(i));
  close(stock.position.z, 0.01975);
  close(stock.position.y, 0.1659);
  const cases = stock.getObjectByName('sensor-led-cases');
  assert.equal(cases.count, 8);
  for (let i = 0; i < 8; i++) {
    const matrix = new Matrix4();
    cases.getMatrixAt(i, matrix);
    close(matrix.elements[12], (i - 3.5) * .0115);
    close(matrix.elements[14] - cases.geometry.parameters.depth / 2, 0);
  }
});

test('one individual channel illuminates one physical lens, with matching silkscreen in either mounting order', () => {
  const group = createSensorIndicators(null);
  const cores = group.getObjectByName('sensor-led-cores');
  const windows = group.getObjectByName('sensor-led-windows');
  const labels = group.getObjectByName('sensor-channel-labels').material.map;
  const off = new Color(), core = new Color(), window = new Color();
  cores.getColorAt(0, off);
  for (const mount of ['s1-left', 's8-left']) {
    for (let i = 0; i < 8; i++) {
      const sensors = Array.from({length: 8}, (_, channel) => i === channel);
      updateSensorIndicators(group, sensors, mount);
      assert.equal(labels.offset.y, mount === 's1-left' ? 0 : 0.5);
      const expected = mount === 's1-left' ? i : 7 - i;
      for (let k = 0; k < 8; k++) {
        cores.getColorAt(k, core);
        windows.getColorAt(k, window);
        assert.equal(core.equals(off), k !== expected);
        assert.equal(window.equals(off), k !== expected);
        if (k === expected) assert.ok(core.r > .75 && core.g > .9 && core.b > .75);
      }
    }
  }
  updateSensorIndicators(group, []);
  for (let i = 0; i < 8; i++) {
    cores.getColorAt(i, core);
    assert.ok(core.equals(off));
  }
});

test('a translated imported assembly locates its own board and unmatched models do not gain hardware', () => {
  const translated = parts.filter(p => p.name === 'line_follower').map(p => ({
    ...p, positions: new Float32Array(p.positions.map((v, i) => v + [0.008, -.032, .016][i % 3])),
  }));
  const group = createSensorIndicators({parts: translated, name: 'my renamed assembly.step'});
  close(group.position.x, .008);
  close(group.position.y, .1659 - .032);
  close(group.position.z, .01975 + .016);
  // A matching board outline alone does not contain the underside optical array.
  assert.equal(createSensorIndicators({parts: [parts[20]], name: '2627_CAR_v2.step'}), null);
  const unrelated = translated.map(part => ({...part, name: 'unrelated'}));
  assert.equal(createSensorIndicators({parts: unrelated}), null);
  assert.equal(createSensorIndicators({parts: []}), null);
  assert.doesNotThrow(() => updateSensorIndicators(null, []));
});

test('recognises the complete unlabelled STL car and rejects a car missing one of its 16 optical barrels', () => {
  // Make the triangle soup a binary STL loader would supply, including the
  // rest of the real chassis, without original indices or part boundaries.
  function flatten(missingBarrel) {
    const coords = [];
    for (const part of parts) {
      for (let i = 0; i < part.indices.length; i += 3) {
        const first = 3 * part.indices[i];
        if (missingBarrel && part === parts[21] && part.positions[first] > .036 &&
          part.positions[first + 1] > .159 && part.positions[first + 2] <= .01815) continue;
        for (let t = 0; t < 3; t++) {
          const j = 3 * part.indices[i + t];
          coords.push(part.positions[j] - .007, part.positions[j + 1] + .012, part.positions[j + 2] + .003);
        }
      }
    }
    return {parts: [{name: 'anonymous.stl', group: 'chassis', positions: new Float32Array(coords)}]};
  }
  const found = createSensorIndicators(flatten(false));
  close(found.position.x, -.007);
  close(found.position.y, .1659 + .012);
  close(found.position.z, .01975 + .003);
  assert.equal(createSensorIndicators(flatten(true)), null);
});
