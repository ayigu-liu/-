package engine

import (
	"math"
	"math/rand"
)

func WalkProsperity(oldProsperity float64, cfg IndustryConfig) float64 {
	halfRange := (cfg.ProsperityMax - cfg.ProsperityMin) / 2

	// deviation from center (1.0), normalized to [-1, +1]
	deviation := (oldProsperity - 1.0) / halfRange

	// regression strength proportional to how far from center
	regressionShare := math.Abs(deviation) * cfg.ProsperityRegression
	randomShare := 1.0 - regressionShare

	// random walk: random(-maxStep, +maxStep) * randomShare
	randomStep := (rand.Float64()*2 - 1) * cfg.ProsperityMaxStep * randomShare

	// regression pull towards 1.0: -deviation * maxStep * regressionShare
	regressionStep := -deviation * cfg.ProsperityMaxStep * regressionShare

	change := randomStep + regressionStep

	// clamp change to [-maxStep, +maxStep]
	if change > cfg.ProsperityMaxStep {
		change = cfg.ProsperityMaxStep
	} else if change < -cfg.ProsperityMaxStep {
		change = -cfg.ProsperityMaxStep
	}

	newProsperity := oldProsperity + change

	// clamp final value to [min, max]
	if newProsperity > cfg.ProsperityMax {
		newProsperity = cfg.ProsperityMax
	} else if newProsperity < cfg.ProsperityMin {
		newProsperity = cfg.ProsperityMin
	}

	return newProsperity
}
