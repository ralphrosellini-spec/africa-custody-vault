// ============================================================
// src/chains/SolanaAdapter.ts
// Solana chain adapter
// ============================================================

import {
  Connection,
  PublicKey,
  Transaction,
  SystemProgram,
  Keypair,
} from '@solana/web3.js';
import { ChainAdapter, TxConfirmationStatus } from './ChainAdapter.js';
import { TxParams, UnsignedTx, SignedTx } from '../kms/Signer.js';
import { REQUIRED_CONFIRMATIONS } from '../utils/constants.js';
import { logger } from '../utils/logger.js';

export class SolanaAdapter implements ChainAdapter {
  readonly network = 'SOL';
  readonly coinType = 501;
  readonly nativeAsset = 'SOL';
  readonly requiredConfirmations: number;

  private readonly connection: Connection;

  constructor(rpcUrl: string) {
    this.requiredConfirmations = REQUIRED_CONFIRMATIONS['SOL'] ?? 32;
    this.connection = new Connection(rpcUrl, 'finalized');
  }

  async getBalance(address: string): Promise<bigint> {
    const balance = await this.connection.getBalance(new PublicKey(address));
    return BigInt(balance); // in lamports
  }

  async getTokenBalance(address: string, mint: string): Promise<bigint> {
    const tokenAccounts = await this.connection.getTokenAccountsByOwner(
      new PublicKey(address),
      { mint: new PublicKey(mint) },
    );

    if (tokenAccounts.value.length === 0) return 0n;

    const accountInfo = await this.connection.getTokenAccountBalance(
      tokenAccounts.value[0]!.pubkey,
    );

    return BigInt(accountInfo.value.amount);
  }

  async estimateFee(_params: TxParams): Promise<bigint> {
    try {
      const res = await this.connection.getRecentBlockhashAndContext();
      const feeCalc = res.value.feeCalculator;
      return BigInt(feeCalc?.lamportsPerSignature ?? 5000);
    } catch {
      return 5000n;
    }
  }

  async buildTransaction(params: TxParams): Promise<UnsignedTx> {
    const { blockhash } = await this.connection.getLatestBlockhash('finalized');

    const tx = new Transaction({
      recentBlockhash: blockhash,
      feePayer: new PublicKey(params.fromAddress),
    });

    tx.add(
      SystemProgram.transfer({
        fromPubkey: new PublicKey(params.fromAddress),
        toPubkey: new PublicKey(params.toAddress),
        lamports: params.amount,
      }),
    );

    const fee = await this.estimateFee(params);
    return { raw: tx, estimatedFee: fee };
  }

  async signTransaction(unsignedTx: UnsignedTx, privateKey: Buffer): Promise<SignedTx> {
    const keypair = Keypair.fromSecretKey(privateKey);
    const tx = unsignedTx.raw as Transaction;
    tx.sign(keypair);

    const serialized = tx.serialize();
    const txHash = Buffer.from(tx.signature ?? []).toString('base64');

    return { raw: Buffer.from(serialized).toString('base64'), txHash };
  }

  async broadcastTransaction(signedTx: SignedTx): Promise<string> {
    const rawBuf = Buffer.from(signedTx.raw, 'base64');
    const signature = await this.connection.sendRawTransaction(rawBuf, {
      skipPreflight: false,
      preflightCommitment: 'finalized',
    });
    return signature;
  }

  async getTransactionStatus(txHash: string): Promise<TxConfirmationStatus> {
    try {
      const statusResult = await this.connection.getSignatureStatuses([txHash]);
      const status = statusResult.value[0];

      if (!status) {
        return { txHash, status: 'PENDING', confirmations: 0 };
      }

      if (status.err) {
        return { txHash, status: 'FAILED', confirmations: 0 };
      }

      if (status.confirmationStatus === 'finalized') {
        return {
          txHash,
          status: 'CONFIRMED',
          confirmations: this.requiredConfirmations,
        };
      }

      const confirmations = status.confirmations ?? 0;
      return { txHash, status: 'PENDING', confirmations };
    } catch (err) {
      logger.warn('[SolanaAdapter] Failed to fetch tx status', { txHash, error: String(err) });
      return { txHash, status: 'PENDING', confirmations: 0 };
    }
  }
}
