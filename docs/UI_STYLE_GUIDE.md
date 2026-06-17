# 大猫投资 - UI 与风格设计文档

## 1. 项目概览

**项目名称**: 大猫投资 (Big Cat Investment)  
**产品类型**: 多人实时股票模拟交易游戏  
**前端架构**: 原生 JavaScript SPA（无框架、无构建工具）  
**样式方案**: 纯手写 CSS（无预处理、无 UI 库），2621 行单文件  
**设计语言**: 专业交易终端暗色主题  

> **技术栈参考**: 详见 [ARCHITECTURE.md](../ARCHITECTURE.md) 和 [REFACTORING_ROADMAP.md](../REFACTORING_ROADMAP.md)。  
> 当前阶段为 Python + Vanilla JS。规划中将在 **P4** 阶段迁移至 React + Zustand + Vite + Tailwind CSS + TypeScript。

---

## 2. 设计理念

### 2.1 视觉定位
- **专业交易终端风格** —— 参考同花顺/东方财富等主流交易软件的视觉语言
- **暗色主题** —— 全站深色背景，降低长时间使用的眼睛疲劳
- **数据密集型** —— 以数据展示为核心，注重信息密度和可读性
- **中国股市配色** —— 红涨/红买(红色=积极)，绿跌/绿卖(绿色=消极)

### 2.2 交互特色
- **实时数据驱动** —— 通过 WebSocket 实时推送股价、成交、排行榜
- **悬浮面板系统** —— 可拖拽、可最小化、可关闭的交易及管理面板
- **响应式布局** —— 支持桌面端(主)、平板、手机三种端适配
- **Canvas K线图** —— 自研K线/分时图渲染引擎

---

## 3. 设计令牌（CSS Variables）

定义于 `frontend/css/style.css` 的 `:root` 块（第4-37行）：

### 3.1 背景色系
| 变量名 | 色值 | 用途 |
|--------|------|------|
| `--bg-primary` | `#0a0e17` | 主页面底色（深海军蓝黑） |
| `--bg-secondary` | `#111827` | 二级背景（卡片外层、模态框） |
| `--bg-card` | `#1a2332` | 面板/卡片背景色 |
| `--bg-card-hover` | `#1e2a3d` | 面板悬停态 |
| `--bg-input` | `#0f1729` | 输入框/表单控件背景 |
| `--bg-hover` | `rgba(59,130,246,0.1)` | 通用悬停高亮 |

### 3.2 文本色系
| 变量名 | 色值 | 用途 |
|--------|------|------|
| `--text-primary` | `#e8edf5` | 正文/主标题 |
| `--text-secondary` | `#94a3b8` | 副标题/辅助文字 |
| `--text-muted` | `#64748b` | 占位符/弱化文字/标签 |

### 3.3 语义色彩
| 变量名 | 色值 | 用途 |
|--------|------|------|
| `--accent-blue / --accent` | `#3b82f6` | 主品牌色/选中态/链接 |
| `--accent-red / --buy-color / --up-color` | `#ef4444` | **买入/上涨**（中国股市红色为涨） |
| `--accent-green / --sell-color / --down-color` | `#10b981` | **卖出/下跌**（中国股市绿色为跌） |
| `--accent-gold` | `#f59e0b` | 排行榜/高亮/黄金等级 |
| `--accent-purple` | `#8b5cf6` | 科技点/特殊指标 |
| `--accent-cyan` | `#06b6d4` | 辅助强调 |

### 3.4 边框与阴影
| 变量名 | 值 | 用途 |
|--------|-----|------|
| `--border-color` | `#1e293b` | 默认分割线/边框 |
| `--border-light` | `#334155` | 较亮边框（面板悬停） |
| `--shadow` | `0 8px 32px rgba(0,0,0,0.5)` | 大阴影（模态框/浮动面板） |
| `--shadow-sm` | `0 2px 8px rgba(0,0,0,0.3)` | 小阴影（卡片） |
| `--shadow-glow` | `0 0 20px rgba(59,130,246,0.15)` | 蓝色荧光 |

