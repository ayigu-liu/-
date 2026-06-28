package config

import (
	"encoding/json"
	"os"
	"reflect"
	"time"

	"github.com/kelseyhightower/envconfig"
)

type Config struct {
	MySQLDSN    string `json:"mysql_dsn"    envconfig:"MYSQL_DSN"     default:"root:root@tcp(127.0.0.1:3306)/jjs?charset=utf8mb4&parseTime=True&loc=Local"`
	JWTSecret   string `json:"jwt_secret"   envconfig:"JWT_SECRET"    default:"jjs-dev-secret-change-in-production"`
	JWTExpire   string `json:"jwt_expire"   envconfig:"JWT_EXPIRE"    default:"168h"`
	Port        string `json:"port"         envconfig:"PORT"          default:"8080"`
	FrontendDir string `json:"frontend_dir" envconfig:"FRONTEND_DIR"  default:"web"`
	ConfigFile  string `json:"-"            envconfig:"CONFIG_FILE"   default:"config.json"`
}

var AppConfig Config

func Load() error {
	if err := envconfig.Process("", &AppConfig); err != nil {
		return err
	}

	fileValues, err := loadFromFile(AppConfig.ConfigFile)
	if err != nil && !os.IsNotExist(err) {
		return err
	}

	mergeInto(&AppConfig, fileValues)
	return nil
}

func loadFromFile(path string) (*Config, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var cfg Config
	if err := json.Unmarshal(data, &cfg); err != nil {
		return nil, err
	}
	return &cfg, nil
}

func mergeInto(dst, src *Config) {
	if src == nil {
		return
	}
	dv := reflect.ValueOf(dst).Elem()
	sv := reflect.ValueOf(src).Elem()
	for i := 0; i < sv.NumField(); i++ {
		sf := sv.Field(i)
		if sf.IsZero() {
			continue
		}
		df := dv.Field(i)
		if df.CanSet() {
			df.Set(sf)
		}
	}
}

// --- 游戏常量（从 config.py 迁移） ---

const (
	StartingCash          = 100_000
	PriceTickInterval     = 2 * time.Second
	LeaderboardInterval   = 7500 * time.Millisecond
	DBFlushInterval       = 30 * time.Second
	PriceMin              = 1            // 分 (最小股价, 原 0.0001 円)
	PriceMax              = 100_000_000  // 分 (最大股价, 原 1_000_000 円)
	SharesOutstanding     = 500_000_000
	MaxPositionPerPlayer  = SharesOutstanding * 5 / 100
	MaxOrderQty           = SharesOutstanding / 100
	InitialPrice          = 10000        // 分 (初始股价, 原 100 円)

	StampTaxRate       = 0.001
	CommissionRate     = 0.00025
	MinCommission      = 5
	ShortSellFeeRate   = 0.000003
	MarginInterestRate = 0.000003
	MarginMinAssets    = 1_000_000

	MaxNicknameLen = 20
	MinPasswordLen = 3

	BrokerScanTicks  = 5
	StaleOrderTicks  = 10
	SystemBrokerID   = "BROKER"

	// AI 交易者
	AiTraderCount            = 100
	AiTraderInitCashMin      int64 = 500_000
	AiTraderInitCashMax      int64 = 50_000_000
	AiTraderCooldownMin      = 5
	AiTraderCooldownMax      = 30
	AiTraderRiskToleranceMin = 0.15
	AiTraderRiskToleranceMax = 0.60
	AiTraderSampleRatio      = 0.20
	AiTraderMinStocks        = 3
	AiTraderSignalThreshold  = 0.20
	AiTraderSentEmaAlpha     = 0.30
	AiTraderSentConduction   = 0.15
	AiTraderExitCash         int64 = 10_000
	AiTraderResupplyInterval = 100
	AiTraderBuyDiscountMin   = 0.970  // 废弃，被 AiTraderMaxSpread 取代
	AiTraderBuyDiscountMax   = 0.995
	AiTraderSellPremiumMin   = 1.005
	AiTraderSellPremiumMax   = 1.030
	AiTraderMaxSpread        = 0.30  // 最大报价偏离幅度，信号=1时可达±30%
	AiTraderStopLossBase     = 0.25
	AiTraderStopLossScale    = 0.60
	AiTraderMarketOrderThreshold = 0.50
	AiTraderSignalJitter        = 0.15
	AiTraderRandomSideRate      = 0.15
	AiTraderCancelDevThreshold  = 0.05  // 挂单偏差 > 5% 撤单（约5-10档）
	AiTraderCancelMaxAge        = 120 * time.Second  // 挂单最长存活
)
