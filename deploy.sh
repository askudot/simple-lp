#!/bin/bash
POOL_NUM=${1:-1}
MULT=${2:-5}

cd /root/.openclaw/workspace/simple-lp

node --input-type=module << EOF
import { screenPools } from './screening.js';
import { getActiveBin, deployPool, trackPosition } from './deploy.js';
import { DEPLOY } from './config.js';

const { pools } = await screenPools({ limit: 10 });
const scored = pools.map(p => ({...p, score: ((p.organic||0)*(p.feeTvlRatio||0)*0.01)})).sort((a,b)=>b.score-a.score);

const idx = $POOL_NUM - 1;
const mult = $MULT;
const p = scored[idx];

if (!p) { console.log('Invalid pool number'); process.exit(1); }

let bin;
try { bin = await getActiveBin(p.pool); } catch { bin = { binId: '?', price: '?' }; }

function calcBins(vol, mult, binStep) {
  const target = vol * mult;
  const r = binStep / 10000;
  const ratio = 1 - target / 100;
  const binsDown = -Math.floor(Math.log(ratio) / Math.log(1 + r));
  return { target, binsDown, total: binsDown + 1 };
}

const calc = calcBins(p.volatility, mult, p.binStep);
const fmtM = (n) => n>=1e6?'$'+((n/1e6)).toFixed(1)+'M':'$'+(((n||0)/1e3)).toFixed(0)+'k';

console.log('\n============================================');
console.log('  DEPLOY — ' + p.name.toUpperCase() + ' ×' + mult);
console.log('============================================\n');

console.log('Pool:      ' + p.name);
console.log('BinStep:   ' + p.binStep + ' (' + (p.binStep/100).toFixed(2) + '% per bin)');
console.log('Fee:       ' + p.feePct + '%');
console.log('TVL:       ' + fmtM(p.tvl));
console.log('Vol:       ' + fmtM(p.volume24h) + ' (' + (p.volumeChange>=0?'▲':'▼') + Math.abs(p.volumeChange).toFixed(1) + '%)');
console.log('Mkt Cap:   ' + fmtM(p.mcap));
console.log('Organic:   ' + p.organic + '/100');
console.log('Fee/TVL:   ' + p.feeTvlRatio?.toFixed(2) + '%');
console.log('Volatility: ' + p.volatility);
console.log('Active Bin: ' + (bin?.binId||'?'));
console.log('\nRange:     ' + calc.target.toFixed(0) + '% (' + calc.binsDown + ' bins, total ' + calc.total + ')');
console.log('\n⏳ Deploying...\n');

const result = await deployPool(p.pool, {
  poolName: p.name,
  volatility: p.volatility,
  multiplier: mult,
});

if (result.success) {
  console.log('✅ SUCCESS!');
  console.log('Position: ' + result.position);
  console.log('TX:       ' + result.tx);
  console.log('Range:    ' + result.targetPercent?.toFixed(0) + '% (' + result.binsDown + ' bins)');
  console.log('Bin:       ' + result.minBinId + ' → ' + result.maxBinId);
  console.log('\n📊 TX: https://solscan.io/tx/' + result.tx);
  trackPosition({...result, poolName: p.name, volatility: p.volatility, multiplier: mult, baseMint: p.baseMint});
} else {
  console.log('❌ FAILED: ' + result.error);
}
EOF
