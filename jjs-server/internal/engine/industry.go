package engine

type IndustryConfig struct {
	ID                string
	Name              string
	PE                float64
	RevPerEmployee    float64
	StartingEmployees int
	StartingCash      float64
	SharesOutstanding int
	CapUnitCeiling    float64
	CapBuildCost      float64
	CapBuildQuarters  int
	CapSpecial        string
	SludgeType        string
	SludgePenalty     float64
	HireCost          float64
}

var Industries = map[string]IndustryConfig{
	"tech": {
		ID:                "tech",
		Name:              "科技",
		PE:                25,
		RevPerEmployee:    40000,
		StartingEmployees: 3,
		StartingCash:      20000,
		SharesOutstanding: 10000,
		CapUnitCeiling:    5000,
		CapBuildCost:      50000,
		CapBuildQuarters:  0,
		CapSpecial:        "depreciate_30pct_5q",
		SludgeType:        "computed",
		SludgePenalty:     10,
		HireCost:          5000,
	},
	"finance": {
		ID:                "finance",
		Name:              "金融",
		PE:                12,
		RevPerEmployee:    50000,
		StartingEmployees: 3,
		StartingCash:      50000,
		SharesOutstanding: 15000,
		CapUnitCeiling:    10_000_000,
		CapBuildCost:      200000,
		CapBuildQuarters:  3,
		CapSpecial:        "",
		SludgeType:        "computed",
		SludgePenalty:     0.005,
		HireCost:          3000,
	},
	"manufacturing": {
		ID:                "manufacturing",
		Name:              "制造",
		PE:                12,
		RevPerEmployee:    30000,
		StartingEmployees: 5,
		StartingCash:      30000,
		SharesOutstanding: 20000,
		CapUnitCeiling:    10000,
		CapBuildCost:      80000,
		CapBuildQuarters:  1,
		CapSpecial:        "",
		SludgeType:        "inventory",
		SludgePenalty:     0.5,
		HireCost:          3000,
	},
	"energy": {
		ID:                "energy",
		Name:              "能源",
		PE:                10,
		RevPerEmployee:    35000,
		StartingEmployees: 5,
		StartingCash:      50000,
		SharesOutstanding: 25000,
		CapUnitCeiling:    8000,
		CapBuildCost:      120000,
		CapBuildQuarters:  2,
		CapSpecial:        "deplete_20q",
		SludgeType:        "inventory",
		SludgePenalty:     0.3,
		HireCost:          3000,
	},
	"consumer": {
		ID:                "consumer",
		Name:              "消费",
		PE:                20,
		RevPerEmployee:    35000,
		StartingEmployees: 3,
		StartingCash:      15000,
		SharesOutstanding: 12000,
		CapUnitCeiling:    800,
		CapBuildCost:      60000,
		CapBuildQuarters:  1,
		CapSpecial:        "",
		SludgeType:        "cooldown",
		SludgePenalty:     0.15,
		HireCost:          3000,
	},
	"healthcare": {
		ID:                "healthcare",
		Name:              "医疗",
		PE:                30,
		RevPerEmployee:    50000,
		StartingEmployees: 3,
		StartingCash:      40000,
		SharesOutstanding: 8000,
		CapUnitCeiling:    3,
		CapBuildCost:      150000,
		CapBuildQuarters:  2,
		CapSpecial:        "random_output",
		SludgeType:        "cooldown",
		SludgePenalty:     1,
		HireCost:          3000,
	},
}
