# 👺 Goblin Empire — Telegram Mini App (тап-кликер)

Node.js 20 + Express + PostgreSQL. Вся экономика считается **на сервере**; клиент только присылает тапы пачками и рисует интерфейс. Фронтенд — чистые HTML/CSS/JS без сборки, оптимизирован под Android (Telegram WebView).

## Структура

```
goblin-empire/
├─ src/
│  ├─ server.js     Express: helmet+CSP, rate-limit, статика, health, миграции при старте
│  ├─ config.js     проверка переменных окружения (zod) — сервер не стартует с плохим конфигом
│  ├─ db.js         пул PostgreSQL + tx() (транзакции)
│  ├─ migrate.js    применяет migrations/*.sql (с advisory-lock), `npm run migrate`
│  ├─ auth.js       проверка Telegram initData (HMAC-SHA256) + JWT (HS256, 2 ч)
│  ├─ game.js       чистая игровая логика: энергия, пассивный доход, лимиты тапов, цены
│  ├─ service.js    операции с БД: вход/рефералы, тап, улучшения, рейтинг
│  ├─ routes.js     API: POST /api/auth, GET /api/state, POST /api/tap, POST /api/upgrade, GET /api/leaderboard
│  └─ bot.js        вебхук бота: /start → кнопка «Играть»
├─ migrations/001_init.sql   users, referrals, ledger
├─ public/          index.html, style.css, app.js, icon.png
├─ test/            node --test (initData, JWT, игровая логика)
├─ assets/botfather-640x360.png   картинка для /newapp
├─ render.yaml  Dockerfile  .env.example  .gitignore
```

## Геймплей

- **Тап** — монеты за тап = 1 + уровень «Тяжёлой лапы»; каждый тап тратит 1 энергию.
- **Энергия** восстанавливается сама (считается по времени на сервере).
- **Кузница**: 4 улучшения (сила тапа, макс. энергия, скорость восстановления, шахта = пассивный доход в час, копится до 3 часов офлайн). Макс. уровень 30.
- **Друзья**: реферальная ссылка `t.me/<бот>/<app>?startapp=ref_<id>` → +5 000 тебе и +2 500 другу (не более 200 наград на игрока).
- **Топ-20** по заработанным монетам.

## Безопасность — что сделано

| Угроза | Защита |
|---|---|
| Поддельный пользователь | initData проверяется HMAC с токеном бота, `timingSafeEqual`, срок жизни 1 час |
| Подмена токена сессии | JWT HS256 с зафиксированным алгоритмом, 2 часа; клиент перелогинивается при 401 |
| «Накрутка» монет | клиент шлёт только число тапов; сервер ограничивает по энергии, ≤20 тапов/с в среднем, ≤100 за запрос, сила тапа берётся из БД |
| Повтор запросов | у пачки тапов растущий `seq`, старые отклоняются (409) |
| Гонки и двойная трата | транзакции + `SELECT … FOR UPDATE`, `CHECK (coins >= 0)` |
| SQL-инъекции | только параметризованные запросы; колонки улучшений — из белого списка |
| XSS | клиент выводит данные только через `textContent`; CSP запрещает чужие и инлайновые скрипты |
| Перебор/DoS | rate-limit: общий, на `/auth` по IP, на игровые запросы по пользователю; тело ≤ 10 КБ |
| Фальшивый вебхук | `secret_token` из HMAC от `JWT_SECRET`, сравнение в постоянное время |
| Утечка секретов | всё в переменных окружения; `.env` в `.gitignore` |

**Честные ограничения:** защита от мульти-аккаунтов (фарм рефералов) только мягкая — лимит наград. Рейтинг показывает имена игроков из Telegram. Для настоящих денег нужен отдельный аудит.

## TON — задел на будущее

Монеты **внутриигровые, без вывода**. В БД уже есть `users.ton_wallet` и `ton_wallet_verified` (по умолчанию `false`), а `ledger` фиксирует все движения монет. План интеграции:

1. Фронтенд: `@tonconnect/ui`, файл `tonconnect-manifest.json`, разрешить нужные домены в CSP (`script-src`, `connect-src`).
2. Бэкенд: эндпоинт выдачи одноразового `payload` (с TTL) и эндпоинт проверки **ton_proof** по спецификации TON Connect; только после успешной проверки писать `ton_wallet` и ставить `ton_wallet_verified = true`. Адрес без proof **нельзя** использовать для выплат.
3. Уникальный индекс на `ton_wallet`, лимиты и антифрод.
4. Вывод/airdrop — только после юридической оценки (регуляторика, налоги) и пересмотра экономики.

---

# Запуск: пошагово (можно целиком с Android)

Порядок важен: Mini App в BotFather создаётся **после** деплоя, потому что нужен https-адрес.

## Шаг 1. Бот в BotFather

