# 非同步匯入工作流與知識庫管理列表

Status: ready-for-agent
Type: AFK

## What to build

建立工作區知識庫的非同步 **Knowledge Base Job** 基礎流程，讓使用者可以在 **Knowledge Base Management** 畫面發起一個批次匯入工作、看到 queued/running/completed/failed/canceled 等狀態，並在同一個 workspace 內對 import jobs 進行排隊與取消 queued job。

這個 slice 的目標是先把「匯入工作是背景 job」這條路徑打通，包含：

- 一次上傳行為建立一個 batch import job 與多個 file-level items
- worker process 會從 queue 中取工作並更新狀態
- 同一個 workspace 的 import jobs 會排隊，不會互相併發改動索引
- 只允許取消 queued import jobs
- 管理頁能顯示目前 job 與可分頁的 job history

這個 slice 可以先用最小可行的處理邏輯驅動 job 狀態流轉；真正的文件正規化、embedding 與 Qdrant 寫入在後續切片完成。

## Acceptance criteria

- [ ] 使用者可以在 `Knowledge Base Management` 畫面選取多個檔案並建立一個批次 import job。
- [ ] 系統會為該批次建立一筆 `Knowledge Base Job` 與多個 file-level items，並在 UI 中顯示狀態。
- [ ] 同一個 workspace 內若已有 import job 在 running，新建立的 import 會進入 queue，而不是直接失敗或併發執行。
- [ ] 使用者可以取消 queued import job，且取消後 UI 與後端狀態一致更新。
- [ ] 管理頁可以顯示目前 running/queued jobs 與可分頁的 job history。
- [ ] 這個 slice 具備對應的 API、worker 狀態流轉、前端管理 UI 與測試。

## Blocked by

- [.scratch/workspace-knowledge-base/issues/01-knowledge-base-settings-and-management-shell.md](</D:/mygithub/demo_mini_rag/.scratch/workspace-knowledge-base/issues/01-knowledge-base-settings-and-management-shell.md>)
