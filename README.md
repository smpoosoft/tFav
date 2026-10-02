# tFav

> **t**ab + **Fav**orite：把打开的标签页收纳进收藏库，需要时再放出来。

tFav 对标 OneTab 的「一键收起」交互体验，但核心定位是**自用标签页收藏工具**。与 OneTab 的关键区别：

- **稍后阅读与收藏同源**：收纳即稍后阅读，标记收藏即写入浏览器原生书签（统一视图，不另立收藏池）。
- **与浏览器书签双向同步**：项目即 `chrome.bookmarks` 的高级 viewer + editor；浏览器侧增删改实时反映到项目，项目侧改名/取消收藏实时写回浏览器。无导入按钮、无手工步骤。
- **强制去重**：pathKey（`?` 之前）+ titleClean 双重判定；同内容跨入口自动合并。
- **保留原始 URL**：去重只用于判断是否同一条内容，恢复标签时始终使用原始 URL。
- **收藏冗余维护**：扫描整个 `chrome.bookmarks` 树，按 pathKey+titleClean 发现重复副本，提供逐项取舍 / 一键合并到指定保留项 —— 这是项目相对原生书签管理器的主要增值。
- **仅 Chrome**（不兼容其它浏览器）。
- **无依赖、无构建**，原生 JS，`chrome://extensions` 直接加载跑。

## 用法

1. Chrome 应用商店搜索 tFav（未上架前走开发者模式）
2. 开发者模式安装：`chrome://extensions` → 开发者模式 → 加载已解压的扩展程序 → 选择本项目文件夹
3. 固定在工具栏
4. 日常：塞一堆 tab → 点图标 → tab 全关、去重后存进 tFav 列表页
5. 收纳后自动写入浏览器收藏夹和 Turso 云端收藏表
6. 从列表页点标题打开、批量恢复、锁定保护、命名整理
7. popup 设置页可配置 Turso Database URL 和 Auth Token；`.env` 仅用于本机开发调试，已被 gitignore

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
│   ├── dedupe.js          # 去重管线：collectBatch
│   ├── bookmarks.js       # 浏览器书签同步控制器 + 重复组分析 + 合并
│   └── turso.js           # Turso HTTP pipeline + 云端 CRUD
├── prd.md                 # 产品需求文档
├── README.md              # 本文件
└── todo.md                # 任务清单
```

## 数据结构

**tfav_items** — 内容原子（一条 = 一个唯一内容）
```jsonc
{ id, pathKey, title, titleClean, urls: [{url, collectedTimestamps}],
  groupIds: [], tagIds: [],
  collectedCount, firstCollectedAt, lastCollectedAt, contentFingerprint: null,
  starred: false, bookmarkIds: [], lastStarredAt: null }
```

**tfav_sessions** — 收纳事件（一次点图标 = 一条 session）
```jsonc
{ id, dateInBox, title, type:'sweep', resourceIds: [], locked: false }
```

**tfav_settings**
```jsonc
{ theme: 'auto', includePinned: false, bookmarkFolder: 'tFav', tursoUrl: '', tursoToken: '' }
```

**tfav_groups / tfav_tags** — 收藏视图的自定义分组和标签
```jsonc
{ id, name, createdAt }
{ id, name, color, createdAt }
```

## Turso 云端表

收纳与收藏在云端为独立表：

- `sessions`：收纳事件
- `items`：收纳条目
- `favorites`：收藏条目
- `tfav_groups`：自定义分组
- `tfav_tags`：标签

## 路线图

- **P1**：一键收纳 + URL 级去重 + 列表页 + 恢复/删除/锁定/命名 + 持久化
- **P2**：收藏与浏览器书签同源同步 + 收藏冗余发现与快速合并 / 取舍 + 收藏多选恢复为标签
- **P3 (当前)**：一键收纳写入 Turso + 原始 URL 保留 + 收藏三栏视图 + 条目拖入分组 + 标签多选
- **导入导出**：暂不开发
- **P5 (远期)**：Readability + SimHash 内容级去重（跨站同文自动合并）

## 隐私

- 权限：`tabs` + `storage` + `bookmarks` + `alarms`
- Host 权限仅用于 Turso 云端和本机调试地址
- 不申请 `<all_urls>`
- 除用户配置的 Turso 数据库外，不上传、不统计、不联网

主色 `#F5A623` · Chrome only · 自用工具
