// ============================================================
// src/kms/Deriver.ts
// BIP32/BIP44 HD wallet address derivation
// Private keys are NEVER stored or logged — only returned
// as Buffer for immediate use and then wiped by the caller.
// ============================================================

import * as bip39 from 'bip39';
import { BIP32Factory, BIP32Interface } from 'bip32';
import * as ecc from 'tiny-secp256k1';
import { Network as BitcoinNetwork, payments } from 'bitcoinjs-lib';
import { ethers } from 'ethers';
import { COIN_TYPE, VAULT_ACCOUNT_INDEX } from '../utils/constants.js';
import { logger } from '../utils/logger.js';

// Initialize BIP32 with the secp256k1 implementation
const bip32 = BIP32Factory(ecc);

export interface DerivedWallet {
  address: string;
  derivationPath: string;
}

/**
 * Build a BIP44 derivation path.
 * m / purpose' / coin_type' / account' / change / index
 */
function buildPath(coinType: number, accountIndex: number, addressIndex: number): string {
  return `m/44'/${coinType}'/${accountIndex}'/0/${addressIndex}`;
}

/**
 * Get the root HD node from master seed.
 * The seed is used in-memory only.
 */
function getRootNode(masterSeed: Buffer): BIP32Interface {
  return bip32.fromSeed(masterSeed);
}

/**
 * Derive a child node at a BIP44 path.
 */
function deriveNode(root: BIP32Interface, path: string): BIP32Interface {
  return root.derivePath(path);
}

/**
 * Derive address for a user deposit vault.
 * Account index = 0 (USER_DEPOSIT).
 */
export async function deriveUserDepositAddress(
  masterSeed: Buffer,
  network: string,
  userIndex: number,
): Promise<DerivedWallet> {
  const coinType = COIN_TYPE[network];
  if (coinType === undefined) throw new Error(`Unsupported network: ${network}`);

  const path = buildPath(coinType, VAULT_ACCOUNT_INDEX.USER_DEPOSIT, userIndex);
  return deriveAddressForPath(masterSeed, network, path);
}

/**
 * Derive omnibus vault address (account index = 1).
 */
export async function deriveOmnibusAddress(
  masterSeed: Buffer,
  network: string,
): Promise<DerivedWallet> {
  const coinType = COIN_TYPE[network];
  if (coinType === undefined) throw new Error(`Unsupported network: ${network}`);

  const path = buildPath(coinType, VAULT_ACCOUNT_INDEX.OMNIBUS, 0);
  return deriveAddressForPath(masterSeed, network, path);
}

/**
 * Derive revenue vault address (account index = 2).
 */
export async function deriveRevenueAddress(
  masterSeed: Buffer,
  network: string,
): Promise<DerivedWallet> {
  const coinType = COIN_TYPE[network];
  if (coinType === undefined) throw new Error(`Unsupported network: ${network}`);

  const path = buildPath(coinType, VAULT_ACCOUNT_INDEX.REVENUE, 0);
  return deriveAddressForPath(masterSeed, network, path);
}

/**
 * Derive gas station wallet address (account index = 3).
 */
export async function deriveGasStationAddress(
  masterSeed: Buffer,
  network: string,
): Promise<DerivedWallet> {
  const coinType = COIN_TYPE[network];
  if (coinType === undefined) throw new Error(`Unsupported network: ${network}`);

  const path = buildPath(coinType, VAULT_ACCOUNT_INDEX.GAS_STATION, 0);
  return deriveAddressForPath(masterSeed, network, path);
}

/**
 * Derive a private key at a path for signing.
 * ⚠️  CALLER MUST call privateKey.fill(0) immediately after use.
 */
export async function derivePrivateKey(
  masterSeed: Buffer,
  derivationPath: string,
  _network: string,
): Promise<Buffer> {
  const root = getRootNode(masterSeed);
  const child = deriveNode(root, derivationPath);

  if (!child.privateKey) {
    throw new Error('Could not derive private key — node has no private key');
  }

  // Return a COPY so the caller can wipe their copy independently
  const privateKey = Buffer.from(child.privateKey);

  // Wipe the child node's private key in memory
  child.privateKey.fill(0);

  logger.info('[KMS] Private key derived for signing', { path: derivationPath });

  return privateKey;
}

// ---- Address derivation per chain family ----

