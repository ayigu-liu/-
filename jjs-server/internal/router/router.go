package router

import (
	"net/http"

	"github.com/go-chi/chi/v5"
	chimw "github.com/go-chi/chi/v5/middleware"

	"jjs-server/internal/handler"
	"jjs-server/internal/middleware"
)

func New(authH *handler.AuthHandler, playerH *handler.PlayerHandler, companyH *handler.CompanyHandler, marketH *handler.MarketHandler, tradeH *handler.TradeHandler, wsH *handler.WsHandler) chi.Router {
	r := chi.NewRouter()
	r.Use(chimw.Logger)
	r.Use(chimw.Recoverer)
	r.Use(middleware.CORS)

	r.Get("/ws", wsH.ServeWS)

	r.Route("/api", func(r chi.Router) {
		r.Get("/health", handler.Health)

		r.Route("/auth", func(r chi.Router) {
			r.Post("/register", authH.Register)
			r.Post("/login", authH.Login)
			r.With(middleware.OptionalJWT).Get("/me", authH.Me)
		})

		r.With(middleware.JWT).Get("/player/info", playerH.Info)

		r.With(middleware.JWT).Post("/company/create", companyH.Create)
		r.With(middleware.JWT).Post("/company/actions", companyH.SubmitActions)
		r.With(middleware.JWT).Post("/company/ipo", companyH.IPO)
		r.With(middleware.JWT).Get("/company/ipo/status", companyH.IpoStatus)
		r.With(middleware.JWT).Get("/company/state", companyH.State)
		r.With(middleware.JWT).Get("/company/quarterly", companyH.Quarterly)

		r.Get("/market/stocks", marketH.ListStocks)
		r.Get("/market/stock/{symbol}", marketH.GetStockDetail)
		r.Get("/market/kline/{symbol}", marketH.GetKline)
		r.Get("/market/orderbook/{symbol}", marketH.GetOrderBook)

		r.With(middleware.JWT).Post("/trade/order", tradeH.PlaceOrder)
		r.With(middleware.JWT).Delete("/trade/order", tradeH.CancelOrder)
		r.With(middleware.JWT).Get("/trade/orders", tradeH.MyOrders)
		r.With(middleware.JWT).Get("/portfolio", tradeH.Portfolio)
	})

	r.Group(func(r chi.Router) {
		r.Use(middleware.StaticFileServer)
		r.NotFound(func(w http.ResponseWriter, req *http.Request) {
			handler.WriteJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
		})
	})

	return r
}
