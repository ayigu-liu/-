# AI 交易者系统设计

> 统一因子评分模板，100 个 AI 交易者按相同决策框架运行，差异仅在于策略权重向量不同。

---

## 一、设计原则

- **不区分类别**。所有 AI 交易者为同一 `AiTrader` 类型的实例，通过不同权重配置体现风格差异。
- **统一因子模型**。每个 AI 对候选股票计算 12 个因子 × 策略权重 → 综合信号 → 限价下单。
- **买卖对抗**。同一支股票的不同策略 AI 会得出相反的信号，形成自然的对手盘和价差。
- **基本面锚定**。市场整体理性权重 ≥ 53%，非理性行为产生波动但不脱锚。
- **自循环生命周期**。AI 资金耗尽后退出，系统自动补充新生 AI，维持市场参与者数量稳定。

---

## 二、核心数据结构

### 2.1 AiTrader

```go
type AiTrader struct {
    ID             string       // "bot_0001" ~ "bot_0100"
    Strategy       *Strategy    // 策略权重配置
    CooldownTicks  int          // 两次操作间隔 tick 数
    RiskTolerance  float64      // 0.15~0.6, 影响仓位激进程度
    CoolDownLeft   int          // 剩余冷却 tick
    SpawnedAt      time.Time
}
```

AI 交易者的现金和持仓复用现有 PlayerState + Holding 表（bot ID 作为 player_id 存入），与人类玩家走同一数据库路径。

### 2.2 Strategy

```go
type Strategy struct {
    Name    string
    Weights map[string]float64   // factorName → weight, 所有权重之和 = 1.0
}
```

### 2.3 Factor & FactorContext

```go
type Factor struct {
    Name string
    Fn   func(ctx *FactorContext) float64   // 输出 [-1, +1]
}

type FactorContext struct {
    Stock           *domain.Stock
    Company         *domain.Company
    CompanyQuarterly []domain.CompanyQuarterly   // 近 8 季
    Prosperity      float64
    PriceHistory    []int64
    MA5, MA20       int64
    AvgVolume       int64
    Holding         *domain.Holding
    PlayerState     *domain.PlayerState
    IndustryConfig  *config.IndustryConfig
}
```

---

## 三、因子体系（12 个）

因子分为三组：理性因子（6 个）、非理性/行为因子（5 个）、噪声因子（1 个）。

### 3.1 理性因子（价值导向）

| # | 因子名 | 计算方式 | 输出逻辑 |
|---|--------|---------|---------|
| F1 | **pe_discount** | `(industryPE - currentPE) / industryPE`, clamp [-1, 1] | PE 低于行业 → +1（低估），高于 → -1（高估） |
| F2 | **eps_growth** | `(近4季平均EPS - 前4季平均EPS) / max(前4季平均EPS, 1)`, clamp [-1, 1] | 盈利增长 → +1 |
| F3 | **nav_discount** | `(nav - price) / nav`, clamp [-1, 1] | 股价低于净资产 → +1（折价安全边际） |
| F4 | **revenue_growth** | `(近4季营收 - 前4季营收) / max(前4季营收, 1)`, clamp [-1, 1] | 营收扩张 → +1 |
| F5 | **profit_margin** | `(近4季平均利润率 - 行业平均利润率) / max(行业平均利润率, 0.01)`, clamp [-1, 1] | 利润率高于行业 → +1 |
| F6 | **prosperity** | `(当前景气度 - 1.0) × 2`, clamp [-1, 1] | 景气上行 → +1 |

### 3.2 非理性因子（行为偏差）

| # | 因子名 | 计算方式 | 输出逻辑 |
|---|--------|---------|---------|
| F7 | **chase** (追涨) | 近 10tick 涨跌幅 / 0.05, clamp [-1, 1] | 涨超 5% → +1（越涨越买） |
| F8 | **panic** (杀跌) | `−(近 10tick 涨跌幅) / 0.05`, clamp [-1, 1] | 跌超 5% → +1（越跌越卖）*方向取反后作为卖出信号* |
| F9 | **vertigo** (恐高) | 持仓盈利 > 30% → +1, 线性插值 | 赚多了 → 卖出倾向 |
| F10 | **stubborn** (死扛) | 持仓亏损 > 30% → +1, 线性插值 | 亏多了 → 补仓倾向 |
| F11 | **herd** (从众) | `(近10tick 均量 - 全市场均量) / 全市场均量`, clamp [-1, 1] | 放量 → +1（跟风买），缩量 → -1（冷门卖） |

> **注**：追涨/杀跌/恐高/死扛/从众都是行为金融学经典偏差——追涨杀跌制造趋势，恐高死扛制造反转，从众形成热门股抱团。

### 3.3 噪声因子

