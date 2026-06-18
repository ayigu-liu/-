package handler

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"gorm.io/gorm"

	"jjs-server/internal/config"
	"jjs-server/internal/middleware"
	"jjs-server/internal/store"
)

type AuthHandler struct{}

type loginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
	Nickname string `json:"nickname"`
}

type registerRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
	Nickname string `json:"nickname"`
}

type authResponse struct {
	Token    string `json:"token"`
	Nickname string `json:"nickname"`
	PlayerID string `json:"player_id"`
	Email    string `json:"email"`
	IsAdmin  bool   `json:"is_admin"`
}

type meResponse struct {
	OK       bool   `json:"ok"`
	Token    string `json:"token,omitempty"`
	Nickname string `json:"nickname,omitempty"`
	PlayerID string `json:"player_id,omitempty"`
	Email    string `json:"email,omitempty"`
	IsAdmin  bool   `json:"is_admin,omitempty"`
}

func (h *AuthHandler) Register(w http.ResponseWriter, r *http.Request) {
	var req registerRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		WriteJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request"})
		return
	}

	email := normalizeEmail(req.Email)
	if email == "" || len(req.Password) < config.MinPasswordLen {
		WriteJSON(w, http.StatusBadRequest, map[string]string{"error": "邮箱不能为空，密码至少3位"})
		return
	}

	if _, err := store.GetUserByUsername(email); err == nil {
		WriteJSON(w, http.StatusConflict, map[string]string{"error": "用户已存在"})
		return
	}

	nickname := req.Nickname
	if nickname == "" {
		nickname = email
	}
	user, err := store.CreateUser(email, req.Password, nickname)
	if err != nil {
		slog.Error("create user failed", "error", err)
		WriteJSON(w, http.StatusInternalServerError, map[string]string{"error": "注册失败"})
		return
	}

	if _, err := store.GetOrCreatePlayerState(user.ID, nickname); err != nil {
		slog.Error("create player state failed", "error", err, "player_id", user.ID)
	}

	token, err := generateJWT(user.ID)
	if err != nil {
		WriteJSON(w, http.StatusInternalServerError, map[string]string{"error": "token generation failed"})
		return
	}

	WriteJSON(w, http.StatusCreated, authResponse{
		Token:    token,
		Nickname: user.Nickname,
		PlayerID: user.ID,
		Email:    user.Username,
		IsAdmin:  user.IsAdmin,
	})
}

func (h *AuthHandler) Login(w http.ResponseWriter, r *http.Request) {
	var req loginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		WriteJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request"})
		return
	}

	email := normalizeEmail(req.Email)
	if email == "" || req.Password == "" {
		WriteJSON(w, http.StatusBadRequest, map[string]string{"error": "邮箱和密码不能为空"})
		return
	}

	user, err := store.GetUserByUsername(email)
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			WriteJSON(w, http.StatusUnauthorized, map[string]string{"error": "用户不存在"})
			return
		}
		WriteJSON(w, http.StatusInternalServerError, map[string]string{"error": "登录失败"})
		return
	}

	if !store.CheckPassword(user.PasswordHash, req.Password) {
		WriteJSON(w, http.StatusUnauthorized, map[string]string{"error": "密码错误"})
		return
	}

	if req.Nickname != "" {
		store.UpdateUserNickname(user.ID, req.Nickname)
		user.Nickname = req.Nickname
	}

	token, err := generateJWT(user.ID)
	if err != nil {
		WriteJSON(w, http.StatusInternalServerError, map[string]string{"error": "token generation failed"})
		return
	}

	WriteJSON(w, http.StatusOK, authResponse{
		Token:    token,
		Nickname: user.Nickname,
		PlayerID: user.ID,
		Email:    user.Username,
		IsAdmin:  user.IsAdmin,
	})
}

func (h *AuthHandler) Me(w http.ResponseWriter, r *http.Request) {
	userID, _ := middleware.GetUserID(r)
	if userID == "" {
		WriteJSON(w, http.StatusOK, meResponse{OK: false})
		return
	}
	user, err := store.GetUserByID(userID)
	if err != nil {
		WriteJSON(w, http.StatusOK, meResponse{OK: false})
		return
	}
	WriteJSON(w, http.StatusOK, meResponse{
		OK:       true,
		Nickname: user.Nickname,
		PlayerID: user.ID,
		Email:    user.Username,
		IsAdmin:  user.IsAdmin,
	})
}

func generateJWT(userID string) (string, error) {
	dur, err := time.ParseDuration(config.AppConfig.JWTExpire)
	if err != nil {
		dur = 168 * time.Hour
	}
	claims := jwt.MapClaims{
		"sub": userID,
		"iat": time.Now().Unix(),
		"exp": time.Now().Add(dur).Unix(),
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString([]byte(config.AppConfig.JWTSecret))
}

func normalizeEmail(email string) string {
	s := email
	for len(s) > 0 && s[len(s)-1] == ' ' {
		s = s[:len(s)-1]
	}
	lower := ""
	for _, c := range s {
		if c >= 'A' && c <= 'Z' {
			lower += string(c + 32)
		} else {
			lower += string(c)
		}
	}
	return lower
}

func WriteJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}
