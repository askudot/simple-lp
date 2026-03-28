import 'dotenv/config';
import readline from 'readline';
import { screenPools } from './screening.js';
import { getActiveBin, deployPool, trackPosition } from './deploy.js';
import { getEnrichedPositions } from './positions.js';
import { closePosition, autoSwapAllTokens } from './deploy.js';
import { DEPLOY, TPSL } from './config.js';
import { getWalletBalances } from './wallet-utils.js';
import { loadConversationState, saveConversationState } from './state.js';
import {
  fmtUsd as fmt,
  fmtSol,
  volatilityLabel,
  inRangeLabel,
  calcBins,
} from './lib.js';

let conversationState = loadConversationState();

// ─── Pool Scoring ───────────────────────────────────────────
function scorePools(pools) {
  return pools.map(p => ({
    ...p,
    score: parseFloat(((p.organic || 0) * (p.feeTvlRatio || 0) * 0.01).toFixed(2)),
  })).sort((a, b) => b.score - a.score);
}

// ─── Suggestion helpers ──────────────────────────────────────
function suggestPool(scored) {
  // Sort by score, pick best one with medium volatility (2-8)
  const sorted = [...scored].sort((a, b) => b.score - a.score);

  // Prefer medium vol (safer LP range)
  const mediumVol = sorted.filter(p => p.volatility >= 2 && p.volatility <= 8);
  const pick = mediumVol.length > 0 ? mediumVol[0] : sorted[0];

  // Find actual index in original scored array
  const idx = scored.findIndex(p => p.pool === pick.pool);
  return { pool: pick, index: idx };
}

function suggestRange(p) {
  const v = p.volatility;
  if (v < 2) return { multiplier: 5, label: '🟢 tight (low vol)', reason: 'volatility rendah' };
  if (v < 5) return { multiplier: 10, label: '🟡 medium', reason: 'volatility sedang' };
  if (v < 10) return { multiplier: 10, label: '🟠 wide (high vol)', reason: 'volatility tinggi' };
  return { multiplier: 5, label: '🔴 very tight (extreme vol)', reason: 'volatility sangat tinggi' };
}

function suggestNextAction(result) {
  const lines = [];
  lines.push('━━━━━━━━━━━━━━━━━━━━');
  lines.push('📋 Aksi selanjutnya:');
  lines.push('');
  lines.push('  1️⃣  `positions`     → cek semua posisi aktif');
  lines.push('  2️⃣  `close <no>`   → close posisi (e.g. `close 1`)');
  lines.push('  3️⃣  `screen`       → screening pool baru');
  lines.push('  4️⃣  `balance`      → cek wallet & token balance');
  lines.push('  5️⃣  `detail <no>`  → lihat detail posisi');
  lines.push('━━━━━━━━━━━━━━━━━━━━');
  lines.push('');
  lines.push('Atau langsung pilih aksi di atas.');
  return lines.join('\n');
}

