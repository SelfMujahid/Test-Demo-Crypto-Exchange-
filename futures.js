// ===== STATE & GLOBALS =====
const INIT_BAL = 10000;
let lev = 10;
let price = 0;
let amtInUSDT = true; // true=USDT mode, false=Coin mode
let positions = [];
let ws = null;
let currentSide = 'long';

// Base symbol nikalne ke liye shortcut (Jaise BTC/USDT se "btc" nikalega logo ke liye)
function getBaseSymbolLower() {
  const pairEl = document.getElementById('pairSel');
  const currentPair = pairEl ? pairEl.value : 'BTC/USDT';
  return currentPair ? currentPair.split('/')[0].toLowerCase() : 'btc';
}

// Binance stream format symbol (Jaise BTC/USDT se "btcusdt")
function getBinanceStreamSymbol() {
  const pairEl = document.getElementById('pairSel');
  const currentPair = pairEl ? pairEl.value : 'BTC/USDT';
  return currentPair ? currentPair.replace('/', '').toLowerCase() : 'btcusdt';
}

// ===== CORE FUNCTIONS =====
function getBal() { return parseFloat(localStorage.getItem('demoBalance') || INIT_BAL); }
function setBal(v) { localStorage.setItem('demoBalance', Math.max(0, v).toFixed(2)); renderBalanceBar(); }

function renderBalanceBar() {
  const b = getBal();
  const balanceDisplay = document.getElementById('balanceDisplay');
  if (balanceDisplay) balanceDisplay.textContent = '$' + b.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function getBase() { 
  const pairEl = document.getElementById('pairSel');
  return ((pairEl ? pairEl.value : 'BTC/USDT') || 'BTC/USDT').split('/')[0]; 
}

function toggleAmtMode() {
  amtInUSDT = !amtInUSDT;
  const base = getBase();
  const iSuffix = document.getElementById('iSuffix');
  const iAmt = document.getElementById('iAmt');
  
  if (iSuffix) iSuffix.textContent = amtInUSDT ? 'USDT' : base;
  if (iAmt) {
    iAmt.value = '';
    iAmt.placeholder = amtInUSDT ? '0.00' : '0.000000';
  }
  calcCost();
}

// Fetch all USDT pairs from Binance (Supports 400+ coins dynamically)
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
      
      // CSS Box Size Fix: Select box ko bohot bada hone se rokne ke liye inline override
      pairSel.style.maxWidth = "130px";
      pairSel.style.textOverflow = "ellipsis";
    }
    if (pairLoadStatus) pairLoadStatus.textContent = usdtPairs.length + ' pairs';
    
    triggerLogoUpdate();
    connectWS();
  } catch (e) {
    if (pairLoadStatus) pairLoadStatus.textContent = 'Load failed';
    const fallback = ['BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'BNB/USDT', 'XRP/USDT'];
    if (pairSel) {
      pairSel.innerHTML = fallback.map(p =>
        `<option${p === 'BTC/USDT' ? ' selected' : ''}>${p}</option>`
      ).join('');
    }
    triggerLogoUpdate();
    connectWS();
  }
}

