# Chat Workspace

This context describes the language of a minimal chat application that groups conversations into workspaces, streams assistant replies, updates conversation titles from the first user prompt, and manages workspace-owned knowledge bases. It exists so product and implementation discussions use the same terms for workspace settings, knowledge-base settings, chat history, titles, and stream lifecycle.

## Language

**Workspace**:
A named container that owns conversations and defines the default chat settings they use.
_Avoid_: Project, folder, chat group

**Archived Workspace**:
A workspace hidden from the main workspace list until it is restored.
_Avoid_: Deleted workspace, permanent removal

**Workspace Name**:
The human-readable name of a Workspace, which must be non-blank and at least three characters long.
_Avoid_: Optional label, free-form nickname

**Workspace Settings**:
The chat configuration owned by a Workspace and used when generating replies in its Conversations.
_Avoid_: Conversation settings, per-chat config

**Settings Tab**:
A section within Workspace Settings that groups related editable fields.
_Avoid_: Page, unrelated panel

**Knowledge Base**:
A workspace-owned collection of imported documents and indexed content used for retrieval.
_Avoid_: Vector database, file bucket, document library

**Knowledge Base Settings**:
The workspace-level configuration that governs document ingestion and retrieval for its Knowledge Base.
_Avoid_: Vector DB settings, RAG config

**Knowledge Base Tab**:
The Workspace Settings tab where a user edits Knowledge Base Settings.
_Avoid_: File manager, standalone admin page

**Knowledge Base Management**:
The workspace-level screen where a user manages knowledge documents, uploads, and job status.
_Avoid_: Settings-only tab, hidden upload area

**Chunk Count**:
The number of indexed chunks or nodes produced for the currently retrievable revision of a knowledge document.
_Avoid_: File size proxy, hidden ingestion result, guessed complexity

**Knowledge Base Job History**:
The persisted record of past knowledge-base jobs that can be browsed over time.
_Avoid_: Ephemeral status only, latest-job only, invisible audit trail

**Ingestion Setting**:
A Knowledge Base Setting that changes how source documents are parsed or split into indexed content.
_Avoid_: Query-time knob, retrieval-only setting

**Retrieval Setting**:
A Knowledge Base Setting that changes how indexed content is selected at answer time without changing the indexed content itself.
_Avoid_: Rebuild-only setting, chunking rule

**Knowledge Base Rebuild**:
A full reprocessing operation that regenerates indexed content for a Workspace's Knowledge Base under its current Knowledge Base Settings.
_Avoid_: Silent refresh, partial save

**Rebuild Required**:
A state indicating that a Workspace's Knowledge Base no longer matches its current Knowledge Base Settings until a Knowledge Base Rebuild is completed.
_Avoid_: Auto-updated, already applied

**Rebuild Prompt**:
A user-visible call to action shown after saving ingestion-setting changes so the user can start a Knowledge Base Rebuild now or defer it.
_Avoid_: Silent backlog, automatic rebuild, hidden next step

**Knowledge Base Job**:
An asynchronous workspace-scoped operation that imports documents or rebuilds a Knowledge Base.
_Avoid_: Request, inline save, hidden process

**Knowledge Base Version**:
A complete indexed snapshot of a Workspace's Knowledge Base that can serve retrieval traffic.
_Avoid_: Partial index, live draft

**Document Import Item**:
One file-level import record tracked inside a Knowledge Base Job.
_Avoid_: Standalone job, anonymous upload

**Document Import Outcome**:
The final per-file result of a Document Import Item, such as imported, replaced, unchanged, unsupported, or failed.
_Avoid_: Batch-only status, hidden file result, all-or-nothing outcome

**Queued Knowledge Base Job**:
A Knowledge Base Job that has been accepted but is waiting for its turn to run.
_Avoid_: Lost request, invisible backlog, running job

**Canceled Knowledge Base Job**:
A queued document-import job that was explicitly withdrawn before execution began.
_Avoid_: Silent disappearance, mid-run abort, rebuild cancel

**Knowledge Document**:
A file that belongs to a Workspace's Knowledge Base and may contribute searchable indexed content.
_Avoid_: Attachment, loose upload, unnamed blob

**Content Hash**:
A deterministic fingerprint of a Knowledge Document's file content used to detect whether the content has changed.
_Avoid_: Filename check, guessed duplicate, display name

**Knowledge Document Identity**:
The stable system identity of a Knowledge Document, distinct from its filename or other display metadata.
_Avoid_: Filename-only identity, temporary upload name

**Knowledge Document Revision**:
One version of a Knowledge Document's content associated with a specific Content Hash.
_Avoid_: Loose replacement, unnamed update, invisible overwrite

**Native File**:
The original uploaded file preserved for a Knowledge Document Revision so the system can reprocess it later.
_Avoid_: Derived chunk, temporary upload, disposable source

**Normalized Markdown**:
The markdown representation derived from a Native File and used as the canonical text input for chunking and retrieval preparation.
_Avoid_: Raw binary file, ad hoc text dump, display-only preview

**Deleted Knowledge Document**:
A knowledge document removed from retrieval but retained temporarily for traceability and cleanup.
_Avoid_: Active file, immediately purged record

**Knowledge Answering**:
Reply generation that uses a Workspace's Knowledge Base as retrieval context.
_Avoid_: Always-on retrieval, plain chat, hidden search

**Knowledge Answering Default**:
The workspace-level default that determines whether new chat turns begin with Knowledge Answering enabled.
_Avoid_: Forced retrieval, per-message memory

**Retrieval Trace**:
A stored record of which knowledge-base version and retrieved chunks were used for one turn of Knowledge Answering.
_Avoid_: Guesswork, implicit context, unstored citation

**Retrieval Query**:
The search input derived for one turn of Knowledge Answering from the current user prompt and relevant recent conversation context.
_Avoid_: Full conversation dump, raw vector text, prompt-only guess

**Source Citation**:
A user-visible reference from an Assistant Reply to the Knowledge Document Revision content that supported it.
_Avoid_: Hidden provenance, unverifiable answer, internal-only trace

**Citation Snapshot**:
A small stored excerpt captured at answer time so a Source Citation remains readable even if the underlying index later changes.
_Avoid_: Full chunk mirror, live lookup only, unstable quote

