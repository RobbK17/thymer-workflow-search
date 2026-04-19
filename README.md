# WorkflowSearch

**Version 1.1.6.1**

A Thymer **AppPlugin** that adds a persistent, panel-based search across your collections. It combines a local index (fast name + tag matching) with optional body text and the app’s `searchByQuery` API for text that is not yet indexed.

**Current release (v1.1.6.1)** matches **`plugin.js`** (`WS_VERSION`), **`plugin.json`** (`custom.version`), and this document. **v1.1.6.1** is a **maintenance** release: deduplicated status-bar HTML (**`wsFormatIndexStatusBarHtml`**), removed unused **SearchPanel** / **SearchIndex** helpers that only delegated to other modules, added a **50 ms** debounce on autocomplete refresh (alongside the existing search debounce), cached sorted **tags** and **people** lists for autocomplete, and introduced stable **`Plugin`** read APIs (**`getEntry`**, **`getColName`**, **`indexSnapshot`**) so panel code no longer reaches through private **`_index`** maps. **v1.1.6** was a **layout + UX** release: the panel is now **pinned to the full available viewport height** (measured as `window.innerHeight − panel.top`, with a `ResizeObserver` + `MutationObserver` defending against host chrome rewrites) so the dialog no longer visibly resizes when switching between empty state, results, and Settings. **`⌘⇧S`** / **`Ctrl+Shift+S`** now **toggles** the panel instead of always opening/focusing — a second press closes when focus is inside our panel, using a `document.activeElement.contains` DOM-focus check rather than the host's weaker `ui.getActivePanel()` signal (which doesn't flip when the user lands in the search input). The **footer hint row** is now **centered at the bottom** with atomic shortcut groups (`white-space: nowrap`) and break-only-at-separator layout, so `Esc` can no longer orphan onto its own line. Theme re-apply (`_applyUiTheme`) and host-system theme flips (`_reapplyIfSystem`) now trigger an immediate panel height re-measure so dark/light look identical in size. **v1.1.5.1** was a **targeted reliability fix** for the Settings panel: it no longer shows a multi-second **“Loading…”** spinner after a configuration save. The panel now opens **instantly** from the merged live-fetch + **`_knownColNames`** cache, and refreshes the collections checklist + People dropdown **in place** in the background if the workspace is still hydrating. A **re-renderable** **`renderColList`** / **`renderPeopleSel`** preserves the user’s current checkbox state and dropdown selection on each refresh, so background updates never clobber pending edits; the italic sync notice was also updated to **“The list will update automatically.”** **v1.1.5** added a **UI theme picker** (Dark / Light / Match System) with a dedicated **`localStorage`** fast path (**`ws_ui_theme`**) so theme flips are instant and never trigger a plugin reload; the theme also **rides along** into the server blob (**`custom.workflowSearch.uiTheme`**) the next time any other setting is saved, so it syncs across devices without a reload of its own. **Match System** is resolved in JS via **`wsResolveSystemTheme`** (inspects host DOM classes/data-attributes, then body-background luminance, then `prefers-color-scheme`) and a **`MutationObserver` + `matchMedia`** keeps the panel in sync when the host app flips themes live. Settings panel was also hardened: **`wsCoerceCollectionArray`** + per-row `try/catch` keep the collection list and People dropdown populated, and **`_buildIndex`** now retries on post-reload hydration races and always refreshes the main panel body. **v1.1.4** added a **cached merged persist read**, **debounced filter input** in the scope picker modal, **`SearchPanel`** UI split into **`SearchPanelResults`**, **`SearchPanelNavigate`**, **`SearchPanelAutocomplete`**, and **`SearchPanelScopeRow`**, and a **one-time migration** of **legacy `localStorage` saved searches** into **`custom.workflowSearch`**. **v1.1.3** added **scope role tokens** — **`in:record:$wsR`**, **`in:col:$wsC`**, **`under:line:$wsL`**. **v1.1.2** improved **expand-row preview** and **hybrid preview navigation**. **v1.1.1** added **` AND `**, **`under:line:`** fixes, merged **`searchByQuery` +** index body results, and a higher body index cap. See **Changelog** for full history.

## Contents

| File | Role |
|------|------|
| `plugin.json` | Plugin manifest (name, icon, Thymer settings). |
| `plugin.js` | Single-file implementation: UI, query parser, search index, People index, and Thymer integration. |

## Features

