package handler

import (
	"encoding/json"
	"math"
	"net/http"
	"time"

	"jjs-server/internal/domain"
	"jjs-server/internal/engine"
	"jjs-server/internal/middleware"
	"jjs-server/internal/store"
)

type ipoRequest struct {
	FloatRatio float64 `json:"float_ratio"` // 0.10 ~ 0.50
}

type ipoResponse struct {
		Symbol         string  `json:"symbol"`
		IpoPrice       int64   `json:"ipo_price"`
		IpoPriceYuan   float64 `json:"ipo_price_yuan"`
		PublicFloat    int64   `json:"public_float"`
		NewTotalShares int64   `json:"new_total_shares"`
		RaisedCash     int64   `json:"raised_cash"`
		Nav            float64 `json:"nav"`
		Eps            float64 `json:"eps"`
	}

const (
	ipoMinQuarters        = 12
	ipoMinConsecutiveProf = 4
	ipoMinCash            = 1_000_000
	ipoMinAnnualRevenue   = 5_000_000
)

func (h *CompanyHandler) IPO(w http.ResponseWriter, r *http.Request) {
	userID, ok := middleware.GetUserID(r)
	if !ok {
		WriteJSON(w, http.StatusUnauthorized, map[string]string{"error": "未登录"})
		return
	}

	var req ipoRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		WriteJSON(w, http.StatusBadRequest, map[string]string{"error": "请求格式错误"})
		return
	}

	if req.FloatRatio < 0.10 || req.FloatRatio > 0.50 {
		WriteJSON(w, http.StatusBadRequest, map[string]string{"error": "增发比例需在 10% 到 50% 之间"})
		return
	}

	company, err := store.GetActiveCompanyByCEOID(userID)
	if err != nil {
		WriteJSON(w, http.StatusNotFound, map[string]string{"error": "未找到活跃公司"})
		return
	}

	if company.IpoQuarter > 0 {
		WriteJSON(w, http.StatusBadRequest, map[string]string{"error": "公司已上市"})
		return
	}

	currentQ := int(engine.GlobalQuarter.Load())
	operatedQuarters := currentQ - company.CreatedQuarter + 1
	if operatedQuarters < ipoMinQuarters {
		WriteJSON(w, http.StatusBadRequest, map[string]string{
			"error": "运营季度不足",
		})
		return
	}

	allQuarterly, err := store.GetQuarterlyByCompanyID(company.ID)
	if err != nil {
		WriteJSON(w, http.StatusInternalServerError, map[string]string{"error": "获取财报失败"})
		return
	}

	finalized := make([]domain.CompanyQuarterly, 0)
	for _, q := range allQuarterly {
		if q.Quarter > 0 && q.Quarter < currentQ {
			finalized = append(finalized, q)
		}
	}

	if len(finalized) < ipoMinConsecutiveProf {
		WriteJSON(w, http.StatusBadRequest, map[string]string{"error": "已结算季度不足"})
		return
	}

	lastN := finalized
	if len(lastN) > ipoMinConsecutiveProf {
		lastN = lastN[len(lastN)-ipoMinConsecutiveProf:]
	}

	consecutiveProfit := true
	var totalProfit float64
	var totalRevenue float64
	for _, q := range lastN {
		if q.Profit <= 0 {
			consecutiveProfit = false
		}
		totalProfit += float64(q.Profit)
		totalRevenue += float64(q.Revenue)
	}

	if !consecutiveProfit {
		WriteJSON(w, http.StatusBadRequest, map[string]string{"error": "未满足连续盈利条件"})
		return
	}

	if company.Cash < ipoMinCash {
		WriteJSON(w, http.StatusBadRequest, map[string]string{"error": "现金不足"})
		return
	}

	if totalRevenue < ipoMinAnnualRevenue {
		WriteJSON(w, http.StatusBadRequest, map[string]string{"error": "近4季度营收不足"})
		return
	}

	cfg := engine.Industries[company.Industry]

	prosperity, err := store.LatestProsperity(company.Industry)
	if err != nil {
		prosperity = 1.0
	}

	totalAssets := company.Cash + float64(company.CapCount)*cfg.CapAssetValue
	navYuan := totalAssets / float64(company.TotalShares)

	avgProfit := totalProfit / float64(len(lastN))
	epsYuan := avgProfit / float64(company.TotalShares)

	theoreticalPrice := math.Max(1, navYuan+epsYuan*cfg.PE*prosperity)
	ipoPrice := int64(math.Round(theoreticalPrice * 0.95 * 100))
	if ipoPrice < 1 {
		ipoPrice = 1
	}

	floatShares := int64(math.Round(float64(company.TotalShares) * req.FloatRatio))
	if floatShares < 1 {
		floatShares = 1
	}
	raisedCash := math.Round(float64(floatShares) * theoreticalPrice * 0.95)

	tx := store.DB.Begin()

	stock := &domain.Stock{
		CompanyID:    company.ID,
		Symbol:       company.Symbol,
		CurrentPrice: ipoPrice,
		Open:         ipoPrice,
		High:         ipoPrice,
		Low:          ipoPrice,
		PrevClose:    ipoPrice,
	}
	if err := tx.Create(stock).Error; err != nil {
		tx.Rollback()
		WriteJSON(w, http.StatusInternalServerError, map[string]string{"error": "创建股票记录失败"})
		return
	}

	broker := &domain.BrokerInventory{
		StockID:  stock.ID,
		TotalQty: floatShares,
	}
	if err := tx.Create(broker).Error; err != nil {
		tx.Rollback()
		WriteJSON(w, http.StatusInternalServerError, map[string]string{"error": "创建证券机构库存失败"})
		return
	}

	newTotalShares := company.TotalShares + floatShares
	if err := tx.Model(company).Updates(map[string]interface{}{
		"cash":          company.Cash + raisedCash,
		"total_shares":  newTotalShares,
		"public_float":  floatShares,
		"ipo_quarter":   currentQ,
		"updated_at":    time.Now(),
	}).Error; err != nil {
		tx.Rollback()
		WriteJSON(w, http.StatusInternalServerError, map[string]string{"error": "更新公司状态失败"})
		return
	}

	if err := tx.Commit().Error; err != nil {
		WriteJSON(w, http.StatusInternalServerError, map[string]string{"error": "提交事务失败"})
		return
	}

	WriteJSON(w, http.StatusOK, ipoResponse{
		Symbol:         company.Symbol,
		IpoPrice:       ipoPrice,
		IpoPriceYuan:   math.Round(float64(ipoPrice)) / 100,
		PublicFloat:    floatShares,
		NewTotalShares: newTotalShares,
		RaisedCash:     int64(raisedCash),
		Nav:            navYuan,
		Eps:            epsYuan,
	})
}

