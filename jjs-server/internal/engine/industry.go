package engine

type IndustryConfig struct {
	ID                   string
	Name                 string
	PE                   float64
	RevPerEmployee       float64
	UnitOutput           float64
	StartingEmployees    int
	StartingCash         float64
	SharesOutstanding    int
	CapUnitCeiling       float64
	CapBuildCost         float64
	CapBuildQuarters     int
	CapSpecial           string
	CapMaintenanceActive float64
	CapMaintenanceIdle   float64
	HireCost             float64

	// 景气度游走参数 (中心=1.0)
	ProsperityMin          float64
	ProsperityMax          float64
	ProsperityMaxStep      float64
	ProsperityRegression   float64

	// 景气度 → 价格传导
	PriceElasticity float64

	// 公司个体波动 (±)
	IndividualVolatility float64

	Enabled bool
}

func EnabledIndustries() []string {
	var ids []string
	for id, ind := range Industries {
		if ind.Enabled {
			ids = append(ids, id)
		}
	}
	return ids
}

var Industries = map[string]IndustryConfig{
	"tech": {
		ID:                   "tech",
		Name:                 "科技",
		PE:                   25,
		RevPerEmployee:       40000,
		UnitOutput:           0,
		StartingEmployees:    3,
		StartingCash:         20000,
		SharesOutstanding:    10000,
		CapUnitCeiling:       5000,
		CapBuildCost:         50000,
		CapBuildQuarters:     0,
		CapSpecial:           "depreciate_30pct_5q",
		CapMaintenanceActive: 2500,
		CapMaintenanceIdle:   800,
		HireCost:             5000,
		ProsperityMin:        0.65,
		ProsperityMax:        1.35,
		ProsperityMaxStep:    0.09,
		ProsperityRegression: 0.06,
		PriceElasticity:      0.2,
		IndividualVolatility: 0.10,
		Enabled:              false,
	},
	"finance": {
		ID:                   "finance",
		Name:                 "金融",
		PE:                   12,
		RevPerEmployee:       50000,
		UnitOutput:           0,
		StartingEmployees:    3,
		StartingCash:         50000,
		SharesOutstanding:    15000,
		CapUnitCeiling:       10_000_000,
		CapBuildCost:         200000,
		CapBuildQuarters:     3,
		CapSpecial:           "",
		CapMaintenanceActive: 6000,
		CapMaintenanceIdle:   3000,
		HireCost:             3000,
		ProsperityMin:        0.75,
		ProsperityMax:        1.25,
		ProsperityMaxStep:    0.06,
		ProsperityRegression: 0.12,
		PriceElasticity:      0.4,
		IndividualVolatility: 0.10,
		Enabled:              false,
	},
	"manufacturing": {
		ID:                   "manufacturing",
		Name:                 "制造",
		PE:                   12,
		RevPerEmployee:       40000,
		UnitOutput:           2000,
		StartingEmployees:    5,
		StartingCash:         30000,
		SharesOutstanding:    20000,
		CapUnitCeiling:       10000,
		CapBuildCost:         80000,
		CapBuildQuarters:     1,
		CapSpecial:           "",
		CapMaintenanceActive: 3000,
		CapMaintenanceIdle:   1000,
		HireCost:             3000,
		ProsperityMin:        0.80,
		ProsperityMax:        1.20,
		ProsperityMaxStep:    0.05,
		ProsperityRegression: 0.15,
		PriceElasticity:      0.6,
		IndividualVolatility: 0.10,
		Enabled:              true,
	},
	"energy": {
		ID:                   "energy",
		Name:                 "能源",
		PE:                   10,
		RevPerEmployee:       35000,
		UnitOutput:           1500,
		StartingEmployees:    5,
		StartingCash:         50000,
		SharesOutstanding:    25000,
		CapUnitCeiling:       8000,
		CapBuildCost:         120000,
		CapBuildQuarters:     2,
		CapSpecial:           "deplete_20q",
		CapMaintenanceActive: 4000,
		CapMaintenanceIdle:   1500,
		HireCost:             3000,
		ProsperityMin:        0.72,
		ProsperityMax:        1.28,
		ProsperityMaxStep:    0.07,
		ProsperityRegression: 0.10,
		PriceElasticity:      1.2,
		IndividualVolatility: 0.10,
		Enabled:              false,
	},
	"consumer": {
		ID:                   "consumer",
		Name:                 "消费",
		PE:                   20,
		RevPerEmployee:       35000,
		UnitOutput:           0,
		StartingEmployees:    3,
		StartingCash:         15000,
		SharesOutstanding:    12000,
		CapUnitCeiling:       800,
		CapBuildCost:         60000,
		CapBuildQuarters:     1,
		CapSpecial:           "",
		CapMaintenanceActive: 3000,
		CapMaintenanceIdle:   1500,
		HireCost:             3000,
		ProsperityMin:        0.88,
		ProsperityMax:        1.12,
		ProsperityMaxStep:    0.04,
		ProsperityRegression: 0.20,
		PriceElasticity:      0.5,
		IndividualVolatility: 0.10,
		Enabled:              false,
	},
	"healthcare": {
		ID:                   "healthcare",
		Name:                 "医疗",
		PE:                   30,
		RevPerEmployee:       50000,
		UnitOutput:           0,
		StartingEmployees:    3,
		StartingCash:         40000,
		SharesOutstanding:    8000,
		CapUnitCeiling:       3,
		CapBuildCost:         150000,
		CapBuildQuarters:     2,
		CapSpecial:           "random_output",
		CapMaintenanceActive: 5000,
		CapMaintenanceIdle:   2000,
		HireCost:             3000,
		ProsperityMin:        0.88,
		ProsperityMax:        1.16,
		ProsperityMaxStep:    0.04,
		ProsperityRegression: 0.25,
		PriceElasticity:      0.3,
		IndividualVolatility: 0.10,
		Enabled:              false,
	},
}
