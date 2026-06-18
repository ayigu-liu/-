# 重写路线图

## 核心原则

> **不做渐进式重构，做完整重写。** 既有代码（`backend/`、`frontend/`）不做任何修改，仅作为功能设计、UI 风格、游戏规则的参考文档。新代码在独立目录中从零构建。

| 原则 | 说明 |
|------|------|
| 旧代码只读 | 不修 Bug、不拆分模块、不清理技术债 |
| 新代码独立 | 新项目目录与旧代码完全隔离 |
| 功能对等 | 新系统覆盖旧系统的全部功能，但不复制其实现 |
| 设计优化 | 在重写时纠正已知设计问题（bcrypt、token 过期、类型安全等） |
| 玩法优先 | 先完成公司运营 v2 + 个人资产基础，再在其上构建股票交易 |

---

## 总览

| 阶段 | 内容 | 预估工作量 | 风险 | 目标产出 |
|------|------|-----------|------|----------|
| **P1** | 项目骨架与基础设施 | 3-4 天 | 低 | ✅ 已完成 |
| **P2** | 公司运营 v2 + 个人资产 | 7-9 天 | 中 | AP 行动点系统、董事会/KPI、研发、随机事件、玩家资产 |
| **P3** | 核心交易引擎 | 5-7 天 | 高 | 订单簿、撮合、行情、股票交易 |
| **P4** | AI 交易者系统 | 4-5 天 | 中 | 6 类 Bot 全部实现 |
| **P5** | 业务系统 | 4-5 天 | 中 | 融资融券、SEC、市场新闻、排行榜 |
| **P6** | API + WebSocket | 3-4 天 | 低 | REST + WS 完整可用 |
| **P7** | 前端 React 重写 | 8-11 天 | 中 | React SPA，UI 风格对齐旧版 |
| **P8** | 测试与收尾 | 5-7 天 | 低 | 关键路径测试覆盖，生产可用 |

> **总计**: 39-52 天 / 单人，或 5-6 周 / 2 人（前后端并行）。
> 
> **核心依赖链**: P1 → P2（公司运营 v2 / 资产）→ P3（交易引擎）→ P4（AI）→ P5（业务系统）→ P6（API）→ P7（前端）→ P8（测试）
> 
> 交易功能（P3）必须在公司运营 + 玩家资产（P2）完成后才能开始，因为股票由公司发行、流通股由公司决定、股价公式由公司基本面驱动。

---

## P1: 项目骨架与基础设施 (3-4 天)

> **目标**: 建立新项目的完整骨架，Go 后端 + React 前端均可独立启动运行。

### 技术选型

| 层 | 选择 | 理由 |
|----|------|------|
| Web 框架 | `chi` | 轻量，接近标准库 |
| ORM | **GORM** | 生态成熟，迁移/关联/事务支持完善 |
| 数据库 | **MySQL 8.0+** | 生产级，适合长期运营 |
| 认证 | `golang-jwt` + `bcrypt` | 标准方案 |
| 日志 | `slog` (Go 1.21+) | 标准库结构化日志 |
| 配置 | `envconfig` | 环境变量驱动 |

### 参考旧代码 / 设计文档

| 文件 | 用途 |
|------|------|
| `backend/config.py` | 提取所有常量和魔法数字 |
| `backend/models.py` | 提取数据模型定义 |
| `backend/database.py` | 理解 DB 表结构和持久化策略 |
| `backend/auth.py` | 理解认证流程（重写时改用 bcrypt） |
| `backend/main.py` | 理解服务启动流程和生命周期 |

### P1.1: Go 后端骨架 (1.5 天)

```
jjs-server/                        # 新建项目根目录
├── go.mod
├── go.sum
├── cmd/server/
│   └── main.go                    # 入口，服务启动
├── internal/
│   ├── config/
│   │   └── config.go              # 从 config.py 迁移所有常量
│   ├── domain/
│   │   └── models.go              # GORM 模型定义
│   ├── store/
│   │   ├── db.go                  # GORM MySQL 连接 + AutoMigrate
│   │   └── user.go                # 用户 CRUD
│   ├── handler/
│   │   ├── auth.go                # 注册/登录（bcrypt + JWT）
│   │   └── health.go              # 健康检查
│   └── middleware/
│       ├── auth.go                # JWT 鉴权中间件
│       ├── cors.go                # CORS
│       └── static.go              # 前端静态文件服务
└── web/                           # 前端构建产物目录（P7 产出）
```

