import {
  Keypair,
  PublicKey,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import BN from 'bn.js';
import { DEPLOY, DRY_RUN, LIMITS } from './config.js';
import { getConnection, getWallet, logTx, calcBins } from './lib.js';
import { getWalletBalances } from './wallet-utils.js';
import { swap } from './swap.js';

const JUPITER_LITE_QUOTE = 'https://lite-api.jup.ag/swap/v1/quote';
const JUPITER_LITE_SWAP = 'https://lite-api.jup.ag/swap/v1/swap';
import { loadPositionsState, savePositionsState } from './state.js';

// ─── Tx sender with auto-retry ───────────────────────────────
async function sendWithRetry(tx, signers, retries = 3) {
  const connection = getConnection();
  for (let i = 0; i < retries; i++) {
    try {
      const hash = await sendAndConfirmTransaction(connection, tx, signers, { skipPreflight: true });
      return { success: true, hash };
    } catch (err) {
      const isRetriable = err.message?.includes('timeout') || err.message?.includes('cu');
      if (!isRetriable || i === retries - 1) {
        return { success: false, error: err.message };
      }
      console.log(`   ⚠️  Tx attempt ${i + 1} failed, retrying...`);
      await new Promise(r => setTimeout(r, 1000 * (i + 1)));
    }
  }
}

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

// ─── Pool Cache ────────────────────────────────────────────────
const poolCache = new Map();
const POOL_CACHE_TTL = 1 * 60 * 1000; // 1 min

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
    stepPct: binStep / 10000,
  };
}



// ─── Safety Checks ─────────────────────────────────────────────
async function safetyCheckDeploy(poolAddress, amountSol, volatility, multiplier) {
  const errors = [];

  const minDeploy = 0.05;
  if (amountSol < minDeploy) {
    errors.push(`Amount ${amountSol} SOL < minimum ${minDeploy} SOL`);
  }

  const maxDeploy = 2.0;
  if (amountSol > maxDeploy) {
    errors.push(`Amount ${amountSol} SOL > maximum ${maxDeploy} SOL`);
  }

  try {
    const balances = await getWalletBalances();
    const gasReserve = DEPLOY.gasReserve ?? 0.01;
    const needed = amountSol + gasReserve;
    if (balances.sol < needed) {
      errors.push(`Insufficient SOL: have ${balances.sol.toFixed(4)}, need ${needed.toFixed(4)} (deploy + gas)`);
    }
  } catch (e) {}

  const targetPercent = volatility * multiplier;
  if (targetPercent > 100) {
    errors.push(`Range ${targetPercent.toFixed(0)}% is too wide (>100%)`);
  }

  return { pass: errors.length === 0, errors };
}