### 3.5 圆角与渐变
| 变量名 | 值 | 用途 |
|--------|-----|------|
| `--radius` | `10px` | 标准圆角 |
| `--radius-sm` | `6px` | 小圆角（按钮/输入框） |
| `--radius-lg` | `14px` | 大圆角 |
| `--gradient-header` | `linear-gradient(135deg, #1a2332, #0f1729)` | 顶部栏/面板标题渐变 |
| `--gradient-gold` | `linear-gradient(135deg, #f59e0b, #d97706)` | 金色渐变 |
| `--gradient-blue` | `linear-gradient(135deg, #3b82f6, #2563eb)` | 蓝色渐变 |
| `--gradient-green` | `linear-gradient(135deg, #10b981, #059669)` | 绿色渐变 |

---

## 4. 排版系统

### 4.1 字体
```css
font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
```
- 优先使用系统原生字体，中文优化（苹方/微软雅黑）
- 等宽数字：`font-variant-numeric: tabular-nums`（广泛用于价格、百分比等数据展示）

### 4.2 字阶
| 用途 | 大小 | 字重 | 示例 |
|------|------|------|------|
| 超大字（资产总额） | 28px | 800 | `.total-assets .value` |
| 大标题（股价） | 24-28px | 700 | `.stock-price-big`, `.pf-hero-value` |
| 页面标题 | 20-24px | 700 | `.summary-main`, `.company-name` |
| 面板标题 | 13-14px | 700 | `.ftp-title` |
| 正文/数据 | 12-14px | 400-600 | `.comp-stat-value` |
| 辅助文字 | 11-12px | 400 | `.sib-label` |
| 微小文字 | 10-11px | 400 | `.tape-time`, `.cr-name-text` |

---

## 5. 颜色语义约定

### 5.1 中国股市配色（与西方相反）
| 含义 | 颜色 | 场景 |
|------|------|------|
| **买入** | **红色** `#ef4444` | 买入按钮、买入方向交易记录 |
| **卖出** | **绿色** `#10b981` | 卖出按钮、卖出方向交易记录 |
| **上涨** | **红色** `#ef4444` | 价格涨幅、正收益 |
| **下跌** | **绿色** `#10b981` | 价格跌幅、负收益 |
| **不利/利空** | **绿色** `#10b981` | 利空新闻标题 |
| **有利/利好** | **红色** `#ef4444` | 利好新闻标题 |

### 5.2 状态色语义
| 颜色 | 场景 |
|------|------|
| 蓝色 `#3b82f6` | 选中态、激活按钮、链接、进度条 |
| 金色 `#f59e0b` | 排行榜排名、房间名称、现金余额高亮 |
| 紫色 `#8b5cf6` | 科技点 |
| 灰色 `#64748b` | 不可用/占位/标签 |

### 5.3 价格闪烁动画
- **上涨闪烁**: 红色半透明背景 0.5s 渐消（`flashUp`）
- **下跌闪烁**: 绿色半透明背景 0.5s 渐消（`flashDown`）

---

## 6. 组件体系

### 6.1 页面层（Pages）
```css
.page { display: none; }
.page.active { display: block; }
```
- `#auth-page`: 登录/注册页
- `#game-page`: 主交易页

### 6.2 面板（Panels）
```css
.panel {
  background: var(--bg-card);        /* #1a2332 */
  border-radius: var(--radius);      /* 10px */
  border: 1px solid var(--border-color);
  box-shadow: var(--shadow-sm);
}
.panel:hover { border-color: var(--border-light); }  /* 悬停边框微亮 */
.panel-header {
  padding: 10px 14px;
  font-size: 12px; font-weight: 700;
  color: var(--text-secondary);
  background: linear-gradient(180deg, rgba(255,255,255,0.03), transparent);
  border-bottom: 1px solid var(--border-color);
  letter-spacing: 1px;
}
```

### 6.3 浮动面板（FTP - Floating Trade Panel）
```css
.ftp {
  position: fixed; top: 80px; right: 20px; width: 340px;
  background: var(--bg-card);
  border: 1px solid var(--border-light);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  backdrop-filter: blur(12px);
  z-index: 100;
}
.ftp.visible { animation: ftp-in 0.2s ease-out; }  /* 淡入上移动画 */
.ftp.minimized .ftp-body { display: none; }           /* 最小化仅显示标题栏 */
.ftp:hover { box-shadow: var(--shadow), 0 0 20px rgba(59,130,246,0.08); }  /* 悬停微光 */
```
- `.ftp-header`: 可拖拽标题栏，渐变背景，含标题/最小化/关闭按钮
- `.ftp-body`: 滚动内容区，含 `.ftp-section` 分段区域

