// =====================================================
// CHART.JS — Multi-chart layout with rank-sorted coin list,
// indicator library, and a simple custom indicator builder.
// Data: Binance (klines, funding rate) + CoinGecko (rank/logos/global stats)
// Library: TradingView lightweight-charts (~45KB)
// =====================================================

// ===== GLOBAL STATE =====
let coinList = [];
let instances = [];
let currentLayout = 1;
let activeInstanceForModal = null;
let activeInstanceForDropdown = null;
let instanceIdSeq = 0;

const TF_LIST = ['1m','3m','5m','15m','30m','1h','2h','4h','6h','8h','12h','1d','3d','1w','1M'];
const TF_SECONDS = { '1m':60,'3m':180,'5m':300,'15m':900,'30m':1800,'1h':3600,'2h':7200,'4h':14400,'6h':21600,'8h':28800,'12h':43200,'1d':86400,'3d':259200,'1w':604800,'1M':2592000 };

const OVERLAY_DEFS = [
  { key:'sma20', name:'SMA (20)', color:'#2962ff' },
  { key:'ema20', name:'EMA (20)', color:'#ffd740' },
  { key:'bb',    name:'Bollinger Bands (20,2)', color:'#9c27b0' },
  { key:'vwap',  name:'VWAP', color:'#00c853' },
  { key:'psar',  name:'Parabolic SAR', color:'#ff5722' },
];
const OSC_DEFS = [
  { key:'rsi',    name:'RSI (14)' },
  { key:'stoch',  name:'Stochastic (14,3,3)' },
  { key:'cci',    name:'CCI (20)' },
  { key:'willr',  name:'Williams %R (14)' },
  { key:'mom',    name:'Momentum (10)' },
  { key:'adx',    name:'ADX (14)' },
];
const EXTRA_DEFS = [
  { key:'macd', name:'MACD (12,26,9)' },
  { key:'atr',  name:'ATR (14)' },
  { key:'volume', name:'Volume' },
];

function fmtPrice(n) {
  if (!n && n!==0) return '—';
  if (n >= 1000) return n.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
  if (n >= 1) return n.toFixed(4);
  return n.toFixed(6);
}
function fmtLarge(n) {
  if (!n) return '—';
  if (n >= 1e12) return '$'+(n/1e12).toFixed(2)+'T';
  if (n >= 1e9)  return '$'+(n/1e9).toFixed(2)+'B';
  if (n >= 1e6)  return '$'+(n/1e6).toFixed(2)+'M';
  return '$'+n.toLocaleString();
}