**Sources Section**:
A UI area shown with an Assistant Reply that lists the Source Citations supporting that reply.
_Avoid_: Inline-only citation marker, hidden provenance, model-formatted footnote

**Page or Slide Locator**:
The page number or slide number attached to indexed content so citations can point to a precise location in a document.
_Avoid_: Unlocated excerpt, filename-only citation, guessed position

**Pending Settings**:
Unsaved changes made inside Workspace Settings before the user confirms them.
_Avoid_: Live settings, auto-saved state

**Discard Warning**:
A confirmation shown before leaving Workspace Settings with Pending Settings that have not been saved.
_Avoid_: Silent reset, implicit discard

**Delete Confirmation**:
A confirmation shown before permanently removing a Conversation.
_Avoid_: One-click delete, silent removal

**System Message**:
The non-blank workspace-level instruction included when generating replies for Conversations in that Workspace.
_Avoid_: Per-conversation prompt, user prompt

**Model-specific Setting**:
A setting inside Workspace Settings that only applies when the selected model supports it.
_Avoid_: Universal field, always-on option

**Selected Model**:
The model currently chosen in Workspace Settings, which determines which Model-specific Settings are available.
_Avoid_: Active conversation model, fixed model snapshot

**Model Catalog**:
A backend-managed collection of selectable models and the settings each one supports.
_Avoid_: Frontend constant list, static config file

**Disabled Model**:
A model that remains in the Model Catalog for reference but cannot be newly selected for chat generation.
_Avoid_: Deleted model, invisible model

**Default Workspace Model**:
The active model designated by the Model Catalog for newly created Workspaces.
_Avoid_: Hard-coded fallback, frontend default

**Conversation**:
A named chat session within a Workspace containing an ordered history of turns.
_Avoid_: Chat, thread, session

**Turn**:
One user prompt and its corresponding assistant reply within a Conversation.
_Avoid_: Message pair, exchange row

**User Prompt**:
The text a user submits to start or continue a Turn.
_Avoid_: Query, input, question

**Assistant Reply**:
The text generated by the system in response to a User Prompt.
_Avoid_: Response, output, completion

**Temporary Title**:
The placeholder name assigned to a new Conversation before title generation finishes.
_Avoid_: Draft title, provisional name

**Conversation Title**:
The final human-readable name shown for a Conversation after title generation.
_Avoid_: Label, subject

**Active Stream**:
An in-progress Assistant Reply that is still emitting text for a Turn.
_Avoid_: Request, generation job

**Stopped Turn**:
A Turn whose Active Stream was interrupted before the Assistant Reply finished.
_Avoid_: Cancelled message, aborted response

## Relationships

