# 文件匯入流程與文件治理規則

Status: ready-for-agent
Type: AFK

## What to build

把工作區知識庫的真實文件匯入路徑打通，讓使用者上傳的支援格式文件可以經過 `Native File -> Normalized Markdown -> chunking -> embedding -> Qdrant` 進入該 workspace 的 active knowledge base，並同時落實文件去重、revision replace、刪除語意、per-file outcome、chunk count 與來源定位 metadata。這條 v1 匯入路徑應明確以 **Microsoft MarkItDown + LlamaIndex + fastembed + Qdrant** 組成，其中 MarkItDown 負責 normalized markdown，LlamaIndex 負責 ingestion pipeline 與 retrieval integration，fastembed 負責 embedding generation。

這個 slice 要把知識庫管理從「只有 job 狀態」升級成「有真實文件內容可檢索」，並落實以下規則：

- 使用 Microsoft MarkItDown 將支援格式正規化
- 使用 LlamaIndex ingestion pipeline 串接 chunking、fastembed 與 Qdrant 寫入
- 成功匯入的文件才成為正式 `Knowledge Document`
- 同內容以 `content_hash` 去重，不建立重複文件
- 同一份文件更新時建立新 revision，而不是新文件
- 新 revision 失敗不影響原本可檢索 revision
- 刪除文件後會立刻從檢索中消失，但保留後續清理所需的狀態

## Acceptance criteria

- [ ] 支援格式文件可以透過 `MarkItDown + LlamaIndex + fastembed + Qdrant` 完成正規化、chunking、embedding 與 Qdrant 寫入，並在同一個 workspace 內可被搜尋到。
- [ ] `Knowledge Base Management` 文件列表只顯示成功匯入的正式文件，並顯示 metadata、`Chunk Count` 與可用的 page/slide locator 資訊。
- [ ] 同 `content_hash` 的重複內容不會建立新的正式文件；同文件更新會建立新 revision，且失敗的新 revision 不會取代現有可檢索 revision。
- [ ] 每個 file-level item 都能明確標示 imported、replaced、unchanged、unsupported、failed 或 canceled 結果。
- [ ] 刪除正式文件後，該文件會立刻從檢索結果中消失，且後端保留必要的 deleted/cleanup 狀態。
- [ ] 這個 slice 具備對應的 worker 處理、資料模型、API、管理 UI 與測試，且 LlamaIndex 與 Qdrant / fastembed / MarkItDown 的整合被收斂在 application-level ingestion boundary 後面。

## Blocked by

- [.scratch/workspace-knowledge-base/issues/02-async-import-jobs-and-management-status.md](</D:/mygithub/demo_mini_rag/.scratch/workspace-knowledge-base/issues/02-async-import-jobs-and-management-status.md>)
