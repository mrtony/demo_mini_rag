# 工作區知識庫設定與管理入口骨架

Status: ready-for-agent
Type: AFK

## What to build

為現有的 **Workspace** 體驗增加最小可用的工作區級 **Knowledge Base** 骨架，讓使用者可以在 `Workspace Settings` 中看到 `Knowledge Base` 分頁，編輯並儲存 **Knowledge Base Settings**，同時進入獨立的 **Knowledge Base Management** 畫面查看空狀態與後續管理入口。

這個 slice 應先把工作區知識庫的基本名詞與互動模型打通，包括：

- 每個 `Workspace` 擁有一筆知識庫設定
- `Knowledge Base Settings` 使用與既有 `Workspace Settings` 一致的 pending、save、discard 行為
- `chunk size`、`chunk overlap`、`top_k`、`similarity threshold`、`knowledge answering default` 可被讀取與儲存
- 匯入設定變更後會產生 `Rebuild Required` 狀態
- `Workspace Settings` 與 `Knowledge Base Management` 之間有清楚的入口關係

這個 slice 不需要真正執行匯入或 rebuild，但要讓後續切片可以直接接上真實工作流。

## Acceptance criteria

- [ ] 使用者可以在 `Workspace Settings` 中看到 `Knowledge Base` 分頁，並讀寫 workspace-owned 的知識庫設定。
- [ ] `Knowledge Base` 分頁遵守既有的 pending、save、discard 互動規則，未儲存變更不會立刻生效。
- [ ] 當使用者儲存 `chunk size` 或 `chunk overlap` 的變更時，系統會把該 workspace 標記為 `Rebuild Required`，並顯示清楚提示。
- [ ] 當使用者儲存 `top_k` 或 `similarity threshold` 的變更時，系統不會把該 workspace 標記為 `Rebuild Required`。
- [ ] 使用者可以進入獨立的 `Knowledge Base Management` 畫面，並看到適合尚未匯入文件時的空狀態。
- [ ] 這個 slice 具備對應的 API、前端互動與測試，且命名與語意對齊 `CONTEXT.md` 與 ADR-0003/0004/0005。

## Blocked by

None - can start immediately
