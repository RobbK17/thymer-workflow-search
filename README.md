# WorkflowSearch

**Version 1.0.7**

A Thymer **AppPlugin** that adds a persistent, panel-based search across your collections. It combines a local index (fast name + tag matching) with optional body text and the app’s `searchByQuery` API for text that is not yet indexed. **v1.0.4+** adds a **People** index and **@-syntax**; **v1.0.5** adds **expandable row previews** for person queries (properties, mentions, or mixed) alongside task-completion preview; **v1.0.6–v1.0.7** refine **mentions** previews (multi-person badges, display names, tree depth / indentation matching task preview).

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
- **Title + body** matching for non-tag query parts (phrase, terms, `-term`); body text is filled in **after** a first-pass index, then the current query is re-run.
- **Async** `searchByQuery` for plain terms/phrases when needed; merges respect the same hashtag, completion, and person filters as the index.
- **`is:completed` / `-is:completed`** filter by task completion (indexed from line items); optional **expand** preview lists matching tasks with nested indentation.
- **People (@-syntax)** — optional **People collection** and name field in settings; resolve `@name`, `mentions:@name`, `fieldname:@name`, wildcards, and escaped `\@…` (see below). **v1.0.5+:** expand-row previews for **linked properties**, **mention lines**, or **tasks** depending on query (see **Expand preview**). **v1.0.6:** mentions lines show **@Name** badges per matched person (via `people.getDisplayName`); **v1.0.7:** mentions lines use **depth-based indentation** like task preview.
- **Saved searches** stored in `localStorage` (`ws_saved_searches`), up to 12 entries.
- **Settings** (gear): included collections, **Hashtag property name**, and **People (@-syntax)** (People collection + optional name property).

## Search syntax

Whitespace separates tokens. Matching is **case-insensitive** for text and tags.

### Text

| Pattern | Meaning |
|--------|---------|
| `word` | Record must contain `word` in the **title** (name match) or, if indexed, **title + body** together. |
| `word1 word2` | **AND** — all terms must match (combined title + body when body is available). |
| `"exact phrase"` | Phrase must appear in the same combined text. |
| `-word` | Exclude rows where **title or body** combined contains `word`. |

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

### Task completion

| Pattern | Meaning |
|--------|---------|
| `is:completed` | Include records that have **at least one completed** task line (`PluginLineItem` type `task`). Completion is detected via `isTaskCompleted()` or `getTaskStatus() === 'done'`. |
| `-is:completed` | Include records that have **at least one open** (incomplete) task line. |

Completion is derived from the full document tree (nested tasks under lists/blocks are included). `-is:completed` is parsed **before** `is:completed` so the negative form is not mistaken for the positive one.

When the query uses either form, the result row can be **expanded** (chevron) to load a **preview** of matching task lines only, with indentation by nesting depth.

### Expand preview (chevron on results)

A **chevron** appears on each result row when the query includes **task completion** (`is:completed` / `-is:completed`) **or** resolvable **person-related** syntax: bare **`@…`**, **`fieldname:@…`**, or **`mentions:`** (People index must resolve at least one person GUID). Tooltips reflect context (“Preview matching tasks”, “Preview mentions”, “Preview linked properties”).

**Priority:** If the query includes **both** task completion **and** @-syntax, the expanded preview uses **task completion** (matching task lines). The preview type is chosen in this order: **task** → **mentions** → **property**.

| Syntax (examples) | Preview content | Click action |
|---------------------|-----------------|--------------|
| `@robb` | All **properties** on the record that link to any **queried** person, shown as **`PropName → PersonName`** | Opens the **record** (no line jump) |
| `owner:@robb` | Only the **`owner`** property, e.g. **`Owner → Robb`** | Opens the **record** |
| `mentions:@robb` | All **line items** that contain a **ref/mention** to the queried person | **Navigate to that line** and highlight |
| Multiple people (e.g. `@robb OR @jane`) | All matched **lines/properties** for **both** people, per rules above | Same as the matching row type (property open vs mention line jump) |

**Mentions preview (v1.0.6–v1.0.7):** Each matching line can reference **multiple** queried people; the preview collects **all** matched person GUIDs per line, then shows a blue **`@Name`** badge for each (names from **`people.getDisplayName(guid)`**, not raw GUIDs). Line text is **capped at 180 characters** to leave room for badges. **v1.0.7:** mention rows use **`wsForEachLineItemDeep`** with **`depth`** (same walker as task preview): **`paddingLeft = 10 + min(depth, 12) × 14`** px, depth **0** = top-level.

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