- A **Conversation** contains one or more **Turns**
- A **Workspace** contains zero or more **Conversations**
- A **Workspace** has exactly one **Workspace Name**
- A **Workspace** owns exactly one set of **Workspace Settings**
- A **Workspace** owns exactly one **Knowledge Base**
- A **Workspace** owns exactly one set of **Knowledge Base Settings**
- A **Workspace** may become an **Archived Workspace**
- The main **Workspace** list defaults to creation order and supports manual reordering
- Manual **Workspace** ordering is persisted
- **Workspace Settings** are grouped into one or more **Settings Tabs**
- **Workspace Settings** contain chat settings and may include a tab for **Knowledge Base Settings**
- A **Knowledge Base Tab** belongs to **Workspace Settings**
- **Knowledge Base Management** is separate from the **Knowledge Base Tab**
- **Knowledge Base Settings** govern document ingestion and retrieval for a **Workspace**'s **Knowledge Base**
- **Knowledge Base Settings** follow the same **Pending Settings**, save, and discard behavior as other **Workspace Settings**
- A **Knowledge Base** belongs to exactly one **Workspace**
- A **Knowledge Base** uses the **Knowledge Base Settings** of its **Workspace**
- Changing **Knowledge Base Settings** may place a **Knowledge Base** into **Rebuild Required**
- A **Knowledge Base Rebuild** brings a **Knowledge Base** back into alignment with its current **Knowledge Base Settings**
- Saving ingestion-setting changes may show a **Rebuild Prompt**
- A **Knowledge Base Job** belongs to exactly one **Workspace**
- A **Knowledge Base Job** may import documents into a **Knowledge Base**
- A **Knowledge Base Job** may execute a **Knowledge Base Rebuild**
- A **Knowledge Base Job** may contain one or more **Document Import Items**
- A **Document Import Item** belongs to exactly one **Knowledge Base Job**
- A **Document Import Item** may end with exactly one **Document Import Outcome**
- A **Knowledge Base Job** may become a **Queued Knowledge Base Job**
- A successful document import creates or updates a **Knowledge Document**
- Unsupported or failed files remain visible through **Document Import Outcome** and **Knowledge Base Job History** instead of becoming **Knowledge Documents**
- A document import with a duplicate **Content Hash** in the same **Workspace** does not create a new **Knowledge Document**
- A **Queued Knowledge Base Job** remains visible to the user through job status in the UI
- A **Queued Knowledge Base Job** for document import may become a **Canceled Knowledge Base Job** before execution begins
- A **Knowledge Document** belongs to exactly one **Knowledge Base**
- A **Knowledge Document** has exactly one **Knowledge Document Identity**
- A **Knowledge Document** may have one **Content Hash** representing its current file content
- A **Knowledge Document** may have one or more **Knowledge Document Revisions**
- A **Knowledge Document Revision** belongs to exactly one **Knowledge Document**
- A **Knowledge Document Revision** keeps exactly one **Native File** for future reprocessing
- A **Knowledge Document Revision** may produce one **Normalized Markdown** representation for ingestion
- A failed **Knowledge Document Revision** does not replace the currently retrievable revision of its **Knowledge Document**
- A **Knowledge Base** may have one active **Knowledge Base Version** serving retrieval traffic
- A **Knowledge Base Rebuild** creates a new **Knowledge Base Version** before it replaces the active one
- A **Knowledge Base Rebuild** uses only the currently retrievable revision of each non-deleted **Knowledge Document**
- A successful **Document Import Item** becomes searchable in the active **Knowledge Base Version** without waiting for other items in the same **Knowledge Base Job**
- Deleting a **Knowledge Document** removes it from retrieval without waiting for a **Knowledge Base Rebuild**
- Deleting a **Knowledge Document** may turn it into a **Deleted Knowledge Document** before its files and metadata are permanently purged
- A running **Knowledge Base Rebuild** does not allow another **Knowledge Base Rebuild** to start
- Document import requests may wait as **Queued Knowledge Base Jobs** instead of being dropped
- A **Knowledge Base Rebuild** does not start while document import jobs for the same **Workspace** are running or queued
- Only queued document-import jobs may be canceled; running jobs and rebuilds are not canceled in v1
- Changing an **Ingestion Setting** places the **Knowledge Base** into **Rebuild Required**
- Changing a **Retrieval Setting** does not place the **Knowledge Base** into **Rebuild Required**
- A **Workspace** has exactly one **Knowledge Answering Default**
- A **Turn** may override the **Knowledge Answering Default** of its **Workspace**
- A **Turn** with **Knowledge Answering** enabled retrieves from the active **Knowledge Base Version** of its **Workspace**
- A **Turn** may fall back to plain chat when **Knowledge Answering** is enabled but no retrievable **Knowledge Base Version** is available
- A **Turn** override of **Knowledge Answering Default** affects only that **Turn**
- A **Turn** with **Knowledge Answering** enabled may derive one **Retrieval Query**
- A **Turn** may fall back to plain chat when its **Retrieval Query** does not return sufficiently relevant content
- A **Knowledge Base** in **Rebuild Required** may continue serving **Knowledge Answering** from its active **Knowledge Base Version** until rebuild completes
- A **Turn** with **Knowledge Answering** enabled searches the active **Knowledge Base Version** of its **Workspace** rather than a user-selected subset of documents
- A **Turn** that uses **Knowledge Answering** may store one **Retrieval Trace**
- An **Assistant Reply** produced with **Knowledge Answering** uses retrieved knowledge-base content as its primary evidence and should acknowledge when that evidence is insufficient
- A **Retrieval Trace** refers to the specific **Knowledge Base Version** used at answer time
- A **Retrieval Trace** may refer to one or more **Knowledge Document Revisions**
- An **Assistant Reply** produced with **Knowledge Answering** may show one or more **Source Citations**
- A **Source Citation** is derived from the **Retrieval Trace** of its **Turn**
- A **Retrieval Trace** may store one or more **Citation Snapshots**
- A **Source Citation** may be rendered from a stored **Citation Snapshot**
- A **Source Citation** may include a **Page or Slide Locator**
- An **Assistant Reply** may render its **Source Citations** in a **Sources Section**
- **Knowledge Base Management** may show the **Chunk Count** of the currently retrievable revision of each **Knowledge Document**
- **Knowledge Base Management** may show paginated **Knowledge Base Job History**
- **Workspace Settings** may have **Pending Settings** before save
- Leaving **Workspace Settings** with **Pending Settings** triggers a **Discard Warning**
- A **Workspace Settings** set contains exactly one **Selected Model**
- A **Workspace Settings** set includes exactly one **System Message**
- A **Workspace Settings** set may include one or more **Model-specific Settings**
- A **Selected Model** must come from the **Model Catalog**
- A **Selected Model** may later become a **Disabled Model**
- The **Default Workspace Model** comes from the **Model Catalog** and cannot be a **Disabled Model**
- The **Model Catalog** provides default values for supported **Model-specific Settings**
- Saving a new **Selected Model** removes persisted **Model-specific Settings** that no longer apply
- A new **Workspace** begins with default **Workspace Settings**
- A new **Workspace** begins with a default **System Message** that users may fully replace
- A **Conversation** belongs to exactly one **Workspace**
- A **Conversation** does not own its own chat settings
- A **Turn** uses the current **Workspace Settings** of its **Conversation**'s **Workspace**
- A **Turn** does not use **Pending Settings**
- A **Turn** uses the current **System Message** of its **Workspace** at send time
- An **Active Stream** keeps the settings it started with until that **Turn** finishes or stops
- A **Conversation Title** is generated independently from **Workspace Settings**
- Selecting a **Workspace** shows only that **Workspace**'s **Conversations**
- An **Archived Workspace** is hidden from the main **Workspace** list
- An **Archived Workspace** must be restored before it can be used again
- A **Workspace**'s **Conversation** list is ordered by most recent activity
- A new **Conversation** appears in its **Workspace** list as soon as creation succeeds, even if its **Active Stream** is still running
- A **Conversation** with an **Active Stream** is visibly marked in the **Conversation** list
- Selecting a **Conversation** loads its stored **Turns**
- A **Disabled Model** blocks new generation but does not block reading existing **Conversations**
- Starting a new **Conversation** does not persist anything until the first **User Prompt** is sent
- A **Conversation** may be deleted
- Deleting a **Conversation** requires a **Delete Confirmation**
- Deleting a **Conversation** permanently removes it
- Deleting a **Conversation** with an **Active Stream** stops that stream before removal
- A **Turn** contains exactly one **User Prompt**
- A **Turn** may contain a partial or complete **Assistant Reply**
- A new **Conversation** begins with a **Temporary Title**
- A **Temporary Title** may later be replaced by a **Conversation Title**
- An **Active Stream** produces the **Assistant Reply** for one **Turn**
- An **Active Stream** may continue in the background while the user views another **Workspace** or **Conversation**
- A **Stopped Turn** belongs to exactly one **Conversation**

## Example dialogue

