/**
 * api.ts — Canonical API response types for Justice Gavel
 *
 * These types match the actual API contract. Every field here corresponds
 * to a real backend field. Changing a field name here will surface all
 * the places in the UI that reference it — that is the point.
 *
 * Sources: endpoint audit of /src/services/api.ts + all screen consumers.
 */

// ── Auth ──────────────────────────────────────────────────────────────────────

export interface AuthUser {
  id:           number;
  email:        string;
  name:         string;
  role:         'consumer' | 'attorney' | 'bondsman' | 'admin' | 'guest';
  state?:       string;       // e.g. "TN"
  subscription?: 'free' | 'basic' | 'legal_pro' | 'firm';
  tos_accepted?: boolean;
  created_at?:  string;       // ISO 8601
}

export interface AuthTokenResponse {
  token:  string;
  user:   AuthUser;
}

// ── Cases ─────────────────────────────────────────────────────────────────────

export interface Case {
  id:               number;
  title:            string;
  status:           'Active' | 'Closed' | 'Pending' | 'Open' | string;
  state?:           string;       // 2-letter state code
  charges?:         string;
  notes?:           string;
  bail_amount?:     number;       // USD
  next_court_date?: string;       // ISO 8601 date string
  court_name?:      string;
  created_at?:      string;
  updated_at?:      string;
  defendant_name?:  string;
  attorney_id?:     number;
  user_id?:         number;
  _intake?:         CaseIntake;  // structured intake data when AI-parsed
}

export interface CaseIntake {
  title?:           string;
  charge?:          string;
  state?:           string;
  court_date?:      string;
  defendant_name?:  string;
  notes?:           string;
  bail_amount?:     number;
}

export interface CasesResponse {
  cases: Case[];
  total?: number;
}

// ── Lawyers / Attorneys ───────────────────────────────────────────────────────

export interface Lawyer {
  id:               number;
  name:             string;
  email?:           string;
  phone?:           string;
  city?:            string;
  state?:           string;
  specialty?:       string;
  bio?:             string;
  bar_number?:      string;
  bar_verified?:    boolean;
  bar_verified_at?: string;
  bar_verified_date?: string;
  avg_rating?:      number;
  review_count?:    number;
  gavel_level?:     1 | 2 | 3 | number;  // badge tier
  photo_url?:       string;
  available?:       boolean;
  hourly_rate?:     number;
  consultation_fee?: number;
  languages?:       string[];
  created_at?:      string;
}

export interface LawyersResponse {
  lawyers:  Lawyer[];
  total?:   number;
  page?:    number;
}

export interface LawyerReviewSummary {
  avg_rating:   number;
  count:        number;
  top_reviews:  Array<{ rating: number; comment: string }>;
}

// ── Bail / Bondsman ───────────────────────────────────────────────────────────

export interface BailAgent {
  id:           number;
  name:         string;
  agency?:      string;
  phone?:       string;
  email?:       string;
  city?:        string;
  state?:       string;
  county?:      string;
  lat?:         number;
  lng?:         number;
  bail_amount?: number;   // typical bond size handled
  license?:     string;
  verified?:    boolean;
}

export interface BailAgentsResponse {
  agents: BailAgent[];
}

export interface BondsmanLead {
  id:           number;
  defendant_name?: string;
  bail_amount:  number;       // USD — critical field
  charge?:      string;
  charges?:     string;
  court_name?:  string;
  court_date?:  string;
  state?:       string;
  county?:      string;
  status:       'new' | 'accepted' | 'declined' | 'closed' | string;
  purchased?:   boolean;    // lead accepted by bondsman
  created_at?:  string;
  contact_name?: string;
  contact_phone?: string;
}

export interface LeadsResponse {
  leads: BondsmanLead[];
}

// ── Check-In ──────────────────────────────────────────────────────────────────

export interface CheckInEnrollment {
  id:             number;
  user_id:        number;
  case_id?:       number;
  frequency:      'daily' | 'weekly' | 'monthly' | string;
  start_date:     string;
  end_date?:      string;
  next_due:       string;
  streak?:        number;
  status:         'active' | 'paused' | 'completed' | string;
  notes?:         string;
}