Person tokens resolve to person **GUIDs** via the People index (exact name, or prefix when `*` is used). All of the above work inside **`A OR B`** groups.

**Implementation notes:** **`_loadPreviewFor(entry, previewContext, previewEl)`** selects **`previewContext.type`**: **`task`** (`wsFilterTaskLinesForPreview`), **`mentions`** (`wsForEachLineItemDeep`; **v1.0.6+** multi-person **`@Name`** badges via **`people.getDisplayName`**, **v1.0.7+** tree depth / same indent as tasks), **`property`** (`getAllProperties()` + `linkedRecords()`, optional field filter; **`PropName → PersonName`**). **`_renderResults`** builds **`previewContext`** once per search. Property rows use **`.ws-preview-prop`** (blue-tinted).

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

Settings are persisted via the plugin’s save path (see `WorkflowSearch` `_saveConfig` / `_getEffectiveConfig` in `plugin.js`).

### Setup (People @-syntax)

1. Open the search panel → **⚙** (gear).
2. Under **People (@-syntax)**, choose your **People collection**.
3. Leave **name property** blank to match against **record titles**, or enter a property name if names are stored elsewhere.
4. Click **Save & Rebuild**.
5. Try queries such as `@robb`, `owner:@robb`, `mentions:@robb`.

## Indexing behavior

1. **Fast index**: Records from selected collections are scanned; names, tags, and collection names are stored. The configured **People** collection is read into **`PeopleIndex`** (separate from the main entry map).
2. **Body index**: Line items are loaded in batches; body text is appended, **mention/ref segments** update **`SearchIndex._mentionIndex`** (`Map<personGuid, Set<recordGuid>>`), task completion is updated, and the open search panel re-runs the current query when indexing completes.
3. **Events**: Record create/update/move triggers index updates when the record belongs to an included collection.

Each query calls **`SearchIndex._resolvePersonFilters(group)`** when the segment contains person or mention clauses: person names resolve against `PeopleIndex`; **`mentions:`** uses the reverse mention index; bare **`@name`** backlink filters scan record links via **`linkedRecords()`** and field-specific filters only inspect the named property.

## Changelog

### 1.0.7

- **Mentions preview indentation:** Replaces the flat **`for (const li of items)`** loop with **`wsForEachLineItemDeep(roots, (li, depth) => { … })`** — the same depth-first walker used for task completion preview. Each matching mention line gets **`paddingLeft = 10 + min(depth, 12) × 14`** px, matching the task preview formula (depth **0** = top-level, up to **12** levels).

### 1.0.6

- **Mentions preview UI:** Collects **all** matched person GUIDs **per line** (one line can mention **multiple** people from the query). Appends a blue **`@Name`** badge for each match after the line text; labels use **`people.getDisplayName(guid)`**, not raw GUIDs. Line text is **capped at 180 characters** to leave room for badges.

### 1.0.5

- **`wsPersonPreviewFilter(parsed)`** — New helper (parallel to **`wsCompletionPreviewFilter`**) that gathers all **`personRefs`** and **`mentionRefs`** from the parsed query (including across **OR** groups). Returns **`null`** when no person preview applies.
- **`_loadPreviewFor(entry, previewContext, previewEl)`** — Routes on **`previewContext.type`**: **`task`** (unchanged task-completion preview), **`mentions`** (line items with **`ref`/`mention`** to resolved person GUIDs; click navigates to **line + highlight**), **`property`** (**`getAllProperties()`** + **`linkedRecords()`**, filtered by GUIDs and optional field for **`fieldname:@name`**; **`PropName → PersonName`**; click opens **record** without line jump).
- **`_renderResults`** — Builds **`previewContext`** before the row loop; resolves person GUIDs once; **`fieldFilter`** when all refs target the same field; **mixed** `mentions` + backlink uses **mentions** (line-level) display. Chevron on every row when the query includes **`@`**, **`fieldname:`**, **`mentions:`**, or task-completion tokens. Tooltips: “Preview mentions”, “Preview linked properties”, or “Preview matching tasks”.
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
