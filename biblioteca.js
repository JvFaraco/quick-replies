const $ = id => document.getElementById(id);
let rows = [], current = null, dirty = false, revision = null, team = null;
function status(text, error = false) { const s = $('status'); s.textContent = text; s.className = error ? 'error' : ''; void s.offsetWidth; s.classList.add('flash'); }
function enter(el) { el.classList.remove('enter'); void el.offsetWidth; el.classList.add('enter'); }
function proceed() { return !dirty || confirm('Há alterações não salvas. Deseja descartá-las?'); }
const teamOwned = shortcut => !!team?.shortcuts?.includes(shortcut);
function render() {
  $('count').textContent = rows.length;
  const categories = [...new Set(rows.map(r => r.category))].sort((a,b) => a.localeCompare(b, 'pt-BR'));
  const selected = $('category').value;
  $('category').replaceChildren(new Option('Todas as categorias', ''), ...categories.map(c => new Option(c, c)));
  $('category').value = categories.includes(selected) ? selected : '';
  $('groups').replaceChildren(...categories.map(c => new Option(c, c)));
  $('list').replaceChildren();
  for (const row of QR.search(rows, $('search').value).filter(r => !$('category').value || r.category === $('category').value)) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'card' + (row.shortcut === current ? ' selected' : '');
    const top = document.createElement('div'); top.className = 'card-top';
    const shortcut = document.createElement('code'); shortcut.textContent = '/' + row.shortcut;
    const category = document.createElement('span'); category.className = 'tag'; category.textContent = row.category; top.append(shortcut, category);
    if (teamOwned(row.shortcut)) { const t = document.createElement('span'); t.className = 'tag from-team'; t.textContent = 'equipe'; t.title = 'Vem da planilha da equipe'; top.append(t); }
    const title = document.createElement('h3'); title.textContent = row.title;
    const preview = document.createElement('p'); preview.textContent = row.body.slice(0, 100);
    button.append(top, title, preview); button.onclick = () => { if (proceed()) edit(row); }; $('list').append(button);
  }
  if (!$('list').children.length) { const p = document.createElement('p'); p.className = 'no-results'; p.textContent = 'Nenhuma resposta encontrada. Tente outro termo ou crie um atalho.'; $('list').append(p); }
  renderPacks();
}
function edit(row = null) {
  current = row?.shortcut ?? null; dirty = false;
  if ($('form').hidden || current !== $('form').dataset.shortcut) enter($('form'));
  $('form').dataset.shortcut = current ?? '';
  $('empty').hidden = true; $('form').hidden = false;
  for (const [id, key] of [['title','title'], ['shortcut','shortcut'], ['group','category'], ['body','body']]) $(id).value = row?.[key] ?? '';
  $('preview').textContent = row?.body ?? ''; $('delete').hidden = !row; $('duplicate').hidden = !row;
  render(); $('title').focus();
}
async function persist(next) {
  // Do not overwrite edits made in another library tab.
  const stored = await QR.load();
  if (JSON.stringify(stored) !== revision) throw Error('A biblioteca mudou em outra aba. Recarregue esta página antes de salvar.');
  rows = await QR.save(next); revision = JSON.stringify(rows); dirty = false;
}
async function reload() { rows = await QR.load(); revision = JSON.stringify(rows); team = await QR.loadTeam(); render(); }
function reset() { current = null; $('form').hidden = true; $('empty').hidden = false; render(); }
function download(name, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type })), link = document.createElement('a');
  link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
// Replacing or importing keeps the previous library for one-step undo.
async function replaceWithUndo(next, message) {
  const before = rows;
  await QR.saveBackup(before); await persist(next); reset();
  status(message); $('undo').hidden = false;
}
$('undo').onclick = async () => {
  try {
    const backup = await QR.loadBackup(); if (!backup) { $('undo').hidden = true; return; }
    await persist(backup.library); await QR.clearBackup(); reset(); $('undo').hidden = true;
    status(`Biblioteca anterior restaurada (${rows.length} respostas).`);
  } catch (err) { status(err.message, true); }
};

