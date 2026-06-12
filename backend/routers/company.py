import json
import logging
import random
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Header
from sqlalchemy import select, desc, func

from backend.database import async_session
from backend.models import Company, CompanyQuarterly, User
from backend.schemas import (
    CompanyCreateRequest, CompanyResponse, CompanyRankingEntry,
    CashActionRequest, DecisionRequest, AllocRequest, AnnounceRequest,
)
from backend.game_engine import get_global_state, GLOBAL_ROOM_ID
from backend.websocket_manager import manager

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/company", tags=["company"])

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
INDUSTRY_BASE_PE = {
    "tech": 20, "finance": 12, "manufacturing": 10,
    "energy": 8, "consumer": 15, "healthcare": 18,
}
# Industry-specific startup configs
INDUSTRY_STARTUP = {
    "tech":        {"cash": 50000, "assets": 50000, "employees": 8,  "price": 5, "shares": 2_000_000,  "desc": "轻资产高估值，研发驱动"},
    "finance":     {"cash": 100000, "assets": 150000, "employees": 12, "price": 4, "shares": 3_000_000, "desc": "资金密集型，监管严格"},
    "manufacturing":{"cash": 80000, "assets": 120000, "employees": 20, "price": 3,  "shares": 5_000_000, "desc": "重资产劳动密集，规模效应"},
    "energy":      {"cash": 120000, "assets": 200000, "employees": 15, "price": 5, "shares": 4_000_000, "desc": "资源依赖，政策敏感"},
    "consumer":    {"cash": 40000, "assets": 50000, "employees": 10, "price": 3,  "shares": 3_000_000, "desc": "现金流稳定，防御性强"},
    "healthcare":  {"cash": 100000, "assets": 80000, "employees": 10, "price": 6, "shares": 2_000_000,  "desc": "高毛利，研发投入大"},
}
# Quarterly simulation benchmarks
INDUSTRY_BENCHMARKS = {
    "tech":        {"rev_per_emp": 3200, "cost_per_emp": 1800, "trend": 1.08, "desc": "人均产出高，薪资高"},
    "finance":     {"rev_per_emp": 2800, "cost_per_emp": 1600, "trend": 1.04, "desc": "人均中等偏高，运营成本高"},
    "manufacturing":{"rev_per_emp": 1800, "cost_per_emp": 1400, "trend": 1.03, "desc": "人均产出低，劳动密集"},
    "energy":      {"rev_per_emp": 2500, "cost_per_emp": 1800, "trend": 1.02, "desc": "人均资源产出高，设备成本高"},
    "consumer":    {"rev_per_emp": 1600, "cost_per_emp": 1000, "trend": 1.05, "desc": "薄利多销，成本控制好"},
    "healthcare":  {"rev_per_emp": 3000, "cost_per_emp": 1400, "trend": 1.06, "desc": "高附加值，高毛利"},
}

# Symbol counters per industry
_symbol_counters: dict[str, int] = {}


async def _get_current_user(token: str = Header(alias="x-auth-token")):
    if not token:
        raise HTTPException(401, "未登录")
    async with async_session() as session:
        r = await session.execute(select(User).where(User.token == token))
        user = r.scalar_one_or_none()
        if not user:
            raise HTTPException(401, "未登录")
        return user


def _generate_symbol(industry: str) -> str:
    global _symbol_counters
    _symbol_counters.setdefault(industry, 0)
    _symbol_counters[industry] += 1
    prefix = {"tech": "TK", "finance": "FI", "manufacturing": "MF",
              "energy": "EN", "consumer": "CS", "healthcare": "YL"}.get(industry, "CP")
    return f"{prefix}{_symbol_counters[industry]:03d}"


