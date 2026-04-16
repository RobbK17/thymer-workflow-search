/**
 * WorkflowSearch — AppPlugin
 * Version 1.0.0
 *
 * Persistent panel-based Workflowy-style search across Thymer collections.
 *
 * Syntax:
 *   term            → name contains term (AND by default)
 *   "exact phrase"  → name contains phrase
 *   #tag            → record has tag (paths: #self/foo; prefix: #self/ or #self/*)
 *   -#tag           → exclude exact tag; -#parent/ or -#parent/* → exclude parent and parent/… (full namespace)
 *   -term           → name does NOT contain term
 *   A OR B          → union of two groups
 *
 * Keyboard:
 *   ↑ ↓             → navigate results
 *   Enter           → open selected record in adjacent panel
 *   Cmd/Ctrl+Shift+S → open/focus search panel
 *   Cmd/Ctrl+S      → save current search
 */

const WS_VERSION = '1.0.0';

const WS_CSS = `
  .ws-root {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    width: 100%;
    overflow: hidden;
    color: #e8e0d0;
    font-family: var(--font-family, sans-serif);
    font-size: 13px;
    text-align: left;
    box-sizing: border-box;
  }
  /* ── Input wrapper (holds input + clear btn) ── */
  .ws-input-wrap { position: relative; flex: 1; min-width: 0; display: flex; align-items: center; }
  .ws-input-wrap .ws-input { width: 100%; padding-right: 28px; }
  .ws-clear-btn {
    position: absolute; right: 7px; top: 50%; transform: translateY(-50%);
    background: none; border: none; cursor: pointer; color: #8a7e6a;
    display: flex; align-items: center; justify-content: center;
    padding: 2px; border-radius: 3px; line-height: 1; transition: color 0.1s;
  }
  .ws-clear-btn:hover { color: #e8e0d0; }
  .ws-clear-btn .ti { font-size: 11px; }
  .ws-clear-btn.ws-hidden { display: none; }
  .ws-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 12px;
    border-bottom: 1px solid rgba(255,255,255,0.07);
    flex-shrink: 0;
  }
  .ws-header-icon { color: #8a7e6a; flex-shrink: 0; display: flex; align-items: center; }
  .ws-header-icon .ti { font-size: 16px; }
  .ws-input {
    flex: 1;
    background: rgba(255,255,255,0.05);
    border: 1px solid rgba(255,255,255,0.10);
    border-radius: 7px;
    outline: none;
    color: #e8e0d0;
    font-size: 14px;
    font-family: inherit;
    caret-color: #c4b8ff;
    min-width: 0;
    padding: 5px 10px;
    transition: border-color 0.12s;
  }
  .ws-input:focus { border-color: rgba(124,106,247,0.55); background: rgba(255,255,255,0.07); }
  .ws-input::placeholder { color: rgba(138,126,106,0.55); }
  .ws-icon-btn {
    display: inline-flex; align-items: center; gap: 4px;
    background: none; border: none; cursor: pointer; color: #8a7e6a;
    font-size: 11px; font-weight: 500; padding: 4px 7px; border-radius: 6px;
    transition: color 0.12s, background 0.12s; flex-shrink: 0; white-space: nowrap; font-family: inherit;
  }
  .ws-icon-btn .ti { font-size: 13px; vertical-align: -0.12em; }
  .ws-icon-btn:hover { color: #e8e0d0; background: rgba(255,255,255,0.07); }
  .ws-icon-btn.ws-active { color: #c4b8ff; background: rgba(124,106,247,0.18); }
  .ws-icon-btn.ws-hidden { display: none; }
  .ws-saved-row {
    display: flex; align-items: center; gap: 5px; padding: 6px 12px;
    border-bottom: 1px solid rgba(255,255,255,0.06); flex-wrap: wrap; flex-shrink: 0;
  }
  .ws-saved-label { font-size: 10px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: #8a7e6a; margin-right: 2px; flex-shrink: 0; }
  .ws-chip {
    display: inline-flex; align-items: center; gap: 3px;
    background: rgba(124,106,247,0.10); border: 1px solid rgba(124,106,247,0.22);
    border-radius: 20px; padding: 2px 6px 2px 9px; font-size: 11px; color: #c4b8ff;
    cursor: default; max-width: 140px; overflow: hidden;
  }
  .ws-chip-label { cursor: pointer; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 1; }
  .ws-chip-label:hover { text-decoration: underline; }
  .ws-chip-del { background: none; border: none; cursor: pointer; color: #8a7e6a; padding: 0 2px; line-height: 1; display: flex; align-items: center; flex-shrink: 0; transition: color 0.1s; }
  .ws-chip-del:hover { color: #e8e0d0; }
  .ws-chip-del .ti { font-size: 9px; }
  .ws-status {
    padding: 4px 14px; font-size: 10px; color: rgba(138,126,106,0.7); letter-spacing: 0.04em;
    border-bottom: 1px solid rgba(255,255,255,0.045); flex-shrink: 0; display: flex; align-items: center; gap: 6px;
  }
  .ws-status-dot { width: 5px; height: 5px; border-radius: 50%; background: #4caf50; flex-shrink: 0; }
  .ws-status-dot.ws-building { background: #ff9800; animation: ws-pulse 1.2s ease-in-out infinite; }
  @keyframes ws-pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
  .ws-body { flex: 1; overflow-y: auto; min-height: 0; padding: 2px 0 8px; }
  .ws-empty { padding: 32px 16px; text-align: center; color: #8a7e6a; font-size: 12px; line-height: 1.7; }
  .ws-empty-icon { margin-bottom: 10px; opacity: 0.65; }
  .ws-empty-icon .ti { font-size: 26px; }
  .ws-empty-hint { font-size: 10px; color: rgba(138,126,106,0.5); margin-top: 8px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; line-height: 1.9; }
  .ws-result { padding: 6px 12px; cursor: pointer; transition: background 0.08s; border-left: 2px solid transparent; }
  .ws-result:hover { background: rgba(255,255,255,0.04); }
  .ws-result.ws-selected { background: rgba(124,106,247,0.13); border-left-color: rgba(124,106,247,0.65); }
  .ws-result.ws-opened { border-left-color: rgba(76,175,80,0.7); }
  .ws-result-main { display: flex; align-items: center; gap: 7px; min-width: 0; }
  .ws-result-icon { color: #8a7e6a; flex-shrink: 0; display: flex; align-items: center; }
  .ws-result-icon .ti { font-size: 12px; }
  .ws-result-icon-dim { opacity: 0.35; }
  .ws-result-name { flex: 1; font-size: 12px; color: #e8e0d0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .ws-result-col { font-size: 9px; color: #8a7e6a; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.08); border-radius: 3px; padding: 1px 5px; white-space: nowrap; flex-shrink: 0; }
  .ws-result.ws-selected .ws-result-col { background: rgba(124,106,247,0.12); border-color: rgba(124,106,247,0.25); color: #c4b8ff; }
  .ws-result-tags { display: flex; gap: 4px; margin-top: 2px; margin-left: 19px; flex-wrap: wrap; }
  .ws-tag { font-size: 9px; color: #c4a882; background: rgba(196,168,130,0.09); border-radius: 3px; padding: 0 4px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  .ws-result.ws-selected .ws-tag { color: #c4b8ff; background: rgba(124,106,247,0.10); }
  .ws-body-sep { display: flex; align-items: center; gap: 8px; padding: 8px 12px 3px; font-size: 10px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: #8a7e6a; }
  .ws-body-sep::before, .ws-body-sep::after { content: ''; flex: 1; height: 1px; background: rgba(255,255,255,0.07); }
  .ws-body-badge { font-size: 9px; color: #c4a882; background: rgba(196,168,130,0.10); border: 1px solid rgba(196,168,130,0.20); border-radius: 3px; padding: 0 4px; margin-left: 4px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; flex-shrink: 0; }
  .ws-config-section { padding: 2px 0; }
  .ws-config-title { font-size: 10px; font-weight: 600; color: #8a7e6a; text-transform: uppercase; letter-spacing: 0.07em; padding: 10px 14px 5px; }
  .ws-config-col-list { padding: 0 6px; }
  .ws-config-col-row { display: flex; align-items: center; gap: 8px; padding: 6px 8px; cursor: pointer; border-radius: 6px; font-size: 12px; color: #e8e0d0; transition: background 0.1s; user-select: none; }
  .ws-config-col-row:hover { background: rgba(255,255,255,0.05); }
  .ws-config-cb { accent-color: #7c6af7; cursor: pointer; flex-shrink: 0; width: 13px; height: 13px; }
  .ws-config-divider { height: 1px; background: rgba(255,255,255,0.07); margin: 6px 14px; }
  .ws-config-field { display: flex; align-items: center; gap: 8px; padding: 0 14px 10px; }
  .ws-config-field-label { font-size: 11px; color: #8a7e6a; white-space: nowrap; flex-shrink: 0; }
  .ws-config-input { flex: 1; min-width: 0; padding: 4px 8px; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.12); border-radius: 5px; color: #e8e0d0; font-size: 12px; outline: none; font-family: inherit; transition: border-color 0.15s; }
  .ws-config-input:focus { border-color: rgba(124,106,247,0.6); }
  .ws-config-actions { display: flex; justify-content: flex-end; padding: 6px 14px 12px; gap: 6px; }
  .ws-btn { padding: 5px 14px; border-radius: 6px; border: none; cursor: pointer; font-size: 12px; font-weight: 500; font-family: inherit; transition: all 0.12s; }
  .ws-btn-primary { background: rgba(124,106,247,0.85); color: #fff; }
  .ws-btn-primary:hover { background: rgba(124,106,247,1); }
  .ws-btn-secondary { background: rgba(255,255,255,0.07); color: #e8e0d0; border: 1px solid rgba(255,255,255,0.10); }
  .ws-btn-secondary:hover { background: rgba(255,255,255,0.12); }
  .ws-footer { padding: 6px 12px; border-top: 1px solid rgba(255,255,255,0.07); flex-shrink: 0; display: flex; align-items: center; justify-content: space-between; }
  .ws-result-count { font-size: 10px; color: #8a7e6a; }
  .ws-hint { font-size: 9px; color: rgba(138,126,106,0.55); letter-spacing: 0.03em; }
  .ws-save-form { display: flex; align-items: center; gap: 6px; padding: 7px 12px; border-bottom: 1px solid rgba(255,255,255,0.07); background: rgba(124,106,247,0.06); flex-shrink: 0; }
  .ws-save-form-label { font-size: 10px; color: #8a7e6a; white-space: nowrap; flex-shrink: 0; }
  .ws-save-input { flex: 1; min-width: 0; padding: 3px 7px; background: rgba(255,255,255,0.07); border: 1px solid rgba(124,106,247,0.4); border-radius: 4px; color: #e8e0d0; font-size: 11px; outline: none; font-family: inherit; }
  .ws-save-input:focus { border-color: rgba(124,106,247,0.8); }
  .ws-body::-webkit-scrollbar { width: 4px; }
  .ws-body::-webkit-scrollbar-track { background: transparent; }
  .ws-body::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.12); border-radius: 2px; }
  .ws-body::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.2); }
`;

