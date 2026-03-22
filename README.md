# docker-git

`docker-git` создаёт отдельную Docker-среду для каждого репозитория, issue или PR.
По умолчанию проекты лежат в `~/.docker-git`.

## Что нужно

- Docker Engine или Docker Desktop
- Доступ к Docker без `sudo`
- Node.js и `npm`

## Установка

```bash
npm i -g @prover-coder-ai/docker-git
docker-git --help
```

## Авторизация

```bash
docker-git auth github login --web
docker-git auth codex login --web
docker-git auth claude login --web
```

## Пример

Можно передавать ссылку на репозиторий, ветку (`/tree/...`), issue или PR.

```bash
docker-git clone https://github.com/ProverCoderAI/docker-git/issues/122 --force --mcp-playwright
```

- `--force` пересоздаёт окружение и удаляет volumes проекта.
- `--mcp-playwright` включает Playwright MCP и Chromium sidecar для браузерной автоматизации.

Автоматический запуск агента:

```bash
docker-git clone https://github.com/ProverCoderAI/docker-git/issues/122 --force --auto
```

- `--auto` сам выбирает Claude или Codex по доступной авторизации. Если доступны оба, выбор случайный.
- `--auto=claude` или `--auto=codex` принудительно выбирает агента.
- В auto-режиме агент сам выполняет задачу, создаёт PR и после завершения контейнер очищается.

## Подробности

`docker-git --help`

## SpawnDock CLI

В этом workspace также есть отдельный package `@spawn-dock/cli` для bootstrapped
SpawnDock TMA-проектов.

Он запускается внутри каталога, где уже есть `spawndock.config.json`, и по
умолчанию стартует `opencode`. Runtime можно переопределить через
`SPAWNDOCK_AGENT_RUNTIME=codex|claude|opencode` или через `agentRuntime` в
`spawndock.config.json`.

Это намеренно минимальный launcher. Он фиксирует project root и запускает
агент только из него; для `codex` дополнительно включает `workspace-write`
sandbox. Для `opencode` это best-effort confinement по working directory, а не
полный OS-level sandbox.
