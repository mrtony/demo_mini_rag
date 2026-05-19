## General

- 在寫 PRD、ADR、Issue時, 要使用繁體中文來建立文件內容。

## Tech stack

### backend

The backend is built with Python and FastAPI. It provides RESTful APIs for agent management, task execution, and data storage.

### frontend

The frontend is built with React and TypeScript. It provides a user interface for managing agents, viewing task results, and configuring settings.

USe Tailwind CSS for styling the frontend components.

## Agent skills

### Issue tracker

Local markdown files under `.scratch/`. See `docs/agents/issue-tracker.md`.

### Triage labels

This repo uses the default triage labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, and `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

This repo uses a single-context layout with one root `CONTEXT.md` and shared ADRs in `docs/adr/`. See `docs/agents/domain.md`.
