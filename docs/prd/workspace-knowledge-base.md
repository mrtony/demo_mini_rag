## 問題陳述

目前系統已經具備以 **Workspace** 為中心的聊天體驗、工作區級聊天設定與串流回覆能力，但仍缺乏可讓使用者把文件匯入到工作區、管理知識庫內容、並在聊天中使用工作區知識回答問題的完整能力。使用者目前無法在同一個 **Workspace** 中管理自己的文件、檢查匯入結果、追蹤背景處理狀態、查看回答來源，也無法在調整知識庫設定後以可理解的方式重建索引。這使得產品無法支援真正可用的工作區知識問答場景，也讓未來要擴充成 Agent / Tool 能力時缺乏清楚的知識存取邊界。

## 解決方案

為每個 **Workspace** 新增一個工作區級 **Knowledge Base**，讓使用者可以在 `Workspace Settings` 內的 `Knowledge Base` tab 編輯 **Knowledge Base Settings**，並在獨立的 **Knowledge Base Management** 畫面中管理文件、拖放上傳、檢視匯入結果與 job 歷史。文件匯入流程將以 `Native File -> Normalized Markdown -> chunking -> embedding -> Qdrant` 運作，並以非同步 **Knowledge Base Job** 執行；聊天側則新增可預設開啟、但可對單一 **Turn** 暫時覆寫的 **Knowledge Answering**，在成功命中時以知識庫內容作為主要證據，並在回答下方顯示 `Sources Section` 與 `Source Citations`。若知識庫不可用或檢索結果不足，該 **Turn** 可退回一般聊天。系統同時支援版本化 rebuild、per-document revision、內容 hash 去重、Qdrant 每工作區獨立 collection，以及可供未來 Agent / Tool 共用的知識檢索 capability。

## 使用者故事

