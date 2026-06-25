package handler

import (
	"encoding/json"
	"net/http"

	"jjs-server/internal/domain"
	"jjs-server/internal/engine"
	"jjs-server/internal/middleware"
	"jjs-server/internal/store"
)

type TradeHandler struct{}

type placeOrderRequest struct {
	StockID uint   `json:"stock_id"`
	Symbol  string `json:"symbol"`
	Type    string `json:"type"`  // "limit" | "market"
	Side    string `json:"side"`  // "buy" | "sell"
	Price   int64  `json:"price"` // 分, 市价单传 0
	Qty     int64  `json:"qty"`
}

type placeOrderResponse struct {
	OrderID     uint           `json:"order_id"`
	FilledQty   int64          `json:"filled_qty"`
	UnfilledQty int64          `json:"unfilled_qty"`
	Status      string         `json:"status"`
	Trades      []domain.Trade `json:"trades,omitempty"`
}

func (h *TradeHandler) PlaceOrder(w http.ResponseWriter, r *http.Request) {
	userID, ok := middleware.GetUserID(r)
	if !ok {
		WriteJSON(w, http.StatusUnauthorized, map[string]string{"error": "未登录"})
		return
	}

	var req placeOrderRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		WriteJSON(w, http.StatusBadRequest, map[string]string{"error": "请求格式错误"})
		return
	}

	if req.Side != "buy" && req.Side != "sell" {
		WriteJSON(w, http.StatusBadRequest, map[string]string{"error": "无效的买卖方向"})
		return
	}

	if req.Type != "limit" && req.Type != "market" {
		WriteJSON(w, http.StatusBadRequest, map[string]string{"error": "无效的订单类型"})
		return
	}

	if req.Qty <= 0 {
		WriteJSON(w, http.StatusBadRequest, map[string]string{"error": "数量必须大于 0"})
		return
	}

	var stockID uint
	if req.StockID > 0 {
		stockID = req.StockID
	} else if req.Symbol != "" {
		stock, err := store.GetStockBySymbol(req.Symbol)
		if err != nil {
			WriteJSON(w, http.StatusNotFound, map[string]string{"error": "股票不存在"})
			return
		}
		stockID = stock.ID
	} else {
		WriteJSON(w, http.StatusBadRequest, map[string]string{"error": "缺少股票信息"})
		return
	}

	order := &domain.Order{
		StockID:  stockID,
		PlayerID: userID,
		Type:     req.Type,
		Side:     req.Side,
		Price:    req.Price,
		Qty:      req.Qty,
	}

	result, err := engine.ExecuteOrder(store.DB, order)
	if err != nil {
		WriteJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}

	WriteJSON(w, http.StatusOK, placeOrderResponse{
		OrderID:     result.OrderID,
		FilledQty:   result.FilledQty,
		UnfilledQty: result.UnfilledQty,
		Status:      result.Status,
		Trades:      result.Trades,
	})
}

func (h *TradeHandler) CancelOrder(w http.ResponseWriter, r *http.Request) {
	userID, ok := middleware.GetUserID(r)
	if !ok {
		WriteJSON(w, http.StatusUnauthorized, map[string]string{"error": "未登录"})
		return
	}

	var req struct {
		OrderID uint `json:"order_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		WriteJSON(w, http.StatusBadRequest, map[string]string{"error": "请求格式错误"})
		return
	}

	if err := engine.CancelOrder(store.DB, req.OrderID, userID); err != nil {
		WriteJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}

	WriteJSON(w, http.StatusOK, map[string]string{"status": "cancelled"})
}

func (h *TradeHandler) MyOrders(w http.ResponseWriter, r *http.Request) {
	userID, ok := middleware.GetUserID(r)
	if !ok {
		WriteJSON(w, http.StatusUnauthorized, map[string]string{"error": "未登录"})
		return
	}

	orders, err := store.GetOpenOrdersByPlayer(userID)
	if err != nil {
		WriteJSON(w, http.StatusOK, map[string]any{"orders": []domain.Order{}})
		return
	}

	WriteJSON(w, http.StatusOK, map[string]any{"orders": orders})
}

type holdingItem struct {
	StockID     uint   `json:"stock_id"`
	Symbol      string `json:"symbol"`
	Qty         int64  `json:"qty"`
	AvgCost     int64  `json:"avg_cost"`
	FrozenQty   int64  `json:"frozen_qty"`
	CurrentPrice int64 `json:"current_price"`
	MarketValue int64  `json:"market_value"`
	ProfitLoss  int64  `json:"profit_loss"` // in 分
}

type portfolioResponse struct {
	Cash       int64         `json:"cash"`
	FrozenCash int64         `json:"frozen_cash"`
	Holdings   []holdingItem `json:"holdings"`
	TotalValue int64         `json:"total_value"` // 元
}

func (h *TradeHandler) Portfolio(w http.ResponseWriter, r *http.Request) {
	userID, ok := middleware.GetUserID(r)
	if !ok {
		WriteJSON(w, http.StatusUnauthorized, map[string]string{"error": "未登录"})
		return
	}

	ps, err := store.GetPlayerState(userID)
	if err != nil {
		WriteJSON(w, http.StatusInternalServerError, map[string]string{"error": "获取玩家状态失败"})
		return
	}

	holdings, err := store.GetHoldingsByPlayer(userID)
	if err != nil {
		holdings = []domain.Holding{}
	}

	items := make([]holdingItem, 0, len(holdings))
	totalMarketValue := int64(0)

	for _, h := range holdings {
		stock, err := store.GetStockByID(h.StockID)
		if err != nil {
			continue
		}
		mv := stock.CurrentPrice * h.Qty
		totalMarketValue += mv
		pl := (stock.CurrentPrice - h.AvgCost) * h.Qty

		items = append(items, holdingItem{
			StockID:      h.StockID,
			Symbol:       stock.Symbol,
			Qty:          h.Qty,
			AvgCost:      h.AvgCost,
			FrozenQty:    h.FrozenQty,
			CurrentPrice: stock.CurrentPrice,
			MarketValue:  mv,
			ProfitLoss:   pl,
		})
	}

	totalValue := ps.Cash + totalMarketValue/100

	WriteJSON(w, http.StatusOK, portfolioResponse{
		Cash:       ps.Cash,
		FrozenCash: ps.FrozenCash,
		Holdings:   items,
		TotalValue: totalValue,
	})
}
