package bots

import (
	"fmt"
	"math"
	"math/rand"
	"time"

	"jjs-server/internal/config"
	"jjs-server/internal/domain"
	"jjs-server/internal/store"
)

type Strategy struct {
	Name    string
	Weights map[string]float64
}

type AiTrader struct {
	ID            string
	Strategy      *Strategy
	CooldownTicks int
	RiskTolerance float64
	CoolDownLeft  int
	SpawnedAt     time.Time
}

var strategyPresets = map[string]map[string]float64{
	"value": {
		"pe_discount": 0.25, "eps_growth": 0.15, "nav_discount": 0.15,
		"revenue_growth": 0.10, "profit_margin": 0.05, "prosperity": 0.05,
		"chase": 0.00, "panic": 0.00, "vertigo": 0.00,
		"stubborn": 0.05, "herd": 0.00, "noise": 0.05,
	},
	"growth": {
		"pe_discount": 0.05, "eps_growth": 0.25, "nav_discount": 0.05,
		"revenue_growth": 0.25, "profit_margin": 0.15, "prosperity": 0.05,
		"chase": 0.10, "panic": 0.00, "vertigo": 0.00,
		"stubborn": 0.00, "herd": 0.05, "noise": 0.05,
	},
	"momentum": {
		"pe_discount": 0.00, "eps_growth": 0.00, "nav_discount": 0.00,
		"revenue_growth": 0.00, "profit_margin": 0.00, "prosperity": 0.00,
		"chase": 0.40, "panic": 0.00, "vertigo": 0.05,
		"stubborn": 0.00, "herd": 0.30, "noise": 0.25,
	},
	"contrarian": {
		"pe_discount": 0.10, "eps_growth": 0.05, "nav_discount": 0.10,
		"revenue_growth": 0.00, "profit_margin": 0.00, "prosperity": 0.00,
		"chase": 0.00, "panic": 0.00, "vertigo": 0.05,
		"stubborn": 0.40, "herd": 0.15, "noise": 0.15,
	},
	"balanced": {
		"pe_discount": 0.10, "eps_growth": 0.10, "nav_discount": 0.10,
		"revenue_growth": 0.10, "profit_margin": 0.05, "prosperity": 0.05,
		"chase": 0.10, "panic": 0.10, "vertigo": 0.05,
		"stubborn": 0.05, "herd": 0.05, "noise": 0.15,
	},
	"national": {
		"pe_discount": 0.30, "eps_growth": 0.00, "nav_discount": 0.25,
		"revenue_growth": 0.00, "profit_margin": 0.00, "prosperity": 0.00,
		"chase": 0.00, "panic": 0.10, "vertigo": 0.00,
		"stubborn": 0.10, "herd": 0.10, "noise": 0.15,
	},
	"noise": {
		"pe_discount": 0.05, "eps_growth": 0.05, "nav_discount": 0.05,
		"revenue_growth": 0.05, "profit_margin": 0.05, "prosperity": 0.05,
		"chase": 0.05, "panic": 0.05, "vertigo": 0.05,
		"stubborn": 0.05, "herd": 0.05, "noise": 0.45,
	},
}

var strategyDistribution = map[string]int{
	"value": 20, "growth": 17, "momentum": 14,
	"contrarian": 12, "balanced": 23, "national": 3, "noise": 11,
}

func pickWeightedStrategy() *Strategy {
	cumulative := 0
	r := rand.Intn(100)
	for name, count := range strategyDistribution {
		cumulative += count
		if r < cumulative {
			return newStrategy(name)
		}
	}
	return newStrategy("balanced")
}

func newStrategy(name string) *Strategy {
	baseWeights, ok := strategyPresets[name]
	if !ok {
		baseWeights = strategyPresets["balanced"]
	}
	perturbed := make(map[string]float64, len(baseWeights))
	total := 0.0
	for k, v := range baseWeights {
		delta := v * 0.20 * (rand.Float64()*2 - 1)
		w := v + delta
		if w < 0 {
			w = 0
		}
		perturbed[k] = w
		total += w
	}
	for k := range perturbed {
		perturbed[k] /= total
	}
	return &Strategy{Name: name, Weights: perturbed}
}

func InitTraders() []*AiTrader {
	dist := make([]string, 0, config.AiTraderCount)
	for name, count := range strategyDistribution {
		for i := 0; i < count; i++ {
			dist = append(dist, name)
		}
	}
	rand.Shuffle(len(dist), func(i, j int) { dist[i], dist[j] = dist[j], dist[i] })

	traders := make([]*AiTrader, 0, config.AiTraderCount)
	for i := 0; i < config.AiTraderCount; i++ {
		id := fmt.Sprintf("bot_%04d", i+1)
		s := newStrategy(dist[i])
		cash := randomRange(config.AiTraderInitCashMin, config.AiTraderInitCashMax)
		trader := &AiTrader{
			ID: id, Strategy: s,
			CooldownTicks: randomIntRange(config.AiTraderCooldownMin, config.AiTraderCooldownMax),
			RiskTolerance: randomTolerance(),
			CoolDownLeft:  0,
			SpawnedAt:     time.Now(),
		}
		traders = append(traders, trader)

		store.GetOrCreatePlayerState(id, id)
		store.DB.Model(&domain.PlayerState{}).Where("player_id = ?", id).
			Updates(map[string]interface{}{"cash": cash, "frozen_cash": 0})
	}
	return traders
}

func randomRange(min, max int64) int64 {
	if max <= min {
		return min
	}
	return min + rand.Int63n(max-min+1)
}

func randomIntRange(min, max int) int {
	if max <= min {
		return min
	}
	return min + rand.Intn(max-min+1)
}

func randomFloatRange(min, max float64) float64 {
	return min + rand.Float64()*(max-min)
}

func randomTolerance() float64 {
	return config.AiTraderRiskToleranceMin + rand.Float64()*(config.AiTraderRiskToleranceMax-config.AiTraderRiskToleranceMin)
}

func clamp(v, lo, hi float64) float64 {
	return math.Max(lo, math.Min(hi, v))
}
