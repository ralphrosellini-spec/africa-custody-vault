# Custody Vault

> **Status:** Standalone phase — institutional-grade in-house crypto custody engine.

A self-hosted cryptocurrency custody system built with strict security, fault tolerance, and multi-network blockchain support. Replaces third-party providers (Fireblocks) with direct key ownership and complete ledger auditability.

---

## Tech Stack (Locked & Finalized)

| Layer | Chosen Technology | Rationale & Security Controls |
|---|---|---|
| **API Framework** | Node.js 20 LTS + Express (TypeScript strict) | High performance, strict type safety, no implicit `any` |
| **Database** | Microsoft SQL Server 2022 (MSSQL) | TDE (Transparent Data Encryption), `DECIMAL(28,18)` financial precision, append-only ledger |
| **Key Management (KMS)** | Azure Key Vault (HSM-backed Premium) | FIPS 140-2 Level 2 hardware root of trust, master seed never leaves hardware in plaintext |
| **Message Queue** | RabbitMQ 3.13 | Durable exchanges, DLQ (Dead Letter Queue), exponential backoff webhook dispatch |
| **Chain RPC** | Alchemy (Primary) + QuickNode (Failover) | High reliability, failover resilience, WebSocket/Webhook mempool support |
| **Signing Engines** | `ethers.js` v6, `bitcoinjs-lib` v6, `tronweb`, `@solana/web3.js`, `xrpl` | Direct in-memory signing with explicit `Buffer.fill(0)` zeroization |
| **API Authentication** | mTLS + HMAC-SHA256 Signed Payloads | Dual-layer transport and message integrity protection with replay defense (5m window) |
| **Static Security Analysis** | ESLint Security + TypeScript Strict | Zero eval, timing attack protection via `crypto.timingSafeEqual` |

---

## Supported Networks (Phase 1)

| Network | Family | Coin Type (BIP44) | Native Asset | Confirmations Required |
|---|---|---|---|---|
| **Ethereum (ETH)** | EVM | 60 | ETH | 12 blocks |
| **BNB Smart Chain (BSC)** | EVM | 60 | BNB | 15 blocks |
| **Polygon (POL)** | EVM | 60 | POL | 128 blocks |
| **Bitcoin (BTC)** | UTXO | 0 | BTC | 3 blocks |
| **Litecoin (LTC)** | UTXO | 2 | LTC | 6 blocks |
| **Dogecoin (DOGE)** | UTXO | 3 | DOGE | 6 blocks |
| **Tron (TRX)** | Tron | 195 | TRX | 19 blocks |
| **Solana (SOL)** | Solana | 501 | SOL | 32 slots (finalized) |
| **XRP Ledger (XRP)** | Ripple | 144 | XRP | 1 ledger validation |

---

## Security Architecture & Guarantees

1. **Zero Key Persistence**:
   - Master seed is stored exclusively in **Azure Key Vault HSM**.
   - Child private keys are derived on-demand in volatile memory only.
   - Immediately following signature generation, private key buffers are zeroized using `Buffer.fill(0)`.
2. **Double-Spend & Overdraft Prevention**:
   - In `WithdrawalService`, the internal balance check, withdrawal record creation, and ledger debit occur in a **single atomic SQL transaction with `UPDLOCK, HOLDLOCK`** prior to broadcasting on-chain.
   - If broadcasting fails, the debit is refunded via an explicit compensatory event.
3. **Immutable Audit Ledger**:
   - The `cv_ledger_events` table is append-only (`INSERT` only; updates and deletes are prevented).
4. **Reconciliation Engine**:
   - Automated 6-hour cron job sums internal ledger events vs. actual on-chain omnibus balances.
   - Any discrepancy triggers an automatic `emergency_pause` halting all outbound funds.
5. **Replay & Timing Attack Immunity**:
   - API endpoints require an `X-Timestamp` (rejected if > 5 minutes drift) and `X-Signature` validated with `crypto.timingSafeEqual`.
6. **No Floating Point Arithmetic**:
   - All financial mathematics use `decimal.js` with 38-digit precision and conservative rounding (`ROUND_DOWN`).

---

## Project Structure

