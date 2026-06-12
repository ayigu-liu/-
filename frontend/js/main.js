// ============================================================
// WebSocket message handler
// ============================================================
let prevPrices = {};

function handleWsMessage(msg) {
  switch (msg.type) {
    case 'price_update':
      gameState.stocks = msg.data.stocks || [];
      renderStockInfo();

      // Flash animation for price changes
      for (const s of gameState.stocks) {
        const prev = prevPrices[s.symbol];
        if (prev != null && prev !== s.price) {
          const flashClass = s.price > prev ? 'price-flash-up' : 'price-flash-down';
          ['stock-price-header', 'stock-price-big', 'stock-change', 'stock-change-pct'].forEach(id => {
            const el = document.getElementById(id);
            if (el) {
              el.classList.remove('price-flash-up', 'price-flash-down');
              void el.offsetWidth;
              el.classList.add(flashClass);
            }
          });
        }
        prevPrices[s.symbol] = s.price;
      }

      // Update K-line chart
      if (msg.data.candles_1t || msg.data.candles_4t || msg.data.candles_20t) {
        if (msg.data.candles_1t) gameState.candleData['1t'] = msg.data.candles_1t;
        if (msg.data.candles_4t) gameState.candleData['4t'] = msg.data.candles_4t;
        if (msg.data.candles_20t) gameState.candleData['20t'] = msg.data.candles_20t;
        const period = gameState.klinePeriod;
        const cd = gameState.candleData[period];
        var selSym = gameState.selectedStock || (gameState.stocks.length > 0 ? gameState.stocks[0].symbol : null);
        if (cd && selSym && cd[selSym]) {
          setKlineData(cd[selSym]);
        }
      }

      // Capture daily stats
      if (msg.data.daily_stats) {
        gameState.dailyStats = msg.data.daily_stats;
      }
      // 新指标（在 msg.data 顶层）
      if (msg.data.turnover_rate !== undefined) gameState.turnoverRate = msg.data.turnover_rate;
      if (msg.data.amplitude !== undefined) gameState.amplitude = msg.data.amplitude;
      if (msg.data.pe !== undefined) gameState.pe = msg.data.pe;
      if (msg.data.pb !== undefined) gameState.pb = msg.data.pb;
      if (msg.data.buy_volume !== undefined) gameState.buyVolume = msg.data.buy_volume;
      if (msg.data.sell_volume !== undefined) gameState.sellVolume = msg.data.sell_volume;
      if (msg.data.wei_bi !== undefined) gameState.weiBi = msg.data.wei_bi;
      if (msg.data.wei_cha !== undefined) gameState.weiCha = msg.data.wei_cha;
      if (msg.data.bid_volume !== undefined) gameState.bidVolume = msg.data.bid_volume;
      if (msg.data.ask_volume !== undefined) gameState.askVolume = msg.data.ask_volume;
      // 财务报告
      if (msg.data.financial_reports) {
        gameState.financialReports = msg.data.financial_reports;
      }
      // 日K线数据
      if (msg.data.candles_1d) {
        gameState.candleData['1d'] = msg.data.candles_1d;
        // 如果当前是日K/周K/月K模式，自动加载日K数据
        var curPeriod = gameState.klinePeriod;
        if (curPeriod === 'kline-1d' || curPeriod === 'kline-1w' || curPeriod === 'kline-1m') {
          var dailyCd = msg.data.candles_1d;
          var selSym = gameState.selectedStock || (gameState.stocks.length > 0 ? gameState.stocks[0].symbol : null);
          if (dailyCd && selSym && dailyCd[selSym] && dailyCd[selSym].length > 0) {
            if (typeof setDayKlineData === 'function') {
              setDayKlineData(dailyCd[selSym]);
            }
          }
        }
      }
      // Capture time-share data
      if (msg.data.timeshare) {
        gameState.timeshare = msg.data.timeshare;
        setTimeshareData(gameState.timeshare); // only redraws if in timeshare mode
      }
      // Capture trade tape
      if (msg.data.tape) {
        gameState.tape = msg.data.tape;
        if (typeof renderTradeTape === 'function') {
          renderTradeTape();
        }
      }
      break;

    case 'trade_executed':
      {
        const t = msg.data;
        const actionMap = { buy: '买入', sell: '卖出', short_sell: '融券卖出', cover: '买券还券' };
        const action = actionMap[t.trade_type] || t.trade_type;
        const feeText = t.total_fee > 0 ? `（佣金 ¥${(t.commission || 0).toFixed(2)}${(t.stamp_tax || 0) > 0 ? ` + 印花税 ¥${(t.stamp_tax || 0).toFixed(2)}` : ''}）` : '';
        const msgEl = t.trade_type === 'short_sell' || t.trade_type === 'cover'
          ? document.getElementById('short-msg')
          : document.getElementById('trade-msg');
        msgEl.innerHTML =
          `${action} ${t.quantity} 股，成交价 ¥${t.price.toFixed(2)}<br><span style="font-size:11px;color:var(--text-muted);">手续费 ¥${t.total_fee.toFixed(2)} ${feeText}</span>`;
        msgEl.className = 'trade-msg success';
      }
      break;

    case 'trade_rejected':
      {
        const rejEl = (msg.data.stock_symbol || '').includes('short') || msg.data.reason && (msg.data.reason.includes('融券') || msg.data.reason.includes('还券'))
          ? document.getElementById('short-msg') : document.getElementById('trade-msg');
        rejEl.textContent = msg.data.reason || '交易被拒绝';
        rejEl.className = 'trade-msg error';
      }
      break;

    case 'portfolio_update':
      updatePortfolio(msg.data);
      // Refresh online count now that WS is connected
      fetch(API_URL + '/api/market').then(function(r) { return r.json(); }).then(function(d) {
        gameState.playersOnline = d.players_online || 0;
        var pcEl = document.getElementById('player-count');
        if (pcEl) pcEl.textContent = '👤 ' + (d.players_online || 0);
      }).catch(function() {});
      break;

    case 'order_placed':
      showToast(`限价单已提交: DM ${msg.data.order_type === 'buy' ? '买入' : '卖出'} ${msg.data.quantity}股 @ ¥${msg.data.price.toFixed(2)}`, 'success');
      setTimeout(loadMyOrders, 500);
      break;

    case 'order_cancelled':
      if (msg.data && msg.data.cancelled_count) {
        showToast('已撤销 ' + msg.data.cancelled_count + ' 笔委托', 'success');
      } else {
        showToast('订单已取消', 'success');
      }
      setTimeout(loadMyOrders, 500);
      break;

    case 'leaderboard':
      gameState.leaderboard = msg.data.rankings || [];
      renderLeaderboard();
      break;

    case 'news':
      if (msg.data.news) {
        gameState.newsList.unshift(msg.data.news);
        if (gameState.newsList.length > 20) gameState.newsList = gameState.newsList.slice(0, 20);
        renderNews();
        showToast(`[${msg.data.news.title}] ${msg.data.news.content}`, msg.data.news.impact === '利好' ? 'success' : 'error');
      }
      break;

    case 'chat':
      break;

    case 'regulator_notice':
      {
        const d = msg.data;
        const toastType = d.level === 'fine' ? 'error' : 'warning';
        showToast('⚠️ AI证监会: ' + d.message, toastType);
        console.warn('SEC notice:', d.message);
      }
      break;

    case 'pong':
      if (msg.data && msg.data.t) {
        var lat = Date.now() - msg.data.t;
        var el = document.getElementById('ws-latency');
        if (el) el.textContent = lat + 'ms';
      }
      break;

    default:
      console.log('Unknown WS msg:', msg);
  }
}

