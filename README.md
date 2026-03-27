# Simple LP

Simple Meteora DLMM pool screening & deploy.

## Setup

```bash
npm install
cp .env.example .env
# edit .env with your WALLET_PRIVATE_KEY
```

## Usage

```bash
# Dry run (no real transactions)
DRY_RUN=true npm start

# Live mode
npm start
```

## What it does

1. Fetches pools from Meteora DLMM API
2. Applies screening filters (market cap, holders, TVL, volume, fee/TVL ratio, organic score)
3. Shows top 20 pools ranked by a simple score
4. Pick a pool → fetches active bin → deploys SOL liquidity

## Config

Edit `config.js` to adjust:
- Screening thresholds (min/max mcap, holders, TVL, bin step, fee ratio, organic score)
- Deploy settings (amount SOL, bins below/above, strategy)
