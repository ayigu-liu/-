# 大猫投资 - 股票模拟交易 架构文档

## 项目概述

多人实时股票市场模拟交易游戏。玩家买卖股票、经营公司、在排行榜上角逐。系统内置多种 AI 对手盘模拟真实市场动态。

### 核心功能矩阵

| 功能域 | 描述 |
|--------|------|
| 股票交易 | 市价单/限价单、融资融券、做空、强制平仓 |
| 公司经营 | 注册公司、发行股票、经营决策、季度财报 |
| AI 市场 | 做市商、机构、游资、量化基金、国家队、散户 |
| 市场监管 | AI SEC 违规检测、持仓超限罚金、高频交易限制 |
| 实时数据 | WebSocket 推送行情、K线、订单簿、成交记录 |

---

## 技术栈

| 层 | 技术 | 说明 |
|----|------|------|
| 后端框架 | Python 3 + FastAPI | 异步 ASGI，WebSocket 原生支持 |
| 数据库 | SQLite + aiosqlite | 单文件数据库，无需额外服务 |
| ORM | SQLAlchemy 2.x (async) | 模型定义 + 异步查询 |
| 数据校验 | Pydantic v2 | 请求/响应 Schema |
| 前端框架 | 原生 JavaScript | 无框架，命令式 DOM |
| 图表 | Canvas 自绘 + TradingView Lightweight Charts v5.2 | K线、分时图、成交量、技术指标 |
| 样式 | 自定义 CSS | 深色主题，CSS 变量体系 |
| 认证 | SHA-256 + 随机盐 | Token 存于 DB，无过期 |

---

## 目录结构

```
jjs/
├── ARCHITECTURE.md               # 本文档
├── requirements.txt              # pip 依赖 → backend/requirements.txt
│
├── backend/                      # Python 后端
│   ├── main.py                   # FastAPI 入口、生命周期、静态文件服务
│   ├── config.py                 # 游戏常量配置
│   ├── database.py               # SQLAlchemy 引擎与会话
│   ├── models.py                 # ORM 模型 (6 个表)
│   ├── schemas.py                # Pydantic 请求/响应模型
│   ├── game_engine.py            # 核心引擎 (~3370 行) ⚠️ 需拆分
│   ├── company_engine.py         # 公司季度运营引擎
│   ├── industry_config.py        # 行业定义 (6 大行业)
│   ├── websocket_manager.py      # WebSocket 房间管理
│   └── routers/
│       ├── auth.py               # 登录/鉴权 API
│       ├── market.py             # 行情/排行/管理员 API
│       ├── company.py            # 公司管理 API
│       └── ws.py                 # WebSocket 端点
│
└── frontend/                     # 静态前端
    ├── index.html                # SPA 入口 (~535 行)
    ├── css/
    │   └── style.css             # 深色主题 (~2621 行)
    └── js/
        ├── utils.js              # 格式化工具、URL 常量
        ├── api.js                # HTTP 请求封装
        ├── auth.js               # 认证状态管理
        ├── websocket.js          # WS 连接/心跳/重连
        ├── gameState.js          # 全局游戏状态对象
        ├── kline.js              # Canvas K线图渲染器 (~1378 行) ⚡ 整体保留
        ├── lightweight-charts.js # TradingView 图表库
        ├── main.js               # WS 消息分发、渲染
        └── ui/
            └── game.js           # 游戏 UI 逻辑 (~1847 行) ⚠️ 需拆分
```

---

## 数据库模型

### ER 图

