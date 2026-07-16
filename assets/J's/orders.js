// ===== CONFIG =====
let btcPrice=67000, minUSD=0, soundOn=false;
let viewMode='split';
let marketMode='futures';   // 'spot' | 'futures' — controls which data source every exchange connects to
let activeCoin='ALL';
let activeSide='ALL';       // 'ALL' | 'LONG' | 'SHORT'
let activeExchange='ALL';   // 'ALL' | 'Binance' | 'Bybit' | 'OKX' | 'Bitget' | 'Gate'
let feedTab='all';
let bubbles=[], particles=[], hovered=null, raf;
let stats={tot:0,totV:0,long:0,longV:0,short:0,shortV:0,big:0,bigInfo:'',cnt:0};
let feedCount=0, startTime=Date.now();
let prices={};

// Spot mode shows "Buy/Sell" (regular trades), Futures mode shows "Long/Short"
// (directional leveraged positions) — same underlying data, different labels.
function longLabel(){ return marketMode==='spot' ? 'BUY' : 'LONG'; }
function shortLabel(){ return marketMode==='spot' ? 'SELL' : 'SHORT'; }

function coinLogo(sym){
  const s=sym.replace('USDT','').replace('PERP','').replace('SWAP','').toLowerCase();
  return `https://cdn.jsdelivr.net/gh/spothq/cryptocurrency-icons@master/128/color/${s}.png`;
}
const imgCache={};
function getImg(src){
  if(imgCache[src]) return imgCache[src];
  const img=new Image(); img.crossOrigin='anonymous';
  img.src=src; imgCache[src]=img; return img;
}

// ===== CANVAS =====
const canvas=document.getElementById('ordCanvas');
const ctx=canvas.getContext('2d');
const dpr=Math.min(window.devicePixelRatio||1,2);

function resizeCanvas(){
  const topH=document.getElementById('topbar').offsetHeight||130;
  const panelW=window.innerWidth>700?260:0;
  const W=window.innerWidth-panelW, H=window.innerHeight-topH;
  document.getElementById('mainWrap').style.top=topH+'px';
  canvas.width=W*dpr; canvas.height=H*dpr;
  canvas.style.width=W+'px'; canvas.style.height=H+'px';
  ctx.setTransform(dpr,0,0,dpr,0,0);
  canvas._W=W; canvas._H=H;
}
window.addEventListener('resize',resizeCanvas);

// ===== ADD ORDER =====
function addOrder(d){
  const sym=d.sym.replace('USDT','').replace('PERP','').replace('_USDT','').replace('-USDT','').replace('-SWAP','').toUpperCase();
  if(activeCoin!=='ALL' && sym!==activeCoin) return;
  if(activeSide!=='ALL' && d.side!==activeSide) return;
  if(activeExchange!=='ALL' && d.exchange!==activeExchange) return;
  if(d.usd<minUSD) return;

  if(d.price>0) prices[sym]=d.price;

  stats.cnt++; stats.tot++; stats.totV+=d.usd;
  if(d.side==='LONG'){stats.long++;stats.longV+=d.usd;}
  else{stats.short++;stats.shortV+=d.usd;}
  if(d.usd>stats.big){stats.big=d.usd;stats.bigInfo=sym+' '+d.exchange;}
  renderStats();
  spawnBubble({...d,sym});
  addFeedItem({...d,sym});
}

// ===== SPAWN BUBBLE =====
function spawnBubble(d){
  const W=canvas._W||400, H=canvas._H||400;
  const r=Math.min(80,Math.max(18,18+Math.log10(d.usd/100+1)*20));
  const isLong=d.side==='LONG';
  const col=isLong?'#00c853':'#f44336';
  const rgb=isLong?'0,200,83':'244,67,54';

  let x,y;
  if(viewMode==='split'){
    if(isLong){
      x=r+4+Math.random()*(W/2-r*2-8);
    } else {
      x=W/2+r+4+Math.random()*(W/2-r*2-8);
    }
    y=r+4+Math.random()*(H-r*2-8);
  } else {
    x=r+4+Math.random()*(W-r*2-8);
    y=r+4+Math.random()*(H-r*2-8);
  }

  const b={
    x,y,r,col,rgb,isLong,d,
    sym:d.sym,
    logoImg:getImg(coinLogo(d.sym)),
    life:1, scale:0, popping:false, popP:0,
    vx:(Math.random()-0.5)*0.4,
    vy:(Math.random()-0.5)*0.4,
  };
  bubbles.push(b);
  spawnParticles(x,y,col,6);

  setTimeout(()=>{b.popping=true;},20000);
  if(bubbles.length>200) bubbles.splice(0,2);
}

// ===== PARTICLES =====
function spawnParticles(x,y,col,n){
  for(let i=0;i<n;i++){
    const a=Math.random()*Math.PI*2,sp=1+Math.random()*2.5;
    particles.push({x,y,vx:Math.cos(a)*sp,vy:Math.sin(a)*sp,r:1.5+Math.random()*2,col,alpha:1});
  }
}