### 6.4 模态框（Modals）
```css
.modal-overlay {
  position: fixed; inset: 0;
  background: rgba(0,0,0,0.6);
  backdrop-filter: blur(4px);
  z-index: 10000;
}
.modal-box {
  background: var(--bg-card);
  border: 1px solid rgba(59,130,246,0.2);
  border-radius: var(--radius);
  box-shadow: 0 16px 48px rgba(0,0,0,0.5);
  animation: fadeIn 0.25s ease;
}
.modal-header { background: linear-gradient(90deg, rgba(59,130,246,0.1), transparent); }
```

### 6.5 标签页（Tabs）
```css
.tab-btn {
  flex: 1; padding: 6px 4px;
  background: transparent; color: var(--text-muted);
  font-size: 11px; font-weight: 600;
}
.tab-btn.active { background: var(--bg-secondary); color: var(--text-primary); }
```
- 适用场景：排行榜/挂单切换（`.panel-tabs`）、登录/注册切换（`.auth-tabs`）

### 6.6 按钮（Buttons）
| 类名 | 样式 | 用途 |
|------|------|------|
| `.btn` | `padding:10px 20px; border-radius:6px; font-weight:600` | 基础按钮 |
| `.btn-primary` | 蓝色背景 `#3b82f6` | 主要操作 |
| `.btn-secondary` | 灰色背景 `--bg-input` + 边框 | 次要操作 |
| `.btn-buy` | 红色背景 `#ef4444` | 买入 |
| `.btn-sell` | 绿色背景 `#10b981` | 卖出 |
| `.btn-danger` | `#dc3545` / `#7f1d1d` | 危险/删除操作 |
| `.btn-warning` | `#e67e22` | 警告操作 |
| `.btn-sm` | `padding:6px 14px; font-size:13px` | 小按钮 |
| `.btn-xs` | `padding:2px 8px; font-size:11px` | 超小按钮 |

按钮全局交互效果：
```css
button:hover  { filter: brightness(1.15); transform: translateY(-1px); }
button:active { transform: translateY(0); filter: brightness(0.95); }
```

### 6.7 开关/选项按钮（Toggle Buttons）
- `.kline-period-btn` / `.ftp-type-btn` / `.order-type-btn` / `.stock-selector-btn`
- 统一模式：默认透明灰字，`.active` 状态蓝色背景白字
- 过渡动画 `0.2s`

---

## 7. 页面布局

### 7.1 登录页 (`#auth-page`)
```
.auth-container （径向渐变背景，flex居中）
  └── .auth-box （深色卡片，400px宽，12px圆角）
        ├── .auth-header （Logo + 副标题，居中对齐）
        ├── .auth-tabs （登录/注册 标签切换）
        └── .auth-body （表单区域）
```

### 7.2 主交易页 (`#game-page`)
```
.game-header （渐变顶部栏，flex三列布局）
├── .header-left   （房间名+状态文本）
├── .header-center （当前股价+倒计时）
└── .header-right  （功能按钮 + 连接状态 + 用户信息 + 退出）

.stock-info-bar （横向数据条，12px字号）
├── sib-symbol, sib-name, stock-selector
├── sib-price, stock-change-pct, stock-change
└── sib-stat × 9 （今开/昨收/最高/最低/成交量/换手率/振幅/市盈率/市净率）

.news-ticker （滚动新闻条）

.game-grid （CSS Grid: 1fr 260px）
├── .panel-center（左侧主区域）
│   └── .kline-panel（K线图 + 时间轴 + 周期选择器）
└── .panel-right（右侧260px）
    ├── .panel-tapetape（成交明细）
    └── .panel-tabbed（排行榜/挂单 标签页）
```

### 7.3 浮动覆盖层
所有浮动面板均为 `position: fixed`，位于右下区域，支持拖拽和最小化：

| 面板 | 选择器 | 尺寸 | 触发 |
|------|--------|------|------|
| 交易面板 | `#floating-trade-panel.ftp` | 340px宽 | 默认显示 |
| 操盘面板 | `#floating-admin-panel` | 320px宽 | 管理员按钮 |
| 公司经营 | `#floating-company-panel` | 320px宽 | 🏢 按钮 |
| 公司排行 | `#floating-comprank-panel` | 480px宽 | 🏆 按钮 |
| 行业市场 | `#floating-industry-panel` | 550px宽 | 📊 按钮 |

