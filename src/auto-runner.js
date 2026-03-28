/**
 * Auto Runner — Full auto mode for Simple LP
 * Handles: auto screening → deploy → TP/SL monitor → auto redeploy
 */
import { screenPools } from './screening.js';
import { getActiveBin, deployPool, trackPosition, closePosition } from './deploy.js';
import { getEnrichedPositions } from './positions.js';
import { getWalletBalances } from './wallet-utils.js';
import { DEPLOY, TPSL, LIMITS } from './config.js';
import { calcBins } from './lib.js';

const SOL_RESERVE = 0.15; // 0.1 deploy + 0.05 gas reserve
const CHECK_INTERVAL = TPSL.checkIntervalMs || 60_000;

let running = false;
let checkInterval = null;

// ─── Helpers ─────────────────────────────────────────────────
function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function getAvailableBalance() {
  const bal = await getWalletBalances();
  return bal.sol;
}

async function canDeploy() {
  const bal = await getAvailableBalance();
  return bal >= SOL_RESERVE;
}

async function getActiveCount() {
  const positions = await getEnrichedPositions();
  return positions.length;
}

function suggestPool(scored) {
  const sorted = [...scored].sort((a, b) => b.score - a.score);
  const mediumVol = sorted.filter(p => p.volatility >= 2 && p.volatility <= 8);
  const pick = mediumVol.length > 0 ? mediumVol[0] : sorted[0];
  const idx = scored.findIndex(p => p.pool === pick.pool);
  return { pool: pick, index: idx };
}

function suggestRange(p) {
  const v = p.volatility;
  if (v < 2) return { multiplier: 5, label: 'tight' };
  if (v < 5) return { multiplier: 10, label: 'medium' };
  if (v < 10) return { multiplier: 10, label: 'wide' };
  return { multiplier: 5, label: 'very tight' };
}

// ─── Auto Deploy Single Position ──────────────────────────────
async function autoDeployOne() {
  console.log('');
  console.log('[AUTO] Screening pools for deployment...');

  try {
    const { pools } = await screenPools({ limit: 10 });
    if (!pools || pools.length === 0) {
      console.log('[AUTO] No pools found matching filters');
      return false;
    }

    // Score pools
    const scored = pools.map(p => ({
      ...p,
      score: parseFloat(((p.organic || 0) * (p.feeTvlRatio || 0) * 0.01).toFixed(2)),
    })).sort((a, b) => b.score - a.score);

    const { pool: p, index: idx } = suggestPool(scored);

    console.log('[AUTO] Best pool: ' + p.name + ' (Score: ' + p.score + ')');

    // Get active bin
    let bin;
    try {
      bin = await getActiveBin(p.pool);
    } catch {
      bin = { binId: 0, price: '?' };
    }

    // Calculate range
    const calc = calcBins(p.volatility, 10, p.binStep); // Default to x10 for auto
    const multiplier = 10;

    console.log('[AUTO] Deploying to ' + p.name + '...');
    console.log('[AUTO] Range: x' + multiplier + ' (' + calc.targetPercent.toFixed(1) + '% | ' + calc.totalBins + ' bins)');

    const result = await deployPool(p.pool, {
      poolName: p.name,
      volatility: p.volatility,
      multiplier: multiplier,
    });

    if (result.success) {
      console.log('[AUTO] SUCCESS! Position: ' + result.position);
      console.log('[AUTO] TX: ' + result.tx);

      // Track
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

      return true;
    } else {
      console.log('[AUTO] Deploy failed: ' + (result.error || result.errors?.join(', ')));
      return false;
    }
  } catch (err) {
    console.log('[AUTO] Error: ' + err.message);
    return false;
  }
}

// ─── Check TP/SL on All Positions ───────────────────────────
async function checkTP_SL() {
  const positions = await getEnrichedPositions();
  const actions = [];

  for (const pos of positions) {
    const pnlPct = pos.pnlPct;
    if (pnlPct === null || pnlPct === undefined) continue;

    const { tpPercent, slPercent } = TPSL;

    if (pnlPct >= tpPercent) {
      actions.push({ pos, action: 'TP', reason: 'PnL ' + pnlPct.toFixed(2) + '% >= ' + tpPercent + '%' });
    } else if (pnlPct <= slPercent) {
      actions.push({ pos, action: 'SL', reason: 'PnL ' + pnlPct.toFixed(2) + '% <= ' + slPercent + '%' });
    }
  }

  return actions;
}

