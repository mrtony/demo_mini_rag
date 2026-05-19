# 版本化重建與 active version 切換

Status: ready-for-agent
Type: AFK

## What to build

為工作區知識庫加入版本化 rebuild 能力，讓使用者在修改 ingestion settings 後可以明確觸發 **Knowledge Base Rebuild**，由系統建立新的 **Knowledge Base Version**，完成後再原子切換 active version，同時保持舊版在 rebuild 期間持續可用。

這個 slice 應落實以下行為：

- `chunk size` 或 `chunk overlap` 變更後產生 `Rebuild Required`
- 使用者可以在 UI 看到 rebuild prompt 並手動啟動 rebuild
- rebuild 只重建目前可檢索的 revisions，不把歷史或 deleted documents 混回 active knowledge base
- rebuild 不可在 import jobs 仍 queued/running 時開始
- rebuild 成功前，聊天與檢索仍使用舊的 active version

## Acceptance criteria

- [ ] 當使用者儲存會影響 ingestion 的設定後，workspace 會維持舊 active version 可用，但明確呈現 `Rebuild Required`。
- [ ] 使用者可以從 UI 明確啟動 rebuild，系統會建立新的 `Knowledge Base Job` 與新的 `Knowledge Base Version`。
- [ ] 若同一個 workspace 仍有 queued 或 running import jobs，rebuild 會被拒絕並向使用者清楚說明原因。
- [ ] rebuild 期間檢索仍使用舊 active version；rebuild 成功後才原子切換到新 version。
- [ ] rebuild 只會包含未刪除文件目前可檢索的 revisions。
- [ ] 這個 slice 具備對應的資料模型、worker 流程、API、UI 提示與測試。

## Blocked by

- [.scratch/workspace-knowledge-base/issues/01-knowledge-base-settings-and-management-shell.md](</D:/mygithub/demo_mini_rag/.scratch/workspace-knowledge-base/issues/01-knowledge-base-settings-and-management-shell.md>)
- [.scratch/workspace-knowledge-base/issues/03-document-import-pipeline-and-document-governance.md](</D:/mygithub/demo_mini_rag/.scratch/workspace-knowledge-base/issues/03-document-import-pipeline-and-document-governance.md>)