---

## 8. 数据展示组件

### 8.1 排行榜（Leaderboard）
```
.lb-row （Grid: 28px rank | 1fr nickname | 85px assets）
├── .lb-rank （排名圈，顶部三名金银铜渐变底色）
├── .lb-nickname （昵称，省略号截断）
└── .lb-assets （资产额，金色文字）
```
- 自身行高亮：渐变金色背景 + 左边框3px金色（`.lb-row.is-me`）

### 8.2 成交明细（Trade Tape）
```
.tape-row （Grid: 50px time | 16px arrow | 1fr price | 40px qty）
```
- 买入方向：红色（`.active-buy`）
- 卖出方向：绿色（`.active-sell`）

### 8.3 挂单簿（Order Book）
```
.ob-row （Grid: 70px price | 1fr qty）
├── 买方（bid）：红色价格（.ob-bid-price）
├── 卖方（ask）：绿色价格（.ob-ask-price）
├── 深度柱状条（.ob-bar）：半透明层叠，买方红色/卖方绿色
└── 价差行（.ob-spread）：买卖一档价差
```

### 8.4 持仓明细（Holdings）
```
.holding-row （Grid: 7列，等宽）
.holding-header （灰色小字表头）
```
交易面板内为紧凑版（`.ftp-holdings-table`），7列固定宽度，横向滚动。

### 8.5 公司排行（Company Ranking）
```
.cr-table / .cr-row （Grid: 排名|代码+名称|行业|市值|营收|利润|分红）
```
- 顶部三名：金银铜色排名
- 代码：蓝色等宽字体
- 数据列：等宽数字

### 8.6 行业市场卡片
```
.industry-card
├── .industry-card-header （行业名 + 周期徽章）
│   └── .industry-cycle-badge （繁荣=绿/正常=灰/衰退=红）
└── .industry-companies （公司列表grid行）
```

### 8.7 公司面板
```
.company-hero （渐变背景，居中布局）
├── .company-name （蓝金渐变文字，20px，800字重）
├── .company-symbol （等宽字体，灰色）
└── .company-industry （蓝色胶囊标签）
```
统计行（`.comp-stat-row`）：标签-值 左右分布，悬停微亮

---

## 9. 表单元素

### 9.1 输入框
```css
.form-group input, .form-group select {
  background: var(--bg-input);     /* #0f1729 */
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm); /* 6px */
  color: var(--text-primary);
  font-size: 15px;
  padding: 10px 14px;
}
input:focus { border-color: var(--accent-blue); }
```

### 9.2 Toast 通知
```css
.toast {
  position: fixed; top: 20px; left: 50%; transform: translateX(-50%);
  background: var(--bg-card); border-radius: var(--radius);
  border: 1px solid var(--border-color);
  z-index: 9999;
}
.toast.error   { border-color: var(--accent-red); }
.toast.success { border-color: var(--accent-green); }
.toast.info    { border-color: var(--accent-blue); }
```
- 淡入淡出过渡 0.3s
- 自动 3 秒消失

### 9.3 分配滑块（Allocation Sliders）
```css
.alloc-row       { 深色卡片，含标题+描述+滑块+数值 }
.alloc-slider    { 6px高度，灰色轨道，蓝色滑块(18px圆形) }
.alloc-value     { 蓝色加粗数字，min-width:40px 右对齐 }
```

### 9.4 行业选择网格
```css
.industry-grid { grid: 1fr 1fr 1fr, gap: 8px; }
.industry-card { 选中的卡片 .selected 高亮边框 }
```
含图标+名称+描述，悬停边框变蓝。

---

## 10. 动画系统

| 动画名 | 类型 | 用途 |
|--------|------|------|
| `ftp-in` | 淡入+上移 | 浮动面板打开 |
| `fadeIn` | 淡入+上移 | 模态框打开 |
| `slideUp` | 淡入+上移 | 通用出现 |
| `flashUp / flashDown` | 背景色脉冲消失 | 价格变动闪烁 |
| `tick-pulse` | 透明度交替闪烁 | tick倒计时紧迫态 |
| `pulseGlow` | 阴影脉冲 | 总资产卡片 |
| `shimmer` | 光带扫过 | 加载骨架屏 |

---

## 11. 响应式设计

