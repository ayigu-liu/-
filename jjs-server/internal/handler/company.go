package handler

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"math"
	"net/http"
	"strconv"

	"jjs-server/internal/domain"
	"jjs-server/internal/engine"
	"jjs-server/internal/middleware"
	"jjs-server/internal/store"
)

type CompanyHandler struct{}

type createCompanyRequest struct {
	Name             string  `json:"name"`
	Industry         string  `json:"industry"`
	InvestorShares   int64   `json:"investor_shares"`
	PlayerInvestment int64   `json:"player_investment"`
}

type createCompanyResponse struct {
	ID             uint    `json:"id"`
	Symbol         string  `json:"symbol"`
	Name           string  `json:"name"`
	Industry       string  `json:"industry"`
	Cash           int64   `json:"cash"`
	Employees      int     `json:"employees"`
	CEOShares      int64   `json:"ceo_shares"`
	InvestorShares int64   `json:"investor_shares"`
	TotalShares    int64   `json:"total_shares"`
	OwnRatio       float64 `json:"own_ratio"`
}

type PendingOrderInfo struct {
	ReadyQuarter int `json:"ready_quarter"`
	Amount       int `json:"amount"`
}

type companyStateResponse struct {
	ID               uint                     `json:"id"`
	Symbol           string                   `json:"symbol"`
	Name             string                   `json:"name"`
	Industry         string                   `json:"industry"`
	CEOID            string                   `json:"ceo_id"`
	CreatedQuarter   int                      `json:"created_quarter"`
	Cash             int64                    `json:"cash"`
	Employees        int                      `json:"employees"`
	Status           string                   `json:"status"`
	CEOShares        int64                    `json:"ceo_shares"`
	InvestorShares   int64                    `json:"investor_shares"`
	TotalShares      int64                    `json:"total_shares"`
	IpoQuarter       int                      `json:"ipo_quarter"`
	PublicFloat      int64                    `json:"public_float"`
	OwnRatio         float64                  `json:"own_ratio"`
	CapCount         int                      `json:"cap_count"`
	Inventory        int64                    `json:"inventory"`
	CapacityCeiling  int64                    `json:"capacity_ceiling"`
	ActualOutput     int64                    `json:"actual_output"`
	Revenue          int64                    `json:"revenue"`
	Profit           int64                    `json:"profit"`
	LastQuarterly    *domain.CompanyQuarterly `json:"last_quarterly"`
	PendingOrders    []PendingOrderInfo       `json:"pending_orders"`
	ActionsSubmitted int                      `json:"actions_submitted"`
	StockPrice       int64                    `json:"stock_price"`
}

var industryPrefix = map[string]string{
	"tech":          "TK",
	"finance":       "JI",
	"manufacturing": "MF",
	"mining":        "MN",
	"consumer":      "CS",
	"healthcare":    "YL",
}

func filteredQuarterly(all []domain.CompanyQuarterly) []domain.CompanyQuarterly {
	currentQuarter := int(engine.GlobalQuarter.Load())
	out := make([]domain.CompanyQuarterly, 0, len(all))
	for _, q := range all {
		if q.Quarter > 0 && q.Quarter < currentQuarter {
			out = append(out, q)
		}
	}
	return out
}

func generateSymbol(industry string) (string, error) {
	prefix, ok := industryPrefix[industry]
	if !ok {
		prefix = "XX"
	}

	var maxSymbol *string
	if err := store.DB.Model(&domain.Company{}).
		Select("MAX(symbol)").
		Where("symbol LIKE ?", prefix+"%").
		Scan(&maxSymbol).Error; err != nil {
		return "", err
	}

	nextNum := 1
	if maxSymbol != nil && *maxSymbol != "" {
		if _, err := fmt.Sscanf(*maxSymbol, prefix+"%d", &nextNum); err == nil {
			nextNum++
		} else {
			nextNum = 1
		}
	}

	return fmt.Sprintf("%s%03d", prefix, nextNum), nil
}

