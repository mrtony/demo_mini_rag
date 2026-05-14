## Problem Statement

The backend chat flow currently depends directly on the OpenAI Python SDK and OpenAI-specific streaming event semantics. This makes the chat integration harder to evolve toward richer prompt composition, future retrieval or tool support, and a more framework-neutral backend design, while also coupling route logic and tests to provider-shaped behavior.

## Solution

Migrate the backend chat implementation to `LangChain + langchain-openai` using runnable-based streaming with `astream_events()`, while keeping the frontend-facing SSE contract unchanged. Introduce an app-owned internal chat event model, rename the provider-specific service to a neutral chat service, preserve the existing request lifecycle and persistence behavior, and keep the migration narrowly scoped to the current chat-and-title workflow.

## User Stories

1. As a user, I want streaming chat responses to keep working exactly as they do now, so that the migration does not change the live chat experience.
2. As a user, I want new conversations to keep showing a temporary title immediately, so that the UI never looks blank while the real title is being generated.
3. As a user, I want the conversation title to update automatically after the first message, so that my conversation list remains readable.
4. As a user, I want stop requests to keep interrupting active streams, so that I can halt unwanted responses without refreshing the app.
5. As a user, I want partial assistant output to remain persisted when a stream is stopped, so that I do not lose useful content.
6. As a user, I want backend errors to surface through the existing error flow, so that failures stay understandable in the UI.
7. As a user, I want previous conversation history to keep influencing later answers, so that follow-up messages still behave like a continuous chat.
8. As a developer, I want the backend to stop depending directly on provider-specific response event names, so that future framework or provider changes do not force route-layer rewrites.
9. As a developer, I want the chat prompt construction to live behind a dedicated module, so that system prompts and history shaping can evolve without bloating request handlers.
10. As a developer, I want the chat service to expose an app-owned streaming contract, so that routes and tests depend on stable backend behavior rather than LangChain internals.
11. As a developer, I want title generation to remain separate from chat streaming, so that both flows stay simpler to reason about and test.
12. As a developer, I want configuration names to become more neutral, so that the code no longer describes a LangChain-based service as if it were still an OpenAI-only implementation.
13. As a developer, I want the migration to avoid unnecessary architectural expansion, so that we do not introduce LangGraph or agent loops before the product actually needs them.
14. As a developer, I want tests to keep validating API behavior and persistence outcomes, so that refactoring the internals does not weaken confidence in the system.
15. As a future maintainer, I want an ADR and PRD explaining the trade-offs behind this migration, so that the next person does not “fix” deliberate design choices back toward provider-specific code.

## Implementation Decisions

- The migration will replace the direct OpenAI SDK integration with `LangChain + langchain-openai`.
- The backend will continue to expose the current SSE contract rather than forwarding LangChain-native event names.
- Streaming will use runnable-based `astream_events()` instead of `create_agent()` or LangGraph orchestration.
- LangGraph is explicitly out of scope for this migration because the near-term roadmap remains a focused chat flow rather than a graph-shaped workflow.
- The provider-specific service will be renamed to a neutral chat service.
- The backend will introduce an app-owned internal chat event vocabulary and envelope, with route logic consuming internal states rather than framework-native event payloads.
- Internal streaming states will include start, delta, completion, error, title, and a reserved future-facing sources concept.
- The internal event model will be class-based and lightweight, suitable for internal use rather than HTTP schema exposure.
- The route layer will remain responsible for transport concerns such as request disconnect handling, stop requests, SSE emission, message persistence timing, and stream cleanup.
- The chat service will be allowed to synthesize a start event when needed to preserve the app’s existing message-creation timing.
- Chat streaming and title generation will remain separate service capabilities, even though title updates are surfaced through the same internal event vocabulary.
- Prompt construction for chat will move behind a dedicated prompt builder module.
- The prompt builder will own full message composition, including system prompt, prior conversation history, and the current user input.
- The prompt builder will operate directly on stored conversation turn records instead of forcing an intermediate history shape.
- Chat prompt construction and title prompt construction will stay separate; title prompt creation will use a smaller helper rather than the general prompt builder.
- Chat and title prompts will both use LangChain message-based prompting.
- A default chat system prompt will live in code, with a settings-based full override available for deployment-specific customization.
- Model instances will continue to use lazy creation semantics, preserving the current lifecycle style and avoiding a larger initialization refactor.
- Existing persistence behavior will be preserved, including incremental writes on each response delta.
- The current one-row-per-turn message persistence model will remain unchanged.
- The existing stored provider response identifier field will remain in place and be treated as optional in the LangChain path.
- Logging will stay within application logs for this migration; LangSmith will not be introduced at this stage.

## Testing Decisions

- Good tests should validate externally visible behavior and persistence outcomes rather than framework-specific implementation details.
- Route and API tests should continue to assert the stable SSE contract, conversation history behavior, title update behavior, stop behavior, and error behavior.
- Test doubles should target the app-owned chat service contract rather than raw LangChain event payloads.
- The migration should preserve or add automated coverage for:
  - successful streaming of a new conversation
  - temporary title followed by final title update
  - stop behavior and partial persistence
  - error propagation and message error status
- Disconnect cleanup may remain covered by manual validation for now if automated simulation remains awkward.
- Existing backend integration-style tests provide the prior art for this work: tests should stay focused on request/response behavior, persisted message state, and event ordering rather than internal chain composition.

## Out of Scope

This PRD does not include LangGraph adoption, tool calling, agent loops, retrieval pipelines, source citation UX, multi-provider model routing, database schema redesign, a shift to one-row-per-message persistence, batching or throttling DB writes during streaming, or frontend changes to consume LangChain-native events.

## Further Notes

- The design intent is to narrow the migration to one architectural change at a time: framework abstraction for chat execution, without changing product behavior.
- The internal event adapter is the key boundary that keeps future retrieval, sources, and richer orchestration options open without forcing this migration to absorb them now.
- This PRD aligns with the ADR that records why the project is choosing LangChain runnable streaming while preserving the current SSE contract.
- The repository does not currently have an issue tracker configured for skill-driven publishing, so this PRD is recorded as a local document for now.
