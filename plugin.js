  /**
   * WorkflowSearch — AppPlugin
   * Version 1.1.5.1
   *
   * Persistent panel-based Workflowy-style search across Thymer collections.
   *
   * Syntax:
   *   term            → name/body contains term (AND by default)
   *   "exact phrase"  → name/body contains phrase
   *   #tag/path       → record has tag
   *   #parent/        → record has tag under parent namespace
   *   -#tag           → exclude tag
   *   -term           → exclude term
   *   A OR B          → union of two groups
   *   A AND B         → intersection (capital AND); e.g. title:… AND body:…
   *   is:completed    → records with at least one completed task
   *   -is:completed   → records with at least one open task
   *   @name           → records linking to person named "name" (exact, case-insensitive)
   *   @name*          → records linking to any person whose title starts with "name"
   *   \@name          → literal text search for "@name" (escaped)
   *   fieldname:@name → records where property "fieldname" links to person "name"
   *   mentions:@name  → records containing an inline ref to person "name"
   *   -"phrase"       → exclude records whose title+body contain phrase
   *   created: / updated: → filter by record date (local calendar day; see README)
   *   in:record: / in:col: / under:line: → GUID-backed scope (see README; filter picker)
   *   title: / body: → restrict text terms to record name or body (segment prefix)
   *   : (after word or alone) → autocomplete is: / created: / updated: / mentions: / in: / under:
   *
   * Keyboard:
   *   ↑ ↓             → navigate results (or suggestions when autocomplete is open)
   *   Enter           → open selected record / accept suggestion
   *   Esc             → close autocomplete
   *   ⌃Space          → saved-search picker
   *   ⌘⇧S / Ctrl+Shift+S → open/focus search panel
   *   ⌘S / Ctrl+S     → save current search
   */

  const WS_VERSION = '1.1.5.1';

  /** Legacy keys (used if `saveConfiguration` is unavailable). */
  const WS_LS_CONFIG = 'ws_search_config';
  const WS_LS_SAVED = 'ws_saved_searches';
  /** Theme is a pure UI preference — stored locally so changing it doesn't trigger `saveConfiguration` (which reloads the plugin). */
  const WS_LS_THEME = 'ws_ui_theme';
  /** `plugin.json` → `custom` — persisted server-side per workspace. */
  const WS_CUSTOM_NS = 'workflowSearch';

  /** SearchPanel uses this so an open panel does not keep a dead `AppPlugin` after reload (e.g. post `saveConfiguration`). */
  let _wsActiveHost = null;

  function wsNormalizePersist(raw) {
    const r = raw && typeof raw === 'object' ? raw : {};
    let saved = r.savedSearches;
    if (!Array.isArray(saved)) {
      try { saved = JSON.parse(typeof saved === 'string' ? saved : '[]'); } catch (e) { saved = []; }
    }
    const savedList = (Array.isArray(saved) ? saved : []).slice(0, 12).map((x) => {
      if (!x || typeof x !== 'object') return null;
      return { id: String(x.id ?? ''), name: String(x.name ?? ''), query: String(x.query ?? '') };
    }).filter(Boolean);
    let uiTheme = r.uiTheme;
    if (uiTheme !== 'dark' && uiTheme !== 'light' && uiTheme !== 'system') uiTheme = 'system';
    return {
      includedCollectionIds: Array.isArray(r.includedCollectionIds) ? r.includedCollectionIds : [],
      tagPropName: typeof r.tagPropName === 'string' && r.tagPropName.trim() ? r.tagPropName.trim() : 'Tags',
      peopleCollectionGuid: typeof r.peopleCollectionGuid === 'string' ? r.peopleCollectionGuid : '',
      peopleNameProp: typeof r.peopleNameProp === 'string' ? r.peopleNameProp : '',
      savedSearches: savedList,
      uiTheme,
    };
  }

  /** `data.getAllCollections()` should return an array per the SDK; keep this thin and log anything unexpected instead of coercing to `[]`. */
  function wsCoerceCollectionArray(raw, where) {
    if (Array.isArray(raw)) return raw;
    if (raw && typeof raw === 'object') {
      if (Array.isArray(raw.collections)) return raw.collections;
      if (typeof raw[Symbol.iterator] === 'function') {
        try { return [...raw]; } catch (e) {}
      }
    }
    console.warn('[WorkflowSearch] getAllCollections returned non-array', { where, raw });
    return [];
  }

  /**
   * Canonical blob for `custom[workflowSearch]` plus legacy LS split (config vs saved array).
   *
   * `uiTheme` is included so it syncs across devices whenever another setting is saved,
   * but it never triggers its own `saveConfiguration` call (which would reload the plugin).
   * On read, `localStorage` wins so the local pick applies instantly even if the server blob is stale.
   */
  function wsWorkflowSearchPersistShapes(normalized) {
    const n = wsNormalizePersist(normalized);
    const customNs = {
      includedCollectionIds: n.includedCollectionIds,
      tagPropName: n.tagPropName,
      peopleCollectionGuid: n.peopleCollectionGuid,
      peopleNameProp: n.peopleNameProp,
      savedSearches: n.savedSearches,
      uiTheme: n.uiTheme,
    };
    return {
      customNs,
      lsConfig: {
        includedCollectionIds: customNs.includedCollectionIds,
        tagPropName: customNs.tagPropName,
        peopleCollectionGuid: customNs.peopleCollectionGuid,
        peopleNameProp: customNs.peopleNameProp,
        uiTheme: customNs.uiTheme,
      },
      lsSaved: customNs.savedSearches,
    };
  }

  /**
   * Theme helpers. `localStorage` is the fast path (no reload on change); the server blob mirrors it for cross-device sync,
   * written opportunistically whenever another setting is saved (see `_savePersisted`).
   */
  function wsReadLocalTheme() {
    try {
      const v = localStorage.getItem(WS_LS_THEME);
      if (v === 'dark' || v === 'light' || v === 'system') return v;
    } catch (e) {}
    return null;
  }
  function wsWriteLocalTheme(v) {
    const t = v === 'dark' || v === 'light' || v === 'system' ? v : 'system';
    try { localStorage.setItem(WS_LS_THEME, t); } catch (e) {}
    return t;
  }

  /**
   * Resolve "system" to a concrete 'dark' or 'light' by inspecting the host app, not just the OS.
   *
   * Thymer (and most Electron hosts) manage their own theme independent of `prefers-color-scheme`,
   * so relying purely on the CSS media query makes "Match System" track the OS rather than the app,
   * which surprises users. Strategy:
   *   1. Look for common theme hints on `<html>` / `<body>` (classes + dataset).
   *   2. Fall back to the computed luminance of `<body>`'s background color.
   *   3. Fall back to `window.matchMedia('(prefers-color-scheme: dark)')`.
   */
  function wsResolveSystemTheme() {
    try {
      const candidates=[];
      if (typeof document!=='undefined') {
        if (document.documentElement) candidates.push(document.documentElement);
        if (document.body) candidates.push(document.body);
      }
      const darkHints=['dark','theme-dark','is-dark','mode-dark','bp-dark'];
      const lightHints=['light','theme-light','is-light','mode-light','bp-light'];
      for (const el of candidates) {
        const cl=el.classList;
        for (const h of darkHints) if (cl.contains(h)) return 'dark';
        for (const h of lightHints) if (cl.contains(h)) return 'light';
        const ds=el.dataset||{};
        const v=(ds.theme||ds.colorMode||ds.colorTheme||ds.appearance||'').toLowerCase();
        if (v==='dark') return 'dark';
        if (v==='light') return 'light';
      }
      if (typeof getComputedStyle==='function' && candidates[1]) {
        const bg=getComputedStyle(candidates[1]).backgroundColor||'';
        const m=/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(bg);
        if (m) {
          const r=+m[1],g=+m[2],b=+m[3];
          const lum=(0.2126*r+0.7152*g+0.0722*b)/255;
          if (lum<0.5) return 'dark';
          return 'light';
        }
      }
    } catch(e) {}
    try {
      if (typeof window!=='undefined' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) return 'dark';
    } catch(e) {}
    return 'light';
  }

  /** Line-derived body text indexed per record (beyond this, terms in the tail are not matched locally). */
  const WS_BODY_INDEX_MAX_CHARS = 100000;

  /** Autocomplete after `:` — matches QueryParser / README (`is:`, dates, `mentions:`). */
  const WS_AC_COLON_OPS = [
    { label:'is:completed', insert:'is:completed', detail:'at least one completed task' },
    { label:'-is:completed', insert:'-is:completed', detail:'at least one open task' },
    { label:'created:…', insert:'created:', detail:'YYYY-MM-DD, ranges, >= / <= / > / <' },
    { label:'updated:…', insert:'updated:', detail:'YYYY-MM-DD, ranges, >= / <= / > / <' },
    { label:'mentions:…', insert:'mentions:', detail:'then @person (e.g. mentions:@robb)' },
    { label:'in:record:…', insert:'in:record:', detail:'one note — use Scope (filter) to pick' },
    { label:'in:col:…', insert:'in:col:', detail:'one collection — use Scope to pick' },
    { label:'under:line:…', insert:'under:line:', detail:'subtree under a heading — use Scope' },
    { label:'title: …', insert:'title: ', detail:'restrict text terms to record title only' },
    { label:'body: …', insert:'body: ', detail:'restrict text terms to record body only' },
  ];

  function wsAcColonOpsMatch(prefix) {
    const p=String(prefix||'').toLowerCase();
    if (!p) return WS_AC_COLON_OPS.slice();
    return WS_AC_COLON_OPS.filter(op=>{
      const ins=op.insert.toLowerCase();
      const stripped=ins.replace(/^-/,'');
      return ins.startsWith(p)||stripped.startsWith(p.replace(/^-/,''));
    });
  }

  const WS_CSS = `    /* WorkflowSearch panel theme: dark default; light via prefers-color-scheme when data-ws-theme=system, or forced via settings (data-ws-theme=light|dark) */
    .ws-root, .ws-preview-ctx-menu {
      color-scheme: dark;
      --ws-fg: #f4efe6;
      --ws-muted: #9e9486;
      --ws-accent-t: #c4b8ff;
      --ws-caret: #c4b8ff;
      --ws-accent-rgb: 124, 106, 247;
      --ws-on-surface: #ffffff;
      --ws-muted-rgb: 158, 148, 134;
      --ws-on-dark-rgb: 255, 255, 255;
      --ws-blue: #a8d8ff;
      --ws-blue-rgb: 100, 180, 255;
      --ws-tag-rgb: 196, 168, 130;
      --ws-sub: #bcb0a0;
      --ws-step: #d2c8ba;
      --ws-scope-chip: #d4c8f0;
      --ws-tag-fg: #c4a882;
      --ws-pop: #1e1c26;
      --ws-panel: #1c1a22;
      --ws-menu: #2a2620;
      --ws-shadow-ac: rgba(0,0,0,0.45);
      --ws-shadow-menu: rgba(0,0,0,0.5);
      --ws-shadow-panel: rgba(0,0,0,0.4);
      --ws-scrim: rgba(0,0,0,0.5);
      --ws-warn-fg: #e8c090;
      --ws-warn-bg: rgba(255, 152, 0, 0.09);
      --ws-warn-bd: rgba(255, 152, 0, 0.14);
      --ws-success-rgb: 76, 175, 80;
      --ws-pending: #ff9800;
      --ws-accent-solid: #7c6af7;
      --ws-ok: #4caf50;
    }
    @media (prefers-color-scheme: light) {
      .ws-root[data-ws-theme="system"],
      .ws-root:not([data-ws-theme]),
      .ws-preview-ctx-menu[data-ws-theme="system"],
      .ws-preview-ctx-menu:not([data-ws-theme]) {
        color-scheme: light;
        --ws-fg: #3a3545;
        --ws-muted: #6d6878;
        --ws-accent-t: #5a48b0;
        --ws-caret: #5b47b8;
        --ws-accent-rgb: 93, 74, 214;
        --ws-on-surface: #ffffff;
        --ws-muted-rgb: 109, 104, 120;
        --ws-on-dark-rgb: 32, 30, 42;
        --ws-blue: #0d62b8;
        --ws-blue-rgb: 13, 98, 184;
        --ws-tag-rgb: 140, 95, 48;
        --ws-sub: #6d6878;
        --ws-step: #756f82;
        --ws-scope-chip: #4a3d7a;
        --ws-tag-fg: #7a5a32;
        --ws-pop: #ffffff;
        --ws-panel: #f4f2f9;
        --ws-menu: #ffffff;
        --ws-shadow-ac: rgba(0,0,0,0.12);
        --ws-shadow-menu: rgba(0,0,0,0.14);
        --ws-shadow-panel: rgba(0,0,0,0.1);
        --ws-scrim: rgba(0,0,0,0.35);
        --ws-warn-fg: #7a4a00;
        --ws-warn-bg: rgba(255, 167, 38, 0.16);
        --ws-warn-bd: rgba(200, 110, 0, 0.22);
        --ws-success-rgb: 46, 125, 50;
        --ws-pending: #e65100;
        --ws-accent-solid: #5b47c4;
        --ws-ok: #2e7d32;
      }
    }
    .ws-root[data-ws-theme="light"],
    .ws-preview-ctx-menu[data-ws-theme="light"] {
      color-scheme: light;
      --ws-fg: #3a3545;
      --ws-muted: #6d6878;
      --ws-accent-t: #5a48b0;
      --ws-caret: #5b47b8;
      --ws-accent-rgb: 93, 74, 214;
      --ws-on-surface: #ffffff;
      --ws-muted-rgb: 109, 104, 120;
      --ws-on-dark-rgb: 32, 30, 42;
      --ws-blue: #0d62b8;
      --ws-blue-rgb: 13, 98, 184;
      --ws-tag-rgb: 140, 95, 48;
      --ws-sub: #6d6878;
      --ws-step: #756f82;
      --ws-scope-chip: #4a3d7a;
      --ws-tag-fg: #7a5a32;
      --ws-pop: #ffffff;
      --ws-panel: #f4f2f9;
      --ws-menu: #ffffff;
      --ws-shadow-ac: rgba(0,0,0,0.12);
      --ws-shadow-menu: rgba(0,0,0,0.14);
      --ws-shadow-panel: rgba(0,0,0,0.1);
      --ws-scrim: rgba(0,0,0,0.35);
      --ws-warn-fg: #7a4a00;
      --ws-warn-bg: rgba(255, 167, 38, 0.16);
      --ws-warn-bd: rgba(200, 110, 0, 0.22);
      --ws-success-rgb: 46, 125, 50;
      --ws-pending: #e65100;
      --ws-accent-solid: #5b47c4;
      --ws-ok: #2e7d32;
    }
    .ws-preview-person-badge {
      flex-shrink: 0;
      font-size: 9px;
      color: var(--ws-blue);
      background: rgba(var(--ws-blue-rgb), 0.1);
      border: 1px solid rgba(var(--ws-blue-rgb), 0.22);
      border-radius: 3px;
      padding: 0 4px;
      white-space: nowrap;
    }

    .ws-root {
      position: relative;
      display: flex;
      flex-direction: column;
      flex: 1;
      min-height: 0;
      width: 100%;
      overflow: hidden;
      background: var(--ws-panel);
      color: var(--ws-fg);
      font-family: var(--font-family, sans-serif);
      font-size: 13px;
      text-align: left;
      box-sizing: border-box;
    }
    .ws-input-wrap { position: relative; flex: 1; min-width: 0; display: flex; align-items: center; }
    .ws-input-wrap .ws-input { width: 100%; padding-right: 28px; }
    .ws-clear-btn {
      position: absolute; right: 7px; top: 50%; transform: translateY(-50%);
      background: none; border: none; cursor: pointer; color: var(--ws-muted);
      display: flex; align-items: center; justify-content: center;
      padding: 2px; border-radius: 3px; line-height: 1; transition: color 0.1s;
    }
    .ws-clear-btn:hover { color: var(--ws-fg); }
    .ws-clear-btn .ti { font-size: 11px; }
    .ws-clear-btn.ws-hidden { display: none; }
    .ws-header {
      display: flex; flex-direction: column; gap: 6px; padding: 8px 12px 10px;
      border-bottom: 1px solid rgba(var(--ws-on-dark-rgb),0.07); flex-shrink: 0;
    }
    .ws-header-top { display: flex; justify-content: flex-end; align-items: center; min-height: 0; }
    .ws-header-actions { display: flex; align-items: center; gap: 2px; flex-shrink: 0; }
    .ws-header-search { display: flex; align-items: center; gap: 8px; min-width: 0; width: 100%; }
    .ws-header-search .ws-input-wrap { flex: 1; min-width: 0; }
    .ws-header-icon { color: var(--ws-muted); flex-shrink: 0; display: flex; align-items: center; }
    .ws-header-icon .ti { font-size: 16px; }
    .ws-input {
      flex: 1; background: rgba(var(--ws-on-dark-rgb),0.05); border: 1px solid rgba(var(--ws-on-dark-rgb),0.10);
      border-radius: 7px; outline: none; color: var(--ws-fg); font-size: 14px; font-family: inherit;
      caret-color: var(--ws-accent-t); min-width: 0; padding: 5px 10px; transition: border-color 0.12s;
    }
    .ws-input:focus { border-color: rgba(var(--ws-accent-rgb),0.55); background: rgba(var(--ws-on-dark-rgb),0.07); }
    .ws-input::placeholder { color: rgba(var(--ws-muted-rgb),0.55); }
    .ws-ac {
      display: none; position: absolute; left: 0; right: 0; top: calc(100% + 4px); z-index: 50;
      max-height: 220px; overflow-y: auto; overflow-x: hidden;
      background: var(--ws-pop); border: 1px solid rgba(var(--ws-accent-rgb),0.35); border-radius: 8px;
      box-shadow: 0 8px 24px var(--ws-shadow-ac); padding: 4px 0; text-align: left;
    }
    .ws-ac.ws-ac-visible { display: block; }
    .ws-ac-item {
      display: flex; align-items: flex-start; gap: 8px; padding: 6px 10px; cursor: pointer;
      font-size: 12px; color: var(--ws-fg); border-left: 2px solid transparent;
    }
    .ws-ac-item:hover, .ws-ac-item.ws-ac-sel { background: rgba(var(--ws-accent-rgb),0.18); border-left-color: rgba(var(--ws-accent-rgb),0.65); }
    .ws-ac-kind { flex-shrink: 0; font-size: 9px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: var(--ws-muted); min-width: 52px; padding-top: 1px; }
    .ws-ac-main { flex: 1; min-width: 0; }
    .ws-ac-label { font-weight: 500; }
    .ws-ac-detail { font-size: 10px; color: var(--ws-muted); margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
    .ws-icon-btn {
      display: inline-flex; align-items: center; gap: 4px; background: none; border: none;
      cursor: pointer; color: var(--ws-muted); font-size: 11px; font-weight: 500; padding: 4px 7px;
      border-radius: 6px; transition: color 0.12s, background 0.12s; flex-shrink: 0;
      white-space: nowrap; font-family: inherit;
    }
    .ws-icon-btn .ti { font-size: 13px; vertical-align: -0.12em; }
    .ws-icon-btn:hover { color: var(--ws-fg); background: rgba(var(--ws-on-dark-rgb),0.07); }
    .ws-icon-btn.ws-active { color: var(--ws-accent-t); background: rgba(var(--ws-accent-rgb),0.18); }
    .ws-icon-btn:disabled { opacity: 0.38; cursor: default; pointer-events: none; }
    .ws-icon-btn.ws-hidden { display: none; }
    .ws-saved-row {
      display: flex; align-items: center; gap: 5px; padding: 6px 12px;
      border-bottom: 1px solid rgba(var(--ws-on-dark-rgb),0.06); flex-wrap: wrap; flex-shrink: 0;
    }
    .ws-saved-label { font-size: 10px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: var(--ws-muted); margin-right: 2px; flex-shrink: 0; }
    .ws-chip {
      display: inline-flex; align-items: center; gap: 3px; background: rgba(var(--ws-accent-rgb),0.10);
      border: 1px solid rgba(var(--ws-accent-rgb),0.22); border-radius: 20px; padding: 2px 6px 2px 9px;
      font-size: 11px; color: var(--ws-accent-t); cursor: default; max-width: 140px; overflow: hidden;
    }
    .ws-chip-label { cursor: pointer; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 1; }
    .ws-chip-label:hover { text-decoration: underline; }
    .ws-chip-del { background: none; border: none; cursor: pointer; color: var(--ws-muted); padding: 0 2px; line-height: 1; display: flex; align-items: center; flex-shrink: 0; transition: color 0.1s; }
    .ws-chip-del:hover { color: var(--ws-fg); }
    .ws-chip-del .ti { font-size: 9px; }
    .ws-status {
      padding: 4px 14px; font-size: 10px; color: rgba(var(--ws-muted-rgb),0.7); letter-spacing: 0.04em;
      border-bottom: 1px solid rgba(var(--ws-on-dark-rgb),0.045); flex-shrink: 0; display: flex; align-items: center; gap: 6px;
    }
    .ws-status-dot { width: 5px; height: 5px; border-radius: 50%; background: var(--ws-ok); flex-shrink: 0; }
    .ws-status-dot.ws-building { background: var(--ws-pending); animation: ws-pulse 1.2s ease-in-out infinite; }
    @keyframes ws-pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
    .ws-people-warn {
      padding: 8px 14px; font-size: 11px; line-height: 1.45; color: var(--ws-warn-fg);
      background: var(--ws-warn-bg); border-bottom: 1px solid var(--ws-warn-bd);
      flex-shrink: 0;
    }
    .ws-people-warn.ws-hidden { display: none; }
    .ws-body { flex: 1; overflow-y: auto; min-height: 0; padding: 2px 0 8px; }
    .ws-empty { padding: 32px 16px; text-align: center; color: var(--ws-muted); font-size: 12px; line-height: 1.7; }
    .ws-empty-icon { margin-bottom: 10px; opacity: 0.65; }
    .ws-empty-icon .ti { font-size: 26px; }
    .ws-empty-hint { font-size: 10px; color: rgba(var(--ws-muted-rgb),0.5); margin-top: 8px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; line-height: 1.9; }
    .ws-result-wrap { border-left: 2px solid transparent; }
    .ws-result-wrap.ws-selected { background: rgba(var(--ws-accent-rgb),0.13); border-left-color: rgba(var(--ws-accent-rgb),0.65); }
    .ws-result-wrap.ws-opened { border-left-color: rgba(var(--ws-success-rgb),0.7); }
    .ws-result-row { display: flex; align-items: flex-start; gap: 0; min-width: 0; }
    .ws-result-expand {
      flex-shrink: 0; align-self: flex-start; margin-top: 2px; background: none; border: none;
      cursor: pointer; color: var(--ws-muted); padding: 2px 4px 2px 8px; border-radius: 4px;
      line-height: 1; transition: color 0.1s, transform 0.12s;
    }
    .ws-result-expand:hover { color: var(--ws-fg); background: rgba(var(--ws-on-dark-rgb),0.04); }
    .ws-result-expand.ws-expanded { transform: rotate(90deg); color: var(--ws-accent-t); }
    .ws-result-expand.ws-hidden { display: none; }
    .ws-result-expand .ti { font-size: 14px; }
    .ws-preview { padding: 0 12px 8px 32px; font-size: 11px; color: var(--ws-sub); line-height: 1.45; }
    .ws-preview-loading, .ws-preview-empty { padding: 4px 0 2px; color: var(--ws-muted); font-style: italic; }
    .ws-preview-line {
      padding: 4px 8px; margin: 2px 0; border-radius: 5px; cursor: pointer;
      border: 1px solid rgba(var(--ws-on-dark-rgb),0.06); background: rgba(var(--ws-on-dark-rgb),0.03);
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .ws-preview-line:hover { background: rgba(var(--ws-accent-rgb),0.12); border-color: rgba(var(--ws-accent-rgb),0.25); color: var(--ws-fg); }
    .ws-preview-prop {
      padding: 4px 8px; margin: 2px 0; border-radius: 5px;
      border: 1px solid rgba(var(--ws-blue-rgb),0.12); background: rgba(var(--ws-blue-rgb),0.05);
      display: flex; align-items: center; gap: 6px; font-size: 11px; color: var(--ws-sub);
      cursor: pointer;
    }
    .ws-preview-prop:hover { background: rgba(var(--ws-blue-rgb),0.12); border-color: rgba(var(--ws-blue-rgb),0.3); color: var(--ws-fg); }
    .ws-preview-prop-name { color: var(--ws-muted); flex-shrink: 0; }
    .ws-preview-prop-arrow { color: var(--ws-muted); flex-shrink: 0; }
    .ws-preview-prop-value { color: var(--ws-blue); }
    .ws-preview-ctx-menu { position: fixed; z-index: 100000; min-width: 200px; padding: 4px 0; border-radius: 8px;
      background: var(--ws-menu); border: 1px solid rgba(var(--ws-on-dark-rgb),0.12); box-shadow: 0 8px 28px var(--ws-shadow-menu);
      font-size: 11px; color: var(--ws-fg); }
    .ws-preview-ctx-item {
      display: block; width: 100%; text-align: left; padding: 7px 12px; border: none; background: transparent;
      color: inherit; font: inherit; cursor: pointer; white-space: nowrap;
    }
    .ws-preview-ctx-item:hover { background: rgba(var(--ws-accent-rgb),0.2); color: var(--ws-on-surface); }
    .ws-result { flex: 1; min-width: 0; padding: 6px 12px 6px 4px; cursor: pointer; transition: background 0.08s; }
    .ws-result:hover { background: rgba(var(--ws-on-dark-rgb),0.04); }
    .ws-result-main { display: flex; align-items: center; gap: 7px; min-width: 0; }
    .ws-result-icon { color: var(--ws-muted); flex-shrink: 0; display: flex; align-items: center; }
    .ws-result-icon .ti { font-size: 12px; }
    .ws-result-icon-dim { opacity: 0.35; }
    .ws-result-name { flex: 1; font-size: 12px; color: var(--ws-fg); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .ws-result-col { font-size: 9px; color: var(--ws-muted); background: rgba(var(--ws-on-dark-rgb),0.05); border: 1px solid rgba(var(--ws-on-dark-rgb),0.08); border-radius: 3px; padding: 1px 5px; white-space: nowrap; flex-shrink: 0; }
    .ws-result-wrap.ws-selected .ws-result-col { background: rgba(var(--ws-accent-rgb),0.12); border-color: rgba(var(--ws-accent-rgb),0.25); color: var(--ws-accent-t); }
    .ws-result-tags { display: flex; gap: 4px; margin-top: 2px; margin-left: 19px; flex-wrap: wrap; }
    .ws-tag { font-size: 9px; color: var(--ws-tag-fg); background: rgba(var(--ws-tag-rgb),0.09); border-radius: 3px; padding: 0 4px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
    .ws-result-wrap.ws-selected .ws-tag { color: var(--ws-accent-t); background: rgba(var(--ws-accent-rgb),0.10); }
    .ws-body-sep { display: flex; align-items: center; gap: 8px; padding: 8px 12px 3px; font-size: 10px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: var(--ws-muted); }
    .ws-body-sep::before, .ws-body-sep::after { content: ''; flex: 1; height: 1px; background: rgba(var(--ws-on-dark-rgb),0.07); }
    .ws-body-badge { font-size: 9px; color: var(--ws-tag-fg); background: rgba(var(--ws-tag-rgb),0.10); border: 1px solid rgba(var(--ws-tag-rgb),0.20); border-radius: 3px; padding: 0 4px; margin-left: 4px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; flex-shrink: 0; }
    .ws-person-badge { font-size: 9px; color: var(--ws-blue); background: rgba(var(--ws-blue-rgb),0.10); border: 1px solid rgba(var(--ws-blue-rgb),0.25); border-radius: 3px; padding: 0 4px; margin-left: 4px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; flex-shrink: 0; }
    .ws-config-section { padding: 2px 0; }
    .ws-config-title { font-size: 10px; font-weight: 600; color: var(--ws-muted); text-transform: uppercase; letter-spacing: 0.07em; padding: 10px 14px 5px; }
    .ws-config-col-list { padding: 0 6px; }
    .ws-config-col-row { display: flex; align-items: center; gap: 8px; padding: 6px 8px; cursor: pointer; border-radius: 6px; font-size: 12px; color: var(--ws-fg); transition: background 0.1s; user-select: none; }
    .ws-config-col-row:hover { background: rgba(var(--ws-on-dark-rgb),0.05); }
    .ws-config-cb { accent-color: var(--ws-accent-solid); cursor: pointer; flex-shrink: 0; width: 13px; height: 13px; }
    .ws-config-divider { height: 1px; background: rgba(var(--ws-on-dark-rgb),0.07); margin: 6px 14px; }
    .ws-scope-row { display:flex; flex-wrap:wrap; gap:6px; align-items:center; padding:0 14px 6px; font-size:11px; min-height:0; }
    .ws-scope-row.ws-hidden { display:none; }
    .ws-scope-chip { display:inline-flex; align-items:center; gap:4px; padding:2px 8px; border-radius:4px; background:rgba(var(--ws-accent-rgb),0.12); border:1px solid rgba(var(--ws-accent-rgb),0.28); color:var(--ws-scope-chip); max-width:100%; }
    .ws-scope-chip-implicit { border-style:dashed; opacity:0.92; }
    .ws-scope-chip span { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .ws-scope-chip .ws-scope-x { background:none; border:none; cursor:pointer; color:var(--ws-muted); padding:0 2px; flex-shrink:0; }
    /* fixed = viewport-sized; absolute inside .ws-root was clipped by panel overflow:hidden */
    .ws-scope-overlay { position:fixed; inset:0; z-index:100000; background:var(--ws-scrim); display:flex; align-items:center; justify-content:flex-start; padding:32px 24px 32px 28px; box-sizing:border-box; overflow:auto; }
    .ws-scope-panel { width:min(520px,calc(100vw - 32px)); height:min(520px,calc(100vh - 64px)); max-height:min(520px,calc(100vh - 64px)); min-height:0; transform:translateX(50%); background:var(--ws-panel); border:1px solid rgba(var(--ws-on-dark-rgb),0.12); border-radius:8px; overflow:hidden; display:flex; flex-direction:column; box-shadow:0 8px 32px var(--ws-shadow-panel); }
    .ws-scope-head { flex-shrink:0; display:flex; justify-content:space-between; align-items:center; padding:10px 12px; border-bottom:1px solid rgba(var(--ws-on-dark-rgb),0.08); font-weight:600; font-size:13px; color:var(--ws-fg); }
    .ws-scope-head button { background:none; border:none; cursor:pointer; color:var(--ws-muted); padding:4px; }
    .ws-scope-tabs { flex-shrink:0; display:flex; gap:4px; padding:8px 10px; border-bottom:1px solid rgba(var(--ws-on-dark-rgb),0.06); }
    .ws-scope-tab { flex:1; padding:6px 8px; border-radius:5px; border:none; cursor:pointer; font-size:11px; background:rgba(var(--ws-on-dark-rgb),0.05); color:var(--ws-sub); }
    .ws-scope-tab.ws-scope-tab-sel { background:rgba(var(--ws-accent-rgb),0.22); color:var(--ws-fg); }
    .ws-scope-panel > .ws-scope-step-hint { flex-shrink:0; }
    .ws-scope-stepbar { flex-shrink:0; padding:8px 12px; font-size:11px; font-weight:600; color:var(--ws-step); letter-spacing:0.02em; border-bottom:1px solid rgba(var(--ws-on-dark-rgb),0.06); }
    .ws-scope-confirm { padding:4px 4px 12px; display:flex; flex-direction:column; gap:12px; }
    .ws-scope-confirm-title { font-size:14px; color:var(--ws-fg); line-height:1.35; }
    .ws-scope-confirm-meta { font-size:11px; color:var(--ws-muted); margin-top:4px; }
    .ws-scope-confirm-actions { display:flex; flex-direction:column; gap:8px; }
    .ws-scope-confirm-actions .ws-btn { width:100%; text-align:center; justify-content:center; }
    .ws-scope-filter { flex-shrink:0; margin:0 10px 8px; padding:6px 10px; border-radius:5px; border:1px solid rgba(var(--ws-on-dark-rgb),0.12); background:rgba(var(--ws-on-dark-rgb),0.06); color:var(--ws-fg); font-size:12px; outline:none; font-family:inherit; }
    .ws-scope-list { flex:1 1 0; min-height:0; overflow-y:auto; overflow-x:hidden; -webkit-overflow-scrolling:touch; padding:0 6px 10px; }
    .ws-scope-item { width:100%; text-align:left; padding:8px 10px; margin:2px 0; border-radius:5px; border:none; cursor:pointer; background:transparent; color:var(--ws-fg); font-size:12px; font-family:inherit; display:block; }
    .ws-scope-item:hover { background:rgba(var(--ws-accent-rgb),0.15); }
    .ws-scope-item small { display:block; color:var(--ws-muted); font-size:10px; margin-top:2px; }
    .ws-scope-back { margin:0 10px 8px; padding:4px 0; background:none; border:none; color:var(--ws-sub); cursor:pointer; font-size:11px; }
    .ws-scope-hint { padding:8px 12px; font-size:11px; color:var(--ws-muted); line-height:1.4; }
    .ws-config-field { display: flex; align-items: center; gap: 8px; padding: 0 14px 10px; }
    .ws-config-field-label { font-size: 11px; color: var(--ws-muted); white-space: nowrap; flex-shrink: 0; }
    .ws-config-input { flex: 1; min-width: 0; padding: 4px 8px; background: rgba(var(--ws-on-dark-rgb),0.06); border: 1px solid rgba(var(--ws-on-dark-rgb),0.12); border-radius: 5px; color: var(--ws-fg); font-size: 12px; outline: none; font-family: inherit; transition: border-color 0.15s; }
    .ws-config-input:focus { border-color: rgba(var(--ws-accent-rgb),0.6); }
    .ws-config-select { flex: 1; min-width: 0; padding: 4px 8px; background: rgba(var(--ws-on-dark-rgb),0.06); border: 1px solid rgba(var(--ws-on-dark-rgb),0.12); border-radius: 5px; color: var(--ws-fg); font-size: 12px; outline: none; font-family: inherit; cursor: pointer; }
    .ws-config-select option { background: var(--ws-panel); }
    .ws-config-actions { display: flex; justify-content: flex-end; padding: 6px 14px 12px; gap: 6px; }
    .ws-btn { padding: 5px 14px; border-radius: 6px; border: none; cursor: pointer; font-size: 12px; font-weight: 500; font-family: inherit; transition: all 0.12s; }
    .ws-btn-primary { background: rgba(var(--ws-accent-rgb),0.85); color: var(--ws-on-surface); }
    .ws-btn-primary:hover { background: rgba(var(--ws-accent-rgb),1); }
    .ws-btn-secondary { background: rgba(var(--ws-on-dark-rgb),0.07); color: var(--ws-fg); border: 1px solid rgba(var(--ws-on-dark-rgb),0.10); }
    .ws-btn-secondary:hover { background: rgba(var(--ws-on-dark-rgb),0.12); }
    .ws-footer { padding: 6px 12px; border-top: 1px solid rgba(var(--ws-on-dark-rgb),0.07); flex-shrink: 0; display: flex; align-items: center; justify-content: space-between; }
    .ws-result-count { font-size: 10px; color: var(--ws-muted); }
    .ws-hint { font-size: 9px; color: rgba(var(--ws-muted-rgb),0.55); letter-spacing: 0.03em; }
    .ws-save-form { display: flex; align-items: center; gap: 6px; padding: 7px 12px; border-bottom: 1px solid rgba(var(--ws-on-dark-rgb),0.07); background: rgba(var(--ws-accent-rgb),0.06); flex-shrink: 0; }
    .ws-save-form-label { font-size: 10px; color: var(--ws-muted); white-space: nowrap; flex-shrink: 0; }
    .ws-save-input { flex: 1; min-width: 0; padding: 3px 7px; background: rgba(var(--ws-on-dark-rgb),0.07); border: 1px solid rgba(var(--ws-accent-rgb),0.4); border-radius: 4px; color: var(--ws-fg); font-size: 11px; outline: none; font-family: inherit; }
    .ws-save-input:focus { border-color: rgba(var(--ws-accent-rgb),0.8); }
    .ws-body::-webkit-scrollbar { width: 4px; }
    .ws-body::-webkit-scrollbar-track { background: transparent; }
    .ws-body::-webkit-scrollbar-thumb { background: rgba(var(--ws-on-dark-rgb),0.12); border-radius: 2px; }
    .ws-body::-webkit-scrollbar-thumb:hover { background: rgba(var(--ws-on-dark-rgb),0.2); }
  `;

  // ─── Helpers ──────────────────────────────────────────────────────────────────

  function wsEsc(s) {
    return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  function wsIcon(name) {
    const n=String(name||'').trim().replace(/^ti-/,'');
    if (!n||!/^[a-z][a-z0-9-]*$/.test(n)) return '';
    return `<i class="ti ti-${n}" aria-hidden="true"></i>`;
  }
  function wsNormalizeTagToken(tok) {
    return String(tok||'').toLowerCase().trim()
      .replace(/[\u200B-\u200D\uFEFF]/g,'')
      .replace(/\u2215/g,'/').replace(/\uff0f/g,'/');
  }
  function wsTagQueryMatches(qTag,entryTags) {
    if (!qTag) return false;
    const qn=wsNormalizeTagToken(qTag);
    if (qn.endsWith('/*')) { const base=qn.slice(0,-2).replace(/\/+$/,''); return base&&entryTags.some(t=>t===base||t.startsWith(base+'/')); }
    if (qn.endsWith('/'))  { const base=qn.slice(0,-1).replace(/\/+$/,''); return base&&entryTags.some(t=>t===base||t.startsWith(base+'/')); }
    return entryTags.includes(qn);
  }
  function wsTagExcludeMatches(qTag,entryTags) {
    if (!qTag) return false;
    const qn=wsNormalizeTagToken(qTag);
    if (qn.endsWith('/*')||qn.endsWith('/')) {
      const base=qn.replace(/\/\*?$/,'').replace(/\/+$/,'');
      return base&&entryTags.some(t=>t===base||t.startsWith(base+'/'));
    }
    return entryTags.includes(qn);
  }
  /** Thymer line items may use `parent_guid` or `parentGuid`. */
  function wsLineParentGuid(li) {
    try {
      if (!li) return undefined;
      const a=li.parent_guid,b=li.parentGuid;
      if (a!=null&&a!=='') return a;
      if (b!=null&&b!=='') return b;
    } catch(e) {}
    return undefined;
  }
  /**
   * Merge top-level `getLineItems` with nested rows from `children` / `getChildren()` (deduped by guid).
   * Some APIs return a tree or omit nested lines from the root array; `under:line:` needs every row for parent links and subtree text.
   */
  async function wsFlattenLineItems(lineItems) {
    const byGuid=new Map();
    async function walk(list) {
      for (const li of list||[]) {
        if (!li) continue;
        try { if (li.guid) byGuid.set(li.guid,li); } catch(e) {}
        let ch=null;
        try { ch=li.children; } catch(e) {}
        if (ch==null||ch===undefined) { try { ch=await li.getChildren(); } catch(e) { ch=[]; } }
        if (ch&&ch.length) await walk(ch);
      }
    }
    await walk(lineItems||[]);
    const out=[...byGuid.values()];
    return out.length?out:(lineItems||[]);
  }
  function wsRootLineItems(record,lineItems) {
    if (!lineItems||!lineItems.length) return [];
    const rg=record.guid;
    const roots=lineItems.filter(li=>{ try { const p=wsLineParentGuid(li); return p==null||p===undefined||p===rg; } catch(e) { return true; } });
    return roots.length?roots:lineItems;
  }
  async function wsForEachLineItemDeep(lineItems,visitor,depth,seen) {
    if (depth===undefined) depth=0;
    if (seen===undefined) seen=new Set();
    for (const li of lineItems||[]) {
      try { if (li.guid&&seen.has(li.guid)) continue; if (li.guid) seen.add(li.guid); } catch(e) {}
      visitor(li,depth);
      let ch=null;
      try { ch=li.children; } catch(e) { ch=null; }
      if (ch===null||ch===undefined) { try { ch=await li.getChildren(); } catch(e) { ch=[]; } }
      if (ch&&ch.length) await wsForEachLineItemDeep(ch,visitor,depth+1,seen);
    }
  }
  function wsTaskLineIsDone(li) {
    if (li.type!=='task') return false;
    try { if (li.isTaskCompleted()===true) return true; if (li.getTaskStatus()==='done') return true; } catch(e) {}
    return false;
  }
  function wsTaskLineIsOpen(li) {
    if (li.type!=='task') return false;
    try { return li.isTaskCompleted()===false; } catch(e) {}
    return false;
  }
  async function wsComputeTaskCompletion(record,lineItems) {
    const roots=wsRootLineItems(record,lineItems);
    let hasAnyTask=false,hasOpenTask=false,hasCompletedTask=false;
    await wsForEachLineItemDeep(roots,(li)=>{ try { if (li.type!=='task') return; hasAnyTask=true; if (wsTaskLineIsDone(li)) hasCompletedTask=true; if (wsTaskLineIsOpen(li)) hasOpenTask=true; } catch(e) {} });
    return { hasAnyTask,hasOpenTask,hasCompletedTask };
  }
  function wsMatchesCompletionFilter(entry,isCompleted) {
    if (isCompleted===null||isCompleted===undefined) return true;
    if (entry.hasOpenTask===undefined) return false;
    if (isCompleted===true) return entry.hasCompletedTask===true;
    if (isCompleted===false) return entry.hasOpenTask===true;
    return true;
  }

  /** YYYY-MM-DD → local start-of-day ms */
  function wsDayStartMs(ymd) {
    const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd||'').trim());
    if (!m) return null;
    const y=+m[1],mo=+m[2],d=+m[3];
    if (mo<1||mo>12||d<1||d>31) return null;
    const t=new Date(y,mo-1,d,0,0,0,0).getTime();
    return isNaN(t)?null:t;
  }
  /** YYYY-MM-DD → local end-of-day ms */
  function wsDayEndMs(ymd) {
    const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd||'').trim());
    if (!m) return null;
    const y=+m[1],mo=+m[2],d=+m[3];
    if (mo<1||mo>12||d<1||d>31) return null;
    const t=new Date(y,mo-1,d,23,59,59,999).getTime();
    return isNaN(t)?null:t;
  }
  /**
   * Parse one created:/updated: value token.
   * Supports: YYYY-MM-DD, >= <= > < prefixes, YYYY-MM-DD..YYYY-MM-DD ranges.
   * Returns { minMs, maxMs } with null = unbounded, or null if invalid.
   */
  function wsParseDateClauseValue(val) {
    const v=String(val||'').trim();
    const ymdRe=/^\d{4}-\d{2}-\d{2}$/;
    const range=v.match(/^(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/);
    if (range) {
      if (!ymdRe.test(range[1])||!ymdRe.test(range[2])) return null;
      const minMs=wsDayStartMs(range[1]),maxMs=wsDayEndMs(range[2]);
      if (minMs==null||maxMs==null||minMs>maxMs) return null;
      return { minMs,maxMs };
    }
    if (v.startsWith('>=')&&ymdRe.test(v.slice(2))) {
      const minMs=wsDayStartMs(v.slice(2));
      return minMs==null?null:{ minMs,maxMs:null };
    }
    if (v.startsWith('<=')&&ymdRe.test(v.slice(2))) {
      const maxMs=wsDayEndMs(v.slice(2));
      return maxMs==null?null:{ minMs:null,maxMs };
    }
    if (v.startsWith('>')&&!v.startsWith('>=')&&ymdRe.test(v.slice(1))) {
      const end=wsDayEndMs(v.slice(1));
      return end==null?null:{ minMs:end+1,maxMs:null };
    }
    if (v.startsWith('<')&&!v.startsWith('<=')&&ymdRe.test(v.slice(1))) {
      const start=wsDayStartMs(v.slice(1));
      return start==null?null:{ minMs:null,maxMs:start-1 };
    }
    if (ymdRe.test(v)) {
      const minMs=wsDayStartMs(v),maxMs=wsDayEndMs(v);
      return minMs==null||maxMs==null?null:{ minMs,maxMs };
    }
    return null;
  }
  function wsIntersectDateInterval(a,b) {
    if (!a) return b;
    if (!b) return a;
    const minMs=Math.max(a.minMs??-Infinity,b.minMs??-Infinity);
    const maxMs=Math.min(a.maxMs??Infinity,b.maxMs??Infinity);
    if (minMs>maxMs) return { empty:true };
    return { minMs:minMs===-Infinity?null:minMs,maxMs:maxMs===Infinity?null:maxMs };
  }
  function wsTsInRange(t,intv) {
    if (!intv||intv.empty) return true;
    if (t==null||typeof t!=='number'||isNaN(t)) return false;
    if (intv.minMs!=null&&t<intv.minMs) return false;
    if (intv.maxMs!=null&&t>intv.maxMs) return false;
    return true;
  }
  /** @param {{created?:object|null,updated?:object|null}} df */
  function wsEntryMatchesDateFilters(entry,df) {
    if (!df) return true;
    if (df.created?.empty||df.updated?.empty) return false;
    if (df.created&&!wsTsInRange(entry.createdMs,df.created)) return false;
    if (df.updated&&!wsTsInRange(entry.updatedMs,df.updated)) return false;
    return true;
  }
  function wsRecordTimeFields(record) {
    let createdMs=null,updatedMs=null;
    const num=(v)=>{
      if (v==null||v==='') return null;
      if (typeof v==='number'&&!isNaN(v)) return v;
      if (v instanceof Date) return v.getTime();
      if (typeof v==='string') { const p=Date.parse(v); return isNaN(p)?null:p; }
      return null;
    };
    try {
      for (const k of ['created_at','createdAt','created']) {
        if (record[k]!==undefined) { createdMs=num(record[k]); if (createdMs!=null) break; }
      }
      if (createdMs==null&&typeof record.getCreatedAt==='function') createdMs=num(record.getCreatedAt());
    } catch(e) {}
    try {
      for (const k of ['updated_at','updatedAt','updated']) {
        if (record[k]!==undefined) { updatedMs=num(record[k]); if (updatedMs!=null) break; }
      }
      if (updatedMs==null&&typeof record.getUpdatedAt==='function') updatedMs=num(record.getUpdatedAt());
    } catch(e) {}
    return { createdMs,updatedMs };
  }
  /** Flatten OR / AND / single-segment queries into a list of segment objects (for person, completion, searchByQuery gates). */
  function wsParsedGroupsFlat(parsed) {
    if (!parsed) return [];
    if (parsed.type==='or') return parsed.groups.flatMap(g=>g&&g.type==='all'?g.groups:[g]);
    if (parsed.type==='all') return parsed.groups;
    return [parsed];
  }
  function wsCompletionPreviewFilter(parsed) {
    if (!parsed) return null;
    for (const g of wsParsedGroupsFlat(parsed)) {
      if (g.isCompleted!==null&&g.isCompleted!==undefined) return g.isCompleted;
    }
    return null;
  }
  /**
   * Returns the person filter context from the parsed query:
   * { personRefs, mentionRefs } if any @-syntax present, null otherwise.
   */
  function wsPersonPreviewFilter(parsed) {
    if (!parsed) return null;
    const groups = wsParsedGroupsFlat(parsed);
    const personRefs=[], mentionRefs=[];
    for (const g of groups) {
      if (g.personRefs)   personRefs.push(...g.personRefs);
      if (g.mentionRefs)  mentionRefs.push(...g.mentionRefs);
    }
    if (!personRefs.length && !mentionRefs.length) return null;
    return { personRefs, mentionRefs };
  }

  /** When false, skip `searchByQuery`: exclusions apply only to indexed title+body; the API cannot express them. `title:`/`body:` cannot be expressed by the API. */
  function wsSearchByQueryAllowed(parsed) {
    if (!parsed) return false;
    if (parsed.scope&&parsed.scope.underLineGuid) return false;
    if (parsed.type==='all') return false;
    const groups=wsParsedGroupsFlat(parsed);
    for (const g of groups) {
      if (g.textScope&&g.textScope!=='both') return false;
      if ((g.excludeTerms&&g.excludeTerms.length)||(g.excludePhrases&&g.excludePhrases.length)) return false;
    }
    return true;
  }

  /** Canonical search scope (GUID-backed tokens in the query string). */
  function wsExtractScope(raw) {
    let s=String(raw||'').trim();
    const scope={ inRecordGuid:null,inCollectionGuid:null,underLineGuid:null };
    const patterns=[[/\bin:record:(\S+)/gi,'inRecordGuid'],[/\bin:col:(\S+)/gi,'inCollectionGuid'],[/\bunder:line:(\S+)/gi,'underLineGuid']];
    for (const [re,key] of patterns) {
      const ms=[...s.matchAll(re)];
      if (ms.length) scope[key]=ms[ms.length-1][1];
      s=s.replace(re,' ');
    }
    s=s.replace(/\s+/g,' ').trim();
    return { rest:s,scope };
  }
  function wsScopeHas(scope) {
    return !!(scope&&(scope.inRecordGuid||scope.inCollectionGuid||scope.underLineGuid));
  }
  function wsStripScopeQuery(q) {
    let s=String(q||'');
    s=s.replace(/\bin:record:\S+/gi,' ').replace(/\bin:col:\S+/gi,' ').replace(/\bunder:line:\S+/gi,' ');
    return s.replace(/\s+/g,' ').trim();
  }
  /** Role tokens for display/editing; resolved to real GUIDs before parse/search (see `wsResolveScopeAliases`). */
  const WS_SCOPE_ALIAS_RECORD = '$wsR';
  const WS_SCOPE_ALIAS_COL = '$wsC';
  const WS_SCOPE_ALIAS_LINE = '$wsL';

  /** @param {{inRecordGuid?:string|null,inCollectionGuid?:string|null,underLineGuid?:string|null}} scope */
  /** @param {{useAliases?:boolean}} [opts] — if `useAliases`, emit `in:record:$wsR` etc. instead of GUIDs */
  function wsFormatScopeTokens(scope, opts) {
    if (!scope) return '';
    const use = opts && opts.useAliases;
    const p=[];
    if (scope.inRecordGuid) p.push('in:record:'+(use?WS_SCOPE_ALIAS_RECORD:scope.inRecordGuid));
    if (scope.inCollectionGuid) p.push('in:col:'+(use?WS_SCOPE_ALIAS_COL:scope.inCollectionGuid));
    if (scope.underLineGuid) p.push('under:line:'+(use?WS_SCOPE_ALIAS_LINE:scope.underLineGuid));
    return p.join(' ');
  }
  function wsMergeScopeIntoQuery(query, scope, opts) {
    const stripped=wsStripScopeQuery(query);
    const prefix=wsFormatScopeTokens(scope, opts);
    if (!prefix) return stripped;
    return (stripped?prefix+' '+stripped:prefix).trim();
  }
  /**
   * Build a persisted search string with literal GUID scope tokens (never `$ws*`), so restores work
   * even when `_scopeAliasResolved` was not set (e.g. ⌃Space saved picker).
   */
  function wsCanonicalPersistedQuery(raw, resolved) {
    const expanded = wsResolveScopeAliases(String(raw || ''), resolved || {});
    const { rest, scope } = wsExtractScope(expanded);
    return wsMergeScopeIntoQuery(rest, scope, { useAliases: false }).trim();
  }
  /**
   * Replace role tokens with GUIDs from the panel map (set when using the Scope picker).
   * @param {{underLineGuid?:string|null,inRecordGuid?:string|null,inCollectionGuid?:string|null}} resolved
   */
  function wsResolveScopeAliases(raw, resolved) {
    let s=String(raw||'');
    const r=resolved||{};
    if (r.underLineGuid) s=s.replace(new RegExp('\\bunder:line:'+WS_SCOPE_ALIAS_LINE.replace(/\$/g,'\\$')+'\\b','gi'),'under:line:'+r.underLineGuid);
    if (r.inRecordGuid) s=s.replace(new RegExp('\\bin:record:'+WS_SCOPE_ALIAS_RECORD.replace(/\$/g,'\\$')+'\\b','gi'),'in:record:'+r.inRecordGuid);
    if (r.inCollectionGuid) s=s.replace(new RegExp('\\bin:col:'+WS_SCOPE_ALIAS_COL.replace(/\$/g,'\\$')+'\\b','gi'),'in:col:'+r.inCollectionGuid);
    return s;
  }

  function wsReEsc(str) {
    return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  /**
   * When a saved query contains literal GUIDs, convert them to `$wsL` / `$wsR` / `$wsC` and return the map for `_scopeAliasResolved`.
   * Uses the same last-match semantics as `wsExtractScope` per prefix. Skips if the value is already a role token.
   */
  function wsQueryGuidsToScopeAliases(raw) {
    let s=String(raw||'');
    const resolved={ underLineGuid:null,inRecordGuid:null,inCollectionGuid:null };
    const steps=[
      [/\bunder:line:(\S+)/gi,'underLineGuid',WS_SCOPE_ALIAS_LINE,'under:line:'],
      [/\bin:record:(\S+)/gi,'inRecordGuid',WS_SCOPE_ALIAS_RECORD,'in:record:'],
      [/\bin:col:(\S+)/gi,'inCollectionGuid',WS_SCOPE_ALIAS_COL,'in:col:'],
    ];
    const tokSet=new Set([WS_SCOPE_ALIAS_LINE,WS_SCOPE_ALIAS_RECORD,WS_SCOPE_ALIAS_COL]);
    for (const [re,key,tok,prefix] of steps) {
      const matches=[...s.matchAll(re)];
      if (!matches.length) continue;
      const lastCap=matches[matches.length-1][1];
      if (tokSet.has(lastCap)) continue;
      resolved[key]=lastCap;
      const esc=wsReEsc(lastCap);
      s=s.replace(new RegExp('\\b'+wsReEsc(prefix)+esc+'(?=\\s|$)','gi'),prefix+tok);
    }
    return { text:s,resolved };
  }

  /** Cursor-local autocomplete context: #tag, bare @person, ` or `→ OR, ` and `→ AND, or `word:` operators. */
  function wsAcDetectContext(beforeCursor) {
    const b=String(beforeCursor||'');
    if (/\s+OR\s*$/.test(b)) return null;
    if (/\s+AND\s*$/.test(b)) return null;
    const orM=b.match(/\s+or\s*$/i);
    if (orM) return { type:'or', replaceStart:b.length-orM[0].length, replaceEnd:b.length, prefix:'' };
    const andM=b.match(/\s+and\s*$/i);
    if (andM) return { type:'and', replaceStart:b.length-andM[0].length, replaceEnd:b.length, prefix:'' };
    const colonM=b.match(/(?:^|[\s])([\w\-]*)?:$/);
    if (colonM) return { type:'colon', prefix:(colonM[1]||'').toLowerCase(), replaceStart:b.length-colonM[0].length, replaceEnd:b.length };
    const tagM=b.match(/#([^\s#]*)$/);
    if (tagM) return { type:'tag', prefix:tagM[1].toLowerCase(), replaceStart:b.length-tagM[0].length, replaceEnd:b.length };
    const atM=b.match(/@([^\s@]*)$/);
    if (atM) {
      const atIdx=atM.index;
      if (atIdx>0&&b[atIdx-1]==='\\') return null;
      if (atIdx>0&&/\w/.test(b[atIdx-1])) return null;
      return {
        type:'person',
        prefix:atM[1].toLowerCase(),
        replaceStart:atIdx,
        replaceEnd:b.length
      };
    }
    return null;
  }

  function wsSortSearchResultsByCollectionTitle(entries) {
    if (!entries||!entries.length) return [];
    const buckets=new Map(),colOrder=[],seen=new Set();
    for (const e of entries) {
      const g=e.collectionGuid||'';
      if (!buckets.has(g)) buckets.set(g,[]);
      buckets.get(g).push(e);
      if (!seen.has(g)) { seen.add(g); colOrder.push(g); }
    }
    const out=[];
    for (const g of colOrder) {
      const list=buckets.get(g);
      list.sort((a,b)=>String(a.displayName||a.name||'').toLowerCase().localeCompare(String(b.displayName||b.name||'').toLowerCase(),undefined,{sensitivity:'base'}));
      out.push(...list);
    }
    return out;
  }
  /**
   * Segment types whose text contributes to search, `under:line:` subtree index, and previews.
   * Includes **`link`** (URLs) and **`ref`** (outline links to records / external targets — not **`mention`**, which stores a person GUID string).
   */
  const WS_LINE_TEXT_SEGMENT_TYPES = ['text','bold','italic','code','hashtag','link','ref','url','bookmark','hyperlink'];

  /** Object shapes used by `link` / `ref` / similar segments for display text. */
  function wsPlainTextFromLinkLikeObject(o) {
    if (!o || typeof o !== 'object') return '';
    const keys = ['name','title','label','displayName','text','url','href'];
    for (const k of keys) {
      if (typeof o[k] === 'string' && o[k]) return o[k];
    }
    return '';
  }

  /** Plain text from a line segment for indexing and display; supports link/ref labels and URL fallbacks. */
  function wsPlainTextFromSegment(s) {
    try {
      if (!s) return '';
      if (typeof s.text === 'string') return s.text;
      if (s.text && typeof s.text === 'object') {
        const fromObj = wsPlainTextFromLinkLikeObject(s.text);
        if (fromObj) return fromObj;
      }
      for (const k of ['label','name','title','displayName']) {
        if (typeof s[k] === 'string' && s[k]) return s[k];
      }
      if (s.type === 'link' || s.type === 'ref' || s.type === 'url' || s.type === 'bookmark' || s.type === 'hyperlink') {
        if (typeof s.url === 'string') return s.url;
        if (typeof s.href === 'string') return s.href;
      }
      return '';
    } catch (e) { return ''; }
  }

  /** When segments use uncommon `type` values, still recover outline link text (record title, URL, etc.). */
  function wsTextFromLineItemFallback(li) {
    try {
      if (typeof li.plainText === 'string' && li.plainText.trim()) return li.plainText.trim();
      if (typeof li.text === 'string' && li.text.trim()) return li.text.trim();
      if (typeof li.content === 'string' && li.content.trim()) return li.content.trim();
      for (const m of ['getPlainText','getLineText','getText','getDisplayText','toPlainText','getPreviewText']) {
        try {
          if (typeof li[m] === 'function') {
            const t = li[m]();
            if (typeof t === 'string' && t.trim()) return t.trim();
          }
        } catch (e2) {}
      }
    } catch (e) {}
    return '';
  }

  /**
   * Resolve a ref/link target GUID: indexed record → `getRecord` → **collection or global plugin** via
   * `getPluginByGuid` (collection links use the collection’s plugin GUID, not a record GUID) → People name.
   */
  function wsResolveGuidTargetTitle(guid, recordEntryMap, data, peopleIndex) {
    if (typeof guid !== 'string' || guid.length < 8) return '';
    const ent = recordEntryMap && recordEntryMap.get(guid);
    if (ent) {
      const n = (ent.displayName || ent.name || '').trim();
      return n || '(untitled)';
    }
    if (data && typeof data.getRecord === 'function') {
      try {
        const r = data.getRecord(guid);
        if (r && typeof r.getName === 'function') {
          const nm = (r.getName() || '').trim();
          if (nm) return nm;
          return '(untitled)';
        }
      } catch (e) {}
    }
    if (data && typeof data.getPluginByGuid === 'function') {
      try {
        const plug = data.getPluginByGuid(guid);
        if (plug && typeof plug.getName === 'function') {
          const nm = (plug.getName() || '').trim();
          if (nm) return nm;
        }
      } catch (e) {}
    }
    if (peopleIndex && peopleIndex.isConfigured()) {
      const pn = peopleIndex.getDisplayName(guid);
      if (pn) return pn;
    }
    return '';
  }

  /** Footer / UI copy: ⌘ on Apple platforms, Ctrl elsewhere. */
  function wsModClickLinkHint() {
    try {
      if (typeof navigator !== 'undefined' && navigator.userAgentData && navigator.userAgentData.platform === 'macOS') return '⌘+click opens link';
      if (typeof navigator !== 'undefined' && /Mac|iPhone|iPod|iPad/i.test(navigator.platform || '')) return '⌘+click opens link';
    } catch (e) {}
    return 'Ctrl+click opens link';
  }

  /**
   * First navigable link target on a line: workspace record (`getRecord`) or collection/global plugin (`getPluginByGuid`).
   */
  function wsPreviewLineLinkTarget(li, data) {
    if (!li || !data) return null;
    const tryGuid = (g) => {
      if (typeof g !== 'string' || g.length < 8) return null;
      try {
        if (typeof data.getRecord === 'function') {
          const r = data.getRecord(g);
          if (r) return { kind: 'record', guid: g };
        }
      } catch (e) {}
      try {
        if (typeof data.getPluginByGuid === 'function') {
          const plug = data.getPluginByGuid(g);
          if (plug) return { kind: 'collection', guid: g };
        }
      } catch (e) {}
      return null;
    };
    for (const k of ['linkedRecordGuid', 'linked_record_guid', 'targetRecordGuid', 'target_guid', 'rootRecordGuid', 'recordLinkGuid', 'linkRecordGuid', 'link_guid']) {
      const t = tryGuid(li[k]);
      if (t) return t;
    }
    for (const seg of li.segments || []) {
      if ((seg.type === 'ref' || seg.type === 'link') && seg.text && typeof seg.text === 'object' && seg.text.guid) {
        const t = tryGuid(seg.text.guid);
        if (t) return t;
      }
    }
    return null;
  }

  /**
   * Outline links to other notes often use `ref` segments with only a target **guid** (no title in JSON).
   * Resolve via `wsResolveGuidTargetTitle` (index, record, **collection**, people).
   */
  function wsLinkedRecordTitleFromLine(li, recordEntryMap, data) {
    if (!recordEntryMap || !li) return '';
    try {
      const tryEntry = (guid) => wsResolveGuidTargetTitle(guid, recordEntryMap, data, null);
      for (const k of ['linkedRecordGuid','linked_record_guid','targetRecordGuid','target_guid','rootRecordGuid','recordLinkGuid','linkRecordGuid','link_guid']) {
        const t = tryEntry(li[k]);
        if (t) return t;
      }
      for (const seg of li.segments || []) {
        if ((seg.type === 'ref' || seg.type === 'link') && seg.text && typeof seg.text === 'object' && seg.text.guid) {
          const t = tryEntry(seg.text.guid);
          if (t) return t;
        }
      }
    } catch (e) {}
    return '';
  }

  /**
   * Single-line label for scope / mention previews when raw `wsTextFromLineItem` is empty (outline links, refs).
   * Uses index → record → **collection / plugin** → People. No GUID/line-id placeholders.
   * Returns **''** when there is nothing to show — caller should **skip** that row.
   */
  function wsPreviewLineLabel(li, rawText, recordEntryMap, peopleIndex, data) {
    const t = String(rawText || '').trim();
    if (t) return t;
    const linked = wsLinkedRecordTitleFromLine(li, recordEntryMap, data);
    if (linked) return linked;
    try {
      for (const seg of li.segments || []) {
        const o = seg && seg.text && typeof seg.text === 'object' ? seg.text : null;
        const g = o && typeof o.guid === 'string' ? o.guid : null;
        if (!g) continue;
        if (seg.type === 'ref' || seg.type === 'link') {
          const name = wsResolveGuidTargetTitle(g, recordEntryMap, data, peopleIndex);
          if (name) return name;
          return '';
        }
      }
    } catch (e) {}
    return '';
  }

  /**
   * @param {object} li — line item from `record.getLineItems`
   * @param {{recordEntryMap?: Map<string, object>, data?: object}} [opts] — pass `recordEntryMap: index._entries`; optional `data` for `getRecord` titles off-index
   */
  function wsTextFromLineItem(li, opts) {
    try {
      opts = opts || {};
      const recordEntryMap = opts.recordEntryMap;
      const data = opts.data;
      const segs = li.segments || [];
      let out = segs
        .filter(s => WS_LINE_TEXT_SEGMENT_TYPES.includes(s.type))
        .map(wsPlainTextFromSegment)
        .join('')
        .trim();
      if (!out) {
        out = segs
          .filter(s => s.type !== 'mention')
          .map(wsPlainTextFromSegment)
          .join('')
          .trim();
      }
      if (!out) out = wsTextFromLineItemFallback(li);
      if (!out) out = wsLinkedRecordTitleFromLine(li, recordEntryMap, data);
      return out;
    } catch (e) { return ''; }
  }
  /** Per-line-guid → lowercased text of that line plus all descendants (for `under:line:`). */
  function wsBuildSubtreeLowerMap(recordGuid, lineItems, recordEntryMap) {
    const memo=new Map();
    const byGuid=new Map((lineItems||[]).map(li=>[li.guid,li]));
    const children=new Map();
    for (const li of lineItems||[]) {
      let p=wsLineParentGuid(li);
      if (p==null||p===undefined||p===recordGuid) p=recordGuid;
      if (!children.has(p)) children.set(p,[]);
      children.get(p).push(li);
    }
    function dfs(nodeGuid) {
      if (memo.has(nodeGuid)) return memo.get(nodeGuid);
      const li=byGuid.get(nodeGuid);
      if (!li) { memo.set(nodeGuid,''); return ''; }
      let t=wsTextFromLineItem(li,{recordEntryMap}).toLowerCase();
      for (const ch of (children.get(nodeGuid)||[])) t+=' '+dfs(ch.guid);
      const out=t.replace(/\s+/g,' ').trim();
      memo.set(nodeGuid,out);
      return out;
    }
    for (const li of lineItems||[]) dfs(li.guid);
    return memo;
  }
  /** Line guids in subtree rooted at anchorLineGuid (including anchor), for previews. */
  function wsCollectSubtreeLineGuids(recordGuid,lineItems,anchorLineGuid) {
    if (!anchorLineGuid) return new Set();
    const children=new Map();
    for (const li of lineItems||[]) {
      let p=wsLineParentGuid(li);
      if (p==null||p===undefined||p===recordGuid) p=recordGuid;
      if (!children.has(p)) children.set(p,[]);
      children.get(p).push(li);
    }
    const out=new Set();
    function dfs(gid) {
      out.add(gid);
      for (const ch of (children.get(gid)||[])) dfs(ch.guid);
    }
    dfs(anchorLineGuid);
    return out;
  }
  function wsTextMatchesQueryLower(textLower,phrases,terms) {
    if (phrases.length&&!phrases.every(p=>textLower.includes(p))) return false;
    if (terms.length&&!terms.every(t=>textLower.includes(t))) return false;
    return true;
  }
  /** Whether a line’s lowercased text satisfies the query’s text clauses (OR = any group). */
  function wsLineTextMatchesParsedQuery(textLower,parsed) {
    if (!parsed) return true;
    if (parsed.type==='or') {
      return parsed.groups.some(g=>{
        const ph=g.phrases||[], t=g.terms||[];
        if (!ph.length&&!t.length) return true;
        if ((g.textScope||'both')==='title') return false;
        return wsTextMatchesQueryLower(textLower,ph,t);
      });
    }
    if (parsed.type==='all') {
      return parsed.groups.every(g=>{
        const ph=g.phrases||[], t=g.terms||[];
        if (!ph.length&&!t.length) return true;
        if ((g.textScope||'both')==='title') return false;
        return wsTextMatchesQueryLower(textLower,ph,t);
      });
    }
    const ph=parsed.phrases||[], t=parsed.terms||[];
    if (!ph.length&&!t.length) return true;
    if ((parsed.textScope||'both')==='title') return false;
    return wsTextMatchesQueryLower(textLower,ph,t);
  }
  /** Preview: include a line if it fully matches the text query, or contains any term/phrase (so split terms across lines still surface hits). */
  function wsLineMatchesUnderPreviewLine(textLower,parsed) {
    if (!parsed) return true;
    if (wsLineTextMatchesParsedQuery(textLower,parsed)) return true;
    if (parsed.type==='or') {
      return parsed.groups.some(g=>{
        if ((g.textScope||'both')==='title') return false;
        const ph=g.phrases||[], t=g.terms||[];
        return ph.some(p=>textLower.includes(p))||t.some(x=>textLower.includes(x));
      });
    }
    if (parsed.type==='all') {
      return parsed.groups.every(g=>{
        if ((g.textScope||'both')==='title') return false;
        const ph=g.phrases||[], t=g.terms||[];
        if (!ph.length&&!t.length) return true;
        return ph.some(p=>textLower.includes(p))||t.some(x=>textLower.includes(x));
      });
    }
    if ((parsed.textScope||'both')==='title') return false;
    const ph=parsed.phrases||[], t=parsed.terms||[];
    return ph.some(p=>textLower.includes(p))||t.some(x=>textLower.includes(x));
  }
  /** Person GUIDs from ref / mention segments on a line item. */
  function wsLinePersonGuids(li) {
    const s=new Set();
    for (const seg of (li.segments||[])) {
      if (seg.type==='ref'&&seg.text&&typeof seg.text==='object'&&seg.text.guid) s.add(seg.text.guid);
      if (seg.type==='mention'&&typeof seg.text==='string'&&seg.text) s.add(seg.text);
    }
    return s;
  }
  /**
   * Resolved person GUIDs from @ / mentions: query clauses. Null = no person filter (no badges in scope preview).
   */
  function wsResolveQueryPersonGuids(parsed, peopleIndex) {
    const pf=wsPersonPreviewFilter(parsed);
    if (!pf||!peopleIndex.isConfigured()) return null;
    const out=new Set();
    for (const ref of pf.mentionRefs||[]) {
      const guids=peopleIndex.resolve(ref.wildcard?ref.token+'*':ref.token);
      for (const g of guids) out.add(g);
    }
    for (const ref of pf.personRefs||[]) {
      const guids=peopleIndex.resolve(ref.wildcard?ref.token+'*':ref.token);
      for (const g of guids) out.add(g);
    }
    return out;
  }
  /** Expanded in:record / under:line preview row: line text + @ badges (mentions-style). `displayText` is usually from `wsPreviewLineLabel`. */
  function wsCreateScopePreviewLineDiv(entry, li, depth, displayText, peopleIndex, parsed, onLineAction) {
    const lineGuids=wsLinePersonGuids(li);
    const queryGuids=wsResolveQueryPersonGuids(parsed, peopleIndex);
    let toShow;
    if (queryGuids===null) {
      toShow=new Set();
    } else {
      toShow=new Set();
      for (const g of lineGuids) if (queryGuids.has(g)) toShow.add(g);
    }
    const div=document.createElement('div');
    div.className='ws-preview-line';
    div.style.cssText='display:flex;align-items:baseline;gap:6px;';
    div.style.paddingLeft=(10+Math.min(depth,12)*14)+'px';
    const textSpan=document.createElement('span');
    textSpan.style.cssText='flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
    const show = String(displayText || '').slice(0, 180) || (li.type === 'task' ? '(task)' : '');
    textSpan.textContent = show || (li.guid ? '(empty line)' : '');
    div.appendChild(textSpan);
    for (const guid of toShow) {
      const displayName=peopleIndex.isConfigured()?peopleIndex.getDisplayName(guid):'';
      if (!displayName) continue;
      const badge=document.createElement('span');
      badge.className='ws-preview-person-badge';
      badge.textContent='@'+displayName;
      div.appendChild(badge);
    }
    const ig=li.guid;
    div.addEventListener('click',(e)=>{ e.stopPropagation(); onLineAction(e,entry,li,ig); });
    div.addEventListener('contextmenu',(e)=>{ e.preventDefault(); e.stopPropagation(); onLineAction(e,entry,li,ig); });
    return div;
  }
  async function wsFilterTaskLinesForPreview(record,lineItems,wantCompleted) {
    if (wantCompleted!==true&&wantCompleted!==false) return [];
    const roots=wsRootLineItems(record,lineItems);
    const out=[];
    await wsForEachLineItemDeep(roots,(li,depth)=>{ try { if (li.type!=='task') return; const match=wantCompleted===true?wsTaskLineIsDone(li):wsTaskLineIsOpen(li); if (match) out.push({li,depth}); } catch(e) {} });
    return out;
  }

  // ─── People Index ─────────────────────────────────────────────────────────────

  class PeopleIndex {
    constructor() {
      this._records = new Map();    // nameLower → record (or array for prefix)
      this._guidToName = new Map(); // guid → displayName
      this._colGuid = null;
      this._nameProp = null;        // null = use record title
    }

    configure(colGuid, nameProp) {
      this._colGuid = colGuid || null;
      this._nameProp = nameProp || null;
    }

    build(allCollections, allColData) {
      this._records.clear();
      this._guidToName.clear();
      if (!this._colGuid) return;
      const col = allCollections.find(c => c.getGuid() === this._colGuid);
      if (!col) return;
      const colEntry = allColData.find(d => d.col.getGuid() === this._colGuid);
      const records = colEntry ? colEntry.records : [];
      for (const rec of records) {
        let name;
        if (this._nameProp) {
          try { name = rec.text(this._nameProp) || rec.getName() || ''; } catch(e) { name = rec.getName() || ''; }
        } else {
          name = rec.getName() || '';
        }
        const key = name.toLowerCase().trim();
        if (!key) continue;
        this._records.set(key, rec);
        this._guidToName.set(rec.guid, name);
      }
    }

    /** Resolve @token to array of GUIDs. token may end with * for prefix match. */
    resolve(token) {
      const t = String(token||'').toLowerCase().trim();
      if (!t) return [];
      if (t.endsWith('*')) {
        const prefix = t.slice(0,-1);
        const out = [];
        for (const [key, rec] of this._records) {
          if (key.startsWith(prefix)) out.push(rec.guid);
        }
        return out;
      }
      const rec = this._records.get(t);
      return rec ? [rec.guid] : [];
    }

    getDisplayName(guid) { return this._guidToName.get(guid) || null; }
    isConfigured()       { return !!this._colGuid; }
    size()               { return this._records.size; }

    /** @param prefix lowercased partial after @ */
    suggestByPrefix(prefix,limit=30) {
      const p=String(prefix||'').toLowerCase();
      const out=[];
      for (const [key,rec] of this._records) {
        if (!p||key.startsWith(p)) {
          const label=this._guidToName.get(rec.guid)||key;
          out.push({ key, label, insert:'@'+key });
        }
      }
      out.sort((a,b)=>String(a.label).localeCompare(String(b.label),undefined,{sensitivity:'base'}));
      return out.slice(0,limit);
    }
  }

  // ─── Query Parser ─────────────────────────────────────────────────────────────

  class QueryParser {
    parse(raw) {
      const { rest, scope } = wsExtractScope(raw || '');
      const trimmed = rest.trim();
      if (!trimmed && !wsScopeHas(scope)) return null;
      if (!trimmed) {
        const empty = this._parseSegment('');
        return empty ? { type: 'and', ...empty, scope } : null;
      }
      const orParts = trimmed.split(/\s+OR\s+/).map(s => s.trim()).filter(Boolean);
      if (orParts.length > 1) {
        const groups = orParts.map(op => this._parseAndOrSingle(op, scope)).filter(Boolean);
        return groups.length ? { type: 'or', groups, scope } : null;
      }
      return this._parseAndOrSingle(orParts[0], scope);
    }

    /** One top-level OR fragment: either a single segment or `type: 'all'` (AND of segments). */
    _parseAndOrSingle(trimmed, scope) {
      const andParts = trimmed.split(/\s+AND\s+/).map(s => s.trim()).filter(Boolean);
      if (andParts.length > 1) {
        const groups = andParts.map(p => this._parseSegment(p)).filter(Boolean);
        return groups.length ? { type: 'all', groups, scope } : null;
      }
      const seg = this._parseSegment(andParts[0] || '');
      if (!seg) return wsScopeHas(scope) ? { type: 'and', ...this._parseSegment(''), scope } : null;
      return { type: 'and', ...seg, scope };
    }

    _parseSegment(raw) {
      if (raw === undefined || raw === null) return null;
      if (!String(raw).trim()) {
        return { includeTags:[],excludeTags:[],phrases:[],excludePhrases:[],excludeTerms:[],terms:[],isCompleted:null,personRefs:[],mentionRefs:[],dateFilters:{created:null,updated:null},textScope:'both' };
      }
      let s=String(raw).trim();
      let textScope='both';
      const head=s.match(/^(title|body):\s*/i);
      if (head) {
        textScope=head[1].toLowerCase()==='title'?'title':'body';
        s=s.slice(head[0].length);
      }
      const includeTags=[],excludeTags=[],phrases=[],excludeTerms=[];
      const personRefs=[];      // { token, wildcard, mode:'backlink'|'field', field:string|null }
      const mentionRefs=[];     // { token, wildcard }
      let isCompleted=null;

      // is:completed / -is:completed
      if (/\-is:completed\b/.test(s))  { isCompleted=false; s=s.replace(/-is:completed\b/g,' '); }
      if (/\bis:completed\b/.test(s))  { isCompleted=true;  s=s.replace(/\bis:completed\b/g,' '); }

      // created: / updated: (date filters; values stripped before text parse)
      const dateFilters={ created:null,updated:null };
      for (const kind of ['created','updated']) {
        for (const m of s.matchAll(new RegExp(`\\b${kind}:(\\S+)`,'gi'))) {
          const intv=wsParseDateClauseValue(m[1]);
          if (intv) dateFilters[kind]=wsIntersectDateInterval(dateFilters[kind],intv);
        }
        s=s.replace(new RegExp(`\\b${kind}:\\S+`,'gi'),' ');
      }

      // mentions:@name or mentions:@name*
      for (const m of [...s.matchAll(/\bmentions:@(\S+)/g)]) {
        const tok=m[1]; const wc=tok.endsWith('*');
        mentionRefs.push({ token: wc?tok.slice(0,-1):tok, wildcard:wc });
      }
      s=s.replace(/\bmentions:@\S+/g,' ');

      // fieldname:@name or fieldname:@name* — generic property person filter
      for (const m of [...s.matchAll(/\b([a-zA-Z][a-zA-Z0-9_\s-]*?):@(\S+)/g)]) {
        const field=m[1].trim().toLowerCase(), tok=m[2]; const wc=tok.endsWith('*');
        personRefs.push({ token:wc?tok.slice(0,-1):tok, wildcard:wc, mode:'field', field });
      }
      s=s.replace(/\b[a-zA-Z][a-zA-Z0-9_\s-]*?:@\S+/g,' ');

      // \@name — escaped literal
      const literalAt=[];
      for (const m of [...s.matchAll(/\\@(\S+)/g)]) literalAt.push(m[1].toLowerCase());
      s=s.replace(/\\@\S+/g,' ');

      // @name or @name* — bare person backlink
      for (const m of [...s.matchAll(/@(\S+)/g)]) {
        const tok=m[1]; const wc=tok.endsWith('*');
        personRefs.push({ token:wc?tok.slice(0,-1):tok, wildcard:wc, mode:'backlink', field:null });
      }
      s=s.replace(/@\S+/g,' ');

      // excluded quoted phrases (before include quotes)
      const excludePhrases=[];
      for (const m of s.matchAll(/-\s*"([^"]+)"/g)) excludePhrases.push(m[1].toLowerCase());
      s=s.replace(/-\s*"[^"]+"/g,' ');

      // quoted phrases (include)
      for (const m of [...s.matchAll(/"([^"]+)"/g)]) phrases.push(m[1].toLowerCase());
      s=s.replace(/"[^"]+"/g,' ');

      // tags
      for (const m of [...s.matchAll(/-#([^\s#]+)/g)]) excludeTags.push(wsNormalizeTagToken(m[1]));
      s=s.replace(/-#[^\s#]+/g,' ');
      for (const m of [...s.matchAll(/#([^\s#]+)/g)]) includeTags.push(wsNormalizeTagToken(m[1]));
      s=s.replace(/#[^\s#]+/g,' ');

      // exclude terms
      for (const m of [...s.matchAll(/-(\S+)/g)]) excludeTerms.push(m[1].toLowerCase());
      s=s.replace(/-\S+/g,' ');

      // bare terms — include escaped literals as plain terms
      const terms=[...s.split(/\s+/).map(t=>t.toLowerCase()).filter(Boolean), ...literalAt];

      const hasDate=(dateFilters.created!=null&&!dateFilters.created.empty)||(dateFilters.updated!=null&&!dateFilters.updated.empty);
      const isEmpty=!includeTags.length&&!excludeTags.length&&!phrases.length&&
        !excludeTerms.length&&!excludePhrases.length&&!terms.length&&isCompleted===null&&
        !personRefs.length&&!mentionRefs.length&&!hasDate;
      if (isEmpty) return null;

      return { includeTags,excludeTags,phrases,excludePhrases,excludeTerms,terms,isCompleted,personRefs,mentionRefs,dateFilters,textScope };
    }
  }

  // ─── Search Index ─────────────────────────────────────────────────────────────

  class SearchIndex {
    constructor() {
      this._entries=new Map();
      this._colNames=new Map();
      this._tagPropName='Tags';
      // Person mention reverse index: personGuid → Set<recordGuid>
      this._mentionIndex=new Map();
      // People index
      this._people=new PeopleIndex();
      // Line guid → subtree body (lower) for `under:line:`; line guid → record guid; record → line guids (cleanup)
      this._lineSubtreeLower=new Map();
      this._lineToRecordGuid=new Map();
      this._recordLineGuids=new Map();
    }

    setPeople(peopleIndex) { this._people=peopleIndex; }
    setTagPropName(name)   { this._tagPropName=(typeof name==='string'&&name.trim())?name.trim():'Tags'; }

    _tagPropForRecord(record) {
      const key=this._tagPropName;
      if (!key) return null;
      const variants=new Set([key,key.toLowerCase(),key.toUpperCase()]);
      if (key.length) variants.add(key.charAt(0).toUpperCase()+key.slice(1).toLowerCase());
      if (/\s/.test(key)) variants.add(key.split(/\s+/).map(w=>w.charAt(0).toUpperCase()+w.slice(1).toLowerCase()).join(' '));
      for (const n of variants) { try { const p=record.prop(n); if (p) return p; } catch(e) {} }
      return null;
    }

    /**
     * Atomic rebuild: populate fresh maps first, then swap. If the caller passes an empty list we STILL
     * swap (so unchecking all collections works), but `_buildIndex` never calls us with a transient empty —
     * it guards the wipe on post-reload hydration races at its own level.
     */
    build(colDataList) {
      const entries=new Map(), colNames=new Map();
      for (const {col,records} of colDataList) {
        const cGuid=col.getGuid(),cName=col.getName();
        colNames.set(cGuid,cName);
        for (const record of records) entries.set(record.guid,this._makeEntry(record,cGuid,cName));
      }
      this._entries=entries;
      this._colNames=colNames;
      // Derived caches are rebuilt incrementally by the body index; clear them together so they can't leak
      // references to records that no longer exist.
      this._mentionIndex=new Map();
      this._lineSubtreeLower=new Map();
      this._lineToRecordGuid=new Map();
      this._recordLineGuids=new Map();
    }

    upsert(record,collectionGuid) {
      const colName=this._colNames.get(collectionGuid)||'';
      this._entries.set(record.guid,this._makeEntry(record,collectionGuid,colName));
    }

    registerCollection(guid,name) { this._colNames.set(guid,name); }
    remove(guid) {
      this._entries.delete(guid);
      const lg=this._recordLineGuids.get(guid);
      if (lg) {
        for (const x of lg) {
          this._lineSubtreeLower.delete(x);
          this._lineToRecordGuid.delete(x);
        }
        this._recordLineGuids.delete(guid);
      }
      // Clean up mention index
      for (const [,set] of this._mentionIndex) set.delete(guid);
    }

    /** Rebuild line → subtree text maps for one record (call after getLineItems). */
    indexLineSubtrees(recordGuid,lineItems) {
      const old=this._recordLineGuids.get(recordGuid);
      if (old) {
        for (const x of old) {
          this._lineSubtreeLower.delete(x);
          this._lineToRecordGuid.delete(x);
        }
      }
      const memo=wsBuildSubtreeLowerMap(recordGuid,lineItems,this._entries);
      const newSet=new Set();
      for (const [lg,text] of memo) {
        this._lineSubtreeLower.set(lg,text);
        this._lineToRecordGuid.set(lg,recordGuid);
        newSet.add(lg);
      }
      this._recordLineGuids.set(recordGuid,newSet);
    }

    size()            { return this._entries.size; }
    collectionCount() { return this._colNames.size; }

    /** Unique normalized tags across all indexed entries, sorted. */
    getAllTagsSorted() {
      const s=new Set();
      for (const e of this._entries.values()) {
        for (const t of e.tags||[]) s.add(t);
      }
      return [...s].sort((a,b)=>a.localeCompare(b,undefined,{sensitivity:'base'}));
    }

    _makeEntry(record,collectionGuid,collectionName) {
      let tags=[];
      try { const prop=this._tagPropForRecord(record); if (prop) tags=prop.texts().map(t=>wsNormalizeTagToken(String(t).replace(/^#/,''))).filter(Boolean); } catch(e) {}
      const name=record.getName()||'';
      for (const m of [...name.matchAll(/#([^\s#]+)/g)]) { const t=wsNormalizeTagToken(m[1]); if (!tags.includes(t)) tags.push(t); }
      const displayName=name.replace(/#[^\s#]+/g,'').replace(/\s{2,}/g,' ').trim()||name;
      const times=wsRecordTimeFields(record);
      return { guid:record.guid,name,displayName,nameLower:name.toLowerCase(),tags,collectionGuid,collectionName,record,createdMs:times.createdMs,updatedMs:times.updatedMs };
    }

    /** Add person mention (ref segment) during body indexing. */
    addMention(recordGuid, personGuid) {
      if (!this._mentionIndex.has(personGuid)) this._mentionIndex.set(personGuid,new Set());
      this._mentionIndex.get(personGuid).add(recordGuid);
    }

    /** Get record guids that mention a person guid. */
    getMentioners(personGuid) { return this._mentionIndex.get(personGuid)||new Set(); }

    /** Drop this record from all mention reverse-index sets (before re-extracting mentions). */
    clearMentionsForRecord(recordGuid) {
      for (const [,set] of this._mentionIndex) set.delete(recordGuid);
    }

    updateBodyText(guid,bodyText) {
      const entry=this._entries.get(guid);
      if (entry) entry.bodyLower=String(bodyText||'').toLowerCase();
    }

    updateTaskCompletion(guid,stats) {
      const entry=this._entries.get(guid);
      if (!entry) return;
      entry.hasAnyTask=stats.hasAnyTask;
      entry.hasOpenTask=stats.hasOpenTask;
      entry.hasCompletedTask=stats.hasCompletedTask;
    }

    matchesParsedEntryFilters(entry,parsed) {
      if (!parsed) return true;
      if (!this._entryMatchesScope(entry,parsed.scope)) return false;
      if (parsed.type==='or') return parsed.groups.some(g=>this._entryMatchesOrGroup(entry,g,parsed));
      if (parsed.type==='all') return parsed.groups.every(g=>this._entryMatchesGroup(entry,g,parsed));
      return this._entryMatchesGroup(entry,parsed,parsed);
    }

    _entryMatchesOrGroup(entry,g,parsed) {
      if (g&&g.type==='all') return g.groups.every(g2=>this._entryMatchesGroup(entry,g2,parsed));
      return this._entryMatchesGroup(entry,g,parsed);
    }

    _entryMatchesScope(entry,scope) {
      if (!scope||!wsScopeHas(scope)) return true;
      if (scope.underLineGuid) {
        const rg=this._lineToRecordGuid.get(scope.underLineGuid);
        if (!rg||entry.guid!==rg) return false;
        if (scope.inRecordGuid&&entry.guid!==scope.inRecordGuid) return false;
        if (scope.inCollectionGuid&&entry.collectionGuid!==scope.inCollectionGuid) return false;
        return true;
      }
      if (scope.inRecordGuid&&entry.guid!==scope.inRecordGuid) return false;
      if (scope.inCollectionGuid&&entry.collectionGuid!==scope.inCollectionGuid) return false;
      return true;
    }

    _entryMatchesGroup(entry,group,parsed) {
      const includeTags=group.includeTags||[],excludeTags=group.excludeTags||[];
      if (includeTags.length&&!includeTags.every(t=>wsTagQueryMatches(t,entry.tags))) return false;
      if (excludeTags.some(t=>wsTagExcludeMatches(t,entry.tags))) return false;
      if (!wsMatchesCompletionFilter(entry,group.isCompleted)) return false;
      const df=group.dateFilters;
      if (!wsEntryMatchesDateFilters(entry,df||null)) return false;
      const excludeTerms=group.excludeTerms||[],excludePhrases=group.excludePhrases||[];
      const scope=parsed&&parsed.scope?parsed.scope:{};
      const ts=group.textScope||'both';
      let combined;
      if (scope.underLineGuid) {
        const sub=this._lineSubtreeLower.get(scope.underLineGuid);
        if (sub===undefined) return false;
        combined=sub;
      } else if (ts==='title') {
        combined=entry.nameLower;
      } else if (ts==='body') {
        combined=entry.bodyLower!==undefined?entry.bodyLower:'';
      } else {
        const bodyText=entry.bodyLower!==undefined?entry.bodyLower:'';
        combined=bodyText?entry.nameLower+' '+bodyText:entry.nameLower;
      }
      if (excludeTerms.some(t=>combined.includes(t))) return false;
      if (excludePhrases.some(p=>combined.includes(p))) return false;
      return true;
    }

    /**
     * Resolve all person filters in a parsed group to sets of matching record guids.
     * Returns null if no person filters present (meaning no restriction).
     * Returns a Set<recordGuid> if person filters are present.
     */
    _resolvePersonFilters(group) {
      const personRefs  = group.personRefs  || [];
      const mentionRefs = group.mentionRefs || [];
      if (!personRefs.length && !mentionRefs.length) return null;

      const allowed = new Set();

      // @name / fieldname:@name
      for (const ref of personRefs) {
        const guids = this._people.resolve(ref.wildcard ? ref.token+'*' : ref.token);
        if (!guids.length) continue; // unresolved → produces no results

        if (ref.mode==='backlink') {
          // Scan all entries for any record-type property containing any of these GUIDs
          for (const entry of this._entries.values()) {
            if (this._entryLinksToAnyGuid(entry, guids)) allowed.add(entry.guid);
          }
        } else if (ref.mode==='field') {
          // Scan entries for the named property
          for (const entry of this._entries.values()) {
            if (this._entryFieldLinksToAnyGuid(entry, ref.field, guids)) allowed.add(entry.guid);
          }
        }
      }

      // mentions:@name — use reverse mention index
      for (const ref of mentionRefs) {
        const guids = this._people.resolve(ref.wildcard ? ref.token+'*' : ref.token);
        for (const pg of guids) {
          for (const rg of this.getMentioners(pg)) allowed.add(rg);
        }
      }

      return allowed;
    }

    _entryLinksToAnyGuid(entry, guids) {
      const guidSet = new Set(guids);
      try {
        const props = entry.record.getAllProperties();
        for (const p of props) {
          try {
            const linked = p.linkedRecords();
            if (linked && linked.some(r => guidSet.has(r.guid))) return true;
          } catch(e) {}
        }
      } catch(e) {}
      return false;
    }

    _entryFieldLinksToAnyGuid(entry, fieldNameLower, guids) {
      const guidSet = new Set(guids);
      try {
        const props = entry.record.getAllProperties();
        for (const p of props) {
          if ((p.name||'').toLowerCase().trim() !== fieldNameLower) continue;
          try {
            const linked = p.linkedRecords();
            if (linked && linked.some(r => guidSet.has(r.guid))) return true;
          } catch(e) {}
        }
      } catch(e) {}
      return false;
    }

    queryWithBody(parsed, limit=150) {
      if (!parsed) return {nameMatches:[],bodyMatches:[]};
      if (parsed.type==='or') {
        const nameSeen=new Map(),bodySeen=new Map();
        for (const group of parsed.groups) {
          const {nameMatches,bodyMatches}=this._filterOrGroupWithBody(group,limit,parsed);
          for (const e of nameMatches) { if (!nameSeen.has(e.guid)) nameSeen.set(e.guid,e); }
          for (const e of bodyMatches) { if (!nameSeen.has(e.guid)&&!bodySeen.has(e.guid)) bodySeen.set(e.guid,e); }
          if (nameSeen.size+bodySeen.size>=limit) break;
        }
        return {nameMatches:[...nameSeen.values()],bodyMatches:[...bodySeen.values()]};
      }
      if (parsed.type==='all') return this._filterAllWithBody(parsed,limit,parsed);
      return this._filterGroupWithBody(parsed,limit,parsed);
    }

    _filterOrGroupWithBody(group,limit,parsed) {
      if (group&&group.type==='all') return this._filterAllWithBody(group,limit,parsed);
      return this._filterGroupWithBody(group,limit,parsed);
    }

    /** Intersection of matches for each AND conjunct (full scan per conjunct; then intersect guids). */
    _filterAllWithBody(andParsed,limit,outerParsed) {
      const INNER=Number.MAX_SAFE_INTEGER;
      const partResults=andParsed.groups.map(g=>this._filterGroupWithBody(g,INNER,outerParsed));
      if (!partResults.length) return {nameMatches:[],bodyMatches:[]};
      let guidSet=null;
      for (const pr of partResults) {
        const s=new Set();
        for (const e of pr.nameMatches) s.add(e.guid);
        for (const e of pr.bodyMatches) s.add(e.guid);
        if (guidSet===null) guidSet=s;
        else guidSet=new Set([...guidSet].filter(g=>s.has(g)));
        if (!guidSet.size) return {nameMatches:[],bodyMatches:[]};
      }
      const wantsBody=andParsed.groups.some(g=>{
        const hasText=!!((g.phrases&&g.phrases.length)||(g.terms&&g.terms.length));
        return hasText&&(g.textScope||'both')!=='title';
      });
      const entries=[...guidSet].map(g=>this._entries.get(g)).filter(Boolean);
      const sorted=wsSortSearchResultsByCollectionTitle(entries);
      const truncated=sorted.slice(0,limit);
      if (wantsBody) return {nameMatches:[],bodyMatches:truncated.map(e=>({...e,_bodyMatch:true}))};
      return {nameMatches:truncated,bodyMatches:[]};
    }

    _filterGroupWithBody(group,limit,parsed) {
      const {includeTags,excludeTags,phrases,excludeTerms,excludePhrases=[],terms,isCompleted=null,dateFilters,textScope:tsRaw}=group;
      const ts=tsRaw||'both';
      const nameMatches=[],bodyMatches=[];
      const scope=parsed&&parsed.scope?parsed.scope:{};

      if (dateFilters?.created?.empty||dateFilters?.updated?.empty) return {nameMatches,bodyMatches};

      // Resolve person filters to an allowed set (null = no restriction)
      const personAllowed = this._resolvePersonFilters(group);

      for (const entry of this._entries.values()) {
        if (!this._entryMatchesScope(entry,scope)) continue;
        // Person filter gate
        if (personAllowed !== null && !personAllowed.has(entry.guid)) continue;

        if (includeTags.length&&!includeTags.every(t=>wsTagQueryMatches(t,entry.tags))) continue;
        if (excludeTags.some(t=>wsTagExcludeMatches(t,entry.tags))) continue;
        if (!wsMatchesCompletionFilter(entry,isCompleted)) continue;
        if (!wsEntryMatchesDateFilters(entry,dateFilters||null)) continue;

        const underLine=scope.underLineGuid;
        const nameLower=entry.nameLower;
        const bodyOnly=entry.bodyLower!==undefined?entry.bodyLower:'';
        let combined;
        if (underLine) {
          const sub=this._lineSubtreeLower.get(underLine);
          if (sub===undefined) continue;
          combined=sub;
        } else if (ts==='title') {
          combined=nameLower;
        } else if (ts==='body') {
          combined=bodyOnly;
        } else {
          combined=bodyOnly?nameLower+' '+bodyOnly:nameLower;
        }
        if (excludeTerms.some(t=>combined.includes(t))) continue;
        if (excludePhrases.some(p=>combined.includes(p))) continue;

        const hasTextual=!!(phrases.length||terms.length);

        if (!hasTextual) {
          nameMatches.push(entry);
        } else if (underLine) {
          if (this._matchesText(combined,phrases,terms)) bodyMatches.push({...entry,_bodyMatch:true});
        } else if (ts==='title') {
          if (this._matchesText(nameLower,phrases,terms)) nameMatches.push(entry);
        } else if (ts==='body') {
          if (this._matchesText(bodyOnly,phrases,terms)) bodyMatches.push({...entry,_bodyMatch:true});
        } else if (this._matchesText(nameLower,phrases,terms)) {
          nameMatches.push(entry);
        } else if (this._matchesText(combined,phrases,terms)) {
          bodyMatches.push({...entry,_bodyMatch:true});
        }

        if (nameMatches.length+bodyMatches.length>=limit) break;
      }

      const onlyPersonFilter = !!(personAllowed !== null && !phrases.length && !terms.length);
      if (onlyPersonFilter) {
        return {
          nameMatches: nameMatches.map(e=>({...e,_personMatch:true})),
          bodyMatches: bodyMatches.map(e=>({...e,_personMatch:true}))
        };
      }

      return {nameMatches,bodyMatches};
    }

    _matchesText(text,phrases,terms) {
      if (phrases.length&&!phrases.every(p=>text.includes(p))) return false;
      if (terms.length&&!terms.every(t=>text.includes(t))) return false;
      return true;
    }
  }

  // ─── SearchPanel · scope wizard (modal) ─────────────────────────────────────
  const SearchPanelScope = {
    rerenderAndFocus(host) {
      if (host._scopeFilterDebounceTimer) { clearTimeout(host._scopeFilterDebounceTimer); host._scopeFilterDebounceTimer=null; }
      return SearchPanelScope.renderList(host).then(()=>{ if (host._scopePicker) SearchPanelScope.focusDefault(host); });
    },
    focusDefault(host) {
      const sp=host._scopePicker;
      if (!sp?.el?.isConnected) return;
      const filt=sp.el.querySelector('.ws-scope-filter');
      const filterHidden=sp.step==='colConfirm'||sp.step==='confirm';
      const run=()=>{
        if (!host._scopePicker||host._scopePicker!==sp||!sp.el.isConnected) return;
        if (filt&&!filterHidden) {
          try { filt.focus({ preventScroll:true }); } catch(e) { try { filt.focus(); } catch(e2) {} }
          return;
        }
        const list=sp.el.querySelector('.ws-scope-list');
        const btn=list?.querySelector('.ws-btn-primary')||list?.querySelector('button');
        try { btn?.focus({ preventScroll:true }); } catch(e) { try { btn?.focus(); } catch(e2) {} }
      };
      requestAnimationFrame(()=>{ requestAnimationFrame(run); });
    },
    setChrome(sp) {
      const stepbar=sp.el.querySelector('.ws-scope-stepbar');
      const hint=sp.el.querySelector('.ws-scope-step-hint');
      const filt=sp.el.querySelector('.ws-scope-filter');
      if (!stepbar||!hint) return;
      if (sp.step==='collection') {
        stepbar.textContent='Step 1 of 5 · Collection';
        hint.innerHTML='Choose a <b>collection</b>, then search the whole collection or pick a note.';
      } else if (sp.step==='colConfirm') {
        stepbar.textContent=`Step 2 of 5 · “${(sp.colName||'…').replace(/"/g,'')}”`;
        hint.innerHTML='Search the <b>whole collection</b> (<code style="font-size:10px">in:col:</code>) or continue to pick a <b>note</b> (<code style="font-size:10px">in:record:</code>).';
      } else if (sp.step==='record') {
        stepbar.textContent=`Step 3 of 5 · Note in “${(sp.colName||'…').replace(/"/g,'')}`;
        hint.innerHTML='Pick a <b>note</b> in this collection.';
      } else if (sp.step==='confirm') {
        stepbar.textContent='Step 4 of 5 · Note scope';
        hint.innerHTML='Search the <b>whole note</b> (<code style="font-size:10px">in:record:</code>) or continue to limit to a <b>heading</b> (<code style="font-size:10px">under:line:</code>).';
      } else if (sp.step==='lines') {
        stepbar.textContent='Step 5 of 5 · Heading';
        hint.innerHTML='Pick a <b>line</b>; search matches that line and everything nested under it.';
      }
      if (filt) filt.style.display=sp.step==='confirm'||sp.step==='colConfirm'?'none':'';
    },
    close(host) {
      if (host._scopeFilterDebounceTimer) { clearTimeout(host._scopeFilterDebounceTimer); host._scopeFilterDebounceTimer=null; }
      if (!host._scopePicker) return;
      try { host._scopePicker.el.remove(); } catch(e) {}
      host._scopePicker=null;
    },
    open(host) {
      if (host._configMode||host._saveMode) return;
      host._closeAc();
      if (host._scopePicker) return;
      const overlay=document.createElement('div');
      overlay.className='ws-scope-overlay';
      overlay.innerHTML=`<div class="ws-scope-panel" role="dialog" aria-modal="true"><div class="ws-scope-head"><span>Search scope</span><button type="button" class="ws-scope-close" aria-label="Close">${wsIcon('x')}</button></div><div class="ws-scope-stepbar"></div><div class="ws-scope-step-hint ws-scope-hint"></div><input type="search" class="ws-scope-filter" placeholder="Filter…" /><div class="ws-scope-list"></div></div>`;
      host._root.appendChild(overlay);
      host._scopePicker={ el:overlay, step:'collection', colGuid:null, colName:'', recordEntry:null };
      const panel=overlay.querySelector('.ws-scope-panel');
      panel.addEventListener('click',(e)=>e.stopPropagation());
      overlay.addEventListener('click',()=>SearchPanelScope.close(host));
      overlay.querySelector('.ws-scope-close')?.addEventListener('click',()=>SearchPanelScope.close(host));
      overlay.querySelector('.ws-scope-filter')?.addEventListener('input',()=>{
        if (host._scopeFilterDebounceTimer) clearTimeout(host._scopeFilterDebounceTimer);
        host._scopeFilterDebounceTimer=setTimeout(()=>{
          host._scopeFilterDebounceTimer=null;
          void SearchPanelScope.renderList(host);
        },160);
      });
      void SearchPanelScope.renderList(host);
    },
    async renderLines(host) {
      const sp=host._scopePicker;
      if (!sp||sp.step!=='lines'||!sp.recordEntry) return;
      const list=sp.el.querySelector('.ws-scope-list');
      if (!list) return;
      SearchPanelScope.setChrome(sp);
      const filt=(sp.el.querySelector('.ws-scope-filter')?.value||'').toLowerCase().trim();
      const entry=sp.recordEntry;
      let items;
      try { items=await entry.record.getLineItems(false); } catch(e) { items=[]; }
      if (!items.length) {
        list.innerHTML='<button type="button" class="ws-scope-back">← Back</button><div class="ws-scope-hint">No lines in this note.</div>';
        list.querySelector('.ws-scope-back')?.addEventListener('click',()=>{ sp.step='confirm'; void SearchPanelScope.rerenderAndFocus(host); });
        return;
      }
      const roots=wsRootLineItems(entry.record,items);
      const rows=[];
      const em=host._h()._index._entries, pe=host._h()._index._people;
      await wsForEachLineItemDeep(roots,(li,depth)=>{
        if (!li.guid) return;
        const raw=wsTextFromLineItem(li,{recordEntryMap:em,data:host._h().data});
        const label=wsPreviewLineLabel(li,raw,em,pe,host._h().data);
        if (!label) return;
        const line=`${label} ${li.guid}`.toLowerCase();
        if (filt&&!line.includes(filt)) return;
        rows.push({ li, depth, text: label });
      });
      const pad0=6;
      let html='<button type="button" class="ws-scope-back">← Back to scope options</button><div class="ws-scope-hint">Select a line; matching uses this line and nested bullets only.</div>';
      html+=rows.map(({ li, depth, text })=>{
        const pad=pad0+Math.min(depth,12)*14;
        const lab=text.slice(0,120);
        const gid=String(li.guid||'').replace(/"/g,'');
        return `<button type="button" class="ws-scope-item" style="padding-left:${pad}px" data-lineid="${gid}">${wsEsc(lab)}<small>${wsEsc(gid)}</small></button>`;
      }).join('');
      if (!rows.length) html+='<div class="ws-scope-hint">No matching lines</div>';
      list.innerHTML=html;
      list.querySelector('.ws-scope-back')?.addEventListener('click',()=>{ sp.step='confirm'; void SearchPanelScope.rerenderAndFocus(host); });
      for (const b of list.querySelectorAll('[data-lineid]')) {
        b.addEventListener('click',()=>host._applyScopeSelection({ underLineGuid:b.getAttribute('data-lineid'), inRecordGuid:null, inCollectionGuid:null }));
      }
    },
    async renderList(host) {
      const sp=host._scopePicker;
      if (!sp) return;
      const list=sp.el.querySelector('.ws-scope-list');
      if (!list) return;
      SearchPanelScope.setChrome(sp);
      if (sp.step==='lines') {
        await SearchPanelScope.renderLines(host);
        SearchPanelScope.focusDefault(host);
        return;
      }
      const filt=(sp.el.querySelector('.ws-scope-filter')?.value||'').toLowerCase().trim();
      if (sp.step==='collection') {
        const rows=[];
        for (const [guid,name] of host._h()._index._colNames) {
          const n=`${name} ${guid}`.toLowerCase();
          if (filt&&!n.includes(filt)) continue;
          rows.push({ guid,name });
        }
        rows.sort((a,b)=>a.name.localeCompare(b.name));
        list.innerHTML=rows.map(r=>`<button type="button" class="ws-scope-item" data-colid="${r.guid.replace(/"/g,'')}">${wsEsc(r.name)}<small>${wsEsc(r.guid)}</small></button>`).join('')||'<div class="ws-scope-hint">No collections</div>';
        for (const b of list.querySelectorAll('[data-colid]')) {
          b.addEventListener('click',()=>{
            sp.colGuid=b.getAttribute('data-colid');
            sp.colName=host._h()._index._colNames.get(sp.colGuid)||'';
            sp.step='colConfirm';
            sp.recordEntry=null;
            if (sp.el.querySelector('.ws-scope-filter')) sp.el.querySelector('.ws-scope-filter').value='';
            void SearchPanelScope.rerenderAndFocus(host);
          });
        }
        SearchPanelScope.focusDefault(host);
        return;
      }
      if (sp.step==='colConfirm') {
        if (!sp.colGuid) { sp.step='collection'; void SearchPanelScope.rerenderAndFocus(host); return; }
        const title=wsEsc(sp.colName||'Collection');
        const meta=wsEsc(sp.colGuid);
        list.innerHTML=`<div class="ws-scope-confirm">
          <div>
            <div class="ws-scope-confirm-title">${title}</div>
            <div class="ws-scope-confirm-meta">${meta}</div>
          </div>
          <div class="ws-scope-confirm-actions">
            <button type="button" class="ws-btn ws-btn-primary" data-scope-col-done="inCol">Search in this collection — add <code style="font-size:10px">in:col:</code></button>
            <button type="button" class="ws-btn ws-btn-secondary" data-scope-col-done="pickNote">Choose a note — <code style="font-size:10px">in:record:</code>…</button>
            <button type="button" class="ws-scope-back" style="margin-top:4px">← Change collection</button>
          </div>
        </div>`;
        list.querySelector('[data-scope-col-done="inCol"]')?.addEventListener('click',()=>{
          host._applyScopeSelection({ inCollectionGuid:sp.colGuid, inRecordGuid:null, underLineGuid:null });
        });
        list.querySelector('[data-scope-col-done="pickNote"]')?.addEventListener('click',()=>{
          sp.step='record';
          if (sp.el.querySelector('.ws-scope-filter')) sp.el.querySelector('.ws-scope-filter').value='';
          void SearchPanelScope.rerenderAndFocus(host);
        });
        list.querySelector('.ws-scope-back')?.addEventListener('click',()=>{
          sp.step='collection';
          sp.colGuid=null;
          sp.colName='';
          sp.recordEntry=null;
          if (sp.el.querySelector('.ws-scope-filter')) sp.el.querySelector('.ws-scope-filter').value='';
          void SearchPanelScope.rerenderAndFocus(host);
        });
        SearchPanelScope.focusDefault(host);
        return;
      }
      if (sp.step==='record') {
        const rows=[];
        for (const e of host._h()._index._entries.values()) {
          if (e.collectionGuid!==sp.colGuid) continue;
          const n=`${e.displayName||e.name} ${e.collectionName||''} ${e.guid}`.toLowerCase();
          if (filt&&!n.includes(filt)) continue;
          rows.push(e);
        }
        rows.sort((a,b)=>String(a.displayName||a.name).localeCompare(String(b.displayName||b.name)));
        let html='<button type="button" class="ws-scope-back">← Change collection</button>';
        if (!rows.length) {
          html+=`<div class="ws-scope-hint">${filt?'No notes match the filter.':'No notes in this collection.'}</div>`;
        } else {
          html+=rows.slice(0,500).map(e=>{
            const sub=e.collectionName?`${wsEsc(e.collectionName)} - ${wsEsc(e.guid)}`:wsEsc(e.guid);
            return `<button type="button" class="ws-scope-item" data-recid="${e.guid.replace(/"/g,'')}">${wsEsc(e.displayName||e.name)}<small>${sub}</small></button>`;
          }).join('');
        }
        list.innerHTML=html;
        list.querySelector('.ws-scope-back')?.addEventListener('click',()=>{
          sp.step='colConfirm';
          sp.recordEntry=null;
          if (sp.el.querySelector('.ws-scope-filter')) sp.el.querySelector('.ws-scope-filter').value='';
          void SearchPanelScope.rerenderAndFocus(host);
        });
        for (const b of list.querySelectorAll('[data-recid]')) {
          b.addEventListener('click',()=>{
            const e=host._h()._index._entries.get(b.getAttribute('data-recid'));
            if (!e) return;
            sp.recordEntry=e;
            sp.step='confirm';
            if (sp.el.querySelector('.ws-scope-filter')) sp.el.querySelector('.ws-scope-filter').value='';
            void SearchPanelScope.rerenderAndFocus(host);
          });
        }
        SearchPanelScope.focusDefault(host);
        return;
      }
      if (sp.step==='confirm') {
        if (!sp.recordEntry) { sp.step='record'; void SearchPanelScope.rerenderAndFocus(host); return; }
        const e=sp.recordEntry;
        const title=wsEsc(e.displayName||e.name||'Note');
        const col=wsEsc(e.collectionName||sp.colName||'');
        list.innerHTML=`<div class="ws-scope-confirm">
          <div>
            <div class="ws-scope-confirm-title">${title}</div>
            <div class="ws-scope-confirm-meta">${col}</div>
          </div>
          <div class="ws-scope-confirm-actions">
            <button type="button" class="ws-btn ws-btn-primary" data-scope-done="record">Search in this note — add <code style="font-size:10px">in:record:</code></button>
            <button type="button" class="ws-btn ws-btn-secondary" data-scope-done="under">Limit to a heading — <code style="font-size:10px">under:line:</code>…</button>
            <button type="button" class="ws-scope-back" style="margin-top:4px">← Choose another note</button>
          </div>
        </div>`;
        list.querySelector('[data-scope-done="record"]')?.addEventListener('click',()=>{
          host._applyScopeSelection({ inRecordGuid:e.guid, inCollectionGuid:null, underLineGuid:null });
        });
        list.querySelector('[data-scope-done="under"]')?.addEventListener('click',()=>{
          sp.step='lines';
          void SearchPanelScope.rerenderAndFocus(host);
        });
        list.querySelector('.ws-scope-back')?.addEventListener('click',()=>{
          sp.step='record';
          sp.recordEntry=null;
          void SearchPanelScope.rerenderAndFocus(host);
        });
        SearchPanelScope.focusDefault(host);
      }
    },
  };

  // ─── SearchPanel · settings (gear) ───────────────────────────────────────────
  const SearchPanelConfig = {
    async open(host) {
      host._closeAc();
      host._closeScopePicker();
      host._configMode=true;
      host._syncPeopleDisabledWarning();
      host._root?.querySelector('.ws-config-btn')?.classList.add('ws-active');
      const body=host._root?.querySelector('.ws-body'); if (!body) return;
      const config=host._h()._getEffectiveConfig();
      let loadError=null;

      // Required GUIDs — if all of these are present in the first (live ∪ cached) view we can render
      // without any retry at all, which is the common steady-state case.
      const requiredGuids=new Set();
      if (config.peopleCollectionGuid) requiredGuids.add(config.peopleCollectionGuid);
      for (const g of config.includedCollectionIds||[]) requiredGuids.add(g);

      /** Build the merged `allCols` view from a `seen` map (live objects by GUID) + `_knownColNames`. */
      const buildMerged=(seen)=>{
        const out=[...seen.values()];
        const known=host._h()._knownColNames;
        if (known && known.size>0) {
          for (const [guid,name] of known.entries()) {
            if (!seen.has(guid)) out.push({ getGuid:()=>guid, getName:()=>name });
          }
        }
        return out;
      };

      const seen=new Map();
      // First attempt: do ONE live fetch and merge with cache so we can render instantly. No "Loading…"
      // spinner in the steady state — the cache is already populated from `_doBuildIndex`.
      try {
        const batch=wsCoerceCollectionArray(await host._h().data.getAllCollections(), 'settings');
        for (const c of batch) { try { const g=c.getGuid(); if (g) seen.set(g, c); } catch(e) {} }
      } catch (e) {
        console.warn('[WorkflowSearch] settings: getAllCollections failed', e);
        loadError=e;
      }
      if (!host._configMode||!host._root?.isConnected) return;
      let allCols=buildMerged(seen);
      const liveGuids0=new Set([...seen.keys()]);
      let usedIndexFallback=allCols.length>seen.size && (seen.size===0 || [...requiredGuids].some(g=>!liveGuids0.has(g)));

      body.innerHTML='';

      const colSection=document.createElement('div'); colSection.className='ws-config-section';
      const colTitle=document.createElement('div'); colTitle.className='ws-config-title'; colTitle.textContent='Collections to search'; colSection.appendChild(colTitle);
      const colList=document.createElement('div'); colList.className='ws-config-col-list';
      const colSyncMsg=document.createElement('div');
      colSyncMsg.style.cssText='padding:6px 14px;font-size:11px;color:var(--ws-muted);line-height:1.5;font-style:italic';
      colSyncMsg.style.display='none';

      /** Re-render the collection checklist preserving the user's current check state. */
      const renderColList=(cols,opts={})=>{
        const checkedNow=new Set([...colList.querySelectorAll('.ws-config-cb:checked')].map(cb=>cb.dataset.guid));
        // If we just opened, seed from the persisted config; otherwise keep the user's ticks as-is.
        const initial=!colList.childElementCount;
        colList.innerHTML='';
        for (const col of cols) {
          let guid='',name='';
          try { guid=col.getGuid(); name=col.getName(); } catch (e) { continue; }
          if (!guid) continue;
          const included=initial
            ? (!config.includedCollectionIds.length||config.includedCollectionIds.includes(guid))
            : checkedNow.has(guid);
          const row=document.createElement('label'); row.className='ws-config-col-row';
          const cb=document.createElement('input'); cb.type='checkbox'; cb.className='ws-config-cb'; cb.checked=included; cb.dataset.guid=guid;
          const nameEl=document.createElement('span'); nameEl.textContent=name||guid;
          row.appendChild(cb); row.appendChild(nameEl); colList.appendChild(row);
        }
        if (!cols.length) {
          colSyncMsg.style.display=''; colSyncMsg.style.fontStyle='';
          colSyncMsg.textContent=loadError
            ? 'Could not load collections (see console). Try reopening settings.'
            : 'No collections were returned by Thymer. Try reopening settings or reloading.';
        } else if (opts.fallback) {
          colSyncMsg.style.display=''; colSyncMsg.style.fontStyle='italic';
          colSyncMsg.textContent='Showing cached collection list — workspace still syncing. The list will update automatically.';
        } else {
          colSyncMsg.style.display='none';
        }
      };
      renderColList(allCols, { fallback: usedIndexFallback });
      colSection.appendChild(colSyncMsg); colSection.appendChild(colList); body.appendChild(colSection);
      body.appendChild(Object.assign(document.createElement('div'),{className:'ws-config-divider'}));

      const tagSection=document.createElement('div'); tagSection.className='ws-config-section';
      const tagTitle=document.createElement('div'); tagTitle.className='ws-config-title'; tagTitle.textContent='Hashtag property name'; tagSection.appendChild(tagTitle);
      const tagField=document.createElement('div'); tagField.className='ws-config-field';
      const tagLabel=document.createElement('span'); tagLabel.className='ws-config-field-label'; tagLabel.textContent='Property:';
      const tagInput=document.createElement('input'); tagInput.className='ws-config-input'; tagInput.value=config.tagPropName; tagInput.placeholder='Tags';
      tagField.appendChild(tagLabel); tagField.appendChild(tagInput); tagSection.appendChild(tagField); body.appendChild(tagSection);
      body.appendChild(Object.assign(document.createElement('div'),{className:'ws-config-divider'}));

      const peopleSection=document.createElement('div'); peopleSection.className='ws-config-section';
      const peopleTitle=document.createElement('div'); peopleTitle.className='ws-config-title'; peopleTitle.textContent='People (@-syntax)'; peopleSection.appendChild(peopleTitle);

      const peopleColField=document.createElement('div'); peopleColField.className='ws-config-field';
      const peopleColLabel=document.createElement('span'); peopleColLabel.className='ws-config-field-label'; peopleColLabel.textContent='Collection:';
      const peopleSel=document.createElement('select'); peopleSel.className='ws-config-select';

      /** Re-render the People dropdown, preserving the current selection when possible. */
      const renderPeopleSel=(cols)=>{
        const prevValue=peopleSel.value || config.peopleCollectionGuid || '';
        peopleSel.innerHTML='';
        const noneOpt=document.createElement('option'); noneOpt.value=''; noneOpt.textContent='— disabled —'; peopleSel.appendChild(noneOpt);
        let currentFound=false;
        for (const col of cols) {
          let guid='',name='';
          try { guid=col.getGuid(); name=col.getName(); } catch (e) { continue; }
          if (!guid) continue;
          const o=document.createElement('option'); o.value=guid; o.textContent=name||guid;
          if (guid===prevValue) { o.selected=true; currentFound=true; }
          peopleSel.appendChild(o);
        }
        if (prevValue && !currentFound) {
          const o=document.createElement('option'); o.value=prevValue;
          o.textContent=`(unknown collection: ${prevValue.slice(0,8)}…)`;
          o.selected=true;
          peopleSel.appendChild(o);
        }
      };
      renderPeopleSel(allCols);
      peopleColField.appendChild(peopleColLabel); peopleColField.appendChild(peopleSel); peopleSection.appendChild(peopleColField);

      const peopleNameField=document.createElement('div'); peopleNameField.className='ws-config-field';
      const peopleNameLabel=document.createElement('span'); peopleNameLabel.className='ws-config-field-label'; peopleNameLabel.textContent='Name property:';
      const peopleNameInput=document.createElement('input'); peopleNameInput.className='ws-config-input'; peopleNameInput.value=config.peopleNameProp||''; peopleNameInput.placeholder='(record title)';
      peopleNameField.appendChild(peopleNameLabel); peopleNameField.appendChild(peopleNameInput); peopleSection.appendChild(peopleNameField);
      body.appendChild(peopleSection);
      body.appendChild(Object.assign(document.createElement('div'),{className:'ws-config-divider'}));

      const themeSection=document.createElement('div'); themeSection.className='ws-config-section';
      const themeTitle=document.createElement('div'); themeTitle.className='ws-config-title'; themeTitle.textContent='Panel appearance'; themeSection.appendChild(themeTitle);
      const themeField=document.createElement('div'); themeField.className='ws-config-field';
      const themeLabel=document.createElement('span'); themeLabel.className='ws-config-field-label'; themeLabel.textContent='Theme:';
      const themeSel=document.createElement('select'); themeSel.className='ws-config-select';
      const themeOpts=[
        { v:'system', t:'Match system (light / dark)' },
        { v:'dark', t:'Always dark' },
        { v:'light', t:'Always light' },
      ];
      const curTheme=config.uiTheme==='dark'||config.uiTheme==='light'?config.uiTheme:'system';
      for (const o of themeOpts) {
        const opt=document.createElement('option'); opt.value=o.v; opt.textContent=o.t;
        if (o.v===curTheme) opt.selected=true;
        themeSel.appendChild(opt);
      }
      themeField.appendChild(themeLabel); themeField.appendChild(themeSel); themeSection.appendChild(themeField);
      body.appendChild(themeSection);

      // Background refresh: only if the first merged view (live ∪ cache) is still missing something
      // required, poll `getAllCollections()` briefly and re-render the checklist + People dropdown in
      // place. The panel is already rendered, so the user never sees a "Loading…" spinner.
      const firstMergedGuids=new Set([...seen.keys(), ...(host._h()._knownColNames?.keys?.()||[])]);
      const missingAny=[...requiredGuids].some(g=>!firstMergedGuids.has(g));
      if (missingAny || seen.size===0) {
        (async()=>{
          let prev=seen.size;
          for (let attempt=0; attempt<6; attempt++) {
            await new Promise(r=>setTimeout(r, 200+attempt*150));
            if (!host._configMode||!host._root?.isConnected) return;
            let batch=[];
            try { batch=wsCoerceCollectionArray(await host._h().data.getAllCollections(), 'settings-bg'); } catch(e) {}
            if (!host._configMode||!host._root?.isConnected) return;
            let grew=false;
            for (const c of batch) {
              try { const g=c.getGuid(); if (g && !seen.has(g)) { seen.set(g, c); grew=true; } else if (g) seen.set(g, c); } catch(e) {}
            }
            const mergedNow=buildMerged(seen);
            const mergedGuids=new Set(mergedNow.map(c=>{ try { return c.getGuid(); } catch(e) { return null; } }).filter(Boolean));
            const stillMissing=[...requiredGuids].some(g=>!mergedGuids.has(g));
            const fallbackNow=mergedNow.length>seen.size && (seen.size===0 || [...requiredGuids].some(g=>!seen.has(g)));
            if (grew || mergedNow.length!==allCols.length) {
              allCols=mergedNow;
              usedIndexFallback=fallbackNow;
              renderColList(allCols, { fallback: fallbackNow });
              renderPeopleSel(allCols);
            }
            if (!stillMissing && seen.size>0 && seen.size===prev && attempt>=2) break; // stable
            if (!stillMissing && seen.size>0) break;
            prev=seen.size;
          }
        })();
      }

      const actions=document.createElement('div'); actions.className='ws-config-actions';
      const cancelBtn=document.createElement('button'); cancelBtn.className='ws-btn ws-btn-secondary'; cancelBtn.textContent='Close'; cancelBtn.addEventListener('click',()=>SearchPanelConfig.close(host));
      const saveBtn=document.createElement('button'); saveBtn.className='ws-btn ws-btn-primary'; saveBtn.textContent='Save & Rebuild';
      saveBtn.addEventListener('click',async()=>{
        const checked=[...colList.querySelectorAll('.ws-config-cb:checked')].map(cb=>cb.dataset.guid).filter(Boolean);
        const allChecked=allCols.length>0&&checked.length===allCols.length;
        // Theme write-through: update LS + apply immediately so the color flips with no reload.
        // `_savePersisted` will mirror LS → server blob automatically whenever another setting triggers a real save.
        const nextTheme=themeSel.value==='dark'||themeSel.value==='light'||themeSel.value==='system'?themeSel.value:'system';
        wsWriteLocalTheme(nextTheme);
        host._applyUiTheme();

        // Build a server-persist patch only from keys that actually need a rebuild.
        const partial={};
        const nextTag=tagInput.value.trim()||'Tags';
        if (nextTag!==config.tagPropName) partial.tagPropName=nextTag;
        const nextPeopleName=peopleNameInput.value.trim()||'';
        if (nextPeopleName!==(config.peopleNameProp||'')) partial.peopleNameProp=nextPeopleName;
        if (allCols.length>0) {
          const nextInc=allChecked?[]:checked;
          const prevInc=config.includedCollectionIds||[];
          const sameInc=nextInc.length===prevInc.length&&nextInc.every(g=>prevInc.includes(g));
          if (!sameInc) partial.includedCollectionIds=nextInc;
          const nextPeopleGuid=peopleSel.value||'';
          if (nextPeopleGuid!==(config.peopleCollectionGuid||'')) partial.peopleCollectionGuid=nextPeopleGuid;
        }

        if (Object.keys(partial).length===0) {
          // Theme-only (or no-op) save: apply instantly and close. We deliberately do NOT push the theme
          // to the server here — `saveConfiguration` always reloads the plugin, which would flash the index
          // rebuild UI. The next time any other setting is saved, `_savePersisted` mirrors the current local
          // theme into the server blob for free (cross-device sync happens then).
          SearchPanelConfig.close(host);
          return;
        }

        await host._h()._saveConfig(partial);
        // `saveConfiguration` triggers a syncer `reload` event; our reload handler rebuilds the index.
        // We only close the settings UI here and re-run the active query — no manual `_buildIndex` call
        // (a duplicate rebuild would race the reload-handler rebuild and could wipe the fresh index
        // if `getAllCollections()` is transiently empty during the syncer hand-off).
        if (host._root?.isConnected) SearchPanelConfig.close(host);
        if (host._root?.isConnected && host._query) host._search(host._query);
      });
      actions.appendChild(cancelBtn); actions.appendChild(saveBtn); body.appendChild(actions);
    },
    close(host) {
      host._configMode=false;
      host._root?.querySelector('.ws-config-btn')?.classList.remove('ws-active');
      if (host._allResults.length>0) { SearchPanelResults.render(host); host._updateFooter(host._allResults.length); }
      else { host._renderEmptyState(); host._updateFooter(null); }
      host._syncPeopleDisabledWarning();
      host._root?.querySelector('.ws-input')?.focus();
    },
  };

  // ─── SearchPanel · saved searches row + save form ────────────────────────────
  const SearchPanelSaved = {
    renderChips(host) {
      const row=host._root?.querySelector('.ws-saved-row');
      if (!row) return;
      const searches=host._getSavedSearches();
      row.innerHTML='';
      if (!searches.length) { row.style.display='none'; return; }
      row.style.display='flex';
      const label=document.createElement('span'); label.className='ws-saved-label'; label.textContent='Saved:'; row.appendChild(label);
      for (const s of searches) {
        const chip=document.createElement('div'); chip.className='ws-chip'; chip.title=s.query;
        const nameEl=document.createElement('span'); nameEl.className='ws-chip-label'; nameEl.textContent=s.name;
        nameEl.addEventListener('click',()=>{
          const input=host._root?.querySelector('.ws-input');
          if (!input) return;
          input.value=host._hydrateSavedSearchQuery(s.query);
          input.dispatchEvent(new Event('input'));
          input.focus();
        });
        const delBtn=document.createElement('button'); delBtn.className='ws-chip-del'; delBtn.title='Remove'; delBtn.innerHTML=wsIcon('x');
        delBtn.addEventListener('click',(e)=>{ e.stopPropagation(); void (async()=>{ await host._persistSavedSearches(host._getSavedSearches().filter(x=>x.id!==s.id)); SearchPanelSaved.renderChips(host); })(); });
        chip.appendChild(nameEl); chip.appendChild(delBtn); row.appendChild(chip);
      }
    },
    openForm(host) {
      if (host._saveMode||!host._query.trim()) return;
      host._closeAc();
      host._closeScopePicker();
      host._saveMode=true;
      host._root?.querySelector('.ws-save-btn')?.classList.add('ws-active');
      const form=document.createElement('div'); form.className='ws-save-form';
      form.innerHTML=`<span class="ws-save-form-label">${wsIcon('bookmark')} Name:</span><input class="ws-save-input" type="text" placeholder="e.g. Open privacy tasks" autocomplete="off"><button class="ws-btn ws-btn-primary" style="padding:3px 10px;font-size:11px;">Save</button><button class="ws-btn ws-btn-secondary" style="padding:3px 9px;font-size:11px;">Cancel</button>`;
      const nameInput=form.querySelector('.ws-save-input');
      const [confirmBtn,cancelBtn]=form.querySelectorAll('.ws-btn');
      const commit=async()=>{
        const name=nameInput.value.trim()||host._query.slice(0,40);
        const searches=host._getSavedSearches(); if (searches.length>=12) searches.shift();
        searches.push({id:`${Date.now().toString(36)}${Math.random().toString(36).slice(2,5)}`,name,query:wsCanonicalPersistedQuery(host._query,host._scopeAliasResolved)});
        await host._persistSavedSearches(searches); SearchPanelSaved.cancelForm(host,form); SearchPanelSaved.renderChips(host);
        host._h().ui.addToaster({title:`Search saved: "${name}"`,dismissible:false,autoDestroyTime:2000});
      };
      confirmBtn.addEventListener('click',()=>void commit());
      cancelBtn.addEventListener('click',()=>SearchPanelSaved.cancelForm(host,form));
      nameInput.addEventListener('keydown',(e)=>{ if (e.key==='Enter'){e.preventDefault();void commit();} if (e.key==='Escape'){e.preventDefault();SearchPanelSaved.cancelForm(host,form);} });
      host._root?.querySelector('.ws-header')?.after(form);
      setTimeout(()=>nameInput.focus(),10);
    },
    cancelForm(host,formEl) {
      host._saveMode=false;
      host._root?.querySelector('.ws-save-btn')?.classList.remove('ws-active');
      formEl?.remove(); host._root?.querySelector('.ws-input')?.focus();
    },
  };

  // ─── SearchPanel · results preview helpers ───────────────────────────────────
  function wsSearchPanelPreviewExpandMeta(previewContext) {
    const showExpand=previewContext!==null;
    const expandTitle=previewContext?.type==='underScope'?'Preview lines matching your terms':
      previewContext?.type==='inRecordScope'?'Preview matching lines in this note':
        previewContext?.type==='task'?'Preview matching tasks':
          previewContext?.type==='mentions'?'Preview mentions':
            'Preview linked properties';
    return { showExpand, expandTitle };
  }

  function wsSearchPanelBuildPreviewContext(host, parsed) {
    const wantCompletion=wsCompletionPreviewFilter(parsed);
    const personFilter=wsPersonPreviewFilter(parsed);
    const underGuid=parsed?.scope?.underLineGuid;
    const underPreview=!!underGuid;
    const inRecGuid=parsed?.scope?.inRecordGuid;
    const inRecordPreview=!!(inRecGuid&&!underGuid);
    let previewContext=null;
    if (underPreview) {
      previewContext={ type:'underScope', anchorLineGuid:underGuid, parsed };
    } else if (inRecordPreview) {
      previewContext={ type:'inRecordScope', parsed };
    } else if (wantCompletion!==null) {
      previewContext={ type:'task', wantCompleted:wantCompletion };
    } else if (personFilter) {
      const people=host._h()._index._people;
      const mentionGuids=new Set();
      for (const ref of personFilter.mentionRefs) {
        const guids=people.resolve(ref.wildcard?ref.token+'*':ref.token);
        for (const g of guids) mentionGuids.add(g);
      }
      const propGuids=new Set();
      let fieldFilter=null;
      let hasFieldFilter=false, allSameField=true, commonField=null;
      for (const ref of personFilter.personRefs) {
        const guids=people.resolve(ref.wildcard?ref.token+'*':ref.token);
        for (const g of guids) propGuids.add(g);
        if (ref.mode==='field') {
          hasFieldFilter=true;
          if (commonField===null) commonField=ref.field;
          else if (commonField!==ref.field) allSameField=false;
        } else {
          allSameField=false;
        }
      }
      if (hasFieldFilter&&allSameField&&commonField) fieldFilter=commonField;
      if (mentionGuids.size>0&&propGuids.size===0) {
        previewContext={ type:'mentions', targetGuids:mentionGuids };
      } else if (propGuids.size>0&&mentionGuids.size===0) {
        previewContext={ type:'property', targetGuids:propGuids, fieldFilter };
      } else if (mentionGuids.size>0&&propGuids.size>0) {
        previewContext={ type:'mentions', targetGuids:new Set([...mentionGuids,...propGuids]) };
      }
    }
    return previewContext;
  }

  async function wsSearchPanelLoadPreviewBody(host, entry, previewContext, previewEl, tk, txOpts) {
    if (previewContext.type==='underScope') {
      const anchorGuid=previewContext.anchorLineGuid;
      const pq=previewContext.parsed;
      const items=await entry.record.getLineItems(false);
      const flat=await wsFlattenLineItems(items);
      if (tk!==host._previewLoadToken) return;
      previewEl.innerHTML='';
      const subtree=wsCollectSubtreeLineGuids(entry.record.guid,flat,anchorGuid);
      if (!subtree.size) { previewEl.innerHTML='<div class="ws-preview-empty">Could not resolve heading subtree</div>'; return; }
      const roots=wsRootLineItems(entry.record,flat);
      let found=0;
      const idx=host._h()._index;
      await wsForEachLineItemDeep(roots,(li,depth)=>{
        if (!subtree.has(li.guid)) return;
        if (!li.guid) return;
        const raw=wsTextFromLineItem(li,txOpts);
        const tl=raw.toLowerCase();
        if (!wsLineMatchesUnderPreviewLine(tl,pq)) return;
        const label=wsPreviewLineLabel(li,raw,idx._entries,idx._people,host._h().data);
        if (!label) return;
        found++;
        const people=idx._people;
        const div=wsCreateScopePreviewLineDiv(entry,li,depth,label,people,pq,(e,ent,li2,ig)=>host._onPreviewLineInteraction(e,ent,li2,ig));
        previewEl.appendChild(div);
      });
      if (!found) previewEl.innerHTML='<div class="ws-preview-empty">No matching lines in this subtree</div>';
    } else if (previewContext.type==='inRecordScope') {
      const pq=previewContext.parsed;
      const items=await entry.record.getLineItems(false);
      if (tk!==host._previewLoadToken) return;
      previewEl.innerHTML='';
      let found=0;
      const nameL=(entry.nameLower||'');
      if (wsLineMatchesUnderPreviewLine(nameL,pq)) {
        found++;
        const div=document.createElement('div'); div.className='ws-preview-line ws-preview-title-hit';
        div.style.cssText='font-style:italic;opacity:0.92;padding-left:10px';
        div.textContent='Title: '+(entry.displayName||entry.name||'').slice(0,200);
        div.addEventListener('click',(e)=>{ e.stopPropagation(); host._navigateToRecord(entry); });
        previewEl.appendChild(div);
      }
      const roots=wsRootLineItems(entry.record,items);
      const idx2=host._h()._index;
      await wsForEachLineItemDeep(roots,(li,depth)=>{
        if (!li.guid) return;
        const raw=wsTextFromLineItem(li,txOpts);
        const tl=raw.toLowerCase();
        if (!wsLineMatchesUnderPreviewLine(tl,pq)) return;
        const label=wsPreviewLineLabel(li,raw,idx2._entries,idx2._people,host._h().data);
        if (!label) return;
        found++;
        const people=idx2._people;
        const div=wsCreateScopePreviewLineDiv(entry,li,depth,label,people,pq,(e,ent,li2,ig)=>host._onPreviewLineInteraction(e,ent,li2,ig));
        previewEl.appendChild(div);
      });
      if (!found) previewEl.innerHTML='<div class="ws-preview-empty">No matching lines in this note</div>';
    } else if (previewContext.type==='task') {
      const wantCompleted=previewContext.wantCompleted;
      const items=await entry.record.getLineItems(false);
      if (tk!==host._previewLoadToken) return;
      const filtered=await wsFilterTaskLinesForPreview(entry.record,items,wantCompleted);
      previewEl.innerHTML='';
      if (!filtered.length) { previewEl.innerHTML='<div class="ws-preview-empty">No matching tasks</div>'; return; }
      const idxT=host._h()._index;
      for (const {li,depth} of filtered) {
        if (!li.guid) continue;
        const raw=wsTextFromLineItem(li,txOpts);
        const label=wsPreviewLineLabel(li,raw,idxT._entries,idxT._people,host._h().data);
        if (!label) continue;
        const div=document.createElement('div'); div.className='ws-preview-line';
        div.style.paddingLeft=(10+Math.min(depth,12)*14)+'px';
        div.textContent=label.slice(0,200)||'(empty task)';
        const ig=li.guid;
        div.addEventListener('click',(e)=>{ e.stopPropagation(); host._onPreviewLineInteraction(e,entry,li,ig); });
        div.addEventListener('contextmenu',(e)=>{ e.preventDefault(); e.stopPropagation(); host._onPreviewLineInteraction(e,entry,li,ig); });
        previewEl.appendChild(div);
      }
    } else if (previewContext.type==='mentions') {
      const targetGuids=previewContext.targetGuids;
      const items=await entry.record.getLineItems(false);
      if (tk!==host._previewLoadToken) return;
      previewEl.innerHTML='';
      let found=0;
      const people=host._h()._index._people;
      const roots=wsRootLineItems(entry.record, items);
      await wsForEachLineItemDeep(roots, (li, depth) => {
        const matchedGuids=new Set();
        for (const seg of (li.segments||[])) {
          if (seg.type==='ref'&&seg.text&&typeof seg.text==='object'&&seg.text.guid&&targetGuids.has(seg.text.guid)) matchedGuids.add(seg.text.guid);
          if (seg.type==='mention'&&typeof seg.text==='string'&&targetGuids.has(seg.text)) matchedGuids.add(seg.text);
        }
        if (!matchedGuids.size) return;
        if (!li.guid) return;
        const raw=wsTextFromLineItem(li,txOpts);
        const label=wsPreviewLineLabel(li,raw,host._h()._index._entries,host._h()._index._people,host._h().data);
        if (!label) return;
        found++;
        const div=document.createElement('div'); div.className='ws-preview-line';
        div.style.cssText='display:flex;align-items:baseline;gap:6px;';
        div.style.paddingLeft=(10+Math.min(depth,12)*14)+'px';
        const textSpan=document.createElement('span');
        textSpan.style.cssText='flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
        const show=String(label).slice(0,180)||(li.type==='task'?'(task)':'');
        textSpan.textContent=show||'(empty line)';
        div.appendChild(textSpan);
        for (const guid of matchedGuids) {
          const displayName=people.getDisplayName(guid)||guid.slice(0,8);
          const badge=document.createElement('span');
          badge.className='ws-preview-person-badge';
          badge.textContent='@'+displayName;
          div.appendChild(badge);
        }
        const ig=li.guid;
        div.addEventListener('click',(e)=>{ e.stopPropagation(); host._onPreviewLineInteraction(e,entry,li,ig); });
        div.addEventListener('contextmenu',(e)=>{ e.preventDefault(); e.stopPropagation(); host._onPreviewLineInteraction(e,entry,li,ig); });
        previewEl.appendChild(div);
      });
      if (!found) previewEl.innerHTML='<div class="ws-preview-empty">No matching mentions</div>';
    } else if (previewContext.type==='property') {
      if (tk!==host._previewLoadToken) return;
      previewEl.innerHTML='';
      let found=0;
      const props=entry.record.getAllProperties();
      for (const p of props) {
        if (previewContext.fieldFilter&&(p.name||'').toLowerCase().trim()!==previewContext.fieldFilter) continue;
        let linked=[];
        try { linked=p.linkedRecords()||[]; } catch(e) { continue; }
        const matchingPeople=linked.filter(r=>previewContext.targetGuids.has(r.guid));
        for (const person of matchingPeople) {
          found++;
          const div=document.createElement('div'); div.className='ws-preview-prop';
          const nameSpan=document.createElement('span'); nameSpan.className='ws-preview-prop-name'; nameSpan.textContent=p.name||'';
          const arrow=document.createElement('span'); arrow.className='ws-preview-prop-arrow'; arrow.textContent='→';
          const valSpan=document.createElement('span'); valSpan.className='ws-preview-prop-value'; valSpan.textContent=person.getName()||'';
          div.appendChild(nameSpan); div.appendChild(arrow); div.appendChild(valSpan);
          div.addEventListener('click',(e)=>{ e.stopPropagation(); host._navigateToRecord(entry); });
          previewEl.appendChild(div);
        }
      }
      if (!found) previewEl.innerHTML='<div class="ws-preview-empty">No matching properties</div>';
    }
  }

  // ─── SearchPanel · scope chips (non-modal row) ──────────────────────────────
  const SearchPanelScopeRow={
    inferCollectionGuid(host,scope) {
      if (!scope) return null;
      if (scope.inRecordGuid) {
        const e=host._h()._index._entries.get(scope.inRecordGuid);
        return e&&e.collectionGuid?e.collectionGuid:null;
      }
      if (scope.underLineGuid) {
        const rg=host._h()._index._lineToRecordGuid.get(scope.underLineGuid);
        if (!rg) return null;
        const e=host._h()._index._entries.get(rg);
        return e&&e.collectionGuid?e.collectionGuid:null;
      }
      return null;
    },
    renderChips(host) {
      const row=host._scopeRowEl;
      if (!row) return;
      const input=host._root?.querySelector('.ws-input');
      const q=input?input.value:'';
      const { scope }=wsExtractScope(wsResolveScopeAliases(q,host._scopeAliasResolved));
      if (!wsScopeHas(scope)) { row.classList.add('ws-hidden'); row.innerHTML=''; return; }
      row.classList.remove('ws-hidden');
      const parts=[];
      if (scope.inCollectionGuid) {
        const name=host._h()._index._colNames.get(scope.inCollectionGuid)||scope.inCollectionGuid.slice(0,8)+'…';
        const fullName=host._h()._index._colNames.get(scope.inCollectionGuid)||scope.inCollectionGuid;
        parts.push(`<span class="ws-scope-chip" title="${wsEsc(fullName)}"><span>Collection: ${wsEsc(name)}</span><button type="button" class="ws-scope-x" data-scope="col" title="Remove">${wsIcon('x')}</button></span>`);
      } else {
        const inferredCol=SearchPanelScopeRow.inferCollectionGuid(host,scope);
        if (inferredCol) {
          const name=host._h()._index._colNames.get(inferredCol)||inferredCol.slice(0,8)+'…';
          const fullName=host._h()._index._colNames.get(inferredCol)||inferredCol;
          parts.push(`<span class="ws-scope-chip ws-scope-chip-implicit" title="Collection that contains this note (not in query) · ${wsEsc(fullName)}"><span>Collection: ${wsEsc(name)}</span></span>`);
        }
      }
      if (scope.inRecordGuid) {
        const e=host._h()._index._entries.get(scope.inRecordGuid);
        const name=e?e.displayName:(scope.inRecordGuid.slice(0,8)+'…');
        const fullNote=e?(e.displayName||e.name||''):scope.inRecordGuid;
        parts.push(`<span class="ws-scope-chip" title="${wsEsc(fullNote)}"><span>Note: ${wsEsc(name)}</span><button type="button" class="ws-scope-x" data-scope="rec" title="Remove">${wsIcon('x')}</button></span>`);
      }
      if (scope.underLineGuid) {
        const sub=host._h()._index._lineSubtreeLower.get(scope.underLineGuid);
        const preview=sub?sub.slice(0,120).replace(/\s+/g,' ').trim():'…';
        const tip=sub?sub.slice(0,800).replace(/\s+/g,' ').trim():'';
        parts.push(`<span class="ws-scope-chip"${tip?` title="${wsEsc(tip)}"`:''}><span>Under: ${wsEsc(preview)}</span><button type="button" class="ws-scope-x" data-scope="under" title="Remove">${wsIcon('x')}</button></span>`);
      }
      row.innerHTML=parts.join('');
      for (const btn of row.querySelectorAll('.ws-scope-x')) {
        btn.addEventListener('click',(ev)=>{ ev.stopPropagation(); SearchPanelScopeRow.removePart(host,btn.getAttribute('data-scope')); });
      }
    },
    removePart(host,part) {
      const input=host._root?.querySelector('.ws-input');
      if (!input) return;
      const { scope }=wsExtractScope(wsResolveScopeAliases(input.value,host._scopeAliasResolved));
      const next={ inRecordGuid:scope.inRecordGuid||null,inCollectionGuid:scope.inCollectionGuid||null,underLineGuid:scope.underLineGuid||null };
      if (part==='col') next.inCollectionGuid=null;
      else if (part==='rec') next.inRecordGuid=null;
      else if (part==='under') next.underLineGuid=null;
      host._scopeAliasResolved={
        underLineGuid:next.underLineGuid||null,
        inRecordGuid:next.inRecordGuid||null,
        inCollectionGuid:next.inCollectionGuid||null,
      };
      input.value=wsMergeScopeIntoQuery(input.value,next,{ useAliases:true });
      SearchPanelScopeRow.renderChips(host);
      input.dispatchEvent(new Event('input'));
    },
  };

  const SearchPanelAutocomplete={
    renderAcList(host) {
      if (!host._acEl) return;
      if (!host._acOpen||!host._acItems.length) {
        host._acEl.classList.remove('ws-ac-visible'); host._acEl.innerHTML=''; return;
      }
      host._acEl.classList.add('ws-ac-visible');
      host._acEl.innerHTML=host._acItems.map((it,i)=>`
        <div class="ws-ac-item${i===host._acSel?' ws-ac-sel':''}" role="option" data-idx="${i}" aria-selected="${i===host._acSel}">
          <span class="ws-ac-kind">${wsEsc(it.kindLabel)}</span>
          <div class="ws-ac-main"><div class="ws-ac-label">${wsEsc(it.label)}</div>${it.detail?`<div class="ws-ac-detail">${wsEsc(it.detail)}</div>`:''}</div>
        </div>`).join('');
      for (const el of host._acEl.querySelectorAll('.ws-ac-item')) {
        el.addEventListener('mousedown',(ev)=>{ ev.preventDefault(); ev.stopPropagation(); host._acSel=+el.dataset.idx; SearchPanelAutocomplete.applySelection(host); });
      }
    },
    applySelection(host) {
      const item=host._acItems[host._acSel];
      if (!item) return;
      const input=host._root?.querySelector('.ws-input');
      if (!input) return;
      const v=input.value;
      const { replaceStart, replaceEnd, replaceWith }=item;
      const applied=item.kind==='saved'?host._hydrateSavedSearchQuery(replaceWith):replaceWith;
      const newV=v.slice(0,replaceStart)+applied+v.slice(replaceEnd);
      input.value=newV;
      input.setSelectionRange(replaceStart+applied.length,replaceStart+applied.length);
      host._closeAc();
      input.dispatchEvent(new Event('input'));
    },
    refreshFromInput(host) {
      if (host._configMode||host._saveMode) { host._closeAc(); return; }
      const input=host._root?.querySelector('.ws-input');
      if (!input) return;
      const v=input.value;
      const cursor=typeof input.selectionStart==='number'?input.selectionStart:v.length;
      const before=v.slice(0,cursor);
      const ctx=wsAcDetectContext(before);
      if (!ctx) { host._closeAc(); return; }
      const items=[];
      if (ctx.type==='or') {
        items.push({ kind:'or', kindLabel:'OR', label:'Use OR (union)', replaceStart:ctx.replaceStart, replaceEnd:ctx.replaceEnd, replaceWith:' OR ' });
      } else if (ctx.type==='and') {
        items.push({ kind:'and', kindLabel:'AND', label:'Use AND (intersection)', replaceStart:ctx.replaceStart, replaceEnd:ctx.replaceEnd, replaceWith:' AND ' });
      } else if (ctx.type==='colon') {
        for (const op of wsAcColonOpsMatch(ctx.prefix)) {
          items.push({ kind:'colon', kindLabel:':', label:op.label, detail:op.detail, replaceStart:ctx.replaceStart, replaceEnd:ctx.replaceEnd, replaceWith:op.insert });
        }
      } else if (ctx.type==='tag') {
        const all=host._h()._index.getAllTagsSorted();
        const p=ctx.prefix;
        const filtered=!p?all:all.filter(t=>t.startsWith(p));
        for (const t of filtered.slice(0,30)) {
          items.push({ kind:'tag', kindLabel:'Tag', label:'#'+t, replaceStart:ctx.replaceStart, replaceEnd:ctx.replaceEnd, replaceWith:'#'+t });
        }
      } else if (ctx.type==='person') {
        if (!host._h()._index._people.isConfigured()) { host._closeAc(); return; }
        for (const s of host._h()._index._people.suggestByPrefix(ctx.prefix,30)) {
          items.push({ kind:'person', kindLabel:'@', label:s.label, replaceStart:ctx.replaceStart, replaceEnd:ctx.replaceEnd, replaceWith:s.insert });
        }
      }
      if (!items.length) { host._closeAc(); return; }
      host._acItems=items; host._acSel=0; host._acOpen=true;
      SearchPanelAutocomplete.renderAcList(host);
    },
    openSaved(host) {
      if (host._configMode||host._saveMode) return;
      const searches=host._getSavedSearches();
      if (!searches.length) return;
      const input=host._root?.querySelector('.ws-input');
      if (!input) return;
      const v=input.value;
      host._acItems=searches.map(s=>({
        kind:'saved', kindLabel:'Saved', label:s.name, detail:s.query,
        replaceStart:0, replaceEnd:v.length, replaceWith:s.query
      }));
      host._acSel=0; host._acOpen=true;
      SearchPanelAutocomplete.renderAcList(host);
    },
  };

  const SearchPanelNavigate={
    handleKey(host,e) {
      e.stopPropagation();
      if (host._scopePicker) {
        if (e.key==='Escape') { e.preventDefault(); host._closeScopePicker(); }
        return;
      }
      if (host._previewCtxMenuEl&&e.key==='Escape') {
        e.preventDefault();
        host._closePreviewLineMenu();
        return;
      }
      if (host._saveMode) {
        if ((e.metaKey||e.ctrlKey)&&e.key==='s') e.preventDefault();
        return;
      }
      if (host._configMode) {
        if ((e.metaKey||e.ctrlKey)&&e.key==='s') e.preventDefault();
        return;
      }
      if (e.ctrlKey&&e.code==='Space') {
        e.preventDefault();
        SearchPanelAutocomplete.openSaved(host);
        return;
      }
      if (host._acOpen&&host._acItems.length) {
        if (e.key==='ArrowDown')  { e.preventDefault(); host._acSel=Math.min(host._acSel+1,host._acItems.length-1); SearchPanelAutocomplete.renderAcList(host); return; }
        if (e.key==='ArrowUp')    { e.preventDefault(); host._acSel=Math.max(host._acSel-1,0); SearchPanelAutocomplete.renderAcList(host); return; }
        if (e.key==='Enter')      { e.preventDefault(); SearchPanelAutocomplete.applySelection(host); return; }
        if (e.key==='Escape')     { e.preventDefault(); host._closeAc(); return; }
        if (e.key==='Tab')       { host._closeAc(); return; }
      }
      if (e.key==='ArrowDown')  { e.preventDefault(); SearchPanelNavigate.moveSelection(host,1); }
      else if (e.key==='ArrowUp')  { e.preventDefault(); SearchPanelNavigate.moveSelection(host,-1); }
      else if (e.key==='Enter')    { e.preventDefault(); SearchPanelNavigate.openSelected(host); }
      else if ((e.metaKey||e.ctrlKey)&&e.key==='s') { e.preventDefault(); if (host._query.trim()) host._openSaveForm(); }
    },
    moveSelection(host,dir) {
      if (!host._allResults.length) return;
      const next=host._selectedIdx+dir;
      host._selectedIdx=((next%host._allResults.length)+host._allResults.length)%host._allResults.length;
      SearchPanelNavigate.highlightSelected(host); SearchPanelNavigate.scrollToSelected(host);
    },
    highlightSelected(host) { host._root?.querySelectorAll('.ws-result-wrap').forEach((wrap,i)=>wrap.classList.toggle('ws-selected',i===host._selectedIdx)); },
    scrollToSelected(host) { host._root?.querySelector('.ws-result-wrap.ws-selected')?.scrollIntoView({block:'nearest'}); },
    openSelected(host) { if (host._selectedIdx<0||!host._allResults[host._selectedIdx]) return; void SearchPanelNavigate.navigateToRecord(host,host._allResults[host._selectedIdx]); },
    async navigateToRecord(host,entry) {
      host._openedGuid=entry.record.guid;
      host._highlightOpened();
      const myId=host._panel.getId();
      const allPanels=host._h().ui.getPanels()||[];
      const candidates=allPanels.filter(p=>p.getId()!==myId&&!p.isSidebar());
      const target=candidates.find(p=>p.isActive())||candidates[0]||null;

      const doNav=async(panel)=>{
        panel.navigateTo({type:'edit_panel',rootId:entry.record.guid,workspaceGuid:host._h().getWorkspaceGuid()});
        host._h().ui.setActivePanel(panel);
        const plainQuery=host._toPlainQuery(host._parser.parse(host._queryResolvedForParse())||{type:'and',terms:[],phrases:[],includeTags:[],excludeTags:[],excludeTerms:[],excludePhrases:[],isCompleted:null,personRefs:[],mentionRefs:[],dateFilters:{created:null,updated:null}});
        if (!plainQuery) return;
        try {
          const lineItems=await Promise.race([entry.record.getLineItems(false),new Promise(r=>setTimeout(()=>r([]),3000))]);
          if (!lineItems.length) return;
          const allTerms=plainQuery.toLowerCase().replace(/"/g,' ').split(/\s+/).filter(Boolean);
          const nameLower=entry.record.getName().toLowerCase();
          const bodyTerms=allTerms.filter(t=>!nameLower.includes(t));
          const searchTerms=bodyTerms.length?bodyTerms:allTerms;
          const em=host._h()._index._entries;
          const match=lineItems.find(li=>{ try { const text=wsTextFromLineItem(li,{recordEntryMap:em}).toLowerCase(); return searchTerms.every(t=>text.includes(t)); } catch(e) { return false; } });
          if (!match) return;
          await new Promise(r=>setTimeout(r,350));
          await panel.navigateTo({itemGuid:match.guid,highlight:true});
        } catch(e) { console.warn('[WorkflowSearch] highlight failed:',e); }
      };

      if (target) { await doNav(target); }
      else { const newPanel=await host._h().ui.createPanel({afterPanel:host._panel}); if (newPanel) await doNav(newPanel); }
    },
    async navigateToRecordLine(host,entry,itemGuid) {
      host._openedGuid=entry.record.guid; host._highlightOpened();
      const myId=host._panel.getId();
      const allPanels=host._h().ui.getPanels()||[];
      const candidates=allPanels.filter(p=>p.getId()!==myId&&!p.isSidebar());
      const target=candidates.find(p=>p.isActive())||candidates[0]||null;
      const doNav=async(panel)=>{ panel.navigateTo({type:'edit_panel',rootId:entry.record.guid,workspaceGuid:host._h().getWorkspaceGuid()}); host._h().ui.setActivePanel(panel); try { await new Promise(r=>setTimeout(r,350)); await panel.navigateTo({itemGuid,highlight:true}); } catch(e) {} };
      if (target) { await doNav(target); }
      else { const newPanel=await host._h().ui.createPanel({afterPanel:host._panel}); if (newPanel) await doNav(newPanel); }
    },
    async navigateToPreviewLinkTarget(host,li) {
      const t=wsPreviewLineLinkTarget(li,host._h().data);
      if (!t) return;
      const myId=host._panel.getId();
      const allPanels=host._h().ui.getPanels()||[];
      const candidates=allPanels.filter(p=>p.getId()!==myId&&!p.isSidebar());
      const panel=candidates.find(p=>p.isActive())||candidates[0]||null;
      const ws=host._h().getWorkspaceGuid();
      const doNav=async(p)=>{
        if (t.kind==='record') {
          p.navigateTo({type:'edit_panel',rootId:t.guid,workspaceGuid:ws});
        } else {
          p.navigateTo({type:'overview',rootId:t.guid,subId:null,workspaceGuid:ws});
        }
        host._h().ui.setActivePanel(p);
      };
      if (panel) await doNav(panel);
      else { const np=await host._h().ui.createPanel({afterPanel:host._panel}); if (np) await doNav(np); }
    },
  };

  const SearchPanelResults={
    render(host) {
      const body=host._root?.querySelector('.ws-body');
      if (!body) return;
      if (host._allResults.length===0) { body.innerHTML=`<div class="ws-empty"><div class="ws-empty-icon">${wsIcon('search-off')}</div><div>No results</div></div>`; return; }
      const parsed=host._parser.parse(host._queryResolvedForParse());
      const previewContext=wsSearchPanelBuildPreviewContext(host, parsed);
      const { showExpand, expandTitle }=wsSearchPanelPreviewExpandMeta(previewContext);

      const frag=document.createDocumentFragment();
      let rowIdx=0;
      const buildRow=(entry)=>{
        const idx=rowIdx++;
        const wrap=document.createElement('div');
        wrap.className='ws-result-wrap';
        if (idx===host._selectedIdx) wrap.classList.add('ws-selected');
        if (entry.guid===host._openedGuid) wrap.classList.add('ws-opened');
        wrap.dataset.idx=String(idx);

        const rowRow=document.createElement('div'); rowRow.className='ws-result-row';

        const expandBtn=document.createElement('button'); expandBtn.type='button';
        expandBtn.className='ws-result-expand'+(showExpand?'':' ws-hidden');
        expandBtn.title=expandTitle; expandBtn.innerHTML=wsIcon('chevron-right');
        if (showExpand) { expandBtn.classList.toggle('ws-expanded',host._expandedGuid===entry.guid); expandBtn.addEventListener('click',(e)=>{ e.stopPropagation(); host._toggleExpand(entry); }); }

        const row=document.createElement('div'); row.className='ws-result';
        let iconHtml;
        try { const rawIcon=entry.record.getIcon(false); iconHtml=rawIcon?`<span class="ws-result-icon">${wsIcon(rawIcon.replace('ti-',''))}</span>`:`<span class="ws-result-icon ws-result-icon-dim">${wsIcon('file-text')}</span>`; }
        catch(e) { iconHtml=`<span class="ws-result-icon ws-result-icon-dim">${wsIcon('file-text')}</span>`; }

        const tagHtml=entry.tags.length?`<div class="ws-result-tags">${entry.tags.slice(0,5).map(t=>`<span class="ws-tag">#${wsEsc(t)}</span>`).join('')}</div>`:'';
        const bodyBadge=entry._bodyMatch?`<span class="ws-body-badge">body</span>`:'';
        const personBadge=entry._personMatch?`<span class="ws-person-badge">@</span>`:'';

        row.innerHTML=`<div class="ws-result-main">${iconHtml}<span class="ws-result-name">${wsEsc(entry.displayName)}${bodyBadge}${personBadge}</span><span class="ws-result-col">${wsEsc(entry.collectionName)}</span></div>${tagHtml}`;
        row.addEventListener('click',()=>{ host._selectedIdx=idx; SearchPanelNavigate.highlightSelected(host); void SearchPanelNavigate.navigateToRecord(host,entry); });
        row.addEventListener('mouseenter',()=>{ host._selectedIdx=idx; SearchPanelNavigate.highlightSelected(host); });

        rowRow.appendChild(expandBtn); rowRow.appendChild(row);

        const preview=document.createElement('div'); preview.className='ws-preview';
        if (showExpand&&host._expandedGuid===entry.guid) { preview.style.display='block'; void host._loadPreviewFor(entry,previewContext,preview); }
        else { preview.style.display='none'; }

        wrap.appendChild(rowRow); wrap.appendChild(preview);
        return wrap;
      };

      for (const entry of host._nameResults) frag.appendChild(buildRow(entry));
      if (host._bodyResults.length) {
        const sep=document.createElement('div'); sep.className='ws-body-sep'; sep.textContent='Body matches';
        frag.appendChild(sep);
        for (const entry of host._bodyResults) frag.appendChild(buildRow(entry));
      }
      body.innerHTML=''; body.appendChild(frag);
    },
  };

  // ─── Search Panel (main) ────────────────────────────────────────────────────

  class SearchPanel {
    constructor(plugin,panel,parser) {
      this._plugin=plugin; this._panel=panel; this._parser=parser;
      this._nameResults=[]; this._bodyResults=[]; this._allResults=[];
      this._selectedIdx=-1; this._openedGuid=null;
      this._query=''; this._debounce=null; this._searchToken=0;
      this._expandedGuid=null; this._previewLoadToken=0;
      this._scopeAliasResolved={ underLineGuid:null,inRecordGuid:null,inCollectionGuid:null };
      this._previewCtxMenuEl=null; this._previewCtxMenuCleanup=null;
      this._configMode=false; this._saveMode=false; this._root=null;
      this._acOpen=false; this._acItems=[]; this._acSel=0; this._acEl=null;
      this._scopePicker=null;
      this._scopeRowEl=null;
      this._scopeFilterDebounceTimer=null;
      this._themeWatchers=null;
    }

    _h() { return _wsActiveHost || this._plugin; }

    _applyUiTheme() {
      const t=this._h()._getEffectiveConfig().uiTheme;
      const choice=t==='dark'||t==='light'||t==='system'?t:'system';
      // `data-ws-theme` is the CSS hook. For "system" we resolve to a concrete value here so the panel can
      // follow the host app's theme (Thymer may not mirror the OS `prefers-color-scheme` media query).
      const applied=choice==='system'?wsResolveSystemTheme():choice;
      this._root?.setAttribute('data-ws-theme',applied);
      this._root?.setAttribute('data-ws-theme-choice',choice);
      if (choice==='system') this._installThemeWatchers(); else this._disposeThemeWatchers();
    }

    /** Re-apply theme whenever the host/OS changes color scheme. Only active when the user chose "Match System". */
    _installThemeWatchers() {
      if (this._themeWatchers) return;
      const w={ cleanups:[] };
      try {
        if (typeof window!=='undefined' && window.matchMedia) {
          const mql=window.matchMedia('(prefers-color-scheme: dark)');
          const onMql=()=>this._reapplyIfSystem();
          if (mql.addEventListener) { mql.addEventListener('change',onMql); w.cleanups.push(()=>mql.removeEventListener('change',onMql)); }
          else if (mql.addListener) { mql.addListener(onMql); w.cleanups.push(()=>mql.removeListener(onMql)); }
        }
      } catch(e) {}
      try {
        if (typeof MutationObserver!=='undefined' && typeof document!=='undefined') {
          const mo=new MutationObserver(()=>this._reapplyIfSystem());
          const targets=[document.documentElement,document.body].filter(Boolean);
          for (const t of targets) mo.observe(t,{ attributes:true,attributeFilter:['class','data-theme','data-color-mode','data-color-theme','data-appearance','style'] });
          w.cleanups.push(()=>{ try { mo.disconnect(); } catch(e) {} });
        }
      } catch(e) {}
      this._themeWatchers=w;
    }

    _disposeThemeWatchers() {
      const w=this._themeWatchers; if (!w) return;
      for (const fn of w.cleanups) { try { fn(); } catch(e) {} }
      this._themeWatchers=null;
    }

    _reapplyIfSystem() {
      if (!this._root?.isConnected) { this._disposeThemeWatchers(); return; }
      if (this._root.getAttribute('data-ws-theme-choice')!=='system') return;
      const resolved=wsResolveSystemTheme();
      if (this._root.getAttribute('data-ws-theme')!==resolved) this._root.setAttribute('data-ws-theme',resolved);
    }

    mount() {
      const el=this._panel.getElement();
      if (!el) return;
      const root=document.createElement('div');
      root.className='ws-root'; this._root=root;
      root.appendChild(this._buildHeader());
      const scopeRow=document.createElement('div'); scopeRow.className='ws-scope-row ws-hidden'; root.appendChild(scopeRow); this._scopeRowEl=scopeRow;
      const savedRow=document.createElement('div'); savedRow.className='ws-saved-row'; root.appendChild(savedRow);
      const statusBar=document.createElement('div'); statusBar.className='ws-status'; root.appendChild(statusBar);
      const peopleWarn=document.createElement('div'); peopleWarn.className='ws-people-warn ws-hidden'; root.appendChild(peopleWarn);
      const body=document.createElement('div'); body.className='ws-body'; root.appendChild(body);
      body.addEventListener('mousedown',()=>this._closeAc());
      root.appendChild(this._buildFooter());
      root.addEventListener('keydown',(e)=>e.stopPropagation());

      const _inject=()=>{
        el.innerHTML='';
        el.appendChild(root);
        this._applyUiTheme();
        this._renderSavedChips(); this._updateStatus(); this._renderScopeChips(); this._renderEmptyState();
        setTimeout(()=>root.querySelector('.ws-input')?.focus(),80);
        requestAnimationFrame(()=>{
          let barHeight=0;
          const parent=el.parentElement;
          if (parent) { for (const child of parent.children) { if (child===el) break; barHeight+=child.offsetHeight||0; } }
          if (barHeight===0) { const fc=el.firstElementChild; if (fc&&fc!==root) barHeight=fc.offsetHeight||0; }
          if (barHeight===0&&parent) { const pRect=parent.getBoundingClientRect(),eRect=el.getBoundingClientRect(); barHeight=Math.round(eRect.top-pRect.top); }
          root.style.paddingTop=(barHeight>0?barHeight:38)+'px';
        });
      };
      _inject();
    }

    refreshStatus() {
      this._updateStatus();
      if (!this._query&&!this._configMode) this._renderEmptyState();
      else if (!this._configMode) this._syncPeopleDisabledWarning();
    }

    _buildHeader() {
      const header=document.createElement('div'); header.className='ws-header';
      header.innerHTML=`
        <div class="ws-header-top">
          <div class="ws-header-actions">
            <button type="button" class="ws-icon-btn ws-save-btn" title="Save search (⌘S)" disabled>${wsIcon('bookmark')}</button>
            <button class="ws-icon-btn ws-scope-open-btn" type="button" title="Search scope (in / under)">${wsIcon('filter')}</button>
            <button class="ws-icon-btn ws-config-btn" title="Configure">${wsIcon('settings')}</button>
          </div>
        </div>
        <div class="ws-header-search">
          <span class="ws-header-icon">${wsIcon('search')}</span>
          <div class="ws-input-wrap">
            <input class="ws-input" type="text" placeholder="Search collections…" autocomplete="off" spellcheck="false" aria-autocomplete="list">
            <button class="ws-clear-btn ws-hidden" title="Clear">${wsIcon('x')}</button>
          </div>
        </div>
      `;
      const wrap=header.querySelector('.ws-input-wrap');
      const input=header.querySelector('.ws-input');
      const ac=document.createElement('div'); ac.className='ws-ac'; ac.setAttribute('role','listbox'); ac.setAttribute('aria-label','Search suggestions');
      const acId='ws-ac-'+Math.random().toString(36).slice(2,10); ac.id=acId; try { input.setAttribute('aria-controls',acId); } catch(e) {}
      wrap.appendChild(ac); this._acEl=ac;
      const clearBtn=header.querySelector('.ws-clear-btn');
      const saveBtn=header.querySelector('.ws-save-btn');
      const configBtn=header.querySelector('.ws-config-btn');
      input.addEventListener('input',()=>{
        const q=input.value;
        clearBtn.classList.toggle('ws-hidden',!q.length);
        saveBtn.disabled=!q.trim();
        this._renderScopeChips();
        SearchPanelAutocomplete.refreshFromInput(this);
        clearTimeout(this._debounce);
        this._debounce=setTimeout(()=>this._search(q),150);
      });
      input.addEventListener('keydown',(e)=>SearchPanelNavigate.handleKey(this,e));
      input.addEventListener('click',()=>SearchPanelAutocomplete.refreshFromInput(this));
      clearBtn.addEventListener('click',()=>{ this._closeAc(); input.value=''; clearBtn.classList.add('ws-hidden'); saveBtn.disabled=true; this._scopeAliasResolved={ underLineGuid:null,inRecordGuid:null,inCollectionGuid:null }; this._renderScopeChips(); this._search(''); input.focus(); });
      saveBtn.addEventListener('click',()=>this._openSaveForm());
      header.querySelector('.ws-scope-open-btn')?.addEventListener('click',()=>this._openScopePicker());
      configBtn.addEventListener('click',()=>this._configMode?this._closeConfig():this._openConfig());
      return header;
    }

    _buildFooter() {
      const footer=document.createElement('div'); footer.className='ws-footer';
      const modHint=wsModClickLinkHint();
      footer.innerHTML=`<span class="ws-result-count"></span><span class="ws-hint">↑↓ results &nbsp;·&nbsp; ⏎ open &nbsp;·&nbsp; ⌘S save &nbsp;·&nbsp; ⌃Space saved &nbsp;·&nbsp; ${modHint} &nbsp;·&nbsp; suggestions: ↑↓ ⏎ Esc</span>`;
      return footer;
    }

    _queryResolvedForParse() {
      return wsResolveScopeAliases(this._query, this._scopeAliasResolved);
    }

    /** Apply a stored saved-search string: set `_scopeAliasResolved` and return input text (with `$ws*` aliases). */
    _hydrateSavedSearchQuery(raw) {
      const { text, resolved } = wsQueryGuidsToScopeAliases(raw);
      this._scopeAliasResolved = {
        underLineGuid: resolved.underLineGuid || null,
        inRecordGuid: resolved.inRecordGuid || null,
        inCollectionGuid: resolved.inCollectionGuid || null,
      };
      return text;
    }

    _closeAc() {
      this._acOpen=false; this._acItems=[]; this._acSel=0;
      if (this._acEl) { this._acEl.classList.remove('ws-ac-visible'); this._acEl.innerHTML=''; }
    }

    _renderAcList() { SearchPanelAutocomplete.renderAcList(this); }
    _applyAcSelection() { SearchPanelAutocomplete.applySelection(this); }
    _refreshAcFromInput() { SearchPanelAutocomplete.refreshFromInput(this); }
    _openSavedSearchesAc() { SearchPanelAutocomplete.openSaved(this); }
    _handleKey(e) { SearchPanelNavigate.handleKey(this,e); }
    _moveSelection(dir) { SearchPanelNavigate.moveSelection(this,dir); }
    _highlightSelected() { SearchPanelNavigate.highlightSelected(this); }
    _scrollToSelected() { SearchPanelNavigate.scrollToSelected(this); }
    _openSelected() { SearchPanelNavigate.openSelected(this); }
    async _navigateToRecord(entry) { return SearchPanelNavigate.navigateToRecord(this,entry); }
    async _navigateToRecordLine(entry,itemGuid) { return SearchPanelNavigate.navigateToRecordLine(this,entry,itemGuid); }
    async _navigateToPreviewLinkTarget(li) { return SearchPanelNavigate.navigateToPreviewLinkTarget(this,li); }

    _closePreviewLineMenu() {
      if (this._previewCtxMenuCleanup) { try { this._previewCtxMenuCleanup(); } catch(e) {} this._previewCtxMenuCleanup=null; }
      if (this._previewCtxMenuEl) { try { this._previewCtxMenuEl.remove(); } catch(e) {} this._previewCtxMenuEl=null; }
    }

    _showPreviewLineMenu(e,entry,li,ig) {
      this._closePreviewLineMenu();
      const target=wsPreviewLineLinkTarget(li,this._h().data);
      const menu=document.createElement('div');
      menu.className='ws-preview-ctx-menu';
      menu.setAttribute('data-ws-theme',this._root?.getAttribute('data-ws-theme')||'system');
      const x=Math.min(e.clientX,typeof window!=='undefined'?window.innerWidth-220:e.clientX);
      const y=Math.min(e.clientY,typeof window!=='undefined'?window.innerHeight-120:e.clientY);
      menu.style.left=x+'px'; menu.style.top=y+'px';
      const add=(label,fn)=>{
        const b=document.createElement('button');
        b.type='button'; b.className='ws-preview-ctx-item'; b.textContent=label;
        b.addEventListener('click',(ev)=>{ ev.stopPropagation(); this._closePreviewLineMenu(); fn(); });
        menu.appendChild(b);
      };
      add('Open in source note',()=>void this._navigateToRecordLine(entry,ig));
      if (target) {
        add(target.kind==='record'?'Open linked record':'Open link target',()=>void this._navigateToPreviewLinkTarget(li));
      }
      document.body.appendChild(menu);
      this._previewCtxMenuEl=menu;
      const close=()=>this._closePreviewLineMenu();
      const onDoc=(ev)=>{ if (this._previewCtxMenuEl&&!this._previewCtxMenuEl.contains(ev.target)) close(); };
      const onKey=(ev)=>{ if (ev.key==='Escape') close(); };
      setTimeout(()=>{
        document.addEventListener('mousedown',onDoc,true);
        document.addEventListener('keydown',onKey,true);
      },0);
      this._previewCtxMenuCleanup=()=>{
        document.removeEventListener('mousedown',onDoc,true);
        document.removeEventListener('keydown',onKey,true);
      };
    }

    _onPreviewLineInteraction(e,entry,li,ig) {
      if (e.type==='contextmenu') {
        this._showPreviewLineMenu(e,entry,li,ig);
        return;
      }
      if ((e.metaKey||e.ctrlKey)&&wsPreviewLineLinkTarget(li,this._h().data)) {
        void this._navigateToPreviewLinkTarget(li);
        return;
      }
      void this._navigateToRecordLine(entry,ig);
    }

    _toggleExpand(entry) {
      this._expandedGuid=this._expandedGuid===entry.guid?null:entry.guid;
      this._renderResults();
    }

    async _loadPreviewFor(entry, previewContext, previewEl) {
      this._closePreviewLineMenu();
      const tk=++this._previewLoadToken;
      previewEl.innerHTML=`<div class="ws-preview-loading">Loading…</div>`;
      const txOpts={recordEntryMap:this._h()._index._entries,data:this._h().data};
      try {
        await wsSearchPanelLoadPreviewBody(this, entry, previewContext, previewEl, tk, txOpts);
      } catch(e) {
        if (tk!==this._previewLoadToken) return;
        previewEl.innerHTML='<div class="ws-preview-empty">Could not load preview</div>';
      }
    }

    _highlightOpened() {
      this._root?.querySelectorAll('.ws-result-wrap').forEach(wrap=>{ const entry=this._allResults[parseInt(wrap.dataset.idx,10)]; wrap.classList.toggle('ws-opened',!!(entry&&entry.guid===this._openedGuid)); });
    }

    /** Shown when the query uses @-syntax but People collection is not configured in settings. */
    _syncPeopleDisabledWarning() {
      const el=this._root?.querySelector('.ws-people-warn');
      if (!el) return;
      if (this._configMode) { el.classList.add('ws-hidden'); el.textContent=''; return; }
      const parsed=this._parser.parse(this._queryResolvedForParse()||'');
      const needPeopleSyntax=!!parsed && !this._h()._index._people.isConfigured() && wsPersonPreviewFilter(parsed);
      if (needPeopleSyntax) {
        el.classList.remove('ws-hidden');
        el.textContent='People search (@name, field:@name, mentions:@name) needs a People collection. Open settings (gear icon) and choose a People collection.';
      } else {
        el.classList.add('ws-hidden');
        el.textContent='';
      }
    }

    _search(query) {
      if (this._configMode) return;
      this._query=query; this._expandedGuid=null; this._previewLoadToken++;
      const token=++this._searchToken;
      try {
        const parsed=this._parser.parse(this._queryResolvedForParse());
        if (!parsed) {
          this._nameResults=[]; this._bodyResults=[]; this._allResults=[]; this._selectedIdx=-1;
          this._renderEmptyState(); this._updateFooter(null); return;
        }
        const {nameMatches,bodyMatches}=this._h()._index.queryWithBody(parsed);
        this._nameResults=wsSortSearchResultsByCollectionTitle(nameMatches);
        this._bodyResults=wsSortSearchResultsByCollectionTitle(bodyMatches);
        this._allResults=[...this._nameResults,...this._bodyResults];
        this._selectedIdx=this._allResults.length>0?0:-1;
        this._renderResults(); this._updateFooter(this._allResults.length);
        const plainQuery=this._toPlainQuery(parsed);
        if (plainQuery&&wsSearchByQueryAllowed(parsed)) void this._searchBody(plainQuery,token,parsed);
      } finally {
        this._syncPeopleDisabledWarning();
      }
    }

    _toPlainQuery(parsed) {
      const groups=wsParsedGroupsFlat(parsed);
      const terms=[],phrases=[];
      for (const g of groups) { if (g.terms) terms.push(...g.terms); if (g.phrases) phrases.push(...g.phrases); }
      return [...phrases.map(p=>`"${p}"`), ...terms].join(' ');
    }

    async _searchBody(plainQuery,token,parsed) {
      let result;
      try { result=await this._h().data.searchByQuery(plainQuery,50); } catch(e) { return; }
      if (token!==this._searchToken||!this._root?.isConnected||this._configMode) return;
      if (result.error) return;
      const seen=new Set([...this._nameResults.map(e=>e.guid),...this._bodyResults.map(e=>e.guid)]);
      const bodyEntries=[];
      const processRecord=(record)=>{
        if (!record||seen.has(record.guid)) return;
        seen.add(record.guid);
        const indexed=this._h()._index._entries.get(record.guid);
        if (indexed&&this._h()._index.matchesParsedEntryFilters(indexed,parsed)) bodyEntries.push({...indexed,_bodyMatch:true});
      };
      for (const r of (result.records||[])) processRecord(r);
      for (const line of (result.lines||[])) { try { processRecord(line.record); } catch(e) {} }
      if (!bodyEntries.length) return;
      // Merge with index body hits — do not replace; searchByQuery only adds records not already listed.
      const merged=new Map(this._bodyResults.map(e=>[e.guid,e]));
      for (const e of bodyEntries) merged.set(e.guid,e);
      this._bodyResults=wsSortSearchResultsByCollectionTitle([...merged.values()]);
      this._allResults=[...this._nameResults,...this._bodyResults];
      if (this._selectedIdx<0&&this._allResults.length>0) this._selectedIdx=0;
      this._renderResults(); this._updateFooter(this._allResults.length);
    }

    _renderEmptyState() {
      const body=this._root?.querySelector('.ws-body');
      if (!body||this._configMode) return;
      const count=this._h()._index.size();
      if (count>0) {
        body.innerHTML=`<div class="ws-empty"><div class="ws-empty-icon">${wsIcon('search')}</div><div>Search ${count.toLocaleString()} records across ${this._h()._index.collectionCount()} collection${this._h()._index.collectionCount()!==1?'s':''}</div><div class="ws-empty-hint">#tag &nbsp; -#tag &nbsp; "phrase" &nbsp; -term &nbsp; -"phrase" &nbsp; use OR (capital) for union<br>@person &nbsp; ⌃Space saved &nbsp; · &nbsp; filter button &nbsp; in:/under: &nbsp; · &nbsp; autocomplete: # &nbsp; @ &nbsp; : &nbsp; or→OR<br>title: / body: &nbsp; · &nbsp; is:completed &nbsp; -is:completed &nbsp; created: &nbsp; updated: &nbsp; mentions:</div></div>`;
      } else {
        body.innerHTML=`<div class="ws-empty"><div class="ws-empty-icon">${wsIcon('loader')}</div><div>Building index…</div></div>`;
      }
      this._syncPeopleDisabledWarning();
    }

    _renderResults() { SearchPanelResults.render(this); }

    _updateStatus() {
      const bar=this._root?.querySelector('.ws-status');
      if (!bar) return;
      const rCount=this._h()._index.size(),cCount=this._h()._index.collectionCount();
      const pCount=this._h()._index._people.size();
      const pStr=pCount>0?` · ${pCount} people`:'';
      if (rCount>0) { bar.innerHTML=`<span class="ws-status-dot"></span>${cCount} collection${cCount!==1?'s':''} · ${rCount.toLocaleString()} records${pStr}`; }
      else { bar.innerHTML=`<span class="ws-status-dot ws-building"></span>Building index…`; }
    }

    _updateFooter(resultCount) {
      const countEl=this._root?.querySelector('.ws-result-count');
      if (!countEl) return;
      if (resultCount===null) { countEl.textContent=''; return; }
      countEl.textContent=`${resultCount.toLocaleString()} result${resultCount!==1?'s':''}`;
    }

    _getSavedSearches() { return this._h()._getSavedSearchesList(); }
    async _persistSavedSearches(list) { await this._h()._saveSavedSearches(list); }

    _renderSavedChips() { SearchPanelSaved.renderChips(this); }

    _openSaveForm() { SearchPanelSaved.openForm(this); }

    _cancelSaveForm(formEl) { SearchPanelSaved.cancelForm(this, formEl); }

    async _openConfig() { return SearchPanelConfig.open(this); }

    _closeConfig() { SearchPanelConfig.close(this); }

    _renderScopeChips() { SearchPanelScopeRow.renderChips(this); }
    _removeScopePart(part) { SearchPanelScopeRow.removePart(this,part); }

    _applyScopeSelection(scope) {
      const input=this._root?.querySelector('.ws-input');
      if (!input) return;
      this._scopeAliasResolved={
        underLineGuid:scope.underLineGuid||null,
        inRecordGuid:scope.inRecordGuid||null,
        inCollectionGuid:scope.inCollectionGuid||null,
      };
      input.value=wsMergeScopeIntoQuery(input.value,scope,{ useAliases:true });
      this._closeScopePicker();
      this._renderScopeChips();
      input.dispatchEvent(new Event('input'));
      input.focus();
    }

    _rerenderScopePickerAndFocus() { return SearchPanelScope.rerenderAndFocus(this); }
    _openScopePicker() { SearchPanelScope.open(this); }
    _closeScopePicker() { SearchPanelScope.close(this); }
    _scopePickerFocusDefault() { SearchPanelScope.focusDefault(this); }
    _scopePickerSetChrome(sp) { SearchPanelScope.setChrome(sp); }
    async _renderScopePickerList() { return SearchPanelScope.renderList(this); }
    async _renderScopePickerLines() { return SearchPanelScope.renderLines(this); }
  }

  /** Load all collections + records needed for people + main index (null on failure). */
  async function wsPluginFetchCollectionsAndRecords(plugin, config) {
    let allCols;
    try { allCols=wsCoerceCollectionArray(await plugin.data.getAllCollections()); } catch(e) { console.error('[WorkflowSearch] collections error:',e); return null; }
    let included=config.includedCollectionIds.length?allCols.filter(c=>config.includedCollectionIds.includes(c.getGuid())):allCols;
    if (!included.length&&allCols.length&&config.includedCollectionIds.length) {
      console.warn('[WorkflowSearch] includedCollectionIds matched no collections (stale or wrong workspace); indexing all collections instead.');
      included=allCols;
    }
    const needPeople=config.peopleCollectionGuid&&!included.find(c=>c.getGuid()===config.peopleCollectionGuid);
    const toFetch=needPeople?[...included,allCols.find(c=>c.getGuid()===config.peopleCollectionGuid)].filter(Boolean):included;
    let colData;
    try { colData=await Promise.all(toFetch.map(async(col)=>({col,records:await col.getAllRecords()}))); } catch(e) { console.error('[WorkflowSearch] records error:',e); return null; }
    return { allCols, included, colData };
  }

  /** Batch line fetch / body text / mentions / tasks for body index. */
  async function wsPluginBuildBodyIndexBatches(plugin, extractText) {
    const entries=[...plugin._index._entries.values()];
    const BATCH=15;
    for (let i=0;i<entries.length;i+=BATCH) {
      const batch=entries.slice(i,i+BATCH);
      await Promise.all(batch.map(async(entry)=>{
        try {
          const items=await entry.record.getLineItems(false);
          const flat=await wsFlattenLineItems(items);
          plugin._index.updateBodyText(entry.guid,extractText(flat));
          plugin._index.indexLineSubtrees(entry.guid,flat);
          plugin._extractMentions(entry.guid,flat);
          const stats=await wsComputeTaskCompletion(entry.record,flat);
          plugin._index.updateTaskCompletion(entry.guid,stats);
        } catch(e) {}
      }));
      await new Promise(r=>setTimeout(r,0));
    }
    console.log(`[WorkflowSearch] v${WS_VERSION} · Body index complete: ${entries.length} records`);
    plugin._refreshSearchPanel();
  }

  // ─── Plugin ───────────────────────────────────────────────────────────────────

  const WS_PANEL_TYPE='ws-search-panel';

  class Plugin extends AppPlugin {
    async onLoad() {
      _wsActiveHost=this;
      this._index=new SearchIndex(); this._parser=new QueryParser();
      this._searchPanelId=null; this._eventIds=[]; this._includedGuids=new Set();
      this._wsPersistMergedCache=null;
      this._knownColNames=new Map();

      this.ui.injectCSS(WS_CSS);

      this.ui.registerCustomPanelType(WS_PANEL_TYPE,(panel)=>{
        this._searchPanelId=panel.getId();
        panel.setTitle('Search');
        const sp=new SearchPanel(this,panel,this._parser);
        this._searchPanel=sp;
        sp.mount();
      });

      this._cmd=this.ui.addCommandPaletteCommand({label:'WorkflowSearch: Open search panel',icon:'search',onSelected:()=>this._openPanel()});
      this._sidebarItem=this.ui.addSidebarItem({label:'Search',icon:'search',tooltip:'Search collections (⌘⇧S)',onClick:()=>this._openPanel()});

      this._keyHandler=(e)=>{ const k=(e.key||'').toLowerCase(); if ((e.metaKey||e.ctrlKey)&&e.shiftKey&&k==='s') { e.preventDefault(); this._openPanel(); } };
      document.addEventListener('keydown',this._keyHandler,true);

      await this._maybeMigrateLocalStorageToPlugin();
      await this._buildIndex();

      this._eventIds.push(
        this.events.on('record.updated',(ev)=>{
          if (!this._includedGuids.has(ev.collectionGuid)) return;
          if (ev.trashed===true) { this._index.remove(ev.recordGuid); return; }
          const record=this.data.getRecord(ev.recordGuid);
          if (record) { this._index.upsert(record,ev.collectionGuid); void this._refreshBodyForRecord(record); }
        },{collection:'*'}),
        this.events.on('record.created',(ev)=>{
          if (!this._includedGuids.has(ev.collectionGuid)) return;
          const record=this.data.getRecord(ev.recordGuid);
          if (record) { this._index.upsert(record,ev.collectionGuid); void this._refreshBodyForRecord(record); }
        },{collection:'*'}),
        this.events.on('record.moved',(ev)=>{
          this._index.remove(ev.recordGuid);
          if (this._includedGuids.has(ev.collectionGuid)) {
            const record=this.data.getRecord(ev.recordGuid);
            if (record) { this._index.upsert(record,ev.collectionGuid); void this._refreshBodyForRecord(record); }
          }
        }),
        // Workspace collection changes: refresh our `_knownColNames` cache so the Settings panel
        // can always resolve GUID → name, and trigger a rebuild so search results stay current.
        // Crucial right after a `reload` where workspace data arrives asynchronously.
        this.events.on('collection.created',(ev)=>{ void this._captureCollectionFromEvent(ev); void this._buildIndex(); }),
        this.events.on('collection.updated',(ev)=>{ void this._captureCollectionFromEvent(ev); void this._buildIndex(); }),
        this.events.on('panel.closed',(ev)=>{ if (ev.panel.getId()===this._searchPanelId) this._searchPanelId=null; }),
        this.events.on('reload',()=>{ this._wsPersistMergedCache=null; void this._buildIndex(); })
      );
    }

    onUnload() {
      for (const id of (this._eventIds||[])) { try { this.events.off(id); } catch(e) {} }
      this._eventIds=[]; this._cmd?.remove?.(); this._sidebarItem?.remove?.();
      if (this._keyHandler) document.removeEventListener('keydown',this._keyHandler,true);
      if (this._buildRetryTimer) { clearTimeout(this._buildRetryTimer); this._buildRetryTimer=null; }
      try { this._searchPanel?._disposeThemeWatchers(); } catch(e) {}
      if (_wsActiveHost===this) _wsActiveHost=null;
    }

    async _openPanel() {
      if (this._searchPanelId) {
        const panels=this.ui.getPanels()||[];
        const existing=panels.find(p=>p.getId()===this._searchPanelId);
        if (existing) { this.ui.setActivePanel(existing); existing.getElement()?.querySelector('.ws-input')?.focus(); return; }
        this._searchPanelId=null;
      }
      const newPanel=await this.ui.createPanel();
      if (newPanel) newPanel.navigateToCustomType(WS_PANEL_TYPE);
    }

    _getRawPluginWorkflowSearch() {
      try {
        const api=this.data.getPluginByGuid(this.getGuid());
        if (!api||typeof api.getConfiguration!=='function') return undefined;
        const conf=api.getConfiguration();
        if (!conf||!conf.custom||!Object.prototype.hasOwnProperty.call(conf.custom,WS_CUSTOM_NS)) return undefined;
        return conf.custom[WS_CUSTOM_NS];
      } catch(e) { return undefined; }
    }

    /** Legacy split: `ws_saved_searches` wins when non-empty; else `savedSearches` inside `ws_search_config`. */
    _readLegacyLocalStoragePersist() {
      let cfg={},saved=[];
      try { cfg=JSON.parse(localStorage.getItem(WS_LS_CONFIG)||'{}'); } catch(e) {}
      try { saved=JSON.parse(localStorage.getItem(WS_LS_SAVED)||'[]'); } catch(e) {}
      const cfgS=Array.isArray(cfg.savedSearches)?cfg.savedSearches:[];
      const fileS=Array.isArray(saved)?saved:[];
      const pickSaved=fileS.length?fileS:cfgS;
      return wsNormalizePersist({ ...cfg,savedSearches:pickSaved });
    }

    /**
     * Prefer meaningful server `custom.workflowSearch`; if the server blob is empty or only defaults,
     * merge in legacy localStorage so `{}` / placeholder keys do not hide LS data.
     */
    _readMergedPersisted() {
      if (this._wsPersistMergedCache!=null) return JSON.parse(JSON.stringify(this._wsPersistMergedCache));
      const raw=this._getRawPluginWorkflowSearch();
      const serverNorm=raw!=null?wsNormalizePersist(raw):null;
      const legacy=this._readLegacyLocalStoragePersist();
      let merged;
      if (serverNorm&&this._persistMeaningful(serverNorm)) merged=serverNorm;
      else if (serverNorm) {
        if (this._persistMeaningful(legacy)) merged=wsNormalizePersist({ ...serverNorm,...legacy });
        else merged=serverNorm;
      } else merged=legacy;
      this._wsPersistMergedCache=merged;
      return JSON.parse(JSON.stringify(merged));
    }

    _persistMeaningful(p) {
      return !!(p.includedCollectionIds&&p.includedCollectionIds.length)||!!(p.peopleCollectionGuid)||!!(p.peopleNameProp)||(p.savedSearches&&p.savedSearches.length)||(p.tagPropName&&p.tagPropName!=='Tags');
    }

    async _maybeMigrateLocalStorageToPlugin() {
      const raw=this._getRawPluginWorkflowSearch();
      const serverNorm=raw!=null?wsNormalizePersist(raw):null;
      const legacy=this._readLegacyLocalStoragePersist();
      // One-time: meaningful server config but empty savedSearches while legacy LS still has chips
      // (older installs never merged LS into server once collections/people lived on the server).
      if (serverNorm&&this._persistMeaningful(serverNorm)&&!(serverNorm.savedSearches&&serverNorm.savedSearches.length)&&(legacy.savedSearches&&legacy.savedSearches.length)) {
        const api=this.data.getPluginByGuid(this.getGuid());
        if (!api||typeof api.saveConfiguration!=='function') return;
        await this._savePersisted({ savedSearches:legacy.savedSearches });
        return;
      }

      const merged=this._readMergedPersisted();
      if (!this._persistMeaningful(merged)) return;
      if (serverNorm&&this._persistMeaningful(serverNorm)) return;
      const api=this.data.getPluginByGuid(this.getGuid());
      if (!api||typeof api.saveConfiguration!=='function') return;
      await this._savePersisted(merged);
    }

    async _savePersisted(partial) {
      const prev=this._readMergedPersisted();
      // Opportunistically mirror the local-only theme into the server blob so it rides along on any real save (cross-device sync).
      const localTheme=wsReadLocalTheme();
      const nextRaw={ ...prev,...partial };
      if (localTheme) nextRaw.uiTheme=localTheme;
      const next=wsNormalizePersist(nextRaw);
      const api=this.data.getPluginByGuid(this.getGuid());
      const shapes=wsWorkflowSearchPersistShapes(next);
      const fallbackLs=()=>{
        try {
          localStorage.setItem(WS_LS_CONFIG,JSON.stringify(shapes.lsConfig));
          localStorage.setItem(WS_LS_SAVED,JSON.stringify(shapes.lsSaved));
        } catch(e) {}
      };
      if (!api||typeof api.getConfiguration!=='function'||typeof api.saveConfiguration!=='function') { fallbackLs(); this._wsPersistMergedCache=next; return; }
      try {
        const conf=api.getConfiguration();
        const custom={ ...(conf.custom||{}) };
        custom[WS_CUSTOM_NS]=shapes.customNs;
        await api.saveConfiguration({ ...conf,custom });
        try { localStorage.removeItem(WS_LS_CONFIG); localStorage.removeItem(WS_LS_SAVED); } catch(e2) {}
      } catch(e) {
        console.warn('[WorkflowSearch] saveConfiguration failed:',e);
        fallbackLs();
      }
      this._wsPersistMergedCache=next;
    }

    async _saveConfig(config) { await this._savePersisted(config); }

    _getEffectiveConfig() {
      const merged=wsNormalizePersist(this._readMergedPersisted());
      // Theme read strategy: `localStorage` wins (fast, no reload). If LS is empty, adopt the server/LS blob value
      // and mirror it into `localStorage` so this device behaves consistently from here on.
      const localTheme=wsReadLocalTheme();
      if (localTheme) merged.uiTheme=localTheme;
      else if (merged.uiTheme==='dark'||merged.uiTheme==='light'||merged.uiTheme==='system') wsWriteLocalTheme(merged.uiTheme);
      return merged;
    }

    _getSavedSearchesList() { return this._readMergedPersisted().savedSearches; }

    async _saveSavedSearches(list) { await this._savePersisted({ savedSearches:list }); }

    /**
     * Serialized index build.
     *
     * Post-save and post-`reload` can both trigger builds concurrently, and `getAllCollections()` can
     * return transiently empty while the syncer is settling. Guarantees:
     *   - Only ONE `_doBuildIndex` runs at a time (others are coalesced into a single pending rerun).
     *   - A transient empty fetch (0 collections from `getAllCollections`) never wipes a healthy index;
     *     we schedule a retry and leave the current index intact (so the UI doesn't flash "Building index…").
     */
    _buildIndex() {
      if (this._buildInFlight) { this._buildPending=true; return this._buildInFlight; }
      const run=(async()=>{
        try {
          do {
            this._buildPending=false;
            await this._doBuildIndex();
          } while (this._buildPending);
        } finally {
          this._buildInFlight=null;
        }
      })();
      this._buildInFlight=run;
      return run;
    }

    async _doBuildIndex() {
      const config=this._getEffectiveConfig();
      this._index.setTagPropName(config.tagPropName);
      const pack=await wsPluginFetchCollectionsAndRecords(this, config);
      if (!pack) return;
      const { allCols, included, colData }=pack;

      // Transient empty: workspace data not yet hydrated after a `reload`/`saveConfiguration`. Keep the
      // current index so the user keeps seeing real results, and schedule a retry via `_scheduleBuildRetry`.
      if (allCols.length===0) {
        this._scheduleBuildRetry();
        return;
      }
      this._buildRetryCount=0;

      const people=new PeopleIndex();
      people.configure(config.peopleCollectionGuid,config.peopleNameProp);
      people.build(allCols,colData);
      this._index.setPeople(people);

      this._includedGuids=new Set(included.map(c=>c.getGuid()));
      const searchColData=colData.filter(d=>this._includedGuids.has(d.col.getGuid()));
      this._index.build(searchColData);

      // Remember every workspace collection name we have seen (including People if it is not one of
      // the included/search collections) on the Plugin so the Settings panel can still resolve GUIDs →
      // names during a syncer hand-off when `getAllCollections()` returns partial data. Stored on the
      // Plugin (not `SearchIndex._colNames`) so the status-bar `collectionCount()` stays scoped to
      // indexed collections only.
      if (!this._knownColNames) this._knownColNames=new Map();
      for (const col of allCols) {
        try { const g=col.getGuid(), n=col.getName(); if (g) this._knownColNames.set(g, n||''); } catch(e) {}
      }

      void this._buildBodyIndex();

      this._refreshSearchPanel();
      console.log(`[WorkflowSearch] v${WS_VERSION} · Index: ${this._index.size()} records, ${this._index.collectionCount()} collections · People: ${people.size()}`);
    }

    /** Capture collection name from a collection.* event so `_knownColNames` stays complete even if `getAllCollections()` is partial. */
    _captureCollectionFromEvent(ev) {
      try {
        const guid=ev?.collectionGuid; if (!guid) return;
        if (!this._knownColNames) this._knownColNames=new Map();
        // Re-query by guid for the current name; fall back to retaining the existing name.
        const col=typeof this.data?.getCollection==='function'?this.data.getCollection(guid):null;
        let name='';
        if (col) { try { name=col.getName()||''; } catch(e) {} }
        if (!name && this._knownColNames.has(guid)) return;
        this._knownColNames.set(guid, name);
      } catch(e) {}
    }

    _scheduleBuildRetry() {
      const attempts=(this._buildRetryCount||0)+1;
      this._buildRetryCount=attempts;
      if (attempts>6) { console.warn('[WorkflowSearch] build retry giving up after 6 attempts'); return; }
      const delay=Math.min(400*attempts, 3000);
      clearTimeout(this._buildRetryTimer);
      this._buildRetryTimer=setTimeout(()=>{ this._buildRetryTimer=null; void this._buildIndex(); }, delay);
    }

    async _refreshBodyForRecord(record) {
      try {
        const items=await record.getLineItems(false);
        const flat=await wsFlattenLineItems(items);
        const em=this._index._entries;
        const text=flat.map(li=>wsTextFromLineItem(li,{recordEntryMap:em})).join(' ').slice(0,WS_BODY_INDEX_MAX_CHARS);
        this._index.updateBodyText(record.guid,text);
        this._index.indexLineSubtrees(record.guid,flat);
        this._index.clearMentionsForRecord(record.guid);
        this._extractMentions(record.guid,flat);
        const stats=await wsComputeTaskCompletion(record,flat);
        this._index.updateTaskCompletion(record.guid,stats);
        this._refreshSearchPanel();
      } catch(e) {}
    }

    _extractMentions(recordGuid, lineItems) {
      for (const li of lineItems||[]) {
        for (const seg of li.segments||[]) {
          if (seg.type==='ref'&&seg.text&&typeof seg.text==='object'&&seg.text.guid) {
            this._index.addMention(recordGuid, seg.text.guid);
          }
          if (seg.type==='mention'&&typeof seg.text==='string'&&seg.text) {
            this._index.addMention(recordGuid, seg.text);
          }
        }
      }
    }

    async _buildBodyIndex() {
      const em=this._index._entries;
      const extractText=(lineItems)=>lineItems.map(li=>wsTextFromLineItem(li,{recordEntryMap:em})).join(' ').slice(0,WS_BODY_INDEX_MAX_CHARS);
      await wsPluginBuildBodyIndexBatches(this, extractText);
    }

    _refreshSearchPanel() {
      if (!this._searchPanelId) return;
      const panels=this.ui.getPanels()||[];
      const sp=panels.find(p=>p.getId()===this._searchPanelId);
      if (!sp) return;
      this._notifyPanelRebuild(sp);
      const input=sp.getElement()?.querySelector('.ws-input');
      if (input&&input.value) {
        input.dispatchEvent(new Event('input'));
        return;
      }
      // No active query — re-render the empty state so the big "Building index…" placeholder clears
      // once the build is done (status bar is already updated by `_notifyPanelRebuild`).
      const panel=this._searchPanel;
      if (panel&&panel._root?.isConnected&&!panel._configMode) panel._renderEmptyState();
    }

    _notifyPanelRebuild(panel) {
      const statusBar=panel.getElement()?.querySelector('.ws-status');
      if (!statusBar) return;
      const rCount=this._index.size(),cCount=this._index.collectionCount(),pCount=this._index._people.size();
      const pStr=pCount>0?` · ${pCount} people`:'';
      statusBar.innerHTML=rCount>0
        ?`<span class="ws-status-dot"></span>${cCount} collection${cCount!==1?'s':''} · ${rCount.toLocaleString()} records${pStr}`
        :`<span class="ws-status-dot ws-building"></span>Building index…`;
    }
  }