// ===== DRAW BUBBLE =====
function drawBubble(b){
  if(b.popping) b.popP=Math.min(1,b.popP+0.05);
  else b.scale=Math.min(1,b.scale+0.12);
  const sc=b.popping?(1-b.popP):b.scale;
  if(sc<=0.01) return;

  const isH=hovered===b;
  ctx.save();
  ctx.globalAlpha=sc;
  ctx.translate(b.x,b.y); ctx.scale(sc,sc); ctx.translate(-b.x,-b.y);

  const glow=ctx.createRadialGradient(b.x,b.y,b.r*0.5,b.x,b.y,b.r+(isH?18:10));
  glow.addColorStop(0,`rgba(${b.rgb},${isH?0.3:0.15})`);
  glow.addColorStop(1,`rgba(${b.rgb},0)`);
  ctx.beginPath(); ctx.arc(b.x,b.y,b.r+(isH?18:10),0,Math.PI*2);
  ctx.fillStyle=glow; ctx.fill();

  const inner=ctx.createRadialGradient(b.x,b.y,b.r*0.15,b.x,b.y,b.r);
  inner.addColorStop(0,  `rgba(${b.rgb},0.03)`);
  inner.addColorStop(0.6,`rgba(${b.rgb},0.1)`);
  inner.addColorStop(0.85,`rgba(${b.rgb},0.24)`);
  inner.addColorStop(1,  `rgba(${b.rgb},0.4)`);
  ctx.beginPath(); ctx.arc(b.x,b.y,b.r,0,Math.PI*2);
  ctx.fillStyle=inner; ctx.fill();

  const shine=ctx.createRadialGradient(b.x-b.r*0.28,b.y-b.r*0.28,0,b.x,b.y,b.r*0.65);
  shine.addColorStop(0,'rgba(255,255,255,0.2)');
  shine.addColorStop(1,'rgba(255,255,255,0)');
  ctx.beginPath(); ctx.arc(b.x,b.y,b.r,0,Math.PI*2);
  ctx.fillStyle=shine; ctx.fill();

  ctx.beginPath(); ctx.arc(b.x,b.y,b.r,0,Math.PI*2);
  ctx.strokeStyle=isH?'#222':b.col; ctx.lineWidth=isH?3:2.5; ctx.stroke();

  ctx.textAlign='center'; ctx.textBaseline='middle';

  if(b.r>48){
    const ls=Math.floor(b.r*0.34);
    const ly=b.y-b.r*0.3;
    ctx.beginPath(); ctx.arc(b.x,ly,ls/2+3,0,Math.PI*2);
    ctx.fillStyle='rgba(255,255,255,0.9)'; ctx.fill();
    if(b.logoImg.complete&&b.logoImg.naturalWidth>0){
      ctx.save(); ctx.beginPath(); ctx.arc(b.x,ly,ls/2,0,Math.PI*2); ctx.clip();
      ctx.drawImage(b.logoImg,b.x-ls/2,ly-ls/2,ls,ls); ctx.restore();
    }
    ctx.font=`800 ${Math.floor(b.r*0.18)}px Inter,sans-serif`;
    ctx.fillStyle='#222'; ctx.fillText(b.sym,b.x,b.y+b.r*0.04);
    ctx.font=`700 ${Math.floor(b.r*0.16)}px Inter,sans-serif`;
    ctx.fillStyle=b.col; ctx.fillText(b.isLong?longLabel()+' ▲':shortLabel()+' ▼',b.x,b.y+b.r*0.28);
    ctx.font=`700 ${Math.floor(b.r*0.16)}px Inter,sans-serif`;
    ctx.fillStyle='#111'; ctx.fillText('$'+fmtN(b.d.usd),b.x,b.y+b.r*0.5);
    ctx.font=`600 ${Math.floor(b.r*0.13)}px Inter,sans-serif`;
    ctx.fillStyle='#888'; ctx.fillText(b.d.exchange,b.x,b.y+b.r*0.7);

  } else if(b.r>32){
    const ls=Math.floor(b.r*0.28);
    const ly=b.y-b.r*0.32;
    ctx.beginPath(); ctx.arc(b.x,ly,ls/2+2,0,Math.PI*2);
    ctx.fillStyle='rgba(255,255,255,0.88)'; ctx.fill();
    if(b.logoImg.complete&&b.logoImg.naturalWidth>0){
      ctx.save(); ctx.beginPath(); ctx.arc(b.x,ly,ls/2,0,Math.PI*2); ctx.clip();
      ctx.drawImage(b.logoImg,b.x-ls/2,ly-ls/2,ls,ls); ctx.restore();
    }
    ctx.font=`800 ${Math.floor(b.r*0.22)}px Inter,sans-serif`;
    ctx.fillStyle='#222'; ctx.fillText(b.sym,b.x,b.y+b.r*0.06);
    ctx.font=`700 ${Math.floor(b.r*0.19)}px Inter,sans-serif`;
    ctx.fillStyle=b.col; ctx.fillText(b.isLong?'▲':'▼',b.x,b.y+b.r*0.36);
    ctx.font=`700 ${Math.floor(b.r*0.17)}px Inter,sans-serif`;
    ctx.fillStyle='#111'; ctx.fillText('$'+fmtN(b.d.usd),b.x,b.y+b.r*0.6);

  } else if(b.r>20){
    const ls=Math.floor(b.r*0.24);
    const ly=b.y-b.r*0.35;
    if(b.logoImg.complete&&b.logoImg.naturalWidth>0){
      ctx.save(); ctx.beginPath(); ctx.arc(b.x,ly,ls/2+1,0,Math.PI*2);
      ctx.fillStyle='rgba(255,255,255,0.85)'; ctx.fill();
      ctx.beginPath(); ctx.arc(b.x,ly,ls/2,0,Math.PI*2); ctx.clip();
      ctx.drawImage(b.logoImg,b.x-ls/2,ly-ls/2,ls,ls); ctx.restore();
    }
    ctx.font=`800 ${Math.max(8,Math.floor(b.r*0.26))}px Inter,sans-serif`;
    ctx.fillStyle='#222'; ctx.fillText(b.sym,b.x,b.y+b.r*0.1);
    ctx.font=`700 ${Math.max(7,Math.floor(b.r*0.24))}px Inter,sans-serif`;
    ctx.fillStyle=b.col; ctx.fillText(b.isLong?'▲':'▼',b.x,b.y+b.r*0.44);
  } else {
    ctx.font=`800 ${Math.max(7,Math.floor(b.r*0.42))}px Inter,sans-serif`;
    ctx.fillStyle=b.col; ctx.fillText(b.isLong?'▲':'▼',b.x,b.y-b.r*0.1);
    ctx.font=`700 ${Math.max(6,Math.floor(b.r*0.3))}px Inter,sans-serif`;
    ctx.fillStyle='#333'; ctx.fillText(b.sym.slice(0,3),b.x,b.y+b.r*0.3);
  }

  ctx.restore(); ctx.globalAlpha=1;
}