1. 作為工作區使用者，我希望每個 **Workspace** 都擁有自己的 **Knowledge Base**，以便我的文件與檢索行為能和其他工作區隔離。
2. 作為工作區使用者，我希望能在 `Workspace Settings` 中開啟 `Knowledge Base` 分頁，以便在既有設定流程內調整匯入與檢索行為。
3. 作為工作區使用者，我希望 `Knowledge Base Settings` 與其他 `Workspace Settings` 一樣遵守 pending、save、discard 的互動方式，以便設定調整的行為一致且可預期。
4. 作為工作區使用者，我希望可以調整 `chunk size` 與 `chunk overlap`，以便控制系統如何為檢索切分文件。
5. 作為工作區使用者，我希望可以調整 `top_k` 與 `similarity threshold` 等檢索限制，以便控制單次回答會使用多少知識內容。
6. 作為工作區使用者，我希望匯入設定變更後會把知識庫標記為需要重建，而不是悄悄重新建立索引，以便知道目前 active index 是否已過期。
7. 作為工作區使用者，我希望在儲存匯入設定後看到清楚的提示，以便決定現在就啟動 rebuild 還是稍後再做。
8. 作為工作區使用者，我希望在 rebuild 尚未執行前，現有的 active knowledge base 仍然可用，以便不會因為剛改設定就立刻失去知識問答能力。
9. 作為工作區使用者，我希望有獨立的 **Knowledge Base Management** 畫面，以便把檔案管理與 job 狀態追蹤和設定調整分開。
10. 作為工作區使用者，我希望能拖放多個檔案到工作區中，以便快速建立知識庫內容。
11. 作為工作區使用者，我希望除了拖放之外也能使用檔案選擇器，以便依照自己熟悉的方式上傳文件。
12. 作為工作區使用者，我希望一次上傳動作會建立一個批次 job，並帶有 per-file 結果，以便把一次匯入理解成一個完整操作。
13. 作為工作區使用者，我希望每個匯入檔案都能顯示 imported、replaced、unchanged、unsupported、failed 或 canceled 等結果，以便了解批次中每個檔案的處理狀態。
14. 作為工作區使用者，我希望成功的檔案在匯入完成後就能立刻被搜尋到，以便大型批次上傳時可以先享受部分成果。
15. 作為工作區使用者，我希望 unsupported 或 failed 的檔案會保留在 job 結果裡，但不會污染正式文件清單，以便知識庫列表只呈現真正被索引的文件。
16. 作為工作區使用者，我希望匯入檔案能保留檔名、MIME type、page 或 slide locator 等有用 metadata，以便我能信任 citation 並在需要時追查來源。
17. 作為工作區使用者，我希望系統能顯示每份文件目前可檢索 revision 的 `Chunk Count`，以便檢查匯入結果是否合理。
18. 作為工作區使用者，我希望系統能透過檔案內容 hash 偵測重複內容，以便重複上傳相同內容時不會產生噪音文件。
19. 作為工作區使用者，我希望同名但內容改變的檔案會建立成同一份知識文件的新 revision，以便更新內容時保留文件身份而不是變成另一份文件。
20. 作為工作區使用者，我希望不同檔名但內容完全相同的檔案會被視為重複內容，而不是新文件，以便工作區知識庫保持乾淨。
21. 作為工作區使用者，我希望替換文件的新 revision 若匯入失敗，不會影響目前可檢索 revision，以便錯誤更新不會破壞原本可用的文件。
22. 作為工作區使用者，我希望刪除知識文件後它會立刻從檢索中消失，以便已刪除的文件不會再被聊天引用。
23. 作為工作區使用者，我希望已刪除文件在最終 purge 前仍可暫時追蹤，以便系統保留必要的稽核與清理能力。
24. 作為工作區使用者，我希望 rebuild 只會使用每份未刪除文件目前可檢索的 revision，以便歷史內容不會重新回到 active knowledge base。
25. 作為工作區使用者，我希望背景 import job 與 rebuild job 的狀態都能在 UI 中看見，以便隨時知道系統正在做什麼。
26. 作為工作區使用者，我希望當同一個工作區已有 import job 在進行時，新的 import 會進入 queue，以便我的請求不會被丟棄。
27. 作為工作區使用者，我希望 rebuild 會等到 import jobs 都不在 queued 或 running 狀態後才開始，以便 rebuild 只針對穩定的輸入集合執行。
28. 作為工作區使用者，我希望可以取消 queued import jobs，以便撤回尚未開始的工作。
29. 作為工作區使用者，我不希望 v1 中的 running import 或 rebuild 在中途被取消，以便 job 行為保持穩定與可預期。
30. 作為工作區使用者，我希望 job 完成後歷史仍然保留可見，以便回頭檢查過去的 import 與 rebuild 發生了什麼事。
31. 作為工作區使用者，我希望 job history 支援分頁，以便長期使用的工作區仍然容易管理。
32. 作為工作區使用者，我希望目前文件 revisions 的 native uploaded files 會被保留下來，以便日後 rebuild 時不必重新上傳全部檔案。
33. 作為工作區使用者，我希望 PDF、DOCX、PPTX、TXT 與 Markdown 檔案都會先被正規化再做 chunking，以便不同格式能走一致的匯入路徑。
34. 作為工作區使用者，我希望在可行時保留 Markdown 結構，以便標題、清單與其他邏輯結構能提升檢索與 citation 品質。
35. 作為工作區使用者，我希望 citations 在可用時能帶出頁碼或投影片編號，以便我能追查證據來自哪一頁或哪一張投影片。
36. 作為工作區使用者，我希望每個工作區的 `Knowledge Answering` 預設是開啟的，以便上傳完文件後就能立即受益。
37. 作為工作區使用者，我希望能只對單一 **Turn** 關閉 `Knowledge Answering`，而不改變工作區預設，以便需要時仍能進行一般聊天。
38. 作為工作區使用者，我希望當知識庫不可用時，聊天回合會自動 fallback 成一般聊天，以便不會因知識庫狀態而完全無法使用助手。
39. 作為工作區使用者，我希望當檢索結果品質不足時，聊天回合也能退回一般聊天，以便不相關的知識片段不會污染回答。
40. 作為工作區使用者，我希望檢索查詢會同時考慮目前提示與最近相關對話脈絡，以便追問時仍能抓到正確知識。
41. 作為工作區使用者，我希望 v1 的知識問答會查整個 active workspace knowledge base，而不是臨時手選幾份文件，以便互動保持簡單。
42. 作為工作區使用者，我希望使用知識回答時，系統會把檢索內容視為主要證據，以便助手不會對沒有根據的內容過度延伸。
43. 作為工作區使用者，我希望當檢索到的證據不足時，助手會誠實說明，以便系統更值得信任。
44. 作為工作區使用者，我希望使用知識的回答會在下方顯示 `Sources Section`，以便我能查看支撐回答的文件來源。
45. 作為工作區使用者，我希望 citations 即使在後續 rebuild 或文件更新後仍然可讀，以便歷史對話的可信度不會消失。
46. 作為工作區使用者，我希望串流回答完成時 citations 就能立即出現，以便不需要再多打一次 API 才看得到來源。
47. 作為產品開發者，我希望 knowledge base 被建模成可重用 capability，而不是聊天專用邏輯，以便未來 Agent 與 Tool 流程可以共用同一套檢索能力。
48. 作為後端開發者，我希望 ingestion、retrieval、citations 與 job coordination 之間有清楚的 application-level 邊界，以便未來更換技術實作時不會污染產品邏輯。
49. 作為後端開發者，我希望 knowledge answering orchestration 位於原始 chat streaming adapter 之上，以便現有聊天傳輸層能保持單純且可重用。
50. 作為負責未來擴充的工程師，我希望系統能逐步支援每個工作區不同的 embedding dimension 與 retrieval strategy，以便儲存拓樸不會卡死後續路線圖。

