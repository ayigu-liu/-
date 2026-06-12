// ============================================================
// K-line (Candlestick) Chart Renderer
// Chinese market convention: red = up (阳线), green = down (阴线)
// ============================================================

const KLINE = {
  UP_COLOR: '#ef4444',
  DOWN_COLOR: '#22c55e',
  GRID_COLOR: '#1a2c38',
  TEXT_COLOR: '#5a7a8a',
  CROSS_COLOR: '#8a9ba8',
  CANDLE_WIDTH_RATIO: 0.6,
  MAIN_HEIGHT_RATIO: 0.60,
  VOL_HEIGHT_RATIO: 0.15,
  INDICATOR_HEIGHT_RATIO: 0.25,
};

// ============================================================
// State
// ============================================================
let klineData = [];            // current tick/minute candles
let dailyData = [];            // daily candles
let weeklyData = [];           // weekly candles (aggregated from daily)
let monthlyData = [];          // monthly candles (aggregated from daily)
let crossX = null;             // crosshair X position (canvas coordinates)
let crossY = null;             // crosshair Y position (canvas coordinates)
let currentIndicator = 'MACD'; // MACD, KDJ, RSI, BOLL
let displayPeriod = 'kline-4t'; // which data source to display
let showTimeshare = false;
let timeshareData = [];

// Zoom / pan state
let klineStartIdx = null;       // first visible candle index (null = show latest)
let klineVisibleCount = 80;     // number of candles visible at once
let isDragging = false;
let dragStartX = 0;
let dragStartIdx = 0;

// ============================================================
// Moving Average
// ============================================================
function calcMA(data, period) {
  const result = [];
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) {
      result.push(null);
      continue;
    }
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) {
      sum += data[j].close;
    }
    result.push(sum / period);
  }
  return result;
}

// ============================================================
// Technical Indicator: MACD
// ============================================================
function calcMACD(data, fast, slow, signal) {
  fast = fast || 12;
  slow = slow || 26;
  signal = signal || 9;

  function ema(values, period) {
    const result = [];
    const k = 2 / (period + 1);
    for (let i = 0; i < values.length; i++) {
      if (i === 0) result.push(values[i]);
      else result.push(values[i] * k + result[i - 1] * (1 - k));
    }
    return result;
  }

  const closes = data.map(function(c) { return c.close; });
  const emaFast = ema(closes, fast);
  const emaSlow = ema(closes, slow);
  const dif = emaFast.map(function(v, i) { return v - emaSlow[i]; });
  const dea = ema(dif, signal);
  const histogram = dif.map(function(v, i) { return 2 * (v - dea[i]); });

  return { dif: dif, dea: dea, histogram: histogram };
}

// ============================================================
// Technical Indicator: KDJ
// ============================================================
function calcKDJ(data, period) {
  period = period || 9;
  const closes = data.map(function(c) { return c.close; });
  const kArr = [];
  const dArr = [];
  const jArr = [];

  for (let i = 0; i < closes.length; i++) {
    if (i < period - 1) {
      kArr.push(null);
      dArr.push(null);
      jArr.push(null);
      continue;
    }

    let low9 = Infinity;
    let high9 = -Infinity;
    for (let si = i - period + 1; si <= i; si++) {
      if (data[si].low < low9) low9 = data[si].low;
      if (data[si].high > high9) high9 = data[si].high;
    }
    const rsv = ((closes[i] - low9) / (high9 - low9 || 0.001)) * 100;

    if (i === period - 1) {
      kArr.push(rsv);
      dArr.push(rsv);
    } else {
      kArr.push((2 / 3) * kArr[i - 1] + (1 / 3) * rsv);
      dArr.push((2 / 3) * dArr[i - 1] + (1 / 3) * kArr[i]);
    }
    jArr.push(3 * kArr[i] - 2 * dArr[i]);
  }

  return { k: kArr, d: dArr, j: jArr };
}

// ============================================================
// Technical Indicator: RSI
// ============================================================
function calcRSI(data, period) {
  period = period || 14;
  const closes = data.map(function(c) { return c.close; });
  const result = [];

  for (let i = 0; i < closes.length; i++) {
    if (i < period) {
      result.push(null);
      continue;
    }
    let gains = 0;
    let losses = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const diff = closes[j] - closes[j - 1];
      if (diff > 0) gains += diff;
      else losses -= diff;
    }
    const avgGain = gains / period;
    const avgLoss = (losses / period) || 0.001;
    const rs = avgGain / avgLoss;
    result.push(100 - 100 / (1 + rs));
  }

  return result;
}

function calcRSI_Multi(data) {
  return {
    rsi6: calcRSI(data, 6),
    rsi12: calcRSI(data, 12),
    rsi24: calcRSI(data, 24),
  };
}

// ============================================================
// Technical Indicator: BOLL
// ============================================================
function calcBOLL(data, period, multiplier) {
  period = period || 20;
  multiplier = multiplier || 2;
  const closes = data.map(function(c) { return c.close; });
  const mid = calcMA(data, period);
  const upper = [];
  const lower = [];

  for (let i = 0; i < closes.length; i++) {
    if (mid[i] === null) {
      upper.push(null);
      lower.push(null);
      continue;
    }
    let sumSq = 0;
    for (let j = i - period + 1; j <= i; j++) {
      sumSq += Math.pow(closes[j] - mid[i], 2);
    }
    const std = Math.sqrt(sumSq / period);
    upper.push(mid[i] + multiplier * std);
    lower.push(mid[i] - multiplier * std);
  }

  return { upper: upper, mid: mid, lower: lower };
}

// ============================================================
// Data Source Resolution
// ============================================================
function getDisplayData() {
  if (displayPeriod === 'kline-1d') return dailyData;
  if (displayPeriod === 'kline-1w') return weeklyData;
  if (displayPeriod === 'kline-1m') return monthlyData;
  return klineData;
}

// ============================================================
// Data Management
// ============================================================
function setKlineData(candles) {
  klineData = candles || [];
  drawKline();
}

function setDayKlineData(candles) {
  dailyData = candles || [];
  weeklyData = calcWeeklyFromDaily(dailyData);
  monthlyData = calcMonthlyFromDaily(dailyData);
  // If currently showing a day/week/month period, refresh
  if (displayPeriod === 'kline-1d' || displayPeriod === 'kline-1w' || displayPeriod === 'kline-1m') {
    drawKline();
  }
}

