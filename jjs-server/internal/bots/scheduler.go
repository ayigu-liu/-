package bots

import (
	"log/slog"
	"math"
	"math/rand"
	"sync"
	"time"

	"gorm.io/gorm"

	"jjs-server/internal/config"
	"jjs-server/internal/domain"
	"jjs-server/internal/engine"
	"jjs-server/internal/store"
)

type Scheduler struct {
	traders    []*AiTrader
	mu         sync.Mutex
	sentiment  *MarketSentiment
	metrics    *BotMetrics
	tickCount  int64
	PlaceOrder func(order *domain.Order) error
}

func NewScheduler(traders []*AiTrader) *Scheduler {
	return &Scheduler{
		traders:   traders,
		sentiment: NewMarketSentiment(),
		metrics:   &BotMetrics{},
	}
}

func (s *Scheduler) ScheduleTick(db *gorm.DB) {
	start := time.Now()
	s.tickCount++

	s.mu.Lock()
	var ready []*AiTrader
	for _, t := range s.traders {
		if t.CoolDownLeft > 0 {
			t.CoolDownLeft--
		}
		if t.CoolDownLeft == 0 {
			ready = append(ready, t)
		}
	}
	s.mu.Unlock()

	if len(ready) == 0 {
		return
	}

	stocks, err := store.ListStocks()
	if err != nil || len(stocks) == 0 {
		return
	}

	companies, err := store.GetActiveCompanies()
	if err != nil {
		return
	}
	companyByID := make(map[uint]*domain.Company, len(companies))
	companyIDs := make([]uint, 0, len(companies))
	for i := range companies {
		companyByID[companies[i].ID] = &companies[i]
		companyIDs = append(companyIDs, companies[i].ID)
	}

	prosperityCache := make(map[string]float64)
	var prospMu sync.Mutex

	quarterlies, _ := store.GetQuarterliesByCompanyIDs(companyIDs, 8)

	priceHistAll, _ := store.GetRecentClosePricesAll(20)
	volHistAll, _ := store.GetRecentVolumesAll(20)

	globalAvgVolume := int64(0)
	totalStocks := 0
	for _, vols := range volHistAll {
		sum := int64(0)
		count := 0
		for _, v := range vols {
			sum += v
			count++
		}
		if count > 0 {
			globalAvgVolume += sum / int64(count)
			totalStocks++
		}
	}
	if totalStocks > 0 {
		globalAvgVolume /= int64(totalStocks)
	}

	stockByID := make(map[uint]*domain.Stock, len(stocks))
	activeStocks := make([]*domain.Stock, 0, len(stocks))
	for i := range stocks {
		if stocks[i].CurrentPrice > 0 {
			stockByID[stocks[i].ID] = &stocks[i]
			activeStocks = append(activeStocks, &stocks[i])
		}
	}

	if len(activeStocks) == 0 {
		return
	}

	var allSignals []float64
	depleted := 0
	for _, trader := range ready {
		openOrders, _ := store.GetOpenOrdersByPlayer(trader.ID)
		for _, o := range openOrders {
			s, ok := stockByID[o.StockID]
			if !ok || s.CurrentPrice <= 0 {
				engine.CancelOrder(db, o.ID, trader.ID)
				continue
			}
			if time.Since(o.CreatedAt) > config.AiTraderCancelMaxAge {
				engine.CancelOrder(db, o.ID, trader.ID)
				continue
			}
			if o.Side == "buy" {
				gap := float64(s.CurrentPrice-o.Price) / float64(s.CurrentPrice)
				if gap > config.AiTraderCancelDevThreshold {
					engine.CancelOrder(db, o.ID, trader.ID)
				}
			} else {
				gap := float64(o.Price-s.CurrentPrice) / float64(s.CurrentPrice)
				if gap > config.AiTraderCancelDevThreshold {
					engine.CancelOrder(db, o.ID, trader.ID)
				}
			}
		}

		sampled := sampleStocks(activeStocks)
		if sampled == nil {
			continue
		}

		ps, err := store.GetPlayerState(trader.ID)
		if err != nil {
			continue
		}
		holdings, _ := store.GetHoldingsByPlayer(trader.ID)
		holdingMap := make(map[uint]*domain.Holding, len(holdings))
		for i := range holdings {
			holdingMap[holdings[i].StockID] = &holdings[i]
		}

		for _, stock := range sampled {
			if stock.CurrentPrice <= 0 {
				continue
			}

			if h, ok := holdingMap[stock.ID]; ok {
				if CheckStopLoss(s.placeOrderInternal, trader, stock, h) {
					s.metrics.RecordStopLoss()
					continue
				}
			}

			company, ok := companyByID[stock.CompanyID]
			if !ok {
				continue
			}

			indCfg, ok := engine.Industries[company.Industry]
			if !ok {
				continue
			}

			prospMu.Lock()
			prosperity, exists := prosperityCache[company.Industry]
			if !exists {
				p, err := store.LatestProsperity(company.Industry)
				if err == nil {
					prosperity = p
				} else {
					prosperity = 1.0
				}
				prosperityCache[company.Industry] = prosperity
			}
			prospMu.Unlock()

			prices := priceHistAll[stock.ID]
			volumes := volHistAll[stock.ID]

			ma5 := int64(0)
			if len(prices) >= 5 {
				sum := int64(0)
				for i := 0; i < 5; i++ {
					sum += prices[i]
				}
				ma5 = sum / 5
			}
			ma20 := int64(0)
			if len(prices) >= 20 {
				sum := int64(0)
				for i := 0; i < 20; i++ {
					sum += prices[i]
				}
				ma20 = sum / 20
			}

			avgVol := int64(0)
			if len(volumes) > 0 {
				sum := int64(0)
				for _, v := range volumes {
					sum += v
				}
				avgVol = sum / int64(len(volumes))
			}

			stockQuarterlies := quarterlies[company.ID]

			ctx := &FactorContext{
				Stock:         stock,
				Company:       company,
				Quarters:      stockQuarterlies,
				IndustryPE:    indCfg.PE,
				Prosperity:    prosperity,
				RecentPrices:  prices,
				MA5:           ma5,
				MA20:          ma20,
				AvgVolume:     avgVol,
				GlobalAvgVol:  globalAvgVolume,
				Holding:       holdingMap[stock.ID],
				PlayerState:   ps,
				CapAssetValue: indCfg.CapAssetValue,
			}

			rawSignal := ComputeRawSignal(ctx, trader.Strategy)
			allSignals = append(allSignals, rawSignal)
			s.metrics.RecordSignal()

			finalSignal := (1-config.AiTraderSentConduction)*rawSignal + config.AiTraderSentConduction*s.sentiment.Get()
			finalSignal += (rand.Float64()*2 - 1) * config.AiTraderSignalJitter

			if rand.Float64() < config.AiTraderRandomSideRate {
				dir := 1.0
				if rand.Float64() < 0.5 {
					dir = -1.0
				}
				finalSignal = dir * randomFloatRange(config.AiTraderSignalThreshold+0.01, 0.5)
			}

			finalSignal = math.Max(-1, math.Min(1, finalSignal))

			if math.Abs(finalSignal) <= config.AiTraderSignalThreshold {
				continue
			}

			order := computeOrder(trader, stock, finalSignal)
			if order == nil {
				continue
			}

			if s.PlaceOrder != nil {
				if err := s.PlaceOrder(order); err != nil {
					slog.Debug("bot order failed", "bot", trader.ID, "stock", stock.Symbol, "error", err)
					continue
				}
				s.metrics.RecordOrder(order.Side)
			}
		}

		trader.CoolDownLeft = trader.CooldownTicks

		holdingValue := int64(0)
		for _, h := range holdings {
			if s, ok := stockByID[h.StockID]; ok {
				holdingValue += s.CurrentPrice * h.Qty
			}
		}
		if ps.Cash < config.AiTraderExitCash && holdingValue == 0 {
			depleted++
		}
	}

	s.sentiment.Update(allSignals)

	s.metrics.SetTraders(len(s.traders), depleted)

	if s.tickCount%config.AiTraderResupplyInterval == 0 {
		CheckAndReplenish(db, s.traders)
	}

	elapsed := time.Since(start).Microseconds()
	if elapsed > 1_000_000 {
		slog.Warn("AI tick slow", "us", elapsed)
	}
}

