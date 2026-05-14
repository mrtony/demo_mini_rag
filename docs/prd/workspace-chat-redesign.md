## Problem Statement

The current app is conversation-first: conversations exist without workspaces, chat model selection is global backend config, the frontend assumes a single active stream tied to the visible conversation, and the persistence model does not support workspace-owned chat settings. This conflicts with the product direction that every conversation must belong to a workspace, each workspace must own its own live chat settings, model capabilities must come from backend-managed catalog data, and streaming must continue even when the user navigates elsewhere.

## Solution

Redesign the app around a workspace-first model. Introduce workspace-owned settings, an internal model catalog table, workspace-scoped conversation lists, archive/restore for workspaces, permanent delete for conversations, and per-conversation streaming state that can continue in the background. Treat existing database shape as disposable and rebuild the schema around the new domain instead of migrating old data forward.

## User Stories

1. As a user, I want to create a workspace by entering only a valid name, so that starting organization is quick.
2. As a user, I want the create-workspace flow to show the default model that will be used, so that hidden defaults do not surprise me.
3. As a user, I want every conversation to live inside a workspace, so that chat history is organized by purpose.
4. As a user, I want to open workspace settings and change the workspace name, system message, model, and model-specific parameters, so that each workspace can behave differently.
5. As a user, I want workspace settings edits to apply only after I explicitly save, so that I can review grouped changes before they affect chat.
6. As a user, I want unsaved settings changes to warn me before I lose them, so that accidental navigation does not silently discard work.
7. As a user, I want the next turn to use the workspace's current saved settings, so that updated model behavior takes effect without creating a new conversation.
8. As a user, I want in-flight streaming responses to keep using the settings they started with, so that mid-stream saves do not mutate a running reply.
9. As a user, I want to switch to another workspace or conversation while a response is still streaming, so that I can continue browsing the app without interrupting generation.
10. As a user, I want conversations with active background streams to be visibly marked in the conversation list, so that I can tell which chats are still running.
11. As a user, I want a new conversation to appear in the workspace list as soon as its first prompt creates it, so that it does not feel lost while the first reply is streaming.
12. As a user, I want conversation lists to sort by recent activity, so that active chats rise naturally.
13. As a user, I want the workspace list to default to creation order but support persisted manual reordering, so that long-lived workspaces stay arranged the way I want.
14. As a user, I want to archive workspaces instead of deleting them, so that I can tidy the sidebar without losing organizational containers.
15. As a user, I want archived workspaces to require restore before reuse, so that archive has a clear inactive meaning.
16. As a user, I want to permanently delete a conversation with confirmation, so that I can clean up chat history deliberately.
17. As a user, I want deleting a streaming conversation to stop the stream first, so that the system stays consistent.
18. As a developer, I want model availability, supported settings, and defaults to come from backend-managed catalog data, so that frontend behavior is driven by one source of truth.
19. As a developer, I want title generation to stay independent from workspace model choice, so that simple system title generation does not expand workspace settings scope.
20. As a developer, I want this redesign to remain limited to chat settings, not retrieval configuration, so that future RAG work can be added later without bloating this release.

## Implementation Decisions

- Rebuild the persistence model around workspaces instead of preserving the current standalone conversation schema.
- Do not migrate existing conversation data; dropping and recreating tables is acceptable for this phase.
- Keep the existing domain vocabulary from `CONTEXT.md`: workspace, workspace settings, selected model, model catalog, conversation, turn, active stream, archived workspace, and disabled model.
- Require every conversation to belong to exactly one workspace.
- Keep conversation as context-only data. Do not snapshot model choice, system message, or model-specific settings per conversation.
- Make each new turn read the workspace's currently saved settings at send time.
- Keep any already-started stream bound to the settings it started with until that turn completes or stops.
- Keep title generation separate from workspace settings and continue sourcing the title model from backend config.
- Keep workspace settings scope limited to:
  - workspace name
  - system message
  - selected model
  - model-specific settings supported by the selected model
- Do not expose RAG/document-library configuration in this redesign.
- Treat `temperature` as just another model-specific setting rather than a universal field.
- Make the model catalog an internal backend data table, not a user-managed admin UI.
- Store model support rules and default values in the model catalog, including the default model for newly created workspaces.
- Ensure the default workspace model is always an enabled model from the catalog.
- If a workspace references a disabled model, allow history browsing but block new generation until the model is changed.
- Remove persisted model-specific values that no longer apply when the selected model is changed and saved.
- Discard pending model-specific values that no longer apply immediately when the user switches models in the settings UI before saving.
- Make workspaces non-deletable but archivable/restorable.
- Make conversations permanently deletable with confirmation.
- Keep the conversation list inside a workspace sorted by recent activity.
- Keep the workspace list sorted by creation order by default, with persisted user-defined manual ordering.

## Proposed Data Model

