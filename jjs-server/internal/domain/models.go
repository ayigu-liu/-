package domain

import (
	"time"

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

type Transaction struct {
	ID        uint      `gorm:"primaryKey;autoIncrement"`
	PlayerID  string    `gorm:"type:varchar(12);index:idx_transactions_player;not null"`
	Symbol    string    `gorm:"type:varchar(10);not null"`
	TradeType string    `gorm:"type:varchar(10);not null;check:trade_type IN ('buy','sell','short_sell','cover')"`
	Quantity  int64     `gorm:"not null"`
	Price     float64   `gorm:"not null"`
	Total     float64   `gorm:"not null"`
	CreatedAt time.Time `gorm:"autoCreateTime"`
}

type PlayerState struct {
	PlayerID   string  `gorm:"type:varchar(12);primaryKey"`
	Nickname   string  `gorm:"type:varchar(50);not null;default:''"`
	Cash       float64 `gorm:"not null;default:0"`
	FrozenCash float64 `gorm:"not null;default:0"`
	MarginDebt float64 `gorm:"not null;default:0"`
}

type Holding struct {
	ID           uint    `gorm:"primaryKey;autoIncrement"`
	PlayerID     string  `gorm:"type:varchar(12);index:idx_holdings_player;not null;uniqueIndex:uq_player_symbol"`
	Symbol       string  `gorm:"type:varchar(10);not null;uniqueIndex:uq_player_symbol"`
	Qty          int64   `gorm:"not null;default:0"`
	AvgCost      float64 `gorm:"not null;default:0"`
	FrozenQty    int64   `gorm:"not null;default:0"`
	ShortQty     int64   `gorm:"not null;default:0"`
	ShortAvgCost float64 `gorm:"not null;default:0"`
}

type Company struct {
	gorm.Model
	CEOID              string  `gorm:"type:varchar(12);index;not null"`
	Symbol             string  `gorm:"type:varchar(10);uniqueIndex;not null"`
	Name               string  `gorm:"type:varchar(50);not null"`
	Industry           string  `gorm:"type:varchar(20);not null;index:idx_company_industry"`
	Cash               float64 `gorm:"not null;default:0"`
	Employees          int     `gorm:"not null;default:0"`
	Quarter            int     `gorm:"not null;default:1"`
	LastSettledQuarter int     `gorm:"not null;default:0"`
	Status    string  `gorm:"type:varchar(20);not null;default:'active'"`
	TotalShares int     `gorm:"not null;default:0"`
	CEOShares   int64   `gorm:"not null;default:0"`
	CapCount    int     `gorm:"not null;default:0"`
	Inventory   int64 `gorm:"not null;default:0"`
	Demand      float64 `gorm:"not null;default:0"`
}

type CapBuildOrder struct {
	gorm.Model
	CompanyID    uint `gorm:"index;not null"`
	ReadyQuarter int  `gorm:"not null"`
	Completed    bool `gorm:"not null;default:false"`
}

type CompanyQuarterly struct {
	ID              uint      `json:"ID" gorm:"primaryKey;autoIncrement"`
	CompanyID       uint      `json:"CompanyID" gorm:"index;not null"`
	Quarter         int       `json:"quarter" gorm:"not null"`
	Revenue         float64   `json:"revenue" gorm:"not null;default:0"`
	Profit          int64     `json:"profit" gorm:"not null;default:0"`
	BeginningCash   int64     `json:"beginning_cash" gorm:"not null;default:0"`
	Cash            int64     `json:"cash" gorm:"not null;default:0"`
	LaborCost       int64     `json:"labor_cost" gorm:"not null;default:0"`
	BaseMaintenance int64     `json:"base_maintenance" gorm:"not null;default:0"`
	OperationalCost int64     `json:"operational_cost" gorm:"not null;default:0"`
	WarehouseCost   int64     `json:"warehouse_cost" gorm:"not null;default:0"`
	TotalCost       int64     `json:"total_cost" gorm:"not null;default:0"`
	SalesQty        int64     `json:"sales_qty" gorm:"not null;default:0"`
	ProdQty         int64     `json:"prod_qty" gorm:"not null;default:0"`
	Employees       int       `json:"employees" gorm:"not null;default:0"`
	TotalShares     int       `json:"total_shares" gorm:"not null;default:0"`
	CEOShares       int64     `json:"ceo_shares" gorm:"not null;default:0"`
	CapCount        int       `json:"cap_count" gorm:"not null;default:0"`
	Inventory       int64     `json:"inventory" gorm:"not null;default:0"`
	Demand          float64   `json:"demand" gorm:"not null;default:0"`
	CreatedAt       time.Time `json:"CreatedAt" gorm:"autoCreateTime"`
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

func (Company) TableName() string           { return "companies" }
func (CapBuildOrder) TableName() string      { return "cap_build_orders" }
func (CompanyQuarterly) TableName() string    { return "company_quarterly" }
func (PlayerState) TableName() string         { return "player_state" }
func (Holding) TableName() string             { return "holdings" }
func (Transaction) TableName() string         { return "transactions" }
func (IndustryProsperity) TableName() string    { return "industry_prosperity" }
