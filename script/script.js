// ===== STATE =====
let allCoins = [];       // full data from CoinGecko REST
let livePrices = {};     // price updates from Binance WSS
let currentFilter = 'all';
let currentSort = 'rank';
let sortAsc = true;
let searchQuery = '';
let wsRetries = 0;
let cgRefreshTimer = null;

// ===== STEP 1: REST API — Binance prices + CoinGecko logos =====
async function fetchTop100() {
  try {
    const binRes = await fetch('https://api.binance.com/api/v3/ticker/24hr');
    if (!binRes.ok) throw new Error('Binance fetch failed (HTTP ' + binRes.status + ')');
    const binData = await binRes.json();

    const usdtPairs = binData
      .filter(t => t.symbol.endsWith('USDT') && !t.symbol.includes('DOWN') && !t.symbol.includes('UP') && !t.symbol.includes('BULL') && !t.symbol.includes('BEAR'))
      .sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
      .slice(0, 100);

    // CoinGecko fetch isolated in its own try/catch — if it fails (CORS/rate limit),
    // Binance data still renders instead of the whole page erroring out.
    const cgMap = await fetchCoinGeckoMap();

    allCoins = [];
    let rank = 1;
    usdtPairs.forEach(t => {
      const sym = t.symbol.replace('USDT', '');
      const cg = cgMap[sym];
      allCoins.push({
        rank:     cg ? cg.rank || rank : rank,
        id:       sym.toLowerCase(),
        sym:      sym,
        name:     cg ? cg.name : sym,
        logo:     cg ? cg.logo : '',
        price:    parseFloat(t.lastPrice),
        change1h: cg ? cg.change1h : 0,
        change:   parseFloat(t.priceChangePercent),
        mcap:     cg ? cg.mcap : 0,
        vol:      parseFloat(t.quoteVolume),
      });
      rank++;
    });

    allCoins.sort((a, b) => (b.mcap || 0) - (a.mcap || 0));
    allCoins.forEach((c, i) => c.rank = i + 1);
    allCoins.forEach(co => { livePrices[co.sym + 'USDT'] = co.price; });

    updateStats();
    renderList();
    connectBinanceWS();
    startCoinGeckoAutoRefresh();

  } catch (e) {
    console.error(e);
    const listEl = document.getElementById('coinList');
    if (listEl) {
      listEl.innerHTML = `<div class="loading" style="color:var(--red)">⚠️ Data load nahi hua.<br>Internet check karein ya refresh karein.<br><small>${e.message}</small></div>`;
    }
  }
}

// Duplicate ticker symbols across CoinGecko entries are resolved by keeping
// the HIGHER market-cap coin, so wrong logo/name doesn't win by accident.
async function fetchCoinGeckoMap() {
  const cgMap = {};
  try {
    const cgRes = await fetch('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=100&page=1&sparkline=false&price_change_percentage=1h%2C24h');
    if (!cgRes.ok) {
      console.warn('CoinGecko responded with', cgRes.status, '— continuing with Binance-only data.');
      return cgMap;
    }
    const cgData = await cgRes.json();
    cgData.forEach(coin => {
      const key = coin.symbol.toUpperCase();
      const mcap = coin.market_cap || 0;
      if (!cgMap[key] || mcap > (cgMap[key].mcap || 0)) {
        cgMap[key] = {
          name:     coin.name,
          logo:     coin.image,
          mcap:     mcap,
          rank:     coin.market_cap_rank,
          change1h: coin.price_change_percentage_1h_in_currency || 0,
        };
      }
    });
  } catch (cgErr) {
    console.warn('CoinGecko fetch failed (rate limit or CORS?), using Binance-only data:', cgErr);
  }
  return cgMap;
}

// CoinGecko-derived fields (1h%, mcap, rank, logo) don't update from the Binance
// WS stream, so they'd freeze at page-load values. This refreshes them every 60s
// (safely under CoinGecko's free-tier rate limit).
function startCoinGeckoAutoRefresh() {
  if (cgRefreshTimer) clearInterval(cgRefreshTimer);
  cgRefreshTimer = setInterval(async () => {
    const cgMap = await fetchCoinGeckoMap();
    if (!Object.keys(cgMap).length) return;
    allCoins.forEach(c => {
      const cg = cgMap[c.sym];
      if (cg) {
        c.name     = cg.name || c.name;
        c.logo     = cg.logo || c.logo;
        c.mcap     = cg.mcap || c.mcap;
        c.rank     = cg.rank || c.rank;
        c.change1h = cg.change1h;
      }
    });
    updateStats();
    renderList();
  }, 60000);
}

