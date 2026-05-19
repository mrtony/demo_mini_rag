# 回答來源、Retrieval Trace 與 SSE 最終事件

Status: ready-for-agent
Type: AFK

## What to build

讓使用知識回答的聊天回合具備完整的可追溯來源，包含 **Retrieval Trace**、`Citation Snapshot`、`Sources Section`，以及在 SSE final event 中把 citations 一起送回前端，讓使用者在回答完成時立刻看到來源，且在後續 rebuild 或文件更新後仍能保有可讀的歷史引用。

這個 slice 要把「有知識回答」升級為「有知識來源且可追溯」，包含：

- 持久化 turn-level `Retrieval Trace`
- 保存實際顯示給使用者的 citation snapshot
- 回答完成時在前端顯示 `Sources Section`
- 歷史對話中的 citations 不依賴即時重查 Qdrant 才能顯示

## Acceptance criteria

- [ ] 對有使用 knowledge answering 的 turn，系統會保存 `Retrieval Trace` 與對應的 source records。
- [ ] `Retrieval Trace` 會保存足以讓歷史 citations 保持可讀的 `Citation Snapshot`，而不是只存不可讀的 identifiers。
- [ ] 聊天串流完成時，SSE final event 會包含 source citations，前端可立即渲染 `Sources Section`。
- [ ] `Sources Section` 會顯示文件名、可用時的頁碼或投影片編號，以及引用片段。
- [ ] 即使後續發生 rebuild、文件更新或文件刪除，既有對話中的 citations 仍保持可讀。
- [ ] 這個 slice 具備對應的資料持久化、SSE 契約、前端來源呈現與測試。

## Blocked by

- [.scratch/workspace-knowledge-base/issues/05-chat-knowledge-answering-orchestration.md](</D:/mygithub/demo_mini_rag/.scratch/workspace-knowledge-base/issues/05-chat-knowledge-answering-orchestration.md>)
