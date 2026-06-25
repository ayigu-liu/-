package engine

import (
	"log/slog"
	"time"

	"gorm.io/gorm"

	"jjs-server/internal/config"
	"jjs-server/internal/domain"
	"jjs-server/internal/store"
)

func ReleaseBrokerInventory(db *gorm.DB) {
	stocks, err := store.ListStocks()
	if err != nil {
		slog.Error("broker: list stocks failed", "error", err)
		return
	}

	staleThreshold := time.Now().Add(-time.Duration(config.StaleOrderTicks) * config.PriceTickInterval)

	for _, stock := range stocks {
		bi, err := store.GetBrokerInventory(stock.ID)
		if err != nil || bi.TotalQty <= 0 {
			continue
		}

		staleBuys, err := store.GetStaleBuyOrders(stock.ID, staleThreshold)
		if err != nil || len(staleBuys) == 0 {
			continue
		}

		_ = ensureBrokerPlayerState(db)

		for _, buy := range staleBuys {
			if bi.TotalQty <= 0 {
				break
			}

			if buy.Price < stock.CurrentPrice*9/10 {
				continue
			}

			unfilled := buy.Qty - buy.FilledQty
			fillQty := unfilled
			if fillQty > bi.TotalQty {
				fillQty = bi.TotalQty
			}
			if fillQty <= 0 {
				continue
			}

			tradePrice := buy.Price

			err := func() error {
				tx := db.Begin()

			fillAmountYuan := centsToYuan(tradePrice * fillQty)
			buyCommission := calcCommission(fillAmountYuan)

			trade := domain.Trade{
				StockID:     stock.ID,
				BuyerID:     buy.PlayerID,
				SellerID:    config.SystemBrokerID,
				BuyOrderID:  buy.ID,
				SellOrderID: 0,
				Price:       tradePrice,
				Qty:         fillQty,
				TotalAmount: tradePrice * fillQty,
				TradeTime:   time.Now(),
			}
			if err := tx.Create(&trade).Error; err != nil {
				tx.Rollback()
				return err
			}

			buyerHolding, err := store.GetOrCreateHolding(tx, buy.PlayerID, stock.ID)
			if err != nil {
				tx.Rollback()
				return err
			}
			totalCost := int64(buyerHolding.Qty)*buyerHolding.AvgCost + tradePrice*fillQty
			buyerHolding.Qty += fillQty
			if buyerHolding.Qty > 0 {
				buyerHolding.AvgCost = totalCost / buyerHolding.Qty
			}
			if err := tx.Save(buyerHolding).Error; err != nil {
				tx.Rollback()
				return err
			}

			buyCost := fillAmountYuan + buyCommission
			if err := store.DeductFrozenCash(tx, buy.PlayerID, buyCost); err != nil {
				tx.Rollback()
				return nil
			}
				if err := store.UpdateOrderFrozenAmount(tx, buy.ID, buy.FrozenAmount-buyCost); err != nil {
					tx.Rollback()
					return nil
				}

				buy.FilledQty += fillQty
				newStatus := "partial"
				if buy.FilledQty >= buy.Qty {
					newStatus = "filled"
				}

				if err := store.DeductBrokerInventory(tx, stock.ID, fillQty); err != nil {
					tx.Rollback()
					return err
				}

				if err := tx.Model(&domain.Order{}).Where("id = ?", buy.ID).Updates(map[string]interface{}{
					"filled_qty": buy.FilledQty,
					"status":     newStatus,
				}).Error; err != nil {
					tx.Rollback()
					return err
				}

				if err := store.AddCash(tx, config.SystemBrokerID, fillAmountYuan); err != nil {
					tx.Rollback()
					return err
				}

				if err := store.UpdateStockFromTrade(tx, stock.ID, tradePrice); err != nil {
					tx.Rollback()
					return err
				}
			updateCandlesForTrade(tx, stock.ID, time.Now(), tradePrice, fillQty)

			if err := tx.Commit().Error; err != nil {
					return err
				}

				bi.TotalQty -= fillQty
				return nil
			}()

			if err != nil {
				slog.Error("broker: release failed", "stockID", stock.ID, "buyOrderID", buy.ID, "error", err)
			}
		}
	}
}

func ensureBrokerPlayerState(db *gorm.DB) error {
	var count int64
	if err := db.Model(&domain.PlayerState{}).Where("player_id = ?", config.SystemBrokerID).Count(&count).Error; err != nil {
		return err
	}
	if count == 0 {
		return db.Create(&domain.PlayerState{
			PlayerID:   config.SystemBrokerID,
			Nickname:   "证券机构",
			Cash:       0,
			FrozenCash: 0,
		}).Error
	}
	return nil
}
