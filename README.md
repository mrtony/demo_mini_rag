# Minimal ChatGPT-like Web App

FastAPI backend + React frontend + SQLite persistence + OpenAI streaming responses.

## Structure

- `backend/app`: FastAPI app, database models, routes, and OpenAI service
- `frontend`: Vite + React + TypeScript client
- `tests`: backend integration tests

## End-to-End Chat Flow

```mermaid
sequenceDiagram
    autonumber
    actor User as User
    participant Browser as Browser
    participant Frontend as React Frontend
    participant Backend as FastAPI Backend
    participant DB as SQLite
    participant OpenAI as OpenAI API

    User->>Browser: Open app
    Browser->>Frontend: Load UI
    Frontend->>Backend: GET /api/conversations
    Backend->>DB: Query conversation list
    DB-->>Backend: Existing conversations
    Backend-->>Frontend: Conversation summaries
    Frontend-->>Browser: Render sidebar and empty chat state

    rect rgb(235, 245, 255)
        Note over User,OpenAI: First conversation and first response
        User->>Browser: Enter first message and click Send
        Browser->>Frontend: submit(message, conversation_id=0)
        Frontend->>Frontend: Add local user bubble and empty assistant bubble
        Frontend->>Backend: POST /api/chat/stream
        Backend->>DB: Create conversation with temporary title
        DB-->>Backend: conversation_id
        Backend-->>Frontend: SSE conversation.created
        Frontend->>Frontend: Save active conversation_id and update sidebar
        Backend->>DB: Load history for this conversation
        DB-->>Backend: Empty history
        Backend->>OpenAI: stream_chat([], first message)
        Backend->>OpenAI: generate_title(first message)
        OpenAI-->>Backend: response.created
        Backend->>DB: Insert message row with status=streaming
        DB-->>Backend: message_id
        Backend-->>Frontend: SSE message.created
        loop Streaming response text
            OpenAI-->>Backend: response.output_text.delta
            Backend->>DB: Update response text incrementally
            Backend-->>Frontend: SSE message.delta
            Frontend-->>Browser: Append assistant text live
        end
        OpenAI-->>Backend: response.completed
        OpenAI-->>Backend: Generated conversation title
        Backend->>DB: Update message status=completed and conversation title
        Backend-->>Frontend: SSE conversation.title
        Backend-->>Frontend: SSE message.done
        Frontend-->>Browser: Show completed first reply
    end

    rect rgb(237, 255, 240)
        Note over User,OpenAI: Second conversation turn and second response
        User->>Browser: Enter second message in same chat
        Browser->>Frontend: submit(message, existing conversation_id)
        Frontend->>Frontend: Add second user bubble and empty assistant bubble
        Frontend->>Backend: POST /api/chat/stream
        Backend->>DB: Load conversation by conversation_id
        Backend->>DB: Build history from prior messages
        DB-->>Backend: First user/assistant exchange
        Backend->>OpenAI: stream_chat(history, second message)
        OpenAI-->>Backend: response.created
        Backend->>DB: Insert second message row with status=streaming
        Backend-->>Frontend: SSE message.created
        loop Streaming second response
            OpenAI-->>Backend: response.output_text.delta
            Backend->>DB: Update second response text incrementally
            Backend-->>Frontend: SSE message.delta
            Frontend-->>Browser: Append second assistant text live
        end
        OpenAI-->>Backend: response.completed
        Backend->>DB: Update second message status=completed
        Backend-->>Frontend: SSE message.done
        Frontend->>Backend: GET /api/conversations
        Backend->>DB: Refresh conversation updated_at order
        Backend-->>Frontend: Latest conversation summaries
        Frontend-->>Browser: Show second completed reply and refreshed sidebar
    end
```

## Asyncio Stream Control in `backend/app/routes.py`

This diagram focuses on how the backend uses `asyncio` to coordinate one streaming chat request.

