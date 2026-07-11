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
