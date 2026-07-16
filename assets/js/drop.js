// ===== NEON GRADIENT GENERATOR =====
const neonLayer = document.getElementById('neon-base-layer');
const r = 1, g = 249, b = 198;
let stops = [];
for (let i = 0; i <= 100; i++) {
  const opacity = ((100 - i) / 100).toFixed(2);
  stops.push(`rgba(${r}, ${g}, ${b}, ${opacity}) ${i}%`);
}
neonLayer.style.background = `linear-gradient(to top, ${stops.join(', ')})`;

// ===== CRYPTO ENGINE CORE LOGIC =====
let btcPriceInUSD = 74000;
let pageTotalBTC = 0;
let startTime = Date.now();

const stats = {
  red:    { count: 0, btc: 0 },
  yellow: { count: 0, btc: 0 },
  blue:   { count: 0, btc: 0 },
  water:  { count: 0, btc: 0 }
};

// Timer
setInterval(() => {
  let elapsedSeconds = Math.floor((Date.now() - startTime) / 1000);
  let mins = Math.floor(elapsedSeconds / 60).toString().padStart(2, '0');
  let secs = (elapsedSeconds % 60).toString().padStart(2, '0');
  document.getElementById('timer-display').innerText = `${mins}:${secs}`;
}, 1000);

// ===== BTC PRICE — REAL-TIME via Binance WebSocket (no polling delay) =====
let btcPriceWS = null;

function connectBTCPriceWS() {
  btcPriceWS = new WebSocket('wss://stream.binance.com:9443/ws/btcusdt@trade');

  btcPriceWS.onmessage = (event) => {
    const data = JSON.parse(event.data);
    btcPriceInUSD = parseFloat(data.p); // 'p' = trade price, updates on every single trade
    document.getElementById('btc-price-display').innerHTML = `$${btcPriceInUSD.toLocaleString(undefined,{maximumFractionDigits:0})}`;

    let sessionUSD = pageTotalBTC * btcPriceInUSD;
    document.getElementById('total-usd-display').innerText = `$${sessionUSD.toLocaleString(undefined, {maximumFractionDigits: 0})}`;

    ['red', 'yellow', 'blue', 'water'].forEach(cat => {
      let catUSD = stats[cat].btc * btcPriceInUSD;
      const el = document.getElementById(`usd-${cat}`);
      if (el) {
        el.innerText = catUSD >= 1000 ? "$" + (catUSD / 1000).toFixed(1) + "k" : "$" + catUSD.toFixed(0);
      }
    });
  };

  btcPriceWS.onerror = () => console.log('BTC price WS error');
  btcPriceWS.onclose  = () => setTimeout(connectBTCPriceWS, 3000); // auto-reconnect
}
connectBTCPriceWS();

// ===== WSS NETWORK CONNECTION (transactions — from blockchain.info) =====
const ws = new WebSocket("wss://ws.blockchain.info/inv");
ws.onopen = () => { ws.send(JSON.stringify({ "op": "unconfirmed_sub" })); };

ws.onmessage = (event) => {
  const response = JSON.parse(event.data);
  if (response.op === "utx") {
    const txData = response.x;
    const txHash = txData.hash;

    let totalOut = 0;
    txData.out.forEach(output => { totalOut += output.value; });
    const rawBtc = totalOut / 100000000;

    if (rawBtc > 0.001) {
      pageTotalBTC += rawBtc;
      document.getElementById('total-btc-display').innerText = `${pageTotalBTC.toFixed(2)} BTC`;
      let sessionUSD = pageTotalBTC * btcPriceInUSD;
      document.getElementById('total-usd-display').innerText = `$${sessionUSD.toLocaleString(undefined, {maximumFractionDigits: 0})}`;

      createCryptoNode(rawBtc, txHash);
    }
  }
};

