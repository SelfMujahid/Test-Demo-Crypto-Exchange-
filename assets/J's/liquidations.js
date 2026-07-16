// =====================================================
// LIQUIDATIONS.JS
// Real-time feed from Binance Futures forceOrder stream.
//
// IMPORTANT HONESTY NOTE: Binance is the only major exchange
// that publicly broadcasts a free, no-key-required real-time
// liquidation stream. Coinbase and most other exchanges do NOT
// expose liquidation data via any public/free API — historical
// or live. Multi-exchange liquidation dashboards you may have
// seen elsewhere use paid/private data deals, not free public APIs.
//
// So: "24h/4h/1h by exchange" here means "Binance USDT-M Futures,
// rolling window since this page was opened" — not a fabricated
// full 24-hour history, since no free source for that exists.
// =====================================================

let ws = null;
let events = [];          // { sym, category, price, usdVal, time }
let filterMode = 'all';   // 'all' | 'long' | 'short'
let windowMode = 'session'; // 'session' | '1h' | '4h' | '24h'

const MAX_ROWS = 60;

function fmtUSD(n) {
  if (n >= 1e9) return '$'+(n/1e9).toFixed(2)+'B';
  if (n >= 1e6) return '$'+(n/1e6).toFixed(2)+'M';
  if (n >= 1e3) return '$'+(n/1e3).toFixed(1)+'K';
  return '$'+n.toFixed(0);
}
function fmtPrice(n) {
  if (n >= 1000) return n.toLocaleString('en-US',{maximumFractionDigits:2});
  if (n >= 1) return n.toFixed(3);
  return n.toFixed(6);
}

function connect() {
  ws = new WebSocket('wss://fstream.binance.com/ws/!forceOrder@arr');

  ws.onopen = () => setStatus('Live');

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      const o = msg.o;
      if (!o) return;

      const sym    = o.s.replace('USDT','').replace('USDC','').replace('BUSD','');
      const side   = o.S; // 'SELL' = long liquidated, 'BUY' = short liquidated
      const price  = parseFloat(o.ap || o.p);
      const qty    = parseFloat(o.z || o.q);
      const usdVal = price * qty;

      if (!usdVal || usdVal < 100) return;

      const category = side === 'SELL' ? 'long' : 'short';
      const ev = { sym, category, price, usdVal, time: Date.now() };

      events.unshift(ev);
      if (events.length > 2000) events.pop(); // keep enough for 24h window calc

      updateStats();
      renderIfVisible(ev);
    } catch(e) {}
  };

  ws.onerror = () => setStatus('Reconnecting...');
  ws.onclose = () => { setStatus('Reconnecting...'); setTimeout(connect, 3000); };
}

function setStatus(text) {
  const el = document.getElementById('pageStatus');
  if (el) el.textContent = text;
}

// ===== WINDOW FILTERING =====
function windowMs() {
  if (windowMode === '1h')  return 60*60*1000;
  if (windowMode === '4h')  return 4*60*60*1000;
  if (windowMode === '24h') return 24*60*60*1000;
  return Infinity; // 'session' = since page opened
}

function eventsInWindow() {
  const cutoff = Date.now() - windowMs();
  return events.filter(e => e.time >= cutoff);
}

function updateStats() {
  const inWin = eventsInWindow();
  let total = 0, long = 0, short = 0;
  inWin.forEach(e => {
    total += e.usdVal;
    if (e.category === 'long') long += e.usdVal; else short += e.usdVal;
  });

  const elTotal = document.getElementById('sTotal');
  const elCount = document.getElementById('sCount');
  const elLong  = document.getElementById('sLong');
  const elShort = document.getElementById('sShort');
  if (elTotal) elTotal.textContent = fmtUSD(total);
  if (elCount) elCount.textContent = inWin.length.toLocaleString();
  if (elLong)  elLong.textContent  = fmtUSD(long);
  if (elShort) elShort.textContent = fmtUSD(short);
}

function sizeClass(usdVal) {
  if (usdVal >= 500000) return 'size-xl';
  if (usdVal >= 100000) return 'size-l';
  if (usdVal >= 25000)  return 'size-m';
  return '';
}

function passesFilter(ev) {
  if (filterMode !== 'all' && ev.category !== filterMode) return false;
  const cutoff = Date.now() - windowMs();
  return ev.time >= cutoff;
}

function makeRowHTML(ev) {
  return `
    <div class="liq-side ${ev.category}">${ev.category === 'long' ? 'LONG' : 'SHORT'}</div>
    <div class="liq-sym">${ev.sym}<small>USDT</small></div>
    <div class="liq-price">$${fmtPrice(ev.price)}</div>
    <div class="liq-usd ${ev.category}">${fmtUSD(ev.usdVal)}</div>
  `;
}

function renderIfVisible(ev) {
  if (!passesFilter(ev)) return;
  const list = document.getElementById('feedList');
  if (!list) return;

  const empty = document.getElementById('emptyMsg');
  if (empty) empty.remove();

  const sc = sizeClass(ev.usdVal);
  const row = document.createElement('div');
  row.className = `liq-row ${ev.category} ${sc} ${ev.usdVal >= 100000 ? 'big' : ''}`;
  row.innerHTML = makeRowHTML(ev);
  list.insertBefore(row, list.firstChild);

  while (list.children.length > MAX_ROWS) {
    list.removeChild(list.lastChild);
  }
}

function rerenderFeed() {
  const list = document.getElementById('feedList');
  if (!list) return;
  list.innerHTML = '';

  const filtered = events.filter(passesFilter).slice(0, MAX_ROWS);
  if (!filtered.length) {
    list.innerHTML = `
      <div class="empty-msg" id="emptyMsg">Is window mein abhi koi liquidation nahi hui.</div>
      <div class="exchange-note">Sirf Binance Futures real-time liquidation data publicly available hai. Coinbase aur baaki exchanges yeh data public API se nahi dete.</div>
    `;
    return;
  }
  filtered.forEach(ev => {
    const sc = sizeClass(ev.usdVal);
    const row = document.createElement('div');
    row.className = `liq-row ${ev.category} ${sc}`;
    row.innerHTML = makeRowHTML(ev);
    list.appendChild(row);
  });
}

function setFilter(mode, el) {
  filterMode = mode;
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  if (el) el.classList.add('active');
  rerenderFeed();
}

function setWindow(mode, el) {
  windowMode = mode;
  document.querySelectorAll('.win-btn').forEach(b => b.classList.remove('active'));
  if (el) el.classList.add('active');
  updateStats();
  rerenderFeed();
}

// Periodically refresh stats/feed so time-window boundaries stay accurate
// even when no new liquidation event has just arrived
setInterval(() => { updateStats(); }, 15000);

// ===== INIT =====
document.addEventListener('DOMContentLoaded', () => {
  connect();
  updateStats();
  rerenderFeed();
});
