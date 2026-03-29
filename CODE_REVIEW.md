# Code Review: simple-lp

## ✅ Yang Sudah Bagus

| Aspek | Status |
|-------|--------|
| Modular structure | Bagus, each file 1 responsibility |
| Error handling | Ada retry logic di `sendWithRetry` |
| Pool caching | Ada TTL 5 min buat reduce API calls |
| DRY_RUN mode | Bisa test tanpa real tx |
| Config centralized | 1 config.js untuk semua settings |

---

## ⚠️ Issues & Suggestions

### 1. `lib.js` — volatilityLabel still exists but unused in display
- Function `volatilityLabel()` exists at line 47 but no longer used in UI
- Suggestion: Keep for debug only or remove

### 2. `deploy.js` — Pool cache bisa stale
- Cache 5 min mungkin terlalu lama buat volatile pools
- Suggestion: Turunin ke 1 min atau tambahin force refresh option

### 3. `screening.js` — No validation kalau API return empty
- Kalau API down atau 0 pools, user gatau kenapa
- Suggestion: Tambahin error message yang jelas

### 4. `auto-runner.js` — suggestPool still hardcoded vol 2-8 range
- Line 40-47: `sorted.filter(p => p.volatility >= 2 && p.volatility <= 8)`
- Ini prefer medium vol, tapi rule baru (vol < 9 → x10, vol >= 9 → x5) gak terpakai di pool selection
- Suggestion: Ubah jadi prefer vol < 9 untuk align dengan range rule

### 5. `positions.js` — PNL fetch bisa fail silently
- `fetchPnL()` return null kalo error, gak ada retry
- Suggestion: Tambahin retry 1-2x sebelum give up

### 6. `state.js` — No validation saat save/load
- Bisa crash kalau JSON corrupted
- Suggestion: Wrap in try-catch

### 7. `index.js` — Pool selection mismatch
- User pilih "#2" di screen → expect pool di posisi #2
- Actual: pools[1] dari array asli (bukan sorted)
- Display sorted by score, tapi selection pakai index array asli
- Result: User pilih #2, dapat pool #1 (karena TRASH=#1 di display tapi index 0)
- Status: **NEW - Not fixed yet**

---

## 🚀 Suggestions for Improvement

| Priority | Item | Impact |
|----------|------|--------|
| **High** | Sync `suggestPool()` di auto-runner sama rule baru | Penting buat auto mode |
| **High** | Tambahin `price check` sebelum deploy (optional) | Bikin entry lebih smart |
| **Medium** | Error handling better di screening | UX lebih baik |
| **Medium** | Logging improvement — write ke file | Bisa trace history |
| **Low** | Add `minRangeBins` filter | Hindari range terlalu sempit |

---

## 🔧 Quick Fixes Needed

### 1. Auto-runner suggestPool sync:
```js
// Current (line 40-47):
const mediumVol = sorted.filter(p => p.volatility >= 2 && p.volatility <= 8);

// Suggestion - align dengan rule baru (x10 for vol < 9):
const stableVol = sorted.filter(p => p.volatility < 9);  // exclude extreme vol only
```

### 2. Screen detail view — duplicate volatility info
```js
// Line 221: "Volatility: ?" duplicate dengan line 218
// Suggestion: Remove redundant line
```

---

## 📁 File Structure

```
src/
├── index.js           # CLI entry, menu handling
├── auto-runner.js     # Auto mode orchestrator (screen→deploy→monitor→redeploy)
├── config.js          # All settings (SCREENING, DEPLOY, TPSL, LIMITS)
├── screening.js       # Pool discovery via Meteora API
├── deploy.js          # Deploy, close, auto-swap logic
├── positions.js       # Position tracking & PnL fetch
├── monitor.js         # TP/SL background monitor
├── lib.js             # Shared utilities (formatters, calcBins, connection, wallet)
├── state.js           # State file helpers (positions-state.json)
├── swap.js            # Jupiter swap wrapper
├── wallet-utils.js    # Wallet balance & token queries
├── wallet-generator.js # Wallet generation/import
└── tx-history.json    # Transaction log
```

---

## 🔄 Auto Mode Flow

```
runAutoMode()
  │
  ├─→ screenPools()         [screening.js]
  │     └─→ API: pool-discovery-api.datapi.meteora.ag
  │
  ├─→ suggestPool()          [auto-runner.js]
  │     └─→ Pick: highest score + prefer vol 2-8 (needs update!)
  │
  ├─→ suggestRange()        [auto-runner.js]
  │     └─→ vol < 9 → x10, vol >= 9 → x5
  │
  ├─→ deployPool()          [deploy.js]
  │     └─→ Meteora DLMM SDK
  │
  ├─→ trackPosition()       [deploy.js]
  │     └─→ Save to positions-state.json
  │
  └─→ monitorLoop()         [monitor.js]
        └─→ Every 60s: check TP/SL → close → redeploy
```