// ─── Deploy Position ────────────────────────────────────────────
export async function deployPool(poolAddress, options = {}) {
  const { DLMM, StrategyType } = await getDLMM();
  const wallet = getWallet();
  const pool = await getPool(poolAddress);

  const multiplier = options.multiplier ?? DEPLOY.rangeMultiplierDefault ?? 5;
  const amountSol  = options.amountSol  ?? DEPLOY.amountSol ?? 0.1;
  const volatility = options.volatility ?? 5;

  const safety = await safetyCheckDeploy(poolAddress, amountSol, volatility, multiplier);
  if (!safety.pass && !DRY_RUN) {
    return { success: false, errors: safety.errors };
  }

  const binStep = pool.lbPair.binStep;
  const { targetPercent, binsDown, totalBins } = calcBins(volatility, multiplier, binStep);
  const activeBin = await pool.getActiveBin();

  const binsAbove = 0;
  const minBinId = activeBin.binId - binsDown;
  const maxBinId = activeBin.binId + binsAbove;
  const isWideRange = totalBins > 69;

  const strategyType = StrategyType.BidAsk;

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
      success: true,
      dryRun: true,
      poolAddress, poolName: options.poolName, volatility, multiplier,
      targetPercent, binsDown, binsAbove, minBinId, maxBinId, totalBins,
      amountSol, strategy: 'bid_ask',
      message: 'DRY RUN — no transaction sent',
    };
  }

  const solLamports = new BN(Math.floor(amountSol * 1e9));
  const newPosition = Keypair.generate();

  try {
    const txHashes = [];

    if (isWideRange) {
      console.log(`   ⚠️  Wide range (>69 bins) — will use 2-step deploy`);

      const createTxs = await pool.createExtendedEmptyPosition(
        minBinId, maxBinId, newPosition.publicKey, wallet.publicKey
      );
      for (const tx of Array.isArray(createTxs) ? createTxs : [createTxs]) {
        const signers = txHashes.length === 0 ? [wallet, newPosition] : [wallet];
        const result = await sendWithRetry(tx, signers);
        if (!result.success) throw new Error('Create position tx failed: ' + result.error);
        txHashes.push(result.hash);
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
        const result = await sendWithRetry(tx, [wallet]);
        if (!result.success) throw new Error('Add liquidity tx failed: ' + result.error);
        txHashes.push(result.hash);
      }
    } else {
      const tx = await pool.initializePositionAndAddLiquidityByStrategy({
        positionPubKey: newPosition.publicKey,
        user: wallet.publicKey,
        totalXAmount: new BN(0),
        totalYAmount: solLamports,
        strategy: { minBinId, maxBinId, strategyType },
        slippage: 1000,
      });
      const result = await sendWithRetry(tx, [wallet, newPosition]);
      if (!result.success) throw new Error('Deploy tx failed: ' + result.error);
      txHashes.push(result.hash);
    }

    console.log(`\n✅ SUCCESS! ${txHashes.length} tx(s): ${txHashes[0]}`);

    // Log to tx-history
    logTx({
      type: 'deploy',
      pool: poolAddress,
      poolName: options.poolName,
      position: newPosition.publicKey.toString(),
      txs: txHashes,
      amountSol,
      multiplier,
      targetPercent,
    });

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

  const poolAddress = await findPoolForPosition(positionAddress, wallet.publicKey.toString());
  poolCache.delete(poolAddress);
  const pool = await getPool(poolAddress);
  const positionPubKey = new PublicKey(positionAddress);
  const txHashes = [];

  try {
    try {
      console.log(`   Step 1: Claiming fees...`);
      const positionData = await pool.getPosition(positionPubKey);
      const claimTxs = await pool.claimSwapFee({ owner: wallet.publicKey, position: positionData });
      if (claimTxs?.length) {
        for (const tx of claimTxs) {
          const result = await sendWithRetry(tx, [wallet]);
          if (!result.success) {
            console.log(`   ⚠️  Fee claim tx failed: ${result.error}`);
          } else {
            txHashes.push(result.hash);
          }
        }
        if (txHashes.length > 0) {
          console.log(`   ✅ Fees claimed (${txHashes.length} tx)`);
        }
      }
    } catch (e) {
      console.log(`   ⚠️  Fee claim skipped: ${e.message}`);
    }

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
      const result = await sendWithRetry(tx, [wallet]);
      if (!result.success) throw new Error('Close tx failed: ' + result.error);
      txHashes.push(result.hash);
    }

    console.log(`\n✅ Position closed! ${txHashes.length} tx(s): ${txHashes.join(', ')}`);
    poolCache.delete(poolAddress);

    // Log to tx-history
    logTx({
      type: 'close',
      position: positionAddress,
      pool: poolAddress,
      txs: txHashes,
    });

    return { success: true, position: positionAddress, pool: poolAddress, txs: txHashes };
  } catch (err) {
    console.error(`\n❌ Close failed: ${err.message}`);
    return { success: false, error: err.message };
  }
}

