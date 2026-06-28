package bots

import (
	"jjs-server/internal/domain"
	"jjs-server/internal/store"
)

func mustGetPs(playerID string) *domain.PlayerState {
	ps, _ := store.GetPlayerState(playerID)
	return ps
}

func mustGetPlayerState(playerID string) (*domain.PlayerState, error) {
	return store.GetPlayerState(playerID)
}

func mustGetHoldings(playerID string) ([]domain.Holding, error) {
	return store.GetHoldingsByPlayer(playerID)
}
