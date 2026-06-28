package bots

import (
	"math"
	"math/rand"
	"sync"

	"jjs-server/internal/config"
	"jjs-server/internal/domain"
)

type BotMetrics struct {
	mu              sync.Mutex
	TotalSignals    int64
	TotalOrders     int64
	BuyOrders       int64
	SellOrders      int64
	StopLossExits   int64
	ActiveTraders   int
	DepletedTraders int
}

func (m *BotMetrics) Snapshot() map[string]interface{} {
	m.mu.Lock()
	defer m.mu.Unlock()
	return map[string]interface{}{
		"total_signals":     m.TotalSignals,
		"total_orders":      m.TotalOrders,
		"buy_orders":        m.BuyOrders,
		"sell_orders":       m.SellOrders,
		"stop_loss_exits":   m.StopLossExits,
		"active_traders":    m.ActiveTraders,
		"depleted_traders":  m.DepletedTraders,
	}
}

func (m *BotMetrics) RecordSignal()       { m.mu.Lock(); m.TotalSignals++; m.mu.Unlock() }
func (m *BotMetrics) RecordOrder(side string) {
	m.mu.Lock()
	m.TotalOrders++
	if side == "buy" {
		m.BuyOrders++
	} else {
		m.SellOrders++
	}
	m.mu.Unlock()
}
func (m *BotMetrics) RecordStopLoss() { m.mu.Lock(); m.StopLossExits++; m.mu.Unlock() }
func (m *BotMetrics) SetTraders(active, depleted int) {
	m.mu.Lock()
	m.ActiveTraders = active
	m.DepletedTraders = depleted
	m.mu.Unlock()
}

type StockRef struct {
	ID           uint
	CurrentPrice int64
}

type TraderStats struct {
	ID           string  `json:"id"`
	Strategy     string  `json:"strategy"`
	Cash         int64   `json:"cash"`
	FrozenCash   int64   `json:"frozen_cash"`
	HoldingValue int64   `json:"holding_value"`
	RiskTolerance float64 `json:"risk_tolerance"`
}

func GatherTraderStats(traders []*AiTrader, stocksByID map[uint]*domain.Stock) []TraderStats {
	psCache := sync.Map{}
	stats := make([]TraderStats, 0, len(traders))

	for _, t := range traders {
		psV, _ := psCache.LoadOrStore(t.ID, mustGetPs(t.ID))
		ps, _ := psV.(*domain.PlayerState)
		if ps == nil {
			continue
		}
		holdings, _ := mustGetHoldings(t.ID)
		holdingValue := int64(0)
		for _, h := range holdings {
			if s, ok := stocksByID[h.StockID]; ok {
				holdingValue += s.CurrentPrice * h.Qty
			}
		}
		stats = append(stats, TraderStats{
			ID:           t.ID,
			Strategy:     t.Strategy.Name,
			Cash:         ps.Cash,
			FrozenCash:   ps.FrozenCash,
			HoldingValue: holdingValue,
			RiskTolerance: t.RiskTolerance,
		})
	}
	return stats
}

type OrderPlacer func(order *domain.Order) error

func computeOrder(trader *AiTrader, stock *domain.Stock, signal float64) *domain.Order {
	absSignal := math.Abs(signal)
	if absSignal <= config.AiTraderSignalThreshold {
		return nil
	}

	ps, err := mustGetPlayerState(trader.ID)
	if err != nil || ps == nil {
		return nil
	}

	orderType := "limit"
	if absSignal > config.AiTraderMarketOrderThreshold {
		orderType = "market"
	}

	if signal > 0 {
		return buildBuyOrder(trader, stock, ps, absSignal, orderType)
	}
	return buildSellOrder(trader, stock, ps, absSignal, orderType)
}

func buildBuyOrder(trader *AiTrader, stock *domain.Stock, ps *domain.PlayerState, absSignal float64, orderType string) *domain.Order {
	availableCash := ps.Cash - ps.FrozenCash
	if availableCash <= 0 {
		return nil
	}

	basePrice := float64(stock.CurrentPrice)
	price := int64(0)
	if orderType == "limit" {
		maxPremium := absSignal * config.AiTraderMaxSpread
		maxDiscount := (1 - absSignal) * config.AiTraderMaxSpread
		factor := (1 - maxDiscount) + rand.Float64()*(maxDiscount+maxPremium)
		price = int64(basePrice * factor)
		if price < 1 {
			price = 1
		}
	}

	refPrice := price
	if orderType == "market" || refPrice <= 0 {
		refPrice = stock.CurrentPrice
	}

	maxSpend := int64(float64(availableCash) * trader.RiskTolerance * absSignal)
	qty := maxSpend / refPrice
	if qty < 100 {
		return nil
	}
	if qty > config.MaxOrderQty {
		qty = config.MaxOrderQty
	}

	return &domain.Order{
		StockID:  stock.ID,
		PlayerID: trader.ID,
		Type:     orderType,
		Side:     "buy",
		Price:    price,
		Qty:      qty,
	}
}

func buildSellOrder(trader *AiTrader, stock *domain.Stock, ps *domain.PlayerState, absSignal float64, orderType string) *domain.Order {
	holdings, _ := mustGetHoldings(trader.ID)
	var holding *domain.Holding
	for i := range holdings {
		if holdings[i].StockID == stock.ID {
			holding = &holdings[i]
			break
		}
	}
	if holding == nil || holding.Qty-holding.FrozenQty < 100 {
		return nil
	}

	availableQty := holding.Qty - holding.FrozenQty
	maxSell := int64(float64(availableQty) * trader.RiskTolerance * absSignal)
	if maxSell < 100 {
		return nil
	}
	if maxSell > config.MaxOrderQty {
		maxSell = config.MaxOrderQty
	}

	basePrice := float64(stock.CurrentPrice)
	price := int64(0)
	if orderType == "limit" {
		maxDiscount := absSignal * config.AiTraderMaxSpread
		maxPremium := (1 - absSignal) * config.AiTraderMaxSpread
		factor := (1 - maxDiscount) + rand.Float64()*(maxDiscount+maxPremium)
		price = int64(basePrice * factor)
		if price < 1 {
			price = 1
		}
	}

	return &domain.Order{
		StockID:  stock.ID,
		PlayerID: trader.ID,
		Type:     orderType,
		Side:     "sell",
		Price:    price,
		Qty:      maxSell,
	}
}
