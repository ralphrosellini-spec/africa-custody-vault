-- ============================================================
-- migrations/001_initial_schema.sql
-- Custody Vault — Complete MS SQL Server Schema
-- Run via: ts-node scripts/migrate.ts
-- ============================================================

-- ---- Migration tracking ----
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'cv_migrations')
CREATE TABLE cv_migrations (
  id          INT IDENTITY(1,1) PRIMARY KEY,
  filename    NVARCHAR(200) NOT NULL,
  applied_at  DATETIMEOFFSET DEFAULT SYSDATETIMEOFFSET() NOT NULL,
  CONSTRAINT UQ_cv_migrations_filename UNIQUE (filename)
);
GO

-- ============================================================
-- cv_users
-- One row per AfricaCrypto user registered in the vault.
-- derivation_index drives all BIP44 address derivation.
-- ============================================================
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'cv_users')
CREATE TABLE cv_users (
  id                 UNIQUEIDENTIFIER DEFAULT NEWSEQUENTIALID() NOT NULL,
  external_user_id   NVARCHAR(100) NOT NULL,          -- AfricaCrypto user ID
  derivation_index   INT NOT NULL,                    -- BIP44 address index
  created_at         DATETIMEOFFSET DEFAULT SYSDATETIMEOFFSET() NOT NULL,
  updated_at         DATETIMEOFFSET DEFAULT SYSDATETIMEOFFSET() NOT NULL,
  CONSTRAINT PK_cv_users PRIMARY KEY (id),
  CONSTRAINT UQ_cv_users_external_user_id UNIQUE (external_user_id),
  CONSTRAINT UQ_cv_users_derivation_index UNIQUE (derivation_index)
);
GO

-- Auto-increment sequence for derivation_index (thread-safe)
IF NOT EXISTS (SELECT * FROM sys.sequences WHERE name = 'seq_derivation_index')
CREATE SEQUENCE seq_derivation_index
  START WITH 1
  INCREMENT BY 1
  NO CYCLE;
GO

-- ============================================================
-- cv_wallets
-- Deposit addresses per user per network.
-- address and derivation_path are encrypted at application
-- level before storage (AES-256-GCM via Azure Key Vault).
-- ============================================================
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'cv_wallets')
CREATE TABLE cv_wallets (
  id               UNIQUEIDENTIFIER DEFAULT NEWSEQUENTIALID() NOT NULL,
  user_id          UNIQUEIDENTIFIER NOT NULL,
  network          NVARCHAR(20) NOT NULL,
  asset            NVARCHAR(30) NOT NULL,
  address          NVARCHAR(500) NOT NULL,    -- AES-256 encrypted at app layer
  derivation_path  NVARCHAR(200) NOT NULL,    -- AES-256 encrypted at app layer
  is_active        BIT NOT NULL DEFAULT 1,
  created_at       DATETIMEOFFSET DEFAULT SYSDATETIMEOFFSET() NOT NULL,
  CONSTRAINT PK_cv_wallets PRIMARY KEY (id),
  CONSTRAINT FK_cv_wallets_user FOREIGN KEY (user_id) REFERENCES cv_users(id),
  CONSTRAINT UQ_cv_wallets_user_network UNIQUE (user_id, network)
);
GO

CREATE INDEX IX_cv_wallets_user_id ON cv_wallets(user_id);
CREATE INDEX IX_cv_wallets_address ON cv_wallets(address);
GO

-- ============================================================
-- cv_deposits
-- All incoming deposits detected on-chain.
-- tx_hash is unique — protects against double-crediting.
-- ============================================================
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'cv_deposits')
CREATE TABLE cv_deposits (
  id            UNIQUEIDENTIFIER DEFAULT NEWSEQUENTIALID() NOT NULL,
  wallet_id     UNIQUEIDENTIFIER NOT NULL,
  tx_hash       NVARCHAR(200) NOT NULL,
  asset         NVARCHAR(30) NOT NULL,
  network       NVARCHAR(20) NOT NULL,
  amount        DECIMAL(28, 18) NOT NULL,    -- NEVER FLOAT
  confirmations INT NOT NULL DEFAULT 0,
  status        NVARCHAR(20) NOT NULL DEFAULT 'UNCONFIRMED',
  detected_at   DATETIMEOFFSET DEFAULT SYSDATETIMEOFFSET() NOT NULL,
  confirmed_at  DATETIMEOFFSET NULL,
  CONSTRAINT PK_cv_deposits PRIMARY KEY (id),
  CONSTRAINT FK_cv_deposits_wallet FOREIGN KEY (wallet_id) REFERENCES cv_wallets(id),
  CONSTRAINT UQ_cv_deposits_tx_hash UNIQUE (tx_hash),
  CONSTRAINT CK_cv_deposits_status CHECK (status IN ('UNCONFIRMED','CONFIRMING','COMPLETED','FAILED')),
  CONSTRAINT CK_cv_deposits_amount CHECK (amount > 0)
);
GO