```
custody-vault/
├── src/
│   ├── api/                    # Express routing & controllers
│   │   ├── middleware/         # HMAC auth, rate limiters, Zod validators, error handlers
│   │   ├── admin.router.ts     # Health, manual sweeps, fee sweeps, emergency pause
│   │   ├── deposits.router.ts  # Deposit history & transaction queries
│   │   ├── wallets.router.ts   # Address creation & lookup
│   │   ├── withdrawals.router.ts # Outbound fund requests
│   │   └── index.ts            # Root API router
│   ├── chains/                 # Per-chain adapter implementations (ChainAdapter interface)
│   │   ├── BitcoinAdapter.ts   # BTC, LTC, DOGE (UTXO PSBT)
│   │   ├── EVMAdapter.ts       # ETH, BSC, Polygon (EIP-1559 & ERC-20)
│   │   ├── SolanaAdapter.ts    # SOL native & SPL tokens
│   │   ├── TronAdapter.ts      # TRX & TRC-20
│   │   ├── XRPAdapter.ts       # XRPL Payments & memos
│   │   └── index.ts            # Chain registry
│   ├── db/                     # MSSQL pool & transactional runner
│   │   └── connection.ts       # Singleton connection pool & transaction helper
│   ├── events/                 # RabbitMQ publisher & consumer
│   │   ├── EventEmitter.ts     # Durable publishing & exponential backoff webhooks
│   │   └── EventTypes.ts       # Envelope & payload contracts
│   ├── kms/                    # Key management & in-memory signing
│   │   ├── AzureKeyVaultClient.ts # AKV SecretClient with cache & audit logging
│   │   ├── Deriver.ts          # BIP32/BIP44 derivation paths
│   │   └── Signer.ts           # Ephemeral key lifecycle & broadcast
│   ├── listeners/              # Background monitoring workers
│   │   ├── ConfirmationTracker.ts # Confirmation pollers
│   │   ├── DepositListenerManager.ts # Master listener coordinator
│   │   └── GasMonitor.ts       # Gas station wallet threshold alerts
│   ├── services/               # Core business domains
│   │   ├── DepositService.ts   # Deposit detection & finalization
│   │   ├── ReconciliationService.ts # On-chain vs. ledger audits
│   │   ├── SweepService.ts     # Deposit-to-Omnibus & fee sweeps
│   │   ├── WalletService.ts    # User wallet address generation
│   │   └── WithdrawalService.ts # Atomic reservation & outbound pipeline
│   ├── types/                  # Strict TypeScript contracts & DB row models
│   ├── utils/                  # Safe decimal math, HMAC, Winston logger, config
│   ├── app.ts                  # Express application setup
│   └── server.ts               # Server bootstrap & graceful teardown
├── migrations/
│   └── 001_initial_schema.sql  # Complete MSSQL schema & default seeds
├── scripts/
│   ├── generate-master-seed.ts # One-time secure BIP39 seed generator
│   └── migrate.ts              # Idempotent DB migration runner
├── tests/
│   └── unit/utils/             # Decimal math & HMAC security tests
├── docker/
│   ├── Dockerfile              # Multi-stage non-root container
│   └── docker-compose.dev.yml  # Local MSSQL + RabbitMQ dev stack
├── package.json
└── tsconfig.json
```

---

## Getting Started

### 1. Prerequisites
- Node.js >= 20.x LTS
- Docker & Docker Compose (for local MSSQL and RabbitMQ)

### 2. Environment Configuration
Copy the template and configure your secrets:
```bash
cp .env.example .env
```

### 3. Start Local Infrastructure
Run the containerized development infrastructure:
```bash
docker compose -f docker/docker-compose.dev.yml up -d mssql rabbitmq
```
- **MS SQL Server**: `localhost:1433` (User: `sa`, Password: `YourStrong@Password1`)
- **RabbitMQ**: `localhost:5672` (Management UI: `http://localhost:15672`, `guest`/`guest`)

### 4. Run Database Migrations
Execute the automated migration runner:
```bash
npm run db:migrate
```

### 5. Generate Master Seed (One-time setup)
In a secure environment, generate the master seed:
```bash
npx ts-node scripts/generate-master-seed.ts
```

### 6. Run Unit Tests & Build
```bash
# Run unit test suite (40 tests covering safe arithmetic and HMAC security)
npm test

# Compile TypeScript production build
npm run build
```

### 7. Run Server
```bash
# Development mode with live reload
npm run dev

# Production mode
npm start
```

---

## API Summary

All endpoints are prefixed with `/api/v1` and require headers:
- `X-Api-Key`: API key hash-checked against database
- `X-Timestamp`: Epoch milliseconds (5m drift limit)
- `X-Signature`: Hex HMAC-SHA256 signature of `${timestamp}.${METHOD}.${path}.${body}`

| Endpoint | Method | Role | Description |
|---|---|---|---|
| `/wallets` | `POST` | User/System | Derives deposit addresses for a user across all networks |
| `/wallets/:externalUserId` | `GET` | User/System | Retrieves all active deposit addresses for a user |
| `/wallets/:externalUserId/:network` | `GET` | User/System | Retrieves address for a specific network |
| `/withdrawals` | `POST` | User/System | Initiates an outbound withdrawal with pre-debit reservation |
| `/withdrawals/:id` | `GET` | User/System | Queries withdrawal status & confirmation count |
| `/deposits/:externalUserId` | `GET` | User/System | Queries deposit history with pagination |
| `/deposits/tx/:txHash` | `GET` | User/System | Queries deposit details by blockchain hash |
| `/admin/sweep` | `POST` | Admin | Triggers manual sweep of user vault funds to Omnibus |
| `/admin/fee-sweep` | `POST` | Admin | Sweeps accumulated fees from Omnibus to Revenue Vault |
| `/admin/emergency-pause` | `POST` | Admin | Halts all outgoing transactions system-wide |
| `/admin/reconciliation` | `POST` | Admin | Triggers full ledger vs. on-chain reconciliation report |
| `/admin/health` | `GET` | Admin | Detailed diagnostic status of listeners & gas balances |
| `/health` | `GET` | Public | Unauthenticated liveness probe |

---

*Institutional-grade Custody Engine — AfricaCrypto Engineering*