### 11.1 断点
| 断点 | 目标设备 | 主要变化 |
|------|----------|----------|
| `> 1100px` | 桌面 | 完整布局：左侧图表 + 右侧面板（260px） |
| `≤ 1100px` | 小平板 | 改为单列布局，信息栏隐藏标签文字 |
| `≤ 800px` | 平板 | 头部弹性换行，浮动面板变宽，持仓表隐藏部分列 |
| `≤ 480px` | 手机 | 极致压缩：减小所有字号/间距/内边距，隐藏非核心信息 |

### 11.2 自适应策略
- 信息密度递进式隐藏（先隐藏标签文字 → 后隐藏非核心列 → 最后压扁布局）
- 浮动面板在移动端占满屏幕宽度（`width: 95vw ~ 98vw`）
- 头部`flex-wrap`换行，价格居中显示

---

## 12. 滚动条定制

```css
::-webkit-scrollbar       { width: 4-6px; height: 4-6px; }
::-webkit-scrollbar-track { background: transparent / var(--bg-primary); }
::-webkit-scrollbar-thumb { background: var(--border-color); border-radius: 2-3px; }
::-webkit-scrollbar-thumb:hover { background: var(--text-muted); }
```

---

## 13. 组件树总览

```
#auth-page （登录/注册）
├── .auth-container → .auth-box
│   ├── .auth-header （Logo + 副标题）
│   ├── .auth-tabs （登录|注册）
│   └── .auth-body （表单）

#game-page （主交易页）
├── .game-header （顶部栏）
│   ├── .header-left （房间名, 状态）
│   ├── .header-center （股价, tick倒计时）
│   └── .header-right （按钮, 连接状态, 用户信息）

├── .stock-info-bar （股票数据条）
├── .news-ticker （新闻滚动条）

├── .game-grid （主内容区域）
│   ├── .panel-center
│   │   └── .kline-panel （Canvas K线图）
│   └── .panel-right
│       ├── .panel-tapetape （成交明细）
│       └── .panel-tabbed
│           ├── tab-leaderboard （排行榜）
│           └── tab-depth （挂单簿）

浮动面板（fixed定位）:
├── #floating-trade-panel.ftp （交易面板：资产/下单/持仓）
├── #floating-admin-panel （操盘面板：管理员快速买卖）
├── #floating-company-panel （公司经营：数据/分配/操作）
├── #floating-comprank-panel （公司排行）
├── #floating-industry-panel （行业市场）

模态框:
├── #company-reg-modal （注册公司：行业选择）
├── #decision-modal （季度经营决策）
└── #cash-action-modal （现金操作）

全局:
└── #toast （通知弹出）
```

---

## 14. 已知技术债务

> 以下问题对应 `ARCHITECTURE.md` 中已标识的 ISSUES。修复计划详见 `REFACTORING_ROADMAP.md`。

### 14.1 CSS / 样式层面

| # | 对应 Issue | 问题 | 位置 |
|---|-----------|------|------|
| 1 | H7 | **36 处 `!important` 声明**，特异性冲突严重 | `style.css` 全文 |
| 2 | - | **重复样式块** —— `.short-panel` 重复 3 次 | `style.css:1690,1755,1821` |
| 3 | - | **硬编码颜色** —— 部分内联样式未使用 CSS 变量令牌 | `index.html` 多处 |
| 4 | - | **无模块化** —— 单文件 2621 行，无命名空间隔离 | `style.css` |

> P2 计划梳理 `!important` 并建立组件样式命名规范；P4 迁移到 Tailwind CSS 将根本性解决此问题。

### 14.2 HTML / 结构层面

| # | 对应 Issue | 问题 | 位置 |
|---|-----------|------|------|
| 1 | H8 | **30+ 内联 `onclick` 回调** —— HTML/JS 强耦合 | `index.html` 全文 |
| 2 | B5 | **多余 `</div>`** — HTML 嵌套错误 | `index.html:524` |
| 3 | - | **内联 `style` 散落** —— 部分样式以 `style="..."` 硬编码 | `index.html` 多处 |

> P2 计划：移除内联 `onclick`，改用 `addEventListener`，集中事件绑定到 `main.js`。

### 14.3 JS / 状态管理层面