// ─── SCREENING FLOW ─────────────────────────────────────────
async function cmdScreening() {
  console.log('\n🔍 Screening pools...\n');

  try {
    const { pools } = await screenPools({ limit: 10 });
    if (!pools || pools.length === 0) {
      console.log('❌ Tidak ada pool ditemukan.');
      return;
    }

    const scored = scorePools(pools);
    const suggestion = suggestPool(scored);

    // Save state
    conversationState = {
      step: 'screening',
      selectedPool: null,
      scoredPools: scored,
      poolDetail: null,
      binData: null,
      calcResults: null,
    };
    saveConversationState(conversationState);

    // Header
    console.log('📊 HASIL SCREENING\n');
    console.log('┌────┬─────────────────────┬──────────┬─────────┬────────┬──────────┬─────────────┬───────┐');
    console.log('│ #  │ Pool                │ Mkt Cap  │ Vol     │ TVL    │ Fee/TVL  │ BinStep/Fee │ Score │');
    console.log('├────┼─────────────────────┼──────────┼─────────┼────────┼──────────┼─────────────┼───────┤');

    scored.forEach((p, i) => {
      const name = (p.name || '?').slice(0, 19);
      const binFee = (p.binStep + '/' + p.feePct + '%').padEnd(11);
      const star = (i === suggestion.index) ? ' ◄── suggest' : '';
      console.log(
        `│ ${String(i + 1).padStart(2)} │ ${name.padEnd(19)} │ ${fmt(p.mcap).padStart(8)} │ ${fmt(p.volume24h).padStart(7)} │ ${fmt(p.tvl).padStart(6)} │ ${(p.feeTvlRatio?.toFixed(1) + '%').padStart(8)} │ ${binFee} │ ${p.score.toFixed(1).padStart(5)} │${star}`
      );
    });

    console.log('└────┴─────────────────────┴──────────┴─────────┴────────┴──────────┴─────────────┴───────┘');

    // Legend
    console.log('');
    console.log('📖 Keterangan Kolom:');
    console.log('   Mkt Cap    = Market Cap (USD)');
    console.log('   Vol        = Volume per jam (USD)');
    console.log('   TVL        = Total Value Locked (USD)');
    console.log('   Fee/TVL    = Fee per TVL (%) — lebih tinggi = lebih bagus');
    console.log('   BinStep/Fee= Bin step + Fee pool (%)');
    console.log('   Score      = organic × fee/TVL — lebih tinggi = lebih bagus');

    console.log('');
    console.log('💡 Suggestion: Pool #' + (suggestion.index + 1));
    console.log('   → ' + suggestion.pool.name + ' (score: ' + suggestion.pool.score + ')');
    console.log('  → `screen` → refresh screening');
    console.log('  → `positions` → cek posisi aktif');
    console.log('  → `menu` → lihat semua command');
    console.log('');

  } catch (err) {
    console.log('❌ Screening error:', err.message);
  }
}

// ─── DETAIL + RANGE FLOW ─────────────────────────────────────
async function cmdPoolDetail(poolIndex) {
  const { scoredPools, step } = conversationState;

  // Allow detail from any step if poolIndex provided
  let pool;
  let idx;

  if (poolIndex !== undefined) {
    idx = parseInt(poolIndex) - 1;
    if (isNaN(idx) || idx < 0 || idx >= scoredPools.length) {
      console.log('❌ Pool tidak ditemukan. Ketik `screen` dulu.');
      return;
    }
    pool = scoredPools[idx];
  } else if (step === 'screening' || step === 'detail') {
    if (!scoredPools.length) {
      console.log('❌ Ketik `screen` dulu.');
      return;
    }
    console.log('📌 Pool mana? Pick dari hasil screening: `1` - `' + scoredPools.length + '`');
    return;
  } else {
    console.log('❌ Ketik `screen` dulu.');
    return;
  }

  console.log('\n📌 Loading detail pool...');

  try {
    // Fetch active bin
    let bin = null;
    try {
      bin = await getActiveBin(pool.pool);
    } catch {
      bin = { binId: '?', price: '?' };
    }

    // Calculate range options
    const binStep = pool.binStep;
    const calc5 = calcBins(pool.volatility, 5, binStep);
    const calc10 = calcBins(pool.volatility, 10, binStep);
    const suggestion = suggestRange(pool);

    // Save state
    conversationState = {
      ...conversationState,
      step: 'detail',
      selectedPool: pool,
      poolDetail: pool,
      binData: bin,
      calcResults: { calc5, calc10, suggestion },
    };
    saveConversationState(conversationState);

    // Display detail
    console.log('\n' + '═'.repeat(50));
    console.log('📌 ' + pool.name.toUpperCase() + ' — Detail Pool');
    console.log('═'.repeat(50));
    console.log('');
    console.log('🏦 Pool:    ' + pool.pool);
    console.log('💰 Fee:     ' + pool.feePct + '%');
    console.log('📊 TVL:     ' + fmt(pool.tvl));
    console.log('📈 Vol 24h: ' + fmt(pool.volume24h));
    console.log('📉 Vol Chg: ' + (pool.volumeChange >= 0 ? '▲' : '▼') + Math.abs(pool.volumeChange || 0).toFixed(1) + '%');
    console.log('👥 Holders: ' + (pool.holders || 0).toLocaleString());
    console.log('💎 MCap:    ' + fmt(pool.mcap));
    console.log('🌱 Organic: ' + (pool.organic || 0) + '/100');
    console.log('📐 Fee/TVL: ' + (pool.feeTvlRatio || 0).toFixed(2) + '%');
    console.log('⚡ Volatility: ' + (pool.volatility || '?') + ' ' + volatilityLabel(pool.volatility));
    console.log('📏 Bin Step:  ' + binStep + ' (' + (binStep / 100).toFixed(2) + '% per bin)');
    console.log('');
    console.log('🎯 Active Bin: ' + (bin?.binId || '?'));
    console.log('   Price:      ' + (bin?.price || '?'));
    console.log('');
    console.log('Score: ' + pool.score);

    console.log('');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📐 PILIH RANGE');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('');
    console.log('⚡ Volatility kamu: ' + (pool.volatility || '?'));
    console.log('');
    console.log('  1️⃣  ×5  (tight)   → ' + calc5.targetPercent.toFixed(1) + '% range = ' + calc5.binsDown + ' bins below active');
    console.log('                    → min bin: ' + ((bin?.binId || 0) - calc5.binsDown));
    console.log('');
    console.log('  2️⃣  ×10 (wide)   → ' + calc10.targetPercent.toFixed(1) + '% range = ' + calc10.binsDown + ' bins below active');
    console.log('                    → min bin: ' + ((bin?.binId || 0) - calc10.binsDown));
    console.log('');
    console.log('💡 Suggestion: ' + suggestion.multiplier + '× → ' + suggestion.label);
    console.log('   Reason: ' + suggestion.reason);
    console.log('');
    console.log('  → Pick range: ketik `1` atau `2`');
    console.log('  → `screen` → back ke screening');
    console.log('  → `cancel` → cancel');
    console.log('');

  } catch (err) {
    console.log('❌ Detail error:', err.message);
  }
}