@router.post("/create")
async def create_company(req: CompanyCreateRequest, user: User = Depends(_get_current_user)):
    async with async_session() as session:
        existing = await session.execute(select(Company).where(Company.player_id == user.id))
        if existing.scalar_one_or_none():
            raise HTTPException(400, "你已经拥有公司了！")

        # Check name uniqueness
        name_check = await session.execute(select(Company).where(Company.name == req.name))
        if name_check.scalar_one_or_none():
            raise HTTPException(400, "公司名称已被使用")

        symbol = _generate_symbol(req.industry)
        startup = INDUSTRY_STARTUP.get(req.industry, {})
        company = Company(
            player_id=user.id,
            name=req.name,
            symbol=symbol,
            industry=req.industry,
            cash=startup.get("cash", 100000),
            total_assets=startup.get("assets", 100000),
            revenue=0.0,
            profit=0.0,
            employees=startup.get("employees", 10),
            quarter=1,
            alloc_pcts='{"reserve":25,"sales":25,"dividend":25,"research":25}',
            share_price=startup.get("price", 10),
            shares_outstanding=startup.get("shares", 10_000_000),
        )
        session.add(company)
        await session.commit()
        await session.refresh(company)

    # Add stock to live market state
    state = get_global_state()
    init_price = startup.get("price", 10)
    init_shares = startup.get("shares", 10_000_000)
    state.stocks[symbol] = {
        "symbol": symbol,
        "name": req.name,
        "price": init_price,
        "volume": 0,
        "shares_outstanding": init_shares,
        "eps": 0.0,
        "nav": init_price,
        "buy_volume": 0,
        "sell_volume": 0,
        "company_id": company.id,
        "is_company_stock": True,
    }

    # Allocate shares to AI bots for market liquidity
    ai_buy_hold = state.holdings.setdefault("ai_buy", {})
    ai_sell_hold = state.holdings.setdefault("ai_sell", {})
    ai_buy_hold[symbol] = {"qty": int(init_shares * 0.3), "avg_cost": init_price, "frozen_qty": 0, "short_qty": 0, "short_avg_cost": 0.0}
    ai_sell_hold[symbol] = {"qty": int(init_shares * 0.3), "avg_cost": init_price, "frozen_qty": 0, "short_qty": 0, "short_avg_cost": 0.0}
    # Also allocate to some institutional bots
    for i in range(3):
        pid = f"inst_{i+1}"
        h = state.holdings.setdefault(pid, {})
        h[symbol] = {"qty": int(init_shares * random.uniform(0.02, 0.08)), "avg_cost": init_price, "frozen_qty": 0, "short_qty": 0, "short_avg_cost": 0.0}

    return {"name": req.name, "symbol": symbol, "industry": req.industry}


@router.get("/my")
async def get_my_company(user: User = Depends(_get_current_user)):
    async with async_session() as session:
        r = await session.execute(select(Company).where(Company.player_id == user.id))
        company = r.scalar_one_or_none()
    if not company:
        raise HTTPException(404, "no company")

    state = get_global_state()
    stock = state.stocks.get(company.symbol, {})
    current_price = stock.get("price", company.share_price)
    valuation = current_price * company.shares_outstanding

    alloc = json.loads(company.alloc_pcts) if isinstance(company.alloc_pcts, str) else company.alloc_pcts

    return CompanyResponse(
        id=company.id,
        player_id=company.player_id,
        name=company.name,
        symbol=company.symbol,
        industry=company.industry,
        industry_name=INDUSTRY_NAMES.get(company.industry, company.industry),
        cash=company.cash,
        total_assets=company.total_assets,
        revenue=company.revenue,
        profit=company.profit,
        employees=company.employees,
        quarter=company.quarter,
        alloc_pcts=alloc,
        tech_points=company.tech_points,
        share_price=current_price,
        shares_outstanding=company.shares_outstanding,
        valuation=valuation,
        created_at=company.created_at.strftime("%Y-%m-%d %H:%M:%S") if company.created_at else "",
    )


@router.get("/ranking")
async def company_ranking():
    async with async_session() as session:
        rows = await session.execute(
            select(Company).order_by(desc(Company.total_assets)).limit(50)
        )
        companies = rows.scalars().all()

    state = get_global_state()
    result = []
    for i, c in enumerate(companies):
        stock = state.stocks.get(c.symbol, {})
        price = stock.get("price", c.share_price)
        market_cap = price * c.shares_outstanding
        div_yield = 0.0
        if c.quarter > 0 and c.revenue > 0:
            alloc = json.loads(c.alloc_pcts) if isinstance(c.alloc_pcts, str) else c.alloc_pcts
            div_pct = alloc.get("dividend", 0) / 100.0
            div_yield = round((c.profit * div_pct * 0.5) / market_cap, 4) if market_cap > 0 else 0.0

        result.append(CompanyRankingEntry(
            rank=i + 1,
            player_id=c.player_id,
            name=c.name,
            symbol=c.symbol,
            industry=c.industry,
            industry_name=INDUSTRY_NAMES.get(c.industry, c.industry),
            market_cap=market_cap,
            revenue=c.revenue,
            profit=c.profit,
            share_price=price,
            dividend_yield=div_yield,
        ))
    return result


@router.post("/alloc")
async def update_alloc(req: AllocRequest, user: User = Depends(_get_current_user)):
    alloc = req.alloc_pcts
    total = alloc.get("reserve", 0) + alloc.get("sales", 0) + alloc.get("dividend", 0) + alloc.get("research", 0)
    if total != 100:
        raise HTTPException(400, "分配比例之和必须为 100%")
    if any(v < 0 or v > 100 for v in alloc.values()):
        raise HTTPException(400, "分配比例必须在 0-100 之间")

    async with async_session() as session:
        r = await session.execute(select(Company).where(Company.player_id == user.id))
        c = r.scalar_one_or_none()
        if not c:
            raise HTTPException(404, "no company")
        c.alloc_pcts = json.dumps(alloc, ensure_ascii=False)
        await session.commit()
    return {"ok": True}


