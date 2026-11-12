# Ankara GOAT v0.3.0

Juego online multijugador que mezcla tablero tipo Oca, trivia futbolera, torneos y ranking público de conocimiento.

Esta versión incorpora reglas de desempate completas, ELO público, roles `user/moderator/admin`, moderación, carga masiva de preguntas, Cloudflare R2, Redis + BullMQ, escalado horizontal de Socket.IO y un simulador de carga para probar muchas partidas simultáneas.

---

## 1. Stack

- **Frontend:** HTML + CSS + JavaScript.
- **Backend:** Node.js + Express.
- **Tiempo real:** Socket.IO.
- **Base de datos:** MySQL + Sequelize.
- **Migraciones:** Umzug + Sequelize.
- **Escalado Socket.IO:** Redis Adapter.
- **Temporizadores persistentes:** BullMQ + Redis.
- **Imágenes:** Cloudflare R2 mediante API S3 compatible.
- **Autenticación:** JWT + bcryptjs.
- **Deploy:** Railway.

En producción el cliente y el servidor Socket.IO usan **WebSocket-only**. Esto es intencional: Railway distribuye conexiones entre réplicas pero no ofrece sticky sessions; Socket.IO sólo necesita sticky sessions cuando se usa HTTP long-polling. Con WebSocket-only, cada conexión permanece asociada a la réplica que aceptó ese WebSocket y Redis distribuye los eventos entre réplicas.

Documentación oficial relacionada:

- Railway variables: https://docs.railway.com/variables
- Railway healthchecks: https://docs.railway.com/deployments/healthchecks
- Railway config as code: https://docs.railway.com/config-as-code/reference
- Socket.IO múltiples nodos: https://socket.io/docs/v4/using-multiple-nodes/
- Socket.IO Redis Adapter: https://socket.io/docs/v4/redis-adapter/
- Cloudflare R2 autenticación: https://developers.cloudflare.com/r2/api/tokens/
- Cloudflare R2 con S3: https://developers.cloudflare.com/r2/get-started/s3/
- Cloudflare R2 buckets públicos: https://developers.cloudflare.com/r2/buckets/public-buckets/

---

## 2. Regla central de movimiento

El dado no mueve definitivamente al jugador.

Flujo:

1. El jugador tira el dado.
2. El servidor calcula el casillero **potencial**.
3. Se muestra la pregunta.
4. Si responde correctamente, la ficha avanza al destino.
5. Si responde mal o vence el tiempo, la ficha vuelve/quedará exactamente en el casillero previo.
6. La sorpresa del destino sólo se aplica cuando la respuesta es correcta, salvo **Cara o Seca**, cuya regla propia castiga al jugador si falla.

Ejemplo:

```text
Posición actual: 12
Dado: 5
Destino potencial: 17

Acierta  -> termina en 17
Falla    -> sigue en 12
```

---

## 3. Tiers de preguntas

Las preguntas tienen:

- `tier`: 1, 2 o 3.
- `difficulty`: 1 a 5.
- `knowledgeArea`: área utilizada para estadísticas de conocimiento.
- `reviewStatus`: `draft`, `review`, `published` o `rejected`.
- `active`: activa/inactiva.

Modos:

| Modo | Tier 1 Popular | Tier 2 Fanático | Tier 3 Enfermo |
|---|---:|---:|---:|
| Casual | 60% | 30% | 10% |
| Futbolero | 45% | 40% | 15% |
| Enfermo | 25% | 40% | 35% |
| **Ankara** | **35%** | **35%** | **30%** |

La selección no es azar puro: el servidor calcula qué Tier está más por debajo de su cuota durante la partida y prioriza ese Tier. Así el reparto se aproxima de verdad al modo elegido.

---

## 4. Tabla de posiciones y desempates

En **liga todos contra todos** y en cada **liguilla/grupo**, la tabla muestra:

```text
Posición | Equipo | Puntos | Victorias | Correctas | Incorrectas | Diferencia
```

Donde:

```text
Diferencia = preguntas correctas - preguntas incorrectas
```

### Orden oficial

1. Más **puntos**.
2. Si empatan en puntos: más **victorias**.
3. Si empatan en puntos y victorias: mejor **diferencia de preguntas**.
4. Si dos o más siguen exactamente empatados en los tres criterios: se genera una **partida definitoria**.

### Partida definitoria

El desempate usa el orden real de llegada de esa partida.

Ejemplo con cuatro empatados:

```text
1. Equipo C llega a la meta
2. Equipo A queda en casillero 67
3. Equipo D queda en casillero 62
4. Equipo B queda en casillero 51
```

La tabla final de esos cuatro queda C > A > D > B, sin volver a aplicar puntos/victorias/diferencia dentro de ese empate.

En liguillas, la llave eliminatoria **no se completa** hasta resolver los desempates que puedan cambiar las posiciones clasificatorias.

Las partidas normales mantienen el límite de **2 a 8 jugadores**. Como una liga puede tener hasta 14 participantes, una partida exclusivamente marcada como `isStandingsTiebreak` admite excepcionalmente **2 a 14**, para poder resolver incluso el caso extremadamente raro en que 9–14 usuarios terminen exactamente empatados.

---

## 5. Puntos de torneos multijugador

Se conserva la regla aprobada:

| Jugadores | Puntuación |
|---|---|
| 2 | 1.º = 3 |
| 3–4 | 1.º = 3, 2.º = 1 |
| 5–8 | 1.º = 8, 2.º = 5, 3.º = 3, 4.º = 1 |

---

## 6. ELO público

Todos empiezan en ELO 1000.

El ranking es público y se puede consultar **sin iniciar sesión**. La portada incluye “Ver ranking ELO público”.

Endpoint:

```http
GET /api/leaderboard
```

El objetivo es que cualquier visitante pueda ver quiénes son los jugadores con mejor rendimiento/ conocimiento competitivo.

---

## 7. Roles y permisos

### Usuario regular

Puede:

- jugar;
- crear/editar su equipo;
- participar en torneos;
- usar chat/reacciones;
- consultar ELO y perfiles públicos;
- denunciar preguntas que considere incorrectas;
- denunciar nombres de equipos o mensajes de chat.

No puede crear, editar, borrar ni importar preguntas.

### Moderador

Puede todo lo anterior y además:

- revisar reportes de nombres y chats;
- ocultar mensajes;
- rechazar nombres de equipo;
- silenciar chat temporalmente;
- quitar un mute;
- suspender/restaurar cuentas;
- consultar el registro de acciones de moderación.

**No puede administrar el banco de preguntas.** Tampoco puede sancionar a otro moderador ni a un administrador; esos casos se escalan a un admin.

### Administrador

Puede:

- todo lo de moderador;
- crear preguntas una por una;
- editar preguntas;
- eliminar preguntas;
- activar/desactivar;
- definir Tier, dificultad y área de conocimiento;
- importar CSV/JSON por lotes;
- resolver denuncias de preguntas;
- cambiar roles de usuarios.

Panel de preguntas:

```text
/admin.html
```

Panel de moderación:

```text
/moderator.html
```

---

## 8. Política de moderación

Versión actual de la política:

```text
2026-09-05
```

El usuario **debe aceptarla al registrarse**. La aceptación y versión quedan guardadas en la base de datos.

### 8.1 Nombres de equipos

No se permiten:

- insultos graves dirigidos;
- odio o discriminación por características personales/protegidas;
- amenazas;
- acoso dirigido;
- referencias sexuales explícitas;
- explotación o sexualización de menores;
- violencia extrema explícita;
- suplantación engañosa de una persona, organización o club;
- datos personales propios o de terceros;
- spam/publicidad engañosa;
- nombres creados para evadir deliberadamente los filtros.

Sí se permiten cargadas, rivalidad, humor futbolero y nombres provocadores mientras no crucen esos límites.

### 8.2 Chat

No se permiten:

- amenazas;
- acoso persistente;
- ataques discriminatorios;
- doxxing o publicación de teléfono, domicilio, contraseñas u otros datos personales;
- phishing, estafas o enlaces maliciosos;
- spam repetitivo;
- contenido sexual explícito;
- explotación de menores.

### 8.3 Escala de intervención

Para infracciones leves:

```text
Advertencia -> ocultar mensaje -> mute temporal -> suspensión
```

No es obligatorio recorrer todos los pasos cuando el contenido es grave.

Odio grave, amenazas creíbles, doxxing, explotación sexual de menores o intentos de comprometer la plataforma pueden justificar suspensión inmediata.

Toda acción queda auditada con:

- moderador;
- usuario objetivo;
- tipo de acción;
- motivo;
- fecha;
- vencimiento cuando corresponda.

Los administradores pueden revisar/revertir decisiones.

### 8.4 Filtro automático

Existe `MODERATION_BLOCKLIST`, pero funciona únicamente como primera barrera. No reemplaza el criterio humano.