// ─── DEPLOY FLOW ─────────────────────────────────────────────
async function cmdDeploy(rangeIndex) {
  const { selectedPool, binData, calcResults, step } = conversationState;

  if (step !== 'detail' || !selectedPool) {
    console.log('❌ Pick pool & range dulu. Ketik `screen` untuk mulai.');
    return;
  }

  // Determine multiplier
  let multiplier;
  const raw = (rangeIndex || '').toLowerCase().replace('×', 'x');
  if (raw === '1' || raw === '5' || raw === 'x5') {
    multiplier = 5;
  } else if (raw === '2' || raw === '10' || raw === 'x10') {
    multiplier = 10;
  } else if (rangeIndex !== undefined) {
    console.log('❌ Range tidak valid. Pick `1` (×5) atau `2` (×10).');
    return;
  } else {
    console.log('📐 Pick range: `1` (×5 tight) atau `2` (×10 wide)');
    return;
  }

  const calc = multiplier === 10 ? calcResults.calc10 : calcResults.calc5;
  const p = selectedPool;
  const bin = binData;
  const amountSol = DEPLOY.amountSol;

  // ── Direct deploy (skip preview + confirm) ─────────────────
  console.log('\n⏳ Deploying...\n');

  try {
    const result = await deployPool(p.pool, {
      poolName: p.name,
      volatility: p.volatility,
      multiplier: multiplier,
    });

    if (result.success) {
      // Track position
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

      // ── Success output ────────────────────────────────────
      console.log('═'.repeat(50));
      console.log('✅ DEPLOY SUCCESS!');
      console.log('═'.repeat(50));
      console.log('');
      console.log('🏦 Pool:      ' + p.name);
      console.log('💰 Amount:    ' + amountSol + ' SOL');
      console.log('📐 Strategy:  bid_ask (SOL sided)');
      console.log('');
      console.log('⚡ Volatility: ' + p.volatility + ' × ' + multiplier + ' = ' + calc.targetPercent.toFixed(1) + '% range');
      console.log('📊 Total bins: ' + calc.totalBins + ' bins below active');
      console.log('🎯 Active bin: ' + (bin?.binId || '?'));
      console.log('📍 Min bin:   ' + result.minBinId);
      console.log('📍 Max bin:   ' + result.maxBinId);
      console.log('');
      console.log('🔗 Position:  ' + result.position);
      console.log('📝 TX:         ' + result.tx);
      console.log('');

      // Suggestion
      console.log('━━━━━━━━━━━━━━━━━━━━');
      console.log('📋 Aksi selanjutnya:');
      console.log('  `positions` → cek posisi aktif');
      console.log('  `close <no>` → close posisi');
      console.log('  `screen` → screening baru');
      console.log('  `balance` → cek wallet');
      console.log('━━━━━━━━━━━━━━━━━━━━');

    } else {
      console.log('❌ DEPLOY FAILED');
      if (result.errors) {
        result.errors.forEach(e => console.log('   ⚠️  ' + e));
      } else if (result.error) {
        console.log('   ' + result.error);
      }
      console.log('');
      console.log('Coba lagi? Ketik `screen` untuk screening baru.');
    }

    // Reset state only for real deploys (dry runs keep state)
    if (!result.dryRun) {
      conversationState = {
        step: 'idle',
        selectedPool: null,
        scoredPools: [],
        poolDetail: null,
        binData: null,
        calcResults: null,
      };
      saveConversationState(conversationState);
    }

  } catch (err) {
    console.log('❌ Deploy error:', err.message);
  }
}