---

## 📊 Screening Flow (Manual Mode)

```
index.js (cmdScreening)
  │
  ├─→ screenPools()         [screening.js]
  │
  ├─→ scorePools()          [index.js]
  │     └─→ score = (organic × feeTvlRatio × 0.01)
  │
  ├─→ suggestPool()         [index.js]
  │     └─→ Best score with vol 2-8 preference
  │
  └─→ Display table with:
        - Mkt Cap, Vol/Hour, TVL, Fee/TVL, Volat., Score
```

---

## ⚡ Current Config (Updated)

```js
SCREENING: {
  minMcap:            150,000,
  maxMcap:         10,000,000,
  minHolders:            100,
  minVolume:            5,000,
  minVolumeChange:        0,
  minTvl:                5,000,
  maxTvl:              300,000,
  minBinStep:              1,
  maxBinStep:           1,000,
  minFeeActiveTvlRatio:  0.05,
  minOrganic:             20,
  timeframe:           '1h',
}

TPSL: {
  enabled:          true,
  tpPercent:          3.0,   // +3% take profit
  slPercent:         -6.0,   // -6% stop loss
  checkIntervalMs:  60,000, // 60 seconds
}

LIMITS: {
  maxActivePositions:     2,
  autoRedeployOnClose:  true,
}
```

---

## 🎯 Range Rule (Updated)

```js
function suggestRange(p) {
  const v = p.volatility;
  // volatility >= 9 (high risk) → x5 (tighter, max ~60% range)
  // volatility < 9 (stable) → x10 (wide, max ~50% range)
  if (v >= 9) return { multiplier: 5, label: 'tight' };
  return { multiplier: 10, label: 'wide' };
}
```

Examples:
- vol 4.22 → 4.22 × 10 = 42% range
- vol 12 → 12 × 5 = 60% range

---

# Future Improvements (Advanced Features)

## ATH Filter + Entry Timing (2026-03-29)

### What We Discussed
```
1. Entry timing - want bot to know:
   - Price trend (uptrend/downtrend?)
   - Price vs ATH (masuk when 20%+ below ATH)
   - Support/resistance
   
2. Flexible range:
   - vol < 9 → x10 (already done)
   - vol > 9 → x5 (already done)
   - More flexible tiers possible
```

### What OKX Can Provide
| Data | Source | Status |
|------|--------|--------|
| Current price | OKX getPriceInfo | ✅ Can implement |
| ATH/ATL | OKX getPriceInfo | ✅ Can implement |
| Price vs ATH % | OKX getPriceInfo | ✅ Can implement |
| Uptrend/Downtrend | External API needed | ❌ Need chart API |
| Support/Resistance | External API needed | ❌ Need TA |

### Implementation Plan (When Ready)
1. OKX getPriceInfo → get current price & ATH
2. Calculate: `price_drop_from_ath = ((current - ath) / ath) * 100`
3. Filter: only deploy if drop >= X% (e.g. 20%)
4. Flexible range tiers (optional)

### Pending Entry System (2026-03-29)

User interested in this concept: "New pool above score - switch!"

#### Concept
```
Found #1 candidate: TRASH
  - Score: 90
  - Price: 5% below ATH (need 10%)
  - Status: ⏳ PENDING #1

Screen continues for other pools
  ↓
Found #2 candidate: PERK
  - Score: 92 (better than TRASH!)
  - Price: 12% below ATH ✅
  → DEPLOY PERK! (new #1 takes priority)
```

#### System Components Needed
| Component | Function |
|-----------|----------|
| Pending pool queue | Track pool waiting for ATH drop |
| Better pool detection | Switch if new pool beats pending |
| Timer/check | Every 60s check pending pool price |

#### Config Concept
```js
PENDING_ENTRY: {
  enabled: true,
  maxPending: 1,           // Max 1 pool waiting
  checkInterval: 60,       // Check every 60s
  minDropFromAth: 10,      // 10% below ATH
}
```

#### Logic Flow
```
Screen pools
  ↓
Pick best candidate
  ↓
If (price drop >= target):
  → DEPLOY!
If (price drop < target AND pending slot available):
  → ADD to pending queue
  → Continue screening other pools
  → Every 60s: check pending pool price
If (pending pool hits target):
  → DEPLOY pending pool
  → Remove from pending
If (new pool better than pending):
  → Replace pending with new pool
```

#### Summary Table
| Scenario | Bot Behavior |
|----------|--------------|
| Pool ready (10% below) | DEPLOY |
| Pool not ready, no pending | HOLD as pending #1 |
| New better pool appears | Switch to new pool |
| Pending hits target | DEPLOY pending |
| No pending, no pool ready | Continue screening |