1. Telegram → **@BotFather** → `/newbot`.
2. Имя: `Goblin Empire`. Username — оканчивается на `bot`, например `GoblinEmpireBot`.
3. Сохрани **токен** (вида `123456:ABC…`) и **username** без `@`. Токен никому не показывай; если утёк — `/revoke` у BotFather.

## Шаг 2. GitHub

1. Chrome → github.com → войди → **+ → New repository** → `goblin-empire`, **Private** → Create.
2. Загрузка кода. Вариант А (надёжный) — **Termux** (из F-Droid):
   ```bash
   pkg install git unzip
   termux-setup-storage
   unzip ~/storage/downloads/goblin-empire.zip && cd goblin-empire
   git init && git branch -M main
   git add .
   git status            # убедись: нет .env и node_modules
   git commit -m "Goblin Empire"
   git remote add origin https://github.com/<ТВОЙ_ЛОГИН>/goblin-empire.git
   git push -u origin main
   ```
   При запросе пароля вставь **Personal Access Token** (GitHub → Settings → Developer settings → Personal access tokens → fine-grained, доступ к этому репозиторию, право *Contents: Read and write*).
   Вариант Б — на сайте: **Add file → Upload files**, загружай файлы по папкам. Скрытые файлы (`.gitignore`, `.env.example`) включи в файловом менеджере.
3. Проверь в репозитории: есть `.gitignore`, **нет** `.env`.

## Шаг 3. Хостинг (Render)

1. render.com → **Get Started** → войди через GitHub и разреши доступ к репозиторию.
2. **New + → Blueprint** → выбери репозиторий → Render прочитает `render.yaml` и создаст сервис `goblin-empire` и базу `goblin-db`.
3. Render спросит значения секретов:
   - `BOT_TOKEN` — токен из шага 1
   - `BOT_USERNAME` — например `GoblinEmpireBot`
   - `APP_SHORT_NAME` — впиши `play` (так же назовём Mini App в шаге 4)
   
   `JWT_SECRET` сгенерируется автоматически, `DATABASE_URL` подставится сам.
4. Дождись статуса **Live**. Адрес сервиса — `https://goblin-empire-xxxx.onrender.com`. Открой `<адрес>/health` — должно быть `{"ok":true}`.

> Бесплатный тариф Render «засыпает» после простоя (первый запуск — до минуты), а бесплатная БД может иметь срок жизни/ограничения — актуальные условия смотри на render.com/pricing. Для реального запуска бери платный план. Альтернатива для БД — Neon: создай проект, скопируй строку подключения в `DATABASE_URL` и поставь `DB_SSL=true`.

## Шаг 4. Mini App в BotFather

1. **@BotFather → `/newapp`** → выбери своего бота.
2. **Title:** `Goblin Empire`.
3. **Description:** `Тапай, копи золото и строй империю гоблинов`.
4. **Photo:** отправь `assets/botfather-640x360.png` (нужно ровно 640×360).
5. **GIF:** отправь `/empty`.
6. **Web App URL:** адрес из шага 3, например `https://goblin-empire-xxxx.onrender.com` (только https, без слеша в конце).
7. **Short name:** `play` → BotFather пришлёт ссылку `https://t.me/<бот>/play`.
8. Кнопка меню: **/mybots → твой бот → Bot Settings → Menu Button → Configure menu button** → отправь тот же URL → название кнопки `Играть`.
9. Если `APP_SHORT_NAME` в Render отличается от `play` — поправь в Render → Environment → Save (сервис перезапустится).

Вебхук бота регистрируется сервером сам при старте (`/start` → кнопка «⚔️ Играть»).

## Шаг 5. Проверка

1. На Android открой `https://t.me/<бот>/play` — должна загрузиться игра, гоблин реагирует на тапы.
2. Нажми Share в «Друзьях», открой ссылку со второго аккаунта — обоим придёт бонус.
3. Логи: Render → сервис → **Logs** (должны быть `migration applied` и `Telegram webhook registered`).

## Локальный запуск (по желанию, нужен компьютер или Termux с PostgreSQL)

```bash
npm install            # создаст package-lock.json — закоммить его
cp .env.example .env   # заполни значения
npm run migrate && npm run dev
npm test
```
Mini App работает только внутри Telegram, поэтому для проверки с телефона нужен публичный https (например, tunnel) — проще проверять уже на Render.

## Если что-то не так

| Симптом | Причина |
|---|---|
| «Открой игру через Telegram» | страница открыта в браузере, а не через бота |
| «Не удалось войти» | неверный `BOT_TOKEN` в Render или токен перевыпущен |
| Белый экран в Telegram | в Render → Logs ищи ошибку конфигурации (`Ошибка конфигурации…`) |
| Долгая первая загрузка | бесплатный тариф «проснулся» |
| `/start` не отвечает | `PUBLIC_URL` не https или неверный `BOT_TOKEN`; смотри Logs |
