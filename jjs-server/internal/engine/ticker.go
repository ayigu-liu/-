package engine

import (
	"log/slog"
	"math"
	"sync/atomic"
	"time"

	"github.com/robfig/cron/v3"

	"jjs-server/internal/domain"
	"jjs-server/internal/store"
)

var GlobalQuarter atomic.Int64

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
	// Step 0: finalize the quarter that just ended (sync, updates cash)
	currentQ := int(GlobalQuarter.Load())
	if currentQ > 0 {
		finalizeQuarter(currentQ)
	}

	// Step 1: advance to the new quarter
	q := GlobalQuarter.Add(1)

	slog.Info("quarter tick", "quarter", q)

	// Step 2: prosperity update for the new quarter
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

	// Step 3: pre-generate quarterly projections for the new quarter (async, cash untouched)
	go preGenerateQuarter(int(q))
}

func finalizeQuarter(quarter int) {
	companies, err := store.GetActiveCompanies()
	if err != nil {
		slog.Error("finalize: failed to get active companies", "error", err)
		return
	}

	slog.Info("finalizing quarter", "companies", len(companies), "quarter", quarter)

	for i, c := range companies {
		if i%20 == 0 && i > 0 {
			time.Sleep(50 * time.Millisecond)
		}

		if err := settleCompanyBaseline(&c, quarter, true); err != nil {
			slog.Error("finalize failed", "company", c.ID, "error", err)
		}
	}

	slog.Info("finalize complete", "companies", len(companies), "quarter", quarter)
}

func preGenerateQuarter(quarter int) {
	companies, err := store.GetActiveCompanies()
	if err != nil {
		slog.Error("pregen: failed to get active companies", "error", err)
		return
	}

	slog.Info("pre-generating quarterly projections", "companies", len(companies), "quarter", quarter)

	for i, c := range companies {
		if i%20 == 0 && i > 0 {
			time.Sleep(50 * time.Millisecond)
		}

		if err := settleCompanyBaseline(&c, quarter, false); err != nil {
			slog.Error("pregen failed", "company", c.ID, "error", err)
		}
	}

	slog.Info("pre-generation complete", "companies", len(companies), "quarter", quarter)
}

func settleCompanyBaseline(c *domain.Company, quarter int, finalize bool) error {
	if finalize {
		if c.LastSettledQuarter >= quarter {
			return nil
		}
		if c.Quarter > quarter {
			return nil
		}
	} else {
		exists, err := store.QuarterlyExists(c.ID, quarter)
		if err != nil {
			return err
		}
		if exists {
			return nil
		}
	}

	prosperity, err := store.LatestProsperity(c.Industry)
	if err != nil {
		prosperity = 1.0
	}

	cfg := Industries[c.Industry]

	if c.Industry == "manufacturing" {
		return settleManufacturing(c, cfg, prosperity, quarter, false, finalize)
	}

	return nil
}

func settleManufacturing(c *domain.Company, cfg IndustryConfig, prosperity float64, quarter int, marketing bool, finalize bool) error {
	result := SettleManufacturing(
		c.ID,
		c.Employees,
		c.CapCount,
		c.Inventory,
		c.Demand,
		prosperity,
		quarter,
		marketing,
		cfg.BaseMaintenanceRate,
		cfg.OperationalCostRate,
	)

	beginningCash := int64(math.Round(c.Cash))
	newCash := beginningCash + result.Profit

	tx := store.DB.Begin()

	if finalize {
		tx.Where("company_id = ? AND quarter = ?", c.ID, quarter).Delete(&domain.CompanyQuarterly{})
	}

	if err := tx.Create(&domain.CompanyQuarterly{
		CompanyID:       c.ID,
		Quarter:         quarter,
		Revenue:         result.Revenue,
		Profit:          result.Profit,
		BeginningCash:   beginningCash,
		Cash:            newCash,
		LaborCost:       result.LaborCost,
		BaseMaintenance: result.BaseMaintenance,
		OperationalCost: result.OperationalCost,
		WarehouseCost:   result.WarehouseCost,
		TotalCost:       result.LaborCost + result.BaseMaintenance + result.OperationalCost + result.WarehouseCost,
		SalesQty:        result.SalesQty,
		ProdQty:         result.ProdQty,
		Employees:       c.Employees,
		TotalShares:     c.TotalShares,
		CEOShares:       c.CEOShares,
		CapCount:        c.CapCount,
		Inventory:       result.Inventory,
		Demand:          result.Demand,
	}).Error; err != nil {
		tx.Rollback()
		return err
	}

	if finalize {
		if err := tx.Model(c).Updates(map[string]interface{}{
			"cash":                 float64(newCash),
			"inventory":            result.Inventory,
			"demand":               result.Demand,
			"quarter":              quarter,
			"last_settled_quarter": quarter,
		}).Error; err != nil {
			tx.Rollback()
			return err
		}
	}

	return tx.Commit().Error
}

func RecoverSettlements() {
	currentQ := int(GlobalQuarter.Load())
	if currentQ <= 1 {
		return
	}

	targetQ := currentQ - 1
	companies, err := store.GetActiveCompanies()
	if err != nil {
		slog.Error("recover settlements: failed to get active companies", "error", err)
		return
	}

	pending := 0
	for i, c := range companies {
		if c.LastSettledQuarter >= targetQ {
			continue
		}
		if i > 0 && i%20 == 0 {
			time.Sleep(50 * time.Millisecond)
		}
		if err := settleCompanyBaseline(&c, targetQ, true); err != nil {
			slog.Error("recover settlement failed", "company", c.ID, "error", err)
			continue
		}
		pending++
	}

	if pending > 0 {
		slog.Info("recovered pending settlements", "count", pending, "quarter", targetQ)
	}

	slog.Info("pre-generating projections for current quarter", "quarter", currentQ)
	preGenerateQuarter(currentQ)
}
