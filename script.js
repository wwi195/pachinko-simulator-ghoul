'use strict';

const game = {
  state: 'normal_idle',
  mode: 'normal',
  spinRate: DEFAULT_SPIN_RATE,
  enzokuConfidence: DEFAULT_ENZOKU_CONFIDENCE,
  mochiDama: 0,
  toushi: 0,
  totalSpins: 0,
  currentSpins: 0,
  lastHitSpins: 0,
  zugarCount: 0,
  streaks: { charge_no_lt: 0, lt_fail: 0, lt_win: 0, enzoku_miss: 0, tanpatsu: 0 },
  lastChainSpins: 0,
  hitHistory: [],     // 大当たり履歴 [{games, kind, chain}]（新しい順。chain=null は結果待ち、0はRUSHなし）
  lastAnyHitTotal: 0, // 直前の大当たり（チャージ・図柄揃い）時点の総回転数
  chargeCount: 0,
  ltEntryCount: 0,
  totalRushHits: 0,
  allRushStats: { rushTotalSpins: 0, bonus6000: 0, bonus3000: 0 },
  rush: null,
  rushCycleSpins: 0,
  rushEntryBonus: null,
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

function handleEnzokuConfidenceChange(value) {
  game.enzokuConfidence = Number(value);
  render();
}

// ---- 通常時ハンドラ ----

function checkEigyoAlert() {
  if (!game.eigyoAlertShown && game.totalSpins >= 2000) {
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
  const result = spinNormal(game.enzokuConfidence);
  const interval = game.totalSpins - game.lastHitSpins;

  if (result === 'zugar' || result === 'false_enzoku') {
    game.pending = { type: result === 'zugar' ? 'zugar' : 'false', interval };
    addLog(`${interval}回転で先バレ発生！`);
    setState('enzoku');
    return true;
  }
  if (result === 'charge') {
    game.chargeCount++;
    addBalls(280);
    game.pending = { chargeLt: rollChargeLt(), interval };
    recordHit('charge', game.pending.chargeLt ? null : 0);
    addLog(`${interval}回転でチャージ ＋280球`, 'charge');
    setState('charge_result');
    return true;
  }
  return false;
}

function handleStart() {
  if (checkEigyoAlert()) return;
  // 何も起きなかった回転は「はずれ」画面を挟まず、そのまま通常画面に留まる
  if (!runNormalSpin()) {
    setState('normal_idle');
  }
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
    game.streaks.enzoku_miss = 0;
    addLog('図柄ぞろい！', 'win');
    setState('win_result');
  } else {
    game.streaks.enzoku_miss++;
    addLog('はずれ');
    setState('lose_result');
  }
}

function handleZugarVibun() {
  game.streaks.charge_no_lt = 0;
  addBalls(1400);
  game.zugarCount++;
  recordHit('zugar', null); // RUSH有無はLTチャレンジで確定
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
    game.streaks.lt_win++;
    game.streaks.lt_fail = 0;
    enterRush({ label: '初当たり', nominal: 1500, actual: 1400 });
    addLog('LTチャレンジ成功！ → RUSH突入', 'rush');
    setState('zugar_lt_win');
  } else {
    game.streaks.lt_fail++;
    game.streaks.lt_win = 0;
    game.streaks.tanpatsu++;
    setLatestHitChain(0);
    addLog('LTチャレンジ失敗 → 通常へ');
    setState('zugar_lt_lose');
  }
}

function handleAfterZugarLt() {
  setState(game.mode === 'rush' ? 'rush_idle' : 'normal_idle');
}

