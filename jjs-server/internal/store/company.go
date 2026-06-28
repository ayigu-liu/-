package store

import (
	"jjs-server/internal/domain"
)

func GetActiveCompanies() ([]domain.Company, error) {
	var companies []domain.Company
	err := DB.Where("status = ?", "active").Find(&companies).Error
	return companies, err
}

func QuarterlyExists(companyID uint, quarter int) (bool, error) {
	var count int64
	err := DB.Model(&domain.CompanyQuarterly{}).
		Where("company_id = ? AND quarter = ?", companyID, quarter).
		Count(&count).Error
	return count > 0, err
}

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

func GetPaginatedQuarterly(companyID uint, cursor, limit, currentQuarter int) ([]domain.CompanyQuarterly, error) {
	var qs []domain.CompanyQuarterly
	query := DB.Where("company_id = ? AND quarter > 0 AND quarter < ?", companyID, currentQuarter)
	if cursor > 0 {
		query = query.Where("quarter < ?", cursor)
	}
	err := query.Order("quarter DESC").Limit(limit + 1).Find(&qs).Error
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

func GetPendingUncompletedBuildOrders(companyID uint, quarter int) ([]domain.CapBuildOrder, error) {
	var orders []domain.CapBuildOrder
	err := DB.Where("company_id = ? AND ready_quarter <= ? AND completed = ?", companyID, quarter, false).Find(&orders).Error
	if err != nil {
		return nil, err
	}
	return orders, nil
}

func CompleteBuildOrder(id uint) error {
	return DB.Model(&domain.CapBuildOrder{}).Where("id = ?", id).Update("completed", true).Error
}

func GetQuarterliesByCompanyIDs(ids []uint, limit int) (map[uint][]domain.CompanyQuarterly, error) {
	if len(ids) == 0 {
		return nil, nil
	}
	var qs []domain.CompanyQuarterly
	err := DB.Raw(`
		SELECT * FROM (
			SELECT *,
				ROW_NUMBER() OVER (PARTITION BY company_id ORDER BY quarter DESC) as _rn
			FROM company_quarterly
			WHERE company_id IN ?
		) t WHERE _rn <= ?
		ORDER BY company_id, quarter DESC
	`, ids, limit).Scan(&qs).Error
	if err != nil {
		return nil, err
	}

	result := make(map[uint][]domain.CompanyQuarterly, len(ids))
	for _, q := range qs {
		result[q.CompanyID] = append(result[q.CompanyID], q)
	}
	return result, nil
}
