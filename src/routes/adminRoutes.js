const express = require('express');
const { Op } = require('sequelize');
const multer = require('multer');
const { Question, QuestionReport, User, RouletteEvent } = require('../models');
const auth = require('../middleware/auth');
const admin = require('../middleware/admin');
const { inferTier } = require('../services/questionTiers');
const { parseQuestionFile } = require('../services/questionImportService');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });
router.use(auth, admin);

router.get('/questions', async (req, res, next) => {
  try {
    const where = {federationId:null};
    if (req.query.status) where.reviewStatus = req.query.status;
    if (req.query.tier) where.tier = Number(req.query.tier);
    if (req.query.q) where.prompt = { [Op.like]: `%${req.query.q}%` };
    const pageSize = Math.min(200, Math.max(10, Number(req.query.limit || 50)));
    const page = Math.max(1, Number(req.query.page || 1));
    const { rows, count } = await Question.findAndCountAll({ where, order: [['updatedAt','DESC']], limit: pageSize, offset: (page - 1) * pageSize });
    res.json({ rows, total: count, page, pageSize, pages: Math.max(1, Math.ceil(count / pageSize)) });
  } catch (e) { next(e); }
});

router.get('/question-stats', async (req, res, next) => {
  try {
    const rows = await Question.findAll({where:{federationId:null}, attributes: ['type','tier','reviewStatus','active'], raw: true });
    const stats = { total: rows.length, byType: {}, byTier: {}, byStatus: {}, active: 0 };
    for (const row of rows) {
      stats.byType[row.type] = (stats.byType[row.type] || 0) + 1;
      stats.byTier[row.tier] = (stats.byTier[row.tier] || 0) + 1;
      stats.byStatus[row.reviewStatus] = (stats.byStatus[row.reviewStatus] || 0) + 1;
      if (row.active) stats.active += 1;
    }
    res.json(stats);
  } catch (e) { next(e); }
});


router.get('/roulette-stats', async (req,res,next)=>{
  try{
    const rows=await RouletteEvent.findAll({attributes:['effect',[require('sequelize').fn('COUNT',require('sequelize').col('id')),'count']],group:['effect'],raw:true});
    const total=rows.reduce((sum,r)=>sum+Number(r.count||0),0);
    res.json({total,rows:rows.map(r=>({effect:r.effect,count:Number(r.count||0),percentage:total?Math.round(Number(r.count||0)*10000/total)/100:0}))});
  }catch(e){next(e);}
});
router.post('/questions', async (req, res, next) => {
  try {
    const payload = { ...req.body, federationId:null, federationAuthorId:null };
    payload.tier = Number(payload.tier || inferTier(payload));
    payload.reviewStatus = payload.reviewStatus || 'review';
    const q = await Question.create(payload);
    res.status(201).json(q);
  } catch (e) { next(e); }
});

router.patch('/questions/:id', async (req, res, next) => {
  try {
    const q = await Question.findByPk(Number(req.params.id));
    if (!q||q.federationId) return res.status(404).json({ error: 'Pregunta inexistente.' });
    const allowed = ['type','prompt','options','correctAnswer','category','competition','knowledgeArea','tier','difficulty','reviewStatus','active'];
    for (const key of allowed) if (req.body[key] !== undefined) q[key] = req.body[key];
    q.version += 1;
    if (['published','rejected'].includes(q.reviewStatus)) {
      q.reviewedById = req.user.id;
      q.reviewedAt = new Date();
    }
    await q.save();
    res.json(q);
  } catch (e) { next(e); }
});


router.post('/questions/import', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Adjuntá un archivo CSV o JSON.' });
    const rows = parseQuestionFile(req.file.buffer, req.file.mimetype, req.file.originalname);
    const chunkSize = 500;
    let inserted = 0;
    for (let i = 0; i < rows.length; i += chunkSize) {
      const chunk = rows.slice(i, i + chunkSize).map(q => ({ ...q, reviewedById: req.user.id, reviewedAt: q.reviewStatus === 'published' ? new Date() : null }));
      await Question.bulkCreate(chunk, { validate: true });
      inserted += chunk.length;
    }
    res.status(201).json({ inserted, total: rows.length });
  } catch (e) { next(e); }
});

router.delete('/questions/:id', async (req, res, next) => {
  try {
    const q = await Question.findByPk(Number(req.params.id));
    if (!q||q.federationId) return res.status(404).json({ error: 'Pregunta inexistente.' });
    await q.destroy();
    res.json({ ok: true, id: Number(req.params.id) });
  } catch (e) { next(e); }
});

router.patch('/users/:id/role', async (req, res, next) => {
  try {
    const role = String(req.body.role || '');
    if (!['user','moderator','admin'].includes(role)) return res.status(400).json({ error: 'Rol inválido.' });
    const user = await User.findByPk(Number(req.params.id));
    if (!user) return res.status(404).json({ error: 'Usuario inexistente.' });
    user.role = role;
    await user.save();
    res.json({ id: user.id, username: user.username, role: user.role });
  } catch (e) { next(e); }
});

router.get('/reports', async (req, res, next) => {
  try {
    const reports = await QuestionReport.findAll({
      where: req.query.status ? { status: req.query.status } : {},
      include: [Question, { model: User, as: 'reporter', attributes: ['id','username'] }],
      order: [['createdAt','DESC']],
      limit: 200
    });
    res.json(reports);
  } catch (e) { next(e); }
});

router.patch('/reports/:id', async (req, res, next) => {
  try {
    const report = await QuestionReport.findByPk(Number(req.params.id));
    if (!report) return res.status(404).json({ error: 'Reporte inexistente.' });
    report.status = ['resolved','dismissed'].includes(req.body.status) ? req.body.status : report.status;
    report.resolution = String(req.body.resolution || '').slice(0, 1000) || null;
    report.resolvedById = req.user.id;
    report.resolvedAt = new Date();
    await report.save();
    res.json(report);
  } catch (e) { next(e); }
});

module.exports = router;