function wsEsc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function wsIcon(name) {
  const n = String(name||'').trim().replace(/^ti-/,'');
  if (!n || !/^[a-z][a-z0-9-]*$/.test(n)) return '';
  return `<i class="ti ti-${n}" aria-hidden="true"></i>`;
}

/** Lowercase, trim, normalize Unicode slashes and invisible chars so #self/ matches stored self. */
function wsNormalizeTagToken(tok) {
  return String(tok||'')
    .toLowerCase()
    .trim()
    .replace(/[\u200B-\u200D\uFEFF]/g,'')
    .replace(/\u2215/g,'/')
    .replace(/\uff0f/g,'/');
}

/**
 * Match a parsed hashtag token against stored tags (lowercase).
 * Include: #self → exact self only. #self/foo → exact path. #self/ or #self/* → self or self/…
 */
function wsTagQueryMatches(qTag, entryTags) {
  if (!qTag) return false;
  const qn = wsNormalizeTagToken(qTag);
  if (qn.endsWith('/*')) {
    const base = qn.slice(0, -2).replace(/\/+$/,'');
    if (!base) return false;
    return entryTags.some(t => t === base || t.startsWith(base + '/'));
  }
  if (qn.endsWith('/')) {
    const base = qn.slice(0, -1).replace(/\/+$/,'');
    if (!base) return false;
    return entryTags.some(t => t === base || t.startsWith(base + '/'));
  }
  return entryTags.includes(qn);
}

/**
 * Exclude: -#self → exact tag self only. -#self/ or -#self/* → exclude bare self and any self/… (same as include prefix).
 * -#self/foo → exact path only.
 */
function wsTagExcludeMatches(qTag, entryTags) {
  if (!qTag) return false;
  const qn = wsNormalizeTagToken(qTag);
  if (qn.endsWith('/*')) {
    const base = qn.slice(0, -2).replace(/\/+$/,'');
    if (!base) return false;
    return entryTags.some(t => t === base || t.startsWith(base + '/'));
  }
  if (qn.endsWith('/')) {
    const base = qn.slice(0, -1).replace(/\/+$/,'');
    if (!base) return false;
    return entryTags.some(t => t === base || t.startsWith(base + '/'));
  }
  if (qn.includes('/')) {
    return entryTags.includes(qn);
  }
  return entryTags.includes(qn);
}

