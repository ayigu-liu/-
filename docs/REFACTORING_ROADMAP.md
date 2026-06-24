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
| **P2** | 公司运营 v2 + 个人资产 | 7-9 天 | 中 | ✅ 核心已完成（行业模型、季度结算、扩产/招人行动系统） |
| **P3** | 核心交易引擎 | 5-7 天 | 高 | ✅ 已完成（撮合引擎+2s tick+K线+完整API） |
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
| `internal/handler/company.go` | `POST /api/company/create` + `GET /api/company/state` + `GET /api/company/quarterly` |
| `internal/router/router.go` | 从 main.go 提取全部路由注册 |

**Company 模型**：
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
    LastSettledQuarter int // 最近已完成最终结算的季度（用于恢复和去重）
    Status    string    // active | bankrupt
    TotalShares int     // 总股本
    CEOShares   int64   // CEO持股数
    CapCount    int     // 产线数量
    Inventory   int64   // 库存（整数）
    Demand      float64 // 当季需求
}
```

**CapBuildOrder 表**：
```go
type CapBuildOrder struct {
    gorm.Model
    CompanyID    uint  // 所属公司
    ReadyQuarter int   // 建造完成的全局季度号
    Completed    bool  // 是否已完成
}
```

**CompanyQuarterly 表（季度快照）**：
```go
type CompanyQuarterly struct {
    ID              uint      // 主键
    CompanyID       uint      // 所属公司
    Quarter         int       // 全局季度号（从 GlobalQuarter 取，前端计算 Y/Q）
    Revenue         float64   // 当季营收
    Profit          int64     // 净利润
    BeginningCash   int64     // 期初现金（round(结算前公司现金)）
    Cash            int64     // 期末现金 = BeginningCash + Profit
    LaborCost       int64     // 人力成本 = 员工 × mfgLaborRate
    BaseMaintenance int64     // 基础维护费 = 全部产线 × BaseMaintenanceRate
    OperationalCost int64     // 运营成本 = 开工产线 × OperationalCostRate
    WarehouseCost   int64     // 仓储费 = 库存 × ¥0.5/件
    TotalCost       int64     // 总成本 = 人力 + 基础维护 + 运营 + 仓储
    SalesQty        int64     // 当季销售量（整数件）
    ProdQty         int64     // 当季生产量（整数件）
    Employees       int       // 员工数
    TotalShares     int       // 总股本
    CEOShares       int64     // CEO持股
    CapCount        int       // 产线数
    Inventory       int64     // 季末库存（整数件）
    Demand          float64   // 当季需求
    CreatedAt       time.Time
}
```

**成本拆分模型**（替代旧单一维护费字段）：
```
BaseMaintenance  = CapCount × BaseMaintenanceRate    // 所有产线的基础维护（含闲置）
OperationalCost  = activeLines × OperationalCostRate // 仅开工产线的运营消耗
LaborCost        = employees × mfgLaborRate          // 人力工资
WarehouseCost    = inventory × mfgWarehouseCostRate  // 仓储费
TotalCost        = LaborCost + BaseMaintenance + OperationalCost + WarehouseCost
Profit           = Revenue - TotalCost
```
各行业费率（制造例：Base=1000, Op=2000，旧值 Active=3000/Idle=1000 → Base+Op 等价总和无变更）。

**季度结算**（两阶段机制）：

1. **预报阶段**（preGenerate）：每个 tick 进入新季度后，异步生成当前季度的 CompanyQuarterly 预报记录。不更新公司现金和 `LastSettledQuarter`，公司不可使用本期利润。
2. **最终结算阶段**（finalize）：每个 tick 开始时，先结算刚结束的季度——删除预报记录，创建最终季报，利润加入公司现金，更新 `LastSettledQuarter`。

当前制造和矿业已启用——非制造/矿业 `settleCompanyBaseline` 直接 `return nil`，待具体行业设计后实现。创建公司时仅生成首季预报（现金仅含初始投资），利润在首次 tick 最终结算时到账。

`Company.LastSettledQuarter` 字段逐公司追踪结算进度，用于启动恢复（`RecoverSettlements`）和最终结算的去重。`settleCompanyBaseline` 带 `c.Quarter > quarter` 保护，防止对公司尚未存在的季度错误结算。

**预生成过滤**：进入新季度后异步生成当前季度的预报记录（`quarter == GlobalQuarter`）。预报仅为前瞻参考，公司现金不包含本期利润。`State` 和 `Quarterly` 接口过滤 `quarter >= GlobalQuarter` 的记录，仅返回已最终结算的历史季度（`quarter < GlobalQuarter`）。`State` 中的 `revenue`/`profit` 取自 `quarter == GlobalQuarter-1` 的已确认季度。

**启动恢复**：`cmd/server/main.go` 启动时调用 `engine.RestoreOrSeedGlobalQuarter()`——DB 无景气度数据则种入所有行业 Q1=1.0 且 `GlobalQuarter=1`；有数据则恢复到最大季度。随后调用 `engine.RecoverSettlements()`——通过 `Company.LastSettledQuarter` 找到未结算的公司，补最终结算旧季度，再补生成当前季度预报。`GlobalQuarter` 不再硬编码为 1，重启后季度号连续。

**API**：

| 方法 | 路径 | 认证 | 说明 |
|------|------|------|------|
| POST | `/api/company/create` | JWT | 创建公司，立即运行首次制造结算（SettleManufacturing），产出首季 CompanyQuarterly + 更新 Company 状态 |
| GET | `/api/company/state` | JWT | 返回公司完整状态（含已确认季度历史 + 待建造队列），`revenue`/`profit` 取自 `GlobalQuarter-1` |
| GET | `/api/company/quarterly` | JWT | 游标分页，返回 `{items, hasMore}`。参数 `?cursor=0&limit=50`，按 quarter DESC 排序，过滤 `quarter>0 AND quarter<GlobalQuarter` |
| GET | `/api/player/info` | JWT | 返回玩家信息 + `global_quarter` 全局季度数 |

**前端**：
- `Header.tsx`：展示 `第Y年`（由 `global_quarter` 换算），窄屏隐藏
- `pages/CompanyPage.tsx`：公司仪表盘——头部不再展示 Q{n}；经营指标产能拆为「开工产能」和「产能上限」两格独立展示，库存格展示上季变更量（±件）；股权结构合并为 2 列（总股本 + CEO持股含占比%）；财务表现移除成本率
- `pages/QuarterlyPage.tsx`：独立历史报表页（路由 `/game/company/quarterly`），无限极滚动加载（50条/页，scroll 事件触发），表格列 季度/营收/利润/总成本/期初现金/期末现金；表格区内滚动（表头 sticky），页高填满可用空间；点击行弹出 Modal 详情——财务摘要移除利润率/成本率，运营指标新增库存变更/开工产能/产能上限，股权数据合并持股比例到 CEO持股
- `types/index.ts`：`PlayerBasicInfo` 新增 `global_quarter` 字段

### P2.2: 玩家行动系统 ✅ 完成（2026-06-23）

> **设计简化**: AP 资源点字段被砍掉，改为每季度固定 3 次操作硬限制。董事会/KPI/研发/随机事件留待后续。首批实现扩产 + 招人两个基础动作。并购和转型永久移除。

**行动规则**:
- 每季度最多 3 次经营操作（`POST /api/company/actions` 提交数组长度 ≤ 3，服务端通过 `CompanyQuarterly.Actions` 中的 `expand`/`hire` 条数做跨请求累计校验）
- 每次「扩产」= 1 个操作位 + 滑动条选择 N 条/次（按 N × 单价扣现金）→ 创建一条 `CapBuildOrder`（含 `Amount` 字段，`ReadyQuarter = 当前季 + CapBuildQuarters`）
- 每次「招人」= 1 个操作位 + 滑动条选择 N 人 → `Employees += round(N × random(0.6~1.4))`
- 资本类动作（分红/回购/营销）暂无 AP 消耗优势，暂不实现

**建造队列结算**（`engine/ticker.go:processBuildQueue` + `processAllBuildQueues`）:
- **季度初**：`processAllBuildQueues(newQ)` 在季度推进后、`preGenerateQuarter` 前立即处理 `ready_quarter <= newQ` 的待完成订单，更新 `companies.cap_count`
- **季度末**：`finalizeQuarter` → `settleCompanyBaseline` 中仍调用 `processBuildQueue` 作为幂等安全网（对已处理订单为无操作）
- **即时完成**：`CapBuildQuarters == 0` 的行业（banking/tech），提交扩产时 `Completed=true`，`CapCount` 立即生效
- 查询逻辑：`GetPendingUncompletedBuildOrders`（`ready_quarter <= currentQ AND completed=false`）
- 逐条标记 completed → `Company.CapCount += Amount`
- 制造业扩产 Amount 确定；矿业扩产 Amount 由 `ProspectOreReserves(rng)` 在**提交时**随机确定

**新增/变更文件**:

| 文件 | 变更 |
|------|------|
| `domain/models.go` | `CapBuildOrder` +`Amount int`；`CompanyQuarterly` +`Actions datatypes.JSON`；新增 `ActionLog` 结构 |
| `store/company.go` | 新增 `GetPendingUncompletedBuildOrders(companyID, quarter)` |
| `engine/ticker.go` | 新增 `processBuildQueue()`、`processAllBuildQueues()`；`settleManufacturing`/`settleMining` 中 `Updates` 显式 `WHERE id=?` + 包含 `cap_count` |
| `engine/mining.go` | `MiningRNG` 加入 `"prospect"` 种子键 |
| `handler/action.go` | **新文件**：`POST /api/company/actions`（含 `countExistingActions` 校验） |
| `router/router.go` | 注册 `/api/company/actions` |

**API**:

| 方法 | 路径 | 认证 | 说明 |
|------|------|------|------|
| POST | `/api/company/actions` | JWT | 提交本季经营操作。Body: `{actions: [{type, amount}]}`，type ∈ {expand, hire}，累计 ≤ 3 次/季 |

**前端**:
- `CompanyPage.tsx`：仪表盘新增「经营行动」弹窗——按钮放在经营指标面板底部；弹窗分两步（选择操作类型 → 滑动调数量 + 提交）。前端本地计数器追踪已用次数（关弹窗归零），后端做最终校验
- `types/index.ts`：新增 `ActionItem`, `ActionLog`, `ActionResponse`

**后端**:
```
jjs-server/internal/
├── handler/
│   └── action.go                    # ✅ 行动提交端点
├── engine/
│   ├── ticker.go                    # ✅ processBuildQueue + 仅finalize调用
│   └── mining.go                    # ✅ MiningRNG +prospect
├── store/
│   └── company.go                   # ✅ GetPendingUncompletedBuildOrders
├── domain/
│   └── models.go                    # ✅ CapBuildOrder.Amount, CQ.Actions, ActionLog
```

```
internal/store/
├── player_state.go                 # ✅ 玩家状态 CRUD（GetPlayerState + GetOrCreatePlayerState，懒创建 StartingCash）
internal/handler/
├── player.go                       # ✅ GET /api/player/info（JWT 认证，返回 nickname/email/cash/frozen_cash/margin_debt）
internal/engine/
├── portfolio.go                    # ⏳ 玩家资产 + 持仓管理（待实现）
├── manufacturing.go                # ✅ 制造业生产模型
├── mining.go                       # ✅ 矿业生产模型（储量递减 + 每季20%上限）
├── prosperity.go                   # ✅ 景气度随机游走
├── ticker.go                       # ✅ 季度定时器 + 结算调度
├── industry.go                     # ✅ 6 行业常量配置
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
- ✅ 制造业生产模型 + 季度结算已完成
- ✅ 矿业生产模型 + 季度结算已完成（2026-06-22，第二个启用行业）
- ✅ 公司创建 + 行业选择 API 可用
- ✅ 扩产/招人行动系统（每季 3 次硬限制，建造队列 季度初处理 + 季度末安全网；banking/tech 即时生效）（2026-06-23）
- ⏳ 董事会/KPI 系统（另行设计）
- ⏳ 研发系统
- ⏳ 随机事件
- ✅ 玩家基础信息查询 API 可用 (`GET /api/player/info`)
- ✅ 玩家资产查询/变动完整 API（`GET /api/portfolio`，含持仓市值/盈亏/总资产）

