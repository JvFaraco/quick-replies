(() => {
  const VAR = /\{\{\s*([^{}\n]+?)\s*\}\}/g;
  const normalize = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  function validate(rows) {
    if (!Array.isArray(rows) || rows.length > 500) throw Error('A biblioteca deve conter uma lista de até 500 respostas.');
    const seen = new Set();
    return rows.map(row => {
      if (!row || typeof row !== 'object') throw Error('Resposta inválida.');
      const clean = {};
      for (const key of ['shortcut', 'title', 'category', 'body']) {
        if (typeof row[key] !== 'string') throw Error(`Campo inválido: ${key}.`);
        clean[key] = row[key].trim();
      }
      clean.shortcut = clean.shortcut.replace(/^\//, '').toLowerCase();
      if (!/^[a-z0-9_-]{1,40}$/.test(clean.shortcut)) throw Error('Use de 1 a 40 letras sem acento, números, _ ou - no atalho.');
      if (seen.has(clean.shortcut)) throw Error(`Atalho duplicado: /${clean.shortcut}.`);
      seen.add(clean.shortcut);
      if (!clean.title || clean.title.length > 120 || !clean.category || clean.category.length > 80 || !clean.body || clean.body.length > 20000) throw Error('Preencha título (até 120 caracteres), categoria (até 80) e mensagem (até 20 mil).');
      return clean;
    });
  }
  function search(rows, query) {
    const q = normalize(query.replace(/^\//, '').trim());
    return rows.filter(r => normalize(`${r.shortcut} ${r.title} ${r.category} ${r.body}`).includes(q))
      .sort((a,b) => Number(b.shortcut === q) - Number(a.shortcut === q) || Number(b.shortcut.startsWith(q)) - Number(a.shortcut.startsWith(q)) || a.title.localeCompare(b.title, 'pt-BR'));
  }
  function token(text, caret) {
    const before = text.slice(0, caret);
    const m = before.match(/(?:^|\s)(\/([a-zA-Z0-9_-]{0,40}))$/);
    return m ? { start: caret - m[1].length, end: caret, query: m[2] } : null;
  }
  const variables = body => [...new Set([...body.matchAll(VAR)].map(m => m[1]))];
  const fill = (body, values) => body.replace(VAR, (all, name) => values[name] ?? all);
  // Merge keeps the user's own replies and only adds shortcuts that do not exist yet.
  function merge(current, incoming) {
    const have = new Set(current.map(r => r.shortcut)), skipped = [];
    const rows = [...current];
    for (const row of validate(incoming)) { if (have.has(row.shortcut)) skipped.push(row.shortcut); else { rows.push(row); have.add(row.shortcut); } }
    return { rows: validate(rows), skipped };
  }

  // Automatic values: greeting by local hour, date and time. Fixed variables saved by the user win over them.
  const pad = n => String(n).padStart(2, '0');
  function automatic(now = new Date()) {
    const h = now.getHours();
    return { saudacao: h >= 5 && h < 12 ? 'Bom dia' : h >= 12 && h < 18 ? 'Boa tarde' : 'Boa noite', data: `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()}`, hora: `${pad(h)}:${pad(now.getMinutes())}` };
  }
  function validateVariables(obj) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw Error('Variáveis inválidas.');
    const entries = Object.entries(obj);
    if (entries.length > 50) throw Error('Use no máximo 50 variáveis fixas.');
    const clean = {};
    for (const [rawName, rawValue] of entries) {
      const name = String(rawName).trim();
      if (!name || name.length > 40 || /[{}\n]/.test(name)) throw Error('O nome da variável deve ter até 40 caracteres, sem chaves.');
      if (typeof rawValue !== 'string' || rawValue.trim().length > 500) throw Error(`O valor de {{${name}}} deve ter até 500 caracteres.`);
      clean[name] = rawValue.trim();
    }
    return clean;
  }
  const known = (fixed = {}, now) => { const values = { ...automatic(now) }; for (const [k, v] of Object.entries(fixed)) if (v) values[k] = v; return values; };
  const missing = (body, values) => variables(body).filter(name => !values[name]);

  // Sites where the menu is injected automatically. Remembered when the user activates the extension in a tab.
  function sitePattern(url) {
    try {
      const u = new URL(url);
      if (!['http:', 'https:'].includes(u.protocol) || !u.hostname) return null;
      return `${u.protocol}//${u.host}/*`;
    } catch { return null; }
  }
  const validateSites = list => [...new Set((Array.isArray(list) ? list : []).filter(s => typeof s === 'string' && /^https?:\/\/[^/]+\/\*$/.test(s)))].slice(0, 100);

  // CSV: ; or , as separator, quoted fields with embedded quotes and line breaks, headers in Portuguese or English.
  const HEADERS = { shortcut: ['atalho', 'shortcut', 'comando'], title: ['titulo', 'title', 'nome'], category: ['categoria', 'category', 'grupo', 'assunto'], body: ['mensagem', 'body', 'texto', 'resposta', 'conteudo'] };
  // Raw records with the sheet row number (header = row 1, blank rows counted), not yet validated.
  function csvRecords(text) {
    let src = text.replace(/^﻿/, '');
    const pinned = src.match(/^sep=(.)\r?\n/i);
    if (pinned) src = src.slice(pinned[0].length);
    const firstLine = src.split(/\r?\n/, 1)[0];
    const sep = pinned ? pinned[1] : (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ';' : ',';
    const rows = [[]]; let field = '', quoted = false;
    for (let i = 0; i < src.length; i++) {
      const c = src[i];
      if (quoted) {
        if (c === '"') { if (src[i + 1] === '"') { field += '"'; i++; } else quoted = false; }
        else field += c;
      } else if (c === '"') quoted = true;
      else if (c === sep) { rows.at(-1).push(field); field = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && src[i + 1] === '\n') i++; rows.at(-1).push(field); field = ''; rows.push([]); }
      else field += c;
    }
    rows.at(-1).push(field);
    const table = rows.map((r, i) => ({ r, linha: i + 1 })).filter(x => x.r.some(v => v.trim()));
    if (table.length < 2) throw Error('O CSV precisa de um cabeçalho e ao menos uma linha.');
    const header = table[0].r.map(h => normalize(h.trim()));
    const at = {};
    for (const [key, names] of Object.entries(HEADERS)) {
      at[key] = header.findIndex(h => names.includes(h));
      if (at[key] < 0) throw Error(`Falta a coluna "${names[0]}" no cabeçalho do CSV.`);
    }
    return table.slice(1).map(({ r, linha }) => ({ linha, row: { shortcut: r[at.shortcut] ?? '', title: unquote(r[at.title] ?? ''), category: unquote(r[at.category] ?? ''), body: unquote(r[at.body] ?? '') } }));
  }
  const parseCSV = text => validate(csvRecords(text).map(x => x.row));
  // Lenient reading for the team sheet: invalid rows are skipped and reported with their sheet row number; a first row wins on a repeated shortcut.
  const MAX_SKIPPED = 100;
  function lenient(records) {
    const rows = [], skipped = [], seen = new Set();
    let ignored = 0;
    for (const { linha, row } of records) {
      try {
        if (rows.length >= 500) throw Error('Passou do limite de 500 respostas.');
        const [clean] = validate([row]);
        if (seen.has(clean.shortcut)) throw Error(`Atalho duplicado: /${clean.shortcut}.`);
        seen.add(clean.shortcut); rows.push(clean);
      } catch (err) { if (skipped.length < MAX_SKIPPED) skipped.push({ linha, motivo: err.message }); else ignored++; }
    }
    if (!rows.length) throw Error(skipped.length ? `Nenhuma linha da planilha é válida. Linha ${skipped[0].linha}: ${skipped[0].motivo}` : 'A planilha não tem nenhuma resposta.');
    return { rows, skipped, ignored };
  }
  function parseTeamText(text) {
    const src = text.replace(/^﻿/, '').trim();
    if (src.startsWith('{')) {
      const data = JSON.parse(src);
      if (data.version !== 1) throw Error('Versão de biblioteca não reconhecida.');
      if (!Array.isArray(data.library)) throw Error('O JSON não traz a lista "library".');
      return lenient(data.library.map((row, i) => ({ linha: i + 1, row })));
    }
    if (src.startsWith('<')) throw Error(HTML_ERROR);
    return lenient(csvRecords(src));
  }
  // A value starting with = + - @ would run as a formula when the CSV is opened in a spreadsheet. The quote prefix neutralizes it
  // and parseCSV removes it again. A spreadsheet reading with the wrong separator can also start a cell after any , ; tab or line
  // break inside a value, so triggers in those positions get the same treatment (the sep= line alone is not enough: Excel ignores it after a BOM).
  // Lookahead, so consecutive delimiters are each checked; whitespace here excludes tab and line breaks because those are delimiters themselves.
  // Quotes of both kinds count as prefix too: a misparsed cell can begin at a doubled quote inside the value.
  const TRIGGER = "(?=(?:['\"]|[^\\S\\t\\r\\n])*[=+\\-@\\t\\r])";
  const AT_CELL = new RegExp(`(^|[,;\\t\\r\\n])${TRIGGER}`, 'g'), AT_CELL_QUOTED = new RegExp(`(^|[,;\\t\\r\\n])'${TRIGGER}`, 'g');
  const neutralize = v => v.replace(AT_CELL, "$1'");
  const unquote = v => v.replace(AT_CELL_QUOTED, '$1');
  const cell = raw => { const v = neutralize(raw); return /[",;\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; };
  const toCSV = rows => ['sep=;', 'atalho;titulo;categoria;mensagem', ...rows.map(r => [r.shortcut, r.title, r.category, r.body].map(cell).join(';'))].join('\n') + '\n';
  // Clipboard model for a new Google Sheet: an HTML table pastes straight into the four columns, line breaks kept inside the cell.
  // Same formula guard as the CSV; the sheet's own CSV export brings the ' back and parseCSV removes it.
  const html = v => v.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  function toSheet(rows) {
    const head = ['atalho', 'titulo', 'categoria', 'mensagem'], data = rows.map(r => [r.shortcut, r.title, r.category, r.body].map(v => neutralize(String(v ?? ''))));
    return {
      html: `<table><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr>${data.map(r => `<tr>${r.map(v => `<td>${html(v).replace(/\r?\n/g, '<br>')}</td>`).join('')}</tr>`).join('')}</table>`,
      text: [head, ...data.map(r => r.map(v => v.replace(/[\t\r\n]+/g, ' ')))].map(r => r.join('\t')).join('\n') + '\n'
    };
  }

  // Team library: a Google Sheets link (shared "anyone with the link") or any https URL serving CSV or the exported JSON.
  function teamUrl(input) {
    let u; try { u = new URL(String(input).trim()); } catch { return null; }
    if (u.protocol !== 'https:') return null;
    const sheet = u.hostname === 'docs.google.com' && u.pathname.match(/^\/spreadsheets\/d\/([\w-]+)\//);
    if (sheet && !u.pathname.includes('/d/e/')) {
      const gid = u.hash.match(/gid=(\d+)/)?.[1] || u.searchParams.get('gid');
      return `https://docs.google.com/spreadsheets/d/${sheet[1]}/export?format=csv${gid ? `&gid=${gid}` : ''}`;
    }
    return u.href;
  }
  const HTML_ERROR = 'A planilha não está pública: o link devolveu uma página de login, não os dados. Na planilha, use Compartilhar → Acesso geral → "Qualquer pessoa com o link" como Leitor.';
  function parseLibraryText(text) {
    const src = text.replace(/^﻿/, '').trim();
    if (src.startsWith('{')) { const data = JSON.parse(src); if (data.version !== 1) throw Error('Versão de biblioteca não reconhecida.'); return validate(data.library); }
    if (src.startsWith('<')) throw Error(HTML_ERROR);
    return parseCSV(src);
  }
  // Team rows win; local rows survive unless they came from the team before and were removed from the sheet.
  function applyTeam(current, team, previous = []) {
    const teamRows = validate(team), owned = new Set([...previous, ...teamRows.map(r => r.shortcut)]);
    return validate([...teamRows, ...current.filter(r => !owned.has(r.shortcut))]);
  }
  // Shortcuts of the user's own replies (not from the sheet before) that the sheet version overwrote with different content.
  function replacedByTeam(current, team, previous = []) {
    const before = new Set(previous), mine = new Map(current.map(r => [r.shortcut, r]));
    return validate(team).filter(t => { const m = mine.get(t.shortcut); return m && !before.has(t.shortcut) && (m.title !== t.title || m.category !== t.category || m.body !== t.body); }).map(t => t.shortcut);
  }
  // Simple queue: library writes (save, sync) run one at a time so a sync cannot overwrite an edit and vice versa.
  let queue = Promise.resolve();
  const serial = fn => { const run = queue.then(fn); queue = run.catch(() => {}); return run; };

  const store = typeof chrome !== 'undefined' && chrome.storage ? chrome.storage.local : null;
  globalThis.QR = { normalize, validate, search, token, variables, fill, merge, automatic, validateVariables, known, missing, sitePattern, validateSites, parseCSV, toCSV, toSheet, teamUrl, parseLibraryText, parseTeamText, applyTeam, replacedByTeam,
    // One-step undo for replacing or importing: the previous library is kept until the next replacement.
    async saveBackup(rows) { await store.set({ backup: { library: validate(rows), at: Date.now() } }); },
    async loadBackup() { const { backup } = await store.get('backup'); return backup ? { library: validate(backup.library), at: backup.at } : null; },
    async clearBackup() { await store.remove('backup'); },
    async loadTeam() { const { team } = await store.get('team'); return team && typeof team.url === 'string' ? team : null; },
    saveTeam(team) { return serial(() => team ? store.set({ team }) : store.remove('team')); },
    // Downloads the team sheet and applies it. Called from the options page (connect, sync now) and from the service worker (alarm, startup).
    // Every failure (download, reading, validation, saving) is recorded in team.error/errorAt when the sheet is the connected one.
    // Invalid rows do not stop the sync: they are skipped and listed in team.skipped ({ linha, motivo }, linha = sheet row, header = 1).
    async syncTeam(url) {
      const first = (await QR.loadTeam()) || {}, target = url || first.url;
      if (!target) return null;
      const mark = async message => { const t = await QR.loadTeam(); if (t && t.url === target) await store.set({ team: { ...t, error: message, errorAt: Date.now() } }); };
      const fail = async message => { try { await serial(() => mark(message)); } catch {} throw Error(message); };
      let text, problem;
      try {
        const res = await fetch(target, { cache: 'no-store', credentials: 'omit' });
        if (!res.ok) throw Error(res.status === 401 || res.status === 403 || res.status === 404 ? `HTTP ${res.status}: a planilha não está pública ou o link mudou` : `HTTP ${res.status}`);
        text = await res.text();
      } catch (err) { problem = `Não consegui baixar a planilha (${err.message}).`; }
      if (problem) return fail(problem);
      let parsed;
      try { parsed = parseTeamText(text); }
      catch (err) { return fail(err.message === HTML_ERROR ? HTML_ERROR : `Não consegui ler a planilha: ${err.message}`); }
      return serial(async () => {
        try {
          // Read inside the queue: an edit saved while the download ran must not be lost.
          const team = (await QR.loadTeam()) || {}, current = await QR.load(), previous = team.shortcuts || [];
          // A background sync (no url given) that finishes after "Desconectar" or a switch to another sheet must not bring the old one back.
          if (!url && team.url !== target) return null;
          const library = applyTeam(current, parsed.rows, previous), replaced = replacedByTeam(current, parsed.rows, previous);
          const next = { url: target, shortcuts: parsed.rows.map(r => r.shortcut), count: parsed.rows.length, syncedAt: Date.now(), skipped: parsed.skipped, skippedMore: parsed.ignored, replaced };
          await store.set({ library, team: next });
          return next;
        } catch (err) {
          const message = `Não consegui salvar as respostas da planilha: ${err.message}`;
          try { await mark(message); } catch {}
          throw Error(message);
        }
      });
    },
    async load() { const { library } = await store.get('library'); return library === undefined ? structuredClone(QR_DEFAULTS) : validate(library); },
    async save(rows) { const library = validate(rows); return serial(async () => { await store.set({ library }); return library; }); },
    async loadVariables() { const { variables } = await store.get('variables'); return variables ? validateVariables(variables) : {}; },
    async saveVariables(obj) { const variables = validateVariables(obj); await store.set({ variables }); return variables; },
    // No site comes enabled out of the box: the user enables each chat with "Ativar nesta aba".
    async loadSites() { const { sites } = await store.get('sites'); return validateSites(sites); },
    async saveSites(list) { const sites = validateSites(list); await store.set({ sites }); return sites; },
    // Registers the content script on every remembered site the extension has permission for (extension pages and the service worker only).
    async syncSites() {
      const sites = await QR.loadSites(), matches = [];
      for (const site of sites) { try { if (await chrome.permissions.contains({ origins: [site] })) matches.push(site); } catch {} }
      await chrome.scripting.unregisterContentScripts({ ids: ['quick-replies'] }).catch(() => {});
      if (matches.length) await chrome.scripting.registerContentScripts([{ id: 'quick-replies', matches, js: ['catalogo.js', 'core.js', 'content.js'], allFrames: true, runAt: 'document_idle', persistAcrossSessions: true }]);
      return matches;
    }
  };
})();
