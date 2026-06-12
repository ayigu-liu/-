function renderStockSelector() {
  var stocks = gameState.stocks || [];
  var selSym = gameState.selectedStock || (stocks.length > 0 ? stocks[0].symbol : "");
  var container = document.getElementById('stock-selector');
  if (container) {
    container.innerHTML = stocks.map(function(s) {
      return '<option value="' + s.symbol + '"' + (s.symbol === selSym ? ' selected' : '') + '>' + escapeHtml(s.symbol + ' ' + s.name) + '</option>';
    }).join('');
  }
  var sel = document.getElementById('trade-stock-select');
  if (sel) {
    sel.innerHTML = stocks.map(function(s) {
      return '<option value="' + s.symbol + '"' + (s.symbol === selSym ? ' selected' : '') + '>' + escapeHtml(s.symbol + ' ' + s.name) + '</option>';
    }).join('');
  }
  var adminSel = document.getElementById('admin-stock-select');
  if (adminSel) {
    adminSel.innerHTML = stocks.map(function(s) {
      return '<option value="' + s.symbol + '"' + (s.symbol === selSym ? ' selected' : '') + '>' + escapeHtml(s.symbol + ' ' + s.name) + '</option>';
    }).join('');
  }
}

let leaderboardInterval = null;


function updateFtpStockPrice(symbol) {
  var el = document.getElementById('ftp-stock-price');
  if (!el) return;
  var s = gameState.stocks.find(function(stk) { return stk.symbol === symbol; });
  if (s) {
    el.textContent = '¥' + s.price.toFixed(2);
    el.className = s.change >= 0 ? 'price-up' : 'price-down';
    el.style.cssText += ';margin-left:6px;font-size:13px;font-weight:700;font-variant-numeric:tabular-nums;min-width:65px;text-align:right;';
  } else {
    el.textContent = '¥--';
  }
}

async function showGamePage() {
  document.getElementById('auth-page').classList.remove('active');
  document.getElementById('game-page').classList.add('active');

  // 必须登录才能进入游戏
  if (!authUserId) {
    showAuth();
    return;
  }
  const pid = authUserId;
  gameState.playerId = pid;
  const nickname = authUsername || (authEmail ? authEmail.split('@')[0] : pid.slice(0, 8));
  wsConnect(pid, { type: 'join', data: { nickname } });

  // Load market data
  await loadMarketData();
  loadLeaderboard();
  var sel = document.getElementById("trade-stock-select");
  if (sel) sel.value = gameState.selectedStock || '';
  renderNews();
  loadMyOrders();
  if (!window.ordersInterval) {
    window.ordersInterval = setInterval(loadMyOrders, 3000);
  }
  checkCompanyOnLogin();

  leaderboardInterval = setInterval(loadLeaderboard, 1000);
  startCountdownTimer();
}

async function loadMarketData() {
  try {
    const data = await apiGet('/api/market');
    gameState.stocks = data.stocks || [{
      symbol: "",
      name: '--',
      price: 0,
      change: 0,
      change_pct: 0,
      volume: 0,
    }];
    gameState.selectedStock = gameState.selectedStock || (data.stocks && data.stocks.length > 0 ? data.stocks[0].symbol : "");
    gameState.playersOnline = data.players_online || 0;
    var pcEl = document.getElementById("player-count");
    if (pcEl) pcEl.textContent = "👤 " + (data.players_online || 0);
    renderStockSelector();
    renderStockInfo();
    loadInitialKline();
    // 首次加载时渲染图表
    if (typeof drawTimeshare === "function" && gameState.klinePeriod === "chart") {
      var tsSym = gameState.selectedStock || (gameState.stocks.length > 0 ? gameState.stocks[0].symbol : "");
      if (gameState.timeshare && gameState.timeshare[tsSym] && gameState.timeshare[tsSym].length >= 2) {
        setTimeshareData(gameState.timeshare[tsSym]);
      }
      toggleChartMode("timeshare");
    }
  } catch (e) {
    console.error('loadMarketData error', e);
  }
}

async function loadInitialKline() {
  var sym = gameState.selectedStock || (gameState.stocks.length > 0 ? gameState.stocks[0].symbol : "");
  if (!sym) return;
  try {
    // Load 4t candles as initial data
    var data = await apiGet('/api/market/kline?symbol=' + sym + '&period=4t');
    if (data && data.length > 0) {
      if (!gameState.candleData['4t']) gameState.candleData['4t'] = {};
      gameState.candleData['4t'][sym] = data;
      // Pre-load kline data even in timeshare mode, so it's ready when user switches
      if (typeof setKlineData === 'function') {
        setKlineData(data);
      }
    }
  } catch (e) {
    // Silent — WS will provide data when connected
  }
}

async function loadLeaderboard() {
  try {
    const lb = await apiGet('/api/market/leaderboard');
    gameState.leaderboard = lb || [];
    renderLeaderboard();
  } catch (e) {
    console.error('loadLeaderboard error', e);
  }
}

function selectStock(symbol) {
  gameState.selectedStock = symbol;
  // Update button active states
  document.querySelectorAll('.stock-selector-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.symbol === symbol);
  });
  renderStockInfo();
  renderTradeTape();
  var sel = document.getElementById("trade-stock-select");
  if (sel) sel.value = gameState.selectedStock || '';
  var adminSel = document.getElementById("admin-stock-select");
  if (adminSel) adminSel.value = symbol;
  updateFtpStockPrice(symbol);
  // Update kline chart for selected stock
  const period = gameState.klinePeriod;
  if (period && period !== 'chart') {
    const kp = period.replace('kline-', '');
    const cd = gameState.candleData[kp];
    if (cd && cd[symbol]) {
      setKlineData(cd[symbol]);
    }
  } else if ((!period || period === 'chart') && gameState.timeshare) {
    var tsSym2 = gameState.selectedStock || (gameState.stocks.length > 0 ? gameState.stocks[0].symbol : "");
    var tsd = gameState.timeshare[tsSym2] || [];
    setTimeshareData(tsd);
  }
  // Update day kline if applicable
  if (period === 'kline-1d' || period === 'kline-1w' || period === 'kline-1m') {
    var dailyCd = gameState.candleData['1d'];
    if (dailyCd && dailyCd[symbol] && dailyCd[symbol].length > 0) {
      if (typeof setDayKlineData === 'function') {
        setDayKlineData(dailyCd[symbol]);
      }
    }
  }
}

function switchRightTab(tab) {
  document.querySelectorAll('.tab-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === tab);
  });
  document.querySelectorAll('.tab-panel').forEach(p => {
    p.classList.toggle('active', p.id === 'tab-' + tab);
  });
  // Redraw equity curve when switching to equity tab
}

let currentOrderType = 'market';
let currentTradeType = 'buy';

function updateTradeEstimate(tradeType) {
  if (tradeType) currentTradeType = tradeType;
  else tradeType = currentTradeType;
  const qty = parseInt(document.getElementById('trade-qty').value) || 0;
  const symbol = gameState.selectedStock || (gameState.stocks.length > 0 ? gameState.stocks[0].symbol : "");
  const s = gameState.stocks.find(stk => stk.symbol === symbol) || gameState.stocks[0];
  if (s && qty > 0) {
    let usePrice = s.price;
    if (currentOrderType === 'limit') {
      const limitPrice = parseFloat(document.getElementById('trade-limit-price').value);
      if (limitPrice && limitPrice > 0) usePrice = limitPrice;
    }
    const total = usePrice * qty;
    const commission = Math.max(total * 0.001, 5.0);
    const stampTax = total * 0.001;
    const allFees = commission + stampTax;
    const netAmount = tradeType === 'sell' ? total - allFees : total + allFees;
    let feeText = `佣金 ¥${formatNumber(commission)}`;
    feeText += ` + 印花税 ¥${formatNumber(stampTax)}`;
    const label = tradeType === 'sell' ? '预计到账' : '预计花费';
    document.getElementById('trade-estimate').innerHTML =
      `成交 ${formatAmountCN(total)}<br><span style="font-size:10px;color:var(--text-muted);">${feeText}</span><br><b>${label} ${formatAmountCN(netAmount)}</b>`;
  }
}

function switchOrderType(type) {
  currentOrderType = type;
  document.querySelectorAll('.ftp-type-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.type === type);
  });
  document.getElementById('ftp-limit-row').classList.toggle('hidden', type !== 'limit');
  updateTradeEstimate();
}

function handleTrade(type) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    document.getElementById('trade-msg').textContent = '未连接到服务器，请等待连接...';
    document.getElementById('trade-msg').className = 'trade-msg error';
    return;
  }
  const qty = parseInt(document.getElementById('trade-qty').value);
  if (!qty || qty <= 0) {
    document.getElementById('trade-msg').textContent = '请输入有效数量';
    document.getElementById('trade-msg').className = 'trade-msg error';
    return;
  }

  if (currentOrderType === 'limit') {
    const limitPrice = parseFloat(document.getElementById('trade-limit-price').value);
    if (!limitPrice || limitPrice <= 0) {
      document.getElementById('trade-msg').textContent = '请输入有效挂单价';
      document.getElementById('trade-msg').className = 'trade-msg error';
      return;
    }
    const sideLabel = type === 'buy' ? '买入' : '卖出';
    var sym = gameState.selectedStock || (gameState.stocks.length > 0 ? gameState.stocks[0].symbol : "");
    if (!confirm(`确认${sideLabel} ${sym} 挂单？\n价格: ¥${limitPrice.toFixed(2)}\n数量: ${qty}股`)) return;
    wsSend('place_order', {
      stock_symbol: gameState.selectedStock || (gameState.stocks.length > 0 ? gameState.stocks[0].symbol : ""),
      quantity: qty,
      order_type: type,
      price: limitPrice,
    });
    document.getElementById('trade-msg').textContent = `挂单已提交：${type === 'buy' ? '买入' : '卖出'} ¥${limitPrice.toFixed(2)} × ${qty}股`;
    document.getElementById('trade-msg').className = 'trade-msg';
  } else {
    const sideLabel = type === 'buy' ? '买入' : '卖出';
    var sym = gameState.selectedStock || (gameState.stocks.length > 0 ? gameState.stocks[0].symbol : "");
    if (!confirm(`确认${sideLabel} ${sym} 市价单？\n数量: ${qty}股`)) return;
    wsSend('trade', {
      stock_symbol: gameState.selectedStock || (gameState.stocks.length > 0 ? gameState.stocks[0].symbol : ""),
      quantity: qty,
      trade_type: type,
    });
    document.getElementById('trade-msg').textContent = '订单已提交...';
    document.getElementById('trade-msg').className = 'trade-msg';
  }
}