- **Search** across included collections with debounced, live results.
- **Tags** from the configured record property (default `Tags`) plus `#…` tokens in the record title; property name lookups are **case-insensitive** (e.g. `tags` vs `Tags`).
- **Path tags** (`#self/work`) and **prefix** include (`#self/`, `#self/*`) for a namespace (`self` or `self/…`).
- **Exclude tags** with different rules for plain (`-#self`), path (`-#self/foo`), and prefix (`-#self/`, `-#self/*`).
- **Title + body** matching for non-tag query parts (phrase, terms, `-term`, **exclude phrases** `-"like this"`); body text is filled in **after** a first-pass index, then the current query is re-run. **v1.1.0:** optional **`title:`** or **`body:`** at the start of a segment restricts **text** to the record **name** or **body** only (see **Text** below). **v1.1.1:** **` AND `** between segments requires **all** conjuncts to match (see **AND** below).
- **Date filters** **`created:`** and **`updated:`** on each record (see below); dates use the **browser’s local timezone** for calendar-day boundaries.
- **Async** `searchByQuery` for plain terms/phrases when the query has **no** **`-word`** or **`-"phrase"`** text exclusions (otherwise the plugin uses the local index only so exclusions match **`nameLower` + `bodyLower`**). When `searchByQuery` runs, merges respect the same hashtag, completion, **date**, **exclude-phrase**, and person filters as the index.
- **`is:completed` / `-is:completed`** filter by task completion (indexed from line items); optional **expand** preview lists matching tasks with nested indentation.
- **People (@-syntax)** — optional **People collection** and name field in settings; resolve `@name`, `mentions:@name`, `fieldname:@name`, wildcards, and escaped `\@…` (see below). **v1.0.5+:** expand-row previews for **linked properties**, **mention lines**, or **tasks** depending on query (see **Expand preview**). **v1.0.6:** mentions lines show **@Name** badges per matched person (via `people.getDisplayName`); **v1.0.7:** mentions lines use **depth-based indentation** like task preview.
- **Saved searches** stored with panel settings in **`plugin.json` → `custom.workflowSearch`** (Thymer `saveConfiguration`), up to 12 entries. Legacy `localStorage` keys (`ws_saved_searches` / `ws_search_config`) are still read for merge and migration: if the server has **no** meaningful config yet, the full legacy blob is pushed to the server when `saveConfiguration` is available. If the server **already** has meaningful settings but **`savedSearches`** is empty while legacy LS still has chips, **v1.1.4** runs a **one-time** `saveConfiguration` that copies **only** those saved searches into the server JSON (then clears LS on success, same as other saves).
- **Autocomplete:** After **`#`**, suggests indexed tags; after **`@`** at the end of the query (when People is configured), suggests people — including right after **`mentions:`** (e.g. **`mentions:@`**), after whitespace (e.g. **`foo @`**), or at the start of the box. **`@` is ignored for autocomplete** when a **word character** sits immediately before **`@`** (so **`user@`** is not treated as a person token). After **`:`** (alone or as in `is:`), suggests **`is:completed`**, **`-is:completed`**, **`created:`**, **`updated:`**, **`mentions:`**, **scope prefixes** (**`in:record:`**, **`in:col:`**, **`under:line:`**), and **`title:`** / **`body:`**; after **` or `** (lowercase), offers **` OR `**; after **` and `** (lowercase), offers **` AND `** (parser requires capital **`OR`** / **`AND`**); **⌃Space** (Ctrl+Space) opens **saved searches**. While suggestions are open, **↑↓** / **Enter** / **Esc** apply to the list (not the result list); see footer hint in the panel.
- **Settings** (gear): included collections, **Hashtag property name**, **People (@-syntax)** (People collection + optional name property), and **UI theme** (Dark / Light / Match System — see **Configuration**).

## Search syntax

Whitespace separates tokens. Matching is **case-insensitive** for text and tags.

### Text

| Pattern | Meaning |
|--------|---------|
| `word` | Record must contain `word` in the **title** (name match) or, if indexed, **title + body** together. |
| `word1 word2` | **AND** — all terms must match (combined title + body when body is available). |
| `"exact phrase"` | Phrase must appear in the same combined text. |
| `-word` | Exclude rows where **title or body** combined contains `word`. |
| `-"exact phrase"` | Exclude rows where **title + body** combined contain this phrase (substring, case-insensitive). Optional space after `-` is allowed (e.g. `- "foo bar"`). Parsed **before** include phrases so include quotes are not confused with excludes. |

**Title / body only:** At the **start of a segment** (before **`OR`** / **`AND`**), **`title:`** or **`body:`** restricts **plain text** terms and **quoted phrases** to the record **name** (`title:`) or **body** (`body:`) only. Tags, **`@`**, dates, **`is:completed`**, etc. still apply to the whole record. **`title:`** / **`body:`** are ignored for **`searchByQuery`** merges (index-only for those queries). With **`under:line:`**, text matching uses the **subtree** only (same as default scoped search); **`title:`** does not apply to individual lines in previews.

### Hashtags (include)

| Pattern | Meaning |
|--------|---------|
| `#tag` | Record must have exact tag `tag`. |
| `#tag/path` | Exact tag `tag/path` (slashes allowed in the token). |
| `#parent/` or `#parent/*` | Tag must be **`parent`** or any **`parent/…`** path. |

### Hashtags (exclude)

| Pattern | Meaning |
|--------|---------|
| `-#tag` | Drop rows whose tags include **`tag`** (exact). |
| `-#tag/path` | Drop rows whose tags include **`tag/path`** (exact). |
| `-#parent/` or `-#parent/*` | Drop rows with tag **`parent`** or any **`parent/…`** tag. |

### OR

`A OR B` splits the query into two groups; each side is parsed as its own segment. Results are merged (union), respecting the same limits. **Person @-filters** work inside each OR segment.

### AND

`A AND B` (capital **`AND`**) requires **every** segment to match the same record (**intersection**). Each side is its own segment (with its own optional **`title:`** / **`body:`** prefix). Example: **`title:1.05 AND body:route`** — title must contain **`1.05`** and the indexed body must contain **`route`**. **` OR `** is split **before** **` AND `**; a branch can be a single segment or an **` AND `** group (e.g. **`title:A AND body:B OR title:C`**). **`searchByQuery`** is not used for pure **` AND `** queries (API cannot express the conjunction faithfully).

### Task completion

| Pattern | Meaning |
|--------|---------|
| `is:completed` | Include records that have **at least one completed** task line (`PluginLineItem` type `task`). Completion is detected via `isTaskCompleted()` or `getTaskStatus() === 'done'`. |
| `-is:completed` | Include records that have **at least one open** (incomplete) task line. |

Completion is derived from the full document tree (nested tasks under lists/blocks are included). `-is:completed` is parsed **before** `is:completed` so the negative form is not mistaken for the positive one.

When the query uses either form, the result row can be **expanded** (chevron) to load a **preview** of matching task lines only, with indentation by nesting depth.

### Search scope (`in:` / `under:`)

Scope tokens are parsed **before** the rest of the query and apply to **all** **`OR`** branches and **` AND `** conjuncts. They use **GUIDs** from Thymer. The **Scope** picker inserts **short role tokens** instead of long IDs so the search bar stays readable; the plugin keeps the **full GUIDs** in memory and substitutes them **before** parsing, searching, and **saving** a search.

