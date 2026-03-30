import { SCREENING } from './config.js';

const POOL_API = 'https://pool-discovery-api.datapi.meteora.ag';

/**
 * Fetch + filter pools from Meteora DLMM API.
 * Returns pools matching all screening criteria.
 */
export async function screenPools({ limit = 20 } = {}) {
  const s = SCREENING;

  const filters = [
    'base_token_has_critical_warnings=false',
    'quote_token_has_critical_warnings=false',
    'base_token_has_high_single_ownership=false',
    'pool_type=dlmm',
    `base_token_market_cap>=${s.minMcap}`,
    `base_token_market_cap<=${s.maxMcap}`,
    `base_token_holders>=${s.minHolders}`,
    `volume>=${s.minVolume}`,
    `tvl>=${s.minTvl}`,
    `tvl<=${s.maxTvl}`,
    `dlmm_bin_step>=${s.minBinStep}`,
    `dlmm_bin_step<=${s.maxBinStep}`,
    `fee_active_tvl_ratio>=${s.minFeeActiveTvlRatio}`,
    `base_token_organic_score>=${s.minOrganic}`,
    'quote_token_organic_score>=60',
  ];

  if (s.minVolumeChange > 0) {
    filters.push(`volume_change_pct>=${s.minVolumeChange}`);
  }

  const queryFilters = filters.join('&&');

  const url = `${POOL_API}/pools?page_size=${limit}&filter_by=${encodeURIComponent(queryFilters)}&timeframe=${s.timeframe}`;

  console.log('🔍 Fetching pools...');
  const res = await fetch(url);

  if (!res.ok) throw new Error(`API error: ${res.status}`);
  const data = await res.json();

  const pools = (data.data || []).map(condensePool);
  console.log(`   Found ${pools.length} pools matching filters`);

  // Show helpful message when 0 pools found
  if (pools.length === 0 && data.total === 0) {
    console.log('');
    console.log('   ⚠️  No pools found matching your filters.');
    console.log('   Your current filters:');
    console.log(`     - minMcap:      $${(s.minMcap / 1000).toFixed(0)}k`);
    console.log(`     - minHolders:   ${s.minHolders}`);
    console.log(`     - minVolume:    $${(s.minVolume / 1000).toFixed(0)}k/${s.timeframe}`);
    console.log(`     - minFeeTVL:    ${s.minFeeActiveTvlRatio}%`);
    console.log(`     - minOrganic:   ${s.minOrganic}`);
    console.log('');
    console.log('   💡 Try: Lower minOrganic or minFeeTVL to see more pools');
    console.log('');
  }

  return { total: data.total, pools };
}

/**
 * Get raw pool details by address.
 */
export async function getPoolDetail(poolAddress) {
  const url = `${POOL_API}/pools?page_size=1&filter_by=${encodeURIComponent(`pool_address=${poolAddress}`)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Pool detail API error: ${res.status}`);
  const data = await res.json();
  return (data.data || [])[0] || null;
}

function condensePool(p) {
  return {
    pool:      p.pool_address,
    name:      p.name,
    baseSymbol: p.token_x?.symbol,
    baseMint:  p.token_x?.address,
    quoteSymbol: p.token_y?.symbol,
    binStep:   p.dlmm_params?.bin_step || null,
    feePct:    p.fee_pct,
    tvl:       Math.round(p.active_tvl || 0),
    volume24h: Math.round(p.volume || 0),
    feeTvlRatio: fix(p.fee_active_tvl_ratio, 4) ?? fix(p.active_tvl > 0 ? (p.fee / p.active_tvl) * 100 : 0, 4),
    volatility: fix(p.volatility, 2),
    holders:   p.base_token_holders,
    mcap:      Math.round(p.token_x?.market_cap || 0),
    organic:   Math.round(p.token_x?.organic_score || 0),
    activePct: fix(p.active_positions_pct, 1),
    price:     p.pool_price,
    priceChange: fix(p.pool_price_change_pct, 1),
    volumeChange: fix(p.volume_change_pct, 1),
    holdersChange: fix(p.base_token_holders_change_pct, 1),
    priceTrend: p.price_trend || null,
  };
}

function fix(n, d) {
  return n != null ? Number(n.toFixed(d)) : null;
}
