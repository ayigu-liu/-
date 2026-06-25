package engine

import (
	"errors"
	"math"
	"sync/atomic"
	"time"

	"gorm.io/gorm"

	"jjs-server/internal/config"
	"jjs-server/internal/domain"
	"jjs-server/internal/store"
)

var globalSeqNum atomic.Int64

func NextSeqNum() int64 {
	return globalSeqNum.Add(1)
}

func updateCandlesForTrade(tx *gorm.DB, stockID uint, tradeTime time.Time, price int64, qty int64) {
	for _, period := range []struct {
		name    string
		seconds int64
	}{
		{"15t", 30},
		{"60t", 120},
		{"150t", 300},
	} {
		openTime := candleOpenTime(tradeTime, period.seconds)
		if err := store.UpsertCandleWithTx(tx, stockID, period.name, openTime, price, qty); err != nil {
			// non-critical, log only
		}
	}
}

func centsToYuan(cents int64) float64 {
	return float64(cents) / 100.0
}

func calcCommission(tradeAmountYuan float64) float64 {
	c := tradeAmountYuan * config.CommissionRate
	if c < config.MinCommission {
		return config.MinCommission
	}
	return c
}

func calcStampTax(tradeAmountYuan float64) float64 {
	return tradeAmountYuan * config.StampTaxRate
}

type ExecuteResult struct {
	OrderID     uint
	FilledQty   int64
	UnfilledQty int64
	Status      string
	Trades      []domain.Trade
}

func ExecuteOrder(db *gorm.DB, order *domain.Order) (*ExecuteResult, error) {
	stock, err := store.GetStockByID(order.StockID)
	if err != nil {
		return nil, errors.New("股票不存在")
	}

	order.SeqNum = NextSeqNum()
	order.CreatedAt = time.Now()

	tx := db.Begin()

	if order.Side == "buy" {
		return executeBuy(tx, order, stock)
	}
	return executeSell(tx, order, stock)
}

