// ============================================================
// src/chains/BitcoinAdapter.ts
// UTXO-based chain adapter for BTC, LTC, DOGE
// ============================================================

import * as bitcoin from 'bitcoinjs-lib';
import { ECPairFactory } from 'ecpair';
import * as ecc from 'tiny-secp256k1';
import { ChainAdapter, TxConfirmationStatus } from './ChainAdapter.js';
import { TxParams, UnsignedTx, SignedTx } from '../kms/Signer.js';
import { REQUIRED_CONFIRMATIONS } from '../utils/constants.js';
import { logger } from '../utils/logger.js';

const ECPair = ECPairFactory(ecc);

interface UTXO {
  txid: string;
  vout: number;
  value: number; // in satoshis
  scriptPubKey: string;
}

export type UTXONetwork = 'BTC' | 'LTC' | 'DOGE';

const NETWORK_PARAMS: Record<UTXONetwork, bitcoin.Network> = {
  BTC: bitcoin.networks.bitcoin,
  LTC: {
    messagePrefix: '\x19Litecoin Signed Message:\n',
    bech32: 'ltc',
    bip32: { public: 0x019da462, private: 0x019d9cfe },
    pubKeyHash: 0x30,
    scriptHash: 0x32,
    wif: 0xb0,
  },
  DOGE: {
    messagePrefix: '\x19Dogecoin Signed Message:\n',
    bech32: 'doge',
    bip32: { public: 0x02facafd, private: 0x02fac398 },
    pubKeyHash: 0x1e,
    scriptHash: 0x16,
    wif: 0x9e,
  },
};

const COIN_TYPES: Record<UTXONetwork, number> = {
  BTC: 0,
  LTC: 2,
  DOGE: 3,
};

export class BitcoinAdapter implements ChainAdapter {
  readonly network: string;
  readonly coinType: number;
  readonly nativeAsset: string;
  readonly requiredConfirmations: number;
  private readonly btcNetwork: bitcoin.Network;
  private readonly rpcUrl: string;

  constructor(network: UTXONetwork, rpcUrl: string) {
    this.network = network;
    this.coinType = COIN_TYPES[network];
    this.nativeAsset = network;
    this.requiredConfirmations = REQUIRED_CONFIRMATIONS[network] ?? 6;
    this.btcNetwork = NETWORK_PARAMS[network];
    this.rpcUrl = rpcUrl;
  }

  private async fetchUTXOs(address: string): Promise<UTXO[]> {
    const response = await fetch(`${this.rpcUrl}/address/${address}/utxo`);
    if (!response.ok) throw new Error(`UTXO fetch failed: ${response.statusText}`);
    return response.json() as Promise<UTXO[]>;
  }

  private async fetchFeeRate(): Promise<number> {
    try {
      const response = await fetch(`${this.rpcUrl}/fee-estimates`);
      if (!response.ok) throw new Error('Fee estimate fetch failed');
      const data = await response.json() as Record<string, number>;
      return Math.ceil(data['6'] ?? 10); // sat/vbyte for 6-block target
    } catch {
      return 10; // fallback: 10 sat/vbyte
    }
  }

  async getBalance(address: string): Promise<bigint> {
    const utxos = await this.fetchUTXOs(address);
    const total = utxos.reduce((sum, u) => sum + u.value, 0);
    return BigInt(total);
  }

  async getTokenBalance(_address: string, _tokenContract: string): Promise<bigint> {
    // UTXO chains don't have token contracts in the traditional sense
    return 0n;
  }

  async estimateFee(params: TxParams): Promise<bigint> {
    const utxos = await this.fetchUTXOs(params.fromAddress);
    const feeRate = await this.fetchFeeRate();
    const inputCount = utxos.length;
    // Estimated tx size: 10 + 148*inputs + 34*outputs (P2PKH)
    const estimatedSize = 10 + 148 * inputCount + 34 * 2;
    return BigInt(estimatedSize * feeRate);
  }

  async buildTransaction(params: TxParams): Promise<UnsignedTx> {
    const utxos = await this.fetchUTXOs(params.fromAddress);
    const feeRate = await this.fetchFeeRate();
    const targetAmount = params.amount;

    if (utxos.length === 0) throw new Error('No UTXOs available for signing');

    // Greedy UTXO selection
    let totalInput = 0n;
    const selectedUTXOs: UTXO[] = [];
    for (const utxo of utxos.sort((a, b) => b.value - a.value)) {
      selectedUTXOs.push(utxo);
      totalInput += BigInt(utxo.value);
      const estimatedSize = 10 + 148 * selectedUTXOs.length + 34 * 2;
      const fee = BigInt(estimatedSize * feeRate);
      if (totalInput >= targetAmount + fee) break;
    }

    const estimatedSize = 10 + 148 * selectedUTXOs.length + 34 * 2;
    const fee = BigInt(estimatedSize * feeRate);
    const change = totalInput - targetAmount - fee;

    if (change < 0n) throw new Error('Insufficient balance including fees');

    const psbt = new bitcoin.Psbt({ network: this.btcNetwork });

    for (const utxo of selectedUTXOs) {
      psbt.addInput({
        hash: utxo.txid,
        index: utxo.vout,
        witnessUtxo: {
          script: Buffer.from(utxo.scriptPubKey, 'hex'),
          value: Number(utxo.value),
        },
      });
    }

    psbt.addOutput({ address: params.toAddress, value: Number(params.amount) });

    if (change > 546n) {
      // Dust threshold: 546 sat
      psbt.addOutput({ address: params.fromAddress, value: Number(change) });
    }

    return { raw: psbt, estimatedFee: fee };
  }

  async signTransaction(unsignedTx: UnsignedTx, privateKey: Buffer): Promise<SignedTx> {
    const psbt = unsignedTx.raw as bitcoin.Psbt;
    const keyPair = ECPair.fromPrivateKey(privateKey, { network: this.btcNetwork });

    for (let i = 0; i < psbt.inputCount; i++) {
      psbt.signInput(i, keyPair);
    }

    psbt.finalizeAllInputs();
    const rawHex = psbt.extractTransaction().toHex();
    const txHash = psbt.extractTransaction().getId();

    return { raw: rawHex, txHash };
  }

  async broadcastTransaction(signedTx: SignedTx): Promise<string> {
    const response = await fetch(`${this.rpcUrl}/tx`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: signedTx.raw,
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Broadcast failed: ${body}`);
    }

    return signedTx.txHash;
  }

  async getTransactionStatus(txHash: string): Promise<TxConfirmationStatus> {
    try {
      const response = await fetch(`${this.rpcUrl}/tx/${txHash}`);
      if (!response.ok) {
        return { txHash, status: 'PENDING', confirmations: 0 };
      }

      const tx = await response.json() as { confirmations?: number; status?: { confirmed?: boolean } };
      const confirmations = tx.confirmations ?? 0;

      if (!tx.status?.confirmed) {
        return { txHash, status: 'PENDING', confirmations: 0 };
      }

      return {
        txHash,
        status: confirmations >= this.requiredConfirmations ? 'CONFIRMED' : 'PENDING',
        confirmations,
      };
    } catch (err) {
      logger.warn('[BitcoinAdapter] Failed to fetch tx status', {
        txHash,
        error: err instanceof Error ? err.message : String(err),
      });
      return { txHash, status: 'PENDING', confirmations: 0 };
    }
  }
}
