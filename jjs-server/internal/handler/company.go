package handler

import (
	"crypto/rand"
	"encoding/json"
	"log/slog"
	"math/big"
	"net/http"

	"jjs-server/internal/domain"
	"jjs-server/internal/engine"
	"jjs-server/internal/middleware"
	"jjs-server/internal/store"
)

type CompanyHandler struct{}

type createCompanyRequest struct {
	Name             string  `json:"name"`
	Industry         string  `json:"industry"`
	TotalShares      int     `json:"total_shares"`
	PlayerInvestment float64 `json:"player_investment"`
}

type createCompanyResponse struct {
	ID        uint    `json:"id"`
	Symbol    string  `json:"symbol"`
	Name      string  `json:"name"`
	Industry  string  `json:"industry"`
	Cash      int64 `json:"cash"`
	Employees int     `json:"employees"`
	TotalShares int   `json:"total_shares"`
	CEOShares   int64 `json:"ceo_shares"`
	OwnRatio    float64 `json:"own_ratio"`
}

	type companyStateResponse struct {
		ID              uint    `json:"id"`
		Symbol          string  `json:"symbol"`
		Name            string  `json:"name"`
		Industry        string  `json:"industry"`
		CEOID           string  `json:"ceo_id"`
		Quarter         int     `json:"quarter"`
		Cash            int64   `json:"cash"`
		Employees       int     `json:"employees"`
		Status          string  `json:"status"`
		TotalShares     int     `json:"total_shares"`
		CEOShares       int64   `json:"ceo_shares"`
		OwnRatio        float64 `json:"own_ratio"`
		CapCount        int     `json:"cap_count"`
		Inventory       int64   `json:"inventory"`
		CapacityCeiling int64   `json:"capacity_ceiling"`
		ActualOutput    int64   `json:"actual_output"`
		Revenue         int64   `json:"revenue"`
		Profit          int64   `json:"profit"`
		Quarterly       []domain.CompanyQuarterly `json:"quarterly"`
		PendingBuilds   int     `json:"pending_builds"`
	}

var industryPrefix = map[string]string{
	"tech":          "TK",
	"finance":       "JI",
	"manufacturing": "ZA",
	"energy":        "EN",
	"consumer":      "XF",
	"healthcare":    "YL",
}

func generateSymbol(industry string) (string, error) {
	prefix, ok := industryPrefix[industry]
	if !ok {
		prefix = "XX"
	}
	const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
	buf := make([]byte, 4)
	for i := range buf {
		idx, err := rand.Int(rand.Reader, big.NewInt(int64(len(letters))))
		if err != nil {
			return "", err
		}
		buf[i] = letters[idx.Int64()]
	}
	return prefix + string(buf), nil
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

	if req.TotalShares < 10000 || req.TotalShares > 200000 {
		WriteJSON(w, http.StatusBadRequest, map[string]string{"error": "总股本需在 1万 到 20万 之间"})
		return
	}

	ceoShares := int64(10000)
	ownRatio := float64(10000) / float64(req.TotalShares)
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

	companyCash := req.PlayerInvestment / ownRatio

	symbol, err := generateSymbol(req.Industry)
	if err != nil {
		slog.Error("generate symbol failed", "error", err)
		WriteJSON(w, http.StatusInternalServerError, map[string]string{"error": "创建失败"})
		return
	}

	company := &domain.Company{
		CEOID:       userID,
		Symbol:      symbol,
		Name:        req.Name,
		Industry:    req.Industry,
		Cash:        companyCash,
		Employees:   ind.StartingEmployees,
		Quarter:     1,
		Status:      "active",
		TotalShares: req.TotalShares,
		CEOShares:   ceoShares,
		CapCount:    1,
	}

	// Set initial demand for manufacturing
	if req.Industry == "manufacturing" {
		company.Demand = engine.InitialDemand(company.ID, ind.StartingEmployees)
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

	q0 := &domain.CompanyQuarterly{
		CompanyID:   company.ID,
		Quarter:     0,
		Period:      "Q0",
		Revenue:     0,
		Profit:      0,
		Cash:        companyCash,
		Employees:   ind.StartingEmployees,
		TotalShares: req.TotalShares,
		CEOShares:   ceoShares,
		CapCount:    1,
		Inventory:   0,
		Demand:      company.Demand,
	}
	if err := store.CreateQuarterly(q0); err != nil {
		slog.Error("create Q0 quarterly failed", "error", err)
	}

	WriteJSON(w, http.StatusCreated, createCompanyResponse{
		ID:          company.ID,
		Symbol:      company.Symbol,
		Name:        company.Name,
		Industry:    company.Industry,
		Cash:        int64(company.Cash),
		Employees:   company.Employees,
		TotalShares: company.TotalShares,
		CEOShares:   company.CEOShares,
		OwnRatio:    ownRatio,
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
	pendingCount := 0
	if err == nil {
		pendingCount = len(pendingOrders)
	}

	var revenue, profit float64
	if len(quarterly) > 0 {
		last := quarterly[len(quarterly)-1]
		if last.Quarter > 0 {
			revenue = last.Revenue
			profit = last.Profit
		}
	}

	ownRatio := float64(10000) / float64(company.TotalShares)
	capacityCeiling := engine.CapacityCeiling(company.Industry, company.CapCount)
	actualOutput := engine.ActualOutput(company.Industry, company.Employees)

	WriteJSON(w, http.StatusOK, companyStateResponse{
		ID:              company.ID,
		Symbol:          company.Symbol,
		Name:            company.Name,
		Industry:        company.Industry,
		CEOID:           company.CEOID,
		Quarter:         company.Quarter,
		Cash:            int64(company.Cash),
		Employees:       company.Employees,
		Status:          company.Status,
		TotalShares:     company.TotalShares,
		CEOShares:       company.CEOShares,
		OwnRatio:        ownRatio,
		CapCount:        company.CapCount,
		Inventory:       company.Inventory,
		CapacityCeiling: capacityCeiling,
		ActualOutput:    actualOutput,
		Revenue:         int64(revenue),
		Profit:          int64(profit),
		Quarterly:       quarterly,
		PendingBuilds:   pendingCount,
	})
}