function updatePortfolio(data) {
  gameState.cash = data.cash;
  gameState.holdings = data.holdings || [];
  gameState.totalAssets = data.total_assets;
  gameState.totalPnl = data.total_pnl;
  gameState.pnlPercent = data.pnl_percent;
  gameState.frozenCash = data.frozen_cash || 0;

  // Admin detection
  if (data.is_admin) {
    isAdminUser = true;
    adminCash = data.cash || 0;
    var btn = document.getElementById('btn-toggle-admin');
    if (btn) btn.style.display = 'inline-block';
    updateAdminPanel();
  }

  // Use server-provided day_start_assets for daily P&L
  if (data.day_start_assets != null) {
    gameState.dayStartAssets = data.day_start_assets;
  } else if (gameState.dayStartAssets === null) {
    gameState.dayStartAssets = data.total_assets;
  }

  // Hero: total assets
  document.getElementById('pf-total').textContent = formatAmountCN(data.total_assets);

  // Day P&L (change since dayStartAssets)
  const dayPnl = data.total_assets - gameState.dayStartAssets;
  const dayPnlPct = gameState.dayStartAssets > 0
    ? (dayPnl / gameState.dayStartAssets) * 100 : 0;
  const dayPnlEl = document.getElementById('pf-day-pnl');
  const dayPnlClass = dayPnl >= 0 ? 'price-up' : 'price-down';
  dayPnlEl.textContent = formatAmountCN(dayPnl) + ' (' + formatPercent(dayPnlPct) + ')';
  dayPnlEl.className = 'pf-hero-pnl ' + dayPnlClass;

  // Detail: cash
  document.getElementById('pf-cash').textContent = formatAmountCN(data.cash);
  document.getElementById('pf-cash').className = 'pf-detail-value';

  // Buying power = cash * 2
  const buyingPower = (data.cash - (data.frozen_cash || 0)) * 2;
  document.getElementById('pf-buying-power').textContent = formatAmountCN(buyingPower);

  // Detail: stock value
  const stockValue = data.total_assets - data.cash;
  document.getElementById('pf-stock-value').textContent = formatAmountCN(stockValue);
  document.getElementById('pf-stock-value').className = 'pf-detail-value';

  // Footer: total P&L
  const pnlEl = document.getElementById('pf-pnl');
  const pnlClass = data.total_pnl >= 0 ? 'price-up' : 'price-down';
  pnlEl.textContent = formatAmountCN(data.total_pnl) + ' (' + formatPercent(data.pnl_percent) + ')';
  pnlEl.className = 'pf-footer-value ' + pnlClass;

  renderHoldings();
}

function renderHoldings() {
  const el = document.getElementById('holdings-table');
  let html = `<div class="holding-row holding-header">
    <span>股票</span><span>数量</span><span>均价</span><span>现价</span><span>市值</span><span>盈亏</span>
  </div>`;
  let hasPosition = false;
  if (gameState.holdings && gameState.holdings.length > 0) {
    for (const h of gameState.holdings) {
      if (h.quantity > 0) {
        hasPosition = true;
        const pnlClass = h.pnl >= 0 ? 'price-up' : 'price-down';
        html += `<div class="holding-row">
          <span style="text-align:left;">${h.symbol}</span>
          <span>${h.quantity}</span>
          <span>${h.avg_cost.toFixed(2)}</span>
          <span class="${priceClass(h.current_price - h.avg_cost)}">${h.current_price.toFixed(2)}</span>
          <span>${formatAmountCN(h.market_value)}</span>
          <span class="${pnlClass}">${formatAmountCN(h.pnl)}</span>
        </div>`;
      }
    }
  }
  if (!hasPosition) {
    html += '<div style="text-align:center;padding:20px;color:var(--text-muted);font-size:13px;">暂无持仓</div>';
  }
  el.innerHTML = html;
}

function renderOrderBook() {
  const el = document.getElementById('orderbook-content');
  if (!el) return;
  var sym = gameState.selectedStock || (gameState.stocks.length > 0 ? gameState.stocks[0].symbol : "");
  document.getElementById('ob-symbol').textContent = sym || '';
  var ob = gameState.orderBook || {};
  var book = ob[sym] || {bids: [], asks: []};
  var bids = (book.bids || []).slice(0, 8);
  var asks = (book.asks || []).slice(0, 8);

  if (bids.length === 0 && asks.length === 0) {
    el.innerHTML = '<div class="ob-empty">暂无挂单</div>';
    return;
  }

  // Max qty for depth bar scaling
  var allQty = bids.concat(asks);
  var maxQty = 1;
  allQty.forEach(function(o) { if (o.quantity > maxQty) maxQty = o.quantity; });

  var bestBid = bids.length > 0 ? bids[0].price : 0;
  var bestAsk = asks.length > 0 ? asks[0].price : 0;
  var spread = (bestBid > 0 && bestAsk > 0) ? (bestAsk - bestBid).toFixed(2) : '--';
  var mid = (bestBid > 0 && bestAsk > 0) ? ((bestBid + bestAsk) / 2).toFixed(2) : '--';

  var html = '';

  // Asks (sells) — show lowest first, reverse so best ask at bottom
  html += '<div class="ob-section-header">卖盘</div>';
  var revAsks = asks.slice().reverse();
  revAsks.forEach(function(o) {
    var pct = (o.quantity / maxQty * 100).toFixed(0);
    html += '<div class="ob-row ob-ask">' +
      '<div class="ob-bar ob-bar-ask" style="width:' + pct + '%"></div>' +
      '<span class="ob-price ob-ask-price">' + o.price.toFixed(2) + '</span>' +
      '<span class="ob-qty">' + (o.quantity >= 10000 ? (o.quantity/10000).toFixed(1)+'万' : o.quantity) + '</span>' +
      '</div>';
  });

  // Spread + mid price
  html += '<div class="ob-spread">' +
    '<span>价差 <b>' + spread + '</b></span>' +
    '<span>中间价 <b>' + mid + '</b></span>' +
    '</div>';

  // Bids (buys) — highest first
  html += '<div class="ob-section-header">买盘</div>';
  bids.forEach(function(o) {
    var pct = (o.quantity / maxQty * 100).toFixed(0);
    html += '<div class="ob-row ob-bid">' +
      '<div class="ob-bar ob-bar-bid" style="width:' + pct + '%"></div>' +
      '<span class="ob-price ob-bid-price">' + o.price.toFixed(2) + '</span>' +
      '<span class="ob-qty">' + (o.quantity >= 10000 ? (o.quantity/10000).toFixed(1)+'万' : o.quantity) + '</span>' +
      '</div>';
  });

  el.innerHTML = html;
}

function renderTradeTape() {
  var el = document.getElementById('tape-content');
  if (!el) return;
  var tape = gameState.tape || [];
  if (tape.length === 0) {
    el.innerHTML = '<div class="tape-empty">暂无成交</div>';
    return;
  }
  el.innerHTML = tape.map(function(t) {
    var arrow = t.type === 'buy' ? '↑' : '↓';
    var cls = t.type === 'buy' ? 'active-buy' : 'active-sell';
    return '<div class="tape-row ' + cls + '">' +
      '<span class="tape-time">' + (t.time || '--') + '</span>' +
      '<span class="tape-arrow">' + arrow + '</span>' +
      '<span class="tape-price">' + t.price.toFixed(2) + '</span>' +
      '<span class="tape-qty">' + t.quantity + '</span>' +
      '</div>';
  }).join('');
}

function startCountdownTimer() {
  var el = document.getElementById('tick-countdown');
  if (!el) return;
  var QUARTER_SEC = 300; // 200 ticks x 1.5s
  setInterval(function() {
    var now = Date.now() / 1000;
    var elapsed = now % QUARTER_SEC;
    var remaining = Math.max(0, QUARTER_SEC - elapsed);
    var min = Math.floor(remaining / 60);
    var sec = Math.floor(remaining % 60);
    el.textContent = '⏱ ' + min + ':' + (sec < 10 ? '0' : '') + sec;
  }, 200);
}

function renderNews() {
  const el = document.getElementById('news-content');
  if (!el) return;
  const news = gameState.newsList || [];
  if (news.length === 0) {
    el.innerHTML = '<div class="news-empty">暂无公告</div>';
    return;
  }
  el.innerHTML = news.map(n => `
    <div class="news-item">
      <div class="news-time">${n.time || ''}</div>
      <div class="news-title ${n.impact || ''}">${n.title || ''}</div>
      <div class="news-content-text">${n.content || ''}</div>
    </div>
  `).join('');
}


var pendingAlloc = {};