The exact SQLAlchemy definitions can evolve, but the schema should be rebuilt around these records.

### `workspaces`

- `id` integer primary key
- `workspace_id` public string id
- `name` string, non-blank, minimum length 3
- `system_message` text, non-blank
- `selected_model_id` foreign key to model catalog
- `sort_order` integer for persisted manual workspace ordering
- `is_archived` boolean
- `archived_at` nullable timestamp
- `created_at` timestamp
- `updated_at` timestamp

Notes:
- `sort_order` should drive the main sidebar order after creation.
- Archive state belongs on the workspace itself, not in a separate archive table.

### `workspace_model_settings`

- `id` integer primary key
- `workspace_fk` foreign key to workspaces, unique if using one row per workspace+setting
- `setting_key` string
- `setting_value_json` JSON/text
- `created_at` timestamp
- `updated_at` timestamp

Notes:
- This table stores only settings currently applicable to the workspace's selected model.
- On model save, obsolete rows are deleted.
- A normalized key/value table is simpler than adding many nullable columns for evolving model parameters.

### `model_catalog`

- `id` integer primary key
- `model_id` string, unique, provider-facing model name
- `provider` string, currently `openai`
- `label` string for UI display
- `is_enabled` boolean
- `is_default_workspace_model` boolean
- `supports_system_message` boolean, likely always true for current scope but harmless to include
- `settings_schema_json` JSON/text describing supported model-specific settings
- `settings_defaults_json` JSON/text describing default values for supported settings
- `sort_order` integer for stable UI presentation
- `created_at` timestamp
- `updated_at` timestamp

Notes:
- `settings_schema_json` should describe which fields to render, their types, ranges, enums, labels, and help text.
- Exactly zero or one row should be marked as the default workspace model at a time.

### `conversations`

- `id` integer primary key
- `conversation_id` public string id
- `workspace_fk` foreign key to workspaces
- `conversation_title` string
- `created_at` timestamp
- `updated_at` timestamp

Notes:
- Keep temporary-title-then-final-title behavior.
- `updated_at` should drive recent-activity ordering inside a workspace.

### `messages`

- `id` integer primary key
- `conversation_fk` foreign key to conversations
- `query` text
- `response` text
- `openai_response_id` nullable string
- `status` string
- `created_at` timestamp
- `updated_at` timestamp

Notes:
- The current one-row-per-turn model can remain.
- No need to redesign into one-row-per-message for this feature set.

## Backend API Shape

The final routes can be adjusted, but the API should be reorganized around workspace ownership.

### Workspace APIs

- `GET /api/workspaces`
  - returns active workspaces in persisted sidebar order
- `GET /api/workspaces/archived`
  - returns archived workspaces
- `POST /api/workspaces`
  - input: `name`
  - behavior: create workspace using default workspace model and its default settings
  - response includes visible initial model metadata
- `GET /api/workspaces/{workspace_id}`
  - returns workspace summary plus current settings
- `PATCH /api/workspaces/{workspace_id}`
  - updates name, system message, selected model, and model-specific settings in one explicit-save request
  - validates all fields together
- `POST /api/workspaces/reorder`
  - persists manual workspace ordering
- `POST /api/workspaces/{workspace_id}/archive`
  - archives workspace
- `POST /api/workspaces/{workspace_id}/restore`
  - restores archived workspace

### Model Catalog APIs

- `GET /api/models`
  - returns enabled catalog entries for selection UI
  - includes supported settings schema and defaults
- optional: `GET /api/models/{model_id}`
  - only needed if the frontend should lazy-load detailed model metadata

### Conversation APIs

- `GET /api/workspaces/{workspace_id}/conversations`
  - returns only that workspace's conversations, ordered by recent activity
- `GET /api/conversations/{conversation_id}`
  - returns conversation detail and stored turns
- `DELETE /api/conversations/{conversation_id}`
  - hard delete after confirmation on client side
  - if streaming, stop first then delete

### Chat Streaming API

The current `POST /api/chat/stream` endpoint can stay, but its request must become workspace-aware in behavior even if the body remains minimal.

- For a new conversation request:
  - require a target `workspace_id`
  - create the conversation only when the first user prompt is accepted
  - emit `conversation.created` as soon as the conversation row exists
- For an existing conversation request:
  - load the conversation's workspace
  - resolve the workspace's current saved settings
  - build the chat request from those settings

Potential request shape:

```json
{
  "workspace_id": "ws_123",
  "conversation_id": "conv_123_or_0",
  "message": "..."
}
```

The SSE contract should remain app-owned. Add enough payload data for the frontend to reconcile background streams cleanly, especially `workspace_id` and `conversation_id` on relevant events.

## Frontend Redesign

The current frontend stores one visible message list and one global `isStreaming` flag. That is not enough for background streaming.

### State shape goals