| Token | Meaning |
|--------|---------|
| `in:col:<guid>` | Only records in this **collection**. |
| `in:record:<guid>` | Only this **record** (single note). |
| `under:line:<guid>` | Only this **line’s subtree** (that line and descendants) for **text** matching; implicitly the record that owns the line. |
| `in:col:$wsC` · `in:record:$wsR` · `under:line:$wsL` | **Alias** form after using the **Scope** picker or when **loading a saved search** (full GUIDs in storage are turned back into **`$ws…`** in the field and **`_scopeAliasResolved`** is filled). **`$wsC`**, **`$wsR`**, **`$wsL`** stand for the collection, note, or line GUID. **Saved searches** still store **expanded** GUIDs in **`custom.workflowSearch.savedSearches`** (same blob as panel settings). You can still paste **full** `in:record:…` / `under:line:…` / `in:col:…` tokens manually. |

The **filter** wizard walks **collection → note →** (whole note or heading line); it does **not** set **`in:col:`** by itself — you end with **`in:record:`** or **`under:line:`** unless you type **`in:col:`** manually.

You can combine **`in:col:`** or **`in:record:`** with **`under:line:`** (e.g. narrow to a collection and then a heading inside a note). Removing chips or editing the query updates scope.

### Date filters (`created:` / `updated:`)

Each record supplies **created** and **updated** times when the Thymer `Record` exposes them (see **Indexing behavior**). Filters apply to the **whole record**, not individual line items. Multiple clauses on the same field are **intersected** (narrowed). **Invalid** date tokens are ignored for filtering (the token is still removed from the query string).

| Pattern | Meaning |
|--------|---------|
| `created:YYYY-MM-DD` | Record’s **created** time falls on that **calendar day** (local: midnight through end of day). |
| `updated:YYYY-MM-DD` | Record’s **updated** time falls on that calendar day (local). |
| `created:>=YYYY-MM-DD` | Created on or after the **start** of that day (local). |
| `updated:<=YYYY-MM-DD` | Updated on or before the **end** of that day (local). |
| `created:>YYYY-MM-DD` | Created **after** that calendar day (first instant after its end). |
| `updated:<YYYY-MM-DD` | Updated **before** the **start** of that calendar day. |
| `created:YYYY-MM-DD..YYYY-MM-DD` | **Inclusive** range (start of first day through end of second day, local). Same shape for **`updated:`**. |

If a record has **no** usable timestamp for a field you filter on, it **does not** match that date predicate.

### Expand preview (chevron on results)

A **chevron** appears on each result row when the query includes **`under:line:`** or **`in:record:`** (with or without separate text terms — scope alone still opens the subtree / whole-note preview), **task completion** (`is:completed` / `-is:completed`), or resolvable **person-related** syntax: bare **`@…`**, **`fieldname:@…`**, or **`mentions:`** (People index must resolve at least one person GUID). Tooltips reflect context (“Preview lines matching your terms”, “Preview matching lines in this note”, “Preview matching tasks”, “Preview mentions”, “Preview linked properties”).

**Priority:** **`under:line:`** → subtree lines; else **`in:record:`** → **whole note** (title hit + matching body lines, or all lines when there are no text terms); else **task** → **mentions** → **property**. (If **`under:`** and **`in:record:`** / **`is:completed`** overlap, **under** preview wins.)

#### Line labels (v1.1.2)

Preview rows prefer **real line text** from segments. When a line is mostly a **link** (outline **ref** / **link** with a target GUID and little or no visible text), the plugin builds a single-line label in order:

1. **Search index** — title for that GUID if the note is indexed.  
2. **`data.getRecord(guid)`** — workspace note title when the target is a **record** but not in the index.  
3. **`data.getPluginByGuid(guid)`** — **`getName()`** for **collections** and other linked plugins (collection links use the collection’s **plugin GUID**, which is not a record id, so **`getRecord`** alone is not enough).  
4. **People** — **`getDisplayName(guid)`** when the target is a person and People is configured.

**Not shown:** raw GUID strings, **`Link · …`** placeholders, or **`· lineId…`** stubs for blank lines. Lines with **no** resolvable label are **omitted** from the list.

#### @ badges in scope previews (v1.1.2)

For **`under:line:`** and **`in:record:`** previews, blue **`@Name`** badges on a line appear only when the query includes a resolvable **person** filter and the badge matches that filter—**not** for every `ref` on the line. That avoids treating **record** or **collection** links as people.

#### Preview navigation (v1.1.2)

Applies to **scope** (`under:line:` / `in:record:`), **task**, and **mentions** line rows (**not** property preview rows, which still open the record only).

| Action | Result |
|--------|--------|
| **Click** | Open the **source** note (the search hit) and jump to **this line** with highlight — same as before. |
| **⌘+click** (macOS) or **Ctrl+click** (Windows/Linux) | If the line has a navigable link target, open that **record** (editor) or **collection / plugin** (collection **overview** view). |
| **Right-click** | Menu: **Open in source note**; when a link target exists, **Open linked record** or **Open link target** (non-record plugin, e.g. collection). |

The panel **footer** includes a hint: **`⌘+click opens link`** or **`Ctrl+click opens link`** depending on platform.

| Syntax (examples) | Preview content | Click action |
|---------------------|-----------------|--------------|
| `@robb` | All **properties** on the record that link to any **queried** person, shown as **`PropName → PersonName`** | Opens the **record** (no line jump; no link-target menu) |
| `owner:@robb` | Only the **`owner`** property, e.g. **`Owner → Robb`** | Opens the **record** |
| `mentions:@robb` | All **line items** that contain a **ref/mention** to the queried person | Default: **source line**; **⌘/Ctrl+click** / **right-click** open **link target** when the line links to a record or collection (**v1.1.2**) |
| Multiple people (e.g. `@robb OR @jane`) | All matched **lines/properties** for **both** people, per rules above | Same as the matching row type (property open vs mention line jump + **v1.1.2** link navigation on line rows) |

