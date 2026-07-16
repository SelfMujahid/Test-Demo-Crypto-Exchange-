// =====================================================
// BOT.JS — bot.html ONLY.
// Depends on common.js: getBal(), setBal(), fmtPrice(),
// fmtLarge(), debounce(), toggleVisualMenu()
// =====================================================

function fp(n)  { return fmtPrice(n); }
function now()  { return new Date().toLocaleTimeString('en-US',{hour12:false}); }

// ===== STATE =====
let running=false, botTimer=null, priceFeed=null;
let sym='BTCUSDT', pairLabel='BTC/USDT';
let dir='long', tf='15m';
let trades=[], history=[], livePrices={};
let totalPnl=0, wins=0, losses=0;
let ofTimer=null;

const IND_INFO = {
  rsi:   'RSI 30 se neeche = Oversold → Long. RSI 70 se upar = Overbought → Short.',
  macd:  'MACD line Signal line ko upar cross kare → Long. Neeche cross → Short.',
  ema:   'EMA 9, EMA 21 ke upar jaaye → Long. Neeche jaaye → Short.',
  bb:    'Price lower Bollinger Band touch kare → Long. Upper band touch kare → Short.',
  stoch: 'Stochastic K < 20 = Oversold → Long. K > 80 = Overbought → Short.',
  cci:   'CCI < -100 → Long signal. CCI > +100 → Short signal.',
  multi: 'RSI + MACD dono ek direction confirm karein tabhi entry hogi (conservative).',
};
const TF_MS = {'1m':7000,'5m':11000,'15m':17000,'1h':23000,'4h':32000,'1d':48000};

// ===== PRICE FEED =====
function startPriceFeed() {
  const pairs = ['btcusdt','ethusdt','solusdt','bnbusdt','xrpusdt','dogeusdt'];
  if (priceFeed) priceFeed.close();
  priceFeed = new WebSocket(
    `wss://stream.binance.com:9443/stream?streams=${pairs.map(p=>p+'@miniTicker').join('/')}`
  );
  priceFeed.onmessage = e => {
    try {
      const d = JSON.parse(e.data).data;
      if (!d) return;
      const base = d.s.replace('USDT','');
      const price = parseFloat(d.c);
      const chgPct = ((price - parseFloat(d.o)) / parseFloat(d.o)) * 100;
      livePrices[d.s] = price;
      const el = document.getElementById('tp-'+base);
      if (el) { el.textContent='$'+fp(price); el.className='tick-price '+(chgPct>=0?'up':'dn'); }
      if (d.s===sym) checkTPSL();
    } catch(e) {}
  };
}

// ===== ORDER FLOW FEED (simulated) =====
const OF_PAIRS = ['BTC','ETH','SOL','BNB','XRP'];
function startOrderFlow() {
  if (ofTimer) clearInterval(ofTimer);
  ofTimer = setInterval(() => {
    const feed = document.getElementById('ofFeed');
    if (!feed) return;
    const sym2   = OF_PAIRS[Math.floor(Math.random()*OF_PAIRS.length)];
    const price2 = livePrices[sym2+'USDT'] || 0;
    if (!price2) return;
    const side   = Math.random()>0.5 ? 'buy' : 'sell';
    const qty    = (Math.random()*2+0.01).toFixed(3);
    const val    = (price2 * parseFloat(qty));
    const row    = document.createElement('div');
    row.className= 'of-row';
    row.innerHTML= `<span class="of-${side}">${sym2} ${side.toUpperCase()}</span><span>$${fp(price2)} × ${qty}</span><span>$${val>=1000?fmtLarge(val):val.toFixed(0)}</span>`;
    feed.insertBefore(row, feed.firstChild);
    if (feed.children.length > 60) feed.removeChild(feed.lastChild);
  }, 600);
}

// ===== BALANCE =====
function updateBalanceUI() {
  const b  = getBal();
  const el = document.getElementById('sBalance');
  if (el) el.textContent = '$'+b.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
}

function resetBalance() {
  if (confirm('Balance $10,000 par reset karein?')) {
    setBal(10000);
    totalPnl=0; wins=0; losses=0;
    updateStats();
    addLog('Balance reset to $10,000','info');
  }
}

