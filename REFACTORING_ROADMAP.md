# 重构路线图

## 总览

| 阶段 | 内容 | 预估工作量 | 风险 | 目标产出 |
|------|------|-----------|------|----------|
| **P0** | 安全修复 + 关键 Bug | 1-2 天 | 低 | 消除安全隐患和运行时错误 |
| **P1** | 后端代码清理（简化 God Module） | 3-5 天 | 中 | `game_engine.py` 拆分为 8+ 模块 |
| **P2** | 前端 JS 清理（为 React 铺路） | 2-3 天 | 中 | 消除全局变量，模块化 |
| **P3** | 补测试（集成测试为主） | 3-5 天 | 低 | 关键路径有测试覆盖 |
| **P4** | 前端 React 迁移 | 7-10 天 | 中 | SPA → React + Zustand |
| **P5** | 后端 Go 迁移 | 15-20 天 | 高 | Golang 服务，生产可用 |

> 每个阶段独立可交付，不阻塞后续阶段但建议按顺序执行。
> P0-P3 以当前 Python+JS 架构为基础做渐进式改进，P4-P5 是技术栈切换。

---

## P0: 安全修复 + 关键 Bug (1-2 天)

### Bug 修复

| # | 文件 | 操作 | 说明 |
|---|------|------|------|
| B1 | `backend/websocket_manager.py` | 添加 `broadcast_to_room()` 方法 | `company.py:233` / `company_engine.py:264,309` 调用不存在的方法 |
| B2 | `backend/game_engine.py:496` + `company_engine.py:15` | 消除循环依赖 | 将 `company_tick_loop` 注册移到 `main.py` 的 lifespan |
| B3 | `backend/main.py:39` | 修正 task 取消逻辑 | 不用 `_coro.__name__`，改用 `asyncio.Task` 的显式引用 |
| B4 | `frontend/js/websocket.js:67` | 心跳在登出时清除 | `handleLogout()` 中加 `clearInterval(_hbInterval)` |
| B5 | `frontend/index.html:524` | 修正多余 `</div>` | HTML 嵌套错误 |

### 安全修复

| # | 文件 | 操作 |
|---|------|------|
| S1 | `backend/auth.py:33` | 密码哈希从 SHA-256 改为 `bcrypt` |
| S2 | `frontend/js/auth.js:111-112` | 移除 `localStorage` 密码存储，只存 token |
| S3 | `backend/models.py:27` | Token 加过期时间字段 |

### 死代码清理

| # | 文件 | 删除内容 |
|---|------|---------|
| D1 | `backend/config.py:8` | `DB_FLUSH_INTERVAL` 未使用常量 |
| D2 | `backend/schemas.py:19-36,88-95` | `PlayerInfo`, `MarketInfo`, `IndustryInfo` 未使用 |
| D3 | `backend/industry_config.py` + `company_engine.py` | 消除 `INDUSTRY_NAMES` 重复定义 |
| D4 | `backend/game_engine.py:2074` | 移除重复的 `QUARTER_TICKS`，统一到 `config.py` |

---

## P1: 后端模块拆分 (3-5 天)

> **目标**: 将 `game_engine.py` (3370 行) 拆分为职责清晰的独立模块。
> **约束**: 不改变游戏行为，纯结构重组。

### 拆分方案

```
backend/engine/                    # 新建目录
├── __init__.py
├── order_book.py                 # _sweep_sell_orders, _sweep_buy_orders,
│                                 #   broadcast_order_book, 订单簿数据结构
├── matching.py                   # execute_trade, _execute_limit_order,
│                                 #   place_limit_order, cancel_limit_order
├── tick_loop.py                  # price_tick_loop (主循环，只做调度)
├── signals.py                    # _compute_signal, _ma
├── portfolio.py                  # calc_player_assets, calc_player_portfolio,
│                                 #   calc_leaderboard, check_forced_liquidation
├── regulator.py                  # sec_regulator_check
├── persistence.py                # mark_dirty, save/load market state
├── initialization.py             # init_global_market, init_npcs
├── price_update.py               # update_price, volume imbalance drift
│
├── bots/
│   ├── __init__.py
│   ├── market_maker.py           # ai_buy_tick, ai_sell_tick
│   ├── npc.py                    # init_npcs (100 NPCs)
│   ├── retail.py                 # 100 retail investors
│   ├── quant.py                  # quant funds + national team + institutions + hot money
│   └── zhuangjia.py              # 4-phase pump cycle
```

