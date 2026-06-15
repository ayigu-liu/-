// ============================================================
// K-line Chart — Lightweight Charts (TradingView) for candlestick
// Canvas for timeshare (分时)
// ============================================================

const KLINE = { UP_COLOR: '#ef4444', DOWN_COLOR: '#22c55e', GRID_COLOR: '#1a2c38', TEXT_COLOR: '#5a7a8a' };

let klineData = [];
let dailyData = [];
let showTimeshare = false;
let timeshareData = [];
let _chart = null;
let _candleSeries = null;
let _volumeSeries = null;
let _chartInit = false;

function initLC() {
  if (_chartInit) return;
  var el = document.getElementById('lc-chart');
  if (!el || typeof LightweightCharts === 'undefined') return;
  _chart = LightweightCharts.createChart(el, {
    layout: { background: {type:'solid',color:'#0a0e17'}, textColor: '#5a7a8a', fontSize: 11 },
    grid: { vertLines: {color:'#1a2c38'}, horzLines: {color:'#1a2c38'} },
    crosshair: { mode: LightweightCharts.CrosshairMode.Normal,
      vertLine: {color:'#8a9ba8',width:1,style:LightweightCharts.LineStyle.Dashed,labelBackgroundColor:'#1a2332'},
      horzLine: {color:'#8a9ba8',width:1,style:LightweightCharts.LineStyle.Dashed,labelBackgroundColor:'#1a2332'} },
    timeScale: { borderColor:'#2a4050', timeVisible:true, secondsVisible:false, fixLeftEdge:true, fixRightEdge:true },
    rightPriceScale: { borderColor:'#2a4050' },
  });
  _candleSeries = _chart.addCandlestickSeries({
    upColor: KLINE.UP_COLOR, downColor: KLINE.DOWN_COLOR,
    borderUpColor: KLINE.UP_COLOR, borderDownColor: KLINE.DOWN_COLOR,
    wickUpColor: KLINE.UP_COLOR, wickDownColor: KLINE.DOWN_COLOR,
  });
  _volumeSeries = _chart.addHistogramSeries({
    priceFormat: {type:'volume'}, priceScaleId: 'volume',
  });
  _chart.priceScale('volume').applyOptions({ scaleMargins: {top:0.8,bottom:0} });
  new ResizeObserver(function(){if(_chart)_chart.resize(el.clientWidth,el.clientHeight);}).observe(el);
  _chartInit = true;
}

function _toLC(d) {
  if (!d || !d.length) return [];
  return d.map(function(c){return{time:Math.floor(c.time/1000),open:c.open,high:c.high,low:c.low,close:c.close};});
}
function _volLC(d) {
  if (!d || !d.length) return [];
  return d.map(function(c){return{time:Math.floor(c.time/1000),value:c.volume||0,color:c.close>=c.open?KLINE.UP_COLOR:KLINE.DOWN_COLOR};});
}

function initChart() { initLC(); }

function setKlineData(candles) {
  if (!candles || !candles.length) return;
  klineData = candles;
  if (showTimeshare) return;
  initLC();
  if (!_candleSeries) return;
  _candleSeries.setData(_toLC(candles));
  _volumeSeries.setData(_volLC(candles));
  try { _chart.timeScale().fitContent(); } catch(e) {}
  // Show chart div, hide canvas
  var cv = document.getElementById('kline-canvas');
  var lc = document.getElementById('lc-chart');
  if (cv) cv.style.display = 'none';
  if (lc) lc.style.display = '';
}

function setDayKlineData(candles) {
  if (!candles || !candles.length) return;
  dailyData = candles;
  setKlineData(candles);
}

function drawKline() {
  var data = klineData.length > 0 ? klineData : dailyData;
  if (data && data.length > 0) setKlineData(data);
}

function switchDisplayPeriod(p) { drawKline(); }
function setIndicator(n) {}

// ============================================================
// Timeshare (分时) — canvas rendering
// ============================================================
function setTimeshareData(data) {
  timeshareData = data || [];
  if (showTimeshare) drawTimeshare();
}

function toggleChartMode(mode) {
  showTimeshare = (mode === 'timeshare' || mode === 'chart');
  var cv = document.getElementById('kline-canvas');
  var lc = document.getElementById('lc-chart');
  if (showTimeshare) {
    if (cv) cv.style.display = '';
    if (lc) lc.style.display = 'none';
    drawTimeshare();
  } else {
    if (cv) cv.style.display = 'none';
    if (lc) lc.style.display = '';
    drawKline();
  }
}

function drawTimeshare() {
  var canvas = document.getElementById('kline-canvas');
  if (!canvas) return;
  var ctx = canvas.getContext('2d');
  var rect = canvas.parentElement.getBoundingClientRect();
  var W = canvas.width = rect.width - 0, H = canvas.height = rect.height - 0;
  if (W <= 0 || H <= 0) return;
  ctx.clearRect(0, 0, W, H);
  var data = timeshareData || [];
  if (data.length < 2) {
    ctx.fillStyle = '#5a7a8a'; ctx.font = '13px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('等待行情数据...', W/2, H/2); return;
  }
  var prices = data.map(function(d){return d.price;});
  var minP = Math.min.apply(null, prices), maxP = Math.max.apply(null, prices);
  var range = maxP - minP || 1, pad = 10, gH = H - pad*2, gW = W - pad*2;
  ctx.strokeStyle = '#1a2c38'; ctx.lineWidth = 1;
  for (var i = 0; i <= 4; i++) {
    var y = pad + (gH/4)*i;
    ctx.beginPath(); ctx.moveTo(pad, y); ctx.lineTo(W-pad, y); ctx.stroke();
    ctx.fillStyle = '#5a7a8a'; ctx.font = '10px sans-serif'; ctx.textAlign = 'right';
    ctx.fillText((maxP - (range/4)*i).toFixed(2), pad-4, y+3);
  }
  var color = data[data.length-1].price >= data[0].price ? KLINE.UP_COLOR : KLINE.DOWN_COLOR;
  ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.beginPath();
  for (var i = 0; i < data.length; i++) {
    var x = pad + (i/(data.length-1))*gW, y = pad + (1-(data[i].price-minP)/range)*gH;
    i === 0 ? ctx.moveTo(x,y) : ctx.lineTo(x,y);
  }
  ctx.stroke();
  ctx.lineTo(pad+gW, pad+gH); ctx.lineTo(pad, pad+gH); ctx.closePath();
  var grad = ctx.createLinearGradient(0,pad,0,pad+gH);
  grad.addColorStop(0, color+'40'); grad.addColorStop(1, color+'05');
  ctx.fillStyle = grad; ctx.fill();
}

// Legacy functions kept for compatibility
function calcMA(data, period) {
  var r = [];
  for (var i = 0; i < data.length; i++) {
    if (i < period-1) { r.push(null); continue; }
    var s = 0; for (var j = i-period+1; j <= i; j++) s += data[j].close;
    r.push(s/period);
  }
  return r;
}
