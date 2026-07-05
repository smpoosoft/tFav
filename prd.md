# PRD — tFav（OneTab 仿制版 · 增强去重型）

## 0. 一句话定位

> 一个把「当前窗口堆着的所有 tab」一键收成列表、需要时再放出来的 **Chrome only** 扩展 Demo；相对原版 OneTab 的最大差异是**默认强制去重 + 推广参数清洗**，并把数据模型做成 URL / Group 解耦，便于后续接后端 DB 与多账户隔离。

## 1. 背景

浏览器开很多 tab 吃内存、看花眼是常态。OneTab 的解法：点一下扩展图标，把当前窗口所有 tab 关掉、存成列表，需要时再放回来。tFav 复刻 OneTab 的核心免费功能做一个 **Chrome MV3** 教学级扩展，并在去重体验上做差异化增强。

设计原则：
1. **去重是核心**：默认强制去重，识别推广参数并清洗，避免同一篇内容因不同推广人被存 N 份。
2. **批次体验不退化**：用 `dateInBox` 时间戳保留「这批是几点收的」的归组语义，即使去重导致某组只剩 1 条甚至 0 条，组壳也保留。
3. **可演进**：数据结构、存储访问层、迁移机制从 P0 就为 P2 后端 DB / P3 账户隔离留好接口位与字段位。

## 2. 目标用户

- **重 tab 用户**：开发 / 译稿 / 调研，每天开几十上百个 tab。
- **本地洁癖者**：希望 tab 数据只在自己这里。
- **被推广链接淹没者**：常通过社区分享的带 `?from=`、`?utm_*` 链接进入同一篇文章，希望收藏时自动去重。
- **学习者**：想读懂「扩展 + 本地列表页 + 去重规范化」这一套怎么做的开发者。

## 3. 目标与非目标

| 维度 | 目标 |
|---|---|
| 用户目标 | 一键收起 tab、自动去重、随时放回来，不丢、不分心 |
| 产品目标 | 用最薄的 MV3 工程量把 OneTab 免费核心跑通 + 去重差异化 |
| 非目标 | 不做分享托管；不做非 Chrome 兼容；不做付费 / 广告 / 上报 |

## 4. 核心用户旅程

### 4.1 收起 tab
1. 用户在任意窗口塞了一堆 tab。
2. 点工具栏 tFav 图标。
3. 扩展：
   - `chrome.tabs.query({currentWindow:true})` 取全部 tab；
   - 过滤掉扩展自身页 `tfav.html`、`chrome://*` 等无法收藏的页（可选含 pinned，遵设置）；
   - 对每条 tab 走 **去重管线**（详见 §5）；
   - 把通过去重的条目组织成一个新的 Group（`dateInBox = now`，`urlIds` 指向实际存进 `tfav_urls` 的记录 id，可能复用已有 id）；
   - 关闭这些 tab（失败的留提示）；
   - 打开 / 聚焦 tFav 列表页。
4. 用户在 tFav 页顶部看到刚收起的那一组（即使去重后只剩 0~N 条，组壳仍在）。

### 4.2 恢复 tab
- 单条：点某条标题 → 新 tab 打开规范化 URL（用 `lastAddedAt` 时的最新 originalUrl）→ 默认从组内移除该 urlId；组空且未锁定 → 删组壳；锁定组保留空壳。
- 全部恢复：「全部恢复」打开整组所有 tab → 默认从列表删组，锁定组保留；「全部恢复并保留」保留组。
- 单条恢复不影响该 URL 在其它历史组中的存在（同一 URL 可属多个组，因 `addedTimes[]` 是 URL 级的）。

### 4.3 整理
- 组命名（默认 `yyyy_mm_dd_hh_mi_ss`）。
- 锁定组：防误删、防一键恢复丢失；单条操作不受影响。
- 删除整组 / 单条 / 全部非锁定。
- 组内单条拖拽（P1）；跨组拖拽（P2）。

