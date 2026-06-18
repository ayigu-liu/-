package engine

import (
	"math"
	"math/rand"
)

const (
	mfgUnitOutput        = 2000  // 件/工人/季
	mfgUnitPrice         = 20.0  // 基础单价 ¥/件
	mfgLineCeiling       = 10000 // 件/产线/季
	mfgWarehouseCostRate = 0.5   // ¥/件/季 仓储费
	mfgLaborRate         = 2500  // ¥/工人/季 工资
	mfgMarketingMin      = 1500  // 营销效果下限 (件)
	mfgMarketingMax      = 3500  // 营销效果上限 (件)
)

func CapacityCeiling(industry string, capCount int) int64 {
	if industry == "manufacturing" {
		return int64(capCount) * mfgLineCeiling
	}
	return 0
}

func ActualOutput(industry string, employees int) int64 {
	if industry == "manufacturing" {
		return int64(employees) * mfgUnitOutput
	}
	return 0
}

func ManufacturingRNG(companyID uint, quarter int, aspect string) *rand.Rand {
	aspects := map[string]int64{
		"volatility":  1,
		"marketing":   2,
		"demand_init": 3,
	}
	seed := int64(companyID)*1_000_000 + int64(quarter)*100 + aspects[aspect]
	return rand.New(rand.NewSource(seed))
}

type ManufacturingResult struct {
	ProdQty       float64 // 生产量 (件)
	SalesQty      float64 // 销售量 (件)
	Demand        float64 // 当季需求 (件)
	Revenue       float64 // 营收
	Inventory     int64   // 季末库存
	ActiveLines   int     // 使用中产线
	IdleLines     int     // 闲置产线
	Maintenance   float64 // 维护费
	WarehouseCost float64 // 仓储费
	LaborCost     float64 // 人工
	Profit        float64 // 净利润
}

func InitialDemand(companyID uint, employees int) float64 {
	rng := ManufacturingRNG(companyID, 0, "demand_init")

	baseDemand := float64(employees) * mfgUnitOutput
	startRatio := 0.5 + rng.Float64()*0.3 // random 50%~80%
	return math.Round(baseDemand*startRatio*100) / 100
}

func SettleManufacturing(
	companyID uint,
	employees int,
	capCount int,
	prevInventory int64,
	prevDemand float64,
	prosperity float64,
	quarter int,
	marketing bool,
	capMaintenanceActive float64,
	capMaintenanceIdle float64,
) ManufacturingResult {
	volatilityRNG := ManufacturingRNG(companyID, quarter, "volatility")
	iv := (volatilityRNG.Float64()*2 - 1) * 0.10 // ±10%

	// 销售单价
	sellingPrice := mfgUnitPrice * math.Pow(prosperity, 0.6)

	// 当季需求: 上季需求 × (景气度 + 个体波动) + 营销
	demand := prevDemand * (prosperity + iv)

	if marketing {
		marketingRNG := ManufacturingRNG(companyID, quarter, "marketing")
		marketingEffect := marketingRNG.Float64()*(mfgMarketingMax-mfgMarketingMin) + mfgMarketingMin
		demand += marketingEffect
	}
	demand = math.Round(math.Max(demand, 0)*100) / 100

	// 生产量
	maxWorkerOutput := float64(employees) * mfgUnitOutput
	maxLineOutput := float64(capCount) * mfgLineCeiling
	prodQty := math.Min(maxWorkerOutput, maxLineOutput)

	// 确定使用中/闲置产线
	linesNeeded := math.Ceil(maxWorkerOutput / mfgLineCeiling)
	activeLines := int(math.Min(linesNeeded, float64(capCount)))
	idleLines := capCount - activeLines

	// 销售量: 先清库存再售新品
	salesQty := math.Min(prodQty+float64(prevInventory), demand)

	// 营收
	revenue := math.Round(salesQty*sellingPrice*100) / 100

	// 季末库存
	inventory := float64(prevInventory) + prodQty - salesQty
	if inventory < 0 {
		inventory = 0
	}
	inventory = math.Round(inventory*100) / 100

	// 维护费
	maintenance := float64(activeLines)*capMaintenanceActive + float64(idleLines)*capMaintenanceIdle

	// 仓储费
	warehouseCost := math.Round(inventory*mfgWarehouseCostRate*100) / 100

	// 人工
	laborCost := float64(employees) * mfgLaborRate

	// 净利润
	profit := revenue - laborCost - maintenance - warehouseCost

	return ManufacturingResult{
		ProdQty:       math.Round(prodQty*100) / 100,
		SalesQty:      math.Round(salesQty*100) / 100,
		Demand:        demand,
		Revenue:       revenue,
		Inventory:     int64(math.Round(inventory)),
		ActiveLines:   activeLines,
		IdleLines:     idleLines,
		Maintenance:   math.Round(maintenance*100) / 100,
		WarehouseCost: warehouseCost,
		LaborCost:     laborCost,
		Profit:        math.Round(profit*100) / 100,
	}
}
