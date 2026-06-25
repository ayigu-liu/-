package store

import (
	"errors"

	"gorm.io/gorm"

	"jjs-server/internal/config"
	"jjs-server/internal/domain"
)

func GetPlayerState(playerID string) (*domain.PlayerState, error) {
	var ps domain.PlayerState
	err := DB.Where("player_id = ?", playerID).First(&ps).Error
	if err != nil {
		return nil, err
	}
	return &ps, nil
}

func GetOrCreatePlayerState(playerID, nickname string) (*domain.PlayerState, error) {
	ps, err := GetPlayerState(playerID)
	if err == nil {
		return ps, nil
	}
	if err != gorm.ErrRecordNotFound {
		return nil, err
	}

	ps = &domain.PlayerState{
		PlayerID: playerID,
		Nickname: nickname,
		Cash:     config.StartingCash,
	}
	if err := DB.Create(ps).Error; err != nil {
		return nil, err
	}
	return ps, nil
}

func FreezeCash(db *gorm.DB, playerID string, amount int64) error {
	if amount <= 0 {
		return nil
	}
	result := db.Model(&domain.PlayerState{}).Where("player_id = ? AND cash >= ?", playerID, amount).
		Updates(map[string]interface{}{
			"cash":        gorm.Expr("cash - ?", amount),
			"frozen_cash": gorm.Expr("frozen_cash + ?", amount),
		})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return errors.New("资金不足")
	}
	return nil
}

func UnfreezeCash(db *gorm.DB, playerID string, amount int64) error {
	if amount <= 0 {
		return nil
	}
	result := db.Model(&domain.PlayerState{}).Where("player_id = ? AND frozen_cash >= ?", playerID, amount).
		Updates(map[string]interface{}{
			"cash":        gorm.Expr("cash + ?", amount),
			"frozen_cash": gorm.Expr("frozen_cash - ?", amount),
		})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return errors.New("冻结资金不足")
	}
	return nil
}

func DeductFrozenCash(db *gorm.DB, playerID string, amount int64) error {
	if amount <= 0 {
		return nil
	}
	result := db.Model(&domain.PlayerState{}).Where("player_id = ? AND frozen_cash >= ?", playerID, amount).
		Update("frozen_cash", gorm.Expr("GREATEST(frozen_cash - ?, 0)", amount))
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return errors.New("冻结资金不足")
	}
	return nil
}

func AddCash(db *gorm.DB, playerID string, amount int64) error {
	if amount <= 0 {
		return nil
	}
	return db.Model(&domain.PlayerState{}).Where("player_id = ?", playerID).
		Update("cash", gorm.Expr("cash + ?", amount)).Error
}

func DeductCash(playerID string, amount int64, note string) error {
	if amount <= 0 {
		return nil
	}
	ps, err := GetPlayerState(playerID)
	if err != nil {
		return err
	}
	if ps.Cash < amount {
		return gorm.ErrRecordNotFound
	}
	ps.Cash -= amount
	if err := DB.Save(ps).Error; err != nil {
		return err
	}
	log := &domain.AssetLog{
		PlayerID: playerID,
		Type:     "company_invest",
		Amount:   -amount,
		Balance:  ps.Cash,
		Note:     note,
	}
	if err := DB.Create(log).Error; err != nil {
		return err
	}
	return nil
}