**产出清单**:
- Go module 初始化，依赖引入（`chi`, `gorm`, `mysql-driver`, `golang-jwt`, `bcrypt`, `slog`）
- `config.go` 完整迁移旧版所有常量，MySQL DSN 配置
- `models.go` 完整定义所有 GORM 模型 struct（带类型安全、关联关系），其中公司模型需预留 v2 字段（AP 系统、研发等级、董事会满意度等）
- GORM AutoMigrate 自动建表，MySQL 连接池
- 注册/登录 API 可用（密码 bcrypt 哈希，JWT 签发）
- 健康检查端点

### P1.2: React 前端骨架 (1.5 天)

```
jjs-web/                # 前端源码目录
├── package.json
├── vite.config.ts
├── tsconfig.json
├── tailwind.config.ts
├── index.html
└── src/
    ├── main.tsx
    ├── App.tsx
    ├── router.tsx                  # TanStack Router 路由定义
    ├── stores/                    # Zustand
    │   ├── authStore.ts
    │   └── gameStore.ts           # WS 实时数据 + UI 状态
    ├── api/
    │   ├── client.ts              # HTTP 封装
    │   ├── queries.ts             # TanStack Query hooks
    │   └── ws.ts                  # WebSocket 封装
    ├── pages/
    │   ├── AuthPage.tsx
    │   └── GamePage.tsx
    ├── components/
    │   └── Header.tsx
    └── types/
        └── index.ts               # 所有 TS 类型定义
```

### 前端技术选型

| 层 | 选择 | 理由 |
|----|------|------|
| 框架 | React 18 + TypeScript | 类型安全，生态成熟 |
| 路由 | **TanStack Router** | 类型安全路由，文件式或编程式 |
| 服务端状态 | **TanStack Query** | 缓存/重取/乐观更新，减少手动状态管理 |
| 客户端状态 | Zustand | WebSocket 实时数据、UI 状态 |
| 构建 | Vite | 快速 HMR，零配置 |
| CSS | Tailwind CSS | 统一设计系统 |
| 拖拽 | `react-draggable` | 浮动面板 |

> 状态分层：**TanStack Query** 管理 HTTP 请求缓存（行情快照、公司列表、排行榜），**Zustand** 管理 WebSocket 实时流（价格推送、盘口变化）和 UI 状态（面板显隐、选中股票），二者互补而非替代。

**产出清单**:
- Vite + React 18 + TypeScript + Tailwind CSS 项目初始化
- TanStack Router 路由配置（auth ↔ game）
- TanStack Query 客户端 + query hooks 骨架
- Zustand store 骨架（auth + game state）
- HTTP 客户端 + WebSocket 客户端封装
- 暗色主题基础 Tailwind 配置（参考旧版 `style.css` 配色）
- AuthPage（登录/注册表单）
- GamePage（空壳，等待后续阶段填充）

### P1 完成状态（2026-06-18）

> P1 骨架已全部实现并在本地验证通过。Go 后端与 React 前端的 auth 链路（注册→登录→JWT→bcrypt→SPA 路由）完整贯通。

**jjs-server（全部完成）**：
- Go 项目初始化，依赖齐全（chi / gorm + mysql / golang-jwt / bcrypt / envconfig / slog）
- `config.go`：完整迁移旧版常量 + env + config.json 三层配置合并
- `models.go`：7 个 GORM 模型定义（公司 v2 字段已全部移除，保留极简骨架：CEOID/Name/Industry/Cash/Employees/Quarter/Status）
- `store/`：GORM+MySQL 连接池 + AutoMigrate 自动建表 + 用户 CRUD（bcrypt）
- `handler/`：注册/登录/Me 端点，JWT HS256 签发，bcrypt 密码校验
- `middleware/`：JWT 鉴权 + 可选鉴权 + CORS + 前端静态文件 SPA fallback
- `cmd/server/`：chi router 组装 + graceful shutdown

