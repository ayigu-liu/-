package handler

import (
	"net/http"
	"strconv"

	"jjs-server/internal/domain"
	"jjs-server/internal/store"
)

type MarketHandler struct{}

type stockInfo struct {
	ID           uint    `json:"id"`
	Symbol       string  `json:"symbol"`
	CurrentPrice int64   `json:"current_price"`
	Change       int64   `json:"change"`
	ChangePct    float64 `json:"change_percent"`
	Open         int64   `json:"open"`
	High         int64   `json:"high"`
	Low          int64   `json:"low"`
}

type stockDetail struct {
	stockInfo
	PrevClose int64            `json:"prev_close"`
	Bids      []orderBookLevel `json:"bids"`
	Asks      []orderBookLevel `json:"asks"`
}

type orderBookResponse struct {
	Symbol string           `json:"symbol"`
	Bids   []orderBookLevel `json:"bids"`
	Asks   []orderBookLevel `json:"asks"`
}

type orderBookLevel struct {
	Price  int64 `json:"price"`
	Volume int64 `json:"volume"`
}

func computeChange(price, prevClose int64) (int64, float64) {
	if prevClose <= 0 {
		return 0, 0
	}
	change := price - prevClose
	pct := float64(change) / float64(prevClose) * 100
	return change, pct
}

func convertLevels(levels []store.OrderBookLevel) []orderBookLevel {
	out := make([]orderBookLevel, 0, len(levels))
	for _, l := range levels {
		out = append(out, orderBookLevel{Price: l.Price, Volume: l.Volume})
	}
	return out
}

func (h *MarketHandler) ListStocks(w http.ResponseWriter, r *http.Request) {
	stocks, err := store.ListStocks()
	if err != nil {
		WriteJSON(w, http.StatusOK, map[string]any{"stocks": []stockInfo{}})
		return
	}

	period := r.URL.Query().Get("period")
	var periodStats map[uint]store.PeriodStockStats
	if period != "" {
		periodStats, _ = store.GetPeriodStatsForAllStocks(period)
	}

	list := make([]stockInfo, 0, len(stocks))
	for _, s := range stocks {
		change, changePct := computeChange(s.CurrentPrice, s.PrevClose)
		info := stockInfo{
			ID:           s.ID,
			Symbol:       s.Symbol,
			CurrentPrice: s.CurrentPrice,
			Change:       change,
			ChangePct:    changePct,
		}

		if ps, ok := periodStats[s.ID]; ok && ps.PeriodOpen > 0 {
			info.Open = ps.PeriodOpen
			info.High = ps.PeriodHigh
			info.Low = ps.PeriodLow
			info.Change = s.CurrentPrice - ps.PeriodOpen
			info.ChangePct = float64(s.CurrentPrice-ps.PeriodOpen) / float64(ps.PeriodOpen) * 100
		}

		list = append(list, info)
	}

	WriteJSON(w, http.StatusOK, map[string]any{"stocks": list})
}

func (h *MarketHandler) GetOrderBook(w http.ResponseWriter, r *http.Request) {
	symbol := r.PathValue("symbol")
	if symbol == "" {
		WriteJSON(w, http.StatusBadRequest, map[string]string{"error": "缺少股票代码"})
		return
	}

	stock, err := store.GetStockBySymbol(symbol)
	if err != nil {
		WriteJSON(w, http.StatusNotFound, map[string]string{"error": "股票不存在"})
		return
	}

	bids, asks, err := store.GetOrderBook(stock.ID)
	if err != nil {
		WriteJSON(w, http.StatusInternalServerError, map[string]string{"error": "获取盘口数据失败"})
		return
	}

	WriteJSON(w, http.StatusOK, orderBookResponse{
		Symbol: symbol,
		Bids:   convertLevels(bids),
		Asks:   convertLevels(asks),
	})
}

func (h *MarketHandler) GetStockDetail(w http.ResponseWriter, r *http.Request) {
	symbol := r.PathValue("symbol")
	if symbol == "" {
		WriteJSON(w, http.StatusBadRequest, map[string]string{"error": "缺少股票代码"})
		return
	}

	s, err := store.GetStockBySymbol(symbol)
	if err != nil {
		WriteJSON(w, http.StatusNotFound, map[string]string{"error": "股票不存在"})
		return
	}

	change, changePct := computeChange(s.CurrentPrice, s.PrevClose)

	bids, asks, err := store.GetOrderBook(s.ID)
	if err != nil {
		WriteJSON(w, http.StatusInternalServerError, map[string]string{"error": "获取盘口数据失败"})
		return
	}

	WriteJSON(w, http.StatusOK, stockDetail{
		stockInfo: stockInfo{
			ID:           s.ID,
			Symbol:       s.Symbol,
			CurrentPrice: s.CurrentPrice,
			Change:       change,
			ChangePct:    changePct,
		},
		PrevClose: s.PrevClose,
		Bids:      convertLevels(bids),
		Asks:      convertLevels(asks),
	})
}

func (h *MarketHandler) GetKline(w http.ResponseWriter, r *http.Request) {
	symbol := r.PathValue("symbol")
	if symbol == "" {
		WriteJSON(w, http.StatusBadRequest, map[string]string{"error": "缺少股票代码"})
		return
	}

	s, err := store.GetStockBySymbol(symbol)
	if err != nil {
		WriteJSON(w, http.StatusNotFound, map[string]string{"error": "股票不存在"})
		return
	}

	period := r.URL.Query().Get("period")
	if period == "" {
		period = "60t"
	}
	if period != "15t" && period != "60t" && period != "150t" {
		WriteJSON(w, http.StatusBadRequest, map[string]string{"error": "无效的K线周期"})
		return
	}

	limit := 100
	if l, err := strconv.Atoi(r.URL.Query().Get("limit")); err == nil && l > 0 && l <= 500 {
		limit = l
	}

	candles, err := store.GetCandles(s.ID, period, limit)
	if err != nil {
		WriteJSON(w, http.StatusOK, map[string]any{"candles": []domain.Candle{}})
		return
	}

	WriteJSON(w, http.StatusOK, map[string]any{"candles": candles})
}