// ─── Query Parser ─────────────────────────────────────────────────────────────

class QueryParser {
  parse(raw) {
    const trimmed = (raw||'').trim();
    if (!trimmed) return null;
    const parts = trimmed.split(/\s+OR\s+/).map(s=>s.trim()).filter(Boolean);
    if (parts.length > 1) {
      const groups = parts.map(p=>this._parseSegment(p)).filter(Boolean);
      return groups.length ? { type:'or', groups } : null;
    }
    const seg = this._parseSegment(trimmed);
    return seg ? { type:'and', ...seg } : null;
  }
  _parseSegment(raw) {
    if (!raw) return null;
    let s = raw;
    const includeTags=[],excludeTags=[],phrases=[],excludeTerms=[];
    let isCompleted=null;
    if (/\bis:completed\b/.test(s))  { isCompleted=true;  s=s.replace(/\bis:completed\b/g,' '); }
    if (/\-is:completed\b/.test(s))  { isCompleted=false; s=s.replace(/-is:completed\b/g,' '); }
    for (const m of [...s.matchAll(/"([^"]+)"/g)]) phrases.push(m[1].toLowerCase());
    s=s.replace(/"[^"]+"/g,' ');
    for (const m of [...s.matchAll(/-#([^\s#]+)/g)]) excludeTags.push(wsNormalizeTagToken(m[1]));
    s=s.replace(/-#[^\s#]+/g,' ');
    for (const m of [...s.matchAll(/#([^\s#]+)/g)]) includeTags.push(wsNormalizeTagToken(m[1]));
    s=s.replace(/#[^\s#]+/g,' ');
    for (const m of [...s.matchAll(/-(\S+)/g)]) excludeTerms.push(m[1].toLowerCase());
    s=s.replace(/-\S+/g,' ');
    const terms=s.split(/\s+/).map(t=>t.toLowerCase()).filter(Boolean);
    const isEmpty=!includeTags.length&&!excludeTags.length&&!phrases.length&&!excludeTerms.length&&!terms.length&&isCompleted===null;
    if (isEmpty) return null;
    return { includeTags,excludeTags,phrases,excludeTerms,terms,isCompleted };
  }
}

// ─── Search Index ─────────────────────────────────────────────────────────────

class SearchIndex {
  constructor() { this._entries=new Map(); this._colNames=new Map(); this._tagPropName='Tags'; }
  setTagPropName(name) { this._tagPropName=(typeof name==='string'&&name.trim())?name.trim():'Tags'; }
  /**
   * Resolve record.prop(...) case-insensitively: Thymer matches the property name literally,
   * so we try the configured name plus lower, upper, sentence-case, and title-cased words.
   */
  _tagPropForRecord(record) {
    const key=this._tagPropName;
    if (!key) return null;
    const variants=new Set([key, key.toLowerCase(), key.toUpperCase()]);
    if (key.length) variants.add(key.charAt(0).toUpperCase()+key.slice(1).toLowerCase());
    if (/\s/.test(key)) {
      variants.add(key.split(/\s+/).map(w=>w.charAt(0).toUpperCase()+w.slice(1).toLowerCase()).join(' '));
    }
    for (const n of variants) {
      try {
        const p=record.prop(n);
        if (p) return p;
      } catch(e) {}
    }
    return null;
  }
  build(colDataList) {
    this._entries.clear(); this._colNames.clear();
    for (const {col,records} of colDataList) {
      const cGuid=col.getGuid(), cName=col.getName();
      this._colNames.set(cGuid,cName);
      for (const record of records) this._entries.set(record.guid,this._makeEntry(record,cGuid,cName));
    }
  }
  upsert(record,collectionGuid) {
    const colName=this._colNames.get(collectionGuid)||'';
    this._entries.set(record.guid,this._makeEntry(record,collectionGuid,colName));
  }
  registerCollection(guid,name) { this._colNames.set(guid,name); }
  remove(guid) { this._entries.delete(guid); }
  size()            { return this._entries.size; }
  collectionCount() { return this._colNames.size; }
  _makeEntry(record,collectionGuid,collectionName) {
    let tags=[];
    try { const prop=this._tagPropForRecord(record); if(prop) tags=prop.texts().map(t=>wsNormalizeTagToken(String(t).replace(/^#/,''))).filter(Boolean); } catch(e) {}
    const name=record.getName()||'';
    for (const m of [...name.matchAll(/#([^\s#]+)/g)]) { const t=wsNormalizeTagToken(m[1]); if(!tags.includes(t)) tags.push(t); }
    const displayName=name.replace(/#[^\s#]+/g,'').replace(/\s{2,}/g,' ').trim()||name;
    return { guid:record.guid,name,displayName,nameLower:name.toLowerCase(),tags,collectionGuid,collectionName,record };
  }
  query(parsed,limit=150) {
    if (!parsed) return [];
    if (parsed.type==='or') {
      const seen=new Map();
      for (const group of parsed.groups) {
        for (const entry of this._filterGroup(group,limit)) { if(!seen.has(entry.guid)) seen.set(entry.guid,entry); if(seen.size>=limit) break; }
      }
      return [...seen.values()];
    }
    return this._filterGroup(parsed,limit);
  }
  _filterGroup(group,limit) {
    const {includeTags,excludeTags,phrases,excludeTerms,terms}=group; const out=[];
    for (const entry of this._entries.values()) {
      if (this._matches(entry,includeTags,excludeTags,phrases,excludeTerms,terms)) { out.push(entry); if(out.length>=limit) break; }
    }
    return out;
  }
  _matches(entry,includeTags,excludeTags,phrases,excludeTerms,terms) {
    if (includeTags.length&&!includeTags.every(t=>wsTagQueryMatches(t,entry.tags))) return false;
    if (excludeTags.some(t=>wsTagExcludeMatches(t,entry.tags))) return false;
    const bodyText=entry.bodyLower!==undefined?entry.bodyLower:'';
    const combined=bodyText?entry.nameLower+' '+bodyText:entry.nameLower;
    if (phrases.length&&!phrases.every(p=>combined.includes(p))) return false;
    if (excludeTerms.some(t=>combined.includes(t))) return false;
    if (terms.length&&!terms.every(t=>combined.includes(t))) return false;
    return true;
  }

  /** Set body text on an existing entry — called by background body indexer. */
  updateBodyText(guid,bodyText) {
    const entry=this._entries.get(guid);
    if (entry) entry.bodyLower=String(bodyText||'').toLowerCase();
  }

  /**
   * Include/exclude hashtag rules for the parsed query (handles OR groups).
   * Used when merging async searchByQuery hits, which only receive plain terms/phrases.
   */
  matchesParsedTagFilters(entry,parsed) {
    if (!parsed) return true;
    if (parsed.type==='or') {
      return parsed.groups.some(g=>this._tagGroupMatches(entry,g));
    }
    return this._tagGroupMatches(entry,parsed);
  }
  _tagGroupMatches(entry,group) {
    const includeTags=group.includeTags||[], excludeTags=group.excludeTags||[];
    if (includeTags.length&&!includeTags.every(t=>wsTagQueryMatches(t,entry.tags))) return false;
    if (excludeTags.some(t=>wsTagExcludeMatches(t,entry.tags))) return false;
    return true;
  }

  /**
   * Query with body text included. Returns { nameMatches[], bodyMatches[] }.
   * nameMatches: phrases/terms match the record title alone.
   * bodyMatches: phrases/terms need body (or title+body combined) — body-only or cross-field hits.
   */
  queryWithBody(parsed,limit=150) {
    if (!parsed) return {nameMatches:[],bodyMatches:[]};
    if (parsed.type==='or') {
      const nameSeen=new Map(),bodySeen=new Map();
      for (const group of parsed.groups) {
        const {nameMatches,bodyMatches}=this._filterGroupWithBody(group,limit);
        for (const e of nameMatches) { if(!nameSeen.has(e.guid)) nameSeen.set(e.guid,e); }
        for (const e of bodyMatches) { if(!nameSeen.has(e.guid)&&!bodySeen.has(e.guid)) bodySeen.set(e.guid,e); }
        if (nameSeen.size+bodySeen.size>=limit) break;
      }
      return {nameMatches:[...nameSeen.values()],bodyMatches:[...bodySeen.values()]};
    }
    return this._filterGroupWithBody(parsed,limit);
  }

  _filterGroupWithBody(group,limit) {
    const {includeTags,excludeTags,phrases,excludeTerms,terms}=group;
    const nameMatches=[],bodyMatches=[];
    for (const entry of this._entries.values()) {
      if (includeTags.length&&!includeTags.every(t=>wsTagQueryMatches(t,entry.tags))) continue;
      if (excludeTags.some(t=>wsTagExcludeMatches(t,entry.tags))) continue;
      const bodyText=entry.bodyLower!==undefined?entry.bodyLower:'';
      const combined=bodyText?entry.nameLower+' '+bodyText:entry.nameLower;
      if (excludeTerms.some(t=>combined.includes(t))) continue;
      const hasTextual=!!(phrases.length||terms.length);
      // Non-tag parts (phrases, terms) must match title and/or body together; classify for UI
      if (!hasTextual) {
        nameMatches.push(entry);
      } else if (this._matchesText(entry.nameLower,phrases,terms)) {
        nameMatches.push(entry);
      } else if (this._matchesText(combined,phrases,terms)) {
        bodyMatches.push({...entry,_bodyMatch:true});
      }
      if (nameMatches.length+bodyMatches.length>=limit) break;
    }
    return {nameMatches,bodyMatches};
  }

  /** Check phrases + terms against a single text string. */
  _matchesText(text,phrases,terms) {
    if (phrases.length&&!phrases.every(p=>text.includes(p))) return false;
    if (terms.length&&!terms.every(t=>text.includes(t))) return false;
    return true;
  }
}

// ─── Search Panel ─────────────────────────────────────────────────────────────

class SearchPanel {
  constructor(plugin,panel,index,parser) {
    this._plugin=plugin; this._panel=panel; this._index=index; this._parser=parser;
    this._nameResults=[]; this._bodyResults=[]; this._allResults=[];
    this._selectedIdx=-1; this._openedGuid=null;
    this._query=''; this._debounce=null; this._searchToken=0;
    this._configMode=false; this._saveMode=false; this._root=null;
  }

  mount() {
    const el=this._panel.getElement();
    if (!el) return;
    const root=document.createElement('div');
    root.className='ws-root'; this._root=root;
    root.appendChild(this._buildHeader());
    const savedRow=document.createElement('div'); savedRow.className='ws-saved-row'; root.appendChild(savedRow);
    const statusBar=document.createElement('div'); statusBar.className='ws-status'; root.appendChild(statusBar);
    const body=document.createElement('div'); body.className='ws-body'; root.appendChild(body);
    root.appendChild(this._buildFooter());
    root.addEventListener('keydown',(e)=>e.stopPropagation());

    // el covers the full panel area including Thymer's title bar.
    // Measure the bar height so we can push our content below it.
    const _inject = () => {
      el.innerHTML='';
      el.appendChild(root);
      this._renderSavedChips(); this._updateStatus(); this._renderEmptyState();
      setTimeout(()=>root.querySelector('.ws-input')?.focus(),80);

      // Detect the panel bar: it is a sibling/ancestor child positioned above el,
      // or a direct child of el's parent. Measure its height and apply as padding-top.
      requestAnimationFrame(()=>{
        let barHeight=0;
        // Walk up from el looking for a sibling that looks like a panel bar
        const parent=el.parentElement;
        if (parent) {
          for (const child of parent.children) {
            if (child===el) break;
            barHeight+=child.offsetHeight||0;
          }
        }
        // If nothing found above el, try el's own first child before our root
        if (barHeight===0) {
          const firstChild=el.firstElementChild;
          if (firstChild && firstChild!==root) barHeight=firstChild.offsetHeight||0;
        }
        // Fallback: if el's bounding top is > 0 relative to panel wrapper, use that
        if (barHeight===0 && parent) {
          const pRect=parent.getBoundingClientRect();
          const eRect=el.getBoundingClientRect();
          barHeight=Math.round(eRect.top-pRect.top);
        }
        root.style.paddingTop = (barHeight>0 ? barHeight : 38) + 'px';
      });
    };
    _inject();
  }

  refreshStatus() {
    this._updateStatus();
    if (!this._query&&!this._configMode) this._renderEmptyState();
  }

  _buildHeader() {
    const header=document.createElement('div'); header.className='ws-header';
    header.innerHTML=`
      <span class="ws-header-icon">${wsIcon('search')}</span>
      <div class="ws-input-wrap">
        <input class="ws-input" type="text" placeholder="Search collections…" autocomplete="off" spellcheck="false">
        <button class="ws-clear-btn ws-hidden" title="Clear search">${wsIcon('x')}</button>
      </div>
      <button class="ws-icon-btn ws-save-btn ws-hidden" title="Save search (Cmd+S)">${wsIcon('bookmark')} Save</button>
      <button class="ws-icon-btn ws-config-btn" title="Configure">${wsIcon('settings')}</button>
    `;
    const input=header.querySelector('.ws-input');
    const clearBtn=header.querySelector('.ws-clear-btn');
    const saveBtn=header.querySelector('.ws-save-btn');
    const configBtn=header.querySelector('.ws-config-btn');
    input.addEventListener('input',()=>{
      const q=input.value;
      clearBtn.classList.toggle('ws-hidden',!q.length);
      saveBtn.classList.toggle('ws-hidden',!q.trim());
      clearTimeout(this._debounce);
      this._debounce=setTimeout(()=>this._search(q),150);
    });
    input.addEventListener('keydown',(e)=>this._handleKey(e));
    clearBtn.addEventListener('click',()=>{
      input.value='';
      clearBtn.classList.add('ws-hidden');
      saveBtn.classList.add('ws-hidden');
      this._search('');
      input.focus();
    });
    saveBtn.addEventListener('click',()=>this._openSaveForm());
    configBtn.addEventListener('click',()=>this._configMode?this._closeConfig():this._openConfig());
    return header;
  }

  _buildFooter() {
    const footer=document.createElement('div'); footer.className='ws-footer';
    footer.innerHTML=`<span class="ws-result-count"></span><span class="ws-hint">↑↓ navigate &nbsp;·&nbsp; ⏎ open in panel &nbsp;·&nbsp; ⌘S save</span>`;
    return footer;
  }

  _handleKey(e) {
    e.stopPropagation();
    if (e.key==='ArrowDown') { e.preventDefault(); this._moveSelection(1); }
    else if (e.key==='ArrowUp') { e.preventDefault(); this._moveSelection(-1); }
    else if (e.key==='Enter') { e.preventDefault(); this._openSelected(); }
    else if ((e.metaKey||e.ctrlKey)&&e.key==='s') { e.preventDefault(); if(this._query.trim()) this._openSaveForm(); }
  }

  _moveSelection(dir) {
    if (!this._allResults.length) return;
    const next=this._selectedIdx+dir;
    this._selectedIdx=((next%this._allResults.length)+this._allResults.length)%this._allResults.length;
    this._highlightSelected(); this._scrollToSelected();
  }
  _highlightSelected() {
    this._root?.querySelectorAll('.ws-result').forEach((row,i)=>row.classList.toggle('ws-selected',i===this._selectedIdx));
  }
  _scrollToSelected() { this._root?.querySelector('.ws-result.ws-selected')?.scrollIntoView({block:'nearest'}); }
  _openSelected() {
    if (this._selectedIdx<0||!this._allResults[this._selectedIdx]) return;
    this._navigateToRecord(this._allResults[this._selectedIdx]);
  }

  async _navigateToRecord(entry) {
    this._openedGuid=entry.record.guid;
    this._highlightOpened();
    const myId=this._panel.getId();
    const allPanels=this._plugin.ui.getPanels()||[];
    const candidates=allPanels.filter(p=>p.getId()!==myId&&!p.isSidebar());
    const target=candidates.find(p=>p.isActive())||candidates[0]||null;

    const doNav=async(panel)=>{
      // Step 1: navigate to the record immediately so the panel starts loading it
      panel.navigateTo({ type:'edit_panel', rootId:entry.record.guid, workspaceGuid:this._plugin.getWorkspaceGuid() });
      this._plugin.ui.setActivePanel(panel);

      // Step 2: find a matching line item to scroll to and highlight
      const plainQuery=this._toPlainQuery(
        this._parser.parse(this._query)||{type:'and',terms:[],phrases:[],includeTags:[],excludeTags:[],excludeTerms:[],isCompleted:null}
      );
      if (!plainQuery) return;

      try {
        // Fetch line items (with 3s timeout) while the record is loading in the panel
        const lineItems=await Promise.race([
          entry.record.getLineItems(false),
          new Promise(r=>setTimeout(()=>r([]),3000))
        ]);
        if (!lineItems.length) return;

        const allTerms=plainQuery.toLowerCase().replace(/"/g,' ').split(/\s+/).filter(Boolean);
        const nameLower=entry.record.getName().toLowerCase();
        // Only require terms not already satisfied by the record name
        const bodyTerms=allTerms.filter(t=>!nameLower.includes(t));
        const searchTerms=bodyTerms.length?bodyTerms:allTerms;

        const match=lineItems.find(li=>{
          try {
            const text=(li.segments||[])
              .filter(s=>['text','bold','italic','code','hashtag'].includes(s.type))
              .map(s=>typeof s.text==='string'?s.text.toLowerCase():'')
              .join(' ');
            return searchTerms.every(t=>text.includes(t));
          } catch(e) { return false; }
        });

        if (!match) return;

        // Wait for the panel to finish rendering the record before scrolling
        await new Promise(r=>setTimeout(r,350));
        await panel.navigateTo({ itemGuid:match.guid, highlight:true });
      } catch(e) {
        console.warn('[WorkflowSearch] highlight failed:', e);
      }
    };

    if (target) { await doNav(target); }
    else {
      const newPanel=await this._plugin.ui.createPanel({afterPanel:this._panel});
      if (newPanel) await doNav(newPanel);
    }
  }

  _highlightOpened() {
    this._root?.querySelectorAll('.ws-result').forEach(row=>{
      const entry=this._allResults[parseInt(row.dataset.idx,10)];
      row.classList.toggle('ws-opened',!!(entry&&entry.guid===this._openedGuid));
    });
  }

  _search(query) {
    if (this._configMode) return;
    this._query=query;
    const token=++this._searchToken;
    const parsed=this._parser.parse(query);
    if (!parsed) {
      this._nameResults=[]; this._bodyResults=[]; this._allResults=[]; this._selectedIdx=-1;
      this._renderEmptyState(); this._updateFooter(null); return;
    }
    // Synchronous: name/tag matches + body matches already in the index
    const {nameMatches,bodyMatches}=this._index.queryWithBody(parsed);
    this._nameResults=nameMatches;
    this._bodyResults=bodyMatches;
    this._allResults=[...nameMatches,...bodyMatches];
    this._selectedIdx=this._allResults.length>0?0:-1;
    this._renderResults(); this._updateFooter(this._allResults.length);
    // Async fallback: searchByQuery for body text not yet indexed
    const plainQuery=this._toPlainQuery(parsed);
    if (plainQuery) void this._searchBody(plainQuery,token,parsed);
  }

  _toPlainQuery(parsed) {
    const groups=parsed.type==='or'?parsed.groups:[parsed];
    const terms=[],phrases=[];
    for (const g of groups) { if(g.terms) terms.push(...g.terms); if(g.phrases) phrases.push(...g.phrases); }
    return [...phrases.map(p=>`"${p}"`), ...terms].join(' ');
  }

  async _searchBody(plainQuery,token,parsed) {
    let result;
    try { result=await this._plugin.data.searchByQuery(plainQuery,50); } catch(e) { return; }
    if (token!==this._searchToken||!this._root?.isConnected||this._configMode) return;
    if (result.error) return;
    // Seed seen from both name results and already-indexed body results
    const seen=new Set([...this._nameResults.map(e=>e.guid),...this._bodyResults.map(e=>e.guid)]);
    const bodyEntries=[];
    const processRecord=(record)=>{
      if (!record||seen.has(record.guid)) return;
      seen.add(record.guid);
      // Only include records present in our index — records absent from the index
      // belong to excluded collections and must not appear in results.
      const indexed=this._index._entries.get(record.guid);
      if (indexed&&this._index.matchesParsedTagFilters(indexed,parsed)) bodyEntries.push({...indexed,_bodyMatch:true});
    };
    for (const r of (result.records||[])) processRecord(r);
    for (const line of (result.lines||[])) { try { processRecord(line.record); } catch(e) {} }
    if (!bodyEntries.length) return;
    this._bodyResults=bodyEntries;
    this._allResults=[...this._nameResults,...this._bodyResults];
    if (this._selectedIdx<0&&this._allResults.length>0) this._selectedIdx=0;
    this._renderResults(); this._updateFooter(this._allResults.length);
  }

  _renderEmptyState() {
    const body=this._root?.querySelector('.ws-body');
    if (!body||this._configMode) return;
    const count=this._index.size();
    if (count>0) {
      body.innerHTML=`<div class="ws-empty"><div class="ws-empty-icon">${wsIcon('search')}</div><div>Search ${count.toLocaleString()} records across ${this._index.collectionCount()} collection${this._index.collectionCount()!==1?'s':''}</div><div class="ws-empty-hint">#tag/path &nbsp; #parent/ &nbsp; #parent/* &nbsp; -#… &nbsp; "phrase" &nbsp; -term<br>term1 term2 &nbsp; A OR B</div></div>`;
    } else {
      body.innerHTML=`<div class="ws-empty"><div class="ws-empty-icon">${wsIcon('loader')}</div><div>Building index…</div></div>`;
    }
  }

  _renderResults() {
    const body=this._root?.querySelector('.ws-body');
    if (!body) return;
    if (this._allResults.length===0) {
      body.innerHTML=`<div class="ws-empty"><div class="ws-empty-icon">${wsIcon('search-off')}</div><div>No results</div></div>`;
      return;
    }
    const frag=document.createDocumentFragment();
    let rowIdx=0;
    const buildRow=(entry)=>{
      const idx=rowIdx++;
      const row=document.createElement('div');
      const isSelected=idx===this._selectedIdx, isOpened=entry.guid===this._openedGuid;
      row.className='ws-result'+(isSelected?' ws-selected':'')+(isOpened?' ws-opened':'');
      row.dataset.idx=String(idx);
      let iconHtml;
      try {
        const rawIcon=entry.record.getIcon(false);
        iconHtml=rawIcon?`<span class="ws-result-icon">${wsIcon(rawIcon.replace('ti-',''))}</span>`:`<span class="ws-result-icon ws-result-icon-dim">${wsIcon('file-text')}</span>`;
      } catch(e) { iconHtml=`<span class="ws-result-icon ws-result-icon-dim">${wsIcon('file-text')}</span>`; }
      const tagHtml=entry.tags.length?`<div class="ws-result-tags">${entry.tags.slice(0,5).map(t=>`<span class="ws-tag">#${wsEsc(t)}</span>`).join('')}</div>`:'';
      const bodyBadge=entry._bodyMatch?`<span class="ws-body-badge">body</span>`:'';
      row.innerHTML=`<div class="ws-result-main">${iconHtml}<span class="ws-result-name">${wsEsc(entry.displayName)}${bodyBadge}</span><span class="ws-result-col">${wsEsc(entry.collectionName)}</span></div>${tagHtml}`;
      row.addEventListener('click',()=>{ this._selectedIdx=idx; this._highlightSelected(); this._navigateToRecord(entry); });
      row.addEventListener('mouseenter',()=>{ this._selectedIdx=idx; this._highlightSelected(); });
      return row;
    };
    for (const entry of this._nameResults) frag.appendChild(buildRow(entry));
    if (this._bodyResults.length) {
      const sep=document.createElement('div'); sep.className='ws-body-sep'; sep.textContent='Body matches';
      frag.appendChild(sep);
      for (const entry of this._bodyResults) frag.appendChild(buildRow(entry));
    }
    body.innerHTML=''; body.appendChild(frag);
  }

  _updateStatus() {
    const bar=this._root?.querySelector('.ws-status');
    if (!bar) return;
    const rCount=this._index.size(),cCount=this._index.collectionCount();
    if (rCount>0) { bar.innerHTML=`<span class="ws-status-dot"></span>${cCount} collection${cCount!==1?'s':''} · ${rCount.toLocaleString()} records`; }
    else { bar.innerHTML=`<span class="ws-status-dot ws-building"></span>Building index…`; }
  }
  _updateFooter(resultCount) {
    const countEl=this._root?.querySelector('.ws-result-count');
    if (!countEl) return;
    if (resultCount===null) { countEl.textContent=''; return; }
    countEl.textContent=`${resultCount.toLocaleString()} result${resultCount!==1?'s':''}`;
  }

  _getSavedSearches() { try { return JSON.parse(localStorage.getItem('ws_saved_searches')||'[]'); } catch(e) { return []; } }
  _persistSavedSearches(list) { try { localStorage.setItem('ws_saved_searches',JSON.stringify(list)); } catch(e) {} }

  _renderSavedChips() {
    const row=this._root?.querySelector('.ws-saved-row');
    if (!row) return;
    const searches=this._getSavedSearches();
    row.innerHTML='';
    if (!searches.length) { row.style.display='none'; return; }
    row.style.display='flex';
    const label=document.createElement('span'); label.className='ws-saved-label'; label.textContent='Saved:'; row.appendChild(label);
    for (const s of searches) {
      const chip=document.createElement('div'); chip.className='ws-chip'; chip.title=s.query;
      const nameEl=document.createElement('span'); nameEl.className='ws-chip-label'; nameEl.textContent=s.name;
      nameEl.addEventListener('click',()=>{ const input=this._root?.querySelector('.ws-input'); if(input){input.value=s.query;input.dispatchEvent(new Event('input'));input.focus();} });
      const delBtn=document.createElement('button'); delBtn.className='ws-chip-del'; delBtn.title='Remove'; delBtn.innerHTML=wsIcon('x');
      delBtn.addEventListener('click',(e)=>{ e.stopPropagation(); this._persistSavedSearches(this._getSavedSearches().filter(x=>x.id!==s.id)); this._renderSavedChips(); });
      chip.appendChild(nameEl); chip.appendChild(delBtn); row.appendChild(chip);
    }
  }

  _openSaveForm() {
    if (this._saveMode||!this._query.trim()) return;
    this._saveMode=true;
    this._root?.querySelector('.ws-save-btn')?.classList.add('ws-active');
    const form=document.createElement('div'); form.className='ws-save-form';
    form.innerHTML=`<span class="ws-save-form-label">${wsIcon('bookmark')} Name:</span><input class="ws-save-input" type="text" placeholder="e.g. Open privacy tasks" autocomplete="off"><button class="ws-btn ws-btn-primary" style="padding:3px 10px;font-size:11px;">Save</button><button class="ws-btn ws-btn-secondary" style="padding:3px 9px;font-size:11px;">Cancel</button>`;
    const nameInput=form.querySelector('.ws-save-input');
    const [confirmBtn,cancelBtn]=form.querySelectorAll('.ws-btn');
    const commit=()=>{
      const name=nameInput.value.trim()||this._query.slice(0,40);
      const searches=this._getSavedSearches(); if(searches.length>=12) searches.shift();
      searches.push({id:`${Date.now().toString(36)}${Math.random().toString(36).slice(2,5)}`,name,query:this._query});
      this._persistSavedSearches(searches); this._cancelSaveForm(form); this._renderSavedChips();
      this._plugin.ui.addToaster({title:`Search saved: "${name}"`,dismissible:false,autoDestroyTime:2000});
    };
    confirmBtn.addEventListener('click',commit);
    cancelBtn.addEventListener('click',()=>this._cancelSaveForm(form));
    nameInput.addEventListener('keydown',(e)=>{ if(e.key==='Enter'){e.preventDefault();commit();} if(e.key==='Escape'){e.preventDefault();this._cancelSaveForm(form);} });
    this._root?.querySelector('.ws-header')?.after(form);
    setTimeout(()=>nameInput.focus(),10);
  }
  _cancelSaveForm(formEl) {
    this._saveMode=false;
    this._root?.querySelector('.ws-save-btn')?.classList.remove('ws-active');
    formEl?.remove(); this._root?.querySelector('.ws-input')?.focus();
  }

  async _openConfig() {
    this._configMode=true;
    this._root?.querySelector('.ws-config-btn')?.classList.add('ws-active');
    const body=this._root?.querySelector('.ws-body'); if (!body) return;
    body.innerHTML=`<div class="ws-empty">${wsIcon('loader')} Loading collections…</div>`;
    const config=this._plugin._getEffectiveConfig();
    let allCols=[]; try { allCols=await this._plugin.data.getAllCollections(); } catch(e) {}
    if (!this._configMode||!this._root?.isConnected) return;
    body.innerHTML='';
    const colSection=document.createElement('div'); colSection.className='ws-config-section';
    const colTitle=document.createElement('div'); colTitle.className='ws-config-title'; colTitle.textContent='Collections to include'; colSection.appendChild(colTitle);
    const colList=document.createElement('div'); colList.className='ws-config-col-list';
    for (const col of allCols) {
      const guid=col.getGuid(),name=col.getName();
      const included=!config.includedCollectionIds.length||config.includedCollectionIds.includes(guid);
      const row=document.createElement('label'); row.className='ws-config-col-row';
      const cb=document.createElement('input'); cb.type='checkbox'; cb.className='ws-config-cb'; cb.checked=included; cb.dataset.guid=guid;
      const nameEl=document.createElement('span'); nameEl.textContent=name;
      row.appendChild(cb); row.appendChild(nameEl); colList.appendChild(row);
    }
    colSection.appendChild(colList); body.appendChild(colSection);
    const div=document.createElement('div'); div.className='ws-config-divider'; body.appendChild(div);
    const tagSection=document.createElement('div'); tagSection.className='ws-config-section';
    const tagTitle=document.createElement('div'); tagTitle.className='ws-config-title'; tagTitle.textContent='Hashtag property name'; tagSection.appendChild(tagTitle);
    const tagField=document.createElement('div'); tagField.className='ws-config-field';
    const tagLabel=document.createElement('span'); tagLabel.className='ws-config-field-label'; tagLabel.textContent='Property:';
    const tagInput=document.createElement('input'); tagInput.className='ws-config-input'; tagInput.value=config.tagPropName; tagInput.placeholder='Tags';
    tagField.appendChild(tagLabel); tagField.appendChild(tagInput); tagSection.appendChild(tagField); body.appendChild(tagSection);
    const actions=document.createElement('div'); actions.className='ws-config-actions';
    const cancelBtn=document.createElement('button'); cancelBtn.className='ws-btn ws-btn-secondary'; cancelBtn.textContent='Cancel'; cancelBtn.addEventListener('click',()=>this._closeConfig());
    const saveBtn=document.createElement('button'); saveBtn.className='ws-btn ws-btn-primary'; saveBtn.textContent='Save & Rebuild';
    saveBtn.addEventListener('click',async()=>{
      const checked=[...colList.querySelectorAll('.ws-config-cb:checked')].map(cb=>cb.dataset.guid);
      const allChecked=checked.length===allCols.length;
      this._plugin._saveConfig({includedCollectionIds:allChecked?[]:checked,tagPropName:tagInput.value.trim()||'Tags'});
      this._closeConfig();
      await this._plugin._buildIndex();
      // Re-run current query against the new index so results update immediately
      if (this._query) this._search(this._query);
    });
    actions.appendChild(cancelBtn); actions.appendChild(saveBtn); body.appendChild(actions);
  }

  _closeConfig() {
    this._configMode=false;
    this._root?.querySelector('.ws-config-btn')?.classList.remove('ws-active');
    if (this._allResults.length>0) { this._renderResults(); this._updateFooter(this._allResults.length); }
    else { this._renderEmptyState(); this._updateFooter(null); }
    this._root?.querySelector('.ws-input')?.focus();
  }
}

// ─── Plugin ───────────────────────────────────────────────────────────────────

const WS_PANEL_TYPE='ws-search-panel';

class Plugin extends AppPlugin {
  async onLoad() {
    this._index=new SearchIndex(); this._parser=new QueryParser();
    this._searchPanelId=null; this._eventIds=[]; this._includedGuids=new Set();

    this.ui.injectCSS(WS_CSS);

    this.ui.registerCustomPanelType(WS_PANEL_TYPE,(panel)=>{
      this._searchPanelId=panel.getId();
      panel.setTitle('Search');
      const sp=new SearchPanel(this,panel,this._index,this._parser);
      sp.mount();
    });

    this._cmd=this.ui.addCommandPaletteCommand({ label:'WorkflowSearch: Open search panel', icon:'search', onSelected:()=>this._openPanel() });
    this._sidebarItem=this.ui.addSidebarItem({ label:'Search', icon:'search', tooltip:'Search collections (Ctrl+Shift+S)', onClick:()=>this._openPanel() });

    this._keyHandler=(e)=>{ if((e.metaKey||e.ctrlKey)&&e.shiftKey&&e.key==='S'){e.preventDefault();this._openPanel();} };
    document.addEventListener('keydown',this._keyHandler,true);

    await this._buildIndex();

    this._eventIds.push(
      this.events.on('record.updated',(ev)=>{
        if (!this._includedGuids.has(ev.collectionGuid)) return;
        if (ev.trashed===true) { this._index.remove(ev.recordGuid); return; }
        const record=this.data.getRecord(ev.recordGuid); if(record) this._index.upsert(record,ev.collectionGuid);
      },{collection:'*'}),
      this.events.on('record.created',(ev)=>{
        if (!this._includedGuids.has(ev.collectionGuid)) return;
        const record=this.data.getRecord(ev.recordGuid); if(record) this._index.upsert(record,ev.collectionGuid);
      },{collection:'*'}),
      this.events.on('record.moved',(ev)=>{
        this._index.remove(ev.recordGuid);
        if (this._includedGuids.has(ev.collectionGuid)) { const record=this.data.getRecord(ev.recordGuid); if(record) this._index.upsert(record,ev.collectionGuid); }
      }),
      this.events.on('panel.closed',(ev)=>{ if(ev.panel.getId()===this._searchPanelId) this._searchPanelId=null; }),
      this.events.on('reload',async()=>{ await this._buildIndex(); })
    );
  }

  onUnload() {
    for (const id of (this._eventIds||[])) { try { this.events.off(id); } catch(e) {} }
    this._eventIds=[]; this._cmd?.remove?.(); this._sidebarItem?.remove?.();
    if (this._keyHandler) document.removeEventListener('keydown',this._keyHandler,true);
  }

  async _openPanel() {
    if (this._searchPanelId) {
      const panels=this.ui.getPanels()||[];
      const existing=panels.find(p=>p.getId()===this._searchPanelId);
      if (existing) {
        this.ui.setActivePanel(existing);
        existing.getElement()?.querySelector('.ws-input')?.focus();
        return;
      }
      this._searchPanelId=null;
    }
    const newPanel=await this.ui.createPanel();
    if (newPanel) newPanel.navigateToCustomType(WS_PANEL_TYPE);
  }

  _loadConfig() { try { return JSON.parse(localStorage.getItem('ws_search_config')||'{}'); } catch(e) { return {}; } }
  _saveConfig(config) { try { localStorage.setItem('ws_search_config',JSON.stringify(config)); } catch(e) {} }
  _getEffectiveConfig() {
    const raw=this._loadConfig();
    return { includedCollectionIds:Array.isArray(raw.includedCollectionIds)?raw.includedCollectionIds:[], tagPropName:typeof raw.tagPropName==='string'&&raw.tagPropName.trim()?raw.tagPropName.trim():'Tags' };
  }

  async _buildIndex() {
    const config=this._getEffectiveConfig();
    this._index.setTagPropName(config.tagPropName);
    let allCols; try { allCols=await this.data.getAllCollections(); } catch(e) { console.error('[WorkflowSearch] collections error:',e); return; }
    const included=config.includedCollectionIds.length?allCols.filter(c=>config.includedCollectionIds.includes(c.getGuid())):allCols;
    let colData; try { colData=await Promise.all(included.map(async(col)=>({col,records:await col.getAllRecords()}))); } catch(e) { console.error('[WorkflowSearch] records error:',e); return; }
    this._includedGuids=new Set(included.map(c=>c.getGuid()));
    this._index.build(colData);
    // Fast index ready — kick off background body text indexing
    void this._buildBodyIndex();
    // Refresh open search panel status bar if visible
    if (this._searchPanelId) {
      const panels=this.ui.getPanels()||[];
      const sp=panels.find(p=>p.getId()===this._searchPanelId);
      sp?.getElement()?.querySelector('.ws-root') && this._notifyPanelRebuild(sp);
    }
    console.log(`[WorkflowSearch] v${WS_VERSION} · Index: ${this._index.size()} records, ${this._index.collectionCount()} collections`);
  }

  /**
   * Background body indexer — fetches line items for all indexed records in
   * batches, writes bodyLower onto each entry. Runs after the fast index build.
   * Yields between batches so it never blocks the UI thread.
   */
  async _buildBodyIndex() {
    const entries=[...this._index._entries.values()];
    const BATCH=15, MAX_CHARS=8000;
    const extractText=(lineItems)=>lineItems
      .map(li=>{ try { return (li.segments||[]).filter(s=>['text','bold','italic','code','hashtag'].includes(s.type)).map(s=>typeof s.text==='string'?s.text:'').join(''); } catch(e){return '';} })
      .join(' ')
      .slice(0,MAX_CHARS);

    for (let i=0;i<entries.length;i+=BATCH) {
      const batch=entries.slice(i,i+BATCH);
      await Promise.all(batch.map(async(entry)=>{
        try {
          const items=await entry.record.getLineItems(false);
          this._index.updateBodyText(entry.guid,extractText(items));
        } catch(e) {}
      }));
      // Yield between batches — keeps UI responsive
      await new Promise(r=>setTimeout(r,0));
    }

    console.log(`[WorkflowSearch] v${WS_VERSION} · Body index complete: ${entries.length} records`);

    // Notify the open search panel so it can re-run the current query
    if (this._searchPanelId) {
      const panels=this.ui.getPanels()||[];
      const sp=panels.find(p=>p.getId()===this._searchPanelId);
      if (sp) {
        this._notifyPanelRebuild(sp);
        // Ask the panel to re-run the current query with body text now available
        const input=sp.getElement()?.querySelector('.ws-input');
        if (input&&input.value) input.dispatchEvent(new Event('input'));
      }
    }
  }

  _notifyPanelRebuild(panel) {
    // Update status bar text directly since we can't reach the SearchPanel instance
    const statusBar=panel.getElement()?.querySelector('.ws-status');
    if (!statusBar) return;
    const rCount=this._index.size(),cCount=this._index.collectionCount();
    statusBar.innerHTML=rCount>0
      ?`<span class="ws-status-dot"></span>${cCount} collection${cCount!==1?'s':''} · ${rCount.toLocaleString()} records`
      :`<span class="ws-status-dot ws-building"></span>Building index…`;
  }
}