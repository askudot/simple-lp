import { screenPools } from './screening.js';
import { getActiveBin, deployPool, trackPosition } from './deploy.js';
import { getEnrichedPositions } from './positions.js';
import { closePosition } from './deploy.js';
import { DEPLOY } from './config.js';
import readline from 'readline';

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function ask(question) {
  return new Promise((resolve) => rl.question(question, resolve));
}

function fmt(n) {
  if (n == null) return '?';
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
  return '$' + (n / 1e3).toFixed(0) + 'k';
}

function calcBins(vol, mult, binStep) {
  const target = vol * mult;
  const r = binStep / 10000;
  const ratio = 1 - target / 100;
  const binsDown = -Math.floor(Math.log(ratio) / Math.log(1 + r));
  return { target, binsDown, total: binsDown + 1 };
}

// ── SCREENING + DEPLOY FLOW ─────────────────────────────
async function doScreening() {
  const { pools } = await screenPools({ limit: 10 });
  const scored = pools.map(p => ({
    ...p,
    score: ((p.organic || 0) * (p.feeTvlRatio || 0) * 0.01),
  })).sort((a, b) => b.score - a.score);

  console.log('\n📊 SCREENING\n');
  console.log('| # | Pool             | Mkt Cap   | Vol      | TVL    | Fee/TVL | BinStep/Fee | Score |');
  console.log('|---|-----------------|-----------|----------|--------|---------|--------------|-------|');

  scored.forEach((p, i) => {
    const name = (p.name || '?').slice(0, 17);
    console.log(
      '| ' + String(i + 1).padStart(2) + ' | ' + name.padEnd(17) +
      ' | ' + fmt(p.mcap).padStart(9) +
      ' | ' + fmt(p.volume24h).padStart(8) +
      ' | ' + fmt(p.tvl).padStart(6) +
      ' | ' + (p.feeTvlRatio?.toFixed(2) + '%').padStart(7) +
      ' | ' + (p.binStep + '/' + p.feePct + '%').padStart(12) +
      ' | ' + p.score.toFixed(2).padStart(5) + ' |'
    );
  });
  console.log('');

  // Pick pool
  const pick = await ask('Pick pool (number): ');
  const idx = parseInt(pick) - 1;
  rl.close();

  if (isNaN(idx) || idx < 0 || idx >= scored.length) {
    console.log('Invalid selection.\n');
    return;
  }

  await showDetail(scored, idx);
}