CREATE INDEX IX_cv_deposits_status_network ON cv_deposits(status, network);
CREATE INDEX IX_cv_deposits_wallet_id ON cv_deposits(wallet_id);
GO

-- ============================================================
-- cv_withdrawals
-- All outgoing withdrawal requests.
-- gross_amount is debited from user; net_amount_sent goes out.
-- fee_charged stays in Omnibus as platform revenue.
-- ============================================================
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'cv_withdrawals')
CREATE TABLE cv_withdrawals (
  id                     UNIQUEIDENTIFIER DEFAULT NEWSEQUENTIALID() NOT NULL,
  user_id                UNIQUEIDENTIFIER NOT NULL,
  asset                  NVARCHAR(30) NOT NULL,
  network                NVARCHAR(20) NOT NULL,
  destination_address    NVARCHAR(200) NOT NULL,
  gross_amount           DECIMAL(28, 18) NOT NULL,
  fee_charged            DECIMAL(28, 18) NOT NULL DEFAULT 0,
  net_amount_sent        DECIMAL(28, 18) NOT NULL,
  tx_hash                NVARCHAR(200) NULL,
  status                 NVARCHAR(20) NOT NULL DEFAULT 'PENDING',
  failure_reason         NVARCHAR(500) NULL,
  requestor_ip           NVARCHAR(50) NOT NULL,
  requestor_api_key_id   NVARCHAR(100) NOT NULL,
  requested_at           DATETIMEOFFSET DEFAULT SYSDATETIMEOFFSET() NOT NULL,
  completed_at           DATETIMEOFFSET NULL,
  CONSTRAINT PK_cv_withdrawals PRIMARY KEY (id),
  CONSTRAINT FK_cv_withdrawals_user FOREIGN KEY (user_id) REFERENCES cv_users(id),
  CONSTRAINT CK_cv_withdrawals_status CHECK (status IN ('PENDING','BROADCASTING','UNCONFIRMED','CONFIRMING','COMPLETED','FAILED')),
  CONSTRAINT CK_cv_withdrawals_amounts CHECK (gross_amount > 0 AND net_amount_sent > 0 AND fee_charged >= 0)
);
GO

CREATE INDEX IX_cv_withdrawals_status_network ON cv_withdrawals(status, network);
CREATE INDEX IX_cv_withdrawals_user_id ON cv_withdrawals(user_id);
CREATE INDEX IX_cv_withdrawals_tx_hash ON cv_withdrawals(tx_hash) WHERE tx_hash IS NOT NULL;
GO

-- ============================================================
-- cv_internal_transfers
-- Vault-to-vault movements: sweeps and fee sweeps.
-- Never exposed externally.
-- ============================================================
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'cv_internal_transfers')
CREATE TABLE cv_internal_transfers (
  id             UNIQUEIDENTIFIER DEFAULT NEWSEQUENTIALID() NOT NULL,
  transfer_type  NVARCHAR(30) NOT NULL,   -- SWEEP, FEE_SWEEP, GAS_REFILL
  asset          NVARCHAR(30) NOT NULL,
  network        NVARCHAR(20) NOT NULL,
  from_address   NVARCHAR(200) NOT NULL,
  to_address     NVARCHAR(200) NOT NULL,
  amount         DECIMAL(28, 18) NOT NULL,
  tx_hash        NVARCHAR(200) NULL,
  status         NVARCHAR(20) NOT NULL DEFAULT 'PENDING',
  created_at     DATETIMEOFFSET DEFAULT SYSDATETIMEOFFSET() NOT NULL,
  completed_at   DATETIMEOFFSET NULL,
  CONSTRAINT PK_cv_internal_transfers PRIMARY KEY (id),
  CONSTRAINT CK_cv_internal_transfers_type CHECK (transfer_type IN ('SWEEP','FEE_SWEEP','GAS_REFILL')),
  CONSTRAINT CK_cv_internal_transfers_status CHECK (status IN ('PENDING','BROADCASTING','COMPLETED','FAILED'))
);
GO

CREATE INDEX IX_cv_internal_transfers_status ON cv_internal_transfers(status, network);
GO

-- ============================================================
-- cv_ledger_events
-- APPEND-ONLY immutable audit ledger.
-- NEVER UPDATE OR DELETE ROWS IN THIS TABLE.
-- Credits: positive amount (DEPOSIT_CREDIT)
-- Debits:  negative amount (WITHDRAWAL_DEBIT, FEE_DEBIT)
-- ============================================================
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'cv_ledger_events')
CREATE TABLE cv_ledger_events (
  id              UNIQUEIDENTIFIER DEFAULT NEWSEQUENTIALID() NOT NULL,
  user_id         UNIQUEIDENTIFIER NOT NULL,
  event_type      NVARCHAR(50) NOT NULL,
  asset           NVARCHAR(30) NOT NULL,
  network         NVARCHAR(20) NOT NULL,
  amount          DECIMAL(28, 18) NOT NULL,  -- positive = credit, negative = debit
  reference_id    NVARCHAR(100) NOT NULL,    -- deposit/withdrawal UUID
  reference_type  NVARCHAR(50) NOT NULL,     -- 'deposit' | 'withdrawal' | 'fee'
  created_at      DATETIMEOFFSET DEFAULT SYSDATETIMEOFFSET() NOT NULL,
  CONSTRAINT PK_cv_ledger_events PRIMARY KEY (id),
  CONSTRAINT FK_cv_ledger_events_user FOREIGN KEY (user_id) REFERENCES cv_users(id)
);
GO