## 實作決策

- 將每個 **Workspace** 建模為只擁有一個 **Knowledge Base**，並把 **Knowledge Base Settings** 保持為獨立的 workspace-owned 設定概念。
- 把 `Knowledge Base Settings` 放在 `Workspace Settings` 內的 `Knowledge Base` 分頁中，但檔案操作與 job 狀態追蹤留在獨立的 **Knowledge Base Management** 介面。
- 明確區分 ingestion settings 與 retrieval settings：前者會觸發 `Rebuild Required`，後者在回答時即時生效，不需 rebuild。
- 保留目前文件 revisions 對應的 native uploaded files，讓後續 rebuild 不必要求使用者重新上傳。
- 透過 Microsoft MarkItDown 先將支援格式正規化後再進行 chunking，讓 PDF、DOCX、PPTX、TXT 與 Markdown 走一致的匯入路徑。
- 在可保留結構的情況下採用 markdown-aware chunking，並保留 page 與 slide locator metadata 供 citations 使用。
- 向量與 chunk text 只存於 Qdrant，不複製到 application database；application database 只保存 document、revision、job、version、retrieval trace 與 citation snapshot metadata。
- 採用每個 workspace 一個 Qdrant collection 的策略，所有 retrieval 都透過該 workspace 的 active knowledge-base version 或 alias 路由。
- rebuild 以新的 **Knowledge Base Version** 建立，並在成功後以原子方式切換 active version。
- rebuild 只會重建每份未刪除文件目前可檢索的 revision。
- 一般成功匯入會增量更新 active version；full rebuild 則建立新 version，待完成後再切換。
- uploads 與 rebuilds 都以非同步 **Knowledge Base Job** 表示，並由獨立於 FastAPI API process 的 worker process 執行。
- v1 先採用 database-backed queue 與 worker process，同時保留未來遷移到 Redis-backed queue/worker model 的空間。
- 同一個 workspace 內允許 import jobs 排隊，但 rebuild 不可在 import jobs 仍處於 running 或 queued 狀態時執行。
- 同一個 workspace 不允許多個 rebuild 並行執行。
- v1 只允許取消 queued import jobs，不允許取消 running jobs 或 rebuild jobs。
- 透過 content hash 偵測重複內容；同一個 workspace 內若 content hash 重複，不建立新的 knowledge document。
- 將同一份文件的更新建模為穩定 knowledge document identity 下的新 revision，而不是另一份全新文件。
- 若替換文件的新 revision 匯入失敗，現有可檢索 revision 必須保持 active。
- 只有成功匯入才會建立或更新正式 knowledge documents；failed 與 unsupported 的檔案只透過 job history 與 per-file outcomes 呈現。
- **Knowledge Answering Default** 在 workspace 層級預設開啟，但允許每個 turn 只覆寫一次。
- retrieval query 由目前 user prompt 加上最近相關對話脈絡組成，而不是直接使用整段 conversation history。
- 當知識庫不可用或檢索品質不足時，knowledge answering 可以 fallback 成一般聊天。
- 使用 workspace knowledge 回答時，必須把檢索內容視為主要證據，並在證據不足時誠實說明，而不是自信補完空白。
- citations 由系統渲染在 assistant reply 下方的 `Sources Section`，而不是要求模型在內文中輸出 inline citation markers。
- 對有使用 knowledge answering 的 turns 持久化 **Retrieval Trace**，其中包含在底層索引後續變更後仍可閱讀的 citation snapshots。
- 在 chat turn 的 final streaming event 中回傳 citations，讓前端在回答完成時能立即渲染來源。
- 保持 chat streaming adapter 單純，並新增較高層的 turn orchestration layer，負責決定是否執行 knowledge retrieval、如何組 prompt，以及如何建立 citations。
- 將 knowledge-base capability 拆成多個 application-level modules，而不是做成單一巨型 service，至少應涵蓋 ingestion、retrieval、citation generation 與 job coordination。