// ─── Auto-swap ALL tokens above threshold ──────────────────────
export async function autoSwapAllTokens(minUsd = 0.5) {
  const SOL_MINT = 'So11111111111111111111111111111111111111112';
  const SOL_DECIMALS = 9;

  try {
    const balances = await getWalletBalances();
    const nonSolTokens = balances.tokens.filter(t => t.mint !== SOL_MINT);

    if (nonSolTokens.length === 0) {
      console.log(`   ⏭️  No tokens to swap`);
      return { swapped: 0 };
    }

    console.log(`   🔄 Checking ${nonSolTokens.length} tokens for swap eligibility...`);

    // Get SOL price from a quote (use USDC as intermediate if available)
    // We'll quote each token → SOL and check if output is worth > minUsd
    let swapped = 0;
    const swapErrors = [];

    for (const token of nonSolTokens) {
      // Convert balance to smallest unit (lamports)
      const amountLamports = Math.floor(token.balance * Math.pow(10, token.decimals));
      if (amountLamports <= 0) continue;

      if (DRY_RUN) {
        console.log(`   🔄 [DRY RUN] Would swap ${token.symbol} (${token.balance})`);
        swapped++;
        continue;
      }

      try {
        // Quote: token → SOL
        const quoteRes = await fetch(
          `${JUPITER_LITE_QUOTE}?inputMint=${token.mint}&outputMint=${SOL_MINT}&amount=${amountLamports}&slippageBps=50`
        );

        if (!quoteRes.ok) {
          console.log(`   ⚠️  ${token.symbol} quote failed: ${quoteRes.status}`);
          swapErrors.push({ token: token.symbol, error: 'quote failed' });
          continue;
        }

        const quote = await quoteRes.json();
        const outAmountSol = parseInt(quote.outAmount) / Math.pow(10, SOL_DECIMALS);

        // Estimate USD value: outAmount SOL × estimated SOL price
        // Since we don't have direct price, we check if it's worth swapping
        // Use swapUsdValue from quote if available
        const usdValue = parseFloat(quote.swapUsdValue || 0);

        if (usdValue < minUsd) {
          console.log(`   ⏭️  ${token.symbol} value $${usdValue.toFixed(2)} < $${minUsd} — skipping`);
          continue;
        }

        console.log(`   🔄 Swapping ${token.symbol} (~$ ${usdValue.toFixed(2)}) → SOL...`);

        // Execute swap
        const swapRes = await fetch(JUPITER_LITE_SWAP, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            quoteResponse: quote,
            userPublicKey: getWallet().publicKey.toString(),
          }),
        });

        if (!swapRes.ok) {
          console.log(`   ⚠️  ${token.symbol} swap failed: ${swapRes.status}`);
          swapErrors.push({ token: token.symbol, error: 'swap failed' });
          continue;
        }

        const swapData = await swapRes.json();
        const txBuf = Buffer.from(swapData.swapTransaction, 'base64');
        const tx = VersionedTransaction.deserialize(txBuf);
        tx.sign([getWallet()]);

        const txHash = await sendWithRetry(tx, [getWallet()]);
        if (txHash.success) {
          console.log(`   ✅ ${token.symbol} → SOL (${outAmountSol.toFixed(4)} SOL) | TX: ${txHash.hash}`);
          swapped++;
        } else {
          console.log(`   ⚠️  ${token.symbol} tx failed: ${txHash.error}`);
          swapErrors.push({ token: token.symbol, error: txHash.error });
        }
      } catch (err) {
        console.log(`   ⚠️  ${token.symbol} error: ${err.message}`);
        swapErrors.push({ token: token.symbol, error: err.message });
      }
    }

    console.log(`   ✅ Auto-swap done: ${swapped}/${nonSolTokens.length} tokens swapped to SOL`);
    if (swapErrors.length > 0) {
      console.log(`   ⚠️  ${swapErrors.length} tokens failed (check log)`);
    }

    return { swapped, errors: swapErrors };
  } catch (e) {
    console.log(`   ⚠️  Auto-swap error: ${e.message}`);
    return { success: false, error: e.message };
  }
}

// ─── Find pool for position ────────────────────────────────────
async function findPoolForPosition(positionAddress, walletAddress) {
  const state = loadPositionsState();
  if (state[positionAddress]?.pool) {
    return state[positionAddress].pool;
  }

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

// ─── Position tracking ────────────────────────────────────────
export function trackPosition(pos) {
  const state = loadPositionsState();
  state[pos.position] = { ...pos, tracked_at: new Date().toISOString() };
  savePositionsState(state);
}

export function getTrackedPosition(posAddress) {
  return loadPositionsState()[posAddress] || null;
}
