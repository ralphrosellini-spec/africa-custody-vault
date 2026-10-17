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

    <!-- Live Health & Diagnostic Probe -->
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

    // Auto trigger on initial load for preview
    deriveBtn.click();
  </script>
</body>
</html>`;
}
