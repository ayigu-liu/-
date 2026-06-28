package bots

import (
	"jjs-server/internal/config"
	"jjs-server/internal/domain"
)

func CheckStopLoss(placeOrder func(order *domain.Order) error, trader *AiTrader, stock *domain.Stock, holding *domain.Holding) bool {
	if holding == nil || holding.Qty <= 0 || holding.AvgCost <= 0 {
		return false
	}

	gainPct := float64(stock.CurrentPrice-holding.AvgCost) / float64(holding.AvgCost)
	threshold := -(config.AiTraderStopLossBase + trader.RiskTolerance*config.AiTraderStopLossScale)

	if gainPct >= threshold {
		return false
	}

	order := &domain.Order{
		StockID:  stock.ID,
		PlayerID: trader.ID,
		Type:     "market",
		Side:     "sell",
		Qty:      holding.Qty,
	}
	placeOrder(order)
	return true
}