export interface CheckInSubmitRequest {
  enrollment_id:  number;
  lat?:           number | null;
  lng?:           number | null;
  location_label?: string;
  notes?:         string;
  device_info?:   string;
}

export interface CheckInSubmitResponse {
  success:  boolean;
  streak?:  number;
  message?: string;
}

// ── Payments ──────────────────────────────────────────────────────────────────

export interface Payment {
  id:           number;
  amount_cents: number;       // e.g. 4999 = $49.99 — critical field
  currency:     string;       // 'usd'
  status:       'paid' | 'pending' | 'failed' | 'refunded' | string;
  description?: string;
  created_at?:  string;
  receipt_url?: string;
}

export interface Subscription {
  plan:         string;
  status:       'active' | 'canceled' | 'past_due' | 'trialing' | string;
  current_period_end?: string;
  cancel_at_period_end?: boolean;
}

// ── Motions ───────────────────────────────────────────────────────────────────

export interface Motion {
  id:           number;
  title:        string;
  content?:     string;
  motion_type?:  string;
  status:       'draft' | 'approved' | 'submitted' | string;
  case_id?:     number;
  created_at?:  string;
  charges?:     string;
}

export interface MotionsResponse {
  motions: Motion[];
}

// ── Arrests / Monitors ────────────────────────────────────────────────────────

export interface ArrestRecord {
  id?:          number;
  name?:        string;
  charge?:      string;
  charges?:     string;    // some endpoints return plural form
  arrest_date?: string;
  facility?:    string;
  county?:      string;
  state?:       string;
  bail_amount?: number;
  status?:      string;
}

export interface ArrestMonitor {
  id:           number;
  name:         string;
  state?:       string;
  county?:      string;
  created_at?:  string;
}

// ── Expungement ───────────────────────────────────────────────────────────────

export interface ExpungementEligibility {
  eligible:         boolean;
  notEligible?:     boolean;
  waitYears?:       number;
  reason?:          string;
  steps?:           string[];
  estimated_cost?:  number;
}

export interface ExpungementResult {
  eligibility:      ExpungementEligibility;
  state?:           string;
  charges?:         string;
  recommendation?:  string;
}

// ── Check-In Manager / Family ─────────────────────────────────────────────────

export interface FamilyContact {
  id:           number;
  name:         string;
  relationship?: string;
  phone?:       string;
  email?:       string;
  bail_amount?: number;    // for incarcerated family members
  facility?:    string;
  state?:       string;
}

// ── Resources / Lessons ───────────────────────────────────────────────────────

export interface Lesson {
  id:           number;
  title:        string;
  category?:    string;
  content?:     string;
  duration_min?: number;
  completed?:   boolean;
}

export interface Resource {
  id:           number;
  title:        string;
  category?:    string;
  phone?:       string;
  url?:         string;
  state?:       string;
  description?: string;
}

// ── Search ────────────────────────────────────────────────────────────────────

export interface SearchResults {
  cases:    Case[];
  lawyers:  Lawyer[];
  messages: Array<{ id: number; content: string; created_at: string }>;
  lessons:  Lesson[];
}

// ── Navigation route params ───────────────────────────────────────────────────
// Replaces the (route?.params as any) pattern everywhere

export interface RouteParams {
  // Case-related
  caseId?:          number | string;
  caseTitle?:       string;
  caseType?:        string;
  case_id?:         number | string;

  // Expungement
  incomingCharges?: string;
  incomingState?:   string;
  incomingCaseId?:  number | string;
  caseTitle2?:      string;

  // Lawyer / booking
  lawyerName?:      string;
  lawyerPhone?:     string;
  lawyerId?:        number | string;

  // Motions
  charges?:         string;
  prefill?:         string;

  // Check-in
  enrollmentId?:    number | string;

  // Discovery / research / messages
  initialQuery?:    string;
  caseContext?:     string;

  // Voice note
  existingNotes?:   string;
  onSave?:          (notes: string) => void;

  // What happens next
  chargeType?:      string;

  // PI lead
  // caseType — already above

  // Generic pass-through (should be phased out)
  [key: string]: unknown;
}