| # | 因子名 | 计算方式 | 输出逻辑 |
|---|--------|---------|---------|
| F12 | **noise** | `random(-1, +1)` | 纯随机扰动 |

> **PE 动态计算**：PE 从 CompanyQuarterly 实时计算，不存储在 Stock 表中。`EPS_季均 = avg(近4季 Profit) / TotalShares`，`PE = CurrentPrice / EPS_季均`。F1 pe_discount 使用此动态 PE 与 `IndustryConfig.PE` 对比。

---

## 四、策略权重配置

7 种策略，覆盖从纯理性到纯噪声的全部风格。**约束**：每个策略的非理性权重总和 ≤ 50%（noise 策略除外）。

| 因子 | value | growth | momentum | contrarian | balanced | national | noise |
|------|:-----:|:------:|:--------:|:----------:|:--------:|:--------:|:-----:|
| pe_discount | 25 | 5 | 0 | 10 | 10 | 30 | 5 |
| eps_growth | 15 | 25 | 0 | 5 | 10 | 0 | 5 |
| nav_discount | 15 | 5 | 0 | 10 | 10 | 25 | 5 |
| revenue_growth | 10 | 25 | 0 | 0 | 10 | 0 | 5 |
| profit_margin | 5 | 15 | 0 | 0 | 5 | 0 | 5 |
| prosperity | 5 | 5 | 0 | 0 | 5 | 0 | 5 |
| chase | 0 | 10 | 40 | 0 | 10 | 0 | 5 |
| panic | 0 | 0 | 0 | 0 | 10 | 10 | 5 |
| vertigo | 0 | 0 | 5 | 5 | 5 | 0 | 5 |
| stubborn | 5 | 0 | 0 | 40 | 5 | 10 | 5 |
| herd | 0 | 5 | 30 | 15 | 5 | 10 | 5 |
| noise | 5 | 5 | 25 | 15 | 15 | 15 | 45 |
| **理性合计** | **75%** | **80%** | **0%** | **25%** | **50%** | **55%** | **30%** |
| **非理性合计** | **5%** | **15%** | **75%** | **60%** | **35%** | **30%** | **25%** |

> 注：chase 和 panic 是方向性因子，在最终信号计算时通过买卖方向体现。数值上 panic 为正值表示"应该卖出"。

### 4.1 实例分布（100 个）

| 策略 | 数量 | 风格一句话 |
|------|:---:|-----------|
| value | 20 | 寻找低估，持有等回归 |
| growth | 17 | 追增长，轻估值 |
| momentum | 14 | 趋势交易，追涨放量 |
| contrarian | 12 | 反向操作，跌买涨卖 |
| balanced | 23 | 多因子均衡 |
| national | 3 | 托市 + 价值锚 |
| noise | 11 | 纯随机噪声 |

### 4.2 个体差异

每个 AiTrader 实例在基准权重上叠加随机扰动（每个权重 ±random(0, 基准值×20%)），然后重新归一化使权重和 = 1.0。CooldownTicks 和 RiskTolerance 在各自范围内独立随机。

---

## 五、市场情绪指数

### 5.1 计算

```
marketSentiment ∈ [-1, 1]
每 tick 更新一次:

  rawSentiment = median(本 tick 所有 AI 的原始 signal) + 0.3 × (mean - median)
  marketSentiment = 0.7 × 上期 marketSentiment + 0.3 × rawSentiment
  // 中位数为主，均值为微调；EMA 平滑避免跳变
```

### 5.2 传导

```
每个 AI 的最终信号:
  finalSignal = 0.85 × rawSignal + 0.15 × marketSentiment
```

15% 的情绪传导模拟信息级联（Information Cascade）——所有 AI 都轻微跟风市场情绪。既不过度同质化（仍由因子主导），又能产生趋势自我强化。

### 5.3 信号扰动与反转

为防止所有 AI 同向操作导致零成交，对 finalSignal 做两层随机干预：

```
finalSignal = finalSignal + ε × random(-1, 1)    // ε = 0.15，小幅抖动
if random() < 15%:
    finalSignal = randomDirection × random(0.21, 0.50)  // 强制随机翻转
```

- **抖动**：弱信号区间（0.2-0.4）可能翻转方向，形成自然对手盘
- **抽签翻转**：每 tick 15% 的决策完全忽略因子，随机选择买卖方向和中等强度信号，确保任何时候都有人在卖

---

## 六、下单决策

### 6.1 信号阈值与订单类型

```
|finalSignal| ≤ 0.2  →  不操作
 finalSignal  > 0.2  →  买入
 finalSignal  < -0.2 →  卖出

|信号| > 0.5  →  市价单（强信心，立即成交跨价差）
|信号| ≤ 0.5  →  限价单（弱信心，挂单提供流动性）
```

### 6.2 买入规模