**Mentions preview (v1.0.6–v1.0.7):** Each matching line can reference **multiple** queried people; the preview collects **all** matched person GUIDs per line, then shows a blue **`@Name`** badge for each (names from **`people.getDisplayName(guid)`**, not raw GUIDs). Line text is **capped at 180 characters** to leave room for badges. **v1.0.7:** mention rows use **`wsForEachLineItemDeep`** with **`depth`** (same walker as task preview): **`paddingLeft = 10 + min(depth, 12) × 14`** px, depth **0** = top-level. **v1.1.2:** the same rows support **hybrid navigation** (see table above) when the line also contains links to other records or collections.

**Mixed queries:** If **`mentions:`** and **backlink** (`@name` / `fieldname:@name`) appear together, the UI uses the **mentions** style (line-level preview). **`wsPersonPreviewFilter(parsed)`** collects all `personRefs` and `mentionRefs` across OR groups to decide when person previews apply.

### People (@-syntax)

Requires **People (@-syntax)** to be configured (People collection, optional name property — see **Configuration**). The **People** index is built separately from the main search index; **people records do not appear** in normal search results as ordinary hits.

| Pattern | Meaning |
|--------|---------|
| `@name` | Records that **link to** the person whose resolved name matches `name` (exact, case-insensitive). Uses **backlink** scan: record-type properties and `linkedRecords()` where applicable. |
| `@name*` | Same, but **prefix** match on the person’s name (e.g. any person whose title starts with `name`). |
| `fieldname:@name` | Only the property **`fieldname`** must link to that person (exact name match; optional `*` on the name for prefix). |
| `mentions:@name` | Records whose body contains an **inline mention/ref** to that person. After the body index finishes, this uses a **reverse index** (`personGuid → record guids`) built from `ref` and `mention` segments — fast for `mentions:`. |
| `\@token` | **Escaped** `@` — searches for the literal text `@token` in title/body instead of a person filter. |
| `?token` | **Escaped** `@` — searches for the literal text `?token` in title/body instead of a person filter for Thymer reserved words (i.e. @document, @list). |

Person tokens resolve to person **GUIDs** via the People index (exact name, or prefix when `*` is used). All of the above work inside **`A OR B`** groups.

**Implementation notes:** **`_loadPreviewFor(entry, previewContext, previewEl)`** selects **`previewContext.type`**: **`task`** (`wsFilterTaskLinesForPreview`), **`mentions`** (`wsForEachLineItemDeep`; **v1.0.6+** multi-person **`@Name`** badges via **`people.getDisplayName`**, **v1.0.7+** tree depth / same indent as tasks), **`property`** (`getAllProperties()` + `linkedRecords()`, optional field filter; **`PropName → PersonName`**), **`underScope`** / **`inRecordScope`** (subtree or whole-note lines). **`SearchPanelResults.render`** builds the result list and **`previewContext`** once per search. Property rows use **`.ws-preview-prop`** (blue-tinted). **v1.1.2:** label helpers **`wsResolveGuidTargetTitle`**, **`wsPreviewLineLinkTarget`**; **`SearchPanel`** **`_onPreviewLineInteraction`**, **`_showPreviewLineMenu`** (navigation delegates to **`SearchPanelNavigate`**); scope line UI from **`wsCreateScopePreviewLineDiv`** (click + context menu). **v1.1.3:** **`wsResolveScopeAliases`**, **`wsQueryGuidsToScopeAliases`**, **`_scopeAliasResolved`**, **`_queryResolvedForParse()`** (see **Search scope**).

## Keyboard

| Shortcut | Action |
|----------|--------|
| ↑ / ↓ | Move selection in the result list. |
| Enter | Open the selected record in an adjacent panel. |
| **⌘⇧S** (Mac) / **Ctrl+Shift+S** (Windows & Linux) | Open or focus the search panel. |
| **⌘S** (Mac) / **Ctrl+S** (Windows & Linux) | Save the current query (when the search box has focus). |

## Result list

- **Name matches** first, then a **Body matches** section when hits rely on body (or cross-field) text.
- Rows can show **tags** (up to five) and a **body** badge when the hit is primarily from body text.
- Person-only filters can show a **person** badge when the hit is driven by @-syntax with no extra text terms.
- **Order (since v1.0.2):** Within each section, results are grouped by **collection** (collections stay in **first-seen** order). **Titles are sorted A–Z** within each collection (case-insensitive, locale-aware).

## Configuration

- **Included collections**: Empty selection means “all collections”; otherwise only checked collections are indexed.
- **Hashtag property name**: Thymer property used to read tag values (default `Tags`). Values are normalized (lowercase, optional leading `#` stripped).
- **People (@-syntax)** (under the gear):
  - **People collection** — dropdown: which collection holds your **people** records (used to build `PeopleIndex` at index time).
  - **Name property** — optional. **Blank** = match person names against each record’s **title**. If names live in another field, enter that **property name** here.
- **UI theme** (under the gear): **Dark** (default look), **Light**, or **Match System** (follows the host app — see **Theme** below).

Settings and saved searches persist in **`plugin.json`** under **`custom.workflowSearch`** via Thymer’s **`PluginGlobalPluginAPI.saveConfiguration`** (`this.data.getPluginByGuid(this.getGuid())`). If that API is missing, the plugin falls back to `localStorage` (see `_savePersisted` in `plugin.js`).