CREATE INDEX IX_cv_ledger_events_user_asset ON cv_ledger_events(user_id, asset, network);
CREATE INDEX IX_cv_ledger_events_created_at ON cv_ledger_events(created_at);
GO

-- ============================================================
-- cv_api_keys
-- API key registry. Only SHA-256 hashes stored — never plaintext.
-- ============================================================
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'cv_api_keys')
CREATE TABLE cv_api_keys (
  id            UNIQUEIDENTIFIER DEFAULT NEWSEQUENTIALID() NOT NULL,
  key_hash      NVARCHAR(200) NOT NULL,   -- SHA-256 of the actual key
  key_id        NVARCHAR(100) NOT NULL,   -- public prefix for identification
  caller_name   NVARCHAR(100) NOT NULL,
  is_admin      BIT NOT NULL DEFAULT 0,
  is_active     BIT NOT NULL DEFAULT 1,
  last_used_at  DATETIMEOFFSET NULL,
  expires_at    DATETIMEOFFSET NULL,
  created_at    DATETIMEOFFSET DEFAULT SYSDATETIMEOFFSET() NOT NULL,
  CONSTRAINT PK_cv_api_keys PRIMARY KEY (id),
  CONSTRAINT UQ_cv_api_keys_key_hash UNIQUE (key_hash),
  CONSTRAINT UQ_cv_api_keys_key_id UNIQUE (key_id)
);
GO

-- ============================================================
-- cv_config
-- Runtime configuration. Editable by admins without code deploy.
-- ============================================================
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'cv_config')
CREATE TABLE cv_config (
  [key]       NVARCHAR(100) NOT NULL,
  [value]     NVARCHAR(500) NOT NULL,
  description NVARCHAR(500) NULL,
  updated_at  DATETIMEOFFSET DEFAULT SYSDATETIMEOFFSET() NOT NULL,
  updated_by  NVARCHAR(100) NOT NULL DEFAULT 'system',
  CONSTRAINT PK_cv_config PRIMARY KEY ([key])
);
GO

-- Seed default config values
MERGE cv_config AS target
USING (VALUES
  ('sweep_threshold_usd',          '50',                   'Min USD value to trigger auto-sweep from user vault to omnibus'),
  ('emergency_pause',              'false',                'When true, all outgoing transactions are blocked immediately'),
  ('withdrawal_alert_threshold_usd','10000',              'Withdrawals above this USD value trigger an alert'),
  ('gas_alert_threshold_eth',      '0.05',                'Gas station ETH balance alert threshold'),
  ('gas_alert_threshold_bnb',      '0.1',                 'Gas station BNB balance alert threshold'),
  ('gas_alert_threshold_trx',      '100',                 'Gas station TRX balance alert threshold (in TRX)'),
  ('gas_alert_threshold_sol',      '0.5',                 'Gas station SOL balance alert threshold'),
  ('gas_alert_threshold_pol',      '5',                   'Gas station POL balance alert threshold'),
  ('withdrawal_fee_USDT_ERC20',    '2',                   'Withdrawal fee in USDT for ERC-20 USDT'),
  ('withdrawal_fee_USDT_BEP20',    '1',                   'Withdrawal fee in USDT for BEP-20 USDT'),
  ('withdrawal_fee_USDT_TRC20',    '1',                   'Withdrawal fee in USDT for TRC-20 USDT'),
  ('withdrawal_fee_ETH',           '0.005',               'Withdrawal fee in ETH'),
  ('withdrawal_fee_BTC',           '0.0001',              'Withdrawal fee in BTC'),
  ('withdrawal_fee_SOL',           '0.01',                'Withdrawal fee in SOL'),
  ('withdrawal_fee_XRP',           '0.5',                 'Withdrawal fee in XRP'),
  ('withdrawal_fee_BNB',           '0.002',               'Withdrawal fee in BNB'),
  ('last_fee_sweep_at',            '1970-01-01T00:00:00Z','Timestamp of last revenue fee sweep'),
  ('reconciliation_cron',          '0 */6 * * *',         'Cron schedule for reconciliation job')
) AS source ([key], [value], description)
ON target.[key] = source.[key]
WHEN NOT MATCHED THEN
  INSERT ([key], [value], description) VALUES (source.[key], source.[value], source.description);
GO