// ===== BINANCE WEBSOCKET PIPELINE =====
function connectWS() {
  if (ws) ws.close();
  
  price = 0; 
  const pairPrice = document.getElementById('pairPrice');
  if (pairPrice) pairPrice.textContent = 'Loading...';
  
  const streamSym = getBinanceStreamSymbol(); 
  
  // Clean WebSocket setup for dual pipeline stream processing
  ws = new WebSocket(`wss://stream.binance.com:9443/stream?streams=${streamSym}@ticker/${streamSym}@depth20@100ms`);
  
  ws.onmessage = e => {
    try {
      const rawData = JSON.parse(e.data);
      const isCombined = rawData.stream && rawData.data;
      const d = isCombined ? rawData.data : rawData;
      const streamType = isCombined ? rawData.stream : '';

      // 1. LIVE PRICE (TICKER) STREAM PIPELINE
      if (!streamType || streamType.endsWith('@ticker')) {
        price = parseFloat(d.c);
        const chg = parseFloat(d.P);
        
        const pairChg = document.getElementById('pairChg');
        const iPrice = document.getElementById('iPrice');
        const iSuffix = document.getElementById('iSuffix');
        const sHigh = document.getElementById('s-high');
        const sLow = document.getElementById('s-low');
        const sMark = document.getElementById('s-mark');
        const obMidP = document.getElementById('obMidP');
        const sOi = document.getElementById('s-oi');

        if (pairPrice) {
          pairPrice.textContent = '$' + fp(price);
          pairPrice.style.color = chg >= 0 ? 'var(--green)' : 'var(--red)';
        }
        
        if (pairChg) {
          pairChg.textContent = (chg >= 0 ? '+' : '') + chg.toFixed(2) + '%';
          pairChg.style.background = chg >= 0 ? 'rgba(0,200,83,0.1)' : 'rgba(246,70,93,0.1)';
          pairChg.style.color = chg >= 0 ? 'var(--green)' : 'var(--red)';
        }
        
        if (sHigh) sHigh.textContent = '$' + fp(parseFloat(d.h));
        if (sLow) sLow.textContent = '$' + fp(parseFloat(d.l));
        if (sMark) sMark.textContent = '$' + fp(price);
        if (obMidP) obMidP.textContent = '$' + fp(price);
        if (iPrice) iPrice.placeholder = fp(price);
        if (iSuffix) iSuffix.textContent = amtInUSDT ? 'USDT' : getBase();
        if (sOi) sOi.textContent = '$' + (200 + Math.random() * 300).toFixed(0) + 'M';
        
        checkTPSL();
        updateLivePricesInTable(); 
        calcCost();
        
        // Agar live orderbook clear na ho rahi ho toh real-time ticker fallback use karein
        if(!d.b) { renderOB(); }
      } 
      
      // 2. LIVE ORDER BOOK DEPTH STREAM PIPELINE
      if (streamType && streamType.endsWith('@depth20@100ms')) {
        renderLiveOrderBook(d.b, d.a); 
      }
    } catch (err) {
      console.error("Stream execution error:", err);
    }
  };
}

// Order Book Render Fix: Data templates ko DOM layout arrays se fully bind kiya hai
function renderLiveOrderBook(bids, asks) {
  const askRows = document.getElementById('askRows');
  const bidRows = document.getElementById('bidRows');
  const obSpread = document.getElementById('obSpread');
  
  if (!askRows || !bidRows) return; 

  let ah = '', bh = '';
  let tA = 0, tB = 0;

  if (asks && asks.length) {
    const cleanAsks = asks.slice(0, 8).map(a => ({ p: parseFloat(a[0]), q: parseFloat(a[1]) })).reverse();
    cleanAsks.forEach(r => tA += r.q);
    cleanAsks.forEach(r => {
      const pct = tA > 0 ? (r.q / tA * 100).toFixed(0) : 0;
      ah += `<div class="ob-row"><span class="ap">${fp(r.p)}</span><span>${r.q.toFixed(4)}</span><span>${(r.p * r.q).toFixed(0)}</span><div class="ob-bar" style="background:var(--red);width:${pct}%"></div></div>`;
    });
    askRows.innerHTML = ah;
  }

  if (bids && bids.length) {
    const cleanBids = bids.slice(0, 8).map(b => ({ p: parseFloat(b[0]), q: parseFloat(b[1]) }));
    cleanBids.forEach(r => tB += r.q);
    cleanBids.forEach(r => {
      const pct = tB > 0 ? (r.q / tB * 100).toFixed(0) : 0;
      bh += `<div class="ob-row"><span class="bp">${fp(r.p)}</span><span>${r.q.toFixed(4)}</span><span>${(r.p * r.q).toFixed(0)}</span><div class="ob-bar" style="background:var(--green);width:${pct}%"></div></div>`;
    });
    bidRows.innerHTML = bh;
  }

  if (obSpread && asks && bids && asks.length && bids.length) {
    const spread = parseFloat(asks[0][0]) - parseFloat(bids[0][0]);
    obSpread.textContent = '$' + (spread >= 0 ? spread.toFixed(2) : '0.00');
  }
}