> **Dev:** "Can the user start a **Conversation** without choosing a **Workspace** first?"
> **Domain expert:** "No — every **Conversation** belongs to exactly one **Workspace**, and it uses that **Workspace**'s chat settings."
>
> **Dev:** "Do we snapshot the model into each **Conversation** when it starts?"
> **Domain expert:** "No — the **Conversation** is only context, and the active model comes from the **Workspace Settings**."
>
> **Dev:** "If a **Workspace** name no longer fits, do we delete it and recreate it?"
> **Domain expert:** "No — a **Workspace** is not deletable, but its name may be changed later."
>
> **Dev:** "Does changing a **Workspace Name** follow the same rules as creating it?"
> **Domain expert:** "Yes — a **Workspace Name** must stay non-blank and at least three characters long."
>
> **Dev:** "Can a **Workspace** exist before the user starts any **Conversation** in it?"
> **Domain expert:** "Yes — a **Workspace** may be empty until the user chooses to start a **Conversation**."
>
> **Dev:** "Does the workspace list's edit control rename the **Workspace**?"
> **Domain expert:** "No — that control starts a new **Conversation** in the selected **Workspace**, while **Workspace Settings** open separately."
>
> **Dev:** "Where does the user rename the **Workspace** itself?"
> **Domain expert:** "Inside **Workspace Settings**, not from the workspace list."
>
> **Dev:** "What belongs in the General settings area?"
> **Domain expert:** "The General **Settings Tab** contains the **Workspace Name** and the **System Message**."
>
> **Dev:** "Does the **System Message** supplement a built-in system prompt?"
> **Domain expert:** "No — the **System Message** fully replaces the built-in chat system prompt for reply generation."
>
> **Dev:** "Is the default **System Message** locked by the system?"
> **Domain expert:** "No — it is only the initial content and may be fully replaced by the user."
>
> **Dev:** "Can the user save an empty **System Message**?"
> **Domain expert:** "No — the **System Message** may be rewritten, but it cannot be blank."
>
> **Dev:** "Do changes in **Workspace Settings** apply immediately as the user edits each field?"
> **Domain expert:** "No — edits become **Pending Settings** and only apply after the user saves them."
>
> **Dev:** "What if the user leaves **Workspace Settings** with unsaved changes?"
> **Domain expert:** "Show a **Discard Warning** before the unsaved changes are lost."
>
> **Dev:** "If the user saves new **Workspace Settings** while an **Active Stream** is already running, does that stream switch over mid-generation?"
> **Domain expert:** "No — the running **Active Stream** keeps the settings it started with, and the new settings only affect later turns."
>
> **Dev:** "After saving **Workspace Settings**, does the UI leave the settings view automatically?"
> **Domain expert:** "No — after save, the user remains in **Workspace Settings**."
>
> **Dev:** "Is **temperature** always a fixed field in **Workspace Settings**?"
> **Domain expert:** "No — **temperature** is treated like any other **Model-specific Setting** and only appears when the selected model supports it."
>
> **Dev:** "Where do the initial values for model-specific fields come from?"
> **Domain expert:** "From the **Model Catalog**, which provides the default values for the selected model's supported settings."
>
> **Dev:** "What decides the initial model for a new **Workspace**?"
> **Domain expert:** "The **Default Workspace Model** comes from the **Model Catalog**, and it must be a model that is not disabled."
>
> **Dev:** "Should the user see the initial model when creating a **Workspace**, even if they cannot change it there?"
> **Domain expert:** "Yes — the create flow should show the **Default Workspace Model** that will be used."
>
> **Dev:** "How should the main **Workspace** list be ordered?"
> **Domain expert:** "By creation order by default, with user-controlled manual reordering."
>
> **Dev:** "Does manual **Workspace** reordering only last for the current view?"
> **Domain expert:** "No — manual **Workspace** ordering is persisted."
>
> **Dev:** "How should a **Workspace**'s **Conversation** list be ordered?"
> **Domain expert:** "By most recent activity, so the most recently active conversations stay on top."
>
> **Dev:** "Can a **Conversation** be removed even though a **Workspace** cannot?"
> **Domain expert:** "Yes — **Conversations** may be deleted, while **Workspaces** are only archived."
>
> **Dev:** "Should deleting a **Conversation** happen immediately with one click?"
> **Domain expert:** "No — deleting a **Conversation** requires a **Delete Confirmation**."
>
> **Dev:** "After the user confirms deletion, can the **Conversation** be restored later?"
> **Domain expert:** "No — deleting a **Conversation** is permanent."
>
> **Dev:** "What if the user deletes a **Conversation** while it still has an **Active Stream**?"
> **Domain expert:** "Stop the **Active Stream** first, then remove the **Conversation**."
>
> **Dev:** "When does a new **Conversation** show up in the **Workspace** list if its first reply is still streaming?"
> **Domain expert:** "As soon as the **Conversation** is created, without waiting for the **Active Stream** to finish."
>
> **Dev:** "Can the user switch to another **Workspace** or **Conversation** while an **Active Stream** is still running?"
> **Domain expert:** "Yes — the **Active Stream** may continue in the background for its own **Conversation**."
>
> **Dev:** "How does the user know a background **Conversation** is still generating?"
> **Domain expert:** "Its **Conversation** list item shows that an **Active Stream** is in progress."
>
> **Dev:** "Can the user stop a background **Active Stream** directly from the **Conversation** list?"
> **Domain expert:** "No — the list only shows status, and stopping requires opening that **Conversation**."
>
> **Dev:** "If a background **Active Stream** finishes while the user is viewing somewhere else, do we show an extra completion notice?"
> **Domain expert:** "No — the UI does not show an additional completion notice for background generation."
>
> **Dev:** "Does **Workspace Settings** already include document-library retrieval settings?"
> **Domain expert:** "Yes — **Knowledge Base Settings** may appear as a tab inside **Workspace Settings**, while remaining a distinct configuration concept from chat settings."
>
> **Dev:** "Do users upload and manage files inside the same settings tab where they edit knowledge-base parameters?"
> **Domain expert:** "No — users edit **Knowledge Base Settings** in the **Knowledge Base Tab**, while file operations and job status live in separate **Knowledge Base Management**."
>
> **Dev:** "Do knowledge-base settings save immediately when the user edits them in the tab?"
> **Domain expert:** "No — **Knowledge Base Settings** follow the same **Pending Settings**, save, and discard behavior as other **Workspace Settings**."
>
> **Dev:** "Does knowledge-base management only show filenames and timestamps, or can it show ingestion detail too?"
> **Domain expert:** "It may also show the **Chunk Count** of the currently retrievable revision of each **Knowledge Document**."
>
> **Dev:** "Once a job finishes, do we lose its status from the management screen?"
> **Domain expert:** "No — **Knowledge Base Management** may show paginated **Knowledge Base Job History** instead of only the current jobs."
>
> **Dev:** "Does each **Workspace** keep its own imported documents separately?"
> **Domain expert:** "Yes — each **Workspace** owns its own **Knowledge Base** and the **Knowledge Base Settings** that govern it."
>
> **Dev:** "Can one **Workspace** contain multiple **Knowledge Bases** with separate settings?"
> **Domain expert:** "No — in v1, each **Workspace** owns exactly one **Knowledge Base**, and users manage multiple documents inside it."
>
> **Dev:** "If the user changes chunking settings, do old indexed documents immediately match the new settings?"
> **Domain expert:** "No — the **Knowledge Base** becomes **Rebuild Required** until the user runs a **Knowledge Base Rebuild**."
>
> **Dev:** "Does document import finish inside the same save or upload request?"
> **Domain expert:** "No — document import and rebuild run as a **Knowledge Base Job** so the user can track progress asynchronously."
>
> **Dev:** "While a rebuild is running, does retrieval read the half-finished new index?"
> **Domain expert:** "No — retrieval keeps using the active **Knowledge Base Version** until the rebuilt version is ready to replace it."
>
> **Dev:** "If the user uploads five files together, is that five separate jobs?"
> **Domain expert:** "No — one upload creates one **Knowledge Base Job**, and each file is tracked as its own **Document Import Item** inside that job."
>
> **Dev:** "If a file import is unsupported or fails, does it still become a knowledge document in the workspace list?"
> **Domain expert:** "No — only a successful import creates or updates a **Knowledge Document**; unsupported or failed files remain visible through job results instead."
>
> **Dev:** "If a user uploads the same content again under a different filename, do we create a second knowledge document?"
> **Domain expert:** "No — a duplicate **Content Hash** in the same **Workspace** does not create a new **Knowledge Document**."
>
> **Dev:** "If one file in the batch finishes early, does the user wait for the whole batch before it can be retrieved?"
> **Domain expert:** "No — each successful **Document Import Item** becomes searchable in the active **Knowledge Base Version** as soon as its import finishes."
>
> **Dev:** "If one file is unsupported, another is unchanged, and another replaces an older document, does the whole batch collapse into one status?"
> **Domain expert:** "No — each **Document Import Item** ends with its own **Document Import Outcome** such as imported, replaced, unchanged, unsupported, or failed."
>
> **Dev:** "If the user deletes one imported file, does it stay retrievable until the next rebuild?"
> **Domain expert:** "No — deleting a **Knowledge Document** removes it from retrieval immediately instead of waiting for a rebuild."
>
> **Dev:** "Is a knowledge document identified only by its filename?"
> **Domain expert:** "No — a **Knowledge Document** has its own **Knowledge Document Identity**, while filename is only display metadata and **Content Hash** tells us whether the content changed."
>
> **Dev:** "If a file with changed content replaces an existing knowledge document, do we lose the old content entirely?"
> **Domain expert:** "No — the **Knowledge Document** keeps a stable identity while changed content becomes a new **Knowledge Document Revision**."
>
> **Dev:** "If a new document revision fails to import, do we lose the old retrievable revision?"
> **Domain expert:** "No — a failed **Knowledge Document Revision** does not replace the currently retrievable revision."
>
> **Dev:** "During a knowledge-base rebuild, do we reindex every historical file revision?"
> **Domain expert:** "No — a **Knowledge Base Rebuild** uses only the currently retrievable revision of each non-deleted **Knowledge Document**."
>
> **Dev:** "Do all knowledge-base settings require a rebuild when they change?"
> **Domain expert:** "No — changing an **Ingestion Setting** requires rebuild, while a **Retrieval Setting** applies at answer time without rebuild."
>
> **Dev:** "If the knowledge base is marked **Rebuild Required**, do we disable knowledge answering until rebuild finishes?"
> **Domain expert:** "No — the **Knowledge Base** may continue serving **Knowledge Answering** from its active **Knowledge Base Version** until rebuild completes, and the UI should make that state visible."
>
> **Dev:** "After saving ingestion-setting changes, do we quietly leave the user to discover rebuild later on their own?"
> **Domain expert:** "No — saving those changes may show a **Rebuild Prompt** so the user can start rebuild now or defer it."
>
> **Dev:** "Can we rebuild a knowledge base without keeping the originally uploaded files?"
> **Domain expert:** "No — each **Knowledge Document Revision** keeps its **Native File** so the system can reprocess it later."
>
> **Dev:** "Do we chunk directly from every native file format separately?"
> **Domain expert:** "No — a **Knowledge Document Revision** may first produce **Normalized Markdown**, which becomes the canonical input for chunking."
>
> **Dev:** "When a user deletes a knowledge document, do we immediately destroy every stored revision file?"
> **Domain expert:** "No — deletion removes it from retrieval immediately, but it may remain as a **Deleted Knowledge Document** until cleanup permanently purges it."
>
> **Dev:** "Does a workspace knowledge base force every turn to use retrieval?"
> **Domain expert:** "No — each **Workspace** has a **Knowledge Answering Default**, and in v1 that default is enabled, but each **Turn** may still override it."
>
> **Dev:** "If knowledge answering is enabled for a turn but the workspace knowledge base is unavailable, do we block chat?"
> **Domain expert:** "No — that **Turn** falls back to plain chat and the UI should explain that knowledge answering was unavailable."
>
> **Dev:** "If the user turns knowledge answering off once, does that change stick for the rest of the conversation?"
> **Domain expert:** "No — overriding **Knowledge Answering Default** affects only that one **Turn**."
>
> **Dev:** "When knowledge answering is enabled, do we search only with the latest user prompt?"
> **Domain expert:** "No — a **Retrieval Query** is derived from the current user prompt plus relevant recent conversation context, not from the entire conversation history."
>
> **Dev:** "Can the user limit one chat turn to only a few selected knowledge documents?"
> **Domain expert:** "No — in v1, a turn with **Knowledge Answering** searches the active **Knowledge Base Version** of its **Workspace** rather than a user-selected subset of documents."
>
> **Dev:** "If retrieval returns weak or irrelevant matches, do we still force them into the answer prompt?"
> **Domain expert:** "No — that **Turn** may fall back to plain chat when its **Retrieval Query** does not return sufficiently relevant content."
>
> **Dev:** "If knowledge answering finds some evidence but not enough to fully support the answer, should the assistant still sound fully certain?"
> **Domain expert:** "No — an **Assistant Reply** produced with **Knowledge Answering** uses retrieved content as its primary evidence and should acknowledge when that evidence is insufficient."
>
> **Dev:** "After a turn uses knowledge answering, do we keep a record of which chunks were actually retrieved?"
> **Domain expert:** "Yes — that **Turn** stores a **Retrieval Trace** tied to the **Knowledge Base Version** used at answer time."
>
> **Dev:** "If knowledge answering supports a reply, do users get to see where the answer came from?"
> **Domain expert:** "Yes — the **Assistant Reply** may show **Source Citations** derived from the **Retrieval Trace**."
>
> **Dev:** "If we do not copy all chunk text into the app database, can old citations still remain readable later?"
> **Domain expert:** "Yes — the **Retrieval Trace** may store **Citation Snapshots** so **Source Citations** remain readable even if the underlying index changes."
>
> **Dev:** "Can a source citation point to where in the document the supporting text came from?"
> **Domain expert:** "Yes — a **Source Citation** may include a **Page or Slide Locator** when that location is available from ingestion."
>
> **Dev:** "Do we require the model to place citation markers inside the reply text itself?"
> **Domain expert:** "No — in v1, the reply stays natural and any **Source Citations** appear in a separate **Sources Section**."
>
> **Dev:** "If a rebuild is already running, do we still allow another rebuild to start?"
> **Domain expert:** "No — a running **Knowledge Base Rebuild** blocks another rebuild from starting."
>
> **Dev:** "What if the user uploads files while another knowledge-base job is already active?"
> **Domain expert:** "Document import requests may become **Queued Knowledge Base Jobs**, and the UI should show their status."
>
> **Dev:** "Can a rebuild start while document imports for the same workspace are still running or queued?"
> **Domain expert:** "No — a **Knowledge Base Rebuild** waits until document import jobs for that **Workspace** are no longer running or queued."
>
> **Dev:** "Can the user cancel any knowledge-base job from the UI?"
> **Domain expert:** "No — in v1, only a queued document-import job may become a **Canceled Knowledge Base Job**; running jobs and rebuilds are not canceled."
>
> **Dev:** "If changing the **Selected Model** hides some unsaved model-specific fields, do those pending values stay around?"
> **Domain expert:** "No — once the user switches models, pending values for fields that no longer apply are discarded."
>
> **Dev:** "After saving a different **Selected Model**, do old persisted model-specific values remain in storage?"
> **Domain expert:** "No — saved values that no longer apply to the current model are removed."
>
> **Dev:** "Do all models expose the same fields in **Workspace Settings**?"
> **Domain expert:** "No — some fields are **Model-specific Settings** and only appear when the selected model supports them."
>
> **Dev:** "What decides which settings the UI should show?"
> **Domain expert:** "The **Selected Model** decides which **Model-specific Settings** are available to edit."
>
> **Dev:** "Can a new **Workspace** be created before the user visits **Workspace Settings**?"
> **Domain expert:** "Yes — a new **Workspace** starts with default **Workspace Settings** so the user can begin immediately."
>
> **Dev:** "Does **Conversation Title** generation use the **Selected Model** from **Workspace Settings**?"
> **Domain expert:** "No — **Conversation Title** generation is separate from **Workspace Settings**."
>
> **Dev:** "Where do the selectable models and their supported settings come from?"
> **Domain expert:** "From the backend **Model Catalog**, not from a frontend constant list."
>
> **Dev:** "Can users edit the **Model Catalog** from the product UI?"
> **Domain expert:** "No — the **Model Catalog** is internal system data for now."
>
> **Dev:** "What if a **Workspace** already uses a model that later becomes unavailable for new selection?"
> **Domain expert:** "That model becomes a **Disabled Model**: existing workspaces can still reference it, but users must pick another model before using it again for new generation."
>
> **Dev:** "If a **Workspace** uses a **Disabled Model**, can the user still open old **Conversations** there?"
> **Domain expert:** "Yes — existing history remains readable, but new generation is blocked until the **Selected Model** is changed."
>
> **Dev:** "How does a user get back to an archived workspace?"
> **Domain expert:** "Through an archived workspace list where each **Archived Workspace** can be restored."
>
> **Dev:** "Can an **Archived Workspace** still be opened for chat or settings without being restored first?"
> **Domain expert:** "No — it must be restored before the user can use it again."
>
> **Dev:** "What happens when the user selects a **Workspace** from the list?"
> **Domain expert:** "The UI shows that **Workspace**'s **Conversation** list, and selecting one loads its stored history."
>
> **Dev:** "When the user clicks new chat in a **Workspace**, do we create an empty **Conversation** immediately?"
> **Domain expert:** "No — the **Conversation** is only created when the first **User Prompt** is sent."
>
> **Dev:** "When the user sends their first **User Prompt**, do we create the **Conversation Title** immediately?"
> **Domain expert:** "No — we create a **Temporary Title** first, then replace it with the final **Conversation Title** once title generation completes."
>
> **Dev:** "If the user presses stop halfway through, is that still the same **Turn**?"
> **Domain expert:** "Yes — it becomes a **Stopped Turn**, and its **Assistant Reply** may be partial."