### API 层清理

| 文件 | 操作 |
|------|------|
| `routers/market.py` | 管理员端点拆分到 `routers/admin.py` |
| `routers/market.py` | 清理 10+ 处 lazy import，统一移至文件顶部 |
| `routers/company.py` | `_get_current_user` 改用 `auth.py` 的 `get_current_user` |
| `routers/company.py` | `cash_action()` 8 类操作各抽取为独立函数 |
| `routers/ws.py` | 清理 lazy import，拆分为 handler 函数 |
| `main.py` | 静态文件服务拆到 `static_serve.py` |

### 消除技术债

| 操作 | 说明 |
|------|------|
| `player_id.startswith()` 替换 | 为 `PlayerState` 添加 `player_type` 字段 (player/bot_mm/bot_npc/...) |
| `_any_stock_sym()` 改为参数化 | 接受 `state` 和 `symbol`，为多股票铺路 |
| `execute_trade()` 拆分 | buy/sell/short_sell/cover 各独立函数 |
| `models.py` 清理 | `Company.alloc_pcts` 改用 `JSON` 列类型 |
| `config.py` 扩充 | 统一所有魔法数字到配置 |

---

## P2: 前端清理 (2-3 天)

> **目标**: 消除全局变量，模块化 JS，为 React 迁移铺路。
> **约束**: 不引入构建工具，保持 IE 兼容 vs 可维护性的平衡。

### 清理操作

| 操作 | 文件 | 说明 |
|------|------|------|
| 引入命名空间 | 所有 JS | `const App = {}` 包裹所有全局函数和变量 |
| 移除内联 `onclick` | `index.html` | 改用 `addEventListener`，集中事件绑定到 `main.js` |
| 拆分 `game.js` | → 3 个模块 | `portfolio.js`(持仓/交易), `company.js`(公司管理), `panels.js`(浮动面板) |
| 拆分 `main.js` | `handleWsMessage` | 每种消息类型独立 handler 函数 |
| 修正 CSS | `style.css` | 梳理 `!important`，建立组件样式命名规范 |
| 统一工具函数 | `utils.js` | 移除 `game.js` 中重复的 `fmt()`, `escapeHtml()` |
| 登出清理 | `auth.js` | 统一清理所有 interval (6+ 个) 和 WS 连接 |

### 模块化后的 JS 结构

```
frontend/js/
├── app.js                    # App 命名空间入口, DOMContentLoaded
├── utils.js                  # 纯工具函数 (不变)
├── constants.js              # WS_URL, API_URL, 时间间隔常量
├── api.js                    # HTTP 封装 (不变)
├── auth.js                   # Auth.* (命名空间化)
├── websocket.js              # WS.* 连接管理
├── state.js                  # App.State 全局状态对象 (替代 gameState)
├── kline.js                  # 不变
├── handlers/
│   ├── price.js              # price_update 处理
│   ├── portfolio.js          # portfolio_update 处理
│   ├── orderbook.js          # orderbook 处理
│   └── messages.js           # 其他 WS 消息处理
├── ui/
│   ├── components.js         # 可复用渲染函数
│   ├── panels.js             # 浮动面板 (拖拽/最小化/关闭)
│   ├── trade.js              # 交易面板
│   ├── portfolio.js          # 持仓/资产
│   ├── leaderboard.js        # 排行榜
│   ├── market.js             # 盘口/成交记录/新闻
│   └── company.js            # 公司管理
```

---

## P3: 关键路径测试 (3-5 天)

> **目标**: 为核心引擎加测试安全网，减少重构风险。
> **策略**: 集成测试为主，单元测试为辅。使用 `pytest-asyncio`。

### 测试清单

#### 引擎测试 (`tests/engine/`)

