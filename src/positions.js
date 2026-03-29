import 'dotenv/config';
import { PublicKey } from '@solana/web3.js';
import { RPC_URL, WALLET_PRIVATE_KEY } from './config.js';
import { getConnection, getWallet } from './lib.js';
import { loadPositionsState } from './state.js';

const POOL_API_PNL = 'https://dlmm.datapi.meteora.ag/positions';

// ─── Get My Positions ─────────────────────────────────────────
export async function getMyPositions() {
  const wallet = getWallet();
  const connection = getConnection();

  // Scan DLMM program for positions owned by wallet
  const DLMM_PROGRAM = new PublicKey('LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo');

  const accounts = await connection.getProgramAccounts(DLMM_PROGRAM, {
    filters: [{ memcmp: { offset: 40, bytes: wallet.publicKey.toBase58() } }],
  });

  const positions = [];
  for (const acc of accounts) {
    const positionAddress = acc.pubkey.toBase58();
    const poolAddress = new PublicKey(acc.account.data.slice(8, 40)).toBase58();
    positions.push({ position: positionAddress, pool: poolAddress });
  }

  return { wallet: wallet.publicKey.toString(), total: positions.length, positions };
}

// ─── Get enriched positions with PnL ──────────────────────────
export async function getEnrichedPositions() {
  const { wallet, positions } = await getMyPositions();
  if (positions.length === 0) return [];

  // Load tracked state
  const state = loadPositionsState();

  const enriched = [];
  for (const pos of positions) {
    const pnl = await fetchPnL(pos.pool, wallet);
    const tracked = state[pos.position] || {};
    const ageMs = pnl?.createdAt ? Date.now() - pnl.createdAt * 1000 : null;

    // Get tracked metadata
    const pair = tracked.poolName || pos.pool.slice(0, 8);
    const volatility = tracked.volatility || null;
    const multiplier = tracked.multiplier || null;
    const rangePct = tracked.rangePct || null;

    enriched.push({
      position:    pos.position,
      pool:        pos.pool,
      pair,
      volatility,
      multiplier,
      rangePct,
      pnlUsd:      pnl ? Math.round((pnl.pnlUsd ?? 0) * 100) / 100 : null,
      pnlPct:      pnl ? Math.round((pnl.pnlPctChange ?? 0) * 100) / 100 : null,
      valueUsd:    pnl ? Math.round(parseFloat(pnl.unrealizedPnl?.balances || 0) * 100) / 100 : null,
      unclaimedFeeUsd: pnl
        ? Math.round((
            parseFloat(pnl.unrealizedPnl?.unclaimedFeeTokenX?.usd || 0) +
            parseFloat(pnl.unrealizedPnl?.unclaimedFeeTokenY?.usd || 0)
          ) * 100) / 100
        : null,
      inRange:      pnl ? !pnl.isOutOfRange : null,
      lowerBin:    pnl?.lowerBinId ?? tracked.lowerBin ?? null,
      upperBin:    pnl?.upperBinId ?? tracked.upperBin ?? null,
      activeBin:   pnl?.poolActiveBinId ?? null,
      ageMinutes:  ageMs ? Math.floor(ageMs / 60000) : null,
      baseMint:    tracked.baseMint || null,
    });
  }
  return enriched;
}

// ─── Fetch PnL from Meteora API ───────────────────────────────
function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function fetchPnL(poolAddress, walletAddress) {
  const url = `${POOL_API_PNL}/${poolAddress}/pnl?user=${walletAddress}&status=open&pageSize=100&page=1`;

  // Retry up to 3 times on failure
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url);

      // Rate limited - retry after delay
      if (res.status === 429) {
        if (attempt < 2) {
          console.log(`   ⚠️  Rate limited, retrying in ${attempt + 1}s...`);
          await sleep(1000 * (attempt + 1));
          continue;
        }
      }

      if (!res.ok) {
        if (attempt < 2) {
          console.log(`   ⚠️  PNL fetch failed (${res.status}), retrying...`);
          await sleep(1000);
          continue;
        }
        console.log(`   ⚠️  PNL fetch failed after 3 attempts`);
        return null;
      }

      const data = await res.json();
      const positions = data.positions || data.data || [];
      return positions[0] || null;

    } catch (e) {
      if (attempt < 2) {
        await sleep(1000);
        continue;
      }
      console.log(`   ⚠️  PNL fetch error: ${e.message}`);
    }
  }

  return null;
}