## Flagged ambiguities

- "workspace" was missing even though conversations now need a parent container — resolved: use **Workspace** for the top-level container and **Conversation** for one chat inside it.
- "chat settings" could have been attached either to a **Workspace** or a **Conversation** — resolved: use **Workspace Settings** for the configuration source, and keep **Conversation** as context only.
- "changing model settings" could have been interpreted as affecting only future conversations or also the next turn in an existing conversation — resolved: each new **Turn** uses the current **Workspace Settings** at send time.
- "non-deletable workspace" could have implied the name was also permanent — resolved: a **Workspace** may be renamed even though it cannot be deleted.
- "workspace naming rules" could have drifted between create and rename — resolved: **Workspace Name** uses the same validation rules in both cases.
- "creating a workspace" could have implied that the first **Conversation** must be created immediately — resolved: a **Workspace** may exist with zero **Conversations**.
- "edit" in the workspace list could have implied renaming the **Workspace** — resolved: that control starts a new **Conversation**, while changing the **Workspace** itself happens elsewhere.
- "where workspace rename happens" was unclear once the list-level edit control was repurposed — resolved: renaming the **Workspace** happens inside **Workspace Settings**.
- "what belongs in workspace settings" was unclear — resolved: the General **Settings Tab** contains **Workspace Name** and **System Message**, while model controls live elsewhere.
- "when system message changes take effect" was unclear — resolved: each new **Turn** uses the current **System Message** at send time.
- "saving settings during generation" was unclear — resolved: an **Active Stream** keeps the settings it started with until that turn ends.
- "what happens after saving settings" was unclear — resolved: saving keeps the user in **Workspace Settings**.
- "temperature" could have been treated as a universal field — resolved: **temperature** is a **Model-specific Setting** shown only for supported models.
- "default model parameter values" was unclear — resolved: the **Model Catalog** provides default values for supported **Model-specific Settings**.
- "default model for new workspaces" was unclear — resolved: the **Default Workspace Model** is chosen from the **Model Catalog** and cannot be disabled.
- "workspace creation could have hidden the initial model choice" was unclear — resolved: the create flow shows the **Default Workspace Model**.
- "workspace ordering" was unclear — resolved: the main **Workspace** list defaults to creation order and supports manual reordering.
- "manual workspace ordering" was unclear — resolved: user-defined **Workspace** order is persisted.
- "conversation ordering within a workspace" was unclear — resolved: a **Workspace**'s **Conversation** list is ordered by most recent activity.
- "non-deletable workspace" could have implied all chat data is non-deletable — resolved: **Conversations** may be deleted even though **Workspaces** cannot.
- "conversation deletion" was unclear — resolved: deleting a **Conversation** requires a **Delete Confirmation**.
- "conversation deletion" could have implied recoverability — resolved: deleting a **Conversation** is permanent.
- "deleting a streaming conversation" was unclear — resolved: an **Active Stream** is stopped before the **Conversation** is removed.
- "when a new conversation becomes visible" was unclear — resolved: a new **Conversation** appears in its **Workspace** list as soon as creation succeeds, even before streaming finishes.
- "streaming while navigating elsewhere" was unclear — resolved: an **Active Stream** may continue in the background while the user views another **Workspace** or **Conversation**.
- "background streaming visibility" was unclear — resolved: a **Conversation** with an **Active Stream** is visibly marked in the **Conversation** list.
- "background streaming controls" was unclear — resolved: the **Conversation** list shows background stream status but does not provide stop controls.
- "background stream completion feedback" was unclear — resolved: the UI does not show an extra completion notice for background generation.
- "workspace settings scope" was unclear — resolved: **Workspace Settings** include chat settings and may also contain a tab for **Knowledge Base Settings**.
- "workspace settings" could have implied knowledge-base configuration must live on a separate screen — resolved: **Knowledge Base Settings** remain a distinct configuration concept but may be edited inside **Workspace Settings**.
- "knowledge-base UX" could have implied settings and file operations must share one crowded screen — resolved: **Knowledge Base Settings** live in the **Knowledge Base Tab**, while uploads and job status live in separate **Knowledge Base Management**.
- "knowledge-base tab" could have implied its fields save live even though other workspace settings do not — resolved: **Knowledge Base Settings** use the same **Pending Settings**, save, and discard behavior as other **Workspace Settings**.
- "knowledge-base management" could have implied users cannot inspect ingestion output quality — resolved: **Knowledge Base Management** may show each document's **Chunk Count**.
- "failed imports" could have implied unsupported or failed files become normal knowledge documents — resolved: only successful imports create or update **Knowledge Documents**; other outcomes remain in job history.
- "duplicate uploads" could have implied the same content becomes multiple knowledge documents when filenames differ — resolved: a duplicate **Content Hash** in the same **Workspace** does not create a new **Knowledge Document**.
- "knowledge-base jobs" could have implied finished work disappears once no longer running — resolved: **Knowledge Base Management** may show paginated **Knowledge Base Job History**.
- "knowledge base" could have implied multiple independently configured libraries per workspace — resolved: in v1, each **Workspace** owns exactly one **Knowledge Base** that contains multiple documents.
- "changing chunk settings" could have implied existing indexed content updates immediately or only affects future files — resolved: the **Knowledge Base** becomes **Rebuild Required** until the user runs a **Knowledge Base Rebuild**.
- "document import" could have implied upload and indexing complete inside a single request — resolved: document import and rebuild execute as asynchronous **Knowledge Base Jobs**.
- "rebuild in progress" could have implied retrieval reads incomplete indexed data — resolved: retrieval keeps using the active **Knowledge Base Version** until the rebuilt version is ready.
- "multi-file upload" could have implied one backend job per file — resolved: one upload creates one **Knowledge Base Job** containing multiple **Document Import Items**.
- "multi-file upload visibility" could have implied successful files wait for the whole batch before retrieval — resolved: each successful **Document Import Item** becomes searchable as soon as it finishes importing.
- "batch upload result" could have implied only one all-or-nothing status per upload — resolved: each **Document Import Item** ends with its own **Document Import Outcome**.
- "document deletion" could have implied removed files stay retrievable until the next rebuild — resolved: deleting a **Knowledge Document** removes it from retrieval immediately.
- "knowledge document identity" could have implied filename is the system identity — resolved: a **Knowledge Document** has its own stable **Knowledge Document Identity**, and **Content Hash** detects content changes.
- "replacing a file" could have implied an invisible overwrite with no history — resolved: changed content creates a new **Knowledge Document Revision** under the same **Knowledge Document**.
- "failed replacement" could have implied a broken update makes the document unavailable — resolved: a failed **Knowledge Document Revision** does not replace the currently retrievable revision.
- "rebuild scope" could have implied deleted documents or historical revisions return to the searchable index — resolved: a **Knowledge Base Rebuild** uses only the currently retrievable revision of each non-deleted **Knowledge Document**.
- "knowledge-base settings" could have implied every setting change requires rebuild — resolved: only **Ingestion Settings** trigger **Rebuild Required**; **Retrieval Settings** do not.
- "rebuild required" could have implied knowledge answering must stop immediately after an ingestion-setting change — resolved: the active **Knowledge Base Version** may continue serving until rebuild completes, with a visible UI warning.
- "rebuild required" could have implied saving ingestion-setting changes either auto-starts rebuild or provides no next-step guidance — resolved: saving may show a **Rebuild Prompt** so the user can start now or defer.
- "document import pipeline" could have implied the original upload may be discarded after indexing — resolved: each **Knowledge Document Revision** keeps its **Native File** for future rebuilds.
- "document chunking input" could have implied every native file format is chunked directly — resolved: a **Knowledge Document Revision** may first be converted into **Normalized Markdown** for ingestion.
- "deleting a knowledge document" could have implied immediate physical purge of all stored files — resolved: deletion removes retrieval access immediately, but the record may remain as a **Deleted Knowledge Document** until cleanup.
- "workspace knowledge base" could have implied retrieval is mandatory on every turn — resolved: each **Workspace** has a **Knowledge Answering Default** and each **Turn** may override it.
- "knowledge answering enabled" could have implied chat must fail when the knowledge base is unavailable — resolved: the **Turn** falls back to plain chat with a user-visible explanation.
- "knowledge answering toggle" could have implied the user changes conversation-wide or workspace-wide state when overriding it once — resolved: overriding **Knowledge Answering Default** affects only that **Turn**.
- "knowledge answering" could have implied retrieval evidence is disposable after reply generation — resolved: a **Turn** may store a **Retrieval Trace** tied to the exact **Knowledge Base Version** used.
- "retrieval query" could have implied we either search only the latest prompt or dump the whole conversation into retrieval — resolved: a **Retrieval Query** is derived from the current prompt plus relevant recent context.
- "knowledge answering enabled" could have implied weak retrieval results must still be injected into the answer prompt — resolved: a **Turn** may fall back to plain chat when retrieval quality is insufficient.
- "knowledge answering scope" could have implied the user may narrow a turn to a hand-picked subset of documents — resolved: in v1, a turn searches the active **Knowledge Base Version** of its **Workspace**.
- "knowledge answering reply style" could have implied the assistant should fill gaps confidently even when evidence is thin — resolved: retrieved knowledge-base content is the primary evidence, and insufficient support should be acknowledged.
- "knowledge answering evidence" could have implied provenance is backend-only — resolved: an **Assistant Reply** may show user-visible **Source Citations** derived from the **Retrieval Trace**.
- "source citations" could have implied they must always be rebuilt from the live index — resolved: the **Retrieval Trace** may keep **Citation Snapshots** so historical citations remain readable.
- "source citations" could have implied location inside a document is unavailable or unimportant — resolved: a **Source Citation** may include a **Page or Slide Locator** when ingestion can preserve it.
- "source citations" could have implied the model must embed citation markers inline in the reply text — resolved: in v1, citations render in a separate **Sources Section**.
- "job concurrency" could have implied every mutating request either runs immediately or must be rejected — resolved: rebuilds do not run concurrently, while document imports may wait as visible **Queued Knowledge Base Jobs**.
- "rebuild scheduling" could have implied rebuild may join the same queue as ordinary imports — resolved: a **Knowledge Base Rebuild** does not start while import jobs for that **Workspace** are running or queued.
- "job cancellation" could have implied any visible job may be aborted at any time — resolved: in v1, only queued document-import jobs may become **Canceled Knowledge Base Jobs**.
- "custom system message" could have meant supplementing a built-in prompt — resolved: the **System Message** fully replaces the built-in chat system prompt.
- "default system message" could have implied a hidden or locked rule — resolved: it is only initial content and may be fully replaced.
- "editable system message" could have implied it may be cleared entirely — resolved: the **System Message** cannot be blank.
- "editing settings" could have implied every field saves live — resolved: edits remain **Pending Settings** until the user saves.
- "leaving settings with unsaved edits" was unclear — resolved: leaving with **Pending Settings** triggers a **Discard Warning**.
- "hidden model-specific fields during editing" was unclear — resolved: switching the **Selected Model** discards pending values for fields that no longer apply.
- "old model-specific values in storage" was unclear — resolved: saving a new **Selected Model** removes persisted values that no longer apply.
- "model settings" could have implied every model exposes the same fields — resolved: some values are **Model-specific Settings** that only apply to supported models.
- "which settings should be shown" was unclear when models differ — resolved: the **Selected Model** determines which **Model-specific Settings** are editable.
- "creating a workspace" could have implied settings must be configured first — resolved: a new **Workspace** starts with default **Workspace Settings**.
- "model choice" could have implied **Conversation Title** generation follows the workspace model — resolved: **Conversation Title** generation is separate from **Workspace Settings**.
- "where selectable models come from" was unclear — resolved: the backend **Model Catalog** defines the available models and supported settings.
- "making the model catalog a table" could have implied user-facing model administration — resolved: the **Model Catalog** is internal system data for now.
- "removing a model" could have implied existing workspaces are silently switched — resolved: a **Disabled Model** remains referenced until the user chooses a different model.
- "disabled model" could have implied the whole workspace becomes inaccessible — resolved: a **Disabled Model** only blocks new generation, not history browsing.
- "non-deletable workspace" could have implied users cannot tidy the list at all — resolved: a **Workspace** may be archived and later restored.
- "archived workspace" could have implied it remains directly usable — resolved: an **Archived Workspace** must be restored before it can be used again.
- "conversation history scope" was unclear — resolved: selecting a **Workspace** filters to that **Workspace**'s **Conversation** list, and selecting a **Conversation** loads its stored **Turns**.
- "starting a new conversation" could have implied an empty conversation record is created immediately — resolved: the first **User Prompt** creates the **Conversation**.
- "message" was being used to mean both a single utterance and a stored user/assistant pair — resolved: use **Turn** for the stored pair, **User Prompt** for the user's text, and **Assistant Reply** for the assistant's text.
- "title" was being used to mean both the immediate placeholder and the generated final name — resolved: use **Temporary Title** and **Conversation Title** as distinct terms.
