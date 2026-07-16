// =====================================================
// COMMON.JS — shared across EVERY page of the site.
// Link this BEFORE the page-specific script (e.g. home.js)
// on every page, since they depend on these functions.
// =====================================================

// ===== DEMO BALANCE (every page can read/write this) =====
function getBal() { return parseFloat(localStorage.getItem('demoBalance') || 10000); }

function setBal(v) { localStorage.setItem('demoBalance', Math.max(0, v).toFixed(2)); }

// ===== FORMATTERS (used by every page that shows a price/number) =====
function fmtPrice(n) {
  if (!n) return '—';
  if (n >= 1000) return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (n >= 1) return n.toFixed(4);
  if (n >= 0.01) return n.toFixed(5);
  return n.toFixed(8);
}

function fmtLarge(n) {
  if (!n) return '—';
  if (n >= 1e12) return '$' + (n / 1e12).toFixed(2) + 'T';
  if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
  return '$' + n.toLocaleString();
}

// ===== DEBOUNCE — generic utility, any page's search/input can use this =====
// Waits until the user stops typing for `delay` ms before actually running fn.
// Stops wasted re-renders on every single keystroke.
function debounce(fn, delay) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), delay);
  };
}

// ===== HEADER "VISUAL ▾" DROPDOWN MENU (identical on every page) =====
function toggleVisualMenu(event) {
  event.preventDefault();
  event.stopPropagation();
  
  const menu = document.getElementById('visualMenu');
  const btn = event.currentTarget;
  
  if (menu.style.display === 'block') {
    menu.style.display = 'none';
    btn.classList.remove('active');
    return;
  }
  
  const rect = btn.getBoundingClientRect();
  const menuWidth = 130;
  const padding = 10;
  
  let left = rect.right;
  let top = rect.bottom - 50;
  const screenWidth = window.innerWidth;
  
  if (left + menuWidth > screenWidth) left = screenWidth - menuWidth - padding;
  if (left < padding) left = padding;
  
  menu.style.display = 'block';
  menu.style.position = 'fixed';
  menu.style.left = left + 'px';
  menu.style.top = top + 'px';
  
  btn.classList.add('active');
}

document.addEventListener('click', function() {
  const menu = document.getElementById('visualMenu');
  if (menu) menu.style.display = 'none';
  document.querySelectorAll('.menu-btn').forEach(btn => btn.classList.remove('active'));
});

// Wrapped in DOMContentLoaded + null-check — common.js may eventually load
// before the DOM is ready on some page, so we don't assume #visualMenu exists yet.
document.addEventListener('DOMContentLoaded', () => {
  const visualMenu = document.getElementById('visualMenu');
  if (visualMenu) {
    visualMenu.addEventListener('click', function(event) {
      event.stopPropagation();
    });
  }
});