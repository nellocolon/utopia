# UTOPIA — Deploy Guide

Stack: **Supabase** (DB) · **Railway** (Backend Node.js) · **Netlify** (Frontend HTML)  
Tempo stimato: ~45 minuti

---

## Struttura del repository

```
utopia/
├── backend/          ← Node.js + Express API
│   ├── server.js
│   ├── .env.example
│   ├── routes/
│   ├── services/
│   │   └── telegramBot.js   ← bot multi-tenant
│   └── middleware/
├── frontend/         ← 12 file HTML statici
└── database/         ← SQL da eseguire in ordine
    ├── 01_mvp_schema.sql
    ├── 02_ads_schema.sql
    ├── 03_ads_procedures.sql
    └── 04_telegram_multi_tenant.sql
```

---

## STEP 1 — Crea il Bot Telegram (5 min)

Fallo per primo: ti serve il token per le variabili d'ambiente.

1. Apri Telegram → cerca **@BotFather** → `/newbot`
2. Scegli un nome display: es. `UTOPIA Community Bot`
3. Scegli uno username (deve finire in `bot`): es. `UTOPIAbot`
4. BotFather ti risponde con il **token** — copialo, serve al Step 3
5. Imposta i comandi del bot: `/setcommands` → seleziona il bot → incolla:

```
xp - Il tuo saldo XP e rank nella community
referral - Il tuo link invito personale
leaderboard - Top 10 della community
raids - Raid attivi in questo momento
quests - Quest disponibili oggi
```

---

## STEP 2 — Crea il database su Supabase (10 min)