// Fallback Engine: Agar network slow ho toh matrix automatically display generate karega
function renderOB() {
  if (!price || isNaN(price)) return;
  
  let ah = '', bh = '';
  let tA = 0, tB = 0;
  const aR = [], bR = [];
  
  for (let i = 8; i >= 1; i--) {
    const p = price + i * price * 0.00012 + Math.random() * price * 0.00005;
    const q = +(Math.random() * 1.5 + 0.01).toFixed(4);
    tA += q; aR.push({ p, q });
  }
  for (let i = 1; i <= 8; i++) {
    const p = price - i * price * 0.00012 - Math.random() * price * 0.00005;
    const q = +(Math.random() * 1.5 + 0.01).toFixed(4);
    tB += q; bR.push({ p, q });
  }
  
  aR.forEach(r => {
    const pct = (r.q / tA * 100).toFixed(0);
    ah += `<div class="ob-row"><span class="ap">${fp(r.p)}</span><span>${r.q}</span><span>${(r.p * r.q).toFixed(0)}</span><div class="ob-bar" style="background:var(--red);width:${pct}%"></div></div>`;
  });
  bR.forEach(r => {
    const pct = (r.q / tB * 100).toFixed(0);
    bh += `<div class="ob-row"><span class="bp">${fp(r.p)}</span><span>${r.q}</span><span>${(r.p * r.q).toFixed(0)}</span><div class="ob-bar" style="background:var(--green);width:${pct}%"></div></div>`;
  });
  
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

// ===== REAL-TIME COST MATRIX CALCULATION =====
function calcCost() {
  const iPrice = document.getElementById('iPrice');
  const iAmt = document.getElementById('iAmt');
  const p = parseFloat(iPrice ? iPrice.value : 0) || price || 0;
  const raw = parseFloat(iAmt ? iAmt.value : 0) || 0;
  if (!p || isNaN(p)) return;

  const coinAmt = amtInUSDT ? (p > 0 ? raw / p : 0) : raw;
  const val = p * coinAmt;
  const margin = val / lev;
  const fee = val * 0.0004;
  const liqP = coinAmt > 0
    ? (currentSide === 'long' ? p * (1 - 1 / lev + 0.005) : p * (1 + 1 / lev - 0.005))
    : 0;
    
  const cVal = document.getElementById('cVal');
  const cMargin = document.getElementById('cMargin');
  const cFee = document.getElementById('cFee');
  const cLiq = document.getElementById('cLiq');

  if (cVal) cVal.textContent = val ? '$' + val.toFixed(2) : '—';
  if (cMargin) cMargin.textContent = margin ? '$' + margin.toFixed(2) : '—';
  if (cFee) cFee.textContent = fee ? '$' + fee.toFixed(4) : '—';
  if (cLiq) cLiq.textContent = liqP ? '$' + fp(liqP) : '—';
}

// ===== RISK PIPELINE MANAGEMENT (TP/SL/LIQ) =====
function checkTPSL() {
  if (!positions.length || !price || isNaN(price)) return;
  let changed = false;
  positions = positions.filter(pos => {
    const mp = price || pos.entry;
    const autoClose = () => {
      const pnl = pos.side === 'long' ? (mp - pos.entry) * pos.amount * pos.lev : (pos.entry - mp) * pos.amount * pos.lev;
      setBal(getBal() + (pos.margin || 0) + pnl);
      changed = true;
    };
    if (pos.tp && ((pos.side === 'long' && price >= pos.tp) || (pos.side === 'short' && price <= pos.tp))) { autoClose(); return false; }
    if (pos.sl && ((pos.side === 'long' && price <= pos.sl) || (pos.side === 'short' && price >= pos.sl))) { autoClose(); return false; }
    if ((pos.side === 'long' && price <= pos.liqPrice) || (pos.side === 'short' && price >= pos.liqPrice)) { autoClose(); return false; }
    return true;
  });
  if (changed) renderPositions();
}

function placeOrder(side) {
  currentSide = side;
  const iPrice = document.getElementById('iPrice');
  const iAmt = document.getElementById('iAmt');
  const iTP = document.getElementById('iTP');
  const iSL = document.getElementById('iSL');
  const pairSel = document.getElementById('pairSel');

  const p = parseFloat(iPrice ? iPrice.value : 0) || price;
  const raw = parseFloat(iAmt ? iAmt.value : 0);
  if (!raw || raw <= 0) { alert('Amount enter karein'); return; }
  if (!p || isNaN(p) || p === 0) { alert('Price load nahi hua, thoda wait karein'); return; }
  
  const a = amtInUSDT ? (p > 0 ? raw / p : 0) : raw;
  if (!a || a <= 0) { alert('Invalid calculation spacing'); return; }

  const orderVal = p * a;
  const margin = orderVal / lev;
  const bal = getBal();
  if (bal < margin) { alert('Balance kam hai!\nZaroorat: $' + margin.toFixed(2) + '\nAvailable: $' + bal.toFixed(2)); return; }
  setBal(bal - margin);

  const tp = parseFloat(iTP ? iTP.value : 0) || null;
  const sl = parseFloat(iSL ? iSL.value : 0) || null;
  const liqP = side === 'long' ? p * (1 - 1 / lev + 0.005) : p * (1 + 1 / lev - 0.005);
  
  positions.push({
    id: Date.now(),
    pair: pairSel ? pairSel.value : 'BTC/USDT',
    base: getBase(), side, entry: p, amount: a, lev, tp, sl, liqPrice: liqP,
    margin: margin,
  });
  
  renderPositions();
  if (iAmt) iAmt.value = ''; 
  if (iTP) iTP.value = ''; 
  if (iSL) iSL.value = '';
}

function renderPositions() {
  const posCount = document.getElementById('posCount');
  const noPosMsg = document.getElementById('noPosMsg');
  const posTable = document.getElementById('posTable');
  const posBody = document.getElementById('posBody');

  if (posCount) posCount.textContent = `(${positions.length})`;
  
  if (!positions.length) {
    if (noPosMsg) noPosMsg.style.display = 'block';
    if (posTable) posTable.style.display = 'none';
    return;
  }
  if (noPosMsg) noPosMsg.style.display = 'none';
  if (posTable) posTable.style.display = 'table';
  
  if (posBody) {
    posBody.innerHTML = positions.map(pos => {
      return `<tr id="pos-row-${pos.id}" data-pair="${pos.pair}">
        <td><b>${pos.pair}</b></td>
        <td>
          <span style="color:${pos.side === 'long' ? 'var(--green)' : 'var(--red)'};font-weight:700;background:${pos.side === 'long' ? 'rgba(0,200,83,0.1)' : 'rgba(246,70,93,0.1)'};padding:2px 8px;border-radius:4px;">
            ${pos.side === 'long' ? '▲ LONG' : '▼ SHORT'} ${pos.lev}x
          </span>
        </td>
        <td>${pos.amount} ${pos.base}</td>
        <td>$${fp(pos.entry)}</td>
        <td class="live-mp">—</td>
        <td style="color:var(--red)">$${fp(pos.liqPrice)}</td>
        <td style="color:var(--green)">${pos.tp ? '$' + fp(pos.tp) : '—'}</td>
        <td style="color:var(--red)">${pos.sl ? '$' + fp(pos.sl) : '—'}</td>
        <td class="live-pnl" style="font-weight:700">—</td>
        <td class="live-pnlpct" style="font-weight:700">—</td>
        <td><button class="cls-btn" data-id="${pos.id}">Close</button></td>
      </tr>`;
    }).join('');
  }
  
  document.querySelectorAll('.cls-btn').forEach(btn => {
    btn.onclick = () => closePos(Number(btn.getAttribute('data-id')));
  });

  updateLivePricesInTable();
}

function updateLivePricesInTable() {
  if(!positions.length) return;
  const mp = price;
  const hasValidPrice = mp && !isNaN(mp) && mp > 0;
  const pairSel = document.getElementById('pairSel');
  const currentPairVal = pairSel ? pairSel.value : '';

  positions.forEach(pos => {
    const row = document.getElementById(`pos-row-${pos.id}`);
    if (!row) return;

    const mpEl = row.querySelector('.live-mp');
    const pnlEl = row.querySelector('.live-pnl');
    const pctEl = row.querySelector('.live-pnlpct');

    if(hasValidPrice && pos.pair === currentPairVal) {
      const pnl = pos.side === 'long' ? (mp - pos.entry) * pos.amount * pos.lev : (pos.entry - mp) * pos.amount * pos.lev;
      const pnlPct = ((pnl / (pos.entry * pos.amount / pos.lev)) * 100).toFixed(2);
      const pc = pnl >= 0 ? 'var(--green)' : 'var(--red)';

      if(mpEl) mpEl.textContent = '$' + fp(mp);
      if(pnlEl) {
        pnlEl.textContent = (pnl >= 0 ? '+' : '') + '$' + pnl.toFixed(2);
        pnlEl.style.color = pc;
      }
      if(pctEl) {
        pctEl.textContent = (pnl >= 0 ? '+' : '') + pnlPct + '%';
        pctEl.style.color = pc;
      }
    }
  });
}

window.closePos = function(id) {
  const pos = positions.find(p => p.id === id);
  if (pos) {
    const pairSel = document.getElementById('pairSel');
    const mp = (pairSel && pos.pair === pairSel.value) ? price : pos.entry;
    const pnl = pos.side === 'long' ? (mp - pos.entry) * pos.amount * pos.lev : (pos.entry - mp) * pos.amount * pos.lev;
    setBal(getBal() + (pos.margin || 0) + pnl);
  }
  positions = positions.filter(p => p.id !== id);
  renderPositions();
};

function fp(n) {
  if (!n || isNaN(n)) return '—';
  if (n >= 1000) return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (n >= 1) return n.toFixed(4);
  return n.toFixed(6);
}

// Fools-Proof Asset Icon Mirror: Agar github image block ho toh automatically CSS Letter-Avatar banayega
function triggerLogoUpdate() {
  const logoEl = document.getElementById('coinLogo');
  if (!logoEl) return;
  
  const coinSymbol = getBaseSymbolLower();
  
  // Clean fallback pipeline rules
  logoEl.style.display = "inline-block";
  if(document.getElementById('coinAvatarFallback')) {
    document.getElementById('coinAvatarFallback').remove();
  }
  
  logoEl.src = `https://raw.githubusercontent.com/spothq/cryptocurrency-icons/master/128/color/${coinSymbol}.png`;
}

// ===== EVENT LISTENERS =====
document.addEventListener('DOMContentLoaded', () => {
  const pairSel = document.getElementById('pairSel');
  const iSuffix = document.getElementById('iSuffix');
  const iAmt = document.getElementById('iAmt');
  const iPrice = document.getElementById('iPrice');
  const levRange = document.getElementById('levRange');
  const btnLong = document.getElementById('btnLong');
  const btnShort = document.getElementById('btnShort');
  const coinLogo = document.getElementById('coinLogo');

  if (pairSel) {
    pairSel.addEventListener('change', () => {
      if (iSuffix) iSuffix.textContent = getBase();
      triggerLogoUpdate();
      connectWS(); 
    });
  }

  if (iSuffix) iSuffix.addEventListener('click', toggleAmtMode);
  if (iAmt) iAmt.addEventListener('input', calcCost);
  if (iPrice) iPrice.addEventListener('input', calcCost);

  if (levRange) {
    levRange.addEventListener('input', (e) => {
      lev = parseInt(e.target.value);
      const levNum = document.getElementById('levNum');
      if (levNum) levNum.textContent = lev + 'x';
      calcCost();
    });
  }

  // LOGO FALLBACK ERROR HANDLER: Agar dono API fail ho jayein toh bina layout tode dynamic initial banaye
  if (coinLogo) {
    coinLogo.onerror = function() {
      const baseName = getBase();
      this.style.display = "none";
      
      const fallbackDiv = document.createElement('div');
      fallbackDiv.id = 'coinAvatarFallback';
      fallbackDiv.style.width = '24px';
      fallbackDiv.style.height = '24px';
      fallbackDiv.style.borderRadius = '50%';
      fallbackDiv.style.backgroundColor = 'var(--choice-bg, #2b3139)';
      fallbackDiv.style.color = 'var(--text-bright, #fff)';
      fallbackDiv.style.fontSize = '9px';
      fallbackDiv.style.fontWeight = 'bold';
      fallbackDiv.style.display = 'inline-flex';
      fallbackDiv.style.alignItems = 'center';
      fallbackDiv.style.justifyContent = 'center';
      fallbackDiv.style.marginRight = '8px';
      fallbackDiv.textContent = baseName.slice(0, 3);
      
      if(this.parentNode && !document.getElementById('coinAvatarFallback')) {
        this.parentNode.insertBefore(fallbackDiv, this);
      }
    };
  }

  // Order type tabs binding
  const tabLimit = document.getElementById('tabLimit');
  const tabMarket = document.getElementById('tabMarket');
  const tabStopLimit = document.getElementById('tabStopLimit');
  const priceRow = document.getElementById('priceRow');

  if (tabLimit) {
    tabLimit.addEventListener('click', function() {
      document.querySelectorAll('.ot-tab').forEach(b => b.classList.remove('active'));
      this.classList.add('active');
      if (priceRow) priceRow.style.display = 'flex';
    });
  }
  if (tabMarket) {
    tabMarket.addEventListener('click', function() {
      document.querySelectorAll('.ot-tab').forEach(b => b.classList.remove('active'));
      this.classList.add('active');
      if (priceRow) priceRow.style.display = 'none';
    });
  }
  if (tabStopLimit) {
    tabStopLimit.addEventListener('click', function() {
      document.querySelectorAll('.ot-tab').forEach(b => b.classList.remove('active'));
      this.classList.add('active');
      if (priceRow) priceRow.style.display = 'flex';
    });
  }

  // Margin modes binding
  const mgCross = document.getElementById('mgCross');
  const mgIsolated = document.getElementById('mgIsolated');
  if (mgCross && mgIsolated) {
    [mgCross, mgIsolated].forEach(btn => {
      btn.addEventListener('click', function() {
        [mgCross, mgIsolated].forEach(b => b.classList.remove('active'));
        this.classList.add('active');
      });
    });
  }

  // Percent choices binding
  document.querySelectorAll('.pct-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const pct = parseFloat(btn.getAttribute('data-pct'));
      const p = parseFloat(iPrice ? iPrice.value : 0) || price || 1;
      const currentBalance = getBal();
      if (iAmt) {
        if (amtInUSDT) {
          iAmt.value = ((currentBalance * pct / 100) * lev).toFixed(2);
        } else {
          iAmt.value = ((currentBalance * pct / 100) * lev / p).toFixed(6);
        }
      }
      calcCost();
    });
  });

  if (btnLong) btnLong.addEventListener('click', () => placeOrder('long'));
  if (btnShort) btnShort.addEventListener('click', () => placeOrder('short'));

  // View toggles
  const subBook = document.getElementById('subBook');
  const subTrades = document.getElementById('subTrades');
  if (subBook && subTrades) {
    subBook.addEventListener('click', function() {
      subBook.classList.add('active'); subTrades.classList.remove('active');
      const bV = document.getElementById('bookView'); if (bV) bV.style.display = 'block';
      const tV = document.getElementById('tradesView'); if (tV) tV.style.display = 'none';
    });
    subTrades.addEventListener('click', function() {
      subTrades.classList.add('active'); subBook.classList.remove('active');
      const bV = document.getElementById('bookView'); if (bV) bV.style.display = 'none';
      const tV = document.getElementById('tradesView'); if (tV) tV.style.display = 'block';
    });
  }

  const tabOpenPos = document.getElementById('tabOpenPos');
  const tabHistory = document.getElementById('tabHistory');
  if (tabOpenPos && tabHistory) {
    tabOpenPos.addEventListener('click', function() {
      tabOpenPos.classList.add('active'); tabHistory.classList.remove('active');
      const oT = document.getElementById('openTab'); if (oT) oT.style.display = 'block';
      const hT = document.getElementById('historyTab'); if (hT) hT.style.display = 'none';
    });
    tabHistory.addEventListener('click', function() {
      tabHistory.classList.add('active'); tabOpenPos.classList.remove('active');
      const oT = document.getElementById('openTab'); if (oT) oT.style.display = 'none';
      const hT = document.getElementById('historyTab'); if (hT) hT.style.display = 'block';
    });
  }

  // ===== INITIALIZER RUN =====
  fetchAllPairs();
  renderBalanceBar();
  setInterval(renderOB, 1500);
  setInterval(renderRecentTrades, 2500);
});
