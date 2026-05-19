# 採用非同步知識庫工作流與版本化重建

我們將文件匯入、文件取代、刪除與全量重建都建模為 **Knowledge Base Job**，由獨立 worker 進程非同步執行，而不是在 FastAPI request 生命週期內完成；v1 先使用資料庫驅動的 queue 與獨立 worker，並保留日後改為 Redis-backed worker 的演進空間。一般文件匯入可以在同一個 workspace 內排隊並顯示為 **Queued Knowledge Base Job**，但 `Knowledge Base Rebuild` 需要獨占視窗，不與其他 rebuild 並行，也不會在同 workspace 的 import queue 尚未清空時開始；重建會依目前可檢索的文件 revision 建立新的 **Knowledge Base Version**，完成後再切換成 active version，而在 `Rebuild Required` 期間，聊天仍可繼續使用舊的 active version 回答，以避免 ingestion 設定變更立即讓知識問答整體停擺。