func (h *CompanyHandler) Create(w http.ResponseWriter, r *http.Request) {
	userID, ok := middleware.GetUserID(r)
	if !ok {
		WriteJSON(w, http.StatusUnauthorized, map[string]string{"error": "未登录"})
		return
	}

	var req createCompanyRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		WriteJSON(w, http.StatusBadRequest, map[string]string{"error": "请求格式错误"})
		return
	}

	if req.Name == "" {
		WriteJSON(w, http.StatusBadRequest, map[string]string{"error": "公司名称不能为空"})
		return
	}

	ind, ok := engine.Industries[req.Industry]
	if !ok {
		WriteJSON(w, http.StatusBadRequest, map[string]string{"error": "无效的行业"})
		return
	}

	if !ind.Enabled {
		WriteJSON(w, http.StatusBadRequest, map[string]string{"error": "该行业暂未开放"})
		return
	}

	existing, err := store.GetActiveCompanyByCEOID(userID)
	if err == nil && existing != nil {
		WriteJSON(w, http.StatusConflict, map[string]string{"error": "你已有一家活跃公司"})
		return
	}

	if req.InvestorShares < 100000 || req.InvestorShares > 1900000 {
		WriteJSON(w, http.StatusBadRequest, map[string]string{"error": "投资方股数需在 10万 到 190万 之间"})
		return
	}

	ceoShares := int64(100000)
	totalShares := ceoShares + req.InvestorShares
	ownRatio := float64(ceoShares) / float64(totalShares)
	if ownRatio < 0.05 {
		WriteJSON(w, http.StatusBadRequest, map[string]string{"error": "出资比例不能低于 5%"})
		return
	}

	if req.PlayerInvestment <= 0 {
		WriteJSON(w, http.StatusBadRequest, map[string]string{"error": "出资额必须大于 0"})
		return
	}

	ps, err := store.GetPlayerState(userID)
	if err != nil {
		WriteJSON(w, http.StatusInternalServerError, map[string]string{"error": "获取玩家状态失败"})
		return
	}
	if ps.Cash < req.PlayerInvestment {
		WriteJSON(w, http.StatusBadRequest, map[string]string{"error": "可用现金不足"})
		return
	}

	companyCash := (req.PlayerInvestment * totalShares) / ceoShares

	symbol, err := generateSymbol(req.Industry)
	if err != nil {
		slog.Error("generate symbol failed", "error", err)
		WriteJSON(w, http.StatusInternalServerError, map[string]string{"error": "创建失败"})
		return
	}

	capCount := 0
	if req.Industry == "manufacturing" {
		capCount = 1
	}

	company := &domain.Company{
		CEOID:          userID,
		Symbol:         symbol,
		Name:           req.Name,
		Industry:       req.Industry,
		Cash:           companyCash,
		Employees:      ind.StartingEmployees,
		CreatedQuarter: int(engine.GlobalQuarter.Load()),
		Status:         "active",
		CEOShares:      ceoShares,
		InvestorShares: req.InvestorShares,
		TotalShares:    totalShares,
		CapCount:       capCount,
	}

	if err := store.CreateCompany(company); err != nil {
		slog.Error("create company failed", "error", err)
		WriteJSON(w, http.StatusInternalServerError, map[string]string{"error": "创建失败"})
		return
	}

	if err := store.DeductCash(userID, req.PlayerInvestment, "创建公司: "+req.Name); err != nil {
		slog.Error("deduct cash failed", "error", err)
		WriteJSON(w, http.StatusInternalServerError, map[string]string{"error": "扣款失败"})
		return
	}

	if req.Industry == "manufacturing" {
		company.Demand = engine.InitialDemand(company.ID, ind.StartingEmployees)
		if err := store.DB.Model(company).Update("demand", company.Demand).Error; err != nil {
			slog.Error("update initial demand failed", "error", err)
		}

		prosperity, err := store.LatestProsperity(req.Industry)
		if err != nil {
			prosperity = 1.0
		}

		currentQuarter := int(engine.GlobalQuarter.Load())
		result := engine.SettleManufacturing(
			company.ID,
			company.Employees,
			company.CapCount,
			0,
			company.Demand,
			prosperity,
			currentQuarter,
			ind.BaseMaintenanceRate,
			ind.OperationalCostRate,
		)

		beginningCash := company.Cash
		newCash := beginningCash + result.Profit

		quarterly := &domain.CompanyQuarterly{
			CompanyID:       company.ID,
			Quarter:         currentQuarter,
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
			Employees:       company.Employees,
			TotalShares:     company.TotalShares,
			CEOShares:       company.CEOShares,
			InvestorShares:  company.InvestorShares,
			CapCount:        company.CapCount,
			Inventory:       result.Inventory,
			Demand:          result.Demand,
		}
		if err := store.CreateQuarterly(quarterly); err != nil {
			slog.Error("create initial quarterly failed", "error", err)
		}
	}

	if req.Industry == "mining" {
		company.CapCount = int(engine.MiningInitialReserves)
		company.Demand = engine.InitialMiningDemand(company.ID, ind.StartingEmployees)
		if err := store.DB.Model(company).Updates(map[string]interface{}{
			"demand":    company.Demand,
			"cap_count": company.CapCount,
		}).Error; err != nil {
			slog.Error("update initial company state failed", "error", err)
		}

		prosperity, err := store.LatestProsperity(req.Industry)
		if err != nil {
			prosperity = 1.0
		}

		currentQuarter := int(engine.GlobalQuarter.Load())
		result := engine.SellMining(
			company.ID,
			company.Employees,
			company.CapCount,
			0,
			company.Demand,
			prosperity,
			currentQuarter,
			ind.BaseMaintenanceRate,
			ind.OperationalCostRate,
		)

		beginningCash := company.Cash
		newCash := beginningCash + result.Profit

		quarterly := &domain.CompanyQuarterly{
			CompanyID:       company.ID,
			Quarter:         currentQuarter,
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
			Employees:       company.Employees,
			TotalShares:     company.TotalShares,
			CEOShares:       company.CEOShares,
			InvestorShares:  company.InvestorShares,
			CapCount:        result.OreRemaining,
			Inventory:       result.Inventory,
			Demand:          result.Demand,
		}
		if err := store.CreateQuarterly(quarterly); err != nil {
			slog.Error("create initial quarterly failed", "error", err)
		}
	}

	WriteJSON(w, http.StatusCreated, createCompanyResponse{
		ID:             company.ID,
		Symbol:         company.Symbol,
		Name:           company.Name,
		Industry:       company.Industry,
		Cash:           company.Cash,
		Employees:      company.Employees,
		CEOShares:      company.CEOShares,
		InvestorShares: company.InvestorShares,
		TotalShares:    company.TotalShares,
		OwnRatio:       ownRatio,
	})
}