async function cmdConfirm() {
  const { selectedPool, binData, pendingDeploy, step } = conversationState;

  if (step !== 'deploying' || !pendingDeploy) {
    console.log('❌ Tidak ada pending deploy. Ketik `screen` untuk mulai.');
    return;
  }

  const { multiplier, calc } = pendingDeploy;
  const p = selectedPool;

  console.log('\n⏳ Deploying...\n');

  try {
    const result = await deployPool(p.pool, {
      poolName: p.name,
      volatility: p.volatility,
      multiplier: multiplier,
    });

    if (result.success) {
      // Track position
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
        activeBin: binData?.binId,
        amountSol: DEPLOY.amountSol,
        baseMint: p.baseMint,
      });

      // Success display
      console.log('═'.repeat(50));
      console.log('✅ DEPLOY SUCCESS!');
      console.log('═'.repeat(50));
      console.log('');
      console.log('🏦 Pool:      ' + p.name);
      console.log('💰 Amount:    ' + DEPLOY.amountSol + ' SOL');
      console.log('📐 Range:     ×' + multiplier + ' = ' + calc.targetPercent.toFixed(1) + '% (' + calc.totalBins + ' bins)');
      console.log('📍 Min bin:   ' + result.minBinId);
      console.log('📍 Max bin:   ' + result.maxBinId);
      console.log('🎯 Active:    ' + binData?.binId);
      console.log('🔗 Position:  ' + result.position);
      console.log('📝 TX:         ' + result.tx);
      console.log('');

      console.log(suggestNextAction(result));

    } else {
      console.log('❌ DEPLOY FAILED');
      if (result.errors) {
        result.errors.forEach(e => console.log('   ⚠️  ' + e));
      } else if (result.error) {
        console.log('   ' + result.error);
      }
      console.log('');
      console.log('Coba lagi? Ketik `screen` untuk screening baru.');
    }

    // Reset state
    conversationState = {
      step: 'idle',
      selectedPool: null,
      scoredPools: [],
      poolDetail: null,
      binData: null,
      calcResults: null,
    };
    saveConversationState(conversationState);

  } catch (err) {
    console.log('❌ Deploy error:', err.message);
  }
}

