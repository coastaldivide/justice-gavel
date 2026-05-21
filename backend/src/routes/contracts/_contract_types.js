/**
 * contracts/_contract_types.js — Contract type definitions
 *
 * Each entry defines the contract's label, required fields, optional fields,
 * the AI system prompt guidance, and subscription tier requirements.
 *
 * CONTRACT FUNCTION LAYER — covers:
 *   Drafting    → generate a new contract from structured fields
 *   Review      → analyze an uploaded contract for risks and red flags
 *   Redline     → compare two contract versions and flag changes
 *   Negotiation → generate negotiation talking points from a draft
 *   Execution   → track signature status, expiry, and renewal dates
 */

export const CONTRACT_TYPES = {

  // ── Transactional ──────────────────────────────────────────────────────────
  nda: {
    label:       'Non-Disclosure Agreement (NDA)',
    category:    'Transactional',
    description: 'Mutual or one-way confidentiality agreement protecting trade secrets and proprietary information.',
    required:    ['disclosing_party', 'receiving_party', 'purpose', 'duration_years', 'state'],
    optional:    ['governing_law', 'injunctive_relief', 'return_of_materials', 'exclusions'],
    prompt_suffix: `
- Include: Definitions, Obligations of Receiving Party, Exclusions, Return/Destruction of Materials, Term, Remedies (including injunctive relief), Governing Law, Entire Agreement.
- State whether mutual or one-directional.
- Include survival clause (confidentiality survives termination).
- Flag [ATTORNEY TO VERIFY] next to any jurisdiction-specific provisions.`,
    tier_required: null, // base tier
  },

  employment: {
    label:       'Employment Agreement',
    category:    'Transactional',
    description: 'Full employment contract covering compensation, duties, IP assignment, and termination.',
    required:    ['employer_name', 'employee_name', 'title', 'start_date', 'base_salary', 'state'],
    optional:    ['equity', 'bonus_structure', 'benefits', 'non_compete_duration', 'severance_weeks', 'remote_policy'],
    prompt_suffix: `
- Include: Position and Duties, Compensation (base, bonus, equity), Benefits, Term and At-Will Status, IP Assignment, Confidentiality, Non-Compete/Non-Solicitation (with duration and geography), Termination, Severance, Governing Law.
- Note at-will employment default in relevant US states.
- Flag non-compete enforceability issues by state (CA, ND, MN ban non-competes entirely).
- Include IP assignment clause covering all work product created in scope of employment.`,
    tier_required: null,
  },

  contractor: {
    label:       'Independent Contractor Agreement',
    category:    'Transactional',
    description: 'Engagement agreement for freelancers and independent contractors with IP and classification provisions.',
    required:    ['company_name', 'contractor_name', 'services_description', 'rate', 'rate_type', 'state'],
    optional:    ['project_end_date', 'ip_ownership', 'non_solicitation', 'expenses_policy'],
    prompt_suffix: `
- Include: Services, Compensation and Payment Schedule, Independent Contractor Status (IRS 20-factor test acknowledgment), IP Assignment, Confidentiality, Term and Termination, Indemnification.
- Emphasize contractor classification — include language that contractor sets own hours, uses own tools, and is free to work for others.
- Note risk of worker misclassification under California AB5, FLSA, and state equivalents.`,
    tier_required: null,
  },

  services: {
    label:       'Master Services Agreement (MSA)',
    category:    'Transactional',
    description: 'Framework agreement for ongoing service relationships with SOW attachment structure.',
    required:    ['client_name', 'vendor_name', 'services_scope', 'payment_terms', 'state'],
    optional:    ['liability_cap_multiplier', 'insurance_requirements', 'audit_rights', 'sla_uptime', 'data_processing'],
    prompt_suffix: `
- Include: Services and SOW process, Fees and Payment Terms, Intellectual Property, Confidentiality, Representations and Warranties, Limitation of Liability (cap at 12 months fees), Indemnification, Insurance, Term and Termination, Dispute Resolution.
- Include Statement of Work (SOW) template as Exhibit A.
- Address data processing and security obligations if services involve personal data.
- Include mutual indemnification for third-party IP infringement claims.`,
    tier_required: null,
  },

  saas: {
    label:       'SaaS Subscription Agreement',
    category:    'Technology',
    description: 'Software-as-a-service agreement covering license, SLA, data, and acceptable use.',
    required:    ['vendor_name', 'customer_name', 'product_name', 'subscription_fee', 'billing_cycle', 'state'],
    optional:    ['sla_uptime_pct', 'support_tier', 'data_retention_days', 'users_included', 'auto_renewal'],
    prompt_suffix: `
- Include: License Grant (limited, non-exclusive, non-transferable), Subscription Fees and Renewal, Service Level Agreement (uptime %, credit remedy), Acceptable Use Policy, Data Security and Privacy, Data Ownership (customer owns their data), IP Ownership, Warranty Disclaimer, Limitation of Liability, Term and Termination, Data Return/Destruction on termination.
- Include uptime SLA with credit schedule (e.g., 99.9% uptime; 10% monthly credit per 30-min outage beyond threshold).
- Address GDPR/CCPA: vendor acts as data processor; customer acts as data controller.
- Include auto-renewal notice requirement (30 days prior written notice to cancel).`,
    tier_required: 'contract_pro',
  },

  // ── M&A / Corporate ───────────────────────────────────────────────────────
  loi: {
    label:       'Letter of Intent (LOI)',
    category:    'M&A and Corporate',
    description: 'Non-binding LOI for acquisitions, partnerships, or investment rounds with binding exclusivity.',
    required:    ['buyer_name', 'target_name', 'transaction_type', 'proposed_value', 'exclusivity_days'],
    optional:    ['structure', 'key_conditions', 'due_diligence_period', 'break_up_fee'],
    prompt_suffix: `
- Include: Transaction Summary, Purchase Price / Valuation Range, Transaction Structure (stock vs. asset; merger vs. acquisition), Due Diligence Period, Exclusivity (binding, with duration and break-fee if appropriate), Conditions to Closing, Representations Preview, Governing Law, Expiration Date.
- Clearly delineate binding vs. non-binding provisions. Exclusivity, confidentiality, and governing law are typically binding.
- Note that non-binding nature does not create an obligation to close.
- Flag material adverse change (MAC) clause as a key negotiation point.`,
    tier_required: 'contract_pro',
  },

  asset_purchase: {
    label:       'Asset Purchase Agreement (APA)',
    category:    'M&A and Corporate',
    description: 'Agreement for the purchase and sale of specified business assets with reps, warranties, and indemnities.',
    required:    ['buyer_name', 'seller_name', 'assets_description', 'purchase_price', 'closing_date', 'state'],
    optional:    ['assumed_liabilities', 'excluded_assets', 'earnout_structure', 'escrow_amount', 'non_compete_years'],
    prompt_suffix: `
- Include: Definitions, Purchased Assets and Excluded Assets, Assumed and Excluded Liabilities, Purchase Price and Adjustment, Closing Conditions, Representations and Warranties (both parties), Covenants (pre and post-closing), Indemnification (baskets, caps, survival), Earnout (if applicable), Non-Compete and Non-Solicitation, Governing Law, Dispute Resolution.
- Include a purchase price adjustment mechanism (working capital peg with 60-day true-up).
- Include indemnification caps (typically 10-25% of purchase price for general reps; uncapped for fraud and fundamental reps).
- Flag bulk sale law compliance requirements by state.
- Flag HSR Act notification thresholds if transaction size exceeds $111.4M (2024).`,
    tier_required: 'contract_pro',
  },

  shareholders: {
    label:       'Shareholders Agreement',
    category:    'M&A and Corporate',
    description: 'Governance agreement among shareholders covering voting, transfer restrictions, drag-along, and tag-along.',
    required:    ['company_name', 'shareholders_list', 'jurisdiction', 'total_shares'],
    optional:    ['board_composition', 'protective_provisions', 'drag_along_threshold', 'right_of_first_refusal', 'anti_dilution'],
    prompt_suffix: `
- Include: Definitions, Share Capital, Board Composition and Voting, Reserved Matters (requiring supermajority), Transfer Restrictions, Right of First Refusal, Tag-Along Rights, Drag-Along Rights (with threshold), Anti-Dilution, Information Rights, Deadlock Resolution, Exit Provisions, Governing Law.
- Include protective provisions list (matters requiring investor consent: new equity, debt above threshold, M&A, IP assignment, key employee changes).
- Drag-along threshold should be stated as a percentage (e.g., 75% of shares voting to drag).
- Flag differences between Delaware LLC agreement and C-Corp shareholders agreement structure.`,
    tier_required: 'contract_pro',
  },

  // ── Real Estate ──────────────────────────────────────────────────────────
  commercial_lease: {
    label:       'Commercial Lease Agreement',
    category:    'Real Estate',
    description: 'Office, retail, or industrial lease with tenant protections and landlord remedies.',
    required:    ['landlord_name', 'tenant_name', 'property_address', 'square_footage', 'monthly_rent', 'lease_term_years', 'state'],
    optional:    ['security_deposit', 'rent_escalation_pct', 'tenant_improvement_allowance', 'exclusivity_clause', 'sublease_rights', 'personal_guarantee'],
    prompt_suffix: `
- Include: Premises Description, Lease Term and Commencement, Base Rent and Escalation (CPI or fixed %), CAM Charges, Security Deposit, Permitted Use, Tenant Improvements and Allowance, Assignment and Subletting, Default and Remedies, Indemnification and Insurance Requirements, Hold Harmless, Governing Law.
- Note gross lease vs. NNN lease distinction and which applies.
- Include holdover tenancy provision (typically 150% of last month's rent).
- Flag ADA compliance responsibility (typically landlord for common areas; tenant for interior).`,
    tier_required: null,
  },

  // ── Settlement ──────────────────────────────────────────────────────────
  settlement: {
    label:       'Settlement Agreement and Release',
    category:    'Litigation',
    description: 'Full and final release of all claims arising from a dispute, with payment terms and confidentiality.',
    required:    ['settling_party_1', 'settling_party_2', 'settlement_amount', 'payment_schedule', 'claims_released', 'state'],
    optional:    ['confidentiality_clause', 'non_disparagement', 'structured_payment', 'tax_treatment', 'court_dismissal_type'],
    prompt_suffix: `
- Include: Recitals, Settlement Payment and Schedule, General Release (known and unknown claims — include Civil Code § 1542 waiver for CA matters), Representations and Warranties, Confidentiality (mutual), Non-Disparagement (mutual), Court Dismissal (with or without prejudice, as applicable), Governing Law, Integration Clause.
- Include § 1542 waiver: "A general release does not extend to claims that the creditor or releasing party does not know or suspect to exist..."
- Address tax treatment: note that settlement payments for personal physical injury may be excludable under IRC § 104.
- Non-disparagement should be mutual and survive termination.
- Note that confidentiality of settlement terms is different from confidentiality of allegations.`,
    tier_required: null,
  },

  // ── IP / Licensing ──────────────────────────────────────────────────────
  ip_assignment: {
    label:       'IP Assignment Agreement',
    category:    'Intellectual Property',
    description: 'Full assignment of intellectual property from creator to assignee with representations.',
    required:    ['assignor_name', 'assignee_name', 'ip_description', 'consideration', 'state'],
    optional:    ['patents', 'trademarks', 'copyrights', 'trade_secrets', 'moral_rights_waiver'],
    prompt_suffix: `
- Include: Assignment of IP (full, irrevocable, worldwide, royalty-free), Representations and Warranties (ownership, no encumbrances, no prior assignments), Cooperation for Recordation, Consideration, Governing Law.
- Include "work made for hire" language as alternative/fallback.
- Include covenant to cooperate with patent prosecution, including executing additional documents.
- Flag moral rights (Berne Convention) — relevant for non-US parties.
- Include warranty that no third party claims exist and no government funding was involved (Bayh-Dole Act).`,
    tier_required: null,
  },

  license: {
    label:       'Technology License Agreement',
    category:    'Intellectual Property',
    description: 'Software, patent, or technology license with royalty structure and sublicensing rights.',
    required:    ['licensor_name', 'licensee_name', 'licensed_technology', 'license_scope', 'royalty_structure', 'term_years', 'state'],
    optional:    ['exclusivity', 'sublicense_rights', 'improvements', 'audit_rights', 'milestone_payments'],
    prompt_suffix: `
- Include: License Grant (scope: field of use, territory, exclusivity), License Fee and Royalty Structure, Sublicensing, Improvements and Derivatives, Records and Audit Rights, IP Ownership (licensor retains ownership), Warranty Disclaimer, Indemnification (licensee for use; licensor for IP ownership), Term and Termination, Effect of Termination.
- Specify the licensed field of use precisely.
- Address improvements: does licensee own improvements to licensed technology?
- Include audit rights: licensee permits annual audit of royalty calculations.
- Grant-back clause: does licensor get license to improvements made by licensee?`,
    tier_required: 'contract_pro',
  },
};

export const CONTRACT_CATEGORIES = [
  'Transactional',
  'Technology',
  'M&A and Corporate',
  'Real Estate',
  'Litigation',
  'Intellectual Property',
];

export function getContractsByCategory() {
  const result = {};
  for (const [key, val] of Object.entries(CONTRACT_TYPES)) {
    if (!result[val.category]) result[val.category] = [];
    result[val.category].push({ key, ...val });
  }
  return result;
}