// ===== ANIMATE =====
function drawDivider(){
  if(viewMode!=='split') return;
  const W=canvas._W||400,H=canvas._H||400;
  ctx.beginPath();
  ctx.moveTo(W/2,0); ctx.lineTo(W/2,H);
  ctx.strokeStyle='rgba(0,0,0,0.06)';
  ctx.lineWidth=1; ctx.setLineDash([5,5]); ctx.stroke(); ctx.setLineDash([]);

  ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.font='700 11px Inter,sans-serif';
  ctx.fillStyle='rgba(0,200,83,0.5)'; ctx.fillText('▲ '+longLabel()+' ORDERS',W/4,14);
  ctx.fillStyle='rgba(244,67,54,0.5)'; ctx.fillText('▼ '+shortLabel()+' ORDERS',W*3/4,14);
}

function animate(){
  raf=requestAnimationFrame(animate);
  const W=canvas._W||400,H=canvas._H||400;
  ctx.clearRect(0,0,W,H);

  drawDivider();

  particles=particles.filter(p=>p.alpha>0.04);
  particles.forEach(p=>{
    p.x+=p.vx; p.y+=p.vy; p.vy+=0.05; p.alpha-=0.025;
    ctx.globalAlpha=p.alpha;
    ctx.beginPath(); ctx.arc(p.x,p.y,p.r,0,Math.PI*2);
    ctx.fillStyle=p.col; ctx.fill();
  });
  ctx.globalAlpha=1;

  bubbles=bubbles.filter(b=>!(b.popping&&b.popP>=1));
  bubbles.forEach(b=>{
    if(b.popping&&b.popP<0.3) spawnParticles(b.x,b.y,b.col,2);
    b.x+=b.vx; b.y+=b.vy;
    const W2=canvas._W||400,H2=canvas._H||400;
    if(viewMode==='split'){
      const limit=b.isLong?W2/2:W2;
      if(b.x-b.r<(b.isLong?0:W2/2)){b.x=(b.isLong?b.r:W2/2+b.r);b.vx*=-1;}
      if(b.x+b.r>limit){b.x=limit-b.r;b.vx*=-1;}
    } else {
      if(b.x-b.r<0){b.x=b.r;b.vx*=-1;}
      if(b.x+b.r>W2){b.x=W2-b.r;b.vx*=-1;}
    }
    if(b.y-b.r<0){b.y=b.r;b.vy*=-1;}
    if(b.y+b.r>H2){b.y=H2-b.r;b.vy*=-1;}
    b.vx*=0.999; b.vy*=0.999;
    drawBubble(b);
  });
}

// ===== STATS =====
function renderStats(){
  document.getElementById('sTot').textContent=fmtN(stats.tot);
  document.getElementById('sTotV').textContent='$'+fmtN(stats.totV)+' vol';
  document.getElementById('sLong').textContent=fmtN(stats.long);
  document.getElementById('sLongV').textContent='$'+fmtN(stats.longV);
  document.getElementById('sShort').textContent=fmtN(stats.short);
  document.getElementById('sShortV').textContent='$'+fmtN(stats.shortV);
  document.getElementById('sLongVol').textContent='$'+fmtN(stats.longV);
  document.getElementById('sShortVol').textContent='$'+fmtN(stats.shortV);
  document.getElementById('sBig').textContent='$'+fmtN(stats.big);
  document.getElementById('sBigInfo').textContent=stats.bigInfo;
  const mins=Math.max(1,(Date.now()-startTime)/60000);
  document.getElementById('sRate').textContent=(stats.cnt/mins).toFixed(1);
  const tot=stats.long+stats.short||1;
  const lp=Math.round(stats.long/tot*100),sp=100-lp;
  document.getElementById('rl').style.width=lp+'%';
  document.getElementById('rs').style.width=sp+'%';
  document.getElementById('lpct').textContent=lp+'%';
  document.getElementById('spct').textContent=sp+'%';
}

// ===== FEED =====
let allFeedItems=[];
function addFeedItem(d){
  feedCount++;
  document.getElementById('feedCnt').textContent=feedCount;
  const isL=d.side==='LONG';
  const item={...d,isL,time:new Date().toLocaleTimeString('en-US',{hour12:false})};
  allFeedItems.unshift(item);
  if(allFeedItems.length>200) allFeedItems.pop();
  renderFeed();
}
function renderFeed(){
  const list=document.getElementById('feedList');
  const filtered=feedTab==='all'?allFeedItems:feedTab==='long'?allFeedItems.filter(i=>i.isL):allFeedItems.filter(i=>!i.isL);
  list.innerHTML=filtered.slice(0,60).map(d=>`
    <div class="feed-item">
      <div class="fi-top">
        <span class="fi-sym">${d.sym}</span>
        <span class="fi-amt ${d.isL?'fi-l':'fi-s'}">$${fmtN(d.usd)}</span>
        <span class="fi-badge ${d.isL?'bl':'bs'}">${d.isL?longLabel()+' ▲':shortLabel()+' ▼'}</span>
      </div>
      <div class="fi-bot">
        <span class="fi-exch">${d.exchange}</span>
        <span class="fi-price">$${(d.price||0).toLocaleString('en-US',{maximumFractionDigits:0})}</span>
        <span class="fi-time">${d.time}</span>
      </div>
    </div>`).join('');
}

