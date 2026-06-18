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
	"jjs-server/internal/engine"
	"jjs-server/internal/handler"
	"jjs-server/internal/router"
	"jjs-server/internal/store"
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

	authH := &handler.AuthHandler{}
	playerH := &handler.PlayerHandler{}
	companyH := &handler.CompanyHandler{}
	r := router.New(authH, playerH, companyH)

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
