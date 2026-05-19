# 聊天知識問答編排與回退行為

Status: ready-for-agent
Type: AFK

## What to build

把工作區知識庫接進現有聊天流程，讓 `Knowledge Answering` 可以依 workspace 預設值啟用，並允許使用者只對單一 **Turn** 暫時覆寫；同時由較高層的 turn orchestration 決定是否做 retrieval、如何組查詢、何時 fallback 成一般聊天，以及如何維持 `ChatService` 作為底層單純的 LLM streaming adapter。v1 的 retrieval capability 應明確以 **LlamaIndex** 為主要整合框架，但只能透過 application-level retrieval boundary 被 orchestration 呼叫，不能讓上層直接依賴框架細節。

這個 slice 應包含以下端到端行為：

- `Knowledge Answering Default` 從 workspace settings 生效
- 聊天 composer 有單一 turn 可覆寫的 toggle
- retrieval 由 LlamaIndex 驅動，但被包在 application-level capability 後面
- retrieval query 會同時考慮目前 prompt 與最近相關對話脈絡
- 檢索品質不足或知識庫不可用時，會自動 fallback 成一般聊天
- 使用知識回答時，系統會把檢索內容視為主要證據，並在證據不足時誠實說明

## Acceptance criteria

- [ ] 聊天 composer 會依 workspace 的 `Knowledge Answering Default` 呈現初始狀態，且使用者可以只對當前 turn 覆寫它。
- [ ] 發送聊天時，較高層 orchestration 會根據目前 prompt 與最近相關對話脈絡決定 retrieval query，而不是把整段 conversation history 全部灌進去。
- [ ] 當知識庫不可用或 retrieval quality 不足時，該 turn 會 fallback 成一般聊天，並在 UI 中提供可見說明。
- [ ] 當知識問答成功命中時，回答會以檢索內容為主要依據，證據不足時要誠實表達不確定。
- [ ] `ChatService` 仍保持為底層 LLM streaming adapter，知識問答決策不直接耦合在 route 或底層串流 adapter 內。
- [ ] LlamaIndex 只作為底層 retrieval/integration framework 存在，orchestration 層仍透過 application-level capability 呼叫知識檢索，不直接綁定框架細節。
- [ ] 這個 slice 具備對應的 API 契約調整、聊天前端互動、orchestration 邏輯與測試。

## Blocked by

- [.scratch/workspace-knowledge-base/issues/03-document-import-pipeline-and-document-governance.md](</D:/mygithub/demo_mini_rag/.scratch/workspace-knowledge-base/issues/03-document-import-pipeline-and-document-governance.md>)
- [.scratch/workspace-knowledge-base/issues/04-versioned-rebuild-and-active-version-switch.md](</D:/mygithub/demo_mini_rag/.scratch/workspace-knowledge-base/issues/04-versioned-rebuild-and-active-version-switch.md>)