**jjs-web（骨架完成，以下为 P1 范围内的待完善项）**：
- Vite + React 18 + TypeScript + Tailwind CSS + Zustand + TanStack Query 全部就位
- authStore（persist to localStorage）+ gameStore（WS 数据 + UI 状态）
- ApiClient（auto-attach JWT, 401 auto-logout）+ WsClient（exponential backoff reconnect）
- 多个 TanStack Query hooks 已定义
- AuthPage：登录/注册双 Tab，错误处理，loading 状态
- GamePage：拆分为 GameLayout + 5 个路由页面，底部 Dock 导航（市场/持仓/交易/公司/排行）
- 浮动面板系统已移除，全部迁入路由页面
- TanStack Router 已接入并驱动所有导航，auth guard 在 beforeLoad 中实现
- Header 响应式适配（sm/md 三档），退出按钮移入昵称下拉菜单
- 完整的 TS 类型定义（CompanyState/QuarterlyReport 已精简为极简字段，去掉 v2 预留类型）

**P1 遗留事项（不阻塞 P2，可在后续顺手修复）**：
- ESLint 配置缺失（ESLint v9 需要 `eslint.config.js`，当前无配置文件，`pnpm lint` 报错）
- ~~TanStack Router 已安装但未使用——当前仅 2 页，用简单条件渲染替代路由；P7 阶段再接入~~ ✅ 已接入 (2026-06-18)
- ~~Header 现金显示为硬编码 `¥--`——等待 P2 个人资产系统接入后替换~~ ✅ 已修复 (2026-06-18)

---

## P2: 公司运营 (7-9 天)

> **目标**: 从极简公司骨架开始，逐阶段构建公司经营系统（创建 → 季度结算 → 破产清算）。
>
> **策略变更**: 不要一次做太多。先搭好公司基础生命周期，AP/董事会/KPI/研发等字段在实现对应功能时按需添加到 `Company` 表，不预留未使用的字段。

### 参考文档

| 文件 | 用途 |
|------|------|
| `COMPANY_V2_DESIGN.md` | v2 完整设计（各阶段组件参考，非一次性实现） |
| `simulate_v2.py` | 数值模拟脚本 |
| `backend/company_engine.py` | v1 公司季度结算（仅参考流程结构） |
| `backend/industry_config.py` | v1 行业分类 |

### P2.1 完成状态（2026-06-18）

> P2.1 已实现：行业常量配置 + 三维数据模型 + 公司创建/状态查询 API + 路由拆分 + 前端公司页。

**新增文件**：

| 文件 | 说明 |
|------|------|
| `internal/engine/industry.go` | 6 行业完整常量配置（PE/人均营收/起始参数/天花板参数/淤积类型） |
| `internal/store/company.go` | 公司 CRUD + 建造队列 + 季度报表查询 |
| `internal/handler/company.go` | `POST /api/company/create` + `GET /api/company/state` |
| `internal/router/router.go` | 从 main.go 提取全部路由注册 |

**Company 模型新增字段**：

```go
type Company struct {
    gorm.Model
    CEOID     string    // 当前CEO
    Symbol    string    // 股票代码，唯一索引
    Name      string    // 公司名
    Industry  string    // 行业
    Cash      float64   // 现金
    Employees int       // 员工数（驱动力）
    Quarter   int       // 当前季度
    Status    string    // active | bankrupt
    // P2.1 新增
    TotalShares int     // 总股本（行业常量，创建时写入）
    CapCount    int     // 天花板单元数量
    Inventory   float64 // 物理淤积量（制造/能源库存，其余行业=0）
    SludgeLevel int     // 状态淤积等级（消费品牌冷却/医疗管线积压）
}
```

**CapBuildOrder 表（新建）**：

```go
type CapBuildOrder struct {
    gorm.Model
    CompanyID    uint  // 所属公司
    ReadyQuarter int   // 建造完成的全局季度号
    Completed    bool  // 是否已完成
}
```

支持多季度连续扩产：每次扩产插入一行，季度结算时检查到期行，建造成本立即扣除。

