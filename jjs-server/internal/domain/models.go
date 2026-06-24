package domain

import (
	"time"

	"gorm.io/datatypes"
	"gorm.io/gorm"
)

type User struct {
	ID           string    `gorm:"type:varchar(12);primaryKey"`
	Username     string    `gorm:"type:varchar(50);uniqueIndex;not null"`
	Nickname     string    `gorm:"type:varchar(20);not null;default:''"`
	PasswordHash string    `gorm:"type:varchar(128);not null;default:''"`
	IsAdmin      bool      `gorm:"not null;default:false"`
	CreatedAt    time.Time `gorm:"autoCreateTime"`
	UpdatedAt    time.Time `gorm:"autoUpdateTime"`
}

type PlayerState struct {
	PlayerID   string  `gorm:"type:varchar(12);primaryKey"`
	Nickname   string  `gorm:"type:varchar(50);not null;default:''"`
	Cash       float64 `gorm:"not null;default:0"`
	FrozenCash float64 `gorm:"not null;default:0"`
	MarginDebt float64 `gorm:"not null;default:0"`
}

type Company struct {
	gorm.Model
	CEOID              string  `gorm:"type:varchar(12);index;not null"`
	Symbol             string  `gorm:"type:varchar(10);uniqueIndex;not null"`
	Name               string  `gorm:"type:varchar(50);not null"`
	Industry           string  `gorm:"type:varchar(20);not null;index:idx_company_industry"`
	Cash               float64 `gorm:"not null;default:0"`
	Employees          int     `gorm:"not null;default:0"`
	CreatedQuarter     int     `gorm:"not null;default:1"`
	LastSettledQuarter int     `gorm:"not null;default:0"`
	Status        string `gorm:"type:varchar(20);not null;default:'active'"`
	CEOShares     int64  `gorm:"not null;default:0"`
	InvestorShares int64 `gorm:"not null;default:0"`
	TotalShares   int64  `gorm:"not null;default:0"`
	IpoQuarter    int    `gorm:"not null;default:0"`
	PublicFloat   int64  `gorm:"not null;default:0"`
	CapCount      int    `gorm:"not null;default:0"`
	Inventory     int64  `gorm:"not null;default:0"`
	Demand        int64  `gorm:"not null;default:0"`
}

type CapBuildOrder struct {
	gorm.Model
	CompanyID    uint `gorm:"index;not null"`
	ReadyQuarter int  `gorm:"not null"`
	Amount       int  `gorm:"not null;default:1"`
	Completed    bool `gorm:"not null;default:false"`
}

type CompanyQuarterly struct {
	ID              uint           `json:"ID" gorm:"primaryKey;autoIncrement"`
	CompanyID       uint           `json:"CompanyID" gorm:"index;not null"`
	Quarter         int            `json:"quarter" gorm:"not null"`
	Revenue         int64          `json:"revenue" gorm:"not null;default:0"`
	Profit          int64          `json:"profit" gorm:"not null;default:0"`
	BeginningCash   int64          `json:"beginning_cash" gorm:"not null;default:0"`
	Cash            int64          `json:"cash" gorm:"not null;default:0"`
	LaborCost       int64          `json:"labor_cost" gorm:"not null;default:0"`
	BaseMaintenance int64          `json:"base_maintenance" gorm:"not null;default:0"`
	OperationalCost int64          `json:"operational_cost" gorm:"not null;default:0"`
	WarehouseCost   int64          `json:"warehouse_cost" gorm:"not null;default:0"`
	TotalCost       int64          `json:"total_cost" gorm:"not null;default:0"`
	SalesQty        int64          `json:"sales_qty" gorm:"not null;default:0"`
	ProdQty         int64          `json:"prod_qty" gorm:"not null;default:0"`
	Employees       int            `json:"employees" gorm:"not null;default:0"`
	TotalShares     int64          `json:"total_shares" gorm:"not null;default:0"`
	CEOShares       int64          `json:"ceo_shares" gorm:"not null;default:0"`
	InvestorShares  int64          `json:"investor_shares" gorm:"not null;default:0"`
	PublicFloat     int64          `json:"public_float" gorm:"not null;default:0"`
	CapCount        int            `json:"cap_count" gorm:"not null;default:0"`
	Inventory       int64          `json:"inventory" gorm:"not null;default:0"`
	Demand          int64          `json:"demand" gorm:"not null;default:0"`
	Actions         datatypes.JSON `json:"actions" gorm:"type:json"`
	CreatedAt       time.Time      `json:"CreatedAt" gorm:"autoCreateTime"`
}

