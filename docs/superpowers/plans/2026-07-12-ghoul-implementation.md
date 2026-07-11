# pachinko-simulator-ghoul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `pachinko-simulator-ghoul`, a new pachinko simulator variant that reuses `pachinko-simulator-ghouldeka`'s visuals/architecture but replaces the charge probability, zugar (図柄揃い) probability, and RUSH (LT) internal structure per `docs/superpowers/specs/2026-07-12-ghoul-spec-design.md`.

**Architecture:** Same 3-file static layout as ghouldeka (`index.html` / `style.css` / `script.js`), but the pure probability/state-transition logic is split into a new `logic.js` that has no DOM dependency, so it can be unit-tested with Node's built-in test runner. `script.js` stays a flat, global-scope file (no bundler, no modules) exactly like ghouldeka, and calls the functions/constants `logic.js` defines in the shared global scope.

**Tech Stack:** Vanilla HTML/CSS/JS, no build step, no npm dependencies. Tests run via Node's built-in `node:test` module (Node v18+; this machine has v24).

---

## Assumptions carried over from the spec (not re-litigated during brainstorming, inherited unchanged from ghouldeka)

- 先バレ (enzoku) mechanic keeps the same 70% confidence display: `P_FALSE_ENZOKU = P_ZUGAR * (0.3 / 0.7)`, recalculated against the new `P_ZUGAR`.
- RUSH spins are free (no ball cost), same as ghouldeka's `handleRushStart` never calling `consumeSpinCost()`.
- 営業時間終了 (closing-time alert at 4000 total spins) logic is unchanged.
- 退店 (leave-store) result screen fields (総回転数/投資金額/持ち球換算/収支/図柄ぞろい/チャージ/RUSH大当たり) are unchanged in shape.
- Money conversion (1 ball = 4 yen, 1000円 = 250発) is unchanged; only spins-per-1000-yen is configurable now.

---

## Task 1: Project scaffold

**Files:**
- Create: `C:\Users\ab_99\pachinko-simulator-ghoul\画像\グール先バレ.webp` (copy)
- Create: `C:\Users\ab_99\pachinko-simulator-ghoul\画像\RUSH中　追加ボーナス演出.png` (copy)
- Create: `C:\Users\ab_99\pachinko-simulator-ghoul\package.json`
- Create: `C:\Users\ab_99\pachinko-simulator-ghoul\.gitignore`

- [ ] **Step 1: Copy the shared visual assets from ghouldeka**

```bash
mkdir -p "/c/Users/ab_99/pachinko-simulator-ghoul/画像"
cp "/c/Users/ab_99/pachinko-simulator-ghouldeka/画像/グール先バレ.webp" "/c/Users/ab_99/pachinko-simulator-ghoul/画像/"
cp "/c/Users/ab_99/pachinko-simulator-ghouldeka/画像/RUSH中　追加ボーナス演出.png" "/c/Users/ab_99/pachinko-simulator-ghoul/画像/"
```

- [ ] **Step 2: Create a minimal package.json (test script only, no dependencies)**

```json
{
  "name": "pachinko-simulator-ghoul",
  "private": true,
  "version": "0.1.0",
  "scripts": {
    "test": "node --test \"test/**/*.test.js\""
  }
}
```

- [ ] **Step 3: Create .gitignore**

```
node_modules/
```

- [ ] **Step 4: Commit**

```bash
git add 画像 package.json .gitignore
git commit -m "chore: scaffold project and copy shared visual assets"
```

---

## Task 2: logic.js — constants and spin cost

**Files:**
- Create: `C:\Users\ab_99\pachinko-simulator-ghoul\logic.js`
- Test: `C:\Users\ab_99\pachinko-simulator-ghoul\test\logic.test.js`

- [ ] **Step 1: Write the failing test**

Create `test/logic.test.js` with this content:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const logic = require('../logic.js');

test('SPIN_RATE_OPTIONS lists the three selectable rates with 16 as default', () => {
  assert.deepEqual(logic.SPIN_RATE_OPTIONS, [14, 16, 18]);
  assert.equal(logic.DEFAULT_SPIN_RATE, 16);
});

