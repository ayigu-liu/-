package store

import (
	"gorm.io/gorm"

	"jjs-server/internal/domain"
)

func ListStocks() ([]domain.Stock, error) {
	var stocks []domain.Stock
	err := DB.Find(&stocks).Error
	return stocks, err
}

func GetStockByID(stockID uint) (*domain.Stock, error) {
	var s domain.Stock
	if err := DB.First(&s, stockID).Error; err != nil {
		return nil, err
	}
	return &s, nil
}

func GetStockBySymbol(symbol string) (*domain.Stock, error) {
	var s domain.Stock
	if err := DB.Where("symbol = ?", symbol).First(&s).Error; err != nil {
		return nil, err
	}
	return &s, nil
}

func UpdateStockFromTrade(tx *gorm.DB, stockID uint, price int64) error {
	return tx.Model(&domain.Stock{}).Where("id = ?", stockID).Update("current_price", price).Error
}

type OrderBookLevel struct {
	Price  int64
	Volume int64
}

func GetOrderBook(stockID uint) (bids []OrderBookLevel, asks []OrderBookLevel, err error) {
	err = DB.Raw(`
		SELECT price, SUM(qty - filled_qty) as volume
		FROM orders
		WHERE stock_id = ? AND side = 'buy' AND type = 'limit' AND status IN ('open','partial')
		GROUP BY price ORDER BY price DESC LIMIT 5
	`, stockID).Scan(&bids).Error
	if err != nil {
		return nil, nil, err
	}

	err = DB.Raw(`
		SELECT price, SUM(qty - filled_qty) as volume
		FROM orders
		WHERE stock_id = ? AND side = 'sell' AND type = 'limit' AND status IN ('open','partial')
		GROUP BY price ORDER BY price ASC LIMIT 5
	`, stockID).Scan(&asks).Error
	if err != nil {
		return nil, nil, err
	}

	return bids, asks, nil
}
