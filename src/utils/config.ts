import dotenv from 'dotenv';
import { z } from 'zod';
import { DefaultAzureCredential } from '@azure/identity';
import { SecretClient } from '@azure/keyvault-secrets';

// Load .env file for local development
dotenv.config();

export const configSchema = z.object({
  // Server
  NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'http', 'verbose', 'debug', 'silly']).default('info'),

  // Database
  DB_SERVER: z.string().default('localhost'),
  DB_PORT: z.coerce.number().int().positive().default(1433),
  DB_NAME: z.string().default('custody_vault'),
  DB_USER: z.string().default('sa'),
  DB_PASSWORD: z.string().default('YourStrong@Password1'),
  DB_ENCRYPT: z
    .preprocess((val) => val === 'true' || val === true || val === '1', z.boolean())
    .default(false),
  DB_TRUST_SERVER_CERT: z
    .preprocess((val) => val === 'true' || val === true || val === '1', z.boolean())
    .default(true),

  // Azure Key Vault
  AZURE_KEY_VAULT_URL: z.string().url().default('https://dev-vault.vault.azure.net'),
  AZURE_TENANT_ID: z.string().optional(),
  AZURE_CLIENT_ID: z.string().optional(),
  AZURE_CLIENT_SECRET: z.string().optional(),
  MASTER_SEED_SECRET_NAME: z.string().default('custody-vault-master-seed'),

  // RabbitMQ
  RABBITMQ_URL: z.string().default('amqp://guest:guest@localhost:5672'),
  RABBITMQ_EXCHANGE: z.string().default('custody.events'),
  RABBITMQ_WEBHOOK_QUEUE: z.string().default('custody.webhooks'),

  // HMAC
  HMAC_SECRET: z
    .string()
    .min(32, 'HMAC_SECRET must be at least 32 characters')
    .default('dev-only-secret-replace-in-production-min-64-chars-use-random-value-32charsmin'),

  // Webhooks
  WEBHOOK_AFRICACRYPTO_URL: z.string().url().optional(),
  WEBHOOK_MAX_RETRIES: z.coerce.number().int().positive().default(5),
  WEBHOOK_RETRY_DELAY_MS: z.coerce.number().int().positive().default(1000),

  // RPC - EVM Primary (Alchemy)
  ALCHEMY_ETH_RPC: z.string().default('https://rpc.ankr.com/eth'),
  ALCHEMY_BSC_RPC: z.string().default('https://rpc.ankr.com/bsc'),
  ALCHEMY_POLYGON_RPC: z.string().default('https://rpc.ankr.com/polygon'),

  // RPC - EVM Failover (QuickNode)
  QUICKNODE_ETH_RPC: z.string().optional(),
  QUICKNODE_BSC_RPC: z.string().optional(),
  QUICKNODE_POLYGON_RPC: z.string().optional(),

  // UTXO & other chains
  BITCOIN_RPC_URL: z.string().default('https://blockstream.info/api'),
  LITECOIN_RPC_URL: z.string().default('https://litecoinspace.org/api'),
  DOGECOIN_RPC_URL: z.string().default('https://dogechain.info/api/v1'),
  TRON_RPC_URL: z.string().default('https://api.trongrid.io'),
  TRON_API_KEY: z.string().optional(),
  SOLANA_RPC_URL: z.string().default('https://api.mainnet-beta.solana.com'),
  XRP_WS_URL: z.string().default('wss://xrplcluster.com'),

  // Sweep and Limits
  SWEEP_THRESHOLD_USD: z.coerce.number().positive().default(50),
  GAS_ALERT_THRESHOLD_ETH: z.string().default('0.05'),
  GAS_ALERT_THRESHOLD_BNB: z.string().default('0.1'),
  GAS_ALERT_THRESHOLD_TRX: z.string().default('100'),
  GAS_ALERT_THRESHOLD_SOL: z.string().default('0.5'),
  GAS_ALERT_THRESHOLD_POL: z.string().default('5'),
  WITHDRAWAL_ALERT_THRESHOLD_USD: z.coerce.number().positive().default(10000),

  // Rate Limiting
  RATE_LIMIT_WINDOW_MS: z.coerce.number().positive().default(60000),
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().positive().default(100),

  // Reconciliation
  RECONCILIATION_CRON: z.string().default('0 */6 * * *'),
});

export type Config = z.infer<typeof configSchema>;

/**
 * Validates environment variables or Key Vault overrides against the schema.
 */
function validateConfig(raw: Record<string, unknown>): Config {
  const result = configSchema.safeParse(raw);
  if (!result.success) {
    const errorMessages = result.error.errors
      .map((err) => `  - ${err.path.join('.')}: ${err.message}`)
      .join('\n');
    throw new Error(`[Config Error] Environment validation failed:\n${errorMessages}`);
  }
  return Object.freeze(result.data);
}

/**
 * Fetches required secrets from Azure Key Vault when running in production.
 */
export async function fetchAzureKeyVaultSecrets(vaultUrl: string): Promise<Record<string, string>> {
  const secrets: Record<string, string> = {};
  const credential = new DefaultAzureCredential();
  const client = new SecretClient(vaultUrl, credential);

  const secretNamesToFetch = [
    { envKey: 'DB_PASSWORD', secretName: 'db-password' },
    { envKey: 'HMAC_SECRET', secretName: 'hmac-secret' },
    { envKey: 'TRON_API_KEY', secretName: 'tron-api-key' },
  ];

  for (const { envKey, secretName } of secretNamesToFetch) {
    try {
      const secret = await client.getSecret(secretName);
      if (secret.value) {
        secrets[envKey] = secret.value;
      }
    } catch (error) {
      // If secret doesn't exist in Key Vault, fall back to process.env if present
      if (!process.env[envKey]) {
        throw new Error(
          `[Config Error] Failed to retrieve required secret "${secretName}" from Azure Key Vault: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }
  }

  return secrets;
}

/**
 * Global frozen config instance.
 */
let currentConfig: Config;

try {
  // Initial parsing using environment variables
  currentConfig = validateConfig(process.env);
} catch (initialError) {
  // If in production and secrets might need to be loaded from AKV before full validation,
  // we defer throwing if AZURE_KEY_VAULT_URL is present, otherwise throw immediately.
  if (process.env.NODE_ENV === 'production' && process.env.AZURE_KEY_VAULT_URL) {
    // Will be populated when initializeConfig() is called
    currentConfig = {} as Config;
  } else {
    throw initialError;
  }
}

/**
 * Production bootstrap initializer to load secrets from Azure Key Vault.
 */
export async function initializeConfig(): Promise<Config> {
  const isProd = process.env.NODE_ENV === 'production';
  const akvUrl = process.env.AZURE_KEY_VAULT_URL;

  if (isProd && akvUrl) {
    const akvSecrets = await fetchAzureKeyVaultSecrets(akvUrl);
    for (const [k, v] of Object.entries(akvSecrets)) {
      process.env[k] = v;
    }
  }

  currentConfig = validateConfig(process.env);
  return currentConfig;
}

export function getConfig(): Config {
  if (!currentConfig || Object.keys(currentConfig).length === 0) {
    currentConfig = validateConfig(process.env);
  }
  return currentConfig;
}

export const config: Config = new Proxy({} as Config, {
  get(_target, prop: string | symbol) {
    const active = getConfig();
    return (active as unknown as Record<string | symbol, unknown>)[prop];
  },
});

export default config;
