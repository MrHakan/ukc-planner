import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

global.window = global;
vm.runInThisContext(fs.readFileSync('calc-engine.js', 'utf8'), { filename: 'calc-engine.js' });
const E = global.UKCEngine;
assert.ok(E, 'UKCEngine must be exposed');

const sample = {
  lbp: 176.1, beam: 29.4, draftForward: 9.00, draftAft: 9.07, displacement: 35900, cbOverride: 0,
  chartedDepth: 11.69, tideHeight: 0.80, speed: 10, waterDensity: 1.025, channelWidth: 0, fwaMm: 180,
  squatMethod: 'barrass-blockage', heelAngle: 0, heelAllowanceManual: 0.07, waveAllowance: 0.20,
  manualDraftCorrection: 0, catzoc: 'MANUAL', surveyAllowanceManual: 0.60, otherAllowance: 0,
  requiredFixed: 1.50, requiredPercent: 15, additionalSafetyMargin: 0,
  bridgeEnabled: 0
};

const r = E.calculate(sample);
assert.ok(Math.abs(r.meanDraft - 9.035) < 1e-9, 'mean draft');
assert.ok(Math.abs(r.cb - 0.7487481113) < 1e-6, 'block coefficient');
assert.ok(Math.abs(r.widthInfluence - 263.49898) < 0.01, 'Barrass width of influence');
assert.ok(Math.abs(r.blockage - 0.0807113) < 1e-5, 'blockage factor');
assert.ok(Math.abs(r.squat - 0.5860334) < 1e-5, 'empirical squat regression');
assert.ok(r.dynamicUKC > r.requiredUKC, 'sample should meet selected requirement');
assert.equal(r.status, 'PASS');
assert.equal(r.bridge.enabled, false);

const simpleOpen = E.squatAtSpeed({ ...sample, squatMethod:'simple-open' }, 10, r.totalDepth);
assert.ok(Math.abs(simpleOpen.squat - r.cb) < 1e-6, 'simple open-water formula at 10 kn');
const simpleConfined = E.squatAtSpeed({ ...sample, squatMethod:'simple-confined' }, 10, r.totalDepth);
assert.ok(Math.abs(simpleConfined.squat - 2 * r.cb) < 1e-6, 'simple confined-water formula at 10 kn');

const zoc = E.calculate({ ...sample, catzoc:'A1', surveyAllowanceManual:0, chartedDepth:10, tideHeight:0, speed:0 });
assert.ok(Math.abs(zoc.surveyAllowance - 0.6) < 1e-9, 'CATZOC A1 reference allowance');
const density = E.densityDraftCorrection({ ...sample, waterDensity:1.000, fwaMm:200 });
assert.ok(Math.abs(density - 0.2) < 1e-9, 'fresh-water draft correction');

const critical = E.maxSafeSpeed(sample, 25);
assert.ok(critical.speed > sample.speed, 'sample should have headroom above 10 kn');
assert.ok(critical.speed < 25, 'critical speed should be bounded below test ceiling');
const atCritical = E.calculate({ ...sample, speed: critical.speed });
assert.ok(Math.abs(atCritical.margin) < 1e-6, 'speed solver must converge to UKC boundary');

const matrix = E.squatMatrix(sample, [10, 12], [6, 10, 14]);
assert.equal(matrix.length, 2);
assert.equal(matrix[0].cells.length, 3);
assert.ok(matrix[0].cells[2].squat > matrix[0].cells[0].squat, 'squat should increase with speed');

const bridgeInput = {
  ...sample,
  bridgeEnabled: 1,
  chartedBridgeClearance: 60,
  bridgeReferenceTide: 3.78,
  tideHeight: 1.69,
  airDraft: 51.72,
  verticalMotionAllowance: 0.50,
  bridgeSurveyAllowance: 0.20,
  requiredAirClearance: 2.00,
  bridgeSquatCredit: 0
};
const bridge = E.bridgeClearance(bridgeInput);
assert.ok(Math.abs(bridge.currentVerticalClearance - 62.09) < 1e-9, 'charted bridge clearance must be corrected from reference tide to current tide');
assert.ok(Math.abs(bridge.effectiveAirDraft - 52.42) < 1e-9, 'air-draft envelope');
assert.ok(Math.abs(bridge.availableAirClearance - 9.67) < 1e-9, 'physical overhead gap');
assert.ok(Math.abs(bridge.margin - 7.67) < 1e-9, 'air-clearance safety margin');
assert.equal(bridge.status, 'PASS');

const tideEvents = [
  { minute:30, height:0.4 },
  { minute:405, height:2.4 },
  { minute:785, height:0.5 },
  { minute:1160, height:2.5 }
];
assert.ok(Math.abs(E.tideHeightAt(tideEvents, 30) - 0.4) < 1e-12, 'tide interpolation must pass through LW event');
assert.ok(Math.abs(E.tideHeightAt(tideEvents, 405) - 2.4) < 1e-12, 'tide interpolation must pass through HW event');
const mid = E.tideHeightAt(tideEvents, (30+405)/2);
assert.ok(mid > 0.4 && mid < 2.4, 'interpolated tide must remain between extrema');

const constrained = {
  ...sample,
  bridgeEnabled: 1,
  chartedBridgeClearance: 52.5,
  bridgeReferenceTide: 2.5,
  airDraft: 52,
  verticalMotionAllowance: 0,
  bridgeSurveyAllowance: 0,
  requiredAirClearance: 1,
  bridgeSquatCredit: 0
};
const lowTide = E.calculate({ ...constrained, tideHeight:0.5 });
const highTide = E.calculate({ ...constrained, tideHeight:2.5 });
assert.ok(lowTide.bridge.margin > 0, 'lower tide should improve overhead clearance');
assert.ok(highTide.bridge.margin < 0, 'higher tide should reduce overhead clearance');
assert.ok(highTide.margin > lowTide.margin, 'higher tide should improve UKC');

const series = E.tideWindowSeries(constrained, tideEvents, { startMinute:0, durationMinutes:1440, stepMinutes:10, maxSpeed:20 });
assert.ok(series.length > 100, 'tide window should generate a full time series');
assert.ok(series.some(p=>p.safe), 'combined tide plan should contain a safe period');
assert.ok(series.some(p=>!p.safe), 'combined tide plan should contain a no-go period');
const windows = E.safeWindows(series, 10);
assert.ok(windows.length >= 1, 'safe-window extraction should find at least one window');
assert.ok(windows.every(w=>w.durationMinutes >= 0), 'safe windows must have non-negative durations');

assert.deepEqual(E.validate(sample), []);
assert.ok(E.validate({ ...sample, chartedDepth:0 }).length > 0, 'invalid water depth must be rejected');
assert.ok(E.validate({ ...sample, bridgeEnabled:1, chartedBridgeClearance:0, airDraft:50 }).length > 0, 'invalid bridge clearance must be rejected');

console.log('UKC, bridge clearance and tidal-window regression tests passed.');