package handler

import (
	"log/slog"
	"net/http"

	"jjs-server/internal/engine"
	"jjs-server/internal/middleware"
	"jjs-server/internal/store"
)

type PlayerHandler struct{}

type playerInfoResponse struct {
	PlayerID      string  `json:"player_id"`
	Nickname      string  `json:"nickname"`
	Email         string  `json:"email"`
	Cash          float64 `json:"cash"`
	FrozenCash    float64 `json:"frozen_cash"`
	MarginDebt    float64 `json:"margin_debt"`
	GlobalQuarter int64   `json:"global_quarter"`
}

func (h *PlayerHandler) Info(w http.ResponseWriter, r *http.Request) {
	userID, ok := middleware.GetUserID(r)
	if !ok {
		WriteJSON(w, http.StatusUnauthorized, map[string]string{"error": "未登录"})
		return
	}

	user, err := store.GetUserByID(userID)
	if err != nil {
		WriteJSON(w, http.StatusInternalServerError, map[string]string{"error": "获取用户信息失败"})
		return
	}

	ps, err := store.GetOrCreatePlayerState(userID, user.Nickname)
	if err != nil {
		slog.Error("get or create player state failed", "error", err, "player_id", userID)
		WriteJSON(w, http.StatusInternalServerError, map[string]string{"error": "获取玩家状态失败"})
		return
	}

	WriteJSON(w, http.StatusOK, playerInfoResponse{
		PlayerID:      ps.PlayerID,
		Nickname:      user.Nickname,
		Email:         user.Username,
		Cash:          ps.Cash,
		FrozenCash:    ps.FrozenCash,
		MarginDebt:    ps.MarginDebt,
		GlobalQuarter: engine.GlobalQuarter.Load(),
	})
}