- Track workspaces separately from conversations.
- Track active workspace and active conversation independently.
- Track conversation summaries per workspace.
- Track loaded message bubbles per conversation.
- Track streaming state per conversation, not globally.
- Track pending workspace settings separately from saved workspace settings.

Suggested state concepts:

- `workspaceSummaries`
- `archivedWorkspaceSummaries`
- `activeWorkspaceId`
- `conversationSummariesByWorkspaceId`
- `activeConversationId`
- `messageBubblesByConversationId`
- `streamStateByConversationId`
  - `idle | streaming | stopped | error`
  - optional metadata: `abortController`, `activeAssistantBubbleId`
- `workspaceSettingsByWorkspaceId`
- `pendingWorkspaceSettings`

### UI structure

- Left sidebar:
  - active workspace list
  - manual reorder support
  - create workspace
  - settings icon
  - new-conversation icon
  - archive entrypoint
- Workspace main area:
  - workspace-scoped conversation list
  - active stream indicator on list items
- Chat panel:
  - selected conversation history
  - composer
  - stop button only inside the opened conversation
- Workspace settings view:
  - `General` tab: workspace name, system message
  - `Model` tab: selected model plus dynamic model-specific settings

### Background streaming behavior

- The user may switch workspaces or conversations while another conversation streams.
- The original stream keeps appending deltas into that conversation's stored UI state.
- The conversation list item remains visibly marked while streaming.
- No extra toast or completion notification is shown when background generation finishes.
- No stop control is shown in the conversation list; stopping requires opening that conversation.

## Prompting Rules

- Chat prompt system message comes entirely from the workspace's saved `system_message`.
- The current built-in chat system prompt should no longer be silently prepended once workspace system messages are introduced.
- Title generation remains separate and keeps its own backend-controlled prompt and model.

## Validation Rules

### Workspace

- name is required
- name must be at least 3 characters
- system message is required and non-blank
- workspace cannot be deleted

### Workspace settings save

- selected model must exist in the model catalog
- selected model must be enabled
- all provided model-specific settings must be valid according to the selected model's schema
- unsupported model-specific settings must be rejected or stripped before persistence

### Conversation delete

- delete requires confirmation in UI
- delete is permanent
- if conversation is streaming, stop it before delete completes

## Suggested Delivery Slices

Implement this in vertical slices rather than a giant rewrite.

### Slice 1: Persistence and backend foundations

- Rebuild SQLAlchemy models around workspaces, model catalog, conversations, and messages
- Add seed/bootstrap logic for model catalog
- Add workspace CRUD, archive/restore, reorder, and conversation list routes
- Keep chat streaming route working with workspace-owned settings

### Slice 2: Workspace-first navigation

- Replace global conversation list UI with workspace sidebar + workspace-scoped conversation list
- Add create workspace flow
- Add archived workspace view and restore action
- Add manual workspace reordering with persistence

### Slice 3: Workspace settings

- Add settings view with `General` and `Model` tabs
- Implement explicit save flow
- Implement discard warning
- Implement dynamic rendering from model catalog schema
- Implement obsolete-setting cleanup on model change save

### Slice 4: Background streaming

- Refactor frontend stream state to be per conversation
- Preserve active streams when navigating away
- Mark streaming conversations in the list
- Keep stop action scoped to the opened conversation

### Slice 5: Conversation deletion and cleanup

- Add permanent delete with confirmation
- Stop-then-delete behavior for streaming conversations
- Add regression tests for delete, archive, disabled model, and background streaming

## Testing Decisions

- Rebuild backend tests around workspace ownership rather than patching the old conversation-only assumptions.
- Keep testing externally visible behavior rather than internal implementation details.
- Add API coverage for:
  - workspace creation with default model
  - workspace rename validation
  - archive and restore
  - persisted workspace reorder
  - workspace-scoped conversation listing
  - conversation creation on first prompt only
  - workspace settings explicit save
  - invalid model-specific setting rejection
  - disabled model blocking generation
  - title generation remaining independent
  - conversation delete and stop-then-delete behavior
- Add frontend coverage for:
  - switching workspaces
  - loading workspace-scoped conversation history
  - background streaming while navigating elsewhere
  - conversation list streaming indicator
  - discard warning on unsaved settings
  - dynamic model settings rendering

## Out of Scope

- RAG/document-library settings
- multi-user permissions
- billing
- agent workflow orchestration
- collaborative document editing
- large production queueing systems
- user-facing model catalog administration
- soft delete or trash for conversations
- workspace deletion

## Further Notes

- This redesign intentionally changes the center of gravity from conversation-first to workspace-first.
- The biggest technical risk is the frontend streaming state refactor, not the route layer.
- The backend already has a per-conversation stop primitive; the main work is making the frontend no longer assume only one visible active stream exists.
- Because old data can be discarded, the team should prefer clean schema boundaries over compatibility shims.