// ── SHOW DETAIL + PICK MULTIPLIER ──────────────────────
async function showDetail(scored, idx) {
  const p = scored[idx];

  let bin;
  try {
    bin = await getActiveBin(p.pool);
  } catch {
    bin = { binId: '?', price: '?' };
  }

  const calc5 = calcBins(p.volatility, 5, p.binStep);
  const calc10 = calcBins(p.volatility, 10, p.binStep);

  console.log('\n📌 ' + p.name.toUpperCase() + ' — Detail');
  console.log('');
  console.log('| Field | Value |');
  console.log('| ---------------- | -------------------------------- |');
  console.log('| Pool Address | ' + p.pool + ' |');
  console.log('| Base Token | ' + p.baseSymbol + ' (' + p.baseMint?.slice(0, 10) + '...) |');
  console.log('| Fee | ' + p.feePct + '% |');
  console.log('| TVL | ' + fmt(p.tvl) + ' |');
  console.log('| Volume 24h | ' + fmt(p.volume24h) + ' |');
  console.log('| Vol Change | ' + (p.volumeChange >= 0 ? '▲' : '▼') + Math.abs(p.volumeChange).toFixed(1) + '% |');
  console.log('| Holders | ' + p.holders?.toLocaleString() + ' |');
  console.log('| Mkt Cap | ' + fmt(p.mcap) + ' |');
  console.log('| Organic | ' + p.organic + '/100 |');
  console.log('| Fee/TVL | ' + p.feeTvlRatio?.toFixed(2) + '% |');
  console.log('| Volatility | ' + p.volatility + ' |');
  console.log('| Bin Step | ' + p.binStep + ' (' + (p.binStep / 100).toFixed(2) + '% per bin) |');
  console.log('| Active Bin | ' + (bin?.binId || '?') + ' |');
  console.log('');
  console.log('Score: ' + (p.organic * p.feeTvlRatio * 0.01).toFixed(2));
  console.log('');

  console.log('📐 RANGE OPTIONS:');
  console.log('');
  console.log('Volatility: ' + p.volatility);
  console.log('×5:  ' + calc5.target.toFixed(0) + '% range = ' + calc5.binsDown + ' bins (total ' + calc5.total + ')');
  console.log('×10: ' + calc10.target.toFixed(0) + '% range = ' + calc10.binsDown + ' bins (total ' + calc10.total + ')');
  console.log('');

  const rl2 = readline.createInterface({ input: process.stdin, output: process.stdout });
  const multAns = await ask('Pick multiplier (5/10): ');
  rl2.close();
  const multiplier = multAns === '10' ? 10 : 5;

  const calc = multiplier === 10 ? calc10 : calc5;
  const binStepPct = p.binStep / 100;

  console.log('\n============================================');
  console.log('   DEPLOY — ' + p.name.toUpperCase() + ' ×' + multiplier);
  console.log('============================================\n');
  console.log('📦 CONFIG');
  console.log('   Pool:      ' + p.name);
  console.log('   Amount:   ' + DEPLOY.amountSol + ' SOL');
  console.log('   Strategy: bid_ask (SOL sided)');
  console.log('');
  console.log('📐 RANGE');
  console.log('   ×' + multiplier + ':        ' + calc.target.toFixed(1) + '% range');
  console.log('   binsDown:   ' + calc.binsDown);
  console.log('   totalBins:  ' + calc.total);
  console.log('');
  console.log('📍 POSITION');
  console.log('   Active bin: ' + (bin?.binId || '?'));
  console.log('   Min bin:   ' + ((bin?.binId || 0) - calc.binsDown));
  console.log('   Max bin:   ' + (bin?.binId || '?'));
  console.log('');

  const rl3 = readline.createInterface({ input: process.stdin, output: process.stdout });
  const confirm = await ask('Deploy? (y/n): ');
  rl3.close();

  if (confirm.toLowerCase() !== 'y') {
    console.log('Cancelled.\n');
    return;
  }

  console.log('\n⏳ Deploying...\n');

  const result = await deployPool(p.pool, {
    poolName: p.name,
    volatility: p.volatility,
    multiplier: multiplier,
  });

  if (result.success) {
    console.log('✅ SUCCESS!');
    console.log('   Position: ' + result.position);
    console.log('   TX:       ' + result.tx);
    console.log('   Range:    ' + result.targetPercent?.toFixed(1) + '% (' + result.binsDown + ' bins)');
    console.log('   Bin:      ' + result.minBinId + ' → ' + result.maxBinId);

    trackPosition({
      position: result.position,
      pool: p.pool,
      poolName: p.name,
      volatility: p.volatility,
      multiplier: multiplier,
      targetPercent: result.targetPercent,
      binsDown: result.binsDown,
      lowerBin: result.minBinId,
      upperBin: result.maxBinId,
      activeBin: bin?.binId,
      amountSol: DEPLOY.amountSol,
      baseMint: p.baseMint,
    });
  } else {
    console.log('❌ FAILED: ' + result.error);
  }
  console.log('');
}

// ── POSITIONS ─────────────────────────────────────────
async function doPositions() {
  const positions = await getEnrichedPositions();
  if (!positions.length) {
    console.log('\nNo positions.\n');
    return;
  }
  console.log('\n📊 POSITIONS:\n');
  positions.forEach((p, i) => {
    const pnl = p.pnlUsd != null ? (p.pnlUsd >= 0 ? '+' : '') + '$' + p.pnlUsd.toFixed(2) : '?';
    const fee = p.unclaimedFeeUsd != null ? '$' + p.unclaimedFeeUsd.toFixed(2) : '$0';
    console.log((i + 1) + '. ' + (p.poolName || p.pool?.slice(0, 8)) + ' | PnL: ' + pnl + ' | Uncl: ' + fee);
  });
  console.log('');
}

// ── CLOSE ──────────────────────────────────────────────
async function doClose() {
  const positions = await getEnrichedPositions();
  if (!positions.length) {
    console.log('\nNo positions to close.\n');
    return;
  }
  const pos = positions[0];
  console.log('\n🔴 CLOSING: ' + (pos.poolName || pos.pool?.slice(0, 8)) + '\n');

  const result = await closePosition(pos.position);
  if (result.success) {
    console.log('✅ Closed! TXs: ' + result.txs?.join(', '));
  } else {
    console.log('❌ Failed: ' + result.error);
  }
  console.log('');
}

// ── MENU ──────────────────────────────────────────────
async function menu() {
  console.log('\n📌 Simple LP — Menu');
  console.log('   1. Screening pools');
  console.log('   2. View positions');
  console.log('   3. Close position');
  console.log('   q. Quit\n');

  const choice = await ask('Select: ');
  rl.close();

  if (choice === 'q' || choice.toLowerCase() === 'q') {
    console.log('Bye!');
    return;
  }

  if (choice === '1') {
    await doScreening();
  } else if (choice === '2') {
    await doPositions();
  } else if (choice === '3') {
    await doClose();
  } else {
    console.log('Invalid.\n');
  }
}

// ── CLI MODE ─────────────────────────────────────────
const args = process.argv.slice(2);

if (args.includes('--screen')) {
  doScreening();
} else if (args.includes('--positions')) {
  doPositions();
} else if (args.includes('--close')) {
  doClose();
} else {
  menu();
}