// ===== WEBSOCKETS (5 real exchanges, no API key needed) =====
// Every exchange below has genuine public spot AND futures/perp trade
// channels. connect*() reads the global `marketMode` to pick the right
// endpoint/symbols. setMarketMode() closes all sockets and reopens them
// in the new mode.

const COIN_BASES = ['BTC','ETH','SOL','BNB','XRP','DOGE','ADA','AVAX','LINK','DOT','LTC','MATIC','NEAR','APT','ARB','OP','INJ','SUI','ATOM','FIL','UNI','ETC','XLM','ALGO','AAVE','TRX','SHIB','TON','ICP','PEPE'];

// ---------- BINANCE ----------
let wsBin;
function connectBinance(){
  const streams = COIN_BASES.map(b => b.toLowerCase()+'usdt@aggTrade').join('/');
  const host = marketMode==='futures' ? 'fstream.binance.com' : 'stream.binance.com:9443';
  wsBin = new WebSocket(`wss://${host}/stream?streams=${streams}`);
  wsBin.onopen = () => setDot('binance','on');
  wsBin.onmessage = e => {
    try{
      const msg=JSON.parse(e.data);
      const d=msg.data||msg;
      if(!d.s) return;
      const sym=d.s;
      const qty=parseFloat(d.q)||0;
      const price=parseFloat(d.p)||0;
      const usd=qty*price;
      if(usd<500) return;
      // m=true -> buyer is market maker -> seller-initiated (aggressive sell) = SHORT-like
      // m=false -> buyer is taker -> buyer-initiated (aggressive buy) = LONG-like
      const side=d.m?'SHORT':'LONG';
      addOrder({exchange:'Binance',sym,side,qty,price,usd});
    }catch(err){}
  };
  wsBin.onerror = () => setDot('binance','err');
  wsBin.onclose  = () => { setDot('binance',''); scheduleReconnect(connectBinance); };
}

// Several exchanges silently drop the connection if the client doesn't send
// a periodic keep-alive ping — this was the main reason some exchanges
// stopped showing orders after a short while. Each interval is cleared on close.
function startPing(ws, msg, intervalMs){
  const timer = setInterval(() => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      try{ ws.send(typeof msg==='function' ? msg() : msg); }catch(e){}
    } else {
      clearInterval(timer);
    }
  }, intervalMs);
  return timer;
}

// ---------- BYBIT ----------
let wsBybit;
let bybitPingTimer;
function connectBybit(){
  const path = marketMode==='futures' ? 'linear' : 'spot';
  wsBybit = new WebSocket(`wss://stream.bybit.com/v5/public/${path}`);
  wsBybit.onopen = () => {
    setDot('bybit','on');
    const coins = COIN_BASES.map(b=>b+'USDT');
    wsBybit.send(JSON.stringify({op:'subscribe',args:coins.map(c=>`publicTrade.${c}`)}));
    if (bybitPingTimer) clearInterval(bybitPingTimer);
    bybitPingTimer = startPing(wsBybit, () => JSON.stringify({op:'ping'}), 18000);
  };
  wsBybit.onmessage = e => {
    try{
      const d=JSON.parse(e.data);
      if(!d.data) return;
      const arr=Array.isArray(d.data)?d.data:[d.data];
      arr.forEach(o=>{
        const sym=d.topic?.split('.')[1]||'BTCUSDT';
        const qty=parseFloat(o.v||o.size)||0;
        const price=parseFloat(o.p||o.price)||0;
        const usd=qty*price;
        if(usd<500) return;
        const side=o.S==='Buy'?'LONG':'SHORT';
        addOrder({exchange:'Bybit',sym,side,qty,price,usd});
      });
    }catch(err){}
  };
  wsBybit.onerror = () => setDot('bybit','err');
  wsBybit.onclose  = () => { setDot('bybit',''); scheduleReconnect(connectBybit); };
}

// ---------- OKX ----------
let wsOKX;
let okxPingTimer;
function connectOKX(){
  wsOKX = new WebSocket('wss://ws.okx.com:8443/ws/v5/public');
  wsOKX.onopen = () => {
    setDot('okx','on');
    const suffix = marketMode==='futures' ? '-USDT-SWAP' : '-USDT';
    const coins = COIN_BASES.map(b=>b+suffix);
    wsOKX.send(JSON.stringify({op:'subscribe',args:coins.map(id=>({channel:'trades',instId:id}))}));
    if (okxPingTimer) clearInterval(okxPingTimer);
    // OKX expects the plain text string "ping" (not JSON) and replies with "pong"
    okxPingTimer = startPing(wsOKX, 'ping', 18000);
  };
  wsOKX.onmessage = e => {
    try{
      const d=JSON.parse(e.data);
      if(!d.data) return;
      d.data.forEach(o=>{
        const sym=(d.arg?.instId||'BTC-USDT').replace('-SWAP','').replace('-','');
        const qty=parseFloat(o.sz)||0;
        const price=parseFloat(o.px)||0;
        const usd=qty*price;
        if(usd<500) return;
        const side=o.side==='buy'?'LONG':'SHORT';
        addOrder({exchange:'OKX',sym,side,qty,price,usd});
      });
    }catch(err){}
  };
  wsOKX.onerror = () => setDot('okx','err');
  wsOKX.onclose  = () => { setDot('okx',''); scheduleReconnect(connectOKX); };
}