**CompanyQuarterly 新增快照字段**：`TotalShares`, `CapCount`, `Inventory`, `SludgeLevel`
——创建公司时自动写入 Q0 快照（`quarter=0`）作为图表起始点。

**行业三维的 DB 表示**（设计文档 §七细化）：

淤积拆分为 2 个通用字段覆盖 6 个行业：
- `Inventory float64` — 物理累积量（制造/能源，其余行业=0）
- `SludgeLevel int` — 状态计数器（消费/医疗，其余行业=0）
- 科技/金融的淤积（闲置容量/资金）在季度结算时即时计算

天花板建造前置期在 v1 实现：`CapBuildOrder.ReadyQuarter` 记录完成季度。

**API**（路径不使用 `/v2/` 前缀）：

| 方法 | 路径 | 认证 | 说明 |
|------|------|------|------|
| POST | `/api/company/create` | JWT | 创建公司，自动生成 Symbol + Q0 快照 |
| GET | `/api/company/state` | JWT | 返回公司完整状态（含季度历史 + 待建造队列） |

**路由拆分**：`internal/router/router.go` 独立维护路由注册，`cmd/server/main.go` 精简为引导逻辑。

**前端**：
- `types/index.ts`：`CompanyState` 扩展 8 字段，`QuarterlyReport` 扩展 4 字段
- `api/queries.ts`：API 路径去掉 `/v2/` 前缀
- `pages/CompanyPage.tsx`：无公司→行业选择+创建表单，有公司→仪表盘+季度报表

### P2.2: AP 行动系统（待 Company 表加 AP/APCap 字段时实现）

```
行动点系统 + 董事会/KPI + 研发 + 随机事件 —— 后续按需逐阶段实现
```

```
internal/store/
├── player_state.go                 # ✅ 玩家状态 CRUD（GetPlayerState + GetOrCreatePlayerState，懒创建 StartingCash）
internal/handler/
├── player.go                       # ✅ GET /api/player/info（JWT 认证，返回 nickname/email/cash/frozen_cash/margin_debt）
internal/engine/
├── portfolio.go                    # ⏳ 玩家资产 + 持仓管理（待实现）
```

**资产功能**:
- ✅ 现金账户基础查询（`GET /api/player/info`，TanStack Query 模式）
- ⏳ 持仓记录（股票代码、数量、成本价）
- ⏳ 总资产计算 = 现金 + 持仓市值（后续 P5 加入 - 融券负债）
- ⏳ 资产变动流水（充值/提现/分红/交易盈亏）
- GORM 模型：`PlayerState`, `Holding`, `AssetLog`（models.go 已定义）

**前端对接**:
- ✅ `PlayerBasicInfo` 类型 + `usePlayerInfo()` TanStack Query hook
- ✅ Header 展示现金 / 昵称（优先使用 API 数据）
- ✅ 注册时自动创建 PlayerState 行（`StartingCash=10,000`）

**P2 产出清单（整体目标）**:
- ✅ 6 行业全部参数配置完成
- ✅ 公司创建 + 行业选择 API 可用
- ⏳ 季度结算完整跑通（AP 决策 → 董事会考核 → 股价更新）
- ⏳ 17 个行动全部可执行，效果/约束/冷却/递减正确
- 研发系统 + 随机事件运转
- ✅ 玩家基础信息查询 API 可用 (`GET /api/player/info`)
- ⏳ 玩家资产查询/变动完整 API（待持仓、交易引擎完成后补充）
- 用 `simulate_v2.py` 的数值参数交叉验证

---

## P3: 核心交易引擎 (5-7 天)

> **前提**: P2 公司运营 v2 完成，股票已发行，流通股已确定，v2 股价公式已实现。
> **目标**: 重写股票交易核心——订单簿、撮合引擎、主循环、行情更新。

### 参考旧代码 / 设计文档

| 文件 | 用途 |
|------|------|
| `backend/game_engine.py` | 引擎逻辑，`_sweep_*`, `execute_trade`, `price_tick_loop` |
| `backend/config.py` | 交易参数（手续费率、持仓上限、涨跌停幅度等） |
| `backend/schemas.py` | WS 消息格式定义 |
| `COMPANY_V2_DESIGN.md` §十一 | v2 股价公式——行情更新需对接此公式 |

