# LangChain Migration Checklist

Use this checklist to migrate the backend chat flow from the direct OpenAI SDK to `LangChain + langchain-openai` without changing the frontend-facing SSE contract.

## 1. Dependencies and Naming

- [ ] Update [pyproject.toml](/D:/mygithub/demo_mini_rag/pyproject.toml) to remove `openai` and add:
  - `langchain>=1.0,<2.0`
  - `langchain-core>=1.0,<2.0`
  - `langchain-openai`
- [ ] Regenerate the lockfile with `uv sync --group dev`.
- [ ] Rename `OpenAIService` to `ChatService`.
- [ ] Rename `get_openai_service` to `get_chat_service`.
- [ ] Rename [backend/app/services/openai_service.py](/D:/mygithub/demo_mini_rag/backend/app/services/openai_service.py) to `chat_service.py`.
- [ ] Update imports across the backend and tests to use the neutral names.

## 2. Settings

- [ ] Keep `OPENAI_API_KEY` as the provider credential.
- [ ] Rename model settings in [backend/app/config.py](/D:/mygithub/demo_mini_rag/backend/app/config.py):
  - `openai_chat_model` -> neutral chat model setting
  - `openai_title_model` -> neutral title model setting
- [ ] Add a default chat system prompt constant plus a settings override for full replacement.
- [ ] Do not introduce multi-provider settings yet.

## 3. Internal Event Model

- [ ] Add [backend/app/chat_events.py](/D:/mygithub/demo_mini_rag/backend/app/chat_events.py).
- [ ] Define `ChatStreamState` as the app-owned internal stream state enum.
- [ ] Define a dataclass envelope for internal chat events.
- [ ] Keep internal events separate from SSE event names.
- [ ] Include fixed fields for error payloads such as `error_message` and `error_code`.
- [ ] Keep `sources` in the model as a future-facing field, but do not emit `sources` events in this migration.

## 4. Prompt Construction

- [ ] Add a `PromptBuilder` that owns chat prompt construction.
- [ ] Make `PromptBuilder` a stateful object configured with the effective chat system prompt.
- [ ] Have `PromptBuilder` accept DB `Message` records directly.
- [ ] Have `PromptBuilder` return the full LangChain message list:
  - system message
  - prior history expanded into `HumanMessage` / `AIMessage`
  - current user message
- [ ] Keep title prompt construction out of `PromptBuilder`.
- [ ] Add a small title prompt helper that builds a message-based prompt for title generation.

## 5. ChatService Design

- [ ] Build `ChatService` around LangChain runnables, not `create_agent()`.
- [ ] Use `astream_events()` for chat streaming.
- [ ] Keep chat streaming and title generation as separate methods.
- [ ] Keep lazy creation for the chat model and title model.
- [ ] Allow `STARTED` to be emitted by the service even if it is synthesized rather than directly forwarded from a LangChain event.
- [ ] Normalize title output through a thin LangChain-oriented result extractor rather than reusing the old OpenAI response parser.

## 6. Route Integration

- [ ] Keep [backend/app/routes.py](/D:/mygithub/demo_mini_rag/backend/app/routes.py) in charge of:
  - stop handling
  - disconnect handling
  - DB writes
  - SSE emission
  - title task orchestration
- [ ] Remove the old provider-shaped history builder and replace it with raw DB message record loading.
- [ ] Pass message records and the new user message into `ChatService`.
- [ ] Map internal chat events back into the existing SSE contract:
  - `conversation.created`
  - `conversation.title`
  - `message.created`
  - `message.delta`
  - `message.done`
  - `error`
- [ ] Keep `message.done` as a completion signal only; do not attach final full content to the completed event.
- [ ] Keep incremental DB writes on every delta for this migration.
- [ ] Keep the temporary-title-then-background-final-title UX.

## 7. Persistence and Compatibility

- [ ] Keep the existing database schema unchanged in this migration.
- [ ] Keep `openai_response_id` for now, but treat it as optional and nullable when using LangChain.
- [ ] Do not rename the DB column in this migration.
- [ ] Do not change the one-row-per-turn message model in this migration.

## 8. Logging

- [ ] Reuse the existing application logger.
- [ ] Add logs around:
  - stream start
  - first delta
  - completion
  - stop
  - disconnect
  - error
  - title generation start and finish
  - LangChain event-to-internal-event mapping decisions
- [ ] Do not add LangSmith in this migration.

## 9. Tests

- [ ] Update test overrides to fake the app-owned `ChatService` contract instead of LangChain raw events.
- [ ] Keep or add automated coverage for:
  - successful new conversation streaming
  - title update after temporary title
  - stop behavior
  - error behavior
- [ ] Accept manual validation for disconnect cleanup in this migration if automated coverage is awkward.

## 10. Out of Scope

- [ ] Do not introduce LangGraph yet.
- [ ] Do not expose LangChain-native event names to the frontend.
- [ ] Do not add tool calling or agent loops in this migration.
- [ ] Do not redesign the DB write cadence.
- [ ] Do not refactor the message schema into one-row-per-message.
