// ============================================================
// src/views/dashboard.ts
// Interactive institutional dashboard rendered at GET /
// ============================================================

export function getDashboardHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AfricaCrypto — Custody Vault Portal</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #090d16;
      --card-bg: #111827;
      --card-border: #1f2937;
      --card-hover: #1e293b;
      --text-main: #f3f4f6;
      --text-muted: #9ca3af;
      --accent: #06b6d4;
      --accent-glow: rgba(6, 182, 212, 0.2);
      --success: #10b981;
      --success-glow: rgba(16, 185, 129, 0.2);
      --font-sans: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif;
      --font-mono: 'JetBrains Mono', monospace;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background-color: var(--bg);
      color: var(--text-main);
      font-family: var(--font-sans);
      min-height: 100vh;
      padding: 2.5rem 1.5rem;
      background-image: 
        radial-gradient(circle at 15% 15%, rgba(6, 182, 212, 0.08) 0%, transparent 40%),
        radial-gradient(circle at 85% 85%, rgba(16, 185, 129, 0.06) 0%, transparent 40%);
    }
    .container {
      max-width: 1100px;
      margin: 0 auto;
      display: flex;
      flex-direction: column;
      gap: 2rem;
    }
    /* Header */
    header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 1rem;
      padding-bottom: 1.5rem;
      border-bottom: 1px solid var(--card-border);
    }
    .logo-group {
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }
    .shield-icon {
      width: 44px;
      height: 44px;
      background: linear-gradient(135deg, #06b6d4, #3b82f6);
      border-radius: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 1.5rem;
      box-shadow: 0 0 20px var(--accent-glow);
    }
    h1 {
      font-size: 1.6rem;
      font-weight: 800;
      letter-spacing: -0.02em;
    }
    .subtitle {
      color: var(--text-muted);
      font-size: 0.88rem;
    }
    .status-badge {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      background: rgba(16, 185, 129, 0.12);
      border: 1px solid rgba(16, 185, 129, 0.3);
      color: var(--success);
      padding: 0.4rem 0.9rem;
      border-radius: 9999px;
      font-size: 0.85rem;
      font-weight: 600;
    }
    .pulse-dot {
      width: 8px;
      height: 8px;
      background-color: var(--success);
      border-radius: 50%;
      box-shadow: 0 0 10px var(--success);
      animation: pulse 2s infinite;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.4; transform: scale(0.85); }
    }

    /* Grid */
    .metrics-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
      gap: 1.25rem;
    }
    .metric-card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 12px;
      padding: 1.25rem;
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      transition: all 0.2s ease;
    }
    .metric-card:hover {
      border-color: rgba(6, 182, 212, 0.4);
      transform: translateY(-2px);
    }
    .metric-title {
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--text-muted);
      font-weight: 700;
    }
    .metric-value {
      font-size: 1.4rem;
      font-weight: 700;
      color: var(--text-main);
    }
    .metric-desc {
      font-size: 0.82rem;
      color: var(--text-muted);
    }

    /* Main Card */
    .card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 14px;
      padding: 1.75rem;
      display: flex;
      flex-direction: column;
      gap: 1.25rem;
      box-shadow: 0 4px 20px rgba(0,0,0,0.3);
    }
    .card-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 1rem;
    }
    .card-title {
      font-size: 1.15rem;
      font-weight: 700;
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    /* Interactive Form */
    .form-group {
      display: flex;
      gap: 0.75rem;
      flex-wrap: wrap;
    }
    .input-field {
      flex: 1;
      min-width: 260px;
      background: #0f172a;
      border: 1px solid #334155;
      color: var(--text-main);
      padding: 0.75rem 1rem;
      border-radius: 8px;
      font-size: 0.95rem;
      font-family: var(--font-mono);
      outline: none;
      transition: border-color 0.2s;
    }
    .input-field:focus {
      border-color: var(--accent);
      box-shadow: 0 0 0 2px var(--accent-glow);
    }
    .btn {
      background: linear-gradient(135deg, #06b6d4, #0284c7);
      color: #fff;
      border: none;
      padding: 0.75rem 1.4rem;
      border-radius: 8px;
      font-weight: 600;
      font-size: 0.92rem;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      transition: all 0.2s;
    }
    .btn:hover {
      filter: brightness(1.1);
      box-shadow: 0 0 15px var(--accent-glow);
    }
    .btn-secondary {
      background: #1e293b;
      border: 1px solid #334155;
      color: var(--text-main);
    }
    .btn-secondary:hover {
      background: #334155;
      box-shadow: none;
    }

    /* Results Table */
    .table-container {
      overflow-x: auto;
      border: 1px solid var(--card-border);
      border-radius: 8px;
      display: none;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.88rem;
    }
    th, td {
      padding: 0.85rem 1rem;
      text-align: left;
    }
    th {
      background: #0f172a;
      color: var(--text-muted);
      font-weight: 600;
      border-bottom: 1px solid var(--card-border);
      font-size: 0.78rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    tr:not(:last-child) td {
      border-bottom: 1px solid rgba(255,255,255,0.05);
    }
    tr:hover td {
      background: rgba(255,255,255,0.02);
    }
    .badge-chain {
      background: #1e293b;
      padding: 0.25rem 0.6rem;
      border-radius: 6px;
      font-weight: 600;
      font-size: 0.8rem;
      color: var(--accent);
      border: 1px solid rgba(6, 182, 212, 0.3);
    }
    .mono-address {
      font-family: var(--font-mono);
      font-size: 0.84rem;
      color: #e2e8f0;
      word-break: break-all;
    }
    .copy-btn {
      background: transparent;
      border: none;
      color: var(--text-muted);
      cursor: pointer;
      padding: 0.2rem 0.4rem;
      font-size: 0.8rem;
    }
    .copy-btn:hover {
      color: var(--accent);
    }

    /* Code block */
    pre {
      background: #0a0f1d;
      border: 1px solid #1e293b;
      padding: 1rem;
      border-radius: 8px;
      color: #38bdf8;
      font-family: var(--font-mono);
      font-size: 0.85rem;
      overflow-x: auto;
    }

    /* Footer */
    footer {
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 1rem;
      padding-top: 1.5rem;
      border-top: 1px solid var(--card-border);
      color: var(--text-muted);
      font-size: 0.82rem;
    }
    a {
      color: var(--accent);
      text-decoration: none;
    }
    a:hover {
      text-decoration: underline;
    }
  </style>
</head>
<body>
  <div class="container">
    <!-- Header -->
    <header>
      <div class="logo-group">
        <div class="shield-icon">🛡️</div>
        <div>
          <h1>AfricaCrypto Custody Vault</h1>
          <p class="subtitle">Institutional-Grade Self-Hosted Cryptocurrency Custody Engine</p>
        </div>
      </div>
      <div class="status-badge">
        <span class="pulse-dot"></span>
        <span>Service Online • v1.0.0</span>
      </div>
    </header>

    <!-- Metrics -->
    <div class="metrics-grid">
      <div class="metric-card">
        <span class="metric-title">Multi-Chain Engine</span>
        <span class="metric-value">9 Networks</span>
        <span class="metric-desc">BTC, ETH, SOL, TRX, XRP, BSC, Polygon, LTC, DOGE</span>
      </div>
      <div class="metric-card">
        <span class="metric-title">Cryptographic Root</span>
        <span class="metric-value">BIP32 / BIP44</span>
        <span class="metric-desc">Zero-key persistence; keys zeroized immediately after sign</span>
      </div>
      <div class="metric-card">
        <span class="metric-title">API Authentication</span>
        <span class="metric-value">HMAC-SHA256</span>
        <span class="metric-desc">Constant-time comparison + 5-min replay protection</span>
      </div>
      <div class="metric-card">
        <span class="metric-title">Storage Architecture</span>
        <span class="metric-value">Triple Vault</span>
        <span class="metric-desc">User Deposit Vaults → Central Omnibus → Revenue Sweeping</span>
      </div>
    </div>

    <!-- Live Interactive Playground -->
    <div class="card">
      <div class="card-header">
        <h2 class="card-title">⚡ Live HD Address Derivation Playground</h2>
        <span style="font-size:0.85rem; color:var(--text-muted);">Try entering any user ID to derive unique multi-chain addresses</span>
      </div>
      
      <div class="form-group">
        <input type="text" id="userIdInput" class="input-field" value="manager-review-001" placeholder="Enter External User ID...">
        <button id="deriveBtn" class="btn">
          <span>Derive 9 Multi-Chain Addresses</span>
        </button>
      </div>

      <div id="loader" style="display:none; color:var(--accent); font-size:0.9rem; align-items:center; gap:0.5rem;">
        <span>Deriving cryptographic addresses across 9 chains...</span>
      </div>

      <div id="tableContainer" class="table-container">
        <table>
          <thead>
            <tr>
              <th>Network</th>
              <th>Asset</th>
              <th>Derivation Path</th>
              <th>Derived Deposit Address</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody id="addressTableBody"></tbody>
        </table>
      </div>
    </div>

    <!-- Phase 2: Deposit Flow & Sweeping Engine -->
    <div class="card">
      <div class="card-header">
        <h2 class="card-title">📥 Phase 2: On-Chain Deposit & Auto-Sweep Simulator</h2>
        <span style="font-size:0.85rem; color:var(--text-muted);">Simulate incoming deposits, confirmation tracking, and auto-sweeping to Omnibus</span>
      </div>

      <div class="form-group">
        <input type="text" id="depUserId" class="input-field" value="manager-review-001" placeholder="User ID" style="max-width:180px;">
        <select id="depNetwork" class="input-field" style="max-width:140px; cursor:pointer;">
          <option value="ETH">ETH (Ethereum)</option>
          <option value="BSC">BSC (BNB Chain)</option>
          <option value="POLYGON">POLYGON</option>
          <option value="BTC">BTC (Bitcoin)</option>
          <option value="SOL">SOL (Solana)</option>
          <option value="TRX">TRX (Tron)</option>
        </select>
        <input type="text" id="depAmount" class="input-field" value="120.00" placeholder="Amount (e.g. 120.00)" style="max-width:160px;">
        <button id="simulateDepositBtn" class="btn" style="background:linear-gradient(135deg, #10b981, #059669);">
          <span>⚡ Simulate Deposit & Auto-Sweep</span>
        </button>
      </div>

      <div id="depLoader" style="display:none; color:var(--success); font-size:0.9rem; align-items:center; gap:0.5rem;">
        <span>Processing deposit confirmation lifecycle and evaluating sweep threshold...</span>
      </div>

      <!-- Deposit Flow Timeline Result -->
      <div id="depositResultPanel" style="display:none; background:#0f172a; border:1px solid #1e293b; border-radius:10px; padding:1.25rem;">
        <h3 style="font-size:0.95rem; color:#38bdf8; margin-bottom:0.75rem; display:flex; align-items:center; gap:0.5rem;">
          <span>✅ Deposit Lifecycle & Sweep Successfully Processed</span>
        </h3>
        <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(220px, 1fr)); gap:1rem; font-size:0.85rem;">
          <div><strong style="color:var(--text-muted);">TxHash:</strong> <div id="resTxHash" class="mono-address" style="font-size:0.78rem;"></div></div>
          <div><strong style="color:var(--text-muted);">Deposit Vault:</strong> <div id="resAddress" class="mono-address" style="font-size:0.78rem;"></div></div>
          <div><strong style="color:var(--text-muted);">Confirmations:</strong> <div id="resConfs" style="color:var(--success); font-weight:700;"></div></div>
          <div><strong style="color:var(--text-muted);">Omnibus Sweep:</strong> <div id="resSweep" style="color:#06b6d4; font-weight:700;"></div></div>
        </div>
      </div>

      <!-- Live Events Stream -->
      <div style="margin-top:0.5rem;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.5rem;">
          <h4 style="font-size:0.88rem; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.05em;">Live Event Bus & Webhook Dispatch Feed</h4>
          <button id="refreshEventsBtn" class="copy-btn">🔄 Refresh Feed</button>
        </div>
        <div id="eventsList" style="display:flex; flex-direction:column; gap:0.5rem;">
          <div style="color:var(--text-muted); font-size:0.82rem;">No recent events emitted yet. Click "Simulate Deposit" above to test.</div>
        </div>
      </div>
    </div>

    <!-- Phase 3: Withdrawal Pipeline & Balance Ledger -->
    <div class="card">
      <div class="card-header">
        <h2 class="card-title">💸 Phase 3 — Withdrawal Pipeline &amp; Balance Ledger</h2>
        <span style="font-size:0.78rem; background:#7c3aed22; color:#a78bfa; border:1px solid #7c3aed44; padding:0.25rem 0.75rem; border-radius:999px;">ATOMIC DEBIT + LEDGER</span>
      </div>
      <p style="font-size:0.88rem; color:var(--text-muted); margin-bottom:1.25rem;">Simulate a full withdrawal: Omnibus balance check → atomic SQL debit → sign &amp; broadcast → ledger append. Then query the user's live balance ledger.</p>
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:1.25rem; margin-bottom:1.25rem;">
        <div>
          <label style="display:block; font-size:0.82rem; color:var(--text-muted); margin-bottom:0.4rem;">External User ID</label>
          <input id="wdUserIdInput" type="text" value="manager-demo" style="width:100%; background:#0f172a; border:1px solid #334155; color:#f1f5f9; padding:0.6rem 0.8rem; border-radius:6px; font-size:0.88rem;" />
        </div>
        <div>
          <label style="display:block; font-size:0.82rem; color:var(--text-muted); margin-bottom:0.4rem;">Gross Amount</label>
          <input id="wdAmountInput" type="text" value="10" style="width:100%; background:#0f172a; border:1px solid #334155; color:#f1f5f9; padding:0.6rem 0.8rem; border-radius:6px; font-size:0.88rem;" />
        </div>
        <div>
          <label style="display:block; font-size:0.82rem; color:var(--text-muted); margin-bottom:0.4rem;">Asset</label>
          <select id="wdAssetSelect" style="width:100%; background:#0f172a; border:1px solid #334155; color:#f1f5f9; padding:0.6rem 0.8rem; border-radius:6px; font-size:0.88rem;">
            <option value="ETH">ETH</option>
            <option value="BTC">BTC</option>
            <option value="SOL">SOL</option>
            <option value="USDT_ERC20">USDT_ERC20</option>
          </select>
        </div>
        <div>
          <label style="display:block; font-size:0.82rem; color:var(--text-muted); margin-bottom:0.4rem;">Network</label>
          <select id="wdNetworkSelect" style="width:100%; background:#0f172a; border:1px solid #334155; color:#f1f5f9; padding:0.6rem 0.8rem; border-radius:6px; font-size:0.88rem;">
            <option value="ETH">ETH</option>
            <option value="BTC">BTC</option>
            <option value="SOL">SOL</option>
            <option value="BSC">BSC</option>
          </select>
        </div>
      </div>
      <div style="display:flex; gap:0.75rem; margin-bottom:1.25rem; flex-wrap:wrap;">
        <button id="submitWithdrawalBtn" class="btn">⚡ Submit Withdrawal</button>
        <button id="checkBalanceBtn" class="btn btn-secondary">📊 Check Balance</button>
        <span id="wdLoader" style="display:none; align-self:center; font-size:0.82rem; color:var(--text-muted);">⏳ Processing...</span>
      </div>
      <div id="wdResult" style="display:none;">
        <h4 style="font-size:0.85rem; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.05em; margin-bottom:0.75rem;">Withdrawal Result</h4>
        <pre id="wdResultPre"></pre>
      </div>
      <div id="balanceResult" style="display:none; margin-top:1rem;">
        <h4 style="font-size:0.85rem; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.05em; margin-bottom:0.75rem;">Balance Ledger</h4>
        <pre id="balanceResultPre"></pre>
      </div>
    </div>

    <div class="card">
      <div class="card-header">
        <h2 class="card-title">🔍 Live API Diagnostics & Health</h2>
        <div style="display:flex; gap:0.5rem;">
          <button id="pingHealthBtn" class="btn btn-secondary">Probe /health</button>
        </div>
      </div>
      <p style="font-size:0.88rem; color:var(--text-muted);">Click "Probe /health" to ping the live server endpoint directly:</p>
      <pre id="healthOutput">// Click "Probe /health" to view live JSON response...</pre>
    </div>

    <!-- Architecture & Flows -->
    <div class="card">
      <h2 class="card-title">📐 Custody Vault Architecture & Flow</h2>
      <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(280px, 1fr)); gap:1.25rem; font-size:0.88rem; color:#cbd5e1; line-height:1.5;">
        <div style="background:#0f172a; padding:1.25rem; border-radius:8px; border:1px solid #1e293b;">
          <h3 style="color:var(--accent); font-size:0.95rem; margin-bottom:0.5rem;">1. Deposit Flow</h3>
          <p>Users send crypto to personal deposit addresses derived above. Once balance exceeds $50 threshold, the automated sweep worker consolidates funds into the shared Omnibus Vault.</p>
        </div>
        <div style="background:#0f172a; padding:1.25rem; border-radius:8px; border:1px solid #1e293b;">
          <h3 style="color:var(--accent); font-size:0.95rem; margin-bottom:0.5rem;">2. Atomic Withdrawals</h3>
          <p>Withdrawals verify Omnibus liquidity and debit the internal ledger inside a single atomic SQL transaction before signing. If signing fails, an immediate rollback refund triggers.</p>
        </div>
        <div style="background:#0f172a; padding:1.25rem; border-radius:8px; border:1px solid #1e293b;">
          <h3 style="color:var(--accent); font-size:0.95rem; margin-bottom:0.5rem;">3. Revenue Sweep</h3>
          <p>Trading and withdrawal fees accumulate in the Omnibus. Scheduled batch jobs sweep pure platform revenue to the dedicated Revenue Vault in single, gas-efficient transactions.</p>
        </div>
      </div>
    </div>

    <!-- Endpoints Reference -->
    <div class="card">
      <h2 class="card-title">📡 Core API Endpoints</h2>
      <div style="overflow-x:auto;">
        <table>
          <thead>
            <tr>
              <th>Method</th>
              <th>Endpoint</th>
              <th>Authentication</th>
              <th>Description</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><span style="color:#10b981; font-weight:700;">GET</span></td>
              <td class="mono-address"><a href="/health" target="_blank">/health</a></td>
              <td>Public</td>
              <td>Liveness & system status probe</td>
            </tr>
            <tr>
              <td><span style="color:#3b82f6; font-weight:700;">POST</span></td>
              <td class="mono-address">/api/v1/wallets</td>
              <td>HMAC-SHA256 + API Key</td>
              <td>Generates BIP44 deposit addresses for a user</td>
            </tr>
            <tr>
              <td><span style="color:#10b981; font-weight:700;">GET</span></td>
              <td class="mono-address">/api/v1/wallets/:userId</td>
              <td>HMAC-SHA256 + API Key</td>
              <td>Retrieves all active addresses for a user</td>
            </tr>
            <tr>
              <td><span style="color:#3b82f6; font-weight:700;">POST</span></td>
              <td class="mono-address">/api/v1/withdrawals</td>
              <td>HMAC-SHA256 + API Key</td>
              <td>Atomic balance debit & on-chain transfer</td>
            </tr>
            <tr>
              <td><span style="color:#10b981; font-weight:700;">GET</span></td>
              <td class="mono-address">/api/v1/admin/health</td>
              <td>Admin Key + HMAC</td>
              <td>Gas station balances & blockchain listener status</td>
            </tr>
            <tr>
              <td><span style="color:#ef4444; font-weight:700;">POST</span></td>
              <td class="mono-address">/api/v1/admin/emergency-pause</td>
              <td>Admin Key + HMAC</td>
              <td>Emergency circuit breaker: block all outgoing transactions</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Footer -->
    <footer>
      <div>AfricaCrypto Custody Vault • Built for High Security & Reliability</div>
      <div>Designed with Node.js 20, TypeScript, MS SQL Server & BIP32/44</div>
    </footer>
  </div>

  <script>
    const deriveBtn = document.getElementById('deriveBtn');
    const userIdInput = document.getElementById('userIdInput');
    const tableContainer = document.getElementById('tableContainer');
    const addressTableBody = document.getElementById('addressTableBody');
    const loader = document.getElementById('loader');
    const pingHealthBtn = document.getElementById('pingHealthBtn');
    const healthOutput = document.getElementById('healthOutput');

    deriveBtn.addEventListener('click', async () => {
      const extUserId = userIdInput.value.trim() || 'manager-demo';
      loader.style.display = 'flex';
      deriveBtn.disabled = true;

      try {
        const res = await fetch('/demo/derive', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ externalUserId: extUserId })
        });
        const json = await res.json();
        
        addressTableBody.innerHTML = '';
        if (json.success && json.data) {
          json.data.forEach(item => {
            const tr = document.createElement('tr');
            tr.innerHTML = \`
              <td><span class="badge-chain">\${item.network}</span></td>
              <td style="font-weight:600;">\${item.network}</td>
              <td style="font-family:var(--font-mono); color:var(--text-muted); font-size:0.8rem;">\${item.derivationPath}</td>
              <td class="mono-address">\${item.address}</td>
              <td><button class="copy-btn" onclick="navigator.clipboard.writeText('\${item.address}'); alert('Address copied to clipboard!');">📋 Copy</button></td>
            \`;
            addressTableBody.appendChild(tr);
          });
          tableContainer.style.display = 'block';
        } else {
          alert('Error deriving addresses: ' + (json.error || 'Unknown error'));
        }
      } catch (err) {
        alert('Fetch error: ' + err.message);
      } finally {
        loader.style.display = 'none';
        deriveBtn.disabled = false;
      }
    });

    pingHealthBtn.addEventListener('click', async () => {
      healthOutput.textContent = 'Probing /health endpoint...';
      try {
        const res = await fetch('/health');
        const json = await res.json();
        healthOutput.textContent = JSON.stringify(json, null, 2);
      } catch (err) {
        healthOutput.textContent = 'Error: ' + err.message;
      }
    });

    const simulateDepositBtn = document.getElementById('simulateDepositBtn');
    const depUserId = document.getElementById('depUserId');
    const depNetwork = document.getElementById('depNetwork');
    const depAmount = document.getElementById('depAmount');
    const depLoader = document.getElementById('depLoader');
    const depositResultPanel = document.getElementById('depositResultPanel');
    const resTxHash = document.getElementById('resTxHash');
    const resAddress = document.getElementById('resAddress');
    const resConfs = document.getElementById('resConfs');
    const resSweep = document.getElementById('resSweep');
    const eventsList = document.getElementById('eventsList');
    const refreshEventsBtn = document.getElementById('refreshEventsBtn');

    async function loadEvents() {
      try {
        const res = await fetch('/demo/events');
        const json = await res.json();
        if (json.events && json.events.length > 0) {
          eventsList.innerHTML = '';
          json.events.slice(0, 5).forEach(ev => {
            const div = document.createElement('div');
            div.style.background = '#0a0f1d';
            div.style.border = '1px solid #1e293b';
            div.style.borderRadius = '6px';
            div.style.padding = '0.6rem 0.9rem';
            div.style.fontSize = '0.82rem';
            div.style.display = 'flex';
            div.style.justifyContent = 'space-between';
            div.style.alignItems = 'center';
            div.style.flexWrap = 'wrap';
            div.style.gap = '0.5rem';
            div.innerHTML = \`
              <div>
                <span style="background:rgba(6, 182, 212, 0.15); color:#06b6d4; padding:0.15rem 0.4rem; border-radius:4px; font-weight:700; font-size:0.75rem;">\${ev.eventType}</span>
                <span style="color:#94a3b8; font-family:var(--font-mono); margin-left:0.5rem;">\${ev.eventId.slice(0, 8)}...</span>
              </div>
              <div style="color:#64748b; font-size:0.75rem;">\${new Date(ev.timestamp).toLocaleTimeString()}</div>
              <div style="font-family:var(--font-mono); color:#10b981; font-size:0.75rem;">\${ev.signature ? ev.signature.slice(0, 18) + '...' : ''}</div>
            \`;
            eventsList.appendChild(div);
          });
        }
      } catch (e) {
        console.error(e);
      }
    }

    refreshEventsBtn.addEventListener('click', loadEvents);

    simulateDepositBtn.addEventListener('click', async () => {
      depLoader.style.display = 'flex';
      simulateDepositBtn.disabled = true;
      try {
        const res = await fetch('/demo/deposit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            externalUserId: depUserId.value.trim() || 'manager-review-001',
            network: depNetwork.value,
            amount: depAmount.value.trim() || '120.00'
          })
        });
        const json = await res.json();
        if (json.success && json.data) {
          depositResultPanel.style.display = 'block';
          resTxHash.textContent = json.data.deposit ? json.data.deposit.txHash : 'N/A';
          resAddress.textContent = json.data.walletAddress || 'N/A';
          resConfs.textContent = \`\${json.data.requiredConfirmations}/\${json.data.requiredConfirmations} (COMPLETED)\`;
          resSweep.textContent = json.data.sweeps && json.data.sweeps.length > 0 ? 'Swept to Omnibus Vault' : 'Threshold Evaluated';
          loadEvents();
        } else {
          alert('Error: ' + (json.error || 'Failed to simulate deposit'));
        }
      } catch (err) {
        alert('Network error: ' + err.message);
      } finally {
        depLoader.style.display = 'none';
        simulateDepositBtn.disabled = false;
      }
    });

    // Phase 3 — Withdrawal & Balance handlers
    const submitWithdrawalBtn = document.getElementById('submitWithdrawalBtn');
    const checkBalanceBtn = document.getElementById('checkBalanceBtn');
    const wdLoader = document.getElementById('wdLoader');
    const wdResult = document.getElementById('wdResult');
    const wdResultPre = document.getElementById('wdResultPre');
    const balanceResult = document.getElementById('balanceResult');
    const balanceResultPre = document.getElementById('balanceResultPre');

    submitWithdrawalBtn.addEventListener('click', async () => {
      const extId = (document.getElementById('wdUserIdInput')).value.trim() || 'manager-demo';
      const asset = (document.getElementById('wdAssetSelect')).value;
      const network = (document.getElementById('wdNetworkSelect')).value;
      const grossAmount = (document.getElementById('wdAmountInput')).value.trim() || '10';
      wdLoader.style.display = 'inline';
      submitWithdrawalBtn.disabled = true;
      wdResult.style.display = 'none';
      try {
        const resp = await fetch('/demo/withdrawal', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ externalUserId: extId, asset, network, grossAmount }),
        });
        const json = await resp.json();
        wdResult.style.display = 'block';
        wdResultPre.textContent = JSON.stringify(json.data ?? json, null, 2);
        if (!json.success) wdResultPre.style.color = '#ef4444';
        else wdResultPre.style.color = '';
      } catch (err) {
        wdResult.style.display = 'block';
        wdResultPre.style.color = '#ef4444';
        wdResultPre.textContent = 'Network error: ' + err.message;
      } finally {
        wdLoader.style.display = 'none';
        submitWithdrawalBtn.disabled = false;
      }
    });

    checkBalanceBtn.addEventListener('click', async () => {
      const extId = (document.getElementById('wdUserIdInput')).value.trim() || 'manager-demo';
      wdLoader.style.display = 'inline';
      checkBalanceBtn.disabled = true;
      balanceResult.style.display = 'none';
      try {
        const resp = await fetch('/demo/balance?externalUserId=' + encodeURIComponent(extId));
        const json = await resp.json();
        balanceResult.style.display = 'block';
        balanceResultPre.textContent = JSON.stringify(json.data ?? json, null, 2);
      } catch (err) {
        balanceResult.style.display = 'block';
        balanceResultPre.textContent = 'Network error: ' + err.message;
      } finally {
        wdLoader.style.display = 'none';
        checkBalanceBtn.disabled = false;
      }
    });

    // Auto trigger on initial load for preview
    deriveBtn.click();
  </script>
</body>
</html>`;
}