// Tabs (ARIA tab pattern: only the selected tab is in the Tab order; arrows, Home and End move between tabs) and welcome card
const tabs = [...document.querySelectorAll('.tab')], tabBar = document.querySelector('.tabs'), HINT = $('status').textContent;
function showTab(name, focus = false) {
  for (const tab of tabs) {
    const on = tab.dataset.tab === name;
    tab.setAttribute('aria-selected', String(on)); tab.tabIndex = on ? 0 : -1;
    if (on) { if (focus) tab.focus(); tab.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
  }
  document.querySelectorAll('.pane').forEach(pane => { pane.hidden = pane.id !== `tab-${name}`; });
  // The title, count, "+ Nova resposta" and the editing hint belong to the Respostas tab; the others show their own name.
  const respostas = name === 'respostas';
  $('new').hidden = !respostas; $('count').hidden = !respostas; $('count').style.display = respostas ? '' : 'none'; // .badge sets its own display, which beats [hidden]
  $('heading').textContent = respostas ? 'Respostas rápidas' : tabs.find(t => t.dataset.tab === name).textContent;
  // The idle hint talks about the Respostas tab; the others have their own intro. Feedback messages stay as they are.
  const s = $('status'); if (!s.textContent || s.textContent === HINT) s.textContent = name === 'respostas' ? HINT : '';
  if (name === 'variaveis') renderAuto();
  if (name === 'sites') renderSites();
  if (name === 'equipe') renderTeam();
}
tabs.forEach(tab => tab.addEventListener('click', () => showTab(tab.dataset.tab)));
tabBar.addEventListener('keydown', e => {
  const i = tabs.indexOf(document.activeElement), to = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 }[e.key];
  if (i < 0 || to === undefined) return;
  e.preventDefault(); showTab(tabs[(to + tabs.length) % tabs.length].dataset.tab, true);
});
// On narrow screens the tab bar scrolls sideways; data-more tells the CSS which edge hides more tabs.
function tabEdges() {
  const max = tabBar.scrollWidth - tabBar.clientWidth, x = tabBar.scrollLeft;
  tabBar.dataset.more = max <= 1 ? '' : [x > 1 && 'start', x < max - 1 && 'end'].filter(Boolean).join(' ');
}
tabBar.addEventListener('scroll', tabEdges, { passive: true }); addEventListener('resize', tabEdges); tabEdges(); document.fonts?.ready.then(tabEdges);
if (new URLSearchParams(location.search).has('bemvindo')) $('welcome').hidden = false;
$('welcome-close').onclick = () => { $('welcome').hidden = true; history.replaceState(null, '', location.pathname); };
document.querySelectorAll('[data-go]').forEach(b => b.addEventListener('click', () => showTab(b.dataset.go)));

// Starter packs
function renderPacks() {
  const have = new Set(rows.map(r => r.shortcut));
  $('packs').replaceChildren(...Object.entries(QR_PACOTES).map(([id, pack]) => {
    const card = document.createElement('article'); card.className = 'pack'; card.dataset.pack = id;
    const h3 = document.createElement('h3'); h3.textContent = pack.title;
    const p = document.createElement('p'); p.textContent = pack.description;
    const fresh = pack.library.filter(r => !have.has(r.shortcut)).length;
    const meta = document.createElement('small'); meta.textContent = `${pack.library.length} respostas · ${fresh ? `${fresh} novas para você` : 'todas já no seu acervo'}`;
    const list = document.createElement('div'); list.className = 'pack-list';
    pack.library.forEach(r => { const code = document.createElement('code'); code.textContent = '/' + r.shortcut; code.title = r.title; list.append(code); });
    const actions = document.createElement('div'); actions.className = 'form-actions';
    const add = document.createElement('button'); add.type = 'button'; add.className = 'primary'; add.textContent = 'Adicionar'; add.disabled = !fresh;
    add.onclick = async () => {
      try {
        const merged = QR.merge(rows, pack.library);
        await replaceWithUndo(merged.rows, `${pack.title}: ${fresh} respostas adicionadas${merged.skipped.length ? `, ${merged.skipped.length} já existiam (${merged.skipped.map(s => '/' + s).join(', ')})` : ''}.`);
      } catch (err) { status(err.message, true); }
    };
    const replace = document.createElement('button'); replace.type = 'button'; replace.className = 'secondary'; replace.textContent = 'Substituir tudo';
    replace.onclick = async () => {
      if (!confirm(`Substituir suas ${rows.length} respostas pelo pacote "${pack.title}" (${pack.library.length})? Dá para desfazer logo em seguida.`)) return;
      try { await replaceWithUndo(pack.library, `Biblioteca substituída pelo pacote ${pack.title}.`); } catch (err) { status(err.message, true); }
    };
    actions.append(add, replace); card.append(h3, p, meta, list, actions);
    return card;
  }));
}

