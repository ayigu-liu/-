import asyncio
import json
import logging
import random
import time
from datetime import datetime

from backend.config import (
    STARTING_CASH, PRICE_TICK_INTERVAL, LEADERBOARD_INTERVAL,
    PRICE_MIN, PRICE_MAX,
    STAMP_TAX_RATE, COMMISSION_RATE, MIN_COMMISSION,
    SHARES_OUTSTANDING, INITIAL_PRICE, STOCKS_TEMPLATE,
    MAX_POSITION_PER_PLAYER, MAX_ORDER_QTY,
    SHORT_SELL_FEE_RATE, MARGIN_INTEREST_RATE, MARGIN_MIN_ASSETS,
)
from backend.database import async_session
from backend.models import Transaction, PlayerState, Holding, User, Company, CompanyQuarterly
from backend.websocket_manager import manager, game_state_store
from sqlalchemy import select, update as sql_update

logger = logging.getLogger(__name__)

GLOBAL_ROOM_ID = "__market__"

# Track players whose state needs saving to DB
_dirty_players: set[str] = set()


# ---------------------------------------------------------------------------
# In-memory global market state
# ---------------------------------------------------------------------------
class GlobalMarketState:
    def __init__(self):
        self.status = "playing"  # always playing
        self.stocks: dict[str, dict] = {}  # symbol -> {price, drift, volatility, volume, ...}
        self.players: dict[str, dict] = {}  # player_id -> {nickname, cash}
        self.holdings: dict[str, dict[str, dict]] = {}  # player_id -> {symbol -> {qty, avg_cost}}
        self.pending_orders: dict[str, dict] = {}
        self._order_counter = 0
        # Candles
        self.candles_1t: dict[str, list[dict]] = {}
        self.current_candle_1t: dict[str, dict] = {}
        self.candles_4t: dict[str, list[dict]] = {}  # 4-tick (main) candles
        self.current_candle: dict[str, dict] = {}  # 4-tick main in-progress
        self.candles_20t: dict[str, list[dict]] = {}
        self.current_candle_20t: dict[str, dict] = {}
        self.candle_interval_ticks = 4
        # Start time
        self.start_time = time.time()
        self.trade_tape: list[dict] = []  # recent trades
        self.day_open: float = 1.0
        self.day_high: float = 1.0
        self.day_low: float = 1.0
        self.prev_close: float = 1.0
        self.last_reset_date: str = ""  # YYYY-MM-DD
        self.news_feed: list[dict] = []
        self.timeshare: list[dict] = []  # time-share price points
        self.price_history: list[float] = []  # recent prices for trend detection
        self.last_news_time: float = 0  # timestamp of last news (real clock)
        self.asset_history: dict[str, list] = {}
        self.npc_data: dict[str, dict] = {}  # npc_id -> strategy state
        self.quant_data: dict[str, dict] = {}
        self.retail_data: dict[str, dict] = {}
        self.zhuang_data: dict = {}  # q_id -> quant fund state
        self.candles_1d: dict[str, list] = {}
        self.day_start_assets: dict[str, float] = {}  # player_id -> total_assets at day start
        self.financial_reports: list[dict] = []
        self._last_report_tick: int = 0
        self._report_start_volume: float = 0  # volume at last report for revenue calc
        self.crash_mode: bool = False  # 所有机器人强制卖出模式
        # Industry cycles and company system
        self.industry_cycles: dict[str, dict] = {}  # industry -> {cycle, ticks_in_cycle, momentum}
        self.company_extra: dict[int, dict] = {}  # company_id -> {marketing_boost, pr_boost}
        self._company_tick_counter: int = 0


    def next_order_id(self) -> str:
        self._order_counter += 1
        return f"o{self._order_counter}_{int(time.time())}"


def get_global_state() -> GlobalMarketState:
    if GLOBAL_ROOM_ID not in game_state_store:
        game_state_store[GLOBAL_ROOM_ID] = GlobalMarketState()
    return game_state_store[GLOBAL_ROOM_ID]


# ============================================================
# 数据库持久化（重要：所有玩家状态都保存到数据库）
# ============================================================
# 设计说明：
# - 游戏运行中所有状态在内存(GlobalMarketState)，性能优先
# - 每次玩家资产变动时调用 mark_dirty() 标记"脏"玩家
# - price_tick_loop 每 15 tick 批量保存所有脏玩家到 DB
# - 服务器重启时 init_global_market() 调用 load_* 从 DB 恢复
# - AI 机器人(ai_buy/ai_sell)和 NPC(npc_xxx)不做持久化，重启后重置
# - 市场价格通过特殊 key (_market_DM) 存入 player_state 表
# ============================================================

async def save_player_state(player_id: str):
    """将单个玩家的现金/持仓写入数据库（upsert）。"""
    state = get_global_state()
    player = state.players.get(player_id)
    if not player or player_id.startswith("ai_") or player_id.startswith("npc_") or player_id.startswith("q_") or player_id.startswith("nat_") or player_id.startswith("zhuangjia") or player_id.startswith("retail_") or player_id.startswith("inst_") or player_id.startswith("hot_") or player_id == "zhuangjia":
        return
    try:
        async with async_session() as session:
            from sqlalchemy import select
            # Upsert 玩家现金、冻结资金、融资负债
            r = await session.execute(select(PlayerState).where(PlayerState.player_id == player_id))
            ps = r.scalar_one_or_none()
            if ps:
                ps.nickname = player.get("nickname", "")
                ps.cash = round(player["cash"], 2)
                ps.frozen_cash = round(player.get("frozen_cash", 0), 2)
                ps.margin_debt = round(player.get("margin_debt", 0.0), 2)
            else:
                session.add(PlayerState(
                    player_id=player_id,
                    nickname=player.get("nickname", ""),
                    cash=round(player["cash"], 2),
                    frozen_cash=round(player.get("frozen_cash", 0), 2),
                    margin_debt=round(player.get("margin_debt", 0.0), 2),
                ))
            # Upsert 每只股票的持仓数量、成本价、冻结数量
            for sym, h in state.holdings.get(player_id, {}).items():
                r2 = await session.execute(
                    select(Holding).where(Holding.player_id == player_id, Holding.symbol == sym)
                )
                hld = r2.scalar_one_or_none()
                if hld:
                    hld.qty = h["qty"]
                    hld.avg_cost = round(h["avg_cost"], 2)
                    hld.frozen_qty = h.get("frozen_qty", 0)
                    hld.short_qty = h.get("short_qty", 0)
                    hld.short_avg_cost = round(h.get("short_avg_cost", 0), 2)
                else:
                    session.add(Holding(
                        player_id=player_id, symbol=sym,
                        qty=h["qty"], avg_cost=round(h["avg_cost"], 2),
                        frozen_qty=h.get("frozen_qty", 0),
                        short_qty=h.get("short_qty", 0),
                        short_avg_cost=round(h.get("short_avg_cost", 0), 2),
                    ))
            await session.commit()
    except Exception as e:
        logger.error(f"Failed to save player state for {player_id}: {e}")


async def load_player_state(player_id: str):
    """从数据库恢复单个玩家的现金/持仓到内存。
       在 ws.py 中 WebSocket 连接时调用，保证玩家每次进来都是上次的状态。"""
    state = get_global_state()
    try:
        async with async_session() as session:
            from sqlalchemy import select
            # 恢复现金
            r = await session.execute(select(PlayerState).where(PlayerState.player_id == player_id))
            ps = r.scalar_one_or_none()
            if ps:
                if player_id not in state.players:
                    state.players[player_id] = {"nickname": ps.nickname or "", "cash": ps.cash, "frozen_cash": ps.frozen_cash, "margin_debt": ps.margin_debt}
                else:
                    state.players[player_id]["cash"] = ps.cash
                    state.players[player_id]["frozen_cash"] = ps.frozen_cash
                    state.players[player_id]["margin_debt"] = ps.margin_debt

            # 恢复持仓
            r2 = await session.execute(
                select(Holding).where(Holding.player_id == player_id)
            )
            for hld in r2.scalars().all():
                state.holdings.setdefault(player_id, {})[hld.symbol] = {
                    "qty": hld.qty,
                    "avg_cost": hld.avg_cost,
                    "frozen_qty": hld.frozen_qty,
                    "short_qty": hld.short_qty,
                    "short_avg_cost": hld.short_avg_cost,
                }
    except Exception as e:
        logger.error(f"Failed to load player state for {player_id}: {e}")


async def save_all_player_states():
    """批量保存所有被 mark_dirty 标记过的玩家到数据库。
       由 price_tick_loop 每 15 tick 自动调用一次。"""
    global _dirty_players
    dirty = list(_dirty_players)
    _dirty_players.clear()
    for pid in dirty:
        await save_player_state(pid)


async def load_all_player_states():
    """服务器启动时从数据库恢复所有玩家的现金和持仓到内存。
       在 init_global_market() 末尾调用。"""
    try:
        async with async_session() as session:
            from sqlalchemy import select
            # 先查 User 表获取 is_admin 标志
            user_r = await session.execute(select(User))
            admin_ids = {u.id for u in user_r.scalars().all() if u.is_admin == 1}
            r = await session.execute(select(PlayerState))
            player_count = 0
            for ps in r.scalars().all():
                if ps.player_id.startswith("_market_"):
                    continue
                player_count += 1
                state = get_global_state()
                state.players[ps.player_id] = {
                    "nickname": ps.nickname or "", "cash": ps.cash,
                    "frozen_cash": ps.frozen_cash, "margin_debt": ps.margin_debt,
                    "is_admin": ps.player_id in admin_ids,
                }
            r2 = await session.execute(select(Holding))
            for hld in r2.scalars().all():
                state = get_global_state()
                state.holdings.setdefault(hld.player_id, {})[hld.symbol] = {
                    "qty": hld.qty, "avg_cost": hld.avg_cost, "frozen_qty": hld.frozen_qty,
                    "short_qty": hld.short_qty, "short_avg_cost": hld.short_avg_cost,
                }
        logger.info("Loaded %d players from DB", player_count)

        # 重要：服务器重启后清空冻结字段，因为挂单（pending_orders）是内存中的，重启后已丢失
        # 同时写入数据库，防止 load_player_state() 重新加载旧冻结数据
        from sqlalchemy import update as sql_update
        state = get_global_state()
        async with async_session() as session:
            for pid in list(state.players.keys()):
                if pid.startswith(("ai_", "npc_", "inst_", "hot_", "q_", "nat_", "zhuangjia", "_market_")):
                    continue
                state.players[pid]["frozen_cash"] = 0
                await session.execute(
                    sql_update(PlayerState)
                    .where(PlayerState.player_id == pid)
                    .values(frozen_cash=0)
                )
            for pid, hlds in state.holdings.items():
                if pid.startswith(("ai_", "npc_", "inst_", "hot_", "q_", "nat_", "zhuangjia", "_market_")):
                    continue
                for sym, h in hlds.items():
                    h["frozen_qty"] = 0
                    await session.execute(
                        sql_update(Holding)
                        .where(Holding.player_id == pid, Holding.symbol == sym)
                        .values(frozen_qty=0)
                    )
            await session.commit()
    except Exception as e:
        logger.error(f"Failed to load player states: {e}")


async def save_market_state():
    """将当前股价和成交量保存到数据库。
       利用 player_state 表做 KV 存储，key 为 _market_<symbol>。
       每 60 tick 自动保存一次。"""
    state = get_global_state()
    try:
        async with async_session() as session:
            from sqlalchemy import select
            for sym, sd in state.stocks.items():
                r = await session.execute(
                    select(PlayerState).where(PlayerState.player_id == f"_market_{sym}")
                )
                ps = r.scalar_one_or_none()
                if ps:
                    ps.cash = sd["price"]
                    ps.frozen_cash = sd["volume"]
                else:
                    session.add(PlayerState(
                        player_id=f"_market_{sym}",
                        cash=sd["price"],
                        frozen_cash=sd["volume"],
                        margin_debt=0,
                    ))
            await session.commit()
    except Exception as e:
        logger.error(f"Failed to save market state: {e}")


async def load_market_state():
    """服务器启动时从数据库恢复上次的股价和成交量。"""
    try:
        async with async_session() as session:
            from sqlalchemy import select
            r = await session.execute(
                select(PlayerState).where(PlayerState.player_id.like("_market_%"))
            )
            for ps in r.scalars().all():
                sym = ps.player_id.replace("_market_", "")
                state = get_global_state()
                if sym in state.stocks:
                    state.stocks[sym]["price"] = max(PRICE_MIN, min(PRICE_MAX, ps.cash))
                    state.stocks[sym]["volume"] = int(ps.frozen_cash)
                    logger.info("Restored %s price to %.4f", sym, ps.cash)
    except Exception as e:
        logger.error(f"Failed to load market state: {e}")


def mark_dirty(player_id: str):
    """标记玩家为"脏"——其状态已被修改，需要保存到数据库。
       所有修改玩家现金/持仓的地方都要调用此函数（已分布在 execute_trade、_execute_limit_order、place_limit_order、cancel_limit_order 中）。
       AI 玩家的状态不需要保存，跳过以 ai_ 开头的 ID。"""
    if not player_id.startswith("ai_") and not player_id.startswith("npc_") and not player_id.startswith("inst_") and not player_id.startswith("hot_") and not player_id.startswith("q_") and not player_id.startswith("nat_"):
        _dirty_players.add(player_id)


# ---------------------------------------------------------------------------
# Price only changes when trades happen (buy → up, sell → down)
# No GBM random walk — real supply and demand drives the price
# ---------------------------------------------------------------------------


# ---------------------------------------------------------------------------
# Global market initialization
# ---------------------------------------------------------------------------
async def init_global_market():
    """Initialize global market state and start the price tick loop."""
    state = get_global_state()

    # Initialize stock DM (大猫投资) with price ¥1.0
    for tmpl in STOCKS_TEMPLATE:
        price = INITIAL_PRICE
        state.stocks[tmpl["symbol"]] = {
            "symbol": tmpl["symbol"],
            "name": tmpl["name"],
            "price": price,
            "volume": 0,
            "shares_outstanding": SHARES_OUTSTANDING,
            "eps": round(random.uniform(0.05, 0.3), 2),
            "nav": round(random.uniform(1.5, 5.0), 2),
            "buy_volume": 0,
            "sell_volume": 0,
        }

    state.start_time = time.time()
    state.last_reset_date = datetime.utcnow().strftime("%Y-%m-%d")
    state.day_open = INITIAL_PRICE
    state.day_high = INITIAL_PRICE
    state.day_low = INITIAL_PRICE
    state.prev_close = INITIAL_PRICE
    state._report_start_volume = 0


    # Initialize 100 NPC traders
    init_npcs(state)

    # Initialize AI trading bots (庄家: hold 30% of shares for price control)
    ai_buy_id = "ai_buy"
    ai_sell_id = "ai_sell"
    state.players[ai_buy_id] = {"nickname": "多头AI", "cash": 500_000_000, "frozen_cash": 0, "margin_debt": 0.0}
    state.players[ai_sell_id] = {"nickname": "空头AI", "cash": 300_000_000, "frozen_cash": 0, "margin_debt": 0.0}
    state.holdings.setdefault(ai_sell_id, {})
    state.holdings[ai_sell_id]["DM"] = {"qty": int(SHARES_OUTSTANDING * 0.3), "avg_cost": INITIAL_PRICE, "frozen_qty": 0}

    # Initialize Institutional Investors (机构)
    for i in range(3):
        pid = f"inst_{i+1}"
        state.players[pid] = {"nickname": f"机构{i+1}", "cash": 200_000_000, "frozen_cash": 0, "margin_debt": 0.0}
        state.holdings.setdefault(pid, {})
        init_shares = int(SHARES_OUTSTANDING * random.uniform(0.03, 0.08))
        state.holdings[pid]["DM"] = {"qty": init_shares, "avg_cost": INITIAL_PRICE, "frozen_qty": 0, "short_qty": 0, "short_avg_cost": 0.0}
        state.npc_data[pid] = {
            "strategy": "value", "cooldown": random.randint(30, 50),
            "last_tick": random.randint(0, 10), "position_limit": int(SHARES_OUTSTANDING * 0.15),
            "risk": random.uniform(0.2, 0.4), "last_decision": "hold",
        }

    # Initialize Hot Money (游资)
    for i in range(5):
        pid = f"hot_{i+1}"
        state.players[pid] = {"nickname": f"游资{i+1}", "cash": 50_000_000, "frozen_cash": 0, "margin_debt": 0.0}
        state.holdings.setdefault(pid, {})
        init_shares = random.randint(0, 50000)
        state.holdings[pid]["DM"] = {"qty": init_shares, "avg_cost": INITIAL_PRICE, "frozen_qty": 0, "short_qty": 0, "short_avg_cost": 0.0}
        state.npc_data[pid] = {
            "strategy": "momentum", "cooldown": random.randint(5, 12),
            "last_tick": random.randint(0, 5), "position_limit": int(SHARES_OUTSTANDING * 0.03),
            "risk": random.uniform(0.6, 0.9), "last_decision": "hold",
        }

    # Initialize Quant Funds (量化基金) — 大额交易制造波动
    quant_configs = [
        ("q_1", "量化先锋", "momentum", 300_000_000, 0.65, 18),
        ("q_2", "量化稳健", "mean_reversion", 200_000_000, 0.35, 25),
        ("q_3", "量化进取", "momentum", 250_000_000, 0.55, 20),
        ("q_4", "量化趋势", "mean_reversion", 200_000_000, 0.45, 22),
        ("q_5", "量化套利", "random", 300_000_000, 0.60, 15),
    ]
    for pid, name, strategy, cash, risk, cooldown in quant_configs:
        state.players[pid] = {"nickname": name, "cash": cash, "frozen_cash": 0, "margin_debt": 0.0}
        state.holdings.setdefault(pid, {})
        init_qty = random.randint(0, 100000)
        state.holdings[pid]["DM"] = {"qty": init_qty, "avg_cost": INITIAL_PRICE, "frozen_qty": 0, "short_qty": 0, "short_avg_cost": 0.0}
        state.quant_data[pid] = {
            "strategy": strategy, "cooldown": cooldown,
            "last_tick": random.randint(0, 3),
            "position_limit": int(SHARES_OUTSTANDING * 0.08),
            "risk": risk, "last_decision": "hold",
        }

    # Initialize National Team (国家队) — 市场的最后一道防线
    # 现实中：汇金、证金、社保基金、养老金，越跌越买，只买不卖
    national_team_configs = [
        ("nat_1", "中央汇金", 1_000_000_000, 0.20),   # 汇金：超级资金，-10% 开始介入
        ("nat_2", "证金公司", 800_000_000, 0.15),      # 证金：流动性提供，-15% 介入
        ("nat_3", "社保基金", 500_000_000, 0.10),      # 社保：长期价值，-20% 介入
        ("nat_4", "养老金",    300_000_000, 0.05),      # 养老金：保守型，-25% 介入
    ]
    for pid, name, cash, trigger_pct in national_team_configs:
        state.players[pid] = {"nickname": name, "cash": cash, "frozen_cash": 0, "margin_debt": 0.0}
        state.holdings.setdefault(pid, {})
        state.holdings[pid]["DM"] = {"qty": 0, "avg_cost": 0.0, "frozen_qty": 0, "short_qty": 0, "short_avg_cost": 0.0}
        state.quant_data[pid] = {
            "strategy": "national_team", "cooldown": 5,
            "last_tick": random.randint(0, 5), "position_limit": int(SHARES_OUTSTANDING * 0.30),
            "risk": 0.0, "last_decision": "hold",
            "nat_base_price": INITIAL_PRICE,  # 基准价（用于判断跌幅）
            "nat_trigger": trigger_pct,  # 触发阈值（较基准价跌幅超过此值才开始买）
            "nat_bought": False,  # 是否已买入
        }

    # Initialize 100 Retail Investors (散户)
    retail_strategies = ["retail_fomo", "retail_panic", "retail_random"]
    for i in range(100):
        pid = f"retail_{i:03d}"
        strategy = retail_strategies[i % 3]
        cash = round(random.uniform(2000, 10000), 2)
        init_shares = random.randint(0, 500)
        state.players[pid] = {"nickname": f"散户{i+1}", "cash": cash, "frozen_cash": 0, "margin_debt": 0.0}
        state.holdings.setdefault(pid, {})
        state.holdings[pid]["DM"] = {"qty": init_shares, "avg_cost": 5.0, "frozen_qty": 0, "short_qty": 0, "short_avg_cost": 0.0}
        state.retail_data[pid] = {
            "strategy": strategy,
            "cooldown": random.randint(50, 200),
            "last_tick": random.randint(0, 50),
            "position_limit": int(MAX_POSITION_PER_PLAYER * 0.02),
            "risk": random.uniform(0.3, 0.8),
            "last_decision": "hold",
        }

    # Initialize 庄家 (Market Maker)
    zj_id = "zhuangjia"
    state.players[zj_id] = {"nickname": "庄家", "cash": 500_000_000, "frozen_cash": 0, "margin_debt": 0.0}
    state.holdings.setdefault(zj_id, {})
    init_zj_shares = int(SHARES_OUTSTANDING * 0.10)
    state.holdings[zj_id]["DM"] = {"qty": init_zj_shares, "avg_cost": 5.0, "frozen_qty": 0, "short_qty": 0, "short_avg_cost": 0.0}
    state.zhuang_data = {
        "phase": "accumulate",
        "phase_ticks": 0,
        "target_price": 0,
        "position_limit": int(SHARES_OUTSTANDING * 0.30),
    }

    # Restore saved state from DB
    await load_market_state()
    await load_all_player_states()

    # Initialize industry cycles
    for ind in ["tech", "finance", "manufacturing", "energy", "consumer", "healthcare"]:
        state.industry_cycles[ind] = {
            "cycle": "normal",
            "cycle_name": "正常",
            "cycle_desc": "行业运行平稳",
            "ticks_in_cycle": 0,
            "momentum": 0.0,
        }

    # Load existing companies into stock state (for server restart)
    try:
        async with async_session() as session:
            rows = await session.execute(select(Company))
            for c in rows.scalars().all():
                if c.symbol not in state.stocks:
                    nav = round(c.total_assets / c.shares_outstanding, 2) if c.shares_outstanding > 0 else 1.0
                    eps = round(c.profit / c.shares_outstanding, 4) if c.shares_outstanding > 0 else 0
                    state.stocks[c.symbol] = {
                        "symbol": c.symbol,
                        "name": c.name,
                        "price": c.share_price,
                        "volume": 0,
                        "shares_outstanding": c.shares_outstanding,
                        "eps": eps,
                        "nav": nav,
                        "buy_volume": 0,
                        "sell_volume": 0,
                        "company_id": c.id,
                        "is_company_stock": True,
                    }
        logger.info("Loaded existing companies into market state")
    except Exception as e:
        logger.warning("Could not load companies on startup: %s", e)

    # Start loops as background tasks
    asyncio.create_task(price_tick_loop())
    asyncio.create_task(ai_trading_loop())
    asyncio.create_task(npc_trading_loop())
    asyncio.create_task(quant_trading_loop())
    asyncio.create_task(retail_trading_loop())
    asyncio.create_task(zhuangjia_trading_loop())
    asyncio.create_task(company_tick_loop())
    logger.info("Global market initialized with DM stock at ¥%.2f", INITIAL_PRICE)


