import { Connection, Keypair, PublicKey, sendAndConfirmTransaction } from '@solana/web3.js';
import BN from 'bn.js';
import bs58 from 'bs58';
import { RPC_URL, WALLET_PRIVATE_KEY } from './config.js';

// ── Lazy DLMM loader ───────────────────────────
let _DLMM = null;
async function getDLMM() {
  if (!_DLMM) {
    const mod = await import('@meteora-ag/dlmm');
    _DLMM = mod.default;
  }
  return _DLMM;
}

// ── Connection + Wallet ─────────────────────────
function getConnection() {
  return new Connection(RPC_URL, 'confirmed');
}

function getWallet() {
  if (!WALLET_PRIVATE_KEY) throw new Error('WALLET_PRIVATE_KEY not set');
  return Keypair.fromSecretKey(bs58.decode(WALLET_PRIVATE_KEY));
}

// ── Fetch open positions ───────────────────────
export async function getMyPositions() {
  const wallet = getWallet();
  const DLMM = await getDLMM();

  const program = new PublicKey('LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo');
  const accounts = await getConnection().getProgramAccounts(program, {
    filters: [{ memcmp: { offset: 40, bytes: wallet.publicKey.toBase58() } }],
  });

  const positions = [];
  for (const acc of accounts) {
    const positionAddress = acc.pubkey.toBase58();
    const poolKey = new PublicKey(acc.account.data.slice(8, 40)).toBase58();
    positions.push({ position: positionAddress, pool: poolKey });
  }

  return { wallet: wallet.publicKey.toBase58(), total: positions.length, positions };
}

// ── Fetch PnL for a position ───────────────────
async function fetchPnL(poolAddress, walletAddress) {
  const url = `https://dlmm.datapi.meteora.ag/positions/${poolAddress}/pnl?user=${walletAddress}&status=open&pageSize=100&page=1`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = await res.json();
  return (data.positions || [])[0] || null;
}

// ── Get enriched positions with PnL ───────────
export async function getEnrichedPositions() {
  const { wallet, positions } = await getMyPositions();
  if (positions.length === 0) return [];

  const enriched = [];
  for (const pos of positions) {
    const pnl = await fetchPnL(pos.pool, wallet);
    const ageMs = pnl?.createdAt ? Date.now() - pnl.createdAt * 1000 : null;

    enriched.push({
      position:    pos.position,
      pool:        pos.pool,
      pair:        pos.pool.slice(0, 8),
      pnlUsd:      pnl ? Math.round((pnl.pnlUsd ?? 0) * 100) / 100 : null,
      pnlPct:      pnl ? Math.round((pnl.pnlPctChange ?? 0) * 100) / 100 : null,
      valueUsd:    pnl ? Math.round(parseFloat(pnl.unrealizedPnl?.balances || 0) * 100) / 100 : null,
      unclaimedFeeUsd: pnl
        ? Math.round((parseFloat(pnl.unrealizedPnl?.unclaimedFeeTokenX?.usd || 0) + parseFloat(pnl.unrealizedPnl?.unclaimedFeeTokenY?.usd || 0)) * 100) / 100
        : null,
      inRange:     pnl ? !pnl.isOutOfRange : null,
      lowerBin:   pnl?.lowerBinId ?? null,
      upperBin:   pnl?.upperBinId ?? null,
      activeBin:  pnl?.poolActiveBinId ?? null,
      ageMinutes: ageMs ? Math.floor(ageMs / 60000) : null,
    });
  }
  return enriched;
}

// ── Close position + claim fees ───────────────
export async function closePosition(positionAddress) {
  const wallet = getWallet();
  const DLMM = await getDLMM();

  // Find pool for this position
  const { positions } = await getMyPositions();
  const pos = positions.find(p => p.position === positionAddress);
  if (!pos) throw new Error('Position not found');

  const connection = getConnection();
  const pool = await DLMM.create(connection, new PublicKey(pos.pool));
  const positionPubKey = new PublicKey(positionAddress);
  const txHashes = [];

  try {
    // Step 1: Claim fees
    try {
      const positionData = await pool.getPosition(positionPubKey);
      const claimTxs = await pool.claimSwapFee({ owner: wallet.publicKey, position: positionData });
      if (claimTxs?.length) {
        for (const tx of claimTxs) {
          const hash = await sendAndConfirmTransaction(connection, tx, [wallet], { skipPreflight: true });
          txHashes.push(hash);
        }
        console.log(`   ✅ Fees claimed (${txHashes.length} tx)`);
      }
    } catch (e) {
      console.log(`   ⚠️  Fee claim skipped: ${e.message}`);
    }

    // Step 2: Remove liquidity + close
    const closeTx = await pool.removeLiquidity({
      user: wallet.publicKey,
      position: positionPubKey,
      fromBinId: -887272,
      toBinId: 887272,
      bps: new BN(10000),
      shouldClaimAndClose: true,
    });

    for (const tx of Array.isArray(closeTx) ? closeTx : [closeTx]) {
      const hash = await sendAndConfirmTransaction(connection, tx, [wallet], { skipPreflight: true });
      txHashes.push(hash);
    }

    return { success: true, position: positionAddress, txs: txHashes };
  } catch (err) {
    return { success: false, error: err.message };
  }
}