```mermaid
flowchart TD
    A["Client sends POST /api/chat/stream"] --> B["stream_chat() creates or loads conversation"]
    B --> C["Create stop_event = asyncio.Event()"]
    C --> D["Store it in ACTIVE_STREAMS[conversation_id]"]
    D --> E["StreamingResponse starts event_stream()"]

    E --> F{"Is this a new conversation?"}
    F -- Yes --> G["Send SSE: conversation.created"]
    G --> H["Start title_task with asyncio.create_task(generate_title(...))"]
    F -- No --> I["Skip title task"]
    H --> J["Load prior message history from DB"]
    I --> J

    J --> K["OpenAI stream_chat(history, message)"]
    K --> L{"Receive next stream event"}

    L --> M{"stop_event.is_set()?"}
    M -- Yes --> N["Mark message as stopped in DB"]
    N --> O["Optionally await title_task and emit conversation.title"]
    O --> P["Send SSE: message.done(status=stopped)"]
    P --> Z["finally: cleanup"]
    M -- No --> Q{"request.is_disconnected()?"}

    Q -- Yes --> R["Treat stream as stopped"]
    R --> Z
    Q -- No --> S["emit_title_if_ready(): if title_task.done(), update title and emit SSE"]

    S --> T{"OpenAI event type"}
    T -- response.created --> U["Create DB message row with status=streaming"]
    U --> L
    T -- response.output_text.delta --> V["Append delta to response_buffer"]
    V --> W["Persist partial response to DB"]
    W --> X["Send SSE: message.delta"]
    X --> L
    T -- response.completed / response.incomplete --> Y["Mark message completed in DB"]
    Y --> AA["Force title emission if still pending"]
    AA --> AB["Send SSE: message.done(status=completed)"]
    AB --> Z
    T -- error / response.failed --> AC["Mark message error and send SSE error"]
    AC --> Z

    Z --> AD{"Was terminal_status never set?"}
    AD -- Yes --> AE["Run _run_cleanup(update_message_response(..., stopped))"]
    AD -- No --> AF["Skip stopped fallback"]
    AE --> AG{"title_task still running?"}
    AF --> AG
    AG -- Yes --> AH["title_task.cancel() and await it safely"]
    AG -- No --> AI["No title task cleanup needed"]
    AH --> AJ{"OpenAI stream object exists?"}
    AI --> AJ
    AJ -- Yes --> AK["Run _run_cleanup(maybe_close_stream(stream))"]
    AJ -- No --> AL["No stream cleanup needed"]
    AK --> AM["Remove conversation_id from ACTIVE_STREAMS"]
    AL --> AM

    AN["POST /conversations/{conversation_id}/stop"] --> AO["Lookup ACTIVE_STREAMS[conversation_id]"]
    AO --> AP["Call stop_event.set()"]
    AP -. cooperative stop signal .-> M

    AQ["asyncio.Task"] --> H
    AR["asyncio.Event"] --> C
    AS["asyncio.shield"] --> AE
    AS --> AK
```

### Why these asyncio pieces exist here

- `asyncio.Event`: acts as a shared stop signal between `/chat/stream` and `/conversations/{conversation_id}/stop`
- `asyncio.Task`: lets title generation run in the background so token streaming is not blocked
- `asyncio.shield`: protects cleanup work in `finally` so DB updates and stream closing still run even if the request is being cancelled
- `asyncio.CancelledError`: makes stream cancellation explicit, while still allowing `finally` to clean up shared state

### Mental model

- Main path: stream assistant tokens to the frontend as fast as possible
- Side path: generate a better conversation title in parallel
- Stop path: let another API request signal the stream to stop without force-killing it
- Cleanup path: always try to leave the database and `ACTIVE_STREAMS` in a consistent state

## Environment

Create `.env` from `.env.example` and set at least `OPENAI_API_KEY`.

Available backend settings:

- `OPENAI_API_KEY`: OpenAI API key
- `CHAT_MODEL`: chat model for streaming responses
- `TITLE_MODEL`: model used to generate conversation titles
- `CHAT_SYSTEM_PROMPT`: optional full override for the default chat system prompt
- `FRONTEND_ORIGIN`: allowed frontend origin for CORS
- `LOG_LEVEL`: backend log level such as `INFO` or `DEBUG`
- `LOG_FILE`: backend log file path
- `LOG_DB_CRUD`: whether to log database `SELECT`, `INSERT`, `UPDATE`, and `DELETE`

## Backend

Install Python dependencies:

```powershell
uv sync --group dev
```

Run the API:

```powershell
uv run fastapi dev main.py
```

If you synced dependencies before this repo included the FastAPI CLI extra, refresh them once:

```powershell
uv sync --group dev
```

Fallback command:

```powershell
uv run uvicorn main:app --reload
```

The backend depends on `fastapi[standard]` so the `fastapi` CLI is available after `uv sync`.

## Frontend

Install frontend dependencies:

```powershell
npm install
```

Run the frontend dev server:

```powershell
npm run dev
```

Open the frontend in your browser at:

```text
http://127.0.0.1:5173/
```

The Vite dev server proxies `/api` to `http://127.0.0.1:8000`.

Backend API docs are available at:

```text
http://127.0.0.1:8000/docs
```

Backend logs are written to:

```text
logs/backend.log
```

Logging behavior:

- Logs are written to both the console and `logs/backend.log`
- Log files rotate automatically at about 1 MB per file and keep 5 backups
- Request lifecycle events are logged for incoming HTTP requests and streaming responses
- Database `SELECT`, `INSERT`, `UPDATE`, and `DELETE` statements are logged by default
- `logs/` is ignored by git and will not be committed

## Knowledge Base Import

The workspace Knowledge Base import path is:

```text
Native File -> MarkItDown normalized markdown -> LlamaIndex chunking -> FastEmbed embeddings -> Qdrant
```

Current supported import formats:

- `.txt`
- `.md`
- `.markdown`
- `.pdf`

Current behavior:

- One upload creates one asynchronous Knowledge Base job with one file-level item per file
- Imports are processed automatically by an in-process background queue worker in the FastAPI app
- The Knowledge Base Management screen polls jobs and documents while it stays open, so completed imports should appear without reopening the screen
- Unsupported or failed files stay visible in job history and per-file outcomes, but do not become formal knowledge documents
- Successful replacements create a new revision and keep the previous retrievable revision in place if the new revision fails

If PDF imports fail in a fresh environment, make sure backend dependencies were refreshed after PDF support was added:

```powershell
uv sync --group dev
```

## Tests

Backend:

```powershell
uv run pytest
```

Frontend:

```powershell
npm run test
```