```
tests/engine/
├── test_order_book.py        # 订单簿撮合逻辑
│   ├── 买单吃限价卖单
│   ├── 卖单吃限价买单
│   ├── 部分成交
│   ├── 价格优先/时间优先
│   └── 空订单簿
│
├── test_matching.py          # 交易执行 (→ Go 迁移最关键)
│   ├── 买入 (现金充足/不足)
│   ├── 卖出 (持仓充足/不足)
│   ├── 做空/平空
│   ├── 手续费计算
│   ├── 持仓上限检查
│   └── 融资买卖
│
├── test_portfolio.py         # 资产计算
│   ├── 总资产 = 现金 + 持仓市值 - 融券
│   ├── 排行榜排序
│   └── 强制平仓线 (130%)
│
├── test_regulator.py         # SEC 监管
│   ├── 持仓超限罚金 (>25% 流通股)
│   └── 高频交易限制 (>30 笔/60 tick)
│
└── test_bots/                # AI 交易者行为
    ├── test_market_maker.py
    ├── test_npc.py
    └── test_zhuangjia.py
```

#### API 测试 (`tests/api/`)

```
tests/api/
├── test_auth.py              # 登录/注册/鉴权
├── test_market.py            # 行情数据
├── test_company.py           # 公司 CRUD
├── test_ws.py                # WebSocket 消息收发
└── conftest.py               # 共享 fixtures (app, db, state)
```

### 测试策略

- **不追求覆盖率**，优先覆盖：订单簿撮合、交易执行、资产计算、强制平仓
- 使用 SQLite 内存数据库 (`:memory:`) 加速
- 每个测试独立初始化 `GlobalMarketState`（不依赖全局状态）

---

## P4: 前端 React 迁移 (7-10 天)

### 技术选型

| 层 | 选择 | 理由 |
|----|------|------|
| 框架 | React 18 | 生态成熟 |
| 状态管理 | Zustand | 最小模板，匹配现有 `gameState.x = y` 模式 |
| 构建 | Vite | 快速开发，零配置 |
| CSS | Tailwind CSS | 解决 `!important` 危机 |
| 拖拽 | `react-draggable` | 替代 60 行自定义拖拽 |
| 类型 | TypeScript | 为 Go 后端提供类型契约 |
| 图表 | kline.js (包裹) | 自绘 Canvas 无需重写 |

### 迁移步骤 (可增量交付)

```
Phase 4.1: 项目骨架 (2 天)
├── Vite + React + TypeScript 初始化
├── Zustand store 定义 (从 gameState 迁移)
├── API/WS 层封装
└── 暗色主题 Tailwind 配置

Phase 4.2: 认证 + 布局 (1 天)
├── AuthPage (登录/注册)
├── Header (连接状态、倒计时)
└── 路由 (auth vs game 页面)

Phase 4.3: 行情面板 (2 天)
├── StockInfoBar + 闪动动画
├── KlinePanel (包裹 kline.js)
├── 分时图 / K线 切换
└── 指标选择器

Phase 4.4: 交易面板 (2 天)
├── TradeForm (市价/限价/融券)
├── PortfolioSummary (资产统计)
├── HoldingsTable (持仓列表)
├── 浮动面板容器 (react-draggable)
└── 快速买卖按钮

Phase 4.5: 公司与杂项 (1-2 天)
├── CompanyPanel + Modals
├── Leaderboard
├── Industry Market
├── DepthBook / TradeTape / NewsTicker
├── AdminPanel (仅 admin)
└── Toast 通知系统
```

### Zustand Store 设计

```typescript
// 对应游戏引擎推送的所有 WS 消息类型
interface GameStore {
  // market
  stocks: Stock[];
  candles: CandleData;
  dailyStats: DailyStats;
  tape: TradeTapeEntry[];
  orderBook: OrderBookSnapshot;
  newsList: NewsItem[];

  // portfolio
  cash: number;
  frozenCash: number;
  marginDebt: number;
  holdings: Holding[];
  totalAssets: number;

  // company
  myCompany: Company | null;
  industryData: IndustryOverview[];

  // ui
  selectedSymbol: string;
  klinePeriod: 'chart' | '4t' | '1d' | '1w';
  panelVisibility: Record<string, boolean>;

  // actions
  handleWsMessage: (msg: WsMessage) => void;
}
```

---

## P5: 后端 Go 迁移 (15-20 天)

### 技术选型

| 层 | 选择 | 理由 |
|----|------|------|
| Web 框架 | `chi` 或 `echo` | 轻量，接近标准库 |
| WebSocket | `nhooyr.io/websocket` | 现代 API，context 原生支持 |
| ORM | `sqlx` + 原生 SQL | 查询复杂，ORM 反而不便 |
| 数据库 | 初期 SQLite (保留)，后期可换 PostgreSQL | 平滑迁移 |
| 配置 | `envconfig` 或 `viper` | 环境变量驱动 |
| 测试 | 标准 `testing` + `testify` | Go 原生 |
| 日志 | `slog` (Go 1.21+) | 标准库结构化日志 |

