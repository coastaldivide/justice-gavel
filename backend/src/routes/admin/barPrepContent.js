/**
 * routes/admin/barPrepContent.js — Content management for bar prep
 * [I-08]
 *
 * Attorneys can correct questions, bulk import CSVs, and resolve user flags.
 */
import { Router }       from 'express';
import { asyncRoute }   from '../../utils/routeHelpers.js';
import { authRequired } from '../../middleware/auth.js';

const router = Router();

/** GET /admin/bar-prep/questions — paginated question list */
router.get('/questions', authRequired, asyncRoute(async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  const { page = 1, subject, difficulty, flagged } = req.query;
  const limit  = 50;
  const offset = (page - 1) * limit;

  const rows = await req.db.all(`
    SELECT qq.*, bs.code AS subject_code, bs.title AS subject_title,
           COUNT(qf.id) AS flag_count
    FROM quiz_questions qq
    JOIN bar_subjects bs ON bs.id = qq.subject_id
    LEFT JOIN quiz_question_flags qf ON qf.question_id = qq.id AND qf.resolved = false
    WHERE 1=1
      ${subject    ? `AND bs.code = '${subject}'`          : ''}
      ${difficulty ? `AND qq.difficulty = '${difficulty}'` : ''}
      ${flagged    ? `AND qq.flag_count > 0`               : ''}
    GROUP BY qq.id, bs.code, bs.title
    ORDER BY qq.created_at DESC
    LIMIT ? OFFSET ?
  `, [limit, offset]);

  return res.json({ data: rows, meta: { page: +page, limit } });
}));

/** PUT /admin/bar-prep/questions/:id — correct a question */
router.put('/questions/:id', authRequired, asyncRoute(async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  const { id } = req.params;
  const { stem, option_a, option_b, option_c, option_d,
          correct_answer, explanation, rule, case_citation,
          difficulty, category } = req.body;

  await req.db.run(`
    UPDATE quiz_questions SET
      stem = COALESCE(?, stem), option_a = COALESCE(?, option_a),
      option_b = COALESCE(?, option_b), option_c = COALESCE(?, option_c),
      option_d = COALESCE(?, option_d), correct_answer = COALESCE(?, correct_answer),
      explanation = COALESCE(?, explanation), rule = COALESCE(?, rule),
      case_citation = COALESCE(?, case_citation), difficulty = COALESCE(?, difficulty),
      category = COALESCE(?, category),
      ai_explanation = NULL, -- regenerate AI explanation on next request
      updated_at = NOW()
    WHERE id = ?
  `, [stem, option_a, option_b, option_c, option_d, correct_answer,
      explanation, rule, case_citation, difficulty, category, id]);

  return res.json({ data: { id, updated: true } });
}));

/** POST /admin/bar-prep/import — bulk CSV import */
router.post('/import', authRequired, asyncRoute(async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  const { subject_code, questions } = req.body;
  // questions: [{ stem, option_a, option_b, option_c, option_d,
  //               correct_answer, explanation, rule, case_citation,
  //               difficulty, category }]
  if (!Array.isArray(questions) || !questions.length) {
    return res.status(400).json({ error: 'questions array required' });
  }

  const subject = await req.db.get(
    'SELECT id FROM bar_subjects WHERE code = ?', [subject_code]
  );
  if (!subject) return res.status(404).json({ error: 'Subject not found' });

  let imported = 0;
  for (const q of questions) {
    await req.db.run(`
      INSERT INTO quiz_questions
        (subject_id, category, difficulty, stem, option_a, option_b, option_c, option_d,
         correct_answer, explanation, rule, case_citation, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, true)
    `, [subject.id, q.category ?? 'general', q.difficulty ?? 'medium',
        q.stem, q.option_a, q.option_b, q.option_c, q.option_d,
        q.correct_answer, q.explanation, q.rule ?? null, q.case_citation ?? null]);
    imported++;
  }

  return res.status(201).json({ data: { imported, subject_code } });
}));

/** GET /admin/bar-prep/flags — unresolved flags */
router.get('/flags', authRequired, asyncRoute(async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  const flags = await req.db.all(`
    SELECT qf.*, qq.stem, qq.correct_answer, u.email AS reporter_email
    FROM quiz_question_flags qf
    JOIN quiz_questions qq ON qq.id = qf.question_id
    LEFT JOIN users u ON u.id = qf.user_id
    WHERE qf.resolved = false
    ORDER BY qf.created_at DESC LIMIT 100
  `);
  return res.json({ data: flags });
}));

/** PATCH /admin/bar-prep/flags/:id/resolve */
router.patch('/flags/:id/resolve', authRequired, asyncRoute(async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  await req.db.run(
    'UPDATE quiz_question_flags SET resolved = true WHERE id = ?', [req.params.id]
  );
  return res.json({ data: { resolved: true } });
}));

export default router;