## 建議資料模型

實際的 SQLAlchemy 定義可以隨實作微調，但 schema 應以以下資料結構為核心延伸。

### `workspace_knowledge_base_settings`

- `workspace_fk`
- `chunk_size`
- `chunk_overlap`
- `retrieval_top_k`
- `similarity_threshold`
- `knowledge_answering_default`
- `rebuild_required`
- `created_at`
- `updated_at`

說明：
- 這筆資料保持為 workspace-owned 狀態，不應變成 conversation-owned state。
- 儲存匯入設定變更時，可以設定 `rebuild_required=true`，但現有 active version 仍保持可用。

### `knowledge_documents`

- `id`
- `workspace_fk`
- `knowledge_document_id`
- `display_filename`
- `is_deleted`
- `deleted_at`
- `created_at`
- `updated_at`

說明：
- 正式的 knowledge document 只會在成功匯入後存在。
- 同一個 workspace 內若 `content_hash` 重複，不會建立新的文件。

### `knowledge_document_revisions`

- `id`
- `knowledge_document_fk`
- `revision_number`
- `content_hash`
- `mime_type`
- `native_file_path`
- `normalized_markdown_path` or `normalized_markdown_text`
- `page_or_slide_map_json`
- `chunk_count`
- `status`
- `error_message`
- `created_at`
- `updated_at`

說明：
- 現有文件若有新內容，會建立新的 revision。
- 新 revision 匯入失敗時，不會取代目前可檢索 revision。
- 每個 revision 都保留自己的 native file，供未來 rebuild 使用。

### `knowledge_base_versions`

- `id`
- `workspace_fk`
- `version_number`
- `collection_name`
- `collection_alias`
- `status`
- `built_from_settings_snapshot_json`
- `created_at`
- `activated_at`

說明：
- Full rebuild 會建立新的 version，而不是直接就地改動 active state。
- rebuild 只會包含每份未刪除文件目前可檢索的 revision。

### `knowledge_base_jobs`

- `id`
- `workspace_fk`
- `job_type`
- `status`
- `triggered_by`
- `retry_count`
- `error_message`
- `created_at`
- `started_at`
- `finished_at`