// ===== BOT =====
function startBot() {
  if (running) return;
  running = true;
  document.getElementById('sdot').classList.add('on');
  document.getElementById('stext').textContent = 'Bot Running';
  document.getElementById('statusPill').classList.add('running');
  document.getElementById('btnStart').disabled = true;
  document.getElementById('btnStop').disabled  = false;

  const ind   = document.getElementById('botInd').value;
  const lev   = parseInt(document.getElementById('levR').value);
  const amt   = parseFloat(document.getElementById('botAmt').value)||100;
  const tp    = parseFloat(document.getElementById('botTP').value)||2;
  const sl    = parseFloat(document.getElementById('botSL').value)||1;
  const trail = parseFloat(document.getElementById('botTrail').value)||0;
  const maxT  = parseInt(document.getElementById('botMax').value)||3;

  addLog(`Bot started — ${pairLabel} | ${ind.toUpperCase()} | ${tf} | ${lev}x | $${amt}/trade`,'info');

  botTimer = setInterval(()=>{
    if (!running) return;
    const p = livePrices[sym];
    if (!p) { addLog('Price feed wait...','info'); return; }
    if (trades.length>=maxT) { addLog(`Max trades (${maxT}) — waiting for close`,'info'); return; }

    const sig = getSignal(ind);
    if (!sig) { addLog(`[${ind.toUpperCase()}] No signal — ${tf}`,'info'); return; }
    if (dir==='long'  && sig==='short') return;
    if (dir==='short' && sig==='long')  return;

    const tpP   = sig==='long' ? p*(1+tp/100) : p*(1-tp/100);
    const slP   = sig==='long' ? p*(1-sl/100) : p*(1+sl/100);
    const qty   = parseFloat((amt/p).toFixed(6));
    const margin= amt/lev;
    const bal   = getBal();

    if (bal<margin) { addLog(`Insufficient balance — Need:$${margin.toFixed(2)} Avail:$${bal.toFixed(2)}`,'warn'); return; }
    setBal(bal-margin);

    trades.push({ id:Date.now(), pair:pairLabel, sym, side:sig, entry:p, qty, lev, tp:tpP, sl:slP, trail, hi:p, lo:p, time:now(), margin, amt });
    addLog(`[${ind.toUpperCase()}] ${sig.toUpperCase()} @ $${fp(p)} | TP:$${fp(tpP)} SL:$${fp(slP)} | Margin:$${margin.toFixed(2)}`, sig);
    renderActive(); updateStats();
  }, TF_MS[tf]||15000);
}

function stopBot() {
  running=false; clearInterval(botTimer);
  document.getElementById('sdot').classList.remove('on');
  document.getElementById('stext').textContent = 'Bot Stopped';
  document.getElementById('statusPill').classList.remove('running');
  document.getElementById('btnStart').disabled = false;
  document.getElementById('btnStop').disabled  = true;
  addLog('Bot stopped.','info');
}

// ===== SIGNAL =====
function getSignal(ind) {
  const r = Math.random();
  if (ind==='rsi')   { const v=20+r*70; return v<32?'long':v>68?'short':null; }
  if (ind==='macd')  return r<0.18?'long':r<0.36?'short':null;
  if (ind==='ema')   return r<0.20?'long':r<0.38?'short':null;
  if (ind==='bb')    return r<0.16?'long':r<0.32?'short':null;
  if (ind==='stoch') { const k=r*100; return k<22?'long':k>78?'short':null; }
  if (ind==='cci')   { const v=-150+r*300; return v<-100?'long':v>100?'short':null; }
  if (ind==='multi') { const rsi=20+r*70,m=Math.random(); return (rsi<35&&m<0.45)?'long':(rsi>65&&m>0.55)?'short':null; }
  return null;
}

// ===== TP/SL CHECK =====
function checkTPSL() {
  if (!trades.length) return;
  trades = trades.filter(t=>{
    const p = livePrices[t.sym]||t.entry;
    if (t.trail>0) {
      if (t.side==='long'  && p>t.hi) { t.hi=p; t.sl=p*(1-t.trail/100); }
      if (t.side==='short' && p<t.lo) { t.lo=p; t.tp=p*(1+t.trail/100); }
    }
    if ((t.side==='long'&&p>=t.tp)||(t.side==='short'&&p<=t.tp)) { closeTrade(t,'TP'); return false; }
    if ((t.side==='long'&&p<=t.sl)||(t.side==='short'&&p>=t.sl)) { closeTrade(t,'SL'); return false; }
    return true;
  });
  renderActive(); updateStats();
}

function closeTrade(t, reason) {
  const p   = livePrices[t.sym]||t.entry;
  const pnl = t.side==='long'?(p-t.entry)*t.qty*t.lev:(t.entry-p)*t.qty*t.lev;
  totalPnl+=pnl;
  if (pnl>=0) wins++; else losses++;
  const newBal = Math.max(0, getBal()+(t.margin||0)+pnl);
  setBal(newBal);
  const tag = reason==='TP'?'tp':'sl';
  addLog(`${reason==='TP'?'✅ TP':'❌ SL'} — ${t.side.toUpperCase()} closed @ $${fp(p)} | PnL:${pnl>=0?'+':''}$${pnl.toFixed(2)}`, tag);
  history.unshift({ time:now(), pair:t.pair, side:t.side, entry:t.entry, exit:p, qty:t.qty, pnl, result:pnl>=0?'WIN':'LOSS' });
  renderHistory();
}

