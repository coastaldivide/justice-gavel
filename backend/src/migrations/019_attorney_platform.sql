-- 019_attorney_platform.sql
-- Attorney platform expansion: practice management layer
--
-- Tables added:
--   office_members       — links attorneys to a public defender office
--   case_assignments     — assigns cases to defenders (already refs'd in messages.js)
--   motion_templates     — shared/approved motion templates across an office
--   cle_courses          — continuing legal education courses on the platform
--   cle_completions      — tracks CLE credit per attorney
--
-- Users fields added:
--   is_defender          — 1 if attorney account
--   office_id            — FK to office_members.office_id (text slug)
--   bar_number           — verified bar number

-- ── Users: attorney fields ─────────────────────────────────────────────────────
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_defender  INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS office_id    TEXT    DEFAULT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS bar_number   TEXT    DEFAULT NULL;

-- ── Office members ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS office_members (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  office_id   TEXT    NOT NULL,                -- e.g. 'pd_davidson_tn'
  office_name TEXT    NOT NULL,
  user_id     INTEGER NOT NULL,
  role        TEXT    DEFAULT 'attorney',       -- 'admin' | 'supervisor' | 'attorney'
  joined_at   TEXT    DEFAULT (datetime('now')),
  active      INTEGER DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_office_members_office ON office_members(office_id);
CREATE INDEX IF NOT EXISTS idx_office_members_user   ON office_members(user_id);

-- ── Case assignments ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS case_assignments (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id     INTEGER NOT NULL,
  defender_id INTEGER NOT NULL,               -- attorney user_id
  assigned_by INTEGER,                        -- supervisor user_id (null = self)
  office_id   TEXT    DEFAULT NULL,
  status      TEXT    DEFAULT 'active',       -- 'active' | 'closed' | 'transferred'
  notes       TEXT    DEFAULT '',
  assigned_at TEXT    DEFAULT (datetime('now')),
  closed_at   TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_case_assign_unique ON case_assignments(case_id, defender_id);
CREATE INDEX IF NOT EXISTS idx_case_assign_defender      ON case_assignments(defender_id, status);
CREATE INDEX IF NOT EXISTS idx_case_assign_office        ON case_assignments(office_id);

-- ── Motion templates (shared library) ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS motion_templates (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  office_id    TEXT    NOT NULL,
  motion_type  TEXT    NOT NULL,              -- matches MOTION_TYPES keys
  title        TEXT    NOT NULL,
  content      TEXT    NOT NULL,              -- full motion text (template)
  notes        TEXT    DEFAULT '',            -- supervisor notes / instructions
  created_by   INTEGER NOT NULL,             -- user_id of creator
  approved_by  INTEGER DEFAULT NULL,          -- supervisor user_id
  status       TEXT    DEFAULT 'pending',     -- 'pending' | 'approved' | 'rejected'
  approved_at  TEXT    DEFAULT NULL,
  created_at   TEXT    DEFAULT (datetime('now')),
  updated_at   TEXT    DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_motion_templates_office ON motion_templates(office_id, status);

-- ── CLE courses ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cle_courses (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  title        TEXT    NOT NULL,
  category     TEXT    NOT NULL,              -- 'ethics' | 'criminal_procedure' | 'evidence' | 'civil_rights' | 'immigration'
  description  TEXT    DEFAULT '',
  content      TEXT    NOT NULL,              -- full course text
  credit_hours REAL    DEFAULT 1.0,           -- CLE credit hours awarded
  difficulty   TEXT    DEFAULT 'intermediate',-- 'beginner' | 'intermediate' | 'advanced'
  active       INTEGER DEFAULT 1,
  created_at   TEXT    DEFAULT (datetime('now'))
);

-- Seed 6 starter CLE courses
INSERT OR IGNORE INTO cle_courses (id, title, category, description, credit_hours, difficulty, content) VALUES
  (1, 'Effective Motion Practice in Criminal Cases', 'criminal_procedure',
   'Suppression motions, Barker analysis, and Brady disclosure — practical techniques for pre-trial defense.',
   1.5, 'intermediate',
   'This course covers the foundational motion types in criminal defense: the motion to suppress, the motion to dismiss, and the motion for bail reduction. We examine the Barker v. Wingo four-factor speedy trial test, Brady v. Maryland materiality analysis, and the practical art of timing motions for maximum impact. By the end of this course, attorneys will be able to identify suppressible evidence in a police report, draft a targeted motion to suppress, and structure a Brady demand letter.'),

  (2, 'Immigration Consequences of Criminal Pleas', 'immigration',
   'Padilla warnings, deportable offenses, and the defense attorney''s duty under Padilla v. Kentucky.',
   1.0, 'intermediate',
   'Padilla v. Kentucky (2010) established that criminal defense attorneys must advise non-citizen clients about the immigration consequences of a guilty plea. This course covers the key deportable offenses under INA §§ 212 and 237, the aggravated felony definition and its sweeping scope, how to identify DACA recipients and visa holders in your caseload, and what a constitutionally adequate Padilla warning looks like. Includes a checklist for intake interviews.'),

  (3, 'Ethics in Criminal Defense: Confidentiality and Candor', 'ethics',
   'Model Rules 1.6, 3.3, and 3.4 in the criminal defense context. When does the duty of confidentiality yield?',
   1.0, 'advanced',
   'Criminal defense attorneys face some of the sharpest ethical tensions in the profession. Model Rule 1.6 protects client confidences — but Rule 3.3 requires candor to the tribunal. This course examines the tension between these duties, the crime-fraud exception to confidentiality, the duty not to present false evidence, and how to handle a client who insists on testifying falsely. Case studies drawn from actual disciplinary proceedings.'),

  (4, 'Evidence Fundamentals for Criminal Defenders', 'evidence',
   'Hearsay, authentication, chain of custody, and the rules that matter most at trial.',
   1.5, 'beginner',
   'This course reviews the Federal Rules of Evidence with emphasis on the rules that arise most frequently in criminal trial practice. We cover hearsay and its exceptions (FRE 801-807), authentication of digital evidence and social media records (FRE 901), the best evidence rule (FRE 1002), and character evidence in criminal cases (FRE 404). Practical exercises include objection practice and cross-examination technique.'),

  (5, 'Juvenile Justice: Rights and Procedures', 'criminal_procedure',
   'In re Gault, juvenile court procedures, and the differences from adult court that matter for defenders.',
   1.0, 'intermediate',
   'In re Gault (1967) established that juveniles have due process rights in delinquency proceedings. This course covers the full juvenile justice arc: Miranda and the juvenile waiver standard, the detention hearing timeline, the difference between adjudication and conviction, disposition alternatives to incarceration, automatic sealing and petition requirements by jurisdiction, and the transfer to adult court — the single most consequential procedural decision in a juvenile case.'),

  (6, 'Competency and Mental Health in Criminal Cases', 'criminal_procedure',
   'Dusky v. United States, competency restoration, NGRI, and the mental health court pathway.',
   1.0, 'intermediate',
   'A significant proportion of criminal defendants have diagnosable mental health conditions. This course covers the Dusky v. United States competency standard, how to identify competency issues at intake, the mechanics of requesting a competency evaluation, competency restoration programs and their timelines, the NGRI defense and its strategic risks, and mental health court as a diversion pathway. Includes intake checklist and referral flowchart.');

-- ── CLE completions ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cle_completions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL,
  course_id    INTEGER NOT NULL,
  bar_number   TEXT    DEFAULT NULL,
  score        INTEGER DEFAULT NULL,           -- quiz score 0-100 (future)
  credit_hours REAL    NOT NULL,
  completed_at TEXT    DEFAULT (datetime('now')),
  certificate_id TEXT  DEFAULT NULL            -- UUID for certificate (future)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_cle_unique    ON cle_completions(user_id, course_id);
CREATE INDEX IF NOT EXISTS idx_cle_user             ON cle_completions(user_id);