type IndustryProsperity struct {
	ID         uint      `gorm:"primaryKey;autoIncrement"`
	Industry   string    `gorm:"type:varchar(20);not null;uniqueIndex:uq_ind_q"`
	Quarter    int       `gorm:"not null;uniqueIndex:uq_ind_q"`
	Prosperity float64   `gorm:"not null"`
	CreatedAt  time.Time `gorm:"autoCreateTime"`
}

type AssetLog struct {
	ID        uint      `gorm:"primaryKey;autoIncrement"`
	PlayerID  string    `gorm:"type:varchar(12);index;not null"`
	Type      string    `gorm:"type:varchar(20);not null"`
	Amount    float64   `gorm:"not null"`
	Balance   float64   `gorm:"not null"`
	Note      string    `gorm:"type:varchar(200);default:''"`
	CreatedAt time.Time `gorm:"autoCreateTime"`
}

type ActionLog struct {
	Type         string `json:"type"`
	Amount       int    `json:"amount,omitempty"`
	Actual       int    `json:"actual,omitempty"`
	Cost         int64  `json:"cost,omitempty"`
	ReadyQuarter int    `json:"ready_quarter,omitempty"`
}

// --- P3 交易引擎模型 ---

type Stock struct {
	ID            uint      `gorm:"primaryKey;autoIncrement"`
	CompanyID     uint      `gorm:"uniqueIndex;not null"`
	Symbol        string    `gorm:"type:varchar(10);uniqueIndex;not null"`
	CurrentPrice  int64     `gorm:"not null;default:0"`
	Change        int64     `gorm:"not null;default:0"`
	ChangePercent float64   `gorm:"not null;default:0"`
	Open          int64     `gorm:"not null;default:0"`
	High          int64     `gorm:"not null;default:0"`
	Low           int64     `gorm:"not null;default:0"`
	PrevClose     int64     `gorm:"not null;default:0"`
	Volume        int64     `gorm:"not null;default:0"`
	Turnover      int64     `gorm:"not null;default:0"`
	PE            float64   `gorm:"not null;default:0"`
	EPS           float64   `gorm:"not null;default:0"`
	NAV           float64   `gorm:"not null;default:0"`
	BidPrice1     int64     `gorm:"not null;default:0"`
	BidVol1       int64     `gorm:"not null;default:0"`
	BidPrice2     int64     `gorm:"not null;default:0"`
	BidVol2       int64     `gorm:"not null;default:0"`
	BidPrice3     int64     `gorm:"not null;default:0"`
	BidVol3       int64     `gorm:"not null;default:0"`
	BidPrice4     int64     `gorm:"not null;default:0"`
	BidVol4       int64     `gorm:"not null;default:0"`
	BidPrice5     int64     `gorm:"not null;default:0"`
	BidVol5       int64     `gorm:"not null;default:0"`
	AskPrice1     int64     `gorm:"not null;default:0"`
	AskVol1       int64     `gorm:"not null;default:0"`
	AskPrice2     int64     `gorm:"not null;default:0"`
	AskVol2       int64     `gorm:"not null;default:0"`
	AskPrice3     int64     `gorm:"not null;default:0"`
	AskVol3       int64     `gorm:"not null;default:0"`
	AskPrice4     int64     `gorm:"not null;default:0"`
	AskVol4       int64     `gorm:"not null;default:0"`
	AskPrice5     int64     `gorm:"not null;default:0"`
	AskVol5       int64     `gorm:"not null;default:0"`
	UpdatedAt     time.Time `gorm:"autoUpdateTime"`
}

