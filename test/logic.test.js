'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const logic = require('../logic.js');

test('SPIN_RATE_OPTIONS lists the six selectable rates with 16 as default', () => {
  assert.deepEqual(logic.SPIN_RATE_OPTIONS, [10, 12, 14, 16, 18, 20]);
  assert.equal(logic.DEFAULT_SPIN_RATE, 16);
});

test('calcSpinCost returns balls-per-spin for a given spins-per-1000-yen rate', () => {
  assert.equal(logic.calcSpinCost(16), 250 / 16);
  assert.equal(logic.calcSpinCost(14), 250 / 14);
  assert.equal(logic.calcSpinCost(18), 250 / 18);
  assert.equal(logic.calcSpinCost(20), 250 / 20);
});

function withMockRandom(values, fn) {
  const original = Math.random;
  let i = 0;
  Math.random = () => values[Math.min(i++, values.length - 1)];
  try {
    return fn();
  } finally {
    Math.random = original;
  }
}

test('P_ZUGAR and P_CHARGE are both 1/399.9', () => {
  assert.equal(logic.P_ZUGAR, 1 / 399.9);
  assert.equal(logic.P_CHARGE, 1 / 399.9);
});

test('ENZOKU_CONFIDENCE_OPTIONS lists 40%/90% with 40% as default', () => {
  assert.deepEqual(logic.ENZOKU_CONFIDENCE_OPTIONS, [40, 90]);
  assert.equal(logic.DEFAULT_ENZOKU_CONFIDENCE, 40);
});

test('falseEnzokuProbability matches the confidence ratio against P_ZUGAR', () => {
  assert.equal(logic.falseEnzokuProbability(40), logic.P_ZUGAR * (60 / 40));
  assert.equal(logic.falseEnzokuProbability(90), logic.P_ZUGAR * (10 / 90));
});

test('spinNormal returns zugar when the first random draw beats P_ZUGAR', () => {
  const result = withMockRandom([0], () => logic.spinNormal(40));
  assert.equal(result, 'zugar');
});

test('spinNormal returns false_enzoku when only the second draw beats falseEnzokuProbability', () => {
  const result = withMockRandom([0.999, 0], () => logic.spinNormal(40));
  assert.equal(result, 'false_enzoku');
});

test('spinNormal returns charge when only the third draw beats P_CHARGE', () => {
  const result = withMockRandom([0.999, 0.999, 0], () => logic.spinNormal(40));
  assert.equal(result, 'charge');
});

test('spinNormal returns miss when every draw is at the high end', () => {
  const result = withMockRandom([0.999, 0.999, 0.999], () => logic.spinNormal(40));
  assert.equal(result, 'miss');
});

test('spinNormal at 90% confidence needs a much smaller second-draw threshold', () => {
  // false_enzoku probability at 90% confidence is P_ZUGAR/9, far below 0.05
  const result = withMockRandom([0.999, 0.05], () => logic.spinNormal(90));
  assert.equal(result, 'miss');
});

test('rollChargeLt is true only under P_CHARGE_LT (1/100)', () => {
  assert.equal(withMockRandom([0], () => logic.rollChargeLt()), true);
  assert.equal(withMockRandom([0.02], () => logic.rollChargeLt()), false);
});

test('rollZugarLtChallenge is true only under P_ZUGAR_LT (50%)', () => {
  assert.equal(withMockRandom([0], () => logic.rollZugarLtChallenge()), true);
  assert.equal(withMockRandom([0.6], () => logic.rollZugarLtChallenge()), false);
});

test('P_RUSH is 1/95.3 and P_RUSH_BIG is 3%', () => {
  assert.equal(logic.P_RUSH, 1 / 95.3);
  assert.equal(logic.P_RUSH_BIG, 0.03);
});

test('spinRush returns hit when the draw beats P_RUSH, miss otherwise', () => {
  assert.equal(withMockRandom([0], () => logic.spinRush()), 'hit');
  assert.equal(withMockRandom([0.5], () => logic.spinRush()), 'miss');
});

test('rollRushHitType returns big under P_RUSH_BIG (3%), small otherwise', () => {
  assert.equal(withMockRandom([0], () => logic.rollRushHitType()), 'big');
  assert.equal(withMockRandom([0.5], () => logic.rollRushHitType()), 'small');
});

