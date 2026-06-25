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
	ID           uint      `gorm:"primaryKey;autoIncrement"`
	CompanyID    uint      `gorm:"uniqueIndex;not null"`
	Symbol       string    `gorm:"type:varchar(10);uniqueIndex;not null"`
	CurrentPrice int64     `gorm:"not null;default:0"`
	PrevClose    int64     `gorm:"not null;default:0"`
	UpdatedAt    time.Time `gorm:"autoUpdateTime"`
}

type Order struct {
	ID           uint      `gorm:"primaryKey;autoIncrement"                          json:"id"`
	StockID      uint      `gorm:"index;not null"                                     json:"stock_id"`
	PlayerID     string    `gorm:"type:varchar(36);index;not null"                    json:"-"`
	Type         string    `gorm:"type:varchar(10);not null"                          json:"type"`
	Side         string    `gorm:"type:varchar(10);not null"                          json:"side"`
	Price        int64     `gorm:"not null;default:0"                                 json:"price"`
	Qty          int64     `gorm:"not null;default:0"                                 json:"qty"`
	FilledQty    int64     `gorm:"not null;default:0"                                 json:"filled_qty"`
	Status       string    `gorm:"type:varchar(20);not null;default:'open'"           json:"status"`
	SeqNum       int64     `gorm:"not null;default:0"                                 json:"-"`
	FrozenAmount float64   `gorm:"not null;default:0"                                 json:"-"`
	CreatedAt    time.Time `gorm:"autoCreateTime"                                     json:"created_at"`
	UpdatedAt    time.Time `gorm:"autoUpdateTime"                                     json:"-"`
}

type Trade struct {
	ID          uint      `gorm:"primaryKey;autoIncrement" json:"-"`
	StockID     uint      `gorm:"index;not null"            json:"-"`
	BuyerID     string    `gorm:"type:varchar(36);not null"  json:"-"`
	SellerID    string    `gorm:"type:varchar(36);not null"  json:"-"`
	BuyOrderID  uint      `gorm:"not null;default:0"         json:"-"`
	SellOrderID uint      `gorm:"not null;default:0"         json:"-"`
	Price       int64     `gorm:"not null"                   json:"price"`
	Qty         int64     `gorm:"not null"                   json:"qty"`
	TotalAmount int64     `gorm:"not null"     json:"total_amount"`
	TradeTime   time.Time `gorm:"not null"     json:"trade_time"`
}

type Candle struct {
	ID       uint      `gorm:"primaryKey;autoIncrement"                    json:"-"`
	StockID  uint      `gorm:"uniqueIndex:uq_candle;not null"              json:"-"`
	Period   string    `gorm:"type:varchar(10);uniqueIndex:uq_candle;not null" json:"-"`
	OpenTime time.Time `gorm:"uniqueIndex:uq_candle;not null"              json:"time"`
	Open     int64     `gorm:"not null"                                     json:"open"`
	High     int64     `gorm:"not null"                                     json:"high"`
	Low      int64     `gorm:"not null"                                     json:"low"`
	Close    int64     `gorm:"not null"                                     json:"close"`
	Volume   int64     `gorm:"not null;default:0"                           json:"volume"`
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
