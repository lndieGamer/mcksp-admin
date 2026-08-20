# mcksp-admin

Админ-панель модпака **MCKSP Seventh Season** (NeoForge 1.21.1, packwiz, unsup 1.1.6).
Строится вокруг существующего репозитория пака `lndieGamer/MCKSP-Seventh-Season`,
который остаётся нетронутым: туда прилетают только коммиты с изменениями метафайлов.

```
браузер ──▶ GitHub Pages (SPA + public.json)
   │
   └── fetch (Authorization: Bearer) ──▶ Cloudflare Worker ──▶ GitHub / Modrinth / CurseForge
                                              │
                                              └── workflow_dispatch ──▶ mutate.yml ──packwiz──▶ пак
```

| Каталог | Что |
|---|---|
| `worker/` | Cloudflare Worker: OAuth, сессии, прокси с белым списком |
| `analyzer/` | разбор jar, граф зависимостей, проверка обновлений → `admin-data/*.json` |
| `mutate/` | операции над паком: построчное редактирование TOML + вызовы packwiz |
| `web/` | SPA (Vite + React + Tailwind + React Flow + ELK) |
| `admin-data/` | артефакты анализатора, коммитит бот; `jar-meta/` — кеш разбора jar |

Тесты: `python -m unittest discover -s analyzer/tests`,
`python -m unittest discover -s mutate/tests`, `npm test --prefix worker`,
`npm test --prefix web` (модель графа: свёртка семейств, слияние рёбер, обход).

---

## Что нужно настроить один раз

### 1. GitHub Secrets в `mcksp-admin`

| Имя | Что | Права |
|---|---|---|
| `PACK_REPO_TOKEN` | fine-grained PAT | `contents: write` **только** на `MCKSP-Seventh-Season` |
| `CF_API_KEY` | ключ CurseForge | — |

Без `CF_API_KEY` анализатор не скачает 144 мода с `mode = "metadata:curseforge"`:
CurseForge с 16 июля 2026 требует ключ и на `edge.forgecdn.net`, ответ — 401.

### 2. GitHub Pages

`Settings → Pages → Source: GitHub Actions`. Деплоит `pages.yml`.

### 3. GitHub OAuth App

`Settings → Developer settings → OAuth Apps → New`.
Authorization callback URL: `https://<worker>.workers.dev/auth/callback`.
Scope не нужен — панель использует OAuth только чтобы узнать логин.

### 4. Cloudflare Worker

```bash
cd worker
npm install
npx wrangler kv namespace create STATE     # id вписать в wrangler.toml (оба места)
npx wrangler secret put GH_CLIENT_ID
npx wrangler secret put GH_CLIENT_SECRET
npx wrangler secret put GH_DISPATCH_TOKEN  # fine-grained PAT: actions:write + contents:read на mcksp-admin
npx wrangler secret put CF_API_KEY
npx wrangler secret put SESSION_SECRET     # openssl rand -base64 32
npx wrangler secret put ALLOWED_LOGIN      # lndieGamer (через запятую можно добавить со-админа)
npx wrangler deploy
```

### 5. Repository variable

`Settings → Secrets and variables → Actions → Variables`:
`WORKER_URL = https://<worker>.workers.dev`. Это не секрет — URL всё равно попадает в бандл.

### 6. Первый прогон

`Actions → analyze → Run workflow`. Первый раз качает все jar (~20 минут),
дальше кеш в `admin-data/jar-meta/` и качаются только обновившиеся моды.

После него посмотреть `admin-data/unparsed.json` — это единственная точка,
где нужно ручное участие. Спорное перенести в `analyzer/overrides.toml`.

---

## Локальная разработка

```bash
python analyzer/main.py --pack ../pack --skip-updates   # граф без сетевых проверок обновлений
python mutate/mutate.py --request-id test --payload '{"op":"set-side","targets":["sodium"],"value":"client"}' \
       --pack ../pack --dry-run                          # правка + пре-флайт без коммита
npm run dev --prefix web                                 # SPA на localhost:5173
npx wrangler dev --env dev --cwd worker                  # Worker с DEV_ORIGIN=localhost:5173
```

`DEV_ORIGIN` живёт только в `[env.dev]`: localhost не должен быть разрешённым
CORS-origin в проде.

---

## Границы, о которых стоит знать

- **Неопознанные jar заливаются в GitHub Release руками.** Панель считает SHA-1 в
  браузере и опознаёт мод одним батч-запросом к Modrinth; если не опознан, она даёт
  форму «добавить по прямой ссылке». Автозаливка ассета потребовала бы отдельного
  хоста `uploads.github.com` в прокси ради пути, которым за всю историю пака
  прошли три мода.
- **Пре-флайт блокирует только новые проблемы.** Он считается дважды — до и после
  правки — и сравнивает. В паке уже есть два расхождения `side` с Modrinth
  (`create_oxidized`, `seasonal-lets-do`); блокировка по абсолютному списку сделала
  бы пак неизменяемым навсегда. Оба видны в `/lint`.
- **Без `CF_API_KEY` анализ не падает, а деградирует.** Моды с CurseForge
  помечаются `failed` и уезжают в `unparsed.json`, граф строится по остальным,
  а в `public.json` появляется `notices` — панель рисует их полосой сверху.
  После прогона с ключом полоса исчезает сама, правки кода не нужно.
- **`preserve = true` unsup игнорирует полностью** — в UI не предлагается.
- **`analyze` коммитит раз в сутки даже без изменений**, потому что `generated_at`
  всегда новый. История коммитов заодно работает журналом «когда последний раз считали».
- **Веса сборок считаются по группам, а не по комбинациям.** В `unsup.toml` 28 групп
  по одной на мод, комбинаций 2²⁸; отдаются `full`, `minimal` и «без группы X».