### `knowledge_base_job_items`

- `id`
- `job_fk`
- `original_filename`
- `mime_type`
- `content_hash`
- `outcome`
- `knowledge_document_fk` nullable
- `knowledge_document_revision_fk` nullable
- `error_message`
- `created_at`
- `finished_at`

說明：
- 一次上傳會建立一個 job 與多個 file-level items。
- item 結果應能表示 imported、replaced、unchanged、unsupported、failed 或 canceled。

### `retrieval_traces`

- `id`
- `message_fk` or equivalent turn/message relation
- `workspace_fk`
- `knowledge_base_version_fk`
- `knowledge_answering_enabled`
- `fallback_reason` nullable
- `retrieval_query_text`
- `retrieval_top_k`
- `similarity_threshold`
- `created_at`

### `retrieval_trace_sources`

- `id`
- `retrieval_trace_fk`
- `knowledge_document_fk`
- `knowledge_document_revision_fk`
- `node_id`
- `score`
- `page_number` nullable
- `slide_number` nullable
- `citation_snapshot_text`
- `display_filename`

說明：
- 這些資料能確保 citations 在後續 rebuild 或文件更新後仍然可讀。

## 後端 API 形狀

最終 route 名稱仍可調整，但後端應在保留既有 workspace/chat 架構的前提下，圍繞以下責任進行擴充。

### Workspace Knowledge Base Settings

- `GET /api/workspaces/{workspace_id}/knowledge-base-settings`
- `PUT /api/workspaces/{workspace_id}/knowledge-base-settings`

說明：
- 雖然 UI 入口位於 `Workspace Settings` 裡，但 knowledge-base settings 仍不應與既有 chat settings 的儲存契約混為一談。

### Knowledge Base Management

- `GET /api/workspaces/{workspace_id}/knowledge-documents`
- `POST /api/workspaces/{workspace_id}/knowledge-imports`
- `GET /api/workspaces/{workspace_id}/knowledge-jobs`
- `GET /api/workspaces/{workspace_id}/knowledge-jobs/{job_id}`
- `POST /api/workspaces/{workspace_id}/knowledge-jobs/{job_id}/cancel`
- `POST /api/workspaces/{workspace_id}/knowledge-base/rebuild`
- `DELETE /api/workspaces/{workspace_id}/knowledge-documents/{knowledge_document_id}`

說明：
- v1 的 cancel 只適用於 queued import jobs。
- 若同一個 workspace 仍有 queued 或 running import jobs，rebuild 應被拒絕。

### Chat Streaming

保留既有的 `POST /api/chat/stream` endpoint，但擴充 request 與 final streaming payload，讓它能支援 knowledge answering。

可能的 request 擴充：

```json
{
  "workspace_id": "ws_123",
  "conversation_id": "conv_123_or_0",
  "message": "...",
  "knowledge_answering_enabled": true
}
```

final event 應包含：

- 這個回答是否實際使用了 knowledge answering
- 是否發生 fallback，以及原因
- 這次回答的 source citations

## 前端改版方向

### Workspace Settings

- 在既有聊天設定 tabs 旁新增 `Knowledge Base` 分頁。
- 讓 `Pending Settings`、`Save settings` 與 `Discard Warning` 的行為與其他 workspace settings 保持一致。
- 若儲存後觸發 `Rebuild Required`，顯示清楚的提示，讓使用者選擇現在重建或稍後再做。

### Knowledge Base Management

- 提供和設定分開的文件列表。
- 顯示文件 metadata 與 `Chunk Count`。
- 支援 drag-and-drop 與 file picker 上傳。
- 顯示目前 running 或 queued 的 jobs。
- 顯示可分頁的 job history。
- 顯示 batch jobs 的 per-item outcomes。

### Chat UI

