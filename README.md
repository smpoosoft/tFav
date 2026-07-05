# tFav

> **t**ab + **Fav**orite：把打开的标签页收纳进收藏库，需要时再放出来。

tFav 对标 OneTab 的「一键收起」交互体验，但核心定位是**自用标签页收藏工具**。与 OneTab 的关键区别：

- **收藏优先**：每次收纳不是一次性快照，而是向收藏库追加内容原子。去重后同一内容不管从什么入口进来都合并到一条记录。
- **强制去重**：pathKey（`?` 之前）+ titleClean 双重判定；推广/追踪参数自动清洗；同内容跨入口自动合并，`collectedTimes[]` 保留所有收纳时间拐点。
- **仅 Chrome**（不兼容其它浏览器）。
- **数据只存本地**（`chrome.storage.local`），不上传、不分享。
- **无依赖、无构建**，原生 JS，`chrome://extensions` 直接加载跑。

## 用法

1. Chrome 应用商店搜索 tFav（未上架前走开发者模式）
2. 开发者模式安装：`chrome://extensions` → 开发者模式 → 加载已解压的扩展程序 → 选择本项目文件夹
3. 固定在工具栏
4. 日常：塞一堆 tab → 点图标 → tab 全关、去重后存进 tFav 列表页
5. 从列表页点标题打开、批量恢复、锁定保护、命名整理

## 文件结构

```
tFav/
├── manifest.json          # MV3 扩展清单
├── background.js          # service worker：监听图标点击→收纳链路
├── tfav.html / .css / .js # 列表页（橙色主题，明暗切换）
├── popup.html / .js       # 设置页（主题 / pinned 选项）
├── lib/
│   ├── urlkit.js          # URL pathKey 提取、titleClean、参数清洗
│   ├── storage.js         # chrome.storage.local 封装 + CRUD
│   └── dedupe.js          # 去重管线：collectBatch
├── prd.md                 # 产品需求文档
├── README.md              # 本文件
└── todo.md                # 任务清单
```

## 数据结构

**tfav_items** — 内容原子（一条 = 一个唯一内容）
```jsonc
{ id, pathKey, title, titleClean, urls: [{url, collectedTimestamps}],
  collectedCount, firstCollectedAt, lastCollectedAt, contentFingerprint: null }
```

**tfav_sessions** — 收纳事件（一次点图标 = 一条 session）
```jsonc
{ id, dateInBox, title, type:'sweep', resourceIds: [], locked: false }
```

**tfav_settings**
```jsonc
{ theme: 'auto', includePinned: false }
```

## 路线图

- **P1 (当前)**：一键收纳 + URL 级去重 + 列表页 + 恢复/删除/锁定/命名 + 持久化
- **P2**：导入导出 + 拖拽排序 + 单条收藏入口
- **P5 (远期)**：Readability + SimHash 内容级去重（跨站同文自动合并）

## 隐私

- 权限：仅 `tabs` + `storage`
- 不申请 `<all_urls>`
- 不上传、不统计、不联网

主色 `#F5A623` · Chrome only · 自用工具