function calcWeeklyFromDaily(dailyCandles) {
  if (!dailyCandles || dailyCandles.length === 0) return [];
  const weeks = {};
  const sorted = dailyCandles.slice().sort(function(a, b) {
    return (a.time || 0) - (b.time || 0);
  });

  for (let ci = 0; ci < sorted.length; ci++) {
    const c = sorted[ci];
    const d = new Date(c.time || c.time * 1000);
    // ISO week calculation
    const yearStart = new Date(d.getFullYear(), 0, 1);
    const weekNum = Math.ceil(((d - yearStart) / 86400000 + yearStart.getDay() + 1) / 7);
    const key = d.getFullYear() + '-W' + String(weekNum).padStart(2, '0');

    if (!weeks[key]) {
      weeks[key] = {
        time: c.time,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume || 0,
      };
    } else {
      weeks[key].high = Math.max(weeks[key].high, c.high);
      weeks[key].low = Math.min(weeks[key].low, c.low);
      weeks[key].close = c.close;
      weeks[key].volume = (weeks[key].volume || 0) + (c.volume || 0);
    }
  }

  return Object.keys(weeks).sort().map(function(k) { return weeks[k]; });
}

function calcMonthlyFromDaily(dailyCandles) {
  if (!dailyCandles || dailyCandles.length === 0) return [];
  const months = {};
  const sorted = dailyCandles.slice().sort(function(a, b) {
    return (a.time || 0) - (b.time || 0);
  });

  for (let ci = 0; ci < sorted.length; ci++) {
    const c = sorted[ci];
    const d = new Date(c.time || c.time * 1000);
    const key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');

    if (!months[key]) {
      months[key] = {
        time: c.time,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume || 0,
      };
    } else {
      months[key].high = Math.max(months[key].high, c.high);
      months[key].low = Math.min(months[key].low, c.low);
      months[key].close = c.close;
      months[key].volume = (months[key].volume || 0) + (c.volume || 0);
    }
  }

  return Object.keys(months).sort().map(function(k) { return months[k]; });
}

function addKlineCandle(candle) {
  if (!candle) return;
  // Always update tick data (real-time)
  if (klineData.length > 0 && klineData[klineData.length - 1].time === candle.time) {
    klineData[klineData.length - 1] = candle;
  } else {
    klineData.push(candle);
    if (klineData.length > 100) {
      klineData = klineData.slice(-100);
    }
  }
  drawKline();
}

function setIndicator(name) {
  currentIndicator = name;
  // Update button active state if indicator selector exists
  var btns = document.querySelectorAll('.indicator-btn');
  for (var bi = 0; bi < btns.length; bi++) {
    btns[bi].classList.toggle('active', btns[bi].dataset.indicator === name);
  }
  drawKline();
}

function switchDisplayPeriod(period) {
  displayPeriod = period;
  // If switching to day/week/month and no daily data exists yet, try to load from gameState
  if ((period === 'kline-1d' || period === 'kline-1w' || period === 'kline-1m') && dailyData.length === 0) {
    if (typeof gameState !== 'undefined' && gameState.candleData && gameState.candleData['1d']) {
      var cd = gameState.candleData['1d'];
      if (cd && cd['DM'] && cd['DM'].length > 0) {
        setDayKlineData(cd['DM']);
        return;
      }
    }
  }
  drawKline();
}

