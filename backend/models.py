import uuid
import hashlib
import secrets
import random
import string
from datetime import datetime

from sqlalchemy import Column, String, Integer, Float, DateTime, CheckConstraint, Index, UniqueConstraint
from sqlalchemy.orm import relationship

from backend.database import Base
from backend.config import STARTING_CASH


def generate_player_id():
    return uuid.uuid4().hex[:12]


class User(Base):
    __tablename__ = "users"

    id = Column(String(12), primary_key=True, default=generate_player_id)
    username = Column(String(50), unique=True, nullable=False, index=True)  # QQ email
    nickname = Column(String(20), nullable=False, default="")
    password_hash = Column(String(128), nullable=False, default="")
    salt = Column(String(32), nullable=False, default="")
    token = Column(String(64), nullable=True)
    is_admin = Column(Integer, nullable=False, default=0)  # 0=普通玩家, 1=后台账号
    created_at = Column(DateTime, default=lambda: datetime.utcnow())

    @staticmethod
    def generate_salt() -> str:
        return secrets.token_hex(16)

    @staticmethod
    def generate_token() -> str:
        return secrets.token_hex(32)


class Transaction(Base):
    __tablename__ = "transactions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    player_id = Column(String(12), nullable=False, index=True)
    symbol = Column(String(6), nullable=False)
    trade_type = Column(String(10), nullable=False)
    quantity = Column(Integer, nullable=False)
    price = Column(Float, nullable=False)
    total = Column(Float, nullable=False)
    created_at = Column(DateTime, default=lambda: datetime.utcnow())

    __table_args__ = (
        CheckConstraint("trade_type IN ('buy', 'sell', 'short_sell', 'cover')"),
        Index("idx_transactions_player", "player_id"),
    )


class PlayerState(Base):
    """玩家财务状态持久化——服务器重启后恢复现金、冻结资金、融资负债。
       每次玩家交易/挂单/撤单时通过 mark_dirty() 标记，每 15 tick 批量写入。"""
    __tablename__ = "player_state"

    player_id = Column(String(12), primary_key=True)
    nickname = Column(String(50), nullable=False, default="")
    cash = Column(Float, nullable=False, default=STARTING_CASH)
    frozen_cash = Column(Float, nullable=False, default=0.0)
    margin_debt = Column(Float, nullable=False, default=0.0)


class Holding(Base):
    """股票持仓持久化——每只股票一条记录，存数量和成本价。
       和 PlayerState 一起在 save_player_state() 中写入。"""
    __tablename__ = "holdings"

    id = Column(Integer, primary_key=True, autoincrement=True)
    player_id = Column(String(12), nullable=False, index=True)
    symbol = Column(String(6), nullable=False)
    qty = Column(Integer, nullable=False, default=0)
    avg_cost = Column(Float, nullable=False, default=0.0)
    frozen_qty = Column(Integer, nullable=False, default=0)
    short_qty = Column(Integer, nullable=False, default=0)
    short_avg_cost = Column(Float, nullable=False, default=0.0)

    __table_args__ = (
        UniqueConstraint("player_id", "symbol", name="uq_player_symbol"),
        Index("idx_holdings_player", "player_id"),
    )


class Company(Base):
    __tablename__ = "companies"

    id = Column(Integer, primary_key=True, autoincrement=True)
    player_id = Column(String(12), nullable=False, unique=True, index=True)
    name = Column(String(20), nullable=False)
    symbol = Column(String(10), nullable=False, unique=True)
    industry = Column(String(20), nullable=False)
    cash = Column(Float, nullable=False, default=100000.0)
    total_assets = Column(Float, nullable=False, default=100000.0)
    revenue = Column(Float, nullable=False, default=0.0)
    profit = Column(Float, nullable=False, default=0.0)
    employees = Column(Integer, nullable=False, default=10)
    quarter = Column(Integer, nullable=False, default=1)
    alloc_pcts = Column(String(200), nullable=False, default='{"reserve":25,"sales":25,"dividend":25,"research":25}')
    tech_points = Column(Float, nullable=False, default=0.0)
    share_price = Column(Float, nullable=False, default=10.0)
    shares_outstanding = Column(Integer, nullable=False, default=10_000_000)
    created_at = Column(DateTime, default=lambda: datetime.utcnow())

    __table_args__ = (
        Index("idx_company_player", "player_id"),
        Index("idx_company_industry", "industry"),
    )


class CompanyQuarterly(Base):
    __tablename__ = "company_quarterly"

    id = Column(Integer, primary_key=True, autoincrement=True)
    company_id = Column(Integer, nullable=False, index=True)
    quarter = Column(Integer, nullable=False)
    period = Column(String(20), nullable=False)  # e.g. "2024年Q1"
    revenue = Column(Float, nullable=False, default=0.0)
    profit = Column(Float, nullable=False, default=0.0)
    assets = Column(Float, nullable=False, default=0.0)
    cash = Column(Float, nullable=False, default=0.0)
    employees = Column(Integer, nullable=False, default=0)
    share_price = Column(Float, nullable=False, default=0.0)
    salary_cost = Column(Float, nullable=False, default=0.0)
    rd_spend = Column(Float, nullable=False, default=0.0)
    fixed_cost = Column(Float, nullable=False, default=0.0)
    dividend_paid = Column(Float, nullable=False, default=0.0)
    industry_cycle = Column(String(10), nullable=False, default="normal")
    prev_revenue = Column(Float, nullable=False, default=0.0)
    prev_profit = Column(Float, nullable=False, default=0.0)
    cycle_mult = Column(Float, nullable=False, default=1.0)
    base_revenue = Column(Float, nullable=False, default=0.0)
    interest_income = Column(Float, nullable=False, default=0.0)
    market_condition = Column(Float, nullable=False, default=0.0)
    created_at = Column(DateTime, default=lambda: datetime.utcnow())
