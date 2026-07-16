// =====================================================
// SPOT.JS — spot.html ONLY.
// Depends on common.js loaded first:
//   getBal(), setBal(), fmtPrice(), fmtLarge(), debounce(), toggleVisualMenu()
// =====================================================

// ===== STATE =====
let price = 0;
let currentSide = 'buy';   // 'buy' | 'sell'
let currentOT   = 'limit'; // 'limit' | 'market' | 'stoplimit'
let amtInUSDT   = true;    // true = USDT amount input, false = coin amount input
let openOrders  = [];      // { id, pair, side, type, price, amount, base, filled, total, time }
let coinHoldings = {};     // { 'BTC': 0.005, 'ETH': 1.2, ... }
let ws = null;

// rAF batch — price state instant, DOM writes per frame
let pendingSpotUpdate = null;
let spotRafScheduled  = false;

// fp = local alias for common.js fmtPrice
function fp(n) { return fmtPrice(n); }

// ===== HELPERS =====
function getBase() {
  const pairEl = document.getElementById('pairSel');
  return ((pairEl ? pairEl.value : 'BTC/USDT') || 'BTC/USDT').split('/')[0];
}
function getBaseSymbolLower() { return getBase().toLowerCase(); }
function getBinanceStreamSymbol() {
  const pairEl = document.getElementById('pairSel');
  const p = pairEl ? pairEl.value : 'BTC/USDT';
  return p.replace('/', '').toLowerCase();
}

// ===== BALANCE & HOLDINGS =====
function getUSDT() { return getBal(); }
function getCoinHolding(sym) { return coinHoldings[sym] || 0; }

function renderBalances() {
  const usdt = getUSDT();
  const base = getBase();
  const coin = getCoinHolding(base);

  const usdtEl = document.getElementById('availUSDT');
  const coinEl = document.getElementById('availCoin');
  const availLbl = document.getElementById('availLbl');

  if (usdtEl) usdtEl.textContent = '$' + usdt.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (coinEl) coinEl.textContent = coin.toFixed(6) + ' ' + base;

  // Show relevant balance depending on buy vs sell side
  if (availLbl) {
    if (currentSide === 'buy') {
      availLbl.textContent = 'Avail: $' + usdt.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    } else {
      availLbl.textContent = 'Avail: ' + coin.toFixed(6) + ' ' + base;
    }
  }
}