**Merge policy (server vs legacy LS):** On each read, the plugin prefers a **meaningful** normalized server blob (`_persistMeaningful` — e.g. included collections, People, non-default tag property, or any saved searches). If the server blob exists but is **not** meaningful, it **merges** legacy `localStorage` into the server shape so empty placeholders do not hide LS data. If the server **is** meaningful, that merged result is the source of truth for **settings**; **saved searches** on the server are still authoritative unless **`savedSearches`** is **empty** and legacy LS still has entries — then **`_maybeMigrateLocalStorageToPlugin`** (on load) performs the **one-time** copy described under **Features** above.

**Read cache:** **`_readMergedPersisted`** keeps a normalized in-memory snapshot and returns a **deep clone** so callers cannot mutate the cache; the cache is cleared on **`reload`** and updated after each successful **`_savePersisted`**.

### Theme (v1.1.5)

The UI theme picker (**Dark** / **Light** / **Match System**) uses a **write-through, read-local** model:

- **Read**: **`_getEffectiveConfig`** reads **`localStorage.ws_ui_theme`** (**`WS_LS_THEME`**) first. If that key is empty it falls back to the server blob’s **`uiTheme`** and mirrors it into `localStorage`.
- **Write on theme change**: **Save & Rebuild** with only the theme field changed updates `localStorage` + calls **`SearchPanel._applyUiTheme`** immediately. It does **not** call `saveConfiguration`, so the plugin **does not reload** and the index is not rebuilt.
- **Write-through to server**: Any **other** settings change (collections, People, tag property) goes through **`_savePersisted`**, which reads the current local theme via **`wsReadLocalTheme`** and includes **`uiTheme`** in the **`custom.workflowSearch`** payload. This is how the theme reaches other devices — it piggybacks on the next real save.
- **Match System**: **`wsResolveSystemTheme`** resolves **`system`** → **`dark`** or **`light`** in JS, checking (1) theme hints on `<html>` / `<body>` (classes `dark` / `light` / `theme-dark` / `theme-light` / `is-dark` / `is-light` / `mode-dark` / `mode-light` / `bp-dark` / `bp-light`, dataset keys `theme` / `colorMode` / `colorTheme` / `appearance`), (2) the computed background luminance of `<body>` (<0.5 → dark), (3) `matchMedia('(prefers-color-scheme: dark)')`. The resolved value is written to **`data-ws-theme`** on the panel root; the user’s choice is kept in **`data-ws-theme-choice`**. While the choice is **system**, a **`MutationObserver`** on `<html>`/`<body>` attributes and a **`matchMedia` change** listener keep the panel in sync with host-theme flips; the watchers are torn down when the choice changes to **dark** / **light** or the plugin unloads.

If you need the latest theme choice to show up on another device **immediately**, save any other setting once (e.g. toggle a collection) and the server blob will be updated.

### Setup (People @-syntax)

1. Open the search panel → **⚙** (gear).
2. Under **People (@-syntax)**, choose your **People collection**.
3. Leave **name property** blank to match against **record titles**, or enter a property name if names are stored elsewhere.
4. Click **Save & Rebuild**.
5. Try queries such as `@robb`, `owner:@robb`, `mentions:@robb`.

## Indexing behavior

1. **Fast index**: Records from selected collections are scanned; names, tags, and collection names are stored. **Created/updated** times are read via **`wsRecordTimeFields`** (tries `created_at` / `updated_at`, camelCase variants, and `getCreatedAt()` / `getUpdatedAt()` when present). The configured **People** collection is read into **`PeopleIndex`** (separate from the main entry map).
2. **Body index**: Line items are loaded in batches; body text is appended, **mention/ref segments** update **`SearchIndex._mentionIndex`** (`Map<personGuid, Set<recordGuid>>`), task completion is updated, and the open search panel re-runs the current query when indexing completes.
3. **Events**: Record create/update/move triggers index updates when the record belongs to an included collection.

Each query calls **`SearchIndex._resolvePersonFilters(group)`** when the segment contains person or mention clauses: person names resolve against `PeopleIndex`; **`mentions:`** uses the reverse mention index; bare **`@name`** backlink filters scan record links via **`linkedRecords()`** and field-specific filters only inspect the named property.

## Changelog

### 1.1.6.1

- **Status bar** — Single helper **`wsFormatIndexStatusBarHtml(index)`** replaces duplicated **`innerHTML`** strings in **`SearchPanel._updateStatus`** and **`Plugin._notifyPanelRebuild`**.
- **Dead code** — Removed **`SearchIndex.registerCollection`** (unused; **`_colNames`** is filled by **`build`** / **`upsert`**), **`SearchPanel.refreshStatus`**, and zero-call **`SearchPanel`** delegates that only forwarded to **`SearchPanelAutocomplete`**, **`SearchPanelNavigate`**, **`SearchPanelScope`**, **`SearchPanelSaved`**, and **`SearchPanelScopeRow`** (call sites use those modules directly). README internal doc link updated from **`_refreshAcFromInput`** to **`SearchPanelAutocomplete.refreshFromInput`**.
- **Autocomplete performance** — **`_acDebounce`**: input-driven **`SearchPanelAutocomplete.refreshFromInput`** is debounced to **50 ms** (click cancels pending timer and refreshes immediately). **`SearchIndex`**: memoized sorted tag list from **`getAllTagsSorted()`**, invalidated on **`build`** / **`upsert`** / **`remove`**. **`PeopleIndex`**: memoized name-sorted suggestion list per **`build`** / **`configure`**; **`suggestByPrefix`** avoids resorting the full map on every call when the prefix is empty.
- **Plugin read API** — **`Plugin.getEntry(guid)`**, **`getColName(guid)`**, **`indexSnapshot()`** ( **`entries`**, **`colNames`**, **`people`**, **`lineToRecordGuid`**, **`lineSubtreeLower`** ) for **`SearchPanel`** and related UI; removes direct **`host._h()._index._entries`** / **`_colNames`** / etc. access from panel helpers ( **`Plugin`** still owns writes to **`_index`** ).

### 1.1.6