// ===== COIN LIST =====
// Binance is the source of truth for WHICH coins exist (every USDT pair on
// Binance is included, no exceptions). CoinGecko is only used to attach
// rank/logo/name where available. Previously this was reversed (CoinGecko
// top-750 was the base list) which silently dropped any Binance-listed coin
// CoinGecko didn't rank in its first ~750 entries.
async function fetchCoinGeckoPage(page, retries=2) {
  try {
    const res = await fetch(`https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=${page}&sparkline=false`);
    if (res.status === 429 && retries > 0) {
      await new Promise(r=>setTimeout(r, 1500));
      return fetchCoinGeckoPage(page, retries-1);
    }
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch(e) { return []; }
}

async function loadCoinList() {
  try {
    const binRes = await fetch('https://api.binance.com/api/v3/exchangeInfo');
    const binData = await binRes.json();
    const binanceBases = binData.symbols
      .filter(s => s.quoteAsset==='USDT' && s.status==='TRADING')
      .map(s => s.baseAsset.toUpperCase());

    // Fetch CoinGecko pages SEQUENTIALLY (with a small gap) rather than in
    // parallel — 3 simultaneous requests reliably triggered CoinGecko's free
    // tier rate limit (429), which was silently losing whole pages of coins.
    const cgMap = {}; // SYMBOL -> {rank, name, logo}
    for (let page=1; page<=4; page++) {
      const items = await fetchCoinGeckoPage(page);
      items.forEach(c => {
        const sym = (c.symbol||'').toUpperCase();
        // Keep the higher-ranked (lower rank number) entry if a symbol repeats
        if (!cgMap[sym] || (c.market_cap_rank && c.market_cap_rank < cgMap[sym].rank)) {
          cgMap[sym] = { rank:c.market_cap_rank, name:c.name, logo:c.image };
        }
      });
      if (page < 4) await new Promise(r=>setTimeout(r, 300));
    }

    coinList = binanceBases.map(sym => {
      const cg = cgMap[sym];
      return {
        rank: cg ? cg.rank : null,
        sym,
        name: cg ? cg.name : sym,
        logo: cg ? cg.logo : `https://raw.githubusercontent.com/spothq/cryptocurrency-icons/master/128/color/${sym.toLowerCase()}.png`,
        binanceSymbol: sym+'USDT',
      };
    });

    // Ranked coins first (by rank ascending), unranked coins after (alphabetical)
    coinList.sort((a,b) => {
      if (a.rank && b.rank) return a.rank - b.rank;
      if (a.rank && !b.rank) return -1;
      if (!a.rank && b.rank) return 1;
      return a.sym.localeCompare(b.sym);
    });

    console.log(`Coin list loaded: ${coinList.length} total Binance USDT pairs (${coinList.filter(c=>c.rank).length} rank-matched via CoinGecko)`);
  } catch(e) {
    console.error('Coin list load failed', e);
    coinList = [{rank:1,sym:'BTC',name:'Bitcoin',logo:'',binanceSymbol:'BTCUSDT'}];
  }
}

// ===== GLOBAL STATS HEADER =====
async function loadGlobalStats() {
  try {
    const res = await fetch('https://api.coingecko.com/api/v3/global');
    const d = (await res.json()).data;
    setText('gMcap', fmtLarge(d.total_market_cap.usd));
    setText('gVol', fmtLarge(d.total_volume.usd));
    const btcDom = d.market_cap_percentage.btc || 0;
    const ethDom = d.market_cap_percentage.eth || 0;
    const altDom = Math.max(0, 100 - btcDom - ethDom);
    setText('gDom', btcDom.toFixed(1)+'%');
    setText('gDomEth', ethDom.toFixed(1)+'%');
    setText('gDomAlt', altDom.toFixed(1)+'%');
  } catch(e) {}
}
function setText(id,val) { const el=document.getElementById(id); if(el) el.textContent=val; }

async function loadFundingRate(symbol) {
  try {
    const res = await fetch(`https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${symbol}`);
    if (!res.ok) throw new Error();
    const d = await res.json();
    const rate = parseFloat(d.lastFundingRate)*100;
    const el = document.getElementById('gFunding');
    if (el) {
      el.textContent = (rate>=0?'+':'')+rate.toFixed(4)+'%';
      el.className = 'gv num ' + (rate>=0?'up':'down');
    }
  } catch(e) {
    setText('gFunding', '—');
  }
}

// =====================================================
// INDICATOR CALCULATION LIBRARY
// All functions take `candles` = [{time,open,high,low,close,volume}]
// =====================================================

function ind_sma(candles, period, srcFn) {
  srcFn = srcFn || (c=>c.close);
  const out = [];
  for (let i=period-1;i<candles.length;i++) {
    let sum=0;
    for (let j=i-period+1;j<=i;j++) sum += srcFn(candles[j]);
    out.push({ time:candles[i].time, value: sum/period });
  }
  return out;
}

function ind_ema_series(candles, period, srcFn) {
  srcFn = srcFn || (c=>c.close);
  const k = 2/(period+1);
  const out = [];
  let prev = srcFn(candles[0]);
  out.push({ time:candles[0].time, value:prev });
  for (let i=1;i<candles.length;i++) {
    prev = srcFn(candles[i])*k + prev*(1-k);
    out.push({ time:candles[i].time, value:prev });
  }
  return out;
}

function ind_bollinger(candles, period=20, mult=2) {
  const mid = ind_sma(candles, period);
  const upper = [], lower = [];
  for (let idx=0; idx<mid.length; idx++) {
    const i = idx + period - 1;
    let sumSq = 0;
    for (let j=i-period+1;j<=i;j++) sumSq += Math.pow(candles[j].close - mid[idx].value, 2);
    const sd = Math.sqrt(sumSq/period);
    upper.push({ time:mid[idx].time, value: mid[idx].value + mult*sd });
    lower.push({ time:mid[idx].time, value: mid[idx].value - mult*sd });
  }
  return { mid, upper, lower };
}

function ind_vwap(candles) {
  let cumPV = 0, cumVol = 0;
  return candles.map(c => {
    const typical = (c.high+c.low+c.close)/3;
    cumPV += typical*c.volume;
    cumVol += c.volume;
    return { time:c.time, value: cumVol ? cumPV/cumVol : typical };
  });
}

function ind_psar(candles, step=0.02, max=0.2) {
  if (candles.length < 2) return [];
  const out = [];
  let uptrend = true;
  let af = step;
  let ep = candles[0].high;
  let sar = candles[0].low;
  for (let i=1;i<candles.length;i++) {
    sar = sar + af*(ep - sar);
    if (uptrend) {
      if (candles[i].low < sar) {
        uptrend = false; sar = ep; af = step; ep = candles[i].low;
      } else {
        if (candles[i].high > ep) { ep = candles[i].high; af = Math.min(af+step, max); }
      }
    } else {
      if (candles[i].high > sar) {
        uptrend = true; sar = ep; af = step; ep = candles[i].high;
      } else {
        if (candles[i].low < ep) { ep = candles[i].low; af = Math.min(af+step, max); }
      }
    }
    out.push({ time:candles[i].time, value:sar });
  }
  return out;
}

function ind_rsi(candles, period=14) {
  const out = [];
  let gains=0, losses=0;
  for (let i=1;i<candles.length;i++) {
    const diff = candles[i].close - candles[i-1].close;
    if (i <= period) {
      if (diff>=0) gains+=diff; else losses-=diff;
      if (i===period) {
        const rs = losses===0 ? 100 : (gains/period)/(losses/period);
        out.push({ time:candles[i].time, value:100-100/(1+rs) });
      }
      continue;
    }
    const gain = diff>0?diff:0, loss = diff<0?-diff:0;
    gains = (gains*(period-1)+gain)/period;
    losses = (losses*(period-1)+loss)/period;
    const rs = losses===0 ? 100 : gains/losses;
    out.push({ time:candles[i].time, value:100-100/(1+rs) });
  }
  return out;
}

function ind_stochastic(candles, kPeriod=14, dPeriod=3) {
  const kVals = [];
  for (let i=kPeriod-1;i<candles.length;i++) {
    let hh=-Infinity, ll=Infinity;
    for (let j=i-kPeriod+1;j<=i;j++) { hh=Math.max(hh,candles[j].high); ll=Math.min(ll,candles[j].low); }
    const k = hh===ll ? 50 : (candles[i].close-ll)/(hh-ll)*100;
    kVals.push({ time:candles[i].time, value:k });
  }
  const dVals = [];
  for (let i=dPeriod-1;i<kVals.length;i++) {
    let sum=0;
    for (let j=i-dPeriod+1;j<=i;j++) sum+=kVals[j].value;
    dVals.push({ time:kVals[i].time, value:sum/dPeriod });
  }
  return { k:kVals, d:dVals };
}

function ind_cci(candles, period=20) {
  const out = [];
  for (let i=period-1;i<candles.length;i++) {
    const tp = [];
    for (let j=i-period+1;j<=i;j++) tp.push((candles[j].high+candles[j].low+candles[j].close)/3);
    const sma = tp.reduce((a,b)=>a+b,0)/period;
    const meanDev = tp.reduce((a,b)=>a+Math.abs(b-sma),0)/period;
    const curTp = (candles[i].high+candles[i].low+candles[i].close)/3;
    out.push({ time:candles[i].time, value: meanDev===0?0:(curTp-sma)/(0.015*meanDev) });
  }
  return out;
}

function ind_williamsR(candles, period=14) {
  const out = [];
  for (let i=period-1;i<candles.length;i++) {
    let hh=-Infinity, ll=Infinity;
    for (let j=i-period+1;j<=i;j++) { hh=Math.max(hh,candles[j].high); ll=Math.min(ll,candles[j].low); }
    out.push({ time:candles[i].time, value: hh===ll?-50:((hh-candles[i].close)/(hh-ll))*-100 });
  }
  return out;
}

function ind_momentum(candles, period=10) {
  const out = [];
  for (let i=period;i<candles.length;i++) {
    out.push({ time:candles[i].time, value: candles[i].close - candles[i-period].close });
  }
  return out;
}

function ind_atr(candles, period=14) {
  const trs = [];
  for (let i=1;i<candles.length;i++) {
    const tr = Math.max(
      candles[i].high-candles[i].low,
      Math.abs(candles[i].high-candles[i-1].close),
      Math.abs(candles[i].low-candles[i-1].close)
    );
    trs.push(tr);
  }
  const out = [];
  let atr = trs.slice(0,period).reduce((a,b)=>a+b,0)/period;
  out.push({ time:candles[period].time, value:atr });
  for (let i=period;i<trs.length;i++) {
    atr = (atr*(period-1)+trs[i])/period;
    out.push({ time:candles[i+1].time, value:atr });
  }
  return out;
}

function ind_adx(candles, period=14) {
  const out = [];
  const plusDM=[], minusDM=[], tr=[];
  for (let i=1;i<candles.length;i++) {
    const upMove = candles[i].high - candles[i-1].high;
    const downMove = candles[i-1].low - candles[i].low;
    plusDM.push(upMove>downMove && upMove>0 ? upMove : 0);
    minusDM.push(downMove>upMove && downMove>0 ? downMove : 0);
    tr.push(Math.max(candles[i].high-candles[i].low, Math.abs(candles[i].high-candles[i-1].close), Math.abs(candles[i].low-candles[i-1].close)));
  }
  let smTR=tr.slice(0,period).reduce((a,b)=>a+b,0);
  let smPlus=plusDM.slice(0,period).reduce((a,b)=>a+b,0);
  let smMinus=minusDM.slice(0,period).reduce((a,b)=>a+b,0);
  const dxs=[];
  for (let i=period;i<tr.length;i++) {
    smTR = smTR - smTR/period + tr[i];
    smPlus = smPlus - smPlus/period + plusDM[i];
    smMinus = smMinus - smMinus/period + minusDM[i];
    const pdi = smTR===0?0:(smPlus/smTR)*100;
    const mdi = smTR===0?0:(smMinus/smTR)*100;
    const dx = (pdi+mdi)===0?0:Math.abs(pdi-mdi)/(pdi+mdi)*100;
    dxs.push({ time:candles[i+1].time, dx });
  }
  let adx = dxs.slice(0,period).reduce((a,b)=>a+b.dx,0)/period;
  out.push({ time:dxs[period-1]?.time, value:adx });
  for (let i=period;i<dxs.length;i++) {
    adx = (adx*(period-1)+dxs[i].dx)/period;
    out.push({ time:dxs[i].time, value:adx });
  }
  return out.filter(p=>p.time!=null);
}

function ind_macd(candles, fast=12, slow=26, signal=9) {
  const emaFast = ind_ema_series(candles, fast).map(p=>p.value);
  const emaSlow = ind_ema_series(candles, slow).map(p=>p.value);
  const macdLine = candles.map((c,i)=>({ time:c.time, value: emaFast[i]-emaSlow[i] }));
  const k = 2/(signal+1);
  let prev = macdLine[0].value;
  const signalLine = [{ time:macdLine[0].time, value:prev }];
  for (let i=1;i<macdLine.length;i++) {
    prev = macdLine[i].value*k + prev*(1-k);
    signalLine.push({ time:macdLine[i].time, value:prev });
  }
  const hist = macdLine.map((p,i)=>({ time:p.time, value:p.value-signalLine[i].value, color: (p.value-signalLine[i].value)>=0?'rgba(0,200,83,0.6)':'rgba(246,70,93,0.6)' }));
  return { macd:macdLine, signal:signalLine, hist };
}

// =====================================================
// CHART INSTANCE — one fully self-contained chart panel.
// Every instance in the multi-chart grid gets its own pair,
// timeframe, indicators, and live data connection.
// =====================================================
class ChartInstance {
  constructor(container, initialSymbol) {
    this.id = ++instanceIdSeq;
    this.container = container;
    this.symbol = initialSymbol || 'BTCUSDT';
    this.tf = '15m';
    this.customMinutes = null; // set when using a non-standard aggregated custom timeframe
    this.candles = [];
    this.ws = null;
    this.overlays = {};      // key -> {series, seriesArr}
    this.oscKey = null;      // currently active single-slot oscillator
    this.oscSeries = null;
    this.extras = {};        // macd/atr/volume -> {chart, series...}
    this.customIndicators = []; // [{id,name,type,source,length,color,series}]

    this.buildDOM();
    this.initChart();
    this.loadData();
  }

  buildDOM() {
    this.container.innerHTML = `
      <div class="ci-toolbar">
        <button class="ci-pair-btn" data-role="pairBtn"><img data-role="pairLogo" src=""><span data-role="pairSym">BTC/USDT</span></button>
        <span class="ci-price num" data-role="price">—</span>
        <button class="ci-icon-btn" data-role="tfBtn">15m ▾</button>
        <span class="ci-countdown num" data-role="countdown" title="Time until this candle closes">—</span>
        <button class="ci-icon-btn" data-role="indBtn">Indicators</button>
        <span class="ci-close" data-role="closeBtn" title="Close this chart">✕</span>
      </div>
      <div class="ci-body">
        <div class="ci-main-pane" data-role="mainPane"></div>
        <div class="ci-sub-pane" data-role="oscPane" style="display:none"><span class="ci-sub-label" data-role="oscLabel"></span></div>
        <div class="ci-sub-pane" data-role="macdPane" style="display:none"><span class="ci-sub-label">MACD (12,26,9)</span></div>
        <div class="ci-sub-pane" data-role="atrPane" style="display:none"><span class="ci-sub-label">ATR (14)</span></div>
        <div class="ci-sub-pane" data-role="volPane" style="display:none"><span class="ci-sub-label">Volume</span></div>
      </div>
    `;

    this.el = {
      pairBtn: this.container.querySelector('[data-role=pairBtn]'),
      pairLogo: this.container.querySelector('[data-role=pairLogo]'),
      pairSym: this.container.querySelector('[data-role=pairSym]'),
      price: this.container.querySelector('[data-role=price]'),
      tfBtn: this.container.querySelector('[data-role=tfBtn]'),
      countdown: this.container.querySelector('[data-role=countdown]'),
      indBtn: this.container.querySelector('[data-role=indBtn]'),
      closeBtn: this.container.querySelector('[data-role=closeBtn]'),
      mainPane: this.container.querySelector('[data-role=mainPane]'),
      oscPane: this.container.querySelector('[data-role=oscPane]'),
      oscLabel: this.container.querySelector('[data-role=oscLabel]'),
      macdPane: this.container.querySelector('[data-role=macdPane]'),
      atrPane: this.container.querySelector('[data-role=atrPane]'),
      volPane: this.container.querySelector('[data-role=volPane]'),
    };

    this.el.tfBtn.addEventListener('click', (e) => openTFDropdown(this, e.currentTarget));
    this.el.pairBtn.addEventListener('click', (e) => openPairDropdown(this, e.currentTarget));
    this.el.indBtn.addEventListener('click', () => openIndModal(this));
    this.el.closeBtn.addEventListener('click', () => this.destroy());

    this.updatePairDisplay();
  }

  setTF(tf) {
    this.tf = tf;
    this.customMinutes = null;
    this.el.tfBtn.textContent = tf + ' ▾';
    this.loadData();
  }

  setCustomTF(minutes) {
    // If the requested custom value happens to match a standard Binance
    // interval exactly, just use that directly (native support, more efficient)
    const standardMatch = Object.entries(TF_SECONDS).find(([k,s]) => s === minutes*60 && TF_LIST.includes(k));
    if (standardMatch) { this.setTF(standardMatch[0]); return; }

    this.customMinutes = minutes;
    this.tf = null;
    const label = minutes >= 1440 ? (minutes/1440)+'d' : minutes >= 60 ? (minutes/60)+'h' : minutes+'m';
    this.el.tfBtn.textContent = label + ' ▾';
    this.loadData();
  }

  updateCountdown() {
    const secs = this.customMinutes ? this.customMinutes*60 : TF_SECONDS[this.tf];
    if (!secs || !this.candles.length) { this.el.countdown.textContent = '—'; return; }
    const lastCandleTime = this.candles[this.candles.length-1].time;
    const closeTime = lastCandleTime + secs;
    const remaining = Math.max(0, closeTime - Math.floor(Date.now()/1000));
    const h = Math.floor(remaining/3600), m = Math.floor((remaining%3600)/60), s = remaining%60;
    this.el.countdown.textContent = h>0
      ? `${h}h ${String(m).padStart(2,'0')}m`
      : `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  }

  updatePairDisplay() {
    const coin = coinList.find(c => c.binanceSymbol === this.symbol);
    const sym = this.symbol.replace('USDT','');
    this.el.pairSym.textContent = sym + '/USDT';
    this.el.pairLogo.src = coin ? coin.logo : `https://raw.githubusercontent.com/spothq/cryptocurrency-icons/master/128/color/${sym.toLowerCase()}.png`;
  }

  initChart() {
    const opts = {
      layout: { background:{color:'#ffffff'}, textColor:'#555' },
      grid: { vertLines:{color:'#f0f0f0'}, horzLines:{color:'#f0f0f0'} },
      crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
      timeScale: { timeVisible:true, secondsVisible:false, borderColor:'#e0e0e0' },
      rightPriceScale: { borderColor:'#e0e0e0' },
    };
    this.chart = LightweightCharts.createChart(this.el.mainPane, opts);
    this.candleSeries = this.chart.addCandlestickSeries({
      upColor:'#00c853', downColor:'#f6465d',
      borderUpColor:'#00c853', borderDownColor:'#f6465d',
      wickUpColor:'#00c853', wickDownColor:'#f6465d',
    });
  }

  resize() {
    const w = this.el.mainPane.clientWidth || this.container.clientWidth;
    const h = this.el.mainPane.clientHeight || 200;
    if (this.chart) this.chart.resize(w, h);
    if (this.oscChart) this.oscChart.resize(this.el.oscPane.clientWidth, this.el.oscPane.clientHeight);
    if (this.macdChart) this.macdChart.resize(this.el.macdPane.clientWidth, this.el.macdPane.clientHeight);
    if (this.atrChart) this.atrChart.resize(this.el.atrPane.clientWidth, this.el.atrPane.clientHeight);
    if (this.volChart) this.volChart.resize(this.el.volPane.clientWidth, this.el.volPane.clientHeight);
  }

  async loadData() {
    try {
      if (this.customMinutes) {
        // Custom timeframe: fetch base 1m candles and aggregate client-side
        // into N-minute buckets (Binance only natively supports the standard
        // interval set, so anything else has to be built up from 1m data).
        const res = await fetch(`https://api.binance.com/api/v3/klines?symbol=${this.symbol}&interval=1m&limit=1000`);
        const raw = await res.json();
        const base = raw.map(k => ({
          time: Math.floor(k[0]/1000),
          open: parseFloat(k[1]), high: parseFloat(k[2]), low: parseFloat(k[3]), close: parseFloat(k[4]),
          volume: parseFloat(k[5]),
        }));
        this.candles = aggregateCandles(base, this.customMinutes);
      } else {
        const res = await fetch(`https://api.binance.com/api/v3/klines?symbol=${this.symbol}&interval=${this.tf}&limit=400`);
        const raw = await res.json();
        this.candles = raw.map(k => ({
          time: Math.floor(k[0]/1000),
          open: parseFloat(k[1]), high: parseFloat(k[2]), low: parseFloat(k[3]), close: parseFloat(k[4]),
          volume: parseFloat(k[5]),
        }));
      }
      this.candleSeries.setData(this.candles.map(c=>({time:c.time,open:c.open,high:c.high,low:c.low,close:c.close})));
      this.refreshAllIndicators();
      this.connectWS();
      if (this.id === 1 || instances[0] === this) loadFundingRate(this.symbol);
    } catch(e) { console.error('Chart data load failed', e); }
  }

  connectWS() {
    if (this.ws) this.ws.close();
    // Custom timeframes subscribe to the raw 1m stream and aggregate live;
    // standard timeframes use Binance's own pre-aggregated kline stream directly.
    const streamInterval = this.customMinutes ? '1m' : this.tf;
    this.ws = new WebSocket(`wss://stream.binance.com:9443/ws/${this.symbol.toLowerCase()}@kline_${streamInterval}`);
    this.ws.onmessage = (e) => {
      const k = JSON.parse(e.data).k;
      const raw1m = { time:Math.floor(k.t/1000), open:parseFloat(k.o), high:parseFloat(k.h), low:parseFloat(k.l), close:parseFloat(k.c), volume:parseFloat(k.v) };

      let candle = raw1m;
      if (this.customMinutes) {
        const bucketTime = Math.floor(raw1m.time / (this.customMinutes*60)) * (this.customMinutes*60);
        const last = this.candles[this.candles.length-1];
        if (last && last.time === bucketTime) {
          last.high = Math.max(last.high, raw1m.high);
          last.low = Math.min(last.low, raw1m.low);
          last.close = raw1m.close;
          last.volume += raw1m.volume; // approximate running volume within the bucket
          candle = last;
        } else {
          candle = { time:bucketTime, open:raw1m.open, high:raw1m.high, low:raw1m.low, close:raw1m.close, volume:raw1m.volume };
          this.candles.push(candle);
        }
      } else {
        if (this.candles.length && this.candles[this.candles.length-1].time === candle.time) this.candles[this.candles.length-1] = candle;
        else this.candles.push(candle);
      }

      this.candleSeries.update({ time:candle.time, open:candle.open, high:candle.high, low:candle.low, close:candle.close });
      this.el.price.textContent = '$'+fmtPrice(candle.close);
      this.el.price.className = 'ci-price num ' + (candle.close>=candle.open?'up':'down');
      this.refreshAllIndicators();
    };
    this.ws.onclose = () => setTimeout(()=>{ if(this.container.isConnected) this.connectWS(); }, 3000);
  }

  changePair(binanceSymbol) {
    this.symbol = binanceSymbol;
    this.updatePairDisplay();
    this.loadData();
  }

  // ===== INDICATOR MANAGEMENT =====
  toggleOverlay(key) {
    if (this.overlays[key]) {
      const ov = this.overlays[key];
      (ov.seriesArr||[ov.series]).forEach(s => this.chart.removeSeries(s));
      delete this.overlays[key];
    } else {
      const def = OVERLAY_DEFS.find(o=>o.key===key);
      if (key==='bb') {
        const upper = this.chart.addLineSeries({ color:def.color, lineWidth:1 });
        const mid   = this.chart.addLineSeries({ color:def.color, lineWidth:1, lineStyle:2 });
        const lower = this.chart.addLineSeries({ color:def.color, lineWidth:1 });
        this.overlays[key] = { seriesArr:[upper,mid,lower] };
      } else {
        const series = this.chart.addLineSeries({ color:def.color, lineWidth:1.5, priceLineVisible:false });
        this.overlays[key] = { series };
      }
      this.refreshOverlay(key);
    }
  }

  refreshOverlay(key) {
    const ov = this.overlays[key];
    if (!ov || this.candles.length < 5) return;
    if (key==='sma20') ov.series.setData(ind_sma(this.candles,20));
    if (key==='ema20') ov.series.setData(ind_ema_series(this.candles,20));
    if (key==='vwap') ov.series.setData(ind_vwap(this.candles));
    if (key==='psar') ov.series.setData(ind_psar(this.candles));
    if (key==='bb') {
      const bb = ind_bollinger(this.candles);
      ov.seriesArr[0].setData(bb.upper);
      ov.seriesArr[1].setData(bb.mid);
      ov.seriesArr[2].setData(bb.lower);
    }
  }

  setOscillator(key) {
    if (this.oscKey === key) {
      // turning off
      this.oscChart?.remove();
      this.oscChart = null; this.oscSeries = null; this.oscSeries2 = null;
      this.oscKey = null;
      this.el.oscPane.style.display = 'none';
      this.resize();
      return;
    }
    this.oscKey = key;
    this.el.oscPane.style.display = 'block';
    this.el.oscLabel.textContent = OSC_DEFS.find(o=>o.key===key).name;
    if (!this.oscChart) {
      this.oscChart = LightweightCharts.createChart(this.el.oscPane, {
        layout:{ background:{color:'#ffffff'}, textColor:'#555' },
        grid:{ vertLines:{color:'#f5f5f5'}, horzLines:{color:'#f5f5f5'} },
        timeScale:{ visible:false }, rightPriceScale:{ borderColor:'#e0e0e0' },
      });
      this.chart.timeScale().subscribeVisibleLogicalRangeChange(r => this.oscChart && this.oscChart.timeScale().setVisibleLogicalRange(r));
    }
    if (this.oscSeries) { this.oscChart.removeSeries(this.oscSeries); this.oscSeries=null; }
    if (this.oscSeries2) { this.oscChart.removeSeries(this.oscSeries2); this.oscSeries2=null; }
    this.oscSeries = this.oscChart.addLineSeries({ color:'#00b4d8', lineWidth:1.5 });
    if (key==='stoch') this.oscSeries2 = this.oscChart.addLineSeries({ color:'#ff9800', lineWidth:1.5 });
    this.refreshOscillator();
    this.resize();
  }

  refreshOscillator() {
    if (!this.oscKey || this.candles.length < 20) return;
    if (this.oscKey==='rsi') this.oscSeries.setData(ind_rsi(this.candles));
    if (this.oscKey==='cci') this.oscSeries.setData(ind_cci(this.candles));
    if (this.oscKey==='willr') this.oscSeries.setData(ind_williamsR(this.candles));
    if (this.oscKey==='mom') this.oscSeries.setData(ind_momentum(this.candles));
    if (this.oscKey==='adx') this.oscSeries.setData(ind_adx(this.candles));
    if (this.oscKey==='stoch') {
      const s = ind_stochastic(this.candles);
      this.oscSeries.setData(s.k);
      this.oscSeries2.setData(s.d);
    }
  }

  toggleExtra(key) {
    if (this.extras[key]) {
      this.extras[key].chart.remove();
      delete this.extras[key];
      this.el[key+'Pane'] ? (this.el[key==='macd'?'macdPane':key==='atr'?'atrPane':'volPane'].style.display='none') : null;
      this.resize();
      return;
    }
    const paneEl = key==='macd' ? this.el.macdPane : key==='atr' ? this.el.atrPane : this.el.volPane;
    paneEl.style.display = 'block';
    const chart = LightweightCharts.createChart(paneEl, {
      layout:{ background:{color:'#ffffff'}, textColor:'#555' },
      grid:{ vertLines:{color:'#f5f5f5'}, horzLines:{color:'#f5f5f5'} },
      timeScale:{ visible:false }, rightPriceScale:{ borderColor:'#e0e0e0' },
    });
    this.chart.timeScale().subscribeVisibleLogicalRangeChange(r => chart.timeScale().setVisibleLogicalRange(r));

    if (key==='macd') {
      const hist = chart.addHistogramSeries({});
      const line = chart.addLineSeries({ color:'#2962ff', lineWidth:1.5 });
      const signal = chart.addLineSeries({ color:'#ff9800', lineWidth:1.5 });
      this.extras.macd = { chart, hist, line, signal };
    }
    if (key==='atr') {
      const line = chart.addLineSeries({ color:'#e53935', lineWidth:1.5 });
      this.extras.atr = { chart, line };
    }
    if (key==='volume') {
      const hist = chart.addHistogramSeries({});
      this.extras.volume = { chart, hist };
    }
    this.refreshExtra(key);
    this.resize();
  }

  refreshExtra(key) {
    const ex = this.extras[key];
    if (!ex || this.candles.length < 5) return;
    if (key==='macd') {
      const m = ind_macd(this.candles);
      ex.hist.setData(m.hist); ex.line.setData(m.macd); ex.signal.setData(m.signal);
    }
    if (key==='atr') ex.line.setData(ind_atr(this.candles));
    if (key==='volume') ex.hist.setData(this.candles.map(c=>({ time:c.time, value:c.volume, color:c.close>=c.open?'rgba(0,200,83,0.5)':'rgba(246,70,93,0.5)' })));
  }

  // ===== CUSTOM INDICATORS =====
  addCustomIndicator(cfg) {
    const srcFn = SRC_FN[cfg.source] || (c=>c.close);
    let series, isOscillator = cfg.type==='diff';
    if (isOscillator) {
      if (!this.oscChart) this.setOscillator('__custom__'); // reuse osc pane infra minimally
    }
    series = this.chart.addLineSeries({ color:cfg.color, lineWidth:1.5, priceLineVisible:false, title:cfg.name });
    const entry = { ...cfg, series };
    this.customIndicators.push(entry);
    this.refreshCustomIndicator(entry);
    return entry;
  }
  refreshCustomIndicator(entry) {
    if (this.candles.length < entry.length+2) return;
    const srcFn = SRC_FN[entry.source] || (c=>c.close);
    if (entry.type==='sma') entry.series.setData(ind_sma(this.candles, entry.length, srcFn));
    if (entry.type==='ema') entry.series.setData(ind_ema_series(this.candles, entry.length, srcFn));
    if (entry.type==='diff') {
      const ma = ind_ema_series(this.candles, entry.length, srcFn);
      const data = this.candles.map((c,i)=>({ time:c.time, value: ma[i] ? ((srcFn(c)-ma[i].value)/ma[i].value*100) : 0 }));
      entry.series.setData(data);
    }
  }
  removeCustomIndicator(id) {
    const entry = this.customIndicators.find(e=>e.id===id);
    if (entry) {
      const targetChart = entry.plotType==='oscillator' ? this.oscChart : this.chart;
      try { targetChart && targetChart.removeSeries(entry.series); } catch(e) {}
      this.customIndicators = this.customIndicators.filter(e=>e.id!==id);
    }
  }

  refreshAllIndicators() {
    Object.keys(this.overlays).forEach(k=>this.refreshOverlay(k));
    this.refreshOscillator();
    Object.keys(this.extras).forEach(k=>this.refreshExtra(k));
    this.customIndicators.forEach(e=>this.refreshCustomIndicator(e));
  }

  destroy() {
    if (this.ws) this.ws.close();
    if (this.chart) this.chart.remove();
    if (this.oscChart) this.oscChart.remove();
    Object.values(this.extras).forEach(ex=>ex.chart.remove());
    this.container.remove();
    instances = instances.filter(i => i !== this);
    if (!instances.length) addInstance(); // never leave zero charts
    layoutGrid();
  }
}

const SRC_FN = {
  close: c=>c.close, open:c=>c.open, high:c=>c.high, low:c=>c.low, hl2:c=>(c.high+c.low)/2,
};

// =====================================================
// LAYOUT MANAGEMENT
// =====================================================
function setLayout(n, el) {
  currentLayout = n;
  document.querySelectorAll('.layout-btn').forEach(b=>b.classList.remove('active'));
  if (el) el.classList.add('active');

  const grid = document.getElementById('chartGrid');

  // Adjust instance count
  while (instances.length < n) addInstance();
  while (instances.length > n) instances[instances.length-1].destroy();

  layoutGrid();
}

function layoutGrid() {
  const grid = document.getElementById('chartGrid');
  const n = instances.length;
  const topbar = document.getElementById('topbar');
  const topH = topbar ? topbar.offsetHeight : 60;
  grid.style.top = topH + 'px';

  grid.style.gridTemplateAreas = '';
  if (n === 1) {
    grid.style.gridTemplateColumns = '1fr';
    grid.style.gridTemplateRows = '1fr';
  } else if (n === 2) {
    grid.style.gridTemplateColumns = '1fr';
    grid.style.gridTemplateRows = '1fr 1fr';
  } else if (n === 3) {
    grid.style.gridTemplateColumns = '1fr 1fr';
    grid.style.gridTemplateRows = '1fr 1fr';
    instances[0].container.style.gridColumn = '1';
    instances[0].container.style.gridRow = '1';
    instances[1].container.style.gridColumn = '2';
    instances[1].container.style.gridRow = '1';
    instances[2].container.style.gridColumn = '1 / span 2';
    instances[2].container.style.gridRow = '2';
  } else if (n === 4) {
    grid.style.gridTemplateColumns = '1fr 1fr';
    grid.style.gridTemplateRows = '1fr 1fr';
  } else if (n === 6) {
    grid.style.gridTemplateColumns = '1fr 1fr 1fr';
    grid.style.gridTemplateRows = '1fr 1fr';
  }

  // Clear explicit column/row for non-3 layouts (grid auto-flow handles it)
  if (n !== 3) {
    instances.forEach(inst => { inst.container.style.gridColumn=''; inst.container.style.gridRow=''; });
  }

  requestAnimationFrame(() => instances.forEach(inst => inst.resize()));
}

function addInstance() {
  const container = document.createElement('div');
  container.className = 'chart-instance';
  document.getElementById('chartGrid').appendChild(container);
  const defaultSymbol = instances.length ? instances[0].symbol : 'BTCUSDT';
  const inst = new ChartInstance(container, defaultSymbol);
  instances.push(inst);
  return inst;
}

window.addEventListener('resize', layoutGrid);

// =====================================================
// SEARCHABLE PAIR DROPDOWN
// =====================================================
function openPairDropdown(instance, anchorEl) {
  activeInstanceForDropdown = instance;
  const dd = document.getElementById('pairDropdown');
  const rect = anchorEl.getBoundingClientRect();
  dd.style.display = 'flex';
  dd.style.left = Math.min(rect.left, window.innerWidth-290) + 'px';
  dd.style.top = (rect.bottom + 6) + 'px';
  document.getElementById('pdSearchInput').value = '';
  renderPairList('');
  document.getElementById('pdSearchInput').focus();
}
function renderPairList(query) {
  const list = document.getElementById('pdList');
  const q = query.trim().toUpperCase();

  let filtered;
  if (!q) {
    // No search yet — show only the top 10 by rank, exactly as requested
    filtered = coinList.slice(0, 10);
  } else {
    // Searching — check the FULL list (every Binance USDT pair), not just top-ranked ones
    filtered = coinList.filter(c => c.sym.includes(q) || c.name.toUpperCase().includes(q)).slice(0, 80);
  }

  list.innerHTML = filtered.map(c => `
    <div class="pd-item" data-sym="${c.binanceSymbol}">
      <span class="pd-rank">${c.rank ? '#'+c.rank : '—'}</span>
      <img src="${c.logo}" alt="" onerror="this.style.visibility='hidden'">
      <div><div class="pd-sym">${c.sym}/USDT</div><div class="pd-name">${c.name}</div></div>
    </div>
  `).join('');
  list.querySelectorAll('.pd-item').forEach(item => {
    item.addEventListener('click', () => {
      if (activeInstanceForDropdown) activeInstanceForDropdown.changePair(item.dataset.sym);
      document.getElementById('pairDropdown').style.display = 'none';
    });
  });
}
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('pdSearchInput').addEventListener('input', e => renderPairList(e.target.value));
});
document.addEventListener('click', (e) => {
  const dd = document.getElementById('pairDropdown');
  if (dd.style.display==='flex' && !dd.contains(e.target) && !e.target.closest('.ci-pair-btn')) {
    dd.style.display = 'none';
  }
});

