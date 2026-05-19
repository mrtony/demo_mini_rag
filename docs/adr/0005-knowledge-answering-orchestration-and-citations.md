# 將知識問答建模為獨立能力並由高層 Turn Orchestration 調用

我們不把 RAG 流程直接塞進既有 `ChatService` 或 FastAPI route，而是把 **Knowledge Answering** 設計成可被聊天、未來 Agent 與 Tool 共用的獨立能力，並由高層的 turn orchestration 組合 `KnowledgeRetriever`、citation 組裝與底層 `ChatService` 串流回覆。每個 turn 可以暫時覆寫工作區的 **Knowledge Answering Default**，retrieval query 由當前 user prompt 與最近幾個 turns 的相關脈絡產生；若知識庫不可用或檢索結果不足以支持回答，系統可退回一般聊天。當知識問答成功命中內容時，回覆會以檢索到的知識庫內容作為主要證據，並在 SSE final event 中一併帶回 `Source Citations`；這些 citations 來自已保存的 `Retrieval Trace` 與 `Citation Snapshot`，並在前端以獨立 `Sources Section` 呈現，而不是要求模型在回答正文內自行插入引用標記。