#### Key Insight
> Bot doesn't just "wait on 1 pool" but:
> 1. Track best pool that isn't ready yet
> 2. Keep looking for better pools
> 3. If better found → switch
> 4. If not → eventually enter the first one
>
> Concept: "Limit order + continue hunting"

### Simple Config
```js
ATH_FILTER: {
  enabled: true,
  minDropFromAth: 20,  // Only enter if 20%+ below ATH
}
```

---

## Scoring System Analysis (2026-03-29)

### Current Score Formula
```js
score = organic × feeTvlRatio × 0.01
```

### Components
| Factor | Source | Description |
|--------|--------|-------------|
| organic | Meteora | Token legitimacy (0-100) |
| feeTvlRatio | Meteora | Pool profitability (%) |
| 0.01 | Constant | Normalizer |

### Example
```
TRASH: 85 × 0.8 × 0.01 = 0.68
umi:   75 × 1.2 × 0.01 = 0.90
PERK:  60 × 2.5 × 0.01 = 1.50
```

### What's Already Available (Meteora)
| Data | Available |
|------|-----------|
| organic | ✅ |
| feeTvlRatio | ✅ |
| volume24h | ✅ |
| market cap | ✅ |
| holders | ✅ |
| volatility | ✅ |

### What's NOT Available (Need OKX)
| Data | Source |
|------|--------|
| ATH price | OKX needed |
| Price vs ATH % | OKX needed |
| Dev behavior | OKX needed |
| Holder clusters | OKX needed |

### Future Score with ATH Bonus
```js
// Concept: price far from ATH = better entry
score = organic × feeTvlRatio × (1 + athBonus)

where athBonus = bonus based on % below ATH
Example:
- Price 30% below ATH → athBonus = +0.5 (better entry)
- Price 5% below ATH → athBonus = -0.2 (worse entry)
```

### Summary
| Source | Data Provided |
|--------|--------------|
| Meteora | organic, fee, volume, cap, holders, volatility |
| OKX | ATH, price vs ATH, dev behavior, holder clusters |

**Combine Meteora + OKX = complete data for smarter scoring**

---

## Peer Bot Features (from asku's friend)

### 🔍 OKX Integration (3 Layers)

**Layer 1: getAdvancedInfo**
- Risk level
- Bundle % (token dikendalikan 1 grup?)
- Sniper % (ada sniper bot?)
- Suspicious wallets
- Smart money tags (whale/dev sold)
- Dev sold tags

**Layer 2: getClusterList**
- Top 5 holder clusters
- Trend (hold or dump?)
- Avg hold days
- PnL % per cluster
- KOL presence

**Layer 3: getPriceInfo**
- Current price
- ATH/ATL
- 24h volume
- Price vs ATH %

### 🚫 Dev Blocklist
Commands:
- `block_deployer <address>`
- `unblock_deployer <address>`
- `list_blocked_deployers`
Works both in pool discovery and OKX enrichment.

### 📉 ATH Filter
Config: `athFilterPct`
- Example: -20 means only enter if price ≥20% below ATH
- Prevents buying at/near top
- Agent-settable via Telegram
- Hot-reload, no restart needed

### 📊 Comparison

| Feature | simple-lp (current) | Peer Bot |
|---------|---------------------|----------|
| Market cap, holders, volume | ✅ | ✅ |
| Fee/TVL, organic score | ✅ | ✅ |
| Volatility | ✅ | ✅ |
| Dev behavior (OKX) | ❌ | ✅ |
| Holder cluster analysis | ❌ | ✅ |
| ATH filter | ❌ | ✅ |
| Dev blocklist | ❌ | ✅ |

### 🎯 Priority for Implementation (if ever)
1. **Medium** - ATH filter (easy to add, valuable)
2. **Medium** - Dev blocklist (straightforward)
3. **High** - OKX integration (complex, API needed)

---

## 🧠 Learning from History

Shared on 2026-03-29. Concept of bot learning from past trades.

### Concept
Bot stores results of each trade and uses that data to improve future decisions.

### What to Track
```js
{
  "poolName": "TRASHCAN-SOL",
  "volatility": 4.0,
  "multiplier": 10,
  "entryPrice": 0.00001,
  "exitPrice": 0.000012,
  "pnlPercent": 2.8,
  "duration": "45m",
  "result": "TP", // TP / SL / manual
  "timestamp": "2026-03-28T10:00:00Z"
}
```

### Learning Analysis
- Pool X dengan vol 3-5 + x10 → sering kena TP
- Pool Y dengan feeTVL > 1% → profit lebih tinggi
- Entry waktu tertentu ( Bulls/bear market) lebih baik

### Implementation
```js
// learning.json - stores trade history
// analysis.js - processes history, updates scoring
// scoring.js - incorporates learned patterns into pool selection
```

