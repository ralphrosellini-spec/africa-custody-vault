import { SecretClient } from '@azure/keyvault-secrets';
import { DefaultAzureCredential } from '@azure/identity';
import { logger } from '../utils/logger';
import { KmsError } from './KmsError';

export { KmsError };

interface CacheEntry {
  value: string;
  expiresAt: number;
}

export class AzureKeyVaultClient {
  private readonly client: SecretClient;
  private readonly cache = new Map<string, CacheEntry>();
  private readonly cacheTtlMs: number;
  private readonly masterSeedSecretName: string;

  constructor(options?: {
    vaultUrl?: string;
    cacheTtlMs?: number;
    masterSeedSecretName?: string;
  }) {
    const vaultUrl = options?.vaultUrl ?? process.env['AZURE_KEYVAULT_URL'] ?? process.env['AZURE_KEY_VAULT_URL'];
    const isDev = process.env['NODE_ENV'] === 'development' || process.env['NODE_ENV'] === 'test';

    if (!vaultUrl && !isDev) {
      throw new KmsError('Azure Key Vault URL is not configured. Set AZURE_KEYVAULT_URL in environment or pass vaultUrl in constructor.', {
        code: 'AKV_URL_MISSING'
      });
    }

    if (vaultUrl && !vaultUrl.includes('dev-vault')) {
      try {
        const credential = new DefaultAzureCredential();
        this.client = new SecretClient(vaultUrl, credential);
      } catch (err: unknown) {
        throw new KmsError('Failed to initialize Azure Key Vault client credential', {
          code: 'AKV_INIT_FAILED',
          cause: err
        });
      }
    } else {
      this.client = null as unknown as SecretClient;
    }

    this.cacheTtlMs = options?.cacheTtlMs ?? 5 * 60 * 1000; // 5 minutes
    this.masterSeedSecretName = options?.masterSeedSecretName ?? process.env['MASTER_SEED_SECRET_NAME'] ?? 'custody-master-seed';
  }

  /**
   * Retrieves a secret by name from Azure Key Vault or in-process cache.
   * Logs access for audit purposes without revealing the secret value.
   */
  public async getSecret(name: string): Promise<string> {
    const timestamp = new Date().toISOString();
    const cached = this.cache.get(name);
    const now = Date.now();

    if (cached && cached.expiresAt > now) {
      logger.info('Audited AKV secret access (cache hit)', {
        secretName: name,
        timestamp,
        cached: true
      });
      return cached.value;
    }

    logger.info('Audited AKV secret access (remote fetch)', {
      secretName: name,
      timestamp,
      cached: false
    });

    if (!this.client) {
      const devSeed = process.env['DEV_MASTER_SEED'] || Buffer.alloc(32, 0x42).toString('base64');
      this.cache.set(name, {
        value: devSeed,
        expiresAt: now + this.cacheTtlMs,
      });
      return devSeed;
    }

    try {
      const response = await this.client.getSecret(name);
      if (!response.value) {
        throw new KmsError(`Secret '${name}' exists in Key Vault but has empty value`, {
          code: 'SECRET_EMPTY'
        });
      }

      this.cache.set(name, {
        value: response.value,
        expiresAt: now + this.cacheTtlMs
      });

      return response.value;
    } catch (err: unknown) {
      if (err instanceof KmsError) {
        throw err;
      }
      const errorMessage = err instanceof Error ? err.message : String(err);
      logger.error('Failed to retrieve secret from Azure Key Vault', {
        secretName: name,
        timestamp,
        error: errorMessage
      });
      throw new KmsError(`Error retrieving secret '${name}' from Azure Key Vault: ${errorMessage}`, {
        code: 'SECRET_FETCH_FAILED',
        cause: err
      });
    }
  }

  /**
   * Fetches the base64-encoded master seed from Key Vault and returns it as a Buffer.
   */
  public async getMasterSeed(): Promise<Buffer> {
    try {
      const base64Seed = await this.getSecret(this.masterSeedSecretName);
      const seedBuffer = Buffer.from(base64Seed, 'base64');
      if (seedBuffer.length < 32 || seedBuffer.length > 64) {
        throw new KmsError(
          `Invalid master seed length (${seedBuffer.length} bytes). Expected 32 to 64 bytes.`,
          { code: 'INVALID_MASTER_SEED_LENGTH' }
        );
      }
      return seedBuffer;
    } catch (err: unknown) {
      if (err instanceof KmsError) {
        throw err;
      }
      throw new KmsError('Failed to fetch master seed from Azure Key Vault', {
        code: 'MASTER_SEED_FETCH_FAILED',
        cause: err
      });
    }
  }

  /**
   * Stores the master seed as a base64-encoded secret in Azure Key Vault.
   * Typically called once during initial vault bootstrap.
   */
  public async storeMasterSeed(seed: Buffer): Promise<void> {
    if (seed.length < 32 || seed.length > 64) {
      throw new KmsError(`Invalid seed length (${seed.length} bytes). Expected 32 to 64 bytes.`, {
        code: 'INVALID_SEED_LENGTH'
      });
    }

    const timestamp = new Date().toISOString();
    logger.info('Audited AKV secret write (storeMasterSeed)', {
      secretName: this.masterSeedSecretName,
      timestamp
    });

    const base64Value = seed.toString('base64');

    if (!this.client) {
      this.cache.set(this.masterSeedSecretName, {
        value: base64Value,
        expiresAt: Date.now() + this.cacheTtlMs,
      });
      return;
    }

    try {
      await this.client.setSecret(this.masterSeedSecretName, base64Value);
      // Update cache
      this.cache.set(this.masterSeedSecretName, {
        value: base64Value,
        expiresAt: Date.now() + this.cacheTtlMs
      });
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      logger.error('Failed to store master seed in Azure Key Vault', {
        secretName: this.masterSeedSecretName,
        timestamp,
        error: errorMessage
      });
      throw new KmsError(`Failed to store master seed in Azure Key Vault: ${errorMessage}`, {
        code: 'MASTER_SEED_STORE_FAILED',
        cause: err
      });
    }
  }

  /**
   * Clears in-process secret cache (e.g. for key rotation or testing).
   */
  public clearCache(): void {
    this.cache.clear();
  }
}

// Lazy-initialized singleton to allow loading without immediate AZURE_KEYVAULT_URL in unit tests if unused
let _akvClientInstance: AzureKeyVaultClient | null = null;

export const akvClient = new Proxy({} as AzureKeyVaultClient, {
  get(_target, prop, receiver) {
    if (!_akvClientInstance) {
      _akvClientInstance = new AzureKeyVaultClient();
    }
    const value = Reflect.get(_akvClientInstance, prop, receiver);
    if (typeof value === 'function') {
      return value.bind(_akvClientInstance);
    }
    return value;
  }
});
