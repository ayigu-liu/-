#!/usr/bin/env python3
"""模拟公司经营 v2 AP 系统：跑 20 个季度 (100 分钟游戏时间)"""

import math, random, json
from dataclasses import dataclass, field
from typing import Optional
from collections import deque

random.seed(42)  # 可复现

# ─── 行业配置 ─────────────────────────────────────────────

INDUSTRIES = {
    "tech":   {"name": "科技", "pe": 25, "rev_per_emp": 40000, "base_employees": 3, "base_cash": 20000, "shares": 10000},
    "finance": {"name": "金融", "pe": 12, "rev_per_emp": 50000, "base_employees": 3, "base_cash": 50000, "shares": 15000},
    "mfg":    {"name": "制造", "pe": 10, "rev_per_emp": 30000, "base_employees": 5, "base_cash": 30000, "shares": 20000},
    "energy":  {"name": "能源", "pe": 8,  "rev_per_emp": 35000, "base_employees": 5, "base_cash": 50000, "shares": 25000},
    "consumer":{"name": "消费", "pe": 20, "rev_per_emp": 35000, "base_employees": 3, "base_cash": 15000, "shares": 12000},
    "medical": {"name": "医疗", "pe": 30, "rev_per_emp": 50000, "base_employees": 3, "base_cash": 40000, "shares": 8000},
}

CYCLE_MULT = {"boom": 1.5, "normal": 1.0, "recession": 0.65}

RANDOM_EVENTS = [
    ("政策利好",       10, lambda c: setattr(c, "demand_mod", c.demand_mod + 0.25)),
    ("原材料涨价",     10, lambda c: setattr(c, "profit_margin", c.profit_margin - 0.10)),
    ("核心员工离职",    8, lambda c: setattr(c, "employees", max(1, c.employees - 3))),
    ("竞品冲击",        8, lambda c: (setattr(c, "demand_mod", c.demand_mod - 0.20), setattr(c, "promo_mult", 2.0))),
    ("技术突破",        6, lambda c: setattr(c, "rd_mult", c.rd_mult + 1.0)),
    ("利率调整",        6, lambda c: setattr(c, "interest_bonus", 0.03)),
    ("监管罚款",        5, lambda c: setattr(c, "cash", max(0, c.cash - random.randint(20000, 80000)))),
    ("社交媒体爆火",    5, lambda c: setattr(c, "price_boost", c.price_boost + 0.15)),
    ("大客户签约",      5, lambda c: setattr(c, "demand_mod", c.demand_mod + 0.40)),
    ("供应链中断",      4, lambda c: setattr(c, "capacity_mod", c.capacity_mod - 0.25)),
    ("专利获批",        3, lambda c: setattr(c, "price_boost", c.price_boost + 0.20)),
    ("自然灾害",        3, lambda c: setattr(c, "capacity_mod", c.capacity_mod - 0.30)),
]

BOARD_KPIS = [
    ("股价涨幅", lambda c: c.price_history[-1] / max(c.price_history[0], 0.01) - 1, 0.15, "+5"),
    ("营收增长", lambda c: c.quarterly_revenue[-1] / max(c.quarterly_revenue[0], 1) - 1, 0.20, "+3"),
    ("利润率",   lambda c: c.profit_margin, 0.25, "+4"),
    ("分红总额", lambda c: c.total_dividend_paid, 100000, "+3"),
    ("员工规模", lambda c: c.employees, 50, "+2"),
]

INDUSTRY_ACTIONS = {
    "tech":     ("产品发布",   2, "下季度营收+50%，2季後-20%", 50000),
    "finance":  ("杠杆投资",   1, "下季度利润翻倍或减半(50%)", 0),
    "mfg":      ("加班赶工",   1, "本季度产能+30%，下季度-10%", 10000),
    "energy":   ("囤积资源",   1, "锁定原料价，下季度不受周期影响", 80000),
    "consumer": ("开店扩张",   2, "需求上限永久+15%", 150000),
    "medical":  ("加速临床",   2, "研发效果立即翻倍，20%失败", 100000),
}

# ─── 公司状态 ─────────────────────────────────────────────

