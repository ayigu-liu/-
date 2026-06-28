package bots

import (
	"math"
	"math/rand"

	"jjs-server/internal/domain"
)

type FactorContext struct {
	Stock          *domain.Stock
	Company        *domain.Company
	Quarters       []domain.CompanyQuarterly
	IndustryPE     float64
	Prosperity     float64
	RecentPrices   []int64
	MA5, MA20      int64
	AvgVolume      int64
	GlobalAvgVol   int64
	Holding        *domain.Holding
	PlayerState    *domain.PlayerState
	CapAssetValue  float64
}

type FactorFunc func(ctx *FactorContext) float64

var factorRegistry = map[string]FactorFunc{
	"pe_discount":    fPeDiscount,
	"eps_growth":     fEpsGrowth,
	"nav_discount":   fNavDiscount,
	"revenue_growth": fRevenueGrowth,
	"profit_margin":  fProfitMargin,
	"prosperity":     fProsperity,
	"chase":          fChase,
	"panic":          fPanic,
	"vertigo":        fVertigo,
	"stubborn":       fStubborn,
	"herd":           fHerd,
	"noise":          fNoise,
}

func fPeDiscount(ctx *FactorContext) float64 {
	if ctx.IndustryPE <= 0 || ctx.Stock.CurrentPrice <= 0 {
		return 0
	}
	n := len(ctx.Quarters)
	if n < 4 {
		n = 4
	}
	profits := make([]int64, 0, 4)
	for i := 0; i < len(ctx.Quarters) && len(profits) < 4; i++ {
		profits = append(profits, ctx.Quarters[i].Profit)
	}
	if len(profits) == 0 {
		return 0
	}
	totalProfit := int64(0)
	shares := int64(0)
	for _, q := range profits {
		totalProfit += q
	}
	for i := 0; i < len(ctx.Quarters) && i < 4; i++ {
		if ctx.Quarters[i].TotalShares > 0 {
			shares = ctx.Quarters[i].TotalShares
			break
		}
	}
	if shares <= 0 {
		return 0
	}
	annualEPS := float64(totalProfit) / float64(shares)
	if annualEPS <= 0 {
		return -1
	}
	currentPE := float64(ctx.Stock.CurrentPrice) / annualEPS
	return clamp((ctx.IndustryPE-currentPE)/ctx.IndustryPE, -1, 1)
}

func fEpsGrowth(ctx *FactorContext) float64 {
	if len(ctx.Quarters) < 8 {
		return 0
	}
	recent := avgEPS(ctx.Quarters[0:4])
	older := avgEPS(ctx.Quarters[4:8])
	if older <= 0 {
		return 0
	}
	return clamp((recent-older)/math.Max(older, 1), -1, 1)
}

func fNavDiscount(ctx *FactorContext) float64 {
	if ctx.Stock.CurrentPrice <= 0 {
		return 0
	}
	nav := float64(ctx.Company.Cash) + float64(ctx.Company.CapCount)*ctx.CapAssetValue
	shares := int64(ctx.Company.TotalShares)
	if shares <= 0 {
		return 0
	}
	navPerShare := nav / float64(shares)
	if navPerShare <= 0 {
		return 0
	}
	return clamp((navPerShare-float64(ctx.Stock.CurrentPrice))/navPerShare, -1, 1)
}

func fRevenueGrowth(ctx *FactorContext) float64 {
	if len(ctx.Quarters) < 8 {
		return 0
	}
	recent := avgRevenue(ctx.Quarters[0:4])
	older := avgRevenue(ctx.Quarters[4:8])
	if older <= 0 {
		return 0
	}
	return clamp((recent-older)/math.Max(older, 1), -1, 1)
}

func fProfitMargin(ctx *FactorContext) float64 {
	if len(ctx.Quarters) < 4 {
		return 0
	}
	q4 := ctx.Quarters[0:4]
	totalRevenue := float64(0)
	totalCost := float64(0)
	count := 0
	for _, q := range q4 {
		if q.Revenue > 0 {
			totalRevenue += float64(q.Revenue)
			totalCost += float64(q.TotalCost)
			count++
		}
	}
	if count == 0 || totalRevenue <= 0 {
		return 0
	}
	margin := (totalRevenue - totalCost) / totalRevenue
	industryMargin := 0.15
	return clamp((margin-industryMargin)/math.Max(industryMargin, 0.01), -1, 1)
}

func fProsperity(ctx *FactorContext) float64 {
	return clamp((ctx.Prosperity-1.0)*2, -1, 1)
}

func fChase(ctx *FactorContext) float64 {
	if len(ctx.RecentPrices) < 10 {
		return 0
	}
	oldest := ctx.RecentPrices[len(ctx.RecentPrices)-1]
	current := ctx.RecentPrices[0]
	if oldest <= 0 {
		return 0
	}
	change := float64(current-oldest) / float64(oldest)
	return clamp(change/0.05, -1, 1)
}

func fPanic(ctx *FactorContext) float64 {
	if len(ctx.RecentPrices) < 10 {
		return 0
	}
	oldest := ctx.RecentPrices[len(ctx.RecentPrices)-1]
	current := ctx.RecentPrices[0]
	if oldest <= 0 {
		return 0
	}
	change := float64(current-oldest) / float64(oldest)
	return clamp(-change/0.05, -1, 1)
}

func fVertigo(ctx *FactorContext) float64 {
	if ctx.Holding == nil || ctx.Holding.Qty <= 0 || ctx.Holding.AvgCost <= 0 {
		return 0
	}
	gain := float64(ctx.Stock.CurrentPrice-ctx.Holding.AvgCost) / float64(ctx.Holding.AvgCost)
	if gain <= 0.3 {
		return 0
	}
	return clamp((gain-0.3)/0.7, 0, 1)
}

func fStubborn(ctx *FactorContext) float64 {
	if ctx.Holding == nil || ctx.Holding.Qty <= 0 || ctx.Holding.AvgCost <= 0 {
		return 0
	}
	loss := float64(ctx.Holding.AvgCost-ctx.Stock.CurrentPrice) / float64(ctx.Holding.AvgCost)
	if loss <= 0.3 {
		return 0
	}
	return clamp((loss-0.3)/0.7, 0, 1)
}

func fHerd(ctx *FactorContext) float64 {
	if ctx.GlobalAvgVol <= 0 {
		return 0
	}
	return clamp(float64(ctx.AvgVolume-ctx.GlobalAvgVol)/float64(ctx.GlobalAvgVol), -1, 1)
}

func fNoise(ctx *FactorContext) float64 {
	return rand.Float64()*2 - 1
}

func ComputeRawSignal(ctx *FactorContext, s *Strategy) float64 {
	signal := 0.0
	for name, weight := range s.Weights {
		fn, ok := factorRegistry[name]
		if !ok {
			continue
		}
		signal += fn(ctx) * weight
	}
	return clamp(signal, -1, 1)
}

func avgEPS(quarters []domain.CompanyQuarterly) float64 {
	if len(quarters) == 0 {
		return 0
	}
	totalProfit := int64(0)
	shares := int64(0)
	for _, q := range quarters {
		totalProfit += q.Profit
		if q.TotalShares > 0 {
			shares = q.TotalShares
		}
	}
	if shares <= 0 {
		return 0
	}
	return float64(totalProfit) / float64(len(quarters)) / float64(shares)
}

func avgRevenue(quarters []domain.CompanyQuarterly) float64 {
	if len(quarters) == 0 {
		return 0
	}
	total := int64(0)
	for _, q := range quarters {
		total += q.Revenue
	}
	return float64(total) / float64(len(quarters))
}
