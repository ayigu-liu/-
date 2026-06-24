package handler

import (
	"encoding/json"
	"log/slog"
	"math"
	"math/rand"
	"net/http"

	"gorm.io/datatypes"

	"jjs-server/internal/domain"
	"jjs-server/internal/engine"
	"jjs-server/internal/middleware"
	"jjs-server/internal/store"
)

type actionRequest struct {
	Actions []actionItem `json:"actions"`
}

type actionItem struct {
	Type   string `json:"type"`
	Amount int    `json:"amount"`
}

type actionResponse struct {
	Cash      int64              `json:"cash"`
	Employees int                `json:"employees"`
	CapCount  int                `json:"cap_count"`
	Actions   []domain.ActionLog `json:"actions"`
}

var validActionTypes = map[string]bool{"expand": true, "hire": true}

func actionHireRNG(companyID uint, quarter int) *rand.Rand {
	seed := int64(companyID)*1_000_000 + int64(quarter)*100 + 99
	return rand.New(rand.NewSource(seed))
}

func (h *CompanyHandler) SubmitActions(w http.ResponseWriter, r *http.Request) {
	userID, ok := middleware.GetUserID(r)
	if !ok {
		WriteJSON(w, http.StatusUnauthorized, map[string]string{"error": "未登录"})
		return
	}

	var req actionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		WriteJSON(w, http.StatusBadRequest, map[string]string{"error": "请求格式错误"})
		return
	}

	if len(req.Actions) == 0 || len(req.Actions) > 3 {
		WriteJSON(w, http.StatusBadRequest, map[string]string{"error": "每季度最多执行 3 次操作"})
		return
	}

	c, err := store.GetActiveCompanyByCEOID(userID)
	if err != nil {
		WriteJSON(w, http.StatusNotFound, map[string]string{"error": "未找到活跃公司"})
		return
	}

	currentQ := int(engine.GlobalQuarter.Load())
	if currentQ == 0 {
		WriteJSON(w, http.StatusInternalServerError, map[string]string{"error": "游戏尚未开始"})
		return
	}

	existingCount := countExistingActions(c.ID, currentQ)
	if existingCount+len(req.Actions) > 3 {
		WriteJSON(w, http.StatusBadRequest, map[string]string{"error": "本季度操作次数已用完"})
		return
	}

	cfg := engine.Industries[c.Industry]

	var totalCost float64
	for _, a := range req.Actions {
		if !validActionTypes[a.Type] {
			WriteJSON(w, http.StatusBadRequest, map[string]string{"error": "无效的操作类型: " + a.Type})
			return
		}
		if a.Amount <= 0 {
			WriteJSON(w, http.StatusBadRequest, map[string]string{"error": "操作数量必须大于 0"})
			return
		}
		switch a.Type {
		case "expand":
			totalCost += float64(a.Amount) * cfg.CapBuildCost
		case "hire":
			totalCost += float64(a.Amount) * cfg.HireCost
		}
	}

	if c.Cash < totalCost {
		WriteJSON(w, http.StatusBadRequest, map[string]string{"error": "公司现金不足"})
		return
	}

	c.Cash -= totalCost

	var actionLogs []domain.ActionLog

	existingPendingCount := 0
	if c.Industry == "mining" {
		existingOrders, err := store.GetPendingBuildOrders(c.ID)
		if err == nil {
			existingPendingCount = len(existingOrders)
		}
	}
	exploreIdx := existingPendingCount

	for _, a := range req.Actions {
		switch a.Type {
		case "expand":
			var capAmount int
			if c.Industry == "mining" {
				for i := 0; i < a.Amount; i++ {
					rng := engine.MiningRNG(c.ID, currentQ, "prospect", exploreIdx)
					capAmount += int(engine.ProspectOreReserves(rng))
					exploreIdx++
				}
			} else {
				capAmount = a.Amount
			}

			readyQuarter := currentQ + cfg.CapBuildQuarters
			order := &domain.CapBuildOrder{
				CompanyID:    c.ID,
				ReadyQuarter: readyQuarter,
				Amount:       capAmount,
				Completed:    cfg.CapBuildQuarters == 0,
			}
			if err := store.CreateCapBuildOrder(order); err != nil {
				WriteJSON(w, http.StatusInternalServerError, map[string]string{"error": "创建建造订单失败"})
				return
			}

			if cfg.CapBuildQuarters == 0 {
				c.CapCount += capAmount
			}
			actionLogs = append(actionLogs, domain.ActionLog{
				Type:         "expand",
				Amount:       a.Amount,
				Cost:         int64(float64(a.Amount) * cfg.CapBuildCost),
				ReadyQuarter: readyQuarter,
			})
			slog.Info("expand order created", "company", c.ID, "amount", a.Amount, "capAmount", capAmount, "readyQ", readyQuarter)

		case "hire":
			reqAmount := a.Amount
			rng := actionHireRNG(c.ID, currentQ)
			ratio := 0.6 + rng.Float64()*0.8
			actualHired := int(math.Round(float64(reqAmount) * ratio))
			if actualHired < 1 {
				actualHired = 1
			}
			c.Employees += actualHired
			actionLogs = append(actionLogs, domain.ActionLog{
				Type:   "hire",
				Amount: reqAmount,
				Actual: actualHired,
				Cost:   int64(float64(reqAmount) * cfg.HireCost),
			})
			slog.Info("hire completed", "company", c.ID, "requested", reqAmount, "hired", actualHired)
		}
	}

	if err := store.UpdateCompany(c); err != nil {
		WriteJSON(w, http.StatusInternalServerError, map[string]string{"error": "更新公司状态失败"})
		return
	}

	prosperity, err := store.LatestProsperity(c.Industry)
	if err != nil {
		prosperity = 1.0
	}

	var existingActions datatypes.JSON
	var quarterly domain.CompanyQuarterly
	var existingQ domain.CompanyQuarterly

	err = store.DB.Where("company_id = ? AND quarter = ?", c.ID, currentQ).First(&existingQ).Error
	if err == nil {
		existingActions = existingQ.Actions
		quarterly = existingQ
	}

	switch c.Industry {
	case "manufacturing":
		result := engine.SettleManufacturing(
			c.ID, c.Employees, c.CapCount, c.Inventory, c.Demand,
			prosperity, currentQ, false,
			cfg.BaseMaintenanceRate, cfg.OperationalCostRate,
		)

		beginningCash := int64(math.Round(c.Cash))
		newCash := beginningCash + result.Profit

		merged, mergeErr := engine.MergeActionLogs(existingActions, actionLogs)
		if mergeErr != nil {
			WriteJSON(w, http.StatusInternalServerError, map[string]string{"error": "合并操作记录失败"})
			return
		}

		quarterly.CompanyID = c.ID
		quarterly.Quarter = currentQ
		quarterly.Revenue = result.Revenue
		quarterly.Profit = result.Profit
		quarterly.BeginningCash = beginningCash
		quarterly.Cash = newCash
		quarterly.LaborCost = result.LaborCost
		quarterly.BaseMaintenance = result.BaseMaintenance
		quarterly.OperationalCost = result.OperationalCost
		quarterly.WarehouseCost = result.WarehouseCost
		quarterly.TotalCost = result.LaborCost + result.BaseMaintenance + result.OperationalCost + result.WarehouseCost
		quarterly.SalesQty = result.SalesQty
		quarterly.ProdQty = result.ProdQty
		quarterly.Employees = c.Employees
		quarterly.TotalShares = c.TotalShares
		quarterly.CEOShares = c.CEOShares
		quarterly.InvestorShares = c.InvestorShares
		quarterly.PublicFloat = c.PublicFloat
		quarterly.CapCount = c.CapCount
		quarterly.Inventory = result.Inventory
		quarterly.Demand = result.Demand
		quarterly.Actions = datatypes.JSON(merged)

		if quarterly.ID != 0 {
			if err := store.DB.Save(&quarterly).Error; err != nil {
				WriteJSON(w, http.StatusInternalServerError, map[string]string{"error": "更新季度报表失败"})
				return
			}
		} else {
			if err := store.DB.Create(&quarterly).Error; err != nil {
				WriteJSON(w, http.StatusInternalServerError, map[string]string{"error": "创建季度报表失败"})
				return
			}
		}

	case "mining":
		result := engine.SellMining(
			c.ID, c.Employees, c.CapCount, c.Inventory, c.Demand,
			prosperity, currentQ,
			cfg.BaseMaintenanceRate, cfg.OperationalCostRate,
		)

		beginningCash := int64(math.Round(c.Cash))
		newCash := beginningCash + result.Profit

		merged, mergeErr := engine.MergeActionLogs(existingActions, actionLogs)
		if mergeErr != nil {
			WriteJSON(w, http.StatusInternalServerError, map[string]string{"error": "合并操作记录失败"})
			return
		}

		quarterly.CompanyID = c.ID
		quarterly.Quarter = currentQ
		quarterly.Revenue = result.Revenue
		quarterly.Profit = result.Profit
		quarterly.BeginningCash = beginningCash
		quarterly.Cash = newCash
		quarterly.LaborCost = result.LaborCost
		quarterly.BaseMaintenance = result.BaseMaintenance
		quarterly.OperationalCost = result.OperationalCost
		quarterly.WarehouseCost = result.WarehouseCost
		quarterly.TotalCost = result.LaborCost + result.BaseMaintenance + result.OperationalCost + result.WarehouseCost
		quarterly.SalesQty = result.SalesQty
		quarterly.ProdQty = result.ProdQty
		quarterly.Employees = c.Employees
		quarterly.TotalShares = c.TotalShares
		quarterly.CEOShares = c.CEOShares
		quarterly.InvestorShares = c.InvestorShares
		quarterly.PublicFloat = c.PublicFloat
		quarterly.CapCount = result.OreRemaining
		quarterly.Inventory = result.Inventory
		quarterly.Demand = result.Demand
		quarterly.Actions = datatypes.JSON(merged)

		if quarterly.ID != 0 {
			if err := store.DB.Save(&quarterly).Error; err != nil {
				WriteJSON(w, http.StatusInternalServerError, map[string]string{"error": "更新季度报表失败"})
				return
			}
		} else {
			if err := store.DB.Create(&quarterly).Error; err != nil {
				WriteJSON(w, http.StatusInternalServerError, map[string]string{"error": "创建季度报表失败"})
				return
			}
		}

	default:
		WriteJSON(w, http.StatusBadRequest, map[string]string{"error": "该行业暂不支持操作"})
		return
	}

	WriteJSON(w, http.StatusOK, actionResponse{
		Cash:      int64(math.Round(c.Cash)),
		Employees: c.Employees,
		CapCount:  c.CapCount,
		Actions:   actionLogs,
	})
}

func countExistingActions(companyID uint, quarter int) int {
	var qr domain.CompanyQuarterly
	if err := store.DB.Where("company_id = ? AND quarter = ?", companyID, quarter).First(&qr).Error; err != nil {
		return 0
	}
	if len(qr.Actions) == 0 {
		return 0
	}
	var actions []domain.ActionLog
	if err := json.Unmarshal(qr.Actions, &actions); err != nil {
		return 0
	}
	count := 0
	for _, a := range actions {
		if a.Type == "expand" || a.Type == "hire" {
			count++
		}
	}
	return count
}
