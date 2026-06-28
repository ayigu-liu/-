package bots

import (
	"fmt"
	"time"

	"gorm.io/gorm"

	"jjs-server/internal/config"
	"jjs-server/internal/domain"
	"jjs-server/internal/store"
)

func ResetTrader(db *gorm.DB, trader *AiTrader) error {
	newCash := randomRange(config.AiTraderInitCashMin, config.AiTraderInitCashMax)
	if err := db.Model(&domain.PlayerState{}).Where("player_id = ?", trader.ID).
		Updates(map[string]interface{}{"cash": newCash, "frozen_cash": 0}).Error; err != nil {
		return err
	}
	db.Where("player_id = ?", trader.ID).Delete(&domain.Holding{})
	trader.Strategy = pickWeightedStrategy()
	trader.CooldownTicks = randomIntRange(config.AiTraderCooldownMin, config.AiTraderCooldownMax)
	trader.RiskTolerance = randomTolerance()
	trader.CoolDownLeft = 0
	trader.SpawnedAt = time.Now()
	return nil
}

func CheckAndReplenish(db *gorm.DB, traders []*AiTrader) {
	for _, t := range traders {
		ps, err := store.GetPlayerState(t.ID)
		if err != nil || ps == nil {
			continue
		}
		holdings, _ := store.GetHoldingsByPlayer(t.ID)
		totalQty := int64(0)
		for _, h := range holdings {
			totalQty += h.Qty
		}
		if ps.Cash < config.AiTraderExitCash && totalQty == 0 {
			ResetTrader(db, t)
		}
	}
}

func RestoreTraders(db *gorm.DB) []*AiTrader {
	var psList []domain.PlayerState
	db.Where("player_id LIKE ?", "bot_%").Find(&psList)

	existingMap := make(map[string]*domain.PlayerState, len(psList))
	for i := range psList {
		existingMap[psList[i].PlayerID] = &psList[i]
	}

	traders := make([]*AiTrader, 0, config.AiTraderCount)

	for i := 1; i <= config.AiTraderCount; i++ {
		id := fmt.Sprintf("bot_%04d", i)
		ps, exists := existingMap[id]

		if exists && ps.Cash >= config.AiTraderExitCash {
			traders = append(traders, &AiTrader{
				ID:            id,
				Strategy:      pickWeightedStrategy(),
			CooldownTicks: randomIntRange(config.AiTraderCooldownMin, config.AiTraderCooldownMax),
			RiskTolerance: randomTolerance(),
			CoolDownLeft:  0,
			SpawnedAt:     time.Now(),
		})
		continue
	}

	if exists && ps.Cash < config.AiTraderExitCash {
		holdings, _ := store.GetHoldingsByPlayer(id)
		totalQty := int64(0)
		for _, h := range holdings {
			totalQty += h.Qty
		}
		if totalQty > 0 {
			traders = append(traders, &AiTrader{
				ID:            id,
				Strategy:      pickWeightedStrategy(),
				CooldownTicks: randomIntRange(config.AiTraderCooldownMin, config.AiTraderCooldownMax),
					RiskTolerance: randomTolerance(),
					CoolDownLeft:  0,
					SpawnedAt:     time.Now(),
				})
				continue
			}
		}

		db.Where("player_id = ?", id).Delete(&domain.Holding{})
		_, err := store.GetOrCreatePlayerState(id, id)
		if err != nil {
			continue
		}
		cash := randomRange(config.AiTraderInitCashMin, config.AiTraderInitCashMax)
		db.Model(&domain.PlayerState{}).Where("player_id = ?", id).
			Updates(map[string]interface{}{"cash": cash, "frozen_cash": 0})

		traders = append(traders, &AiTrader{
			ID:            id,
			Strategy:      pickWeightedStrategy(),
		CooldownTicks: randomIntRange(config.AiTraderCooldownMin, config.AiTraderCooldownMax),
		RiskTolerance: randomTolerance(),
		CoolDownLeft:  0,
		SpawnedAt:     time.Now(),
	})
}

	return traders
}