- **Full-height panel** — **`SearchPanel._installPanelSizePin(el)`** pins the host panel element's inline `height` to `window.innerHeight − el.getBoundingClientRect().top`, so the dialog occupies the full available viewport height and does **not** resize as `.ws-body` swaps between empty-state, results, and Settings. Re-measures on `window.resize`, `visibilitychange`, `ResizeObserver` on `el.parentElement` + `document.body`, and a `MutationObserver` on `el.style`/`class` that **reinstates** the pinned height if the host rewrites inline styles on theme flip. First paint does two extra `requestAnimationFrame` passes to catch host chrome that settles late (tab bar animating in on first open). Cleanup is wired into **`_disposeSizeWatcher`** and called from **`Plugin.onUnload`**.
- **Theme-size parity** — Theme is color-only in our CSS, but host dark/light themes can change their own chrome height. **`_applyUiTheme`** and **`_reapplyIfSystem`** now call **`_sizePinRemeasure`** (+ one extra `requestAnimationFrame`) after setting `data-ws-theme`, guaranteeing the panel re-measures whenever ours or the host's theme flips.
- **`.ws-root`** — Added explicit **`height: 100%`** and **`flex: 1 1 auto`** as a belt-and-braces fallback for the pixel pin; forces a full-height layout even if the host re-parents the element outside a flex context.
- **Toggle shortcut** — **`⌘⇧S`** / **`Ctrl+Shift+S`** now calls a new **`_togglePanel()`** that: (a) creates the panel if none exists, (b) activates + focuses the input if a panel exists but focus is elsewhere, (c) **closes** the panel if focus is already inside it. The "already inside" check uses **`el.contains(document.activeElement)`** as the primary signal — **`ui.getActivePanel()`** is a weaker fallback because the host's active-panel bookkeeping doesn't always flip when focus merely lands on a panel input. Header JSDoc updated to `toggle search panel (open/focus, or close if already active)`.
- **Footer centered** — **`.ws-footer`** is now a centered `flex-direction: column` (`align-items: center`); result count sits above the hint (both centered), with **`.ws-result-count:empty { display: none }`** collapsing the blank row before any search runs. Hint block is **`text-align: center`** with a looser `line-height: 1.65` so multi-line wraps on narrow panel widths remain legible.
- **Atomic hint groups** — **`.ws-hint`** rendered from an array of group strings (`↑↓ results`, `⏎ open`, `⌘S save`, `⌃Space saved`, `⌘+click opens link`, `suggestions: ↑↓ ⏎ Esc`). Each group is wrapped in **`.ws-hint-group { white-space: nowrap }`** with internal `\u00A0` (non-breaking space) so the browser cannot split a group (e.g. `Esc` was orphaning below `↑↓ ⏎`). Separators use a dedicated **`.ws-hint-sep`** span so line breaks occur **only** at `·` boundaries between groups.

### 1.1.5.1

- **Settings reload fix** — After **`_savePersisted`** triggered a plugin reload, reopening **Settings** was getting stuck on a **“Loading…”** screen for several seconds while a blocking retry loop waited for **`data.getAllCollections()`** to fully hydrate. **`SearchPanelConfig.open`** now performs **one** live fetch, **merges** the result with **`Plugin._knownColNames`** (the cache populated by **`_doBuildIndex`** across reloads), and **renders immediately** — no spinner when the cache is warm.
- **Re-renderable settings UI** — Extracted **`renderColList(cols, { fallback })`** (checklist) and **`renderPeopleSel(cols)`** (People dropdown) so the settings body can be refreshed in place. **`renderColList`** reads the current **`.ws-config-cb:checked`** state and keeps user edits intact on re-render; **`renderPeopleSel`** preserves the live **`peopleSel.value`** (falling back to **`config.peopleCollectionGuid`**) and still renders an **`(unknown collection: GUID…)`** option when the stored GUID isn’t live yet.
- **Background refresh (no spinner)** — If the initial merged view (live ∪ cache) is still missing the configured People GUID or any included-collection GUID, an **`async()`** loop polls **`getAllCollections`** up to **6** times with increasing backoff (**200 ms + attempt × 150 ms**). Each time the merged list grows it re-invokes **`renderColList`** + **`renderPeopleSel`** in place, so settings update live without the user re-opening the panel.
- **Updated sync message** — The italic notice below the checklist now reads **“Showing cached collection list — workspace still syncing. The list will update automatically.”** (previously asked the user to reopen settings). All background updates guard on **`host._configMode`** + **`host._root?.isConnected`** so a closed panel never writes to a detached DOM.

### 1.1.5

- **UI theme picker** — Settings panel adds **Dark** / **Light** / **Match System**. Theme is stored in **`localStorage`** under **`ws_ui_theme`** (**`WS_LS_THEME`**); changing only the theme applies instantly via **`SearchPanel._applyUiTheme`** and **does not** call **`saveConfiguration`**, so there is **no reload / no index rebuild** on theme flips.
- **Write-through sync** — **`wsWorkflowSearchPersistShapes`** carries **`uiTheme`** in **`custom.workflowSearch`** (and legacy LS shape). **`_savePersisted`** reads **`wsReadLocalTheme`** on every save and mirrors it into the server blob, so the theme rides along on the next real settings save (cross-device sync without a dedicated reload).
- **Match-System detector** — **`wsResolveSystemTheme`** resolves **`system`** to a concrete **`dark`** / **`light`** by inspecting host DOM theme hints (classes + `data-theme` / `data-color-mode` / `data-color-theme` / `data-appearance`), then body background luminance, then **`prefers-color-scheme`**. Live updates via **`MutationObserver`** on `<html>`/`<body>` attributes + **`matchMedia`** change listener (**`_installThemeWatchers`** / **`_disposeThemeWatchers`**); the user’s choice lives in **`data-ws-theme-choice`**, the resolved value in **`data-ws-theme`**.
- **CSS** — **`.ws-root`** now paints **`background: var(--ws-panel)`** and the light media block also matches **`.ws-root:not([data-ws-theme])`** / **`.ws-preview-ctx-menu:not([data-ws-theme])`** so the system theme applies during the brief window before JS attaches the attribute.
- **Settings resilience** — **`wsCoerceCollectionArray(raw, where)`** normalizes SDK return shapes and logs when it sees something unexpected; per-row **`try/catch`** around **`col.getGuid()`** / **`col.getName()`** keeps the list and People dropdown usable when one record is malformed. If **`peopleCollectionGuid`** points at a GUID that is no longer live the dropdown shows **`(unknown collection: GUID…)`** instead of disappearing. Collection writes (included list + People GUID) are only saved when the live collection array actually loaded, preventing a transient empty fetch from wiping user selections.
- **Post-reload resilience** — **`_buildIndex`** retries up to 3 times with increasing delays (**600 ms × attempt**) when **`getAllCollections`** returns empty right after a reload (hydration race), always calls **`_refreshSearchPanel`** at the end, and **`_refreshSearchPanel`** now calls **`_renderEmptyState`** on the main body so the **“Building index…”** banner is cleared once the index is ready. **Save & Rebuild** guards UI updates behind **`host._root?.isConnected`** so post-reload writes do not touch a detached DOM.