```
┌──────────┐       ┌──────────────┐       ┌──────────┐
│   User   │       │ PlayerState  │       │ Holding  │
├──────────┤       ├──────────────┤       ├──────────┤
│ id (PK)  │       │ player_id PK │       │ id (PK)  │
│ username │──→──│ nickname     │──→──│ player_id │
│ pwd_hash │       │ cash          │       │ symbol    │
│ salt     │       │ frozen_cash   │       │ qty       │
│ token    │       │ margin_debt   │       │ avg_cost  │
│ is_admin │       └──────────────┘       │ short_qty │
└──────────┘                              └──────────┘
     │
     │          ┌───────────────┐
     ├──────────→│  Transaction  │
     │          ├───────────────┤
     │          │ id (PK)       │
     └──────────→│ player_id     │
                │ symbol        │
                │ trade_type    │  (buy/sell/short_sell/cover)
                │ quantity      │
                │ price         │
                │ total         │
                │ fee_stamp     │
                │ fee_commission│
                │ time          │
                └───────────────┘

┌───────────────┐       ┌────────────────────┐
│   Company     │       │  CompanyQuarterly  │
├───────────────┤       ├────────────────────┤
│ id (PK)       │       │ id (PK)            │
│ player_id     │──→──│ company_id         │
│ name          │       │ q, tick            │
│ symbol (UQ)   │       │ cash, assets       │
│ industry      │       │ revenue, profit    │
│ cash          │       │ employees          │
│ total_assets  │       │ price              │
│ total_shares  │       │ alloc_*            │
│ founding_price│       │ strategy           │
│ employees     │       │ r_and_d_level      │
│ tech_points   │       │ ...                │
│ alloc_pcts    │       └────────────────────┘
│ strategy      │
│ r_and_d_level │
│ locked        │
└───────────────┘
```

---

## 核心引擎架构 (game_engine.py)

### GlobalMarketState

内存中维护的全局游戏状态，是整个系统的单点真相源：

```
GlobalMarketState
├── stocks:    { symbol: { price, history, vwap, change, change_pct, ... } }
├── players:   { player_id: { cash, frozen_cash, margin_debt, portfolio_value } }
├── holdings:  { player_id: { symbol: { qty, avg_cost, short_qty, ... } } }
├── orders:    [ { order_id, player_id, symbol, side, price, quantity } ]
├── candles:   { symbol: { '1t':[], '4t':[], '20t':[], '1d':[] } }
├── tape:      [ { time, price, quantity, side } ]
├── news:      [ { time, text, impact } ]
├── asset_history: { player_id: [ { total_assets, net_assets, ... } ] }
├── industry_cycles: { industry: phase }
└── company_extras: { symbol: { outstanding, pe, pb, ... } }
```

### 核心循环 (price_tick_loop, 每 1.5 秒)

```
Tick 循环 (price_tick_loop)
├── 1. Candle 聚合 (1t → 4t → 20t → 1d)
├── 2. 限价单撮合 (买盘卖盘交叉则自动成交)
├── 3. 成交量不平衡漂移 (imbalance drift)
├── 4. 资产历史更新
├── 5. DB 落盘 (每 15 tick)
├── 6. 融资利息计算
├── 7. SEC 监管检查
├── 8. 排行榜计算 (每 5 tick)
├── 9. 财报处理 (每 QUARTER_TICKS)
├── 10. 行情广播 + 订单簿广播
└── 11. 新闻生成
```

### AI 交易者体系 (7 种类型，8 个并发 loop)

| 类型 | 数量 | Loop | 策略 |
|------|------|------|------|
| 做市商 (Market Maker) | 2 | `ai_buy/sell` | 5 档限价单提供流动性 |
| NPC 交易者 | 100 | `npc_trading_loop` | 价值/动量/均值回归/随机/新闻 |
| 机构投资者 | 3 | `quant_trading_loop` | 大单、分仓、带头效应 |
| 游资 (Hot Money) | 5 | `quant_trading_loop` | 快速进出、追涨停 |
| 量化基金 | 5 | `quant_trading_loop` | 动量/均值回归/随机 |
| 国家队 (National Team) | 4 | `quant_trading_loop` | -10%~-25% 托市 |
| 散户 | 100 | `retail_trading_loop` | FOMO/恐慌/随机 |
| 庄家 | 1 | `zhuangjia_trading_loop` | 吸筹→拉升→洗盘→出货 |

---

## 前端数据流

```
WebSocket (ws)
  │
  ├── price_update ──→ gameState.stocks/candleData/tape ──→ renderStockInfo/kline/tape
  ├── portfolio_update ──→ gameState.cash/holdings ──→ updatePortfolio/holdings
  ├── orderbook ──→ gameState.orderBook ──→ renderDepth
  ├── leaderboard ──→ gameState.leaderboard ──→ renderLeaderboard
  ├── trade_executed ──→ Toast + refreshPortfolio
  ├── news ──→ gameState.newsList ──→ renderNews
  ├── quarterly_report ──→ 动态创建 Modal
  └── pong ──→ 更新延迟显示

REST API (周期性轮询)
  ├── GET /api/market (leaderboard 每 7.5s)
  ├── GET /api/market/trades (成交历史 每 3s)
  ├── GET /api/market/equity_curve (资产曲线 每 10s)
  └── GET /api/market/orders (限价单 每 2s)
```