function showAllocAdjustModal() {
  var alloc = (gameState.myCompany && gameState.myCompany.alloc_pcts) || {};
  pendingAlloc = {
    reserve: alloc.reserve || 25,
    sales: alloc.sales || 25,
    dividend: alloc.dividend || 25,
    research: alloc.research || 25,
  };
  var modal = document.getElementById('decision-modal');
  if (!modal) return;
  document.getElementById('decision-quarter').textContent = '调整利润分配比例';
  var body = document.getElementById('decision-body');
  body.innerHTML = '';

  var div = document.createElement('div');
  div.className = 'decision-item';
  div.innerHTML = '<div class="decision-title">利润分配</div>' +
    '<div style="font-size:12px;color:var(--text-muted);margin-bottom:12px;">调整各项分配比例，合计必须为100%</div>';

  var adjustable = ['sales', 'dividend', 'research'];
  var sliders = {};
  var valueDisplays = {};

  adjustable.forEach(function(key) {
    var labels = {sales: '销售', dividend: '分红', research: '研究'};
    var descs = {sales: '扩展市场份额', dividend: '分给股东', research: '提升未来增长'};
    var row = document.createElement('div');
    row.className = 'alloc-row';
    row.innerHTML = '<div class="alloc-header">' +
      '<span class="alloc-label">' + labels[key] + '</span>' +
      '<span class="alloc-desc">' + descs[key] + '</span>' +
      '</div>' +
      '<div class="alloc-control">' +
      '<input type="range" class="alloc-slider" min="0" max="100" value="' + pendingAlloc[key] + '">' +
      '<span class="alloc-value">' + pendingAlloc[key] + '%</span>' +
      '</div>';
    div.appendChild(row);
    sliders[key] = row.querySelector('.alloc-slider');
    valueDisplays[key] = row.querySelector('.alloc-value');
    sliders[key].addEventListener('input', (function(k) {
      return function() {
        var v = parseInt(this.value) || 0;
        pendingAlloc[k] = Math.max(0, Math.min(100, v));
        updateDisplays();
      };
    })(key));
  });

  // Auto-calculated reserve display
  var reserveRow = document.createElement('div');
  reserveRow.className = 'alloc-row';
  reserveRow.style.opacity = '0.7';
  reserveRow.innerHTML = '<div class="alloc-header">' +
    '<span class="alloc-label">储存</span>' +
    '<span class="alloc-desc">自动 = 100% - 其他三项</span>' +
    '</div>' +
    '<div class="alloc-control">' +
    '<span class="alloc-value" id="reserve-auto-val">' + pendingAlloc.reserve + '%</span>' +
    '</div>';
  div.appendChild(reserveRow);

        } else {
        }
      });
    } else {
    }
  }

  function updateDisplays() {
    var sum = (pendingAlloc.sales || 0) + (pendingAlloc.dividend || 0) + (pendingAlloc.research || 0);
    pendingAlloc.reserve = Math.max(0, 100 - sum);
    adjustable.forEach(function(k) {
      sliders[k].value = pendingAlloc[k];
      valueDisplays[k].textContent = pendingAlloc[k] + '%';
    });
    var re = document.getElementById('reserve-auto-val');
    if (re) re.textContent = pendingAlloc.reserve + '%';
    var td = document.getElementById('alloc-total');
    if (td) {
      td.textContent = '合计: 100%（其中储存 ' + pendingAlloc.reserve + '%）';
      td.style.color = 'var(--text-muted)';
    }
  }

  updateDisplays();
    var total = 0;
    keys.forEach(function(k) {
      sliders[k].value = pendingAlloc[k];
      valueDisplays[k].textContent = pendingAlloc[k] + '%';
      total += pendingAlloc[k];
    });
    var td = document.getElementById('alloc-total');
    if (td) {
      td.textContent = '合计: ' + total + '%';
      td.style.color = (total !== 100) ? '#ef4444' : 'var(--text-muted)';
    }
  }

  var btnRow = document.createElement('div');
  btnRow.style.cssText = 'display:flex;justify-content:center;gap:8px;margin-top:16px;';
  var cancelBtn = document.createElement('button');
  cancelBtn.className = 'btn';
  cancelBtn.textContent = '取消';
  cancelBtn.onclick = function() { hideDecisionModal(); };
  btnRow.appendChild(cancelBtn);
  var saveBtn = document.createElement('button');
  saveBtn.className = 'btn btn-primary';
  saveBtn.textContent = '保存分配';
  saveBtn.onclick = function() { saveAllocation(); };
  btnRow.appendChild(saveBtn);
  div.appendChild(btnRow);

  var totalDisplay = document.createElement('div');
  totalDisplay.style.cssText = 'text-align:center;font-size:12px;margin-top:8px;color:var(--text-muted);';
  totalDisplay.id = 'alloc-total';
  totalDisplay.textContent = '合计: 100%';
  div.appendChild(totalDisplay);

  body.appendChild(div);
  modal.style.display = 'flex';
}

async function saveAllocation() {
  try {
    var result = await apiPost('/api/company/alloc', { alloc_pcts: pendingAlloc });
    showToast('分配比例已保存！', 'success');
    hideDecisionModal();
    loadCompanyInfo();
  } catch (e) {
    showToast('保存失败: ' + (e.message || '未知错误'), 'error');
  }
}

function renderLeaderboard() {
  const el = document.getElementById('leaderboard');
  if (!gameState.leaderboard || gameState.leaderboard.length === 0) {
    el.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-muted);font-size:13px;">暂无排名</div>';
    return;
  }
  const medals = { 1: 'gold', 2: 'silver', 3: 'bronze' };
  el.innerHTML = gameState.leaderboard.map(e => {
    const isMe = e.player_id === gameState.playerId ? 'is-me' : '';
    const medalClass = medals[e.rank] || '';
    const pnlClass = e.pnl_percent >= 0 ? 'price-up' : 'price-down';
    return `<div class="lb-row ${isMe}">
      <span class="lb-rank ${medalClass}">${e.rank <= 3 ? ['\u{1F947}','\u{1F948}','\u{1F949}'][e.rank-1] : e.rank}</span>
      <span class="lb-nickname">${escapeHtml(e.nickname || '匿名')}</span>
      <span class="lb-earn">${formatAmountCN(e.total_assets)}</span>
    </div>`;
  }).join('');
}

// ============================================================
// 历史成交
// ============================================================
// ============================================================
// 我的委托（撤单）
// ============================================================
async function loadMyOrders() {
  if (!gameState.playerId) return;
  try {
    const orders = await apiGet('/api/market/orders?player_id=' + gameState.playerId);
    gameState.pendingOrders = orders || [];
    renderPendingOrders();
  } catch (e) {
    console.error('loadOrders error', e);
  }
}

function renderPendingOrders() {
  const el = document.getElementById('pending-orders-content');
  if (!el) return;
  const orders = gameState.pendingOrders || [];
  if (orders.length === 0) {
    el.innerHTML = '<div class="pending-orders-empty">暂无委托</div>';
    return;
  }
  el.innerHTML = orders.map(o => {
    const label = o.type === 'buy' ? '买入' : '卖出';
    const cls = o.type === 'buy' ? 'price-up' : 'price-down';
    return `<div class="pending-order-row">
      <div class="po-info">
        <span class="po-type ${cls}">${label}</span>
        <span class="po-symbol">${o.symbol}</span>
        <span class="po-price">¥${o.price.toFixed(2)}</span>
        <span class="po-qty">${o.filled}/${o.quantity}</span>
      </div>
      <button class="btn btn-xs btn-danger" onclick="handleCancelOrder('${o.order_id}')">撤单</button>
    </div>`;
  }).join('');
}

async function handleCancelOrder(orderId) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    showToast('未连接', 'error');
    return;
  }
  wsSend('cancel_order', { order_id: orderId });
}

function handleCancelAllOrders() {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    showToast('未连接', 'error');
    return;
  }
  const orders = gameState.pendingOrders || [];
  if (orders.length === 0) {
    showToast('没有需要撤销的委托', 'info');
    return;
  }
  wsSend('cancel_all_orders', {});
  showToast('正在撤销全部委托...', 'info');
}

function refreshHoldings() {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    showToast('未连接', 'error');
    return;
  }
  wsSend('refresh_portfolio', {});
  showToast('刷新中...', 'info');
}

// ============================================================
// Admin Panel
// ============================================================
let isAdminUser = false;
let adminCash = 0;

function toggleAdminPanel() {
  var panel = document.getElementById('floating-admin-panel');
  if (!panel) return;
  panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
  if (panel.style.display === 'block') updateAdminPanel();
}

function closeAdminPanel() {
  var panel = document.getElementById('floating-admin-panel');
  if (panel) panel.style.display = 'none';
}

function updateAdminPanel() {
  var cashEl = document.getElementById('admin-cash');
  var priceEl = document.getElementById('admin-stock-price');
  if (cashEl) cashEl.textContent = '可用资金: ¥' + formatAmountCN(adminCash);
  if (priceEl) {
    var symbol = gameState.selectedStock || (gameState.stocks.length > 0 ? gameState.stocks[0].symbol : "");
    var s = gameState.stocks && (gameState.stocks.find(stk => stk.symbol === symbol) || gameState.stocks[0]);
    priceEl.textContent = '当前股价: ¥' + (s ? s.price.toFixed(2) : '--');
  }
}

function quickBuy(qty) {
  if (!ws || ws.readyState !== WebSocket.OPEN) { showToast('未连接', 'error'); return; }
  var symbol = gameState.selectedStock || (gameState.stocks.length > 0 ? gameState.stocks[0].symbol : "");
  var s = gameState.stocks && (gameState.stocks.find(function(stk) { return stk.symbol === symbol; }) || gameState.stocks[0]);
  if (!s) { showToast('无行情数据', 'error'); return; }
  var cost = s.price * qty;
  var cash = gameState.cash || 0;
  if (cost > cash * 1.05) { showToast('资金不足，最多可买 ' + Math.floor(cash / s.price / 100) * 100 + ' 股', 'error'); return; }
  if (!confirm('确认市价买入 ' + symbol + ' ' + Number(qty).toLocaleString() + ' 股？')) return;
  wsSend('trade', { stock_symbol: symbol, quantity: qty, trade_type: 'buy' });
  showToast('买入委托 ' + Number(qty).toLocaleString() + ' 股', 'success');
}

function quickSell(qty) {
  if (!ws || ws.readyState !== WebSocket.OPEN) { showToast('未连接', 'error'); return; }
  var symbol = gameState.selectedStock || (gameState.stocks.length > 0 ? gameState.stocks[0].symbol : "");
  var s = gameState.stocks && (gameState.stocks.find(function(stk) { return stk.symbol === symbol; }) || gameState.stocks[0]);
  if (!s) { showToast('无行情数据', 'error'); return; }
  var holding = gameState.holdings ? gameState.holdings.find(function(h) { return h.symbol === symbol; }) : null;
  var available = holding ? (holding.quantity - (holding.frozen_qty || 0)) : 0;
  if (available < qty) { showToast('可卖不足，最多卖 ' + available + ' 股', 'error'); return; }
  if (!confirm('确认市价卖出 ' + symbol + ' ' + Number(qty).toLocaleString() + ' 股？')) return;
  wsSend('trade', { stock_symbol: symbol, quantity: qty, trade_type: 'sell' });
  showToast('卖出委托 ' + Number(qty).toLocaleString() + ' 股', 'success');
}


function adminBuy(qty) {
  if (!ws || ws.readyState !== WebSocket.OPEN) { showToast('未连接', 'error'); return; }
  var symbol = gameState.selectedStock || (gameState.stocks.length > 0 ? gameState.stocks[0].symbol : "");
  var s = gameState.stocks && (gameState.stocks.find(stk => stk.symbol === symbol) || gameState.stocks[0]);
  if (!s) { showToast('无行情数据', 'error'); return; }
  var cost = s.price * qty;
  if (cost > adminCash * 1.1) { showToast('资金不足，最多可买 ' + Math.floor(adminCash / s.price / 1000) * 1000 + ' 股', 'error'); return; }
  wsSend('place_order', { stock_symbol: symbol, quantity: qty, order_type: 'buy', price: s.price });
  setAdminStatus('买入委托 ' + Number(qty).toLocaleString() + ' 股 @ ¥' + s.price.toFixed(2));
}