// Variables
function varRow(name = '', value = '') {
  const row = document.createElement('div'); row.className = 'var-row';
  const prefix = document.createElement('div'); prefix.className = 'prefix';
  const open = document.createElement('span'); open.textContent = '{{';
  const key = document.createElement('input'); key.className = 'var-name'; key.maxLength = 40; key.placeholder = 'empresa'; key.value = name; key.setAttribute('aria-label', 'Nome da variável');
  const close = document.createElement('span'); close.textContent = '}}';
  prefix.append(open, key, close);
  const val = document.createElement('input'); val.className = 'var-value'; val.maxLength = 500; val.placeholder = 'Valor'; val.value = value; val.setAttribute('aria-label', 'Valor da variável');
  const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'danger'; remove.textContent = 'Remover'; remove.onclick = () => row.remove();
  row.append(prefix, val, remove);
  return row;
}
function renderAuto() {
  const auto = QR.automatic();
  $('autovars').replaceChildren(...Object.entries(auto).map(([name, value]) => { const chip = document.createElement('span'); chip.className = 'chip'; const code = document.createElement('code'); code.textContent = `{{${name}}}`; chip.append(code, ` ${value}`); return chip; }));
}
async function renderVars() {
  const fixed = await QR.loadVariables();
  const entries = Object.entries(fixed);
  if (!entries.length) entries.push(['empresa', ''], ['atendente', '']);
  $('varrows').replaceChildren(...entries.map(([k, v]) => varRow(k, v)));
}
$('addvar').onclick = () => { const row = varRow(); $('varrows').append(row); row.querySelector('.var-name').focus(); };
$('vars').onsubmit = async e => {
  e.preventDefault();
  try {
    const obj = {};
    for (const row of $('varrows').querySelectorAll('.var-row')) {
      const name = row.querySelector('.var-name').value.trim(), value = row.querySelector('.var-value').value;
      if (!name && !value.trim()) continue;
      if (name in obj) throw Error(`Variável repetida: {{${name}}}.`);
      obj[name] = value;
    }
    await QR.saveVariables(obj); await renderVars();
    status(`${Object.keys(obj).length} variáveis fixas salvas. Já valem nas abas abertas.`);
  } catch (err) { status(err.message, true); }
};

