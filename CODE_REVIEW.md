# Code Review: simple-lp

## Current Status ✅

| Item | Status |
|------|--------|
| Core functions | ✅ Working |
| Screening | ✅ Working |
| Auto mode | ✅ Working |
| Diversification (unique tokens) | ✅ Fixed |
| Pool selection | ✅ Fixed |
| All issues | ✅ Fixed |

---

## Config Summary

```js
SCREENING: {
  minMcap: 150k,       minHolders: 100,
  minVolume: 5k,      minFeeTVL: 0.05%,
  minOrganic: 20,      timeframe: '1h',
}

TPSL: { tpPercent: 3.0, slPercent: -6.0, checkIntervalMs: 60000 }
LIMITS: { maxActivePositions: 2, autoRedeployOnClose: true }
```

---

## Range Rule

```js
vol < 9  → x10 (wide)
vol >= 9 → x5 (tighter)
```

---

## Data Stored (Available for Future)

### From Discovery API (Screening)
| Field | Stored | Used |
|-------|--------|------|
| organic | ✅ | ✅ Score |
| feeTvlRatio | ✅ | ✅ Score |
| volatility | ✅ | ✅ Range rule |
| holders | ✅ | ❌ |
| mcap | ✅ | ❌ |
| tvl | ✅ | ❌ |
| binStep | ✅ | ❌ |
| feePct | ✅ | ❌ |
| volume24h | ✅ | ❌ |
| volumeChange | ✅ | ❌ |
| priceChange | ✅ | ❌ |
| holdersChange | ✅ | ❌ |
| priceTrend[] | ✅ | ❌ |
| activePct | ✅ | ❌ |

### From DLMM API (Detail) — NOT CALLED YET
| Field | Available |
|-------|-----------|
| apr, apy | ✅ |
| volume (30m/1h/2h/4h/12h/24h) | ✅ |
| fee_tvl_ratio (by timeframe) | ✅ |
| farm_apr, has_farm | ✅ |
| pool_config | ✅ |

---

## Future Improvements

### 1. ATH Filter (OKX)
- Price vs ATH %
- Only deploy if X% below ATH
- Pending entry system

### 2. OKX Integration
- getAdvancedInfo (risk, bundle, sniper %)
- getClusterList (holder clusters)
- getPriceInfo (ATH, volume)

### 3. Learning from History
- Track trade results
- Improve pool selection over time

### 4. Hive Mind
- Multiple bots share data
- Shared DB (Firebase/Dropbox)

### 5. Dev Blocklist
28 addresses saved — implement when ready.

---

## Dev Blocklist (28 Addresses)
```
bwamJzztZsepfkteWRChggmXuiiCQvpLqPietdNfSXa
whamNNP9tHoxLg92yHvJPdYhghEoCg1qYTsh5a2oLbx
D9gQ6RhKEpnobPBUdWY5bPQt2p3zGk3iVz6ChpUi2ArA
... (28 total)
```