@router.post("/announce")
async def company_announce(req: AnnounceRequest, user: User = Depends(_get_current_user)):
    async with async_session() as session:
        r = await session.execute(select(Company).where(Company.player_id == user.id))
        c = r.scalar_one_or_none()
        if not c:
            raise HTTPException(404, "no company")

    msg = {
        "type": "company_announcement",
        "data": {
            "symbol": c.symbol,
            "company": c.name,
            "title": req.title,
            "content": req.content,
        }
    }
    state = get_global_state()
    try:
        await manager.broadcast_to_room(GLOBAL_ROOM_ID, msg)
    except Exception:
        pass
    return {"ok": True}


@router.post("/cash-action")
async def cash_action(req: CashActionRequest, user: User = Depends(_get_current_user)):
    async with async_session() as session:
        r = await session.execute(select(Company).where(Company.player_id == user.id))
        c = r.scalar_one_or_none()
        if not c:
            raise HTTPException(404, "no company")

        action = req.action_type
        amount = req.amount
        min_cost = _min_cost(action)

        if action != "pivot" and amount < min_cost:
            raise HTTPException(400, f"最少需要 ¥{min_cost:,.0f}")
        if amount > c.cash:
            raise HTTPException(400, "公司现金不足")

        msg = ""
        if action == "stock_buyback":
            buy_qty = int(amount / max(c.share_price, 0.01))
            c.cash -= amount
            c.shares_outstanding = max(100000, c.shares_outstanding - buy_qty)
            c.share_price = round(c.share_price * 1.05, 2)  # +5% price boost
            msg = f"回购 {buy_qty} 股，耗资 ¥{amount:,.0f}"

        elif action == "special_dividend":
            c.cash -= amount
            c.total_assets -= amount
            msg = f"特别分红 ¥{amount:,.0f} 已派发"

        elif action == "hiring":
            new_employees = int(amount / 10000) * 2
            c.cash -= amount
            c.employees += new_employees
            msg = f"招聘 {new_employees} 名新员工"

        elif action == "layoff":
            qty = int(req.amount) if req.amount > 0 else 1
            qty = min(qty, c.employees - 1)  # keep at least 1 employee
            if qty <= 0:
                raise HTTPException(400, "员工数不足，无法裁员")
            severance = qty * 2000  # severance pay
            c.cash -= severance
            c.employees -= qty
            msg = f"裁员 {qty} 人，支付遣散费 ¥{severance:,.0f}，每季度节省 ¥{qty * 800:,.0f}"

        elif action == "marketing":
            c.cash -= amount
            state = get_global_state()
            extra = state.company_extra.setdefault(c.id, {})
            extra["marketing_boost"] = extra.get("marketing_boost", 0) + amount
            msg = f"营销投入 ¥{amount:,.0f}，下季度营收将提升"

        elif action == "media_pr":
            c.cash -= amount
            state = get_global_state()
            extra = state.company_extra.setdefault(c.id, {})
            extra["pr_boost"] = extra.get("pr_boost", 0) + amount
            msg = f"公关投入 ¥{amount:,.0f}，品牌形象提升"

        elif action == "acquisition":
            c.cash -= amount
            acquired_assets = amount * random.uniform(1.5, 2.5)
            acquired_employees = random.randint(5, 15)
            c.total_assets += acquired_assets
            c.employees += acquired_employees
            msg = f"并购完成！新增资产 ¥{acquired_assets:,.0f}，{acquired_employees} 名员工"

        elif action == "pivot":
            target = req.target_industry
            if not target or target not in INDUSTRY_NAMES:
                raise HTTPException(400, "请选择有效的目标行业")
            if target == c.industry:
                raise HTTPException(400, "目标行业与当前行业相同")
            old_ind = c.industry
            c.industry = target
            c.cash -= 500000
            c.share_price = round(c.share_price * 0.8, 2)
            msg = f"行业转型为 {INDUSTRY_NAMES[target]}！股价短期承压"

        else:
            raise HTTPException(400, f"未知操作: {action}")

        await session.commit()

        # Update in-memory stock state
        state = get_global_state()
        if c.symbol in state.stocks:
            state.stocks[c.symbol]["price"] = c.share_price
            state.stocks[c.symbol]["shares_outstanding"] = c.shares_outstanding

    return {"message": msg}


def _min_cost(action: str) -> float:
    costs = {
        "stock_buyback": 50000, "special_dividend": 20000, "hiring": 10000,
        "marketing": 30000, "media_pr": 50000, "acquisition": 200000,
        "pivot": 500000,
    }
    return costs.get(action, 0)