async def generate_news():
    """Generate a random news event that affects stock drift."""
    state = get_global_state()
    events = [
        ("重大利好", "大猫投资获得国资战略投资入股", 0.08),
        ("业绩预增", "大猫投资季度利润同比增长150%", 0.05),
        ("行业利好", "国务院发布行业重磅扶持政策", 0.04),
        ("技术突破", "大猫投资核心芯片研发成功", 0.06),
        ("并购重组", "大猫投资拟收购业内龙头公司", 0.07),
        ("产能扩张", "大猫投资新建生产基地获批", 0.03),
        ("利空预警", "大猫投资主要股东拟减持股份", -0.05),
        ("监管趋严", "行业监管政策收紧", -0.03),
        ("业绩不及预期", "大猫投资营收增速放缓", -0.04),
        ("竞争加剧", "竞争对手推出替代产品", -0.03),
        ("市场传闻", "大猫投资或将获得巨额订单", 0.05),
        ("分红方案", "大猫投资拟10派5元", 0.02),
    ]
    event = random.choice(events)
    impact_pct = event[2] * 0.5  # apply as direct price change
    for sym, sd in state.stocks.items():
        sd["price"] = round(max(PRICE_MIN, min(PRICE_MAX, sd["price"] * (1 + impact_pct))), 2)

    news_item = {
        "time": datetime.utcnow().strftime("%H:%M:%S"),
        "title": event[0],
        "content": event[1],
        "impact": "利好" if event[2] > 0 else "利空",
    }
    state.news_feed.insert(0, news_item)
    if len(state.news_feed) > 30:
        state.news_feed = state.news_feed[:30]

    await manager.broadcast(GLOBAL_ROOM_ID, {
        "type": "news",
        "data": {"news": news_item},
    })


