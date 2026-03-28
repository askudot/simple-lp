# Simple LP — Meteora DLMM Bot

Guided conversational CLI untuk screening dan deploy liquidity di **Meteora DLMM**.

## Quick Start

```bash
git clone https://github.com/asku/simple-lp.git
cd simple-lp
npm install
cp .env.example .env
# Edit .env — add WALLET_PRIVATE_KEY and RPC_URL
npm start
```

## Setup

### 1. Environment

```bash
cp .env.example .env
```

Edit `.env`:
```env
WALLET_PRIVATE_KEY=<your_base58_private_key>
RPC_URL=https://mainnet.helius-rpc.com/?api-key=YOUR_KEY
DRY_RUN=false
```

### 2. Wallet

```bash
# Generate new wallet
npm run wallet:generate

# Or import existing
npm run wallet:import <your_secret_key>
```

### 3. RPC URL

Get free Helius key: https://helius.xyz

## Commands

```bash
npm start             # Manual mode
npm start auto       # Auto mode (auto deploy + TP/SL monitor)
npm start screen     # Screening pools
npm start positions  # View positions
npm start balance    # Check wallet
npm run wallet:generate # Generate wallet
npm run monitor       # Background TP/SL monitor
```

## Output Format

### Screening Pool Results
```
==============================================================
  POOL SCREENING RESULTS
==============================================================

  Active Positions: 0/2 (2 slot available)

  #   Pool                  Mkt Cap    Vol/Hour   TVL       Fee/TVL  Bin/Fee    Score
  ──────────────────────────────────────────────────────────────────────────────────────────
  1  SQUEEZE-SOL          $169k      $26k       $15k      10.6%   125/5%     4.3   [RECOMMENDED]
  2  Deadwhale-SOL        $548k      $8k        $7k       2.3%    80/0.8%    1.7
  ...

  Suggested: SQUEEZE-SOL (Score: 4.33 | Vol: $26k/Hour)

  Type pool number to select (1-7)
  'screen' to refresh | 'positions' to view | 'menu' for commands
```

### Pool Detail
```
==============================================================
  POOL DETAIL: DEADWHALE-SOL
==============================================================

  Fee:           0.8%
  TVL:           $11k
  Volume/Hour:   $7k (-21.8%)
  Holders:       3,864
  Market Cap:    $644k
  Organic:       75/100
  Fee/TVL:       1.33%
  Volatility:    3.36 (MEDIUM)
  Bin Step:      80 (0.80% per bin)

  Active Bin:    -612
  Price:         0.00000762
  Score:         1.0

--------------------------------------------------------------
  SELECT RANGE
--------------------------------------------------------------

  Your Volatility: 3.36

  [1] x5 (tight)  -> 16.8% range | 24 bins below | min: -636
  [2] x10 (wide)  -> 33.6% range | 52 bins below | min: -664

  Suggested: x10 (medium)

  Type '1' or '2' to select
```

### Deploy Success
```
==============================================================
  DEPLOY SUCCESS
==============================================================

  Pool:      Deadwhale-SOL
  Amount:    0.1 SOL
  Strategy:  bid_ask (SOL sided)

  Volatility: 3.81 x10 = 38.1% range
  Total bins: 57 bins below active
  Min bin:   -678
  Max bin:   -621
  Active:    -621

  Position:  7tNb2eTb6kYd9KLG5A5M1oJNxPZGqJ3UqVGBJgDm9F5
  TX:        5BkkMSNv2z2vZ8GfNYfTYLZcYqLnTZQqLBhPZ7xBLq...

--------------------------------------------------------------
  TP/SL Active: TP +1.0% | SL -5.0%
  Check interval: 60s

--------------------------------------------------------------
  'positions' to view | 'screen' for new pools
```

### Position Closed
```
==============================================================
  CLOSE POSITION
==============================================================

  Pool:      Deadwhale-SOL
  PnL:       +$0.05
  Uncl.Fee:  $0.00

  TXs: 3
  2vZ7dLJdJKyVcL7vVT3UP9GD3QQXJHTCQTL2tTa2...

--------------------------------------------------------------
  Auto-swap: checking tokens...
  No tokens to swap

--------------------------------------------------------------
  'positions' to view remaining
```

### Wallet Balance
```
==============================================================
  WALLET BALANCE
==============================================================

  Address:  CjZZFtiB94rayYAewC25qKWS1wapQgd5Hx1nJ1nCqaqi
  SOL:      0.1437 SOL

  Tokens: (none)
```

## Features

- **Pool Screening** — filter by mcap, holders, volume, TVL, fee, organic
- **Guided Flow** — bot suggests best pool + range
- **Auto Mode** — auto deploy to 2 positions, monitor TP/SL, auto redeploy
- **TP/SL Monitor** — background monitoring, auto-close at +1% TP / -5% SL
- **Auto Swap** — after close, tokens auto-swap to SOL via Jupiter Lite
- **Position Tracking** — track PnL, fees, in/out of range

## Config

Edit `src/config.js`:

```js
SCREENING.minMcap      // min market cap (USD) — default: 150,000
SCREENING.minHolders   // min token holders — default: 500
SCREENING.minVolume    // volume per timeframe (USD) — default: 5,000
SCREENING.timeframe    // '5m' | '1h' | '4h' | '24h' — default: '1h'

DEPLOY.amountSol        // SOL per deploy — default: 0.1
DEPLOY.gasReserve      // SOL for gas — default: 0.05

TPSL.enabled           // true/false — default: true
TPSL.tpPercent        // Take profit % — default: 1.0
TPSL.slPercent        // Stop loss % — default: -5.0
TPSL.checkIntervalMs  // Check interval ms — default: 60000

LIMITS.maxActivePositions // Max positions — default: 2
```

## Security

- **NEVER** share your `.env` file
- **NEVER** commit secrets to git
- **ALWAYS** verify transaction details before signing

## Project Structure

```
simple-lp/
├── src/
│   ├── index.js             # CLI entry point
│   ├── lib.js               # Shared utilities
│   ├── config.js            # Config (SCREENING, DEPLOY, TPSL, LIMITS)
│   ├── screening.js         # Pool discovery
│   ├── deploy.js           # Deploy/close/track
│   ├── positions.js         # Position management
│   ├── swap.js             # Jupiter Lite swap
│   ├── wallet-utils.js     # Wallet utilities
│   ├── wallet-generator.js # Wallet gen/import
│   ├── monitor.js         # TP/SL background monitor
│   ├── auto-runner.js     # Auto mode runner
│   └── state.js           # State file helpers
├── .env                    # Secrets (gitignored)
├── .env.example           # Template
└── package.json
```
