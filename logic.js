'use strict';

const SPIN_RATE_OPTIONS = [14, 16, 18];
const DEFAULT_SPIN_RATE = 16;

function calcSpinCost(spinRate) {
  return 250 / spinRate;
}

const P_ZUGAR        = 1 / 399.9;
const P_CHARGE       = 1 / 399.9;
const P_FALSE_ENZOKU = P_ZUGAR * (0.3 / 0.7);
const P_CHARGE_LT    = 1 / 100;
const P_ZUGAR_LT     = 0.5;

// Each outcome is an independent roll (not cumulative buckets on one draw),
// matching pachinko-simulator-ghouldeka's existing convention.
function spinNormal() {
  if (Math.random() < P_ZUGAR)        return 'zugar';
  if (Math.random() < P_FALSE_ENZOKU) return 'false_enzoku';
  if (Math.random() < P_CHARGE)       return 'charge';
  return 'miss';
}

function rollChargeLt() {
  return Math.random() < P_CHARGE_LT;
}

function rollZugarLtChallenge() {
  return Math.random() < P_ZUGAR_LT;
}

const P_RUSH     = 1 / 95.3;
const P_RUSH_BIG = 0.03;

function spinRush() {
  return Math.random() < P_RUSH ? 'hit' : 'miss';
}

function rollRushHitType() {
  return Math.random() < P_RUSH_BIG ? 'big' : 'small';
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    SPIN_RATE_OPTIONS,
    DEFAULT_SPIN_RATE,
    calcSpinCost,
    P_ZUGAR,
    P_CHARGE,
    P_FALSE_ENZOKU,
    P_CHARGE_LT,
    P_ZUGAR_LT,
    spinNormal,
    rollChargeLt,
    rollZugarLtChallenge,
    P_RUSH,
    P_RUSH_BIG,
    spinRush,
    rollRushHitType,
  };
}
