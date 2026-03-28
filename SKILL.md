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

## 📊 Output Format Templates

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

  Pool Address:  7jREzkE2gd4bzPYomSFTPhrjDFYxt832eeBExMuTd6f6
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

  Type '1' or '2' to select, 'back' to return
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

### Active Positions
```
==============================================================
  ACTIVE POSITIONS (1/2)
==============================================================

  #   Pool          PnL       Uncl.Fee  Value    Range  Status
  1  Deadwhale-SOL +$0.05    $0.00     $100.50  x10    IN

  'close <no> --confirm' to close | 'detail <no>' for details
  'screen' to find new pools
```

---

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
