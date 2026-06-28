package bots

import (
	"sort"
	"sync"

	"jjs-server/internal/config"
)

type MarketSentiment struct {
	value float64
	mu    sync.RWMutex
}

func NewMarketSentiment() *MarketSentiment {
	return &MarketSentiment{}
}

func (s *MarketSentiment) Update(rawSignals []float64) {
	if len(rawSignals) == 0 {
		return
	}
	sorted := make([]float64, len(rawSignals))
	copy(sorted, rawSignals)
	sort.Float64s(sorted)

	median := sorted[len(sorted)/2]
	sum := 0.0
	for _, v := range rawSignals {
		sum += v
	}
	mean := sum / float64(len(rawSignals))

	raw := median + (mean-median)*config.AiTraderSentEmaAlpha

	s.mu.Lock()
	s.value = (1-config.AiTraderSentEmaAlpha)*s.value + config.AiTraderSentEmaAlpha*raw
	s.mu.Unlock()
}

func (s *MarketSentiment) Get() float64 {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.value
}