### 4.4 移植
- 导出 JSON（含 `schemaVersion`、`urls`、`groups`、`settings`、`account`，含 `accountId` 占位），或 URL 纯文本。
- 导入 JSON / 粘贴 URL 文本，导入时同样走 §5 去重管线，跨设备迁移、schema 迁移自动执行（详见 §8）。

## 5. 去重管线（核心）

收起 / 导入时，对每条 url 顺序执行 **双闸门判定**：

```
原 url
  → 基础规范化：去 fragment(#...)、强制 https、小写 host、删默认端口、删默认 path(/)
  → 拆分：pathKey  = 首个 '?' 之前的部分（host + path，不含任何 query）
          rawQuery = '?' 之后部分（保留原始参数，供回放与展示）
  → 推广参数清洗（仅用于 canonicalUrl 展示与 originalUrls 回放比较；不参与等价键）
       → canonicalUrl = pathKey + '?' + 清洗后 query（清洗规则见 §5.1）
       → 若某参数不属黑/白名单，保守保留在 canonicalUrl 里
       → originalUrl 取完整原始（带所有参数）压入 originalUrls 末项
  → 【第一闸门 · pathKey】在 tfav_urls 中按 pathKey 找候选
       ├─ 无候选  → ? 前不一致 ⇒ 直接判定不同资源，无需标题比对
       │             → 新建 URL 记录，addedTimes=[T]，加入当前组
       │             → dedupNote=null
       └─ 有候选  → ? 前一致 ⇒ 「疑似重复」，强制进入第二闸门
                       → 【第二闸门 · 标题】normalizeTitle 比对：
                           ├─ 标题一致 → 判定重复资源：
                           │     • T 追加 addedTimes
                           │     • 用本次 originalUrl 替换 originalUrls 末项（保留合法参数差异）
                           │     • canonicalUrl 用本次清洗结果更新（同 pathKey 下，保留最新清洗形态）
                           │     • 必要时更新 title / favicon / lastAddedAt
                           │     • 同次收起中本条只追加一次 T（不重复写）
                           │     • 把该 urlId 加入当前组 urlIds
                           │     • dedupNote=null
                           └─ 标题不一致 → ? 前同但内容不同 ⇒ 判定为不同资源
                                 • 存储等价键 = pathKey + normalizeTitle
                                 • 在候选之外新建一条 URL 记录，addedTimes=[T]，加入当前组
                                 • canonicalUrl = 本次清洗结果（所以同 pathKey 下会有多条 canonicalUrl 共存）
                                 • dedupNote='title-diff-path-same' 便于审阅
```

**核心守卫**：pathKey（`?` 之前）不一致 → 肯定不是重复，立即终止流程；pathKey 一致 → 才质疑是否重复，强制做标题比对。
**为什么这样**：参数差异可能只是推广位 / 追踪码；不放第一闸门会误判；但 path 不同则从根本上不是同一资源，没必要做标题相似度等昂贵且易错的比对。

### 5.1 推广 / 追踪参数清单（可安全删除）
- 通用追踪：`utm_source`、`utm_medium`、`utm_campaign`、`utm_term`、`utm_content`、`utm_id`
- 推广位：`from`、`fromId`、`ref`、`referrer`、`share`、`shareId`、`shareFrom`、`inviter`、`inviteCode`
- 平台追踪：`fbclid`、`gclid`、`msclkid`、`yclid`、`dclid`、`srsltid`
- 其它明确的无副作用参数白名单见 `lib/urlkit.js` 注释；不在白名单 / 黑名单的 → **保留**。

### 5.2 标题归一化比对
- 去首尾空白、转小写、去常见站点后缀（` - xxx`、` | xxx`、`_xxx`）。
- 完全相等视为一致；不做模糊匹配（避免误合并）。

### 5.3 与原版去重对比

