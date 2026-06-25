package engine

import (
	"math"
	"math/rand"
)

const (
	mfgUnitOutput          = 2000  // 件/工人/季
	mfgUnitPrice           = 20.0  // 基础单价 ¥/件
	mfgLineCeiling         = 10000 // 件/产线/季
	mfgWarehouseCostRate   = 0.5   // ¥/件/季 仓储费
	mfgLaborRate           = 2500  // ¥/工人/季 工资
	mfgDemandCapMultiplier = 2.0   // 需求上限 = 产能 × 倍数
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
	ProdQty         int64   // 生产量 (件)
	SalesQty        int64   // 销售量 (件)
	Demand          int64   // 当季需求 (件)
	Revenue         int64   // 营收 (円)
	Inventory       int64   // 季末库存
	ActiveLines     int     // 使用中产线
	IdleLines       int     // 闲置产线
	BaseMaintenance int64   // 基础维护费
	OperationalCost int64   // 运营成本
	WarehouseCost   int64   // 仓储费
	LaborCost       int64   // 人工
	Profit          int64   // 净利润
}

func InitialDemand(companyID uint, employees int) int64 {
	rng := ManufacturingRNG(companyID, 0, "demand_init")

	baseDemand := float64(employees) * mfgUnitOutput
	startRatio := 0.5 + rng.Float64()*0.3 // random 50%~80%
	return int64(math.Round(baseDemand * startRatio))
}

func SettleManufacturing(
	companyID uint,
	employees int,
	capCount int,
	prevInventory int64,
	prevDemand int64,
	prosperity float64,
	quarter int,
	baseMaintenanceRate int64,
	operationalCostRate int64,
) ManufacturingResult {
	volatilityRNG := ManufacturingRNG(companyID, quarter, "volatility")
	iv := (volatilityRNG.Float64()*2 - 1) * 0.10 // ±10%

	sellingPrice := mfgUnitPrice * math.Pow(prosperity, 0.6)

	maxWorkerOutput := float64(employees) * mfgUnitOutput
	maxLineOutput := float64(capCount) * mfgLineCeiling
	prodQty := math.Min(maxWorkerOutput, maxLineOutput)

	prevD := float64(prevDemand)
	demand := prevD * (prosperity + iv)
	demandCap := (prodQty + float64(prevInventory)) * mfgDemandCapMultiplier
	if demand > demandCap {
		demand = demandCap
	}
	demandInt := int64(math.Ceil(math.Max(demand, 0)))

	linesNeeded := math.Ceil(maxWorkerOutput / mfgLineCeiling)
	activeLines := int(math.Min(linesNeeded, float64(capCount)))
	idleLines := capCount - activeLines

	salesQty := math.Min(prodQty+float64(prevInventory), float64(demandInt))

	revenue := int64(math.Round(salesQty * sellingPrice))

	inventory := float64(prevInventory) + prodQty - salesQty
	if inventory < 0 {
		inventory = 0
	}
	inventoryInt := int64(math.Round(inventory))

	baseMaintenance := int64(capCount) * baseMaintenanceRate
	operationalCost := int64(activeLines) * operationalCostRate
	warehouseCost := int64(math.Round(float64(inventoryInt) * mfgWarehouseCostRate))
	laborCost := int64(employees) * int64(mfgLaborRate)

	profit := revenue - laborCost - baseMaintenance - operationalCost - warehouseCost

	return ManufacturingResult{
		ProdQty:         int64(math.Round(prodQty)),
		SalesQty:        int64(math.Round(salesQty)),
		Demand:          demandInt,
		Revenue:         revenue,
		Inventory:       inventoryInt,
		ActiveLines:     activeLines,
		IdleLines:       idleLines,
		BaseMaintenance: baseMaintenance,
		OperationalCost: operationalCost,
		WarehouseCost:   warehouseCost,
		LaborCost:       laborCost,
		Profit:          profit,
	}
}