test('calcSpinCost returns balls-per-spin for a given spins-per-1000-yen rate', () => {
  assert.equal(logic.calcSpinCost(16), 250 / 16);
  assert.equal(logic.calcSpinCost(14), 250 / 14);
  assert.equal(logic.calcSpinCost(18), 250 / 18);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /c/Users/ab_99/pachinko-simulator-ghoul && node --test "test/**/*.test.js"`
Expected: FAIL — `Cannot find module '../logic.js'`

- [ ] **Step 3: Write minimal implementation**

Create `logic.js`:

```js
'use strict';

const SPIN_RATE_OPTIONS = [14, 16, 18];
const DEFAULT_SPIN_RATE = 16;

function calcSpinCost(spinRate) {
  return 250 / spinRate;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    SPIN_RATE_OPTIONS,
    DEFAULT_SPIN_RATE,
    calcSpinCost,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /c/Users/ab_99/pachinko-simulator-ghoul && node --test "test/**/*.test.js"`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add logic.js test/logic.test.js
git commit -m "feat: add spin-rate constants and spin cost calculation"
```

---

## Task 3: logic.js — normal-mode spin outcomes (zugar / charge / charge-LT roll)

**Files:**
- Modify: `logic.js`
- Modify: `test/logic.test.js`

- [ ] **Step 1: Write the failing tests**

Append to `test/logic.test.js`:

```js
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

test('P_FALSE_ENZOKU keeps the 70% confidence ratio against the new P_ZUGAR', () => {
  assert.equal(logic.P_FALSE_ENZOKU, logic.P_ZUGAR * (0.3 / 0.7));
});

test('spinNormal returns zugar when the first random draw beats P_ZUGAR', () => {
  const result = withMockRandom([0], () => logic.spinNormal());
  assert.equal(result, 'zugar');
});

test('spinNormal returns false_enzoku when only the second draw beats P_FALSE_ENZOKU', () => {
  const result = withMockRandom([0.999, 0], () => logic.spinNormal());
  assert.equal(result, 'false_enzoku');
});

test('spinNormal returns charge when only the third draw beats P_CHARGE', () => {
  const result = withMockRandom([0.999, 0.999, 0], () => logic.spinNormal());
  assert.equal(result, 'charge');
});

test('spinNormal returns miss when every draw is at the high end', () => {
  const result = withMockRandom([0.999, 0.999, 0.999], () => logic.spinNormal());
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /c/Users/ab_99/pachinko-simulator-ghoul && node --test "test/**/*.test.js"`
Expected: FAIL — `logic.P_ZUGAR` etc. are undefined, `spinNormal` is not a function

- [ ] **Step 3: Write minimal implementation**

Add to `logic.js` (after the constants from Task 2, before the `module.exports` block):

```js
const P_ZUGAR        = 1 / 399.9;
const P_CHARGE       = 1 / 399.9;
const P_FALSE_ENZOKU = P_ZUGAR * (0.3 / 0.7);
const P_CHARGE_LT    = 1 / 100;
const P_ZUGAR_LT     = 0.5;

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
```

Update the `module.exports` object to also include:
`P_ZUGAR, P_CHARGE, P_FALSE_ENZOKU, P_CHARGE_LT, P_ZUGAR_LT, spinNormal, rollChargeLt, rollZugarLtChallenge,`

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /c/Users/ab_99/pachinko-simulator-ghoul && node --test "test/**/*.test.js"`
Expected: PASS (all tests so far)

- [ ] **Step 5: Commit**

```bash
git add logic.js test/logic.test.js
git commit -m "feat: add normal-mode spin outcome logic (zugar/charge/charge-LT roll)"
```

---

## Task 4: logic.js — RUSH spin outcome and hit-type roll

**Files:**
- Modify: `logic.js`
- Modify: `test/logic.test.js`

- [ ] **Step 1: Write the failing tests**

Append to `test/logic.test.js`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /c/Users/ab_99/pachinko-simulator-ghoul && node --test "test/**/*.test.js"`
Expected: FAIL — `logic.P_RUSH` etc. are undefined

- [ ] **Step 3: Write minimal implementation**

Add to `logic.js`:

```js
const P_RUSH     = 1 / 95.3;
const P_RUSH_BIG = 0.03;

function spinRush() {
  return Math.random() < P_RUSH ? 'hit' : 'miss';
}

function rollRushHitType() {
  return Math.random() < P_RUSH_BIG ? 'big' : 'small';
}
```

Update `module.exports` to also include: `P_RUSH, P_RUSH_BIG, spinRush, rollRushHitType,`

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /c/Users/ab_99/pachinko-simulator-ghoul && node --test "test/**/*.test.js"`
Expected: PASS (all tests so far)

- [ ] **Step 5: Commit**

```bash
git add logic.js test/logic.test.js
git commit -m "feat: add RUSH spin outcome and hit-type logic"
```

---

## Task 5: logic.js — RUSH ST (130-count reset) state reducer

**Files:**
- Modify: `logic.js`
- Modify: `test/logic.test.js`

- [ ] **Step 1: Write the failing tests**

Append to `test/logic.test.js`:

```js
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

test('applyRushSpin: a big hit resets ST to 130, adds 5400 actual / 6000 nominal balls', () => {
  const state = logic.createRushState();
  const { rushState, outcome } = withMockRandom([0, 0], () => logic.applyRushSpin(state));
  assert.equal(outcome, 'hit_big');
  assert.equal(rushState.stRemaining, 130);
  assert.equal(rushState.chainCount, 1);
  assert.equal(rushState.bonus3000, 0);
  assert.equal(rushState.bonus6000, 1);
  assert.equal(rushState.actualBalls, 5400);
  assert.equal(rushState.nominalBalls, 6000);
});

test('applyRushSpin: hits accumulate chainCount and balls across repeated calls', () => {
  let state = logic.createRushState();
  ({ rushState: state } = withMockRandom([0, 0.5], () => logic.applyRushSpin(state))); // small hit
  ({ rushState: state } = withMockRandom([0, 0], () => logic.applyRushSpin(state)));    // big hit
  assert.equal(state.chainCount, 2);
  assert.equal(state.bonus3000, 1);
  assert.equal(state.bonus6000, 1);
  assert.equal(state.actualBalls, 2800 + 5400);
  assert.equal(state.nominalBalls, 3000 + 6000);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /c/Users/ab_99/pachinko-simulator-ghoul && node --test "test/**/*.test.js"`
Expected: FAIL — `logic.createRushState` is not a function

- [ ] **Step 3: Write minimal implementation**

Add to `logic.js`:

```js
const RUSH_ST_COUNT = 130;

function createRushState() {
  return {
    stRemaining: RUSH_ST_COUNT,
    chainCount: 0,
    bonus3000: 0,
    bonus6000: 0,
    actualBalls: 0,
    nominalBalls: 0,
  };
}

function applyRushSpin(rushState) {
  const result = spinRush();
  const stRemaining = rushState.stRemaining - 1;

  if (result === 'miss') {
    if (stRemaining <= 0) {
      return { rushState: { ...rushState, stRemaining: 0 }, outcome: 'st_end' };
    }
    return { rushState: { ...rushState, stRemaining }, outcome: 'miss' };
  }

  const isBig    = rollRushHitType() === 'big';
  const balls    = isBig ? 5400 : 2800;
  const nominal  = isBig ? 6000 : 3000;

  const newState = {
    stRemaining:  RUSH_ST_COUNT,
    chainCount:   rushState.chainCount + 1,
    bonus3000:    rushState.bonus3000 + (isBig ? 0 : 1),
    bonus6000:    rushState.bonus6000 + (isBig ? 1 : 0),
    actualBalls:  rushState.actualBalls  + balls,
    nominalBalls: rushState.nominalBalls + nominal,
  };

  return { rushState: newState, outcome: isBig ? 'hit_big' : 'hit_small' };
}
```

Update `module.exports` to also include: `RUSH_ST_COUNT, createRushState, applyRushSpin,`

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /c/Users/ab_99/pachinko-simulator-ghoul && node --test "test/**/*.test.js"`
Expected: PASS (all tests — this is the full logic.js suite)

- [ ] **Step 5: Commit**

```bash
git add logic.js test/logic.test.js
git commit -m "feat: add RUSH ST (130-count reset) state reducer"
```

---

## Task 6: index.html — page skeleton

**Files:**
- Create: `C:\Users\ab_99\pachinko-simulator-ghoul\index.html`

- [ ] **Step 1: Create index.html**

Reuses ghouldeka's header/log/rush-stats-bar structure verbatim (same element IDs, since `script.js` targets them the same way); only the title text is changed to identify this as the ghoul variant.

```html
<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>パチンコシミュレーター（ghoul ver）</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <div id="app">

    <div id="title-bar">パチンコ　e東京喰種 ghoul ver</div>

    <div id="header">

      <div class="hrow hrow1">
        <div class="spins-block">
          <span class="spins-current" id="current-spins">0</span>
          <span class="spins-unit">回</span>
          <span class="spins-sep">／累計</span>
          <span class="spins-total" id="total-spins-disp">0</span>
          <span class="spins-unit">回</span>
        </div>
        <div id="mode-badge">通常時</div>
        <div class="esup-block">
          <div class="esup-label">ST残り</div>
          <div class="esup-value" id="rush-count">－</div>
        </div>
      </div>

      <div class="hrow hrow2">
        <div class="money-block">
          <span class="money-label">持ち球</span>
          <span class="money-value gold" id="mochi-dama">0</span>
          <span class="money-unit">球</span>
        </div>
        <div class="money-block">
          <span class="money-label">投資</span>
          <span class="money-value red" id="toushi-value">0</span>
          <span class="money-unit">円</span>
        </div>
        <div class="money-block">
          <span class="money-label">収支</span>
          <span class="money-value red" id="shuushi-value">0</span>
          <span class="money-unit">円</span>
        </div>
      </div>

      <div class="hrow hrow3">
        <div class="hrow3-header">
          <span class="hrow3-title">大当たり総回数</span>
          <span class="total-hit-block">
            <span class="total-hit-count" id="total-hit-count">0回</span>
          </span>
          <span class="fee-block" id="fee-block">16回転/千円</span>
        </div>
        <div class="hrow3-normal-line">
          <span class="hit-label2">通常時初当たり</span>
          <span class="hit-count" id="normal-first-hit">0回</span>
          <span class="hit-prob" id="normal-first-prob">1/―</span>
        </div>
        <div class="hrow3-stats">
          <div class="hit-item">
            <span class="hit-label2">図柄揃い</span>
            <span class="hit-count" id="zugar-count">0回</span>
            <span class="hit-prob" id="zugar-prob">1/399</span>
            <span class="rush-entry" id="rush-entry-info">(LT突入0回)</span>
          </div>
          <div class="hit-item">
            <span class="hit-label2">チャージ</span>
            <span class="hit-count" id="charge-count">0回</span>
            <span class="hit-prob" id="charge-prob">1/399</span>
          </div>
        </div>
      </div>

    </div><!-- /header -->

    <div id="main-screen"></div>

    <div id="rush-stats-bar">
      <div class="rsb-header">
        <span class="rsb-title">通算RUSH成績</span>
        <span class="rsb-item">
          <span class="rsb-label">大当たり</span>
          <span class="rsb-val" id="rs-chain">0回</span>
          <span class="rsb-prob" id="rs-prob">1/―</span>
        </span>
        <span class="rsb-item">
          <span class="rsb-label">総回転</span>
          <span class="rsb-val" id="rs-spins">0回</span>
        </span>
      </div>
      <div class="rsb-row">
        <span class="rsb-item">
          <span class="rsb-label">6000個</span>
          <span class="rsb-val" id="rs-6000">0回</span>
        </span>
        <span class="rsb-item">
          <span class="rsb-label">3000個</span>
          <span class="rsb-val" id="rs-3000">0回</span>
        </span>
      </div>
    </div>

    <div id="log-area">
      <div id="log-title">履歴</div>
      <div id="log-list"></div>
    </div>

  </div>
  <script src="logic.js"></script>
  <script src="script.js"></script>
</body>
</html>
```

Note the `<script src="logic.js">` tag loads **before** `script.js`, and both are classic (non-module) scripts, so the `const`/`function` declarations in `logic.js` share the same global lexical scope as `script.js` — no `window.` prefixing or bundler needed, matching ghouldeka's flat-global-script style.

- [ ] **Step 2: Commit**

```bash
git add index.html
git commit -m "feat: add page skeleton (index.html)"
```

---

## Task 7: style.css — new UI elements

**Files:**
- Create: `C:\Users\ab_99\pachinko-simulator-ghoul\style.css`

- [ ] **Step 1: Copy ghouldeka's style.css as the base**

```bash
cp "/c/Users/ab_99/pachinko-simulator-ghouldeka/style.css" "/c/Users/ab_99/pachinko-simulator-ghoul/style.css"
```

- [ ] **Step 2: Append styles for the spin-rate dropdown and the RUSH 3-button row**

The LT-challenge and LT-announce screens reuse existing classes (`.vibun-box`, `.bonus-main`, `.enzoku-img`, `.rush-announce`) already present in the copied `style.css` — no new classes needed for those. Append only what's genuinely new:

```css

/* ========== ghoul版 追加: スピンレート選択 ========== */
.spin-rate-block {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 6px;
}

.spin-rate-label { font-size: 11px; color: #666; }

.spin-rate-select {
  background: #1a1a1a;
  color: #ccc;
  border: 1px solid #444;
  border-radius: 8px;
  padding: 6px 10px;
  font-size: 13px;
}

/* ========== ghoul版 追加: RUSH中の3種回転ボタン ========== */
.rush-spin-btns {
  display: flex;
  gap: 8px;
  margin-top: 4px;
  width: 100%;
  max-width: 320px;
}

.btn-rush-spin {
  flex: 1;
  padding: 10px 0;
  border-radius: 10px;
  background: #1a1a1a;
  border: 1px solid #444;
  font-size: 13px;
  font-weight: bold;
  color: #ccc;
  cursor: pointer;
  transition: background 0.1s, transform 0.1s;
}
.btn-rush-spin:active { background: #2a2a2a; transform: scale(0.96); }

.btn-rush-spin.skip {
  background: linear-gradient(135deg, #aa1100, #550800);
  border-color: #ff6644;
  color: #fff;
}
```

- [ ] **Step 3: Commit**

```bash
git add style.css
git commit -m "feat: add styles for spin-rate dropdown and RUSH spin buttons"
```

---

## Task 8: script.js — game state and normal-mode flow

**Files:**
- Create: `C:\Users\ab_99\pachinko-simulator-ghoul\script.js`

- [ ] **Step 1: Write the game state object and normal-mode handlers**

Create `script.js` and start with this content (RUSH-mode handlers and rendering are added in Tasks 9–10 — this file is not runnable in a browser until then, so no manual check yet):

```js
'use strict';

const game = {
  state: 'normal_idle',
  mode: 'normal',
  spinRate: DEFAULT_SPIN_RATE,
  mochiDama: 0,
  toushi: 0,
  totalSpins: 0,
  currentSpins: 0,
  lastHitSpins: 0,
  zugarCount: 0,
  chargeCount: 0,
  ltEntryCount: 0,
  totalRushHits: 0,
  allRushStats: { rushTotalSpins: 0, bonus6000: 0, bonus3000: 0 },
  rush: null,
  pending: {},
  eigyoAlertShown: false,
  log: [],
};

function addLog(text, type = '') {
  game.log.unshift({ text, type });
  if (game.log.length > 50) game.log.pop();
  renderLog();
}

// ---- 球数・投資 ----

function consumeSpinCost() {
  const cost = calcSpinCost(game.spinRate);
  if (game.mochiDama >= cost) {
    game.mochiDama -= cost;
  } else {
    const shortfall = cost - game.mochiDama;
    game.mochiDama = 0;
    const units = Math.ceil(shortfall / 250);
    game.toushi   += units * 1000;
    game.mochiDama = units * 250 - shortfall;
  }
}

function addBalls(n) {
  game.mochiDama += n;
}

function handleSpinRateChange(value) {
  game.spinRate = Number(value);
  render();
}

// ---- 通常時ハンドラ ----

function checkEigyoAlert() {
  if (!game.eigyoAlertShown && game.totalSpins >= 4000) {
    game.eigyoAlertShown = true;
    setState('eigyo_alert');
    return true;
  }
  return false;
}

// 1回転処理。演出発生など画面遷移が起きたら true を返す
function runNormalSpin() {
  game.totalSpins++;
  game.currentSpins++;
  consumeSpinCost();
  const result = spinNormal();
  const interval = game.totalSpins - game.lastHitSpins;

  if (result === 'zugar' || result === 'false_enzoku') {
    game.pending = { type: result === 'zugar' ? 'zugar' : 'false' };
    addLog(`${interval}回転で先バレ発生！`);
    setState('enzoku');
    return true;
  }
  if (result === 'charge') {
    game.chargeCount++;
    addBalls(280);
    game.pending = { chargeLt: rollChargeLt() };
    addLog(`${interval}回転でチャージ ＋280球`, 'charge');
    setState('charge_result');
    return true;
  }
  return false;
}

function handleStart() {
  if (checkEigyoAlert()) return;
  runNormalSpin();
}

function autoSpin(count) {
  for (let i = 0; i < count; i++) {
    if (checkEigyoAlert()) return;
    if (runNormalSpin()) return;
  }
  setState('normal_idle');
}

function handleEnzokuJudge() {
  if (game.pending.type === 'zugar') {
    addLog('図柄ぞろい！', 'win');
    setState('win_result');
  } else {
    addLog('はずれ');
    setState('lose_result');
  }
}

function handleZugarVibun() {
  addBalls(1400);
  game.zugarCount++;
  game.currentSpins = 0;
  game.lastHitSpins = game.totalSpins;
  addLog('1500大当たり ＋1400球', 'win');
  setState('zugar_result');
}

function handleZugarLtChallenge() {
  setState('zugar_lt_challenge');
}

function handleZugarLtJudge() {
  if (rollZugarLtChallenge()) {
    enterRush();
    addLog('LTチャレンジ成功！ → RUSH突入', 'rush');
    setState('zugar_lt_win');
  } else {
    addLog('LTチャレンジ失敗 → 通常へ');
    setState('zugar_lt_lose');
  }
}

function handleAfterZugarLt() {
  setState(game.mode === 'rush' ? 'rush_idle' : 'normal_idle');
}

function handleChargeContinue() {
  if (game.pending.chargeLt) {
    addLog('LT当選！', 'rush');
    setState('charge_lt_announce');
  } else {
    backToNormal();
  }
}

function handleAfterChargeLt() {
  enterRush();
  setState('rush_idle');
}

function backToNormal() {
  game.mode = 'normal';
  setState('normal_idle');
}

function enterRush() {
  game.mode = 'rush';
  game.ltEntryCount++;
  game.rush = createRushState();
}

// ---- 営業終了・退店 ----

function handleEigyoHai() {
  setState(game.mode === 'rush' ? 'rush_idle' : 'normal_idle');
}

function handleEigyoIie() {
  setState('taiten_result');
}

function handleTaiten() {
  setState('taiten_result');
}

function resetGame() {
  game.state           = 'normal_idle';
  game.mode            = 'normal';
  game.spinRate        = DEFAULT_SPIN_RATE;
  game.mochiDama       = 0;
  game.toushi          = 0;
  game.totalSpins      = 0;
  game.currentSpins    = 0;
  game.lastHitSpins    = 0;
  game.zugarCount      = 0;
  game.chargeCount     = 0;
  game.ltEntryCount    = 0;
  game.totalRushHits   = 0;
  game.allRushStats    = { rushTotalSpins: 0, bonus6000: 0, bonus3000: 0 };
  game.rush            = null;
  game.pending         = {};
  game.eigyoAlertShown = false;
  game.log             = [];
  render();
}
```

- [ ] **Step 2: Commit**

```bash
git add script.js
git commit -m "feat: add game state and normal-mode flow handlers"
```

---

## Task 9: script.js — RUSH-mode flow (130-ST, 1/10/skip spins)

**Files:**
- Modify: `script.js`

- [ ] **Step 1: Append RUSH-mode handlers**

Add to `script.js`, after the `enterRush()` function from Task 8:

```js
// ---- RUSH(ST)中ハンドラ ----

// 1回転処理。画面遷移が起きたら true を返す
function runRushSpin(opts = {}) {
  game.allRushStats.rushTotalSpins++;
  const { rushState, outcome } = applyRushSpin(game.rush);
  game.rush = rushState;

  if (outcome === 'miss') {
    if (!opts.silent) {
      addLog(`ST残り${rushState.stRemaining}回`);
      setState('rush_miss');
      return true;
    }
    return false;
  }

  if (outcome === 'st_end') {
    addLog('ST終了 → RUSHリザルトへ');
    setState('rush_result');
    return true;
  }

  const isBig = outcome === 'hit_big';
  game.totalRushHits++;
  game.allRushStats[isBig ? 'bonus6000' : 'bonus3000']++;
  game.pending = { isBig };
  addLog(`${isBig ? '6000個' : '3000個'}！ ＋${isBig ? 5400 : 2800}球 (${rushState.chainCount}連)`, 'rush');
  setState('rush_hit_result');
  return true;
}

function handleRushSpin() {
  runRushSpin();
}

function handleRushSpin10() {
  for (let i = 0; i < 10; i++) {
    if (runRushSpin({ silent: true })) return;
  }
  setState('rush_idle');
}

function handleRushSkip() {
  for (;;) {
    if (runRushSpin({ silent: true })) return;
  }
}

function handleRushHitContinue() {
  setState('rush_idle');
}

function handleRushMissContinue() {
  setState('rush_idle');
}

function handleRushResultEnd() {
  addLog('RUSH終了 → 通常時へ');
  game.mode = 'normal';
  game.rush = null;
  setState('normal_idle');
}
```

`handleRushSpin10` and `handleRushSkip` mirror the existing `autoSpin()` pattern from Task 8: they call the single-spin function in a loop with a `silent` flag so intermediate misses don't each trigger a screen transition, stopping only on a hit or ST end — same shape as normal mode's 100/300-spin auto buttons.

- [ ] **Step 2: Commit**

```bash
git add script.js
git commit -m "feat: add RUSH-mode flow (130-ST reset, 1/10/skip spin controls)"
```

---

## Task 10: script.js — rendering (buildScreen, header, rush stats, log)

**Files:**
- Modify: `script.js`

- [ ] **Step 1: Append the rendering layer**

Add to `script.js`, after `resetGame()`:

```js
// ---- 状態セット & レンダリング ----

function setState(state) {
  game.state = state;
  render();
}

function render() {
  renderHeader();
  renderModeBadge();
  renderMainScreen();
  renderRushStats();
}

function renderHeader() {
  const mochiInt = Math.floor(game.mochiDama);
  document.getElementById('mochi-dama').textContent   = mochiInt.toLocaleString();
  document.getElementById('toushi-value').textContent = game.toushi.toLocaleString();

  const shuushi   = mochiInt * 4 - game.toushi;
  const shuushiEl = document.getElementById('shuushi-value');
  shuushiEl.textContent = (shuushi >= 0 ? '+' : '') + shuushi.toLocaleString();
  shuushiEl.className   = 'money-value ' + (shuushi >= 0 ? 'green' : 'red');
  document.getElementById('current-spins').textContent = game.currentSpins.toLocaleString();
  document.getElementById('total-spins-disp').textContent = game.totalSpins.toLocaleString();

  const rushCountEl = document.getElementById('rush-count');
  rushCountEl.textContent = game.mode === 'rush' ? `${game.rush.stRemaining}回` : '－';

  document.getElementById('zugar-count').textContent  = game.zugarCount + '回';
  document.getElementById('charge-count').textContent = game.chargeCount + '回';

  const zugarProb = game.zugarCount > 0 && game.totalSpins > 0
    ? '1/' + Math.round(game.totalSpins / game.zugarCount).toLocaleString()
    : '1/399';
  const chargeProb = game.chargeCount > 0 && game.totalSpins > 0
    ? '1/' + Math.round(game.totalSpins / game.chargeCount).toLocaleString()
    : '1/399';
  document.getElementById('zugar-prob').textContent  = zugarProb;
  document.getElementById('charge-prob').textContent = chargeProb;

  document.getElementById('rush-entry-info').textContent = `(LT突入${game.ltEntryCount}回)`;

  const normalHits = game.zugarCount + game.chargeCount;
  const grandTotal = normalHits + game.totalRushHits;
  document.getElementById('total-hit-count').textContent = grandTotal + '回';

  document.getElementById('normal-first-hit').textContent  = normalHits + '回';
  document.getElementById('normal-first-prob').textContent = normalHits > 0 && game.totalSpins > 0
    ? '1/' + Math.round(game.totalSpins / normalHits).toLocaleString()
    : '1/―';

  document.getElementById('fee-block').textContent = `${game.spinRate}回転/千円`;
}

function renderModeBadge() {
  const el = document.getElementById('mode-badge');
  if (game.mode === 'rush') {
    el.textContent = 'RUSH中';
    el.className = 'rush';
  } else {
    el.textContent = '通常時';
    el.className = '';
  }
}

function renderMainScreen() {
  document.getElementById('main-screen').innerHTML = buildScreen(game.state);
}

function spinRateOptionsHtml() {
  return SPIN_RATE_OPTIONS.map(rate =>
    `<option value="${rate}" ${rate === game.spinRate ? 'selected' : ''}>${rate}回転</option>`
  ).join('');
}

function autoSpinCostHint(count) {
  const yen = Math.round((count * calcSpinCost(game.spinRate) / 250) * 1000);
  return `約${yen.toLocaleString()}円消費`;
}

function buildScreen(state) {
  switch (state) {

    case 'normal_idle':
      return `<div class="screen">
        <button class="btn-start" onclick="handleStart()">START</button>
        <p class="prob-hint">図柄ぞろい 1/399.9　チャージ 1/399.9</p>
        <div class="spin-rate-block">
          <span class="spin-rate-label">1000円あたりの回転数</span>
          <select class="spin-rate-select" onchange="handleSpinRateChange(this.value)">
            ${spinRateOptionsHtml()}
          </select>
        </div>
        <div class="auto-spin-btns">
          <div class="auto-spin-wrap">
            <button class="btn-auto" onclick="autoSpin(100)">100回転</button>
            <p class="spin-cost-hint">${autoSpinCostHint(100)}</p>
          </div>
          <div class="auto-spin-wrap">
            <button class="btn-auto" onclick="autoSpin(300)">300回転</button>
            <p class="spin-cost-hint">${autoSpinCostHint(300)}</p>
          </div>
        </div>
        <button class="btn-taiten" onclick="handleTaiten()">退店する</button>
      </div>`;

    case 'enzoku':
      return `<div class="screen">
        <p class="enzoku-label">先バレ発生！</p>
        <img src="画像/グール先バレ.webp" class="enzoku-img" alt="先バレ演出">
        <p class="shinraiudo">信頼度 70%</p>
        <button class="btn-action" onclick="handleEnzokuJudge()">▶ 判定に進む</button>
      </div>`;

    case 'win_result':
      return `<div class="screen">
        <p class="result-main win">図柄ぞろい！</p>
        <p style="font-size:56px; margin:4px 0;">🎰</p>
        <button class="btn-action" onclick="handleZugarVibun()">▶ 振り分けへ</button>
      </div>`;

    case 'lose_result':
      return `<div class="screen">
        <p class="result-main lose">はずれ</p>
        <button class="btn-sub" onclick="backToNormal()" style="margin-top:8px;">続ける</button>
      </div>`;

    case 'charge_result':
      return `<div class="screen">
        <p class="result-main charge">チャージ！</p>
        <p class="result-balls">＋280球</p>
        <button class="btn-sub" onclick="handleChargeContinue()">続ける</button>
      </div>`;

    case 'charge_lt_announce':
      return `<div class="screen">
        <p class="add-rush-title">LT当選！</p>
        <img src="画像/RUSH中　追加ボーナス演出.png" class="enzoku-img" alt="LT当選演出"
          onerror="this.style.display='none'">
        <button class="btn-action" onclick="handleAfterChargeLt()">▶ RUSHへ</button>
      </div>`;

    case 'zugar_result':
      return `<div class="screen">
        <div class="vibun-box normal-box">
          <p class="bonus-main standard">1500大当たり</p>
          <p class="bonus-sub">＋1,400球獲得</p>
        </div>
        <button class="btn-action" onclick="handleZugarLtChallenge()">▶ 次へ</button>
      </div>`;

    case 'zugar_lt_challenge':
      return `<div class="screen">
        <p class="add-rush-title">LTチャレンジ！</p>
        <p class="result-sub">継続率 50%</p>
        <button class="btn-action" onclick="handleZugarLtJudge()">▶ 判定</button>
      </div>`;

    case 'zugar_lt_win':
      return `<div class="screen">
        <p class="add-rush-title">LT突入！</p>
        <img src="画像/RUSH中　追加ボーナス演出.png" class="enzoku-img" alt="LT突入演出"
          onerror="this.style.display='none'">
        <button class="btn-action" onclick="handleAfterZugarLt()">▶ RUSHへ</button>
      </div>`;

    case 'zugar_lt_lose':
      return `<div class="screen">
        <p class="result-main lose" style="font-size:28px;">LTならず…</p>
        <button class="btn-sub" onclick="handleAfterZugarLt()" style="margin-top:12px;">続ける</button>
      </div>`;

    case 'rush_idle':
      return `<div class="screen">
        <p class="chain-label">${game.rush.chainCount}連チャン中</p>
        <p class="rush-title">RUSH</p>
        <p class="rush-sub">ST残り <span>${game.rush.stRemaining}</span> 回</p>
        <div class="rush-spin-btns">
          <button class="btn-rush-spin" onclick="handleRushSpin()">1回転</button>
          <button class="btn-rush-spin" onclick="handleRushSpin10()">10回転</button>
          <button class="btn-rush-spin skip" onclick="handleRushSkip()">スキップ</button>
        </div>
        <p class="prob-hint">大当たり確率 1/95.3</p>
        <button class="btn-taiten" onclick="handleTaiten()">退店する</button>
      </div>`;

    case 'rush_hit_result': {
      const isBig = game.pending.isBig;
      return `<div class="screen">
        <div class="vibun-box rush-box">
          <p class="bonus-main ${isBig ? 'premium' : 'standard'}">${isBig ? '6000個' : '3000個'}</p>
          <p class="bonus-sub">＋${isBig ? '5,400' : '2,800'}球獲得</p>
        </div>
        <button class="btn-action" onclick="handleRushHitContinue()" style="margin-top:16px;">
          ▶ RUSH継続へ
        </button>
      </div>`;
    }

    default:
      return `<div class="screen"><p>...</p></div>`;
  }
}
```

This relies on `runRushSpin` (Task 9) storing `game.pending = { isBig }` on every hit — the same pattern already used for `pending.type` (先バレ) and `pending.chargeLt` (チャージ) earlier in this file.

- [ ] **Step 2: Add the remaining screen cases (rush_miss, rush_result, eigyo_alert, taiten_result) and the stats/log renderers**

Insert these `case` blocks into `buildScreen` right before the `default:` case:

```js
    case 'rush_miss':
      return `<div class="screen">
        <p class="result-main lose">外れ</p>
        <p style="color:#ff9900; font-size:18px; margin-top:4px;">ST残り ${game.rush.stRemaining}回</p>
        <button class="btn-sub" onclick="handleRushMissContinue()" style="margin-top:12px;">続ける</button>
      </div>`;

    case 'rush_result': {
      const s = game.rush;
      const lines = [];
      if (s.bonus6000 > 0) {
        lines.push(`<div class="result-row">
          <span class="rr-label">6000個</span>
          <span class="rr-val">×${s.bonus6000}回</span>
        </div>`);
      }
      if (s.bonus3000 > 0) {
        lines.push(`<div class="result-row">
          <span class="rr-label">3000個</span>
          <span class="rr-val">×${s.bonus3000}回</span>
        </div>`);
      }
      if (lines.length === 0) lines.push(`<p style="color:#555; font-size:13px;">大当たりなし</p>`);
      return `<div class="screen">
        <p class="rush-result-title">RUSH リザルト</p>
        <div class="rush-result-box">
          <div class="result-row highlight">
            <span class="rr-label">連チャン数</span>
            <span class="rr-val gold">${s.chainCount}連チャン</span>
          </div>
          <div class="result-row">
            <span class="rr-label">獲得出玉</span>
            <span class="rr-val gold">${s.actualBalls.toLocaleString()}球</span>
          </div>
          <div class="result-row">
            <span class="rr-label">表示出玉</span>
            <span class="rr-val">${s.nominalBalls.toLocaleString()}個</span>
          </div>
          <hr class="result-hr">
          <p class="rr-section">ボーナス内訳</p>
          ${lines.join('')}
        </div>
        <button class="btn-action" onclick="handleRushResultEnd()" style="margin-top:16px;">▶ 通常へ戻る</button>
      </div>`;
    }

    case 'eigyo_alert':
      return `<div class="screen">
        <p style="font-size:22px; font-weight:bold; color:#f0c040; text-align:center; line-height:1.6;">
          営業時間終了になりました
        </p>
        <p style="font-size:16px; color:#ccc; text-align:center;">このまま居座り続けますか？</p>
        <div style="display:flex; gap:16px; margin-top:8px;">
          <button class="btn-action" style="flex:1;" onclick="handleEigyoHai()">はい</button>
          <button class="btn-action" style="flex:1; background:linear-gradient(135deg,#555,#333); border-color:#888;"
            onclick="handleEigyoIie()">いいえ</button>
        </div>
      </div>`;

    case 'taiten_result': {
      const mochi    = Math.floor(game.mochiDama);
      const mochiYen = mochi * 4;
      const shuushi  = mochiYen - game.toushi;
      const shuushiColor = shuushi >= 0 ? '#44cc88' : '#cc6666';
      const shuushiSign  = shuushi >= 0 ? '＋' : '';
      return `<div class="screen">
        <p style="font-size:24px; font-weight:bold; color:#aaa;">退店します</p>
        <div class="rush-result-box" style="max-width:320px;">
          <p class="rr-section" style="margin-bottom:8px;">収支発表</p>
          <div class="result-row">
            <span class="rr-label">総回転数</span>
            <span class="rr-val">${game.totalSpins.toLocaleString()}回</span>
          </div>
          <div class="result-row">
            <span class="rr-label">投資金額</span>
            <span class="rr-val" style="color:#cc6666;">${game.toushi.toLocaleString()}円</span>
          </div>
          <div class="result-row">
            <span class="rr-label">持ち球換算</span>
            <span class="rr-val">${mochiYen.toLocaleString()}円</span>
          </div>
          <hr class="result-hr">
          <div class="result-row highlight">
            <span class="rr-label" style="font-weight:bold;">収支</span>
            <span class="rr-val" style="color:${shuushiColor}; font-size:22px;">
              ${shuushiSign}${shuushi.toLocaleString()}円
            </span>
          </div>
          <hr class="result-hr">
          <div class="result-row">
            <span class="rr-label">図柄ぞろい</span>
            <span class="rr-val">${game.zugarCount}回</span>
          </div>
          <div class="result-row">
            <span class="rr-label">チャージ</span>
            <span class="rr-val">${game.chargeCount}回</span>
          </div>
          <div class="result-row">
            <span class="rr-label">RUSH大当たり</span>
            <span class="rr-val">${game.totalRushHits}回</span>
          </div>
        </div>
        <button class="btn-action" onclick="resetGame()" style="margin-top:8px;">▶ 最初の画面に戻る</button>
      </div>`;
    }
```

Then append the stats/log renderers and the initial `render()` call at the very end of `script.js`:

```js
function renderRushStats() {
  const a     = game.allRushStats;
  const hits  = game.totalRushHits;
  const spins = a.rushTotalSpins;
  const prob  = hits > 0 && spins > 0
    ? '1/' + (spins / hits).toFixed(1)
    : '1/―';
  document.getElementById('rs-chain').textContent = hits + '回';
  document.getElementById('rs-prob').textContent  = prob;
  document.getElementById('rs-spins').textContent = spins + '回';
  document.getElementById('rs-6000').textContent  = a.bonus6000 + '回';
  document.getElementById('rs-3000').textContent  = a.bonus3000 + '回';
}

function renderLog() {
  const el = document.getElementById('log-list');
  el.innerHTML = game.log.map(item =>
    `<div class="log-item ${item.type}">${item.text}</div>`
  ).join('');
}

render();
```

- [ ] **Step 3: Commit**

```bash
git add script.js
git commit -m "feat: add rendering layer (screens, header stats, RUSH stats, log)"
```

---

## Task 11: End-to-end manual verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full logic.js test suite**

Run: `cd /c/Users/ab_99/pachinko-simulator-ghoul && node --test "test/**/*.test.js"`
Expected: PASS, 0 failures

- [ ] **Step 2: Open the page in a browser**

```powershell
Start-Process "C:\Users\ab_99\pachinko-simulator-ghoul\index.html"
```

- [ ] **Step 3: Walk through the normal-mode golden path**

- Click START repeatedly (or use 300回転) until a 先バレ occurs → click 判定に進む.
  - If 図柄ぞろい: confirm the screen shows "1500大当たり ＋1,400球獲得", click 次へ, confirm "LTチャレンジ！" screen appears, click 判定 — confirm it either shows the LT突入 screen (image loads or gracefully hides via `onerror`) leading into RUSH, or the "LTならず…" screen leading back to normal.
  - If はずれ: confirm it returns to normal_idle.
- Confirm a チャージ event shows "チャージ！ ＋280球"; click 続ける. Repeat until one triggers `chargeLt` (rare, 1/100) to confirm the "LT当選！" announce screen appears and leads into RUSH.
- Change the スピンレート dropdown between 14/16/18 and confirm the 100回転/300回転 cost hints under the buttons update accordingly, and that `fee-block` in the header updates after any spin.

- [ ] **Step 4: Walk through the RUSH golden path**

- Once in RUSH, confirm ST残り starts at 130 and the mode badge shows "RUSH中".
- Click 1回転 a few times, confirm each miss decrements ST残り by 1 and each hit shows the 3000個/6000個 result screen with correct ball counts, then ▶ RUSH継続へ resets ST残り to 130.
- Click 10回転 and confirm it silently fast-forwards misses, stopping only on a hit or ST-end screen.
- Click スキップ and confirm it fast-forwards all the way to the next hit or the rush_result screen without intermediate flicker.
- Let ST reach 0 with no further hits and confirm the RUSH リザルト screen shows correct 連チャン数/獲得出玉/表示出玉/内訳, then ▶ 通常へ戻る returns to normal_idle with mode badge back to "通常時".

- [ ] **Step 5: Sanity-check 退店 and 営業時間終了**

- Click 退店する from normal_idle, confirm the 収支発表 screen shows correct totals, then ▶ 最初の画面に戻る resets everything (spin rate back to 16, ST/mode/log cleared).
- (Optional, slow) Run 300回転 repeatedly until totalSpins ≥ 4000 and confirm the 営業時間終了 alert appears once and only once.

- [ ] **Step 6: Fix any bugs found during manual verification, then commit**

```bash
git add -A
git commit -m "fix: address issues found during manual end-to-end verification"
```

(Skip this commit if no fixes were needed.)

---

## Self-Review Notes

- **Spec coverage:** file structure (Task 1/6/7), charge probability 1/399.9 + charge-LT 1/100 (Task 3/8), zugar probability 1/399.9 + uniform 1500/1400-ball reveal + 50% LT challenge (Task 3/8/10), RUSH 130-ST reset + 1/95.3 + 97%/3% split with no upsell judge (Task 4/5/9), spin-rate dropdown 14/16/18 default 16 normal-only (Task 2/8/10), dynamic auto-spin cost display (Task 10), RUSH 1/10/skip buttons (Task 9/10) — all covered.
- **Placeholder scan:** none left; `rush_hit_result` is written correctly on the first pass using `game.pending.isBig`, set by `runRushSpin` in Task 9.
- **Type/name consistency:** `game.rush` (not `game.rushStats`), `game.ltEntryCount` (not `rushEntryCount`), `game.allRushStats` has only `bonus6000`/`bonus3000`/`rushTotalSpins` (no `uenose3000`) — consistent across Tasks 8–10.
