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
	CapAssetValue        float64
	BaseMaintenanceRate  int64
	OperationalCostRate  int64
	HireCost             float64
	LaborRate            float64

	// 营销: 每¥1投入的需求增量范围
	MarketingDemandMin float64
	MarketingDemandMax float64

	// 景气度游走参数 (中心=1.0)
	ProsperityMin        float64
	ProsperityMax        float64
	ProsperityMaxStep    float64
	ProsperityRegression float64 // 边界向心回拉的绝对步长

	// 景气度修正脉冲
	CorrectionProb  float64 // 每季度触发修正脉冲的概率 [0,1]
	CorrectionPulse float64 // 脉冲触发时向中心跳的绝对步长

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
		CapAssetValue:        50000,
		BaseMaintenanceRate:  800,
		OperationalCostRate:  1700,
		HireCost:             5000,
		LaborRate:            2000,
		MarketingDemandMin:   0,
		MarketingDemandMax:   0,
		ProsperityMin:        0.85,
		ProsperityMax:        1.15,
		ProsperityMaxStep:    0.05,
		ProsperityRegression: 0.03,
		CorrectionProb:       0.05,
		CorrectionPulse:      0.06,
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
		CapAssetValue:        200000,
		BaseMaintenanceRate:  3000,
		OperationalCostRate:  3000,
		HireCost:             3000,
		LaborRate:            3000,
		MarketingDemandMin:   0,
		MarketingDemandMax:   0,
		ProsperityMin:        0.90,
		ProsperityMax:        1.10,
		ProsperityMaxStep:    0.04,
		ProsperityRegression: 0.02,
		CorrectionProb:       0.04,
		CorrectionPulse:      0.05,
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
		CapAssetValue:        80000,
		BaseMaintenanceRate:  1000,
		OperationalCostRate:  2000,
		HireCost:             3000,
		LaborRate:            2500,
		MarketingDemandMin:   0.075,
		MarketingDemandMax:   0.175,
		ProsperityMin:        0.90,
		ProsperityMax:        1.10,
		ProsperityMaxStep:    0.04,
		ProsperityRegression: 0.02,
		CorrectionProb:       0.04,
		CorrectionPulse:      0.05,
		PriceElasticity:      0.6,
		IndividualVolatility: 0.10,
		Enabled:              true,
	},
	"mining": {
		ID:                   "mining",
		Name:                 "矿业",
		PE:                   10,
		RevPerEmployee:       35000,
		UnitOutput:           1500,
		StartingEmployees:    5,
		StartingCash:         50000,
		SharesOutstanding:    25000,
		CapUnitCeiling:       8000,
		CapBuildCost:         120000,
		CapBuildQuarters:     2,
		CapAssetValue:        2.0,
		BaseMaintenanceRate:  1,
		OperationalCostRate:  1200,
		HireCost:             3000,
		LaborRate:            2500,
		MarketingDemandMin:   0.125,
		MarketingDemandMax:   0.292,
		ProsperityMin:        0.85,
		ProsperityMax:        1.15,
		ProsperityMaxStep:    0.05,
		ProsperityRegression: 0.03,
		CorrectionProb:       0.05,
		CorrectionPulse:      0.06,
		PriceElasticity:      1.2,
		IndividualVolatility: 0.10,
		Enabled:              true,
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
		CapAssetValue:        60000,
		BaseMaintenanceRate:  1500,
		OperationalCostRate:  1500,
		HireCost:             3000,
		LaborRate:            2500,
		MarketingDemandMin:   0,
		MarketingDemandMax:   0,
		ProsperityMin:        0.94,
		ProsperityMax:        1.06,
		ProsperityMaxStep:    0.03,
		ProsperityRegression: 0.01,
		CorrectionProb:       0.03,
		CorrectionPulse:      0.03,
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
		CapAssetValue:        150000,
		BaseMaintenanceRate:  2000,
		OperationalCostRate:  3000,
		HireCost:             3000,
		LaborRate:            3000,
		MarketingDemandMin:   0,
		MarketingDemandMax:   0,
		ProsperityMin:        0.94,
		ProsperityMax:        1.06,
		ProsperityMaxStep:    0.03,
		ProsperityRegression: 0.01,
		CorrectionProb:       0.03,
		CorrectionPulse:      0.03,
		PriceElasticity:      0.3,
		IndividualVolatility: 0.10,
		Enabled:              false,
	},
}
