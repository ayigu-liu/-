package main

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"jjs-server/internal/config"
	"jjs-server/internal/domain"
	"jjs-server/internal/engine"
	"jjs-server/internal/handler"
	"jjs-server/internal/router"
	"jjs-server/internal/store"
	"jjs-server/internal/ws"
)

func main() {
	slog.SetDefault(slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo})))

	if err := config.Load(); err != nil {
		slog.Error("failed to load config", "error", err)
		os.Exit(1)
	}

	if err := store.Init(); err != nil {
		slog.Error("failed to init database", "error", err)
		os.Exit(1)
	}

	if err := engine.RestoreOrSeedGlobalQuarter(); err != nil {
		slog.Error("failed to restore global quarter", "error", err)
		os.Exit(1)
	}

	engine.RecoverSettlements()

	hub := ws.NewHub()
	go hub.Run()

	engine.OnTradeExecuted = func(playerID, _ string) {
		ps, err := store.GetPlayerState(playerID)
		if err != nil {
			return
		}
		holdings, err := store.GetHoldingsByPlayer(playerID)
		if err != nil {
			holdings = nil
		}

		stocksByID := make(map[uint]*domain.Stock, len(holdings))
		for _, h := range holdings {
			s, err := store.GetStockByID(h.StockID)
			if err == nil {
				stocksByID[h.StockID] = s
			}
		}

		companies, err := store.GetActiveCompanies()
		companyMap := make(map[string]*domain.Company, len(companies))
		if err == nil {
			for i := range companies {
				companyMap[companies[i].Symbol] = &companies[i]
			}
		}

		msg := ws.BuildPortfolioUpdate(ps.Cash, ps.FrozenCash, holdings, stocksByID, companyMap)
		hub.SendToPlayer(playerID, msg)
	}

	authH := &handler.AuthHandler{}
	playerH := &handler.PlayerHandler{}
	companyH := &handler.CompanyHandler{}
	marketH := &handler.MarketHandler{}
	tradeH := &handler.TradeHandler{}
	wsH := handler.NewWsHandler(hub)
	r := router.New(authH, playerH, companyH, marketH, tradeH, wsH)

	srv := &http.Server{
		Addr:         ":" + config.AppConfig.Port,
		Handler:      r,
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 10 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	ticker := engine.NewTicker()
	ticker.Start()
	defer ticker.Stop()

	tradingTicker := engine.NewTradingTicker()
	tradingTicker.SetHub(hub)
	tradingTicker.Start()
	defer tradingTicker.Stop()

	go func() {
		slog.Info("server starting", "port", config.AppConfig.Port)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			slog.Error("server failed", "error", err)
			os.Exit(1)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit
	slog.Info("shutting down server...")

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := srv.Shutdown(ctx); err != nil {
		slog.Error("forced shutdown", "error", err)
	}
	slog.Info("server stopped")
}
