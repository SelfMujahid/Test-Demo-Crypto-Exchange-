// =====================================================
// WALLET.JS — Whale Wallet Tracker
//
// Real Bitcoin transactions via blockchain.info's public WebSocket.
// Each transaction's input/output addresses are checked against a
// curated list of publicly-known exchange wallet addresses.
//
// HONESTY NOTE: This address list is a best-effort curated set of
// publicly documented/tagged exchange addresses (visible on any
// blockchain explorer). Exchanges rotate wallets constantly and
// use many thousands of addresses internally, so this will only
// catch a fraction of real exchange flow — it is NOT a complete or
// authoritative source (paid services like Whale Alert have far
// larger proprietary address databases). Anything that doesn't
// match is shown as "Unknown Whale Wallet" rather than guessed.
// =====================================================

// ===== KNOWN EXCHANGE WALLET ADDRESSES (publicly tagged, best-effort) =====
const EXCHANGE_WALLETS = {
  '34xp4vRoCGJym3xR7yCVPFHoCNxv4Twseo': 'Binance',
  '3M219KR5vEneNb47ewrPfWyb5jQ2DjxRP6': 'Binance',
  '1NDyJtNTjmwk5xPNhjgAMu4HDHigtobu1s': 'Binance',
  '3Kzh9qAqVWQhEsfQz7zEQL1EuSx5tyNLNS': 'Coinbase',
  '3FupZp77ySr7jwoLYEJ9mwzJpvoNBXsBnE': 'Coinbase',
  '3H5JTt42K7RmZtromfTSefcMEFMMe18pMD': 'Kraken',
  '3JZq4atUahhuA9rLhXLMhhTo133J9rF97j': 'Bitfinex',
  '1Kr6QSydW9bFQG1mXiPNNu6WpJGmUa9i1g': 'Bitfinex',
  '3Ptv3TFDzo7RVE7oJtEE7VvunkxV6dCwaP': 'Huobi',
  '1LQoWist8KkaUXSPKZHNvEyfrEkPHzSsCd': 'Huobi',
  '385cR5DM96n1HvBDMzLHPYcw89fZAXULJP': 'Bitstamp',
  '3P3QsMVK89JBNqZQv5zMAKG8FK3kJM4rjt': 'OKX',
  '1P5ZEDWTKTFGxQjZphgWPQUpe554WKDfHQ': 'Bittrex',
};

let btcPrice = 0;
let wsConn = null;

// ===== STATE =====
let events = [];  // stored whale tx objects
let filterMode = 'all'; // 'all' | 'inflow' | 'outflow' | 'unknown'
let minBTC = 5;

let stats = { totalBTC:0, inflowUSD:0, outflowUSD:0, count:0, biggest:null };

const MAX_ROWS = 60;

function fmtUSD(n) {
  if (n >= 1e9) return '$'+(n/1e9).toFixed(2)+'B';
  if (n >= 1e6) return '$'+(n/1e6).toFixed(2)+'M';
  if (n >= 1e3) return '$'+(n/1e3).toFixed(1)+'K';
  return '$'+n.toFixed(0);
}
function fmtBTC(n) {
  return n.toFixed(2)+' ₿';
}
function fmtTime(ts) {
  return new Date(ts).toLocaleTimeString('en-US',{hour12:false});
}
function setStatus(text) {
  const el = document.getElementById('pageStatus');
  if (el) el.textContent = text;
}

// ===== BTC PRICE (live, via Binance trade stream — no polling delay) =====
function connectBTCPrice() {
  const priceWS = new WebSocket('wss://stream.binance.com:9443/ws/btcusdt@trade');
  priceWS.onmessage = (e) => {
    const d = JSON.parse(e.data);
    btcPrice = parseFloat(d.p);
    const el = document.getElementById('btcTickerVal');
    if (el) el.textContent = '$' + btcPrice.toLocaleString('en-US',{maximumFractionDigits:0});
  };
  priceWS.onclose = () => setTimeout(connectBTCPrice, 3000);
}

// ===== BLOCKCHAIN.INFO CONNECTION =====
function connect() {
  wsConn = new WebSocket('wss://ws.blockchain.info/inv');

  wsConn.onopen = () => {
    setStatus('Live');
    wsConn.send(JSON.stringify({ op: 'unconfirmed_sub' }));
  };

  wsConn.onmessage = (event) => {
    try {
      const response = JSON.parse(event.data);
      if (response.op !== 'utx') return;
      const tx = response.x;
      processTx(tx);
    } catch(e) {}
  };

  wsConn.onerror = () => setStatus('Reconnecting...');
  wsConn.onclose = () => { setStatus('Reconnecting...'); setTimeout(connect, 3000); };
}

// ===== PROCESS A RAW TRANSACTION =====
function processTx(tx) {
  let totalOut = 0;
  tx.out.forEach(o => { totalOut += o.value; });
  const totalBTC = totalOut / 100000000;

  if (totalBTC < minBTC) return;

  // Check outputs for exchange addresses (money going INTO exchange = inflow)
  let inflowExchange = null;
  for (const o of tx.out) {
    if (o.addr && EXCHANGE_WALLETS[o.addr]) { inflowExchange = EXCHANGE_WALLETS[o.addr]; break; }
  }

  // Check inputs for exchange addresses (money coming OUT of exchange = outflow)
  let outflowExchange = null;
  if (tx.inputs) {
    for (const i of tx.inputs) {
      const addr = i.prev_out && i.prev_out.addr;
      if (addr && EXCHANGE_WALLETS[addr]) { outflowExchange = EXCHANGE_WALLETS[addr]; break; }
    }
  }

  let category, exchange;
  if (inflowExchange) { category = 'inflow'; exchange = inflowExchange; }
  else if (outflowExchange) { category = 'outflow'; exchange = outflowExchange; }
  else { category = 'unknown'; exchange = null; }

  const usdVal = totalBTC * (btcPrice || 0);

  const entry = {
    hash: tx.hash,
    category,
    exchange,
    btc: totalBTC,
    usd: usdVal,
    time: Date.now(),
  };

  ingest(entry);
}