function renderStockInfo() {
  var sym = gameState.selectedStock || (gameState.stocks.length > 0 ? gameState.stocks[0].symbol : "");
  const s = gameState.stocks.find(function(stk) { return stk.symbol === sym; }) || gameState.stocks[0];
  if (!s) return;
  document.getElementById('stock-price-header').textContent = '¥' + s.price.toFixed(2);
  document.getElementById('stock-price-big').textContent = '¥' + s.price.toFixed(2);
  document.getElementById('stock-change').textContent = (s.change >= 0 ? '+' : '') + s.change.toFixed(2);
  document.getElementById('stock-change-pct').textContent = formatPercent(s.change_pct);

  const ds = gameState.dailyStats || {};
  document.getElementById('stock-open').textContent = ds.open != null ? ds.open.toFixed(2) : '--';
  document.getElementById('stock-prev-close').textContent = ds.prev_close != null ? ds.prev_close.toFixed(2) : '--';
  document.getElementById('stock-high').textContent = ds.high != null ? ds.high.toFixed(2) : '--';
  document.getElementById('stock-low').textContent = ds.low != null ? ds.low.toFixed(2) : '--';
  document.getElementById('stock-volume').textContent = s.volume >= 10000 ? (s.volume/10000).toFixed(1) + '万' : s.volume;

  // 新指标
  document.getElementById('stock-turnover').textContent = gameState.turnoverRate != null ? gameState.turnoverRate.toFixed(2) + '%' : '--';
  document.getElementById('stock-amplitude').textContent = gameState.amplitude != null ? gameState.amplitude.toFixed(2) + '%' : '--';
  document.getElementById('stock-pe').textContent = gameState.pe != null ? gameState.pe.toFixed(2) : '--';
  document.getElementById('stock-pb').textContent = gameState.pb != null ? gameState.pb.toFixed(2) : '--';

  // Color (preserve existing classes, just add/remove price color)
  const pc = priceClass(s.change);
  ['stock-price-header', 'stock-price-big', 'stock-change', 'stock-change-pct'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.remove('price-up', 'price-down');
    if (pc) el.classList.add(pc);
  });
}

