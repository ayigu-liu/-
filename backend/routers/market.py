from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Header
from fastapi import Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc

from backend.database import get_session, async_session
from backend.models import User, Transaction
from backend.schemas import MarketInfo, LeaderboardEntry
from backend.websocket_manager import manager
from backend.config import SHARES_OUTSTANDING
from pydantic import BaseModel, Field

INDUSTRY_NAMES = {
    "tech": "科技", "finance": "金融", "manufacturing": "制造业",
    "energy": "能源", "consumer": "消费", "healthcare": "医药",
}
INDUSTRY_DESCS = {
    "tech": "高增长、高波动",
    "finance": "稳定增长、低波动",
    "manufacturing": "稳定收益、周期性强",
    "energy": "强周期性、政策敏感",
    "consumer": "防御性、稳定现金流",
    "healthcare": "防御性、高利润",
}

router = APIRouter(prefix="/api/market", tags=["market"])


@router.get("")
async def market_info():
    from backend.game_engine import get_global_state, GLOBAL_ROOM_ID
    state = get_global_state()
    stocks = []
    for sym, sd in state.stocks.items():
        if sd.get("is_company_stock"):
            ref_price = sd.get("price", 1.0)
        else:
            ref_price = state.prev_close or sd.get("price", 1.0)
        change = round(sd["price"] - ref_price, 2)
        change_pct = round((change / ref_price) * 100, 2) if ref_price else 0
        stocks.append({
            "symbol": sym, "name": sd["name"],
            "price": sd["price"], "change": change, "change_pct": change_pct,
            "volume": sd["volume"],
            "shares_outstanding": sd.get("shares_outstanding", SHARES_OUTSTANDING),
        })
    if not stocks:
        stocks.append({
            "symbol": "DM", "name": "大猫投资",
            "price": 1.0, "change": 0, "change_pct": 0,
            "volume": 0, "shares_outstanding": SHARES_OUTSTANDING,
        })
    return {
        "stocks": stocks,
        "players_online": len(manager.get_connections(GLOBAL_ROOM_ID)),
    }


@router.get("/leaderboard", response_model=list[LeaderboardEntry])
async def market_leaderboard():
    from backend.game_engine import calc_leaderboard
    rankings = calc_leaderboard()
    return rankings


@router.get("/sec-report")
async def sec_report():
    from backend.game_engine import get_global_state, QUARTER_TICKS
    state = get_global_state()
    sanctioned = []
    for pid, pdata in list(state.players.items()):
        if pid.startswith(("retail_", "ai_", "_market_", "npc_", "inst_", "hot_", "q_", "nat_", "__")):
            continue
        violations = pdata.get("_sec_violations", 0)
        restrict_q = pdata.get("_sec_restrict_quarters", 0)
        total_fines = pdata.get("_sec_total_fines", 0)
        if violations > 0 or restrict_q > 0 or total_fines > 0:
            sanctioned.append({
                "player_id": pid,
                "player_name": pdata.get("nickname", pdata.get("name", pid[:12])),
                "tier": violations,
                "restrict_quarters": restrict_q,
                "total_fines": total_fines,
            })
    sec_log = getattr(state, '_sec_log', [])[-50:]
    for entry in sec_log:
        p = state.players.get(entry["player_id"], {})
        entry["player_name"] = p.get("nickname", p.get("name", entry["player_id"][:12]))
    return {"sanctioned": sanctioned, "recent_actions": list(reversed(sec_log))}


@router.get("/trades")
async def player_trades(player_id: str = Query(...), limit: int = Query(50)):
    from backend.database import async_session
    async with async_session() as session:
        result = await session.execute(
            select(Transaction)
            .where(Transaction.player_id == player_id)
            .order_by(desc(Transaction.created_at))
            .limit(limit)
        )
        trades = result.scalars().all()
        return [
            {
                "id": t.id,
                "symbol": t.symbol,
                "trade_type": t.trade_type,
                "quantity": t.quantity,
                "price": t.price,
                "total": t.total,
                "created_at": t.created_at.strftime("%Y-%m-%d %H:%M:%S") if t.created_at else "",
            }
            for t in trades
        ]


@router.get("/equity_curve")
async def player_equity_curve(player_id: str = Query(...)):
    from backend.game_engine import get_global_state
    state = get_global_state()
    history = state.asset_history.get(player_id, [])
    return history[-200:]


