-- Bar Prep Subjects Update: add 5 new MBE subjects
-- Adds Contracts, Civil Procedure, Evidence, Real Property, Torts

BEGIN;

INSERT INTO bar_prep_subjects
  (id, name, description, question_count, color, icon, is_active)
VALUES
  ('contracts-001',
   'Contracts & UCC',
   'Formation, consideration, performance, breach, remedies, defenses, and UCC Article 2.',
   105, '#2563EB', 'document-text', true),

  ('civ-pro-001',
   'Civil Procedure',
   'Federal jurisdiction, pleading, discovery, summary judgment, trial, preclusion, venue, and class actions.',
   43, '#7C3AED', 'scale', true),

  ('evidence-001',
   'Evidence',
   'FRE relevance, character, hearsay, exceptions, privileges, expert witnesses, and authentication.',
   25, '#059669', 'eye', true),

  ('real-prop-001',
   'Real Property',
   'Ownership interests, concurrent ownership, landlord-tenant, recording acts, adverse possession, easements, covenants, and mortgages.',
   25, '#D97706', 'home', true),

  ('torts-001',
   'Torts',
   'Intentional torts, negligence, strict liability, products liability, defamation, nuisance, and damages.',
   25, '#DC2626', 'lightning-bolt', true)

ON CONFLICT (id) DO UPDATE SET
  name          = EXCLUDED.name,
  description   = EXCLUDED.description,
  question_count = EXCLUDED.question_count,
  color         = EXCLUDED.color,
  icon          = EXCLUDED.icon,
  is_active     = EXCLUDED.is_active;

-- Also update con-law-001 question count to reflect the 75 gap questions added
UPDATE bar_prep_subjects
SET question_count = question_count + 75
WHERE id = 'con-law-001';

COMMIT;