// K-line period switching
function switchKlinePeriod(period) {
  gameState.klinePeriod = period;
  document.querySelectorAll('.kline-period-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.period === period);
  });

  if (period === 'chart') {
    // Switch to time-share chart mode
    if (gameState.timeshare && gameState.timeshare.length > 0) {
      setTimeshareData(gameState.timeshare);
    }
    toggleChartMode('timeshare');
  } else if (period === 'kline-1d' || period === 'kline-1w' || period === 'kline-1m') {
    toggleChartMode('kline');
    // Load daily candle data if available
    var dailyCd = gameState.candleData['1d'];
    var selSym = gameState.selectedStock || (gameState.stocks.length > 0 ? gameState.stocks[0].symbol : null);
    if (dailyCd && selSym && dailyCd[selSym] && dailyCd[selSym].length > 0) {
      if (typeof setDayKlineData === 'function') {
        setDayKlineData(dailyCd[selSym]);
      }
    }
    // Switch display period (day/week/month)
    if (typeof switchDisplayPeriod === 'function') {
      switchDisplayPeriod(period);
    } else {
      drawKline();
    }
  } else {
    // Switch to K-line mode
    toggleChartMode('kline');
    if (typeof switchDisplayPeriod === 'function') {
      switchDisplayPeriod('kline'); // reset day/week/month mode
    }
    const kp = period.replace('kline-', '');
    const cd = gameState.candleData[kp];
    if (cd && selSym && cd[selSym]) {
      setKlineData(cd[selSym]);
    }
  }
}

// ============================================================
// Event bindings
// ============================================================
document.addEventListener('DOMContentLoaded', async () => {
  // 有保存的token时验证是否仍然有效
  if (isLoggedIn()) {
    try {
      const me = await apiGet('/api/auth/me');
      if (!me.ok) throw new Error('not logged in');
      authUserId = me.user_id;
      authUsername = me.username;
      authEmail = me.email;
      localStorage.setItem('auth_user_id', me.user_id);
      localStorage.setItem('auth_username', me.username);
      localStorage.setItem('auth_email', me.email);
      document.getElementById('game-user-email').textContent = me.email;
      showGamePage();
    } catch (e) {
      // Token expired or invalid
      authToken = null;
      localStorage.removeItem('auth_token');
      showAuth();
    }
  } else {
    // 预填保存的登录信息
    const savedEmail = localStorage.getItem('saved_email');
    const savedPassword = localStorage.getItem('saved_password');
    if (savedEmail) document.getElementById('login-email').value = savedEmail;
    if (savedPassword) document.getElementById('login-password').value = savedPassword;
    showAuth();
  }

  // 登录框回车提交
  document.getElementById('login-password').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleEmailLogin();
  });
  document.getElementById('login-email').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleEmailLogin();
  });

  document.getElementById('btn-buy').addEventListener('click', () => { updateTradeEstimate('buy'); handleTrade('buy'); });
  document.getElementById('btn-sell').addEventListener('click', () => { updateTradeEstimate('sell'); handleTrade('sell'); });
  document.getElementById('trade-qty').addEventListener('input', () => updateTradeEstimate());
  document.getElementById('trade-limit-price').addEventListener('input', () => updateTradeEstimate());
});
