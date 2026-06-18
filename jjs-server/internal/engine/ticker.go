package engine

import (
	"log/slog"
	"sync/atomic"
	"time"

	"github.com/robfig/cron/v3"

	"jjs-server/internal/domain"
	"jjs-server/internal/store"
)

var GlobalQuarter atomic.Int64

func init() {
	GlobalQuarter.Store(1)
}

type Ticker struct {
	cron *cron.Cron
}

func NewTicker() *Ticker {
	return &Ticker{
		cron: cron.New(cron.WithSeconds()),
	}
}

func (t *Ticker) Start() {
	_, err := t.cron.AddFunc("0 */5 * * * *", t.onQuarterTick)
	if err != nil {
		slog.Error("failed to register cron job", "error", err)
		return
	}
	t.cron.Start()
	slog.Info("quarterly ticker started (every 5min)")
}

func (t *Ticker) Stop() {
	ctx := t.cron.Stop()
	<-ctx.Done()
	slog.Info("quarterly ticker stopped")
}

func (t *Ticker) onQuarterTick() {
	q := GlobalQuarter.Add(1)

	slog.Info("quarter tick", "quarter", q)

	// Step 1: prosperity update for all industries
	for id, cfg := range Industries {
		prev, err := store.LatestProsperity(id)
		if err != nil {
			slog.Warn("no previous prosperity, starting at 1.0", "industry", id)
			prev = 1.0
		}
		next := WalkProsperity(prev, cfg)
		if err := store.SaveProsperity(id, int(q), next); err != nil {
			slog.Error("failed to save prosperity", "industry", id, "error", err)
		}
	}
	slog.Info("prosperity updated", "quarter", q)

	// Step 2: batch baseline settlement in background
	go t.batchSettle(int(q))
}

func (t *Ticker) batchSettle(quarter int) {
	companies, err := store.GetActiveCompanies()
	if err != nil {
		slog.Error("failed to get active companies", "error", err)
		return
	}

	slog.Info("batch settlement started", "companies", len(companies), "quarter", quarter)

	for i, c := range companies {
		if i%20 == 0 && i > 0 {
			// yield every 20 companies to avoid CPU hogging
			time.Sleep(50 * time.Millisecond)
		}

		if err := settleCompanyBaseline(&c, quarter); err != nil {
			slog.Error("settlement failed", "company", c.ID, "error", err)
		}
	}

	slog.Info("batch settlement complete", "companies", len(companies), "quarter", quarter)
}

func settleCompanyBaseline(c *domain.Company, quarter int) error {
	// Check if quarterly snapshot already exists
	exists, err := store.QuarterlyExists(c.ID, quarter)
	if err != nil {
		return err
	}
	if exists {
		return nil
	}

	// Get current prosperity
	prosperity, err := store.LatestProsperity(c.Industry)
	if err != nil {
		prosperity = 1.0
	}

	cfg := Industries[c.Industry]

	if c.Industry == "manufacturing" {
		return settleManufacturing(c, cfg, prosperity, quarter, false)
	}

	// Non-manufacturing: simple revenue model
	return settleAbstract(c, cfg, prosperity, quarter)
}

func settleManufacturing(c *domain.Company, cfg IndustryConfig, prosperity float64, quarter int, marketing bool) error {
	result := SettleManufacturing(
		c.ID,
		c.Employees,
		c.CapCount,
		c.Inventory,
		c.Demand,
		prosperity,
		quarter,
		marketing,
		cfg.CapMaintenanceActive,
		cfg.CapMaintenanceIdle,
	)

	newCash := c.Cash + result.Profit

	tx := store.DB.Begin()

	if err := tx.Create(&domain.CompanyQuarterly{
		CompanyID:   c.ID,
		Quarter:     quarter,
		Period:      formatPeriod(quarter),
		Revenue:     result.Revenue,
		Profit:      result.Profit,
		Cash:        newCash,
		Employees:   c.Employees,
		TotalShares: c.TotalShares,
		CEOShares:   c.CEOShares,
		CapCount:    c.CapCount,
		Inventory:   result.Inventory,
		Demand:      result.Demand,
	}).Error; err != nil {
		tx.Rollback()
		return err
	}

	if err := tx.Model(c).Updates(map[string]interface{}{
		"cash":      newCash,
		"inventory": result.Inventory,
		"demand":    result.Demand,
		"quarter":   quarter,
	}).Error; err != nil {
		tx.Rollback()
		return err
	}

	return tx.Commit().Error
}

func settleAbstract(c *domain.Company, cfg IndustryConfig, prosperity float64, quarter int) error {
	rng := ManufacturingRNG(c.ID, quarter, "volatility")
	iv := (rng.Float64()*2 - 1) * cfg.IndividualVolatility

	revenue := float64(c.Employees) * cfg.RevPerEmployee * (prosperity + iv)
	profit := revenue * 0.25 // simplified 25% profit margin

	newCash := c.Cash + profit

	tx := store.DB.Begin()

	if err := tx.Create(&domain.CompanyQuarterly{
		CompanyID:   c.ID,
		Quarter:     quarter,
		Period:      formatPeriod(quarter),
		Revenue:     revenue,
		Profit:      profit,
		Cash:        newCash,
		Employees:   c.Employees,
		TotalShares: c.TotalShares,
		CEOShares:   c.CEOShares,
		CapCount:    c.CapCount,
	}).Error; err != nil {
		tx.Rollback()
		return err
	}

	if err := tx.Model(c).Updates(map[string]interface{}{
		"cash":    newCash,
		"quarter": quarter,
	}).Error; err != nil {
		tx.Rollback()
		return err
	}

	return tx.Commit().Error
}

func formatPeriod(q int) string {
	year := (q-1)/4 + 1
	qnum := (q-1)%4 + 1
	switch qnum {
	case 1:
		return "Q1"
	case 2:
		return "Q2"
	case 3:
		return "Q3"
	case 4:
		return "Q4"
	}
	_ = year
	return "Q1"
}