type Order struct {
	ID        uint      `gorm:"primaryKey;autoIncrement"`
	StockID   uint      `gorm:"index;not null"`
	PlayerID  string    `gorm:"type:varchar(36);index;not null"`
	Type      string    `gorm:"type:varchar(10);not null"`
	Side      string    `gorm:"type:varchar(10);not null"`
	Price     int64     `gorm:"not null;default:0"`
	Qty       int64     `gorm:"not null;default:0"`
	FilledQty int64     `gorm:"not null;default:0"`
	Status    string    `gorm:"type:varchar(20);not null;default:'open'"`
	SeqNum    int64     `gorm:"not null;default:0"`
	CreatedAt time.Time `gorm:"autoCreateTime"`
	UpdatedAt time.Time `gorm:"autoUpdateTime"`
}

type Trade struct {
	ID          uint      `gorm:"primaryKey;autoIncrement"`
	StockID     uint      `gorm:"index;not null"`
	BuyerID     string    `gorm:"type:varchar(36);not null"`
	SellerID    string    `gorm:"type:varchar(36);not null"`
	BuyOrderID  uint      `gorm:"not null;default:0"`
	SellOrderID uint      `gorm:"not null;default:0"`
	Price       int64     `gorm:"not null"`
	Qty         int64     `gorm:"not null"`
	TotalAmount int64     `gorm:"not null"`
	TradeTime   time.Time `gorm:"not null"`
}

type Candle struct {
	ID       uint      `gorm:"primaryKey;autoIncrement"`
	StockID  uint      `gorm:"uniqueIndex:uq_candle;not null"`
	Period   string    `gorm:"type:varchar(10);uniqueIndex:uq_candle;not null"`
	OpenTime time.Time `gorm:"uniqueIndex:uq_candle;not null"`
	Open     int64     `gorm:"not null"`
	High     int64     `gorm:"not null"`
	Low      int64     `gorm:"not null"`
	Close    int64     `gorm:"not null"`
	Volume   int64     `gorm:"not null;default:0"`
}

type BrokerInventory struct {
	ID        uint  `gorm:"primaryKey;autoIncrement"`
	StockID   uint  `gorm:"uniqueIndex;not null"`
	TotalQty  int64 `gorm:"not null;default:0"`
	FrozenQty int64 `gorm:"not null;default:0"`
}

type Holding struct {
	ID           uint   `gorm:"primaryKey;autoIncrement"`
	PlayerID     string `gorm:"type:varchar(36);index:idx_holdings_player;not null;uniqueIndex:uq_player_stock"`
	StockID      uint   `gorm:"not null;uniqueIndex:uq_player_stock"`
	Qty          int64  `gorm:"not null;default:0"`
	AvgCost      int64  `gorm:"not null;default:0"`
	FrozenQty    int64  `gorm:"not null;default:0"`
	ShortQty     int64  `gorm:"not null;default:0"`
	ShortAvgCost int64  `gorm:"not null;default:0"`
}

// --- V1 遗留模型 (保留避免 DB 迁移丢失历史数据) ---

type Transaction struct {
	ID        uint      `gorm:"primaryKey;autoIncrement"`
	PlayerID  string    `gorm:"type:varchar(12);index:idx_transactions_player;not null"`
	Symbol    string    `gorm:"type:varchar(10);not null"`
	TradeType string    `gorm:"type:varchar(10);not null;check:trade_type IN ('buy','sell','short_sell','cover')"`
	Quantity  int64     `gorm:"not null"`
	Price     int64     `gorm:"not null"`
	Total     int64     `gorm:"not null"`
	CreatedAt time.Time `gorm:"autoCreateTime"`
}

// --- 表名 ---

func (Company) TableName() string              { return "companies" }
func (CapBuildOrder) TableName() string         { return "cap_build_orders" }
func (CompanyQuarterly) TableName() string      { return "company_quarterly" }
func (PlayerState) TableName() string           { return "player_state" }
func (Holding) TableName() string               { return "holdings" }
func (Transaction) TableName() string           { return "transactions" }
func (IndustryProsperity) TableName() string    { return "industry_prosperity" }
func (Trade) TableName() string                 { return "trades" }
func (Order) TableName() string                 { return "orders" }
func (Stock) TableName() string                 { return "stocks" }
func (Candle) TableName() string                { return "candles" }
func (BrokerInventory) TableName() string       { return "broker_inventory" }
