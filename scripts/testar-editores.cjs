// Runs the extension's menu and insertion against the rich text editors chat apps are built on (Lexical on WhatsApp Web,
// ProseMirror/TipTap, Quill), plus a textarea and a plain contenteditable. Each editor reports its own model text, so a
// reply that only shows up in the DOM (and that the editor would drop) counts as a failure.
// Needs internet: editors load from esm.sh. Usage: npm run test:editores   (PW_CHANNEL=chromium on machines without Chrome)
const { chromium } = require('@playwright/test');
const fs = require('node:fs'); const path = require('node:path');
// QR_DIR points at another copy of the extension files (e.g. an older version) to compare against.
const ROOT = path.resolve(process.env.QR_DIR || path.join(__dirname, '..'));
const channel = process.env.PW_CHANNEL || 'chrome';
const box = 'style="border:1px solid #888;min-height:80px;padding:8px;margin-top:320px;white-space:pre-wrap"';

const lexical = (ver, rich) => `<div id=ed contenteditable=true ${box}></div><script type=module>
import { createEditor, $getRoot } from 'https://esm.sh/lexical@${ver}';
import { ${rich ? 'registerRichText' : 'registerPlainText'} as reg } from 'https://esm.sh/@lexical/${rich ? 'rich-text' : 'plain-text'}@${ver}?deps=lexical@${ver}';
const editor = createEditor({ namespace: 't', onError: e => { throw e; } });
editor.setRootElement(document.getElementById('ed')); reg(editor);
window.model = () => editor.getEditorState().read(() => $getRoot().getTextContent()); window.ready = true;</script>`;
const prosemirror = `<div id=host ${box}></div><script type=module>
import { EditorState } from 'https://esm.sh/prosemirror-state@1.4.3';
import { EditorView } from 'https://esm.sh/prosemirror-view@1.38.1?deps=prosemirror-state@1.4.3';
import { schema } from 'https://esm.sh/prosemirror-schema-basic@1.2.4';
import { keymap } from 'https://esm.sh/prosemirror-keymap@1.2.2?deps=prosemirror-state@1.4.3';
import { baseKeymap, chainCommands, exitCode } from 'https://esm.sh/prosemirror-commands@1.7.0?deps=prosemirror-state@1.4.3';
const br = (state, dispatch) => { dispatch && dispatch(state.tr.replaceSelectionWith(schema.nodes.hard_break.create()).scrollIntoView()); return true; };
const view = new EditorView(document.getElementById('host'), { state: EditorState.create({ schema, plugins: [keymap({ 'Shift-Enter': br }), keymap(baseKeymap)] }) });
window.model = () => view.state.doc.textBetween(0, view.state.doc.content.size, '\\n', '\\n'); window.ready = true;</script>`;
const quill = `<link rel=stylesheet href="https://cdn.jsdelivr.net/npm/quill@2.0.3/dist/quill.core.css"><div id=host ${box}></div>
<script src="https://cdn.jsdelivr.net/npm/quill@2.0.3/dist/quill.core.js"></script><script>
const q = new Quill('#host'); window.model = () => q.getText().replace(/\\n$/, ''); window.ready = true;</script>`;
const textarea = `<textarea id=ed rows=5 style="width:600px;margin-top:320px"></textarea><script>window.model = () => document.getElementById('ed').value; window.ready = true;</script>`;
const plain = `<div id=ed contenteditable=true ${box}></div><script>window.model = () => document.getElementById('ed').innerText.replace(/\\n$/, ''); window.ready = true;</script>`;