func executeBuy(tx *gorm.DB, order *domain.Order, stock *domain.Stock) (*ExecuteResult, error) {
	var estimatedCost float64
	if order.Type == "limit" {
		estimatedCost = centsToYuan(order.Price*order.Qty) + calcCommission(centsToYuan(order.Price*order.Qty))
	} else {
		estPrice := stock.CurrentPrice
		if estPrice == 0 {
			estPrice = config.InitialPrice
		}
		estimatedCost = centsToYuan(estPrice*order.Qty) * 1.2
	}

	if err := store.FreezeCash(tx, order.PlayerID, estimatedCost); err != nil {
		tx.Rollback()
		return nil, errors.New("资金不足")
	}
	order.FrozenAmount = estimatedCost

	var opponentOrders []domain.Order
	if order.Type == "limit" {
		if err := tx.Where("stock_id = ? AND side = 'sell' AND type = 'limit' AND status IN ('open','partial') AND price <= ?",
			order.StockID, order.Price).
			Order("price ASC, seq_num ASC").
			Find(&opponentOrders).Error; err != nil {
			tx.Rollback()
			return nil, err
		}
	} else {
		var err error
		opponentOrders, err = store.GetOpenSellOrdersByStock(order.StockID)
		if err != nil {
			tx.Rollback()
			return nil, err
		}
	}

	var trades []domain.Trade
	var totalBuySpent float64
	remaining := order.Qty

	for i := range opponentOrders {
		if remaining <= 0 {
			break
		}
		opp := &opponentOrders[i]

		fillQty := opp.Qty - opp.FilledQty
		if fillQty > remaining {
			fillQty = remaining
		}
		if fillQty <= 0 {
			continue
		}

		tradePrice := opp.Price
		fillAmountYuan := centsToYuan(tradePrice * fillQty)
		buyCommission := calcCommission(fillAmountYuan)
		buyCost := fillAmountYuan + buyCommission

		sellCommission := calcCommission(fillAmountYuan)
		sellTax := calcStampTax(fillAmountYuan)
		sellRevenue := fillAmountYuan - sellCommission - sellTax

		trade := domain.Trade{
			StockID:     order.StockID,
			BuyerID:     order.PlayerID,
			SellerID:    opp.PlayerID,
			BuyOrderID:  order.ID,
			SellOrderID: opp.ID,
			Price:       tradePrice,
			Qty:         fillQty,
			TotalAmount: tradePrice * fillQty,
			TradeTime:   time.Now(),
		}
		if order.ID != 0 {
			trade.BuyOrderID = order.ID
		}
		trade.SellOrderID = opp.ID

		if err := tx.Create(&trade).Error; err != nil {
			tx.Rollback()
			return nil, err
		}
		trades = append(trades, trade)

		buyerHolding, err := store.GetOrCreateHolding(tx, order.PlayerID, order.StockID)
		if err != nil {
			tx.Rollback()
			return nil, err
		}
		totalCost := int64(buyerHolding.Qty)*buyerHolding.AvgCost + tradePrice*fillQty
		buyerHolding.Qty += fillQty
		if buyerHolding.Qty > 0 {
			buyerHolding.AvgCost = totalCost / buyerHolding.Qty
		}
		if err := tx.Save(buyerHolding).Error; err != nil {
			tx.Rollback()
			return nil, err
		}

		if opp.PlayerID != config.SystemBrokerID {
			if err := store.DeductHoldingQtyByPlayerStock(tx, opp.PlayerID, order.StockID, fillQty); err != nil {
				tx.Rollback()
				return nil, err
			}
			if err := store.AddCash(tx, opp.PlayerID, sellRevenue); err != nil {
				tx.Rollback()
				return nil, err
			}
		}

		opp.FilledQty += fillQty
		newStatus := "partial"
		if opp.FilledQty >= opp.Qty {
			newStatus = "filled"
		}
		if err := tx.Model(&domain.Order{}).Where("id = ?", opp.ID).Updates(map[string]interface{}{
			"filled_qty": opp.FilledQty,
			"status":     newStatus,
		}).Error; err != nil {
			tx.Rollback()
			return nil, err
		}

		totalBuySpent += buyCost
		remaining -= fillQty
		order.FilledQty += fillQty

		if err := store.UpdateStockFromTrade(tx, order.StockID, tradePrice); err != nil {
			tx.Rollback()
			return nil, err
		}
		updateCandlesForTrade(tx, order.StockID, time.Now(), tradePrice, fillQty)
	}

	filledQty := order.Qty - remaining
	order.Status = "open"
	if filledQty > 0 {
		order.Status = "partial"
		if remaining == 0 {
			order.Status = "filled"
		}
	}
	if order.Type == "market" && remaining > 0 {
		order.Status = "cancelled"
	}

	if err := store.DeductFrozenCash(tx, order.PlayerID, totalBuySpent); err != nil {
		tx.Rollback()
		return nil, err
	}
	order.FrozenAmount -= totalBuySpent

	if order.Status == "filled" || order.Status == "cancelled" {
		if order.FrozenAmount > 0 {
			if err := store.UnfreezeCash(tx, order.PlayerID, order.FrozenAmount); err != nil {
				tx.Rollback()
				return nil, err
			}
			order.FrozenAmount = 0
		}
	}

	if order.Type == "limit" && (order.Status == "open" || order.Status == "partial") {
		if order.ID == 0 {
			if err := tx.Create(order).Error; err != nil {
				tx.Rollback()
				return nil, err
			}
		} else {
			if err := tx.Save(order).Error; err != nil {
				tx.Rollback()
				return nil, err
			}
		}
	}

	if order.Status != "cancelled" && order.ID != 0 {
		if err := store.UpdateOrderFrozenAmount(tx, order.ID, order.FrozenAmount); err != nil {
			tx.Rollback()
			return nil, err
		}
	}

	for i := range trades {
		if trades[i].BuyOrderID == 0 {
			trades[i].BuyOrderID = order.ID
		}
	}

	if err := tx.Commit().Error; err != nil {
		return nil, err
	}

	if OnTradeExecuted != nil {
		affected := map[string]bool{order.PlayerID: true}
		for _, tr := range trades {
			if tr.SellerID != config.SystemBrokerID {
				affected[tr.SellerID] = true
			}
		}
		for pid := range affected {
			OnTradeExecuted(pid, "")
		}
	}

	return &ExecuteResult{
		OrderID:     order.ID,
		FilledQty:   order.FilledQty,
		UnfilledQty: order.Qty - order.FilledQty,
		Status:      order.Status,
		Trades:      trades,
	}, nil
}