// ─── POSITIONS FLOW ──────────────────────────────────────────
async function cmdPositions(args) {
  const positions = await getEnrichedPositions();

  if (!positions.length) {
    console.log('\n📭 Tidak ada posisi aktif.');
    console.log('   Ketik `screen` untuk mulai screening.');
    console.log('');
    return;
  }

  // If args given (e.g. "detail 1"), handle differently
  const parts = args?.split(' ');
  const subCmd = parts?.[0];
  const arg = parts?.[1];

  console.log('\n📊 POSISI AKTIF (' + positions.length + ')\n');
  console.log('┌────┬─────────────────────┬──────────┬──────────┬────────────┬───────────┬──────────┐');
  console.log('│ #  │ Pool                │ PnL      │ Uncl.Fee │ Value      │ Range     │ Status   │');
  console.log('├────┼─────────────────────┼──────────┼──────────┼────────────┼───────────┼──────────┤');

  positions.forEach((pos, i) => {
    const pnl = pos.pnlUsd != null ? (pos.pnlUsd >= 0 ? '+' : '') + '$' + pos.pnlUsd.toFixed(2) : '?';
    const fee = pos.unclaimedFeeUsd != null ? '$' + pos.unclaimedFeeUsd.toFixed(2) : '$0';
    const val = pos.valueUsd != null ? '$' + pos.valueUsd.toFixed(2) : '?';
    const range = pos.multiplier ? '×' + pos.multiplier : '?';
    const status = pos.inRange !== null ? (pos.inRange ? '✅' : '⚠️') : '?';
    const poolName = (pos.poolName || pos.pool?.slice(0, 8) || '?').slice(0, 19);
    console.log(
      `│ ${String(i + 1).padStart(2)} │ ${poolName.padEnd(19)} │ ${pnl.padStart(8)} │ ${fee.padStart(8)} │ ${val.padStart(10)} │ ${range.padStart(9)} │ ${status} │`
    );
  });

  console.log('└────┴─────────────────────┴──────────┴──────────┴────────────┴───────────┴──────────┘');
  console.log('');
  console.log('💡 Suggest: close posisi yang out-of-range (⚠️) duluan');
  console.log('');
  console.log('Aksi:');
  console.log('  `close <no>`  → close posisi # (e.g. `close 1`)');
  console.log('  `detail <no>`  → detail posisi #');
  console.log('  `claim <no>`   → claim fee posisi # (TODO)');
  console.log('  `screen`       → screening pool baru');
  console.log('');
}

async function cmdClose(args) {
  const positions = await getEnrichedPositions();

  if (!positions.length) {
    console.log('\n📭 Tidak ada posisi untuk di-close.');
    return;
  }

  // Parse: could be a number (1-based index) or a position address
  let pos;
  const num = parseInt(args);
  if (!isNaN(num) && num >= 1 && num <= positions.length) {
    // Numeric index
    pos = positions[num - 1];
  } else if (args && args.length > 20) {
    // Likely a position address
    pos = positions.find(p => p.position === args);
    if (!pos) {
      console.log('\n❌ Position tidak ditemukan: ' + args);
      return;
    }
  } else {
    // Show picker
    console.log('\n📋 Pick posisi untuk di-close:');
    positions.forEach((p, i) => {
      const pnl = p.pnlUsd != null ? (p.pnlUsd >= 0 ? '+' : '') + '$' + p.pnlUsd.toFixed(2) : '?';
      const status = p.inRange !== null ? (p.inRange ? '✅' : '⚠️') : '?';
      console.log('  ' + (i + 1) + '. ' + (p.poolName || p.pool?.slice(0, 8)) + ' — PnL: ' + pnl + ' ' + status);
    });
    console.log('');
    console.log('Usage: `close <no>` (e.g. `close 1`)');
    console.log('  atau: `close <position_address>`');
    return;
  }

  console.log('\n🔴 CLOSE PREVIEW — ' + (pos.poolName || pos.pool?.slice(0, 8)));
  console.log('   Position: ' + pos.position);
  if (pos.pnlUsd != null) {
    console.log('   PnL: ' + (pos.pnlUsd >= 0 ? '+' : '') + '$' + pos.pnlUsd.toFixed(2));
  }
  console.log('   Uncl. Fee: ' + (pos.unclaimedFeeUsd != null ? '$' + pos.unclaimedFeeUsd.toFixed(2) : '$0'));
  console.log('');

  if (args?.includes('--confirm')) {
    // Execute close
    const result = await closePosition(pos.position);
    if (result.success) {
      console.log('✅ Closed! TXs: ' + (result.txs || []).join(', '));

      // Auto-swap tokens above $0.5
      console.log('\n🔄 Checking tokens for auto-swap...');
      const swapResult = await autoSwapAllTokens(0.5);
      if (swapResult.swapped > 0) {
        console.log('✅ Auto-swap done!');
      } else if (!swapResult.dryRun && swapResult.swapped === 0) {
        console.log('   No tokens above $0.5 — skipping swap');
      }
    } else {
      console.log('❌ Failed: ' + result.error);
    }
    console.log('');
    console.log('Ketik `positions` untuk cek sisa posisi.');
  } else {
    console.log('Tambahkan `--confirm` untuk execute: `close ' + (posIdx + 1) + ' --confirm`');
    console.log('  atau `cancel` untuk cancel');
  }
}

