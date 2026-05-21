-- Add enriched fields to lawyers table
ALTER TABLE lawyers ADD COLUMN IF NOT EXISTS specialties TEXT DEFAULT '[]';
ALTER TABLE lawyers ADD COLUMN IF NOT EXISTS languages TEXT DEFAULT '["English"]';
ALTER TABLE lawyers ADD COLUMN IF NOT EXISTS sliding_scale INTEGER DEFAULT 0;
ALTER TABLE lawyers ADD COLUMN IF NOT EXISTS free_consultation INTEGER DEFAULT 0;
ALTER TABLE lawyers ADD COLUMN IF NOT EXISTS years_experience INTEGER DEFAULT NULL;
ALTER TABLE lawyers ADD COLUMN IF NOT EXISTS bio TEXT DEFAULT NULL;

-- Add conversation history table for AI chat
CREATE TABLE IF NOT EXISTS chat_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('user','assistant')),
  content TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_chat_session ON chat_sessions(session_id, created_at);

-- Enrich seed lawyer data
UPDATE lawyers SET
  specialties = '["DUI","Drug Offenses","Traffic Violations"]',
  languages = '["English","Spanish"]',
  sliding_scale = 1,
  free_consultation = 1,
  years_experience = 12,
  bio = 'Experienced DUI and drug defense attorney serving Memphis since 2012. Known for aggressive pre-trial motion practice.',
  pro_bono = 1
WHERE source_id = 'mem_law_1';

UPDATE lawyers SET
  specialties = '["Assault","Domestic Violence","Theft","Weapons Charges"]',
  languages = '["English"]',
  sliding_scale = 0,
  free_consultation = 1,
  years_experience = 8,
  bio = 'Criminal defense specialist focused on violent crime and weapons cases in the Memphis metro area.'
WHERE source_id = 'mem_law_2';

UPDATE lawyers SET
  specialties = '["Drug Offenses","Federal Crimes","White Collar"]',
  languages = '["English","Spanish"]',
  sliding_scale = 0,
  free_consultation = 0,
  years_experience = 17,
  bio = 'Former federal prosecutor with 17 years experience, now defending complex drug and federal cases in Atlanta.'
WHERE source_id = 'atl_law_1';

UPDATE lawyers SET
  specialties = '["DUI","Theft","Juvenile Defense"]',
  languages = '["English"]',
  sliding_scale = 1,
  free_consultation = 1,
  years_experience = 6,
  bio = 'Dedicated to accessible justice — sliding-scale fees and free initial consultations for all clients.'
WHERE source_id = 'atl_law_2';

UPDATE lawyers SET
  specialties = '["Drug Offenses","Assault","Murder/Homicide"]',
  languages = '["English"]',
  sliding_scale = 0,
  free_consultation = 1,
  years_experience = 22,
  bio = 'Senior trial attorney with 22 years defending serious felonies in Wayne County courts.'
WHERE source_id = 'det_law_1';

UPDATE lawyers SET
  specialties = '["DUI","Traffic Violations","Expungement"]',
  languages = '["English","Arabic"]',
  sliding_scale = 1,
  free_consultation = 1,
  years_experience = 9,
  bio = 'Bilingual attorney (English/Arabic) specializing in DUI defense and record expungement.'
WHERE source_id = 'det_law_2';

UPDATE lawyers SET
  specialties = '["Drug Offenses","Assault","Theft"]',
  languages = '["English"]',
  sliding_scale = 1,
  free_consultation = 0,
  years_experience = 14,
  bio = 'Baltimore-based public defender turned private attorney. Sliding-scale fees for qualifying clients.'
WHERE source_id = 'bal_law_1';

UPDATE lawyers SET
  specialties = '["Federal Crimes","White Collar","Drug Offenses"]',
  languages = '["English","Mandarin"]',
  sliding_scale = 0,
  free_consultation = 1,
  years_experience = 19,
  bio = 'Bilingual (English/Mandarin) federal defense attorney with deep expertise in white-collar and drug conspiracy cases.'
WHERE source_id = 'bal_law_2';

UPDATE lawyers SET
  specialties = '["DUI","Drug Offenses","Domestic Violence"]',
  languages = '["English","Spanish"]',
  sliding_scale = 1,
  free_consultation = 1,
  years_experience = 11,
  bio = 'Spanish-speaking defense attorney in Kansas City. Free consultations and payment plans available.'
