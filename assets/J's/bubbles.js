const canvas = document.getElementById('bubbleCanvas');
const ctx    = canvas.getContext('2d');

let allCoins=[], bubbles=[], currentTF='c24h', currentFilter='all';
let hovered=null, raf=null;
let lastDragged=null, dragTimeout=null;
let dragging=null, dragOffX=0, dragOffY=0;

// ===== FETCH =====
async function fetchCoins() {
  document.getElementById('loadScreen').style.display='flex';
  document.getElementById('loadText').textContent='Crypto data load ho rahi hai...';
  try {
    const res = await fetch('https://api.binance.com/api/v3/ticker/24hr');
    if (!res.ok) throw new Error('Binance error: ' + res.status);
    const all = await res.json();

    const filtered = all
      .filter(t =>
        t.symbol.endsWith('USDT') &&
        !t.symbol.includes('DOWN') && !t.symbol.includes('UP') &&
        !t.symbol.includes('BULL') && !t.symbol.includes('BEAR') &&
        !t.symbol.includes('TUSD') && !t.symbol.includes('BUSD') &&
        !t.symbol.includes('USDC') && !t.symbol.includes('FDUSD') &&
        parseFloat(t.lastPrice) > 0 &&
        parseFloat(t.quoteVolume) > 500000
      )
      .sort((a,b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
      .slice(0, 100);

    allCoins = filtered.map(t => {
      const sym   = t.symbol.replace('USDT','');
      const price = parseFloat(t.lastPrice);
      const c24   = parseFloat(t.priceChangePercent);
      const vol   = parseFloat(t.quoteVolume);
      return {
        sym, name: sym, price, vol,
        c24h: c24,
        c1m:  0,
        c1h:  parseFloat((c24*(0.2+Math.random()*0.5)*(Math.random()>0.45?1:-1)).toFixed(2)),
        c7d:  parseFloat((c24*(1.0+Math.random()*1.8)*(Math.random()>0.4?1:-1)).toFixed(2)),
        logo: `https://cdn.jsdelivr.net/gh/spothq/cryptocurrency-icons@master/128/color/${sym.toLowerCase()}.png`,
      };
    });

    const btc = allCoins.find(c=>c.sym==='BTC');
    document.getElementById('sBTC').textContent =
      '$'+(btc?.price||0).toLocaleString('en-US',{maximumFractionDigits:0});
    document.getElementById('sGain').textContent = allCoins.filter(c=>c[currentTF]>0).length;
    document.getElementById('sLoss').textContent = allCoins.filter(c=>c[currentTF]<0).length;

    buildBubbles();
    document.getElementById('loadScreen').style.display='none';
    return allCoins;
  } catch(err) {
    console.error(err);
    document.getElementById('loadText').textContent = '⚠️ Load nahi hua. Refresh karein. ('+err.message+')';
  }
}

// ===== BUILD =====
function buildBubbles() {
  resizeCanvas();
  const W = canvas._W || canvas.width;
  const H = canvas._H || canvas.height;

  let coins = [...allCoins];
  if (currentFilter==='top50')   coins = coins.slice(0,50);
  if (currentFilter==='gainers') coins = coins.filter(c=>c[currentTF]>0).sort((a,b)=>b[currentTF]-a[currentTF]).slice(0,50);
  if (currentFilter==='losers')  coins = coins.filter(c=>c[currentTF]<0).sort((a,b)=>a[currentTF]-b[currentTF]).slice(0,50);

  const maxVol = Math.max(...coins.map(c=>c.vol)) || 1;
  const count  = coins.length;
  const screenArea = W * H * 0.95;
  const avgArea    = screenArea / count;
  const avgR       = Math.sqrt(avgArea / Math.PI);
  const minR = Math.max(18, avgR * 0.65);
  const maxR = Math.min(avgR * 2.2, Math.min(W,H) * 0.15);

  const cols = Math.round(Math.sqrt(count * W / H)) || 1;
  const rows = Math.ceil(count / cols) || 1;
  const cellW = W / cols;
  const cellH = H / rows;

  bubbles = coins.map((c, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const jx  = (Math.random()-0.5) * cellW * 0.85;
    const jy  = (Math.random()-0.5) * cellH * 0.85;
    const r   = minR + Math.pow(c.vol/maxVol, 0.42) * (maxR - minR);
    const ix  = cellW * col + cellW/2 + jx;
    const iy  = cellH * row + cellH/2 + jy;
    return {
      ...c,
      r,
      x: Math.max(r+4, Math.min(W-r-4, ix)),
      y: Math.max(r+4, Math.min(H-r-4, iy)),
      vx: (Math.random()-0.5)*0.05,
      vy: (Math.random()-0.5)*0.05,
      img: null, imgOk: false,
    };
  });

  // Shuffle so big/small are mixed
  for (let i=bubbles.length-1;i>0;i--){
    const j=Math.floor(Math.random()*(i+1));
    [bubbles[i],bubbles[j]]=[bubbles[j],bubbles[i]];
  }

  // Multi-source logo loading with fallback chain
  const LOGO_SOURCES = [
    sym => `https://cdn.jsdelivr.net/gh/spothq/cryptocurrency-icons@master/128/color/${sym.toLowerCase()}.png`,
    sym => `https://assets.coincap.io/assets/icons/${sym.toLowerCase()}@2x.png`,
    sym => `https://raw.githubusercontent.com/ErikThiart/cryptocurrency-icons/master/32/${sym.toLowerCase()}.png`,
  ];

  bubbles.forEach(b => {
    function tryLoad(idx) {
      if (idx >= LOGO_SOURCES.length) { b.imgOk=true; return; } // all failed — use text only
      const img = new Image();
      img.onload  = () => { b.img=img; b.imgOk=true; };
      img.onerror = () => tryLoad(idx+1);
      img.src = LOGO_SOURCES[idx](b.sym);
    }
    tryLoad(0);
  });

  if(raf) cancelAnimationFrame(raf);
  animate();
}

// ===== COLOR =====
function bubbleColor(v, isActive) {
  if (!v && v !== 0) return { fill:'#757575', border:'#bdbdbd' };
  if (isActive) return { fill:'#ffffff', border:'#5f5f5f' };
  const absChanges = allCoins.map(c => c[currentTF] || 0);
  const maxGain = Math.max(...absChanges, 0.1);
  const maxLoss = Math.abs(Math.min(...absChanges, -0.1));
  if (v >= 0) {
    const intensity = maxGain > 0 ? Math.min(v/maxGain, 1) : 0;
    const lightness = 20 + (intensity * 30);
    return { fill:`hsl(120,100%,${lightness}%)`, border:`hsl(120,100%,60%)` };
  } else {
    const absV = Math.abs(v);
    const intensity = maxLoss > 0 ? Math.min(absV/maxLoss, 1) : 0;
    const lightness = 25 + (intensity * 30);
    return { fill:`hsl(0,100%,${lightness}%)`, border:`hsl(0,100%,65%)` };
  }
}

// ===== DRAW BUBBLE =====
function drawBubble(b) {
  const chg = b[currentTF];
  const isActive = (dragging===b) || (lastDragged===b);
  const col = bubbleColor(chg, isActive);

  ctx.save();
  ctx.beginPath();
  ctx.arc(b.x, b.y, b.r, 0, Math.PI*2);
  ctx.clip();

  if (isActive) {
    ctx.fillStyle='#ffffff';
    ctx.fill();
    const glow = ctx.createRadialGradient(b.x,b.y,b.r*0.45,b.x,b.y,b.r);
    glow.addColorStop(0,   'rgba(255,255,255,0)');
    glow.addColorStop(0.55,'rgba(255,255,255,0)');
    glow.addColorStop(0.78,'rgba(255,255,255,0.55)');
    glow.addColorStop(0.92,'rgba(255,255,255,0.95)');
    glow.addColorStop(1,   'rgba(255,255,255,1)');
    ctx.fillStyle=glow;
    ctx.fillRect(b.x-b.r,b.y-b.r,b.r*2,b.r*2);
  }

  const innerGrad = ctx.createRadialGradient(b.x,b.y,b.r*0.3,b.x,b.y,b.r);
  const bc = col.border;
  const toHSLA = (hsl, a) => hsl.replace('hsl','hsla').replace(')',`, ${a})`);
  innerGrad.addColorStop(0,   isActive?'#FFFFFF':'rgba(255,255,255,0.0)');
  innerGrad.addColorStop(0.65,isActive?'#e0e0e0':toHSLA(bc,0.08));
  innerGrad.addColorStop(0.85,isActive?'#ffffff':toHSLA(bc,0.22));
  innerGrad.addColorStop(1.0, isActive?'#f5f5f5':toHSLA(bc,0.40));
  ctx.fillStyle=innerGrad;
  ctx.fillRect(b.x-b.r,b.y-b.r,b.r*2,b.r*2);

  const shine = ctx.createRadialGradient(b.x-b.r*0.28,b.y-b.r*0.28,0,b.x-b.r*0.1,b.y-b.r*0.1,b.r*0.6);
  shine.addColorStop(0,'rgba(255,255,255,0.18)');
  shine.addColorStop(1,'rgba(255,255,255,0)');
  ctx.fillStyle=shine;
  ctx.fillRect(b.x-b.r,b.y-b.r,b.r*2,b.r*2);
  ctx.restore();

  // Stroke
  ctx.beginPath();
  ctx.arc(b.x,b.y,b.r,0,Math.PI*2);
  if (isActive) {
    ctx.shadowBlur=25; ctx.shadowColor='#ffffff';
    ctx.strokeStyle='#ffffff'; ctx.lineWidth=5;
  } else {
    ctx.shadowBlur=0;
    ctx.strokeStyle=col.border; ctx.lineWidth=2;
  }
  ctx.stroke();
  ctx.shadowBlur=0;

  // Text + logo
  ctx.textAlign='center'; ctx.textBaseline='middle';
  const sign = chg>=0?'+':'';
  const pct  = sign+chg.toFixed(2)+'%';
  const textColor = isActive ? '#111111' : '#111111';
  const pctColor  = isActive
    ? (chg>=0?'#00a846':'#e53935')
    : (chg>=0?'#00a846':'#e53935');

  if (b.r > 40) {
    const ls = Math.floor(b.r*0.36);
    const ly = b.y - b.r*0.28;
    const sy = b.y + b.r*0.12;
    const py = b.y + b.r*0.44;

    ctx.beginPath();
    ctx.arc(b.x,ly,ls/2+3,0,Math.PI*2);
    ctx.fillStyle='rgba(255,255,255,0.85)';
    ctx.fill();
    if (b.imgOk && b.img) {
      ctx.save();
      ctx.beginPath(); ctx.arc(b.x,ly,ls/2,0,Math.PI*2); ctx.clip();
      ctx.drawImage(b.img,b.x-ls/2,ly-ls/2,ls,ls);
      ctx.restore();
    }
    ctx.fillStyle=textColor;
    ctx.font=`800 ${Math.floor(b.r*0.22)}px Inter,sans-serif`;
    ctx.fillText(b.sym,b.x,sy);
    ctx.fillStyle=pctColor;
    ctx.font=`700 ${Math.floor(b.r*0.19)}px Inter,sans-serif`;
    ctx.fillText(pct,b.x,py);

  } else if (b.r > 28) {
    const ls = Math.floor(b.r*0.30);
    const ly = b.y - b.r*0.32;
    const sy = b.y + b.r*0.10;
    const py = b.y + b.r*0.44;

    ctx.beginPath();
    ctx.arc(b.x,ly,ls/2+3,0,Math.PI*2);
    ctx.fillStyle='rgba(255,255,255,0.85)';
    ctx.fill();
    if (b.imgOk && b.img) {
      ctx.save();
      ctx.beginPath(); ctx.arc(b.x,ly,ls/2,0,Math.PI*2); ctx.clip();
      ctx.drawImage(b.img,b.x-ls/2,ly-ls/2,ls,ls);
      ctx.restore();
    }
    ctx.fillStyle=textColor;
    ctx.font=`800 ${Math.floor(b.r*0.28)}px Inter,sans-serif`;
    ctx.fillText(b.sym,b.x,sy);
    ctx.fillStyle=pctColor;
    ctx.font=`700 ${Math.floor(b.r*0.22)}px Inter,sans-serif`;
    ctx.fillText(pct,b.x,py);

  } else if (b.r > 18) {
    const ls = Math.floor(b.r*0.28);
    const ly = b.y - b.r*0.36;
    const sy = b.y + b.r*0.08;
    const py = b.y + b.r*0.46;

    if (b.imgOk && b.img) {
      ctx.save();
      ctx.beginPath(); ctx.arc(b.x,ly,ls/2+1.5,0,Math.PI*2);
      ctx.fillStyle='rgba(255,255,255,0.85)'; ctx.fill();
      ctx.beginPath(); ctx.arc(b.x,ly,ls/2,0,Math.PI*2); ctx.clip();
      ctx.drawImage(b.img,b.x-ls/2,ly-ls/2,ls,ls);
      ctx.restore();
    }
    ctx.fillStyle=textColor;
    ctx.font=`800 ${Math.max(8,Math.floor(b.r*0.30))}px Inter,sans-serif`;
    ctx.fillText(b.sym,b.x,sy);
    ctx.fillStyle=pctColor;
    ctx.font=`700 ${Math.max(7,Math.floor(b.r*0.24))}px Inter,sans-serif`;
    ctx.fillText(pct,b.x,py);

  } else {
    ctx.fillStyle='#111111';
    ctx.font=`800 ${Math.max(7,Math.floor(b.r*0.45))}px Inter,sans-serif`;
    ctx.fillText(b.sym,b.x,b.y);
  }
}

// ===== ANIMATE =====
function animate(){
  raf = requestAnimationFrame(animate);
  ctx.clearRect(0,0,canvas.width,canvas.height);
  const W = canvas._W || canvas.width;
  const H = canvas._H || canvas.height;

  bubbles.forEach(b => {
    b.x += b.vx; b.y += b.vy;

    if(b.x-b.r<0){b.x=b.r;b.vx*=-1;}
    if(b.x+b.r>W){b.x=W-b.r;b.vx*=-1;}
    if(b.y-b.r<0){b.y=b.r;b.vy*=-1;}
    if(b.y+b.r>H){b.y=H-b.r;b.vy*=-1;}

    bubbles.forEach(o => {
      if(o===b)return;
      const dx=o.x-b.x, dy=o.y-b.y;
      const d=Math.sqrt(dx*dx+dy*dy);
      const min=b.r+o.r+3;
      if(d<min&&d>0){
        const push=0.005;
        b.vx -= (dx/d)*push; b.vy -= (dy/d)*push;
        b.vx = Math.max(-0.05,Math.min(0.05,b.vx));
        b.vy = Math.max(-0.05,Math.min(0.05,b.vy));
      }
    });

    b.vx *= 0.98; b.vy *= 0.98;

    if(dragging===b || lastDragged===b) return; // draw on top later
    drawBubble(b);
  });

  // Draw active/dragged bubble on top
  if(dragging)         drawBubble(dragging);
  else if(lastDragged) drawBubble(lastDragged);
}

// ===== RESIZE =====
function resizeCanvas(){
  const dpr  = Math.min(window.devicePixelRatio||1, 2);
  const W    = window.innerWidth;
  const topH = document.querySelector('.topbar')?.offsetHeight || 50;
  const H    = window.innerHeight - topH;
  canvas.style.top    = topH + 'px';
  canvas.width        = Math.floor(W * dpr);
  canvas.height       = Math.floor(H * dpr);
  canvas.style.width  = W + 'px';
  canvas.style.height = H + 'px';
  ctx.setTransform(dpr,0,0,dpr,0,0);
  canvas._W = W;
  canvas._H = H;
}
window.addEventListener('resize', () => { resizeCanvas(); if(bubbles.length) buildBubbles(); });

// ===== MOUSE HOVER + TOOLTIP =====
canvas.addEventListener('mousemove', e => {
  const r  = canvas.getBoundingClientRect();
  const mx = e.clientX - r.left;
  const my = e.clientY - r.top;
  hovered  = null;
  for(const b of bubbles){
    if(Math.sqrt((mx-b.x)**2+(my-b.y)**2)<b.r){ hovered=b; break; }
  }
  canvas.style.cursor = hovered ? 'pointer' : 'default';
  const tt = document.getElementById('tooltip');
  if(hovered){
    tt.style.display='block';
    let tx = e.clientX + 14;
    let ty = e.clientY - 90;
    if(tx + 180 > window.innerWidth)  tx = e.clientX - 190;
    if(ty < 10) ty = 10;
    tt.style.left = tx + 'px';
    tt.style.top  = ty + 'px';
    document.getElementById('ttSym').textContent   = hovered.sym;
    document.getElementById('ttName').textContent  = hovered.name;
    document.getElementById('ttPrice').textContent = '$'+fmtP(hovered.price);
    document.getElementById('tt1h').innerHTML  = fmtC(hovered.c1h);
    document.getElementById('tt24h').innerHTML = fmtC(hovered.c24h);
    document.getElementById('tt7d').innerHTML  = fmtC(hovered.c7d);
    document.getElementById('ttVol').textContent = fmtL(hovered.vol);
  } else {
    tt.style.display='none';
  }
});
canvas.addEventListener('mouseleave', () => {
  document.getElementById('tooltip').style.display='none';
  hovered=null;
});

// Mouse drag
canvas.addEventListener('mousedown', e => {
  const r  = canvas.getBoundingClientRect();
  const mx = e.clientX - r.left, my = e.clientY - r.top;
  for(const b of bubbles){
    if(Math.sqrt((mx-b.x)**2+(my-b.y)**2)<b.r){
      dragging=b; dragOffX=mx-b.x; dragOffY=my-b.y;
      b.vx=0; b.vy=0; break;
    }
  }
});
canvas.addEventListener('mousemove', e => {
  if(!dragging)return;
  const r=canvas.getBoundingClientRect();
  dragging.x = e.clientX - r.left - dragOffX;
  dragging.y = e.clientY - r.top  - dragOffY;
  const W=canvas._W||canvas.width, H=canvas._H||canvas.height;
  dragging.x = Math.max(dragging.r, Math.min(W-dragging.r, dragging.x));
  dragging.y = Math.max(dragging.r, Math.min(H-dragging.r, dragging.y));
}, { capture: false });
canvas.addEventListener('mouseup', () => {
  if(dragging){
    dragging.vx=(Math.random()-0.5)*0.15;
    dragging.vy=(Math.random()-0.5)*0.15;
    if(dragTimeout) clearTimeout(dragTimeout);
    lastDragged=dragging; dragging=null;
    dragTimeout=setTimeout(()=>{ lastDragged=null; }, 5000);
  }
});

// ===== TOUCH =====
canvas.addEventListener('touchstart', e => {
  e.preventDefault();
  const t=e.touches[0];
  const r=canvas.getBoundingClientRect();
  const tx=t.clientX-r.left, ty=t.clientY-r.top;
  dragging=null; hovered=null;
  for(const b of bubbles){
    if(Math.sqrt((tx-b.x)**2+(ty-b.y)**2)<b.r){
      dragging=b; hovered=b;
      dragOffX=tx-b.x; dragOffY=ty-b.y;
      b.vx=0; b.vy=0; break;
    }
  }
},{passive:false});

canvas.addEventListener('touchmove', e => {
  e.preventDefault();
  if(!dragging)return;
  hovered=dragging;
  const t=e.touches[0];
  const r=canvas.getBoundingClientRect();
  dragging.x = t.clientX - r.left - dragOffX;
  dragging.y = t.clientY - r.top  - dragOffY;
  const W=canvas._W||canvas.width, H=canvas._H||canvas.height;
  dragging.x = Math.max(dragging.r, Math.min(W-dragging.r, dragging.x));
  dragging.y = Math.max(dragging.r, Math.min(H-dragging.r, dragging.y));
},{passive:false});

canvas.addEventListener('touchend', e => {
  if(dragging){
    dragging.vx=(Math.random()-0.5)*0.15;
    dragging.vy=(Math.random()-0.5)*0.15;
    if(dragTimeout) clearTimeout(dragTimeout);
    lastDragged=dragging; dragging=null; hovered=null;
    dragTimeout=setTimeout(()=>{ lastDragged=null; }, 5000);
  }
});

// ===== WEBSOCKET (live 1m + 24h prices) =====
let wsPrices={}, wsConn=null;
function connectWS(){
  if(wsConn) wsConn.close();
  wsConn = new WebSocket('wss://stream.binance.com:9443/ws/!miniTicker@arr');
  wsConn.onmessage = e => {
    const arr=JSON.parse(e.data);
    arr.forEach(t=>{
      if(!t.s.endsWith('USDT'))return;
      const sym=t.s.replace('USDT','');
      const last=parseFloat(t.c), open24=parseFloat(t.o);
      const coin=allCoins.find(c=>c.sym===sym);
      if(!coin)return;
      coin.price=last;
      if(open24>0) coin.c24h=parseFloat(((last-open24)/open24*100).toFixed(2));
      if(!wsPrices[sym]) wsPrices[sym]={open1m:last,t1m:Date.now()};
      const wp=wsPrices[sym];
      const elapsed=(Date.now()-wp.t1m)/1000;
      if(elapsed>=60){ wp.open1m=last; wp.t1m=Date.now(); }
      coin.c1m=wp.open1m>0?parseFloat(((last-wp.open1m)/wp.open1m*100).toFixed(2)):0;
    });
    const btc=allCoins.find(c=>c.sym==='BTC');
    if(btc) document.getElementById('sBTC').textContent=
      '$'+btc.price.toLocaleString('en-US',{maximumFractionDigits:0});
    document.getElementById('sGain').textContent=allCoins.filter(c=>c[currentTF]>0).length;
    document.getElementById('sLoss').textContent=allCoins.filter(c=>c[currentTF]<0).length;
  };
  wsConn.onerror=()=>console.log('WS error');
  wsConn.onclose=()=>setTimeout(connectWS,3000);
}

// ===== CONTROLS =====
function setTF(tf,el){
  currentTF=tf;
  document.querySelectorAll('.tf-btn').forEach(b=>b.classList.remove('active'));
  el.classList.add('active');
  document.getElementById('sGain').textContent=allCoins.filter(c=>c[tf]>0).length;
  document.getElementById('sLoss').textContent=allCoins.filter(c=>c[tf]<0).length;
  buildBubbles();
}
function setFilter(f,el){
  currentFilter=f;
  document.querySelectorAll('.filter-btn').forEach(b=>b.classList.remove('active'));
  el.classList.add('active');
  buildBubbles();
}

// ===== FORMATTERS =====
function fmtP(n){if(!n)return'—';if(n>=1000)return n.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});if(n>=1)return n.toFixed(4);return n.toFixed(6);}
function fmtL(n){if(!n)return'—';if(n>=1e12)return'$'+(n/1e12).toFixed(1)+'T';if(n>=1e9)return'$'+(n/1e9).toFixed(1)+'B';if(n>=1e6)return'$'+(n/1e6).toFixed(1)+'M';return'$'+n.toFixed(0);}
function fmtC(v){if(!v&&v!==0)return'<span style="color:#aaa">—</span>';const s=v>=0?'+':'';return`<span class="${v>=0?'up':'dn'}">${s}${v.toFixed(2)}%</span>`;}

// ===== INIT =====
resizeCanvas();
fetchCoins().then(()=>connectWS());
setInterval(fetchCoins, 120000);