async function cmdDetail(args) {
  const positions = await getEnrichedPositions();

  if (!positions.length) {
    console.log('\n📭 Tidak ada posisi.');
    return;
  }

  const idx = parseInt(args) - 1;
  if (isNaN(idx) || idx < 0 || idx >= positions.length) {
    console.log('\n📋 Pick posisi: `detail <no>` (e.g. `detail 1`)');
    positions.forEach((p, i) => {
      console.log('  ' + (i + 1) + '. ' + (p.poolName || p.pool?.slice(0, 8)));
    });
    return;
  }

  const pos = positions[idx];
  console.log('\n📌 DETAIL — ' + (pos.poolName || pos.pool?.slice(0, 8)));
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('Position:  ' + pos.position);
  console.log('Pool:      ' + pos.pool);
  console.log('Pool Name: ' + (pos.poolName || '?'));
  console.log('');
  console.log('📊 PnL:       ' + (pos.pnlUsd != null ? (pos.pnlUsd >= 0 ? '+' : '') + '$' + pos.pnlUsd.toFixed(2) : '?'));
  console.log('   PnL %:    ' + (pos.pnlPct != null ? (pos.pnlPct >= 0 ? '+' : '') + pos.pnlPct.toFixed(2) + '%' : '?'));
  console.log('   Value:    ' + (pos.valueUsd != null ? '$' + pos.valueUsd.toFixed(2) : '?'));
  console.log('   Uncl.Fee: ' + (pos.unclaimedFeeUsd != null ? '$' + pos.unclaimedFeeUsd.toFixed(2) : '$0'));
  console.log('');
  console.log('📐 Range:    ×' + (pos.multiplier || '?'));
  console.log('   Total %: ' + (pos.rangePct != null ? pos.rangePct.toFixed(1) + '%' : '?'));
  console.log('   Lower:   ' + (pos.lowerBin || '?'));
  console.log('   Upper:   ' + (pos.upperBin || '?'));
  console.log('   Active:  ' + (pos.activeBin || '?'));
  console.log('   Status:  ' + inRangeLabel(pos.inRange));
  console.log('');
  console.log('💰 Amount:   ' + (pos.amountSol ? pos.amountSol + ' SOL' : '?'));
  console.log('   Age:     ' + (pos.ageMinutes ? Math.floor(pos.ageMinutes / 60) + 'h ' + (pos.ageMinutes % 60) + 'm' : '?'));
  console.log('');

  console.log('Aksi:');
  console.log('  `close ' + (idx + 1) + ' --confirm` → close posisi ini');
  console.log('  `positions` → lihat semua posisi');
}

async function cmdBalance() {
  console.log('\n💼 WALLET BALANCE\n');
  try {
    const bal = await getWalletBalances();
    console.log('Address: ' + (bal.wallet?.slice(0, 10) + '...' || '?'));
    console.log('SOL:     ' + fmtSol(bal.sol));
    console.log('');
    if (bal.tokens?.length) {
      console.log('Tokens:');
      bal.tokens.forEach(t => {
        console.log('  ' + (t.symbol || t.mint?.slice(0, 8)) + ': ' + t.balance?.toFixed(4));
      });
    } else {
      console.log('(no tokens)');
    }
    console.log('');
  } catch (err) {
    console.log('❌ Balance error:', err.message);
  }
}