func ipoCheckConditions(company *domain.Company, currentQ int) (eligible bool, conditions map[string]any) {
	conditions = map[string]any{
		"ipo_quarter": company.IpoQuarter,
	}

	if company.IpoQuarter > 0 {
		conditions["listed"] = true
		return false, conditions
	}

	operatedQuarters := currentQ - company.CreatedQuarter + 1
	allQuarterly, _ := store.GetQuarterlyByCompanyID(company.ID)
	finalized := make([]domain.CompanyQuarterly, 0)
	for _, q := range allQuarterly {
		if q.Quarter > 0 && q.Quarter < currentQ {
			finalized = append(finalized, q)
		}
	}

	consecutiveProfit := 0
	var annualRevenue float64
	lastN := finalized
	if len(lastN) > ipoMinConsecutiveProf {
		lastN = lastN[len(lastN)-ipoMinConsecutiveProf:]
	}
	for i := len(lastN) - 1; i >= 0; i-- {
		if lastN[i].Profit > 0 {
			consecutiveProfit++
		} else {
			consecutiveProfit = 0
		}
		annualRevenue += float64(lastN[i].Revenue)
	}

	conditions["quarters"] = map[string]any{
		"met":      operatedQuarters >= ipoMinQuarters,
		"current":  operatedQuarters,
		"required": ipoMinQuarters,
	}
	conditions["consecutive_profit"] = map[string]any{
		"met":      consecutiveProfit >= ipoMinConsecutiveProf,
		"current":  consecutiveProfit,
		"required": ipoMinConsecutiveProf,
	}
	conditions["cash"] = map[string]any{
		"met":      company.Cash >= ipoMinCash,
		"current":  int64(company.Cash),
		"required": int64(ipoMinCash),
	}
	conditions["annual_revenue"] = map[string]any{
		"met":      annualRevenue >= ipoMinAnnualRevenue,
		"current":  int64(annualRevenue),
		"required": int64(ipoMinAnnualRevenue),
	}
	var avgProfit float64
	if len(lastN) > 0 {
		for _, q := range lastN {
			avgProfit += float64(q.Profit)
		}
		avgProfit /= float64(len(lastN))
	}
	conditions["detail"] = map[string]any{
		"nav": (company.Cash + float64(company.CapCount)*engine.Industries[company.Industry].CapAssetValue) / float64(company.TotalShares),
		"eps": avgProfit / float64(company.TotalShares),
		"pe":  engine.Industries[company.Industry].PE,
	}

	eligible = operatedQuarters >= ipoMinQuarters &&
		consecutiveProfit >= ipoMinConsecutiveProf &&
		company.Cash >= ipoMinCash &&
		annualRevenue >= ipoMinAnnualRevenue

	return eligible, conditions
}

func (h *CompanyHandler) IpoStatus(w http.ResponseWriter, r *http.Request) {
	userID, ok := middleware.GetUserID(r)
	if !ok {
		WriteJSON(w, http.StatusUnauthorized, map[string]string{"error": "未登录"})
		return
	}

	company, err := store.GetActiveCompanyByCEOID(userID)
	if err != nil {
		WriteJSON(w, http.StatusNotFound, map[string]string{"error": "未找到活跃公司"})
		return
	}

	currentQ := int(engine.GlobalQuarter.Load())
	eligible, conditions := ipoCheckConditions(company, currentQ)

	WriteJSON(w, http.StatusOK, map[string]any{
		"eligible":   eligible,
		"conditions": conditions,
	})
}