function adminSell(qty) {
  if (!ws || ws.readyState !== WebSocket.OPEN) { showToast('未连接', 'error'); return; }
  var symbol = gameState.selectedStock || (gameState.stocks.length > 0 ? gameState.stocks[0].symbol : "");
  var s = gameState.stocks && (gameState.stocks.find(stk => stk.symbol === symbol) || gameState.stocks[0]);
  if (!s) { showToast('无行情数据', 'error'); return; }
  wsSend('place_order', { stock_symbol: symbol, quantity: qty, order_type: 'sell', price: s.price });
  setAdminStatus('卖出委托 ' + Number(qty).toLocaleString() + ' 股 @ ¥' + s.price.toFixed(2));
}

function adminBuyAll() {
  if (!ws || ws.readyState !== WebSocket.OPEN) { showToast('未连接', 'error'); return; }
  var symbol = gameState.selectedStock || (gameState.stocks.length > 0 ? gameState.stocks[0].symbol : "");
  var s = gameState.stocks && (gameState.stocks.find(stk => stk.symbol === symbol) || gameState.stocks[0]);
  if (!s || !adminCash) { showToast('无行情数据或资金', 'error'); return; }
  var maxQty = Math.floor((adminCash * 0.98) / s.price / 1000) * 1000;
  if (maxQty < 1000) { showToast('资金不足', 'error'); return; }
  adminBuy(maxQty);
}

function adminSellAll() {
  if (!ws || ws.readyState !== WebSocket.OPEN) { showToast('未连接', 'error'); return; }
  var symbol = gameState.selectedStock || (gameState.stocks.length > 0 ? gameState.stocks[0].symbol : "");
  var holding = gameState.holdings.find(function(h) { return h.symbol === symbol && h.quantity > 0; });
  if (!holding) { showToast('没有持仓', 'error'); return; }
  adminSell(holding.quantity);
}

function adminBuyToTarget() {
  var target = parseFloat(document.getElementById('admin-target-price').value);
  if (!target || target <= 0) { showToast('请输入目标价', 'error'); return; }
  if (!ws || ws.readyState !== WebSocket.OPEN) { showToast('未连接', 'error'); return; }
  var symbol = gameState.selectedStock || (gameState.stocks.length > 0 ? gameState.stocks[0].symbol : "");
  var s = gameState.stocks && (gameState.stocks.find(stk => stk.symbol === symbol) || gameState.stocks[0]);
  if (!s) { showToast('无行情数据', 'error'); return; }
  if (target <= s.price) { showToast('目标价必须高于当前价才能拉升', 'error'); return; }
  var steps = Math.min(5, Math.ceil((target - s.price) / (s.price * 0.01)));
  var cashPerOrder = Math.min(adminCash * 0.2, 20000000);
  for (var i = 0; i < steps; i++) {
    var stepPrice = s.price * (1 + 0.01 * (i + 1));
    var qty = Math.floor(cashPerOrder / stepPrice / 1000) * 1000;
    if (qty >= 1000) {
      wsSend('place_order', { stock_symbol: symbol, quantity: qty, order_type: 'buy', price: stepPrice });
    }
  }
  setAdminStatus('拉升委托已提交: ' + steps + ' 档');
}

function adminDumpToTarget() {
  var target = parseFloat(document.getElementById('admin-target-price').value);
  var qty = parseInt(document.getElementById('admin-dump-qty').value) || 100000;
  if (!target || target <= 0) { showToast('请输入目标价', 'error'); return; }
  if (!ws || ws.readyState !== WebSocket.OPEN) { showToast('未连接', 'error'); return; }
  var symbol = gameState.selectedStock || (gameState.stocks.length > 0 ? gameState.stocks[0].symbol : "");
  var s = gameState.stocks && (gameState.stocks.find(stk => stk.symbol === symbol) || gameState.stocks[0]);
  if (!s) { showToast('无行情数据', 'error'); return; }
  if (target >= s.price) { showToast('目标价必须低于当前价才能砸盘', 'error'); return; }
  var steps = Math.min(5, Math.ceil((s.price - target) / (s.price * 0.01)));
  var perStep = Math.floor(qty / steps / 1000) * 1000;
  for (var i = 0; i < steps; i++) {
    var stepPrice = s.price * (1 - 0.01 * (i + 1));
    if (perStep >= 1000) {
      wsSend('place_order', { stock_symbol: symbol, quantity: perStep, order_type: 'sell', price: stepPrice });
    }
  }
  setAdminStatus('砸盘委托已提交: ' + steps + ' 档');
}

function setAdminStatus(msg) {
  var el = document.getElementById('admin-status');
  if (el) {
    el.textContent = msg;
    el.style.color = '#ffd700';
    setTimeout(function() { el.style.color = ''; }, 3000);
  }
}

// Auto-refresh pending orders (starts in showGamePage)
window.ordersInterval = null;

// ============================================================
// Floating Trading Panel
// ============================================================
function toggleFloatingPanel() {
  const panel = document.getElementById('floating-trade-panel');
  if (!panel) return;
  const isVisible = panel.classList.contains('visible');
  if (isVisible) {
    panel.classList.remove('visible');
    localStorage.setItem('ftp_visible', 'false');
  } else {
    panel.classList.add('visible');
    panel.classList.remove('minimized');
    localStorage.setItem('ftp_visible', 'true');
    // Restore saved position
    var savedLeft = localStorage.getItem('floating-trade-panel_left') || localStorage.getItem('ftp_left');
    var savedTop = localStorage.getItem('floating-trade-panel_top') || localStorage.getItem('ftp_top');
    if (savedLeft) panel.style.left = savedLeft;
    if (savedTop) panel.style.top = savedTop;
    panel.style.right = ''; // clear right when using left
  }
}

function minimizeFtp() {
  const panel = document.getElementById('floating-trade-panel');
  if (!panel) return;
  panel.classList.toggle('minimized');
}

function closeFtp() {
  const panel = document.getElementById('floating-trade-panel');
  if (!panel) return;
  panel.classList.remove('visible');
  localStorage.setItem('ftp_visible', 'false');
}

function renamePlayer() {
  var currentName = authUsername || gameState.playerId.slice(0, 8);
  var newName = prompt('请输入新的昵称（最多20个字符）', currentName);
  if (!newName || newName.trim() === '') return;
  newName = newName.trim().slice(0, 20);
  if (newName === currentName) return;
  apiPost('/api/market/rename', { nickname: newName })
    .then(function(resp) {
      authUsername = resp.nickname;
      showToast('昵称已修改为: ' + resp.nickname, 'success');
    })
    .catch(function(err) {
      showToast('修改失败: ' + err.message, 'error');
    });
}

// Restore FTP visibility from localStorage on load
document.addEventListener('DOMContentLoaded', () => {
  const ftp = document.getElementById('floating-trade-panel');
  if (ftp && localStorage.getItem('ftp_visible') === 'true') {
    ftp.classList.add('visible');
    var savedLeft = localStorage.getItem('floating-trade-panel_left') || localStorage.getItem('ftp_left');
    var savedTop = localStorage.getItem('floating-trade-panel_top') || localStorage.getItem('ftp_top');
    if (savedLeft) ftp.style.left = savedLeft;
    if (savedTop) ftp.style.top = savedTop;
    ftp.style.right = '';
  }
});

// Draggable FTP
let dragState = null;

document.addEventListener('mousedown', (e) => {
  const header = e.target.closest('.ftp-header');
  if (!header) return;
  const panel = header.closest('.ftp');
  if (!panel || !panel.classList.contains('visible')) return;

  dragState = {
    panel,
    startX: e.clientX,
    startY: e.clientY,
    origLeft: panel.style.left || (window.innerWidth - panel.offsetWidth - 20) + 'px',
    origTop: panel.style.top || '80px',
  };
  panel.style.right = '';
  panel.style.left = dragState.origLeft;
  panel.style.top = dragState.origTop;
});

document.addEventListener('mousemove', (e) => {
  if (!dragState) return;
  const dx = e.clientX - dragState.startX;
  const dy = e.clientY - dragState.startY;
  dragState.panel.style.left = (parseInt(dragState.origLeft) + dx) + 'px';
  dragState.panel.style.top = (parseInt(dragState.origTop) + dy) + 'px';
});

document.addEventListener('mouseup', () => {
  if (!dragState) return;
  // Save position with panel-specific keys
  const prefix = dragState.panel.id || 'ftp';
  localStorage.setItem(prefix + '_left', dragState.panel.style.left);
  localStorage.setItem(prefix + '_top', dragState.panel.style.top);
  dragState = null;
});




function escapeHtml(text) {
  const d = document.createElement('div');
  d.textContent = text;
  return d.innerHTML;
}




// ============================================================
// 行业概览
// ============================================================
// 公司经营相关
// ============================================================
let selectedIndustry = 'tech';

function selectIndustry(industry) {
  selectedIndustry = industry;
  document.querySelectorAll('.industry-card').forEach(function(c) {
    c.classList.toggle('selected', c.dataset.industry === industry);
  });
}

function showCompanyRegModal() {
  var modal = document.getElementById('company-reg-modal');
  if (modal) modal.style.display = 'flex';
}

function hideCompanyRegModal() {
  var modal = document.getElementById('company-reg-modal');
  if (modal) modal.style.display = 'none';
}

async function createCompany() {
  var name = document.getElementById('company-name-input').value.trim();
  if (!name) {
    document.getElementById('company-reg-msg').textContent = '请输入公司名称';
    return;
  }
  if (name.length > 20) {
    document.getElementById('company-reg-msg').textContent = '公司名称不能超过20字';
    return;
  }
  try {
    var result = await apiPost('/api/company/create', { name: name, industry: selectedIndustry });
    document.getElementById('company-reg-msg').textContent = '';
    hideCompanyRegModal();
    showToast('公司 ' + result.name + ' 创建成功！股票代码: ' + result.symbol, 'success');
    loadMarketData();
    loadCompanyInfo();
  } catch (e) {
    if (e.message && e.message.includes("already have a company")) {
      document.getElementById("company-reg-msg").textContent = "你已经拥有公司了！请先关闭此窗口查看你的公司。";
      return;
    }
    document.getElementById('company-reg-msg').textContent = e.message || '创建失败';
  }
}