---

## P3: 核心交易引擎 (5-7 天) ✅ 完整完成 (2026-06-24)

> **前提**: P2 公司运营 v2 完成（扩产/招人 action + 季度结算 + 股价公式）。
> **目标**: 实现 IPO 上市、订单簿撮合、证券机构库存释放、多股票行情、K 线聚合、WebSocket 实时推送。
>
> **设计依据**: `COMPANY_V2_DESIGN.md` §十六、`GAME_DESIGN.md` §2.1-2.3。

### 参考文档

| 文件 | 用途 |
|------|------|
| `COMPANY_V2_DESIGN.md` §十六 | IPO 机制、股份结构、减持、证券机构 |
| `COMPANY_V2_DESIGN.md` §十一 | 股价公式、总资产/NAV/EPS |
| `backend/game_engine.py` | 引擎逻辑参考 |
| `backend/schemas.py` | WS 消息格式参考 |

### 关键常量

| 参数 | 值 |
|------|-----|
| 交易 tick | 2 秒 |
| tick/季 | 150 (5分钟) |
| K 线周期 | 15t(30s) / 60t(120s) / 150t(300s) |
| 证券机构扫描间隔 | 5 tick |
| 未成交买单超时 | 10 tick |

### P3.1: 数据模型变更与 Company IPO 字段 ✅ 完成 (2026-06-24)