```go
availableCash = Cash - FrozenCash
maxSpend      = availableCash × riskTolerance × |finalSignal|
qty           = maxSpend / referencePrice
qty           = clamp(qty, 100, MaxOrderQty)
```

### 6.3 卖出规模

```go
availableQty = Holding.Qty - Holding.FrozenQty
maxSell      = availableQty × riskTolerance × |finalSignal|
qty          = clamp(maxSell, 100, MaxOrderQty)
```

### 6.4 限价单价格（信号驱动宽幅报价）

报价不再固定在现价附近，而是由信号强度决定浮动范围：

```
basePrice = CurrentPrice
maxSpread = 0.30 (30%)

买入:
  maxPremium  = |signal| × maxSpread        // 强信号报价接近甚至超过现价
  maxDiscount = (1 - |signal|) × maxSpread   // 弱信号报价大幅低于现价
  price = basePrice × random(1 - maxDiscount, 1 + maxPremium)

卖出:
  maxDiscount = |signal| × maxSpread
  maxPremium  = (1 - |signal|) × maxSpread
  price = basePrice × random(1 - maxDiscount, 1 + maxPremium)
```

| |signal| | 买单范围 | 卖单范围 | 行为 |
|:---:|------|------|------|
| 0.90 | 97%~127% | 73%~103% | 买卖区间大幅重叠，大概率跨价差成交 |
| 0.50 | 85%~115% | 85%~115% | 区间完全重叠，快速定价 |
| 0.21 | 76%~106% | 94%~124% | 重叠极小，提供远端买卖盘 |

### 6.5 撤单策略

每 tick 评估已挂订单，不会无条件全部撤销：

```
对每个挂单:
  ├─ 股票不存在或价格归零 → 撤
  ├─ 挂单存活 > 120s → 撤（硬超时）
  ├─ 买单: (现价 - 挂单价) / 现价 > 5% → 撤（价格已远离）
  ├─ 卖单: (挂单价 - 现价) / 现价 > 5% → 撤
  └─ 上述均不满足 → 保留（等待成交）
```

宽幅报价 + 5% 撤单阈值确保订单有足够时间被对手盘吃下。保留的订单仍冻结资金/持仓，新订单量由 `可用资金 - 冻结` / `可用持仓 - 冻结` 自动控制。

---

## 七、每 Tick 执行流程

```
ScheduleTick(db) 每 2s 触发一次:

   [t0] 选到期 AI:
        遍历 100 个 AiTrader, CoolDownLeft == 0 → ready[]
        对每个 ready trader: 撤销其全部未成交挂单（释放资金/持仓）
        log: 到期数 + 耗时

  [t1] 采样股票 + 构建上下文:
       对每个 ready trader:
         stocks = randomSample(stockList, 20%), max 20
         if len(stockList) < 15 → min 3
         对每个 stock:
           build FactorContext (含 DB 查询)
       log: 上下文数 + 耗时

  [t2] 计算信号:
       对每个 (trader, stock) 对:
         12 因子 × 策略权重 → rawSignal
         finalSignal = 0.85 × rawSignal + 0.15 × marketSentiment
         |finalSignal| > 0.2 → 限价下单
       log: 信号数 + 下单数 + 耗时

  [t3] 更新状态:
       - 更新每个操盘手的 CoolDownLeft = CooldownTicks
       - 批量写入 orders 表
       - 更新 marketSentiment
       log: 下单数 + 耗时

  [汇总] log: 到期数/信号数/下单数/总耗时
          if total > 1_000_000μs → WARN
```

---

## 八、止损闸门

止损是独立的风险闸门，在因子计算**之前**执行。触发止损的股票跳过本轮因子计算。

### 8.1 止损条件

```
if holding != nil && holding.Qty > 0:
    gainPct = (currentPrice - avgCost) / avgCost
    threshold = -(0.25 + riskTolerance × 0.60)   // [-34%, -61%]
    if gainPct < threshold:
        → 市价全平该持仓
        → 跳过该股票的因子计算
```

### 8.2 阈值范围

| RiskTolerance | 止损线 | 含义 |
|:---:|:---:|---|
| 0.15（低） | -34% | 略高于死扛触发线(-30%)，低容忍 bot 先于死扛出场 |
| 0.35（中） | -46% | 有空间触发死扛 + 网格补仓 1-2 次后才止损 |
| 0.60（高） | -61% | 深度套牢时才止损，给足逆向策略操作空间 |

### 8.3 与行为因子的关系

止损不改变死扛/网格/恐高因子的计算逻辑。时序自然分层：
- 浮亏 30% → 死扛因子触发买入（因子阶段）
- 浮亏 46% → 止损闸门触发全平（因子前阶段，中容忍 bot）
- 下单方式为市价卖，确保立即成交离场

---

## 九、生命周期

### 9.1 初始化