1. Vai su **[supabase.com](https://supabase.com)** → New Project
2. Nome: `utopia-prod` · Regione: **EU West** (per utenti italiani) · imposta una password sicura
3. Aspetta ~2 minuti che il progetto si inizializzi
4. Vai su **Settings → API** e copia:
   - `Project URL` → es. `https://abcdefgh.supabase.co`
   - `anon public` key
   - `service_role` key (⚠️ non condividere mai)
5. Vai su **Settings → Database → Connection string → URI** e copia la **Transaction Pooler URI** (porta 6543)

### Esegui gli SQL in ordine

Vai su **SQL Editor → New Query** e incolla+esegui ogni file nell'ordine:

| # | File | Cosa fa |
|---|------|---------|
| 1 | `database/01_mvp_schema.sql` | 12 tabelle core UTOPIA |
| 2 | `database/02_ads_schema.sql` | 8 tabelle sistema ads |
| 3 | `database/03_ads_procedures.sql` | Stored procedures ads |
| 4 | `database/04_telegram_multi_tenant.sql` | Colonne + tabella OTP Telegram |

✅ Verifica: **Table Editor** → dovresti vedere ~22 tabelle.

---

## STEP 3 — Deploy Backend su Railway (15 min)

### 3a. Carica il codice su GitHub

```bash
# Nella cartella utopia/
git init
git add .
git commit -m "UTOPIA v1.0 — initial deploy"
git branch -M main
git remote add origin https://github.com/TUO-USERNAME/utopia.git
git push -u origin main
```

### 3b. Crea il servizio su Railway

1. Vai su **[railway.app/new](https://railway.app/new)** → **Deploy from GitHub repo**
2. Seleziona il tuo repository `utopia`
3. Railway rileva Node.js automaticamente — ma devi specificare la subdirectory:
   - **Settings → Source → Root Directory**: `backend`
4. Aspetta il primo deploy (potrebbe fallire senza le env vars — è normale)

### 3c. Configura le variabili d'ambiente

In Railway → **Variables** → aggiungi tutte queste:

| Variabile | Valore |
|-----------|--------|
| `NODE_ENV` | `production` |
| `PORT` | `3001` |
| `DATABASE_URL` | Transaction Pooler URI copiata da Supabase (porta 6543) |
| `SUPABASE_URL` | `https://XXXX.supabase.co` |
| `SUPABASE_SERVICE_KEY` | service_role key da Supabase |
| `JWT_SECRET` | stringa random 64+ char (vedi sotto) |
| `JWT_EXPIRES_IN` | `7d` |
| `BCRYPT_ROUNDS` | `12` |
| `FRONTEND_URL` | lascia vuoto per ora, aggiungi dopo il Step 4 |
| `TELEGRAM_BOT_TOKEN` | token da @BotFather |
| `TELEGRAM_BOT_USERNAME` | es. `UTOPIAbot` (senza @) |

**Genera JWT_SECRET** (copia l'output):
```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

### 3d. Ottieni il tuo URL Railway

Railway → **Settings → Networking → Generate Domain**  
Esempio: `utopia-backend-prod.up.railway.app`

### 3e. Verifica che funzioni

```
GET https://utopia-backend-prod.up.railway.app/health
→ { "status": "ok", ... }
```

Se vedi questo, il backend è live. ✅

---

## STEP 4 — Deploy Frontend su Netlify (5 min)

### Metodo rapido: Drag & Drop

1. Vai su **[app.netlify.com/drop](https://app.netlify.com/drop)**
2. Trascina la cartella `frontend/` nella zona di drop
3. Il sito è live in ~30 secondi su es. `random-name.netlify.app`

### Metodo consigliato: GitHub (auto-deploy ad ogni push)

1. **[app.netlify.com/start](https://app.netlify.com/start)** → Import from Git
2. Seleziona il tuo repository GitHub `utopia`
3. **Base directory**: `frontend`
4. **Build command**: lascia **vuoto** (HTML puro, nessuna build)
5. **Publish directory**: `frontend`
6. → **Deploy site**

### Aggiorna FRONTEND_URL su Railway

Ora che hai l'URL Netlify (es. `https://random-name.netlify.app`):
- Torna su Railway → Variables
- Aggiorna `FRONTEND_URL` con il tuo URL Netlify
- Railway fa il redeploy automaticamente

---

## STEP 5 — Aggiorna API_BASE nel frontend (5 min)

I file HTML devono sapere dove si trova il backend.  
Apri VS Code nella cartella `frontend/` e fai un **Find & Replace globale**:

- Cerca: `API_BASE = ''`  
- Sostituisci con: `API_BASE = 'https://utopia-backend-prod.up.railway.app'`

Poi fai il push su GitHub — Netlify fa il redeploy in automatico.

---

## STEP 6 — Test end-to-end (5 min)

Apri il tuo sito Netlify e verifica:

- [ ] `index.html` si apre correttamente
- [ ] Registrazione nuovo account da `onboarding.html`
- [ ] Login e visualizzazione `dashboard.html`
- [ ] Dashboard → Settings → Link Telegram genera codice e apre @UTOPIAbot
- [ ] `GET /health` del backend risponde 200

---

## STEP 7 — Attiva il Bot Telegram sulla tua community

Questo è il flusso che ogni creator seguirà:

1. **Sul dashboard** → Settings → clicca "Open @UTOPIAbot →"
2. Il bot invia un codice a 6 cifre in chat privata
3. Incolla il codice nel campo del dashboard → account collegato ✅
4. **Su Telegram**: aggiungi `@UTOPIAbot` al tuo gruppo community come **amministratore**
5. Il bot rileva automaticamente la community e si attiva 🚀

---

## Dominio custom (opzionale)

### Frontend (Netlify)
- Netlify → **Domain settings → Add custom domain** → es. `utopia.io`
- Aggiungi record DNS nel tuo provider:
  ```
  CNAME  www  random-name.netlify.app
  A      @    75.2.60.5
  ```

### Backend API (Railway)
- Railway → **Settings → Networking → Custom Domain** → es. `api.utopia.io`
- Railway mostra il CNAME da aggiungere al DNS
- Aggiorna `FRONTEND_URL` e `BACKEND_URL` di conseguenza

---

## Troubleshooting rapido

**Railway build fallisce**  
→ Verifica che `Root Directory` sia impostato su `backend`  
→ Controlla che `package.json` abbia `"start": "node server.js"`

**CORS error nel browser**  
→ `FRONTEND_URL` in Railway non corrisponde all'URL Netlify (controlla maiuscole/slash finale)

**Supabase connection error**  
→ Usa la **Transaction Pooler URI** (porta 6543), non la Direct URI (porta 5432)

**Bot Telegram non risponde**  
→ Verifica `TELEGRAM_BOT_TOKEN` corretto in Railway  
→ Controlla i Railway Logs per errori al webhook setup  
→ Forza il webhook manualmente:
```bash
curl "https://api.telegram.org/botTOKEN/setWebhook?url=https://TUO-BACKEND.up.railway.app/api/bot/webhook"
```

**Pagina bianca nel frontend**  
→ F12 → Console → cerca `Failed to fetch` → `API_BASE` non è configurato

---

## Costi mensili stimati

| Servizio | Piano | Costo |
|----------|-------|-------|
| Supabase | Free (500MB DB) | €0 |
| Supabase Pro | 8GB DB + backup | ~€25 |
| Railway Hobby | ~$5 credit incluso | ~€5–10 |
| Netlify | Free (100GB bandwidth) | €0 |
| Dominio .io | Namecheap/Cloudflare | ~€3–5/mese |
| **Totale MVP** | | **€0–15/mese** |