test('createRushState starts with 130 ST and zeroed counters', () => {
  assert.deepEqual(logic.createRushState(), {
    stRemaining: 130,
    chainCount: 0,
    bonus3000: 0,
    bonus6000: 0,
    actualBalls: 0,
    nominalBalls: 0,
  });
});

test('applyRushSpin: a miss with ST remaining decrements stRemaining and reports miss', () => {
  const state = logic.createRushState();
  const { rushState, outcome } = withMockRandom([0.5], () => logic.applyRushSpin(state));
  assert.equal(outcome, 'miss');
  assert.equal(rushState.stRemaining, 129);
});

test('applyRushSpin: a miss on the last ST spin reports st_end', () => {
  const state = { ...logic.createRushState(), stRemaining: 1 };
  const { rushState, outcome } = withMockRandom([0.5], () => logic.applyRushSpin(state));
  assert.equal(outcome, 'st_end');
  assert.equal(rushState.stRemaining, 0);
});

test('applyRushSpin: a small hit resets ST to 130, adds 2800 actual / 3000 nominal balls', () => {
  const state = logic.createRushState();
  const { rushState, outcome } = withMockRandom([0, 0.5], () => logic.applyRushSpin(state));
  assert.equal(outcome, 'hit_small');
  assert.equal(rushState.stRemaining, 130);
  assert.equal(rushState.chainCount, 1);
  assert.equal(rushState.bonus3000, 1);
  assert.equal(rushState.bonus6000, 0);
  assert.equal(rushState.actualBalls, 2800);
  assert.equal(rushState.nominalBalls, 3000);
});

test('applyRushSpin: a big hit resets ST to 130, adds 5600 actual / 6000 nominal balls', () => {
  const state = logic.createRushState();
  const { rushState, outcome } = withMockRandom([0, 0], () => logic.applyRushSpin(state));
  assert.equal(outcome, 'hit_big');
  assert.equal(rushState.stRemaining, 130);
  assert.equal(rushState.chainCount, 1);
  assert.equal(rushState.bonus3000, 0);
  assert.equal(rushState.bonus6000, 1);
  assert.equal(rushState.actualBalls, 5600);
  assert.equal(rushState.nominalBalls, 6000);
});

test('applyRushSpin: hits accumulate chainCount and balls across repeated calls', () => {
  let state = logic.createRushState();
  ({ rushState: state } = withMockRandom([0, 0.5], () => logic.applyRushSpin(state))); // small hit
  ({ rushState: state } = withMockRandom([0, 0], () => logic.applyRushSpin(state)));    // big hit
  assert.equal(state.chainCount, 2);
  assert.equal(state.bonus3000, 1);
  assert.equal(state.bonus6000, 1);
  assert.equal(state.actualBalls, 2800 + 5600);
  assert.equal(state.nominalBalls, 3000 + 6000);
});

test('chainProbability: exact = p^k(1-p), atLeast = p^k', () => {
  const p = logic.P_ST_HIT;
  assert.ok(Math.abs(logic.chainProbability(0).exact - (1 - p)) < 1e-12);
  assert.ok(Math.abs(logic.chainProbability(10).atLeast - Math.pow(p, 10)) < 1e-12);
});

test('streakProbability for each kind', () => {
  assert.ok(Math.abs(logic.streakProbability('lt_fail', 5) - 1 / 32) < 1e-12);
  assert.ok(Math.abs(logic.streakProbability('lt_win', 5) - 1 / 32) < 1e-12);
  assert.ok(Math.abs(logic.streakProbability('enzoku_miss', 5, 40) - Math.pow(0.6, 5)) < 1e-12);
  assert.ok(Math.abs(logic.P_CHARGE_NO_LT_BEFORE_ZUGAR - 0.495) < 1e-9);
});

test('tanpatsuProbability combines charge/zugar one-shot rates', () => {
  const r = 1 - logic.P_ST_HIT;
  const expected = 0.5 * (0.99 + 0.01 * r) + 0.5 * (0.5 + 0.5 * r);
  assert.ok(Math.abs(logic.tanpatsuProbability() - expected) < 1e-12);
});
