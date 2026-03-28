/**
 * Wallet Generator — Generate new Solana wallet
 * Usage: node src/wallet-generator.js
 */
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function generateWallet() {
  const kp = Keypair.generate();

  console.log('\n🔑 WALLET GENERATED\n');
  console.log('Public Key: ' + kp.publicKey.toString());
  console.log('Secret (base58): ' + bs58.encode(kp.secretKey));
  console.log('');

  // Ask to save to .env
  const envPath = path.join(__dirname, '..', '.env');
  const existingEnv = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';

  // Replace WALLET_PRIVATE_KEY if exists, else append
  if (existingEnv.includes('WALLET_PRIVATE_KEY=')) {
    console.log('⚠️  WALLET_PRIVATE_KEY already in .env — not overwriting.');
    console.log('   Copy secret key manually if you want to update.');
  } else {
    const newEnv = existingEnv.trimEnd() + '\n' + 'WALLET_PRIVATE_KEY=' + bs58.encode(kp.secretKey) + '\n';
    fs.writeFileSync(envPath, newEnv);
    console.log('✅ WALLET_PRIVATE_KEY saved to .env');
  }

  console.log('\n⚠️  BACKUP YOUR SECRET KEY!');
  console.log('   Secret: ' + bs58.encode(kp.secretKey));
  console.log('   Save it somewhere safe — DO NOT share!\n');

  return {
    publicKey: kp.publicKey.toString(),
    secret: bs58.encode(kp.secretKey),
  };
}

function importWallet(secretBase58) {
  try {
    const secretKey = bs58.decode(secretBase58);
    const kp = Keypair.fromSecretKey(secretKey);

    console.log('\n🔓 WALLET IMPORTED\n');
    console.log('Public Key: ' + kp.publicKey.toString());
    console.log('');

    const envPath = path.join(__dirname, '..', '.env');
    const existingEnv = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';

    if (existingEnv.includes('WALLET_PRIVATE_KEY=')) {
      // Replace existing key
      const updated = existingEnv.replace(/WALLET_PRIVATE_KEY=.+/, 'WALLET_PRIVATE_KEY=' + secretBase58);
      fs.writeFileSync(envPath, updated);
      console.log('✅ WALLET_PRIVATE_KEY updated in .env');
    } else {
      const newEnv = existingEnv.trimEnd() + '\n' + 'WALLET_PRIVATE_KEY=' + secretBase58 + '\n';
      fs.writeFileSync(envPath, newEnv);
      console.log('✅ WALLET_PRIVATE_KEY saved to .env');
    }

    return { publicKey: kp.publicKey.toString() };
  } catch (err) {
    console.log('❌ Invalid secret key: ' + err.message);
    return null;
  }
}

// CLI
const args = process.argv.slice(2);

if (args[0] === 'import' && args[1]) {
  importWallet(args[1]);
} else if (args[0] === 'generate' || !args.length) {
  generateWallet();
} else {
  console.log('Usage:');
  console.log('  node src/wallet-generator.js          # generate new wallet');
  console.log('  node src/wallet-generator.js generate # same as above');
  console.log('  node src/wallet-generator.js import <secret_base58>  # import existing');
}

export { generateWallet, importWallet };