// ============================================================
// Main Drawing (entry point)
// ============================================================
function drawKline() {
  var canvas = document.getElementById('kline-canvas');
  if (!canvas) return;

  // Responsive sizing: fill container width, fixed height
  var container = canvas.parentElement;
  var w = container.clientWidth || 400;
  var h = Math.max(240, Math.min(420, w * 0.65));  // responsive height
  var dpr = window.devicePixelRatio || 1;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';

  var ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  var data = getDisplayData();

  // Fallback
  if (!data || data.length === 0) {
    if (klineData.length > 0) data = klineData;
    else {
      ctx.fillStyle = KLINE.TEXT_COLOR;
      ctx.font = '13px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('暂无K线数据', w / 2, h / 2);
      return;
    }
  }

  // Zoom/pan: show a window of candles based on klineStartIdx & klineVisibleCount
  if (klineStartIdx === null) {
    klineStartIdx = Math.max(0, data.length - klineVisibleCount);
  }
  var dataStart = Math.max(0, Math.min(klineStartIdx, data.length - klineVisibleCount));
  var dispData = data.slice(dataStart, dataStart + klineVisibleCount);
  var dataLen = dispData.length;

  // ================================================================
  // Layout: three-zone design  (65% main, 10% vol, 25% indicator)
  // ================================================================
  var pad = { top: 6, right: 50, bottom: 22, left: 8 };
  var mainRatio = 0.65;
  var volRatio = 0.10;

  var plotY = pad.top;
  var plotH = Math.max(30, h * mainRatio - pad.top - 2);
  var volAreaTop = plotY + plotH + 2;
  var volAreaH = Math.max(12, h * volRatio - 4);
  var indAreaTop = volAreaTop + volAreaH + 2;
  var indAreaH = Math.max(20, h - indAreaTop - pad.bottom);
  var indLabelH = 14;
  var indChartH = indAreaH - indLabelH;
  var plotW = Math.max(30, w - pad.left - pad.right);

  // ================================================================
  // Calculate price/volume ranges
  // ================================================================
  var minP = Infinity, maxP = -Infinity, maxV = 0;
  for (var di = 0; di < dataLen; di++) {
    var c = dispData[di];
    if (c.low < minP) minP = c.low;
    if (c.high > maxP) maxP = c.high;
    if (c.volume && c.volume > maxV) maxV = c.volume;
  }
  var lastC = dispData[dataLen - 1];
  var lastClose = lastC ? lastC.close : (maxP !== -Infinity ? maxP : 1);
  if (minP === Infinity) minP = lastClose * 0.95;
  if (maxP === -Infinity) maxP = lastClose * 1.05;
  // Add 5% padding above/below the range so candles don't touch the edge
  var pricePadding = (maxP - minP) * 0.05;
  minP -= pricePadding;
  maxP += pricePadding;
  var priceRange = maxP - minP || 1;

  if (maxV === 0) {
    for (var vi = 0; vi < dataLen; vi++) {
      maxV = Math.max(maxV, Math.abs(dispData[vi].close - dispData[vi].open) * 100);
    }
  }
  var volRange = maxV || 1;

  // ================================================================
  // Candle spacing
  // ================================================================
  var candleSpacing = Math.max(2, plotW / Math.max(1, dataLen));
  var candleW = Math.max(1, candleSpacing * 0.6);
  var candleBodyW = Math.max(1, candleW * 0.55);
  var candleStep = candleSpacing;

  var toY = function(p) {
    return plotY + plotH - ((p - minP) / priceRange) * plotH;
  };

  // ================================================================
  // Background
  // ================================================================
  ctx.fillStyle = '#0f1923';
  ctx.fillRect(0, 0, w, h);

  // ================================================================
  // Grid & Price Labels (同花顺 style: labels on the RIGHT)
  // ================================================================
  ctx.strokeStyle = KLINE.GRID_COLOR;
  ctx.lineWidth = 0.5;
  var gridLines = 4;
  for (var gi = 0; gi <= gridLines; gi++) {
    var gy = plotY + (plotH / gridLines) * gi;
    ctx.beginPath();
    ctx.moveTo(pad.left, Math.round(gy) + 0.5);
    ctx.lineTo(w - pad.right, Math.round(gy) + 0.5);
    ctx.stroke();

    var gPrice = maxP - (priceRange / gridLines) * gi;
    ctx.fillStyle = KLINE.TEXT_COLOR;
    ctx.font = '9px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(gPrice.toFixed(4), w - pad.right + 4, gy + 3);
  }

  // ================================================================
  // Candlesticks
  // ================================================================
  for (var ci = 0; ci < dataLen; ci++) {
    var cc = dispData[ci];
    var cx = pad.left + ci * candleStep + candleSpacing / 2;
    var isUp = cc.close >= cc.open;
    var color = isUp ? KLINE.UP_COLOR : KLINE.DOWN_COLOR;

    // Wick
    ctx.strokeStyle = color;
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(cx, toY(cc.high));
    ctx.lineTo(cx, toY(cc.low));
    ctx.stroke();

    // Body
    var bodyTop = toY(Math.max(cc.open, cc.close));
    var bodyBot = toY(Math.min(cc.open, cc.close));
    var bodyH = Math.max(1, bodyBot - bodyTop);
    ctx.fillStyle = color;
    ctx.fillRect(cx - candleBodyW / 2, bodyTop, candleBodyW, bodyH);
  }

  // ================================================================
  // Moving Averages (MA5, MA10, MA20, MA60)
  // ================================================================
  var maPeriods = [5, 10, 20, 60];
  var maColors = ['#f59e0b', '#3b82f6', '#8b5cf6', '#ec4899'];
  var maData = {};
  for (var mpi = 0; mpi < maPeriods.length; mpi++) {
    maData[maPeriods[mpi]] = calcMA(dispData, maPeriods[mpi]);
  }
  for (var mli = 0; mli < maPeriods.length; mli++) {
    var mp = maPeriods[mli];
    var mv = maData[mp];
    ctx.strokeStyle = maColors[mli];
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    var started = false;
    for (var mi = 0; mi < dataLen; mi++) {
      if (mv[mi] === null) continue;
      var mx = pad.left + mi * candleStep + candleSpacing / 2;
      var my = toY(mv[mi]);
      if (!started) { ctx.moveTo(mx, my); started = true; }
      else { ctx.lineTo(mx, my); }
    }
    ctx.stroke();
  }

  // MA legend
  ctx.font = '9px sans-serif';
  ctx.textAlign = 'left';
  var legX = pad.left + 4;
  var legY = plotY + 12;
  for (var lli = 0; lli < maPeriods.length; lli++) {
    var lastVals = maData[maPeriods[lli]].filter(function(v) { return v !== null; });
    var label = 'MA' + maPeriods[lli];
    if (lastVals.length > 0) label += ' ' + lastVals[lastVals.length - 1].toFixed(4);
    ctx.fillStyle = maColors[lli];
    ctx.fillText(label, legX + lli * 60, legY);
  }

  // ================================================================
  // Volume Zone
  // ================================================================
  ctx.strokeStyle = KLINE.GRID_COLOR;
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  ctx.moveTo(pad.left, volAreaTop + volAreaH);
  ctx.lineTo(w - pad.right, volAreaTop + volAreaH);
  ctx.stroke();

  ctx.fillStyle = KLINE.TEXT_COLOR;
  ctx.font = '8px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('VOL', pad.left + 2, volAreaTop + 9);

  // Volume bars
  for (var voli = 0; voli < dataLen; voli++) {
    var vc = dispData[voli];
    var vx = pad.left + voli * candleStep + candleSpacing / 2;
    var vUp = vc.close >= vc.open;
    var volVal = vc.volume || Math.abs(vc.close - vc.open) * 100;
    var volBarH = Math.max(0.5, (volVal / volRange) * (volAreaH - 4));
    ctx.fillStyle = vUp ? 'rgba(239,68,68,0.5)' : 'rgba(34,197,94,0.5)';
    ctx.fillRect(vx - candleW / 3, volAreaTop + volAreaH - 2 - volBarH, candleW * 0.66, volBarH);
  }

  // ================================================================
  // Indicator Zone
  // ================================================================
  ctx.fillStyle = '#0d1620';
  ctx.fillRect(pad.left, indAreaTop + indLabelH, plotW, indChartH);

  ctx.fillStyle = KLINE.TEXT_COLOR;
  ctx.font = 'bold 9px sans-serif';
  ctx.textAlign = 'left';
  var indLabels = { MACD: 'MACD(12,26,9)', KDJ: 'KDJ(9,3,3)', RSI: 'RSI(6,12,24)', BOLL: 'BOLL(20,2)' };
  ctx.fillText(indLabels[currentIndicator] || currentIndicator, pad.left + 2, indAreaTop + 11);

  if (currentIndicator === 'MACD') drawMACD(ctx, dispData, pad.left, indAreaTop + indLabelH, indChartH, candleStep, candleW, plotW);
  else if (currentIndicator === 'KDJ') drawKDJ(ctx, dispData, pad.left, indAreaTop + indLabelH, indChartH, candleStep, candleW, plotW);
  else if (currentIndicator === 'RSI') drawRSI(ctx, dispData, pad.left, indAreaTop + indLabelH, indChartH, candleStep, candleW, plotW);
  else if (currentIndicator === 'BOLL') drawBOLL(ctx, dispData, pad.left, indAreaTop + indLabelH, indChartH, candleStep, candleW, plotW);

  // ================================================================
  // Time Labels (X-axis) — evenly spaced, no overlap
  // ================================================================
  ctx.fillStyle = KLINE.TEXT_COLOR;
  ctx.font = '8px sans-serif';
  ctx.textAlign = 'center';
  var labelInterval = Math.max(1, Math.floor(dataLen / 6));
  for (var ti = 0; ti < dataLen; ti += labelInterval) {
    var tc = dispData[ti];
    var tx = pad.left + ti * candleStep + candleSpacing / 2;
    var td = new Date(tc.time || tc.time * 1000);
    var tLabel;
    if (displayPeriod === 'kline-1d' || displayPeriod === 'kline-1w' || displayPeriod === 'kline-1m')
      tLabel = (td.getMonth() + 1) + '/' + td.getDate();
    else
      tLabel = String(td.getHours()).padStart(2, '0') + ':' + String(td.getMinutes()).padStart(2, '0');
    ctx.fillText(tLabel, tx, h - pad.bottom + 8);
  }

  // ================================================================
  // Last Price Label
  // ================================================================
  if (dataLen > 0) {
    var last = dispData[dataLen - 1];
    var ly = toY(last.close);
    ctx.fillStyle = last.close >= last.open ? KLINE.UP_COLOR : KLINE.DOWN_COLOR;
    ctx.font = 'bold 10px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(last.close.toFixed(4), w - pad.right, ly - 4);
    ctx.strokeStyle = (last.close >= last.open ? KLINE.UP_COLOR : KLINE.DOWN_COLOR) + '40';
    ctx.lineWidth = 0.5;
    ctx.setLineDash([2, 3]);
    ctx.beginPath();
    ctx.moveTo(pad.left, ly);
    ctx.lineTo(w - pad.right, ly);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // ================================================================
  // Crosshair
  // ================================================================
  if (crossX !== null && crossY !== null && dataLen > 0) {
    var rawIdx = (crossX - pad.left - candleSpacing / 2) / candleStep;
    var hoverIdx = Math.max(0, Math.min(dataLen - 1, Math.round(rawIdx)));
    var hoverCandle = dispData[hoverIdx];
    var hx = pad.left + hoverIdx * candleStep + candleSpacing / 2;

    ctx.save();

    // Vertical line
    ctx.strokeStyle = KLINE.CROSS_COLOR;
    ctx.lineWidth = 0.6;
    ctx.setLineDash([2, 3]);
    ctx.beginPath();
    ctx.moveTo(hx, plotY);
    ctx.lineTo(hx, indAreaTop + indAreaH);
    ctx.stroke();

    // Horizontal line in main chart
    var hy = Math.max(plotY, Math.min(plotY + plotH, crossY));
    ctx.beginPath();
    ctx.moveTo(pad.left, hy);
    ctx.lineTo(w - pad.right, hy);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = KLINE.CROSS_COLOR;
    ctx.beginPath();
    ctx.arc(hx, hy, 2.5, 0, Math.PI * 2);
    ctx.fill();

    // Price at crosshair Y (right side, like 同花顺)
    var hoveredPrice = maxP - ((hy - plotY) / plotH) * priceRange;
    ctx.fillStyle = KLINE.CROSS_COLOR;
    ctx.font = '9px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('¥' + hoveredPrice.toFixed(4), w - pad.right + 4, hy - 2);

    // OHLC info box
    var ohlcIsUp = hoverCandle.close >= hoverCandle.open;
    var ohlcColor = ohlcIsUp ? KLINE.UP_COLOR : KLINE.DOWN_COLOR;
    var ohlcText = 'O:' + hoverCandle.open.toFixed(4) + ' H:' + hoverCandle.high.toFixed(4)
                 + ' L:' + hoverCandle.low.toFixed(4) + ' C:' + hoverCandle.close.toFixed(4);

    // MA values
    var maText = '';
    for (var mai = 0; mai < maPeriods.length; mai++) {
      var mpv = maData[maPeriods[mai]][hoverIdx];
      if (mpv !== null) maText += ' MA' + maPeriods[mai] + ':' + mpv.toFixed(4);
    }
    var fullText = ohlcText + maText;

    ctx.font = '9px sans-serif';
    ctx.textAlign = 'left';
    var textWidth = ctx.measureText(fullText).width + 14;
    var boxX = Math.max(pad.left, Math.min(hx - textWidth / 2, w - pad.right - textWidth));
    var boxY = plotY + 2;

    ctx.fillStyle = 'rgba(15, 25, 35, 0.88)';
    ctx.fillRect(boxX, boxY, textWidth, 16);
    ctx.strokeStyle = KLINE.CROSS_COLOR;
    ctx.lineWidth = 0.5;
    ctx.strokeRect(boxX, boxY, textWidth, 16);

    ctx.fillStyle = ohlcColor;
    ctx.fillText(ohlcText, boxX + 6, boxY + 12);

    // MA values in different color
    ctx.fillStyle = '#8a9ba8';
    ctx.fillText(maText, boxX + 6 + ctx.measureText(ohlcText).width + 4, boxY + 12);

    // Volume label
    var hoverVol = hoverCandle.volume || 0;
    ctx.fillStyle = KLINE.TEXT_COLOR;
    ctx.font = '8px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(hoverVol > 0 ? (hoverVol / 10000).toFixed(1) + '万' : '--', w - pad.right, volAreaTop + volAreaH - 2);

    // Time label
    var hd = new Date(hoverCandle.time || hoverCandle.time * 1000);
    var timeLabel;
    if (displayPeriod === 'kline-1d' || displayPeriod === 'kline-1w' || displayPeriod === 'kline-1m')
      timeLabel = (hd.getMonth() + 1) + '/' + hd.getDate();
    else
      timeLabel = String(hd.getHours()).padStart(2, '0') + ':' + String(hd.getMinutes()).padStart(2, '0');
    ctx.fillStyle = KLINE.CROSS_COLOR;
    ctx.font = '8px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(timeLabel, hx, h - pad.bottom + 18);

    ctx.restore();
  }
}

// ============================================================
// MACD Drawing
// ============================================================
function drawMACD(ctx, data, xBase, areaTop, areaH, candleStep, candleW, plotW) {
  var macdData = calcMACD(data);
  var dif = macdData.dif;
  var dea = macdData.dea;
  var histogram = macdData.histogram;

  // Find value range
  var minVal = Infinity;
  var maxVal = -Infinity;
  for (var mi = 0; mi < histogram.length; mi++) {
    if (histogram[mi] !== null && histogram[mi] !== undefined) {
      if (histogram[mi] < minVal) minVal = histogram[mi];
      if (histogram[mi] > maxVal) maxVal = histogram[mi];
    }
  }
  for (var mi2 = 0; mi2 < dif.length; mi2++) {
    if (dif[mi2] !== null && dif[mi2] !== undefined) {
      if (dif[mi2] < minVal) minVal = dif[mi2];
      if (dif[mi2] > maxVal) maxVal = dif[mi2];
    }
  }
  for (var mi3 = 0; mi3 < dea.length; mi3++) {
    if (dea[mi3] !== null && dea[mi3] !== undefined) {
      if (dea[mi3] < minVal) minVal = dea[mi3];
      if (dea[mi3] > maxVal) maxVal = dea[mi3];
    }
  }

  var range = (maxVal - minVal) || 1;
  var padRange = range * 0.1;
  minVal -= padRange;
  maxVal += padRange;

  var toIndY = function(v) {
    return areaTop + areaH - ((v - minVal) / (maxVal - minVal)) * areaH;
  };

  // Zero line
  var zeroY = toIndY(0);
  if (zeroY >= areaTop && zeroY <= areaTop + areaH) {
    ctx.strokeStyle = 'rgba(255,255,255,0.2)';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(xBase, zeroY);
    ctx.lineTo(xBase + data.length * candleStep, zeroY);
    ctx.stroke();
  }

  // Histogram bars
  var halfCW = candleW / 2;
  for (var hi = 0; hi < histogram.length; hi++) {
    if (histogram[hi] === null || histogram[hi] === undefined) continue;
    var hx = xBase + hi * candleStep + halfCW;
    var hv = histogram[hi];
    var hy0 = toIndY(0);
    var hy1 = toIndY(hv);
    ctx.fillStyle = hv >= 0 ? KLINE.UP_COLOR : KLINE.DOWN_COLOR;
    var barW = Math.max(1, candleW * 0.6);
    ctx.fillRect(hx - barW / 2, Math.min(hy0, hy1), barW, Math.abs(hy1 - hy0) || 1);
  }

  // DIF line (white)
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  var started = false;
  for (var di = 0; di < dif.length; di++) {
    if (dif[di] === null || dif[di] === undefined) continue;
    var dix = xBase + di * candleStep + halfCW;
    var diy = toIndY(dif[di]);
    if (!started) { ctx.moveTo(dix, diy); started = true; }
    else { ctx.lineTo(dix, diy); }
  }
  ctx.stroke();

  // DEA line (yellow)
  ctx.strokeStyle = '#f59e0b';
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  started = false;
  for (var ei = 0; ei < dea.length; ei++) {
    if (dea[ei] === null || dea[ei] === undefined) continue;
    var ex = xBase + ei * candleStep + halfCW;
    var ey = toIndY(dea[ei]);
    if (!started) { ctx.moveTo(ex, ey); started = true; }
    else { ctx.lineTo(ex, ey); }
  }
  ctx.stroke();

  // Y-axis labels (right side)
  ctx.fillStyle = KLINE.TEXT_COLOR;
  ctx.font = '9px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(maxVal.toFixed(2), xBase + plotW + 4, areaTop + 10);
  ctx.fillText(minVal.toFixed(2), xBase + plotW + 4, areaTop + areaH);
}

// ============================================================
// KDJ Drawing
// ============================================================
function drawKDJ(ctx, data, xBase, areaTop, areaH, candleStep, candleW, plotW) {
  var kdj = calcKDJ(data);
  var kArr = kdj.k;
  var dArr = kdj.d;
  var jArr = kdj.j;

  var toIndY = function(v) {
    return areaTop + areaH - (v / 100) * areaH;
  };

  // Reference lines at 20, 50, 80
  ctx.strokeStyle = 'rgba(255,255,255,0.15)';
  ctx.lineWidth = 0.5;
  ctx.setLineDash([2, 2]);
  var refs = [20, 50, 80];
  for (var ri = 0; ri < refs.length; ri++) {
    var ry = toIndY(refs[ri]);
    ctx.beginPath();
    ctx.moveTo(xBase, ry);
    ctx.lineTo(xBase + data.length * candleStep, ry);
    ctx.stroke();
    ctx.fillStyle = KLINE.TEXT_COLOR;
    ctx.font = '8px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(String(refs[ri]), xBase + plotW + 4, ry + 3);
  }
  ctx.setLineDash([]);

  var halfCW = candleW / 2;

  // K line (white)
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  var started = false;
  for (var ki = 0; ki < kArr.length; ki++) {
    if (kArr[ki] === null) continue;
    var kx = xBase + ki * candleStep + halfCW;
    var ky = toIndY(kArr[ki]);
    if (!started) { ctx.moveTo(kx, ky); started = true; }
    else { ctx.lineTo(kx, ky); }
  }
  ctx.stroke();

  // D line (yellow)
  ctx.strokeStyle = '#f59e0b';
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  started = false;
  for (var di2 = 0; di2 < dArr.length; di2++) {
    if (dArr[di2] === null) continue;
    var dx = xBase + di2 * candleStep + halfCW;
    var dy = toIndY(dArr[di2]);
    if (!started) { ctx.moveTo(dx, dy); started = true; }
    else { ctx.lineTo(dx, dy); }
  }
  ctx.stroke();

  // J line (purple)
  ctx.strokeStyle = '#8b5cf6';
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  started = false;
  for (var ji = 0; ji < jArr.length; ji++) {
    if (jArr[ji] === null) continue;
    var jx = xBase + ji * candleStep + halfCW;
    var jy = toIndY(jArr[ji]);
    if (!started) { ctx.moveTo(jx, jy); started = true; }
    else { ctx.lineTo(jx, jy); }
  }
  ctx.stroke();

  // Y-axis labels (right side)
  ctx.fillStyle = KLINE.TEXT_COLOR;
  ctx.font = '9px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('100', xBase + plotW + 4, areaTop + 10);
  ctx.fillText('0', xBase + plotW + 4, areaTop + areaH);
}

// ============================================================
// RSI Drawing
// ============================================================
function drawRSI(ctx, data, xBase, areaTop, areaH, candleStep, candleW, plotW) {
  var rsiData = calcRSI_Multi(data);
  var rsi6 = rsiData.rsi6;
  var rsi12 = rsiData.rsi12;
  var rsi24 = rsiData.rsi24;

  var toIndY = function(v) {
    return areaTop + areaH - (v / 100) * areaH;
  };

  // Reference lines at 30, 50, 70
  ctx.strokeStyle = 'rgba(255,255,255,0.15)';
  ctx.lineWidth = 0.5;
  ctx.setLineDash([2, 2]);
  var refs = [30, 50, 70];
  for (var ri = 0; ri < refs.length; ri++) {
    var ry = toIndY(refs[ri]);
    ctx.beginPath();
    ctx.moveTo(xBase, ry);
    ctx.lineTo(xBase + data.length * candleStep, ry);
    ctx.stroke();
    ctx.fillStyle = KLINE.TEXT_COLOR;
    ctx.font = '8px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(String(refs[ri]), xBase + plotW + 4, ry + 3);
  }
  ctx.setLineDash([]);

  var halfCW = candleW / 2;

  // RSI6 (white)
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  var started = false;
  for (var i6 = 0; i6 < rsi6.length; i6++) {
    if (rsi6[i6] === null) continue;
    var x6 = xBase + i6 * candleStep + halfCW;
    var y6 = toIndY(rsi6[i6]);
    if (!started) { ctx.moveTo(x6, y6); started = true; }
    else { ctx.lineTo(x6, y6); }
  }
  ctx.stroke();

  // RSI12 (yellow)
  ctx.strokeStyle = '#f59e0b';
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  started = false;
  for (var i12 = 0; i12 < rsi12.length; i12++) {
    if (rsi12[i12] === null) continue;
    var x12 = xBase + i12 * candleStep + halfCW;
    var y12 = toIndY(rsi12[i12]);
    if (!started) { ctx.moveTo(x12, y12); started = true; }
    else { ctx.lineTo(x12, y12); }
  }
  ctx.stroke();

  // RSI24 (purple)
  ctx.strokeStyle = '#8b5cf6';
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  started = false;
  for (var i24 = 0; i24 < rsi24.length; i24++) {
    if (rsi24[i24] === null) continue;
    var x24 = xBase + i24 * candleStep + halfCW;
    var y24 = toIndY(rsi24[i24]);
    if (!started) { ctx.moveTo(x24, y24); started = true; }
    else { ctx.lineTo(x24, y24); }
  }
  ctx.stroke();

  // Y-axis labels (right side)
  ctx.fillStyle = KLINE.TEXT_COLOR;
  ctx.font = '9px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('100', xBase + plotW + 4, areaTop + 10);
  ctx.fillText('0', xBase + plotW + 4, areaTop + areaH);
}

// ============================================================
// BOLL Drawing
// ============================================================
function drawBOLL(ctx, data, xBase, areaTop, areaH, candleStep, candleW, plotW) {
  var boll = calcBOLL(data);
  var upper = boll.upper;
  var mid = boll.mid;
  var lower = boll.lower;

  // Find range
  var minVal = Infinity;
  var maxVal = -Infinity;
  for (var i = 0; i < data.length; i++) {
    if (upper[i] !== null) {
      if (upper[i] < minVal) minVal = upper[i];
      if (upper[i] > maxVal) maxVal = upper[i];
    }
    if (mid[i] !== null) {
      if (mid[i] < minVal) minVal = mid[i];
      if (mid[i] > maxVal) maxVal = mid[i];
    }
    if (lower[i] !== null) {
      if (lower[i] < minVal) minVal = lower[i];
      if (lower[i] > maxVal) maxVal = lower[i];
    }
  }
  var range = (maxVal - minVal) || 1;
  var padR = range * 0.05;
  minVal -= padR;
  maxVal += padR;

  var toIndY = function(v) {
    return areaTop + areaH - ((v - minVal) / (maxVal - minVal)) * areaH;
  };

  var halfCW = candleW / 2;

  // Upper band (red dashed)
  ctx.strokeStyle = '#ef4444';
  ctx.lineWidth = 0.8;
  ctx.setLineDash([4, 3]);
  ctx.beginPath();
  var started = false;
  for (var ui = 0; ui < upper.length; ui++) {
    if (upper[ui] === null) continue;
    var ux = xBase + ui * candleStep + halfCW;
    var uy = toIndY(upper[ui]);
    if (!started) { ctx.moveTo(ux, uy); started = true; }
    else { ctx.lineTo(ux, uy); }
  }
  ctx.stroke();
  ctx.setLineDash([]);

  // Mid band (yellow)
  ctx.strokeStyle = '#f59e0b';
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  started = false;
  for (var mi = 0; mi < mid.length; mi++) {
    if (mid[mi] === null) continue;
    var mx = xBase + mi * candleStep + halfCW;
    var my = toIndY(mid[mi]);
    if (!started) { ctx.moveTo(mx, my); started = true; }
    else { ctx.lineTo(mx, my); }
  }
  ctx.stroke();

  // Lower band (green dashed)
  ctx.strokeStyle = '#22c55e';
  ctx.lineWidth = 0.8;
  ctx.setLineDash([4, 3]);
  ctx.beginPath();
  started = false;
  for (var li = 0; li < lower.length; li++) {
    if (lower[li] === null) continue;
    var lx = xBase + li * candleStep + halfCW;
    var ly = toIndY(lower[li]);
    if (!started) { ctx.moveTo(lx, ly); started = true; }
    else { ctx.lineTo(lx, ly); }
  }
  ctx.stroke();
  ctx.setLineDash([]);

  // Y-axis labels (right side)
  ctx.fillStyle = KLINE.TEXT_COLOR;
  ctx.font = '9px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(maxVal.toFixed(2), xBase + plotW + 4, areaTop + 10);
  ctx.fillText(minVal.toFixed(2), xBase + plotW + 4, areaTop + areaH);
}

// ============================================================
// Event Handlers — crosshair + zoom/pan
// ============================================================
document.addEventListener('DOMContentLoaded', function() {
  var canvas = document.getElementById('kline-canvas');
  if (!canvas) return;

  canvas.addEventListener('mousemove', function(e) {
    var rect = canvas.getBoundingClientRect();
    var dpr = window.devicePixelRatio || 1;
    var mx = (e.clientX - rect.left) * (canvas.width / (rect.width * dpr));
    var my = (e.clientY - rect.top) * (canvas.height / (rect.height * dpr));
    crossX = mx;
    crossY = my;
    if (!showTimeshare) drawKline();
  });

  canvas.addEventListener('mouseleave', function() {
    crossX = null;
    crossY = null;
    if (!showTimeshare) drawKline();
  });

  // --- Zoom: mouse wheel ---
  canvas.addEventListener('wheel', function(e) {
    e.preventDefault();
    if (showTimeshare) return;
    var oldCount = klineVisibleCount;
    if (e.deltaY < 0) {
      klineVisibleCount = Math.max(20, Math.round(klineVisibleCount * 0.8));
    } else {
      klineVisibleCount = Math.min(500, Math.round(klineVisibleCount * 1.25));
    }
    // Adjust startIdx so the candle under cursor stays in view
    if (klineStartIdx !== null && crossX !== null) {
      var data = getDisplayData();
      if (data.length === 0) data = klineData;
      var ratio = klineVisibleCount / oldCount;
      // keep center of visible area stable
      var centerOffset = klineVisibleCount / 2;
      klineStartIdx = Math.round(klineStartIdx + (oldCount / 2) * (1 - ratio));
    }
    drawKline();
  }, { passive: false });

  // --- Pan: mouse drag ---
  canvas.addEventListener('mousedown', function(e) {
    if (showTimeshare) return;
    isDragging = true;
    dragStartX = e.clientX;
    dragStartIdx = klineStartIdx !== null ? klineStartIdx : Math.max(0, (getDisplayData() || klineData).length - klineVisibleCount);
  });

  window.addEventListener('mousemove', function(e) {
    if (!isDragging || showTimeshare) return;
    var data = getDisplayData();
    if (data.length === 0) data = klineData;
    if (data.length === 0) return;
    var rect = canvas.getBoundingClientRect();
    var dpr = window.devicePixelRatio || 1;
    var w = canvas.width / dpr;
    var padL = 8, padR = 50;
    var plotW = Math.max(30, w - padL - padR);
    var pxPerCandle = plotW / klineVisibleCount;
    var dx = e.clientX - dragStartX;
    var idxDelta = Math.round(-dx / pxPerCandle);
    klineStartIdx = Math.max(0, Math.min(dragStartIdx + idxDelta, data.length - klineVisibleCount));
    crossX = null;
    drawKline();
  });

  window.addEventListener('mouseup', function() {
    isDragging = false;
  });

  // --- Touch events for mobile ---
  var touchStartX = 0;
  var touchStartIdx = 0;
  var lastTouchDist = 0;

  canvas.addEventListener('touchstart', function(e) {
    if (showTimeshare) return;
    if (e.touches.length === 1) {
      // Single finger = pan
      touchStartX = e.touches[0].clientX;
      touchStartIdx = klineStartIdx !== null ? klineStartIdx : Math.max(0, (getDisplayData() || klineData).length - klineVisibleCount);
    } else if (e.touches.length === 2) {
      // Two fingers = pinch zoom
      lastTouchDist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
    }
  }, { passive: true });

  canvas.addEventListener('touchmove', function(e) {
    e.preventDefault();
    if (showTimeshare) return;
    var data = getDisplayData();
    if (data.length === 0) data = klineData;
    if (data.length === 0) return;

    if (e.touches.length === 1) {
      // Pan
      var rect = canvas.getBoundingClientRect();
      var w = canvas.clientWidth || 400;
      var padL = 8, padR = 50;
      var plotW = Math.max(30, w - padL - padR);
      var pxPerCandle = plotW / klineVisibleCount;
      var dx = e.touches[0].clientX - touchStartX;
      var idxDelta = Math.round(-dx / pxPerCandle);
      klineStartIdx = Math.max(0, Math.min(touchStartIdx + idxDelta, data.length - klineVisibleCount));
      crossX = null;
      drawKline();
    } else if (e.touches.length === 2) {
      // Pinch zoom
      var dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      if (lastTouchDist > 0) {
        var scale = dist / lastTouchDist;
        var oldCount = klineVisibleCount;
        klineVisibleCount = Math.max(20, Math.min(500, Math.round(klineVisibleCount / scale)));
        if (klineStartIdx !== null) {
          var centerOffset = klineVisibleCount / 2;
          klineStartIdx = Math.round(klineStartIdx + (oldCount / 2) * (1 - klineVisibleCount / oldCount));
        }
        drawKline();
      }
      lastTouchDist = dist;
    }
  }, { passive: false });

  canvas.addEventListener('touchend', function() {
    lastTouchDist = 0;
  });
});

// Debounced resize handler
var klineResizeTimer = null;
window.addEventListener('resize', function() {
  if (klineResizeTimer) clearTimeout(klineResizeTimer);
  klineResizeTimer = setTimeout(function() {
    if (!showTimeshare) drawKline();
    else drawTimeshare();
  }, 200);
});

// ============================================================
// Timeshare (分时图) chart
// ============================================================
function setTimeshareData(data) {
  timeshareData = data || [];
  if (showTimeshare) drawTimeshare();
}

function toggleChartMode(mode) {
  showTimeshare = (mode === 'timeshare');
  if (showTimeshare) {
    drawTimeshare();
  } else {
    drawKline();
  }
}

function drawTimeshare() {
  var canvas = document.getElementById('kline-canvas');
  if (!canvas) return;
  var dpr = window.devicePixelRatio || 1;
  var w = canvas.clientWidth || 400;
  var h = 380;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';

  var ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  var data = timeshareData;
  if (!data || data.length < 2) {
    ctx.fillStyle = '#5a7a8a';
    ctx.font = '13px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('暂无分时数据', w / 2, h / 2);
    return;
  }

  var volH = 60;
  var pad = { top: 8, right: 50, bottom: 28, left: 8 };
  var priceH = h - pad.top - pad.bottom - volH - 6;
  var plotW = w - pad.left - pad.right;
  var plotY = pad.top;

  var minP = Infinity, maxP = -Infinity, maxVol = 0;
  for (var dsi = 0; dsi < data.length; dsi++) {
    if (data[dsi].price < minP) minP = data[dsi].price;
    if (data[dsi].price > maxP) maxP = data[dsi].price;
    if (data[dsi].volume !== undefined && data[dsi].volume > maxVol) maxVol = data[dsi].volume;
  }
  var rangeTs = maxP - minP || 0.01;
  var paddingTs = rangeTs * 0.05;
  minP -= paddingTs;
  maxP += paddingTs;

  var toY = function(p) { return plotY + priceH - ((p - minP) / rangeTs) * priceH; };
  var volY = pad.top + priceH + 4;

  var refPrice = (typeof gameState !== 'undefined' && gameState.dailyStats && gameState.dailyStats.prev_close) || data[0].price;
  var refY = toY(refPrice);

  ctx.fillStyle = '#0f1923';
  ctx.fillRect(0, 0, w, h);

  // Grid lines
  ctx.strokeStyle = '#1a2c38';
  ctx.lineWidth = 0.5;
  var gridLines = 4;
  for (var tgi = 0; tgi <= gridLines; tgi++) {
    var gy = plotY + (priceH / gridLines) * tgi;
    ctx.beginPath();
    ctx.moveTo(pad.left, gy);
    ctx.lineTo(w - pad.right, gy);
    ctx.stroke();
    var gPrice = maxP - (rangeTs / gridLines) * tgi;
    ctx.fillStyle = '#5a7a8a';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(gPrice.toFixed(4), w - pad.right + 4, gy + 3);
  }

  // Reference line
  ctx.strokeStyle = 'rgba(255,255,255,0.2)';
  ctx.lineWidth = 0.5;
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.moveTo(pad.left, refY);
  ctx.lineTo(w - pad.right, refY);
  ctx.stroke();
  ctx.setLineDash([]);

  // Volume bars
  if (maxVol > 0) {
    for (var vi = 0; vi < data.length; vi++) {
      var vx = pad.left + (vi / (data.length - 1)) * plotW;
      var barW = Math.max(1, plotW / data.length * 0.6);
      var vh = data[vi].volume ? (data[vi].volume / maxVol) * volH : 0;
      var isUp = vi === 0 || data[vi].price >= data[vi - 1].price;
      ctx.fillStyle = isUp ? 'rgba(239,68,68,0.5)' : 'rgba(34,197,94,0.5)';
      ctx.fillRect(vx - barW / 2, volY + volH - vh, barW, vh);
    }
  }

  // Volume axis label
  if (maxVol > 0) {
    ctx.fillStyle = '#5a7a8a';
    ctx.font = '9px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(maxVol >= 10000 ? (maxVol / 10000).toFixed(1) + '万' : maxVol, w - pad.right + 4, volY + 10);
  }

  // Price line
  ctx.strokeStyle = '#3b82f6';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (var pli = 0; pli < data.length; pli++) {
    var px = pad.left + (pli / (data.length - 1)) * plotW;
    var py = toY(data[pli].price);
    if (pli === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.stroke();

  // Average price line (yellow)
  ctx.strokeStyle = '#f5c842';
  ctx.lineWidth = 1.0;
  ctx.beginPath();
  var ali, apx, apy;
  var hasAvg = false;
  for (ali = 0; ali < data.length; ali++) {
    if (data[ali].avg_price === undefined) continue;
    apx = pad.left + (ali / (data.length - 1)) * plotW;
    apy = toY(data[ali].avg_price);
    if (!hasAvg) { ctx.moveTo(apx, apy); hasAvg = true; }
    else ctx.lineTo(apx, apy);
  }
  if (hasAvg) ctx.stroke();

  // Fill area under the line
  var lastPx = pad.left + plotW;
  var refYEnd = toY(refPrice);
  ctx.lineTo(lastPx, refYEnd);
  ctx.lineTo(pad.left, refYEnd);
  ctx.closePath();
  var grad = ctx.createLinearGradient(0, plotY, 0, plotY + priceH);
  grad.addColorStop(0, 'rgba(59, 130, 246, 0.3)');
  grad.addColorStop(1, 'rgba(59, 130, 246, 0.02)');
  ctx.fillStyle = grad;
  ctx.fill();

  // Time labels
  ctx.fillStyle = '#5a7a8a';
  ctx.font = '9px sans-serif';
  ctx.textAlign = 'center';
  var step = Math.max(1, Math.floor(data.length / 5));
  for (var tsi = 0; tsi < data.length; tsi += step) {
    var tpx = pad.left + (tsi / (data.length - 1)) * plotW;
    var td = new Date(data[tsi].time);
    var tLabel = String(td.getHours()).padStart(2, '0') + ':' + String(td.getMinutes()).padStart(2, '0');
    ctx.fillText(tLabel, tpx, h - pad.bottom + 14);
  }

  // Current price label
  var lastDP = data[data.length - 1];
  var llx = w - pad.right;
  var lly = toY(lastDP.price);
  ctx.fillStyle = '#3b82f6';
  ctx.font = 'bold 11px sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText(lastDP.price.toFixed(4), llx, lly - 4);

  // Avg price legend
  var lastAP = data[data.length - 1].avg_price;
  if (lastAP !== undefined) {
    ctx.fillStyle = '#f5c842';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('均价 ￥' + lastAP.toFixed(4), pad.left + 4, pad.top + 14);
  }
}
