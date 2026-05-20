# 採用工作區知識庫模型與每工作區獨立 Qdrant Collection

我們將為每個 **Workspace** 建立恰好一個 **Knowledge Base**，並把 **Knowledge Base Settings** 建模為與聊天設定不同的工作區級配置；在產品體驗上，它會以 `Workspace Settings` 內的 `Knowledge Base` tab 出現，但檔案上傳、文件清單與 job 狀態仍維持在獨立的 `Knowledge Base Management` 畫面。我們同時決定 Qdrant 採用「每個 workspace 一個 collection」而不是共享 collection 加 filter，因為系統已明確預留未來支援多種 embedding 維度、不同 retrieval 策略與租戶級索引調校，而這些需求若綁在共享 collection 上會過早限制演進空間；為了讓搜尋流量與重建切換更穩定，聊天檢索將透過 workspace 對應的 active collection 或 alias 存取，而不是把 collection 拓樸外漏到上層 domain。Qdrant runtime 採用外部 Qdrant Server，而不是 Python client 的 local `path` mode；正式環境與本機開發都透過 server URL 連線，本機開發可用 Docker 啟動 Qdrant Server，測試則維持以 fake 或替身 backend 驗證 application behavior，避免 CI 依賴外部向量服務。

Collection 不做全域 startup migration；建立時機留在匯入與 rebuild 流程中，由 ingestion backend 依 **Knowledge Base Version** 的 collection name lazy create 或 upsert。聊天檢索遇到尚不存在的 collection 時，應回傳空結果並沿用 knowledge-answering fallback，而不是讓 application startup 或一般聊天失敗。

Qdrant 連線設定以 `KB_QDRANT_URL` 為主要入口，預設可指向本機 `http://localhost:6333`；`KB_QDRANT_API_KEY` 用於 Qdrant Cloud 或受保護的 server；`KB_QDRANT_PREFER_GRPC` 預設關閉，保留給大量 upsert 場景調整。系統不再支援 `KB_QDRANT_PATH` 作為 runtime storage mode，避免同時維護 server 與 local path 兩套部署語意。

Qdrant Server 不可用時，mutating knowledge-base operations 與 chat retrieval 採不同語意：匯入與 rebuild job 應失敗並記錄錯誤，因為沒有成功寫入索引就不能產生或更新可檢索版本；刪除文件若無法同步從 Qdrant 移除既有 revision，不應讓使用者看到「已刪除但仍可能被檢索到」的狀態，需失敗或保留可重試狀態。聊天檢索遇到 Qdrant unavailable 時則不讓整個聊天失敗，而是記錄 retrieval fallback reason，退回 plain chat 並提示知識庫暫時不可用。Application startup 不因 Qdrant unavailable 直接 fail fast；部署層若需要嚴格檢查，應透過獨立 healthcheck 表示。
