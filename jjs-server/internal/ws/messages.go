package ws

import (
	"encoding/json"

	"jjs-server/internal/domain"
)

type wsEnvelope struct {
	Type string      `json:"type"`
	Data interface{} `json:"data"`
}

type stockSnapshot struct {
	Symbol            string  `json:"symbol"`
	Name              string  `json:"name"`
	Price             int64   `json:"price"`
	Change            int64   `json:"change"`
	ChangePercent     float64 `json:"changePercent"`
	MarketCap         int64   `json:"marketCap"`
	SharesOutstanding int64   `json:"sharesOutstanding"`
}

type portfolioHolding struct {
	Symbol       string  `json:"symbol"`
	Name         string  `json:"name"`
	Qty          int64   `json:"qty"`
	CostPrice    int64   `json:"costPrice"`
	CurrentPrice int64   `json:"currentPrice"`
	MarketValue  int64   `json:"marketValue"`
	Pnl          int64   `json:"pnl"`
	PnlPercent   float64 `json:"pnlPercent"`
}

type portfolioData struct {
	Cash       int64             `json:"cash"`
	FrozenCash int64             `json:"frozenCash"`
	Holdings   []portfolioHolding `json:"holdings"`
}

func BuildPriceUpdate(stocks []domain.Stock, companyMap map[string]*domain.Company, tick int64) []byte {
	data := make(map[string]interface{}, len(stocks)+1)
	for _, s := range stocks {
		name := s.Symbol
		shares := int64(0)
		if c, ok := companyMap[s.Symbol]; ok {
			name = c.Name
			shares = c.TotalShares
		}
		change := int64(0)
		changePct := float64(0)
		if s.PrevClose > 0 {
			change = s.CurrentPrice - s.PrevClose
			changePct = float64(change) / float64(s.PrevClose) * 100
		}
		data[s.Symbol] = stockSnapshot{
			Symbol:            s.Symbol,
			Name:              name,
			Price:             s.CurrentPrice,
			Change:            change,
			ChangePercent:     changePct,
			MarketCap:         s.CurrentPrice * shares,
			SharesOutstanding: shares,
		}
	}
	data["tick"] = tick

	msg, _ := json.Marshal(wsEnvelope{Type: "price_update", Data: data})
	return msg
}

func BuildPortfolioUpdate(cash, frozenCash int64, holdings []domain.Holding, stocks map[uint]*domain.Stock, companyMap map[string]*domain.Company) []byte {
	items := make([]portfolioHolding, 0, len(holdings))
	for _, h := range holdings {
		stock, ok := stocks[h.StockID]
		if !ok {
			continue
		}
		name := stock.Symbol
		if c, ok := companyMap[stock.Symbol]; ok {
			name = c.Name
		}
		marketValue := stock.CurrentPrice * h.Qty
		pnl := (stock.CurrentPrice - h.AvgCost) * h.Qty
		pnlPct := float64(0)
		if h.AvgCost > 0 {
			pnlPct = float64(stock.CurrentPrice-h.AvgCost) / float64(h.AvgCost) * 100
		}
		items = append(items, portfolioHolding{
			Symbol:       stock.Symbol,
			Name:         name,
			Qty:          h.Qty,
			CostPrice:    h.AvgCost,
			CurrentPrice: stock.CurrentPrice,
			MarketValue:  marketValue,
			Pnl:          pnl,
			PnlPercent:   pnlPct,
		})
	}
	if items == nil {
		items = []portfolioHolding{}
	}

	msg, _ := json.Marshal(wsEnvelope{
		Type: "portfolio_update",
		Data: portfolioData{
			Cash:       cash,
			FrozenCash: frozenCash,
			Holdings:   items,
		},
	})
	return msg
}