async function checkCompanyOnLogin() {
  try {
    var data = await apiGet('/api/company/my');
    gameState.myCompany = data;
    loadCompanyInfo();
    var btn = document.getElementById('btn-toggle-company');
    if (btn) btn.style.display = 'inline-block';
  } catch (e) {
    if (e.message && (e.message.includes('no company') || e.message.includes('Not Found') || e.message.includes('404'))) {
      showCompanyRegModal();
    } else {
      console.warn('检查公司状态失败:', e.message);
    }
  }
}

function loadCompanyInfo() {
  (async function() {
    try {
      var data = await apiGet('/api/company/my');
      gameState.myCompany = data;
      renderCompanyInfo(data);
    } catch (e) {
      var btn = document.getElementById('btn-toggle-company');
      if (btn) btn.style.display = 'none';
    }
  })();
}

function renderCompanyInfo(d) {
  document.getElementById('comp-name').textContent = d.name || '--';
  document.getElementById('comp-symbol').textContent = d.symbol || '--';
  document.getElementById('comp-industry').textContent = d.industry_name || d.industry || '--';
  var priceEl = document.getElementById('comp-price');
  if (d.share_price) {
    priceEl.textContent = '¥' + Number(d.share_price).toFixed(2);
    priceEl.className = 'comp-stat-value price-up';
  }
  document.getElementById('comp-valuation').textContent = d.valuation ? formatAmountCN(d.valuation) : '--';
  document.getElementById('comp-assets').textContent = d.total_assets ? formatAmountCN(d.total_assets) : '--';
  document.getElementById('comp-cash').textContent = d.cash ? formatAmountCN(d.cash) : '--';
  document.getElementById('comp-revenue').textContent = d.revenue ? formatAmountCN(d.revenue) : '--';
  document.getElementById('comp-profit').textContent = d.profit ? formatAmountCN(d.profit) : '--';
  document.getElementById('comp-employees').textContent = d.employees ? Number(d.employees).toLocaleString() : '--';
  document.getElementById('comp-quarter').textContent = d.quarter != null ? '第' + d.quarter + '季度' : '--';
  document.getElementById('comp-tech-points').textContent = d.tech_points ? Number(d.tech_points).toFixed(1) : '0';
  // Show allocation percentages
  var alloc = d.alloc_pcts || {};
  document.getElementById('comp-alloc-reserve').textContent = (alloc.reserve != null ? alloc.reserve : 25) + '%';
  document.getElementById('comp-alloc-sales').textContent = (alloc.sales != null ? alloc.sales : 25) + '%';
  document.getElementById('comp-alloc-dividend').textContent = (alloc.dividend != null ? alloc.dividend : 25) + '%';
  document.getElementById('comp-alloc-research').textContent = (alloc.research != null ? alloc.research : 25) + '%';
}

function toggleCompanyPanel() {
  var panel = document.getElementById('floating-company-panel');
  if (!panel) return;
  var isVisible = panel.classList.contains('visible');
  if (isVisible) {
    panel.classList.remove('visible');
  } else {
    panel.classList.add('visible');
    panel.style.display = '';
    panel.classList.remove('minimized');
    loadCompanyInfo();
  }
}

function minimizeCompanyPanel() {
  var panel = document.getElementById('floating-company-panel');
  if (panel) panel.classList.toggle('minimized');
}

function closeCompanyPanel() {
  var panel = document.getElementById('floating-company-panel');
  if (panel) {
    panel.classList.remove('visible');
    panel.style.display = 'none';
  }
}

// ============================================================
// 公司排行面板
// ============================================================
async function loadComprankData() {
  try {
    var data = await apiGet('/api/company/ranking');
    renderComprank(data || []);
  } catch (e) {
    console.error('loadComprank error', e);
  }
}

function renderComprank(data) {
  var el = document.getElementById('comprank-table');
  if (!el) return;
  if (!data || data.length === 0) {
    el.innerHTML = '<div style="text-align:center;padding:30px 10px;color:var(--text-muted);font-size:13px;">暂无公司排行</div>';
    return;
  }
  var html = '<div class="cr-header">' +
    '<span class="cr-r">#</span>' +
    '<span class="cr-n">公司</span>' +
    '<span class="cr-i">行业</span>' +
    '<span class="cr-m">市值</span>' +
    '<span class="cr-rv">营收</span>' +
    '<span class="cr-p">利润</span>' +
    '<span class="cr-d">股息率</span>' +
  '</div>';
  data.forEach(function(r) {
    var revStr = r.market_cap >= 100000000 ? (r.market_cap / 100000000).toFixed(2) + '亿' : Math.floor(r.market_cap / 10000) + '万';
    var revStr = r.revenue >= 100000000 ? (r.revenue / 100000000).toFixed(2) + '亿' : (r.revenue >= 10000 ? Math.floor(r.revenue / 10000) + '万' : (r.revenue || 0));
    var profitStr = r.profit >= 100000000 ? (r.profit / 100000000).toFixed(2) + '亿' : (r.profit >= 10000 ? Math.floor(r.profit / 10000) + '万' : (r.profit || 0));
    profitStr = '<span class="' + (r.profit >= 0 ? 'cr-up' : 'cr-down') + '">' + profitStr + '</span>';
    var divStr = r.dividend_yield > 0 ? r.dividend_yield + '%' : '<span style="color:var(--text-muted);">--</span>';
    html += '<div class="cr-row">' +
      '<span class="cr-r' + (r.rank <= 3 ? ' top' + r.rank : '') + '">' + r.rank + '</span>' +
      '<span class="cr-n"><span class="cr-sym">' + r.symbol + '</span><span class="cr-name-text">' + r.name + '</span></span>' +
      '<span class="cr-i">' + (r.industry_name || '--') + '</span>' +
      '<span class="cr-m">' + revStr + '</span>' +
      '<span class="cr-rv">' + revStr + '</span>' +
      '<span class="cr-p">' + profitStr + '</span>' +
      '<span class="cr-d">' + divStr + '</span>' +
    '</div>';
  });
  el.innerHTML = html;
}

function toggleComprankPanel() {
  var panel = document.getElementById('floating-comprank-panel');
  if (!panel) return;
  var isVisible = panel.classList.contains('visible');
  if (isVisible) {
    panel.classList.remove('visible');
  } else {
    panel.classList.add('visible');
    panel.style.display = '';
    panel.classList.remove('minimized');
    loadComprankData();
  }
}

function minimizeComprankPanel() {
  var panel = document.getElementById('floating-comprank-panel');
  if (panel) panel.classList.toggle('minimized');
}

function closeComprankPanel() {
  var panel = document.getElementById('floating-comprank-panel');
  if (panel) {
    panel.classList.remove('visible');
    panel.style.display = 'none';
  }
}

function refreshComprank() {
  loadComprankData();
}


// ============================================================
// 行业市场面板
// ============================================================
function toggleIndustryPanel() {
  var panel = document.getElementById('floating-industry-panel');
  if (!panel) return;
  var isVisible = panel.classList.contains('visible');
  if (isVisible) {
    panel.classList.remove('visible');
  } else {
    document.querySelectorAll('.ftp').forEach(function(p) { p.classList.remove('visible'); });
    panel.classList.add('visible');
    panel.style.display = '';
    loadIndustryMarket();
  }
}

function minimizeIndustryPanel() {
  var panel = document.getElementById('floating-industry-panel');
  if (panel) panel.classList.toggle('minimized');
}

function closeIndustryPanel() {
  var panel = document.getElementById('floating-industry-panel');
  if (panel) { panel.classList.remove('visible'); panel.style.display = 'none'; }
}

function refreshIndustryPanel() {
  loadIndustryMarket();
}

async function loadIndustryMarket() {
  var el = document.getElementById('industry-market-content');
  if (!el) return;
  el.innerHTML = '<div style="text-align:center;padding:30px;color:#8899a6">加载中...</div>';
  try {
    var data = await apiGet('/api/market/industry');
    if (!data || data.length === 0) {
      el.innerHTML = '<div style="text-align:center;padding:30px;color:#8899a6">暂无行业数据</div>';
      return;
    }
    var html = '';
    data.forEach(function(ind) {
      var cycleCls = ind.cycle === 'boom' ? 'color:#22c55e' : (ind.cycle === 'recession' ? 'color:#ef4444' : 'color:#fbbf24');
      var cycleName = ind.cycle === 'boom' ? '繁荣' : (ind.cycle === 'recession' ? '衰退' : '正常');
      var totalRevStr = ind.total_revenue >= 100000000 ? (ind.total_revenue / 100000000).toFixed(2) + '亿' : (ind.total_revenue >= 10000 ? (ind.total_revenue / 10000).toFixed(2) + '万' : '¥' + (ind.total_revenue || 0));

      html += '<div style="background:#1a2a35;border:1px solid #2a4050;border-radius:6px;margin-bottom:8px;padding:8px;">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;padding-bottom:4px;border-bottom:1px solid #2a4050;">' +
        '<span style="font-weight:700;font-size:13px;color:#c0d0d8;">' + (ind.industry_name || '--') + '</span>' +
        '<span style="font-size:11px;padding:1px 6px;border-radius:8px;background:#1a3a2a;' + cycleCls + '">' + cycleName + '</span>' +
        '<span style="font-size:11px;color:#8899a6;">营收合计: ' + totalRevStr + '</span>' +
        '</div>';

      if (ind.companies && ind.companies.length > 0) {
        ind.companies.forEach(function(c) {
          var revStr = c.revenue >= 100000000 ? (c.market_cap / 100000000).toFixed(2) + '亿' : (c.market_cap >= 10000 ? (c.market_cap / 10000).toFixed(2) + '万' : '¥' + (c.market_cap || 0));
          var shareWidth = Math.min(100, Math.max(2, c.market_share || 0));
          var shareColor = c.market_share >= 50 ? '#22c55e' : (c.market_share >= 20 ? '#3b82f6' : '#8899a6');
          html += '<div style="display:flex;align-items:center;padding:4px 0;font-size:11px;cursor:pointer;" onclick="selectStock(\'' + c.symbol + '\');closeIndustryPanel();">' +
            '<span style="width:70px;color:#c0d0d8;font-weight:600;">' + c.symbol + '</span>' +
            '<span style="flex:1;color:#8899a6;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + (c.name || '') + '</span>' +
            '<div style="width:80px;height:6px;background:#253545;border-radius:3px;margin:0 8px;overflow:hidden;">' +
            '<div style="height:100%;width:' + shareWidth + '%;background:' + shareColor + ';border-radius:3px;"></div></div>' +
            '<span style="width:50px;text-align:right;color:' + shareColor + ';font-weight:600;">' + (c.market_share || 0) + '%</span>' +
            '<span style="width:80px;text-align:right;color:#c0d0d8;margin-left:4px;">' + revStr + '</span>' +
            '</div>';
        });
      } else {
        html += '<div style="text-align:center;padding:8px;color:#556677;font-size:11px;">暂无公司入驻</div>';
      }
      html += '</div>';
    });
    el.innerHTML = html;
  } catch (e) {
    el.innerHTML = '<div style="text-align:center;padding:30px;color:#ef4444">加载失败: ' + (e.message || '') + '</div>';
  }
}