// Team sheet
const when = ts => new Date(ts).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
async function renderTeam() {
  team = await QR.loadTeam();
  $('team-setup').hidden = !!team; $('team').hidden = $('team-info').hidden = !team;
  if (!team) return;
  $('team-url-view').textContent = team.url;
  $('team-open').href = team.url.replace(/\/export\?format=csv.*$/, '/edit');
  const last = team.syncedAt ? when(team.syncedAt) : 'nenhuma';
  $('team-meta').textContent = team.error
    ? `Erro${team.errorAt ? ` em ${when(team.errorAt)}` : ''}: ${team.error} Última sincronização com sucesso: ${last}. Nova tentativa automática em até 10 minutos.`
    : `${team.count} respostas da equipe · atualizada em ${last} · próxima atualização em até 10 minutos.`;
  $('team-meta').className = team.error ? 'error' : '';
  const skipped = team.skipped || [], more = Math.max(0, skipped.length - 5) + (team.skippedMore || 0);
  $('team-skipped').hidden = !skipped.length;
  $('team-skipped').textContent = skipped.length ? `${skipped.length + (team.skippedMore || 0)} linhas da planilha foram ignoradas: ${skipped.slice(0, 5).map(s => `linha ${s.linha} (${s.motivo})`).join('; ')}${more ? ` e mais ${more}` : ''}.` : '';
}
const slashList = shortcuts => shortcuts.map(s => '/' + s).join(', ');
function syncNote(result) {
  const n = (result.skipped?.length || 0) + (result.skippedMore || 0);
  return n ? ` ${n} linhas da planilha foram ignoradas (veja na aba Equipe).` : '';
}
async function connect(url) {
  const before = rows, origin = `${new URL(url).origin}/*`;
  let granted = true;
  try { granted = await chrome.permissions.request({ origins: [origin] }); } catch {}
  if (granted === false) throw Error('Sem a permissão de acesso à planilha não dá para conectar. Tente de novo e permita o acesso quando o Chrome perguntar.');
  const result = await QR.syncTeam(url);
  await QR.saveBackup(before); await reload(); reset(); await renderTeam();
  const swapped = result.replaced.length;
  status(`Planilha conectada: ${result.count} respostas da equipe. ${swapped ? `${swapped} ${swapped > 1 ? 'respostas suas com o mesmo atalho foram trocadas' : 'resposta sua com o mesmo atalho foi trocada'} pela versão da planilha: ${slashList(result.replaced)}. Dá para desfazer.` : 'Suas respostas próprias foram mantidas.'}${syncNote(result)}`); $('undo').hidden = false;
}
// A site the user enabled keeps its permission even when the sheet lives on the same origin.
const coversOrigin = (site, origin) => { const o = new URL(origin), s = new URL(site.replace('*.', '')); return site === `${o.origin}/*` || (site.startsWith(`${o.protocol}//*.`) && (o.hostname === s.hostname || o.hostname.endsWith('.' + s.hostname))); };
$('team-form').onsubmit = async e => {
  e.preventDefault();
  const url = QR.teamUrl($('team-url').value);
  if (!url) { status('Cole o link da planilha do Google (https) ou um link direto para CSV.', true); return; }
  $('team-connect').disabled = true;
  try { await connect(url); } catch (err) { status(err.message, true); await renderTeam(); }
  finally { $('team-connect').disabled = false; }
};
$('team-sync').onclick = async () => {
  $('team-sync').disabled = true;
  try { const result = await QR.syncTeam(); await reload(); reset(); await renderTeam(); const swapped = result.replaced.length; status(`Planilha sincronizada: ${result.count} respostas da equipe.${swapped ? ` ${swapped} suas com o mesmo atalho foram trocadas pela versão da planilha: ${slashList(result.replaced)}.` : ''}${syncNote(result)}`); }
  catch (err) { status(err.message, true); await renderTeam(); }
  finally { $('team-sync').disabled = false; }
};
$('team-disconnect').onclick = async () => {
  if (!confirm('Desconectar a planilha? As respostas atuais continuam na sua biblioteca, mas param de atualizar.')) return;
  const current = await QR.loadTeam();
  await QR.saveTeam(null);
  // Give the sheet's origin permission back, unless the same origin is a site the user enabled.
  if (current) {
    try {
      const origin = `${new URL(current.url).origin}/*`;
      if (!(await QR.loadSites()).some(site => coversOrigin(site, origin))) await chrome.permissions.remove({ origins: [origin] });
    } catch {}
  }
  await reload(); await renderTeam(); status('Planilha desconectada.');
};
// Copies the library as a table (pastes into the four columns) and opens a blank Google Sheet. Without clipboard, falls back to the CSV file.
$('team-sheet').onclick = async () => {
  const list = rows.length ? rows : QR_DEFAULTS, { html, text } = QR.toSheet(list);
  try {
    try { await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([text], { type: 'text/plain' }) })]); }
    catch { await navigator.clipboard.writeText(text); }
  } catch {
    download('modelo-equipe.csv', '﻿' + QR.toCSV(list), 'text/csv;charset=utf-8');
    status('Não deu para copiar, então baixei o modelo. Na planilha nova: Arquivo → Importar → Fazer upload.');
    window.open('https://sheets.new', '_blank', 'noopener'); return;
  }
  window.open('https://sheets.new', '_blank', 'noopener');
  status(`Planilha nova aberta em outra aba, com ${list.length} respostas copiadas. Clique na célula A1 e cole (Ctrl+V).`);
};