// =====================================================
// INDICATOR MODAL
// =====================================================
function openIndModal(instance) {
  activeInstanceForModal = instance;
  renderIndModalLists();
  document.getElementById('indModal').style.display = 'flex';
}
function closeIndModal() { document.getElementById('indModal').style.display = 'none'; }

function renderIndModalLists() {
  const inst = activeInstanceForModal;
  if (!inst) return;

  document.getElementById('overlayList').innerHTML = OVERLAY_DEFS.map(o => `
    <div class="ind-row" data-key="${o.key}" data-group="overlay">
      <span class="ind-name">${o.name}</span>
      <div class="ind-toggle ${inst.overlays[o.key]?'on':''}"></div>
    </div>`).join('');

  document.getElementById('oscList').innerHTML = OSC_DEFS.map(o => `
    <div class="ind-row" data-key="${o.key}" data-group="osc">
      <span class="ind-name">${o.name}</span>
      <div class="ind-toggle ${inst.oscKey===o.key?'on':''}"></div>
    </div>`).join('');

  document.getElementById('extraList').innerHTML = EXTRA_DEFS.map(o => `
    <div class="ind-row" data-key="${o.key}" data-group="extra">
      <span class="ind-name">${o.name}</span>
      <div class="ind-toggle ${inst.extras[o.key]?'on':''}"></div>
    </div>`).join('');

  document.querySelectorAll('#indModal .ind-row').forEach(row => {
    row.addEventListener('click', () => {
      const key = row.dataset.key, group = row.dataset.group;
      if (group==='overlay') inst.toggleOverlay(key);
      if (group==='osc') inst.setOscillator(key);
      if (group==='extra') inst.toggleExtra(key);
      renderIndModalLists();
    });
  });

  renderCustomList();
}

