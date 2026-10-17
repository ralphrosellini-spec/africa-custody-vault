// ============================================================
// src/chains/ChainAdapter.ts
// Interface that all chain adapters must implement.
// Core vault logic ONLY calls this interface — never
// chain-specific code directly.
// ============================================================

import { TxParams, UnsignedTx, SignedTx } from '../kms/Signer.js';

export interface TxConfirmationStatus {
  txHash: string;
  status: 'PENDING' | 'CONFIRMED' | 'FAILED';
  confirmations: number;
  blockNumber?: number;
}

export interface ChainAdapter {
  /** Network identifier e.g. 'ETH', 'BTC' */
  readonly network: string;

  /** BIP44 coin_type */
  readonly coinType: number;

  /** Native token symbol e.g. 'ETH', 'BTC' */
  readonly nativeAsset: string;

  /** Number of confirmations required before a tx is considered final */
  readonly requiredConfirmations: number;

  /** Get native balance of an address in smallest unit */
  getBalance(address: string): Promise<bigint>;

  /** Get ERC-20 / TRC-20 / SPL token balance */
  getTokenBalance(address: string, tokenContractOrMint: string): Promise<bigint>;

  /** Estimate network fee for a transaction */
  estimateFee(params: TxParams): Promise<bigint>;

  /** Build an unsigned transaction object */
  buildTransaction(params: TxParams): Promise<UnsignedTx>;

  /** Sign a built transaction using the provided private key */
  signTransaction(unsignedTx: UnsignedTx, privateKey: Buffer): Promise<SignedTx>;

  /** Broadcast a signed transaction to the network. Returns txHash. */
  broadcastTransaction(signedTx: SignedTx): Promise<string>;

  /** Get current confirmation status of a transaction */
  getTransactionStatus(txHash: string): Promise<TxConfirmationStatus>;
}

// Re-export TxParams etc. so callers can import from one place
export type { TxParams, UnsignedTx, SignedTx };