function createCryptoNode(btcAmount, txHash) {
  const container = document.createElement('div');
  container.className = 'element-node';
  container.style.top = '135px';

  const shapeDiv = document.createElement('div');
  const textDiv = document.createElement('div');
  textDiv.className = 'inner-text';

  const formattedBTC = btcAmount.toFixed(2);
  const usdAmount = btcAmount * btcPriceInUSD;
  let formattedUSD = usdAmount >= 1000 ? "$" + (usdAmount / 1000).toFixed(1) + "k" : "$" + usdAmount.toFixed(0);

  textDiv.innerHTML = `
    <div class="drop-btc-logo-top">₿</div>
    <div>${formattedBTC}</div>
    <div class="sub-val">${formattedUSD}</div>
  `;

  let category = 'water';

  if (btcAmount >= 50) {
    shapeDiv.className = 'shola-base red-shola';
    category = 'red';
  } else if (btcAmount >= 10 && btcAmount < 50) {
    shapeDiv.className = 'shola-base yellow-shola';
    category = 'yellow';
  } else if (btcAmount >= 1 && btcAmount < 10) {
    shapeDiv.className = 'shola-base blue-shola';
    category = 'blue';
  } else {
    shapeDiv.className = 'water-drop';
    textDiv.classList.add('water-drop-text');
    category = 'water';
  }

  stats[category].count += 1;
  stats[category].btc += btcAmount;

  document.getElementById(`count-${category}`).innerText = stats[category].count;
  document.getElementById(`btc-${category}`).innerText = stats[category].btc.toFixed(2) + " ₿";

  let catUSD = stats[category].btc * btcPriceInUSD;
  document.getElementById(`usd-${category}`).innerText = catUSD >= 1000
    ? "$" + (catUSD / 1000).toFixed(1) + "k"
    : "$" + catUSD.toFixed(0);

  container.appendChild(shapeDiv);
  container.appendChild(textDiv);

  const randomLeft = Math.random() * (window.innerWidth - 60);
  container.style.left = randomLeft + 'px';

  const fallDuration = Math.random() * 8 + 15;
  container.style.animation = `fall-animation ${fallDuration}s linear forwards`;

  document.body.appendChild(container);

  container.addEventListener('animationend', () => {
    container.remove();
  });

  // DRAG & CLICK LOGIC
  let isDragging = false;
  let startX, startY;
  let originalLeft, originalTop;

  const startAction = (e) => {
    isDragging = false;
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;

    startX = clientX;
    startY = clientY;

    const rect = container.getBoundingClientRect();
    originalLeft = rect.left;
    originalTop = rect.top || 135;

    container.style.animationPlayState = 'paused';

    const moveAction = (moveEvent) => {
      const mX = moveEvent.touches ? moveEvent.touches[0].clientX : moveEvent.clientX;
      const mY = moveEvent.touches ? moveEvent.touches[0].clientY : moveEvent.clientY;

      let deltaX = mX - startX;
      let deltaY = mY - startY;

      if (Math.abs(deltaX) > 5 || Math.abs(deltaY) > 5) {
        isDragging = true;
        container.style.animation = 'none';
      }

      container.style.left = (originalLeft + deltaX) + 'px';
      container.style.top = (originalTop + deltaY) + 'px';
    };

    const endAction = () => {
      window.removeEventListener('mousemove', moveAction);
      window.removeEventListener('touchmove', moveAction);
      window.removeEventListener('mouseup', endAction);
      window.removeEventListener('touchend', endAction);

      if (!isDragging) {
        navigator.clipboard.writeText(txHash).then(() => {
          const alertBox = document.getElementById('copy-alert');
          alertBox.style.display = 'block';
          setTimeout(() => { alertBox.style.display = 'none'; }, 1500);
        }).catch(err => {
          const el = document.createElement('textarea');
          el.value = txHash;
          document.body.appendChild(el);
          el.select();
          document.execCommand('copy');
          document.body.removeChild(el);
          const alertBox = document.getElementById('copy-alert');
          alertBox.style.display = 'block';
          setTimeout(() => { alertBox.style.display = 'none'; }, 1500);
        });
        container.style.animationPlayState = 'running';
      } else {
        container.style.animation = 'none';

        setTimeout(() => {
          if (container.parentElement) {
            const currentTop = parseFloat(container.style.top) || 135;
            const remainingDistance = window.innerHeight - currentTop;
            const remainingTime = (remainingDistance / window.innerHeight) * fallDuration;

            const uniqueAnimName = `fall-from-${Math.floor(currentTop)}-${Date.now()}`;

            const styleSheet = document.styleSheets[0];
            try {
              styleSheet.insertRule(`
                @keyframes ${uniqueAnimName} {
                  0% { top: ${currentTop}px; }
                  100% { top: 105vh; opacity: 0; }
                }
              `, styleSheet.cssRules.length);
            } catch(e) {}

            container.style.animation = `${uniqueAnimName} ${remainingTime > 0 ? remainingTime : 1}s linear forwards`;

            container.addEventListener('animationend', () => {
              container.remove();
            });
          }
        }, 3000);
      }
    };

    window.addEventListener('mousemove', moveAction);
    window.addEventListener('touchmove', moveAction, { passive: false });
    window.addEventListener('mouseup', endAction);
    window.addEventListener('touchend', endAction);
  };

  container.addEventListener('mousedown', startAction);
  container.addEventListener('touchstart', startAction, { passive: true });
}