function switchIndTab(tab, el) {
  document.querySelectorAll('.tab-switch button').forEach(b=>b.classList.remove('active'));
  el.classList.add('active');
  document.getElementById('tabLibrary').classList.toggle('active', tab==='library');
  document.getElementById('tabCustom').classList.toggle('active', tab==='custom');
}

function addCustomIndicator() {
  const inst = activeInstanceForModal;
  if (!inst) return;
  const name = document.getElementById('cbName').value.trim() || 'Custom';
  const type = document.getElementById('cbType').value;
  const source = document.getElementById('cbSource').value;
  const length = parseInt(document.getElementById('cbLength').value) || 20;
  const color = document.getElementById('cbColor').value;

  const entry = inst.addCustomIndicator({ id:Date.now(), name, type, source, length, color });
  renderCustomList();
}

function renderCustomList() {
  const inst = activeInstanceForModal;
  const list = document.getElementById('customList');
  if (!inst) { list.innerHTML=''; return; }
  list.innerHTML = inst.customIndicators.map(e => `
    <div class="cb-custom-item">
      <span><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${e.color};margin-right:6px"></span>${e.name} (${e.type.toUpperCase()}, ${e.length})</span>
      <span class="cb-custom-remove" onclick="removeCustom(${e.id})">✕ Remove</span>
    </div>`).join('');
}
function removeCustom(id) {
  if (activeInstanceForModal) activeInstanceForModal.removeCustomIndicator(id);
  renderCustomList();
}