Ejemplo:

```env
MODERATION_BLOCKLIST=frase1,frase2,frase3
```

No conviene hacer una lista gigantesca sin contexto: genera falsos positivos y los usuarios aprenden a evadirla. La decisión final sigue siendo de moderadores/admins.

---

## 9. Administración de las 30.000 preguntas

El diseño original contempla:

- 20.000 multiple choice.
- 10.000 categorización.

Sólo administradores pueden cargarlas.

### 9.1 Formulario individual

Entrar como admin y abrir:

```text
/admin.html
```

Desde allí se puede:

- crear;
- editar;
- borrar;
- publicar/rechazar;
- cambiar Tier;
- cambiar dificultad;
- cambiar categoría/competencia/knowledge area.

### 9.2 Importación JSON

Plantilla incluida:

```text
examples/questions-template.json
```

Formato multiple choice:

```json
{
  "type": "multiple_choice",
  "prompt": "¿Qué selección ganó el Mundial de 2014?",
  "options": ["Alemania", "Argentina", "Brasil", "España"],
  "correctAnswer": "Alemania",
  "category": "Selecciones",
  "competition": "Mundial",
  "knowledgeArea": "Mundiales",
  "tier": 1,
  "difficulty": 1,
  "reviewStatus": "published",
  "active": true
}
```

Formato categorización:

```json
{
  "type": "categorization",
  "prompt": "Clasificá estos clubes por confederación.",
  "options": {
    "categories": ["CONMEBOL", "UEFA"],
    "items": ["Peñarol", "Benfica", "Celtic", "Nacional"]
  },
  "correctAnswer": {
    "Peñarol": "CONMEBOL",
    "Benfica": "UEFA",
    "Celtic": "UEFA",
    "Nacional": "CONMEBOL"
  },
  "knowledgeArea": "Confederaciones",
  "tier": 2,
  "difficulty": 2,
  "reviewStatus": "published",
  "active": true
}
```

El archivo completo debe ser un array JSON.

### 9.3 Importación CSV

Plantilla incluida:

```text
examples/questions-template.csv
```

Columnas principales para multiple choice:

```text
type
prompt
option_a
option_b
option_c
option_d
correct_answer
category
competition
knowledge_area
tier
difficulty
review_status
active
```

Para categorización en CSV se pueden usar `options`/`options_json` y `correct_answer_json` conteniendo JSON escapado. Por practicidad, para grandes lotes de categorización se recomienda JSON.

La importación:

- valida estructura;
- exige exactamente 4 opciones en multiple choice;
- verifica que la respuesta correcta esté entre las cuatro;
- exige Tier 1–3;
- exige dificultad 1–5;
- valida objetos de categorización;
- rechaza prompts duplicados dentro del mismo archivo;
- admite hasta 30.000 filas por importación;
- inserta en bloques de 500.

### 9.4 Validación por consola

Antes de importar un banco:

```bash
npm run validate:questions -- ./preguntas.json
```

Luego se puede importar desde el panel admin o por el script del proyecto.

---

# 10. Cloudflare R2: configuración paso a paso

En producción Ankara GOAT usa R2 para los escudos. **No uses el disco local de Railway** para archivos permanentes porque el almacenamiento del servicio es efímero.

## 10.1 Crear el bucket

1. Entrá en Cloudflare Dashboard.
2. Abrí **R2 Object Storage**.
3. Si todavía no activaste R2, completá la activación/facturación requerida por Cloudflare.
4. Elegí **Create bucket**.
5. Nombre sugerido:

```text
ankara-goat-media
```

6. Para un proyecto normal podés dejar la jurisdicción por defecto, salvo que tengas un requisito legal/regional específico.
7. Creá el bucket.

Variable resultante:

```env
R2_BUCKET=ankara-goat-media
```

## 10.2 Conseguir Account ID

Cloudflare muestra el **Account ID** en el dashboard de la cuenta/R2.

Copialo:

```env
R2_ACCOUNT_ID=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

El endpoint S3 estándar queda:

```text
https://<ACCOUNT_ID>.r2.cloudflarestorage.com
```

El código lo construye automáticamente. Sólo necesitás definir `R2_ENDPOINT` si usás un endpoint jurisdiccional especial.

## 10.3 Crear credenciales R2

1. En R2, buscá **API Tokens** / **Manage R2 API Tokens**.
2. Creá un **Account API token** o **User API token**.
3. Permiso recomendado:

```text
Object Read & Write
```

4. Limitá el token al bucket:

```text
ankara-goat-media
```

No le des permiso administrativo de todos los buckets si Ankara GOAT sólo necesita escribir/leer sus escudos.

5. Creá el token.
6. Cloudflare mostrará:

```text
Access Key ID
Secret Access Key
```

7. Copiá ambos inmediatamente. Cloudflare advierte que el Secret Access Key no vuelve a mostrarse después.

Variables:

```env
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
```

## 10.4 Publicar los escudos

El navegador necesita una URL pública para mostrar las imágenes.

Para pruebas se puede habilitar el dominio `r2.dev`, pero Cloudflare recomienda un **custom domain** para producción.

Ejemplo:

```text
media.ankaragoat.com
```

En R2:

1. Abrí el bucket.
2. Settings.
3. Public access / Custom Domains.
4. Conectá el dominio.
5. Esperá que Cloudflare lo active.

Variable:

```env
R2_PUBLIC_BASE_URL=https://media.ankaragoat.com
```

Sin slash final.

## 10.5 Variables finales de R2

En producción:

```env
MEDIA_PROVIDER=r2
R2_ACCOUNT_ID=xxxxxxxx
R2_ACCESS_KEY_ID=xxxxxxxx
R2_SECRET_ACCESS_KEY=xxxxxxxx
R2_BUCKET=ankara-goat-media
R2_PUBLIC_BASE_URL=https://media.ankaragoat.com
```

No subas estas credenciales a GitHub.

## 10.6 Cómo guarda archivos Ankara GOAT

Los objetos usan claves como:

```text
crests/user-123/550e8400-e29b-41d4-a716-446655440000.webp
```

Formatos permitidos:

- PNG
- JPEG
- WebP

SVG no está permitido para reducir riesgos de contenido activo/XSS.

---

# 11. Desarrollo local desde cero

## 11.1 Requisitos

- Node.js 20 o superior.
- MySQL 8.
- Redis opcional para desarrollo, recomendado para reproducir producción.
- Git.

## 11.2 Instalar

```bash
git clone <TU_REPOSITORIO>
cd ankara-goat
npm install
```

## 11.3 Crear `.env`

Linux/macOS:

```bash
cp .env.example .env
```

Windows CMD:

```cmd
copy .env.example .env
```

Generá un secreto JWT largo. Con Node:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Pegalo en:

```env
JWT_SECRET=...
```

## 11.4 Crear MySQL

Ejemplo:

```sql
CREATE DATABASE ankara_goat
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;
```

Configurá usuario/contraseña en `.env`.

## 11.5 Migraciones

```bash
npm run migrate
```

En desarrollo `AUTO_MIGRATE=true` hace que el servidor también aplique migraciones faltantes al iniciar.

## 11.6 Datos demo

```bash
npm run seed
```

## 11.7 Ejecutar

```bash
npm run dev
```

Abrir:

```text
http://localhost:3000
```

Healthcheck:

```text
http://localhost:3000/api/health
```

Debe responder `ok: true`.

---

# 12. Despliegue completo en Railway

La opción más sencilla para empezar es GitHub + Railway Dashboard.

## 12.1 Subir el proyecto a GitHub

Desde la carpeta:

```bash
git init
git add .
git commit -m "Ankara GOAT v0.3.0"
git branch -M main
git remote add origin https://github.com/TU_USUARIO/ankara-goat.git
git push -u origin main
```

Confirmá antes que `.env` esté ignorado por `.gitignore`.

## 12.2 Crear proyecto Railway

1. Entrá a Railway.
2. **New Project**.
3. **Deploy from GitHub repo**.
4. Autorizá GitHub si hace falta.
5. Seleccioná `ankara-goat`.
6. Railway creará el servicio Node.

El repositorio ya incluye `railway.json` con:

```text
pre-deploy: DESACTIVADO (migraciones sujetas a validación manual)
start: npm start
healthcheck: /api/health
restart: ON_FAILURE
overlap: 20 s
draining: 20 s
```

En Federaciones V1 las migraciones **no se ejecutan automáticamente**. Validá primero el esquema en una copia de base de datos. Para el procedimiento completo, consultá `RELEASE_FEDERACIONES_V1.md`.

## 12.3 Agregar MySQL

En el mismo proyecto:

1. Click **Create/New**.
2. **Database**.
3. **MySQL**.
4. Esperá a que quede activo.
5. Si el servicio no se llama `MySQL`, renombralo a `MySQL` para que los ejemplos siguientes coincidan.

Railway expone variables del servicio MySQL, incluyendo una URL de conexión.

## 12.4 Agregar Redis

En el mismo proyecto:

1. **Create/New**.
2. **Database**.
3. **Redis**.
4. Esperá a que quede activo.
5. Nombre recomendado del servicio: `Redis`.

No expongas Redis públicamente. Ankara GOAT y Redis están en el mismo proyecto y pueden usar la conectividad privada/reference variables de Railway.

## 12.5 Conectar Node con MySQL y Redis usando Reference Variables

Abrí el servicio **Ankara GOAT -> Variables**.

Agregá:

```env
DATABASE_URL=${{MySQL.MYSQL_URL}}
REDIS_URL=${{Redis.REDIS_URL}}
```

Si llamaste a los servicios de otra manera, reemplazá `MySQL` y `Redis` por los nombres exactos.

Railway soporta referencias con:

```text
${{SERVICE_NAME.VARIABLE}}
```

Esto es preferible a copiar contraseñas manualmente porque la referencia se mantiene sincronizada.

## 12.6 Variables obligatorias del servicio Node

Agregá en Railway:

```env
NODE_ENV=production
AUTO_MIGRATE=false
JWT_SECRET=<SECRETO_LARGO>
ADMIN_EMAILS=tu-email-admin@example.com
MODERATOR_EMAILS=moderador1@example.com,moderador2@example.com
DATABASE_URL=${{MySQL.MYSQL_URL}}
REDIS_URL=${{Redis.REDIS_URL}}
MEDIA_PROVIDER=r2
R2_ACCOUNT_ID=<ACCOUNT_ID>
R2_ACCESS_KEY_ID=<ACCESS_KEY>
R2_SECRET_ACCESS_KEY=<SECRET_KEY>
R2_BUCKET=ankara-goat-media
R2_PUBLIC_BASE_URL=https://media.ankaragoat.com
DB_POOL_MAX=12
DB_POOL_MIN=0
SOCKET_PING_INTERVAL_MS=25000
SOCKET_PING_TIMEOUT_MS=20000
```

Opcional:

```env
MODERATION_BLOCKLIST=...
```

Railway inyecta `PORT`, así que no hace falta fijarlo manualmente.

## 12.7 Proteger secretos

Después de verificar que funcionan, usá la opción **Seal** de Railway para secretos sensibles cuando corresponda, especialmente:

- JWT_SECRET
- R2_ACCESS_KEY_ID
- R2_SECRET_ACCESS_KEY

Nunca los imprimas en logs.

## 12.8 Desplegar

Al guardar variables se generarán cambios pendientes.

1. Revisalos.
2. Deploy.
3. En logs deberías ver las migraciones del pre-deploy.
4. Luego:

```text
Socket.IO Redis Adapter activo.
Ankara GOAT escuchando en puerto ...
```

## 12.9 Crear dominio público

En el servicio Node:

1. Settings.
2. Networking.
3. **Generate Domain**.

Railway dará algo parecido a:

```text
https://ankara-goat-production.up.railway.app
```

Más adelante podés conectar tu dominio propio.

## 12.10 Verificar healthcheck

Abrí:

```text
https://TU_DOMINIO/api/health
```

Esperado:

```json
{
  "ok": true,
  "app": "Ankara GOAT",
  "version": "0.3.0",
  "database": true,
  "redis": true
}
```

Si `database=false`, revisar `DATABASE_URL`.

Si `redis=false`, revisar `REDIS_URL`.

Railway usa `/api/health` también para no pasar tráfico a un deploy nuevo hasta que esté listo.

## 12.11 Crear el primer admin

Poné tu email en:

```env
ADMIN_EMAILS=tuemail@example.com
```

Después registrate con **exactamente ese email**. La cuenta se creará como admin.

Si una cuenta ya existía antes de agregar el email, podés cambiar su rol desde otro admin o directamente en DB durante desarrollo. `ADMIN_EMAILS` se evalúa al registrarse.

## 12.12 Crear moderadores

Opción A, antes de registrarse:

```env
MODERATOR_EMAILS=mod1@example.com,mod2@example.com
```

Opción B: un admin cambia el rol desde el endpoint/panel administrativo.

---

# 13. Escalar Socket.IO en Railway

## 13.1 Qué problema estamos resolviendo

Una sola instancia Node tiene límites de:

- CPU;
- RAM;
- conexiones WebSocket;
- operaciones MySQL;
- eventos/segundo.

Cuando agregás réplicas, Railway puede mandar clientes distintos a procesos distintos.

Ejemplo:

```text
Jugador A -> Replica 1
Jugador B -> Replica 2
Jugador C -> Replica 1
Jugador D -> Replica 3
```

Sin Redis, un `io.to(room).emit(...)` de la réplica 1 no llegaría a sockets conectados sólo a la réplica 2/3.

Con Redis Adapter:

```text
Replica 1 ─┐
Replica 2 ─┼── Redis Pub/Sub ── rooms/eventos
Replica 3 ─┘
```

El estado crítico de cada partida se guarda en MySQL y `withLockedGame()` toma un lock de fila durante cada mutación, reduciendo carreras cuando dos réplicas intentan modificar la misma partida.

BullMQ usa Redis para que los timeouts de preguntas sobrevivan reinicios y sean procesados por alguno de los workers disponibles.

## 13.2 Por qué WebSocket-only

Socket.IO normalmente puede usar:

```text
HTTP long-polling -> upgrade a WebSocket
```

En múltiples servidores, long-polling requiere sticky sessions.

Railway no ofrece sticky sessions. Por eso Ankara GOAT fija:

```js
transports: ['websocket']
```

Servidor y cliente.

Trade-off: algún proxy/red corporativa extremadamente restrictiva podría bloquear WebSockets. Para un juego realtime es una decisión razonable; si en el futuro necesitás fallback long-polling, habría que introducir una capa/proxy que soporte afinidad de sesión.

## 13.3 Empezar con una réplica

Primero desplegá y probá con **1 réplica**.

No escales para ocultar errores funcionales.

## 13.4 Agregar réplicas

Cuando el sistema esté estable:

1. Railway -> servicio Ankara GOAT.
2. Settings/Deploy/Scale según la UI vigente.
3. Aumentá a 2 réplicas en la misma región.
4. Volvé a ejecutar pruebas de carga.
5. Recién después probá 3, 4, etc.

Railway también permite escalar desde CLI. Ejemplos actuales:

```bash
# interfaz interactiva
railway scale