// ---------- BITGET ----------
// Bitget V2 sends trade data as OBJECTS with named fields (price, size, side) —
// not arrays. Same public endpoint serves both spot and futures; only
// `instType` in the subscribe args changes.
let wsBitget;
let bitgetPingTimer;
function connectBitget(){
  wsBitget = new WebSocket('wss://ws.bitget.com/v2/ws/public');
  wsBitget.onopen = () => {
    setDot('bitget','on');
    const instType = marketMode==='futures' ? 'USDT-FUTURES' : 'SPOT';
    const coins = COIN_BASES.map(b=>b+'USDT');
    const args = coins.map(c=>({instType,channel:'trade',instId:c}));
    wsBitget.send(JSON.stringify({op:'subscribe',args}));
    if (bitgetPingTimer) clearInterval(bitgetPingTimer);
    // Bitget expects the plain text string "ping" every ~30s
    bitgetPingTimer = startPing(wsBitget, 'ping', 20000);
  };
  wsBitget.onmessage = e => {
    try{
      const d=JSON.parse(e.data);
      if(!d.data) return;
      d.data.forEach(o=>{
        const sym=d.arg?.instId||'BTCUSDT';
        const qty=parseFloat(o.size)||0;
        const price=parseFloat(o.price)||0;
        const usd=qty*price;
        if(usd<500) return;
        const side=o.side==='buy'?'LONG':'SHORT';
        addOrder({exchange:'Bitget',sym,side,qty,price,usd});
      });
    }catch(err){}
  };
  wsBitget.onerror = () => setDot('bitget','err');
  wsBitget.onclose  = () => { setDot('bitget',''); scheduleReconnect(connectBitget); };
}

// ---------- GATE.IO ----------
// Futures and Spot are genuinely different WebSocket hosts + channel names on Gate.
let wsGate;
function connectGate(){
  const coins = COIN_BASES.map(b=>b+'_USDT');
  if (marketMode==='futures') {
    wsGate = new WebSocket('wss://fx-ws.gateio.ws/v4/ws/usdt');
    wsGate.onopen = () => {
      setDot('gate','on');
      wsGate.send(JSON.stringify({time:Math.floor(Date.now()/1000),channel:'futures.trades',event:'subscribe',payload:coins}));
    };
    wsGate.onmessage = e => {
      try{
        const d=JSON.parse(e.data);
        if(d.event==='subscribe'||!d.result) return;
        const arr=Array.isArray(d.result)?d.result:[d.result];
        arr.forEach(o=>{
          const sym=(o.contract||'BTC_USDT').replace('_','');
          const qty=Math.abs(parseFloat(o.size))||0;
          const price=parseFloat(o.price)||0;
          const usd=qty*price;
          if(usd<500) return;
          const side=o.size>0?'LONG':'SHORT';
          addOrder({exchange:'Gate',sym,side,qty,price,usd});
        });
      }catch(err){}
    };
  } else {
    wsGate = new WebSocket('wss://api.gateio.ws/ws/v4/');
    wsGate.onopen = () => {
      setDot('gate','on');
      wsGate.send(JSON.stringify({time:Math.floor(Date.now()/1000),channel:'spot.trades',event:'subscribe',payload:coins}));
    };
    wsGate.onmessage = e => {
      try{
        const d=JSON.parse(e.data);
        if(d.event==='subscribe'||!d.result) return;
        const r=d.result;
        const arr=Array.isArray(r)?r:[r];
        arr.forEach(o=>{
          const sym=(o.currency_pair||'BTC_USDT').replace('_','');
          const qty=Math.abs(parseFloat(o.amount))||0;
          const price=parseFloat(o.price)||0;
          const usd=qty*price;
          if(usd<500) return;
          const side=o.side==='buy'?'LONG':'SHORT';
          addOrder({exchange:'Gate',sym,side,qty,price,usd});
        });
      }catch(err){}
    };
  }
  wsGate.onerror = () => setDot('gate','err');
  wsGate.onclose  = () => { setDot('gate',''); scheduleReconnect(connectGate); };
}

// ---------- COINBASE ----------
// Coinbase Exchange public "matches" channel — genuine real trades, no key.
// Coinbase's public feed is spot-only (no public retail perpetuals feed),
// so it stays connected the same way regardless of Spot/Futures toggle.
let wsCoinbase;
function connectCoinbase(){
  wsCoinbase = new WebSocket('wss://ws-feed.exchange.coinbase.com');
  wsCoinbase.onopen = () => {
    setDot('coinbase','on');
    const productIds = COIN_BASES.map(b=>b+'-USD');
    wsCoinbase.send(JSON.stringify({type:'subscribe',product_ids:productIds,channels:['matches']}));
  };
  wsCoinbase.onmessage = e => {
    try{
      const d=JSON.parse(e.data);
      if(d.type!=='match' && d.type!=='last_match') return;
      const sym=d.product_id.replace('-USD','')+'USD';
      const qty=parseFloat(d.size)||0;
      const price=parseFloat(d.price)||0;
      const usd=qty*price;
      if(usd<500) return;
      const side=d.side==='buy'?'LONG':'SHORT';
      addOrder({exchange:'Coinbase',sym,side,qty,price,usd});
    }catch(err){}
  };
  wsCoinbase.onerror = () => setDot('coinbase','err');
  wsCoinbase.onclose  = () => { setDot('coinbase',''); scheduleReconnect(connectCoinbase); };
}

