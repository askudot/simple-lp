import 'dotenv/config';
import { sendAndConfirmTransaction, VersionedTransaction } from '@solana/web3.js';
import { RPC_URL, WALLET_PRIVATE_KEY } from './config.js';
import { getConnection, getWallet } from './lib.js';

const JUPITER_LITE_QUOTE = 'https://lite-api.jup.ag/swap/v1/quote';
const JUPITER_LITE_SWAP = 'https://lite-api.jup.ag/swap/v1/swap';

// ─── Jupiter Lite Swap ─────────────────────────────────────────
export async function swap({ inputMint, outputMint, amount }) {
  const wallet = getWallet();
  const connection = getConnection();

  try {
    // Step 1: Get quote
    const quoteRes = await fetch(
      `${JUPITER_LITE_QUOTE}?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount}&slippageBps=50`
    );
    if (!quoteRes.ok) throw new Error(`Quote API error: ${quoteRes.status}`);
    const quote = await quoteRes.json();

    // Step 2: Get swap tx
    const swapRes = await fetch(JUPITER_LITE_SWAP, {
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

// ─── Get quote without executing ────────────────────────────────
export async function getQuote(inputMint, outputMint, amount) {
  try {
    const res = await fetch(
      `${JUPITER_LITE_QUOTE}?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount}&slippageBps=50`
    );
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}
