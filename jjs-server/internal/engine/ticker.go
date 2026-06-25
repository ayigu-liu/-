package engine

import (
	"encoding/json"
	"errors"
	"log/slog"
	"math"
	"sync/atomic"
	"time"

	"github.com/robfig/cron/v3"
	"gorm.io/datatypes"
	"gorm.io/gorm"

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

	// Step 1.5: process pending build orders at the start of the new quarter
	processAllBuildQueues(int(q))

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
	go preGenerateQuarter(nil, int(q))
}

func finalizeQuarter(quarter int) []domain.Company {
	companies, err := store.GetActiveCompanies()
	if err != nil {
		slog.Error("finalize: failed to get active companies", "error", err)
		return nil
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
	return companies
}

func preGenerateQuarter(companies []domain.Company, quarter int) {
	if len(companies) == 0 {
		if c, err := store.GetActiveCompanies(); err == nil {
			companies = c
		}
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

func processBuildQueue(c *domain.Company, quarter int) error {
	orders, err := store.GetPendingUncompletedBuildOrders(c.ID, quarter)
	if err != nil {
		return err
	}
	if len(orders) == 0 {
		return nil
	}

	for _, o := range orders {
		c.CapCount += o.Amount
		if err := store.CompleteBuildOrder(o.ID); err != nil {
			return err
		}
	}
	slog.Info("build queue processed", "company", c.ID, "completed", len(orders), "cap_count", c.CapCount)
	return nil
}

func processAllBuildQueues(quarter int) {
	companies, err := store.GetActiveCompanies()
	if err != nil {
		slog.Error("processAllBuildQueues: failed to get companies", "error", err)
		return
	}

	for i, c := range companies {
		if i > 0 && i%20 == 0 {
			time.Sleep(50 * time.Millisecond)
		}
		oldCap := c.CapCount
		if err := processBuildQueue(&c, quarter); err != nil {
			slog.Error("processAllBuildQueues: failed", "company", c.ID, "error", err)
			continue
		}
		if c.CapCount != oldCap {
			if err := store.DB.Model(&c).Where("id = ?", c.ID).Update("cap_count", c.CapCount).Error; err != nil {
				slog.Error("processAllBuildQueues: failed to update cap_count", "company", c.ID, "error", err)
			}
		}
	}
}

func MergeActionLogs(existing datatypes.JSON, extra []domain.ActionLog) (datatypes.JSON, error) {
	if len(extra) == 0 {
		return existing, nil
	}
	var all []domain.ActionLog
	if len(existing) > 0 {
		if err := json.Unmarshal(existing, &all); err != nil {
			return nil, err
		}
	}
	all = append(all, extra...)
	data, err := json.Marshal(all)
	if err != nil {
		return nil, err
	}
	return datatypes.JSON(data), nil
}

func settleCompanyBaseline(c *domain.Company, quarter int, finalize bool) error {
	if finalize {
		if c.LastSettledQuarter >= quarter {
			return nil
		}
		if c.CreatedQuarter > quarter {
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

	if finalize {
		if err := processBuildQueue(c, quarter); err != nil {
			return err
		}
	}

	if c.Industry == "manufacturing" {
		return settleManufacturing(c, cfg, prosperity, quarter, finalize)
	}
	if c.Industry == "mining" {
		return settleMining(c, cfg, prosperity, quarter, finalize)
	}

	return nil
}

func settleManufacturing(c *domain.Company, cfg IndustryConfig, prosperity float64, quarter int, finalize bool) error {
	result := SettleManufacturing(
		c.ID,
		c.Employees,
		c.CapCount,
		c.Inventory,
		c.Demand,
		prosperity,
		quarter,
		cfg.BaseMaintenanceRate,
		cfg.OperationalCostRate,
	)

	beginningCash := int64(math.Round(c.Cash))
	newCash := beginningCash + result.Profit

	quarterlyRecord := domain.CompanyQuarterly{
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
		InvestorShares:  c.InvestorShares,
		PublicFloat:     c.PublicFloat,
		CapCount:        c.CapCount,
		Inventory:       result.Inventory,
		Demand:          result.Demand,
	}

	tx := store.DB.Begin()

	if finalize {
		var existing domain.CompanyQuarterly
		err := tx.Where("company_id = ? AND quarter = ?", c.ID, quarter).First(&existing).Error
		if err == nil {
			quarterlyRecord.ID = existing.ID
			quarterlyRecord.CreatedAt = existing.CreatedAt
			quarterlyRecord.Actions = existing.Actions
			if err := tx.Save(&quarterlyRecord).Error; err != nil {
				tx.Rollback()
				return err
			}
		} else if errors.Is(err, gorm.ErrRecordNotFound) {
			if err := tx.Create(&quarterlyRecord).Error; err != nil {
				tx.Rollback()
				return err
			}
		} else {
			tx.Rollback()
			return err
		}
	} else {
		if err := tx.Create(&quarterlyRecord).Error; err != nil {
			tx.Rollback()
			return err
		}
	}

	if finalize {
		if err := tx.Model(c).Where("id = ?", c.ID).Updates(map[string]interface{}{
			"cash":                 float64(newCash),
			"inventory":            result.Inventory,
			"demand":               result.Demand,
			"cap_count":            c.CapCount,
			"last_settled_quarter": quarter,
		}).Error; err != nil {
			tx.Rollback()
			return err
		}
	}

	return tx.Commit().Error
}

func settleMining(c *domain.Company, cfg IndustryConfig, prosperity float64, quarter int, finalize bool) error {
	result := SellMining(
		c.ID,
		c.Employees,
		c.CapCount,
		c.Inventory,
		c.Demand,
		prosperity,
		quarter,
		cfg.BaseMaintenanceRate,
		cfg.OperationalCostRate,
	)

	beginningCash := int64(math.Round(c.Cash))
	newCash := beginningCash + result.Profit

	quarterlyRecord := domain.CompanyQuarterly{
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
		InvestorShares:  c.InvestorShares,
		PublicFloat:     c.PublicFloat,
		CapCount:        result.OreRemaining,
		Inventory:       result.Inventory,
		Demand:          result.Demand,
	}

	tx := store.DB.Begin()

	if finalize {
		var existing domain.CompanyQuarterly
		err := tx.Where("company_id = ? AND quarter = ?", c.ID, quarter).First(&existing).Error
		if err == nil {
			quarterlyRecord.ID = existing.ID
			quarterlyRecord.CreatedAt = existing.CreatedAt
			quarterlyRecord.Actions = existing.Actions
			if err := tx.Save(&quarterlyRecord).Error; err != nil {
				tx.Rollback()
				return err
			}
		} else if errors.Is(err, gorm.ErrRecordNotFound) {
			if err := tx.Create(&quarterlyRecord).Error; err != nil {
				tx.Rollback()
				return err
			}
		} else {
			tx.Rollback()
			return err
		}
	} else {
		if err := tx.Create(&quarterlyRecord).Error; err != nil {
			tx.Rollback()
			return err
		}
	}

	if finalize {
		if err := tx.Model(c).Where("id = ?", c.ID).Updates(map[string]interface{}{
			"cash":                 float64(newCash),
			"inventory":            result.Inventory,
			"cap_count":            result.OreRemaining,
			"demand":               result.Demand,
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

	processAllBuildQueues(currentQ)

	slog.Info("pre-generating projections for current quarter", "quarter", currentQ)
	preGenerateQuarter(nil, currentQ)
}