func executeSell(tx *gorm.DB, order *domain.Order, stock *domain.Stock) (*ExecuteResult, error) {
	holding, err := store.GetHolding(tx, order.PlayerID, order.StockID)
	if err != nil {
		tx.Rollback()
		return nil, errors.New("未持有该股票")
	}

	available := holding.Qty - holding.FrozenQty
	if available < order.Qty {
		tx.Rollback()
		return nil, errors.New("可用持仓不足")
	}

	if err := store.FreezeHoldingQty(tx, holding.ID, order.Qty); err != nil {
		tx.Rollback()
		return nil, err
	}

	var opponentOrders []domain.Order
	if order.Type == "limit" {
		if err := tx.Where("stock_id = ? AND side = 'buy' AND type = 'limit' AND status IN ('open','partial') AND price >= ?",
			order.StockID, order.Price).
			Order("price DESC, seq_num ASC").
			Find(&opponentOrders).Error; err != nil {
			tx.Rollback()
			return nil, err
		}
	} else {
		opponentOrders, err = store.GetOpenBuyOrdersByStock(order.StockID)
		if err != nil {
			tx.Rollback()
			return nil, err
		}
	}

	var trades []domain.Trade
	var totalSellRevenue float64
	remaining := order.Qty

	for i := range opponentOrders {
		if remaining <= 0 {
			break
		}
		opp := &opponentOrders[i]

		fillQty := opp.Qty - opp.FilledQty
		if fillQty > remaining {
			fillQty = remaining
		}
		if fillQty <= 0 {
			continue
		}

		tradePrice := opp.Price
		fillAmountYuan := centsToYuan(tradePrice * fillQty)
		buyCommission := calcCommission(fillAmountYuan)
		buyCost := fillAmountYuan + buyCommission

		sellCommission := calcCommission(fillAmountYuan)
		sellTax := calcStampTax(fillAmountYuan)
		sellRevenue := fillAmountYuan - sellCommission - sellTax

		trade := domain.Trade{
			StockID:     order.StockID,
			BuyerID:     opp.PlayerID,
			SellerID:    order.PlayerID,
			BuyOrderID:  opp.ID,
			SellOrderID: order.ID,
			Price:       tradePrice,
			Qty:         fillQty,
			TotalAmount: tradePrice * fillQty,
			TradeTime:   time.Now(),
		}
		if order.ID != 0 {
			trade.SellOrderID = order.ID
		}

		if err := tx.Create(&trade).Error; err != nil {
			tx.Rollback()
			return nil, err
		}
		trades = append(trades, trade)

		buyerHolding, err := store.GetOrCreateHolding(tx, opp.PlayerID, order.StockID)
		if err != nil {
			tx.Rollback()
			return nil, err
		}
		totalCost := int64(buyerHolding.Qty)*buyerHolding.AvgCost + tradePrice*fillQty
		buyerHolding.Qty += fillQty
		if buyerHolding.Qty > 0 {
			buyerHolding.AvgCost = totalCost / buyerHolding.Qty
		}
		if err := tx.Save(buyerHolding).Error; err != nil {
			tx.Rollback()
			return nil, err
		}

		if err := store.DeductFrozenCash(tx, opp.PlayerID, buyCost); err != nil {
			tx.Rollback()
			return nil, err
		}
		if err := store.UpdateOrderFrozenAmount(tx, opp.ID, opp.FrozenAmount-buyCost); err != nil {
			tx.Rollback()
			return nil, err
		}

		opp.FilledQty += fillQty
		newStatus := "partial"
		if opp.FilledQty >= opp.Qty {
			newStatus = "filled"
			if opp.FrozenAmount > 0.005 {
				remainingFrozen := opp.FrozenAmount
				if err := store.UnfreezeCash(tx, opp.PlayerID, remainingFrozen); err != nil {
					tx.Rollback()
					return nil, err
				}
			}
		}
		if err := tx.Model(&domain.Order{}).Where("id = ?", opp.ID).Updates(map[string]interface{}{
			"filled_qty": opp.FilledQty,
			"status":     newStatus,
		}).Error; err != nil {
			tx.Rollback()
			return nil, err
		}

		totalSellRevenue += sellRevenue
		remaining -= fillQty
		order.FilledQty += fillQty

		if err := store.UpdateStockFromTrade(tx, order.StockID, tradePrice); err != nil {
			tx.Rollback()
			return nil, err
		}
		updateCandlesForTrade(tx, order.StockID, time.Now(), tradePrice, fillQty)
	}

	if totalSellRevenue > 0 {
		if err := store.AddCash(tx, order.PlayerID, totalSellRevenue); err != nil {
			tx.Rollback()
			return nil, err
		}
	}

	filledQty := order.Qty - remaining
	order.Status = "open"
	if filledQty > 0 {
		order.Status = "partial"
		if remaining == 0 {
			order.Status = "filled"
		}
	}
	if order.Type == "market" && remaining > 0 {
		order.Status = "cancelled"
	}

	if order.Status == "filled" || order.Status == "cancelled" {
		if err := store.UnfreezeHoldingQty(tx, holding.ID, remaining); err != nil {
			tx.Rollback()
			return nil, err
		}

		actualDeducted := order.Qty - remaining
		if actualDeducted > 0 {
			if err := tx.Model(&domain.Holding{}).Where("id = ? AND frozen_qty >= ?", holding.ID, actualDeducted).
				Updates(map[string]interface{}{
					"qty":        gorm.Expr("qty - ?", actualDeducted),
					"frozen_qty": gorm.Expr("frozen_qty - ?", actualDeducted),
				}).Error; err != nil {
				tx.Rollback()
				return nil, err
			}
		}
	}

	if order.Type == "limit" && (order.Status == "open" || order.Status == "partial") {
		if order.ID == 0 {
			if err := tx.Create(order).Error; err != nil {
				tx.Rollback()
				return nil, err
			}
		} else {
			if err := tx.Save(order).Error; err != nil {
				tx.Rollback()
				return nil, err
			}
		}
	}

	for i := range trades {
		if trades[i].SellOrderID == 0 {
			trades[i].SellOrderID = order.ID
		}
	}

	if err := tx.Commit().Error; err != nil {
		return nil, err
	}

	if OnTradeExecuted != nil {
		affected := map[string]bool{order.PlayerID: true}
		for _, tr := range trades {
			if tr.BuyerID != config.SystemBrokerID {
				affected[tr.BuyerID] = true
			}
		}
		for pid := range affected {
			OnTradeExecuted(pid, "")
		}
	}

	return &ExecuteResult{
		OrderID:     order.ID,
		FilledQty:   order.FilledQty,
		UnfilledQty: order.Qty - order.FilledQty,
		Status:      order.Status,
		Trades:      trades,
	}, nil
}

func CancelOrder(db *gorm.DB, orderID uint, playerID string) error {
	tx := db.Begin()

	order, err := store.GetOrderByIDAndPlayer(orderID, playerID)
	if err != nil {
		tx.Rollback()
		return errors.New("订单不存在")
	}

	if order.Status != "open" && order.Status != "partial" {
		tx.Rollback()
		return errors.New("订单无法撤销")
	}

	unfilledQty := order.Qty - order.FilledQty

	if order.Side == "buy" && order.FrozenAmount > 0 {
		if err := store.UnfreezeCash(tx, order.PlayerID, order.FrozenAmount); err != nil {
			tx.Rollback()
			return err
		}
	}

	if order.Side == "sell" && unfilledQty > 0 {
		holding, err := store.GetHolding(tx, order.PlayerID, order.StockID)
		if err != nil {
			tx.Rollback()
			return err
		}
		if err := store.UnfreezeHoldingQty(tx, holding.ID, unfilledQty); err != nil {
			tx.Rollback()
			return err
		}
	}

	order.Status = "cancelled"
	order.FrozenAmount = 0
	if err := tx.Save(order).Error; err != nil {
		tx.Rollback()
		return err
	}

	return tx.Commit().Error
}

var (
	_ = math.MaxInt64
)
