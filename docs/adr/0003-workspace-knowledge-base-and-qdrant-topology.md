# 採用工作區知識庫模型與每工作區獨立 Qdrant Collection

我們將為每個 **Workspace** 建立恰好一個 **Knowledge Base**，並把 **Knowledge Base Settings** 建模為與聊天設定不同的工作區級配置；在產品體驗上，它會以 `Workspace Settings` 內的 `Knowledge Base` tab 出現，但檔案上傳、文件清單與 job 狀態仍維持在獨立的 `Knowledge Base Management` 畫面。我們同時決定 Qdrant 採用「每個 workspace 一個 collection」而不是共享 collection 加 filter，因為系統已明確預留未來支援多種 embedding 維度、不同 retrieval 策略與租戶級索引調校，而這些需求若綁在共享 collection 上會過早限制演進空間；為了讓搜尋流量與重建切換更穩定，聊天檢索將透過 workspace 對應的 active collection 或 alias 存取，而不是把 collection 拓樸外漏到上層 domain。
