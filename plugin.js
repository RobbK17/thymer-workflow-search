/**
 * WorkflowSearch — AppPlugin
 * Version 1.0.7
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
 *   is:completed    → records with at least one completed task
 *   -is:completed   → records with at least one open task
 *   @name           → records linking to person named "name" (exact, case-insensitive)
 *   @name*          → records linking to any person whose title starts with "name"
 *   \@name          → literal text search for "@name" (escaped)
 *   fieldname:@name → records where property "fieldname" links to person "name"
 *   mentions:@name  → records containing an inline ref to person "name"
 *
 * Keyboard:
 *   ↑ ↓             → navigate results
 *   Enter           → open selected record in adjacent panel
 *   ⌘⇧S / Ctrl+Shift+S → open/focus search panel
 *   ⌘S / Ctrl+S     → save current search
 */

const WS_VERSION = '1.0.7';

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
    display: flex; align-items: center; gap: 8px; padding: 10px 12px;
    border-bottom: 1px solid rgba(255,255,255,0.07); flex-shrink: 0;
  }
  .ws-header-icon { color: #8a7e6a; flex-shrink: 0; display: flex; align-items: center; }
  .ws-header-icon .ti { font-size: 16px; }
  .ws-input {
    flex: 1; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.10);
    border-radius: 7px; outline: none; color: #e8e0d0; font-size: 14px; font-family: inherit;
    caret-color: #c4b8ff; min-width: 0; padding: 5px 10px; transition: border-color 0.12s;
  }
  .ws-input:focus { border-color: rgba(124,106,247,0.55); background: rgba(255,255,255,0.07); }
  .ws-input::placeholder { color: rgba(138,126,106,0.55); }
  .ws-icon-btn {
    display: inline-flex; align-items: center; gap: 4px; background: none; border: none;
    cursor: pointer; color: #8a7e6a; font-size: 11px; font-weight: 500; padding: 4px 7px;
    border-radius: 6px; transition: color 0.12s, background 0.12s; flex-shrink: 0;
    white-space: nowrap; font-family: inherit;
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
    display: inline-flex; align-items: center; gap: 3px; background: rgba(124,106,247,0.10);
    border: 1px solid rgba(124,106,247,0.22); border-radius: 20px; padding: 2px 6px 2px 9px;
    font-size: 11px; color: #c4b8ff; cursor: default; max-width: 140px; overflow: hidden;
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
  .ws-result-wrap { border-left: 2px solid transparent; }
  .ws-result-wrap.ws-selected { background: rgba(124,106,247,0.13); border-left-color: rgba(124,106,247,0.65); }
  .ws-result-wrap.ws-opened { border-left-color: rgba(76,175,80,0.7); }
  .ws-result-row { display: flex; align-items: flex-start; gap: 0; min-width: 0; }
  .ws-result-expand {
    flex-shrink: 0; align-self: flex-start; margin-top: 2px; background: none; border: none;
    cursor: pointer; color: #8a7e6a; padding: 2px 4px 2px 8px; border-radius: 4px;
    line-height: 1; transition: color 0.1s, transform 0.12s;
  }
  .ws-result-expand:hover { color: #e8e0d0; background: rgba(255,255,255,0.04); }
  .ws-result-expand.ws-expanded { transform: rotate(90deg); color: #c4b8ff; }
  .ws-result-expand.ws-hidden { display: none; }
  .ws-result-expand .ti { font-size: 14px; }
  .ws-preview { padding: 0 12px 8px 32px; font-size: 11px; color: #a89a82; line-height: 1.45; }
  .ws-preview-loading, .ws-preview-empty { padding: 4px 0 2px; color: #8a7e6a; font-style: italic; }
  .ws-preview-line {
    padding: 4px 8px; margin: 2px 0; border-radius: 5px; cursor: pointer;
    border: 1px solid rgba(255,255,255,0.06); background: rgba(255,255,255,0.03);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .ws-preview-line:hover { background: rgba(124,106,247,0.12); border-color: rgba(124,106,247,0.25); color: #e8e0d0; }
  .ws-preview-prop {
    padding: 4px 8px; margin: 2px 0; border-radius: 5px;
    border: 1px solid rgba(100,180,255,0.12); background: rgba(100,180,255,0.05);
    display: flex; align-items: center; gap: 6px; font-size: 11px; color: #a89a82;
    cursor: pointer;
  }
  .ws-preview-prop:hover { background: rgba(100,180,255,0.12); border-color: rgba(100,180,255,0.3); color: #e8e0d0; }
  .ws-preview-prop-name { color: #8a7e6a; flex-shrink: 0; }
  .ws-preview-prop-arrow { color: #8a7e6a; flex-shrink: 0; }
  .ws-preview-prop-value { color: #a8d8ff; }
  .ws-result { flex: 1; min-width: 0; padding: 6px 12px 6px 4px; cursor: pointer; transition: background 0.08s; }
  .ws-result:hover { background: rgba(255,255,255,0.04); }
  .ws-result-main { display: flex; align-items: center; gap: 7px; min-width: 0; }
  .ws-result-icon { color: #8a7e6a; flex-shrink: 0; display: flex; align-items: center; }
  .ws-result-icon .ti { font-size: 12px; }
  .ws-result-icon-dim { opacity: 0.35; }
  .ws-result-name { flex: 1; font-size: 12px; color: #e8e0d0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .ws-result-col { font-size: 9px; color: #8a7e6a; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.08); border-radius: 3px; padding: 1px 5px; white-space: nowrap; flex-shrink: 0; }
  .ws-result-wrap.ws-selected .ws-result-col { background: rgba(124,106,247,0.12); border-color: rgba(124,106,247,0.25); color: #c4b8ff; }
  .ws-result-tags { display: flex; gap: 4px; margin-top: 2px; margin-left: 19px; flex-wrap: wrap; }
  .ws-tag { font-size: 9px; color: #c4a882; background: rgba(196,168,130,0.09); border-radius: 3px; padding: 0 4px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  .ws-result-wrap.ws-selected .ws-tag { color: #c4b8ff; background: rgba(124,106,247,0.10); }
  .ws-body-sep { display: flex; align-items: center; gap: 8px; padding: 8px 12px 3px; font-size: 10px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: #8a7e6a; }
  .ws-body-sep::before, .ws-body-sep::after { content: ''; flex: 1; height: 1px; background: rgba(255,255,255,0.07); }
  .ws-body-badge { font-size: 9px; color: #c4a882; background: rgba(196,168,130,0.10); border: 1px solid rgba(196,168,130,0.20); border-radius: 3px; padding: 0 4px; margin-left: 4px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; flex-shrink: 0; }
  .ws-person-badge { font-size: 9px; color: #a8d8ff; background: rgba(100,180,255,0.10); border: 1px solid rgba(100,180,255,0.25); border-radius: 3px; padding: 0 4px; margin-left: 4px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; flex-shrink: 0; }
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
  .ws-config-select { flex: 1; min-width: 0; padding: 4px 8px; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.12); border-radius: 5px; color: #e8e0d0; font-size: 12px; outline: none; font-family: inherit; cursor: pointer; }
  .ws-config-select option { background: #1c1a22; }
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
function wsRootLineItems(record,lineItems) {
  if (!lineItems||!lineItems.length) return [];
  const rg=record.guid;
  const roots=lineItems.filter(li=>{ try { const p=li.parent_guid; return p==null||p===undefined||p===rg; } catch(e) { return true; } });
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
function wsCompletionPreviewFilter(parsed) {
  if (!parsed) return null;
  if (parsed.type==='or') { for (const g of parsed.groups) { if (g.isCompleted!==null&&g.isCompleted!==undefined) return g.isCompleted; } return null; }
  if (parsed.isCompleted!==null&&parsed.isCompleted!==undefined) return parsed.isCompleted;
  return null;
}
/**
 * Returns the person filter context from the parsed query:
 * { personRefs, mentionRefs } if any @-syntax present, null otherwise.
 */
function wsPersonPreviewFilter(parsed) {
  if (!parsed) return null;
  const groups = parsed.type==='or' ? parsed.groups : [parsed];
  const personRefs=[], mentionRefs=[];
  for (const g of groups) {
    if (g.personRefs)   personRefs.push(...g.personRefs);
    if (g.mentionRefs)  mentionRefs.push(...g.mentionRefs);
  }
  if (!personRefs.length && !mentionRefs.length) return null;
  return { personRefs, mentionRefs };
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
function wsTextFromLineItem(li) {
  try { return (li.segments||[]).filter(s=>['text','bold','italic','code','hashtag'].includes(s.type)).map(s=>typeof s.text==='string'?s.text:'').join('').trim(); } catch(e) { return ''; }
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
}

// ─── Query Parser ─────────────────────────────────────────────────────────────

class QueryParser {
  parse(raw) {
    const trimmed=(raw||'').trim();
    if (!trimmed) return null;
    const parts=trimmed.split(/\s+OR\s+/).map(s=>s.trim()).filter(Boolean);
    if (parts.length>1) {
      const groups=parts.map(p=>this._parseSegment(p)).filter(Boolean);
      return groups.length?{type:'or',groups}:null;
    }
    const seg=this._parseSegment(trimmed);
    return seg?{type:'and',...seg}:null;
  }

  _parseSegment(raw) {
    if (!raw) return null;
    let s=raw;
    const includeTags=[],excludeTags=[],phrases=[],excludeTerms=[];
    const personRefs=[];      // { token, wildcard, mode:'backlink'|'field', field:string|null }
    const mentionRefs=[];     // { token, wildcard }
    let isCompleted=null;

    // is:completed / -is:completed
    if (/\-is:completed\b/.test(s))  { isCompleted=false; s=s.replace(/-is:completed\b/g,' '); }
    if (/\bis:completed\b/.test(s))  { isCompleted=true;  s=s.replace(/\bis:completed\b/g,' '); }

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

    // quoted phrases
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

    const isEmpty=!includeTags.length&&!excludeTags.length&&!phrases.length&&
      !excludeTerms.length&&!terms.length&&isCompleted===null&&
      !personRefs.length&&!mentionRefs.length;
    if (isEmpty) return null;

    return { includeTags,excludeTags,phrases,excludeTerms,terms,isCompleted,personRefs,mentionRefs };
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

  build(colDataList) {
    this._entries.clear(); this._colNames.clear(); this._mentionIndex.clear();
    for (const {col,records} of colDataList) {
      const cGuid=col.getGuid(),cName=col.getName();
      this._colNames.set(cGuid,cName);
      for (const record of records) this._entries.set(record.guid,this._makeEntry(record,cGuid,cName));
    }
  }

  upsert(record,collectionGuid) {
    const colName=this._colNames.get(collectionGuid)||'';
    this._entries.set(record.guid,this._makeEntry(record,collectionGuid,colName));
  }

  registerCollection(guid,name) { this._colNames.set(guid,name); }
  remove(guid) {
    this._entries.delete(guid);
    // Clean up mention index
    for (const [,set] of this._mentionIndex) set.delete(guid);
  }

  size()            { return this._entries.size; }
  collectionCount() { return this._colNames.size; }

  _makeEntry(record,collectionGuid,collectionName) {
    let tags=[];
    try { const prop=this._tagPropForRecord(record); if (prop) tags=prop.texts().map(t=>wsNormalizeTagToken(String(t).replace(/^#/,''))).filter(Boolean); } catch(e) {}
    const name=record.getName()||'';
    for (const m of [...name.matchAll(/#([^\s#]+)/g)]) { const t=wsNormalizeTagToken(m[1]); if (!tags.includes(t)) tags.push(t); }
    const displayName=name.replace(/#[^\s#]+/g,'').replace(/\s{2,}/g,' ').trim()||name;
    return { guid:record.guid,name,displayName,nameLower:name.toLowerCase(),tags,collectionGuid,collectionName,record };
  }

  /** Add person mention (ref segment) during body indexing. */
  addMention(recordGuid, personGuid) {
    if (!this._mentionIndex.has(personGuid)) this._mentionIndex.set(personGuid,new Set());
    this._mentionIndex.get(personGuid).add(recordGuid);
  }

  /** Get record guids that mention a person guid. */
  getMentioners(personGuid) { return this._mentionIndex.get(personGuid)||new Set(); }

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
    if (parsed.type==='or') return parsed.groups.some(g=>this._entryMatchesGroup(entry,g));
    return this._entryMatchesGroup(entry,parsed);
  }

  _entryMatchesGroup(entry,group) {
    const includeTags=group.includeTags||[],excludeTags=group.excludeTags||[];
    if (includeTags.length&&!includeTags.every(t=>wsTagQueryMatches(t,entry.tags))) return false;
    if (excludeTags.some(t=>wsTagExcludeMatches(t,entry.tags))) return false;
    if (!wsMatchesCompletionFilter(entry,group.isCompleted)) return false;
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
        const {nameMatches,bodyMatches}=this._filterGroupWithBody(group,limit);
        for (const e of nameMatches) { if (!nameSeen.has(e.guid)) nameSeen.set(e.guid,e); }
        for (const e of bodyMatches) { if (!nameSeen.has(e.guid)&&!bodySeen.has(e.guid)) bodySeen.set(e.guid,e); }
        if (nameSeen.size+bodySeen.size>=limit) break;
      }
      return {nameMatches:[...nameSeen.values()],bodyMatches:[...bodySeen.values()]};
    }
    return this._filterGroupWithBody(parsed,limit);
  }

  _filterGroupWithBody(group,limit) {
    const {includeTags,excludeTags,phrases,excludeTerms,terms,isCompleted=null}=group;
    const nameMatches=[],bodyMatches=[];

    // Resolve person filters to an allowed set (null = no restriction)
    const personAllowed = this._resolvePersonFilters(group);

    for (const entry of this._entries.values()) {
      // Person filter gate
      if (personAllowed !== null && !personAllowed.has(entry.guid)) continue;

      if (includeTags.length&&!includeTags.every(t=>wsTagQueryMatches(t,entry.tags))) continue;
      if (excludeTags.some(t=>wsTagExcludeMatches(t,entry.tags))) continue;
      if (!wsMatchesCompletionFilter(entry,isCompleted)) continue;

      const bodyText=entry.bodyLower!==undefined?entry.bodyLower:'';
      const combined=bodyText?entry.nameLower+' '+bodyText:entry.nameLower;
      if (excludeTerms.some(t=>combined.includes(t))) continue;

      const hasTextual=!!(phrases.length||terms.length);

      if (!hasTextual) {
        // Person/tag/completion only — person set already applied above
        nameMatches.push(entry);
      } else if (this._matchesText(entry.nameLower,phrases,terms)) {
        nameMatches.push(entry);
      } else if (this._matchesText(combined,phrases,terms)) {
        bodyMatches.push({...entry,_bodyMatch:true});
      }

      if (nameMatches.length+bodyMatches.length>=limit) break;
    }

    // If only person filters (no text), mark results with person badge
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

// ─── Search Panel ─────────────────────────────────────────────────────────────

class SearchPanel {
  constructor(plugin,panel,index,parser) {
    this._plugin=plugin; this._panel=panel; this._index=index; this._parser=parser;
    this._nameResults=[]; this._bodyResults=[]; this._allResults=[];
    this._selectedIdx=-1; this._openedGuid=null;
    this._query=''; this._debounce=null; this._searchToken=0;
    this._expandedGuid=null; this._previewLoadToken=0;
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

    const _inject=()=>{
      el.innerHTML='';
      el.appendChild(root);
      this._renderSavedChips(); this._updateStatus(); this._renderEmptyState();
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
  }

  _buildHeader() {
    const header=document.createElement('div'); header.className='ws-header';
    header.innerHTML=`
      <span class="ws-header-icon">${wsIcon('search')}</span>
      <div class="ws-input-wrap">
        <input class="ws-input" type="text" placeholder="Search collections…" autocomplete="off" spellcheck="false">
        <button class="ws-clear-btn ws-hidden" title="Clear">${wsIcon('x')}</button>
      </div>
      <button class="ws-icon-btn ws-save-btn ws-hidden" title="Save (⌘S)">${wsIcon('bookmark')} Save</button>
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
    clearBtn.addEventListener('click',()=>{ input.value=''; clearBtn.classList.add('ws-hidden'); saveBtn.classList.add('ws-hidden'); this._search(''); input.focus(); });
    saveBtn.addEventListener('click',()=>this._openSaveForm());
    configBtn.addEventListener('click',()=>this._configMode?this._closeConfig():this._openConfig());
    return header;
  }

  _buildFooter() {
    const footer=document.createElement('div'); footer.className='ws-footer';
    footer.innerHTML=`<span class="ws-result-count"></span><span class="ws-hint">↑↓ navigate &nbsp;·&nbsp; ⏎ open &nbsp;·&nbsp; ⌘S save</span>`;
    return footer;
  }

  _handleKey(e) {
    e.stopPropagation();
    if (e.key==='ArrowDown')  { e.preventDefault(); this._moveSelection(1); }
    else if (e.key==='ArrowUp')  { e.preventDefault(); this._moveSelection(-1); }
    else if (e.key==='Enter')    { e.preventDefault(); this._openSelected(); }
    else if ((e.metaKey||e.ctrlKey)&&e.key==='s') { e.preventDefault(); if (this._query.trim()) this._openSaveForm(); }
  }

  _moveSelection(dir) {
    if (!this._allResults.length) return;
    const next=this._selectedIdx+dir;
    this._selectedIdx=((next%this._allResults.length)+this._allResults.length)%this._allResults.length;
    this._highlightSelected(); this._scrollToSelected();
  }
  _highlightSelected() { this._root?.querySelectorAll('.ws-result-wrap').forEach((wrap,i)=>wrap.classList.toggle('ws-selected',i===this._selectedIdx)); }
  _scrollToSelected() { this._root?.querySelector('.ws-result-wrap.ws-selected')?.scrollIntoView({block:'nearest'}); }
  _openSelected() { if (this._selectedIdx<0||!this._allResults[this._selectedIdx]) return; this._navigateToRecord(this._allResults[this._selectedIdx]); }

  async _navigateToRecord(entry) {
    this._openedGuid=entry.record.guid;
    this._highlightOpened();
    const myId=this._panel.getId();
    const allPanels=this._plugin.ui.getPanels()||[];
    const candidates=allPanels.filter(p=>p.getId()!==myId&&!p.isSidebar());
    const target=candidates.find(p=>p.isActive())||candidates[0]||null;

    const doNav=async(panel)=>{
      panel.navigateTo({type:'edit_panel',rootId:entry.record.guid,workspaceGuid:this._plugin.getWorkspaceGuid()});
      this._plugin.ui.setActivePanel(panel);
      const plainQuery=this._toPlainQuery(this._parser.parse(this._query)||{type:'and',terms:[],phrases:[],includeTags:[],excludeTags:[],excludeTerms:[],isCompleted:null,personRefs:[],mentionRefs:[]});
      if (!plainQuery) return;
      try {
        const lineItems=await Promise.race([entry.record.getLineItems(false),new Promise(r=>setTimeout(()=>r([]),3000))]);
        if (!lineItems.length) return;
        const allTerms=plainQuery.toLowerCase().replace(/"/g,' ').split(/\s+/).filter(Boolean);
        const nameLower=entry.record.getName().toLowerCase();
        const bodyTerms=allTerms.filter(t=>!nameLower.includes(t));
        const searchTerms=bodyTerms.length?bodyTerms:allTerms;
        const match=lineItems.find(li=>{ try { const text=(li.segments||[]).filter(s=>['text','bold','italic','code','hashtag'].includes(s.type)).map(s=>typeof s.text==='string'?s.text.toLowerCase():'').join(' '); return searchTerms.every(t=>text.includes(t)); } catch(e) { return false; } });
        if (!match) return;
        await new Promise(r=>setTimeout(r,350));
        await panel.navigateTo({itemGuid:match.guid,highlight:true});
      } catch(e) { console.warn('[WorkflowSearch] highlight failed:',e); }
    };

    if (target) { await doNav(target); }
    else { const newPanel=await this._plugin.ui.createPanel({afterPanel:this._panel}); if (newPanel) await doNav(newPanel); }
  }

  async _navigateToRecordLine(entry,itemGuid) {
    this._openedGuid=entry.record.guid; this._highlightOpened();
    const myId=this._panel.getId();
    const allPanels=this._plugin.ui.getPanels()||[];
    const candidates=allPanels.filter(p=>p.getId()!==myId&&!p.isSidebar());
    const target=candidates.find(p=>p.isActive())||candidates[0]||null;
    const doNav=async(panel)=>{ panel.navigateTo({type:'edit_panel',rootId:entry.record.guid,workspaceGuid:this._plugin.getWorkspaceGuid()}); this._plugin.ui.setActivePanel(panel); try { await new Promise(r=>setTimeout(r,350)); await panel.navigateTo({itemGuid,highlight:true}); } catch(e) {} };
    if (target) { await doNav(target); }
    else { const newPanel=await this._plugin.ui.createPanel({afterPanel:this._panel}); if (newPanel) await doNav(newPanel); }
  }

  _toggleExpand(entry) {
    this._expandedGuid=this._expandedGuid===entry.guid?null:entry.guid;
    this._renderResults();
  }

  async _loadPreviewFor(entry, previewContext, previewEl) {
    const tk=++this._previewLoadToken;
    previewEl.innerHTML=`<div class="ws-preview-loading">Loading…</div>`;
    try {
      if (previewContext.type==='task') {
        // ── Task completion preview (is:completed / -is:completed) ──
        const wantCompleted=previewContext.wantCompleted;
        const items=await entry.record.getLineItems(false);
        if (tk!==this._previewLoadToken) return;
        const filtered=await wsFilterTaskLinesForPreview(entry.record,items,wantCompleted);
        previewEl.innerHTML='';
        if (!filtered.length) { previewEl.innerHTML='<div class="ws-preview-empty">No matching tasks</div>'; return; }
        for (const {li,depth} of filtered) {
          const div=document.createElement('div'); div.className='ws-preview-line';
          div.style.paddingLeft=(10+Math.min(depth,12)*14)+'px';
          div.textContent=wsTextFromLineItem(li).slice(0,200)||'(empty task)';
          const ig=li.guid;
          div.addEventListener('click',(e)=>{ e.stopPropagation(); this._navigateToRecordLine(entry,ig); });
          previewEl.appendChild(div);
        }

      } else if (previewContext.type==='mentions') {
        // ── mentions:@name — find line items with matching ref segments, preserving depth ──
        const targetGuids=previewContext.targetGuids; // Set<personGuid>
        const items=await entry.record.getLineItems(false);
        if (tk!==this._previewLoadToken) return;
        previewEl.innerHTML='';
        let found=0;
        const people=this._plugin._index._people;

        // Walk the tree depth-first so we get correct indent levels
        const roots=wsRootLineItems(entry.record, items);
        await wsForEachLineItemDeep(roots, (li, depth) => {
          const matchedGuids=new Set();
          for (const seg of (li.segments||[])) {
            if (seg.type==='ref'&&seg.text&&typeof seg.text==='object'&&seg.text.guid&&targetGuids.has(seg.text.guid)) matchedGuids.add(seg.text.guid);
            if (seg.type==='mention'&&typeof seg.text==='string'&&targetGuids.has(seg.text)) matchedGuids.add(seg.text);
          }
          if (!matchedGuids.size) return;
          found++;
          const text=wsTextFromLineItem(li);

          // Row: indented line text + @name badge(s)
          const div=document.createElement('div'); div.className='ws-preview-line';
          div.style.cssText='display:flex;align-items:baseline;gap:6px;';
          div.style.paddingLeft=(10+Math.min(depth,12)*14)+'px';

          const textSpan=document.createElement('span');
          textSpan.style.cssText='flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
          textSpan.textContent=text.slice(0,180)||(li.type==='task'?'(task)':'(empty line)');
          div.appendChild(textSpan);

          for (const guid of matchedGuids) {
            const displayName=people.getDisplayName(guid)||guid.slice(0,8);
            const badge=document.createElement('span');
            badge.style.cssText='flex-shrink:0;font-size:9px;color:#a8d8ff;background:rgba(100,180,255,0.10);border:1px solid rgba(100,180,255,0.22);border-radius:3px;padding:0 4px;white-space:nowrap;';
            badge.textContent='@'+displayName;
            div.appendChild(badge);
          }

          const ig=li.guid;
          div.addEventListener('click',(e)=>{ e.stopPropagation(); this._navigateToRecordLine(entry,ig); });
          previewEl.appendChild(div);
        });

        if (!found) previewEl.innerHTML='<div class="ws-preview-empty">No matching mentions</div>';

      } else if (previewContext.type==='property') {
        // ── @name / fieldname:@name — show matching property rows ──
        if (tk!==this._previewLoadToken) return;
        previewEl.innerHTML='';
        let found=0;
        const props=entry.record.getAllProperties();
        for (const p of props) {
          // For 'field' mode: only show the matching field name
          if (previewContext.fieldFilter && (p.name||'').toLowerCase().trim()!==previewContext.fieldFilter) continue;
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
            // Property match — clicking opens the record (no specific line)
            div.addEventListener('click',(e)=>{ e.stopPropagation(); this._navigateToRecord(entry); });
            previewEl.appendChild(div);
          }
        }
        if (!found) previewEl.innerHTML='<div class="ws-preview-empty">No matching properties</div>';
      }
    } catch(e) {
      if (tk!==this._previewLoadToken) return;
      previewEl.innerHTML='<div class="ws-preview-empty">Could not load preview</div>';
    }
  }

  _highlightOpened() {
    this._root?.querySelectorAll('.ws-result-wrap').forEach(wrap=>{ const entry=this._allResults[parseInt(wrap.dataset.idx,10)]; wrap.classList.toggle('ws-opened',!!(entry&&entry.guid===this._openedGuid)); });
  }

  _search(query) {
    if (this._configMode) return;
    this._query=query; this._expandedGuid=null; this._previewLoadToken++;
    const token=++this._searchToken;
    const parsed=this._parser.parse(query);
    if (!parsed) {
      this._nameResults=[]; this._bodyResults=[]; this._allResults=[]; this._selectedIdx=-1;
      this._renderEmptyState(); this._updateFooter(null); return;
    }
    const {nameMatches,bodyMatches}=this._index.queryWithBody(parsed);
    this._nameResults=wsSortSearchResultsByCollectionTitle(nameMatches);
    this._bodyResults=wsSortSearchResultsByCollectionTitle(bodyMatches);
    this._allResults=[...this._nameResults,...this._bodyResults];
    this._selectedIdx=this._allResults.length>0?0:-1;
    this._renderResults(); this._updateFooter(this._allResults.length);
    const plainQuery=this._toPlainQuery(parsed);
    if (plainQuery) void this._searchBody(plainQuery,token,parsed);
  }

  _toPlainQuery(parsed) {
    const groups=parsed.type==='or'?parsed.groups:[parsed];
    const terms=[],phrases=[];
    for (const g of groups) { if (g.terms) terms.push(...g.terms); if (g.phrases) phrases.push(...g.phrases); }
    return [...phrases.map(p=>`"${p}"`), ...terms].join(' ');
  }

  async _searchBody(plainQuery,token,parsed) {
    let result;
    try { result=await this._plugin.data.searchByQuery(plainQuery,50); } catch(e) { return; }
    if (token!==this._searchToken||!this._root?.isConnected||this._configMode) return;
    if (result.error) return;
    const seen=new Set([...this._nameResults.map(e=>e.guid),...this._bodyResults.map(e=>e.guid)]);
    const bodyEntries=[];
    const processRecord=(record)=>{
      if (!record||seen.has(record.guid)) return;
      seen.add(record.guid);
      const indexed=this._index._entries.get(record.guid);
      if (indexed&&this._index.matchesParsedEntryFilters(indexed,parsed)) bodyEntries.push({...indexed,_bodyMatch:true});
    };
    for (const r of (result.records||[])) processRecord(r);
    for (const line of (result.lines||[])) { try { processRecord(line.record); } catch(e) {} }
    if (!bodyEntries.length) return;
    this._bodyResults=wsSortSearchResultsByCollectionTitle(bodyEntries);
    this._allResults=[...this._nameResults,...this._bodyResults];
    if (this._selectedIdx<0&&this._allResults.length>0) this._selectedIdx=0;
    this._renderResults(); this._updateFooter(this._allResults.length);
  }

  _renderEmptyState() {
    const body=this._root?.querySelector('.ws-body');
    if (!body||this._configMode) return;
    const count=this._index.size();
    if (count>0) {
      body.innerHTML=`<div class="ws-empty"><div class="ws-empty-icon">${wsIcon('search')}</div><div>Search ${count.toLocaleString()} records across ${this._index.collectionCount()} collection${this._index.collectionCount()!==1?'s':''}</div><div class="ws-empty-hint">#tag &nbsp; -#tag &nbsp; "phrase" &nbsp; -term &nbsp; A OR B<br>@person &nbsp; @person* &nbsp; field:@person &nbsp; mentions:@person<br>is:completed &nbsp; -is:completed</div></div>`;
    } else {
      body.innerHTML=`<div class="ws-empty"><div class="ws-empty-icon">${wsIcon('loader')}</div><div>Building index…</div></div>`;
    }
  }

  _renderResults() {
    const body=this._root?.querySelector('.ws-body');
    if (!body) return;
    if (this._allResults.length===0) { body.innerHTML=`<div class="ws-empty"><div class="ws-empty-icon">${wsIcon('search-off')}</div><div>No results</div></div>`; return; }
    const parsed=this._parser.parse(this._query);
    const wantCompletion=wsCompletionPreviewFilter(parsed);
    const personFilter=wsPersonPreviewFilter(parsed);

    // Build preview context — determines what the chevron shows
    // Priority: task completion > mentions > property backlink
    let previewContext=null;
    if (wantCompletion!==null) {
      previewContext={ type:'task', wantCompleted:wantCompletion };
    } else if (personFilter) {
      // Resolve all person GUIDs upfront for the preview
      const people=this._index._people;

      // mentions refs → targetGuids for mention scan
      const mentionGuids=new Set();
      for (const ref of personFilter.mentionRefs) {
        const guids=people.resolve(ref.wildcard?ref.token+'*':ref.token);
        for (const g of guids) mentionGuids.add(g);
      }

      // backlink/field refs → targetGuids for property scan
      const propGuids=new Set();
      let fieldFilter=null; // null = all fields, string = specific field name
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
      // fieldFilter = specific field name if ALL person refs are same-field, else null (show all)
      if (hasFieldFilter && allSameField && commonField) fieldFilter=commonField;

      if (mentionGuids.size>0 && propGuids.size===0) {
        previewContext={ type:'mentions', targetGuids:mentionGuids };
      } else if (propGuids.size>0 && mentionGuids.size===0) {
        previewContext={ type:'property', targetGuids:propGuids, fieldFilter };
      } else if (mentionGuids.size>0 && propGuids.size>0) {
        // Mixed: prefer mentions for display (line-level), show property rows for backlinks
        // Use 'mentions' context but include prop guids for completeness
        previewContext={ type:'mentions', targetGuids:new Set([...mentionGuids,...propGuids]) };
      }
    }

    const showExpand=previewContext!==null;
    const expandTitle=previewContext?.type==='task'?'Preview matching tasks':
                      previewContext?.type==='mentions'?'Preview mentions':
                      'Preview linked properties';

    const frag=document.createDocumentFragment();
    let rowIdx=0;
    const buildRow=(entry)=>{
      const idx=rowIdx++;
      const wrap=document.createElement('div');
      wrap.className='ws-result-wrap';
      if (idx===this._selectedIdx) wrap.classList.add('ws-selected');
      if (entry.guid===this._openedGuid) wrap.classList.add('ws-opened');
      wrap.dataset.idx=String(idx);

      const rowRow=document.createElement('div'); rowRow.className='ws-result-row';

      const expandBtn=document.createElement('button'); expandBtn.type='button';
      expandBtn.className='ws-result-expand'+(showExpand?'':' ws-hidden');
      expandBtn.title=expandTitle; expandBtn.innerHTML=wsIcon('chevron-right');
      if (showExpand) { expandBtn.classList.toggle('ws-expanded',this._expandedGuid===entry.guid); expandBtn.addEventListener('click',(e)=>{ e.stopPropagation(); this._toggleExpand(entry); }); }

      const row=document.createElement('div'); row.className='ws-result';
      let iconHtml;
      try { const rawIcon=entry.record.getIcon(false); iconHtml=rawIcon?`<span class="ws-result-icon">${wsIcon(rawIcon.replace('ti-',''))}</span>`:`<span class="ws-result-icon ws-result-icon-dim">${wsIcon('file-text')}</span>`; }
      catch(e) { iconHtml=`<span class="ws-result-icon ws-result-icon-dim">${wsIcon('file-text')}</span>`; }

      const tagHtml=entry.tags.length?`<div class="ws-result-tags">${entry.tags.slice(0,5).map(t=>`<span class="ws-tag">#${wsEsc(t)}</span>`).join('')}</div>`:'';
      const bodyBadge=entry._bodyMatch?`<span class="ws-body-badge">body</span>`:'';
      const personBadge=entry._personMatch?`<span class="ws-person-badge">@</span>`:'';

      row.innerHTML=`<div class="ws-result-main">${iconHtml}<span class="ws-result-name">${wsEsc(entry.displayName)}${bodyBadge}${personBadge}</span><span class="ws-result-col">${wsEsc(entry.collectionName)}</span></div>${tagHtml}`;
      row.addEventListener('click',()=>{ this._selectedIdx=idx; this._highlightSelected(); this._navigateToRecord(entry); });
      row.addEventListener('mouseenter',()=>{ this._selectedIdx=idx; this._highlightSelected(); });

      rowRow.appendChild(expandBtn); rowRow.appendChild(row);

      const preview=document.createElement('div'); preview.className='ws-preview';
      if (showExpand&&this._expandedGuid===entry.guid) { preview.style.display='block'; void this._loadPreviewFor(entry,previewContext,preview); }
      else { preview.style.display='none'; }

      wrap.appendChild(rowRow); wrap.appendChild(preview);
      return wrap;
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
    const pCount=this._index._people.size();
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
      nameEl.addEventListener('click',()=>{ const input=this._root?.querySelector('.ws-input'); if (input) { input.value=s.query; input.dispatchEvent(new Event('input')); input.focus(); } });
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
      const searches=this._getSavedSearches(); if (searches.length>=12) searches.shift();
      searches.push({id:`${Date.now().toString(36)}${Math.random().toString(36).slice(2,5)}`,name,query:this._query});
      this._persistSavedSearches(searches); this._cancelSaveForm(form); this._renderSavedChips();
      this._plugin.ui.addToaster({title:`Search saved: "${name}"`,dismissible:false,autoDestroyTime:2000});
    };
    confirmBtn.addEventListener('click',commit);
    cancelBtn.addEventListener('click',()=>this._cancelSaveForm(form));
    nameInput.addEventListener('keydown',(e)=>{ if (e.key==='Enter'){e.preventDefault();commit();} if (e.key==='Escape'){e.preventDefault();this._cancelSaveForm(form);} });
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
    body.innerHTML=`<div class="ws-empty">${wsIcon('loader')} Loading…</div>`;
    const config=this._plugin._getEffectiveConfig();
    let allCols=[]; try { allCols=await this._plugin.data.getAllCollections(); } catch(e) {}
    if (!this._configMode||!this._root?.isConnected) return;
    body.innerHTML='';

    // ── Collections ──
    const colSection=document.createElement('div'); colSection.className='ws-config-section';
    const colTitle=document.createElement('div'); colTitle.className='ws-config-title'; colTitle.textContent='Collections to search'; colSection.appendChild(colTitle);
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
    body.appendChild(Object.assign(document.createElement('div'),{className:'ws-config-divider'}));

    // ── Tag property ──
    const tagSection=document.createElement('div'); tagSection.className='ws-config-section';
    const tagTitle=document.createElement('div'); tagTitle.className='ws-config-title'; tagTitle.textContent='Hashtag property name'; tagSection.appendChild(tagTitle);
    const tagField=document.createElement('div'); tagField.className='ws-config-field';
    const tagLabel=document.createElement('span'); tagLabel.className='ws-config-field-label'; tagLabel.textContent='Property:';
    const tagInput=document.createElement('input'); tagInput.className='ws-config-input'; tagInput.value=config.tagPropName; tagInput.placeholder='Tags';
    tagField.appendChild(tagLabel); tagField.appendChild(tagInput); tagSection.appendChild(tagField); body.appendChild(tagSection);
    body.appendChild(Object.assign(document.createElement('div'),{className:'ws-config-divider'}));

    // ── People collection ──
    const peopleSection=document.createElement('div'); peopleSection.className='ws-config-section';
    const peopleTitle=document.createElement('div'); peopleTitle.className='ws-config-title'; peopleTitle.textContent='People (@-syntax)'; peopleSection.appendChild(peopleTitle);

    const peopleColField=document.createElement('div'); peopleColField.className='ws-config-field';
    const peopleColLabel=document.createElement('span'); peopleColLabel.className='ws-config-field-label'; peopleColLabel.textContent='Collection:';
    const peopleSel=document.createElement('select'); peopleSel.className='ws-config-select';
    const noneOpt=document.createElement('option'); noneOpt.value=''; noneOpt.textContent='— disabled —'; peopleSel.appendChild(noneOpt);
    for (const col of allCols) {
      const o=document.createElement('option'); o.value=col.getGuid(); o.textContent=col.getName();
      if (col.getGuid()===config.peopleCollectionGuid) o.selected=true;
      peopleSel.appendChild(o);
    }
    peopleColField.appendChild(peopleColLabel); peopleColField.appendChild(peopleSel); peopleSection.appendChild(peopleColField);

    const peopleNameField=document.createElement('div'); peopleNameField.className='ws-config-field';
    const peopleNameLabel=document.createElement('span'); peopleNameLabel.className='ws-config-field-label'; peopleNameLabel.textContent='Name property:';
    const peopleNameInput=document.createElement('input'); peopleNameInput.className='ws-config-input'; peopleNameInput.value=config.peopleNameProp||''; peopleNameInput.placeholder='(record title)';
    peopleNameField.appendChild(peopleNameLabel); peopleNameField.appendChild(peopleNameInput); peopleSection.appendChild(peopleNameField);
    body.appendChild(peopleSection);

    // ── Actions ──
    const actions=document.createElement('div'); actions.className='ws-config-actions';
    const cancelBtn=document.createElement('button'); cancelBtn.className='ws-btn ws-btn-secondary'; cancelBtn.textContent='Cancel'; cancelBtn.addEventListener('click',()=>this._closeConfig());
    const saveBtn=document.createElement('button'); saveBtn.className='ws-btn ws-btn-primary'; saveBtn.textContent='Save & Rebuild';
    saveBtn.addEventListener('click',async()=>{
      const checked=[...colList.querySelectorAll('.ws-config-cb:checked')].map(cb=>cb.dataset.guid);
      const allChecked=checked.length===allCols.length;
      this._plugin._saveConfig({
        includedCollectionIds:allChecked?[]:checked,
        tagPropName:tagInput.value.trim()||'Tags',
        peopleCollectionGuid:peopleSel.value||'',
        peopleNameProp:peopleNameInput.value.trim()||''
      });
      this._closeConfig();
      await this._plugin._buildIndex();
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

    this._cmd=this.ui.addCommandPaletteCommand({label:'WorkflowSearch: Open search panel',icon:'search',onSelected:()=>this._openPanel()});
    this._sidebarItem=this.ui.addSidebarItem({label:'Search',icon:'search',tooltip:'Search collections (⌘⇧S)',onClick:()=>this._openPanel()});

    this._keyHandler=(e)=>{ const k=(e.key||'').toLowerCase(); if ((e.metaKey||e.ctrlKey)&&e.shiftKey&&k==='s') { e.preventDefault(); this._openPanel(); } };
    document.addEventListener('keydown',this._keyHandler,true);

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
      this.events.on('panel.closed',(ev)=>{ if (ev.panel.getId()===this._searchPanelId) this._searchPanelId=null; }),
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
      if (existing) { this.ui.setActivePanel(existing); existing.getElement()?.querySelector('.ws-input')?.focus(); return; }
      this._searchPanelId=null;
    }
    const newPanel=await this.ui.createPanel();
    if (newPanel) newPanel.navigateToCustomType(WS_PANEL_TYPE);
  }

  _loadConfig() { try { return JSON.parse(localStorage.getItem('ws_search_config')||'{}'); } catch(e) { return {}; } }
  _saveConfig(config) { try { localStorage.setItem('ws_search_config',JSON.stringify(config)); } catch(e) {} }
  _getEffectiveConfig() {
    const raw=this._loadConfig();
    return {
      includedCollectionIds:Array.isArray(raw.includedCollectionIds)?raw.includedCollectionIds:[],
      tagPropName:typeof raw.tagPropName==='string'&&raw.tagPropName.trim()?raw.tagPropName.trim():'Tags',
      peopleCollectionGuid:typeof raw.peopleCollectionGuid==='string'?raw.peopleCollectionGuid:'',
      peopleNameProp:typeof raw.peopleNameProp==='string'?raw.peopleNameProp:''
    };
  }

  async _buildIndex() {
    const config=this._getEffectiveConfig();
    this._index.setTagPropName(config.tagPropName);

    let allCols; try { allCols=await this.data.getAllCollections(); } catch(e) { console.error('[WorkflowSearch] collections error:',e); return; }
    const included=config.includedCollectionIds.length?allCols.filter(c=>config.includedCollectionIds.includes(c.getGuid())):allCols;

    // Always fetch the people collection even if excluded from search results
    const needPeople=config.peopleCollectionGuid&&!included.find(c=>c.getGuid()===config.peopleCollectionGuid);
    const toFetch=needPeople?[...included,allCols.find(c=>c.getGuid()===config.peopleCollectionGuid)].filter(Boolean):included;

    let colData; try { colData=await Promise.all(toFetch.map(async(col)=>({col,records:await col.getAllRecords()}))); } catch(e) { console.error('[WorkflowSearch] records error:',e); return; }

    // Build people index
    const people=new PeopleIndex();
    people.configure(config.peopleCollectionGuid,config.peopleNameProp);
    people.build(allCols,colData);
    this._index.setPeople(people);

    // Build main index (only included collections — not the people-only extra fetch)
    this._includedGuids=new Set(included.map(c=>c.getGuid()));
    const searchColData=colData.filter(d=>this._includedGuids.has(d.col.getGuid()));
    this._index.build(searchColData);

    void this._buildBodyIndex();

    if (this._searchPanelId) {
      const panels=this.ui.getPanels()||[];
      const sp=panels.find(p=>p.getId()===this._searchPanelId);
      if (sp) this._notifyPanelRebuild(sp);
    }
    console.log(`[WorkflowSearch] v${WS_VERSION} · Index: ${this._index.size()} records, ${this._index.collectionCount()} collections · People: ${people.size()}`);
  }

  async _refreshBodyForRecord(record) {
    try {
      const items=await record.getLineItems(false);
      const text=items.map(li=>{ try { return (li.segments||[]).filter(s=>['text','bold','italic','code','hashtag'].includes(s.type)).map(s=>typeof s.text==='string'?s.text:'').join(''); } catch(e){return '';} }).join(' ').slice(0,8000);
      this._index.updateBodyText(record.guid,text);
      // Update mention index for this record
      this._index.remove(record.guid); // clears old mention entries via remove()
      // Re-upsert to restore entry
      const entry=this._index._entries.get(record.guid);
      if (!entry) return;
      this._extractMentions(record.guid,items);
      const stats=await wsComputeTaskCompletion(record,items);
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
    const entries=[...this._index._entries.values()];
    const BATCH=15, MAX_CHARS=8000;
    const extractText=(lineItems)=>lineItems
      .map(li=>{ try { return (li.segments||[]).filter(s=>['text','bold','italic','code','hashtag'].includes(s.type)).map(s=>typeof s.text==='string'?s.text:'').join(''); } catch(e){return '';} })
      .join(' ').slice(0,MAX_CHARS);

    for (let i=0;i<entries.length;i+=BATCH) {
      const batch=entries.slice(i,i+BATCH);
      await Promise.all(batch.map(async(entry)=>{
        try {
          const items=await entry.record.getLineItems(false);
          this._index.updateBodyText(entry.guid,extractText(items));
          this._extractMentions(entry.guid,items);
          const stats=await wsComputeTaskCompletion(entry.record,items);
          this._index.updateTaskCompletion(entry.guid,stats);
        } catch(e) {}
      }));
      await new Promise(r=>setTimeout(r,0));
    }

    console.log(`[WorkflowSearch] v${WS_VERSION} · Body index complete: ${entries.length} records`);
    this._refreshSearchPanel();
  }

  _refreshSearchPanel() {
    if (!this._searchPanelId) return;
    const panels=this.ui.getPanels()||[];
    const sp=panels.find(p=>p.getId()===this._searchPanelId);
    if (!sp) return;
    this._notifyPanelRebuild(sp);
    const input=sp.getElement()?.querySelector('.ws-input');
    if (input&&input.value) input.dispatchEvent(new Event('input'));
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