- 在 composer 上新增單次 `Turn` 可覆寫的 `Knowledge Answering` toggle，初始值來自 `Knowledge Answering Default`。
- 當 citations 存在時，在 assistant reply 下方渲染 `Sources Section`。
- 當某個 turn fallback 成一般聊天時，提供可見的說明。
- 當 workspace 處於 `Rebuild Required` 且仍使用舊 active version 服務時，提供可見的提示。

## 建議交付切片

### Slice 1：Knowledge Base persistence 與 worker 基礎設施

- 新增 knowledge-base settings persistence
- 新增 document、revision、version、job 與 retrieval trace models
- 新增 worker process 與 database-backed job queue
- 新增 native file storage

### Slice 2：Import pipeline 與管理 UI

- 整合 MarkItDown normalization
- 加入 chunking、embedding 與 Qdrant upsert
- 加入 batch import jobs 與 per-item outcomes
- 加入基礎的 knowledge-base management UI

### Slice 3：Versioned rebuild 與 rebuild-required 流程

- 加入 full rebuild jobs
- 加入 active version switching
- 加入 rebuild prompt 與 rebuild-required UI state

### Slice 4：Chat orchestration 與 citations

- 加入 turn-level knowledge-answering override
- 加入依最近脈絡組 retrieval query 的能力
- 加入 retrieval fallback 行為
- 加入 retrieval trace persistence
- 加入 SSE final-event citations 與前端 `Sources Section`

## 測試決策

- 好的測試應該驗證對外可見的行為與狀態轉移，而不是私有實作細節或框架內部機制。
- 測試 workspace-level knowledge-base settings 的行為，包括 pending、save、discard、`Rebuild Required` 狀態轉移與 rebuild prompt 這些使用者可感知的結果。
- 測試非同步 job 行為，包括 queueing、completion、failure、queued imports 的 cancellation、rebuild admission rules 與 per-file outcomes。
- 測試 content-hash 與 revision 規則，包括 duplicate uploads、replacements、unchanged imports 與 failed replacement 的安全性。
- 在 orchestration 層測試 retrieval 行為，包括預設開啟的 knowledge answering、per-turn override、recent context 組 query、fallback 成 plain chat 與 citation 建立。
- 測試 SSE final-event 行為，確保回答完成時會一併送出 source citations。
- 測試文件管理行為，例如 delete semantics、立刻從 retrieval 中移除，以及 rebuild 範圍只包含目前可檢索 revisions。
- 測試 `Knowledge Base Management` 的 UI 行為，包括 chunk count 顯示、可分頁 job history、per-file outcomes，以及 assistant reply 下方 sources 的呈現。
- 以前案為基礎，沿用本 repo 既有的 API、SSE、workspace settings 與 React interaction 測試風格，而不是另起一套測試哲學。

## 不在範圍內

- v1 中由使用者自行選擇 embedding model、vector dimension 或 retrieval strategy。
- 在主聊天流程中手動指定只檢索某幾份文件。
- 取消 running import jobs 或 rebuild jobs。
- 採用 shared-collection + workspace filters 的 Qdrant 拓樸。
- 把所有 chunk text 複製一份到 application database。
- 在 assistant reply 內文中產生 inline citation markers。
- v1 導入 LlamaParse 或其他外部文件解析服務。
- v1 正式支援以試算表為中心的匯入情境，例如 XLSX 或 CSV。
- 同一個 workspace 中任意並行執行多個 mutating knowledge-base jobs。

## 補充說明

- 這份 PRD 是建立在既有 workspace-first chat redesign 之上，而不是取代它。
- 實作時應持續對齊 `CONTEXT.md` 中的 glossary vocabulary。
- 實作時應遵守 ADR-0003、ADR-0004 與 ADR-0005，作為 knowledge-base topology、非同步 job 流程與 knowledge-answering orchestration 的架構約束。
- 最值得保護的深模組是 application-level ingestion service、retrieval service、citation service 與 job coordinator，因為這些邊界能保護程式碼免於未來 parser、vector store、worker 與 agent framework 變動的衝擊。