// ===== STEP 2: Binance WebSocket =====
let ws;
function connectBinanceWS() {
  const pairs = allCoins.slice(0, 50).map(c => c.sym.toLowerCase() + 'usdt@ticker').join('/');
  const wsUrl = `wss://stream.binance.com:9443/stream?streams=${pairs}`;

  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    setWsStatus('connected', 'Live');
    wsRetries = 0;
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (!msg.data) return;
      const d = msg.data;
      const sym = d.s;
      const price = parseFloat(d.c);
      const change = parseFloat(d.P);
      if (!isNaN(price)) {
        const old = livePrices[sym];
        livePrices[sym] = price;
        if (old && old !== price) {
          flashPrice(sym, price > old ? 'up' : 'down');
        }
        const coin = allCoins.find(c => c.sym + 'USDT' === sym);
        if (coin) {
          coin.price  = price;
          coin.change = change;
        }
        updatePriceCell(sym, price, change);
        updateStats();
      }
    } catch (e) {}
  };

  ws.onerror = () => setWsStatus('error', 'Error');
  ws.onclose = () => {
    setWsStatus('', 'Reconnecting...');
    wsRetries++;
    if (wsRetries < 5) setTimeout(connectBinanceWS, 3000);
    else setWsStatus('error', 'Disconnected');
  };
}

function setWsStatus(cls, label) {
  const dot = document.getElementById('wsDot');
  const lbl = document.getElementById('wsLabel');
  if (dot) dot.className = 'ws-dot ' + cls;
  if (lbl) lbl.textContent = label;
}

function updatePriceCell(sym, price, change) {
  const el = document.getElementById('price-' + sym);
  const chEl = document.getElementById('change-' + sym);
  if (el) el.textContent = '$' + fmtPrice(price);
  if (chEl) {
    const up = change >= 0;
    chEl.textContent = (up ? '▲ +' : '▼ ') + Math.abs(change).toFixed(2) + '%';
    chEl.className = 'change-cell ' + (up ? 'up' : 'down');
  }
}

function flashPrice(sym, dir) {
  const el = document.getElementById('price-' + sym);
  if (!el) return;
  el.classList.remove('flash-up', 'flash-down');
  void el.offsetWidth;
  el.classList.add(dir === 'up' ? 'flash-up' : 'flash-down');
  setTimeout(() => el.classList.remove('flash-up', 'flash-down'), 600);
}

// ===== RENDER FULL LIST =====
function renderList() {
  let coins = [...allCoins];

  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    coins = coins.filter(c => c.name.toLowerCase().includes(q) || c.sym.toLowerCase().includes(q));
  }

  if (currentFilter === 'top10')   coins = coins.slice(0, 10);
  if (currentFilter === 'gainers') coins = coins.filter(c => c.change > 0).sort((a, b) => b.change - a.change).slice(0, 20);
  if (currentFilter === 'losers')  coins = coins.filter(c => c.change < 0).sort((a, b) => a.change - b.change).slice(0, 20);

  if (currentSort === 'rank')     coins.sort((a, b) => sortAsc ? a.rank - b.rank : b.rank - a.rank);
  if (currentSort === 'price')    coins.sort((a, b) => sortAsc ? a.price - b.price : b.price - a.price);
  if (currentSort === 'change1h') coins.sort((a, b) => sortAsc ? a.change1h - b.change1h : b.change1h - a.change1h);
  if (currentSort === 'change')   coins.sort((a, b) => sortAsc ? a.change - b.change : b.change - a.change);
  if (currentSort === 'mcap')     coins.sort((a, b) => sortAsc ? a.mcap - b.mcap : b.mcap - a.mcap);

  const listEl = document.getElementById('coinList');
  if (!listEl) return;

  if (!coins.length) {
    listEl.innerHTML = `<div class="loading" style="padding:30px">Koi coin nahi mila 🔍</div>`;
    return;
  }

  listEl.innerHTML = coins.map(c => {
    const up = c.change >= 0;
    const sym = c.sym + 'USDT';
    return `
    <div class="coin-row" onclick="goToCoin('${c.sym}')">
      <div class="rank">${c.rank}</div>
      <div class="coin-info">
        <img src="${c.logo}" alt="${c.sym}" class="coin-logo" onerror="this.outerHTML='<div class=coin-logo-placeholder>${c.sym.slice(0, 2)}</div>'"/>
        <div class="coin-name-wrap">
          <div class="coin-name">${c.name}</div>
          <div class="coin-sym">${c.sym}</div>
        </div>
      </div>
      <div class="price-cell" id="price-${sym}">$${fmtPrice(c.price)}</div>
      <div>
        <div class="change-cell ${c.change1h >= 0 ? 'up' : 'down'}" id="change1h-${sym}">
          ${c.change1h >= 0 ? '▲ +' : '▼ '}${Math.abs(c.change1h).toFixed(2)}%
        </div>
      </div>
      <div>
        <div class="change-cell ${up ? 'up' : 'down'}" id="change-${sym}">
          ${up ? '▲ +' : '▼ '}${Math.abs(c.change).toFixed(2)}%
        </div>
      </div>
      <div class="mcap-cell">${fmtLarge(c.mcap)}</div>
      <div class="vol-cell">${fmtLarge(c.vol)}</div>
    </div>`;
  }).join('');
}