**Company 表新增字段**:
- `CEOShares` 改为 int64（现有字段不变）
- `InvestorShares` int64 — **新增**。投资方持股（创建时玩家输入）
- `TotalShares` int64 — **新增**。派生字段 = CEOShares + InvestorShares + PublicFloat
- `IpoQuarter` int — **新增**。IPO 季度号，0=未上市
- `PublicFloat` int64 — **新增**。流通股（IPO 增发股数）

**IndustryConfig 新增**:
- `CapAssetValue` float64 — 固定资产单位估值
- 矿业探索期望调至 60,000（CapAssetValue = 120,000/60,000 = 2.0）

**新建 GORM 模型**:
```
Stock              # 上市股票: price/volume/PE/NAV/盘口五档
Order              # 订单簿: limit/market, side, price, qty, status
Trade              # 成交记录: buyer/seller, buyOrderID/sellOrderID
Candle             # K线聚合: period, openTime, OHLC
BrokerInventory    # 证券机构: TotalQty/FrozenQty
```

**修改现有模型**:
- `Holding`: `Symbol` 改为 `StockID` 外键
- `Transaction` → 重写为 `Trade` 模型

**产出**: GORM 模型定义 + AutoMigrate + `store/` CRUD。

### P3.2: IPO 上市流程 ✅ 完成 (2026-06-24)

