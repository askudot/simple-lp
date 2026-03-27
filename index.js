import { screenPools } from './screening.js';
import { getEnrichedPositions, closePosition } from './positions.js';
import { DEPLOY } from './config.js';
import readline from 'readline';

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function ask(question) {
  return new Promise((resolve) => rl.question(question, resolve));
}

function printMenu() {
  console.log('\n📌 Simple LP — Menu');
  console.log('   1. Screening pools');
  console.log('   2. View active positions');
  console.log('   3. Close position (+ claim fees)');
  console.log('   q. Quit\n');
}

// ── Screening ─────────────────────────────────
async function screening() {
  const { pools, total } = await screenPools({ limit: 20 });

  // Rank by score
  const scored = pools.map(p => ({
    ...p,
    score: ((p.organic || 0) * (p.feeTvlRatio || 0) * 0.01),
  })).sort((a, b) => b.score - a.score);

  const now = new Date().toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta' });

  console.log(`\n📊 HASIL SCREENING | ${now} (UTC+7)`);
  console.log(`Total eligible: ${total} | Ditampilkan: ${pools.length}\n`);

  console.log(' # | Pool Name         | Fee% | Vol    | VolChg   | Org  | TVL    | Holders | Range×5 | Range×10');
  console.log('---|-------------------|------|--------|----------|------|--------|---------|---------|---------');
  scored.forEach((p, i) => {
    const name = (p.name || '?').slice(0, 17).padEnd(17);
    const vol = p.volatility != null ? p.volatility.toFixed(1) : '?';
    const volBadge = p.volatilityLabel || '?';
    const chg = (p.volumeChange >= 0 ? '▲' : '▼') + Math.abs(p.volumeChange || 0).toFixed(1) + '%';
    
    // Show range for both ×5 and ×10
    let r5 = '?', r10 = '?';
    if (p.volatility != null) {
      r5 = (p.volatility * 5).toFixed(0) + '%';
      r10 = (p.volatility * 10).toFixed(0) + '%';
    }
    
    const tvl = '$' + (p.tvl / 1000).toFixed(0) + 'k';
    console.log(
      String(i + 1).padStart(2) + ' | ' + name + ' | ' +
      String(p.feePct + '%').padStart(4) + ' | ' +
      vol.padStart(4) + volBadge.padStart(7) + ' | ' +
      chg.padStart(10) + ' | ' +
      String(p.organic || 0).padStart(4) + ' | ' +
      tvl.padStart(7) + ' | ' +
      String(p.holders || 0).toLocaleString().padStart(7) + ' | ' +
      r5.padStart(8) + ' | ' + r10.padStart(8)
    );
  });

  console.log('\n▲ = vol naik | ▼ = vol turun');
  console.log('Vol标签: LOW(<2) | MEDIUM(2-5) | HIGH(5-10) | EXTREME(>10)');
  console.log('Range = volatility × multiplier\n');

  return scored;
}

// ── Pick multiplier ────────────────────────────
async function pickMultiplier() {
  console.log('Pilih range multiplier:');
  console.log('   5 = tighter range (more fee, more risk)');
  console.log('  10 = wider range (less fee, less risk)\n');
  
  const choice = await ask('Multiplier (5/10) [default=5]: ');
  rl.close();
  
  if (choice === '10') return 10;
  return 5;
}

// ── Main menu loop ─────────────────────────────
async function main() {
  console.log('\n🚀 Simple LP\n');

  while (true) {
    printMenu();
    const choice = await ask('Select: ');

    if (choice === 'q' || choice.toLowerCase() === 'q') {
      console.log('Bye!');
      break;
    }

    if (choice === '1') {
      const scored = await screening();
      rl.close();
      
      const pick = await ask('Pick pool (number): ');
      const idx = parseInt(pick) - 1;
      
      if (isNaN(idx) || idx < 0 || idx >= scored.length) {
        console.log('Invalid selection.');
        break;
      }
      
      const picked = scored[idx];
      const mult = await pickMultiplier();
      
      console.log('\n📌 Pool chosen: ' + picked.name);
      console.log('   Volatility: ' + picked.volatility + ' (' + picked.volatilityLabel + ')');
      console.log('   Range: ' + picked.volatility + ' × ' + mult + ' = ' + (picked.volatility * mult).toFixed(0) + '%');
      console.log('\n⚠️  Deploy dengan SDK masih error di Node 22.');
      console.log('   Pool address: ' + picked.pool);
      console.log('   Base mint: ' + picked.baseMint);
      console.log('\n✅ Untuk live deploy, jalanin manual di Meteora atau tunggu fix SDK.\n');
      break;

    } else if (choice === '2') {
      await viewPositions();
      rl.close();
      break;

    } else if (choice === '3') {
      await closePositionFlow();
      rl.close();
      break;

    } else {
      console.log('Invalid option.\n');
    }
  }
}

