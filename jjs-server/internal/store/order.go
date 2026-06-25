package store

import (
	"time"

	"gorm.io/gorm"

	"jjs-server/internal/domain"
)

func CreateOrder(order *domain.Order) error {
	return DB.Create(order).Error
}

func GetOrderByID(orderID uint) (*domain.Order, error) {
	var o domain.Order
	if err := DB.First(&o, orderID).Error; err != nil {
		return nil, err
	}
	return &o, nil
}

func GetOrderByIDAndPlayer(orderID uint, playerID string) (*domain.Order, error) {
	var o domain.Order
	if err := DB.Where("id = ? AND player_id = ?", orderID, playerID).First(&o).Error; err != nil {
		return nil, err
	}
	return &o, nil
}

func SaveOrder(order *domain.Order) error {
	return DB.Save(order).Error
}

func UpdateOrderStatus(orderID uint, status string, filledQty int64) error {
	return DB.Model(&domain.Order{}).Where("id = ?", orderID).Updates(map[string]interface{}{
		"status":     status,
		"filled_qty": filledQty,
	}).Error
}

func GetOpenBuyOrdersByStock(stockID uint) ([]domain.Order, error) {
	var orders []domain.Order
	err := DB.Where("stock_id = ? AND side = 'buy' AND status IN ('open','partial')", stockID).
		Order("price DESC, seq_num ASC").
		Find(&orders).Error
	return orders, err
}

func GetOpenSellOrdersByStock(stockID uint) ([]domain.Order, error) {
	var orders []domain.Order
	err := DB.Where("stock_id = ? AND side = 'sell' AND status IN ('open','partial')", stockID).
		Order("price ASC, seq_num ASC").
		Find(&orders).Error
	return orders, err
}

func GetOpenOrdersByPlayer(playerID string) ([]domain.Order, error) {
	var orders []domain.Order
	err := DB.Where("player_id = ? AND status IN ('open','partial')", playerID).
		Order("created_at DESC").
		Find(&orders).Error
	return orders, err
}

func GetStaleBuyOrders(stockID uint, olderThan time.Time) ([]domain.Order, error) {
	var orders []domain.Order
	err := DB.Where("stock_id = ? AND side = 'buy' AND status IN ('open','partial') AND created_at < ?", stockID, olderThan).
		Order("price DESC, seq_num ASC").
		Find(&orders).Error
	return orders, err
}

func UpdateOrderFrozenAmount(tx *gorm.DB, orderID uint, frozenAmount int64) error {
	if frozenAmount < 0 {
		frozenAmount = 0
	}
	return tx.Model(&domain.Order{}).Where("id = ?", orderID).Update("frozen_amount", frozenAmount).Error
}