// ============================================================
// 季度决策相关
// ============================================================
var currentDecisions = null;

function showDecisionModal(data) {
  var modal = document.getElementById('decision-modal');
  if (!modal) return;
  currentDecisions = data;
  document.getElementById('decision-quarter').textContent = '第 ' + (data.quarter || '?') + ' 季度经营决策';

  var body = document.getElementById('decision-body');
  body.innerHTML = '';

  if (!data.options || data.options.length === 0) {
    body.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-muted);">暂无待处理决策</div>';
    modal.style.display = 'flex';
    return;
  }

  data.options.forEach(function(d, idx) {
    var div = document.createElement('div');
    div.className = 'decision-item';
    div.innerHTML = '<div class="decision-title">' + (d.title || d.type || '决策') + '</div>' +
      '<div style="font-size:12px;color:var(--text-muted);margin-bottom:12px;">' + (d.desc || '') + '</div>';

    var fields = d.fields || [];
    var alloc = d.allocation_default || {reserve: 25, sales: 25, dividend: 25, research: 25};
    var currentValues = {};
    var sliders = {};
    var valueDisplays = {};

    fields.forEach(function(f) {
      currentValues[f.key] = alloc[f.key] || 0;

      var row = document.createElement('div');
      row.className = 'alloc-row';
      row.innerHTML = '<div class="alloc-header">' +
        '<span class="alloc-label">' + f.label + '</span>' +
        '<span class="alloc-desc">' + (f.desc || '') + '</span>' +
        '</div>' +
        '<div class="alloc-control">' +
        '<input type="range" class="alloc-slider" id="slider-' + f.key + '" min="0" max="100" value="' + currentValues[f.key] + '">' +
        '<span class="alloc-value" id="val-' + f.key + '">' + currentValues[f.key] + '%</span>' +
        '</div>';
      div.appendChild(row);

      sliders[f.key] = row.querySelector('.alloc-slider');
      valueDisplays[f.key] = row.querySelector('.alloc-value');

      sliders[f.key].addEventListener('input', (function(key) {
        return function() {
          updateAllocation(key, parseInt(this.value) || 0);
        };
      })(f.key));
    });

    function updateAllocation(changedKey, newVal) {
      newVal = Math.max(0, Math.min(100, newVal));
      var keys = Object.keys(currentValues);
      var otherKeys = keys.filter(function(k) { return k !== changedKey; });
      var currentTotal = 0;
      otherKeys.forEach(function(k) { currentTotal += currentValues[k]; });
      var remaining = 100 - newVal;

      if (remaining < 0) {
        newVal = 100;
        remaining = 0;
        otherKeys.forEach(function(k) { currentValues[k] = 0; });
      } else if (currentTotal > 0) {
        var ratio = remaining / currentTotal;
        var allocated = 0;
        otherKeys.forEach(function(k, i) {
          var v = Math.round(currentValues[k] * ratio);
          if (i === otherKeys.length - 1) {
            v = remaining - allocated;
          } else {
            allocated += v;
          }
          currentValues[k] = Math.max(0, Math.min(100, v));
        });
      } else {
        var equalShare = Math.floor(remaining / otherKeys.length);
        otherKeys.forEach(function(k) {
          currentValues[k] = equalShare;
        });
        var sum = newVal;
        otherKeys.forEach(function(k) { sum += currentValues[k]; });
        if (sum < 100) currentValues[otherKeys[otherKeys.length - 1]] += 100 - sum;
      }

      currentValues[changedKey] = newVal;

      keys.forEach(function(k) {
        sliders[k].value = currentValues[k];
        valueDisplays[k].textContent = currentValues[k] + '%';
      });

      var total = 0;
      keys.forEach(function(k) { total += currentValues[k]; });
      var td = document.getElementById('alloc-total');
      if (td) {
        td.textContent = '合计: ' + total + '%';
        td.style.color = (total !== 100) ? '#ef4444' : 'var(--text-muted)';
      }
    }

    var submitRow = document.createElement('div');
    submitRow.style.cssText = 'text-align:center;margin-top:16px;';
    var submitBtn = document.createElement('button');
    submitBtn.className = 'btn btn-primary';
    submitBtn.textContent = '确认分配';
    submitBtn.onclick = function() {
      var allocData = {};
      Object.keys(currentValues).forEach(function(k) {
        allocData[k] = currentValues[k];
      });
      submitDecision(d.type, JSON.stringify(allocData));
    };
    submitRow.appendChild(submitBtn);
    div.appendChild(submitRow);

    var totalDisplay = document.createElement('div');
    totalDisplay.style.cssText = 'text-align:center;font-size:12px;margin-top:8px;color:var(--text-muted);';
    totalDisplay.id = 'alloc-total';
    totalDisplay.textContent = '合计: 100%';
    div.appendChild(totalDisplay);

    body.appendChild(div);
  });

  modal.style.display = 'flex';
}

function showCashActionModal() {
  var modal = document.getElementById('cash-action-modal');
  if (!modal) return;
  var body = document.getElementById('cash-action-body');
  var grid = document.getElementById('cash-action-grid');
  var detail = document.getElementById('cash-action-detail');
  grid.innerHTML = '';
  detail.style.display = 'none';
  detail.innerHTML = '';

  // Show company cash balance
  var company = gameState.myCompany || {};
  document.getElementById('cash-action-balance').textContent = formatAmountCN(company.cash != null ? company.cash : 0);

  var actions = [
    {type: 'stock_buyback', icon: '🔄', name: '股票回购', min_cost: 50000, desc: '从市场回购股票，提振股价', effect: '直接提升公司估值'},
    {type: 'special_dividend', icon: '💰', name: '特别分红', min_cost: 20000, desc: '向所有股东派发现金分红', effect: '股东按持股比例获得现金'},
    {type: 'hiring', icon: '👥', name: '扩产招人', min_cost: 10000, desc: '招聘新员工提升产能', effect: '永久提升每季度营收'},
    {type: 'layoff', icon: '🚪', name: '裁员', min_cost: 0, desc: '裁减员工降低成本', effect: '减少工资支出，但降低产能'},
    {type: 'capital_inject', icon: '💵', name: '注资', min_cost: 10000, desc: '用自己的现金向公司注资', effect: '增加公司现金储备'},
    {type: 'marketing', icon: '📢', name: '市场突袭', min_cost: 30000, desc: '大规模营销推广', effect: '下季度营收大幅增长'},
    {type: 'media_pr', icon: '📰', name: '媒体公关', min_cost: 50000, desc: '提升公司品牌形象', effect: '短期拉高PE估值倍数'},
    {type: 'acquisition', icon: '🤝', name: '跨业并购', min_cost: 200000, desc: '收购小型企业', effect: '直接增加总资产和员工'},
    {type: 'pivot', icon: '🔄', name: '行业转型', min_cost: 500000, desc: '更换公司行业赛道', effect: '重置行业周期'},
  ];

  actions.forEach(function(a) {
    var card = document.createElement('div');
    card.className = 'cash-action-card';
    card.innerHTML = '<div class="cash-card-icon">' + a.icon + '</div>' +
      '<div class="cash-card-name">' + a.name + '</div>' +
      '<div class="cash-card-desc">' + a.desc + '</div>' +
      '<div class="cash-card-cost">最低 ¥' + Number(a.min_cost).toLocaleString() + '</div>';
    card.onclick = function() { selectCashAction(a.type, a.name, a.min_cost); };
    grid.appendChild(card);
  });

  modal.style.display = 'flex';
}

function hideCashActionModal() {
  var modal = document.getElementById('cash-action-modal');
  if (modal) modal.style.display = 'none';
}

var selectedActionType = null;
var selectedActionName = '';
var selectedMinCost = 0;

// ============================================================
// 股东列表
// ============================================================
function showShareholders() {
  var modal = document.getElementById('quarterly-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'quarterly-modal';
    modal.className = 'modal-overlay';
    modal.style.display = 'flex';
    modal.innerHTML = '<div class="modal-box" style="width:500px;max-height:80vh;display:flex;flex-direction:column">' +
      '<div class="modal-title">📋 股东列表</div>' +
      '<div id="quarterly-content" style="flex:1;overflow-y:auto;padding:8px 0"></div>' +
      '<div class="modal-actions"><button class="modal-btn" onclick="hideQuarterlyHistory()">关闭</button></div>' +
    '</div>';
    document.body.appendChild(modal);
  }
  modal.style.display = 'flex';
  var el = document.getElementById('quarterly-content');
  if (!el) return;
  el.innerHTML = '<div style="text-align:center;padding:40px;color:#8899a6">加载中...</div>';

  apiGet('/api/company/shareholders').then(function(data) {
    var html = '<div style="font-size:12px;color:var(--text-muted);margin-bottom:8px;">股票代码: <b style="color:#c0d0d8;">' + data.symbol + '</b> | 流通股: <b style="color:#c0d0d8;">' + (data.shares_outstanding || 0).toLocaleString() + '</b> | 已流通: <b style="color:#22c55e;">' + data.circulation_pct + '%</b></div>';
    if (!data.shareholders || data.shareholders.length === 0) {
      html += '<div style="text-align:center;padding:30px;color:#8899a6;">暂无股东</div>';
    } else {
      html += '<table style="width:100%;border-collapse:collapse;font-size:12px">' +
        '<thead><tr style="background:#1a2a35;color:#8899a6">' +
        '<th style="padding:6px;text-align:left;border-bottom:1px solid #2a4050;">排名</th>' +
        '<th style="padding:6px;text-align:left;border-bottom:1px solid #2a4050;">股东</th>' +
        '<th style="padding:6px;text-align:right;border-bottom:1px solid #2a4050;">持股</th>' +
        '<th style="padding:6px;text-align:right;border-bottom:1px solid #2a4050;">占比</th>' +
        '</tr></thead><tbody>';
      data.shareholders.forEach(function(sh, idx) {
        html += '<tr style="border-bottom:1px solid #1a2a35;">' +
          '<td style="padding:4px 6px;color:#8899a6;">' + (idx + 1) + '</td>' +
          '<td style="padding:4px 6px;color:#c0d0d8;">' + escapeHtml(sh.nickname || sh.player_id) + '</td>' +
          '<td style="padding:4px 6px;text-align:right;color:#c0d0d8;">' + sh.qty.toLocaleString() + '</td>' +
          '<td style="padding:4px 6px;text-align:right;color:#fbbf24;">' + sh.pct + '%</td>' +
          '</tr>';
      });
      html += '</tbody></table>';
    }
    el.innerHTML = html;
  }).catch(function(e) {
    el.innerHTML = '<div style="text-align:center;padding:30px;color:#ef4444">加载失败: ' + (e.message || '') + '</div>';
  });
}

