import 'dotenv/config';

// ── Wallet ─────────────────────────────────────
export const WALLET_PRIVATE_KEY = process.env.WALLET_PRIVATE_KEY;
export const RPC_URL = process.env.RPC_URL || 'https://api.mainnet-beta.solana.com';

// ── Screening Filters ───────────────────────────
export const SCREENING = {
  minMcap:              150_000,       // min market cap (USD)
  maxMcap:           10_000_000,       // max market cap (USD)
  minHolders:              100,         // min token holders
  minVolume:             5_000,         // volume (USD) per timeframe
  minVolumeChange:           0,         // volume change % (0 = any, positive = rising)
  minTvl:                 5_000,         // min TVL (USD)
  maxTvl:               300_000,         // max TVL (USD)
  minBinStep:                 1,         // raw: 1 = 0.01%, 10 = 0.1%, 100 = 1%
  maxBinStep:             1_000,           // raw: 1000 = 10%
  minFeeActiveTvlRatio:       0.05,       // fee/TVL ratio %
  minOrganic:                20,           // organic score (0-100)
  timeframe:             '1h',             // '5m' | '1h' | '4h' | '24h'
};

// ── Deploy Settings ─────────────────────────────
export const DEPLOY = {
  amountSol:   0.1,                  // SOL per deploy
  amountX:     0,                    // 0 = SOL only (sided)

  // Range mode: 'fixed' or 'volatility'
  rangeMode:   'volatility',         // 'fixed' = use rangePctBelow directly
                                     // 'volatility' = multiply volatility × rangeMultiplier

  // Fixed range (used if rangeMode = 'fixed')
  rangePctBelow: 20,                 // % below active price

  // Volatility-based range (used if rangeMode = 'volatility')
  // User picks multiplier at runtime: 5 = tight, 10 = wide
  rangeMultiplierDefault: 5,          // default multiplier
  rangeMaxBinsAbove: 0,              // 0 = all bins below (SOL sided)

  strategy:    'bid_ask',            // 'spot' | 'curve' | 'bid_ask'
  gasReserve:  0.05,                 // SOL kept for gas
};

// ── TP/SL Monitoring ───────────────────────────
export const TPSL = {
  enabled:     true,                // Enable TP/SL monitoring
  tpPercent:   1.0,                // Take profit at +1% PnL
  slPercent:   -5.0,               // Stop loss at -5% PnL
  checkIntervalMs: 60_000,         // Check every 60 seconds
};

// ── Position Limits ────────────────────────────
export const LIMITS = {
  maxActivePositions: 2,            // Max 2 open positions
  autoRedeployOnClose: true,        // Auto screen + suggest when position closes
};

export const DRY_RUN = process.env.DRY_RUN === 'true';