### 前端文件依赖图

```
utils.js (格式化工具)
  ├──→ api.js (HTTP 封装)
  │     └──→ authToken (来自 auth.js)
  ├──→ auth.js (认证状态)
  │     └──→ api.js, websocket.js
  ├──→ websocket.js (WS 连接)
  │     └──→ main.js (handleWsMessage)
  ├──→ gameState.js (全局状态)
  └──→ kline.js (Canvas 图表)
        └──→ (无依赖, 纯渲染库)

ui/game.js (UI 逻辑)
  └──→ 依赖上述所有文件

main.js (消息分发)
  └──→ 依赖 gameState.js, kline.js, game.js
```

---

## API 路由表

### Auth
| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/auth/login` | 登录(自动注册) |
| GET | `/api/auth/me` | 当前用户信息 |

### Market
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/market` | 行情概览 |
| GET | `/api/market/leaderboard` | 玩家排行 |
| GET | `/api/market/sec-report` | SEC 违规报告 |
| GET | `/api/market/trades` | 成交历史 |
| GET | `/api/market/equity_curve` | 资产曲线 |
| GET | `/api/market/f10` | 公司基本面 (硬编码 DM) |
| GET | `/api/market/orders` | 待成交限价单 |
| GET | `/api/market/kline` | K 线数据 |
| GET | `/api/market/industry` | 行业板块 |
| POST | `/api/market/rename` | 修改昵称 |
| GET/POST | `/api/market/admin/*` | 管理员操盘 (9 个端点) |

### Company
| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/company/create` | 创建公司 |
| GET | `/api/company/my` | 我的公司 |
| GET | `/api/company/ranking` | 公司排行 |
| POST | `/api/company/alloc` | 调整分配比例 |
| POST | `/api/company/announce` | 发布公告 |
| POST | `/api/company/cash-action` | 公司资金操作 |
| POST | `/api/company/decisions` | 提交经营决策 |
| GET | `/api/company/financials` | 季度财务历史 |
| GET | `/api/company/shareholders` | 股东列表 |

### WebSocket
| 路径 | 消息类型 |
|------|----------|
| `ws://host/ws?player_id=xxx` | join, trade, place_order, cancel_order, cancel_all_orders, refresh_portfolio, ping, chat |

---

## 已识别问题清单

### 严重 (Critical)
| # | 文件 | 问题 | 行号 |
|---|------|------|------|
| C1 | `game_engine.py` | 3370 行 God Module，包含 ~20 个职责 | 全文 |
| C2 | `frontend/js/ui/game.js` | 1847 行 God File，93 个函数 | 全文 |
| C3 | `backend/game_engine.py` + `company_engine.py` | 循环依赖 (lazy import) | g:496, c:15 |
| C4 | 全局 | 无自动化测试覆盖 | - |
| C5 | `frontend/js/auth.js` | 明文密码存 localStorage | 111-112 |
| C6 | `frontend/` | 所有函数/变量污染全局 `window` | 全文 |

### 高 (High)
| # | 文件 | 问题 |
|---|------|------|
| H1 | `backend/game_engine.py` | `player_id.startswith()` 模式重复 30+ 次 |
| H2 | `backend/game_engine.py` | `execute_trade()` 400 行 if/elif 链 |
| H3 | `backend/websocket_manager.py` | `broadcast_to_room()` 不存在于 Manager 类，多处调用会 AttributeError |
| H4 | `backend/routers/market.py` | 管理员 API 和公开 API 混合在同一路由 |
| H5 | `backend/auth.py` | 密码使用 SHA-256 (无 bcrypt/argon2) |
| H6 | `backend/game_engine.py` | `_any_stock_sym()` 只返回第一支股票，无法多股票 |
| H7 | `frontend/css/style.css` | 36 处 `!important`，特异性战争 |
| H8 | `frontend/index.html` | 30+ 内联 `onclick` 回调，HTML/JS 强耦合 |
| H9 | `backend/routers/market.py` | `/f10` 端点硬编码仅支持 "DM" |