### 1.1.4

- **Persist read cache** — Merged `custom.workflowSearch` + legacy LS is cached on **`Plugin`** after normalize; reads return **`JSON.parse(JSON.stringify(…))`**. Cache cleared on **`reload`**; refreshed after **`_savePersisted`**.
- **Scope picker** — Filter input in the modal is **debounced** (~160 ms); **`rerenderAndFocus`** and closing the overlay clear the timer and still refresh the list immediately when needed.
- **Code layout** — Panel helpers: **`SearchPanelResults`**, **`SearchPanelNavigate`**, **`SearchPanelAutocomplete`**, **`SearchPanelScopeRow`** (plus existing **`SearchPanelScope`**, **`SearchPanelConfig`**, **`SearchPanelSaved`**).
- **One-time LS → server saved searches** — If the server blob is already **meaningful** but **`savedSearches`** is empty and legacy **`ws_saved_searches` / `ws_search_config`** still has saved entries, **`_maybeMigrateLocalStorageToPlugin`** calls **`_savePersisted({ savedSearches: … })`** once (requires `saveConfiguration`). Successful server save removes legacy LS keys as usual.

### 1.1.3

- **Scope aliases** — Role tokens **`$wsL`**, **`$wsR`**, **`$wsC`** after **`under:line:`** / **`in:record:`** / **`in:col:`** from the Scope picker; **`wsResolveScopeAliases`** expands them before **`QueryParser`** / search; **`_scopeAliasResolved`** holds GUIDs. **Save** stores **full GUIDs**; **saved-search chips** call **`wsQueryGuidsToScopeAliases`** to rewrite stored GUIDs back to tokens and refill the map. Clear search and scope-chip removal keep state consistent.

### 1.1.2

- **Preview labels** — Resolve linked **record** titles with `getRecord` when not in the index; resolve **collection** (and plugin) links with `getPluginByGuid` + `getName`. Drop GUID/line-id placeholders and lines with nothing to show; scope-preview **@** badges only when the query filters people.
- **Preview navigation** — **⌘+click** (macOS) / **Ctrl+click** (Windows/Linux) opens the **link target** (record editor or collection **overview**); **right-click** offers **Open in source note** vs **Open linked record** / **Open link target**. Footer shows the modifier shortcut (`⌘+click opens link` or `Ctrl+click opens link`).

### 1.1.1

- **` AND `** — Capital **`AND`** between segments parses as **`type: 'all'`**; **`SearchIndex._filterAllWithBody`** intersects matches per conjunct. **`wsParsedGroupsFlat`** flattens **OR** / **AND** for person filters, **`wsSearchByQueryAllowed`**, and **`_toPlainQuery`**. **`searchByQuery`** is disabled for **` AND `** queries.
- **Autocomplete:** **`wsAcDetectContext`** / **`SearchPanelAutocomplete.refreshFromInput`** — trailing **` and `** suggests **` AND `** (like **` or `** → **` OR `**).
- **`under:line:`** — **`wsLineParentGuid`** (`parent_guid` / `parentGuid`), **`wsFlattenLineItems`** for nested line items; subtree maps and previews use the full outline.
- **`_searchBody`** — Merges API hits with existing index **body** matches instead of replacing them.
- **Body index** — **`WS_BODY_INDEX_MAX_CHARS`** (default **100000**) replaces a lower per-record slice for line-derived body text.

### 1.1.0

- **`title:`** / **`body:`** — Optional **segment** prefix (case-insensitive) restricts **plain text** terms and phrases to the record **name** or **body** only (`textScope` on parsed groups). **`wsSearchByQueryAllowed`** skips **`searchByQuery`** when any segment uses **`title:`** or **`body:`** (API cannot express the split). **Preview** lines under **`under:line:`** do not match **`title:`** text (record title is not line text). **`QueryParser._parseSegment`**, **`SearchIndex._filterGroupWithBody`**, **`_entryMatchesGroup`**, **`wsLineTextMatchesParsedQuery`**, **`wsLineMatchesUnderPreviewLine`**.

### 1.0.9

- **Search autocomplete:** Dropdown under the search field for **`#`…** (tags from the index), **`@`…** at the end of the query (People index, when configured — works after **`mentions:`**, whitespace, etc.; skips **`word@`**-style positions), **`:`** / **`word:`** ( **`is:completed`**, **`-is:completed`**, **`created:`**, **`updated:`**, **`mentions:`** ), and lowercase **` or `** → insert **` OR `** (union). **⌃Space** lists **saved searches** (same data as **Saved:** chips). **Functionality** keyboard: when open, **↑↓** / **Enter** / **Esc** apply to suggestions; **Tab** closes suggestions. **`SearchIndex.getAllTagsSorted`**, **`PeopleIndex.suggestByPrefix`**, **`WS_AC_COLON_OPS`**.

