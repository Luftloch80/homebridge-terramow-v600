import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DP, MQTT_USERNAME, START_MODE, TOPIC } from '../dist/settings.js';

describe('settings', () => {
  it('uses TerraMow MQTT defaults', () => {
    assert.equal(MQTT_USERNAME, 'terramow');
    assert.equal(TOPIC.app(103), 'data_point/103/app');
    assert.equal(TOPIC.robot(107), 'data_point/107/robot');
    assert.equal(START_MODE.GLOBAL_CLEAN, 'START_MODE_GLOBAL_CLEAN');
    assert.equal(START_MODE.RETURN, 'START_MODE_RETURN');
    assert.equal(DP.PAUSE_COMMAND, 105);
    assert.equal(DP.RESUME_COMMAND, 106);
  });
});