func (h *CompanyHandler) Quarterly(w http.ResponseWriter, r *http.Request) {
	userID, ok := middleware.GetUserID(r)
	if !ok {
		WriteJSON(w, http.StatusUnauthorized, map[string]string{"error": "未登录"})
		return
	}

	company, err := store.GetActiveCompanyByCEOID(userID)
	if err != nil {
		WriteJSON(w, http.StatusOK, map[string]any{"items": []any{}, "hasMore": false})
		return
	}

	cursor, _ := strconv.Atoi(r.URL.Query().Get("cursor"))
	limit, err := strconv.Atoi(r.URL.Query().Get("limit"))
	if err != nil || limit <= 0 {
		limit = 50
	}

	currentQuarter := int(engine.GlobalQuarter.Load())
	quarterly, err := store.GetPaginatedQuarterly(company.ID, cursor, limit, currentQuarter)
	if err != nil {
		quarterly = []domain.CompanyQuarterly{}
	}

	hasMore := len(quarterly) > limit
	if hasMore {
		quarterly = quarterly[:limit]
	}

	WriteJSON(w, http.StatusOK, map[string]any{
		"items":   quarterly,
		"hasMore": hasMore,
	})
}

func (h *CompanyHandler) State(w http.ResponseWriter, r *http.Request) {
	userID, ok := middleware.GetUserID(r)
	if !ok {
		WriteJSON(w, http.StatusUnauthorized, map[string]string{"error": "未登录"})
		return
	}

	company, err := store.GetActiveCompanyByCEOID(userID)
	if err != nil {
		WriteJSON(w, http.StatusOK, map[string]any{"has_company": false})
		return
	}

	quarterly, err := store.GetQuarterlyByCompanyID(company.ID)
	if err != nil {
		quarterly = []domain.CompanyQuarterly{}
	}

	pendingOrders, err := store.GetPendingBuildOrders(company.ID)
	pendingList := []PendingOrderInfo{}
	if err == nil {
		for _, o := range pendingOrders {
			pendingList = append(pendingList, PendingOrderInfo{
				ReadyQuarter: o.ReadyQuarter,
				Amount:       o.Amount,
			})
		}
	}

	confirmedQuarter := int(engine.GlobalQuarter.Load()) - 1
	filtered := filteredQuarterly(quarterly)
	var lastQ *domain.CompanyQuarterly
	var revenue int64
	var profit int64
	for i := range filtered {
		if filtered[i].Quarter == confirmedQuarter {
			cp := filtered[i]
			lastQ = &cp
			revenue = cp.Revenue
			profit = cp.Profit
			break
		}
	}

	ownRatio := float64(company.CEOShares) / float64(company.TotalShares)
	var capacityCeiling int64
	var actualOutput int64
	if company.Industry == "mining" {
		quarterlyCap := int64(math.Ceil(float64(company.CapCount) * 0.2))
		capacityCeiling = quarterlyCap
		workerOutput := int64(company.Employees) * 1500
		if workerOutput > quarterlyCap {
			actualOutput = quarterlyCap
		} else {
			actualOutput = workerOutput
		}
	} else {
		capacityCeiling = engine.CapacityCeiling(company.Industry, company.CapCount)
		actualOutput = engine.ActualOutput(company.Industry, company.Employees)
	}

	currentQ := int(engine.GlobalQuarter.Load())
	var actionsSubmitted int
	for _, q := range quarterly {
		if q.Quarter == currentQ {
			var acts []domain.ActionLog
			if err := json.Unmarshal(q.Actions, &acts); err == nil {
				actionsSubmitted = len(acts)
			}
			break
		}
	}

	var stockPrice int64
	if company.IpoQuarter > 0 {
		if s, err := store.GetStockByCompanyID(company.ID); err == nil {
			stockPrice = s.CurrentPrice
		}
	}

	WriteJSON(w, http.StatusOK, companyStateResponse{
		ID:               company.ID,
		Symbol:           company.Symbol,
		Name:             company.Name,
		Industry:         company.Industry,
		CEOID:            company.CEOID,
		CreatedQuarter:   company.CreatedQuarter,
		Cash:             company.Cash,
		Employees:        company.Employees,
		Status:           company.Status,
		CEOShares:        company.CEOShares,
		InvestorShares:   company.InvestorShares,
		TotalShares:      company.TotalShares,
		IpoQuarter:       company.IpoQuarter,
		PublicFloat:      company.PublicFloat,
		OwnRatio:         ownRatio,
		CapCount:         company.CapCount,
		Inventory:        company.Inventory,
		CapacityCeiling:  capacityCeiling,
		ActualOutput:     actualOutput,
		Revenue:          revenue,
		Profit:           profit,
		LastQuarterly:    lastQ,
		PendingOrders:    pendingList,
		ActionsSubmitted: actionsSubmitted,
		StockPrice:       stockPrice,
	})
}