### Benefits
- Bot "belajar" dari pengalaman
- Improve pool selection over time
- Filter out consistently losing pools

---

## 🌐 Hive Mind (Collective Intelligence)

Shared on 2026-03-29. Multiple bots sharing data.

### Concept
Multiple bot instances share trade results via shared database.

```
Bot A deploys TRASHCAN → profit +1% → logged to shared DB
Bot B screens → queries DB → "TRASHCAN success rate 90%" → auto prioritize
Bot C, D, E... benefit from Bot A's experience
```

### Implementation Options

| Method | Complexity | Pros |
|--------|------------|------|
| Shared JSON (Dropbox/Git) | Low | Simple, no server |
| Discord/Telegram webhook | Low | Notifications too |
| Firebase/Supabase DB | Medium | Real-time, structured |
| P2P (libp2p) | High | Decentralized |

### Simple Implementation
```js
// shared-db.json on Dropbox
{
  "pools": {
    "TRASHCAN-SOL": {
      "attempts": 15,
      "successes": 12,
      "avgPnl": 1.2,
      "lastUpdated": "2026-03-29"
    }
  }
}
```

### Benefits
- Bot belajar dari pengalaman bot lain
- Shared intelligence across all instances
- Better decision making over time

### Priority
- **Low-Medium** - Nice to have
- Requires external storage (Dropbox, Firebase, etc)
- More complex setup

---

## 🚫 Dev Blocklist (Deployer Addresses to Block)

Added on 2026-03-29. These deployer addresses should be blocked.

```
bwamJzztZsepfkteWRChggmXuiiCQvpLqPietdNfSXa
whamNNP9tHoxLg92yHvJPdYhghEoCg1qYTsh5a2oLbx
D9gQ6RhKEpnobPBUdWY5bPQt2p3zGk3iVz6ChpUi2ArA
AMRsSeU5JpqwQWJGNLMpZzRCZSFEwYQYbMnms3dD4311
5FqUo9aBjsp7QeeyN6Vi2ZmF2fjS4H5EU7wnAQwPy17z
HiSo5kykqDPs3EG14Fk9QY4B5RvkuEs8oJTiqPX3EDAn
8HeDT75s5g4CtCimH5B5nySqCiQhtWii2UnZhxBtFo38
HTM87R4mgjDdiF6Yfn8duK9vbDmZxiPCTRbGvm7eCAJY
dtrzJPj7yDdvm6eRqBAgxsK2sMJeD9HhBEBB3XMedXy
8i5U2uNBEuTc4zskYP14zbebDg2RSwrrG8REhEnJb97K
9wRuFPJZFviuHv9q4hsaxUUADDphX6oSjcMA3RuxTFRG
D6bTtoSgLknJ9KrgDFUtB5WpqomrNEjBJipVVRoFh2DC
Aqje5DsN4u2PHmQxGF9PKfpsDGwQRCBhWeLKHCFhSMXk
6nU2L7MQVUWjtdKHVpuZA9aind73nd3rXC4YFo8KQCy4
95ZCf3jKMHeFYvPXVZW3Ek6AEPDyjebosqnc7eNioVMo
8NJ7Ujpji8uMF2675mqaTSEm2DCbfJA7fiRKtiaqkaLN
A8Z1ejQGk45EJibBPJviWnM3UvwKSuYun53nSCkWKM52
Dwo2kj88YYhwcFJiybTjXezR9a6QjkMASz5xXD7kujXC
69aiAKU3uJMxMLRkUEGFNt6nQ43PiVimE4ZbErJ7VSM1
7moqFjvm2MwAiMtCZoqYoTAPzRBxxMRT2ddyHThQuWjr
FaBGrHWjcJ8vKnbgUtsdpZjvF7YAAajtQTWmmEHiKtQr
7GhWwhaMgbKiRWxF93Bud6HnHMci6NCLTJyTxG8zFH51
Xh2Y84WN8t3ZEKbwkDRT1ap5thJUAf3Ndv44wbbEXxX
75GMVrr2xfgAeybuNg1VMHqFE3GTFJLzEHo6xC4MwUzF
23QuARJvRDKYy7c9QM8NCVZJSBKy3EALUkzSvf5Gft3U
3z5FDHPFQTDo2GYpDZT7XCbSVY9q1ehr7T6Gzuu4UMyx
FM1YCKED2KaqB8Uat8aB1nsffR1vezr7s6FAEieXJgke
2b2N2p7xCS9ibDqxwYgXpDSTniJwwye7n93WYuzmr74s
6ujZxnphRxTqveaQtLAQHFoWz16xhLWZbTijcgZN4fRp
```

**Total: 28 addresses to block**

When implementing Dev Blocklist feature, add these addresses to the blocklist.