### P3.1: 全局市场状态 (1 天)

```
internal/engine/
├── state.go                       # GlobalMarketState struct
```

- 用 `sync.RWMutex` 替代 Python 的 GIL 隐式保护
- 明确区分公开字段和内部字段
- 处理已知设计问题：`player_type` 字段替代 `player_id.startswith()` 判断

### P3.2: 订单簿与撮合 (2 天)

```
internal/engine/
├── orderbook.go                   # 订单簿数据 + 盘口广播
├── matching.go                    # 交易匹配引擎
```

- 限价单簿（bid/ask 两棵排序树）
- 市价单扫单逻辑（吃限价单）
- 价格优先 → 时间优先撮合
- 部分成交处理
- `execute_trade` 拆分为 `executeBuy` / `executeSell` / `executeShort` / `executeCover`
- 手续费计算、持仓上限检查
- 股票可交易数量受公司流通股限制

### P3.3: 主循环与行情 (2 天)

```
internal/engine/
├── ticker.go                      # 主循环 goroutine
├── signals.go                     # 信号计算 (_compute_signal, _ma)
├── price_update.go                # 价格更新（短期波动来自 order flow，长期锚定 v2 股价公式）
├── candle.go                      # K 线聚合
├── persistence.go                 # 定时落盘（GORM 批量写入）
└── initialization.go              # 市场初始化
```

- 主循环用 `time.Ticker` + `context` 控制启停
- 每 tick 流程：公司季度检查 → AI Bot → 撮合 → 价格更新 → candle 聚合 → 广播 → 持久化
- **关键对接**: `price_update.go` 的短期价格漂移需锚定 v2 股价公式的理论价格，防止市场价与基本面脱锚
- GORM 批量 upsert 落盘（替代 `mark_dirty`）
- 市场初始化（从 MySQL 加载公司和玩家数据）

---

## P4: AI 交易者系统 (4-5 天)

> **目标**: 重写全部 6 类 AI 交易者，保持与旧版行为一致。

### 参考旧代码

| 旧文件 | 用途 |
|--------|------|
| `backend/game_engine.py` → `ai_buy_tick`, `ai_sell_tick` | Market Maker |
| `backend/game_engine.py` → `init_npcs` 及 NPC 策略 | NPC 交易者 |
| `backend/game_engine.py` → `init_retail_investors` | 散户 |
| `backend/game_engine.py` → Quant/NationalTeam/Institution/HotMoney | 量化/国家队/机构/游资 |
| `backend/game_engine.py` → `Zhuangjia` 类 | 庄家 4 阶段 |

### 目录结构

```
internal/engine/bots/
├── bot.go                         # Bot 接口定义
├── market_maker.go                # 做市商
├── npc.go                         # NPC (100 个, 5 策略)
├── retail.go                      # 散户 (100 个)
├── quant.go                       # 量化基金 + 国家队 + 机构 + 游资
└── zhuangjia.go                   # 庄家 (吸筹/拉升/出货/砸盘)
```

### 设计要点

- 每个 Bot 类型一个 `goroutine`，通过 channel 接收行情更新
- 与主循环 ticker 通过 channel 同步，不直接调函数
- NPC 数量从旧代码配置读取（默认 100）
- 庄家 4 阶段状态机用枚举类型
- 每 tick 所有 Bot 并行运行（goroutine），主循环等待全部完成后进入撮合

---

## P5: 业务系统 (4-5 天)

> **目标**: 重写融资融券、SEC 监管、市场新闻、排行榜。
> 注意：公司运营（含随机事件）、董事会、研发已在 P2 完成，此阶段仅处理与交易直接相关的业务系统。

### 参考旧代码

| 旧文件 | 用途 |
|--------|------|
| `backend/game_engine.py` → `check_forced_liquidation` | 强制平仓 |
| `backend/game_engine.py` → `sec_regulator_check` | SEC 监管 |
| `backend/game_engine.py` → 新闻生成相关 | 市场新闻 |

### 目录结构

