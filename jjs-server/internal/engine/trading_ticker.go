package engine

import (
	"log/slog"
	"time"

	"gorm.io/gorm"

	"jjs-server/internal/config"
	"jjs-server/internal/domain"
	"jjs-server/internal/store"
	"jjs-server/internal/ws"
)

type BotRunner interface {
	ScheduleTick(db *gorm.DB)
}

type TradingTicker struct {
	stopCh    chan struct{}
	tickCount int64
	hub       *ws.Hub
	botRunner BotRunner
}

func NewTradingTicker() *TradingTicker {
	return &TradingTicker{}
}

func (t *TradingTicker) SetHub(h *ws.Hub) {
	t.hub = h
}

func (t *TradingTicker) SetBotRunner(b BotRunner) {
	t.botRunner = b
}

func (t *TradingTicker) Start() {
	t.stopCh = make(chan struct{})
	go t.run()
	slog.Info("trading ticker started", "interval", config.PriceTickInterval)
}

func (t *TradingTicker) Stop() {
	close(t.stopCh)
	slog.Info("trading ticker stopped")
}

func (t *TradingTicker) run() {
	ticker := time.NewTicker(config.PriceTickInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			t.onTick()
		case <-t.stopCh:
			return
		}
	}
}

func (t *TradingTicker) onTick() {
	t.tickCount++

	if t.tickCount%config.BrokerScanTicks == 0 {
		go ReleaseBrokerInventory(store.DB)
	}

	t.aggregateAllCandles()

	if t.botRunner != nil {
		t.botRunner.ScheduleTick(store.DB)
	}

	if t.hub != nil {
		t.broadcastPriceUpdate()
	}
}

func (t *TradingTicker) broadcastPriceUpdate() {
	stocks, err := store.ListStocks()
	if err != nil {
		return
	}

	companies, err := store.GetActiveCompanies()
	if err != nil {
		return
	}

	companyMap := make(map[string]*domain.Company, len(companies))
	for i := range companies {
		companyMap[companies[i].Symbol] = &companies[i]
	}

	msg := ws.BuildPriceUpdate(stocks, companyMap, t.tickCount)
	t.hub.Broadcast(msg)
}

func (t *TradingTicker) aggregateAllCandles() {
	stocks, err := store.ListStocks()
	if err != nil {
		return
	}

	for _, s := range stocks {
		if s.CurrentPrice <= 0 {
			continue
		}
		for _, period := range []struct {
			name    string
			seconds int64
		}{
			{"15t", 30},
			{"60t", 120},
			{"150t", 300},
		} {
			openTime := candleOpenTime(time.Now(), period.seconds)
			if err := store.UpsertCandle(s.ID, period.name, openTime, s.CurrentPrice, 0); err != nil {
				slog.Error("candle upsert failed", "stockID", s.ID, "period", period.name, "error", err)
			}
		}
	}
}

func candleOpenTime(t time.Time, periodSecs int64) time.Time {
	unix := t.Unix()
	return time.Unix(unix-(unix%periodSecs), 0).UTC()
}