| 场景 | OneTab（默认不去重） | tFav（强制去重） |
|---|---|---|
| 1月1日 `foo.com/bar` 收纳 | 一条记录 | 一条记录 |
| 2月1日 `foo.com/bar` 收纳 | 又一条记录 | **同一条记录**，addedTimes 多一个时间 |
| 2月1日 `foo.com/bar?from=2` 收纳 | 又一条 | **同一条**（from 被清洗） |
| 2月1日 `foo.com/bar?x=9` 与历史 `foo.com/bar?x=8`，标题一样 | 又一条 | **同一条**，originalUrls 用最新替换 |
| 2月1日 `foo.com/bar?x=9` 与历史 `foo.com/bar?x=8`，**标题不一样** | 两条 | **两条**（按 canonical+title 分开） |

## 6. 功能清单与优先级

### P0（MVP 必须）
| ID | 功能 | 说明 |
|---|---|---|
| F1 | 一键收起 | 工具栏 click → 收当前窗口 tab 成新组并关闭 |
| F2 | 去重管线 | §5 全流程 |
| F3 | tFav 页面 | 列表按 `dateInBox` 倒序，卡片化 |
| F4 | 单条恢复 | 点 title 新 tab 打开，默认从组移除 |
| F5 | 全部恢复 | 一键开整组；锁定组跳过删除 |
| F6 | 删除 | 单条 / 单组 / 全部非锁定 |
| F7 | 命名组 | 默认 `yyyy_mm_dd_hh_mi_ss` |
| F8 | 锁定组 | 「全部恢复」「全部删除」跳过；单条不受影响 |
| F9 | 持久化 | `chrome.storage.local`，schema 版本号 |
| F10 | 统计展示 | 卡片角标「命中重复 N 条」 |

### P1（紧接 MVP）
| ID | 功能 | 说明 |
|---|---|---|
| F11 | 导出 JSON / URL 文本 | 一键复制 + 下载 |
| F12 | 导入 JSON / URL 文本 | 走去重管线 + schema 迁移 |
| F13 | 明 / 暗主题 | 跟随系统 / 手动 |
| F14 | 单条拖拽 | 组内重排 |
| F15 | pinned 处理选项 | 设置开关 |

### P2
| ID | 内容 |
|---|---|
| F20 | 网页转 Markdown：把当前 tab 正文转 md 存进某条 URL 记录的 `markdown` 字段 |
| F21 | 后端存储底座：Cloudflare Workers + D1（JSON 关系库）做跨设备同步的存储端，本地走存储适配层无缝切换 |
| F22 | 跨组拖拽 |

### P3
| ID | 内容 |
|---|---|
| F30 | 用户账户体系（注册 / 登录 / token），启用预留的 `accountId` 字段，做多账户数据隔离 |
| F31 | 账户数据隔离：URL / Group 全部按 `accountId` 过滤读写 |
| F32 | 同步冲突解决（last-write-wins + per-field merge 二选一，P3 定） |

### P5 — 内容级去重（Readability + SimHash）

> 远期、不排期，架构预留。P1~P3 完成后回到本阶段。

**动机**：P1 的 URL 级去重（`pathKey + titleClean`）无法处理镜像站、跨站转载、同文不同标题等场景。核心是内容而非 URL，因此要升级到内容指纹。

**技术路线**：

1. **Mozilla Readability** —— 已有成熟 JS 实现，纯 heuristic，无 AI。在 content.js 层对当前页面 DOM 运行，提取正文纯文本。
2. **SimHash** —— Google 级网页去重算法，纯算法，无 AI。对正文文本计算 64bit 指纹，Hamming 距离 ≤ 3 判定为近似重复。

**数据模型增量**（tfav_items 新字段）：

```jsonc
{
  "contentPlainText": null,         // Readability 输出（P0 不存）
  "contentFingerprint": null,       // 未计算
}
```

+ `lib/fingerprint.js`：Readability runner + SimHash 计算 + 距离比对。

**去重管线升级（P5 版）**：