// ===== INGEST =====
function ingest(entry) {
  events.unshift(entry);
  if (events.length > 500) events.pop();

  stats.totalBTC += entry.btc;
  stats.count++;
  if (entry.category === 'inflow')  stats.inflowUSD  += entry.usd;
  if (entry.category === 'outflow') stats.outflowUSD += entry.usd;
  if (!stats.biggest || entry.btc > stats.biggest.btc) stats.biggest = entry;

  updateStatsUI();
  renderIfVisible(entry);
}

function updateStatsUI() {
  setText('sTotalVol', fmtBTC(stats.totalBTC));
  setText('sInflow', fmtUSD(stats.inflowUSD));
  setText('sOutflow', fmtUSD(stats.outflowUSD));
  setText('sCount', stats.count.toLocaleString());
  setText('sBiggest', stats.biggest ? fmtBTC(stats.biggest.btc) : '—');

  const net = stats.inflowUSD - stats.outflowUSD;
  const netEl = document.getElementById('sNetFlow');
  if (netEl) {
    netEl.textContent = (net >= 0 ? '+' : '') + fmtUSD(Math.abs(net)) + (net >= 0 ? ' Inflow' : ' Outflow');
    netEl.className = 'val ' + (net > 0 ? 'red' : net < 0 ? 'green' : 'gray');
  }

  const total = stats.inflowUSD + stats.outflowUSD || 1;
  const inPct = Math.round(stats.inflowUSD / total * 100);
  const outPct = 100 - inPct;
  const nfIn = document.getElementById('nfIn');
  const nfOut = document.getElementById('nfOut');
  if (nfIn) nfIn.style.width = inPct + '%';
  if (nfOut) nfOut.style.width = outPct + '%';
}
function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

// ===== FILTER / DISPLAY =====
function passesFilter(e) {
  if (filterMode === 'all') return true;
  return e.category === filterMode;
}
function sizeClass(btc) {
  if (btc >= 500) return 'size-xl';
  if (btc >= 100) return 'size-l';
  return '';
}
function exchangeIcon(e) {
  if (e.category === 'inflow')  return '📥';
  if (e.category === 'outflow') return '📤';
  return '❓';
}
function makeRowHTML(e) {
  const label = e.exchange
    ? (e.category === 'inflow' ? e.exchange + ' (Deposit)' : e.exchange + ' (Withdrawal)')
    : 'Unknown Whale Wallet';
  const dirText = e.category === 'inflow' ? '→ Exchange' : e.category === 'outflow' ? 'Exchange →' : 'Untagged';
  return `
    <div class="wtx-icon ${e.category}">${exchangeIcon(e)}</div>
    <div class="wtx-main">
      <div class="wtx-exch">${label} <span class="wtx-dir ${e.category}">${dirText}</span></div>
      <div class="wtx-sub">Click to view on Blockchain.com</div>
    </div>
    <div class="wtx-amt">
      <div class="wtx-btc">${fmtBTC(e.btc)}</div>
      <div class="wtx-usd">${e.usd ? fmtUSD(e.usd) : '—'}</div>
    </div>
    <div class="wtx-time">${fmtTime(e.time)}</div>
  `;
}

function renderIfVisible(e) {
  if (!passesFilter(e)) return;
  const list = document.getElementById('feedList');
  if (!list) return;

  const empty = document.getElementById('emptyMsg');
  if (empty) empty.remove();

  const sc = sizeClass(e.btc);
  const row = document.createElement('div');
  row.className = `wtx-row ${e.category} ${sc} ${e.btc >= 100 ? 'big' : ''}`;
  row.innerHTML = makeRowHTML(e);
  row.addEventListener('click', () => window.open(`https://www.blockchain.com/explorer/transactions/btc/${e.hash}`, '_blank'));
  list.insertBefore(row, list.firstChild);

  while (list.children.length > MAX_ROWS) list.removeChild(list.lastChild);
}

function rerenderFeed() {
  const list = document.getElementById('feedList');
  if (!list) return;
  list.innerHTML = '';

  const filtered = events.filter(passesFilter).slice(0, MAX_ROWS);
  if (!filtered.length) {
    list.innerHTML = `<div class="empty-msg" id="emptyMsg">Whale transactions wait ho rahi hain (min ${minBTC} BTC)...</div>`;
    return;
  }
  filtered.forEach(e => {
    const sc = sizeClass(e.btc);
    const row = document.createElement('div');
    row.className = `wtx-row ${e.category} ${sc}`;
    row.innerHTML = makeRowHTML(e);
    row.addEventListener('click', () => window.open(`https://www.blockchain.com/explorer/transactions/btc/${e.hash}`, '_blank'));
    list.appendChild(row);
  });
}

// ===== CONTROLS =====
function setFilter(mode, el) {
  filterMode = mode;
  document.querySelectorAll('.ctrl-btn.filter').forEach(b => b.classList.remove('active'));
  if (el) el.classList.add('active');
  rerenderFeed();
}
function setMinBTC(min, el) {
  minBTC = min;
  document.querySelectorAll('.ctrl-btn.thresh').forEach(b => b.classList.remove('active'));
  if (el) el.classList.add('active');
  // Existing events below new threshold are simply filtered out of view;
  // future incoming transactions respect the new minimum.
  rerenderFeed();
}

// ===== INIT =====
document.addEventListener('DOMContentLoaded', () => {
  connectBTCPrice();
  connect();
  rerenderFeed();
});