// ===== STATS =====
function updateStats() {
  const btc = allCoins.find(c => c.sym === 'BTC');
  const btcEl = document.getElementById('btcPrice');
  const totalEl = document.getElementById('totalCoins');
  const mcapEl = document.getElementById('globalMcap');

  if (btc && btcEl) btcEl.textContent = '$' + fmtPrice(btc.price);
  if (totalEl) totalEl.textContent = allCoins.length;

  if (mcapEl) {
    const totalMcap = allCoins.reduce((s, c) => s + (c.mcap || 0), 0);
    mcapEl.textContent = fmtLarge(totalMcap);
  }
}

// ===== CONTROLS =====
function setFilter(f, el) {
  currentFilter = f;
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  el.classList.add('active');
  renderList();
}

function sortBy(col) {
  if (currentSort === col) sortAsc = !sortAsc;
  else { currentSort = col; sortAsc = false; }
  renderList();
}

function goToCoin(sym) { /* Future Extension */ }

// ===== FORMATTERS =====
function fmtPrice(n) {
  if (!n) return '—';
  if (n >= 1000)  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (n >= 1)     return n.toFixed(4);
  if (n >= 0.01)  return n.toFixed(5);
  return n.toFixed(8);
}

function fmtLarge(n) {
  if (!n) return '—';
  if (n >= 1e12) return '$' + (n / 1e12).toFixed(2) + 'T';
  if (n >= 1e9)  return '$' + (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6)  return '$' + (n / 1e6).toFixed(2) + 'M';
  return '$' + n.toLocaleString();
}

// ===== DEMO BALANCE =====
function getBal() { return parseFloat(localStorage.getItem('demoBalance') || 10000); }
function renderHomeBalance() {
  const b = getBal();
  const diff = b - 10000;
  const pct = ((diff / 10000) * 100).toFixed(2);
  const whole = Math.floor(b).toLocaleString('en-US');
  const dec = (b % 1).toFixed(2).substring(1);

  const balEl = document.getElementById('homeBalance');
  const chgEl = document.getElementById('homeChange');
  const availEl = document.getElementById('availBal');
  const pnlEl = document.getElementById('homePnl');

  if (balEl) balEl.innerHTML = '$' + whole + '<span>' + dec + '</span>';
  if (chgEl) {
    if (diff === 0) { chgEl.textContent = 'Starting Balance'; chgEl.style.color = 'var(--muted)'; }
    else { const s = diff >= 0 ? '+' : ''; chgEl.textContent = s + '$' + Math.abs(diff).toFixed(2) + ' (' + s + pct + '%)'; chgEl.style.color = diff >= 0 ? 'var(--green)' : 'var(--red)'; }
  }
  if (availEl) availEl.textContent = '$' + b.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (pnlEl) {
    pnlEl.textContent = (diff >= 0 ? '+' : '') + '$' + Math.abs(diff).toFixed(2);
    pnlEl.className = 'bstat-value ' + (diff >= 0 ? 'g' : 'r');
  }
}

// ===== UI MENUS =====
function toggleVisualMenu(event) {
  event.preventDefault();

  const menu = document.getElementById('visualMenu');
  const btn = event.currentTarget;
  const rect = btn.getBoundingClientRect();

  const menuWidth = 130;
  const padding = 10;

  let left = rect.right;
  let top = rect.bottom - 50;

  const screenWidth = window.innerWidth;

  if (left + menuWidth > screenWidth) {
    left = screenWidth - menuWidth - padding;
  }

  if (left < padding) {
    left = padding;
  }

  menu.style.display = 'block';
  menu.style.position = 'fixed';
  menu.style.left = left + 'px';
  menu.style.top = top + 'px';

  btn.classList.add('active');
}

// ===== INIT — THIS WAS MISSING ENTIRELY =====
// Nothing in this file was ever being called. fetchTop100() existed but was
// never invoked, so allCoins stayed empty forever and #coinList just sat on
// its static "loading..." HTML — regardless of whether Binance/CoinGecko
// worked or not. Same for renderHomeBalance() and the search box listener.
// Script tag is already at the bottom of <body> in index.html, so the DOM
// is guaranteed ready here — no need to wait for DOMContentLoaded.
fetchTop100();
renderHomeBalance();

const searchInput = document.getElementById('searchInput');
if (searchInput) {
  searchInput.addEventListener('input', e => {
    searchQuery = e.target.value.trim();
    renderList();
  });
}