function deriveAddressForPath(
  masterSeed: Buffer,
  network: string,
  path: string,
): DerivedWallet {
  const root = getRootNode(masterSeed);
  const child = deriveNode(root, path);

  let address: string;

  if (['ETH', 'BSC', 'POLYGON'].includes(network)) {
    address = deriveEVMAddress(child);
  } else if (['BTC', 'LTC', 'DOGE'].includes(network)) {
    address = deriveUTXOAddress(child, network);
  } else if (network === 'TRX') {
    address = deriveTronAddress(child);
  } else if (network === 'SOL') {
    // Solana uses ed25519 — derive from first 32 bytes of seed
    address = deriveSolanaAddress(masterSeed, path);
  } else if (network === 'XRP') {
    address = deriveXRPAddress(child);
  } else {
    throw new Error(`Address derivation not implemented for network: ${network}`);
  }

  // Wipe private key from child node
  if (child.privateKey) child.privateKey.fill(0);

  return { address, derivationPath: path };
}

function deriveEVMAddress(node: BIP32Interface): string {
  if (!node.publicKey) throw new Error('No public key on node');
  // EVM address from uncompressed public key
  const wallet = new ethers.Wallet(
    '0x' + (node.privateKey?.toString('hex') ?? ''),
  );
  const address = wallet.address;
  // Wipe
  if (node.privateKey) node.privateKey.fill(0);
  return address;
}

function deriveUTXOAddress(node: BIP32Interface, network: string): string {
  if (!node.publicKey) throw new Error('No public key on node');

  let btcNetwork: BitcoinNetwork;
  if (network === 'BTC') {
    btcNetwork = {
      messagePrefix: '\x18Bitcoin Signed Message:\n',
      bech32: 'bc',
      bip32: { public: 0x0488b21e, private: 0x0488ade4 },
      pubKeyHash: 0x00,
      scriptHash: 0x05,
      wif: 0x80,
    };
  } else if (network === 'LTC') {
    btcNetwork = {
      messagePrefix: '\x19Litecoin Signed Message:\n',
      bech32: 'ltc',
      bip32: { public: 0x019da462, private: 0x019d9cfe },
      pubKeyHash: 0x30,
      scriptHash: 0x32,
      wif: 0xb0,
    };
  } else {
    // DOGE
    btcNetwork = {
      messagePrefix: '\x19Dogecoin Signed Message:\n',
      bech32: 'doge',
      bip32: { public: 0x02facafd, private: 0x02fac398 },
      pubKeyHash: 0x1e,
      scriptHash: 0x16,
      wif: 0x9e,
    };
  }

  const { address } = payments.p2wpkh({
    pubkey: node.publicKey,
    network: btcNetwork,
  });

  if (!address) throw new Error(`Could not derive ${network} address`);
  return address;
}

function deriveTronAddress(node: BIP32Interface): string {
  if (!node.privateKey) throw new Error('No private key on node');
  // Tron uses the same key derivation as ETH but with a different address format
  // Address = Base58Check(0x41 + keccak256(pubKey)[12:])
  const ethAddr = deriveEVMAddress(node);
  // Convert ETH address hex to Tron format (replace 0x prefix with 41)
  const hex = ethAddr.slice(2).toLowerCase();
  const tronHex = '41' + hex;
  // Base58Check encode
  const tronAddress = hexToBase58Check(tronHex);
  return tronAddress;
}

function hexToBase58Check(hex: string): string {
  // Simple base58check encoding for Tron addresses
  const { createHash } = require('crypto');
  const buf = Buffer.from(hex, 'hex');
  const hash1 = createHash('sha256').update(buf).digest();
  const hash2 = createHash('sha256').update(hash1).digest();
  const checksum = hash2.slice(0, 4);
  const full = Buffer.concat([buf, checksum]);

  const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let num = BigInt('0x' + full.toString('hex'));
  let result = '';
  while (num > 0n) {
    result = BASE58_ALPHABET[Number(num % 58n)] + result;
    num = num / 58n;
  }
  return result;
}

function deriveSolanaAddress(masterSeed: Buffer, path: string): string {
  // Solana derivation: use the path indices to derive a sub-seed
  // Simple approach: hash the master seed with the path
  const { createHmac } = require('crypto');
  const derived = createHmac('sha512', 'ed25519 seed')
    .update(Buffer.concat([masterSeed, Buffer.from(path)]))
    .digest()
    .slice(0, 32);

  // Import PublicKey from @solana/web3.js
  const { Keypair } = require('@solana/web3.js');
  const keypair = Keypair.fromSeed(derived);
  derived.fill(0);
  return keypair.publicKey.toString();
}

function deriveXRPAddress(node: BIP32Interface): string {
  if (!node.publicKey) throw new Error('No public key on node');
  // XRP address from secp256k1 public key
  const { createHash } = require('crypto');
  const sha256 = createHash('sha256').update(node.publicKey).digest();
  const ripemd160 = createHash('ripemd160').update(sha256).digest();
  const payload = Buffer.concat([Buffer.from([0x00]), ripemd160]);
  return hexToBase58Check(payload.toString('hex'));
}

// Re-export bip39 utilities for use in seed generation script
export { bip39 };
