import {
  Connection,
  Keypair,
  PublicKey,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import BN from 'bn.js';
import bs58 from 'bs58';
import { RPC_URL, WALLET_PRIVATE_KEY, DEPLOY, DRY_RUN, SCREENING } from './config.js';
import { getWalletBalances } from './wallet-utils.js';

// ─── Lazy SDK loader ───────────────────────────────────────────
let _DLMM = null;
let _StrategyType = null;

async function getDLMM() {
  if (!_DLMM) {
    const mod = await import('@meteora-ag/dlmm');
    _DLMM = mod.default;
    _StrategyType = mod.StrategyType;
  }
  return { DLMM: _DLMM, StrategyType: _StrategyType };
}

// ─── Connection + Wallet ──────────────────────────────────────
function getConnection() {
  return new Connection(RPC_URL, 'confirmed');
}

function getWallet() {
  if (!WALLET_PRIVATE_KEY) throw new Error('WALLET_PRIVATE_KEY not set in .env');
  return Keypair.fromSecretKey(bs58.decode(WALLET_PRIVATE_KEY));
}

// ─── Pool Cache ────────────────────────────────────────────────
const poolCache = new Map();
const POOL_CACHE_TTL = 5 * 60 * 1000; // 5 min

async function getPool(poolAddress) {
  const key = poolAddress.toString();
  if (!poolCache.has(key)) {
    const { DLMM } = await getDLMM();
    const pool = await DLMM.create(getConnection(), new PublicKey(poolAddress));
    poolCache.set(key, { pool, cachedAt: Date.now() });
  }
  const cached = poolCache.get(key);
  if (Date.now() - cached.cachedAt > POOL_CACHE_TTL) {
    poolCache.delete(key);
    return getPool(poolAddress);
  }
  return cached.pool;
}

// ─── Get Active Bin ────────────────────────────────────────────
export async function getActiveBin(poolAddress) {
  const pool = await getPool(poolAddress);
  const activeBin = await pool.getActiveBin();
  const binStep = pool.lbPair.binStep;

  return {
    binId:   activeBin.binId,
    price:   pool.fromPricePerLamport(Number(activeBin.price)),
    binStep: binStep,
    stepPct: binStep / 10000, // e.g. 100 = 0.01 = 1%
  };
}

// ─── Calculate bins from volatility × multiplier ───────────────
// Formula: binsDown = -floor(log(1 - targetPercent/100) / log(1 + binStep/10000))
// targetPercent = volatility × multiplier (e.g., 2.5 × 10 = 25%)
// Example: bin step 80, target 40% → -floor(ln(0.6)/ln(1.008)) = 65 bins down
function volatilityToBins(volatility, multiplier, binStep) {
  const targetPercent = volatility * multiplier;
  const r = binStep / 10000;
  const ratio = 1 - targetPercent / 100; // e.g. 0.6 for -40%
  const deltaBin = Math.log(ratio) / Math.log(1 + r);
  const binsDown = -Math.floor(deltaBin); // negate because ratio < 1 means going down
  const totalBins = binsDown + 1; // +1 for active bin
  return { targetPercent, binsDown, totalBins, r };
}

// ─── Safety Checks ─────────────────────────────────────────────
async function safetyCheckDeploy(poolAddress, amountSol, volatility, multiplier) {
  const errors = [];

  // 1. Min amount
  const minDeploy = 0.05;
  if (amountSol < minDeploy) {
    errors.push(`Amount ${amountSol} SOL < minimum ${minDeploy} SOL`);
  }

  // 2. Max amount
  const maxDeploy = 2.0;
  if (amountSol > maxDeploy) {
    errors.push(`Amount ${amountSol} SOL > maximum ${maxDeploy} SOL`);
  }

  // 3. Balance check
  try {
    const balances = await getWalletBalances();
    const gasReserve = DEPLOY.gasReserve ?? 0.01;
    const needed = amountSol + gasReserve;
    if (balances.sol < needed) {
      errors.push(`Insufficient SOL: have ${balances.sol.toFixed(4)}, need ${needed.toFixed(4)} (deploy + gas)`);
    }
  } catch (e) {
    // wallet not configured yet — skip
  }

  // 4. Range check (volatility × multiplier)
  const targetPercent = volatility * multiplier;
  if (targetPercent > 100) {
    errors.push(`Range ${targetPercent.toFixed(0)}% is too wide (>100%)`);
  }

  return {
    pass: errors.length === 0,
    errors,
  };
}

// ─── Deploy Position ────────────────────────────────────────────
export async function deployPool(poolAddress, options = {}) {
  const { DLMM, StrategyType } = await getDLMM();
  const wallet = getWallet();
  const pool = await getPool(poolAddress);

  const multiplier   = options.multiplier  ?? DEPLOY.rangeMultiplierDefault ?? 5;
  const amountSol    = options.amountSol   ?? DEPLOY.amountSol ?? 0.1;
  const volatility   = options.volatility  ?? 5; // default if not provided

  // Safety check
  const safety = await safetyCheckDeploy(poolAddress, amountSol, volatility, multiplier);
  if (!safety.pass && !DRY_RUN) {
    return { success: false, errors: safety.errors };
  }

  // Calculate range from volatility × multiplier
  const binStep = pool.lbPair.binStep;
  const { targetPercent, binsDown, totalBins } = volatilityToBins(volatility, multiplier, binStep);
  const activeBin = await pool.getActiveBin();

  // User's range: from (activeBin - binsDown) to activeBin (all below = SOL sided)
  const binsAbove = 0; // SOL sided = all below
  const minBinId = activeBin.binId - binsDown;
  const maxBinId = activeBin.binId + binsAbove;
  const isWideRange = totalBins > 69;

  const strategyType = StrategyType.BidAsk; // SOL sided

  console.log(`\n📦 DEPLOY — ${options.poolName || poolAddress}`);
  console.log(`   Pool:        ${poolAddress}`);
  console.log(`   Volatility: ${volatility} × ${multiplier} = ${targetPercent.toFixed(1)}% range`);
  console.log(`   Bins:        ${binsDown} below active (${totalBins} total)`);
  console.log(`   Range:       bin ${minBinId} → ${maxBinId}`);
  console.log(`   Active bin:  ${activeBin.binId}`);
  console.log(`   Strategy:    bid_ask (SOL sided)`);
  console.log(`   Amount:      ${amountSol} SOL`);
  console.log(`   Bin step:   ${binStep} (${(binStep / 100).toFixed(2)}% per bin)`);

  if (DRY_RUN) {
    console.log(`\n🔴 DRY RUN — no transaction sent`);
    return {
      dryRun: true,
      poolAddress,
      poolName: options.poolName,
      volatility,
      multiplier,
      targetPercent,
      binsDown,
      binsAbove,
      minBinId,
      maxBinId,
      totalBins,
      amountSol,
      strategy: 'bid_ask',
      message: 'DRY RUN — no transaction sent',
    };
  }

  const solLamports = new BN(Math.floor(amountSol * 1e9));
  const newPosition = Keypair.generate();

  try {
    const txHashes = [];

    if (isWideRange) {
      // Wide range: create empty position first, then add liquidity
      console.log(`   ⚠️  Wide range (>69 bins) — will use 2-step deploy`);

      const createTxs = await pool.createExtendedEmptyPosition(
        minBinId, maxBinId, newPosition.publicKey, wallet.publicKey
      );
      for (const tx of Array.isArray(createTxs) ? createTxs : [createTxs]) {
        const signers = txHashes.length === 0 ? [wallet, newPosition] : [wallet];
        const hash = await sendAndConfirmTransaction(getConnection(), tx, signers, { skipPreflight: true });
        txHashes.push(hash);
      }

      const addTxs = await pool.addLiquidityByStrategyChunkable({
        positionPubKey: newPosition.publicKey,
        user: wallet.publicKey,
        totalXAmount: new BN(0),
        totalYAmount: solLamports,
        strategy: { minBinId, maxBinId, strategyType },
        slippage: 10,
      });
      for (const tx of Array.isArray(addTxs) ? addTxs : [addTxs]) {
        const hash = await sendAndConfirmTransaction(getConnection(), tx, [wallet], { skipPreflight: true });
        txHashes.push(hash);
      }
    } else {
      // Standard: single tx
      const tx = await pool.initializePositionAndAddLiquidityByStrategy({
        positionPubKey: newPosition.publicKey,
        user: wallet.publicKey,
        totalXAmount: new BN(0),
        totalYAmount: solLamports,
        strategy: { minBinId, maxBinId, strategyType },
        slippage: 1000,
      });
      const hash = await sendAndConfirmTransaction(getConnection(), tx, [wallet, newPosition], { skipPreflight: true });
      txHashes.push(hash);
    }

    console.log(`\n✅ SUCCESS! ${txHashes.length} tx(s): ${txHashes[0]}`);

    return {
      success: true,
      position: newPosition.publicKey.toString(),
      pool: poolAddress,
      poolName: options.poolName,
      volatility,
      multiplier,
      targetPercent,
      binsDown,
      binsAbove,
      minBinId,
      maxBinId,
      totalBins,
      amountSol,
      strategy: 'bid_ask',
      tx: txHashes[0],
      txs: txHashes,
    };
  } catch (err) {
    console.error(`\n❌ Deploy failed: ${err.message}`);
    return { success: false, error: err.message };
  }
}

// ─── Close Position ─────────────────────────────────────────────
export async function closePosition(positionAddress, options = {}) {
  const { DLMM } = await getDLMM();
  const wallet = getWallet();
  const connection = getConnection();

  console.log(`\n🔴 CLOSING position: ${positionAddress}`);

  if (DRY_RUN) {
    console.log(`🔴 DRY RUN — no transaction sent`);
    return { dryRun: true, position: positionAddress, message: 'DRY RUN' };
  }

  // Find pool for this position
  const poolAddress = await findPoolForPosition(positionAddress, wallet.publicKey.toString());

  // Clear pool cache to get fresh state
  poolCache.delete(poolAddress);
  const pool = await getPool(poolAddress);
  const positionPubKey = new PublicKey(positionAddress);
  const txHashes = [];

  try {
    // Step 1: Claim fees
    try {
      console.log(`   Step 1: Claiming fees...`);
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
    console.log(`   Step 2: Removing liquidity & closing...`);
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

    console.log(`\n✅ Position closed! ${txHashes.length} tx(s): ${txHashes.join(', ')}`);

    // Invalidate cache
    poolCache.delete(poolAddress);

    return {
      success: true,
      position: positionAddress,
      pool: poolAddress,
      txs: txHashes,
    };
  } catch (err) {
    console.error(`\n❌ Close failed: ${err.message}`);
    return { success: false, error: err.message };
  }
}

// ─── Auto-swap base token → SOL ───────────────────────────────
export async function autoSwapToSol(baseMint, amount, minUsd = 0.10) {
  if (DRY_RUN) {
    console.log(`   🔄 [DRY RUN] Would swap ${amount} of ${baseMint} → SOL`);
    return { dryRun: true };
  }

  try {
    const balances = await getWalletBalances();
    const token = balances.tokens?.find(t => t.mint === baseMint);
    if (!token || token.usd < minUsd) {
      console.log(`   ⏭️  Skipping swap — token value $${token?.usd?.toFixed(2) || 0} < $${minUsd}`);
      return { skipped: true, reason: 'below minimum' };
    }

    console.log(`   🔄 Swapping ${token.symbol || baseMint.slice(0, 8)} ($${token.usd.toFixed(2)}) → SOL`);
    // Use Jupiter or Raydium — simple swap
    const result = await swapToken(baseMint, 'So11111111111111111111111111111111111111112', token.balance);
    if (result.success) {
      console.log(`   ✅ Swapped! TX: ${result.tx}`);
    }
    return result;
  } catch (e) {
    console.log(`   ⚠️  Swap failed: ${e.message}`);
    return { success: false, error: e.message };
  }
}

// ─── Simple Jupiter swap ───────────────────────────────────────
async function swapToken(inputMint, outputMint, amount) {
  const { swap } = await import('./swap.js');
  return swap({ inputMint, outputMint, amount });
}

// ─── Find pool for position (quick lookup) ────────────────────
async function findPoolForPosition(positionAddress, walletAddress) {
  // Try state file first
  const state = await import('./state.json', { assert: { type: 'json' } }).catch(() => null);
  if (state?.default?.[positionAddress]?.pool) {
    return state.default[positionAddress].pool;
  }

  // Fallback: SDK scan
  const { DLMM } = await getDLMM();
  const allPositions = await DLMM.getAllLbPairPositionsByUser(
    getConnection(),
    new PublicKey(walletAddress)
  );
  for (const [lbPairKey, positionData] of Object.entries(allPositions)) {
    for (const pos of positionData.lbPairPositionsData || []) {
      if (pos.publicKey.toString() === positionAddress) return lbPairKey;
    }
  }
  throw new Error(`Position ${positionAddress} not found`);
}

// ─── State file helpers ────────────────────────────────────────
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE_FILE = path.join(__dirname, 'positions-state.json');

export function loadState() {
  if (fs.existsSync(STATE_FILE)) {
    try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch {}
  }
  return {};
}

export function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

export function trackPosition(pos) {
  const state = loadState();
  state[pos.position] = { ...pos, tracked_at: new Date().toISOString() };
  saveState(state);
}

export function getTrackedPosition(posAddress) {
  return loadState()[posAddress] || null;
}
