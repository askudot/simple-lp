# Simple LP — Meteora DLMM Bot

Guided conversational CLI untuk screening dan deploy liquidity di **Meteora DLMM**.

## ⚡ Quick Start

```bash
npm install
cp .env.example .env
# Edit .env with your values
npm start
```

## 🔧 Setup

### Get RPC URL (Free)
1. Go to [helius.xyz](https://helius.xyz) — free tier available
2. Create account → Dashboard → Copy RPC URL
3. Paste in `.env`

### Wallet
```bash
npm run wallet:generate    # Generate new wallet
npm run wallet:import <key> # Import existing
```

## 📖 Workflow

### Manual Mode
```
screen          → screening pools
<no>           → pick pool
x5 / x10       → pick range → DEPLOY IMMEDIATELY

positions       → view active positions
close <no> --confirm → close + auto-swap
balance         → check wallet
```

### Auto Mode
```bash
npm start auto   # Full auto: screen → pick → deploy
```

## 🎯 Features

- **Pool Screening** — filter by mcap, holders, volume, TVL, fee, organic
- **Guided Flow** — bot suggests best pool + range
- **Deploy SOL Liquidity** — bid_ask strategy (SOL-sided)
- **TP/SL Monitor** — background monitoring, auto-close at +1% TP / -5% SL
- **Auto Swap** — after close, tokens ≥ $0.50 auto-swap to SOL
- **Position Tracking** — track PnL, fees, in/out of range
- **TX History** — permanent log of all transactions

## ⚙️ Config

Edit `src/config.js`:

```js
SCREENING.minMcap      // min market cap (USD)
SCREENING.minHolders   // min token holders
SCREENING.minVolume    // volume per timeframe (USD)
SCREENING.timeframe    // '5m' | '1h' | '4h' | '24h'

DEPLOY.amountSol        // SOL per deploy
TPSL.tpPercent        // Take profit % (default: 1.0)
TPSL.slPercent        // Stop loss % (default: -5.0)
```

## 🔒 Security

- **NEVER** share your `.env` file
- **NEVER** commit secrets to git
- **ALWAYS** verify transaction details before signing

## 📁 Structure

```
simple-lp/
├── src/
│   ├── index.js            # CLI entry
│   ├── lib.js              # Shared utilities
│   ├── config.js           # Config
│   ├── screening.js        # Pool discovery
│   ├── deploy.js          # Deploy/close
│   ├── positions.js       # Positions
│   ├── swap.js            # Jupiter swap
│   ├── wallet-utils.js    # Wallet utilities
│   ├── wallet-generator.js # Wallet gen/import
│   ├── monitor.js         # TP/SL monitor
│   └── state.js           # State helpers
├── .env                   # Secrets (gitignored)
├── .env.example           # Template
└── package.json
```

## 📦 Commands

| Command | Description |
|---------|-------------|
| `npm start` | Run bot |
| `npm start auto` | Auto full flow |
| `npm run monitor` | Background TP/SL |
| `npm run wallet:generate` | Generate wallet |
| `npm run dry` | Dry run mode |