# dos réplicas en US East
railway scale us-east=2

# indicando servicio y ambiente
railway scale --service ankara-goat --environment production us-east=2
```

Railway acepta nombres amigables como `us-east`, `us-west`, `eu-west` y `southeast-asia` y actualmente limita a 50 réplicas totales. Para Ankara GOAT, mantené inicialmente Node, MySQL y Redis en una región coherente: sumar réplicas lejanas del MySQL puede aumentar la latencia de cada turno.

## 13.5 Pool MySQL por réplica

Muy importante:

```text
conexiones máximas aproximadas = número de réplicas × DB_POOL_MAX
```

Ejemplo:

```text
4 réplicas × DB_POOL_MAX=12 ~= hasta 48 conexiones del backend
```

No pongas `DB_POOL_MAX=100` pensando que siempre es mejor.

Primero verificá el límite de conexiones de tu MySQL y dejá margen para migraciones, tareas administrativas y monitoreo.

---

# 14. Cómo emular muchas partidas simultáneas

El proyecto incluye un simulador propio en:

```text
load-tests/
```

La idea es que entiendas dos cosas diferentes:

1. **Conexiones:** ¿cuántos WebSockets quedan conectados?
2. **Carga real:** ¿cuántas partidas activas pueden tirar dados, consultar preguntas, escribir MySQL, usar Redis/BullMQ y emitir eventos sin degradarse demasiado?

Nuestro simulador hace la segunda.

## 14.1 NUNCA empezar contra producción

Creá un entorno **staging** separado con MySQL/Redis separados.

No cargues usuarios `[LOADTEST]` en la base real.

Protección obligatoria:

```env
LOAD_TEST_CONFIRM=YES
```

El script se niega a sembrar datos sin esa variable.

## 14.2 Preparar staging local o Railway

Variables mínimas en tu terminal:

```env
NODE_ENV=development
JWT_SECRET=<el mismo secreto del servidor staging>
DATABASE_URL=<mysql de staging>
LOAD_TEST_CONFIRM=YES
LOAD_TEST_TARGET=https://tu-staging.up.railway.app
```

Si ejecutás el seed desde tu PC contra MySQL Railway, la base debe ser accesible desde donde ejecutes el script. Alternativamente ejecutá los scripts desde un entorno conectado correctamente a Railway.

## 14.3 Crear 25 partidas x 4 jugadores = 100 sockets

```bash
npm run load:seed -- --games 25 --players 4
```

Esto crea:

```text
25 partidas
100 usuarios sintéticos
100 equipos sintéticos
250 preguntas sintéticas LOADTEST como pool mínimo
```

Y genera:

```text
load-tests/manifest.json
```

Ese archivo contiene JWT temporales de los bots, por eso está incluido en `.gitignore` y **no debe subirse a GitHub**.

## 14.4 Lanzar los 100 clientes

```bash
npm run load:simulate -- --duration 120 --ramp-ms 20 --target https://tu-staging.up.railway.app
```

Significado:

- `duration 120`: prueba durante 120 segundos.
- `ramp-ms 20`: espera 20 ms entre cada nueva conexión para no crear un pico artificial instantáneo.
- `target`: URL pública del servidor.

Cada bot:

- conecta por WebSocket;
- autentica JWT;
- entra a su room;
- espera su turno;
- tira el dado;
- recibe pregunta;
- responde;
- maneja Cara o Seca;
- repite.

Por eso esta prueba toca Socket.IO + Express/auth inicial + MySQL + Redis + BullMQ + motor de juego.

## 14.5 Resultado

El simulador imprime algo parecido a:

```json
{
  "connected": 100,
  "acks": 5240,
  "errors": 0,
  "events": 9800,
  "questions": 640,
  "ackLatencyMs": {
    "p50": 35,
    "p95": 110,
    "p99": 220,
    "max": 480
  }
}
```

### Cómo leerlo

`connected`:
: cantidad de sockets que llegaron a conectar.

`errors`:
: timeouts o respuestas fallidas. Idealmente 0.

`p50`:
: la mitad de los ACK tardó menos que ese valor.

`p95`:
: 95% de los ACK tardó menos que ese valor. Es una métrica mucho más útil que el promedio.

`p99`:
: muestra la cola de latencias y ayuda a detectar degradación.

No existe un número mágico universal. Como objetivo inicial de producto, podés tomar **p95 < 250 ms con errores prácticamente 0** para acciones realtime sencillas, pero es un objetivo de ingeniería nuestro, no una garantía de Railway.

## 14.6 Escalera recomendada

No saltes directamente a 5.000 sockets.

### Nivel A

```bash
npm run load:seed -- --games 25 --players 4
```

```text
100 sockets
```

### Nivel B

```bash
npm run load:seed -- --games 100 --players 4
```

```text
400 sockets
```

### Nivel C

```bash
npm run load:seed -- --games 250 --players 4
```

```text
1.000 sockets
```

### Nivel D

```bash
npm run load:seed -- --games 250 --players 8
```

```text
2.000 sockets
```

### Nivel E

```bash
npm run load:seed -- --games 500 --players 8
```

```text
4.000 sockets
```

Para cada nivel:

1. empezá con una réplica;
2. guardá p50/p95/p99, CPU, memoria, errores y DB;
3. repetí 2–3 veces;
4. aumentá réplicas;
5. repetí exactamente la misma carga;
6. compará.

## 14.7 Qué mirar en Railway

Durante la prueba abrí métricas/logs del servicio y observá:

- CPU;
- memoria;
- reinicios;
- errores Node;
- duración/errores de requests;
- cantidad de réplicas;
- logs de Redis adapter;
- errores MySQL tipo `Too many connections`;
- errores BullMQ/Redis.

En MySQL prestá especial atención a:

- conexiones;
- queries lentas;
- locks;
- CPU del servicio DB.

En Redis:

- memoria;
- conexiones;
- errores/reconexiones;
- latencia.

## 14.8 Identificar el cuello de botella

Caso 1:

```text
Node CPU 95%
MySQL tranquilo
Redis tranquilo
```

Probablemente necesitás más réplicas Node/optimización CPU.

Caso 2:

```text
Node 40%
MySQL al límite
p95 sube mucho
```

Agregar Node no arreglará el problema. Hay que optimizar queries, índices, pool y/o capacidad MySQL.

Caso 3:

```text
Redis saturado / desconexiones
```

El realtime y BullMQ pueden degradarse a la vez; revisar capacidad, Pub/Sub y número de conexiones.

Caso 4:

```text
Conecta bien pero falla entre réplicas
```

Verificar que **todas** las réplicas usan el mismo `REDIS_URL` y que cliente/servidor siguen WebSocket-only.

## 14.9 Limpiar datos sintéticos

Después de la prueba:

```bash
npm run load:cleanup
```

El script elimina los datos marcados como `[LOADTEST]`/usuarios de carga.

Volvé a poner:

```env
LOAD_TEST_CONFIRM=NO
```

## 14.10 Prueba comparativa de escalado

Hacé una planilla así:

| Réplicas | Partidas | Sockets | p50 | p95 | p99 | Errores | CPU | RAM |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 100 | 400 | | | | | | |
| 2 | 100 | 400 | | | | | | |
| 2 | 250 | 1000 | | | | | | |
| 3 | 250 | 1000 | | | | | | |

Eso te permite saber si escalar horizontalmente realmente mejora Ankara GOAT o si el límite está en MySQL/Redis.

---

# 15. Migraciones y producción

Las migraciones están en:

```text
migrations/
```

Comando:

```bash
npm run migrate
```

En Federaciones V1, `railway.json` **no incluye `preDeployCommand`**. Ejecutalas manualmente sólo después de validar y respaldar la base de datos.

En producción:

```env
AUTO_MIGRATE=false
```

No uses `sequelize.sync()`.

---

# 16. Reconexión

El cliente Socket.IO usa:

```text
reconnection=true
reconnectionAttempts=Infinity
transports=['websocket']
```

Al reconectar vuelve a entrar en la partida y solicita el estado autoritativo actual.

Los timeouts de preguntas viven en BullMQ/Redis, por lo que reiniciar una réplica no transforma una pregunta de 20 segundos en una pregunta infinita.

---

# 17. Estadísticas de conocimiento

Cada respuesta actualiza estadísticas por `knowledgeArea`.

Ejemplo:

```text
Argentina        92%
Champions        87%
Premier          81%
Brasil           74%
Bundesliga       71%
Europa del Este  54%
África           43%
Asia             36%
```

Se calculan desde datos reales de respuestas y se acompañan con ELO, XP, nivel e historial.

---

# 18. Seguridad y decisiones importantes

- El dado se genera en servidor.
- El cliente nunca recibe `correctAnswer` antes de contestar.
- La validación de respuestas ocurre en servidor.
- El estado de juego se actualiza con lock de fila MySQL.
- Preguntas no se repiten dentro de la misma partida.
- Roles se verifican en servidor; ocultar botones no es el control de seguridad.
- Preguntas sólo se mutan por rutas `admin`.
- SVG no se admite en escudos.
- Redis no debe ser público.
- Secretos sólo en variables de entorno.
- Las pruebas de carga tienen confirmación explícita.

---

# 19. Comandos útiles

```bash
npm install
npm run dev
npm start
npm test
npm run migrate
npm run seed
npm run validate:questions -- ./preguntas.json
npm run load:seed -- --games 100 --players 4
npm run load:simulate -- --duration 120 --target https://staging.example.com
npm run load:cleanup
```

---

# 20. Estructura principal

```text
ankara-goat/
├── examples/
│   ├── questions-template.csv
│   └── questions-template.json
├── load-tests/
│   ├── seed-load-data.js
│   ├── socket-simulator.js
│   └── cleanup-load-data.js
├── migrations/
├── public/
│   ├── admin.html
│   ├── moderator.html
│   ├── css/
│   └── js/
├── scripts/
├── src/
│   ├── config/
│   ├── middleware/
│   ├── models/
│   ├── routes/
│   ├── services/
│   └── sockets/
├── tests/
├── .env.example
├── package.json
├── railway.json
└── README.md
```

---

# 21. Antes de abrir una beta pública

Checklist recomendado:

- [ ] R2 con custom domain funcionando.
- [ ] MySQL + Redis de producción separados del staging.
- [ ] Al menos 2 moderadores reales además del admin.
- [ ] Política visible y aceptación guardada.
- [ ] Banco de preguntas revisado editorialmente.
- [ ] Reportes de preguntas probados.
- [ ] Ranking ELO público probado sin login.
- [ ] Tiebreak de 2, 3, 8 y 14 jugadores probado.
- [ ] Prueba de carga de al menos 1.000 sockets en staging.
- [ ] Prueba con 2 réplicas y Redis Adapter.
- [ ] Verificación de pool MySQL.
- [ ] Backups/estrategia de recuperación de MySQL.
- [ ] Logs de moderación revisados.
- [ ] Secretos sellados/rotables.

La capacidad real de producción no debe decidirse por una cifra teórica. Debe salir de las pruebas escalonadas de staging y de observar cuál componente se satura primero.
