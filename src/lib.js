import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';
import { RPC_URL, WALLET_PRIVATE_KEY } from './config.js';

// ─── Shared Connection ───────────────────────────────────────
let _connection = null;

export function getConnection() {
  if (!_connection) {
    _connection = new Connection(RPC_URL, 'confirmed');
  }
  return _connection;
}

// ─── Shared Wallet ───────────────────────────────────────────
let _wallet = null;

export function getWallet() {
  if (!_wallet) {
    if (!WALLET_PRIVATE_KEY) throw new Error('WALLET_PRIVATE_KEY not set in .env');
    _wallet = Keypair.fromSecretKey(bs58.decode(WALLET_PRIVATE_KEY));
  }
  return _wallet;
}

// ─── Reset wallet (e.g. when key changes) ───────────────────
export function resetWallet() {
  _wallet = null;
}

export function resetConnection() {
  _connection = null;
}

// ─── Formatters ─────────────────────────────────────────────
export function fmtUsd(n) {
  if (n == null) return '?';
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return '$' + (n / 1e3).toFixed(0) + 'k';
  return '$' + n.toFixed(0);
}

export function fmtSol(n) {
  if (n == null) return '?';
  return n.toFixed(4) + ' SOL';
}

export function volatilityLabel(v) {
  if (v == null) return '?';
  if (v < 2) return '🟢 LOW';
  if (v < 5) return '🟡 MEDIUM';
  if (v < 10) return '🟠 HIGH';
  return '🔴 EXTREME';
}

export function inRangeLabel(inRange) {
  if (inRange == null) return '';
  return inRange ? '✅ In Range' : '⚠️ Out of Range';
}

// ─── Bin Calculator (single source of truth) ───────────────
// Formula: binsDown = -floor(log(1 - targetPercent/100) / log(1 + binStep/10000))
// targetPercent = volatility × multiplier
export function calcBins(volatility, multiplier, binStep) {
  const targetPercent = volatility * multiplier;
  const r = binStep / 10000;
  const ratio = 1 - targetPercent / 100;
  const deltaBin = Math.log(ratio) / Math.log(1 + r);
  const binsDown = -Math.floor(deltaBin);
  const totalBins = binsDown + 1;
  return { targetPercent, binsDown, totalBins };
}

// ─── Tx Logger ──────────────────────────────────────────────
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TX_LOG_FILE = path.join(__dirname, 'tx-history.json');

export function logTx(tx) {
  const logs = fs.existsSync(TX_LOG_FILE)
    ? JSON.parse(fs.readFileSync(TX_LOG_FILE, 'utf8'))
    : [];
  logs.push({ ...tx, ts: new Date().toISOString() });
  // Keep last 100
  if (logs.length > 100) logs.splice(0, logs.length - 100);
  fs.writeFileSync(TX_LOG_FILE, JSON.stringify(logs, null, 2));
}

export function getTxLogs() {
  if (!fs.existsSync(TX_LOG_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(TX_LOG_FILE, 'utf8'));
  } catch {
    return [];
  }
}