// ── View positions ─────────────────────────────
async function viewPositions() {
  console.log('\n⏳ Fetching positions...\n');
  try {
    const positions = await getEnrichedPositions();
    if (positions.length === 0) {
      console.log('No open positions.\n');
      return;
    }

    console.log(`📊 Active Positions (${positions.length}):\n`);
    console.log(' # | Position      | Pool      | PnL        | Value    | Uncl.Fee | Range    | Age  | InRange');
    console.log('---|---------------|-----------|------------|----------|----------|----------|------|--------');
    positions.forEach((p, i) => {
      const pos = p.position.slice(0, 10);
      const pool = p.pool.slice(0, 8);
      const pnl = (p.pnlUsd ?? 0) >= 0 ? `+$${(p.pnlUsd || 0).toFixed(2)}` : `-$${Math.abs(p.pnlUsd || 0).toFixed(2)}`;
      const val = p.valueUsd != null ? `$${p.valueUsd.toFixed(2)}` : '?';
      const fee = p.unclaimedFeeUsd != null ? `$${p.unclaimedFeeUsd.toFixed(2)}` : '$0';
      const range = p.lowerBin && p.upperBin ? `${p.lowerBin}-${p.upperBin}` : '?';
      const age = p.ageMinutes != null ? `${p.ageMinutes}m` : '?';
      const inRange = p.inRange === true ? '✅' : p.inRange === false ? '❌' : '?';
      console.log(String(i + 1).padStart(2) + ' | ' + pos.padEnd(11) + ' | ' + pool.padEnd(9) + ' | ' + pnl.padEnd(10) + ' | ' + val.padEnd(8) + ' | ' + fee.padEnd(8) + ' | ' + range.padEnd(8) + ' | ' + age.padEnd(4) + ' | ' + inRange);
    });
    console.log('');
  } catch (e) {
    console.error('Error:', e.message);
  }
}

// ── Close position ────────────────────────────
async function closePositionFlow() {
  try {
    const positions = await getEnrichedPositions();
    if (positions.length === 0) {
      console.log('\nNo open positions to close.\n');
      return;
    }

    console.log('\n📊 Active Positions:\n');
    positions.forEach((p, i) => {
      const pnl = (p.pnlUsd ?? 0) >= 0 ? `+$${(p.pnlUsd || 0).toFixed(2)}` : `-$${Math.abs(p.pnlUsd || 0).toFixed(2)}`;
      const fee = p.unclaimedFeeUsd != null ? `$${p.unclaimedFeeUsd.toFixed(2)}` : '$0';
      console.log((i + 1) + '. ' + p.position.slice(0, 16) + '... | PnL: ' + pnl + ' | Unclaimed: ' + fee);
    });

    const answer = await ask('\nPick position to close (number): ');
    const idx = parseInt(answer) - 1;

    if (isNaN(idx) || idx < 0 || idx >= positions.length) {
      console.log('Invalid selection.');
      return;
    }

    const picked = positions[idx];
    console.log(`\n🔴 Closing position ${picked.position}...`);

    const result = await closePosition(picked.position);
    if (result.success) {
      console.log(`\n✅ Position closed!`);
      console.log(`   TXs: ${result.txs.join(', ')}`);
    } else {
      console.log(`\n❌ Failed: ${result.error}`);
    }
  } catch (e) {
    console.error('Error:', e.message);
  }
}

main().catch((e) => {
  console.error('Error:', e.message);
  process.exit(1);
});
