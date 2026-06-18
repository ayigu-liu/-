package store

import (
	"jjs-server/internal/domain"
)

func CreateCompany(c *domain.Company) error {
	return DB.Create(c).Error
}

func GetActiveCompanyByCEOID(ceoID string) (*domain.Company, error) {
	var c domain.Company
	err := DB.Where("ceo_id = ? AND status = ?", ceoID, "active").First(&c).Error
	if err != nil {
		return nil, err
	}
	return &c, nil
}

func GetCompanyByID(id uint) (*domain.Company, error) {
	var c domain.Company
	err := DB.First(&c, id).Error
	if err != nil {
		return nil, err
	}
	return &c, nil
}

func GetCompanyBySymbol(symbol string) (*domain.Company, error) {
	var c domain.Company
	err := DB.Where("symbol = ?", symbol).First(&c).Error
	if err != nil {
		return nil, err
	}
	return &c, nil
}

func UpdateCompany(c *domain.Company) error {
	return DB.Save(c).Error
}

func CreateQuarterly(q *domain.CompanyQuarterly) error {
	return DB.Create(q).Error
}

func GetQuarterlyByCompanyID(companyID uint) ([]domain.CompanyQuarterly, error) {
	var qs []domain.CompanyQuarterly
	err := DB.Where("company_id = ?", companyID).Order("quarter ASC").Find(&qs).Error
	if err != nil {
		return nil, err
	}
	return qs, nil
}

func CreateCapBuildOrder(o *domain.CapBuildOrder) error {
	return DB.Create(o).Error
}

func GetPendingBuildOrders(companyID uint) ([]domain.CapBuildOrder, error) {
	var orders []domain.CapBuildOrder
	err := DB.Where("company_id = ? AND completed = ?", companyID, false).Order("ready_quarter ASC").Find(&orders).Error
	if err != nil {
		return nil, err
	}
	return orders, nil
}

func CompleteBuildOrder(id uint) error {
	return DB.Model(&domain.CapBuildOrder{}).Where("id = ?", id).Update("completed", true).Error
}