async function cmdMenu() {
  console.log('\n📋 MENU — Simple LP Bot');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');
  console.log('  screening / screen   → screening pools');
  console.log('  auto                 → full auto: screen → pick → deploy');
  console.log('  <no>                 → pilih pool dari hasil screening');
  console.log('  <no>                → pilih range (1=×5, 2=×10)');
  console.log('  confirm              → execute deploy');
  console.log('  cancel               → cancel current action');
  console.log('');
  console.log('  positions / pos      → lihat semua posisi');
  console.log('  detail <no>          → detail posisi');
  console.log('  close <no> [--confirm] → close posisi');
  console.log('  balance / bal        → cek wallet balance');
  console.log('');
  console.log('  help                 → show this menu');
  console.log('  menu                 → show this menu');
  console.log('');
}

// ─── COMMAND PARSER ───────────────────────────────────────────
async function parseCommand(input) {
  const raw = input.trim();
  const lower = raw.toLowerCase();
  const parts = lower.split(/\s+/);
  const cmd = parts[0];
  const args = raw.slice(cmd.length).trim();

  // No command
  if (!cmd) return;

  // ── Screen ──────────────────────────────────────────────
  if (cmd === 'screen' || cmd === 'screening' || cmd === 's') {
    await cmdScreening();
    return;
  }

  // ── Help / Menu ──────────────────────────────────────────
  if (cmd === 'help' || cmd === 'menu' || cmd === 'h') {
    await cmdMenu();
    return;
  }

  // ── Auto mode ───────────────────────────────────────────
  if (cmd === 'auto') {
    await cmdAuto();
    return;
  }

  // ── Cancel ───────────────────────────────────────────────
  if (cmd === 'cancel' || cmd === 'c') {
    conversationState = {
      step: 'idle',
      selectedPool: null,
      scoredPools: [],
      poolDetail: null,
      binData: null,
      calcResults: null,
    };
    saveConversationState(conversationState);
    console.log('✅ Cancelled. Kembali ke idle state.');
    console.log('   Ketik `screen` untuk mulai screening.');
    return;
  }

  // ── Balance ──────────────────────────────────────────────
  if (cmd === 'balance' || cmd === 'bal' || cmd === 'b') {
    await cmdBalance();
    return;
  }

  // ── Positions ─────────────────────────────────────────────
  if (cmd === 'positions' || cmd === 'pos' || cmd === 'p') {
    await cmdPositions(args);
    return;
  }

  // ── Close ─────────────────────────────────────────────────
  if (cmd === 'close') {
    await cmdClose(args);
    return;
  }

  // ── Detail ───────────────────────────────────────────────
  if (cmd === 'detail') {
    await cmdDetail(args);
    return;
  }

  // ── Confirm Deploy ───────────────────────────────────────
  if (cmd === 'confirm' || cmd === 'yes' || cmd === 'y') {
    await cmdConfirm();
    return;
  }

  // ── Range shorthand (x5, x10) ─────────────────────────────
  if (cmd === 'x5' || cmd === '×5') {
    const { step } = conversationState;
    if (step === 'detail' || step === 'deploying') {
      await cmdDeploy('5');
      return;
    }
  }
  if (cmd === 'x10' || cmd === '×10') {
    const { step } = conversationState;
    if (step === 'detail' || step === 'deploying') {
      await cmdDeploy('10');
      return;
    }
  }

  // ── Numeric: pool pick or range pick ─────────────────────
  const num = parseInt(cmd);
  if (!isNaN(num)) {
    const { step } = conversationState;

    if (step === 'idle') {
      console.log('❌ Ketik `screen` dulu untuk mulai.');
      return;
    }

    if (step === 'screening') {
      await cmdPoolDetail(cmd);
      return;
    }

    if (step === 'detail') {
      await cmdDeploy(cmd);
      return;
    }

    if (step === 'deploying') {
      // Allow re-pick range
      await cmdDeploy(cmd);
      return;
    }
  }

  // ── Unknown ───────────────────────────────────────────────
  console.log('❓ Command tidak dikenal: `' + cmd + '`');
  console.log('   Ketik `help` untuk lihat menu.');
}

