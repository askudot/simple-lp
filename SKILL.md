# Simple LP — Meteora DLMM Bot

**Skill for OpenClaw** — Guided conversational CLI untuk screening dan deploy liquidity di Meteora DLMM.

## ⚡ Quick Start

```bash
cd /path/to/simple-lp
npm install
cp .env.example .env
# Edit .env — add WALLET_PRIVATE_KEY and RPC_URL
npm start
```

## 🔧 Setup

### 1. Clone & Install

```bash
git clone <repo_url>
cd simple-lp
npm install
```

### 2. Environment

```bash
cp .env.example .env
```

Edit `.env`:
```env
WALLET_PRIVATE_KEY=<your_base58_private_key>
RPC_URL=https://mainnet.helius-rpc.com/?api-key=YOUR_KEY
DRY_RUN=false
```

### 3. Wallet

```bash
# Generate new wallet
npm run wallet:generate

# Or import existing
npm run wallet:import <your_secret_base58>
```

### 4. RPC URL

Get free Helius key: https://helius.xyz

## 📖 Usage

### Manual Mode

```
npm start
→ screen          # screening pools
→ 1              # pick pool #1
→ x10            # deploy immediately (no confirm)

→ positions       # view active positions
→ close 1 --confirm  # close + auto-swap
→ balance        # check wallet
```

### Auto Mode

```bash
npm start auto   # Full auto: screen → best pool → deploy
```

## 🎯 Features

### Pool Screening
- Filter by: market cap, holders, volume, TVL, fee/TVL, organic score
- Auto-suggest best pool (score = organic × feeTVL)
- Shows: Mkt Cap, Vol/jam, TVL, Fee/TVL, BinStep/Fee, Score

### Deploy
- SOL-sided liquidity (bid_ask strategy)
- Volatility-based range (×5 tight / ×10 wide)
- Wide range support (>69 bins = 2-step deploy)
- TX history logged

### TP/SL Monitor
- Background monitoring every 60 seconds
- TP: +1% PnL → auto close
- SL: -5% PnL → auto close
- Run separately: `npm run monitor`

### Auto Swap
- After close: checks all tokens via Jupiter Lite API
- If token value ≥ $0.50 → auto swap to SOL
- If < $0.50 → leave in wallet

### Position Tracking
- Track PnL, unclaimed fees, in/out of range
- Persistent state across sessions

## 🎮 Commands

| Command | Alias | Description |
|---------|-------|-------------|
| `screen` | `s` | Screening pools |
| `auto` | — | Full auto: screen → pick → deploy |
| `<no>` | — | Pick pool (1-10) |
| `x5` / `x10` | `1` / `2` | Pick range → deploy immediately |
| `cancel` | `c` | Cancel & reset |
| `positions` | `pos` | View active positions |
| `detail <no>` | — | Position details |
| `close <no> --confirm` | — | Close position + auto-swap |
| `balance` | `bal` | Wallet balance |
| `menu` | `help` | Show all commands |

## ⚙️ Config

Edit `src/config.js`:

```js
// Screening Filters
SCREENING.minMcap            // min market cap (USD) — default: 150,000
SCREENING.minHolders         // min token holders — default: 500
SCREENING.minVolume          // volume per timeframe (USD) — default: 5,000
SCREENING.timeframe          // '5m' | '1h' | '4h' | '24h' — default: '1h'
SCREENING.minFeeActiveTvlRatio // fee/TVL minimum % — default: 0.1

// Deploy Settings
DEPLOY.amountSol             // SOL per deploy — default: 0.1
DEPLOY.gasReserve           // SOL for gas — default: 0.01

// TP/SL Monitor
TPSL.enabled                // true/false — default: true
TPSL.tpPercent             // Take profit % — default: 1.0
TPSL.slPercent             // Stop loss % — default: -5.0
TPSL.checkIntervalMs       // Check interval ms — default: 60000
```

## 🔒 Security

### ✅ What's Safe (GitHub)

- All source code in `src/`
- `.env.example` — template without real values
- `.gitignore` — blocks `.env`, state files, wallet files

### ❌ Never Commit

- `.env` — contains your **PRIVATE KEY** and **RPC URL**
- `wallet-keypair.json` — contains your **SECRET KEY**
- `conversation-state.json` — session state
- `positions-state.json` — your position data
- `tx-history.json` — your transaction history

### Sharing with Friends

**Option A: Public GitHub Repo**
```bash
git push to public repo
# Friends clone, cp .env.example .env, fill their own keys
```
Your keys are NOT in the repo because `.env` is gitignored.

**Option B: Private GitHub Repo**
```bash
# Create private repo, invite friends as collaborators
git push to private repo
# Friends clone, same process
```

**Friend's Setup:**
```bash
git clone <repo_url>
cd simple-lp
npm install
cp .env.example .env
# Edit .env with THEIR wallet + RPC
npm start
```

## 📁 Project Structure

```
simple-lp/
├── src/
│   ├── index.js             # CLI entry point
│   ├── lib.js               # Shared utilities
│   ├── config.js            # Config (SCREENING, DEPLOY, TPSL)
│   ├── screening.js         # Pool discovery
│   ├── deploy.js            # Deploy/close/track
│   ├── positions.js         # Position management
│   ├── swap.js              # Jupiter Lite swap
│   ├── wallet-utils.js     # Wallet utilities
│   ├── wallet-generator.js # Wallet gen/import
│   ├── monitor.js          # TP/SL background monitor
│   └── state.js            # State file helpers
├── .env                     # YOUR secrets (gitignored)
├── .env.example            # Template for friends
├── .gitignore              # Ignores .env + state files
├── README.md
├── SKILL.md
└── package.json
```

## 📦 NPM Scripts

```bash
npm start              # Run bot (manual mode)
npm start auto        # Full auto mode
npm start screen      # Direct screening
npm start positions    # View positions
npm start balance     # Check wallet
npm run wallet:generate # Generate wallet
npm run wallet:import   # Import wallet
npm run monitor       # Background TP/SL monitor
npm run monitor:once  # Single TP/SL check
npm run dry           # Dry run mode
```

## 🔄 Workflow Examples

### Manual Deploy
```bash
npm start
→ screen
→ 1 (pick pool)
→ x10 (deploy immediately)
```

### Auto Deploy + Monitor
```bash
# Terminal 1: Deploy
npm start auto

# Terminal 2: Monitor TP/SL (run in background)
npm run monitor
```

### Close Position
```bash
npm start
→ positions
→ close 1 --confirm
→ auto-swap triggers if token > $0.50
```

## 📝 Notes

- **DRY_RUN=true** for testing (no real transactions)
- **State files** are gitignored — each user has their own
- **Jupiter Lite API** used for swaps (no API key needed)
- **Meteora DLMM** for liquidity deployment