// ===== RENDER =====
function renderActive() {
  const countEl = document.getElementById('actCount');
  const body    = document.getElementById('actBody');
  if (countEl) countEl.textContent=`(${trades.length})`;
  if (!body) return;
  if (!trades.length) { body.innerHTML='<tr><td colspan="10" class="no-data">No active positions</td></tr>'; return; }
  body.innerHTML = trades.map(t=>{
    const p   = livePrices[t.sym]||t.entry;
    const pnl = t.side==='long'?(p-t.entry)*t.qty*t.lev:(t.entry-p)*t.qty*t.lev;
    const pc  = pnl>=0?'var(--green)':'var(--red)';
    return `<tr>
      <td><b>${t.pair}</b></td>
      <td><span style="color:${t.side==='long'?'var(--green)':'var(--red)'};font-weight:700;background:${t.side==='long'?'rgba(0,230,118,0.1)':'rgba(255,23,68,0.1)'};padding:2px 8px;border-radius:4px">${t.side.toUpperCase()}</span></td>
      <td>$${fp(t.entry)}</td><td>$${fp(p)}</td>
      <td>${t.qty}</td><td>${t.lev}x</td>
      <td style="color:var(--green)">$${fp(t.tp)}</td>
      <td style="color:var(--red)">$${fp(t.sl)}</td>
      <td style="color:${pc};font-weight:700">${pnl>=0?'+':''}$${pnl.toFixed(2)}</td>
      <td><button class="cls-btn" onclick="manualClose(${t.id})">Close</button></td>
    </tr>`;
  }).join('');
}

function renderHistory() {
  const body = document.getElementById('histBody');
  if (!body) return;
  if (!history.length) { body.innerHTML='<tr><td colspan="8" class="no-data">No completed trades</td></tr>'; return; }
  body.innerHTML = history.slice(0,50).map(h=>{
    const pc=h.pnl>=0?'var(--green)':'var(--red)';
    return `<tr>
      <td>${h.time}</td><td><b>${h.pair}</b></td>
      <td style="color:${h.side==='long'?'var(--green)':'var(--red)'};font-weight:700">${h.side.toUpperCase()}</td>
      <td>$${fp(h.entry)}</td><td>$${fp(h.exit)}</td><td>${h.qty}</td>
      <td style="color:${pc};font-weight:700">${h.pnl>=0?'+':''}$${h.pnl.toFixed(2)}</td>
      <td style="color:${pc};font-weight:700">${h.result}</td>
    </tr>`;
  }).join('');
}

function updateStats() {
  const tot=wins+losses;
  const totEl=document.getElementById('sTot');
  const winEl=document.getElementById('sWin');
  const subEl=document.getElementById('sWinSub');
  const pnlEl=document.getElementById('sPnl');
  const actEl=document.getElementById('sActive');
  if (totEl) totEl.textContent=tot;
  if (winEl) { winEl.textContent=tot?((wins/tot)*100).toFixed(0)+'%':'0%'; winEl.style.color=wins>=losses?'var(--green)':'var(--red)'; }
  if (subEl) subEl.textContent=`${wins}W / ${losses}L`;
  if (pnlEl) { pnlEl.textContent=(totalPnl>=0?'+':'')+'$'+totalPnl.toFixed(2); pnlEl.style.color=totalPnl>=0?'var(--green)':'var(--red)'; }
  if (actEl) actEl.textContent=trades.length;
  updateBalanceUI();
}

// ===== LOG =====
function addLog(msg, type) {
  const box=document.getElementById('logBox');
  if (!box) return;
  const d=document.createElement('div');
  d.className='log-line ll-'+type;
  d.textContent=`[${now()}] ${msg}`;
  box.insertBefore(d,box.firstChild);
  if (box.children.length>80) box.removeChild(box.lastChild);
}
function clearLog()     { const b=document.getElementById('logBox');  if(b) b.innerHTML=''; }
function clearHistory() { history=[]; renderHistory(); }

// ===== CONTROLS =====
function setTF(el) { document.querySelectorAll('.tf-btn').forEach(b=>b.classList.remove('active')); el.classList.add('active'); tf=el.textContent; }
function setDir(d) {
  dir=d;
  document.getElementById('dirLong').className ='dir-btn'+(d==='long'?' long-active':'');
  document.getElementById('dirShort').className='dir-btn'+(d==='short'?' short-active':'');
  document.getElementById('dirBoth').className ='dir-btn'+(d==='both'?' both-active':'');
}
function updateIndInfo() { const el=document.getElementById('indInfo'); const v=document.getElementById('botInd').value; if(el) el.textContent=IND_INFO[v]||''; }
function onBotPairChange() { pairLabel=document.getElementById('botPair').value; sym=pairLabel.replace('/',''); const t=document.getElementById('pairTag'); if(t) t.textContent=pairLabel; }

window.manualClose = function(id) {
  trades=trades.filter(t=>{ if(t.id===id){closeTrade(t,'Manual Close');return false;} return true; });
  renderActive(); updateStats();
};

// ===== INIT =====
document.addEventListener('DOMContentLoaded', ()=>{
  updateBalanceUI();
  startPriceFeed();
  startOrderFlow();

  document.getElementById('btnStart').addEventListener('click', startBot);
  document.getElementById('btnStop').addEventListener('click', stopBot);
  document.getElementById('botInd').addEventListener('change', updateIndInfo);
  document.getElementById('botPair').addEventListener('change', onBotPairChange);
  document.getElementById('resetBalBtn').addEventListener('click', resetBalance);
  document.getElementById('levR').addEventListener('input', e=>{
    document.getElementById('levVal').textContent=e.target.value+'x';
  });

  setInterval(()=>{ if(trades.length) renderActive(); }, 2000);
});