@router.get("/f10")
async def company_f10():
    from backend.game_engine import get_global_state
    state = get_global_state()
    sd = state.stocks.get("DM", {})
    return {
        "symbol": "DM",
        "name": "大猫投资",
        "industry": "半导体",
        "business": "专注于人工智能芯片的研发、设计与销售，产品广泛应用于数据中心、自动驾驶、智能终端等领域。",
        "eps": sd.get("eps", 0),
        "nav": sd.get("nav", 0),
        "pe": round(sd.get("price", 1) / sd.get("eps", 0.1), 2) if sd.get("eps", 0) > 0 else 0,
        "pb": round(sd.get("price", 1) / sd.get("nav", 1), 2) if sd.get("nav", 0) > 0 else 0,
        "shares_outstanding": SHARES_OUTSTANDING,
        "price": sd.get("price", 1),
        "volume": sd.get("volume", 0),
    }


@router.get("/orders")
async def player_orders(player_id: str = Query(...)):
    from backend.game_engine import get_global_state
    state = get_global_state()
    result = []
    for oid, order in state.pending_orders.items():
        if order.get("player_id") == player_id and order.get("status") in ("pending",):
            remaining = order["quantity"] - order["filled"]
            if remaining > 0:
                result.append({
                    "order_id": oid,
                    "symbol": order["symbol"],
                    "type": order["type"],
                    "price": order["price"],
                    "quantity": order["quantity"],
                    "filled": order["filled"],
                    "remaining": remaining,
                    "status": order["status"],
                    "created_at": order.get("created_at", 0),
                })
    result.sort(key=lambda x: x["created_at"], reverse=True)
    return result


@router.get("/kline")
async def market_kline(symbol: str = Query(""), period: str = Query("4t")):
    """Get historical candle data for a stock symbol."""
    from backend.game_engine import get_global_state
    state = get_global_state()
    period_map = {"1t": state.candles_1t, "4t": state.candles_4t, "20t": state.candles_20t, "1d": state.candles_1d}
    candles = period_map.get(period, state.candles_4t)
    data = candles.get(symbol, [])
    if not data:
        # Return a dummy candle if no data yet
        price = state.stocks.get(symbol, {}).get("price", 100)
        now_ms = int(datetime.utcnow().timestamp() * 1000)
        dummy = {"time": now_ms, "open": price, "high": price, "low": price, "close": price}
        return [dummy]
    return data[-200:]


@router.get("/industry")
async def market_industry():
    from backend.game_engine import get_global_state
    state = get_global_state()
    from backend.routers.company import INDUSTRY_NAMES as CN, INDUSTRY_DESCS as CD

    # Query total revenue per industry from DB
    ind_revenue: dict[str, float] = {ind: 0.0 for ind in INDUSTRY_NAMES}
    try:
        from backend.database import async_session
        from backend.models import Company
        from sqlalchemy import select, func
        async with async_session() as sess:
            for ind_id in INDUSTRY_NAMES:
                r = await sess.execute(
                    select(func.sum(Company.revenue)).where(Company.industry == ind_id)
                )
                total = r.scalar_one_or_none()
                if total:
                    ind_revenue[ind_id] = round(total, 2)
    except Exception:
        pass

    # Group stocks by industry company stocks
    industry_companies: dict[str, list] = {ind: [] for ind in INDUSTRY_NAMES}

    # Check all stocks in state for company stocks
    for sym, sd in state.stocks.items():
        if sd.get("is_company_stock"):
            # Try to find industry from DB
            ind = "tech"  # fallback
            from backend.database import async_session
            from backend.models import Company
            try:
                async with async_session() as session:
                    r = await session.execute(select(Company).where(Company.symbol == sym))
                    c = r.scalar_one_or_none()
                    if c:
                        ind = c.industry
            except Exception:
                pass
            mcap = sd.get("price", 0) * sd.get("shares_outstanding", 1)
            industry_companies.setdefault(ind, []).append({
                "symbol": sym,
                "name": sd.get("name", sym),
                "price": sd.get("price", 0),
                "pe": sd.get("eps", 0) / max(sd.get("price", 1), 0.01) if sd.get("eps", 0) > 0 else 0,
                "market_cap": mcap,
            })

    result = []
    for ind_id, ind_name in INDUSTRY_NAMES.items():
        cycle_info = state.industry_cycles.get(ind_id, {"cycle": "normal", "cycle_name": "正常", "cycle_desc": "行业运行平稳"})
        companies = industry_companies.get(ind_id, [])
        # Calculate total market cap for this industry
        total_mcap = sum(c.get("market_cap", 0) for c in companies)
        # Add market share to each company
        for c in companies:
            c["market_share"] = round((c.get("market_cap", 0) / max(total_mcap, 1)) * 100, 1) if total_mcap > 0 else 0
        result.append({
            "industry_id": ind_id,
            "industry_name": ind_name,
            "industry_desc": INDUSTRY_DESCS.get(ind_id, ""),
            "cycle": cycle_info.get("cycle", "normal"),
            "cycle_name": cycle_info.get("cycle_name", "正常"),
            "cycle_desc": cycle_info.get("cycle_desc", "行业运行平稳"),
            "total_market_cap": total_mcap,
            "total_revenue": ind_revenue.get(ind_id, 0),
            "companies": companies,
        })

    return result


