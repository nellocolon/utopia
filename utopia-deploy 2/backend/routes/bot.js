const express            = require('express');
const router             = express.Router();
const { processUpdate }  = require('../services/telegramBot');

// Telegram chiama questo endpoint per ogni update.
// Risponde 200 subito (entro 5s obbligatori) e processa async.
router.post('/webhook', async (req, res) => {
  res.sendStatus(200);
  await processUpdate(req.body);
});

module.exports = router;
