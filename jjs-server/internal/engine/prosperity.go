package engine

import (
	"fmt"
	"log/slog"
	"math/rand"

	"jjs-server/internal/store"
)

func WalkProsperity(oldProsperity float64, cfg IndustryConfig) float64 {
	halfRange := (cfg.ProsperityMax - cfg.ProsperityMin) / 2
	deviation := (oldProsperity - 1.0) / halfRange // [-1, +1]

	// 修正脉冲：覆盖当季正常步长
	if rand.Float64() < cfg.CorrectionProb {
		pulse := -deviation * cfg.CorrectionPulse
		return clamp(oldProsperity+pulse, cfg.ProsperityMin, cfg.ProsperityMax)
	}

	// 正常季度：随机 + 回归
	randomStep := (rand.Float64()*2 - 1) * cfg.ProsperityMaxStep
	regressionStep := -deviation * cfg.ProsperityRegression

	change := clamp(randomStep+regressionStep, -cfg.ProsperityMaxStep, cfg.ProsperityMaxStep)

	return clamp(oldProsperity+change, cfg.ProsperityMin, cfg.ProsperityMax)
}

func clamp(v, lo, hi float64) float64 {
	if v < lo {
		return lo
	} else if v > hi {
		return hi
	}
	return v
}

func RestoreOrSeedGlobalQuarter() error {
	maxQ, err := store.MaxProsperityQuarter()
	if err != nil {
		return fmt.Errorf("get max prosperity quarter: %w", err)
	}

	if maxQ == 0 {
		for id := range Industries {
			if err := store.SaveProsperity(id, 1, 1.0); err != nil {
				return fmt.Errorf("save initial prosperity for %s: %w", id, err)
			}
		}
		GlobalQuarter.Store(1)
		slog.Info("seeded initial prosperity", "quarter", 1)
	} else {
		GlobalQuarter.Store(int64(maxQ))
		slog.Info("restored global quarter from DB", "quarter", maxQ)
	}

	return nil
}