# ---------------------------------------------------------------------------
# Price tick loop (runs in background indefinitely)
# ---------------------------------------------------------------------------
async def price_tick_loop():
    """Continuous price tick loop - runs forever, no status checks."""
    state = get_global_state()
    last_leaderboard = 0.0
    tick_count = 0

    while True:
        await asyncio.sleep(PRICE_TICK_INTERVAL)
        tick_count += 1
        elapsed = tick_count * PRICE_TICK_INTERVAL

        # Price only changes through trades — no GBM random walk
        now_ms = int(datetime.utcnow().timestamp() * 1000)

        # Track time-share for this tick
        for sym, sd in state.stocks.items():

            # Track time-share for this tick
            if not hasattr(state, '_vwap_value'):
                state._vwap_value = 0.0
                state._vwap_vol = 0
            if sd.get("volume", 0) > state._vwap_vol:
                vol_delta = sd["volume"] - state._vwap_vol
                state._vwap_value += sd["price"] * vol_delta
                state._vwap_vol = sd["volume"]
            else:
                vol_delta = 0
            avg_p = round(state._vwap_value / state._vwap_vol, 4) if state._vwap_vol > 0 else sd["price"]

            state.timeshare.append({
                "time": now_ms,
                "price": sd["price"],
                "avg_price": avg_p,
                "volume": vol_delta,
            })
            if len(state.timeshare) > 480:
                state.timeshare = state.timeshare[-480:]

            # Update 4-tick K-line candle
            if sym not in state.current_candle:
                state.current_candle[sym] = {
                    "time": now_ms, "open": sd["price"],
                    "high": sd["price"], "low": sd["price"], "close": sd["price"],
                }
            else:
                cc = state.current_candle[sym]
                cc["high"] = max(cc["high"], sd["price"])
                cc["low"] = min(cc["low"], sd["price"])
                cc["close"] = sd["price"]

        # --- Update daily high/low ---
        for sym, sd in state.stocks.items():
            state.day_high = max(state.day_high, sd["price"])
            state.day_low = min(state.day_low, sd["price"])

        # --- Multi-period candle updates ---
        now_ms = int(time.time() * 1000)
        for sym in state.stocks:
            sd = state.stocks[sym]
            # 1-tick candles
            if sym not in state.current_candle_1t:
                state.current_candle_1t[sym] = {"time": now_ms, "open": sd["price"], "high": sd["price"], "low": sd["price"], "close": sd["price"]}
            else:
                cc = state.current_candle_1t[sym]
                cc["high"] = max(cc["high"], sd["price"])
                cc["low"] = min(cc["low"], sd["price"])
                cc["close"] = sd["price"]
            # 20-tick candles
            if sym not in state.current_candle_20t:
                state.current_candle_20t[sym] = {"time": now_ms, "open": sd["price"], "high": sd["price"], "low": sd["price"], "close": sd["price"]}
            else:
                cc = state.current_candle_20t[sym]
                cc["high"] = max(cc["high"], sd["price"])
                cc["low"] = min(cc["low"], sd["price"])
                cc["close"] = sd["price"]

        # --- Limit order matching ---
        for oid, order in list(state.pending_orders.items()):
            if order["status"] in ("filled", "cancelled"):
                continue
            sp = state.stocks.get(order["symbol"], {}).get("price", 0)
            can_execute = False
            if order["type"] == "buy" and sp <= order["price"]:
                can_execute = True
            elif order["type"] == "sell" and sp >= order["price"]:
                can_execute = True
            if can_execute:
                remaining = order["quantity"] - order["filled"]
                if remaining > 0:
                    await _execute_limit_order(order, remaining, sp)

        # --- Volume imbalance drift (makes price trend when one side dominates) ---
        for sym_v, sd_v in state.stocks.items():
            if not hasattr(state, '_last_buy_vol'):
                state._last_buy_vol = {sym_v: sd_v.get("buy_volume", 0)}
                state._last_sell_vol = {sym_v: sd_v.get("sell_volume", 0)}
            prev_buy = state._last_buy_vol.get(sym_v, sd_v.get("buy_volume", 0))
            prev_sell = state._last_sell_vol.get(sym_v, sd_v.get("sell_volume", 0))
            cur_buy = sd_v.get("buy_volume", 0)
            cur_sell = sd_v.get("sell_volume", 0)
            state._last_buy_vol[sym_v] = cur_buy
            state._last_sell_vol[sym_v] = cur_sell
            buy_delta = cur_buy - prev_buy
            sell_delta = cur_sell - prev_sell
            total_delta = buy_delta + sell_delta
            if total_delta > 2000:  # 至少 2000 股成交才计算漂移
                imbalance = (buy_delta - sell_delta) / total_delta  # -1 ~ 1
                drift = imbalance * 0.0005  # 最大 ±0.05%/tick
                sd_v["price"] = round(max(PRICE_MIN, min(PRICE_MAX, sd_v["price"] * (1 + drift))), 4)

        # --- Finalize candles ---
        # 1-tick candles always finalize
        for sym in state.stocks:
            if sym in state.current_candle_1t:
                if sym not in state.candles_1t:
                    state.candles_1t[sym] = []
                state.candles_1t[sym].append(state.current_candle_1t[sym])
                if len(state.candles_1t[sym]) > 500:
                    state.candles_1t[sym] = state.candles_1t[sym][-500:]
                sd = state.stocks[sym]
                state.current_candle_1t[sym] = {"time": now_ms, "open": sd["price"], "high": sd["price"], "low": sd["price"], "close": sd["price"]}

        # 4-tick candles (main)
        if tick_count % state.candle_interval_ticks == 0:
            for sym in state.stocks:
                if sym in state.current_candle:
                    if sym not in state.candles_4t:
                        state.candles_4t[sym] = []
                    state.candles_4t[sym].append(state.current_candle[sym])
                    if len(state.candles_4t[sym]) > 500:
                        state.candles_4t[sym] = state.candles_4t[sym][-500:]
                    sd = state.stocks[sym]
                    state.current_candle[sym] = {
                        "time": now_ms, "open": sd["price"],
                        "high": sd["price"], "low": sd["price"], "close": sd["price"],
                    }

        # 20-tick candles
        if tick_count % 20 == 0:
            for sym in state.stocks:
                if sym in state.current_candle_20t:
                    if sym not in state.candles_20t:
                        state.candles_20t[sym] = []
                    state.candles_20t[sym].append(state.current_candle_20t[sym])
                    if len(state.candles_20t[sym]) > 500:
                        state.candles_20t[sym] = state.candles_20t[sym][-500:]
                    sd = state.stocks[sym]
                    state.current_candle_20t[sym] = {"time": now_ms, "open": sd["price"], "high": sd["price"], "low": sd["price"], "close": sd["price"]}

        # --- Save tick count ---
        state._price_tick_count = tick_count

        # --- Forced liquidation check every 10 ticks ---
        if tick_count % 10 == 0:
            try:
                await check_forced_liquidation()
            except Exception as e:
                logger.error(f"forced liquidation error: {e}")

        # --- 季度边界：证监会限制期减少 ---
        if tick_count % QUARTER_TICKS == 0 and tick_count > 0:
            for pid, pdata in list(state.players.items()):
                if pid.startswith(("ai_", "npc_", "inst_", "hot_", "q_", "nat_", "_market_", "retail_")):
                    continue
                rq = pdata.get("_sec_restrict_quarters", 0)
                if rq > 0:
                    pdata["_sec_restrict_quarters"] = rq - 1
                    if pdata["_sec_restrict_quarters"] == 0:
                        logger.info("SEC restriction lifted for %s", pid)
                        try:
                            await manager.send_to(GLOBAL_ROOM_ID, pid, {
                                "type": "regulator_notice",
                                "data": {"level": "info", "message": "【AI证监会】交易限制已解除，你的账户已恢复正常交易。"},
                            })
                        except Exception:
                            pass

        # --- AI 证监会检查 every 60 ticks ---
        if tick_count % 60 == 0:
            try:
                await sec_regulator_check()
            except Exception as e:
                logger.error(f"SEC regulator error: {e}")

        # --- EPS/NAV 动态漂移 every 60 ticks ---
        if tick_count % 60 == 0:
            for sym_eps, sd_eps in state.stocks.items():
                sd_eps["eps"] = round(sd_eps["eps"] * random.uniform(0.98, 1.02), 4)
                sd_eps["nav"] = round(sd_eps["nav"] * random.uniform(0.99, 1.01), 4)

        # --- 财务报告 every 2400 ticks (1 in-game month) ---
        MONTH_TICKS = 2400
        if tick_count % MONTH_TICKS == 0 and tick_count > 0:
            for sym_rpt, sd_rpt in state.stocks.items():
                eps_rpt = sd_rpt.get("eps", 0.1)
                nav_rpt = sd_rpt.get("nav", 1.0)
                price_rpt = sd_rpt["price"]
                period_volume = sd_rpt["volume"] - state._report_start_volume
                state._report_start_volume = sd_rpt["volume"]
                # 估算营收: 均价 * 成交量 * 平均每手金额系数
                est_revenue = round(price_rpt * period_volume * 0.6, 2)
                profit_margin = random.uniform(0.05, 0.25) + (eps_rpt * 0.5)
                net_profit = round(est_revenue * min(profit_margin, 0.45), 2)
                report_month = (tick_count // MONTH_TICKS)
                report = {
                    "period": f"第{report_month}月",
                    "tick": tick_count,
                    "revenue": est_revenue,
                    "net_profit": net_profit,
                    "eps": eps_rpt,
                    "nav": nav_rpt,
                    "pe": round(price_rpt / eps_rpt, 2) if eps_rpt > 0 else 0,
                    "pb": round(price_rpt / nav_rpt, 2) if nav_rpt > 0 else 0,
                    "price": price_rpt,
                    "volume": period_volume,
                }
                if state.financial_reports:
                    prev = state.financial_reports[-1]
                    if prev.get("revenue", 0) > 0:
                        report["revenue_growth"] = round((est_revenue - prev["revenue"]) / prev["revenue"] * 100, 2)
                    else:
                        report["revenue_growth"] = 0
                    if prev.get("net_profit", 0) > 0:
                        report["profit_growth"] = round((net_profit - prev["net_profit"]) / prev["net_profit"] * 100, 2)
                    else:
                        report["profit_growth"] = 0
                else:
                    report["revenue_growth"] = 0
                    report["profit_growth"] = 0
                state.financial_reports.append(report)
            # 广播财务报告
            try:
                await manager.broadcast(GLOBAL_ROOM_ID, {
                    "type": "financial_report",
                    "data": {"reports": state.financial_reports[-12:]},
                })
            except Exception as e:
                logger.error(f"financial report broadcast error: {e}")

        # --- Record asset history every 10 ticks ---
        if tick_count % 10 == 0:
            now_ts = int(time.time() * 1000)
            for pid, pdata in list(state.players.items()):
                if pid.startswith("ai_") or pid.startswith("npc_") or pid.startswith("inst_") or pid.startswith("hot_") or pid.startswith("q_") or pid.startswith("nat_") or pid == "zhuangjia":
                    continue
                if pid not in state.asset_history:
                    state.asset_history[pid] = []
                total = pdata["cash"]
                for sym, h in state.holdings.get(pid, {}).items():
                    sp = state.stocks.get(sym, {})
                    cur_price = sp.get("price", 0)
                    total += h["qty"] * cur_price  # long position
                    total -= h.get("short_qty", 0) * cur_price  # short liability
                total -= pdata.get("margin_debt", 0)  # margin debt
                sv = round(total - pdata["cash"], 2)
                state.asset_history[pid].append({
                    "time": now_ts,
                    "total_assets": round(total, 2),
                    "cash": round(pdata["cash"], 2),
                    "stock_value": sv if sv > 0 else 0,
                })
                if len(state.asset_history[pid]) > 500:
                    state.asset_history[pid] = state.asset_history[pid][-500:]

        # --- Save state to DB every 15 ticks ---
        if tick_count % 15 == 0:
            try:
                await save_all_player_states()
            except Exception as e:
                logger.error(f"save_all_player_states error: {e}")
        if tick_count % 60 == 0:
            try:
                await save_market_state()
            except Exception as e:
                logger.error(f"save_market_state error: {e}")

        # --- Margin interest + 融券费用 ---
        if tick_count % 20 == 0:
            for pid_m, pdata_m in list(state.players.items()):
                md = pdata_m.get("margin_debt", 0)
                if md > 0:
                    interest = round(md * MARGIN_INTEREST_RATE, 2)  # per tick group
                    pdata_m["margin_debt"] = round(md + interest, 2)
                    mark_dirty(pid_m)
                # 融券费用：按融券持仓市值收取
                ph = state.holdings.get(pid_m, {})
                for sym_h, hld in ph.items():
                    sq = hld.get("short_qty", 0)
                    if sq > 0:
                        sp = state.stocks.get(sym_h, {})
                        short_value = sq * sp.get("price", 0)
                        fee = round(short_value * SHORT_SELL_FEE_RATE, 2)  # per tick group
                        if fee > 0:
                            pdata_m["cash"] = round(pdata_m["cash"] - fee, 2)
                            mark_dirty(pid_m)

        # --- Track price history for retail AI trend detection ---
        state.price_history.append(state.stocks["DM"]["price"])
        if len(state.price_history) > 100:
            state.price_history = state.price_history[-100:]

        # --- Generate news (real-time cooldown, max 1 per 5 min) ---
        now = time.time()
        if now - state.last_news_time > 300 and random.random() < 0.02:
            state.last_news_time = now
            await generate_news()

        # --- Update daily stats ---
        today_str = datetime.utcnow().strftime("%Y-%m-%d")
        if today_str != state.last_reset_date:
            if state.last_reset_date:
                state.prev_close = state.stocks["DM"]["price"]
            state.last_reset_date = today_str
            state.day_open = state.stocks["DM"]["price"]
            state.day_high = state.stocks["DM"]["price"]
            state.day_low = state.stocks["DM"]["price"]
            # Recalculate day_start_assets for all human players
            state.day_start_assets.clear()
            for pid, pdata in list(state.players.items()):
                if pid.startswith("ai_") or pid.startswith("npc_") or pid.startswith("_market_") or pid.startswith("inst_") or pid.startswith("hot_") or pid.startswith("q_") or pid.startswith("nat_") or pid == "zhuangjia":
                    continue
                total = pdata["cash"]
                for sym, h in state.holdings.get(pid, {}).items():
                    cur_price = state.stocks.get(sym, {}).get("price", 0)
                    total += h["qty"] * cur_price
                    total -= h.get("short_qty", 0) * cur_price
                total -= pdata.get("margin_debt", 0)
                state.day_start_assets[pid] = round(total, 2)

        # --- Update daily candle (update last entry, not append) ---
        if state.last_reset_date:
            try:
                dt_obj = datetime.strptime(state.last_reset_date, "%Y-%m-%d")
                candle_ts = int(dt_obj.timestamp() * 1000)
            except:
                candle_ts = now_ms
        else:
            candle_ts = now_ms
        for sym_name in state.stocks:
            sd = state.stocks[sym_name]
            if sym_name not in state.candles_1d:
                state.candles_1d[sym_name] = []
            if state.candles_1d[sym_name] and state.candles_1d[sym_name][-1]["time"] == candle_ts:
                # Update existing day candle
                last = state.candles_1d[sym_name][-1]
                last["high"] = max(last["high"], state.day_high)
                last["low"] = min(last["low"], state.day_low)
                last["close"] = sd["price"]
                last["volume"] = sd["volume"]
            else:
                # New day candle
                state.candles_1d[sym_name].append({
                    "time": candle_ts,
                    "open": state.day_open,
                    "high": state.day_high,
                    "low": state.day_low,
                    "close": sd["price"],
                    "volume": sd["volume"],
                })
                if len(state.candles_1d[sym_name]) > 365:
                    state.candles_1d[sym_name] = state.candles_1d[sym_name][-365:]

        # --- Build stock data for broadcast ---
        stocks_data = []
        for sym, sd in state.stocks.items():
            ref_price = state.prev_close or sd.get("price", 1.0)
            change = round(sd["price"] - ref_price, 2)
            change_pct = round((change / ref_price) * 100, 2) if ref_price else 0
            stocks_data.append({
                "symbol": sym,
                "name": sd["name"],
                "price": sd["price"],
                "change": change,
                "change_pct": change_pct,
                "volume": sd["volume"],
            })

        msg = {
            "type": "price_update",
            "data": {
                "stocks": stocks_data,
                "timestamp": now_ms,
            },
        }

        # Include candle data
        if state.candles_1t:
            candles_data = {}
            for sym, clist in state.candles_1t.items():
                data = clist[-199:]
                # 追加当前正在形成的 candle
                if sym in state.current_candle_1t:
                    data = data + [state.current_candle_1t[sym]]
                candles_data[sym] = data
            msg["data"]["candles_1t"] = candles_data
        if state.candles_4t:
            candles_data = {}
            for sym, clist in state.candles_4t.items():
                data = clist[-199:]
                if sym in state.current_candle:
                    data = data + [state.current_candle[sym]]
                candles_data[sym] = data
            msg["data"]["candles_4t"] = candles_data
        if state.candles_20t:
            candles_data = {}
            for sym, clist in state.candles_20t.items():
                data = clist[-199:]
                if sym in state.current_candle_20t:
                    data = data + [state.current_candle_20t[sym]]
                candles_data[sym] = data
            msg["data"]["candles_20t"] = candles_data

        # --- Extra market data fields ---
        first_stock = next(iter(state.stocks.values()), {})
        turnover_rate = round((first_stock.get("volume", 0) / SHARES_OUTSTANDING) * 100, 2) if SHARES_OUTSTANDING else 0
        msg["data"]["turnover_rate"] = turnover_rate
        amplitude = round(((state.day_high - state.day_low) / max(state.prev_close, 0.01)) * 100, 2) if state.prev_close and state.prev_close > 0 else 0
        msg["data"]["amplitude"] = amplitude
        msg["data"]["buy_volume"] = first_stock.get("buy_volume", 0)
        msg["data"]["sell_volume"] = first_stock.get("sell_volume", 0)
        eps = first_stock.get("eps", 0)
        nav = first_stock.get("nav", 0)
        fs_price = first_stock.get("price", 0)
        msg["data"]["pe"] = round(fs_price / eps, 2) if eps and eps > 0 else 0
        msg["data"]["pb"] = round(fs_price / nav, 2) if nav and nav > 0 else 0
        if state.financial_reports:
            msg["data"]["financial_reports"] = state.financial_reports[-12:]
        total_bid_qty = sum(
            order["quantity"] - order["filled"]
            for oid, order in state.pending_orders.items()
            if order["symbol"] == "DM" and order["type"] == "buy" and order["status"] == "pending"
        )
        total_ask_qty = sum(
            order["quantity"] - order["filled"]
            for oid, order in state.pending_orders.items()
            if order["symbol"] == "DM" and order["type"] == "sell" and order["status"] == "pending"
        )
        wei_cha = total_bid_qty - total_ask_qty
        wei_bi = round((wei_cha / (total_bid_qty + total_ask_qty)) * 100, 2) if (total_bid_qty + total_ask_qty) > 0 else 0
        msg["data"]["bid_volume"] = total_bid_qty
        msg["data"]["ask_volume"] = total_ask_qty
        msg["data"]["wei_bi"] = wei_bi
        msg["data"]["wei_cha"] = wei_cha

        # --- Broadcast daily candles every 4 ticks ---
        if tick_count % 4 == 0 and state.candles_1d:
            d_candles = {}
            for sym_name, clist in state.candles_1d.items():
                d_candles[sym_name] = clist[-200:]
            msg["data"]["candles_1d"] = d_candles

        msg["data"]["daily_stats"] = {
            "open": state.day_open,
            "high": state.day_high,
            "low": state.day_low,
            "prev_close": state.prev_close,
            "volume": state.stocks["DM"]["volume"],
        }
        if state.timeshare:
            msg["data"]["timeshare"] = state.timeshare[-241:]  # last ~6 minutes
        if state.trade_tape:
            msg["data"]["tape"] = state.trade_tape[:20]

        try:
            await manager.broadcast(GLOBAL_ROOM_ID, msg)
        except Exception as e:
            logger.error(f"broadcast error: {e}")

        # Broadcast order book every tick
        try:
            await broadcast_order_book()
        except Exception as e:
            logger.error(f"orderbook broadcast error: {e}")

        # Leaderboard every LEADERBOARD_INTERVAL seconds
        if elapsed - last_leaderboard >= LEADERBOARD_INTERVAL - 0.01:
            last_leaderboard = elapsed
            try:
                await broadcast_leaderboard()
            except Exception as e:
                logger.error(f"leaderboard broadcast error: {e}")


# ---------------------------------------------------------------------------
# AI Trading Bots
# ---------------------------------------------------------------------------
async def ai_trading_loop():
    """Background loop that drives AI bot trading every ~8 ticks."""
    state = get_global_state()
    tick_count = 0
    while True:
        await asyncio.sleep(PRICE_TICK_INTERVAL)
        tick_count += 1
        # Run AI buy on tick % 12 == 0, AI sell on tick % 12 == 6 (staggered, slower refresh)
        if tick_count % 12 == 0:
            try:
                await _ai_buy_tick(state)
            except Exception as e:
                logger.error(f"AI buy error: {e}")
        if tick_count % 12 == 6:
            try:
                await _ai_sell_tick(state)
            except Exception as e:
                logger.error(f"AI sell error: {e}")


async def _ai_clear_pending(player_id: str, order_type: str):
    """Cancel all pending orders for a player of a given type."""
    state = get_global_state()
    for oid, order in list(state.pending_orders.items()):
        if order["player_id"] == player_id and order["type"] == order_type and order["status"] == "pending":
            order["status"] = "cancelled"
            # Unfreeze
            player = state.players.get(player_id)
            if player:
                if order_type == "buy":
                    reserved = order.get("_reserved", 0)
                    remaining = order["quantity"] - order["filled"]
                    fill_ratio = remaining / order["quantity"] if order["quantity"] > 0 else 0
                    unfreeze = round(reserved * fill_ratio, 2)
                    player["frozen_cash"] = max(0, player.get("frozen_cash", 0) - unfreeze)
                elif order_type == "sell":
                    remaining = order["quantity"] - order["filled"]
                    h = state.holdings.get(player_id, {}).get(order["symbol"])
                    if h:
                        h["frozen_qty"] = max(0, h.get("frozen_qty", 0) - remaining)


async def _ai_buy_tick(state):
    """AI buy bot: provides bid liquidity with 10-tier limit orders."""
    pid = "ai_buy"
    player = state.players.get(pid)
    if not player:
        return
    player_holdings = state.holdings.setdefault(pid, {})
    holding = player_holdings.setdefault("DM", {"qty": 0, "avg_cost": 0.0, "frozen_qty": 0, "short_qty": 0, "short_avg_cost": 0.0})
    stock = state.stocks.get("DM")
    if not stock:
        return
    price = stock["price"]
    available_cash = player["cash"] - player.get("frozen_cash", 0)

    # Clear old buy orders and place fresh ones
    await _ai_clear_pending(pid, "buy")

    # Place 5-tier buy limit orders below market (thinner book for more volatility)
    tiers = [
        (round(price * 0.995, 4), 3000),   # -0.5%
        (round(price * 0.985, 4), 10000),  # -1.5%
        (round(price * 0.97, 4), 20000),   # -3%
        (round(price * 0.94, 4), 35000),   # -6%
        (round(price * 0.88, 4), 60000),   # -12%
    ]
    for limit_price, qty in tiers:
        if limit_price <= 0:
            continue
        estimated = round(limit_price * qty, 2)
        comm = round(max(estimated * 0.00025, 5), 2)
        total_needed = round(estimated + comm, 2)
        if available_cash < total_needed:
            continue
        order_id = state.next_order_id()
        order = {
            "id": order_id, "player_id": pid, "symbol": "DM",
            "type": "buy", "price": limit_price, "quantity": qty,
            "filled": 0, "status": "pending", "created_at": time.time(),
            "_reserved": total_needed,
        }
        player["frozen_cash"] = player.get("frozen_cash", 0) + total_needed
        state.pending_orders[order_id] = order

    # Crash mode: bot sells everything via market orders
    if state.crash_mode:
        await _ai_clear_pending(pid, "buy")
        available_qty = holding["qty"] - holding.get("frozen_qty", 0)
        if available_qty > 0:
            sell_qty = min(available_qty, 20000)
            await execute_trade(pid, {
                "stock_symbol": "DM", "quantity": sell_qty, "trade_type": "sell",
            })
        return

    # Emergency market buy only when price < ¥3 (support floor)
    if price < 3.0 and available_cash > 500000:
        buy_qty = random.randint(20000, 50000)
        await execute_trade(pid, {
            "stock_symbol": "DM", "quantity": buy_qty, "trade_type": "buy",
        })

    # Position limit: if holding too many, sell some via limit orders
    if holding["qty"] > 2_000_000:
        sell_qty = int(holding["qty"] * 0.05)
        if sell_qty > 0:
            await place_limit_order(pid, {
                "stock_symbol": "DM", "quantity": sell_qty,
                "order_type": "sell", "price": round(price * 1.01, 4),
            })


async def _ai_sell_tick(state):
    """AI sell bot: provides ask liquidity with 10-tier limit orders."""
    pid = "ai_sell"
    player = state.players.get(pid)
    if not player:
        return
    player_holdings = state.holdings.setdefault(pid, {})
    holding = player_holdings.setdefault("DM", {"qty": 0, "avg_cost": 0.0, "frozen_qty": 0, "short_qty": 0, "short_avg_cost": 0.0})
    stock = state.stocks.get("DM")
    if not stock:
        return
    price = stock["price"]
    available_qty = holding["qty"] - holding.get("frozen_qty", 0)

    # Crash mode: market sell aggressively
    if state.crash_mode:
        if available_qty > 0:
            qty = min(available_qty, 30000)
            await execute_trade(pid, {
                "stock_symbol": "DM", "quantity": qty, "trade_type": "sell",
            })
        return

    # Clear old sell orders
    await _ai_clear_pending(pid, "sell")

    # Place 5-tier sell limit orders above market (thinner book for more volatility)
    tiers = [
        (round(price * 1.005, 4), 3000),   # +0.5%
        (round(price * 1.015, 4), 10000),  # +1.5%
        (round(price * 1.03, 4), 20000),   # +3%
        (round(price * 1.06, 4), 35000),   # +6%
        (round(price * 1.12, 4), 60000),   # +12%
    ]
    for limit_price, qty in tiers:
        if limit_price <= 0:
            continue
        if available_qty < qty:
            continue
        order_id = state.next_order_id()
        order = {
            "id": order_id, "player_id": pid, "symbol": "DM",
            "type": "sell", "price": limit_price, "quantity": qty,
            "filled": 0, "status": "pending", "created_at": time.time(),
        }
        holding["frozen_qty"] = holding.get("frozen_qty", 0) + qty
        state.pending_orders[order_id] = order

    # No aggressive market sells — only limit orders for liquidity

    # Position floor: if running low on shares, buy back via limit order
    available_qty = holding["qty"] - holding.get("frozen_qty", 0)
    if available_qty < 50000:
        buy_qty = 20000
        available_cash = player["cash"] - player.get("frozen_cash", 0)
        if available_cash > buy_qty * price:
            await execute_trade(pid, {
                "stock_symbol": "DM", "quantity": buy_qty, "trade_type": "buy",
            })


# ============================================================
# 100 个智能 NPC 交易者
# ============================================================
# 设计说明：
# - 5 种策略各 20 人，模拟真实市场参与者
# - 使用 execute_trade() 市价交易，与玩家相同路径
# - 每个 NPC 有独立的策略参数、风险偏好、交易频率
# - 不持久化到 DB，重启后重置
# - 排行榜、资产历史记录中排除
# ============================================================

# 100 个中文名
NPC_NAMES = [
    "王伟", "李芳", "张娜", "刘敏", "陈静", "杨丽", "黄强", "赵磊", "周军", "吴洋",
    "徐勇", "孙艳", "马杰", "朱倩", "胡鹏", "郭宇", "何宁", "高婷", "林旭", "罗明",
    "梁超", "宋秀英", "唐华", "许文", "韩飞", "冯雪", "邓琳", "曹浩", "彭峰", "曾帅",
    "萧斌", "田宇", "董鑫", "潘磊", "袁波", "蔡静", "蒋涛", "余鑫", "于磊", "杜娟",
    "叶辉", "程龙", "苏敏", "魏丹", "吕鑫", "丁洋", "任杰", "沈洁", "姚远", "卢慧",
    "姜琳", "崔凯", "钟琴", "谭志", "陆辉", "汪婷", "范鑫", "金石", "廖强", "贾磊",
    "夏雪", "韦华", "付芳", "方静", "白涛", "邹阳", "孟宇", "熊超", "秦亮", "邱玲",
    "江波", "尹欣", "薛磊", "闫峰", "段敏", "雷明", "侯杰", "龙海", "史珍", "陶燕",
    "贺杰", "顾诚", "毛敏", "郝帅", "龚萍", "邵峰", "万莉", "钱程", "严丽", "覃辉",
    "武强", "戴威", "莫文", "孔琳", "向旭", "汤杰", "温馨", "康伟", "施浩",
]

# 策略权重配置（用于生成 NPC 个性参数）
NPC_STRATEGIES = ["value", "momentum", "mean_reversion", "random", "news"]
NPC_STRATEGY_WEIGHTS = {
    "value": {"cooldown_range": (25, 40), "position_pct": (0.01, 0.05), "risk": (0.3, 0.5)},
    "momentum": {"cooldown_range": (15, 25), "position_pct": (0.02, 0.08), "risk": (0.4, 0.7)},
    "mean_reversion": {"cooldown_range": (8, 18), "position_pct": (0.01, 0.04), "risk": (0.2, 0.4)},
    "random": {"cooldown_range": (5, 15), "position_pct": (0.005, 0.02), "risk": (0.1, 0.3)},
    "news": {"cooldown_range": (15, 30), "position_pct": (0.02, 0.06), "risk": (0.4, 0.6)},
}


def init_npcs(state):
    """创建 100 个 NPC 玩家，分配策略和个性参数。"""
    for i in range(100):
        pid = f"npc_{i:03d}"
        strategy = NPC_STRATEGIES[i % 5]  # 均匀分配 5 种策略
        cfg = NPC_STRATEGY_WEIGHTS[strategy]
        cooldown = random.randint(*cfg["cooldown_range"])
        cash = round(STARTING_CASH * random.uniform(0.5, 2.0), 2)
        pos_pct = random.uniform(*cfg["position_pct"])
        position_limit = max(500, int(MAX_POSITION_PER_PLAYER * pos_pct))
        risk = random.uniform(*cfg["risk"])
        name = NPC_NAMES[i] if i < len(NPC_NAMES) else f"玩家{i}"

        state.players[pid] = {
            "nickname": name, "cash": cash,
            "frozen_cash": 0, "margin_debt": 0.0,
        }
        state.npc_data[pid] = {
            "strategy": strategy,
            "cooldown": cooldown,
            "last_tick": random.randint(0, cooldown),  # 错开启动时间
            "position_limit": position_limit,
            "risk": risk,
            "last_decision": "hold",
        }
        # Give each NPC a starting position so they can sell from the start
        init_shares = random.randint(100, 2000)
        state.holdings.setdefault(pid, {})
        state.holdings[pid]["DM"] = {
            "qty": init_shares, "avg_cost": INITIAL_PRICE,
            "frozen_qty": 0, "short_qty": 0, "short_avg_cost": 0.0,
        }


def _ma(history: list[float], period: int) -> float | None:
    """计算移动平均，数据不足返回 None。"""
    if len(history) < period:
        return None
    return sum(history[-period:]) / period


def _compute_signal(strategy: str, price: float, history: list[float],
                    holding: dict, player: dict, news_feed: list[dict]) -> float:
    """
    计算买卖信号强度，范围 -1（强烈卖出）~ 1（强烈买入）。
    各策略独立计算，互不干扰。
    """
    if strategy == "value":
        ma20 = _ma(history, 20)
        if ma20 is None:
            return 0
        # 价格远低于 MA20 → 买入；远高于 → 卖出
        if price < ma20 * 0.93:
            return 0.8
        elif price < ma20 * 0.97:
            return 0.4
        elif price > ma20 * 1.15:
            return -0.8
        elif price > ma20 * 1.08:
            return -0.4
        return 0

    elif strategy == "momentum":
        ma5 = _ma(history, 5)
        ma20 = _ma(history, 20)
        if ma5 is None or ma20 is None:
            return 0
        # 趋势跟踪
        trend = (ma5 - ma20) / ma20  # 趋势强度
        if trend > 0.02:
            return min(0.9, trend * 10)  # 强势买入
        elif trend < -0.02:
            return max(-0.9, trend * 10)  # 弱势卖出
        # 止盈：持仓盈利 > 8% 时卖出
        if holding["qty"] > 0 and holding["avg_cost"] > 0:
            pnl_pct = (price - holding["avg_cost"]) / holding["avg_cost"]
            if pnl_pct > 0.08:
                return -0.6
        return 0

    elif strategy == "mean_reversion":
        # 检查短期涨跌
        if len(history) < 5:
            return 0
        change_5 = (price - history[-5]) / history[-5]  # 近5tick涨跌幅
        if change_5 < -0.03:  # 跌 >3% 抄底
            return 0.7
        elif change_5 < -0.015:
            return 0.3
        elif change_5 > 0.03:  # 涨 >3% 卖出
            return -0.7
        elif change_5 > 0.015:
            return -0.3
        # 持仓止盈
        if holding["qty"] > 0 and holding["avg_cost"] > 0:
            pnl_pct = (price - holding["avg_cost"]) / holding["avg_cost"]
            if pnl_pct > 0.05:
                return -0.5
        return 0

    elif strategy == "random":
        r = random.random()
        if r < 0.35:
            return random.uniform(0.3, 0.7)  # 买入
        elif r < 0.70:
            # 有持仓才卖
            if holding["qty"] > 0:
                return random.uniform(-0.7, -0.3)  # 卖出
            return 0
        return 0

    elif strategy == "news":
        # 检查最近两条新闻
        if len(news_feed) >= 2:
            last_news = news_feed[0]
            impact = last_news.get("impact", "")
            if impact == "利好":
                return 0.9  # 积极追买
            elif impact == "利空":
                return -0.9 if holding["qty"] > 0 else 0  # 清仓
        # 无新闻时小额定投式买入
        if holding["qty"] == 0 and player["cash"] > 10000:
            return 0.2
        return 0

    elif strategy == "retail_fomo":
        # 散户追涨杀跌：看最近3个tick的价格变化
        if len(history) < 4:
            return 0
        changes = [(history[i] - history[i-1]) / history[i-1] for i in range(-3, 0)]
        cons_up = all(c > 0 for c in changes)
        cons_down = all(c < 0 for c in changes)
        if cons_up:
            return 0.6
        if cons_down:
            return -0.7
        return random.uniform(-0.1, 0.1)

    elif strategy == "retail_panic":
        if len(history) < 10:
            return 0
        change_10 = (price - history[-10]) / history[-10]
        if change_10 < -0.05:
            return -0.9
        if change_10 > 0.10:
            return 0.8
        return random.uniform(-0.2, 0.2)

    elif strategy == "retail_random":
        r = random.random()
        if r < 0.20:
            return random.uniform(0.3, 0.6)
        elif r < 0.40:
            if holding["qty"] > 0:
                return random.uniform(-0.5, -0.2)
            return 0
        return 0

    return 0


async def _npc_make_decision(pid: str, npc: dict, state):
    """执行单个 NPC 的交易决策。"""
    stock = state.stocks.get("DM")
    if not stock:
        return
    price = stock["price"]
    player = state.players.get(pid)
    if not player:
        return
    holding = state.holdings.setdefault(pid, {}).get("DM", {"qty": 0, "avg_cost": 0.0, "frozen_qty": 0, "short_qty": 0, "short_avg_cost": 0.0})
    available_cash = player["cash"] - player.get("frozen_cash", 0)
    available_qty = holding["qty"] - holding.get("frozen_qty", 0)

    # Crash mode: 无条件卖出
    if state.crash_mode and available_qty > 0:
        qty = min(available_qty, 5000)
        if qty >= 100:
            await execute_trade(pid, {
                "stock_symbol": "DM", "quantity": qty, "trade_type": "sell",
            })
        return

    # 计算信号
    signal = _compute_signal(npc["strategy"], price, state.price_history,
                             holding, player, state.news_feed)

    if signal > 0.3 and price > 0:
        # 先撤销旧的未成交买单，释放被冻结的现金（按剩余比例）
        # 先撤销旧的未成交买单，释放被冻结的现金（按剩余比例）
        for oid, order in list(state.pending_orders.items()):
            if order["player_id"] == pid and order["type"] == "buy" and order["status"] == "pending":
                order["status"] = "cancelled"
                reserved = order.get("_reserved", 0)
                if reserved > 0:
                    remaining = order["quantity"] - order["filled"]
                    fill_ratio = remaining / order["quantity"] if order["quantity"] > 0 else 0
                    unfreeze = round(reserved * fill_ratio, 2)
                    player["frozen_cash"] = max(0, player.get("frozen_cash", 0) - unfreeze)
        available_cash = player["cash"] - player.get("frozen_cash", 0)
        # 买入：控制单笔量，避免价格剧烈波动
        max_by_cash = int(available_cash * 0.9 / price) if price > 0 else 0
        max_by_limit = npc["position_limit"] - holding["qty"]
        max_by_risk = int(max_by_cash * npc["risk"])
        qty = int(max_by_cash * abs(signal) * npc["risk"])
        qty = min(qty, max_by_cash, max_by_limit, max_by_risk, 5000)
        if qty < 100:
            return  # 数量不足100股，不交易
        # 65% 概率用限价单，35% 用市价单（更多市价单增加波动）
        if random.random() < 0.65:
            limit_price = round(price * random.uniform(0.97, 0.995), 4)
            if limit_price > 0:
                await place_limit_order(pid, {
                    "stock_symbol": "DM", "quantity": qty,
                    "order_type": "buy", "price": limit_price,
                })
        else:
            await execute_trade(pid, {
                "stock_symbol": "DM", "quantity": qty, "trade_type": "buy",
            })

    elif signal < -0.3 and available_qty > 0:
        # 先撤销旧的未成交卖单，释放被冻结的持仓（按剩余比例）
        for oid, order in list(state.pending_orders.items()):
            if order["player_id"] == pid and order["type"] == "sell" and order["status"] == "pending":
                order["status"] = "cancelled"
                remaining = order["quantity"] - order["filled"]
                holding["frozen_qty"] = max(0, holding.get("frozen_qty", 0) - remaining)
        available_qty = holding["qty"] - holding.get("frozen_qty", 0)
        # 卖出
        qty = int(available_qty * abs(signal) * npc["risk"])
        qty = min(qty, available_qty, 5000)
        if qty < 100:
            return
        # 65% 概率用限价单
        if random.random() < 0.65:
            limit_price = round(price * random.uniform(1.005, 1.03), 4)
            await place_limit_order(pid, {
                "stock_symbol": "DM", "quantity": qty,
                "order_type": "sell", "price": limit_price,
            })
        else:
            await execute_trade(pid, {
                "stock_symbol": "DM", "quantity": qty, "trade_type": "sell",
            })


async def npc_trading_loop():
    """NPC 后台交易循环，每 tick 挑选 3-8 个 NPC 交易。"""
    state = get_global_state()
    tick_count = 0
    while True:
        await asyncio.sleep(PRICE_TICK_INTERVAL)
        tick_count += 1

        # 收集冷却已到的 NPC
        candidates = []
        for pid, npc in list(state.npc_data.items()):
            if tick_count - npc["last_tick"] >= npc["cooldown"]:
                candidates.append(pid)

        if not candidates:
            continue

        # 随机选 3-8 个
        num = min(random.randint(3, 8), len(candidates))
        selected = random.sample(candidates, num)
        for pid in selected:
            npc = state.npc_data[pid]
            npc["last_tick"] = tick_count
            try:
                await _npc_make_decision(pid, npc, state)
            except Exception as e:
                logger.error(f"NPC {pid} error: {e}")


async def _retail_make_decision(pid: str, rd: dict, state):
    stock = state.stocks.get("DM")
    if not stock:
        return
    price = stock["price"]
    player = state.players.get(pid)
    if not player:
        return
    holding = state.holdings.setdefault(pid, {}).setdefault("DM", {"qty": 0, "avg_cost": 0.0, "frozen_qty": 0, "short_qty": 0, "short_avg_cost": 0.0})
    available_cash = player["cash"] - player.get("frozen_cash", 0)
    available_qty = holding["qty"] - holding.get("frozen_qty", 0)

    # Crash mode: 无条件卖出
    if state.crash_mode and available_qty > 0:
        qty = min(available_qty, 2000)
        if qty >= 100:
            await execute_trade(pid, {
                "stock_symbol": "DM", "quantity": qty, "trade_type": "sell",
            })
        return

    signal = _compute_signal(rd["strategy"], price, state.price_history, holding, player, state.news_feed)
    signal += random.uniform(-0.2, 0.2)
    signal = max(-1, min(1, signal))

    if signal > 0.25 and available_cash > 200 and holding["qty"] < rd["position_limit"]:
        invest_pct = min(signal * rd["risk"], 0.8)
        budget = int(available_cash * invest_pct)
        qty = min(int(budget / price), rd["position_limit"] - holding["qty"])
        qty = max(0, min(qty, random.randint(100, 1000)))
        if qty >= 100:
            await execute_trade(pid, {
                "stock_symbol": "DM", "quantity": qty, "trade_type": "buy",
            })
    elif signal < -0.25 and available_qty > 0:
        sell_pct = min(abs(signal), 1.0)
        qty = int(available_qty * sell_pct)
        qty = max(0, min(qty, random.randint(100, 2000)))
        if qty >= 100:
            await execute_trade(pid, {
                "stock_symbol": "DM", "quantity": qty, "trade_type": "sell",
            })


async def retail_trading_loop():
    state = get_global_state()
    tick_count = 0
    while True:
        await asyncio.sleep(PRICE_TICK_INTERVAL)
        tick_count += 1
        retail_ids = list(state.retail_data.keys())
        if not retail_ids:
            continue
        sample_size = min(len(retail_ids), random.randint(10, 20))
        active = random.sample(retail_ids, sample_size)
        for pid in active:
            rd = state.retail_data.get(pid)
            if not rd:
                continue
            if tick_count - rd["last_tick"] < rd["cooldown"]:
                continue
            rd["last_tick"] = tick_count
            try:
                await _retail_make_decision(pid, rd, state)
            except Exception as e:
                logger.error(f"Retail {pid} error: {e}")


# ---------------------------------------------------------------------------
# Quant Fund trading (量化基金) — 大额交易制造波动
# ---------------------------------------------------------------------------
async def quant_trading_loop():
    """量化基金交易循环，每 tick 挑选 1-3 个基金大额交易。"""
    state = get_global_state()
    tick_count = 0
    while True:
        await asyncio.sleep(PRICE_TICK_INTERVAL)
        tick_count += 1

        candidates = []
        for pid, q in list(state.quant_data.items()):
            if tick_count - q["last_tick"] >= q["cooldown"]:
                candidates.append(pid)

        if not candidates:
            continue

        num = min(random.randint(1, 2), len(candidates))
        selected = random.sample(candidates, num)
        for pid in selected:
            qd = state.quant_data[pid]
            qd["last_tick"] = tick_count
            try:
                await _quant_make_decision(pid, qd, state)
            except Exception as e:
                logger.error(f"Quant {pid} error: {e}")


async def _quant_make_decision(pid: str, qd: dict, state):
    """量化基金交易决策 — 大额多空双向交易制造价格波动。"""
    stock = state.stocks.get("DM")
    if not stock:
        return
    price = stock["price"]
    player = state.players.get(pid)
    if not player:
        return
    holding = state.holdings.setdefault(pid, {}).setdefault("DM", {
        "qty": 0, "avg_cost": 0.0, "frozen_qty": 0,
        "short_qty": 0, "short_avg_cost": 0.0,
    })

    available_cash = player["cash"] - player.get("frozen_cash", 0)
    available_qty = holding["qty"] - holding.get("frozen_qty", 0)
    current_short = holding.get("short_qty", 0)

    # Crash mode: 无条件卖出
    if state.crash_mode and available_qty > 0:
        qty = min(available_qty, 50000)
        if qty >= 5000:
            await execute_trade(pid, {
                "stock_symbol": "DM", "quantity": qty, "trade_type": "sell",
            })
        return

    # ===== 国家队特殊逻辑 =====
    if qd.get("strategy") == "national_team":
        base_price = qd.get("nat_base_price", price)
        drop_pct = (base_price - price) / base_price  # 跌幅
        trigger = qd.get("nat_trigger", 0.10)  # 触发阈值，如 0.20 表示跌 20%

        # 更新基准价（跟随市场缓慢调整，但只在上涨时更新，下跌时不更新）
        if price > base_price * 1.05:
            qd["nat_base_price"] = price

        if drop_pct >= trigger and available_cash > 500000:
            # 跌幅越深，买入量越大
            intensity = min((drop_pct - trigger) / 0.10, 1.0)  # 每多跌 10% 加一倍力度
            invest_pct = min(0.15 + intensity * 0.35, 0.50)  # 15% ~ 50% 可用资金
            total_budget = int(available_cash * invest_pct)
            max_qty = int(total_budget / price)
            max_qty = min(max_qty, qd["position_limit"] - holding["qty"])
            if max_qty >= 10000:
                # 分 5 档挂限价单：在当前价下方 0.5% ~ 5%
                tier_qtys = [
                    int(max_qty * 0.15),  # -0.5%
                    int(max_qty * 0.20),  # -1%
                    int(max_qty * 0.20),  # -2%
                    int(max_qty * 0.25),  # -3%
                    int(max_qty * 0.20),  # -5%
                ]
                tier_prices = [
                    round(price * 0.995, 4),
                    round(price * 0.99, 4),
                    round(price * 0.98, 4),
                    round(price * 0.97, 4),
                    round(price * 0.95, 4),
                ]
                for tqty, tprice in zip(tier_qtys, tier_prices):
                    if tqty < 2000 or tprice <= 0:
                        continue
                    await place_limit_order(pid, {
                        "stock_symbol": "DM", "quantity": tqty,
                        "order_type": "buy", "price": tprice,
                    })
        # 上涨时卖出：涨幅超过 trigger 时抛售持仓平抑泡沫
        rise_pct = (price - base_price) / base_price
        if rise_pct >= trigger and holding["qty"] > 10000:
            intensity = min((rise_pct - trigger) / 0.10, 1.0)
            sell_pct = min(0.10 + intensity * 0.25, 0.40)
            max_sell = int(holding["qty"] * sell_pct)
            max_sell = min(max_sell, holding["qty"] - holding.get("frozen_qty", 0))
            if max_sell >= 10000:
                tier_sell_qty = [
                    int(max_sell * 0.20),
                    int(max_sell * 0.25),
                    int(max_sell * 0.20),
                    int(max_sell * 0.20),
                    int(max_sell * 0.15),
                ]
                tier_sell_prices = [
                    round(price * 1.005, 4),
                    round(price * 1.01, 4),
                    round(price * 1.02, 4),
                    round(price * 1.03, 4),
                    round(price * 1.05, 4),
                ]
                for tqty, tprice in zip(tier_sell_qty, tier_sell_prices):
                    if tqty < 2000:
                        continue
                    await place_limit_order(pid, {
                        "stock_symbol": "DM", "quantity": tqty,
                        "order_type": "sell", "price": tprice,
                    })
        return  # 国家队不参与普通买卖逻辑

    # 计算信号 + 加入随机扰动（量化也不完美）
    signal = _compute_signal(qd["strategy"], price, state.price_history,
                             holding, player, state.news_feed)
    signal += random.uniform(-0.25, 0.25)
    signal = max(-1, min(1, signal))

    # 价格过低保护：低于 ¥5 时禁止做空，低于 ¥3 时强制只买不卖
    if price < 3.0:
        signal = abs(signal)  # 强制买入信号
    elif price < 5.0 and signal < 0:
        signal *= 0.3  # 卖信号大幅衰减

    # ===== 以挂单（限价单）为主 =====
    if signal > 0.15 and available_cash > 100000:
        # 买入信号：在现价下方挂限价买单（吃单/护盘）
        max_qty = int(available_cash * 0.25 / price)
        base_qty = int(max_qty * abs(signal) * qd["risk"])
        base_qty = min(base_qty, 50000)
        base_qty = min(base_qty, qd["position_limit"] - holding["qty"])
        base_qty = max(base_qty, 2000)
        if base_qty >= 2000:
            # 分 3 档挂限价单，分布在 -0.3% ~ -1.5%
            tiers = [
                (round(price * 0.997, 4), int(base_qty * 0.3)),
                (round(price * 0.992, 4), int(base_qty * 0.3)),
                (round(price * 0.985, 4), int(base_qty * 0.4)),
            ]
            for limit_price, tqty in tiers:
                if limit_price <= 0 or tqty < 500:
                    continue
                await place_limit_order(pid, {
                    "stock_symbol": "DM", "quantity": tqty,
                    "order_type": "buy", "price": limit_price,
                })

    elif signal < -0.15:
        # 卖出信号：在现价上方挂限价卖单
        if available_qty > 1000:
            base_qty = int(available_qty * abs(signal) * qd["risk"])
            base_qty = min(base_qty, 50000)
            base_qty = max(base_qty, 2000)
            if base_qty >= 2000:
                tiers = [
                    (round(price * 1.003, 4), int(base_qty * 0.3)),
                    (round(price * 1.008, 4), int(base_qty * 0.3)),
                    (round(price * 1.015, 4), int(base_qty * 0.4)),
                ]
                for limit_price, tqty in tiers:
                    if tqty < 500:
                        continue
                    await place_limit_order(pid, {
                        "stock_symbol": "DM", "quantity": tqty,
                        "order_type": "sell", "price": limit_price,
                    })

        # 激进型基金少量做空（仅限价格 ≥ ¥8，signal < -0.5）
        if qd["risk"] > 0.55 and signal < -0.5 and current_short < MAX_POSITION_PER_PLAYER and price >= 8.0:
            short_qty = min(int(available_cash * 0.05 / price), 15000)
            remaining_limit = MAX_POSITION_PER_PLAYER - current_short
            short_qty = min(short_qty, remaining_limit)
            if short_qty >= 3000:
                await execute_trade(pid, {
                    "stock_symbol": "DM", "quantity": short_qty, "trade_type": "short_sell",
                })


# ---------------------------------------------------------------------------
# Leaderboard calculation
# ---------------------------------------------------------------------------
def calc_leaderboard() -> list[dict]:
    state = get_global_state()
    entries = []
    for pid, pdata in state.players.items():
        if pdata.get("is_admin"):
            continue
        if pid.startswith("retail_") or pid.startswith("ai_") or pid.startswith("_market_") or pid.startswith("npc_") or pid.startswith("inst_") or pid.startswith("hot_") or pid.startswith("q_") or pid.startswith("nat_") or pid == "zhuangjia":
            continue
        total = pdata["cash"]
        player_holdings = state.holdings.get(pid, {})
        for sym, h in player_holdings.items():
            sp = state.stocks.get(sym, {})
            cur_price = sp.get("price", 0)
            total += h["qty"] * cur_price  # long position
            total -= h.get("short_qty", 0) * cur_price  # short liability
        total -= pdata.get("margin_debt", 0)  # margin debt
        pnl_pct = round(((total - STARTING_CASH) / STARTING_CASH) * 100, 2)
        entries.append({
            "player_id": pid,
            "nickname": pdata["nickname"] or f"玩家{pid[:4]}",
            "total_assets": round(total, 2),
            "pnl_percent": pnl_pct,
        })
    entries.sort(key=lambda e: e["total_assets"], reverse=True)
    for i, e in enumerate(entries, 1):
        e["rank"] = i
    return entries


async def broadcast_leaderboard():
    rankings = calc_leaderboard()
    await manager.broadcast(GLOBAL_ROOM_ID, {
        "type": "leaderboard",
        "data": {"rankings": rankings},
    })


# ---------------------------------------------------------------------------
# 计算玩家总资产和担保比例
# ---------------------------------------------------------------------------
def calc_player_assets(player_id: str) -> tuple:
    """Return (total_assets, collateral_ratio) for a player.
    collateral_ratio = total_assets / margin_debt * 100 (%), or None if no debt."""
    state = get_global_state()
    pdata = state.players.get(player_id)
    if not pdata:
        return (0, None)
    total = pdata["cash"]
    for sym, h in state.holdings.get(player_id, {}).items():
        sp = state.stocks.get(sym, {})
        cur_price = sp.get("price", 0)
        total += h["qty"] * cur_price
        total -= h.get("short_qty", 0) * cur_price
    md = pdata.get("margin_debt", 0)
    total -= md
    ratio = (total / md) * 100 if md > 0 else None
    return (round(total, 2), ratio)


async def check_forced_liquidation():
    """检查所有玩家担保比例，跌破 130% 时强制平仓归还融资负债。"""
    state = get_global_state()
    for pid, pdata in list(state.players.items()):
        if pid.startswith(("ai_", "npc_", "inst_", "hot_", "q_", "nat_", "zhuangjia", "_market_")):
            continue
        md = pdata.get("margin_debt", 0)
        if md <= 0:
            continue
        total, ratio = calc_player_assets(pid)
        if ratio is None or ratio >= 130:
            continue
        # 担保比例 < 130%，强制平仓
        # 计算需要归还多少才能回到 150%
        target_debt = max(total, 0) / 1.5 if total > 0 else 0  # 目标负债
        need_repay = round(md - target_debt, 2)
        if need_repay <= 0:
            continue
        # 卖出持仓归还
        player = pdata
        player_holdings = state.holdings.get(pid, {})
        for sym, h in list(player_holdings.items()):
            if need_repay <= 0:
                break
            available = h["qty"] - h.get("frozen_qty", 0)
            if available <= 0:
                continue
            stock = state.stocks.get(sym)
            if not stock:
                continue
            price = stock["price"]
            # 计算需要卖多少股才能凑够 need_repay
            # 卖出后净收入 ≈ price * qty * (1 - stamp_tax - commission_rate)
            net_per_share = round(price * (1 - STAMP_TAX_RATE - COMMISSION_RATE), 4)
            if net_per_share <= 0:
                continue
            sell_qty = min(available, int(need_repay / net_per_share) + 100)
            if sell_qty < 100:
                continue
            # 执行强制卖出
            sell_cost = round(price * sell_qty, 2)
            sell_commission = round(max(sell_cost * COMMISSION_RATE, MIN_COMMISSION), 2)
            sell_stamp = round(sell_cost * STAMP_TAX_RATE, 2)
            sell_fee = sell_commission + sell_stamp
            net_sell = round(sell_cost - sell_fee, 2)
            # 先还融资负债
            repay = min(net_sell, md)
            player["margin_debt"] = round(md - repay, 2)
            player["cash"] = round(player["cash"] + net_sell - repay, 2)
            md = player["margin_debt"]
            # 更新持仓
            h["qty"] -= sell_qty
            if h["qty"] == 0:
                h["avg_cost"] = 0.0
            # 市场影响
            stock["volume"] += sell_qty
            impact = round(price * (sell_qty / SHARES_OUTSTANDING) * 100, 6)
            stock["price"] = round(max(PRICE_MIN, min(PRICE_MAX, stock["price"] - impact)), 4)
            # 记录成交明细
            state.trade_tape.insert(0, {
                "time": datetime.utcnow().strftime("%H:%M:%S"),
                "price": price, "quantity": sell_qty, "type": "forced_liquidation",
            })
            mark_dirty(pid)
            # 发送平仓通知
            await manager.send_to(GLOBAL_ROOM_ID, pid, {
                "type": "trade_executed",
                "data": {
                    "stock_symbol": sym, "quantity": sell_qty,
                    "price": price, "total": sell_cost, "trade_type": "sell",
                    "commission": sell_commission, "stamp_tax": sell_stamp,
                    "total_fee": sell_fee, "reason": "担保比例不足，强制平仓",
                },
            })
            # 发送 portfolio_update 刷新持仓
            cash_after = player["cash"]
            holdings_list = []
            total_assets = cash_after
            for sym2, h2 in state.holdings.get(pid, {}).items():
                sp2 = state.stocks.get(sym2, {})
                cp2 = sp2.get("price", 0)
                mv2 = round(h2["qty"] * cp2, 2)
                pnl2 = round(mv2 - h2["qty"] * h2["avg_cost"], 2) if h2["qty"] > 0 else 0
                short_mv2 = round(h2.get("short_qty", 0) * cp2, 2)
                short_pnl2 = round((h2.get("short_avg_cost", 0) - cp2) * h2.get("short_qty", 0), 2) if h2.get("short_qty", 0) > 0 else 0
                holdings_list.append({
                    "symbol": sym2, "name": sp2.get("name", sym2),
                    "quantity": h2["qty"], "avg_cost": h2["avg_cost"],
                    "current_price": cp2, "market_value": mv2, "pnl": pnl2,
                    "frozen_qty": h2.get("frozen_qty", 0),
                    "short_qty": h2.get("short_qty", 0),
                    "short_avg_cost": h2.get("short_avg_cost", 0),
                    "short_market_value": short_mv2, "short_pnl": short_pnl2,
                })
                total_assets += mv2 - short_mv2
            md_val = player.get("margin_debt", 0)
            total_assets -= md_val
            frozen_cash_val = player.get("frozen_cash", 0)
            buying_power_val = round((cash_after - frozen_cash_val) * 2.0, 2)
            total_pnl = round(total_assets - STARTING_CASH, 2)
            pnl_pct = round((total_pnl / STARTING_CASH) * 100, 2)
            day_start_val = state.day_start_assets.get(pid, total_assets)
            await manager.send_to(GLOBAL_ROOM_ID, pid, {
                "type": "portfolio_update",
                "data": {
                    "cash": round(cash_after, 2), "holdings": holdings_list,
                    "total_assets": round(total_assets, 2),
                    "frozen_cash": frozen_cash_val,
                    "margin_debt": md_val,
                    "buying_power": buying_power_val,
                    "total_pnl": total_pnl, "pnl_percent": pnl_pct,
                    "day_start_assets": day_start_val,
                },
            })
            logger.warning("Forced liquidation: %s sold %d %s at %.4f to repay margin", pid, sell_qty, sym, price)
            need_repay = round(need_repay - net_sell, 2)

            # 如果资产已经不足以偿还，清理剩余债务
            if md <= 0 or need_repay <= 0:
                break

        # 如果所有持仓卖完还不够还债，剩余债务减免（风控兜底）
        md = player.get("margin_debt", 0)


# ---------------------------------------------------------------------------
# AI 证监会 — 自动监控 & 执法
# ---------------------------------------------------------------------------
SEC_OWNERSHIP_LIMIT = 0.25
SEC_PRICE_SURGE = 0.12
SEC_CHECK_INTERVAL = 60
SEC_FINE_TIER = [100000, 300000, 800000, 2000000]
SEC_RESTRICT_TIER = [0, 1, 2, 4]
QUARTER_TICKS = 200

async def sec_regulator_check():
    """AI 证监会扫描所有玩家，发现异常行为并执法。
    每 60 tick 运行一次。"""
    state = get_global_state()
    if "_sec_log" not in state.__dict__:
        state._sec_log = []

    for pid, pdata in list(state.players.items()):
        if pid.startswith(("ai_", "npc_", "inst_", "hot_", "q_", "nat_", "_market_")):
            continue
        if pdata.get("is_admin"):
            continue  # 不检查管理员

        # 初始化监管状态（新版：支持 tier 和 restrict_quarters）
        if "_sec_violations" not in pdata:
            pdata["_sec_violations"] = 0
            pdata["_sec_restrict_quarters"] = 0
            pdata["_sec_total_fines"] = 0

        # 如果处于限制期，跳过检查（限制期间不累计新违规）
        if pdata["_sec_restrict_quarters"] > 0:
            continue

        # --- 指标计算 ---
        cash = pdata["cash"]
        long_qty = 0
        long_mv = 0
        short_qty = 0
        short_mv = 0
        for sym, h in state.holdings.get(pid, {}).items():
            sp = state.stocks.get(sym, {})
            price = sp.get("price", 0)
            long_qty += h["qty"]
            long_mv += h["qty"] * price
            short_qty += h.get("short_qty", 0)
            short_mv += h.get("short_qty", 0) * price
        md = pdata.get("margin_debt", 0)
        trade_count = pdata.get("_trade_count", 0)
        pdata["_trade_count"] = 0  # 重置计数器（每 60 tick 窗口）

        total = cash + long_mv - short_mv - md

        red_flags = []
        violation_symbols = set()

        # 1. 持仓占比过高（可能坐庄操纵）：long_qty > SHARES_OUTSTANDING * 25%
        outstanding = SHARES_OUTSTANDING
        for sym, h in state.holdings.get(pid, {}).items():
            if h["qty"] > outstanding * SEC_OWNERSHIP_LIMIT:
                ratio = h["qty"] / outstanding * 100
                red_flags.append(f"持仓占比过高({sym}:{ratio:.1f}%)")
                violation_symbols.add(sym)

        # 2. 高频交易：60 tick 内 > 30 笔
        if trade_count > 30:
            red_flags.append(f"高频交易({trade_count}笔/窗口)")

        if not red_flags:
            continue

        # --- 执法 ---
        pdata["_sec_violations"] += 1
        violations = pdata["_sec_violations"]
        tier_idx = min(violations - 1, len(SEC_FINE_TIER) - 1)
        if tier_idx < 0:
            tier_idx = 0

        fine_amount = SEC_FINE_TIER[tier_idx]
        restrict_q = SEC_RESTRICT_TIER[tier_idx] if tier_idx < len(SEC_RESTRICT_TIER) else SEC_RESTRICT_TIER[-1]

        # 执行罚款
        player_cash = pdata["cash"]
        actual_fine = min(fine_amount, player_cash * 0.5)
        actual_fine = round(max(actual_fine, 1000), 2)
        if actual_fine > 0:
            pdata["cash"] = round(player_cash - actual_fine, 2)
            pdata["_sec_total_fines"] = pdata.get("_sec_total_fines", 0) + actual_fine
            mark_dirty(pid)

        # 设置限制季度数
        if restrict_q > 0:
            pdata["_sec_restrict_quarters"] = restrict_q

        # 记录日志
        sym_str = ", ".join(violation_symbols) if violation_symbols else "DM"
        log_entry = {
            "tick": getattr(state, '_price_tick_count', 0),
            "player_id": pid,
            "action": "fine",
            "symbol": sym_str,
            "tier": violations,
            "fine": actual_fine,
            "restrict_quarters": restrict_q,
            "reason": "; ".join(red_flags),
        }
        state._sec_log.append(log_entry)
        if len(state._sec_log) > 200:
            state._sec_log = state._sec_log[-200:]

        # 发送通知
        msg = f"【AI证监会】检测到违规行为: {'; '.join(red_flags)}"
        msg += f"\n罚款 ¥{actual_fine:,.2f}，限制交易 {restrict_q} 季度"
        await manager.send_to(GLOBAL_ROOM_ID, pid, {
            "type": "regulator_notice",
            "data": {"level": "fine" if actual_fine > 0 else "warning", "message": msg},
        })
        logger.warning("SEC -> %s tier=%d fine=%.2f restrict=%d reasons=%s",
                       pid, violations, actual_fine, restrict_q, "; ".join(red_flags))


# ---------------------------------------------------------------------------
# 庄家操盘：4 阶段周期（吸筹->拉升->洗盘->出货）
# ---------------------------------------------------------------------------
async def _zhuangjia_make_decision(state):
    stock = state.stocks.get("DM")
    if not stock:
        return
    price = stock["price"]
    player = state.players.get("zhuangjia")
    if not player:
        return
    zd = state.zhuang_data
    if not zd:
        return
    holding = state.holdings.setdefault("zhuangjia", {}).setdefault("DM", {"qty": 0, "avg_cost": 0.0, "frozen_qty": 0, "short_qty": 0, "short_avg_cost": 0.0})

    # Crash mode: 无条件卖出
    if state.crash_mode:
        available_qty = holding["qty"] - holding.get("frozen_qty", 0)
        if available_qty > 0:
            qty = min(available_qty, 80000)
            if qty >= 5000:
                await execute_trade("zhuangjia", {
                    "stock_symbol": "DM", "quantity": qty, "trade_type": "sell",
                })
        return

    ma20 = _ma(state.price_history, 20) or price
    phase = zd.get("phase", "accumulate")
    zd["phase_ticks"] = zd.get("phase_ticks", 0) + 1
    available_cash = player["cash"] - player.get("frozen_cash", 0)
    available_qty = holding["qty"] - holding.get("frozen_qty", 0)

    if phase == "accumulate" and (price > ma20 * 1.03 or zd["phase_ticks"] > 250):
        zd["phase"] = "pump"
        zd["phase_ticks"] = 0
        logger.info("庄家进入拉升阶段")
    elif phase == "pump" and (price > zd.get("target_price", price) or zd["phase_ticks"] > 80):
        zd["phase"] = "shakeout"
        zd["phase_ticks"] = 0
        logger.info("庄家进入洗盘阶段")
    elif phase == "shakeout" and (price < ma20 * 0.97 or zd["phase_ticks"] > 50):
        zd["phase"] = "distribute"
        zd["phase_ticks"] = 0
        logger.info("庄家进入出货阶段")
    elif phase == "distribute" and (holding["qty"] < 50000 or zd["phase_ticks"] > 200):
        zd["phase"] = "accumulate"
        zd["phase_ticks"] = 0
        logger.info("庄家重新进入吸筹阶段")

    phase = zd["phase"]
    if phase == "accumulate":
        if available_cash > 500000 and holding["qty"] < zd["position_limit"]:
            limit_price = round(price * random.uniform(0.95, 0.99), 4)
            qty = min(int(available_cash * 0.08 / price), 80000)
            if qty >= 5000:
                await place_limit_order("zhuangjia", {
                    "stock_symbol": "DM", "quantity": qty,
                    "order_type": "buy", "price": limit_price,
                })
    elif phase == "pump":
        if available_cash > 500000:
            qty = min(int(available_cash * 0.12 / price), 100000)
            if qty >= 5000:
                await execute_trade("zhuangjia", {
                    "stock_symbol": "DM", "quantity": qty, "trade_type": "buy",
                })
        if not zd.get("target_price"):
            zd["target_price"] = round(price * 1.15, 2)
    elif phase == "shakeout":
        if available_qty > 50000:
            qty = min(int(available_qty * 0.12), 50000)
            if qty >= 5000:
                await execute_trade("zhuangjia", {
                    "stock_symbol": "DM", "quantity": qty, "trade_type": "sell",
                })
    elif phase == "distribute":
        if available_qty > 50000:
            limit_price = round(price * random.uniform(1.0, 1.05), 4)
            qty = min(int(available_qty * 0.15), 150000)
            if qty >= 5000:
                await place_limit_order("zhuangjia", {
                    "stock_symbol": "DM", "quantity": qty,
                    "order_type": "sell", "price": limit_price,
                })


async def zhuangjia_trading_loop():
    state = get_global_state()
    tick_count = 0
    while True:
        await asyncio.sleep(PRICE_TICK_INTERVAL)
        tick_count += 1
        if tick_count % random.randint(2, 4) != 0:
            continue
        try:
            await _zhuangjia_make_decision(state)
        except Exception as e:
            logger.error(f"庄家 error: {e}")


# ---------------------------------------------------------------------------
# Trade execution — 订单簿撮合引擎
# ---------------------------------------------------------------------------
async def _sweep_sell_orders(state, buyer_id: str, symbol: str, qty: int, max_cash: float) -> dict | None:
    """扫卖单：市价买入时从最低卖单开始吃。
    Returns {filled_qty, avg_price, last_price, total_cost, commission, fills} or None."""
    # 收集所有卖单（排除自己的），按价格升序排列
    sells = []
    for oid, o in list(state.pending_orders.items()):
        if o["symbol"] == symbol and o["type"] == "sell" and o["status"] == "pending" and o["player_id"] != buyer_id:
            available = o["quantity"] - o["filled"]
            if available > 0:
                sells.append((oid, o, available))
    sells.sort(key=lambda x: x[1]["price"])  # 最便宜的优先

    if not sells:
        return None

    remaining = qty
    total_cost = 0
    last_price = 0
    fills = []
    stock = state.stocks[symbol]

    for oid, order, available in sells:
        if remaining <= 0:
            break
        fill_qty = min(remaining, available)
        fill_price = order["price"]
        fill_cost = round(fill_qty * fill_price, 2)

        # Check budget (cash on hand + margin buying power)
        if max_cash is not None and total_cost + fill_cost > max_cash:
            break  # 钱不够了，停止

        # 吃单方（买方）的佣金
        buyer_comm = round(max(fill_cost * COMMISSION_RATE, MIN_COMMISSION), 2)
        if max_cash is not None and total_cost + fill_cost + buyer_comm > max_cash:
            break

        # --- 执行成交 ---
        order["filled"] += fill_qty
        if order["filled"] >= order["quantity"]:
            order["status"] = "filled"

        # 卖方收到钱（扣除佣金+印花税）
        seller = state.players.get(order["player_id"])
        if seller:
            seller_comm = round(max(fill_cost * COMMISSION_RATE, MIN_COMMISSION), 2)
            seller_stamp = round(fill_cost * STAMP_TAX_RATE, 2)
            seller_net = round(fill_cost - seller_comm - seller_stamp, 2)
            seller["cash"] = round(seller["cash"] + seller_net, 2)
            mark_dirty(order["player_id"])

        # 卖方减少冻结持仓
        seller_holding = state.holdings.get(order["player_id"], {}).get(symbol)
        if seller_holding:
            seller_holding["frozen_qty"] = max(0, seller_holding.get("frozen_qty", 0) - fill_qty)

        # 释放卖方限价单冻结的现金预留（卖单没有cash reserve，但订单可能有关联逻辑）
        # 卖单的保留字段处理
        order_reserved = order.get("_reserved", 0)
        if order_reserved > 0:
            remaining_ratio = (order["quantity"] - order["filled"]) / max(order["quantity"], 1)
            order["_reserved"] = round(order_reserved * remaining_ratio, 2)

        remaining -= fill_qty
        total_cost += fill_cost
        last_price = fill_price

        fills.append({"price": fill_price, "qty": fill_qty, "cost": fill_cost, "commission": buyer_comm})

        # 记录成交到 tape
        state.trade_tape.insert(0, {
            "time": datetime.utcnow().strftime("%H:%M:%S"),
            "price": fill_price,
            "quantity": fill_qty,
            "type": "buy",
            "side": "active_buy",
        })
        if len(state.trade_tape) > 100:
            state.trade_tape = state.trade_tape[:100]
        # buy_volume 由调用方（execute_trade/_execute_limit_order）在公共尾部统一统计

    filled = qty - remaining
    if filled == 0:
        return None

    avg_price = round(total_cost / filled, 4) if filled > 0 else 0
    total_commission = round(sum(f["commission"] for f in fills), 2)

    return {
        "filled_qty": filled, "avg_price": avg_price, "last_price": last_price,
        "total_cost": total_cost, "commission": total_commission, "fills": fills,
    }


async def _sweep_buy_orders(state, seller_id: str, symbol: str, qty: int) -> dict | None:
    """扫买单：市价卖出时从最高买单开始砸。
    Returns {filled_qty, avg_price, last_price, total_proceeds, commission, stamp_tax, fills} or None."""
    buys = []
    for oid, o in list(state.pending_orders.items()):
        if o["symbol"] == symbol and o["type"] == "buy" and o["status"] == "pending" and o["player_id"] != seller_id:
            available = o["quantity"] - o["filled"]
            if available > 0:
                buys.append((oid, o, available))
    buys.sort(key=lambda x: x[1]["price"], reverse=True)  # 最高价优先

    if not buys:
        return None

    remaining = qty
    total_proceeds = 0
    last_price = 0
    fills = []
    stock = state.stocks[symbol]

    for oid, order, available in buys:
        if remaining <= 0:
            break
        fill_qty = min(remaining, available)
        fill_price = order["price"]
        fill_value = round(fill_qty * fill_price, 2)

        # --- 执行成交 ---
        order["filled"] += fill_qty
        if order["filled"] >= order["quantity"]:
            order["status"] = "filled"

        # 买方扣钱
        buyer = state.players.get(order["player_id"])
        if buyer:
            buyer_comm = round(max(fill_value * COMMISSION_RATE, MIN_COMMISSION), 2)
            buyer_total = round(fill_value + buyer_comm, 2)
            # 从冻结现金中扣除
            buyer["frozen_cash"] = max(0, buyer.get("frozen_cash", 0) - buyer_total)
            buyer["cash"] = round(buyer["cash"] - buyer_total, 2)
            mark_dirty(order["player_id"])

        # 买方增加持仓
        buyer_holding = state.holdings.setdefault(order["player_id"], {}).setdefault(symbol, {
            "qty": 0, "avg_cost": 0.0, "frozen_qty": 0, "short_qty": 0, "short_avg_cost": 0.0,
        })
        new_bqty = buyer_holding["qty"] + fill_qty
        buyer_holding["avg_cost"] = round(
            (buyer_holding["avg_cost"] * buyer_holding["qty"] + fill_value) / new_bqty, 2
        ) if new_bqty > 0 else 0
        buyer_holding["qty"] = new_bqty

        remaining -= fill_qty
        total_proceeds += fill_value
        last_price = fill_price

        # sell_volume 由调用方（execute_trade/_execute_limit_order）在公共尾部统一统计

        fills.append({"price": fill_price, "qty": fill_qty, "value": fill_value})

        # 记录成交到 tape
        state.trade_tape.insert(0, {
            "time": datetime.utcnow().strftime("%H:%M:%S"),
            "price": fill_price,
            "quantity": fill_qty,
            "type": "sell",
            "side": "active_sell",
        })
        if len(state.trade_tape) > 100:
            state.trade_tape = state.trade_tape[:100]

    filled = qty - remaining
    if filled == 0:
        return None

    avg_price = round(total_proceeds / filled, 4) if filled > 0 else 0
    commission = round(max(total_proceeds * COMMISSION_RATE, MIN_COMMISSION), 2)
    stamp_tax = round(total_proceeds * STAMP_TAX_RATE, 2)

    return {
        "filled_qty": filled, "avg_price": avg_price, "last_price": last_price,
        "total_proceeds": total_proceeds, "commission": commission,
        "stamp_tax": stamp_tax, "fills": fills,
    }


async def execute_trade(player_id: str, data: dict):
    state = get_global_state()

    symbol = data.get("stock_symbol", "").upper()
    qty = int(data.get("quantity", 0))
    trade_type = data.get("trade_type", "")

    if symbol not in state.stocks:
        await manager.send_to(GLOBAL_ROOM_ID, player_id, {
            "type": "trade_rejected",
            "data": {"reason": "无效的股票代码", "stock_symbol": symbol},
        })
        return

    if qty <= 0:
        await manager.send_to(GLOBAL_ROOM_ID, player_id, {
            "type": "trade_rejected",
            "data": {"reason": "数量必须大于0", "stock_symbol": symbol},
        })
        return

    # 单笔委托数量限制
    if qty > MAX_ORDER_QTY and not player_id.startswith("ai_") and not player_id.startswith("npc_") and not player_id.startswith("q_") and not player_id.startswith("nat_") and player_id != "zhuangjia" and not player_id.startswith("retail_"):
        await manager.send_to(GLOBAL_ROOM_ID, player_id, {
            "type": "trade_rejected",
            "data": {"reason": f"单笔委托数量不能超过 {MAX_ORDER_QTY} 股", "stock_symbol": symbol},
        })
        return

    # 获取玩家数据
    player = state.players.get(player_id)
    if not player:
        await manager.send_to(GLOBAL_ROOM_ID, player_id, {
            "type": "trade_rejected",
            "data": {"reason": "请先连接市场"},
        })
        return

    # 统计交易频率（用于证监会监控）
    player["_trade_count"] = player.get("_trade_count", 0) + 1

    stock = state.stocks[symbol]
    price = stock["price"]
    total_cost = round(price * qty, 2)

    player_holdings = state.holdings.setdefault(player_id, {})
    holding = player_holdings.setdefault(symbol, {"qty": 0, "avg_cost": 0.0, "frozen_qty": 0, "short_qty": 0, "short_avg_cost": 0.0})

    # Calculate fees（A股：买入不收印花税）
    commission = round(max(total_cost * COMMISSION_RATE, MIN_COMMISSION), 2)
    stamp_tax = round(total_cost * STAMP_TAX_RATE, 2) if trade_type == "sell" else 0
    total_fee = commission + stamp_tax

    # Shared result variables for common code
    fill_qty = 0
    fill_avg_price = price
    fill_commission = commission
    fill_stamp = stamp_tax
    fill_fee = total_fee
    fill_total_cost = total_cost

    if trade_type == "buy":
        # 持仓上限检查（总股本 5%）
        current_qty = holding.get("qty", 0)
        if current_qty + qty > MAX_POSITION_PER_PLAYER and not player_id.startswith("ai_") and not player_id.startswith("q_") and not player_id.startswith("nat_"):
            await manager.send_to(GLOBAL_ROOM_ID, player_id, {
                "type": "trade_rejected",
                "data": {"reason": f"单只股票持仓上限为 {MAX_POSITION_PER_PLAYER} 股，当前已持有 {current_qty} 股", "stock_symbol": symbol},
            })
            return
        available_cash = player["cash"] - player.get("frozen_cash", 0)
        margin_debt = player.get("margin_debt", 0.0)

        # 先做资金/担保比例验证（防止扫单后验证失败无法回滚）
        total_estimated = round(price * qty + max(commission, MIN_COMMISSION), 2)
        if total_estimated > available_cash:
            _, ratio = calc_player_assets(player_id)
            if not player_id.startswith(("ai_", "npc_", "inst_", "hot_", "q_", "nat_", "zhuangjia", "retail_")):
                gross = player["cash"]
                for sym, h in state.holdings.get(player_id, {}).items():
                    sp = state.stocks.get(sym, {})
                    gross += h["qty"] * sp.get("price", 0)
                if gross < MARGIN_MIN_ASSETS:
                    await manager.send_to(GLOBAL_ROOM_ID, player_id, {
                        "type": "trade_rejected",
                        "data": {"reason": f"融资交易需要账户总资产 ≥ ¥{MARGIN_MIN_ASSETS:,}", "stock_symbol": symbol},
                    })
                    return
                if ratio is not None and ratio < 300:
                    await manager.send_to(GLOBAL_ROOM_ID, player_id, {
                        "type": "trade_rejected",
                        "data": {"reason": f"担保比例不足({ratio:.2f}%)，需要 ≥ 300%", "stock_symbol": symbol},
                    })
                    return

        # 订单簿撮合：扫卖单
        result = await _sweep_sell_orders(state, player_id, symbol, qty, available_cash * 2.0)
        if result is None:
            await manager.send_to(GLOBAL_ROOM_ID, player_id, {
                "type": "trade_rejected",
                "data": {"reason": "没有足够的卖单，暂时无法成交", "stock_symbol": symbol},
            })
            return

        filled = result["filled_qty"]
        total_required = round(result["total_cost"] + result["commission"], 2)

        if total_required > available_cash:
            cash_used = min(available_cash, total_required)
            margin_used = round(total_required - cash_used, 2)
            player["cash"] = round(player["cash"] - cash_used, 2)
            if margin_used > 0:
                player["margin_debt"] = round(margin_debt + margin_used, 2)
        else:
            player["cash"] = round(player["cash"] - total_required, 2)

        # 更新持仓
        new_qty = holding["qty"] + filled
        holding["avg_cost"] = round(
            (holding["avg_cost"] * holding["qty"] + result["total_cost"]) / new_qty, 2
        ) if new_qty > 0 else 0
        holding["qty"] = new_qty
        stock["price"] = result["last_price"]
        stock["volume"] = stock.get("volume", 0) + filled
        stock["buy_volume"] = stock.get("buy_volume", 0) + filled
        mark_dirty(player_id)

        fill_qty = filled
        fill_avg_price = result["avg_price"]
        fill_commission = result["commission"]
        fill_stamp = 0
        fill_fee = result["commission"]
        fill_total_cost = result["total_cost"]

    elif trade_type == "sell":
        available_qty = holding["qty"] - holding.get("frozen_qty", 0)
        if qty > available_qty and holding.get("frozen_qty", 0) > 0:
            # 有冻结的卖单挂单，自动撤销后再试
            for oid, o in list(state.pending_orders.items()):
                if o["player_id"] == player_id and o["symbol"] == symbol and o["type"] == "sell" and o["status"] == "pending":
                    o["status"] = "cancelled"
                    h = state.holdings.get(player_id, {}).get(symbol)
                    if h:
                        h["frozen_qty"] = max(0, h.get("frozen_qty", 0) - (o["quantity"] - o["filled"]))
                    mark_dirty(player_id)
            available_qty = holding["qty"] - holding.get("frozen_qty", 0)
        if qty > available_qty:
            await manager.send_to(GLOBAL_ROOM_ID, player_id, {
                "type": "trade_rejected",
                "data": {
                    "reason": f"持仓不足，可卖 {max(0, available_qty)} 股",
                    "stock_symbol": symbol,
                    "requested_qty": qty,
                },
            })
            return

        # 订单簿撮合：扫买单
        result = await _sweep_buy_orders(state, player_id, symbol, min(qty, available_qty))
        if result is None:
            await manager.send_to(GLOBAL_ROOM_ID, player_id, {
                "type": "trade_rejected",
                "data": {"reason": "没有足够的买单，暂时无法成交", "stock_symbol": symbol},
            })
            return

        filled = result["filled_qty"]
        net_proceeds = round(result["total_proceeds"] - result["commission"] - result["stamp_tax"], 2)

        # 用卖股收入归还融资负债
        margin_debt = player.get("margin_debt", 0)
        if margin_debt > 0:
            repay = min(net_proceeds, margin_debt)
            player["margin_debt"] = round(margin_debt - repay, 2)
            player["cash"] = round(player["cash"] + net_proceeds - repay, 2)
        else:
            player["cash"] = round(player["cash"] + net_proceeds, 2)

        holding["qty"] -= filled
        if holding["qty"] == 0:
            holding["avg_cost"] = 0.0
        stock["price"] = result["last_price"]
        stock["sell_volume"] = stock.get("sell_volume", 0) + filled
        stock["volume"] = stock.get("volume", 0) + filled
        mark_dirty(player_id)

        fill_qty = filled
        fill_avg_price = result["avg_price"]
        fill_commission = result["commission"]
        fill_stamp = result["stamp_tax"]
        fill_fee = round(result["commission"] + result["stamp_tax"], 2)
        fill_total_cost = result["total_proceeds"]

    elif trade_type == "short_sell":
        # 融券卖出：借股票卖出
        current_short = holding.get("short_qty", 0)
        # 融资融券准入门槛：总资产（现金+市值）≥ 100 万
        if not player_id.startswith(("ai_", "npc_", "inst_", "hot_", "q_", "nat_", "zhuangjia", "retail_")):
            gross = player["cash"]
            for sym_g, h_g in state.holdings.get(player_id, {}).items():
                sp_g = state.stocks.get(sym_g, {})
                gross += h_g["qty"] * sp_g.get("price", 0)
            if gross < MARGIN_MIN_ASSETS:
                await manager.send_to(GLOBAL_ROOM_ID, player_id, {
                    "type": "trade_rejected",
                    "data": {"reason": f"融券交易需要账户总资产 ≥ ¥{MARGIN_MIN_ASSETS:,}，当前总资产 ¥{gross:,.2f}", "stock_symbol": symbol},
                })
                return
        if current_short + qty > MAX_POSITION_PER_PLAYER and not player_id.startswith("ai_") and not player_id.startswith("q_") and not player_id.startswith("nat_"):
            await manager.send_to(GLOBAL_ROOM_ID, player_id, {
                "type": "trade_rejected",
                "data": {"reason": f"融券持仓上限为 {MAX_POSITION_PER_PLAYER} 股，当前已融券 {current_short} 股", "stock_symbol": symbol},
            })
            return
        # 风控：融资卖出额以扣除融券收入后的净资产为基准
        # 防止"卖出越多→现金越多→可卖越多"的无限循环
        short_proceeds = holding.get("short_avg_cost", 0) * current_short  # 已收到的融券收入
        long_mv = holding.get("qty", 0) * price  # 多头市值
        equity_ex_shorts = player["cash"] + long_mv - player.get("margin_debt", 0) - short_proceeds
        max_short_value = round(max(equity_ex_shorts, 0) * 3.0, 2)  # 3x 净资产（不含融券收入）
        short_value = round(price * qty, 2)
        current_short_value = round(current_short * price, 2)
        if current_short_value + short_value > max_short_value and not player_id.startswith(("ai_", "npc_", "inst_", "hot_", "q_", "nat_", "zhuangjia", "retail_")):
            await manager.send_to(GLOBAL_ROOM_ID, player_id, {
                "type": "trade_rejected",
                "data": {"reason": f"融券卖出额超过购买力上限，需要 ¥{short_value:,.2f}，可用 ¥{max(0, max_short_value - current_short_value):,.2f}", "stock_symbol": symbol},
            })
            return
        # 订单簿撮合：扫买单（融券卖出 = 吃买方挂单）
        result = await _sweep_buy_orders(state, player_id, symbol, qty)
        if result is None:
            await manager.send_to(GLOBAL_ROOM_ID, player_id, {
                "type": "trade_rejected",
                "data": {"reason": "没有足够的买单，暂时无法融券卖出", "stock_symbol": symbol},
            })
            return
        filled_short = result["filled_qty"]
        net_proceeds = round(result["total_proceeds"] - result["commission"] - result["stamp_tax"], 2)
        player["cash"] = round(player["cash"] + net_proceeds, 2)
        # Update short position
        new_short_qty = current_short + filled_short
        holding["short_avg_cost"] = round(
            (holding.get("short_avg_cost", 0) * current_short + result["avg_price"] * filled_short) / new_short_qty, 2
        ) if new_short_qty > 0 else 0
        holding["short_qty"] = new_short_qty
        stock["price"] = result["last_price"]
        stock["sell_volume"] = stock.get("sell_volume", 0) + filled_short
        stock["volume"] = stock.get("volume", 0) + filled_short
        fill_qty = filled_short
        fill_avg_price = result["avg_price"]
        fill_commission = result["commission"]
        fill_stamp = result["stamp_tax"]
        fill_fee = round(result["commission"] + result["stamp_tax"], 2)
        fill_total_cost = result["total_proceeds"]
        mark_dirty(player_id)

    elif trade_type == "cover":
        # 买券还券：买入归还融券
        current_short = holding.get("short_qty", 0)
        if qty > current_short:
            await manager.send_to(GLOBAL_ROOM_ID, player_id, {
                "type": "trade_rejected",
                "data": {
                    "reason": f"融券持仓不足，需归还 {qty} 股，当前融券 {current_short} 股",
                    "stock_symbol": symbol,
                    "requested_qty": qty,
                },
            })
            return
        # 订单簿撮合：扫卖单（买券还券 = 吃卖方挂单）
        result = await _sweep_sell_orders(state, player_id, symbol, qty, player["cash"] - player.get("frozen_cash", 0))
        if result is None:
            await manager.send_to(GLOBAL_ROOM_ID, player_id, {
                "type": "trade_rejected",
                "data": {"reason": "没有足够的卖单，暂时无法买券还券", "stock_symbol": symbol},
            })
            return
        filled_cover = result["filled_qty"]
        total_required = round(result["total_cost"] + result["commission"], 2)
        player["cash"] = round(player["cash"] - total_required, 2)
        # Reduce short position
        holding["short_qty"] = current_short - filled_cover
        if holding["short_qty"] == 0:
            holding["short_avg_cost"] = 0.0
        stock["price"] = result["last_price"]
        stock["buy_volume"] = stock.get("buy_volume", 0) + filled_cover
        stock["volume"] = stock.get("volume", 0) + filled_cover
        fill_qty = filled_cover
        fill_avg_price = result["avg_price"]
        fill_commission = result["commission"]
        fill_stamp = 0
        fill_fee = result["commission"]
        fill_total_cost = result["total_cost"]
        mark_dirty(player_id)

    else:
        await manager.send_to(GLOBAL_ROOM_ID, player_id, {
            "type": "trade_rejected",
            "data": {"reason": "无效的交易类型", "stock_symbol": symbol},
        })
        return

    # Record transaction in DB
    try:
        async with async_session() as session:
            tx = Transaction(
                player_id=player_id,
                symbol=symbol,
                trade_type=trade_type,
                quantity=fill_qty,
                price=fill_avg_price,
                total=fill_total_cost,
            )
            session.add(tx)
            await session.commit()
    except Exception as e:
        logger.error(f"Failed to record transaction: {e}")

    # Add to trade tape (use actual fill values, not request values)
    side = "active_buy" if trade_type in ("buy", "cover") else "active_sell"
    state.trade_tape.insert(0, {
        "time": datetime.utcnow().strftime("%H:%M:%S"),
        "price": fill_avg_price,
        "quantity": fill_qty,
        "type": trade_type,
        "side": side,
    })
    if len(state.trade_tape) > 100:
        state.trade_tape = state.trade_tape[:100]

    # 大单冲击：成交 > 流通股 0.1% 时影响 EPS/NAV
    if fill_qty >= SHARES_OUTSTANDING * 0.001:
        eps_impact = random.uniform(-0.005, 0.01)
        nav_impact = random.uniform(-0.008, 0.005)
        if trade_type in ("buy", "cover"):
            stock["eps"] = round(stock["eps"] * (1 + eps_impact), 4)
        else:
            stock["eps"] = round(stock["eps"] * (1 - eps_impact * 0.5), 4)
        stock["nav"] = round(stock["nav"] * (1 + nav_impact), 4)

    # Send trade_executed to player
    await manager.send_to(GLOBAL_ROOM_ID, player_id, {
        "type": "trade_executed",
        "data": {
            "stock_symbol": symbol,
            "quantity": fill_qty,
            "price": fill_avg_price,
            "total": fill_total_cost,
            "trade_type": trade_type,
            "commission": fill_commission,
            "stamp_tax": fill_stamp,
            "total_fee": fill_fee,
        },
    })

    # Send portfolio_update to player
    cash = player["cash"]
    holdings_list = []
    total_assets = cash
    for sym, h in state.holdings.get(player_id, {}).items():
        sp = state.stocks.get(sym, {})
        cur_price = sp.get("price", 0)
        mv = round(h["qty"] * cur_price, 2)
        pnl = round(mv - h["qty"] * h["avg_cost"], 2) if h["qty"] > 0 else 0
        short_mv = round(h.get("short_qty", 0) * cur_price, 2)
        short_pnl = round((h.get("short_avg_cost", 0) - cur_price) * h.get("short_qty", 0), 2) if h.get("short_qty", 0) > 0 else 0

        holdings_list.append({
            "symbol": sym,
            "name": sp.get("name", sym),
            "quantity": h["qty"],
            "avg_cost": h["avg_cost"],
            "current_price": cur_price,
            "market_value": mv,
            "pnl": pnl,
            "frozen_qty": h.get("frozen_qty", 0),
            "short_qty": h.get("short_qty", 0),
            "short_avg_cost": h.get("short_avg_cost", 0),
            "short_market_value": short_mv,
            "short_pnl": short_pnl,
        })
        total_assets += mv
        total_assets -= short_mv  # short liability
    total_assets -= player.get("margin_debt", 0)  # margin debt

    total_pnl = round(total_assets - STARTING_CASH, 2)
    pnl_pct = round((total_pnl / STARTING_CASH) * 100, 2)

    await manager.send_to(GLOBAL_ROOM_ID, player_id, {
        "type": "portfolio_update",
        "data": {
            "cash": round(cash, 2),
            "holdings": holdings_list,
            "total_assets": round(total_assets, 2),
            "total_pnl": total_pnl,
            "pnl_percent": pnl_pct,
            "frozen_cash": player.get("frozen_cash", 0),
            "margin_debt": player.get("margin_debt", 0),
            "buying_power": round((cash - player.get("frozen_cash", 0)) * 2.0, 2),
            "day_start_assets": state.day_start_assets.get(player_id, total_assets),
        },
    })


# ---------------------------------------------------------------------------
# Limit order execution
# ---------------------------------------------------------------------------
async def _execute_limit_order(order: dict, quantity: int, price: float):
    state = get_global_state()
    player_id = order["player_id"]
    symbol = order["symbol"]
    trade_type = order["type"]
    qty_to_execute = min(quantity, order["quantity"] - order["filled"])
    if qty_to_execute <= 0:
        return

    stock = state.stocks.get(symbol)
    if not stock:
        return
    player = state.players.get(player_id)
    if not player:
        return

    total_cost = round(price * qty_to_execute, 2)
    player_holdings = state.holdings.setdefault(player_id, {})
    holding = player_holdings.setdefault(symbol, {"qty": 0, "avg_cost": 0.0, "frozen_qty": 0, "short_qty": 0, "short_avg_cost": 0.0})

    commission = round(max(total_cost * COMMISSION_RATE, MIN_COMMISSION), 2)
    stamp_tax = round(total_cost * STAMP_TAX_RATE, 2)
    total_fee = commission + (stamp_tax if trade_type == "sell" else 0)

    if trade_type == "buy":
        # 持仓上限检查
        current_qty = holding.get("qty", 0)
        if current_qty + qty_to_execute > MAX_POSITION_PER_PLAYER and not player_id.startswith(("ai_", "q_", "nat_", "zhuangjia", "retail_")):
            return
        # 走订单簿扫单
        total_needed = round(price * qty_to_execute, 2)
        own_reserved = order.get("_reserved", 0)
        available_cash = player["cash"] - player.get("frozen_cash", 0) + own_reserved
        margin_debt = player.get("margin_debt", 0.0)
        max_cash_for_buy = available_cash
        if total_needed + commission > available_cash:
            _, ratio = calc_player_assets(player_id)
            if ratio is not None and ratio >= 300 and not player_id.startswith(("ai_", "npc_", "inst_", "hot_", "q_", "nat_", "zhuangjia", "retail_")):
                max_cash_for_buy = available_cash * 2.0
            else:
                max_qty_by_cash = int((available_cash - commission) / price) if price > 0 else 0
                qty_to_execute = min(qty_to_execute, max_qty_by_cash)
                if qty_to_execute <= 0:
                    return
                total_needed = round(price * qty_to_execute, 2)
        result = await _sweep_sell_orders(state, player_id, symbol, qty_to_execute, max_cash_for_buy)
        if result:
            fill_qty = result["filled_qty"]
            fill_avg_price = result["avg_price"]
            fill_total_cost = result["total_cost"]
            fill_commission = result["commission"]
            order["filled"] += fill_qty
            if order["filled"] >= order["quantity"]:
                order["status"] = "filled"
            new_qty = holding["qty"] + fill_qty
            holding["avg_cost"] = round(
                (holding["avg_cost"] * holding["qty"] + fill_total_cost) / new_qty, 2
            ) if new_qty > 0 else 0
            holding["qty"] = new_qty
            reserved_total = order.get("_reserved", total_needed)
            fill_ratio = fill_qty / order["quantity"] if order["quantity"] > 0 else 0
            unfreeze = round(reserved_total * fill_ratio, 2)
            player["frozen_cash"] = max(0, player.get("frozen_cash", 0) - unfreeze)
            player["cash"] = round(player["cash"] - fill_total_cost - fill_commission, 2)
            mark_dirty(player_id)
            stock["price"] = round(max(PRICE_MIN, min(PRICE_MAX, result["last_price"])), 4)
        else:
            if available_cash <= 0:
                return
            max_qty_cash = int(available_cash / price) if price > 0 else 0
            qty_to_execute = min(qty_to_execute, max_qty_cash)
            if qty_to_execute <= 0:
                return
            total_cost = round(price * qty_to_execute, 2)
            commission = round(max(total_cost * COMMISSION_RATE, MIN_COMMISSION), 2)
            new_qty = holding["qty"] + qty_to_execute
            holding["avg_cost"] = round(
                (holding["avg_cost"] * holding["qty"] + price * qty_to_execute) / new_qty, 2
            ) if new_qty > 0 else 0
            holding["qty"] = new_qty
            player["cash"] = round(player["cash"] - total_cost - commission, 2)
            mark_dirty(player_id)
            impact = round(price * (qty_to_execute / SHARES_OUTSTANDING) * 50, 6)
            stock["price"] = round(max(PRICE_MIN, min(PRICE_MAX, stock["price"] + impact)), 4)
            order["filled"] += qty_to_execute
            if order["filled"] >= order["quantity"]:
                order["status"] = "filled"
            fill_commission = commission
            fill_qty = qty_to_execute
            fill_avg_price = price
            fill_total_cost = total_cost

    elif trade_type == "sell":
        order_remaining = order["quantity"] - order["filled"]
        available_long = holding["qty"] - holding.get("frozen_qty", 0) + order_remaining
        sell_from_long = min(qty_to_execute, max(0, available_long))
        if sell_from_long <= 0:
            return
        qty_to_execute = sell_from_long
        result = await _sweep_buy_orders(state, player_id, symbol, qty_to_execute)
        if result:
            fill_qty = result["filled_qty"]
            fill_avg_price = result["avg_price"]
            fill_total_proceeds = result["total_proceeds"]
            fill_commission = result["commission"]
            fill_stamp = result["stamp_tax"]
            fill_fee = fill_commission + fill_stamp
            order["filled"] += fill_qty
            if order["filled"] >= order["quantity"]:
                order["status"] = "filled"
            holding["frozen_qty"] = max(0, holding.get("frozen_qty", 0) - fill_qty)
            holding["qty"] -= fill_qty
            net_proceeds = round(fill_total_proceeds - fill_commission - fill_stamp, 2)
            margin_debt_sell = player.get("margin_debt", 0)
            if margin_debt_sell > 0:
                repay_sell = min(net_proceeds, margin_debt_sell)
                player["margin_debt"] = round(margin_debt_sell - repay_sell, 2)
                player["cash"] = round(player["cash"] + net_proceeds - repay_sell, 2)
            else:
                player["cash"] = round(player["cash"] + net_proceeds, 2)
            if holding["qty"] == 0:
                holding["avg_cost"] = 0.0
            mark_dirty(player_id)
            stock["price"] = round(max(PRICE_MIN, min(PRICE_MAX, result["last_price"])), 4)
            commission = fill_commission
            stamp_tax = fill_stamp
            fill_fee = fill_fee
        else:
            total_cost = round(price * qty_to_execute, 2)
            holding["frozen_qty"] = max(0, holding.get("frozen_qty", 0) - qty_to_execute)
            commission = round(max(total_cost * COMMISSION_RATE, MIN_COMMISSION), 2)
            stamp_tax = round(total_cost * STAMP_TAX_RATE, 2)
            total_fee = commission + stamp_tax
            net = round(total_cost - total_fee, 2)
            margin_debt = player.get("margin_debt", 0)
            if margin_debt > 0:
                repay = min(net, margin_debt)
                player["margin_debt"] = round(margin_debt - repay, 2)
                player["cash"] = round(player["cash"] + net - repay, 2)
            else:
                player["cash"] = round(player["cash"] + net, 2)
            holding["qty"] -= qty_to_execute
            if holding["qty"] == 0:
                holding["avg_cost"] = 0.0
            mark_dirty(player_id)
            impact = round(price * (qty_to_execute / SHARES_OUTSTANDING) * 50, 6)
            stock["price"] = round(max(PRICE_MIN, min(PRICE_MAX, stock["price"] - impact)), 4)
            order["filled"] += qty_to_execute
            if order["filled"] >= order["quantity"]:
                order["status"] = "filled"
            fill_qty = qty_to_execute
            fill_avg_price = price
            fill_total_cost = total_cost
            fill_commission = commission
            fill_fee = total_fee
            fill_stamp = stamp_tax
    else:
        return


    stock["volume"] = stock.get("volume", 0) + fill_qty
    stock["buy_volume"] = stock.get("buy_volume", 0) + (fill_qty if trade_type == "buy" else 0)
    stock["sell_volume"] = stock.get("sell_volume", 0) + (fill_qty if trade_type == "sell" else 0)

    # Update order status

    # Add to trade tape
    side = "active_buy" if trade_type == "buy" else "active_sell"
    state.trade_tape.insert(0, {
        "time": datetime.utcnow().strftime("%H:%M:%S"),
        "price": fill_avg_price,
        "quantity": fill_qty,
        "type": trade_type,
        "side": side,
    })
    if len(state.trade_tape) > 100:
        state.trade_tape = state.trade_tape[:100]

    # Record transaction in DB
    try:
        async with async_session() as session:
            tx = Transaction(
                player_id=player_id, symbol=symbol,
                trade_type=trade_type, quantity=qty_to_execute, price=price,
                total=total_cost,
            )
            session.add(tx)
            await session.commit()
    except Exception as e:
        logger.error(f"Failed to record limit tx: {e}")

    # Send trade_executed to player
    await manager.send_to(GLOBAL_ROOM_ID, player_id, {
        "type": "trade_executed",
        "data": {
            "stock_symbol": symbol, "quantity": qty_to_execute,
            "price": price, "total": total_cost, "trade_type": trade_type,
            "commission": commission,
            "stamp_tax": stamp_tax if trade_type == "sell" else 0,
            "total_fee": total_fee, "order_id": order["id"],
            "order_type": "limit",
        },
    })

    # Send portfolio_update
    cash = player["cash"]
    holdings_list = []
    total_assets = cash
    for sym, h in state.holdings.get(player_id, {}).items():
        sp = state.stocks.get(sym, {})
        cur_price = sp.get("price", 0)
        mv = round(h["qty"] * cur_price, 2)
        pnl = round(mv - h["qty"] * h["avg_cost"], 2) if h["qty"] > 0 else 0
        short_mv = round(h.get("short_qty", 0) * cur_price, 2)
        short_pnl = round((h.get("short_avg_cost", 0) - cur_price) * h.get("short_qty", 0), 2) if h.get("short_qty", 0) > 0 else 0
        holdings_list.append({
            "symbol": sym, "name": sp.get("name", sym),
            "quantity": h["qty"], "avg_cost": h["avg_cost"],
            "current_price": cur_price, "market_value": mv, "pnl": pnl,
            "frozen_qty": h.get("frozen_qty", 0),
            "short_qty": h.get("short_qty", 0),
            "short_avg_cost": h.get("short_avg_cost", 0),
            "short_market_value": short_mv,
            "short_pnl": short_pnl,
        })
        total_assets += mv
        total_assets -= short_mv
    total_assets -= player.get("margin_debt", 0)  # margin debt
    total_pnl = round(total_assets - STARTING_CASH, 2)
    pnl_pct = round((total_pnl / STARTING_CASH) * 100, 2)
    await manager.send_to(GLOBAL_ROOM_ID, player_id, {
        "type": "portfolio_update",
        "data": {
            "cash": round(cash, 2), "holdings": holdings_list,
            "total_assets": round(total_assets, 2),
            "total_pnl": total_pnl, "pnl_percent": pnl_pct,
            "frozen_cash": player.get("frozen_cash", 0),
            "margin_debt": player.get("margin_debt", 0),
            "buying_power": round((cash - player.get("frozen_cash", 0)) * 2.0, 2),
            "day_start_assets": state.day_start_assets.get(player_id, total_assets),
        },
    })


# ---------------------------------------------------------------------------
# Limit order management
# ---------------------------------------------------------------------------
async def place_limit_order(player_id: str, data: dict):
    state = get_global_state()

    symbol = data.get("stock_symbol", "").upper()
    qty = int(data.get("quantity", 0))
    order_type = data.get("order_type", "")  # "buy" or "sell"
    limit_price = float(data.get("price", 0))

    if order_type not in ("buy", "sell"):
        await manager.send_to(GLOBAL_ROOM_ID, player_id, {
            "type": "trade_rejected", "data": {"reason": "限价单仅支持买入和卖出", "stock_symbol": symbol},
        })
        return

    if symbol not in state.stocks:
        await manager.send_to(GLOBAL_ROOM_ID, player_id, {
            "type": "trade_rejected", "data": {"reason": "无效的股票代码", "stock_symbol": symbol},
        })
        return
    if qty <= 0:
        await manager.send_to(GLOBAL_ROOM_ID, player_id, {
            "type": "trade_rejected", "data": {"reason": "数量必须大于0", "stock_symbol": symbol},
        })
        return
    if limit_price <= 0:
        await manager.send_to(GLOBAL_ROOM_ID, player_id, {
            "type": "trade_rejected", "data": {"reason": "限价必须大于0", "stock_symbol": symbol},
        })
        return

    # 单笔委托数量限制（AI和NPC豁免）
    if qty > MAX_ORDER_QTY and not player_id.startswith(("ai_", "npc_", "inst_", "hot_", "q_", "nat_", "zhuangjia", "retail_")):
        await manager.send_to(GLOBAL_ROOM_ID, player_id, {
            "type": "trade_rejected", "data": {"reason": f"单笔委托数量不能超过 {MAX_ORDER_QTY} 股", "stock_symbol": symbol},
        })
        return

    order_id = state.next_order_id()
    order = {
        "id": order_id, "player_id": player_id, "symbol": symbol,
        "type": order_type, "price": limit_price, "quantity": qty,
        "filled": 0, "status": "pending", "created_at": time.time(),
    }

    # Check immediate fill
    current_price = state.stocks[symbol]["price"]
    immediate_fill = False
    if order_type == "buy" and current_price <= limit_price:
        immediate_fill = True
    elif order_type == "sell" and current_price >= limit_price:
        immediate_fill = True

    if immediate_fill:
        await _execute_limit_order(order, qty, current_price)
        # 立即成交但未完全成交时，剩余部分加入挂单队列
        remaining = order["quantity"] - order["filled"]
        if remaining > 0 and order["status"] == "pending":
            player = state.players.get(player_id)
            if player:
                if order_type == "buy":
                    avg_price = order["price"]
                    est_cost = round(avg_price * remaining, 2)
                    comm = round(max(est_cost * COMMISSION_RATE, MIN_COMMISSION), 2)
                    total_needed = round(est_cost + comm, 2)
                    available_cash = player["cash"] - player.get("frozen_cash", 0)
                    if available_cash >= total_needed:
                        player["frozen_cash"] = player.get("frozen_cash", 0) + total_needed
                        order["_reserved"] = total_needed
                        state.pending_orders[order_id] = order
                        mark_dirty(player_id)
                    # else: 现金不够了，剩余部分丢弃
                elif order_type == "sell":
                    player_holdings = state.holdings.setdefault(player_id, {})
                    h = player_holdings.setdefault(symbol, {"qty": 0, "avg_cost": 0.0, "frozen_qty": 0, "short_qty": 0, "short_avg_cost": 0.0})
                    available_qty = h["qty"] - h.get("frozen_qty", 0)
                    if available_qty >= remaining:
                        h["frozen_qty"] = h.get("frozen_qty", 0) + remaining
                        state.pending_orders[order_id] = order
                        mark_dirty(player_id)
                    # else: 没足够股票了，剩余部分丢弃
    else:
        # Verify player has enough cash/holdings before adding to pending
        player = state.players.get(player_id)
        if not player:
            return

        if order_type == "buy":
            estimated_cost = round(limit_price * qty, 2)
            commission = round(max(estimated_cost * COMMISSION_RATE, MIN_COMMISSION), 2)
            total_needed = round(estimated_cost + commission, 2)
            available_cash = player["cash"] - player.get("frozen_cash", 0)
            if available_cash < total_needed:
                await manager.send_to(GLOBAL_ROOM_ID, player_id, {
                    "type": "trade_rejected",
                    "data": {"reason": f"现金不足，需要约 ¥{total_needed:,.2f}，可用 ¥{available_cash:,.2f}", "stock_symbol": symbol},
                })
                return
            player["frozen_cash"] = player.get("frozen_cash", 0) + total_needed
            order["_reserved"] = total_needed
            mark_dirty(player_id)
        elif order_type == "sell":
            player_holdings = state.holdings.setdefault(player_id, {})
            if symbol not in player_holdings:
                player_holdings[symbol] = {"qty": 0, "avg_cost": 0.0, "frozen_qty": 0, "short_qty": 0, "short_avg_cost": 0.0}
            h = player_holdings[symbol]
            available_qty = h["qty"] - h.get("frozen_qty", 0)
            if available_qty < qty:
                await manager.send_to(GLOBAL_ROOM_ID, player_id, {
                    "type": "trade_rejected",
                    "data": {"reason": f"持仓不足，可卖 {available_qty} 股", "stock_symbol": symbol},
                })
                return
            h["frozen_qty"] = h.get("frozen_qty", 0) + qty
            mark_dirty(player_id)

        state.pending_orders[order_id] = order
        await manager.send_to(GLOBAL_ROOM_ID, player_id, {
            "type": "order_placed",
            "data": {"order_id": order_id, "symbol": symbol, "order_type": order_type, "price": limit_price, "quantity": qty},
        })

    await broadcast_order_book()


async def cancel_limit_order(player_id: str, data: dict):
    state = get_global_state()
    order_id = data.get("order_id", "")
    order = state.pending_orders.get(order_id)
    if not order:
        await manager.send_to(GLOBAL_ROOM_ID, player_id, {
            "type": "trade_rejected", "data": {"reason": "订单不存在"},
        })
        return
    if order["player_id"] != player_id:
        await manager.send_to(GLOBAL_ROOM_ID, player_id, {
            "type": "trade_rejected", "data": {"reason": "不能取消他人的订单"},
        })
        return
    if order["status"] != "pending":
        await manager.send_to(GLOBAL_ROOM_ID, player_id, {
            "type": "trade_rejected", "data": {"reason": "订单已完成或已取消"},
        })
        return

    order["status"] = "cancelled"

    # Unfreeze reserved cash/holdings
    player = state.players.get(player_id)
    if player:
        if order["type"] == "buy":
            reserved = order.get("_reserved", 0)
            remaining = order["quantity"] - order["filled"]
            fill_ratio = remaining / order["quantity"] if order["quantity"] > 0 else 0
            unfreeze = round(reserved * fill_ratio, 2)
            player["frozen_cash"] = max(0, player.get("frozen_cash", 0) - unfreeze)
        elif order["type"] == "sell":
            remaining = order["quantity"] - order["filled"]
            player_holdings = state.holdings.setdefault(player_id, {})
            h = player_holdings.get(order["symbol"])
            if h:
                h["frozen_qty"] = max(0, h.get("frozen_qty", 0) - remaining)

    mark_dirty(player_id)
    await manager.send_to(GLOBAL_ROOM_ID, player_id, {
        "type": "order_cancelled",
        "data": {"order_id": order_id},
    })
    await broadcast_order_book()


async def cancel_all_limit_orders(player_id: str):
    """Cancel all pending orders for a player and unfreeze cash/holdings."""
    state = get_global_state()
    cancelled = 0
    for oid, order in list(state.pending_orders.items()):
        if order["player_id"] == player_id and order["status"] == "pending":
            order["status"] = "cancelled"
            player = state.players.get(player_id)
            if player:
                if order["type"] == "buy":
                    reserved = order.get("_reserved", 0)
                    remaining = order["quantity"] - order["filled"]
                    fill_ratio = remaining / order["quantity"] if order["quantity"] > 0 else 0
                    unfreeze = round(reserved * fill_ratio, 2)
                    player["frozen_cash"] = max(0, player.get("frozen_cash", 0) - unfreeze)
                elif order["type"] == "sell":
                    remaining = order["quantity"] - order["filled"]
                    h = state.holdings.get(player_id, {}).get(order["symbol"])
                    if h:
                        h["frozen_qty"] = max(0, h.get("frozen_qty", 0) - remaining)
            cancelled += 1
    if cancelled > 0:
        mark_dirty(player_id)
        await manager.send_to(GLOBAL_ROOM_ID, player_id, {
            "type": "order_cancelled",
            "data": {"order_id": "all", "cancelled_count": cancelled},
        })
        await broadcast_order_book()


# ---------------------------------------------------------------------------
# Order book broadcast
# ---------------------------------------------------------------------------
async def broadcast_order_book():
    state = get_global_state()
    by_symbol: dict[str, dict] = {}
    for oid, order in state.pending_orders.items():
        if order["status"] in ("filled", "cancelled"):
            continue
        remaining = order["quantity"] - order["filled"]
        if remaining <= 0:
            continue
        sym = order["symbol"]
        if sym not in by_symbol:
            by_symbol[sym] = {"bids": {}, "asks": {}}
        price = order["price"]
        if order["type"] == "buy":
            by_symbol[sym]["bids"][price] = by_symbol[sym]["bids"].get(price, 0) + remaining
        else:
            by_symbol[sym]["asks"][price] = by_symbol[sym]["asks"].get(price, 0) + remaining

    result = {}
    for sym, data in by_symbol.items():
        sorted_bids = sorted(data["bids"].items(), key=lambda x: x[0], reverse=True)[:10]
        sorted_asks = sorted(data["asks"].items(), key=lambda x: x[0])[:10]
        result[sym] = {
            "bids": [{"price": p, "quantity": q} for p, q in sorted_bids],
            "asks": [{"price": p, "quantity": q} for p, q in sorted_asks],
        }

    await manager.broadcast(GLOBAL_ROOM_ID, {
        "type": "orderbook",
        "data": result,
    })


# ---------------------------------------------------------------------------
# Company system: stock price drift + quarterly processing + industry cycles
# ---------------------------------------------------------------------------

async def company_tick_loop():
    """Process company stocks every tick: drift price toward fundamental value.
    Every QUARTER_TICKS, process quarterly reports and industry cycle transitions."""
    state = get_global_state()
    tick_count = 0

    while True:
        await asyncio.sleep(PRICE_TICK_INTERVAL)
        tick_count += 1
        state._company_tick_counter = tick_count

        # Every tick: drift company stock prices toward fundamental value
        await _update_company_stock_prices(state)

        # Every quarter boundary: process companies and industry cycles
        if tick_count % QUARTER_TICKS == 0 and tick_count > 0:
            await _process_quarterly(state, tick_count)


async def _update_company_stock_prices(state):
    """Drift company stock prices toward their fundamental value based on assets."""
    try:
        async with async_session() as session:
            for sym, sd in list(state.stocks.items()):
                if not sd.get("is_company_stock"):
                    continue
                company_id = sd.get("company_id")
                if not company_id:
                    continue
                r = await session.execute(select(Company).where(Company.id == company_id))
                c = r.scalar_one_or_none()
                if not c:
                    continue

                # Calculate fundamental price: NAV x industry PE x cycle multiplier
                nav = max(c.total_assets / max(c.shares_outstanding, 1), 1.0)
                base_pe = {"tech": 20, "finance": 12, "manufacturing": 10,
                           "energy": 8, "consumer": 15, "healthcare": 18}.get(c.industry, 10)
                cycle_info = state.industry_cycles.get(c.industry, {})
                cycle = cycle_info.get("cycle", "normal")
                cycle_mult = {"boom": 1.5, "normal": 1.0, "recession": 0.6}.get(cycle, 1.0)
                # Add profit contribution
                eps = c.profit / max(c.shares_outstanding, 1) if c.quarter > 0 else 0
                fundamental = nav * base_pe * cycle_mult + eps * 5

                # Drift current price toward fundamental (0.5% per tick)
                current = sd["price"]
                diff = fundamental - current
                drift = diff * 0.005
                # Clamp drift to +-2% per tick
                drift = max(-current * 0.02, min(current * 0.02, drift))
                new_price = max(0.01, current + drift)
                sd["price"] = round(new_price, 4)
                sd["nav"] = round(nav, 2)
                sd["eps"] = round(eps, 4)
    except Exception as e:
        logger.error(f"Company stock price update error: {e}")


async def _process_quarterly(state, tick_count):
    """Process quarterly reports for all companies with realistic simulation."""
    try:
        async with async_session() as session:
            rows = await session.execute(select(Company))
            companies = rows.scalars().all()

            q_num = ((tick_count // QUARTER_TICKS) - 1) % 4 + 1
            year = 2024 + ((tick_count // QUARTER_TICKS) - 1) // 4
            period_labels = {1: "Q1", 2: "Q2", 3: "Q3", 4: "Q4"}
            period_str = f"{year}年{period_labels.get(q_num, f'Q{q_num}')}"

            # Industry benchmarks — must match company.py INDUSTRY_BENCHMARKS
            industry_benchmarks = {
                "tech":        {"rev": 3200, "cost": 1800, "trend": 1.08},
                "finance":     {"rev": 2800, "cost": 1600, "trend": 1.04},
                "manufacturing": {"rev": 1800, "cost": 1400, "trend": 1.03},
                "energy":      {"rev": 2500, "cost": 1800, "trend": 1.02},
                "consumer":    {"rev": 1600, "cost": 1000, "trend": 1.05},
                "healthcare":  {"rev": 3000, "cost": 1400, "trend": 1.06},
            }

            # Global market condition this quarter (-20% ~ +20%)
            market_condition = random.uniform(-0.15, 0.20)

            for c in companies:
                try:
                    alloc = json.loads(c.alloc_pcts) if isinstance(c.alloc_pcts, str) else c.alloc_pcts
                except (json.JSONDecodeError, TypeError):
                    alloc = {"reserve": 25, "sales": 25, "dividend": 25, "research": 25}

                extra = state.company_extra.get(c.id, {})
                marketing_boost = extra.get("marketing_boost", 0)
                pr_boost = extra.get("pr_boost", 0)
                rnd_level = extra.get("rnd_level", 1.0)  # compound R&D factor

                # Industry benchmarks
                bench = industry_benchmarks.get(c.industry, {"rev": 2000, "cost": 1200, "trend": 1.04})
                base_rev_per_emp = bench["rev"]
                base_cost_per_emp = bench["cost"]
                trend = bench["trend"]

                # Industry cycle
                cycle_info = state.industry_cycles.get(c.industry, {})
                cycle = cycle_info.get("cycle", "normal")
                cycle_mult = {"boom": 1.5, "normal": 1.0, "recession": 0.65}.get(cycle, 1.0)

                # --- Revenue calculation ---
                sales_pct = alloc.get("sales", 25) / 100.0
                research_pct = alloc.get("research", 25) / 100.0
                reserve_pct = alloc.get("reserve", 25) / 100.0

                # R&D compounds: each quarter, research % builds knowledge
                rnd_growth = 1.0 + research_pct * 0.12  # up to +12%/quarter
                rnd_level *= rnd_growth
                extra["rnd_level"] = rnd_level
                rnd_efficiency = 1.0 + (rnd_level - 1.0) * 0.3  # 30% of R&D translates to efficiency

                # Sales allocation boosts revenue
                sales_boost = 1.0 + sales_pct * 0.6

                # Scale economy: larger companies are more efficient
                scale_factor = 1.0 + min(0.5, c.employees / 500 * 0.15)

                # Marketing: immediate boost, decays
                mkt_boost = 1.0
                if marketing_boost > 0:
                    mkt_boost = 1.0 + min(1.0, marketing_boost / 50000)
                    extra["marketing_boost"] = marketing_boost * 0.3  # decay 70%
                    if extra["marketing_boost"] < 500:
                        extra["marketing_boost"] = 0

                # Quarterly random factor
                random_factor = random.uniform(0.85, 1.15)

                # Industry-specific growth trend compounds each quarter
                quarters_since_start = c.quarter
                trend_mult = trend ** quarters_since_start  # e.g. tech 1.08^4 = +36%/year

                # Revenue per employee
                effective_rev_per_emp = base_rev_per_emp * cycle_mult * rnd_efficiency * scale_factor * trend_mult
                revenue = c.employees * effective_rev_per_emp * sales_boost * mkt_boost * random_factor
                # Add market condition
                revenue *= (1.0 + market_condition)

                # --- Cost calculation ---
                # Fixed costs (office, equipment, admin)
                fixed_cost = 5000 + c.employees * 200

                # Variable costs per employee (salary + benefits)
                salary_cost = c.employees * base_cost_per_emp * cycle_mult * scale_factor

                # R&D spending (proportional to research allocation of revenue)
                rd_spend = revenue * research_pct * 0.8

                # Total costs
                total_costs = fixed_cost + salary_cost + rd_spend

                # --- Profit ---
                profit = revenue - total_costs

                # Interest income on cash (0.5% per quarter)
                interest_income = c.cash * 0.005

                # PR boost: temporary valuation uplift (doesn't affect fundamentals directly)
                if pr_boost > 0:
                    extra["pr_boost"] = pr_boost * 0.5
                    if extra["pr_boost"] < 500:
                        extra["pr_boost"] = 0

                # Net profit after interest
                net_profit = profit + interest_income

                # Dividend payout
                div_pct = alloc.get("dividend", 25) / 100.0
                dividend_paid = max(0, net_profit * div_pct) if net_profit > 0 else 0

                # Reserve allocation goes to asset building
                reserve_amount = max(0, net_profit * reserve_pct) if net_profit > 0 else 0

                # --- Update company state ---
                c.revenue = round(revenue, 2)
                c.profit = round(net_profit, 2)
                c.cash = round(c.cash + net_profit - dividend_paid, 2)
                c.total_assets = round(c.total_assets + reserve_amount + interest_income, 2)
                c.quarter = q_num

                # Natural employee churn + hiring/firing based on profitability
                if net_profit > 0:
                    hire_chance = min(0.4, net_profit / (salary_cost + 1)) * 0.3
                    if random.random() < hire_chance:
                        c.employees += random.randint(1, 3)
                else:
                    if random.random() < 0.2:
                        c.employees = max(5, c.employees - random.randint(1, 2))

                # Accumulate tech points based on R&D spending
                # Each ¥1000 R&D = 1 tech point, +10% bonus from existing tech (compounding)
                tech_gain = rd_spend / 1000 * (1 + c.tech_points * 0.001)
                c.tech_points = round(c.tech_points + max(0, tech_gain), 1)
                # Tech points slowly decay if no R&D investment (5% per quarter)
                if rd_spend < 100:
                    c.tech_points = round(max(0, c.tech_points * 0.95), 1)

                # Update share price based on new fundamentals
                nav = max(c.total_assets / max(c.shares_outstanding, 1), 1.0)
                eps = net_profit / max(c.shares_outstanding, 1)
                base_pe = {"tech": 20, "finance": 12, "manufacturing": 10,
                           "energy": 8, "consumer": 15, "healthcare": 18}.get(c.industry, 10)
                # PE expands with profit growth, contracts with losses
                if eps > 0:
                    pe_mult = base_pe * cycle_mult
                else:
                    pe_mult = base_pe * 0.5 * cycle_mult  # loss-making companies get lower PE
                c.share_price = round(max(0.01, nav + eps * pe_mult), 2)

                # Save quarterly report with full details
                # Get previous quarter data for growth calculation
                prev_r = await session.execute(
                    select(CompanyQuarterly)
                    .where(CompanyQuarterly.company_id == c.id)
                    .order_by(desc(CompanyQuarterly.id))
                    .limit(1)
                )
                prev = prev_r.scalar_one_or_none()

                q = CompanyQuarterly(
                    company_id=c.id,
                    quarter=q_num,
                    period=period_str,
                    revenue=c.revenue,
                    profit=c.profit,
                    assets=c.total_assets,
                    cash=c.cash,
                    employees=c.employees,
                    share_price=c.share_price,
                    salary_cost=round(salary_cost, 2),
                    rd_spend=round(rd_spend, 2),
                    fixed_cost=round(fixed_cost, 2),
                    dividend_paid=round(dividend_paid, 2),
                    industry_cycle=cycle,
                    prev_revenue=prev.revenue if prev else 0,
                    prev_profit=prev.profit if prev else 0,
                )
                session.add(q)

                # Update in-memory stock
                if c.symbol in state.stocks:
                    state.stocks[c.symbol]["price"] = c.share_price
                    state.stocks[c.symbol]["eps"] = round(eps, 4)
                    state.stocks[c.symbol]["nav"] = round(nav, 2)

            await session.commit()

        await _update_industry_cycles(state, tick_count)

    except Exception as e:
        logger.error(f"Quarterly processing error: {e}")


async def _update_industry_cycles(state, tick_count):
    """Transition industry cycles based on accumulated momentum."""
    for ind_id, cyc in state.industry_cycles.items():
        cyc["ticks_in_cycle"] = cyc.get("ticks_in_cycle", 0) + QUARTER_TICKS

        # Every 4 quarters, transition
        if cyc["ticks_in_cycle"] >= QUARTER_TICKS * 4:
            momentum = cyc.get("momentum", 0.0)
            current = cyc["cycle"]

            if current == "normal":
                if momentum > 2.0:
                    new_cycle = "boom"
                    name = "繁荣"
                    desc = "行业景气度高涨，需求旺盛！"
                elif momentum < -2.0:
                    new_cycle = "recession"
                    name = "衰退"
                    desc = "行业进入下行周期，市场低迷"
                else:
                    new_cycle = "normal"
                    name = "正常"
                    desc = "行业运行平稳"
            elif current == "boom":
                new_cycle = "normal"
                name = "正常"
                desc = "繁荣期结束，行业回归平稳"
            else:  # recession
                new_cycle = "normal"
                name = "正常"
                desc = "衰退期结束，行业开始复苏"

            cyc["cycle"] = new_cycle
            cyc["cycle_name"] = name
            cyc["cycle_desc"] = desc
            cyc["ticks_in_cycle"] = 0
            cyc["momentum"] = 0.0

            # Broadcast cycle change
            industry_name_map = {
                "tech": "科技", "finance": "金融", "manufacturing": "制造业",
                "energy": "能源", "consumer": "消费", "healthcare": "医药",
            }
            try:
                await manager.broadcast_to_room(GLOBAL_ROOM_ID, {
                    "type": "industry_cycle_change",
                    "data": {
                        "industry_id": ind_id,
                        "industry_name": industry_name_map.get(ind_id, ind_id),
                        "cycle": new_cycle,
                        "cycle_name": name,
                        "cycle_desc": desc,
                    }
                })
            except Exception:
                pass
