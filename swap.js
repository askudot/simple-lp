import 'dotenv/config';
import { Connection, Keypair, PublicKey, sendAndConfirmTransaction, VersionedTransaction } from '@solana/web3.js';
import bs58 from 'bs58';
import { RPC_URL, WALLET_PRIVATE_KEY } from './config.js';

const JUPITER_QUOTE_API = 'https://quote-api.jup.ag/v6/quote';
const JUPITER_SWAP_API = 'https://quote-api.jup.ag/v6/swap';

function getConnection() {
  return new Connection(RPC_URL, 'confirmed');
}

function getWallet() {
  if (!WALLET_PRIVATE_KEY) throw new Error('WALLET_PRIVATE_KEY not set');
  return Keypair.fromSecretKey(bs58.decode(WALLET_PRIVATE_KEY));
}

// ─── Simple Jupiter Swap ───────────────────────────────────────
export async function swapToken({ inputMint, outputMint, amount }) {
  const wallet = getWallet();
  const connection = getConnection();

  try {
    // Step 1: Get quote
    const quoteRes = await fetch(
      `${JUPITER_QUOTE_API}?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount}&slippageBps=50`
    );
    if (!quoteRes.ok) throw new Error(`Quote API error: ${quoteRes.status}`);
    const quote = await quoteRes.json();

    // Step 2: Get swap tx
    const swapRes = await fetch(JUPITER_SWAP_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        quoteResponse: quote,
        userPublicKey: wallet.publicKey.toString(),
      }),
    });
    if (!swapRes.ok) throw new Error(`Swap API error: ${swapRes.status}`);
    const swapData = await swapRes.json();

    // Step 3: Send transaction
    const txBuf = Buffer.from(swapData.swapTransaction, 'base64');
    const tx = VersionedTransaction.deserialize(txBuf);
    tx.sign([wallet]);

    const txHash = await sendAndConfirmTransaction(connection, tx, { skipPreflight: true });

    return {
      success: true,
      tx: txHash,
      inputMint,
      outputMint,
      amountIn: amount,
      amountOut: quote.outAmount,
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}
