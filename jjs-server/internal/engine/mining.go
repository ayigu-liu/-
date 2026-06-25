package engine

import (
	"math"
	"math/rand"
)

const (
	miningUnitPrice           = 12.0
	miningUnitOutput          = 1500
	miningWarehouseCostRate   = 0.3
	miningLaborRate           = 2500
	miningOperationalPerHead  = 1200
	miningMaintenanceDivisor  = 100
	MiningInitialReserves     = 50000
	miningDemandCapMultiplier = 2.0 // 需求上限 = 产能 × 倍数
)

func ProspectOreReserves(rng *rand.Rand) int64 {
	roll := rng.Float64()
	var lo, hi float64
	switch {
	case roll < 0.70:
		lo, hi = 20000, 60000
	case roll < 0.90:
		lo, hi = 65000, 110000
	default:
		lo, hi = 110000, 180000
	}
	return int64(math.Round(lo + rng.Float64()*(hi-lo)))
}

type MiningResult struct {
	ProdQty         int64
	SalesQty        int64
	Demand          int64
	Revenue         int64
	Inventory       int64
	OreConsumed     int64
	OreRemaining    int
	BaseMaintenance int64
	OperationalCost int64
	WarehouseCost   int64
	LaborCost       int64
	Profit          int64
}

func MiningRNG(companyID uint, quarter int, aspect string, idx int) *rand.Rand {
	aspects := map[string]int64{
		"volatility":  1,
		"demand_init": 2,
		"prospect":    3,
		"marketing":   4,
	}
	seed := int64(companyID)*1_000_000 + int64(quarter)*100 + aspects[aspect] + int64(idx)
	return rand.New(rand.NewSource(seed))
}

func InitialMiningDemand(companyID uint, employees int) int64 {
	rng := MiningRNG(companyID, 0, "demand_init", 0)
	baseDemand := float64(employees) * miningUnitOutput
	startRatio := 0.5 + rng.Float64()*0.3
	return int64(math.Round(baseDemand * startRatio))
}

func SellMining(
	companyID uint,
	employees int,
	capCount int,
	prevInventory int64,
	prevDemand int64,
	prosperity float64,
	quarter int,
	baseMaintenanceRate int64,
	operationalCostRate int64,
) MiningResult {
	volatilityRNG := MiningRNG(companyID, quarter, "volatility", 0)
	iv := (volatilityRNG.Float64()*2 - 1) * 0.10

	sellingPrice := miningUnitPrice * math.Pow(prosperity, 1.2)

	workerOutput := float64(employees) * miningUnitOutput
	maxProduction := math.Ceil(float64(capCount) * 0.2)
	prodQty := math.Min(workerOutput, maxProduction)

	prevD := float64(prevDemand)
	demand := prevD * (prosperity + iv)
	demandCap := (prodQty + float64(prevInventory)) * miningDemandCapMultiplier
	if demand > demandCap {
		demand = demandCap
	}
	demandInt := int64(math.Ceil(math.Max(demand, 0)))

	salesQty := math.Min(prodQty+float64(prevInventory), float64(demandInt))

	revenue := int64(math.Round(salesQty * sellingPrice))

	inventory := float64(prevInventory) + prodQty - salesQty
	if inventory < 0 {
		inventory = 0
	}
	inventoryInt := int64(math.Round(inventory))

	oreRemaining := capCount - int(prodQty)
	if oreRemaining < 0 {
		oreRemaining = 0
	}

	baseMaintenance := int64(math.Round(float64(capCount) / float64(miningMaintenanceDivisor) * float64(baseMaintenanceRate)))

	workersNeeded := math.Ceil(math.Min(maxProduction/miningUnitOutput, float64(employees)))
	operationalCost := int64(workersNeeded) * operationalCostRate

	warehouseCost := int64(math.Round(float64(inventoryInt) * miningWarehouseCostRate))
	laborCost := int64(employees) * int64(miningLaborRate)

	profit := revenue - laborCost - baseMaintenance - operationalCost - warehouseCost

	return MiningResult{
		ProdQty:         int64(prodQty),
		SalesQty:        int64(salesQty),
		Demand:          demandInt,
		Revenue:         revenue,
		Inventory:       inventoryInt,
		OreConsumed:     int64(prodQty),
		OreRemaining:    oreRemaining,
		BaseMaintenance: baseMaintenance,
		OperationalCost: operationalCost,
		WarehouseCost:   warehouseCost,
		LaborCost:       laborCost,
		Profit:          profit,
	}
}