```
输入: { url, title, document(DOM) }

Step A — content.js 层
  Readability(document) → 正文纯文本
  → 传给 background

Step B — background.js 层
  simhash = computeSimhash(content)
  pathKey = extractPathKey(url)

Step C — 去重判定（三重闸门）

  (1) SimHash 精确匹配:
      → 同一篇文章 ✅ 合并（无视 URL/title）
  (2) SimHash 相似匹配（Hamming ≤ 2）:
      → 疑似同篇不同版本 → 标记候选，不自动合并
  (3) 降级到 P1 URL 级:
      (pathKey + titleClean) 保底判重
      → 命中 → 合并 + dedupNote='fallback-content-fingerprint-unavailable'
      → 不命中 → 新建
```

**不存正文**：SimHash 指纹仅 64bit，`chrome.storage.local` 压力几乎为零。正文只在使用 Readability 提取时临时存于内存，写入指纹后释放。回放时仍从原始 URL 实时拉取页面。如需保留正文（MD/全文搜索），另开 IndexedDB 存储（非 P5 范围）。

## 7. 数据模型（注意 P3 字段占位）

### 7.1 tfav_urls[i]
```jsonc
{
  "id": "uuid",
  "accountId": "local",            // P3 多账户用；本期固定 'local'
  "canonicalUrl": "https://foo.com/bar",
  "originalUrls": [                // 最新原始 URL 在末项，便于恢复时按需带参
    "https://foo.com/bar?from=2"
  ],
  "title": "页面标题（归一化比对用 rawTitleNormalized）",
  "rawTitle": "原始 title",
  "rawTitleNormalized": "归一化 title",
  "favIconUrl": "https://.../favicon.ico",
  "addedTimes": [1735689600000, 1738406400000],
  "firstAddedAt": 1735689600000,
  "lastAddedAt": 1738406400000,
  "markdown": null,                // P2 F20 写入
  "dedupNote": null                // 'title-diff-canonical-same' 等
}
```

### 7.2 tfav_groups[i]
```jsonc
{
  "id": "uuid",
  "accountId": "local",
  "title": "2026_01_01_12_00_00",
  "dateInBox": 1735708800000,
  "locked": false,
  "urlIds": ["u1", "u2"]
}
```

### 7.3 tfav_settings
```jsonc
{
  "theme": "auto",                 // 'auto'|'light'|'dark'
  "includePinned": false,
  "favIconFromGoogle": true,
  "syncEnabled": false             // P2 占位；本期不读不写网关
}
```

### 7.4 tfav_account
```jsonc
{ "id": "local", "name": "本地账户", "syncEndpoint": null }   // syncEndpoint P2/P3 才写
```

### 7.5 tfav_schema_version
```jsonc
1   // 整数；迁移脚本按此分支执行
```

## 8. 存储适配层与迁移

- 所有读写经 `lib/store.js` 暴露的语义接口（`getUrls / upsertUrl / getGroups / upsertGroup / removeGroup / getSettings / setSettings` 等），不直接调 `chrome.storage.local`。
- 当前实现 = `chromeStorageAdapter`；未来 BackendAdapter（Cloudflare + D1）实现同一接口。
- 启动时调 `lib/migrate.js`：读 `tfav_schema_version`，依次执行 `migrate_v1_to_v2` 等版本递增函数；迁移失败回滚 + 在 tFav 页报错。
- 导出文件以**最新 schema** 写；导入时若文件 schema 旧 → 自动迁移。
- `accountId` 字段在 P0 就写入（固定 `'local'`），P3 切换账户时整个 `tfav_urls / tfav_groups` 按 accountId 过滤即可，无需重构字段。

## 9. 交互边界

