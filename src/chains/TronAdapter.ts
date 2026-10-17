// ============================================================
// src/chains/TronAdapter.ts
// Tron (TRX + TRC-20) chain adapter
// ============================================================

import { ChainAdapter, TxConfirmationStatus } from './ChainAdapter.js';
import { TxParams, UnsignedTx, SignedTx } from '../kms/Signer.js';
import { REQUIRED_CONFIRMATIONS } from '../utils/constants.js';
import { logger } from '../utils/logger.js';

// Dynamic import to handle tronweb ESM/CJS differences
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TronWeb = require('tronweb');

export class TronAdapter implements ChainAdapter {
  readonly network = 'TRX';
  readonly coinType = 195;
  readonly nativeAsset = 'TRX';
  readonly requiredConfirmations: number;

  private readonly tronWeb: typeof TronWeb;

  constructor(rpcUrl: string, apiKey?: string) {
    this.requiredConfirmations = REQUIRED_CONFIRMATIONS['TRX'] ?? 19;

    this.tronWeb = new TronWeb({
      fullHost: rpcUrl,
      headers: apiKey ? { 'TRON-PRO-API-KEY': apiKey } : {},
    });
  }

  async getBalance(address: string): Promise<bigint> {
    const balance = await this.tronWeb.trx.getBalance(address) as number;
    return BigInt(balance); // in SUN (1 TRX = 1,000,000 SUN)
  }

  async getTokenBalance(address: string, contractAddress: string): Promise<bigint> {
    const contract = await this.tronWeb.contract().at(contractAddress) as {
      balanceOf: (addr: string) => { call: () => Promise<{ _hex?: string } | bigint> };
    };
    const balance = await contract.balanceOf(address).call();
    if (typeof balance === 'bigint') return balance;
    if (balance && typeof balance === 'object' && '_hex' in balance) {
      return BigInt(balance._hex ?? '0');
    }
    return BigInt(String(balance));
  }

  async estimateFee(_params: TxParams): Promise<bigint> {
    // Tron uses bandwidth/energy model — estimate conservatively
    // Simple TRX transfer costs ~300 bandwidth (free if available)
    // TRC-20 transfer costs ~300,000 energy ~ 30 TRX
    return 1_000_000n; // 1 TRX in SUN as safety buffer
  }

  async buildTransaction(params: TxParams): Promise<UnsignedTx> {
    let tx: unknown;

    if (params.data) {
      // TRC-20 token transfer
      const contract = await this.tronWeb.contract().at(params.data) as {
        transfer: (to: string, amount: bigint) => { send: (opts: { from: string }) => Promise<unknown> };
      };
      tx = await contract.transfer(params.toAddress, params.amount).send({
        from: params.fromAddress,
      });
    } else {
      // Native TRX transfer
      tx = await this.tronWeb.transactionBuilder.sendTrx(
        params.toAddress,
        Number(params.amount),
        params.fromAddress,
      );
    }

    return { raw: tx, estimatedFee: await this.estimateFee(params) };
  }

  async signTransaction(unsignedTx: UnsignedTx, privateKey: Buffer): Promise<SignedTx> {
    const hexKey = privateKey.toString('hex');
    const signed = await this.tronWeb.trx.sign(unsignedTx.raw, hexKey) as { txID?: string };
    const txHash = signed.txID ?? '';
    return { raw: JSON.stringify(signed), txHash };
  }

  async broadcastTransaction(signedTx: SignedTx): Promise<string> {
    const tx = JSON.parse(signedTx.raw) as { txID?: string };
    const result = await this.tronWeb.trx.sendRawTransaction(tx) as { result?: boolean; txid?: string };

    if (!result.result) {
      throw new Error(`Tron broadcast failed: ${JSON.stringify(result)}`);
    }

    return result.txid ?? signedTx.txHash;
  }

  async getTransactionStatus(txHash: string): Promise<TxConfirmationStatus> {
    try {
      const info = await this.tronWeb.trx.getTransactionInfo(txHash) as {
        blockNumber?: number;
        receipt?: { result?: string };
      };

      if (!info.blockNumber) {
        return { txHash, status: 'PENDING', confirmations: 0 };
      }

      const currentBlock = await this.tronWeb.trx.getCurrentBlock() as {
        block_header?: { raw_data?: { number?: number } };
      };

      const currentNum = currentBlock.block_header?.raw_data?.number ?? 0;
      const confirmations = currentNum - info.blockNumber + 1;

      if (info.receipt?.result === 'REVERT' || info.receipt?.result === 'OUT_OF_ENERGY') {
        return { txHash, status: 'FAILED', confirmations, blockNumber: info.blockNumber };
      }

      return {
        txHash,
        status: confirmations >= this.requiredConfirmations ? 'CONFIRMED' : 'PENDING',
        confirmations,
        blockNumber: info.blockNumber,
      };
    } catch (err) {
      logger.warn('[TronAdapter] Failed to fetch tx status', { txHash, error: String(err) });
      return { txHash, status: 'PENDING', confirmations: 0 };
    }
  }
}
