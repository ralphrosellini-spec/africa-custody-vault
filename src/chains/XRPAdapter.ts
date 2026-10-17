// ============================================================
// src/chains/XRPAdapter.ts
// XRP Ledger chain adapter using xrpl.js
// ============================================================

import { Client, Wallet, type Payment } from 'xrpl';
import { ChainAdapter, TxConfirmationStatus } from './ChainAdapter.js';
import { TxParams, UnsignedTx, SignedTx } from '../kms/Signer.js';
import { REQUIRED_CONFIRMATIONS } from '../utils/constants.js';
import { logger } from '../utils/logger.js';

export class XRPAdapter implements ChainAdapter {
  readonly network = 'XRP';
  readonly coinType = 144;
  readonly nativeAsset = 'XRP';
  readonly requiredConfirmations: number;

  private readonly wsUrl: string;
  private client: Client | null = null;

  constructor(wsUrl: string) {
    this.requiredConfirmations = REQUIRED_CONFIRMATIONS['XRP'] ?? 1;
    this.wsUrl = wsUrl;
  }

  private async getClient(): Promise<Client> {
    if (!this.client || !this.client.isConnected()) {
      this.client = new Client(this.wsUrl);
      await this.client.connect();
    }
    return this.client;
  }

  async disconnect(): Promise<void> {
    if (this.client?.isConnected()) {
      await this.client.disconnect();
    }
  }

  async getBalance(address: string): Promise<bigint> {
    const client = await this.getClient();
    const accountInfo = await client.request({
      command: 'account_info',
      account: address,
      ledger_index: 'validated',
    });
    const balanceDrops = accountInfo.result.account_data.Balance;
    return BigInt(balanceDrops);
  }

  async getTokenBalance(_address: string, _tokenContract: string): Promise<bigint> {
    // XRP Issued Currencies (IOU) — not implemented in Phase 1
    return 0n;
  }

  async estimateFee(_params: TxParams): Promise<bigint> {
    const client = await this.getClient();
    const feeResult = await client.request({ command: 'fee' });
    const openLedgerFee = feeResult.result.drops.open_ledger_fee;
    return BigInt(openLedgerFee) * 2n; // 2x buffer
  }

  async buildTransaction(params: TxParams): Promise<UnsignedTx> {
    const client = await this.getClient();
    const fee = await this.estimateFee(params);

    const accountInfo = await client.request({
      command: 'account_info',
      account: params.fromAddress,
      ledger_index: 'current',
    });

    const sequence = accountInfo.result.account_data.Sequence;

    const tx: Payment = {
      TransactionType: 'Payment',
      Account: params.fromAddress,
      Destination: params.toAddress,
      Amount: params.amount.toString(),
      Fee: fee.toString(),
      Sequence: sequence,
      DestinationTag: params.memo ? parseInt(params.memo, 10) : undefined,
    };

    return { raw: tx, estimatedFee: fee };
  }

  async signTransaction(unsignedTx: UnsignedTx, privateKey: Buffer): Promise<SignedTx> {
    const wallet = Wallet.fromEntropy(new Uint8Array(privateKey.subarray(0, 16)));
    const { tx_blob, hash } = wallet.sign(unsignedTx.raw as Payment);
    return { raw: tx_blob, txHash: hash };
  }

  async broadcastTransaction(signedTx: SignedTx): Promise<string> {
    const client = await this.getClient();
    const result = await client.request({
      command: 'submit',
      tx_blob: signedTx.raw,
    });

    if (result.result.engine_result !== 'tesSUCCESS') {
      throw new Error(`XRP submit failed: ${result.result.engine_result_message}`);
    }

    return signedTx.txHash;
  }

  async getTransactionStatus(txHash: string): Promise<TxConfirmationStatus> {
    try {
      const client = await this.getClient();
      const result = await client.request({
        command: 'tx',
        transaction: txHash,
        binary: false,
      });

      if (!result.result.validated) {
        return { txHash, status: 'PENDING', confirmations: 0 };
      }

      const meta = result.result.meta;
      if (meta && typeof meta === 'object' && 'TransactionResult' in meta) {
        const txResult = (meta as { TransactionResult: string }).TransactionResult;
        if (txResult !== 'tesSUCCESS') {
          return { txHash, status: 'FAILED', confirmations: 0 };
        }
      }

      return { txHash, status: 'CONFIRMED', confirmations: 1 };
    } catch (err) {
      logger.warn('[XRPAdapter] Failed to fetch tx status', { txHash, error: String(err) });
      return { txHash, status: 'PENDING', confirmations: 0 };
    }
  }
}
