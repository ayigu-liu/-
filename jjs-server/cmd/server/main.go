package main

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/go-chi/chi/v5"
	chimw "github.com/go-chi/chi/v5/middleware"

	"jjs-server/internal/config"
	"jjs-server/internal/handler"
	"jjs-server/internal/middleware"
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

	r := chi.NewRouter()
	r.Use(chimw.Logger)
	r.Use(chimw.Recoverer)
	r.Use(middleware.CORS)

	authH := &handler.AuthHandler{}
	playerH := &handler.PlayerHandler{}

	r.Route("/api", func(r chi.Router) {
		r.Get("/health", handler.Health)

		r.Route("/auth", func(r chi.Router) {
			r.Post("/register", authH.Register)
			r.Post("/login", authH.Login)
			r.With(middleware.OptionalJWT).Get("/me", authH.Me)
		})

		r.With(middleware.JWT).Get("/player/info", playerH.Info)
	})

	r.Group(func(r chi.Router) {
		r.Use(middleware.StaticFileServer)
		r.NotFound(func(w http.ResponseWriter, req *http.Request) {
			handler.WriteJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
		})
	})

	srv := &http.Server{
		Addr:         ":" + config.AppConfig.Port,
		Handler:      r,
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 10 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

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
