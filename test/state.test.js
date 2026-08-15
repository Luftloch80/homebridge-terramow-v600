import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  createInitialState,
  deriveActivity,
  isAtBase,
  isCharging,
  isMowingActivity,
  isRainDelay,
  bladeFilterLife,
  parseBatteryLevel,
  parseBatteryStatus,
  parseCompatibilityInfo,
  parseCurrentOperation,
  parseMapStatus,
  parseSchedule,
  parseStatistics,
  parseTaskStatus,
} from '../dist/state.js';

describe('parseBatteryLevel', () => {
  it('reads int_value and clamps', () => {
    assert.equal(parseBatteryLevel({ int_value: 67 }), 67);
    assert.equal(parseBatteryLevel({ int_value: 150 }), 100);
    assert.equal(parseBatteryLevel({ int_value: -5 }), 0);
    assert.equal(parseBatteryLevel({}), null);
  });
});

describe('parseBatteryStatus', () => {
  it('maps charging fields', () => {
    assert.deepEqual(
      parseBatteryStatus({
        state: 'BATTERY_STATE_CHARGING',
        charger_connected: true,
        tempreture: 'BATTERY_TEMPRETURE_NORMAL',
        is_switch_on: true,
      }),
      {
        state: 'BATTERY_STATE_CHARGING',
        chargerConnected: true,
        temperature: 'BATTERY_TEMPRETURE_NORMAL',
        powerSwitchOn: true,
      },
    );
  });
});

describe('parseTaskStatus', () => {
  it('maps mission payload', () => {
    const task = parseTaskStatus({
      mission: 'MISSION_GLOBAL_CLEAN',
      sub_mission: 'SUB_MISSION_IDLE',
      state: 'MISSION_STATE_RUNNING',
      has_error: false,
      back_to_station_reason: 'BACK_TO_STATION_REASON_NONE',
    });
    assert.equal(task?.mission, 'MISSION_GLOBAL_CLEAN');
    assert.equal(task?.state, 'MISSION_STATE_RUNNING');
    assert.equal(task?.hasError, false);
  });
});

describe('parseCurrentOperation', () => {
  it('computes progress percent', () => {
    const op = parseCurrentOperation({
      total_area: 3000,
      clean_area: 1500,
      work_duration: 1800,
      is_completed: false,
    });
    assert.equal(op?.progressPercent, 50);
  });

  it('forces 100 when completed', () => {
    const op = parseCurrentOperation({
      total_area: 3000,
      clean_area: 1000,
      is_completed: true,
    });
    assert.equal(op?.progressPercent, 100);
  });
});

describe('deriveActivity', () => {
  it('reports error when disconnected', () => {
    const task = createInitialState().task;
    assert.equal(deriveActivity(task, false), 'error');
  });

  it('detects mowing', () => {
    assert.equal(
      deriveActivity(
        {
          mission: 'MISSION_GLOBAL_CLEAN',
          subMission: 'SUB_MISSION_IDLE',
          state: 'MISSION_STATE_RUNNING',
          hasError: false,
          backToStationReason: 'BACK_TO_STATION_REASON_NONE',
        },
        true,
      ),
      'mowing',
    );
  });

  it('detects pause', () => {
    assert.equal(
      deriveActivity(
        {
          mission: 'MISSION_GLOBAL_CLEAN',
          subMission: 'SUB_MISSION_IDLE',
          state: 'MISSION_STATE_PAUSE',
          hasError: false,
          backToStationReason: 'BACK_TO_STATION_REASON_NONE',
        },
        true,
      ),
      'paused',
    );
  });

  it('detects returning via sub-mission', () => {
    assert.equal(
      deriveActivity(
        {
          mission: 'MISSION_GLOBAL_CLEAN',
          subMission: 'SUB_MISSION_RETURN_TO_BASE',
          state: 'MISSION_STATE_RUNNING',
          hasError: false,
          backToStationReason: 'BACK_TO_STATION_REASON_LOW_BATTERY',
        },
        true,
      ),
      'returning',
    );
  });

  it('detects docked idle', () => {
    assert.equal(
      deriveActivity(
        {
          mission: 'MISSION_IDLE',
          subMission: 'SUB_MISSION_IDLE',
          state: 'MISSION_STATE_IDLE',
          hasError: false,
          backToStationReason: 'BACK_TO_STATION_REASON_NONE',
        },
        true,
      ),
      'docked',
    );
  });
});

describe('helpers', () => {
  it('classifies charging and rain delay', () => {
    assert.equal(isCharging({ state: 'BATTERY_STATE_CHARGING', chargerConnected: true, temperature: 'BATTERY_TEMPRETURE_NORMAL', powerSwitchOn: true }), true);
    assert.equal(isMowingActivity('mowing'), true);
    assert.equal(isMowingActivity('paused'), true);
    assert.equal(isMowingActivity('docked'), false);
    assert.equal(
      isRainDelay({
        mission: 'MISSION_RECHARGE',
        subMission: 'SUB_MISSION_RETURN_TO_BASE',
        state: 'MISSION_STATE_RUNNING',
        hasError: false,
        backToStationReason: 'BACK_TO_STATION_REASON_RAINING',
      }),
      true,
    );
    assert.equal(
      isAtBase('docked', { state: 'BATTERY_STATE_CHARGED', chargerConnected: true, temperature: 'BATTERY_TEMPRETURE_NORMAL', powerSwitchOn: true }),
      true,
    );
  });
});

describe('extra parsers', () => {
  it('parses statistics map and schedule', () => {
    assert.deepEqual(
      parseStatistics({ duration: 7200, clean_area: 2000, clean_times: 5 }),
      { durationSeconds: 7200, cleanArea: 2000, cleanTimes: 5 },
    );
    assert.equal(parseMapStatus({ is_map_detected: true, map_state: 'MAP_STATE_COMPLETE' })?.mapDetected, true);
    assert.equal(
      parseSchedule({
        exist: true,
        start_time: { hour: 14, minute: 30 },
        end_time: { hour: 16, minute: 0 },
      })?.startHour,
      14,
    );
    assert.equal(bladeFilterLife(0), 100);
    assert.ok(bladeFilterLife(14400) <= 0);
  });

  it('formats firmware from DP 127 compatibility info', () => {
    assert.equal(
      parseCompatibilityInfo({
        overall: 25,
        module: { home_assistant: 3, map: 2, control: 4 },
      }),
      '25.3',
    );
    assert.equal(parseCompatibilityInfo({ overall: 25 }), '25');
    assert.equal(parseCompatibilityInfo({}), null);
  });
});
