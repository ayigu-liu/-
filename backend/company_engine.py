"""Company quarterly processing, industry cycles, stock price drift.
Extracted from game_engine.py to reduce module size."""

import asyncio
import json
import logging
import random
from datetime import datetime

from sqlalchemy import select, desc

from backend.config import PRICE_TICK_INTERVAL
from backend.database import async_session
from backend.models import Company, CompanyQuarterly
from backend.game_engine import get_global_state, GLOBAL_ROOM_ID
from backend.websocket_manager import manager

logger = logging.getLogger(__name__)

QUARTER_TICKS = 200


async def company_tick_loop():
    """Process company stocks every tick. Every QUARTER_TICKS, process quarterly reports."""
    state = get_global_state()
    tick_count = 0
    while True:
        await asyncio.sleep(PRICE_TICK_INTERVAL)
        tick_count += 1
        state._company_tick_counter = tick_count
        await _update_company_stock_prices(state)
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
                # No per-tick drift — price only changes through actual trades
                nav = max(c.total_assets / max(c.shares_outstanding, 1), 1.0)
                sd["nav"] = round(nav, 2)
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

            from backend.industry_config import INDUSTRY_BENCHMARKS

            # Global market condition this quarter
            market_condition = random.uniform(-0.15, 0.20)

            for c in companies:
                try:
                    alloc = json.loads(c.alloc_pcts) if isinstance(c.alloc_pcts, str) else c.alloc_pcts
                except (json.JSONDecodeError, TypeError):
                    alloc = {"reserve": 25, "sales": 25, "dividend": 25, "research": 25}

                extra = state.company_extra.get(c.id, {})
                marketing_boost = extra.get("marketing_boost", 0)
                pr_boost = extra.get("pr_boost", 0)
                rnd_level = extra.get("rnd_level", 1.0)

                # Industry benchmarks from config
                bench = INDUSTRY_BENCHMARKS.get(c.industry, {"rev": 2000, "cost": 1200, "trend": 1.04})
                base_rev_per_emp = bench["rev"]
                base_cost_per_emp = bench["cost"]
                trend = bench["trend"]

                # Industry cycle
                cycle_info = state.industry_cycles.get(c.industry, {})
                cycle = cycle_info.get("cycle", "normal")
                cycle_mult = {"boom": 1.5, "normal": 1.0, "recession": 0.65}.get(cycle, 1.0)

                sales_pct = alloc.get("sales", 25) / 100.0
                research_pct = alloc.get("research", 25) / 100.0
                reserve_pct = alloc.get("reserve", 25) / 100.0

                rnd_growth = 1.0 + research_pct * 0.12
                rnd_level *= rnd_growth
                extra["rnd_level"] = rnd_level
                rnd_efficiency = 1.0 + (rnd_level - 1.0) * 0.3

                sales_boost = 1.0 + sales_pct * 0.6
                scale_factor = 1.0 + min(0.5, c.employees / 500 * 0.15)

                mkt_boost = 1.0
                if marketing_boost > 0:
                    mkt_boost = 1.0 + min(1.0, marketing_boost / 50000)
                    extra["marketing_boost"] = marketing_boost * 0.3
                    if extra["marketing_boost"] < 500:
                        extra["marketing_boost"] = 0

                random_factor = random.uniform(0.85, 1.15)
                quarters_since_start = c.quarter
                trend_mult = trend ** quarters_since_start

                effective_rev_per_emp = base_rev_per_emp * cycle_mult * rnd_efficiency * scale_factor * trend_mult
                revenue = c.employees * effective_rev_per_emp * sales_boost * mkt_boost * random_factor
                revenue *= (1.0 + market_condition)

                fixed_cost = 5000 + c.employees * 200
                salary_cost = c.employees * base_cost_per_emp * cycle_mult * scale_factor
                rd_spend = revenue * research_pct * 0.8
                total_costs = fixed_cost + salary_cost + rd_spend
                profit = revenue - total_costs
                interest_income = c.cash * 0.005

                if pr_boost > 0:
                    extra["pr_boost"] = pr_boost * 0.5
                    if extra["pr_boost"] < 500:
                        extra["pr_boost"] = 0

                net_profit = profit + interest_income
                div_pct = alloc.get("dividend", 25) / 100.0
                dividend_paid = max(0, net_profit * div_pct) if net_profit > 0 else 0
                reserve_amount = max(0, net_profit * reserve_pct) if net_profit > 0 else 0

                c.revenue = round(revenue, 2)
                c.profit = round(net_profit, 2)
                c.cash = round(c.cash + net_profit - dividend_paid, 2)
                c.total_assets = round(c.total_assets + reserve_amount + interest_income, 2)
                c.quarter = q_num

                if net_profit > 0:
                    if random.random() < min(0.4, net_profit / (salary_cost + 1)) * 0.3:
                        c.employees += random.randint(1, 3)
                else:
                    if random.random() < 0.2:
                        c.employees = max(5, c.employees - random.randint(1, 2))

                nav = max(c.total_assets / max(c.shares_outstanding, 1), 1.0)
                eps = net_profit / max(c.shares_outstanding, 1)
                base_pe = {"tech": 20, "finance": 12, "manufacturing": 10,
                           "energy": 8, "consumer": 15, "healthcare": 18}.get(c.industry, 10)
                if eps > 0:
                    pe_mult = base_pe * cycle_mult
                else:
                    pe_mult = base_pe * 0.5 * cycle_mult
                c.share_price = round(max(0.01, nav + eps * pe_mult), 2)

                base_rev = round(c.employees * base_rev_per_emp, 2)
                prev_r = await session.execute(
                    select(CompanyQuarterly)
                    .where(CompanyQuarterly.company_id == c.id)
                    .order_by(desc(CompanyQuarterly.id))
                    .limit(1)
                )
                prev = prev_r.scalar_one_or_none()

                q = CompanyQuarterly(
                    company_id=c.id, quarter=q_num, period=period_str,
                    revenue=c.revenue, profit=c.profit, assets=c.total_assets,
                    cash=c.cash, employees=c.employees, share_price=c.share_price,
                    salary_cost=round(salary_cost, 2), rd_spend=round(rd_spend, 2),
                    fixed_cost=round(fixed_cost, 2), dividend_paid=round(dividend_paid, 2),
                    industry_cycle=cycle,
                    prev_revenue=prev.revenue if prev else 0,
                    prev_profit=prev.profit if prev else 0,
                    cycle_mult=cycle_mult, base_revenue=base_rev,
                    interest_income=round(interest_income, 2),
                    market_condition=round(market_condition, 4),
                )
                session.add(q)

                if c.symbol in state.stocks:
                    state.stocks[c.symbol]["price"] = c.share_price
                    state.stocks[c.symbol]["eps"] = round(eps, 2)
                    state.stocks[c.symbol]["nav"] = round(nav, 2)

            await session.commit()

        await _update_industry_cycles(state, tick_count)
    except Exception as e:
        logger.error(f"Quarterly processing error: {e}")


