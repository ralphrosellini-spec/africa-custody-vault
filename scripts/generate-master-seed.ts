// ============================================================
// scripts/generate-master-seed.ts
//
// ⚠️  DANGER — Run this script ONCE in a secure, ideally
//    air-gapped environment.
//
// It generates a BIP39 master seed and stores it in Azure
// Key Vault. The mnemonic is printed ONCE to stdout for
// offline backup. Store it in a fireproof safe.
//
// Usage:
//   NODE_ENV=development ts-node scripts/generate-master-seed.ts
//   NODE_ENV=production  ts-node scripts/generate-master-seed.ts --i-understand-the-risk
// ============================================================

import 'dotenv/config';
import * as bip39 from 'bip39';
import { SecretClient } from '@azure/keyvault-secrets';
import { DefaultAzureCredential } from '@azure/identity';

async function main(): Promise<void> {
  // Guard: require explicit flag in production
  if (process.env['NODE_ENV'] === 'production') {
    if (!process.argv.includes('--i-understand-the-risk')) {
      console.error(
        'ERROR: In production, pass --i-understand-the-risk flag.\n' +
        'This script generates the master seed and OVERWRITES any existing seed in Azure Key Vault.\n' +
        'This is a DESTRUCTIVE operation.',
      );
      process.exit(1);
    }
  }

  const vaultUrl = process.env['AZURE_KEY_VAULT_URL'];
  const secretName = process.env['MASTER_SEED_SECRET_NAME'] ?? 'custody-vault-master-seed';

  if (!vaultUrl) {
    console.error('ERROR: AZURE_KEY_VAULT_URL environment variable is required.');
    process.exit(1);
  }

  console.log('\n=========================================');
  console.log('  CUSTODY VAULT — MASTER SEED GENERATION');
  console.log('=========================================\n');

  // Check if seed already exists in AKV
  const credential = new DefaultAzureCredential();
  const client = new SecretClient(vaultUrl, credential);

  try {
    const existing = await client.getSecret(secretName);
    if (existing.value) {
      console.error(
        `ERROR: A master seed already exists in Azure Key Vault (secret: ${secretName}).\n` +
        'Refusing to overwrite. Delete it manually if you truly want to regenerate.\n' +
        'WARNING: Deleting the seed without migrating all wallets first = PERMANENT FUND LOSS.',
      );
      process.exit(1);
    }
  } catch (err) {
    if ((err as { code?: string }).code !== 'SecretNotFound') {
      throw err;
    }
    // Secret not found — proceed
  }

  // Generate 256-bit entropy = 24-word mnemonic
  console.log('Generating 256-bit entropy mnemonic (24 words)...');
  const mnemonic = bip39.generateMnemonic(256);

  // Convert mnemonic to seed
  const seedBuffer = await bip39.mnemonicToSeed(mnemonic);
  const seedBase64 = seedBuffer.toString('base64');

  // Store in Azure Key Vault
  console.log(`\nStoring encrypted seed in Azure Key Vault: ${vaultUrl}`);
  console.log(`Secret name: ${secretName}\n`);

  await client.setSecret(secretName, seedBase64, {
    contentType: 'application/octet-stream',
    tags: {
      purpose: 'custody-vault-master-seed',
      generatedAt: new Date().toISOString(),
      environment: process.env['NODE_ENV'] ?? 'unknown',
    },
  });

  console.log('✅ Master seed stored successfully in Azure Key Vault.\n');

  // Print mnemonic ONCE for offline backup
  console.log('=========================================');
  console.log('  ⚠️  WRITE DOWN THE FOLLOWING 24 WORDS');
  console.log('  Store in a fireproof safe. Never digital.');
  console.log('  This is shown ONCE and never again.');
  console.log('=========================================\n');
  console.log(mnemonic);
  console.log('\n=========================================');
  console.log('  Verify the mnemonic is written correctly.');
  console.log('  Then destroy any digital copies.');
  console.log('=========================================\n');

  // Wipe mnemonic from memory
  // (JS strings are immutable, but we can null the variable)
  process.exit(0);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