// ---------- KRAKEN ----------
// Kraken uses 'XBT' instead of 'BTC' and "BASE/USD" pair format for spot.
// Kraken Futures uses 'PF_' (multi-collateral perpetual) prefixed symbols.
const KRAKEN_SPOT_OVERRIDE = { BTC:'XBT' };
function krakenSpotPair(base){ return (KRAKEN_SPOT_OVERRIDE[base]||base)+'/USD'; }
function krakenFuturesSymbol(base){ return 'PF_'+(KRAKEN_SPOT_OVERRIDE[base]||base)+'USD'; }

let wsKraken;
function connectKraken(){
  if (marketMode==='futures') {
    wsKraken = new WebSocket('wss://futures.kraken.com/ws/v1');
    wsKraken.onopen = () => {
      setDot('kraken','on');
      wsKraken.send(JSON.stringify({event:'subscribe',feed:'trade',product_ids:COIN_BASES.map(krakenFuturesSymbol)}));
    };
    wsKraken.onmessage = e => {
      try{
        const d=JSON.parse(e.data);
        if(d.feed!=='trade' || !d.product_id) return;
        const sym=d.product_id.replace('PF_','').replace('USD','')+'USD';
        const qty=parseFloat(d.qty)||0;
        const price=parseFloat(d.price)||0;
        const usd=qty*price;
        if(usd<500) return;
        const side=d.side==='buy'?'LONG':'SHORT';
        addOrder({exchange:'Kraken',sym,side,qty,price,usd});
      }catch(err){}
    };
  } else {
    wsKraken = new WebSocket('wss://ws.kraken.com');
    wsKraken.onopen = () => {
      setDot('kraken','on');
      wsKraken.send(JSON.stringify({event:'subscribe',pair:COIN_BASES.map(krakenSpotPair),subscription:{name:'trade'}}));
    };
    wsKraken.onmessage = e => {
      try{
        const d=JSON.parse(e.data);
        if(!Array.isArray(d) || !Array.isArray(d[1])) return; // ignore heartbeats/system events
        const pairName=d[3]||'';
        const sym=pairName.replace('XBT','BTC').replace('/USD','')+'USD';
        d[1].forEach(t=>{
          const price=parseFloat(t[0])||0;
          const qty=parseFloat(t[1])||0;
          const usd=qty*price;
          if(usd<500) return;
          const side=t[3]==='b'?'LONG':'SHORT';
          addOrder({exchange:'Kraken',sym,side,qty,price,usd});
        });
      }catch(err){}
    };
  }
  wsKraken.onerror = () => setDot('kraken','err');
  wsKraken.onclose  = () => { setDot('kraken',''); scheduleReconnect(connectKraken); };
}

// ---------- MEXC ----------
let wsMexc;
let mexcPingTimer;
function connectMexc(){
  if (marketMode==='futures') {
    wsMexc = new WebSocket('wss://contract.mexc.com/edge');
    wsMexc.onopen = () => {
      setDot('mexc','on');
      COIN_BASES.forEach(b=>{
        wsMexc.send(JSON.stringify({method:'sub.deal',param:{symbol:b+'_USDT'}}));
      });
      if (mexcPingTimer) clearInterval(mexcPingTimer);
      mexcPingTimer = startPing(wsMexc, () => JSON.stringify({method:'ping'}), 15000);
    };
    wsMexc.onmessage = e => {
      try{
        const d=JSON.parse(e.data);
        if(d.channel!=='push.deal' || !d.data) return;
        const sym=(d.symbol||'BTC_USDT').replace('_','');
        const price=parseFloat(d.data.p)||0;
        const qty=parseFloat(d.data.v)||0;
        const usd=qty*price;
        if(usd<500) return;
        const side=d.data.T===1?'LONG':'SHORT';
        addOrder({exchange:'MEXC',sym,side,qty,price,usd});
      }catch(err){}
    };
  } else {
    wsMexc = new WebSocket('wss://wbs.mexc.com/ws');
    wsMexc.onopen = () => {
      setDot('mexc','on');
      const params=COIN_BASES.map(b=>`spot@public.deals.v3.api@${b}USDT`);
      wsMexc.send(JSON.stringify({method:'SUBSCRIPTION',params}));
      if (mexcPingTimer) clearInterval(mexcPingTimer);
      mexcPingTimer = startPing(wsMexc, () => JSON.stringify({method:'PING'}), 15000);
    };
    wsMexc.onmessage = e => {
      try{
        const d=JSON.parse(e.data);
        if(!d.d || !d.d.deals) return;
        const sym=(d.s||'BTCUSDT');
        d.d.deals.forEach(t=>{
          const price=parseFloat(t.p)||0;
          const qty=parseFloat(t.v)||0;
          const usd=qty*price;
          if(usd<500) return;
          const side=t.S===1?'LONG':'SHORT';
          addOrder({exchange:'MEXC',sym,side,qty,price,usd});
        });
      }catch(err){}
    };
  }
  wsMexc.onerror = () => setDot('mexc','err');
  wsMexc.onclose  = () => { setDot('mexc',''); scheduleReconnect(connectMexc); };
}

