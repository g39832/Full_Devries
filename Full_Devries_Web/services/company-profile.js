function normalizeCompanyProfile(raw = {}, env = process.env) {
  return {
    businessName: String(raw.businessName || raw.companyName || env.BUSINESS_NAME || 'Your Company Name').trim(),
    businessAddress: String(raw.businessAddress || raw.address || env.BUSINESS_ADDRESS || 'Your Address').trim(),
    businessPhone: String(raw.businessPhone || raw.phone || env.BUSINESS_PHONE || 'Your Phone').trim(),
    businessEmail: String(raw.businessEmail || raw.email || env.BUSINESS_EMAIL || 'your@email.com').trim(),
    logoUrl: String(raw.logoUrl || raw.logo_url || '').trim(),
    defaultScopeOfWork: String(raw.defaultScopeOfWork || raw.default_scope_of_work || '').trim()
  };
}

module.exports = {
  normalizeCompanyProfile
};