### 中 (Medium)
| # | 文件 | 问题 |
|---|------|------|
| M1 | `backend/config.py` | `DB_FLUSH_INTERVAL` 常量未使用 |
| M2 | `backend/schemas.py` | `PlayerInfo`/`MarketInfo`/`IndustryInfo` 未使用 |
| M3 | `backend/industry_config.py` | `INDUSTRY_NAMES` 在 `company_engine.py` 中重复定义 |
| M4 | `backend/game_engine.py` + `company_engine.py` | `QUARTER_TICKS = 200` 重复定义 |
| M5 | `backend/routers/market.py` | 10+ 处 lazy import `from backend.game_engine import ...` |
| M6 | `backend/main.py` | Lazy import + 私有属性访问 (`task._coro.__name__`) |
| M7 | `frontend/` | 并发 interval 泄漏 (6+ 个 timer，登出不清理) |
| M8 | `frontend/js/main.js` | `handleWsMessage` 227 行 switch 分支 |
| M9 | `backend/routers/company.py` | `cash_action()` 105 行 if/elif 链 |
| M10 | `backend/routers/company.py` | `get_current_user` 与 auth.py 重复 |

---

## 重构后的目标架构

### Backend (Python 清理后 → 最终 Go 目标)

```
backend/
├── main.py                     # 仅应用启动 (20 行)
├── config.py                   # 保持不变
├── database.py                 # 保持不变
├── models.py                   # 清理未使用 import、修正 JSON 列
├── schemas.py                  # 清理未使用 Schema、添加校验
│
├── core/
│   ├── constants.py            # 全局常量 (bot ID, 时间间隔等)
│   └── market_state.py         # GlobalMarketState 类
│
├── engine/
│   ├── order_book.py           # 订单簿撮合
│   ├── matching.py             # 交易执行
│   ├── tick_loop.py            # 主循环 (只调度，不实现)
│   ├── signals.py              # 信号计算
│   ├── bots/                   # AI 交易者 (每个策略一个文件)
│   │   ├── market_maker.py
│   │   ├── npc.py
│   │   ├── retail.py
│   │   ├── quant.py
│   │   └── zhuangjia.py
│   ├── company.py              # 公司季度处理
│   ├── regulator.py            # SEC + 强制平仓
│   ├── portfolio.py            # 资产计算 + 排行榜
│   └── persistence.py          # 数据持久化
│
├── routers/
│   ├── auth.py
│   ├── market.py               # 仅公开行情
│   ├── admin.py                # 拆分管理员
│   ├── company.py
│   └── ws.py
│
├── websocket_manager.py        # 仅 WS 连接管理
└── static_serve.py             # 静态文件服务
```

### Frontend (React 迁移后)

```
frontend/src/
├── main.tsx                    # React 入口
├── App.tsx                     # 路由 + 布局
│
├── components/
│   ├── auth/ (AuthPage, LoginForm, RegisterForm)
│   ├── layout/ (Header, ConnectionStatus)
│   ├── stock/ (StockInfoBar, StockSelector)
│   ├── chart/ (KlinePanel → 包裹 kline.js 的 React 组件)
│   ├── trade/ (TradePanel, TradeForm, HoldingsTable)
│   ├── market/ (Leaderboard, DepthBook, NewsTicker)
│   ├── company/ (CompanyPanel, Modals, Ranking, Industry)
│   └── admin/ (AdminPanel)
│
├── hooks/
│   ├── useWebSocket.ts         # WS 连接管理
│   ├── useAuth.ts
│   └── useIntervals.ts         # 统一管理所有轮询
│
├── store/                      # Zustand
│   ├── authSlice.ts
│   ├── marketSlice.ts
│   ├── portfolioSlice.ts
│   ├── companySlice.ts
│   ├── uiSlice.ts
│   └── wsMiddleware.ts         # WS 消息 → Store Actions
│
├── lib/
│   ├── api.ts
│   ├── format.ts
│   ├── kline.ts                # kline.js 的 ESM 导出包装
│   └── constants.ts
│
└── types/                      # TypeScript 类型定义
```