const EDITORS = [
  ['Campo de texto (textarea)', textarea, '#ed'],
  ['Editor simples (contenteditable)', plain, '#ed'],
  ['Lexical 0.21 texto (WhatsApp Web)', lexical('0.21.0', false), '#ed'],
  ['Lexical 0.35 formatado (WhatsApp Web)', lexical('0.35.0', true), '#ed'],
  ['ProseMirror / TipTap', prosemirror, '.ProseMirror'],
  ['Quill 2', quill, '.ql-editor'],
];
const FINAL = 'Posso ajudar em algo mais? 🙂';
const flat = s => s.replace(/ /g, ' ').replace(/\n+/g, '\n').trim();
const CASES = [
  ['/finalizar + Enter', async (k) => { await k.type('/finalizar'); await k.pick('Enter'); }, m => flat(m) === FINAL],
  ['texto antes + Tab, várias linhas', async (k) => { await k.type('Oi /emat'); await k.pick('Tab'); }, m => flat(m).startsWith('Oi Olá! Estou em outro atendimento') && !m.includes('/emat') && /Agradeço/.test(m)],
  ['campo na hora (/protocolo)', async (k) => { await k.type('/protoc'); await k.pick('Enter'); await k.page.keyboard.type('2026-1'); await k.pick('Enter'); }, m => flat(m).startsWith('Seu protocolo de atendimento é 2026-1.') && !m.includes('/protoc')],
  ['atalho na 2ª linha', async (k) => { await k.type('Olá'); await k.page.keyboard.press('Shift+Enter'); await k.type('/finalizar'); await k.pick('Enter'); }, m => flat(m) === 'Olá\n' + FINAL],
  // The menu lives in a closed shadow root inside <quick-replies>; the host only takes up space while the panel is shown.
  ['/ sozinho abre o menu', async (k) => { await k.type('/'); await k.page.waitForTimeout(400); k.menuOpen = await k.page.evaluate(() => (document.querySelector('quick-replies')?.getBoundingClientRect().height || 0) > 40); await k.page.keyboard.press('Escape'); }, (m, k) => k.menuOpen],
];

(async () => {
  const browser = await chromium.launch({ ...(channel === 'chromium' ? {} : { channel }), headless: true });
  const rows = []; let failed = 0;
  for (const [name, html, selector] of EDITORS) {
    const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
    await page.addInitScript(() => { globalThis.chrome = { storage: { local: { async get(k) { return k === 'variables' ? { variables: { empresa: 'Loja Exemplo', atendente: 'Ana' } } : {}; }, async set() {} }, onChanged: { addListener() {} } } }; });
    await page.route('http://editores.test/**', r => r.fulfill({ contentType: 'text/html', body: '<!doctype html><meta charset=utf-8>' + html }));
    const result = { name, cases: [] };
    try {
      await page.goto('http://editores.test/'); await page.waitForFunction(() => window.ready, null, { timeout: 30000 });
      for (const f of ['catalogo.js', 'core.js', 'content.js']) await page.addScriptTag({ content: fs.readFileSync(path.join(ROOT, f), 'utf8') });
      for (const [label, run, ok] of CASES) {
        const el = page.locator(selector).first();
        await el.click(); await page.keyboard.press('Control+A'); await page.keyboard.press('Backspace'); await page.waitForTimeout(150);
        const k = { page, type: t => page.keyboard.type(t, { delay: 40 }), pick: async key => { await page.waitForTimeout(250); await page.keyboard.press(key); await page.waitForTimeout(600); } };
        let pass = false, model = '';
        try {
          await run(k);
          model = await page.evaluate(() => window.model());
          pass = !!ok(model, k);
        } catch (err) { model = 'erro: ' + err.message.split('\n')[0]; }
        if (!pass) failed++;
        result.cases.push({ label, pass, model });
      }
    } catch (err) { failed += CASES.length; result.cases = CASES.map(([label]) => ({ label, pass: false, model: 'editor não carregou: ' + err.message.split('\n')[0] })); }
    rows.push(result); await page.close();
  }
  await browser.close();
  const lines = ['# Teste da extensão nos editores de chat', '', `Gerado em ${new Date().toLocaleString('pt-BR')} · versão ${JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8')).version}`, '', '| Editor | ' + CASES.map(c => c[0]).join(' | ') + ' |', '|---|' + CASES.map(() => ':-:').join('|') + '|'];
  for (const r of rows) lines.push(`| ${r.name} | ` + r.cases.map(c => (c.pass ? '✅' : '❌')).join(' | ') + ' |');
  const fails = rows.flatMap(r => r.cases.filter(c => !c.pass).map(c => `- **${r.name}**, ${c.label}: campo ficou \`${JSON.stringify(c.model).slice(1, 120)}\``));
  if (fails.length) lines.push('', '## Falhas', '', ...fails);
  const out = path.join(ROOT, 'test-results', 'editores.md'); fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, lines.join('\n') + '\n');
  console.log(lines.join('\n')); console.log(`\nRelatório: ${out}`);
  process.exit(failed ? 1 : 0);
})().catch(err => { console.error(err); process.exit(1); });
