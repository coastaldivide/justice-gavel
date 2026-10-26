-- 00000000000029_bar_prep_answer_balance.sql — balance the bar-prep answer key
--
-- Legal accuracy review (Oct 2026): 291 of 548 questions (53%) had "B" as the
-- correct answer (A 91, C 100, D 66). A student could beat the bank by always
-- picking B, and a skewed key is a known sign of machine-written questions.
--
-- Fix: for each question whose options do not refer to each other by letter
-- ("Both A and B", "All of the above", "None of the above"), the correct option's
-- text is swapped with the option in a target position, assigned round-robin
-- A, B, C, D in id order. Option TEXT is unchanged, only its position; the
-- explanation and rule_tested never name an option letter for these rows (checked:
-- the letters that appear in explanations are rule subsections such as FRE 801(d)(1)(A)).
-- Position-dependent questions (38 rows) keep their order.
--
-- Idempotent: guarded by jg_meta.data_fixes, so a second run changes nothing.

CREATE SCHEMA IF NOT EXISTS jg_meta;
CREATE TABLE IF NOT EXISTS jg_meta.data_fixes (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());

DO $$
DECLARE
  r record;
  tgt char(1);
  cur_txt text;
  tgt_txt text;
BEGIN
  IF EXISTS (SELECT 1 FROM jg_meta.data_fixes WHERE name = 'bar_prep_answer_balance_v1') THEN
    RETURN;
  END IF;

  FOR r IN
    SELECT q.id, upper(trim(q.correct_answer)) AS ans,
           (row_number() OVER (ORDER BY q.id) - 1) % 4 AS slot
      FROM quiz_questions q
     WHERE upper(trim(q.correct_answer)) IN ('A','B','C','D')
       AND NOT (q.option_a || ' ' || q.option_b || ' ' || q.option_c || ' ' || q.option_d)
               ~* '(both|neither|all of the above|none of the above|\m[ABCD] (and|or) [ABCD]\M)'
       AND coalesce(q.explanation, '') !~* '(choice|option|answer)s?\s+\(?[ABCD]\)?\M'
       AND q.stem !~* '(choice|option)s?\s+\(?[ABCD]\)?\M'
  LOOP
    tgt := substr('ABCD', r.slot::int + 1, 1);
    CONTINUE WHEN tgt = r.ans;
    EXECUTE format('SELECT option_%s, option_%s FROM quiz_questions WHERE id = $1', lower(r.ans), lower(tgt))
       INTO cur_txt, tgt_txt USING r.id;
    EXECUTE format('UPDATE quiz_questions SET option_%s = $1, option_%s = $2, correct_answer = $3, updated_at = now() WHERE id = $4',
                   lower(r.ans), lower(tgt))
       USING tgt_txt, cur_txt, tgt, r.id;
  END LOOP;

  INSERT INTO jg_meta.data_fixes (name) VALUES ('bar_prep_answer_balance_v1');
END $$;
