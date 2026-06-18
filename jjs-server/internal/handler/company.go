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
	Name     string `json:"name"`
	Industry string `json:"industry"`
}

type createCompanyResponse struct {
	ID        uint    `json:"id"`
	Symbol    string  `json:"symbol"`
	Name      string  `json:"name"`
	Industry  string  `json:"industry"`
	Cash      float64 `json:"cash"`
	Employees int     `json:"employees"`
}

type companyStateResponse struct {
	ID              uint    `json:"id"`
	Symbol          string  `json:"symbol"`
	Name            string  `json:"name"`
	Industry        string  `json:"industry"`
	CEOID           string  `json:"ceo_id"`
	Quarter         int     `json:"quarter"`
	Cash            float64 `json:"cash"`
	Employees       int     `json:"employees"`
	Status          string  `json:"status"`
	TotalShares     int     `json:"total_shares"`
	CapCount        int     `json:"cap_count"`
	Inventory       float64 `json:"inventory"`
	SludgeLevel     int     `json:"sludge_level"`
	Revenue         float64 `json:"revenue"`
	Profit          float64 `json:"profit"`
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

	if _, ok := engine.Industries[req.Industry]; !ok {
		WriteJSON(w, http.StatusBadRequest, map[string]string{"error": "无效的行业"})
		return
	}

	existing, err := store.GetActiveCompanyByCEOID(userID)
	if err == nil && existing != nil {
		WriteJSON(w, http.StatusConflict, map[string]string{"error": "你已有一家活跃公司"})
		return
	}

	ind := engine.Industries[req.Industry]

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
		Cash:        ind.StartingCash,
		Employees:   ind.StartingEmployees,
		Quarter:     1,
		Status:      "active",
		TotalShares: ind.SharesOutstanding,
		CapCount:    1,
	}

	if err := store.CreateCompany(company); err != nil {
		slog.Error("create company failed", "error", err)
		WriteJSON(w, http.StatusInternalServerError, map[string]string{"error": "创建失败"})
		return
	}

	// Q0 quarterly snapshot as starting point
	q0 := &domain.CompanyQuarterly{
		CompanyID:   company.ID,
		Quarter:     0,
		Period:      "Q0",
		Revenue:     0,
		Profit:      0,
		Cash:        ind.StartingCash,
		Employees:   ind.StartingEmployees,
		TotalShares: ind.SharesOutstanding,
		CapCount:    1,
		Inventory:   0,
		SludgeLevel: 0,
	}
	if err := store.CreateQuarterly(q0); err != nil {
		slog.Error("create Q0 quarterly failed", "error", err)
	}

	WriteJSON(w, http.StatusCreated, createCompanyResponse{
		ID:        company.ID,
		Symbol:    company.Symbol,
		Name:      company.Name,
		Industry:  company.Industry,
		Cash:      company.Cash,
		Employees: company.Employees,
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

	WriteJSON(w, http.StatusOK, companyStateResponse{
		ID:            company.ID,
		Symbol:        company.Symbol,
		Name:          company.Name,
		Industry:      company.Industry,
		CEOID:         company.CEOID,
		Quarter:       company.Quarter,
		Cash:          company.Cash,
		Employees:     company.Employees,
		Status:        company.Status,
		TotalShares:   company.TotalShares,
		CapCount:      company.CapCount,
		Inventory:     company.Inventory,
		SludgeLevel:   company.SludgeLevel,
		Revenue:       revenue,
		Profit:        profit,
		Quarterly:     quarterly,
		PendingBuilds: pendingCount,
	})
}