// ─── AUTO MODE ───────────────────────────────────────────────
async function cmdAuto() {
  console.log('\n🤖 AUTO MODE — Full flow screening → deploy\n');

  try {
    // Step 1: Screen
    console.log('🔍 Step 1: Screening pools...');
    const { pools } = await screenPools({ limit: 10 });
    if (!pools || pools.length === 0) {
      console.log('❌ No pools found.');
      return;
    }

    const scored = scorePools(pools);
    const suggestion = suggestPool(scored);
    const p = suggestion.pool;
    console.log(`   Found ${pools.length} pools`);
    console.log(`   ✅ Auto-pick: ${p.name} (score: ${suggestion.pool.score})`);

    // Step 2: Get active bin
    console.log('\n🔍 Step 2: Fetching active bin...');
    let bin;
    try {
      bin = await getActiveBin(p.pool);
    } catch {
      bin = { binId: '?', price: '?' };
    }
    console.log(`   Active bin: ${bin.binId}`);

    // Step 3: Calculate range
    const binStep = p.binStep;
    const calc5 = calcBins(p.volatility, 5, binStep);
    const calc10 = calcBins(p.volatility, 10, binStep);
    const rangeSuggestion = suggestRange(p);
    const multiplier = rangeSuggestion.multiplier;
    const calc = multiplier === 10 ? calc10 : calc5;
    console.log(`   ⚡ Volatility: ${p.volatility} → ${multiplier}× = ${calc.targetPercent.toFixed(1)}% range`);

    // Step 4: Deploy
    console.log('\n🔍 Step 3: Deploying...');
    const result = await deployPool(p.pool, {
      poolName: p.name,
      volatility: p.volatility,
      multiplier: multiplier,
    });

    if (result.success) {
      // Track position
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

      // Result
      console.log('═'.repeat(50));
      console.log('✅ DEPLOY SUCCESS!');
      console.log('═'.repeat(50));
      console.log('');
      console.log('🏦 Pool:      ' + p.name);
      console.log('💰 Amount:    ' + DEPLOY.amountSol + ' SOL');
      console.log('📐 Range:     ×' + multiplier + ' = ' + calc.targetPercent.toFixed(1) + '% (' + calc.totalBins + ' bins)');
      console.log('📍 Min bin:   ' + result.minBinId);
      console.log('📍 Max bin:    ' + result.maxBinId);
      console.log('🎯 Active:    ' + (bin?.binId || '?'));
      console.log('');
      console.log('🔗 Position:  ' + result.position);
      console.log('📝 TX:         ' + result.tx);
      console.log('');
      console.log('━━━━━━━━━━━━━━━━━━━━');
      console.log('📋 Aksi selanjutnya:');
      console.log('  `positions` → cek posisi aktif');
      console.log('  `close <no>` → close posisi');
      console.log('  `balance` → cek wallet');
      console.log('  `monitor` → start TP/SL monitor (background)');
      console.log('━━━━━━━━━━━━━━━━━━━━');

      if (TPSL.enabled) {
        console.log('');
        console.log('⚠️  TP/SL Active: TP +' + TPSL.tpPercent + '% | SL ' + TPSL.slPercent + '%');
        console.log('   Run `npm run monitor` di terminal lain untuk background monitoring');
      }
    } else {
      console.log('❌ DEPLOY FAILED');
      if (result.errors) {
        result.errors.forEach(e => console.log('   ⚠️  ' + e));
      } else if (result.error) {
        console.log('   ' + result.error);
      }
    }
  } catch (err) {
    console.log('❌ Auto mode error:', err.message);
  }
}

// ─── CLI ENTRY ───────────────────────────────────────────────
const input = process.argv.slice(2).join(' ');

if (input) {
  // Direct command mode (e.g. from npm script)
  await parseCommand(input);
} else {
  // Interactive mode
  console.log('');
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║       🤖 SIMPLE LP BOT — Meteora DLMM         ║');
  console.log('╚══════════════════════════════════════════════╝');
  console.log('');
  console.log('Ketik `help` untuk lihat menu.');
  console.log('Atau ketik command langsung, e.g.: `screen`');
  console.log('');

  // Simple REPL with proper cleanup
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const ask = () => {
    rl.question('> ', async (cmd) => {
      if (cmd.trim()) {
        await parseCommand(cmd);
      }
      ask();
    });
  };

  // Cleanup on exit
  rl.on('close', () => {
    process.exit(0);
  });

  process.on('SIGINT', () => {
    rl.close();
  });

  ask();
}

export { parseCommand };
