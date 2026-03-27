import 'dotenv/config';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';
import { RPC_URL, WALLET_PRIVATE_KEY } from './config.js';

function getConnection() {
  return new Connection(RPC_URL, 'confirmed');
}

function getWallet() {
  if (!WALLET_PRIVATE_KEY) throw new Error('WALLET_PRIVATE_KEY not set');
  return Keypair.fromSecretKey(bs58.decode(WALLET_PRIVATE_KEY));
}

// ─── Get Wallet Balances ───────────────────────────────────────
export async function getWalletBalances() {
  const wallet = getWallet();
  const connection = getConnection();

  const sol = await connection.getBalance(wallet.publicKey);
  const solBalance = sol / 1e9;

  // Get all token accounts
  const tokenAccounts = await connection.getParsedTokenAccountsByOwner(wallet.publicKey, {
    programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'),
  });

  const tokens = [];
  for (const acc of tokenAccounts.value) {
    const info = acc.account.data.parsed.info;
    if (parseFloat(info.tokenAmount.amount) > 0) {
      tokens.push({
        mint: info.mint,
        symbol: info.mint.slice(0, 6),
        balance: parseFloat(info.tokenAmount.amount) / Math.pow(10, info.tokenAmount.decimals),
        decimals: info.tokenAmount.decimals,
        usd: 0, // Would need price feed
      });
    }
  }

  return {
    sol: solBalance,
    wallet: wallet.publicKey.toString(),
    tokens,
  };
}
