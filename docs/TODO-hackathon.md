# Hackathon TODO — Pending Tasks

---

## 🚨 URGENTE — Deadline: DOMINGO 29 JUNIO a las 5:00 PM PT (hacer TODO en la mañana)

### ⚠️ FEEDBACK DE ORGANIZADORES — Submission incompleta, arreglar ANTES del deadline:

- [ ] **1. Screenshot de AWS Database (REQUERIDO)**
  - Ir a AWS Console → DynamoDB → Tables (region us-east-2)
  - Tomar screenshot mostrando las tablas `ollinai-*`
  - URL directa: https://us-east-2.console.aws.amazon.com/dynamodbv2/home?region=us-east-2#tables
  - Subir el screenshot en DevPost donde dice "Upload a screenshot proving your AWS database usage"

- [ ] **2. Acceso al proyecto (REQUERIDO para ser elegible)**
  - La app DEBE estar corriendo: https://ollin-ai.vercel.app
  - Levantar infra: `cd infra/terraform && terraform apply`
  - Restaurar backup: `bash scripts/dynamodb-backup.sh restore`
  - Actualizar credenciales AWS personales en Vercel dashboard
  - Desactivar SQS trigger del risk-scorer Lambda
  - Verificar: `curl https://ollin-ai.vercel.app/api/health/db`

- [ ] **3. Credenciales de login para jueces (REQUERIDO — app es privada)**
  - Crear usuario demo: `judges@ollinai.com` / contraseña segura (tier: enterprise)
  - Verificar login funciona en https://ollin-ai.vercel.app
  - Poner credenciales en "Testing Instructions" de DevPost
  - Texto ejemplo: "Login: judges@ollinai.com / Password: [xxx]"

- [ ] **4. Video de demo MÁXIMO 3 minutos**
  - Regla oficial: "Judges are not required to watch beyond three minutes"
  - Usar el script de `docs/video-script-guide.md` (ya ajustado a ~2:55)
  - Si el video actual es más largo, re-grabar o cortar

- [ ] **5. Verificar dashboard muestra datos** antes de enviar
  - DORA metrics visibles
  - Risk distribution visible
  - Todas las secciones avanzadas cargando

---

## Bonus Points: Optional Content URLs

Create content for bonus points. Each piece MUST include language stating it was created for the purposes of entering the H0 Hackathon.

Use hashtag: **#H0Hackathon**

### Tasks for Tomorrow

- [ ] **Write a Medium blog post** (alexmarket.medium.com)
  - Topic: "How DynamoDB's Partition Key Model Becomes Your Security Model"
  - Include: "This article was created for the purposes of entering the H0 Hackathon hosted at h01.devpost.com"
  - Share on Twitter/LinkedIn with #H0Hackathon

- [ ] **Post on Twitter/X**
  - Short thread about OllinAI + DynamoDB architecture
  - Include #H0Hackathon hashtag
  - Link to the live app and GitHub repo

- [ ] **Post on LinkedIn**
  - Professional post about building OllinAI for the hackathon
  - Include: "Created for the H0 Hackathon"
  - Use #H0Hackathon

- [ ] **Collect URLs** and paste into the DevPost submission form under "Optional content for Bonus Points"

### Required Disclaimer (copy-paste into each piece of content)

> "This content was created for the purposes of entering the H0 Hackathon (h01.devpost.com). #H0Hackathon"

### Links to Submit
- Medium post URL: ___
- Twitter/X thread URL: ___
- LinkedIn post URL: ___
