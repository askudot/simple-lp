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