// ============================================================
// 季度财报历史
// ============================================================
function showQuarterlyHistory() {
  var modal = document.getElementById('quarterly-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'quarterly-modal';
    modal.className = 'modal-overlay';
    modal.style.display = 'flex';
    modal.innerHTML = '<div class="modal-box" style="width:700px;max-height:80vh;display:flex;flex-direction:column">' +
      '<div class="modal-title">季度财报历史</div>' +
      '<div id="quarterly-content" style="flex:1;overflow-y:auto;padding:8px 0"></div>' +
      '<div class="modal-actions"><button class="modal-btn" onclick="hideQuarterlyHistory()">关闭</button></div>' +
    '</div>';
    document.body.appendChild(modal);
  }
  modal.style.display = 'flex';
  loadQuarterlyHistory();
}

function hideQuarterlyHistory() {
  var modal = document.getElementById('quarterly-modal');
  if (modal) modal.style.display = 'none';
}

async function loadQuarterlyHistory() {
  var el = document.getElementById('quarterly-content');
  if (!el) return;
  el.innerHTML = '<div style="text-align:center;padding:40px;color:#8899a6">加载中...</div>';
  try {
    var records = await apiGet('/api/company/financials');
    if (!records || records.length === 0) {
      el.innerHTML = '<div class="fin-empty">暂无季度数据</div>';
      return;
    }
    var html = '<div style="font-size:12px;color:var(--text-muted);margin-bottom:8px;">共 ' + records.length + ' 个季度（点击展开）</div>';
    records.forEach(function(r, idx) {
      var margin = r.revenue > 0 ? (r.profit / r.revenue * 100).toFixed(1) + '%' : '--';
      var profitCls = r.profit >= 0 ? '#22c55e' : '#ef4444';
      var cycleCls = r.industry_cycle === 'boom' ? '#22c55e' : (r.industry_cycle === 'recession' ? '#ef4444' : '#fbbf24');
      var cycleName = r.industry_cycle === 'boom' ? '繁荣' : (r.industry_cycle === 'recession' ? '衰退' : '正常');
      var revGrowthStr = r.revenue_growth > 0 ? ('<span style=\"color:#22c55e\">↑' + r.revenue_growth + '%</span>') : (r.revenue_growth < 0 ? '<span style=\"color:#ef4444\">↓' + Math.abs(r.revenue_growth) + '%</span>' : '<span style=\"color:#8899a6\">--</span>');
      var profitGrowthStr = r.profit_growth > 0 ? ('<span style=\"color:#22c55e\">↑' + r.profit_growth + '%</span>') : (r.profit_growth < 0 ? '<span style=\"color:#ef4444\">↓' + Math.abs(r.profit_growth) + '%</span>' : '<span style=\"color:#8899a6\">--</span>');

      var detailId = 'qdetail-' + idx;
      // Accordion: click header to toggle details
      html += '<div style="background:#1a2a35;border:1px solid #2a4050;border-radius:6px;margin-bottom:6px;overflow:hidden;">' +
        '<div onclick="var d=document.getElementById(\'' + detailId + '\');d.style.display=d.style.display==\'none\'?\'\':\'none\';this.querySelector(\'.q-arrow\').textContent=d.style.display==\'none\'?\'▶\':\'▼\'" style="display:flex;justify-content:space-between;align-items:center;padding:8px 10px;cursor:pointer;user-select:none;transition:background 0.15s;" onmouseover="this.style.background=\'#1e2a3d\'" onmouseout="this.style.background=\'transparent\'">' +
        '<div style="display:flex;align-items:center;gap:8px;">' +
        '<span class="q-arrow" style="font-size:10px;color:#8899a6;">▶</span>' +
        '<span style="font-weight:700;font-size:13px;color:#c0d0d8;">' + (r.period || 'Q' + r.quarter) + '</span>' +
        '<span style="font-size:11px;padding:1px 6px;border-radius:8px;background:#1a3a2a;color:' + cycleCls + '">' + cycleName + '</span>' +
        '</div>' +
        '<div style="display:flex;gap:12px;font-size:11px;color:#8899a6;">' +
        '<span>营收 <b style="color:#c0d0d8;">' + fmt(r.revenue) + '</b></span>' +
        '<span>利润 <b style="color:' + profitCls + ';">' + fmt(r.profit) + '</b></span>' +
        '<span>利润率 <b style="color:#c0d0d8;">' + margin + '</b></span>' +
        '</div>' +
        '</div>' +
        '<div id="' + detailId + '" style="display:none;padding:8px 10px;border-top:1px solid #2a4050;font-size:12px;">' +

        // Revenue breakdown
        '<div style="margin-bottom:6px;padding:4px 0;border-bottom:1px solid #253545;">' +
        '<div style="color:#8899a6;margin-bottom:3px;">📈 营收构成</div>' +
        '<div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:2px;">' +
        '<span>基础营收</span><span style="color:#c0d0d8;">' + fmt(r.base_revenue) + '</span>' +
        '<span>行业系数</span><span style="color:#c0d0d8;">' + (r.cycle_mult || 1).toFixed(2) + 'x</span>' +
        '<span>市场环境</span><span style="color:' + ((r.market_condition || 0) >= 0 ? '#22c55e' : '#ef4444') + ';">' + ((r.market_condition || 0) >= 0 ? '+' : '') + ((r.market_condition || 0) * 100).toFixed(1) + '%</span>' +
        '</div>' +
        '<div style="display:flex;justify-content:space-between;font-size:11px;">' +
        '<span>利息收入</span><span style="color:#22c55e;">' + fmt(r.interest_income) + '</span>' +
        '<span>营收增长</span>' + revGrowthStr +
        '<span>利润增长</span>' + profitGrowthStr +
        '</div></div>' +

        // Cost breakdown
        '<div style="margin-bottom:6px;padding:4px 0;border-bottom:1px solid #253545;">' +
        '<div style="color:#8899a6;margin-bottom:3px;">📉 成本支出</div>' +
        '<div style="display:flex;justify-content:space-between;font-size:11px;">' +
        '<span>员工薪资 <b style="color:#c0d0d8;">' + fmt(r.salary_cost) + '</b></span>' +
        '<span>研发投入 <b style="color:#c0d0d8;">' + fmt(r.rd_spend) + '</b></span>' +
        '<span>固定成本 <b style="color:#c0d0d8;">' + fmt(r.fixed_cost) + '</b></span>' +
        '<span>股东分红 <b style="color:#c0d0d8;">' + fmt(r.dividend_paid) + '</b></span>' +
        '</div>' +
        '<div style="font-size:11px;margin-top:4px;color:#8899a6;">总成本 <b style="color:#c0d0d8;">' + fmt(r.salary_cost + r.rd_spend + r.fixed_cost) + '</b> = 营收 ' + fmt(r.revenue) + ' - 利润 ' + fmt(r.profit) + (r.interest_income > 0 ? ' + 利息 ' + fmt(r.interest_income) : '') + '</div>' +
        '</div>' +

        // Per-share metrics
        '<div style="margin-bottom:6px;padding:4px 0;border-bottom:1px solid #253545;">' +
        '<div style="color:#8899a6;margin-bottom:3px;">每股指标</div>' +
        '<div style="display:flex;justify-content:space-between;font-size:11px;">' +
        '<span>EPS <b style="color:#c0d0d8;">' + (r.eps || 0).toFixed(2) + '</b></span>' +
        '<span>NAV <b style="color:#c0d0d8;">' + (r.nav || 0).toFixed(2) + '</b></span>' +
        '<span>PE <b style="color:#c0d0d8;">' + (r.pe || '--') + '</b></span>' +
        '<span>PB <b style="color:#c0d0d8;">' + (r.pb || '--') + '</b></span>' +
        '</div></div>' +

        // Status
        '<div style="display:flex;justify-content:space-between;font-size:11px;">' +
        '<span>员工 <b style="color:#c0d0d8;">' + (r.employees || 0) + '人</b></span>' +
        '<span>现金 <b style="color:#c0d0d8;">' + fmt(r.cash) + '</b></span>' +
        '<span>资产 <b style="color:#c0d0d8;">' + fmt(r.assets) + '</b></span>' +
        '<span>股价 <b style="color:#c0d0d8;">¥' + (r.share_price || 0).toFixed(2) + '</b></span>' +
        '</div>' +

        '</div></div>';
    });
    el.innerHTML = html;
  } catch (e) {
    el.innerHTML = '<div class="fin-empty">加载失败: ' + (e.message || '') + '</div>';
  }
}

function fmt(n) {
  if (n == null || isNaN(n)) return '--';
  if (Math.abs(n) >= 10000) return '¥' + Number(n).toLocaleString(undefined, {maximumFractionDigits:2});
  return '¥' + Number(n).toFixed(2);
}

