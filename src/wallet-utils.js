import 'dotenv/config';
import { PublicKey } from '@solana/web3.js';
import { RPC_URL, WALLET_PRIVATE_KEY } from './config.js';
import { getWallet } from './lib.js';
import { Connection, PublicKey, clusterApiUrl } from '@solana/web3.js';

const JUPITER_PRICE_API = 'https://price-api.jup.ag/v6/price';
const SOL_MINT = 'So11111111111111111111111111111111111111112';

// ─── Get token prices from Jupiter ────────────────────────────
export async function getTokenPrices(mints) {
  if (!mints || mints.length === 0) return {};

  const ids = [...new Set(mints)].join(',');
  try {
    const res = await fetch(`${JUPITER_PRICE_API}?ids=${ids}`);
    if (!res.ok) return {};
    const data = await res.json();
    return data.data || {};
  } catch {
    return {};
  }
}

// ─── Get Wallet Balances ───────────────────────────────────────
export async function getWalletBalances() {
  const wallet = getWallet();
  // Always create fresh connection to avoid stale data
  const connection = new Connection(RPC_URL, { commitment: 'confirmed' });

  const sol = await connection.getBalance(wallet.publicKey);
  const solBalance = sol / 1e9;

  // Get all token accounts
  const tokenAccounts = await connection.getParsedTokenAccountsByOwner(wallet.publicKey, {
    programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'),
  });

  const tokens = [];
  const mints = [];

  for (const acc of tokenAccounts.value) {
    const info = acc.account.data.parsed.info;
    if (parseFloat(info.tokenAmount.amount) > 0) {
      const mint = info.mint;
      const balance = parseFloat(info.tokenAmount.amount) / Math.pow(10, info.tokenAmount.decimals);
      tokens.push({
        mint,
        symbol: mint.slice(0, 6),
        balance,
        decimals: info.tokenAmount.decimals,
        usd: 0,
      });
      if (mint !== SOL_MINT) {
        mints.push(mint);
      }
    }
  }

  // Fetch prices
  const prices = await getTokenPrices(mints);

  // Calculate USD values
  for (const token of tokens) {
    if (token.mint === SOL_MINT) {
      token.price = 1;
      token.usd = token.balance;
    } else {
      const priceData = prices[token.mint];
      if (priceData) {
        token.price = priceData.price || 0;
        token.usd = token.balance * token.price;
        token.symbol = priceData.symbol || token.symbol;
      }
    }
  }

  return {
    sol: solBalance,
    wallet: wallet.publicKey.toString(),
    tokens,
  };
}