// =====================================================
// INIT
// =====================================================
// =====================================================
// CUSTOM TIMEFRAME AGGREGATION — buckets 1m candles into N-minute candles
// =====================================================
function aggregateCandles(base1m, minutes) {
  const bucketSize = minutes*60;
  const buckets = new Map();
  base1m.forEach(c => {
    const bt = Math.floor(c.time/bucketSize)*bucketSize;
    if (!buckets.has(bt)) {
      buckets.set(bt, { time:bt, open:c.open, high:c.high, low:c.low, close:c.close, volume:c.volume });
    } else {
      const b = buckets.get(bt);
      b.high = Math.max(b.high, c.high);
      b.low = Math.min(b.low, c.low);
      b.close = c.close;
      b.volume += c.volume;
    }
  });
  return Array.from(buckets.values()).sort((a,b)=>a.time-b.time);
}

// =====================================================
// TF DROPDOWN (popover) — keeps the toolbar clean instead of showing
// every timeframe as a permanent row of buttons
// =====================================================
function openTFDropdown(instance, anchorEl) {
  activeInstanceForDropdown = instance;
  let dd = document.getElementById('tfDropdown');
  if (!dd) {
    dd = document.createElement('div');
    dd.id = 'tfDropdown';
    dd.className = 'pair-dropdown';
    dd.style.width = '220px';
    document.body.appendChild(dd);
  }
  dd.innerHTML = `
    <div style="padding:10px;display:grid;grid-template-columns:repeat(4,1fr);gap:4px;">
      ${TF_LIST.map(tf=>`<button class="ci-tf-btn" style="padding:7px 4px;border:1px solid #eee;border-radius:6px;" data-tf="${tf}">${tf}</button>`).join('')}
    </div>
    <div style="padding:10px;border-top:1px solid #eee;display:flex;gap:5px;align-items:center;">
      <input type="number" id="customTfNum" placeholder="e.g. 45" min="1" style="width:60px;padding:6px;border:1px solid #e0e0e0;border-radius:6px;font-size:11px;">
      <select id="customTfUnit" style="padding:6px;border:1px solid #e0e0e0;border-radius:6px;font-size:11px;">
        <option value="1">Minutes</option>
        <option value="60">Hours</option>
        <option value="1440">Days</option>
      </select>
      <button id="customTfSet" style="padding:6px 10px;background:#111;color:#fff;border:none;border-radius:6px;font-size:11px;cursor:pointer;">Set</button>
    </div>
  `;
  dd.style.display = 'flex';
  dd.style.flexDirection = 'column';
  const rect = anchorEl.getBoundingClientRect();
  dd.style.left = Math.min(rect.left, window.innerWidth-230) + 'px';
  dd.style.top = (rect.bottom + 6) + 'px';

  dd.querySelectorAll('[data-tf]').forEach(btn => {
    btn.addEventListener('click', () => { instance.setTF(btn.dataset.tf); dd.style.display='none'; });
  });
  dd.querySelector('#customTfSet').addEventListener('click', () => {
    const n = parseInt(document.getElementById('customTfNum').value);
    const unit = parseInt(document.getElementById('customTfUnit').value);
    if (n > 0) { instance.setCustomTF(n*unit); dd.style.display='none'; }
  });
}
document.addEventListener('click', (e) => {
  const dd = document.getElementById('tfDropdown');
  if (dd && dd.style.display!=='none' && !dd.contains(e.target) && !e.target.closest('[data-role=tfBtn]')) {
    dd.style.display = 'none';
  }
});