// ---------- KUCOIN ----------
// KuCoin requires a short-lived public connection token fetched via a plain
// (no-auth) REST POST before opening the WebSocket. Still 100% free/public.
let wsKucoin;
let kucoinPingTimer;
async function connectKucoin(){
  try{
    const bulletUrl = marketMode==='futures'
      ? 'https://api-futures.kucoin.com/api/v1/bullet-public'
      : 'https://api.kucoin.com/api/v1/bullet-public';
    const res = await fetch(bulletUrl, {method:'POST'});
    const j = await res.json();
    const token = j.data.token;
    const endpoint = j.data.instanceServers[0].endpoint;
    const pingInterval = j.data.instanceServers[0].pingInterval || 18000;
    wsKucoin = new WebSocket(`${endpoint}?token=${token}`);

    wsKucoin.onopen = () => {
      setDot('kucoin','on');
      if (marketMode==='futures') {
        COIN_BASES.forEach(b=>{
          wsKucoin.send(JSON.stringify({id:Date.now()+Math.random(),type:'subscribe',topic:`/contractMarket/execution:${b}USDTM`,privateChannel:false,response:false}));
        });
      } else {
        const pairs = COIN_BASES.map(b=>b+'-USDT').join(',');
        wsKucoin.send(JSON.stringify({id:Date.now(),type:'subscribe',topic:`/market/match:${pairs}`,privateChannel:false,response:false}));
      }
      // KuCoin disconnects the socket if it doesn't receive a ping within the
      // server-specified interval — this was the main reason KuCoin never
      // showed data (connection opened, then silently died a few seconds later).
      if (kucoinPingTimer) clearInterval(kucoinPingTimer);
      kucoinPingTimer = startPing(wsKucoin, () => JSON.stringify({id:Date.now(),type:'ping'}), Math.max(10000, pingInterval - 5000));
    };
    wsKucoin.onmessage = e => {
      try{
        const d=JSON.parse(e.data);
        if(!d.data || (d.type!=='message')) return;
        const o=d.data;
        const symRaw = o.symbol || 'BTCUSDTM';
        const sym = symRaw.replace('-','').replace('M','');
        const price=parseFloat(o.price)||0;
        const qty=parseFloat(o.size)||0;
        const usd=qty*price;
        if(usd<500) return;
        const side=(o.side==='buy')?'LONG':'SHORT';
        addOrder({exchange:'KuCoin',sym,side,qty,price,usd});
      }catch(err){}
    };
    wsKucoin.onerror = () => setDot('kucoin','err');
    wsKucoin.onclose  = () => { setDot('kucoin',''); scheduleReconnect(connectKucoin); };
  }catch(err){
    setDot('kucoin','err');
    scheduleReconnect(connectKucoin);
  }
}

// ---------- BITFINEX ----------
// Bitfinex spot public trades feed. One socket, multiple subscribe messages,
// channel IDs mapped back to symbols from the subscribe ACK.
// Public feed here is spot-only, so — like Coinbase — it stays connected the
// same way regardless of the Spot/Futures toggle.
let wsBitfinex;
let bitfinexChanMap = {};
function connectBitfinex(){
  wsBitfinex = new WebSocket('wss://api-pub.bitfinex.com/ws/2');
  bitfinexChanMap = {};
  wsBitfinex.onopen = () => {
    setDot('bitfinex','on');
    COIN_BASES.forEach(b=>{
      wsBitfinex.send(JSON.stringify({event:'subscribe',channel:'trades',symbol:'t'+b+'USD'}));
    });
  };
  wsBitfinex.onmessage = e => {
    try{
      const d=JSON.parse(e.data);
      if(!Array.isArray(d)){
        if(d.event==='subscribed' && d.channel==='trades'){
          bitfinexChanMap[d.chanId] = d.symbol.replace('t','');
        }
        return;
      }
      const chanId=d[0];
      const sym=bitfinexChanMap[chanId];
      if(!sym) return;
      // 'te' = new trade executed. Ignore snapshots/other message types.
      if(d[1]==='te' && Array.isArray(d[2])){
        const [, , amount, price] = d[2];
        const qty=Math.abs(parseFloat(amount))||0;
        const p=parseFloat(price)||0;
        const usd=qty*p;
        if(usd<500) return;
        const side=amount>0?'LONG':'SHORT';
        addOrder({exchange:'Bitfinex',sym,side,qty,price:p,usd});
      }
    }catch(err){}
  };
  wsBitfinex.onerror = () => setDot('bitfinex','err');
  wsBitfinex.onclose  = () => { setDot('bitfinex',''); scheduleReconnect(connectBitfinex); };
}

// Prevents a reconnect firing right after we intentionally close sockets to switch modes
let switchingMode = false;
function scheduleReconnect(fn){
  if (switchingMode) return;
  setTimeout(fn, 3000);
}

// ===== MODE TOGGLE (Spot Orders / Futures Orders) =====
function updateModeLabels(){
  const L=longLabel(), S=shortLabel();
  const set=(id,txt)=>{const el=document.getElementById(id); if(el) el.textContent=txt;};
  set('lblLongOrders', L+' Orders');
  set('lblShortOrders', S+' Orders');
  set('lblLongVol', L+' Volume');
  set('lblShortVol', S+' Volume');
  set('lblRatioLong', L+' Orders');
  set('lblRatioShort', S+' Orders');
}

function setMarketMode(mode, el){
  if (mode === marketMode) return;
  marketMode = mode;

  document.querySelectorAll('.mode-btn').forEach(b=>b.classList.remove('active'));
  if (el) el.classList.add('active');
  updateModeLabels();

  // Reset everything so stats/feed/bubbles don't mix spot+futures data
  switchingMode = true;
  [wsBin, wsBybit, wsOKX, wsBitget, wsGate, wsKraken, wsMexc, wsKucoin].forEach(ws => { if (ws) ws.close(); });

  // Coinbase & Bitfinex have no public futures feed — connect only in Spot mode
  if (mode === 'futures') {
    if (wsCoinbase) { wsCoinbase.close(); wsCoinbase = null; }
    if (wsBitfinex) { wsBitfinex.close(); wsBitfinex = null; }
    setDot('coinbase','na');
    setDot('bitfinex','na');
  }

  bubbles = []; particles = []; allFeedItems = []; feedCount = 0;
  stats = {tot:0,totV:0,long:0,longV:0,short:0,shortV:0,big:0,bigInfo:'',cnt:0};
  startTime = Date.now();
  renderStats();
  renderFeed();
  document.getElementById('feedCnt').textContent = '0';

  setTimeout(() => {
    switchingMode = false;
    connectBinance();
    connectBybit();
    connectOKX();
    connectBitget();
    connectGate();
    connectKraken();
    connectMexc();
    connectKucoin();
    if (mode === 'spot') {
      connectCoinbase();
      connectBitfinex();
    }
  }, 300);
}