```
internal/engine/
├── margin.go                      # 融资融券 + 强制平仓 (130% 线)
├── regulator.go                   # SEC 监管 (持仓超限罚金, 高频交易限制)
├── news.go                        # 市场级新闻（基于行情异常，不同于 P2 公司随机事件）
└── leaderboard.go                 # 排行榜（所有玩家按总资产排序）
```

### 实现要点

- 强制平仓：每个 tick 检查维持担保比例 < 130%
- SEC 监管：持仓 > 25% 流通股罚金，60 tick 内 > 30 笔交易限制；公司被 SEC 罚款联动董事会满意度 -10
- 市场新闻：根据价格波动、成交量异常、公司财报季等自动生成广播
- 排行榜：按总资产（现金 + 持仓市值 - 融券负债）排序
- GORM 模型：`MarginAccount`, `TradeRecord`, `NewsItem`

---

## P6: API + WebSocket (3-4 天)

> **目标**: 实现全部 REST API 和 WebSocket 端点，与旧版 API 完全兼容，同时新增 v2 公司端点。

### 参考旧代码 / 设计文档

| 文件 | 用途 |
|------|------|
| `backend/routers/market.py` | 行情 API |
| `backend/routers/company.py` | 公司 API |
| `backend/routers/ws.py` | WebSocket 处理 |
| `backend/schemas.py` | 请求/响应 schema |
| `backend/websocket_manager.py` | WS 连接管理 |
| `COMPANY_V2_DESIGN.md` §十四 | v2 公司 API 端点设计 |

### P6.1: REST API (2 天)

```
internal/handler/
├── auth.go                        # 注册/登录/Token 刷新
├── market.go                      # 行情数据、K 线、盘口、成交
├── trade.go                       # 下单、撤单、历史成交
├── portfolio.go                   # 持仓、资产
├── company.go                     # 公司 CRUD（对接 v2 引擎）
├── admin.go                       # 管理员端点（市场控制、用户管理）
└── leaderboard.go                 # 排行榜
```