// ─── Monitor Loop ─────────────────────────────────────────────
async function monitorLoop() {
  console.log('[MONITOR] Starting TP/SL monitor (every ' + (CHECK_INTERVAL / 1000) + 's)');
  console.log('[MONITOR] TP: +' + TPSL.tpPercent + '% | SL: ' + TPSL.slPercent + '%');

  while (running) {
    await sleep(CHECK_INTERVAL);

    if (!running) break;

    const actions = await checkTP_SL();

    for (const { pos, action, reason } of actions) {
      console.log('');
      console.log('[MONITOR] ' + action + ' TRIGGERED on ' + (pos.poolName || pos.pool?.slice(0, 8)));
      console.log('[MONITOR] Reason: ' + reason);
      console.log('[MONITOR] Closing position...');

      const result = await closePosition(pos.position);

      if (result.success) {
        console.log('[MONITOR] Closed! TXs: ' + (result.txs || []).length);
        console.log('[MONITOR] Checking if redeploy needed...');

        const count = await getActiveCount();
        const bal = await getAvailableBalance();

        if (count < LIMITS.maxActivePositions && bal >= SOL_RESERVE) {
          console.log('[MONITOR] Redeploying... (' + count + '/' + LIMITS.maxActivePositions + ' active, ' + bal.toFixed(4) + ' SOL available)');
          await autoDeployOne();
        } else if (count >= LIMITS.maxActivePositions) {
          console.log('[MONITOR] Max positions reached (' + count + '/' + LIMITS.maxActivePositions + ')');
        } else {
          console.log('[MONITOR] Insufficient balance for redeploy (' + bal.toFixed(4) + ' SOL < ' + SOL_RESERVE + ')');
        }
      } else {
        console.log('[MONITOR] Close failed: ' + result.error);
      }
    }
  }

  console.log('[MONITOR] Monitor stopped');
}

// ─── Main Auto Run ────────────────────────────────────────────
export async function runAutoMode() {
  console.log('');
  console.log('==============================================================');
  console.log('  SIMPLE LP — AUTO MODE');
  console.log('==============================================================');
  console.log('');
  console.log('  Max Positions: ' + LIMITS.maxActivePositions);
  console.log('  TP: +' + TPSL.tpPercent + '% | SL: ' + TPSL.slPercent + '%');
  console.log('  Check Interval: ' + (CHECK_INTERVAL / 1000) + 's');
  console.log('  Deploy Amount: ' + DEPLOY.amountSol + ' SOL');
  console.log('');
  console.log('  Press Ctrl+C to stop');
  console.log('==============================================================');

  running = true;

  // Step 1: Fill positions up to maxActivePositions
  while (running) {
    const count = await getActiveCount();
    const bal = await getAvailableBalance();

    if (count >= LIMITS.maxActivePositions) {
      console.log('[AUTO] Position limit reached (' + count + '/' + LIMITS.maxActivePositions + ')');
      break;
    }

    if (bal < SOL_RESERVE) {
      console.log('[AUTO] Insufficient balance for new position (' + bal.toFixed(4) + ' SOL < ' + SOL_RESERVE + ')');
      break;
    }

    console.log('[AUTO] Active: ' + count + '/' + LIMITS.maxActivePositions + ' | Balance: ' + bal.toFixed(4) + ' SOL');

    const deployed = await autoDeployOne();

    if (!deployed) {
      console.log('[AUTO] Failed to deploy, retrying in 30s...');
      await sleep(30000);
    }

    // Re-check count after deploy
    const newCount = await getActiveCount();
    if (newCount >= LIMITS.maxActivePositions) {
      break;
    }
  }

  // Step 2: Start monitor loop
  if (running) {
    await monitorLoop();
  }

  console.log('[AUTO] Auto mode ended');
}

// ─── Stop Auto Mode ───────────────────────────────────────────
export function stopAutoMode() {
  console.log('[AUTO] Stopping...');
  running = false;
  if (checkInterval) {
    clearInterval(checkInterval);
    checkInterval = null;
  }
}