**IPO 条件校验**（`handler/ipo.go`）:

| 条件 | 值 |
|------|-----|
| 运营季度 | ≥ 12 季 |
| 连续盈利 | ≥ 4 季 |
| 现金 | ≥ ¥1,000,000 |
| 年度营收 | 近4季合计 ≥ ¥5,000,000 |

**API**:

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/company/ipo` | 发起 IPO（Body: `{float_ratio: 0.10~0.50}`），即时校验+发行价计算+创建Stock/BrokerInventory |
| GET | `/api/company/ipo/status` | IPO 条件进度查询（各条件 current/required/met + 估值预览 NAV/EPS/PE） |

**POST /api/company/ipo**:
```
Body: { float_ratio: 0.10~0.50 }
即时执行:
  1. 校验 IPO 条件
  2. 计算发行价 = round((NAV + EPS×行业PE×景气度) × 0.95 × 100) 分
  3. 增发股数 = TotalShares × ratio
  4. Company.Cash += 增发股数 × 发行价
  5. Company.TotalShares += 增发股数
  6. Company.PublicFloat = 增发股数
  7. Company.IpoQuarter = 当前季度
  8. 创建 Stock 行
  9. BrokerInventory.TotalQty = 增发股数
```

**前端**:
- `CompanyPage.tsx`：新增 IPO 进度面板（四条件进度条 + 估值预览悬停说明 + 发起按钮）、IPO 弹窗（增发比例滑块 10%-50%、实时预览发行价/募资额）
- `api/queries.ts`：新增 `useIpoStatus()` hook + `IpoStatusInfo`/`IpoConditionItem` 类型
- `types/index.ts`：`CompanyState` 新增 `investor_shares`/`ipo_quarter`/`public_float`

**待完成**:
- ⏳ CEO 减持 action 扩展（`handler/action.go`，IPO+4季度后可执行）

**产出**: IPO 端点 + IPO 状态端点 + 前端 IPO 完整交互。

### P3.3: 订单簿与撮合引擎 ✅ 完成 (2026-06-24)

> **设计简化**: 放弃内存 OrderBook 双写架构，改为 DB 驱动。限价单挂入 orders 表，撮合时直接从 DB 查询对手单并排序匹配，盘口5档通过 SQL GROUP BY 聚合。Handler goroutine 和 Ticker goroutine 各自独立调用 engine 函数，并发安全靠 DB 行级锁。

**实际产出**:
```
internal/engine/
├── matching.go      # ExecuteOrder(db, order): 查对手单→排序→match→事务写入（买卖、限价/市价、冻结/释放、手续费）
├── broker.go        # ReleaseBrokerInventory(db): 每5tick释放库存到stale buys，BROKER系统账号
│                    # CancelOrder(db, orderID, playerID): 撤单+退冻资金/股份
└── trading_ticker.go # (P3.4，含于此完成)