| # | 对应 Issue | 问题 | 位置 |
|---|-----------|------|------|
| 1 | C6 | **全局作用域污染** —— 所有函数/变量在 `window` | 所有 JS 文件 |
| 2 | C2 | **`game.js` 1847 行，93 个函数** —— God File | `frontend/js/ui/game.js` |
| 3 | M8 | **`handleWsMessage` 227 行 switch 分支** | `frontend/js/main.js` |
| 4 | M7 | **Interval 泄漏** —— 6+ 个定时器，登出不清理 | 多个 JS 文件 |
| 5 | C5 | **明文密码存 localStorage** | `frontend/js/auth.js:111-112` |

> P2 计划: 引入 App 命名空间 → 拆分 `game.js` 为 3 个子模块 → 拆分 `main.js` WS 消息处理。  
> P4 计划: 迁移到 React + Zustand，以 Zustand store 替代 `gameState.js` 全局对象，以 React hooks 统一管理定时器生命周期。

### 14.4 架构视图

完整的问题清单见 `ARCHITECTURE.md` §已识别问题清单（C1-C6 严重，H1-H9 高优，M1-M10 中等），分阶段修复方案见 `REFACTORING_ROADMAP.md`（P0-P5）。

---

## 15. 未来迁移注意事项（P4 前端 React 重构）

当执行 REFACTORING_ROADMAP 的 P4 阶段（React + Tailwind CSS 迁移）时，本样式系统需按以下映射迁移：

### 15.1 CSS 变量 → Tailwind Theme 映射

| CSS 变量 | Tailwind 配置路径 | 色值 |
|----------|------------------|------|
| `--bg-primary` | `theme.colors.bg.primary` | `#0a0e17` |
| `--bg-secondary` | `theme.colors.bg.secondary` | `#111827` |
| `--bg-card` | `theme.colors.bg.card` | `#1a2332` |
| `--bg-input` | `theme.colors.bg.input` | `#0f1729` |
| `--text-primary` | `theme.colors.text.primary` | `#e8edf5` |
| `--text-secondary` | `theme.colors.text.secondary` | `#94a3b8` |
| `--text-muted` | `theme.colors.text.muted` | `#64748b` |
| `--accent-blue` | `theme.colors.accent.blue` | `#3b82f6` |
| `--accent-red` | `theme.colors.accent.red` | `#ef4444` |
| `--accent-green` | `theme.colors.accent.green` | `#10b981` |
| `--accent-gold` | `theme.colors.accent.gold` | `#f59e0b` |
| `--accent-purple` | `theme.colors.accent.purple` | `#8b5cf6` |
| `--border-color` | `theme.colors.border.DEFAULT` | `#1e293b` |
| `--radius` | `theme.borderRadius.DEFAULT` | `10px` |
| `--radius-sm` | `theme.borderRadius.sm` | `6px` |

### 15.2 关键约定保持

- **颜色语义不变**: 红买/绿卖、红涨/绿跌（中国股市配色）
- **暗色主题**: 保持为唯一主题，无需 light/dark 切换
- **字体栈**: 保持系统原生字体、中文优先
- **等宽数据**: 所有数值列保持 `font-variant-numeric: tabular-nums`（Tailwind: `tabular-nums`）
- **动画**: `ftp-in`、`flashUp/flashDown`、`pulseGlow` 保持相同语义

### 15.3 组件映射

| 当前 DOM 组件 | P4 React 组件目录 |
|--------------|-------------------|
| `.panel` / `.ftp` | `components/shared/Panel.tsx`, `FloatingPanel.tsx` |
| `.kline-panel` | `components/chart/KlinePanel.tsx` (包裹 `kline.js`) |
| `.lb-row` / `.leaderboard` | `components/market/Leaderboard.tsx` |
| `.tape-row` | `components/market/TradeTape.tsx` |
| `.ob-row` / `.ob-grid` | `components/market/DepthBook.tsx` |
| `.holding-row` | `components/trade/HoldingsTable.tsx` |
| `.ftp-trade-row` | `components/trade/TradeForm.tsx` |
| `.company-hero` / `.company-stats` | `components/company/CompanyPanel.tsx` |
| `.cr-row` / `.cr-table` | `components/company/CompanyRanking.tsx` |
| `.industry-card` | `components/company/IndustryPanel.tsx` |
| `.modal-overlay` | `components/shared/Modal.tsx` |
| `.toast` | `components/shared/Toast.tsx` |

### 15.4 拖拽处理

当前 60 行自定义拖拽逻辑（`.ftp-header` 的 `mousedown/mousemove/mouseup`），P4 将替换为 `react-draggable` 库。
