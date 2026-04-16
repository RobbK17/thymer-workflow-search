# WorkflowSearch

**Version 1.0.0**

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
- **Async** `searchByQuery` for plain terms/phrases when needed; merges respect the same hashtag filters as the index.
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

### Other (parsed, not enforced in matching)

`is:completed` and `-is:completed` are stripped from the query string for parsing but **completion state is not applied** in the current index filters.

## Keyboard

| Shortcut | Action |
|----------|--------|
| ↑ / ↓ | Move selection in the result list. |
| Enter | Open the selected record in an adjacent panel. |
| Cmd/Ctrl+Shift+S | Open or focus the search panel. |
| Cmd/Ctrl+S | Save the current query (when the search box has focus). |

## Result list

- **Name matches** first, then a **Body matches** section when hits rely on body (or cross-field) text.
- Rows can show **tags** (up to five) and a **body** badge when the hit is primarily from body text.

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
