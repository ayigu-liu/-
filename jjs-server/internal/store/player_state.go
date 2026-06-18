package store

import (
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