@dataclass
class Company:
    name: str
    industry: str
    symbol: str
    employees: int
    cash: float
    total_shares: int
    profit_margin: float
    capacity: int
    inventory: int = 0
    demand: int = 1000
    rd_level: float = 1.0
    stock_price: float = 5.0
    quarter: int = 1
    total_dividend_paid: float = 0
    board_satisfaction: int = 70
    board_kpi_name: str = "股价涨幅"
    board_kpi_target: float = 0.15
    board_kpi_quarters: int = 0
    is_active: bool = True
    fail_reason: str = ""
    ceo_nickname: str = "玩家"
    ap_bonus: int = 0
    fired_count: int = 0  # 被罢免次数（重生计数）

    # 历史追踪
    price_history: list = field(default_factory=list)
    quarterly_revenue: list = field(default_factory=list)
    quarterly_profit: list = field(default_factory=list)
    decisions_log: list = field(default_factory=list)

    # 临时修正 (每季度重置)
    demand_mod: float = 0.0
    capacity_mod: float = 0.0
    promo_mult: float = 1.0
    rd_mult: float = 0.0
    price_boost: float = 0.0
    interest_bonus: float = 0.0
    next_q_penalty: float = 0.0
    cycle_shield: bool = False

    def reset_mods(self):
        self.demand_mod = 0.0
        self.capacity_mod = 0.0
        self.promo_mult = 1.0
        self.rd_mult = 0.0
        self.price_boost = 0.0
        self.interest_bonus = 0.0

    @property
    def pe(self):
        return INDUSTRIES[self.industry]["pe"]

    @property
    def revenue(self):
        rev_per_emp = INDUSTRIES[self.industry]["rev_per_emp"] * self.rd_level
        base = self.employees * rev_per_emp
        return base * (1 + self.demand_mod) * random.uniform(0.88, 1.12)

    @property
    def profit(self):
        return self.revenue * self.profit_margin + self.cash * (0.005 + self.interest_bonus)

    @property
    def eps(self):
        return self.profit / max(self.total_shares, 1)

    @property
    def board_status(self):
        s = self.board_satisfaction
        if s >= 80: return "满意", "🟢"
        if s >= 50: return "观察", "🟡"
        if s >= 30: return "不满", "🟠"
        return "危急", "🔴"


# ─── 模拟器 ───────────────────────────────────────────────

