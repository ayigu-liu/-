package store

import (
	"log/slog"

	"gorm.io/driver/mysql"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	"jjs-server/internal/config"
	"jjs-server/internal/domain"
)

var DB *gorm.DB

func Init() error {
	var err error
	DB, err = gorm.Open(mysql.Open(config.AppConfig.MySQLDSN), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Warn),
	})
	if err != nil {
		return err
	}

	sqlDB, err := DB.DB()
	if err != nil {
		return err
	}
	sqlDB.SetMaxOpenConns(25)
	sqlDB.SetMaxIdleConns(10)

	if err := DB.AutoMigrate(
		&domain.User{},
		&domain.PlayerState{},
		&domain.Holding{},
		&domain.Transaction{},
		&domain.Company{},
		&domain.CapBuildOrder{},
		&domain.CompanyQuarterly{},
		&domain.IndustryProsperity{},
		&domain.AssetLog{},
	); err != nil {
		return err
	}

	if DB.Migrator().HasColumn(&domain.Company{}, "sludge_level") {
		DB.Migrator().DropColumn(&domain.Company{}, "sludge_level")
	}
	if DB.Migrator().HasColumn(&domain.CompanyQuarterly{}, "sludge_level") {
		DB.Migrator().DropColumn(&domain.CompanyQuarterly{}, "sludge_level")
	}

	slog.Info("database initialized and migrated")
	return nil
}
