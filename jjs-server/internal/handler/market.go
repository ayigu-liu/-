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
	Volume       int64   `json:"volume"`
}

type stockDetail struct {
	stockInfo
	PrevClose int64           `json:"prev_close"`
	Turnover  int64           `json:"turnover"`
	PE        float64         `json:"pe"`
	EPS       float64         `json:"eps"`
	NAV       float64         `json:"nav"`
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

func (h *MarketHandler) ListStocks(w http.ResponseWriter, r *http.Request) {
	stocks, err := store.ListStocks()
	if err != nil {
		WriteJSON(w, http.StatusOK, map[string]any{"stocks": []stockInfo{}})
		return
	}

	list := make([]stockInfo, 0, len(stocks))
	for _, s := range stocks {
		list = append(list, stockInfo{
			ID:           s.ID,
			Symbol:       s.Symbol,
			CurrentPrice: s.CurrentPrice,
			Change:       s.Change,
			ChangePct:    s.ChangePercent,
			Open:         s.Open,
			High:         s.High,
			Low:          s.Low,
			Volume:       s.Volume,
		})
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

	resp := orderBookResponse{
		Symbol: symbol,
		Bids:   buildOrderBookLevels(stock, "bid"),
		Asks:   buildOrderBookLevels(stock, "ask"),
	}

	WriteJSON(w, http.StatusOK, resp)
}

func buildOrderBookLevels(s *domain.Stock, side string) []orderBookLevel {
	if side == "bid" {
		levels := []struct{ p, v int64 }{
			{s.BidPrice1, s.BidVol1},
			{s.BidPrice2, s.BidVol2},
			{s.BidPrice3, s.BidVol3},
			{s.BidPrice4, s.BidVol4},
			{s.BidPrice5, s.BidVol5},
		}
		out := make([]orderBookLevel, 0, 5)
		for _, l := range levels {
			if l.v > 0 {
				out = append(out, orderBookLevel{Price: l.p, Volume: l.v})
			}
		}
		return out
	}

	levels := []struct{ p, v int64 }{
		{s.AskPrice1, s.AskVol1},
		{s.AskPrice2, s.AskVol2},
		{s.AskPrice3, s.AskVol3},
		{s.AskPrice4, s.AskVol4},
		{s.AskPrice5, s.AskVol5},
	}
	out := make([]orderBookLevel, 0, 5)
	for _, l := range levels {
		if l.v > 0 {
			out = append(out, orderBookLevel{Price: l.p, Volume: l.v})
		}
	}
	return out
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

	WriteJSON(w, http.StatusOK, stockDetail{
		stockInfo: stockInfo{
			ID:           s.ID,
			Symbol:       s.Symbol,
			CurrentPrice: s.CurrentPrice,
			Change:       s.Change,
			ChangePct:    s.ChangePercent,
			Open:         s.Open,
			High:         s.High,
			Low:          s.Low,
			Volume:       s.Volume,
		},
		PrevClose: s.PrevClose,
		Turnover:  s.Turnover,
		PE:        s.PE,
		EPS:       s.EPS,
		NAV:       s.NAV,
		Bids:      buildOrderBookLevels(s, "bid"),
		Asks:      buildOrderBookLevels(s, "ask"),
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