# ============================================================
# Player rename
# ============================================================
class RenameRequest(BaseModel):
    nickname: str = Field(min_length=1, max_length=20)


@router.post("/rename")
async def rename_player(req: RenameRequest, token: str = Header(alias="x-auth-token")):
    from backend.game_engine import get_global_state, mark_dirty
    async with async_session() as session:
        r = await session.execute(select(User).where(User.token == token))
        user = r.scalar_one_or_none()
        if not user:
            raise HTTPException(401, "未登录")
        old_nick = user.nickname
        user.nickname = req.nickname
        await session.commit()
    # Update in-memory state
    state = get_global_state()
    if user.id in state.players:
        state.players[user.id]["nickname"] = req.nickname
        mark_dirty(user.id)
    return {"nickname": req.nickname}


# ============================================================
# Admin Trading API (authenticated via x-admin-token header)
# ============================================================
ADMIN_EMAIL = "admin@stock.game"
ADMIN_CASH_TARGET = 500_000_000


async def _verify_admin(token: str = Header(alias="x-admin-token")):
    """验证管理员 token 并返回 player_id。"""
    from backend.models import User
    from backend.database import async_session
    from sqlalchemy import select
    async with async_session() as session:
        r = await session.execute(
            select(User).where(User.token == token, User.is_admin == 1)
        )
        user = r.scalar_one_or_none()
        if not user:
            raise HTTPException(403, "无权限")
        return user.id


async def _ensure_admin_state(pid: str):
    """确保管理员在游戏内存中且有足额资金。"""
    from backend.game_engine import get_global_state
    state = get_global_state()
    if pid not in state.players:
        state.players[pid] = {
            "nickname": "操盘手", "cash": ADMIN_CASH_TARGET,
            "frozen_cash": 0, "margin_debt": 0.0, "is_admin": True,
        }
    if not state.players[pid].get("is_admin"):
        state.players[pid]["is_admin"] = True


@router.get("/admin/status")
async def admin_status(pid: str = Depends(_verify_admin)):
    from backend.game_engine import get_global_state, broadcast_leaderboard
    await _ensure_admin_state(pid)
    state = get_global_state()
    stock = state.stocks.get("DM", {})
    p = state.players.get(pid, {})
    holding = state.holdings.get(pid, {}).get("DM", {"qty": 0, "short_qty": 0, "short_avg_cost": 0.0, "avg_cost": 0.0, "frozen_qty": 0})
    return {
        "price": stock.get("price", 0),
        "cash": p.get("cash", 0),
        "frozen_cash": p.get("frozen_cash", 0),
        "available_cash": p.get("cash", 0) - p.get("frozen_cash", 0),
        "holdings": holding.get("qty", 0),
        "avg_cost": holding.get("avg_cost", 0),
        "frozen_qty": holding.get("frozen_qty", 0),
        "short_qty": holding.get("short_qty", 0),
        "short_avg_cost": holding.get("short_avg_cost", 0),
        "margin_debt": p.get("margin_debt", 0),
        "is_admin": True,
    }


@router.post("/admin/buy")
async def admin_buy(qty: int = Query(...), pid: str = Depends(_verify_admin)):
    from backend.game_engine import get_global_state, execute_trade, broadcast_leaderboard
    await _ensure_admin_state(pid)
    state = get_global_state()
    stock = state.stocks.get("DM")
    if not stock:
        raise HTTPException(400, "无行情数据")
    cost = stock["price"] * qty
    p = state.players.get(pid, {})
    if cost > p.get("cash", 0) - p.get("frozen_cash", 0):
        raise HTTPException(400, "资金不足")
    await execute_trade(pid, {"stock_symbol": "DM", "quantity": qty, "trade_type": "buy"})
    await broadcast_leaderboard()
    return {"status": "ok", "message": f"买入 {qty} 股", "price": stock["price"]}


@router.post("/admin/sell")
async def admin_sell(qty: int = Query(...), pid: str = Depends(_verify_admin)):
    from backend.game_engine import get_global_state, execute_trade, broadcast_leaderboard
    await _ensure_admin_state(pid)
    state = get_global_state()
    holding = state.holdings.get(pid, {}).get("DM", {"qty": 0})
    if holding["qty"] < qty:
        raise HTTPException(400, f"持仓不足 (持有 {holding['qty']} 股)")
    await execute_trade(pid, {"stock_symbol": "DM", "quantity": qty, "trade_type": "sell"})
    await broadcast_leaderboard()
    stock = state.stocks.get("DM", {})
    return {"status": "ok", "message": f"卖出 {qty} 股", "price": stock.get("price", 0)}