- **空窗口**：收起时无可收起 tab → toast，不建空组壳。
- **tFav 自身页**：收起逻辑过滤 `chrome-extension://<id>/tfav.html`、`chrome-extension://<id>/popup.html`。
- **特殊页**：`chrome://*`、`chrome-extension://*`、`file://*` 照原 url 存，title 占位「(无标题)」，能否恢复由浏览器决定。
- **同次收起的同 url**：若规范化后 canonical 相同且标题相同 → 组内只保留一条；`addedTimes` 记一次 T（而非 T,T）。若 canonical 同但标题不同，则把两条都加入组（按 §5.3）。
- **关闭失败**：`chrome.tabs.remove` 个别失败，该 tab 仍写入列表但留在浏览器，toast「N 个 tab 关闭失败已保留」。
- **存储 quota**：写入超过 `chrome.storage.local` 配额 → 捕获、toast、回滚此次写入（不污染半截数据）。
- **全部恢复数量保护**：单组 > 50 条 → 二次确认。
- **未保存输入**：组改名进行中 → `beforeunload` 拦截。

## 10. 视觉规范

- **主色：橙色**（区别于原版 OneTab 蓝）。建议：
  - 主色 `#F5A623`（amber），或更暖一点 `#FF8A00`
  - 主色按下 / hover `#E8941A`
  - 危险色保留红 `#D93025`
- 背景：亮 `#FFFFFF / #F7F7F8`；暗 `#1F1F1F / #2A2A2A`
- 文字：亮 `#202124`；暗 `#E8EAED`
- 字体：`system-ui, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei"`
- 卡片式列表；组卡左上角拖拽手柄（P1）、右上角操作按钮区。
- 重复命中徽章：橙色小角标「已合并 N 次」对应 addedTimes.length - 1。

## 11. 非功能需求

- **隐私**：仅 `tabs` + `storage` 两权限；不申请 `<all_urls>` / `host_permissions`；不主动联网（favicon 可选且可关）。
- **无依赖、无构建**：原生 JS，`chrome://extensions` 直接加载跑。
- **平台**：仅 Chrome（不测 Edge / Brave / Firefox / Safari）。
- **可演进**：P2 后端、P3 账户的接口位 / 字段位从 P0 写起。

## 12. 成功标准（Demo 验收）

- [ ] 一个 ≥10 tab 的窗口里点图标，≤1s 内收起、跳到 tFav 页、列表正确。
- [ ] 同 url 带不同 `from` / `utm_*` 参数收两次 → 列表中只有一条，`addedTimes.length===2`，组壳两次都在。
- [ ] 同 canonical、标题不同 → 列表中两条，均被归入同一组。
- [ ] 关闭浏览器、重启电脑再开，列表仍在；schema version 经迁移守得住。
- [ ] 锁定组在「全部恢复」「全部删除」时跳过，单条恢复不受影响。
- [ ] 全部恢复 >50 条二次确认。
- [ ] quota 写满给 toast 且不崩。
- [ ] 导出 JSON 含 `schemaVersion / accountId / urls / groups / settings`；导入旧 schema 自动迁移。

## 13. 里程碑

| 里程碑 | 内容 | 状态 |
|---|---|---|
| M0 文档 | README / PRD / TODO 定稿并获编码许可 | 进行中 |
| M1 收起 + 去重 + 列表骨架 | F1 / F2 / F3 / F9 / F10 | 未开始 |
| M2 恢复与删除 | F4 / F5 / F6 | 未开始 |
| M3 命名 / 锁定 / 全部删除 | F7 / F8 (全部删除含在 F6) | 未开始 |
| M4 导入导出 + 主题 + 拖拽 + pinned | F11 / F12 / F13 / F14 / F15 | 未开始 |
| M5 网页转 MD | F20 | 未开始 |
| M6 后端底座（Cloudflare + D1） | F21 + 适配层切换 | 未开始 |
| M7 账户体系 + 同步 | F30 / F31 / F32 | 未开始 |
| M8 图标 / 上架素材 | 工程质量 | 未开始 |
| M9 内容指纹去重 | Readability + SimHash（P5） | 未开始 |