package handler

import (
	"net/http"

	"jjs-server/internal/bots"
	"jjs-server/internal/store"
)

type AdminHandler struct {
	Scheduler *bots.Scheduler
}

func NewAdminHandler(s *bots.Scheduler) *AdminHandler {
	return &AdminHandler{Scheduler: s}
}

func (h *AdminHandler) BotMetrics(w http.ResponseWriter, r *http.Request) {
	WriteJSON(w, http.StatusOK, h.Scheduler.Metrics().Snapshot())
}

func (h *AdminHandler) BotTraders(w http.ResponseWriter, r *http.Request) {
	stocks, _ := store.ListStocks()
	stocksByID := make(map[uint]*bots.StockRef, len(stocks))
	for i := range stocks {
		stocksByID[stocks[i].ID] = &bots.StockRef{ID: stocks[i].ID, CurrentPrice: stocks[i].CurrentPrice}
	}
	WriteJSON(w, http.StatusOK, h.Scheduler.GatherTraderStats(stocksByID))
}