function handleChargeContinue() {
  if (!game.pending.chargeLt) {
    game.streaks.charge_no_lt++;
    game.streaks.tanpatsu++;
    // 連続回数の告知が出る場合は、LTならずの画面を挟む
    if (game.streaks.charge_no_lt >= STREAK_NOTICE_MIN || game.streaks.tanpatsu >= TANPATSU_NOTICE_MIN) {
      setState('charge_lt_lose');
      return;
    }
  }
  if (game.pending.chargeLt) {
    game.streaks.charge_no_lt = 0;
    setState('charge_lt_pending');
    setTimeout(() => {
      addLog('LT当選！', 'rush');
      setState('charge_lt_announce');
    }, 1000);
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

function enterRush(entryBonus = null) {
  game.mode = 'rush';
  game.ltEntryCount++;
  game.rush = createRushState();
  game.rushCycleSpins = 0;
  game.rushEntryBonus = entryBonus;
}

// ---- RUSH(ST)中ハンドラ ----

// 1回転処理。画面遷移が起きたら true を返す
function runRushSpin(opts = {}) {
  game.allRushStats.rushTotalSpins++;
  game.rushCycleSpins++;
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
    setLatestHitChain(rushState.chainCount + 1); // 初当たり含む連チャン数
    // 1連で終了なら単発、2連以上なら単発カウントとハマり起点をリセット
    if (rushState.chainCount === 0) {
      game.streaks.tanpatsu++;
    } else {
      game.streaks.tanpatsu = 0;
      game.lastChainSpins = game.totalSpins;
    }
    addLog('ST終了 → RUSHリザルトへ');
    setState('rush_result');
    return true;
  }

  const isBig = outcome === 'hit_big';
  const balls = isBig ? 5600 : 2800;
  game.totalRushHits++;
  game.allRushStats[isBig ? 'bonus6000' : 'bonus3000']++;
  addBalls(balls);
  game.pending = { isBig, spinsThisCycle: game.rushCycleSpins };
  game.rushCycleSpins = 0;
  addLog(`${isBig ? '6000個' : '3000個'}！ ＋${balls}球 (${rushState.chainCount + 1}連)`, 'rush');
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
    if (game.rush.stRemaining <= 10) {
      setState('rush_idle');
      return;
    }
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
  game.rushCycleSpins = 0;
  game.rushEntryBonus = null;
  setState('normal_idle');
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
  game.enzokuConfidence = DEFAULT_ENZOKU_CONFIDENCE;
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
  game.rushCycleSpins  = 0;
  game.rushEntryBonus  = null;
  game.pending         = {};
  game.eigyoAlertShown = false;
  game.streaks         = { charge_no_lt: 0, lt_fail: 0, lt_win: 0, enzoku_miss: 0, tanpatsu: 0 };
  game.lastChainSpins  = 0;
  game.hitHistory      = [];
  game.lastAnyHitTotal = 0;
  game.log             = [];
  render();
}

// ---- 状態セット & レンダリング ----

function setState(state) {
  game.state = state;
  render();
}

// 連続発生の告知（5回連続目から表示）。1%未満なら希少性も付ける
const STREAK_NOTICE_MIN = 5;

function streakNoticeHtml(kind, label) {
  const n = game.streaks[kind];
  if (n < STREAK_NOTICE_MIN) return '';
  const prob = streakProbability(kind, n, game.enzokuConfidence);
  const pct = prob * 100;
  const pctText = pct >= 1 ? pct.toFixed(1) : pct >= 0.01 ? pct.toFixed(2) : pct.toPrecision(2);
  const rare = pct < 1 ? `<br>約${Math.round(1 / prob).toLocaleString()}回に1回の割合です` : '';
  return `<p class="streak-notice">${label}　${n}回連続中<br>発生率 ${pctText}%${rare}</p>`;
}

// 単発の連続告知（7回連続目から）。前回の連チャンからのハマり回転数も表示
const TANPATSU_NOTICE_MIN = 7;

function tanpatsuNoticeHtml() {
  const n = game.streaks.tanpatsu;
  if (n < TANPATSU_NOTICE_MIN) return '';
  const prob = streakProbability('tanpatsu', n);
  const pct = prob * 100;
  const pctText = pct >= 1 ? pct.toFixed(1) : pct >= 0.01 ? pct.toFixed(2) : pct.toPrecision(2);
  const rare = pct < 1 ? `<br>約${Math.round(1 / prob).toLocaleString()}回に1回の割合です` : '';
  const hamari = game.totalSpins - game.lastChainSpins;
  return `<p class="streak-notice">単発　${n}回連続中<br>発生率 ${pctText}%${rare}<br>
    前回の連チャンから ${hamari.toLocaleString()}回転ハマり</p>`;
}

// 確率の表示。1%未満なら「約○回に1回」の希少性表示を付ける
function probRowHtml(label, prob) {
  const pct = prob * 100;
  const pctText = pct >= 1 ? pct.toFixed(1) : pct >= 0.01 ? pct.toFixed(2) : pct.toPrecision(2);
  const rare = pct < 1
    ? `<p class="rr-rare">約${Math.round(1 / prob).toLocaleString()}回に1回の割合です</p>`
    : '';
  return `<div class="result-row">
      <span class="rr-label">${label}</span>
      <span class="rr-val">${pctText}%</span>
    </div>${rare}`;
}

// ---- 大当たり履歴グラフ ----
function recordHit(kind, chain) {
  const games = game.totalSpins - game.lastAnyHitTotal;
  game.lastAnyHitTotal = game.totalSpins;
  game.hitHistory.unshift({ games, kind, chain });
}
function setLatestHitChain(chain) {
  const last = game.hitHistory[0];
  if (last && last.chain === null) last.chain = chain;
}

const HIST_BLOCK = 100;
const HIST_MAX_BLOCKS = 7;
function renderHitGraph() {
  const el = document.getElementById('hist-cols');
  if (!el) return;
  const col = (cls, games, label, idx) => {
    const blocks = Math.min(HIST_MAX_BLOCKS, Math.max(1, Math.ceil(games / HIST_BLOCK)));
    const more = games >= HIST_BLOCK * HIST_MAX_BLOCKS ? '<div class="hist-more">▲</div>' : '';
    return `<div class="hist-col ${cls}">
      <div class="hist-g">${games}</div>${more}
      ${'<div class="hist-block"></div>'.repeat(blocks)}
      <div class="hist-type">${label}</div>
      <div class="hist-idx">${idx}</div>
    </div>`;
  };
  let html = col('now', game.totalSpins - game.lastAnyHitTotal, '現在', '');
  game.hitHistory.forEach((h, i) => {
    let cls, label;
    if (h.chain === null) { cls = 'pending'; label = '…'; }
    else if (h.chain >= 1) { cls = h.chain >= 10 ? 'big-chain' : 'rush'; label = `${h.chain}連`; }
    else if (h.kind === 'charge') { cls = 'charge'; label = 'チャージ'; }
    else { cls = 'zugar'; label = '図柄'; }
    html += col(cls, h.games, label, i + 1);
  });
  if (game.hitHistory.length === 0) html += '<div class="hist-empty">まだ大当たりがありません</div>';
  el.innerHTML = html;
}

function render() {
  renderHeader();
  renderModeBadge();
  renderMainScreen();
  renderRushStats();
  renderHitGraph();
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

function enzokuConfidenceOptionsHtml() {
  return ENZOKU_CONFIDENCE_OPTIONS.map(pct =>
    `<option value="${pct}" ${pct === game.enzokuConfidence ? 'selected' : ''}>${pct}%</option>`
  ).join('');
}

function tenThousandYenSpins() {
  return game.spinRate * 10;
}

// interactive=false は喰種CHARGE→LT昇格の1秒サスペンス演出中に使う、
// 見た目は通常時画面のままボタン操作だけを無効化した画面
function buildNormalIdleScreen(interactive) {
  const startAttr  = interactive ? ' onclick="handleStart()"' : '';
  const confAttr   = interactive ? ' onchange="handleEnzokuConfidenceChange(this.value)"' : '';
  const rateAttr   = interactive ? ' onchange="handleSpinRateChange(this.value)"' : '';
  const spinAttr   = interactive ? ` onclick="autoSpin(${tenThousandYenSpins()})"` : '';
  const taitenAttr = interactive ? ' onclick="handleTaiten()"' : '';
  return `<div class="screen">
    <button class="btn-start"${startAttr}>START</button>
    <p class="prob-hint">図柄ぞろい 1/399.9　チャージ 1/399.9</p>
    <div class="spin-rate-block">
      <span class="spin-rate-label">先バレ確率</span>
      <select class="spin-rate-select"${confAttr}>
        ${enzokuConfidenceOptionsHtml()}
      </select>
    </div>
    <div class="spin-rate-block">
      <span class="spin-rate-label">1000円あたりの回転数</span>
      <select class="spin-rate-select"${rateAttr}>
        ${spinRateOptionsHtml()}
      </select>
    </div>
    <div class="auto-spin-btns">
      <div class="auto-spin-wrap">
        <button class="btn-auto"${spinAttr}>1万円分回す</button>
        <p class="spin-cost-hint">約${tenThousandYenSpins()}回転分</p>
      </div>
    </div>
    <button class="btn-taiten"${taitenAttr}>退店する</button>
  </div>`;
}

function buildScreen(state) {
  switch (state) {

    case 'normal_idle':
      return buildNormalIdleScreen(true);

    case 'charge_lt_pending':
      return buildNormalIdleScreen(false);

    case 'enzoku':
      return `<div class="screen">
        <p class="enzoku-label">${game.pending.interval}回転　先バレ発生！</p>
        <img src="画像/グール先バレ.webp" class="enzoku-img" alt="先バレ演出">
        <p class="shinraiudo">信頼度 ${game.enzokuConfidence}%</p>
        <button class="btn-action" onclick="handleEnzokuJudge()">▶ 判定に進む</button>
      </div>`;

    case 'win_result':
      return `<div class="screen">
        <p class="result-main win">図柄ぞろい！</p>
        <p class="result-sub">${game.pending.interval.toLocaleString()}回転</p>
        <p style="font-size:56px; margin:4px 0;">🎰</p>
        <button class="btn-action" onclick="handleZugarVibun()">▶ 振り分けへ</button>
      </div>`;

    case 'lose_result':
      return `<div class="screen">
        <p class="result-main lose">はずれ</p>
        ${streakNoticeHtml('enzoku_miss', '先バレはずれ')}
        <button class="btn-sub" onclick="backToNormal()" style="margin-top:8px;">続ける</button>
      </div>`;

    case 'charge_result':
      return `<div class="screen">
        <p class="result-sub">${game.pending.interval}回転</p>
        <p class="result-main charge"><span style="color:#ff4444;">喰</span><span style="color:#ccc;">種CHARGE</span></p>
        <p class="result-balls">＋280球</p>
        <button class="btn-sub" onclick="handleChargeContinue()">続ける</button>
      </div>`;

    case 'charge_lt_lose':
      return `<div class="screen">
        <p class="result-main lose" style="font-size:24px;">チャージ　LTならず</p>
        ${streakNoticeHtml('charge_no_lt', 'グールチャージ（LTならず）')}
        ${tanpatsuNoticeHtml()}
        <button class="btn-sub" onclick="backToNormal()" style="margin-top:12px;">続ける</button>
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
        <button class="btn-action" onclick="handleZugarLtChallenge()">▶ LTチャレンジ</button>
      </div>`;

    case 'zugar_lt_challenge':
      return `<div class="screen">
        <p class="add-rush-title">LTチャレンジ！</p>
        <p class="result-sub">成功率 50%</p>
        <button class="btn-action" onclick="handleZugarLtJudge()">▶ 判定</button>
      </div>`;

    case 'zugar_lt_win':
      return `<div class="screen">
        <p class="add-rush-title">LT突入！</p>
        ${streakNoticeHtml('lt_win', 'LT突入')}
        <img src="画像/RUSH中　追加ボーナス演出.png" class="enzoku-img" alt="LT突入演出"
          onerror="this.style.display='none'">
        <button class="btn-action" onclick="handleAfterZugarLt()">▶ RUSHへ</button>
      </div>`;

    case 'zugar_lt_lose':
      return `<div class="screen">
        <p class="result-main lose" style="font-size:28px;">LTならず…</p>
        ${streakNoticeHtml('lt_fail', 'LT突入ならず')}
        ${tanpatsuNoticeHtml()}
        <button class="btn-sub" onclick="handleAfterZugarLt()" style="margin-top:12px;">続ける</button>
      </div>`;

    case 'rush_idle': {
      const skipDisabled = game.rush.stRemaining <= 10;
      return `<div class="screen">
        <p class="chain-label">${game.rush.chainCount + 1}連チャン中</p>
        <p class="rush-title">3000ﾗｯｷｰﾄﾘｶﾞｰ</p>
        <p class="rush-sub">ST残り <span>${game.rush.stRemaining}</span> 回</p>
        <div class="rush-spin-btns">
          <button class="btn-rush-spin" onclick="handleRushSpin()">1回転</button>
          <button class="btn-rush-spin" onclick="handleRushSpin10()">10回転</button>
          <button class="btn-rush-spin skip" ${skipDisabled ? 'disabled' : 'onclick="handleRushSkip()"'}>スキップ</button>
        </div>
        <p class="prob-hint">大当たり確率 1/95.3</p>
        <button class="btn-taiten" onclick="handleTaiten()">退店する</button>
      </div>`;
    }

    case 'rush_hit_result': {
      const isBig = game.pending.isBig;
      return `<div class="screen">
        <p class="result-sub">${game.pending.spinsThisCycle}回転で当選</p>
        <p class="chain-label">${game.rush.chainCount + 1}連チャン中</p>
        <div class="vibun-box rush-box">
          <p class="bonus-main ${isBig ? 'premium' : 'standard'}">HYPER喰種BONUS ${isBig ? '6000' : '3000'}</p>
          <p class="bonus-sub">＋${isBig ? '5,600' : '2,800'}球獲得</p>
        </div>
        <button class="btn-action" onclick="handleRushHitContinue()" style="margin-top:16px;">
          ▶ RUSH継続へ
        </button>
      </div>`;
    }

    case 'rush_miss':
      return `<div class="screen">
        <p class="result-main lose">外れ</p>
        <p style="color:#ff9900; font-size:18px; margin-top:4px;">ST残り ${game.rush.stRemaining}回</p>
        <button class="btn-sub" onclick="handleRushMissContinue()" style="margin-top:12px;">続ける</button>
      </div>`;

    case 'rush_result': {
      const s = game.rush;
      const bonus = game.rushEntryBonus;
      const lines = [];
      if (bonus) {
        lines.push(`<div class="result-row">
          <span class="rr-label">初当たり${bonus.nominal}</span>
          <span class="rr-val">×1回</span>
        </div>`);
      }
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

      // 初当たりを1連チャン目として数える（RUSH中の当選回数＋1）
      const totalChain = s.chainCount + 1;
      const dist = chainProbability(s.chainCount);
      const totalActual  = s.actualBalls  + (bonus ? bonus.actual  : 0);
      const totalNominal = s.nominalBalls + (bonus ? bonus.nominal : 0);

      return `<div class="screen">
        <p class="rush-result-title">RUSH リザルト</p>
        <div class="rush-result-box">
          <div class="result-row highlight">
            <span class="rr-label">連チャン数</span>
            <span class="rr-val gold">${totalChain}連チャン</span>
          </div>
          <div class="result-row">
            <span class="rr-label">獲得出玉</span>
            <span class="rr-val gold">${totalActual.toLocaleString()}球</span>
          </div>
          <div class="result-row">
            <span class="rr-label">表示出玉</span>
            <span class="rr-val">${totalNominal.toLocaleString()}個</span>
          </div>
          <hr class="result-hr">
          <p class="rr-section">連チャン分布（ST当選率 ${(P_ST_HIT * 100).toFixed(1)}%）</p>
          ${probRowHtml(`${totalChain}連で終わる確率`, dist.exact)}
          ${probRowHtml(`${totalChain}連以上に届く確率`, dist.atLeast)}
          <hr class="result-hr">
          <p class="rr-section">ボーナス内訳</p>
          ${lines.join('')}
        </div>
        ${tanpatsuNoticeHtml()}
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

    default:
      return `<div class="screen"><p>...</p></div>`;
  }
}

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
