"""Industry configuration: names, descriptions, startup params, benchmarks.
Single source of truth — all other modules import from here."""

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
INDUSTRY_STARTUP = {
    "tech":        {"cash": 50000, "assets": 50000, "employees": 8,  "price": 5, "shares": 2_000_000,  "desc": "轻资产高估值，研发驱动"},
    "finance":     {"cash": 100000, "assets": 150000, "employees": 12, "price": 4, "shares": 3_000_000, "desc": "资金密集型，监管严格"},
    "manufacturing":{"cash": 80000, "assets": 120000, "employees": 20, "price": 3,  "shares": 5_000_000, "desc": "重资产劳动密集，规模效应"},
    "energy":      {"cash": 120000, "assets": 200000, "employees": 15, "price": 5, "shares": 4_000_000, "desc": "资源依赖，政策敏感"},
    "consumer":    {"cash": 40000, "assets": 50000, "employees": 10, "price": 3,  "shares": 3_000_000, "desc": "现金流稳定，防御性强"},
    "healthcare":  {"cash": 100000, "assets": 80000, "employees": 10, "price": 6, "shares": 2_000_000,  "desc": "高毛利，研发投入大"},
}
INDUSTRY_BENCHMARKS = {
    "tech":        {"rev": 1600, "cost": 1200, "trend": 1.08, "desc": "人均产出高，薪资高"},
    "finance":     {"rev": 1400, "cost": 1100, "trend": 1.04, "desc": "人均中等偏高，运营成本高"},
    "manufacturing":{"rev": 1000, "cost": 900, "trend": 1.03, "desc": "人均产出低，劳动密集"},
    "energy":      {"rev": 1200, "cost": 1100, "trend": 1.02, "desc": "人均资源产出高，设备成本高"},
    "consumer":    {"rev": 900, "cost": 700, "trend": 1.05, "desc": "薄利多销，成本控制好"},
    "healthcare":  {"rev": 1500, "cost": 900, "trend": 1.06, "desc": "高附加值，高毛利"},
}
SYMBOL_PREFIXES = {
    "tech": "TK", "finance": "FI", "manufacturing": "MF",
    "energy": "EN", "consumer": "CS", "healthcare": "YL",
}