WHERE source_id = 'kcm_law_1';

UPDATE lawyers SET
  specialties = '["Theft","Assault","Juvenile Defense","Expungement"]',
  languages = '["English"]',
  sliding_scale = 1,
  free_consultation = 1,
  years_experience = 7,
  bio = 'Focused on giving young people a second chance — juvenile defense and record clearing in MO courts.'
WHERE source_id = 'kcm_law_2';

UPDATE lawyers SET
  specialties = '["Drug Offenses","DUI","Weapons Charges"]',
  languages = '["English","Hmong"]',
  sliding_scale = 0,
  free_consultation = 1,
  years_experience = 13,
  bio = 'Hmong-speaking attorney serving Milwaukee\'s Southeast Asian community in criminal defense matters.'
WHERE source_id = 'mil_law_1';

UPDATE lawyers SET
  specialties = '["Assault","Domestic Violence","Theft"]',
  languages = '["English","Spanish"]',
  sliding_scale = 1,
  free_consultation = 0,
  years_experience = 10,
  bio = 'Bilingual criminal defense attorney with a strong track record in Milwaukee County courts.'
WHERE source_id = 'mil_law_2';

UPDATE lawyers SET
  specialties = '["DUI","Drug Offenses","Immigration Consequences"]',
  languages = '["English","Spanish"]',
  sliding_scale = 1,
  free_consultation = 1,
  years_experience = 15,
  bio = 'Specializes in cases where criminal charges carry immigration consequences. Bilingual English/Spanish.'
WHERE source_id = 'abq_law_1';

UPDATE lawyers SET
  specialties = '["Assault","Domestic Violence","Expungement"]',
  languages = '["English","Spanish","Navajo"]',
  sliding_scale = 1,
  free_consultation = 1,
  years_experience = 8,
  pro_bono = 1,
  bio = 'Trilingual attorney (English/Spanish/Navajo) serving Indigenous and Latino communities in Albuquerque.'
WHERE source_id = 'abq_law_2';

UPDATE lawyers SET
  specialties = '["Drug Offenses","Federal Crimes","Assault"]',
  languages = '["English","Spanish"]',
  sliding_scale = 0,
  free_consultation = 0,
  years_experience = 20,
  bio = 'Top-rated Houston federal defense attorney with two decades of courtroom experience across Harris County.'
WHERE source_id = 'hou_law_1';

UPDATE lawyers SET
  specialties = '["DUI","Theft","Domestic Violence","Expungement"]',
  languages = '["English","Spanish","Vietnamese"]',
  sliding_scale = 1,
  free_consultation = 1,
  years_experience = 10,
  bio = 'Trilingual (English/Spanish/Vietnamese) attorney serving Houston\'s diverse communities with affordable defense.'
WHERE source_id = 'hou_law_2';

UPDATE lawyers SET
  specialties = '["DUI","Drug Offenses","Weapons Charges"]',
  languages = '["English"]',
  sliding_scale = 0,
  free_consultation = 1,
  years_experience = 16,
  bio = 'Nashville criminal defense veteran — free consultations and aggressive DUI and drug charge defense.'
WHERE source_id = 'bna_law_1';

UPDATE lawyers SET
  specialties = '["Assault","Theft","Juvenile Defense"]',
  languages = '["English","Spanish"]',
  sliding_scale = 1,
  free_consultation = 1,
  years_experience = 9,
  bio = 'Bilingual Nashville attorney passionate about juvenile justice and keeping families together.'
WHERE source_id = 'bna_law_2';

UPDATE lawyers SET
  specialties = '["DUI","Drug Offenses","Federal Crimes"]',
  languages = '["English"]',
  sliding_scale = 0,
  free_consultation = 1,
  years_experience = 18,
  bio = 'Mile High Defense handles high-stakes federal and state cases across Colorado with a proven track record.'
WHERE source_id = 'den_law_1';

UPDATE lawyers SET
  specialties = '["Assault","Domestic Violence","Expungement","Theft"]',
  languages = '["English","Spanish"]',
  sliding_scale = 1,
  free_consultation = 1,
  years_experience = 11,
  bio = 'Bilingual Denver attorney — sliding-scale fees, free consultations, and a strong focus on expungement.'
WHERE source_id = 'den_law_2';
