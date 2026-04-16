# WorkflowSearch

**Version 1.0.3**

A Thymer **AppPlugin** that adds a persistent, panel-based search across your collections. It combines a local index (fast name + tag matching) with optional body text and the app’s `searchByQuery` API for text that is not yet indexed.

## Contents

| File | Role |
|------|------|
| `plugin.json` | Plugin manifest (name, icon, Thymer settings). |
| `plugin.js` | Single-file implementation: UI, query parser, search index, and Thymer integration. |

## Features

- **Search** across included collections with debounced, live results.
- **Tags** from the configured record property (default `Tags`) plus `#…` tokens in the record title; property name lookups are **case-insensitive** (e.g. `tags` vs `Tags`).
- **Path tags** (`#self/work`) and **prefix** include (`#self/`, `#self/*`) for a namespace (`self` or `self/…`).
- **Exclude tags** with different rules for plain (`-#self`), path (`-#self/foo`), and prefix (`-#self/`, `-#self/*`).
- **Title + body** matching for non-tag query parts (phrase, terms, `-term`); body text is filled in **after** a first-pass index, then the current query is re-run.
- **Async** `searchByQuery` for plain terms/phrases when needed; merges respect the same hashtag and completion filters as the index.
- **`is:completed` / `-is:completed`** filter by task completion (indexed from line items); optional **expand** preview lists matching tasks with nested indentation.
- **Saved searches** stored in `localStorage` (`ws_saved_searches`), up to 12 entries.
- **Settings** (gear): limit which collections are indexed, and set the **Hashtag property name**.

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

`A OR B` splits the query into two groups; each side is parsed as its own segment. Results are merged (union), respecting the same limits.

### Task completion

| Pattern | Meaning |
|--------|---------|
| `is:completed` | Include records that have **at least one completed** task line (`PluginLineItem` type `task`). Completion is detected via `isTaskCompleted()` or `getTaskStatus() === 'done'`. |
| `-is:completed` | Include records that have **at least one open** (incomplete) task line. |

Completion is derived from the full document tree (nested tasks under lists/blocks are included). `-is:completed` is parsed **before** `is:completed` so the negative form is not mistaken for the positive one.

When the query uses either form, the result row can be **expanded** (chevron) to load a **preview** of matching task lines only, with indentation by nesting depth.

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
- **Order (since v1.0.2):** Within each section, results are grouped by **collection** (collections stay in **first-seen** order). **Titles are sorted A–Z** within each collection (case-insensitive, locale-aware).

## Changelog

### 1.0.3

- **Open-search shortcut:** Documented explicitly as **⌘⇧S** on macOS and **Ctrl+Shift+S** on Windows/Linux (sidebar tooltip and README). The global key handler matches **`s`** case-insensitively so **Shift+S** is recognized whether the browser reports `s` or `S`.

### 1.0.2

- **Search result ordering:** Name matches and body matches are each sorted so that, within every collection, records appear in **alphabetical order by title** (`displayName`). Collection blocks keep the order in which each collection first appeared in the result set.

### 1.0.1

- Task completion filters **`is:completed`** / **`-is:completed`** with indexing from line items; **expand** row preview for matching tasks (nested tree, deduped); parser fix so **`-is:completed`** is not parsed as **`is:completed`**; completed tasks also respect **`getTaskStatus() === 'done'`** when **`isTaskCompleted()`** is not set.

## Configuration

- **Included collections**: Empty selection means “all collections”; otherwise only checked collections are indexed.
- **Hashtag property name**: Thymer property used to read tag values (default `Tags`). Values are normalized (lowercase, optional leading `#` stripped).

Settings are persisted via the plugin’s save path (see `WorkflowSearch` `_saveConfig` / `_getEffectiveConfig` in `plugin.js`).

## Indexing behavior

1. **Fast index**: Records from selected collections are scanned; names, tags, and collection names are stored.
2. **Body index**: Line items are loaded in batches; body text is appended and the open search panel re-runs the current query when indexing completes.
3. **Events**: Record create/update/move triggers index updates when the record belongs to an included collection.

## Requirements

- Thymer app environment with plugin APIs used in `plugin.js` (`AppPlugin`, `data`, `ui`, `events`, etc.).
