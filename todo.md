# TODO — tFav P1 MVP

> `[x]` 完成　`[ ]` 未完成　`[~]` 进行中

P1 目标：可用的自用版本 —— 「点图标→收起→去重→列表→恢复」全链路闭环。

---

## 0. 工程初始化
- [ ] git remote 关联 + 首次提交
- [ ] `manifest.json`（MV3, tabs+storage, service_worker, default_popup）

## 1. 数据层

### 1.1 `lib/urlkit.js` — URL + Title 工具
- [ ] `extractPathKey(url)` — host+path（`?` 前），比较时转小写，不做 www 剥离
- [ ] `cleanTitle(raw)` — 全角→半角（含括号逗号问号冒号；`—`→`-`；`–`→`-`），`replace(/\s+/g, '')`，不做 lowerCase
- [ ] 参数黑名单（utm_*、from、ref、fbclid、gclid、share、inviter、spm、scm、_t、_、nocache、feature、si…），扩展到国内平台自有参数；不在名单的保留

### 1.2 `lib/storage.js` — chrome.storage.local 封装
- [ ] 接口：`getVersion / setVersion / getItems / upsertItem / deleteItem / getSessions / upsertSession / deleteSession / getSettings / setSettings`
- [ ] 键：`tfav_items`、`tfav_sessions`、`tfav_settings`、`tfav_schema_version`

### 1.3 `lib/dedupe.js` — 去重管线
- [ ] `locateItem(pathKey, titleClean)` → 按 pathKey 查找候选，再用 titleClean 精确比对
- [ ] `collectBatch(tabs[], now)` → 逐条去重 → upsert items → 创建 session

## 2. 收纳链路
- [ ] `background.js`：`chrome.action.onClicked` → query tabs → 过滤自身 → collectBatch → close tabs → open tfav.html
- [ ] 边界：空窗口跳过、特殊页面占位 title、关闭失败 toast（console）、quota 捕获

## 3. 列表页

### 3.1 `tfav.html` — 骨架
- [ ] 顶栏：标题 + 全部删除 + 设置图标
- [ ] 列表容器

### 3.2 `tfav.css` — 橙色主题
- [ ] 变量：`--accent: #F5A623`、明暗 theme
- [ ] session 卡片、item 条目、锁定/删除/恢复按钮

### 3.3 `tfav.js` — 逻辑
- [ ] 读 sessions + items → 按 dateInBox 倒序渲染
- [ ] 每条显示：favicon（失败→首字）/ title（链接）/ url（hover）/「已合并 N 次」徽章
- [ ] 单条点击 → `chrome.tabs.create({url})` → 从 session 移除 urlId（atomic write）
- [ ] 「全部恢复」→ 批量 create → 删 session（除非 locked）
- [ ] 「全部恢复并保留」→ 不删
- [ ] 删除单条 / 删除单 session / 全部删除（跳过 locked）
- [ ] 组名行内编辑（默认格式：yyyy_mm_dd_hh_mi_ss）
- [ ] 锁定切换
- [ ] >50 条恢复二次确认
- [ ] beforeunload 保护未保存的改名

## 4. 设置页（可选，P1 简单版）
- [ ] `popup.html` + `popup.js`：主题切换 + pinned 开关

## 数据结构

```jsonc
// tfav_items — 内容原子
{ id, pathKey, title, titleClean, urls: [{ url, collectedTimestamps:[ts] }],
  favIconUrl, collectedCount, tags, dedupMeta,
  contentFingerprint: null, markdown: null }

// tfav_sessions — 收纳事件
{ id, dateInBox, title, type:'sweep', note:null, resourceIds:[], locked:false }

// tfav_settings
{ theme:'auto', includePinned:false }
```

## 设计决策
1. 去重键 = `pathKey + titleClean`；`?` 前不一致直接不同资源
2. urls[] 存原始 URL（含参数），回放原路打开
3. 单组删除只去 resourceIds 不删 item（item 跨 session 共用）
4. 「全部删除」级联删 item（仅在该 item 没有被其它 session 引用时）
5. 不做 import/export、拖拽、内容指纹（P2+/P5）
6. 主色 `#F5A623`