func (s *Scheduler) placeOrderInternal(order *domain.Order) error {
	if s.PlaceOrder == nil {
		return nil
	}
	return s.PlaceOrder(order)
}

func sampleStocks(stocks []*domain.Stock) []*domain.Stock {
	if len(stocks) == 0 {
		return nil
	}
	n := int(math.Ceil(float64(len(stocks)) * config.AiTraderSampleRatio))
	if n > 20 {
		n = 20
	}
	minStocks := config.AiTraderMinStocks
	if len(stocks) < 15 && minStocks > len(stocks) {
		minStocks = len(stocks)
	}
	if n < minStocks {
		n = minStocks
	}
	if n > len(stocks) {
		n = len(stocks)
	}

	perm := rand.Perm(len(stocks))
	result := make([]*domain.Stock, n)
	for i := 0; i < n; i++ {
		result[i] = stocks[perm[i]]
	}
	return result
}

func (s *Scheduler) Metrics() *BotMetrics {
	return s.metrics
}

func (s *Scheduler) GatherTraderStats(stocksByID map[uint]*StockRef) []TraderStats {
	s.mu.Lock()
	defer s.mu.Unlock()

	domainStocks := make(map[uint]*domain.Stock, len(stocksByID))
	for id, ref := range stocksByID {
		domainStocks[id] = &domain.Stock{ID: ref.ID, CurrentPrice: ref.CurrentPrice}
	}
	return GatherTraderStats(s.traders, domainStocks)
}