### 1.0.8

This section lists features first released under the **1.0.8** docs line (exclude phrases, dates, **`searchByQuery` skip**).

- **Exclude phrases:** Query syntax **`-"…"`** (optional space after `-`). Excludes records whose **combined** title + body contain the phrase (case-insensitive substring). Parsed before include quotes so `- "foo"` and `"foo"` do not clash.
- **Date filters:** **`created:`** and **`updated:`** with values **`YYYY-MM-DD`**, **`>=` / `<=` / `>` / `<`**, or **`start..end`** ranges; calendar boundaries use the **browser local** timezone. Stored per index entry from the record API; records **missing** a timestamp **fail** predicates that require that field. Multiple clauses on the same field are **intersected**. **`SearchIndex._entryMatchesGroup`** and **`_filterGroupWithBody`** apply the same rules for the index and for **`searchByQuery`** merge filtering.
- **`searchByQuery` skip:** **`wsSearchByQueryAllowed`** — if any OR-segment includes **`-term`** or **`-"phrase"`**, the plugin does **not** call **`data.searchByQuery`**. Results come only from the local index so text exclusions stay consistent with **`nameLower` + `bodyLower`** (e.g. **`dog -"dog"`** is not filled with API hits that lack that substring). Tag-only / person-only / date-only queries without text exclusions still use the API when **`plainQuery`** is non-empty.

### 1.0.7

- **Mentions preview indentation:** Replaces the flat **`for (const li of items)`** loop with **`wsForEachLineItemDeep(roots, (li, depth) => { … })`** — the same depth-first walker used for task completion preview. Each matching mention line gets **`paddingLeft = 10 + min(depth, 12) × 14`** px, matching the task preview formula (depth **0** = top-level, up to **12** levels).

### 1.0.6

- **Mentions preview UI:** Collects **all** matched person GUIDs **per line** (one line can mention **multiple** people from the query). Appends a blue **`@Name`** badge for each match after the line text; labels use **`people.getDisplayName(guid)`**, not raw GUIDs. Line text is **capped at 180 characters** to leave room for badges.

### 1.0.5

- **`wsPersonPreviewFilter(parsed)`** — New helper (parallel to **`wsCompletionPreviewFilter`**) that gathers all **`personRefs`** and **`mentionRefs`** from the parsed query (including across **OR** groups). Returns **`null`** when no person preview applies.
- **`_loadPreviewFor(entry, previewContext, previewEl)`** — Routes on **`previewContext.type`**: **`task`** (unchanged task-completion preview), **`mentions`** (line items with **`ref`/`mention`** to resolved person GUIDs; click navigates to **line + highlight**), **`property`** (**`getAllProperties()`** + **`linkedRecords()`**, filtered by GUIDs and optional field for **`fieldname:@name`**; **`PropName → PersonName`**; click opens **record** without line jump).
- **Result list / preview wiring** — Builds **`previewContext`** before the row loop; resolves person GUIDs once; **`fieldFilter`** when all refs target the same field; **mixed** `mentions` + backlink uses **mentions** (line-level) display. Chevron on every row when the query includes **`@`**, **`fieldname:`**, **`mentions:`**, or task-completion tokens. Tooltips: “Preview mentions”, “Preview linked properties”, or “Preview matching tasks”. *(In current code this lives in **`SearchPanelResults.render`**.)*
- **CSS** — **`.ws-preview-prop`** for property preview rows (blue-tinted), distinct from task/mention line previews.

### 1.0.4

Complete drop-in replacement for prior releases. Highlights:

- **`PeopleIndex`** — Built from the configured **People collection** during index build. Resolves `@token` to person record GUIDs by **exact case-insensitive** name or **prefix** match with `*`. Kept **separate** from the main search index so the People collection does **not** pollute ordinary search results.
- **Query parser** — Parses `@name`, `@name*`, `fieldname:@name`, `mentions:@name`, and `\@name` (escaped literal). All variants work inside **OR** groups.
- **`SearchIndex._mentionIndex`** — `Map<personGuid, Set<recordGuid>>` built during **`_buildBodyIndex`** by scanning **`ref`** and **`mention`** line segments. Makes **`mentions:@name`** fast once the body index has run.
- **`SearchIndex._resolvePersonFilters(group)`** — Runs on every query: resolves person filters to an allowed **Set** of record GUIDs and gates the main filter loop. **`@name`** (backlink mode) considers record-type links via **`linkedRecords()`**; **`fieldname:@name`** checks only that property; **`mentions:`** uses the reverse index.
- **Settings** — **People (@-syntax)**: People collection picker + optional name property (blank = use record title).

### 1.0.3

- **Open-search shortcut:** Documented explicitly as **⌘⇧S** on macOS and **Ctrl+Shift+S** on Windows/Linux (sidebar tooltip and README). The global key handler matches **`s`** case-insensitively so **Shift+S** is recognized whether the browser reports `s` or `S`.

### 1.0.2

- **Search result ordering:** Name matches and body matches are each sorted so that, within every collection, records appear in **alphabetical order by title** (`displayName`). Collection blocks keep the order in which each collection first appeared in the result set.

### 1.0.1

- Task completion filters **`is:completed`** / **`-is:completed`** with indexing from line items; **expand** row preview for matching tasks (nested tree, deduped); parser fix so **`-is:completed`** is not parsed as **`is:completed`**; completed tasks also respect **`getTaskStatus() === 'done'`** when **`isTaskCompleted()`** is not set.

## Requirements

- Thymer app environment with plugin APIs used in `plugin.js` (`AppPlugin`, `data`, `ui`, `events`, etc.).