class Simulator:
    def __init__(self, company: Company):
        self.c = company
        self.c.price_history.append(self.c.stock_price)
        self.cycle = "normal"
        self.cycle_ticks = 0

    def tick_cycle(self):
        self.cycle_ticks += 1
        if self.cycle_ticks >= 4:
            if self.cycle == "normal":
                m = random.uniform(-1, 1)
                if m > 0.5: self.cycle = "boom"
                elif m < -0.5: self.cycle = "recession"
            else:
                self.cycle = "normal"
            self.cycle_ticks = 0

    def roll_event(self) -> Optional[str]:
        if random.random() > 0.30:
            return None
        weights = [(e[0], e[1]) for e in RANDOM_EVENTS]
        total = sum(w[1] for w in weights)
        r = random.uniform(0, total)
        cum = 0
        for name, w, fn in RANDOM_EVENTS:
            cum += w
            if r <= cum:
                fn(self.c)
                return name
        return None

    def compute_stock_price(self):
        eps = self.c.eps
        cycle_m = CYCLE_MULT.get(self.cycle, 1.0)
        sentiment = 0.9 + 0.2 * math.tanh(len([d for d in self.c.decisions_log[-4:] if "分红" in d or "回购" in d]) / 2)
        price = max(0.10, eps * self.c.pe * cycle_m * sentiment * (1 + self.c.price_boost))
        self.c.stock_price = round(price, 2)
        self.c.price_history.append(self.c.stock_price)

    def board_check(self):
        # 日常波动 (股价相关)
        if self.c.price_history:
            recent = self.c.price_history[-1]
            prev = self.c.price_history[-2] if len(self.c.price_history) > 1 else recent
            chg = (recent - prev) / max(prev, 0.01)
            if chg > 0.10: self.c.board_satisfaction += 2
            elif chg < -0.10: self.c.board_satisfaction -= 3
        self.c.board_satisfaction = max(0, min(100, self.c.board_satisfaction))

        # 年度考核 (Q4/Q8/Q12/...)
        self.c.board_kpi_quarters += 1
        if self.c.board_kpi_quarters % 4 == 0 and self.c.board_kpi_quarters > 0:
            kpi_name, kpi_fn, target, bonus_str = self._get_kpi(self.c.board_kpi_name)
            actual = kpi_fn(self.c)
            if isinstance(actual, float):
                passed = actual >= target
            else:
                passed = actual >= target

            label = self._kpi_label(self.c.board_kpi_name, actual)
            # 早期宽容：前8季度KPI只影响不加惩罚
            if self.c.board_kpi_quarters <= 8 and not passed:
                self.c.decisions_log.append(f"📋 年度考核未达标(保护期) {label}")
            elif passed:
                self.c.board_satisfaction = min(100, self.c.board_satisfaction + 8)
                over = max(0, actual - target) / max(target, 0.01)
                bonus = min(5, int(over / 0.05) * int(bonus_str[1:]))
                self.c.board_satisfaction = min(100, self.c.board_satisfaction + bonus)
                if self.c.ap_bonus < 2:
                    self.c.ap_bonus += 1
                self.c.decisions_log.append(f"📋 年度考核通过！{label} → +{8+bonus}, AP上限+1")
            else:
                self.c.board_satisfaction -= 12
                self.c.decisions_log.append(f"📋 年度考核未达标 {label}")
                if self.c.board_satisfaction < 30 and self.c.board_kpi_quarters > 8:
                    self.c.is_active = False
                    self.c.fail_reason = f"Q{self.c.quarter}: 被董事会罢免 (满意度 {self.c.board_satisfaction})"

            # 低满意度检查
            if self.c.board_satisfaction < 20 and self.c.board_kpi_quarters > 8:
                self.c.is_active = False
                self.c.fail_reason = f"Q{self.c.quarter}: 被董事会罢免 (满意度 {self.c.board_satisfaction})"

            # 换 KPI
            if random.random() < 0.4:
                old = self.c.board_kpi_name
                self.c.board_kpi_name = random.choice(BOARD_KPIS)[0]
                self.c.decisions_log.append(f"  董事会更换年度KPI: {old} → {self.c.board_kpi_name}")

    def _get_kpi(self, name):
        for k in BOARD_KPIS:
            if k[0] == name: return k
        return BOARD_KPIS[0]

    def _kpi_label(self, name, val):
        if name == "股价涨幅": return f"股价涨幅 {val*100:.1f}%"
        if name == "营收增长": return f"营收增长 {val*100:.1f}%"
        if name == "利润率": return f"利润率 {val*100:.1f}%"
        if name == "分红总额": return f"分红 ¥{val:,.0f}"
        if name == "员工规模": return f"员工 {val}人"
        return f"{name}: {val}"


# ─── AI 策略 ──────────────────────────────────────────────