```go
func spawnTrader(strategy *Strategy) *AiTrader {
    cash := randomRange(500_000, 50_000_000) 分  // ¥5,000 ~ ¥500,000
    db.Create(&PlayerState{PlayerID: id, Cash: cash})
    // 不创建 Holding —— 零持仓起步，通过后续 tick 自然建仓
    return &AiTrader{
        ID:            id,
        Strategy:      strategy,
        CooldownTicks: randomRange(5, 30),
        RiskTolerance: randomRange(0.15, 0.60),
        CoolDownLeft:  0,  // 首 tick 即可行动
    }
}
```

### 9.2 耗尽重置

不删除 PlayerState 行（保留历史交易记录），直接重置同一 bot_id：

```go
if playerState.Cash < 10_000 && holdingValue == 0 {
    // 充值随机资金
    playerState.Cash = randomRange(500_000, 50_000_000)
    playerState.FrozenCash = 0
    // 重新分配策略 + 参数
    trader.Strategy = weightedPick(strategyDistribution)
    trader.CooldownTicks = randomRange(5, 30)
    trader.RiskTolerance = randomRange(0.15, 0.60)
    trader.CoolDownLeft = 0
}
```

### 9.3 补给检查

每 100 tick（~200s）检查一次，遍历所有 100 个 bot，对耗尽的执行重置。

> **Strategy 不持久化**：重启恢复时，所有 bot 的 Strategy 随机重新分配。PlayerState/Holding 持久化保留 bot 的财务状态。

---

## 十、统计与监控

### 9.1 内存计数器

```go
type BotMetrics struct {
    mu              sync.Mutex
    TotalSignals    int64
    TotalOrders     int64
    BuyOrders       int64
    SellOrders      int64
    ActiveTraders   int
    DepletedTraders int
    TickTimings     ringBuffer  // 最近 50 tick 耗时(μs)
}
```

### 9.2 每 Trader 统计

```go
type TraderStats struct {
    ID           string
    Strategy     string
    SpawnedAt    time.Time
    TotalTrades  int
    TotalBuyQty  int64
    TotalSellQty int64
    InitialCash  int64
    CurrentCash  int64
    CurrentValue int64        // 持仓市值
}
```

### 9.3 调试端点

```
GET /api/admin/bots/metrics       → BotMetrics 快照
GET /api/admin/bots/traders      → 各策略存活数/收益率汇总
```

统计仅存内存和日志，不持久化到 MySQL。后期如需长期分析可写入独立 metrics 表。

---

## 十一、目录结构

```
jjs-server/internal/bots/
├── ai_trader.go     # AiTrader struct + Strategy 权重预设 + 初始化
├── factors.go       # 12 因子计算函数（分理性/非理性注释）
├── scheduler.go     # ScheduleTick: 分层耗时日志 + 情绪指数更新
├── lifecycle.go     # 零持仓初始化 + 枯竭重置 + 新生补充
├── sentiment.go     # 市场情绪指数计算 + EMA 平滑
├── stoploss.go      # 止损闸门（RiskTolerance 联动）
├── metrics.go       # BotMetrics 实时计数器 + 订单构建
└── helpers.go       # PlayerState/Holding 缓存辅助
```

---

## 十二、关键常量

| 参数 | 值 | 说明 |
|------|-----|------|
| 交易者总数 | 100 | 固定目标数量 |
| 初始资金范围 | ¥5,000 ~ ¥500,000 | 按分存储 (500,000 ~ 50,000,000) |
| CoolDown 范围 | 5 ~ 30 tick | 10s ~ 60s 间隔 |
| RiskTolerance | 0.15 ~ 0.60 | 仓位激进程度 |
| 采股比例 | 20% | 全市场随机采样，上限 20 支 |
| 最少采股数 | 3 | 全市场 < 15 支时触发 |
| 信号阈值 | 0.2 | \|signal\| > 0.2 才下单 |
| 市价单阈值 | 0.5 | \|signal\| > 0.5 用市价单 |
| 报价最大偏离 | 30% | 信号驱动宽幅报价上限 |
| 情绪传导系数 | 0.15 | finalSignal = 0.85×raw + 0.15×sentiment |
| 情绪 EMA 系数 | 0.3 | sentiment = 0.7×old + 0.3×new |
| 信号抖动幅度 | 0.15 | finalSignal += random(-0.15, +0.15) |
| 随机翻转比例 | 15% | 每 tick 随机忽略信号选方向 |
| 止损基准偏移 | 0.25 | threshold = -(0.25 + RT×0.60) |
| 退出现金阈值 | ¥100 (10,000分) | 现金 + 持仓为零时重置 |
| 补给检查间隔 | 100 tick | ~200s |
| 撤单偏差阈值 | 5% | 挂单价偏离市价 > 5% 时撤单 |
| 撤单最大年龄 | 120s | 挂单硬超时 |