// ===== CANDLE COUNTDOWN TICKER =====
setInterval(() => { instances.forEach(inst => inst.updateCountdown()); }, 1000);

// =====================================================
// CODE-MODE CUSTOM INDICATOR ENGINE
// Runs user-written JS per candle, sandboxed in a try/catch. Provides
// helper functions (sma/ema/rsi + raw OHLCV accessors) scoped to "up to
// bar i" so the logic stays causal (no look-ahead into future candles).
// =====================================================
function switchBuilderMode(mode, el) {
  document.querySelectorAll('#tabCustom .tab-switch button').forEach(b=>b.classList.remove('active'));
  el.classList.add('active');
  document.getElementById('builderFormula').style.display = mode==='formula' ? 'block' : 'none';
  document.getElementById('builderCode').style.display = mode==='code' ? 'block' : 'none';
}

function addCodeIndicator() {
  const inst = activeInstanceForModal;
  if (!inst) return;
  const errEl = document.getElementById('ccError');
  errEl.style.display = 'none';

  const name = document.getElementById('ccName').value.trim() || 'Custom Code';
  const codeBody = document.getElementById('ccCode').value;
  const plotType = document.getElementById('ccPlotType').value;
  const color = document.getElementById('ccColor').value;

  const candles = inst.candles;
  if (candles.length < 5) { errEl.textContent = 'Chart data abhi load nahi hui.'; errEl.style.display='block'; return; }

  // Helper functions exposed to user code, all causal (only look at bars <= i)
  const close = i => candles[i]?.close;
  const open  = i => candles[i]?.open;
  const high  = i => candles[i]?.high;
  const low   = i => candles[i]?.low;
  const volume= i => candles[i]?.volume;
  const sma = (period, i, srcFn) => {
    srcFn = srcFn || close;
    if (i < period-1) return undefined;
    let sum=0; for (let j=i-period+1;j<=i;j++) sum+=srcFn(j);
    return sum/period;
  };
  const ema = (period, i, srcFn) => {
    srcFn = srcFn || close;
    if (i < period-1) return undefined;
    const k = 2/(period+1);
    let prev = srcFn(i-period+1);
    for (let j=i-period+2;j<=i;j++) prev = srcFn(j)*k + prev*(1-k);
    return prev;
  };
  const rsi = (period, i) => {
    if (i < period) return undefined;
    let gains=0, losses=0;
    for (let j=i-period+1;j<=i;j++) {
      const diff = close(j)-close(j-1);
      if (diff>=0) gains+=diff; else losses-=diff;
    }
    const rs = losses===0 ? 100 : (gains/period)/(losses/period);
    return 100-100/(1+rs);
  };

  let userFn;
  try {
    userFn = new Function('candles','i','close','open','high','low','volume','sma','ema','rsi', codeBody);
  } catch(err) {
    errEl.textContent = 'Syntax error: ' + err.message;
    errEl.style.display = 'block';
    return;
  }

  const data = [];
  try {
    for (let i=0;i<candles.length;i++) {
      const val = userFn(candles, i, close, open, high, low, volume, sma, ema, rsi);
      if (val !== undefined && val !== null && !isNaN(val)) data.push({ time:candles[i].time, value:val });
    }
  } catch(err) {
    errEl.textContent = 'Runtime error: ' + err.message;
    errEl.style.display = 'block';
    return;
  }

  if (!data.length) {
    errEl.textContent = 'Code ne koi valid data return nahi kiya (sab undefined/NaN aaye).';
    errEl.style.display = 'block';
    return;
  }

  let series;
  if (plotType === 'oscillator') {
    if (!inst.oscChart) {
      inst.oscChart = LightweightCharts.createChart(inst.el.oscPane, {
        layout:{ background:{color:'#ffffff'}, textColor:'#555' },
        grid:{ vertLines:{color:'#f5f5f5'}, horzLines:{color:'#f5f5f5'} },
        timeScale:{ visible:false }, rightPriceScale:{ borderColor:'#e0e0e0' },
      });
      inst.chart.timeScale().subscribeVisibleLogicalRangeChange(r => inst.oscChart && inst.oscChart.timeScale().setVisibleLogicalRange(r));
    }
    inst.el.oscPane.style.display = 'block';
    inst.el.oscLabel.textContent = name;
    series = inst.oscChart.addLineSeries({ color, lineWidth:1.5 });
    inst.resize();
  } else {
    series = inst.chart.addLineSeries({ color, lineWidth:1.5, priceLineVisible:false, title:name });
  }
  series.setData(data);

  inst.customIndicators.push({ id:Date.now(), name, type:'code', code:codeBody, plotType, color, series, isCode:true,
    refresh(){ /* re-run handled by refreshCodeIndicator below via closure re-add — simplified: code indicators are static snapshots, re-run manually by re-adding */ } });
  renderCustomList();
}

document.addEventListener('DOMContentLoaded', async () => {
  await loadCoinList();
  loadGlobalStats();
  setInterval(loadGlobalStats, 60000);

  addInstance();
  layoutGrid();
  document.getElementById('loadingOverlay').style.display = 'none';

  setInterval(() => { if (instances[0]) loadFundingRate(instances[0].symbol); }, 30000);
});
