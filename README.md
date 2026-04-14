# Jurist3

Новый интерфейсный фронтенд (TypeScript + Next.js) для процесса согласования договоров.

## Что уже заложено

- Левый сайдбар вместо вкладок: навигация + блоки подключения Google.
- Единая рабочая область справа: карточки договоров, статус футбола разногласий, зона ИИ-ассистента.
- Структурированный i18n по папкам с языками `ru/en` и namespace-файлами.
- Docker-ready конфигурация для запуска в инфраструктуре компании.
- Базовая подготовка к интеграции платформы `C:\1trim\1platform\platform`.

## Быстрый старт

```bash
npm install
npm run dev
```

Приложение: `http://localhost:3000`.

## Docker

```bash
copy .env.example .env
docker compose up --build
```

## Структура локалей

- `src/i18n/locales/ru/sidebar.json`
- `src/i18n/locales/ru/workspace.json`
- `src/i18n/locales/ru/settings.json`
- `src/i18n/locales/en/sidebar.json`
- `src/i18n/locales/en/workspace.json`
- `src/i18n/locales/en/settings.json`

## Следующий шаг

Подключить реальные API из `JURI2` и заменить mock-данные в `src/lib/contracts/mock.ts`.
# Use UTF-8 encoding in PowerShell profile for this repository.
# Run: .\scripts\psprofile-utf8.ps1