// ===== PAIR LOADING =====
async function fetchAllPairs() {
  const pairSel = document.getElementById('pairSel');
  const pairLoadStatus = document.getElementById('pairLoadStatus');
  try {
    const res = await fetch('https://api.binance.com/api/v3/exchangeInfo');
    if (!res.ok) throw new Error();
    const data = await res.json();
    const usdtPairs = data.symbols
      .filter(s => s.quoteAsset === 'USDT' && s.status === 'TRADING'
        && !s.baseAsset.includes('DOWN') && !s.baseAsset.includes('UP')
        && !s.baseAsset.includes('BULL') && !s.baseAsset.includes('BEAR'))
      .map(s => s.baseAsset + '/USDT')
      .sort();
    if (pairSel) {
      pairSel.innerHTML = usdtPairs.map(p =>
        `<option${p === 'BTC/USDT' ? ' selected' : ''}>${p}</option>`
      ).join('');
    }
    if (pairLoadStatus) pairLoadStatus.textContent = usdtPairs.length + ' pairs';
    triggerLogoUpdate();
    connectWS();
  } catch (e) {
    if (pairLoadStatus) pairLoadStatus.textContent = 'Load failed';
    const fallback = ['BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'BNB/USDT', 'XRP/USDT'];
    if (pairSel) pairSel.innerHTML = fallback.map(p => `<option${p === 'BTC/USDT' ? ' selected' : ''}>${p}</option>`).join('');
    triggerLogoUpdate();
    connectWS();
  }
}

// ===== WEBSOCKET =====
function connectWS() {
  if (ws) ws.close();
  price = 0;
  const pairPrice = document.getElementById('pairPrice');
  if (pairPrice) pairPrice.textContent = 'Loading...';

  const streamSym = getBinanceStreamSymbol();
  ws = new WebSocket(`wss://stream.binance.com:9443/stream?streams=${streamSym}@ticker/${streamSym}@depth20@100ms`);

  ws.onmessage = e => {
    try {
      const raw = JSON.parse(e.data);
      const isCombined = raw.stream && raw.data;
      const d = isCombined ? raw.data : raw;
      const streamType = isCombined ? raw.stream : '';

      if (!streamType || streamType.endsWith('@ticker')) {
        price = parseFloat(d.c);
        const chg = parseFloat(d.P);
        calcCost();
        pendingSpotUpdate = { price, chg, high: d.h, low: d.l, vol: d.q };
        if (!spotRafScheduled) {
          spotRafScheduled = true;
          requestAnimationFrame(flushSpotTicker);
        }
        if (!d.b) renderOB();
      }

      if (streamType && streamType.endsWith('@depth20@100ms')) {
        renderLiveOrderBook(d.b, d.a);
      }
    } catch (err) { console.error('WS error:', err); }
  };
}

function flushSpotTicker() {
  spotRafScheduled = false;
  if (!pendingSpotUpdate) return;
  const { price: p, chg, high, low, vol } = pendingSpotUpdate;
  pendingSpotUpdate = null;

  const pairPrice = document.getElementById('pairPrice');
  const pairChg   = document.getElementById('pairChg');
  const sHigh     = document.getElementById('s-high');
  const sLow      = document.getElementById('s-low');
  const sVol      = document.getElementById('s-vol');
  const obMidP    = document.getElementById('obMidP');
  const iPrice    = document.getElementById('iPrice');

  if (pairPrice) { pairPrice.textContent = '$' + fp(p); pairPrice.style.color = chg >= 0 ? 'var(--green)' : 'var(--red)'; }
  if (pairChg)   { pairChg.textContent = (chg >= 0 ? '+' : '') + chg.toFixed(2) + '%'; pairChg.style.background = chg >= 0 ? 'rgba(0,200,83,0.1)' : 'rgba(246,70,93,0.1)'; pairChg.style.color = chg >= 0 ? 'var(--green)' : 'var(--red)'; }
  if (sHigh)  sHigh.textContent  = '$' + fp(parseFloat(high));
  if (sLow)   sLow.textContent   = '$' + fp(parseFloat(low));
  if (sVol)   sVol.textContent   = fmtLarge(parseFloat(vol));
  if (obMidP) { obMidP.textContent = '$' + fp(p); obMidP.style.color = chg >= 0 ? 'var(--green)' : 'var(--red)'; }
  if (iPrice && currentOT === 'market') iPrice.placeholder = fp(p);
}

// ===== ORDER BOOK =====
function renderLiveOrderBook(bids, asks) {
  const askRows = document.getElementById('askRows');
  const bidRows = document.getElementById('bidRows');
  const obSpread = document.getElementById('obSpread');
  if (!askRows || !bidRows) return;

  let ah = '', bh = '', tA = 0, tB = 0;

  if (asks && asks.length) {
    const cleanAsks = asks.slice(0, 8).map(a => ({ p: parseFloat(a[0]), q: parseFloat(a[1]) })).reverse();
    cleanAsks.forEach(r => tA += r.q);
    cleanAsks.forEach(r => { const pct = tA > 0 ? (r.q / tA * 100).toFixed(0) : 0; ah += `<div class="ob-row"><span class="ap">${fp(r.p)}</span><span>${r.q.toFixed(4)}</span><span>${(r.p * r.q).toFixed(0)}</span><div class="ob-bar" style="background:var(--red);width:${pct}%"></div></div>`; });
    askRows.innerHTML = ah;
  }
  if (bids && bids.length) {
    const cleanBids = bids.slice(0, 8).map(b => ({ p: parseFloat(b[0]), q: parseFloat(b[1]) }));
    cleanBids.forEach(r => tB += r.q);
    cleanBids.forEach(r => { const pct = tB > 0 ? (r.q / tB * 100).toFixed(0) : 0; bh += `<div class="ob-row"><span class="bp">${fp(r.p)}</span><span>${r.q.toFixed(4)}</span><span>${(r.p * r.q).toFixed(0)}</span><div class="ob-bar" style="background:var(--green);width:${pct}%"></div></div>`; });
    bidRows.innerHTML = bh;
  }
  if (obSpread && asks && bids && asks.length && bids.length) {
    const spread = parseFloat(asks[0][0]) - parseFloat(bids[0][0]);
    obSpread.textContent = '$' + (spread >= 0 ? spread.toFixed(2) : '0.00');
  }
}

function renderOB() {
  if (!price || isNaN(price)) return;
  let ah = '', bh = '', tA = 0, tB = 0;
  const aR = [], bR = [];
  for (let i = 8; i >= 1; i--) { const p = price + i * price * 0.00012 + Math.random() * price * 0.00005; const q = +(Math.random() * 1.5 + 0.01).toFixed(4); tA += q; aR.push({ p, q }); }
  for (let i = 1; i <= 8; i++) { const p = price - i * price * 0.00012 - Math.random() * price * 0.00005; const q = +(Math.random() * 1.5 + 0.01).toFixed(4); tB += q; bR.push({ p, q }); }
  aR.forEach(r => { const pct = (r.q / tA * 100).toFixed(0); ah += `<div class="ob-row"><span class="ap">${fp(r.p)}</span><span>${r.q}</span><span>${(r.p * r.q).toFixed(0)}</span><div class="ob-bar" style="background:var(--red);width:${pct}%"></div></div>`; });
  bR.forEach(r => { const pct = (r.q / tB * 100).toFixed(0); bh += `<div class="ob-row"><span class="bp">${fp(r.p)}</span><span>${r.q}</span><span>${(r.p * r.q).toFixed(0)}</span><div class="ob-bar" style="background:var(--green);width:${pct}%"></div></div>`; });
  const askRows = document.getElementById('askRows');
  const bidRows = document.getElementById('bidRows');
  const obSpread = document.getElementById('obSpread');
  if (askRows && !askRows.innerHTML) askRows.innerHTML = ah;
  if (bidRows && !bidRows.innerHTML) bidRows.innerHTML = bh;
  if (obSpread && obSpread.textContent === '—') obSpread.textContent = '$' + (aR[0].p - bR[0].p).toFixed(2);
}

function renderRecentTrades() {
  if (!price || isNaN(price)) return;
  const rtRows = document.getElementById('rtRows');
  if (!rtRows) return;
  let h = '';
  for (let i = 0; i < 14; i++) {
    const tp = price + (Math.random() - 0.5) * price * 0.001;
    const tq = (Math.random() * 0.4 + 0.001).toFixed(4);
    const up = Math.random() > 0.5;
    const t = new Date().toLocaleTimeString('en-US', { hour12: false });
    h += `<div class="rt-row"><span style="color:${up ? 'var(--green)' : 'var(--red)'}">${fp(tp)}</span><span>${tq}</span><span>${t}</span></div>`;
  }
  rtRows.innerHTML = h;
}

// ===== COST CALCULATION =====
function calcCost() {
  const iPrice = document.getElementById('iPrice');
  const iAmt   = document.getElementById('iAmt');
  const p   = (currentOT === 'market') ? price : (parseFloat(iPrice ? iPrice.value : 0) || price || 0);
  const raw = parseFloat(iAmt ? iAmt.value : 0) || 0;
  if (!p || isNaN(p)) return;

  const coinAmt = amtInUSDT ? (p > 0 ? raw / p : 0) : raw;
  const total   = p * coinAmt;
  const fee     = total * 0.001; // spot 0.1% fee (standard)

  const cTotal  = document.getElementById('cTotal');
  const cCoin   = document.getElementById('cCoin');
  const cFee    = document.getElementById('cFee');
  const cFinal  = document.getElementById('cFinal');

  if (cTotal)  cTotal.textContent  = total   ? '$' + total.toFixed(2)        : '—';
  if (cCoin)   cCoin.textContent   = coinAmt ? coinAmt.toFixed(6) + ' ' + getBase() : '—';
  if (cFee)    cFee.textContent    = fee      ? '$' + fee.toFixed(4)          : '—';
  if (cFinal) {
    const final = currentSide === 'buy' ? total + fee : total - fee;
    cFinal.textContent = final ? '$' + final.toFixed(2) : '—';
    cFinal.style.color = currentSide === 'buy' ? 'var(--red)' : 'var(--green)';
  }
}

// ===== AMOUNT MODE TOGGLE =====
function toggleAmtMode() {
  amtInUSDT = !amtInUSDT;
  const base    = getBase();
  const iSuffix = document.getElementById('iSuffix');
  const iAmt    = document.getElementById('iAmt');
  if (iSuffix) iSuffix.textContent = amtInUSDT ? 'USDT' : base;
  if (iAmt)    { iAmt.value = ''; iAmt.placeholder = amtInUSDT ? '0.00' : '0.000000'; }
  calcCost();
}

// ===== PLACE ORDER =====
function placeOrder() {
  const iPrice  = document.getElementById('iPrice');
  const iAmt    = document.getElementById('iAmt');
  const pairSel = document.getElementById('pairSel');

  const p   = (currentOT === 'market') ? price : (parseFloat(iPrice ? iPrice.value : 0) || price);
  const raw = parseFloat(iAmt ? iAmt.value : 0);

  if (!raw || raw <= 0) { alert('Amount enter karein'); return; }
  if (!p || isNaN(p) || p === 0) { alert('Price load nahi hua, thoda wait karein'); return; }

  const coinAmt = amtInUSDT ? raw / p : raw;
  const total   = p * coinAmt;
  const fee     = total * 0.001;
  const base    = getBase();

  if (currentSide === 'buy') {
    const cost = total + fee;
    if (getUSDT() < cost) { alert('USDT balance kam hai!\nZaroorat: $' + cost.toFixed(2) + '\nAvailable: $' + getUSDT().toFixed(2)); return; }
    setBal(getUSDT() - cost);
    coinHoldings[base] = (coinHoldings[base] || 0) + coinAmt;
  } else {
    const holding = getCoinHolding(base);
    if (holding < coinAmt) { alert(base + ' balance kam hai!\nZaroorat: ' + coinAmt.toFixed(6) + '\nAvailable: ' + holding.toFixed(6)); return; }
    coinHoldings[base] = holding - coinAmt;
    setBal(getUSDT() + total - fee);
  }

  // Add to open orders table
  openOrders.push({
    id:     Date.now(),
    pair:   pairSel ? pairSel.value : 'BTC/USDT',
    base,
    side:   currentSide,
    type:   currentOT,
    price:  p,
    amount: coinAmt,
    total,
    fee,
    time:   new Date().toLocaleTimeString('en-US', { hour12: false }),
    status: currentOT === 'market' ? 'Filled' : 'Open',
  });

  renderBalances();
  renderOrders();
  if (iAmt) iAmt.value = '';
  calcCost();
}

// ===== CANCEL ORDER =====
window.cancelOrder = function(id) {
  const order = openOrders.find(o => o.id === id);
  if (order && order.status === 'Open') {
    // Refund margin for open limit orders
    if (order.side === 'buy') {
      setBal(getUSDT() + order.total + order.fee);
    } else {
      coinHoldings[order.base] = (coinHoldings[order.base] || 0) + order.amount;
    }
    renderBalances();
  }
  openOrders = openOrders.filter(o => o.id !== id);
  renderOrders();
};

// ===== RENDER ORDERS TABLE =====
function renderOrders() {
  const openCount   = document.getElementById('openCount');
  const histCount   = document.getElementById('histCount');
  const noPosMsg    = document.getElementById('noPosMsg');
  const posTable    = document.getElementById('posTable');
  const posBody     = document.getElementById('posBody');
  const histBody    = document.getElementById('histBody');
  const histTable   = document.getElementById('histTable');
  const noHistMsg   = document.getElementById('noHistMsg');

  const openList = openOrders.filter(o => o.status === 'Open');
  const histList = openOrders.filter(o => o.status === 'Filled');

  if (openCount) openCount.textContent = `(${openList.length})`;
  if (histCount) histCount.textContent = `(${histList.length})`;

  // Open orders
  if (!openList.length) {
    if (noPosMsg)  noPosMsg.style.display  = 'block';
    if (posTable)  posTable.style.display  = 'none';
  } else {
    if (noPosMsg)  noPosMsg.style.display  = 'none';
    if (posTable)  posTable.style.display  = 'table';
    if (posBody) {
      posBody.innerHTML = openList.map(o => `
        <tr>
          <td>${o.time}</td>
          <td><b>${o.pair}</b></td>
          <td><span style="color:${o.side==='buy'?'var(--long)':'var(--short)'};font-weight:700">${o.side.toUpperCase()}</span></td>
          <td style="text-transform:capitalize">${o.type}</td>
          <td>$${fp(o.price)}</td>
          <td>${o.amount.toFixed(6)} ${o.base}</td>
          <td>$${o.total.toFixed(2)}</td>
          <td><span style="color:var(--accent);font-weight:700">${o.status}</span></td>
          <td><button class="cls-btn" onclick="cancelOrder(${o.id})">Cancel</button></td>
        </tr>`
      ).join('');
    }
  }

  // Trade history
  if (!histList.length) {
    if (noHistMsg) noHistMsg.style.display = 'block';
    if (histTable) histTable.style.display = 'none';
  } else {
    if (noHistMsg) noHistMsg.style.display = 'none';
    if (histTable) histTable.style.display = 'table';
    if (histBody) {
      histBody.innerHTML = histList.map(o => `
        <tr>
          <td>${o.time}</td>
          <td><b>${o.pair}</b></td>
          <td><span style="color:${o.side==='buy'?'var(--long)':'var(--short)'};font-weight:700">${o.side.toUpperCase()}</span></td>
          <td style="text-transform:capitalize">${o.type}</td>
          <td>$${fp(o.price)}</td>
          <td>${o.amount.toFixed(6)} ${o.base}</td>
          <td>$${o.total.toFixed(2)}</td>
          <td style="color:var(--muted)">$${o.fee.toFixed(4)}</td>
          <td><span style="color:var(--green);font-weight:700">Filled</span></td>
        </tr>`
      ).join('');
    }
  }
}

// ===== COIN LOGO =====
function triggerLogoUpdate() {
  const logoEl = document.getElementById('coinLogo');
  if (!logoEl) return;
  if (document.getElementById('coinAvatarFallback')) document.getElementById('coinAvatarFallback').remove();
  logoEl.style.display = 'inline-block';
  logoEl.src = `https://raw.githubusercontent.com/spothq/cryptocurrency-icons/master/128/color/${getBaseSymbolLower()}.png`;
}

// ===== INIT =====
document.addEventListener('DOMContentLoaded', () => {
  const pairSel  = document.getElementById('pairSel');
  const iSuffix  = document.getElementById('iSuffix');
  const iAmt     = document.getElementById('iAmt');
  const iPrice   = document.getElementById('iPrice');
  const coinLogo = document.getElementById('coinLogo');
  const btnBuy   = document.getElementById('btnAction');

  // Chart button toggle — show/hide middle chart column
  const chartBtn = document.getElementById('chartToggleBtn');
  const tradeWrap = document.querySelector('.trade-wrap');
  if (chartBtn && tradeWrap) {
    chartBtn.addEventListener('click', function(e) {
      e.preventDefault();
      const isOpen = tradeWrap.classList.toggle('chart-open');
      chartBtn.classList.toggle('active', isOpen);
    });
  }

  // Buy / Sell tabs
  document.querySelectorAll('.bs-tab').forEach(tab => {
    tab.addEventListener('click', function() {
      document.querySelectorAll('.bs-tab').forEach(t => t.classList.remove('active'));
      this.classList.add('active');
      currentSide = this.dataset.side;
      const actionBtn = document.getElementById('btnAction');
      if (actionBtn) {
        actionBtn.textContent = currentSide === 'buy' ? '▲ BUY' : '▼ SELL';
        actionBtn.className = 'action-btn ' + currentSide;
      }
      renderBalances();
      calcCost();
    });
  });

  // Order type tabs
  document.querySelectorAll('.ot-tab').forEach(tab => {
    tab.addEventListener('click', function() {
      document.querySelectorAll('.ot-tab').forEach(t => t.classList.remove('active'));
      this.classList.add('active');
      currentOT = this.dataset.ot;
      const priceRow = document.getElementById('priceRow');
      if (priceRow) priceRow.style.display = currentOT === 'market' ? 'none' : 'flex';
      const stopRow = document.getElementById('stopRow');
      if (stopRow) stopRow.style.display = currentOT === 'stoplimit' ? 'flex' : 'none';
      calcCost();
    });
  });

  // Pair change
  if (pairSel) {
    pairSel.addEventListener('change', () => {
      if (iSuffix) iSuffix.textContent = amtInUSDT ? 'USDT' : getBase();
      triggerLogoUpdate();
      renderBalances();
      connectWS();
    });
  }

  if (iSuffix) iSuffix.addEventListener('click', toggleAmtMode);
  if (iAmt)    iAmt.addEventListener('input', calcCost);
  if (iPrice)  iPrice.addEventListener('input', calcCost);

  // % quick fill
  document.querySelectorAll('.pct-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const pct = parseFloat(btn.getAttribute('data-pct'));
      const p = parseFloat(iPrice ? iPrice.value : 0) || price || 1;
      if (iAmt) {
        if (currentSide === 'buy') {
          iAmt.value = amtInUSDT
            ? (getUSDT() * pct / 100).toFixed(2)
            : (getUSDT() * pct / 100 / p).toFixed(6);
        } else {
          const holding = getCoinHolding(getBase());
          iAmt.value = amtInUSDT
            ? (holding * pct / 100 * p).toFixed(2)
            : (holding * pct / 100).toFixed(6);
        }
      }
      calcCost();
    });
  });

  // Place order button
  const actionBtn = document.getElementById('btnAction');
  if (actionBtn) actionBtn.addEventListener('click', placeOrder);

  // Coin logo fallback
  if (coinLogo) {
    coinLogo.onerror = function() {
      const baseName = getBase();
      this.style.display = 'none';
      if (!document.getElementById('coinAvatarFallback')) {
        const fb = document.createElement('div');
        fb.id = 'coinAvatarFallback';
        Object.assign(fb.style, { width:'24px', height:'24px', borderRadius:'50%', backgroundColor:'#2b3139', color:'#fff', fontSize:'9px', fontWeight:'bold', display:'inline-flex', alignItems:'center', justifyContent:'center', marginRight:'8px' });
        fb.textContent = baseName.slice(0, 3);
        this.parentNode.insertBefore(fb, this);
      }
    };
  }

  // Order Book / Trades toggle
  const subBook   = document.getElementById('subBook');
  const subTrades = document.getElementById('subTrades');
  if (subBook && subTrades) {
    subBook.addEventListener('click',   function() { subBook.classList.add('active');   subTrades.classList.remove('active'); document.getElementById('bookView').style.display='block';  document.getElementById('tradesView').style.display='none'; });
    subTrades.addEventListener('click', function() { subTrades.classList.add('active'); subBook.classList.remove('active');   document.getElementById('bookView').style.display='none';   document.getElementById('tradesView').style.display='block'; });
  }

  // Open Orders / History tab
  const tabOpen = document.getElementById('tabOpenOrders');
  const tabHist = document.getElementById('tabHistory');
  if (tabOpen && tabHist) {
    tabOpen.addEventListener('click', function() { tabOpen.classList.add('active'); tabHist.classList.remove('active'); document.getElementById('openTab').style.display='block'; document.getElementById('historyTab').style.display='none'; });
    tabHist.addEventListener('click', function() { tabHist.classList.add('active');  tabOpen.classList.remove('active'); document.getElementById('openTab').style.display='none';  document.getElementById('historyTab').style.display='block'; });
  }

  fetchAllPairs();
  renderBalances();
  renderOrders();
  setInterval(renderOB, 1500);
  setInterval(renderRecentTrades, 2500);
});