**v2 公司专用端点** (参考设计文档 14.3 节):

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/company/v2/state` | 公司完整状态（用于渲染决策面板） |
| POST | `/api/company/v2/actions` | 提交本季度 AP 决策 |
| GET | `/api/company/v2/board` | 董事会满意度 + KPI 进度 |
| GET | `/api/company/v2/quarterly` | 季度财报历史 |

- 所有端点与旧版 URL 路径一致，保证前端兼容
- 请求/响应 JSON 格式对齐旧版
- 管理员端点独立路由组 + 权限检查

### P6.2: WebSocket (1-2 天)

```
internal/handler/
└── ws.go                          # WebSocket 端点 + 连接管理
```

- 连接管理：`map[playerId]*ws.Conn` + `sync.RWMutex`
- 消息类型与旧版完全一致（`price_update`, `portfolio_update`, `orderbook`, `trade_tape`, `news`）
- 新增 `quarterly_report` 消息（v2 季度公告广播）
- 按需广播：仅向订阅该股票的客户端推送盘口
- 心跳机制（client → server ping/pong）
- 连接断开自动清理

---

## P7: 前端 React 重写 (8-11 天)

> **目标**: 完整重写前端为 React SPA，UI 风格对齐旧版，功能完全对等。公司模块直接对接 v2 AP 决策面板。

### 参考旧代码 / 设计文档

| 文件 | 用途 |
|------|------|
| `frontend/index.html` | 页面布局、DOM 结构 |
| `frontend/js/game.js` | 所有游戏 UI 逻辑 |
| `frontend/js/kline.js` | K 线图 Canvas 绘制 |
| `frontend/css/style.css` | 配色、动画、布局 |
| `frontend/js/main.js` | WS 消息分发逻辑 |
| `frontend/js/websocket.js` | WS 连接和心跳 |
| `COMPANY_V2_DESIGN.md` §二、§十四 | v2 公司面板 UI 设计 |

### 技术选型（与 P1.2 一致）

| 层 | 选择 | 理由 |
|----|------|------|
| 路由 | TanStack Router | 类型安全路由 |
| 服务端状态 | TanStack Query | HTTP 缓存/重取（公司列表、排行榜、历史 K 线等） |
| 客户端状态 | Zustand | WS 实时流（价格推送、盘口变化）+ UI 状态 |
| 图表 | Canvas 组件重写 | 替代旧版 kline.js |

### P7.1: 行情面板 (2 天)

```
src/components/market/
├── StockInfoBar.tsx               # 股票信息条 + 闪动动画
├── KlineChart.tsx                 # K 线图（Canvas 重写）
├── PeriodSelector.tsx             # 分时/K线 切换
└── IndicatorSelector.tsx          # 指标选择
```

- K 线历史数据通过 TanStack Query 获取和缓存

### P7.2: 交易面板 (2 天)

```
src/components/trade/
├── TradeForm.tsx                  # 市价/限价/融券下单
├── PortfolioSummary.tsx           # 资产统计
├── HoldingsTable.tsx              # 持仓列表
└── QuickTrade.tsx                 # 快速买卖按钮 (25%/50%/100%)
```

- 持仓/资产通过 TanStack Query 获取初始数据，WS 推送增量更新

### P7.3: 浮动面板系统 (1.5 天)

```
src/components/panels/
├── DraggablePanel.tsx             # 通用浮动面板容器 (react-draggable)
├── OrderBook.tsx                  # 盘口深度
├── TradeTape.tsx                  # 逐笔成交
├── NewsTicker.tsx                 # 新闻滚动
└── Leaderboard.tsx                # 排行榜
```

- 面板显隐状态存 Zustand
- 排行榜、新闻列表通过 TanStack Query 获取

### P7.4: 公司 v2 管理面板 (2 天)

> **直接对接 v2 AP 决策系统。** UI 参考 `COMPANY_V2_DESIGN.md` 第二章布局。

```
src/components/company/
├── CompanyDashboard.tsx           # 公司状态面板（股价/营收/利润/员工/现金）
├── ActionPanel.tsx                # AP 行动选择面板
│   ├── 经营类 (1AP): 扩产/招人/研发/降本/促销
│   ├── 资本类 (0AP): 分红/回购/营销
│   ├── 战略类 (2-3AP): 并购/转型
│   └── 行业独有行动
├── BoardPanel.tsx                 # 董事会满意度进度条 + KPI 进度
├── QuarterlyReportModal.tsx       # 季度财报弹窗
├── RandomEventToast.tsx           # 随机事件通知
├── CompanyCreateModal.tsx         # 创建公司（选择行业，随机分配 KPI）
└── AdminPanel.tsx                 # 管理员面板
```

**交互要点**:
- AP 行动勾选式 UI（参考设计文档第十二章的决策示例面板）
- 实时显示剩余 AP / 现金是否够用 / 冷却状态
- 提交决策 → POST `/api/company/v2/actions`
- 季度公告通过 WS `quarterly_report` 消息推送
- 随机事件以 Toast 形式弹出

### P7.5: 页面组装 (1 天)

```
src/pages/
├── AuthPage.tsx                   # 登录/注册（P1 已完成）
└── GamePage.tsx                   # 组装所有面板 + 布局
```

- Header：连接状态指示、游戏倒计时、登出
- 左侧：K 线图
- 右侧：公司面板（优先于交易区域显示）
- 下方：交易区域 + 持仓
- 浮动面板：盘口、成交、新闻、排行榜（可拖拽/最小化/关闭）
- Toast 通知系统（错误/成功/随机事件提示）
- 响应式暗色主题（继承旧版配色风格）

---

## P8: 测试与收尾 (5-7 天)

> **目标**: 为核心路径添加测试安全网，进行端到端验证。

### P8.1: 引擎测试 (2-3 天)

```
internal/engine/
├── company/
│   ├── actions_test.go            # AP 行动执行
│   │   ├── 17 个行动效果正确
│   │   ├── AP 不足拒绝
│   │   ├── 现金不足拒绝
│   │   ├── 冷却中拒绝
│   │   └── 并购递减机制
│   ├── board_test.go              # 董事会 + KPI
│   │   ├── 5 种 KPI 达标/不达标
│   │   ├── 罢免触发
│   │   ├── 保护期 2 年
│   │   └── AP 上限升级
│   ├── engine_test.go             # 季度结算
│   │   ├── 完整季度流程
│   │   ├── 股价公式计算
│   │   └── 16 组模拟对比 (参考 simulate_v2.py)
│   ├── events_test.go             # 随机事件
│   └── research_test.go           # 研发系统
├── orderbook_test.go              # 订单簿撮合
├── matching_test.go               # 交易执行
├── portfolio_test.go              # 资产计算
├── regulator_test.go              # SEC 监管
└── bots/
    ├── market_maker_test.go
    ├── npc_test.go
    └── zhuangjia_test.go