class AIStrategies:
    """不同风格的模拟 CEO"""

    @staticmethod
    def growth(c: Company, s: Simulator) -> list[str]:
        """激进增长：优先扩产招人"""
        ap = 3 + c.ap_bonus
        acts = []
        hire_cost = 3000  # per employee
        max_hire = min(int(c.cash / hire_cost) if hire_cost > 0 else 5, 5)
        while ap >= 1:
            if c.cash >= hire_cost and max_hire > 0:
                new_emp = min(max_hire, 2)
                c.employees += new_emp
                c.cash -= new_emp * hire_cost
                max_hire -= new_emp
                ap -= 1
                acts.append(f"招人×{new_emp}")
            elif ap >= 1:
                c.capacity = int(c.capacity * 1.20)
                c.demand = int(c.demand * 1.10)
                ap -= 1
                acts.append("扩产")
            else:
                break
        if ap >= 0 and c.cash >= 30000:
            c.cash -= 30000
            acts.append("营销")
        return acts

    @staticmethod
    def value(c: Company, s: Simulator) -> list[str]:
        """价值投资：重分红+研发，不激進扩张"""
        ap = 3 + c.ap_bonus
        acts = []
        if ap >= 2 and c.cash >= 50000:
            c.cash -= 50000
            c.rd_level += 0.15
            c.profit_margin += 0.02
            ap -= 2
            acts.append("并购(小)")
        if ap >= 1:
            c.profit_margin += 0.03
            c.rd_level += 0.03
            ap -= 1
            acts.append("研发")
        if c.profit_margin > 0.10 and c.cash >= 20000:
            div = min(c.cash * 0.2, 10000)
            if div > 0:
                c.cash -= div
                c.total_dividend_paid += div
                c.stock_price *= 1.06
                acts.append("分红")
        if ap >= 0 and c.cash >= 30000 and not any("营销" in a for a in acts):
            c.cash -= 30000
            acts.append("营销")
        return acts

    @staticmethod
    def balanced(c: Company, s: Simulator) -> list[str]:
        """平衡型：交替增长和研发"""
        ap = 3 + c.ap_bonus
        acts = []
        phase = c.quarter % 3
        if phase == 0 and ap >= 1:
            c.profit_margin += 0.025
            c.rd_level += 0.02
            ap -= 1
            acts.append("研发")
        elif phase == 1 and ap >= 1 and c.cash >= 6000:
            hire_count = min(2, int(c.cash / 4000))
            if hire_count > 0:
                c.employees += hire_count
                c.cash -= hire_count * 3000
                ap -= 1
                acts.append(f"招人×{hire_count}")
        elif phase == 2 and ap >= 1:
            c.capacity = int(c.capacity * 1.15)
            c.demand = int(c.demand * 1.10)
            ap -= 1
            acts.append("扩产")
        if ap >= 0 and c.cash >= 20000:
            c.cash -= 20000
            c.demand = int(c.demand * 1.20)
            acts.append("营销")
        if ap >= 0 and c.cash >= 30000 and c.profit_margin > 0.10:
            div = min(c.cash * 0.15, 15000)
            c.cash -= div
            c.total_dividend_paid += div
            c.stock_price *= 1.05
            acts.append("分红")
        return acts

    @staticmethod
    def risk(c: Company, s: Simulator) -> list[str]:
        """赌徒型：重行业专属 + 偶尔大并购，不干时就研发"""
        ap = 3 + c.ap_bonus
        acts = []
        ia_name, ia_ap, ia_eff, ia_cost = INDUSTRY_ACTIONS[c.industry]
        did_big = False

        if c.industry == "medical" and ap >= ia_ap and c.cash >= ia_cost:
            c.cash -= ia_cost
            if random.random() < 0.20:
                acts.append(f"{ia_name}(失败)")
            else:
                c.rd_level += 0.25
                c.profit_margin += 0.03
                acts.append(f"{ia_name}(成功×2)")
            ap -= ia_ap
            did_big = True
        elif c.industry == "tech" and ap >= ia_ap and c.cash >= ia_cost:
            c.cash -= ia_cost
            c.demand_mod += 0.50
            c.next_q_penalty -= 0.15
            ap -= ia_ap
            acts.append(ia_name)
            did_big = True
        elif ap >= 2 and c.cash >= 50000:
            c.cash -= 50000
            c.rd_level += 0.20
            c.employees += int(c.employees * 0.3)
            ap -= 2
            acts.append("并购(大)")
            did_big = True

        # 如果没做大事，就做日常经营
        if not did_big:
            if ap >= 1:
                c.profit_margin += 0.02
                c.rd_level += 0.02
                ap -= 1
                acts.append("研发")
            if ap >= 1 and c.cash >= 10000:
                c.cash -= 10000
                c.demand = int(c.demand * 1.15)
                ap -= 1
                acts.append("营销")
            if ap >= 1 and c.cash >= 6000:
                c.employees += 2
                c.cash -= 6000
                ap -= 1
                acts.append("招人")
        return acts


# ─── 运行模拟 ─────────────────────────────────────────────