internal/store/
├── order.go         # CRUD + 按price/seq排序查询 + stale订单查询
├── trade.go         # 创建成交
├── holding.go       # upsert + 增减持 + 冻结/解冻（FrozenQty）
├── stock.go         # List/UpdateOHLCV/SnapshotOrderBook(SQL GROUP BY price LIMIT 5)
├── candle.go        # UpsertCandleWithTx (ON DUPLICATE KEY UPDATE)
└── broker.go        # 库存查询 + 扣减

internal/handler/
├── market.go        # GET market/stocks + market/stock/{symbol} + market/kline/{symbol} + market/orderbook/{symbol}
└── trade.go         # POST trade/order + DELETE trade/order + GET trade/orders + GET portfolio
```

**核心设计**:
- 资金模型: `Cash(可用) / FrozenCash(冻结)`，买单调 `FreezeCash`，成交调 `DeductFrozenCash`，撤单调 `UnfreezeCash`
- 持仓模型: `Holding.Qty / FrozenQty`，卖单调入冻结，成交扣减，Order 新增 `FrozenAmount` 追踪冻结额
- 手续费: 买方佣金 0.025%（min ¥5），卖方佣金+印花税 0.1%
- 撮合: 价格优先→同价时间优先(SeqNum)，限价单受阻价，市价单扫全部
- 系统账号: `PlayerID="BROKER"` 接收 Broker 卖出资金

**产出**: 引擎+Store+最小API全部可用，无做空。

### P3.4: 主循环与行情 ✅ 完成 (2026-06-24)

**实际产出**:
```
internal/engine/
└── trading_ticker.go    # TradingTicker: 2s tick goroutine, 每tick更新Change/ChangePercent+蜡烛聚合
```

每 tick 流程（2s）:
```
1. [每5tick] ReleaseBrokerInventory → 查stale buys → Broker按买价卖出库存
2. updateAllStockPrices → 重算 Change = CurrentPrice - PrevClose, ChangePercent
3. aggregateAllCandles → 用当前价更新40t/150t/600t三周期蜡烛
```

- 成交量/蜡烛实时更新：每笔成交在 `ExecuteOrder` 中同步调用 `updateCandlesForTrade`，不依赖 tick
- `PriceTickInterval` 统一为 2s（修改 config.go，对齐设计文档）
- `TradingTicker` 与季度 `Ticker` 并行运行，各自独立 goroutine
- 新常量: `BrokerScanTicks=5` / `StaleOrderTicks=10` / `SystemBrokerID="BROKER"`

**产出**: 2s tick goroutine + 行情更新 + K线三周期聚合。

### P3.5: API 与符号生成 ✅ 完成 (2026-06-24)

**全部 API 已就绪**:

| 方法 | 路径 | 说明 | 文件 |
|------|------|------|------|
| POST | `/api/trade/order` | 下单（limit/market, buy/sell） | handler/trade.go |
| DELETE | `/api/trade/order` | 撤单（Body: order_id） | handler/trade.go |
| GET | `/api/trade/orders` | 我的挂单（status=open/partial） | handler/trade.go |
| GET | `/api/market/stocks` | 上市股票列表（基础行情） | handler/market.go |
| GET | `/api/market/stock/{symbol}` | 单股详情（OHLCV+PE/EPS/NAV+盘口5档） | handler/market.go |
| GET | `/api/market/kline/{symbol}` | K线数据（?period=150t&limit=100） | handler/market.go |
| GET | `/api/market/orderbook/{symbol}` | 盘口5档快照（从 Stock 表读取） | handler/market.go |
| GET | `/api/portfolio` | 持仓列表+总资产（现金+市值） | handler/trade.go |

**Symbol 生成**（已在 P3.1 实现）:
```
行业前缀: tech=TK, finance=JI, manufacturing=MF, mining=MN, consumer=CS, healthcare=YL
查询现有最大值 +1: SELECT MAX(symbol) FROM companies WHERE symbol LIKE 'MF%'
并发: uniqueIndex 兜底 + 重试
```

**产出**: 全部 REST 交易 API 可用。

### P3.6: WebSocket 实时推送 ✅ 完成 (2026-06-24)

**架构**: Hub/Client 模式，单 goroutine 事件循环。

```
internal/ws/
├── hub.go          # Hub + Client 管理（Register/Unregister/Broadcast/SendToPlayer）
└── messages.go     # BuildPriceUpdate / BuildPortfolioUpdate JSON 构造

