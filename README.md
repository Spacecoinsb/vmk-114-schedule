# Расписание ВМК

Расписание первого курса ВМК МГУ (все группы) и карта корпуса. Работает без интернета, ставится на экран «Домой».

**Сайт:** https://mgucs.github.io/vmk-schedule/

## Как обновляется расписание

- Каждые 15 минут GitHub Actions скачивает PDF с [cs.msu.ru/studies/schedule](https://cs.msu.ru/studies/schedule), разбирает пары всех групп и публикует их вместе с сайтом.
- Если ВМК что-то поменял, в приложении видно, что именно: аудиторию, преподавателя, время, даты.
- Телефон забирает новую версию при открытии сайта и хранит её для работы без сети.
- `watch.yml` запускает проверку `pages.yml` каждые 15 минут: встроенное расписание GitHub срабатывает слишком редко.

## Разработка

```sh
npm ci
npm run dev      # локальный запуск
npm run check    # TypeScript
npm test         # парсер, изменения, маршруты по карте
npm run build
```

Браузерные тесты (`tests/browser.mjs`) проверяют готовую сборку в Chromium через Playwright. Перед запуском соберите сайт с `VITE_BASE=/vmk-schedule/ npm run build`, затем:

```sh
PLAYWRIGHT_MODULE=<путь к playwright/index.mjs> BROWSER_CHANNEL=chromium node tests/browser.mjs
```

## Устройство

| Файл | Что делает |
| --- | --- |
| `scripts/sync-schedule.mjs`, `scripts/source-check.mjs` | проверка сайта ВМК, история изменений |
| `public/parser.mjs` | разбор PDF по границам ячеек |
| `app/page.tsx` | интерфейс расписания |
| `components/campus-map.tsx`, `components/map-scene.ts` | карта корпуса (three.js) |
| `tools/build_map.py` | разметка кабинетов по планам этажей из `tools/floor-plans.pdf` |

Пересобрать карту после правки разметки:

```sh
pip install pymupdf pillow numpy
python3 tools/build_map.py --check
```