```

### P8.2: API 集成测试 (1-2 天)

```
internal/handler/
├── auth_test.go                   # 注册/登录/鉴权
├── market_test.go                 # 行情数据
├── trade_test.go                  # 下单/撤单
├── company_test.go                # 公司 CRUD + v2 AP 提交
├── ws_test.go                     # WebSocket 消息收发
└── helper_test.go                 # 测试 fixtures（GORM 测试 DB）
```

### P8.3: 数值验证 (1 天)

- 将 `simulate_v2.py` 的数值参数映射到 Go 引擎
- 运行 16 组 × 20 季度模拟，对比以下指标是否在设计范围内：
  - 存活率 100%
  - 股价分化度（300 倍以上）
  - 4 种策略股价范围
- 如有偏差，调整配置参数

### P8.4: 收尾 (1 天)

- 前端构建集成（`Vite build` → `jjs-server/web/`）
- 单二进制部署（Go embed 前端静态文件）
- `Dockerfile` + `docker-compose.yml`（MySQL + Go 服务）
- 运行旧系统，对比验证关键行为一致性
- 清理旧代码目录（归档或删除）

---

## 里程碑汇总

```
✅ P1 完成 (2026-06-18): 项目骨架（Go+GORM+MySQL + React 骨架可运行）
✅ P2.1 完成 (2026-06-18): 行业配置 + 三维数据模型 + 公司创建/查询 API + 路由拆分
Week 2-3:    P2.2-P2.6 公司运营 v2 持续推进（AP 系统/董事会/研发/事件）
Week 3-4:    P3 核心交易引擎（订单簿、撮合、行情，对接 v2 股价公式）
Week 5:      P4 AI 交易者（6 类 Bot）
Week 5-6:    P5 业务系统（融资、SEC、市场新闻、排行榜）
Week 6-7:    P6 API + WS（含 v2 公司端点）
Week 7-9:    P7 前端 React（含 v2 AP 决策面板）
Week 9-10:   P8 测试与收尾（含数值验证）
```

> **双人并行方案** (5-6 周):
> - Week 1: 两人一起 P1 ✅
> - Week 1-2: 后端 P2, 前端 P7.1-P7.2 (用 mock 数据)
> - Week 2-3: 后端 P2 收尾 + P3, 前端 P7.3-P7.4
> - Week 3-4: 后端 P4-P5, 前端 P7.4 收尾
> - Week 4-5: 后端 P6, 前端 P7.5 联调
> - Week 5-6: P8 测试收尾

---

## 旧代码参考索引

> 仅作参考，不做修改。

| 功能域 | 文件 |
|--------|------|
| 公司运营 v2 设计 | **`COMPANY_V2_DESIGN.md`** (十五章节) |
| 数值模拟验证 | `simulate_v2.py` |
| 全局配置/常量 | `backend/config.py` |
| 数据模型 | `backend/models.py` |
| DB 持久化 | `backend/database.py` |
| 引擎核心 | `backend/game_engine.py` (3370 行) |
| 公司引擎 (v1) | `backend/company_engine.py` |
| 行业配置 (v1) | `backend/industry_config.py` |
| WS 管理 | `backend/websocket_manager.py` |
| 认证 | `backend/auth.py` |
| API 路由 | `backend/routers/market.py`, `company.py`, `ws.py` |
| WS 消息格式 | `backend/schemas.py` |
| UI 布局/配色 | `frontend/index.html`, `frontend/css/style.css` |
| 前端游戏逻辑 | `frontend/js/game.js`, `main.js` |
| K 线绘制 | `frontend/js/kline.js` |
| WS 客户端 | `frontend/js/websocket.js` |
