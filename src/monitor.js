/**
 * TP/SL Monitor — Background monitoring for positions
 * Run standalone: node src/monitor.js
 * Or import from other modules
 */
import { getEnrichedPositions } from './positions.js';
import { closePosition } from './deploy.js';
import { TPSL } from './config.js';
import { loadPositionsState, savePositionsState } from './state.js';

let monitorInterval = null;

// ─── Check single position for TP/SL ─────────────────────────
async function checkPosition(pos) {
  const pnlPct = pos.pnlPct; // already in percentage

  if (pnlPct === null || pnlPct === undefined) {
    return { action: null, reason: null };
  }

  const { tpPercent, slPercent } = TPSL;

  if (pnlPct >= tpPercent) {
    return { action: 'TP', reason: `PnL ${pnlPct.toFixed(2)}% >= ${tpPercent}% (TP)` };
  }

  if (pnlPct <= slPercent) {
    return { action: 'SL', reason: `PnL ${pnlPct.toFixed(2)}% <= ${slPercent}% (SL)` };
  }

  return { action: null, reason: null };
}

// ─── Monitor all tracked positions ───────────────────────────
async function monitorAll() {
  const positions = await getEnrichedPositions();

  if (!positions || positions.length === 0) {
    return { checked: 0, triggered: 0 };
  }

  let triggered = 0;

  for (const pos of positions) {
    // Only monitor positions that aren't already closed
    const state = loadPositionsState();
    const tracked = state[pos.position];
    if (tracked?.closed) continue;

    const { action, reason } = await checkPosition(pos);

    if (action) {
      triggered++;
      console.log(`\n⚠️  ${action} TRIGGERED — ${pos.poolName || pos.pool?.slice(0, 8)}`);
      console.log(`   Position: ${pos.position}`);
      console.log(`   Reason:   ${reason}`);

      if (!TPSL.enabled) {
        console.log('   ⚠️  TP/SL disabled — skipping');
        continue;
      }

      // Execute close
      console.log(`   🔴 Closing position...`);
      const result = await closePosition(pos.position);

      if (result.success) {
        console.log(`   ✅ ${action} Closed! TXs: ${(result.txs || []).join(', ')}`);

        // Mark as closed in state
        const state = loadPositionsState();
        if (state[pos.position]) {
          state[pos.position].closed = true;
          state[pos.position].closedAt = new Date().toISOString();
          state[pos.position].closeReason = action;
          savePositionsState(state);
        }
      } else {
        console.log(`   ❌ Close failed: ${result.error}`);
      }
    }
  }

  return { checked: positions.length, triggered };
}

// ─── Start monitoring loop ─────────────────────────────────────
export function startMonitor(onCheck) {
  if (monitorInterval) {
    console.log('⚠️  Monitor already running');
    return;
  }

  if (!TPSL.enabled) {
    console.log('⚠️  TP/SL is disabled in config');
    return;
  }

  const intervalSec = TPSL.checkIntervalMs / 1000;
  console.log(`\n🔄 TP/SL Monitor started — checking every ${intervalSec}s`);
  console.log(`   TP: +${TPSL.tpPercent}% | SL: ${TPSL.slPercent}%`);
  console.log('   Press Ctrl+C to stop\n');

  // Initial check
  monitorAll().then(({ checked, triggered }) => {
    if (onCheck) onCheck(checked, triggered);
  });

  // Recurring
  monitorInterval = setInterval(async () => {
    const { checked, triggered } = await monitorAll();
    if (onCheck) onCheck(checked, triggered);
  }, TPSL.checkIntervalMs);
}

// ─── Stop monitoring loop ──────────────────────────────────────
export function stopMonitor() {
  if (monitorInterval) {
    clearInterval(monitorInterval);
    monitorInterval = null;
    console.log('🔄 Monitor stopped');
  }
}

// ─── CLI entry ────────────────────────────────────────────────
const args = process.argv.slice(2);

if (args.includes('--once')) {
  // Single check
  console.log('🔍 Running single TP/SL check...\n');
  monitorAll().then(({ checked, triggered }) => {
    console.log(`\n✅ Checked ${checked} positions, ${triggered} triggered`);
    process.exit(0);
  });
} else {
  // Continuous monitoring
  startMonitor((checked, triggered) => {
    if (checked > 0) {
      console.log(`[${new Date().toLocaleTimeString()}] Checked ${checked} positions${triggered > 0 ? `, ⚠️ ${triggered} TP/SL triggered` : ''}`);
    }
  });

  // Keep alive
  process.on('SIGINT', () => {
    stopMonitor();
    process.exit(0);
  });
}