@router.post("/admin/limit-buy")
async def admin_limit_buy(
    qty: int = Query(...), price: float = Query(...),
    pid: str = Depends(_verify_admin),
):
    from backend.game_engine import get_global_state, place_limit_order, broadcast_leaderboard
    await _ensure_admin_state(pid)
    await place_limit_order(pid, {
        "stock_symbol": "DM", "quantity": qty,
        "order_type": "buy", "price": price,
    })
    await broadcast_leaderboard()
    return {"status": "ok", "message": f"限价买入 {qty} 股 @ ¥{price}"}


@router.post("/admin/limit-sell")
async def admin_limit_sell(
    qty: int = Query(...), price: float = Query(...),
    pid: str = Depends(_verify_admin),
):
    from backend.game_engine import get_global_state, place_limit_order, broadcast_leaderboard
    await _ensure_admin_state(pid)
    await place_limit_order(pid, {
        "stock_symbol": "DM", "quantity": qty,
        "order_type": "sell", "price": price,
    })
    await broadcast_leaderboard()
    return {"status": "ok", "message": f"限价卖出 {qty} 股 @ ¥{price}"}


@router.post("/admin/reset")
async def admin_reset(pid: str = Depends(_verify_admin)):
    """重置管理员：清空持仓、撤销挂单、归零融资融券。"""
    from backend.game_engine import get_global_state, broadcast_leaderboard
    state = get_global_state()
    p = state.players.get(pid, {})
    p["cash"] = ADMIN_CASH_TARGET
    p["frozen_cash"] = 0
    p["margin_debt"] = 0.0
    p["is_admin"] = True
    if pid in state.holdings:
        state.holdings[pid] = {}
    # 撤销管理员的所有挂单
    for oid, o in list(state.pending_orders.items()):
        if o["player_id"] == pid:
            o["status"] = "cancelled"
    await broadcast_leaderboard()
    return {"status": "ok", "message": f"管理员已重置，现金 ¥{ADMIN_CASH_TARGET:,.0f}，融资融券已归零"}


@router.post("/admin/crash-on")
async def admin_crash_on(pid: str = Depends(_verify_admin)):
    """启动砸盘模式：所有机器人强制卖出。"""
    from backend.game_engine import get_global_state
    state = get_global_state()
    state.crash_mode = True
    return {"status": "ok", "message": "砸盘模式已启动，所有机器人将强制卖出"}


@router.post("/admin/crash-off")
async def admin_crash_off(pid: str = Depends(_verify_admin)):
    """关闭砸盘模式。"""
    from backend.game_engine import get_global_state
    state = get_global_state()
    state.crash_mode = False
    return {"status": "ok", "message": "砸盘模式已关闭"}


@router.get("/admin/crash-status")
async def admin_crash_status(pid: str = Depends(_verify_admin)):
    from backend.game_engine import get_global_state
    state = get_global_state()
    stock = state.stocks.get("DM", {})
    return {
        "crash_mode": state.crash_mode,
        "price": stock.get("price", 0),
    }


@router.get("/admin/debug")
async def admin_debug(pid: str = Depends(_verify_admin)):
    from backend.game_engine import get_global_state
    state = get_global_state()
    stock = state.stocks.get("DM", {})
    buys = []
    sells = []
    for oid, o in state.pending_orders.items():
        if o["symbol"] != "DM" or o["status"] != "pending":
            continue
        (buys if o["type"] == "buy" else sells).append({
            "price": o["price"], "remaining": o["quantity"] - o["filled"],
            "qty": o["quantity"], "filled": o["filled"],
            "player": o["player_id"],
            "created": round(o.get("created_at", 0), 1),
        })
    buys.sort(key=lambda x: x["price"], reverse=True)
    sells.sort(key=lambda x: x["price"])
    bots = {}
    for pid_b in ["ai_buy", "ai_sell", "zhuangjia"] + [f"inst_{i+1}" for i in range(3)] + [f"hot_{i+1}" for i in range(5)]:
        p = state.players.get(pid_b)
        if not p: continue
        h = state.holdings.get(pid_b, {}).get("DM", {})
        bots[pid_b] = {"cash": p.get("cash",0), "frozen_cash": p.get("frozen_cash",0),
                       "qty": h.get("qty",0), "frozen_qty": h.get("frozen_qty",0),
                       "short_qty": h.get("short_qty",0)}
    return {
        "price": stock.get("price", 0),
        "volume": stock.get("volume", 0),
        "buy_depth": buys[:10],
        "sell_depth": sells[:10],
        "bots": bots,
    }