async def _update_industry_cycles(state, tick_count):
    """Transition industry cycles based on accumulated momentum."""
    for ind_id, cyc in state.industry_cycles.items():
        cyc["ticks_in_cycle"] = cyc.get("ticks_in_cycle", 0) + QUARTER_TICKS
        cyc["momentum"] = cyc.get("momentum", 0.0) + random.uniform(-0.3, 0.3)

        if cyc["ticks_in_cycle"] >= QUARTER_TICKS * 4:
            momentum = cyc.get("momentum", 0.0)
            current = cyc["cycle"]

            if current == "normal":
                if momentum > 2.0:
                    new_cycle, name, desc = "boom", "繁荣", "行业景气度高涨，需求旺盛！"
                elif momentum < -2.0:
                    new_cycle, name, desc = "recession", "衰退", "行业进入下行周期，市场低迷"
                else:
                    new_cycle, name, desc = "normal", "正常", "行业运行平稳"
            elif current == "boom":
                new_cycle, name, desc = "normal", "正常", "繁荣期结束，行业回归平稳"
            else:
                new_cycle, name, desc = "normal", "正常", "衰退期结束，行业开始复苏"

            cyc["cycle"] = new_cycle
            cyc["cycle_name"] = name
            cyc["cycle_desc"] = desc
            cyc["ticks_in_cycle"] = 0
            cyc["momentum"] = 0.0

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
                        "cycle": new_cycle, "cycle_name": name, "cycle_desc": desc,
                    }
                })
            except Exception:
                pass