function setDot(exch,state){

  const el=document.getElementById('dot-'+exch);
  if(!el) return;
  el.className='ws-dot '+(state==='on'?'on':state==='err'?'err':state==='na'?'na':'');
}

// ===== BTC PRICE =====
async function fetchPrice(){
  try{
    const r=await fetch('https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT');
    const d=await r.json();
    btcPrice=parseFloat(d.price);
    document.getElementById('sBTC').textContent='$'+btcPrice.toLocaleString('en-US',{maximumFractionDigits:0});
  }catch(e){}
}

// ===== HOVER =====
canvas.addEventListener('mousemove',e=>{
  const r=canvas.getBoundingClientRect();
  const mx=e.clientX-r.left,my=e.clientY-r.top;
  hovered=null;
  for(const b of bubbles){if(Math.sqrt((mx-b.x)**2+(my-b.y)**2)<b.r){hovered=b;break;}}
  canvas.style.cursor=hovered?'pointer':'default';
  const tt=document.getElementById('tooltip');
  if(hovered){
    tt.style.display='block';
    tt.style.left=(e.clientX+14)+'px'; tt.style.top=(e.clientY-110)+'px';
    document.getElementById('ttTitle').innerHTML=`<span style="color:${hovered.col}">${hovered.isLong?'▲ '+longLabel():'▼ '+shortLabel()} Order</span>`;
    document.getElementById('ttSym').textContent=hovered.sym;
    document.getElementById('ttAmt').textContent=hovered.d.qty.toFixed(4)+' '+hovered.sym;
    document.getElementById('ttUSD').textContent='$'+fmtN(hovered.d.usd);
    document.getElementById('ttPrice').textContent='$'+(hovered.d.price||0).toLocaleString('en-US',{maximumFractionDigits:2});
    document.getElementById('ttExch').textContent=hovered.d.exchange;
    document.getElementById('ttType').textContent='Market Trade';
  } else tt.style.display='none';
});
canvas.addEventListener('mouseleave',()=>{document.getElementById('tooltip').style.display='none';hovered=null;});
canvas.addEventListener('touchstart',e=>{
  const t=e.touches[0]; const r=canvas.getBoundingClientRect();
  const mx=t.clientX-r.left,my=t.clientY-r.top;
  for(const b of bubbles){if(Math.sqrt((mx-b.x)**2+(my-b.y)**2)<b.r){hovered=b;break;}}
},{passive:true});

// ===== CONTROLS =====
function setCoin(c,el){
  activeCoin=c;
  document.querySelectorAll('.coin-btn').forEach(b=>{b.classList.remove('active');});
  el.classList.add('active');
}
function setSide(s,el){
  activeSide=s;
  document.querySelectorAll('.side-btn').forEach(b=>b.classList.remove('active'));
  el.classList.add('active');
}
function setExchange(x,el){
  activeExchange=x;
  document.querySelectorAll('.exch-btn').forEach(b=>b.classList.remove('active'));
  el.classList.add('active');
}
function setView(v,el){
  viewMode=v;
  document.querySelectorAll('.view-btn').forEach(b=>b.classList.remove('active'));
  el.classList.add('active');
  document.getElementById('divLbl').style.display=v==='split'?'block':'none';
}
function setPeriod(p,el){
  document.querySelectorAll('.tf-btn').forEach(b=>b.classList.remove('active'));
  el.classList.add('active');
}
function setMin(v,el){
  minUSD=v;
  document.querySelectorAll('.min-btn').forEach(b=>b.classList.remove('active'));
  el.classList.add('active');
}
function showTab(t,el){
  feedTab=t;
  document.querySelectorAll('.stab').forEach(b=>b.classList.remove('active'));
  el.classList.add('active');
  renderFeed();
}
function toggleSound(){
  soundOn=!soundOn;
  const btn=document.getElementById('soundBtn');
  btn.className='sound-btn'+(soundOn?' on':'');
  btn.textContent=soundOn?'🔔 On':'🔕 Sound';
}

// ===== FORMAT =====
function fmtN(n){if(!n)return'0';if(n>=1e9)return(n/1e9).toFixed(2)+'B';if(n>=1e6)return(n/1e6).toFixed(2)+'M';if(n>=1e3)return(n/1e3).toFixed(1)+'K';return n.toFixed(0);}

// ===== INIT =====
resizeCanvas();
fetchPrice();
setInterval(fetchPrice,15000);
connectBinance();
connectBybit();
connectOKX();
connectBitget();
connectGate();
connectKraken();
connectMexc();
connectKucoin();
// Coinbase & Bitfinex have no public futures/perp feed — only connect them
// when starting in Spot mode. setMarketMode() handles connecting/disconnecting
// them when the user toggles Spot <-> Futures afterward.
if (marketMode==='spot') {
  connectCoinbase();
  connectBitfinex();
} else {
  setDot('coinbase','na');
  setDot('bitfinex','na');
}
animate();