def simulate(strategy, industry="tech", quarters=20):
    ind = INDUSTRIES[industry]
    c = Company(
        name=f"{strategy}{ind['name']}公司",
        industry=industry,
        symbol=f"{'TK'}_SIM",
        employees=ind["base_employees"],
        cash=ind["base_cash"],
        total_shares=ind["shares"],
        profit_margin=0.25,
        capacity=ind["base_employees"] * 300,
        demand=ind["base_employees"] * 280,
        rd_level=1.0,
        stock_price=5.0,
        board_kpi_name=random.choice(BOARD_KPIS)[0],
    )
    s = Simulator(c)
    strategy_fn = getattr(AIStrategies, strategy)

    print(f"\n{'='*80}")
    print(f"  {c.name}  [CEO: {strategy}型]  PE={c.pe}  股本={c.total_shares:,}")
    print(f"  初始 KPI: {c.board_kpi_name}  |  现金 ¥{c.cash:,.0f}  |  股价 ¥{c.stock_price:.2f}")
    print(f"{'='*80}")
    print(f"{'Q':<4} {'营收':>10} {'利润':>10} {'利润率':>7} {'股价':>8} {'员工':>5} {'现金':>10} {'董事会':>5} {'决策'}")
    print(f"{'-'*80}")

    for q in range(1, quarters + 1):
        if not c.is_active:
            break

        c.quarter = q
        c.reset_mods()
        c.demand_mod += c.next_q_penalty
        c.next_q_penalty = 0
        s.tick_cycle()

        # 随机事件
        event = s.roll_event()

        # AI 决策
        if c.ap_bonus > 0:
            pass  # 保持上年度奖励
        decisions = strategy_fn(c, s)
        c.decisions_log = c.decisions_log[-8:]  # 保留最近

        # 应用产能/需求 → 营收/利润
        rev = c.revenue
        prof = c.profit
        if q > 1 and prof > 0:
            c.cash += prof
        elif prof < 0:
            c.cash += prof  # 亏损消耗现金
        c.cash = round(c.cash, 2)
        c.quarterly_revenue.append(rev)
        c.quarterly_profit.append(prof)

        # 现金为负处理
        if c.cash < 0:
            if q > 3:  # 前3季度容忍
                c.board_satisfaction -= 10
            c.cash = max(c.cash, 0)  # 最低0，由注资弥补（模拟董事会输血）
            c.decisions_log.append("⚠️ 现金流枯竭，董事会紧急注资")

        if q > 1:
            s.compute_stock_price()
        s.board_check()
        if not c.is_active:
            break

        # 日志
        event_str = f"📰{event}" if event else ""
        decision_str = "+".join(decisions) if decisions else "跳过"
        status, icon = c.board_status
        if q > 1:
            pm = prof / max(rev, 1) * 100
            decisions_display = decision_str if len(decision_str) <= 30 else decision_str[:28] + ".."
            print(f"Q{q:<3} ¥{rev:>8,.0f} ¥{prof:>8,.0f} {pm:>5.1f}% ¥{c.stock_price:>6.2f} {c.employees:>4}人 ¥{c.cash:>8,.0f} {c.board_satisfaction:>4} {event_str} {decisions_display}")
        else:
            pm = prof / max(rev, 1) * 100
            decisions_display = decision_str if len(decision_str) <= 30 else decision_str[:28] + ".."
            print(f"Q{q:<3} ¥{rev:>8,.0f} ¥{prof:>8,.0f} {pm:>5.1f}% ¥{c.stock_price:>6.2f} {c.employees:>4}人 ¥{c.cash:>8,.0f} {c.board_satisfaction:>4} 📰{s.cycle} {decisions_display}")

    # 结算
    print(f"{'-'*80}")
    if c.is_active:
        price_chg = (c.price_history[-1] / max(c.price_history[0], 0.01) - 1) * 100
        eps_final = c.profit / max(c.total_shares, 1)
        print(f"  最终: 股价 ¥{c.stock_price:.2f}({price_chg:+.0f}%) | EPS ¥{eps_final:.2f} | 员工 {c.employees}人 | "
              f"现金 ¥{c.cash:,.0f} | 满意度 {c.board_satisfaction} | AP上限 {3+c.ap_bonus}")
    else:
        print(f"  💀 {c.fail_reason}")
    return c


