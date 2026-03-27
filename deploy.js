import { Connection, Keypair, PublicKey, sendAndConfirmTransaction } from '@solana/web3.js';
import BN from 'bn.js';
import bs58 from 'bs58';
import { RPC_URL, WALLET_PRIVATE_KEY, DEPLOY, DRY_RUN } from './config.js';

// ── Lazy DLMM loader ────────────────────────────
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

// ── Connection + Wallet ─────────────────────────
function getConnection() {
  return new Connection(RPC_URL, 'confirmed');
}

function getWallet() {
  if (!WALLET_PRIVATE_KEY) throw new Error('WALLET_PRIVATE_KEY not set in .env');
  return Keypair.fromSecretKey(bs58.decode(WALLET_PRIVATE_KEY));
}

// ── Pool cache ─────────────────────────────────
const poolCache = new Map();

async function getPool(poolAddress) {
  if (!poolCache.has(poolAddress)) {
    const { DLMM } = await getDLMM();
    const pool = await DLMM.create(getConnection(), new PublicKey(poolAddress));
    poolCache.set(poolAddress, pool);
  }
  return poolCache.get(poolAddress);
}

// ── Get active bin ──────────────────────────────
export async function getActiveBin(poolAddress) {
  const pool = await getPool(poolAddress);
  const activeBin = await pool.getActiveBin();
  const binStep = pool.lbPair.binStep; // raw: 1 = 0.01%, 100 = 1%
  
  return {
    binId:     activeBin.binId,
    price:     pool.fromPricePerLamport(Number(activeBin.price)),
    binStep:   binStep,
    // Convert bin step to percentage per bin
    stepPct:   binStep / 10000, // e.g., 100 / 10000 = 0.01 = 1%
  };
}

/**
 * Calculate min bin from percentage below active price.
 * 
 * Example: 
 *   active price = 0.00000324
 *   rangePctBelow = 20 (%)
 *   binStep = 100 (1% per bin)
 *   
 *   binsBelow = 20 / 1 = 20 bins
 *   minBin = activeBin - 20
 */
function pctToBins(pctBelow, stepPct) {
  return Math.round(pctBelow / (stepPct * 100));
}

// ── Deploy ──────────────────────────────────────
export async function deployPool(poolAddress, options = {}) {
  const wallet = getWallet();
  const pool = await getPool(poolAddress);
  const activeBin = await pool.getActiveBin();
  const binStep = pool.lbPair.binStep;
  const stepPct = binStep / 10000;

  // Config overrides
  const amountSol  = options.amountSol  ?? DEPLOY.amountSol;
  const rangePct   = options.rangePctBelow ?? DEPLOY.rangePctBelow;
  const strategyName = options.strategy   ?? DEPLOY.strategy;

  // Calculate bins from percentage
  const binsBelow = pctToBins(rangePct, stepPct);
  const binsAbove = options.rangeMaxBinsAbove ?? DEPLOY.rangeMaxBinsAbove;
  
  const minBinId = activeBin.binId - binsBelow;
  const maxBinId = activeBin.binId + binsAbove;
  const totalBins = binsBelow + binsAbove;
  const isWideRange = totalBins > 69;

  const activePrice = pool.fromPricePerLamport(Number(activeBin.price));
  
  // Calculate actual price range
  // price at bin N = activePrice * (1 + stepPct)^(N - activeBinId)
  const minPrice = activePrice * Math.pow(1 - stepPct, binsBelow);
  const maxPrice = binsAbove > 0 ? activePrice * Math.pow(1 + stepPct, binsAbove) : activePrice;

  const { StrategyType } = await getDLMM();

  const strategyMap = {
    spot:    StrategyType.Spot,
    curve:   StrategyType.Curve,
    bid_ask: StrategyType.BidAsk,
  };
  const strategyType = strategyMap[strategyName];
  if (!strategyType) throw new Error(`Unknown strategy: ${strategyName}`);

  console.log(`📦 Deploying to: ${poolAddress}`);
  console.log(`   Strategy: ${strategyName}`);
  console.log(`   Active bin: ${activeBin.binId} @ price ${Number(activePrice).toExponential(4)}`);
  console.log(`   Bin step: ${binStep} (${(stepPct * 100).toFixed(2)}% per bin)`);
  console.log(`   Range: ${rangePct}% below = ${binsBelow} bins`);
  console.log(`   Position: bin ${minBinId} → ${maxBinId} (${totalBins} bins${isWideRange ? ' — WIDE' : ''})`);
  console.log(`   Price range: ${Number(minPrice).toExponential(4)} → ${Number(maxPrice).toExponential(4)}`);
  console.log(`   Amount: ${amountSol} SOL`);

  if (DRY_RUN) {
    console.log('🔴 DRY RUN — no transaction sent');
    return {
      dryRun: true,
      poolAddress,
      amountSol,
      binsBelow,
      binsAbove,
      minBinId,
      maxBinId,
      totalBins,
      minPrice,
      maxPrice,
      strategy: strategyName,
    };
  }

  const solLamports = new BN(Math.floor(amountSol * 1e9));
  const newPosition = Keypair.generate();

  try {
    const txHashes = [];

    if (isWideRange) {
      // Wide range: create empty position first, then add liquidity
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
      // Standard: initialize + add liquidity in one tx
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

    console.log(`✅ Success! ${txHashes.length} tx(s): ${txHashes[0]}`);

    return {
      success: true,
      position: newPosition.publicKey.toString(),
      pool: poolAddress,
      tx: txHashes[0],
      txs: txHashes,
      binRange: { min: minBinId, max: maxBinId, active: activeBin.binId },
      priceRange: { min: minPrice, max: maxPrice },
      strategy: strategyName,
    };
  } catch (err) {
    console.error(`❌ Deploy failed: ${err.message}`);
    return { success: false, error: err.message };
  }
}