// Sites
async function renderSites() {
  const sites = await QR.loadSites();
  const items = await Promise.all(sites.map(async site => {
    let allowed = null;
    try { allowed = await chrome.permissions.contains({ origins: [site] }); } catch {}
    const li = document.createElement('li');
    const host = document.createElement('strong'); host.textContent = site.replace(/^https?:\/\//, '').replace(/\/\*$/, '').replace(/^\*\./, '');
    const meta = document.createElement('small'); meta.textContent = [site.startsWith('https://*.') ? 'com subdomínios' : site.startsWith('http:') ? 'sem https' : '', allowed === false ? 'sem permissão: ative de novo na aba' : ''].filter(Boolean).join(' · ');
    const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'danger'; remove.textContent = 'Remover';
    remove.onclick = async () => {
      try {
        await QR.saveSites(sites.filter(s => s !== site));
        try { await chrome.permissions.remove({ origins: [site] }); } catch {}
        await renderSites(); status(`${host.textContent} removido. Recarregue as abas desse site.`);
      } catch (err) { status(err.message, true); }
    };
    const info = document.createElement('div'); info.append(host, meta); li.append(info, remove);
    return li;
  }));
  if (!items.length) { const li = document.createElement('li'); li.className = 'no-results'; li.textContent = 'Nenhum site salvo. Ative a extensão em uma aba para começar.'; items.push(li); }
  $('sites').replaceChildren(...items);
}

$('search').oninput = render; $('category').onchange = render;
$('new').onclick = () => { if (proceed()) edit(); };
$('form').oninput = () => { dirty = true; $('preview').textContent = $('body').value; };
$('form').onsubmit = async e => {
  e.preventDefault();
  try {
    const row = { shortcut: $('shortcut').value, title: $('title').value, category: $('group').value, body: $('body').value };
    const next = rows.filter(r => r.shortcut !== current); next.push(row);
    const clean = QR.validate(next);
    await persist(clean); edit(rows.find(r => r.shortcut === row.shortcut));
    status(teamOwned(row.shortcut) ? 'Resposta salva. Como ela vem da planilha da equipe, a próxima sincronização vai trazer a versão da planilha de volta.' : 'Resposta salva. O atalho já está disponível nas abas ativas.');
  } catch (err) { status(err.message, true); }
};
$('duplicate').onclick = () => {
  if (!proceed()) return;
  const row = rows.find(r => r.shortcut === current);
  let suffix = 2; while (rows.some(r => r.shortcut === `${row.shortcut.slice(0,35)}_${suffix}`)) suffix++;
  edit({ ...row, shortcut: `${row.shortcut.slice(0,35)}_${suffix}`, title: row.title.slice(0,110) + ' (cópia)' });
  current = null; dirty = true; $('delete').hidden = true; $('duplicate').hidden = true;
};
$('delete').onclick = async () => {
  if (!confirm(`Excluir /${current}?`)) return;
  try { await persist(rows.filter(r => r.shortcut !== current)); reset(); status('Resposta excluída.'); }
  catch (err) { status(err.message, true); }
};
$('export').onclick = () => {
  download('quick-replies.json', JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), library: rows }, null, 2), 'application/json');
  status('Biblioteca exportada. Envie o JSON para a equipe importar no Chrome.');
};
$('export-csv').onclick = () => {
  download('quick-replies.csv', '﻿' + QR.toCSV(rows), 'text/csv;charset=utf-8');
  status('CSV exportado. Abra no Excel ou no Google Planilhas, edite e importe de volta.');
};
$('import').onclick = () => { if (proceed()) $('file').click(); };
$('file').onchange = async () => {
  try {
    const file = $('file').files[0]; if (!file) return;
    if (file.size > 3000000) throw Error('O arquivo excede o limite de 3 MB.');
    const next = QR.parseLibraryText(await file.text());
    const merge = rows.length && confirm(`Importar ${next.length} respostas.\n\nOK: juntar às suas ${rows.length} respostas atuais (atalhos repetidos são ignorados).\nCancelar: substituir tudo pelo arquivo.`);
    if (!merge && rows.length && !confirm(`Substituir a biblioteca atual de ${rows.length} respostas pelas ${next.length} do arquivo? Dá para desfazer logo em seguida.`)) return;
    const result = merge ? QR.merge(rows, next) : { rows: next, skipped: [] };
    await replaceWithUndo(result.rows, merge ? `${next.length - result.skipped.length} respostas adicionadas${result.skipped.length ? `, ${result.skipped.length} já existiam` : ''}.` : 'Biblioteca importada com sucesso.');
  } catch (err) { status('Não foi possível importar: ' + err.message, true); }
  finally { $('file').value = ''; }
};
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { if (!$('form').hidden) { e.preventDefault(); $('form').requestSubmit(); } }
  else if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.target.closest('input, textarea, select, [contenteditable]')) { e.preventDefault(); showTab('respostas'); $('search').focus(); $('search').select(); }
});
window.addEventListener('beforeunload', e => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });
// A sync from the service worker while this page is open shows up without reloading, unless there are unsaved edits.
chrome.storage.onChanged.addListener((changes, area) => { if (area === 'local' && (changes.library || changes.team) && !dirty) reload().catch(() => {}); });
reload().then(renderVars).catch(err => status(err.message, true));
