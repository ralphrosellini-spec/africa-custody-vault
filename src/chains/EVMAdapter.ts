// ============================================================
// src/chains/EVMAdapter.ts
// EVM-compatible chain adapter (ETH, BSC, Polygon).
// One adapter class, parameterised by chainId + RPC URL.
// ============================================================

import { ethers } from 'ethers';
import { ChainAdapter, TxConfirmationStatus } from './ChainAdapter.js';
import { TxParams, UnsignedTx, SignedTx } from '../kms/Signer.js';
import { logger } from '../utils/logger.js';
import { EVM_CHAIN_IDS, REQUIRED_CONFIRMATIONS } from '../utils/constants.js';

const ERC20_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'function decimals() view returns (uint8)',
];

export interface EVMAdapterConfig {
  network: string;
  rpcUrl: string;
  fallbackRpcUrl?: string;
}

export class EVMAdapter implements ChainAdapter {
  readonly network: string;
  readonly coinType: number;
  readonly nativeAsset: string;
  readonly requiredConfirmations: number;

  private provider: ethers.JsonRpcProvider;
  private fallbackProvider: ethers.JsonRpcProvider | null = null;
  readonly chainId: number;

  constructor(config: EVMAdapterConfig) {
    this.network = config.network;
    this.chainId = EVM_CHAIN_IDS[config.network] ?? 1;
    this.requiredConfirmations = REQUIRED_CONFIRMATIONS[config.network] ?? 12;

    // Native asset per network
    const nativeAssets: Record<string, string> = {
      ETH: 'ETH',
      BSC: 'BNB',
      POLYGON: 'POL',
    };
    this.nativeAsset = nativeAssets[config.network] ?? 'ETH';
    this.coinType = 60; // All EVM chains use coin_type 60

    const staticNet = ethers.Network.from(this.chainId);
    this.provider = new ethers.JsonRpcProvider(config.rpcUrl, staticNet, { staticNetwork: staticNet });

    if (config.fallbackRpcUrl) {
      this.fallbackProvider = new ethers.JsonRpcProvider(
        config.fallbackRpcUrl,
        staticNet,
        { staticNetwork: staticNet },
      );
    }
  }

  private async callWithFallback<T>(fn: (p: ethers.JsonRpcProvider) => Promise<T>): Promise<T> {
    try {
      return await fn(this.provider);
    } catch (err) {
      if (this.fallbackProvider) {
        logger.warn('[EVMAdapter] Primary RPC failed, trying fallback', {
          network: this.network,
          error: err instanceof Error ? err.message : String(err),
        });
        return await fn(this.fallbackProvider);
      }
      throw err;
    }
  }

  async getBalance(address: string): Promise<bigint> {
    const balance = await this.callWithFallback((p) => p.getBalance(address));
    return balance;
  }

  async getTokenBalance(address: string, tokenContract: string): Promise<bigint> {
    const contract = new ethers.Contract(tokenContract, ERC20_ABI, this.provider);
    const balance = await (contract['balanceOf'] as (addr: string) => Promise<bigint>)(address);
    return balance;
  }

  async estimateFee(params: TxParams): Promise<bigint> {
    const feeData = await this.callWithFallback((p) => p.getFeeData());
    const gasPrice = feeData.gasPrice ?? ethers.parseUnits('20', 'gwei');

    const txRequest: ethers.TransactionRequest = {
      from: params.fromAddress,
      to: params.toAddress,
      value: params.data ? 0n : params.amount,
      data: params.data ?? '0x',
    };

    const gasLimit = await this.callWithFallback((p) => p.estimateGas(txRequest));
    return gasLimit * gasPrice;
  }

  async buildTransaction(params: TxParams): Promise<UnsignedTx> {
    const [feeData, nonce] = await Promise.all([
      this.callWithFallback((p) => p.getFeeData()),
      this.callWithFallback((p) =>
        p.getTransactionCount(params.fromAddress, 'pending'),
      ),
    ]);

    const gasPrice = feeData.gasPrice ?? ethers.parseUnits('20', 'gwei');

    const tx: ethers.TransactionRequest = {
      chainId: this.chainId,
      from: params.fromAddress,
      to: params.toAddress,
      value: params.data ? 0n : params.amount,
      data: params.data ?? '0x',
      gasLimit: params.gasLimit ?? 21000n,
      gasPrice: params.gasPrice ?? gasPrice,
      nonce: params.nonce ?? nonce,
    };

    const gasLimitBigInt = BigInt((params.gasLimit ?? 21000n).toString());
    const gasPriceBigInt = BigInt((params.gasPrice ?? gasPrice).toString());
    const estimatedFee = gasLimitBigInt * gasPriceBigInt;

    return { raw: tx, estimatedFee };
  }

  async signTransaction(unsignedTx: UnsignedTx, privateKey: Buffer): Promise<SignedTx> {
    const wallet = new ethers.Wallet('0x' + privateKey.toString('hex'));
    const signed = await wallet.signTransaction(unsignedTx.raw as ethers.TransactionRequest);
    const txHash = ethers.keccak256(signed);
    return { raw: signed, txHash };
  }

  async broadcastTransaction(signedTx: SignedTx): Promise<string> {
    const response = await this.callWithFallback((p) =>
      p.broadcastTransaction(signedTx.raw),
    );
    return response.hash;
  }

  async getTransactionStatus(txHash: string): Promise<TxConfirmationStatus> {
    const [receipt, block] = await Promise.all([
      this.callWithFallback((p) => p.getTransactionReceipt(txHash)),
      this.callWithFallback((p) => p.getBlockNumber()),
    ]);

    if (!receipt) {
      return { txHash, status: 'PENDING', confirmations: 0 };
    }

    if (receipt.status === 0) {
      return { txHash, status: 'FAILED', confirmations: 0, blockNumber: receipt.blockNumber };
    }

    const confirmations = block - receipt.blockNumber + 1;
    const status = confirmations >= this.requiredConfirmations ? 'CONFIRMED' : 'PENDING';

    return {
      txHash,
      status,
      confirmations,
      blockNumber: receipt.blockNumber,
    };
  }
}