### Go 迁移关键设计

```
jjs-server/
├── cmd/server/
│   └── main.go                 # 入口
│
├── internal/
│   ├── config/
│   │   └── config.go           # 所有常量 (来自 config.py)
│   │
│   ├── domain/                 # 领域模型 (来自 models.py)
│   │   └── models.go           # User, PlayerState, Holding, Company
│   │
│   ├── engine/                 # 核心引擎 (来自 game_engine.py)
│   │   ├── state.go            # GlobalMarketState → 带 RWMutex 的 struct
│   │   ├── orderbook.go        # 订单簿 + 撮合
│   │   ├── matching.go         # 交易执行 (executeTrade)
│   │   ├── ticker.go           # 主循环 goroutine
│   │   ├── signals.go          # 信号计算
│   │   ├── bots/               # AI 交易者 (各一个 goroutine)
│   │   ├── company.go          # 公司季度处理
│   │   ├── regulator.go        # SEC + 强制平仓
│   │   └── portfolio.go        # 资产 + 排行榜
│   │
│   ├── store/                  # 数据持久层 (来自 database.py)
│   │   ├── db.go               # 连接池
│   │   ├── user.go
│   │   ├── player.go
│   │   ├── company.go
│   │   └── transaction.go
│   │
│   ├── handler/                # HTTP 处理器 (来自 routers/)
│   │   ├── auth.go
│   │   ├── market.go
│   │   ├── admin.go
│   │   ├── company.go
│   │   └── ws.go               # WebSocket
│   │
│   └── middleware/
│       ├── auth.go
│       └── static.go
│
└── web/ → frontend 构建产物      # Vite build 的 dist/
```

### Go 迁移步骤

```
Phase 5.1: 基础设施 (3 天)
├── 项目骨架, 依赖管理
├── config 模块
├── DB 连接池 + 迁移
├── domain models (struct 定义)
└── 中间件 (auth, CORS, 静态文件)

Phase 5.2: 引擎核心 (5 天)
├── GlobalMarketState (struct + RWMutex)
├── orderbook (线程安全)
├── matching (交易匹配引擎)
├── ticker (主循环 goroutine + context 取消)
├── 行情更新 + candle 聚合
└── persistence (定期落盘)

Phase 5.3: AI 交易者 (4 天)
├── 抽象 Bot 接口
├── MarketMaker
├── NPC (100 个, 5 策略)
├── Quant (量化 + 机构 + 游资 + 国家队)
├── Retail (100 个散户)
└── Zhuangjia (庄家 4 阶段)

Phase 5.4: 系统功能 (3 天)
├── 融资融券 + 强制平仓
├── SEC 监管
├── 公司季度结算
├── 新闻生成
└── 排行榜

Phase 5.5: API + WS (3 天)
├── REST API 处理器
├── WebSocket 端点
├── 管理员端点
├── 前端静态文件服务
└── 集成测试
```

### Go vs Python 关键差异

| 方面 | Python (当前) | Go (目标) |
|------|--------------|-----------|
| 并发模型 | asyncio 协程 (单线程) | Goroutine + Channel |
| 状态保护 | GIL + 协作式 => 无锁 | `sync.RWMutex` 显式保护 |
| 类型安全 | 动态类型, dict 宽松 | 静态类型, 编译期检查 |
| 错误处理 | 异常 (try/except) | 显式 error 返回值 |
| Bot 通信 | 直接调用函数 | Channel 消息传递 |
| DB 持久化 | 定时批量 `mark_dirty` | 可按需写入 (连接池) |
| 测试 | pytest (外部依赖) | 标准库 testing + benchmark |

---

## 里程碑汇总

```
Week 1-2:  P0 安全修复 + P1 后端拆分
Week 3:    P2 前端清理
Week 4-5:  P3 补测试 (可与 P1-P2 并行)
Week 6-7:  P4 前端 React 迁移
Week 8-10: P5 后端 Go 迁移
```

> 如前后端分工并行：前端直接跳到 P4（跳过 P2），后端同时做 P0+P1+P3+P5，总工期约 **6-8 周/2 人**。
