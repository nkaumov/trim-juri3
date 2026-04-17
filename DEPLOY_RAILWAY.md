# Railway deploy (web + Postgres + OnlyOffice)

Этот репозиторий разворачивается в Railway как **3 сервиса в одном Project**:

1) `web` — Next.js приложение (из GitHub, ветка `main`, сборка по `Dockerfile`)
2) `Postgres` — Railway PostgreSQL
3) `onlyoffice` — OnlyOffice DocumentServer (Docker image)

## 1) Web (Next.js)

1. Railway → **New Project** → **Deploy from GitHub**
2. Выберите репозиторий `trim-juri3`, ветку `main`
3. Railway использует `Dockerfile` и `railway.toml` из корня репозитория

### Web Variables (обязательные)

Перейдите в `web` service → Variables → **RAW Editor** и вставьте значения (можно взять из `.env.example` как список ключей).

Обязательные:
- `DATABASE_URL` — подключить из Postgres сервиса (reference переменная в Railway)
- `DOCUMENTS_SIGNING_KEY` — base64, минимум 32 байта
- `ADMIN_EMAIL`
- `ADMIN_PASSWORD`

Для OnlyOffice (обязательно, если хотите просмотр/редактирование документов):
- `NEXT_PUBLIC_ONLYOFFICE_URL` — публичный домен onlyoffice, например `https://onlyoffice-production.up.railway.app`
- `NEXT_PUBLIC_ONLYOFFICE_FILE_BASE_URL` — публичный домен web, например `https://web-production.up.railway.app`

Опционально (если используете AI анализ):
- `AI_API_KEY` (или `PLATFORM_OPENAI_API_KEY`)
- `AI_MODEL`

## 2) PostgreSQL

Railway → **Add** → **Database** → **PostgreSQL**.

Дальше в `web` сервисе задайте `DATABASE_URL` как reference на Postgres (в UI Railway это выбирается из подсказок).

## 3) OnlyOffice DocumentServer

Railway → **Add** → **Service** → **Deploy Docker Image**

Image:
- `onlyoffice/documentserver:latest` (лучше закрепить версию позже)

### OnlyOffice Variables

Минимально (как в `docker-compose.yml`):
- `JWT_ENABLED=false`
- `ALLOW_PRIVATE_IP_ADDRESS=true`
- `ALLOW_META_IP_ADDRESS=true`

### Порт

OnlyOffice обычно слушает `80` внутри контейнера.
Если Railway не смог “угадать” порт, задайте переменную сервиса:
- `PORT=80`

## Как это связано с деплоем

- После того как вы один раз настроили Project и сервис `web` из GitHub, **любой push в `main` автоматически запускает новый деплой web-сервиса**.
- Postgres и onlyoffice сами по себе “не нуждаются” в деплое при каждом пуше.

## Проверка

- `web` healthcheck: `GET /api/health` должен отдавать `200`.
- В UI: откройте `web` домен, зайдите `/login`, проверьте загрузку workspace.
- В OnlyOffice: при открытии документа в интерфейсе должен подгрузиться скрипт `.../web-apps/apps/api/documents/api.js`.