function showCompanyAnnounceModal() {
  var modal = document.getElementById('announce-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'announce-modal';
    modal.className = 'modal-overlay';
    modal.style.display = 'flex';
    modal.innerHTML = '<div class="modal-box" style="width:420px">' +
      '<div class="modal-title">公司公告</div>' +
      '<div style="margin:12px 0"><input id="announce-title" class="modal-input" placeholder="公告标题" maxlength="50" style="width:100%;padding:8px;background:#1a2a35;border:1px solid #2a4050;color:#c0d0d8;border-radius:4px"></div>' +
      '<div style="margin:12px 0"><textarea id="announce-content" class="modal-input" placeholder="公告内容（限200字）" maxlength="200" rows="4" style="width:100%;padding:8px;background:#1a2a35;border:1px solid #2a4050;color:#c0d0d8;border-radius:4px;resize:none"></textarea></div>' +
      '<div id="announce-msg" style="color:#ef4444;font-size:12px;min-height:18px"></div>' +
      '<div class="modal-actions">' +
        '<button class="modal-btn" onclick="hideCompanyAnnounceModal()">取消</button>' +
        '<button class="modal-btn modal-btn-primary" onclick="submitCompanyAnnounce()">发布</button>' +
      '</div>' +
    '</div>';
    document.body.appendChild(modal);
  }
  modal.style.display = 'flex';
  var te = document.getElementById('announce-title');
  if (te) te.value = '';
  var ce = document.getElementById('announce-content');
  if (ce) ce.value = '';
  var me = document.getElementById('announce-msg');
  if (me) me.textContent = '';
}

function hideCompanyAnnounceModal() {
  var modal = document.getElementById('announce-modal');
  if (modal) modal.style.display = 'none';
}

async function submitCompanyAnnounce() {
  var title = document.getElementById('announce-title').value.trim();
  var content = document.getElementById('announce-content').value.trim();
  var msgEl = document.getElementById('announce-msg');
  if (!title) { msgEl.textContent = '请输入标题'; return; }
  if (!content) { msgEl.textContent = '请输入内容'; return; }
  try {
    var result = await apiPost('/api/company/announce', { title: title, content: content });
    hideCompanyAnnounceModal();
    showToast('公告已发布', 'success');
  } catch (e) {
    msgEl.textContent = e.message || '发布失败';
  }
}

function selectCashAction(type, name, minCost) {
  selectedActionType = type;
  selectedActionName = name;
  selectedMinCost = minCost;

  var detail = document.getElementById('cash-action-detail');
  var company = gameState.myCompany || {};
  var cash = company.cash || 0;

  if (type === 'hiring') {
    detail.innerHTML = '<div class="cash-detail-box">' +
      '<div class="cash-detail-title">' + name + '</div>' +
      '<div style="font-size:12px;color:var(--text-muted);margin-bottom:12px;">每 ¥10,000 招聘1名员工（自动取整）</div>' +
      '<div class="cash-input-group">' +
      '<label>投入金额（¥）</label>' +
      '<input type="number" id="cash-amount-input" class="cash-input" min="' + minCost + '" step="10000" value="' + minCost + '" placeholder="最少' + minCost + '">' +
      '</div>' +
      '<div style="font-size:11px;color:var(--text-muted);margin-top:4px;">预计招聘 <span id="hiring-preview">0</span> 人</div>' +
      '<button class="btn btn-primary" onclick="executeCashAction()" style="margin-top:12px;width:100%;">确认执行</button>' +
      '</div>';
    // Update hiring preview on input
    setTimeout(function() {
      var input = document.getElementById('cash-amount-input');
      if (input) {
        input.addEventListener('input', function() {
          var preview = document.getElementById('hiring-preview');
          if (preview) preview.textContent = Math.floor(parseInt(this.value) / 10000) || 0;
        });
        input.dispatchEvent(new Event('input'));
      }
    }, 50);
  } else if (type === 'pivot') {
    var currentInd = (gameState.myCompany && gameState.myCompany.industry) || 'tech';
    var industries = [
      {id:'tech', name:'科技', icon:'💻', desc:'高增长、高波动'},
      {id:'finance', name:'金融', icon:'🏦', desc:'稳定增长、低波动'},
      {id:'manufacturing', name:'制造业', icon:'🏭', desc:'稳定收益、周期性强'},
      {id:'energy', name:'能源', icon:'⚡', desc:'强周期性、政策敏感'},
      {id:'consumer', name:'消费', icon:'🛒', desc:'防御性、稳定现金流'},
      {id:'healthcare', name:'医药', icon:'💊', desc:'防御性、高利润'},
    ];
    var opts = industries.filter(function(i) { return i.id !== currentInd; }).map(function(i) {
      return '<div class="industry-card" onclick="selectPivotTarget(\'' + i.id + '\')" data-ind="' + i.id + '" style="cursor:pointer;display:inline-block;padding:6px 12px;margin:4px;background:var(--bg-card);border:2px solid var(--border-color);border-radius:6px;text-align:center;">' +
        '<div style="font-size:18px;">' + i.icon + '</div>' +
        '<div style="font-size:12px;font-weight:600;">' + i.name + '</div>' +
        '<div style="font-size:10px;color:var(--text-muted);">' + i.desc + '</div></div>';
    }).join('');
    detail.innerHTML = '<div class="cash-detail-box">' +
      '<div class="cash-detail-title">⚠️ ' + name + '</div>' +
      '<div style="font-size:12px;color:var(--text-muted);margin-bottom:8px;">消耗 ¥500,000 更换行业赛道，选择目标行业：</div>' +
      '<div style="margin-bottom:12px;">' + opts + '</div>' +
      '<div id="pivot-selection" style="font-size:12px;color:var(--accent-red);margin-bottom:8px;"></div>' +
      '<button class="btn btn-primary" onclick="executeCashAction()" style="width:100%;">确认转型（¥500,000）</button>' +
      '</div>';
    selectedActionType = 'pivot';
    selectedActionName = name;
    selectedMinCost = 500000;
    window._pivotTarget = null;
  } else if (type === 'layoff') {
    var _company = gameState.myCompany || {};
    var _emp = _company.employees || 0;
    detail.innerHTML = '<div class="cash-detail-box">' +
      '<div class="cash-detail-title">🚪 ' + name + '</div>' +
      '<div style="font-size:12px;color:var(--text-muted);margin-bottom:8px;">当前员工: <b style="color:#ef4444;">' + _emp + '</b> 人</div>' +
      '<div class="cash-input-group">' +
      '<label>裁减人数</label>' +
      '<input type="number" id="layoff-qty-input" class="cash-input" min="1" max="' + Math.max(0, _emp - 1) + '" value="' + Math.min(5, Math.max(1, Math.floor(_emp / 2))) + '">' +
      '</div>' +
      '<div style="font-size:11px;color:var(--text-muted);margin-top:4px;">每裁1人节省 ¥<span id="layoff-saving">0</span>/季度</div>' +
      '<button class="btn btn-primary" onclick="executeCashAction()" style="margin-top:12px;width:100%;background:#ef4444;">确认裁员</button>' +
      '</div>';
    selectedActionType = 'layoff';
    selectedActionName = name;
    selectedMinCost = 0;
    setTimeout(function() {
      var _inp = document.getElementById('layoff-qty-input');
      if (_inp) {
        _inp.addEventListener('input', function() {
          var _q = parseInt(this.value) || 0;
          document.getElementById('layoff-saving').textContent = (_q * 800).toLocaleString();
        });
        _inp.dispatchEvent(new Event('input'));
      }
    }, 50);
  } else {
    detail.innerHTML = '<div class="cash-detail-box">' +
      '<div class="cash-detail-title">' + name + '</div>' +
      '<div style="font-size:12px;color:var(--text-muted);margin-bottom:12px;">最低消费 ¥' + Number(minCost).toLocaleString() + '</div>' +
      '<div class="cash-input-group">' +
      '<label>投入金额（¥）</label>' +
      '<input type="number" id="cash-amount-input" class="cash-input" min="' + minCost + '" value="' + minCost + '" placeholder="最少' + minCost + '">' +
      '</div>' +
      '<button class="btn btn-primary" onclick="executeCashAction()" style="margin-top:12px;width:100%;">确认执行</button>' +
      '</div>';
  }

  detail.style.display = 'block';
  detail.scrollIntoView({behavior: 'smooth', block: 'nearest'});
}

function selectPivotTarget(ind) {
  window._pivotTarget = ind;
  document.querySelectorAll('#cash-action-detail .industry-card').forEach(function(el) {
    el.style.borderColor = el.getAttribute('data-ind') === ind ? '#3b82f6' : 'var(--border-color)';
  });
  document.getElementById('pivot-selection').textContent = '已选择: ' + (document.querySelector('#cash-action-detail .industry-card[data-ind="' + ind + '"] .industry-name') || {}).textContent || ind;
}

async function executeCashAction() {
  if (!selectedActionType) return;
  var amount = selectedMinCost;
  if (selectedActionType === 'layoff') {
    var layoffInput = document.getElementById('layoff-qty-input');
    if (layoffInput) amount = parseInt(layoffInput.value) || 1;
  } else if (selectedActionType !== 'pivot') {
    var input = document.getElementById('cash-amount-input');
    if (input) amount = parseInt(input.value) || selectedMinCost;
    if (amount < selectedMinCost) {
      showToast('最少需要 ¥' + Number(selectedMinCost).toLocaleString(), 'error');
      return;
    }
  }
  try {
    var body = { action_type: selectedActionType, amount: amount };
    if (selectedActionType === 'pivot') {
      if (!window._pivotTarget) {
        showToast('请选择目标行业', 'error'); return;
      }
      body.target_industry = window._pivotTarget;
    }
    var result = await apiPost('/api/company/cash-action', body);
    showToast(result.message || selectedActionName + '成功！', 'success');
    hideCashActionModal();
    loadCompanyInfo();
  } catch (e) {
    showToast('操作失败: ' + (e.message || '未知错误'), 'error');
  }
}

// Close cash action modal on overlay click
document.addEventListener('click', function(e) {
  var modal = document.getElementById('cash-action-modal');
  if (modal && modal.style.display === 'flex' && e.target === modal) {
    hideCashActionModal();
  }
});

function hideDecisionModal() {
  var modal = document.getElementById('decision-modal');
  if (modal) modal.style.display = 'none';
}

async function submitDecision(decisionType, choice) {
  try {
    await apiPost('/api/company/decisions', {
      decision_type: decisionType,
      choice: choice
    });
    showToast('利润分配已提交！', 'success');
    hideDecisionModal();
    currentDecisions = null;
  } catch (e) {
    showToast('提交失败: ' + (e.message || '未知错误'), 'error');
  }
}