internal/handler/
└── ws.go           # /ws 端点：query token JWT 鉴权 → HTTP Upgrade → Client 注册
```

**消息类型**:
| 类型 | 频率 | 说明 |
|------|------|------|
| `price_update` | 每 2s | 全股票实时价格广播（trading_ticker → hub.Broadcast） |
| `portfolio_update` | 成交时 | 买卖双方个人持仓刷新（matching → hub.SendToPlayer） |

**技术细节**:
- 前端 WS URL 从 `?player_id=` 改为 `?token=`（JWT 鉴权）
- 前端 `ws.ts` 已有完整客户端（指数退避重连、pub/sub 分发）
- Candle/Order/Trade/Holding 模型全部补齐 `json` tag，确保 API 响应字段名一致
- Stock 模型 bid/ask 字段加显式 `column` tag 修复 GORM 命名不一致问题

### P3.7: 前端交易页面 ✅ 完成 (2026-06-24)

> 原计划 P7 阶段实现，实际与后端同步开发。

**新增/重写文件**:

| 文件 | 说明 |
|------|------|
| `components/TradeForm.tsx` | 买入/卖出切换，限价/市价切换，盘口填价（元→分转换），提交+结果展示 |
| `components/KlineChart.tsx` | lightweight-charts v5 封装：Pane 0（K线+分时共享价格轴，`setData([])` 切换）+ Pane 1（成交量独立面板） |
| `pages/MarketPage.tsx` | 左右分栏响应式：股票列表（排序）+ 详情（K线/分时/实时三种模式 + 五档盘口 + TradeForm） |
| `pages/PortfolioPage.tsx` | 资产概览卡片 + 持仓表格（点击跳转市场 `?symbol=`）+ 挂单表格（撤单按钮） |

**删除**:
- `pages/TradePage.tsx` — 交易功能已合并到 MarketPage
- Dock 减为 4 Tab：市场/持仓/公司/排行

**图表模式**:
| 模式 | 说明 | 成交量 |
|------|------|--------|
| K线 | Candlestick + OHLC + 周期选择 (15t/60t/150t) | 独立 Pane 1 正常展示 |
| 分时 | LineSeries 连线收盘价 | 不展示 |
| 实时 | 前端缓冲 WS `price_update` 最近 300 tick，每 2s 推点 | 不展示 |

**技术决策**:
- 图表库: `lightweight-charts@5.2`（TradingView 开源）
- 价格单位: 前端输入元 → 提交时 `Math.round(yuan * 100)` 转分
- K 线周期: 15t(30s) / 60t(120s) / 150t(300s)，实时模式用 WS tick 缓冲零存储
- 移动端: 股票列表 `max-h-[35vh]`，详情区独立滚动，价格信息垂直排列+缩写

### P3 产出清单

- ✅ GORM 模型: Stock/Order/Trade/Candle/BrokerInventory + Company 新增字段 (P3.1)
- ✅ IPO 条件校验 + POST /api/company/ipo + GET /api/company/ipo/status + 发行价计算 (P3.2)
- ✅ 前端 IPO 进度面板 + IPO 弹窗（增发比例/发行价/募资额预览）(P3.2)
- ✅ IndustryConfig.CapAssetValue + 矿业勘探期望调至 60k (P3.1)
- ✅ Symbol 前缀+自增序号生成 (P3.1)
- ✅ 创建公司 API: total_shares → investor_shares 输入翻转 (P3.1)
- ⏳ CEO 减持 action 扩展 (P3.2 遗留)
- ✅ 订单簿撮合引擎 (limit/market, 无做空, DB驱动) (P3.3)
- ✅ 证券机构库存释放机制（BROKER系统账号, 每5tick, stale buys 10tick） (P3.3)
- ✅ 2s tick 主循环 + 行情更新 (Change/ChangePercent) (P3.4)
- ✅ K 线 15t/60t/150t 三周期聚合（成交实时更新 + tick兜底） (P3.4)
- ✅ 完整 REST API (8端点: 行情/下单/撤单/持仓/盘口/K线/挂单) (P3.5)
- ✅ WebSocket Hub/Client + price_update 广播 + portfolio_update 单播 (P3.6)
- ✅ MarketPage + PortfolioPage + TradeForm + KlineChart (P3.7)

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

## P6: API + WebSocket (1-2 天)

> **目标**: 实现全部 REST API 和 WebSocket 端点，与旧版 API 完全兼容。
> **状态**: REST API 已在 P3.5 全部完成，WebSocket 已在 P3.6 完成。此阶段仅需补充管理端点和待定功能。

### 已完成（P3.5 + P3.6）

- ✅ 全部 8 个 REST API 端点（行情/下单/撤单/持仓/盘口/K线/挂单）
- ✅ WebSocket Hub/Client + `price_update`(2s) + `portfolio_update`(成交时)
- ✅ 前端 WS 客户端（指数退避重连、pub/sub、JWT token 鉴权）

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

## P7: 前端 React 重写 (6-8 天)

> **目标**: 完整重写前端为 React SPA，UI 风格对齐旧版，功能完全对等。
> **状态**: 核心交易页面（Market/Portfolio）已在 P3.7 完成。剩余待做：排行榜、管理面板、通知系统。

### 已完成（P3.7 + P1/P2）

- ✅ AuthPage（登录/注册）
- ✅ GameLayout（Header + Outlet + Dock 导航）
- ✅ CompanyPage（公司仪表盘 + 经营行动弹窗 + IPO）
- ✅ QuarterlyPage（无限滚动历史报表）
- ✅ **MarketPage**（股票列表 + K线/分时/实时图 + 五档盘口 + 交易表单）
- ✅ **PortfolioPage**（资产概览 + 持仓表 + 挂单表 + 撤单）
- ✅ TradeForm（买卖切换 + 限价/市价 + 盘口填价 + 元/分转换）
- ✅ KlineChart（lightweight-charts v5, 双面板, 三模式）
- ✅ Dock 导航（4 Tab: 市场/持仓/公司/排行）
- ✅ 响应式布局（移动端堆叠 + 自适应）

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
✅ P2.2 完成 (2026-06-23): 扩产/招人行动系统（每季3次硬限制，建造队列）
✅ P3.1 完成 (2026-06-24): 数据模型变更（Company新字段+5个新GORM模型）+ Symbol前缀自增 + 股权翻转
✅ P3.2 完成 (2026-06-24): IPO 条件校验 + 发行价计算 + IPO API + 前端完整交互
✅ P3.3 完成 (2026-06-24): 订单簿撮合引擎（DB驱动，limit/market，冻结/释放，手续费）
✅ P3.4 完成 (2026-06-24): 2s交易tick（broker释放+价格更新+K线聚合），TradingTicker与季度Ticker并行
✅ P3.5 完成 (2026-06-24): 完整REST API（8端点：行情/下单/撤单/持仓/盘口/K线/挂单）
✅ P3.6 完成 (2026-06-24): WebSocket Hub/Client + price_update广播 + portfolio_update单播
✅ P3.7 完成 (2026-06-24): MarketPage + PortfolioPage + TradeForm + KlineChart（三模式双面板）
Week 5:      P4 AI 交易者（6 类 Bot）
Week 5-6:    P5 业务系统（融资、SEC、市场新闻、排行榜）
Week 6:      补完 P6 管理端点 / P7 Leaderboard + 通知面板
Week 7-8:    P8 测试与收尾（含数值验证）
```

> **当前实际进度**: 单人，P3 全部完成（交易引擎 + WebSocket + 前端交易页面），进入 P4。总进度约 60%。

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