# ─── 主程序 ───────────────────────────────────────────────

if __name__ == "__main__":
    strategies = ["growth", "value", "balanced", "risk"]
    industries = ["tech", "mfg", "consumer", "medical"]
    results = []

    print("\n")
    print("╔═══════════════════════════════════════════════════════════════╗")
    print("║       公司经营 v2 · 行动点数制 · 模拟 20 季度               ║")
    print("║       每季度 3AP，随机事件，董事会年度考核                   ║")
    print("╚═══════════════════════════════════════════════════════════════╝")

    for strat in strategies:
        for ind in industries:
            c = simulate(strat, ind, 20)
            if c.is_active:
                results.append({
                    "name": c.name,
                    "strategy": strat,
                    "industry": c.industry,
                    "final_price": c.stock_price,
                    "price_chg": (c.price_history[-1] / c.price_history[0] - 1) * 100,
                    "employees": c.employees,
                    "board": c.board_satisfaction,
                    "ap": 3 + c.ap_bonus,
                    "active": True,
                })
            else:
                results.append({
                    "name": c.name, "strategy": strat, "industry": c.industry,
                    "active": False, "reason": c.fail_reason,
                })

    # 排行榜
    print("\n\n")
    print("╔══════════════════════════════════════════════════════════════════════════╗")
    print("║                         终    局    排    行    榜                        ║")
    print("╠══════════════════════════════════════════════════════════════════════════╣")
    print(f"  {'公司':<18} {'策略':<8} {'行业':<6} {'股价':>8} {'涨幅':>7} {'员工':>5} {'满意度':>5} {'AP':>3}")
    print("  " + "-" * 68)

    alive = [r for r in results if r["active"]]
    dead = [r for r in results if not r["active"]]

    # 按股价排序
    alive.sort(key=lambda r: r["final_price"], reverse=True)
    for i, r in enumerate(alive):
        medal = ["🥇","🥈","🥉"][i] if i < 3 else f" {i+1}."
        eps_str = f"¥{r.get('final_eps', 0):.2f}" if "final_eps" in r else ""
        print(f"  {medal} {r['name']:<16} {r['strategy']:<8} {r['industry']:<6} "
              f"¥{r['final_price']:>6.2f} {r['price_chg']:>+7.1f}% {r['employees']:>4}人 "
              f"{r['board']:>4} {r['ap']:>2}")

    if dead:
        print(f"\n  💀 被罢免的公司:")
        for r in dead:
            print(f"     {r['name']} ({r['strategy']}/{r['industry']}) — {r['reason']}")

    print("╚══════════════════════════════════════════════════════════════════════════╝")

    # 统计分析
    print(f"\n总计: {len(alive)} 家存活, {len(dead)} 家被罢免")
    if alive:
        prices = [r["final_price"] for r in alive]
        chgs = [r["price_chg"] for r in alive]
        print(f"股价: 最高 ¥{max(prices):.2f}  |  最低 ¥{min(prices):.2f}  |  中位数 ¥{sorted(prices)[len(prices)//2]:.2f}")
        print(f"涨幅: 最高 {max(chgs):+.0f}%  |  最低 {min(chgs):+.0f}%")

        # 策略分析
        from collections import defaultdict
        strat_avg = defaultdict(list)
        for r in alive:
            strat_avg[r["strategy"]].append(r["final_price"])
        print(f"\n按策略平均股价:")
        for s in strategies:
            if strat_avg[s]:
                avg = sum(strat_avg[s]) / len(strat_avg[s])
                print(f"  {s:<10}  ¥{avg:.2f}")

        # 行业分析
        ind_avg = defaultdict(list)
        for r in alive:
            ind_avg[r["industry"]].append(r["final_price"])
        print(f"\n按行业平均股价:")
        for ind_name in industries:
            if ind_avg[ind_name]:
                avg = sum(ind_avg[ind_name]) / len(ind_avg[ind_name])
                ind_label = INDUSTRIES[ind_name]["name"]
                print(f"  {ind_label:<6}  ¥{avg:.2f}")