@router.post("/decisions")
async def submit_decision(req: DecisionRequest, user: User = Depends(_get_current_user)):
    async with async_session() as session:
        r = await session.execute(select(Company).where(Company.player_id == user.id))
        c = r.scalar_one_or_none()
        if not c:
            raise HTTPException(404, "no company")

        # Store decision in-game state for quarterly processing
        state = get_global_state()
        extra = state.company_extra.setdefault(c.id, {})
        pending = extra.setdefault("pending_decisions", {})
        pending[req.decision_type] = req.choice

        # Update industry momentum based on decision
        momentum_delta = _decision_momentum(req.decision_type, req.choice)
        if momentum_delta != 0:
            cyc = state.industry_cycles.get(c.industry)
            if cyc:
                cyc["momentum"] = cyc.get("momentum", 0) + momentum_delta

        await session.commit()
    return {"ok": True}


def _decision_momentum(decision_type: str, choice: str) -> float:
    """Calculate how much a decision affects industry momentum."""
    # Expansion/growth decisions push momentum positive
    # Contraction/cautious decisions push momentum negative
    positive = {"expand": 0.5, "growth": 0.5, "aggressive": 0.5, "hire": 0.3, "invest": 0.4}
    negative = {"contract": -0.5, "cut": -0.5, "retrench": -0.5, "layoff": -0.3, "save": -0.3}
    if choice in positive:
        return positive[choice]
    if choice in negative:
        return negative[choice]
    return 0.0


@router.get("/financials")
async def company_financials(user: User = Depends(_get_current_user)):
    async with async_session() as session:
        r = await session.execute(select(Company).where(Company.player_id == user.id))
        c = r.scalar_one_or_none()
        if not c:
            raise HTTPException(404, "no company")

        rows = await session.execute(
            select(CompanyQuarterly)
            .where(CompanyQuarterly.company_id == c.id)
            .order_by(desc(CompanyQuarterly.id))
            .limit(20)
        )
        reports = rows.scalars().all()

    return [
        {
            "period": r.period,
            "quarter": r.quarter,
            "revenue": r.revenue,
            "profit": r.profit,
            "assets": r.assets,
            "cash": r.cash,
            "employees": r.employees,
            "share_price": r.share_price,
            "salary_cost": r.salary_cost,
            "rd_spend": r.rd_spend,
            "fixed_cost": r.fixed_cost,
            "dividend_paid": r.dividend_paid,
            "industry_cycle": r.industry_cycle,
            "cycle_mult": r.cycle_mult,
            "base_revenue": r.base_revenue,
            "interest_income": r.interest_income,
            "market_condition": r.market_condition,
            "eps": round(r.profit / c.shares_outstanding, 4) if c.shares_outstanding > 0 else 0,
            "nav": round(r.assets / c.shares_outstanding, 2) if c.shares_outstanding > 0 else 0,
            "pe": round(r.share_price / max(r.profit / max(c.shares_outstanding, 1), 0.001), 2) if r.profit > 0 else 0,
            "pb": round(r.share_price / max(r.assets / max(c.shares_outstanding, 1), 0.001), 2) if r.assets > 0 else 0,
            "revenue_growth": round(((r.revenue / max(r.prev_revenue, 0.01)) - 1) * 100, 2) if r.prev_revenue > 0 else 0,
            "profit_growth": round(((r.profit / max(r.prev_profit, 0.01)) - 1) * 100, 2) if r.prev_profit > 0 else 0,
        }
        for r in reports
    ]


@router.get("/shareholders")
async def company_shareholders(user: User = Depends(_get_current_user)):
    """Get list of players holding this company's stock."""
    async with async_session() as session:
        r = await session.execute(select(Company).where(Company.player_id == user.id))
        c = r.scalar_one_or_none()
        if not c:
            raise HTTPException(404, "no company")

        from backend.models import Holding, User
        rows = await session.execute(
            select(Holding, User.nickname)
            .outerjoin(User, Holding.player_id == User.id)
            .where(Holding.symbol == c.symbol, Holding.qty > 0)
            .order_by(desc(Holding.qty))
        )
        shareholders = []
        total_held = 0
        for h, nick in rows.all():
            name = nick or h.player_id[:8]
            shareholders.append({
                "player_id": h.player_id,
                "nickname": name,
                "qty": h.qty,
                "pct": round(h.qty / max(c.shares_outstanding, 1) * 100, 2),
            })
            total_held += h.qty

        return {
            "symbol": c.symbol,
            "shares_outstanding": c.shares_outstanding,
            "total_held": total_held,
            "circulation_pct": round(total_held / max(c.shares_outstanding, 1) * 100, 2),
            "shareholders": shareholders,
        }
