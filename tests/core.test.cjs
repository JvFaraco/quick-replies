const { test } = require('node:test');
const assert = require('node:assert/strict');
// In-memory chrome.storage.local so syncTeam can run in Node.
const data = {};
globalThis.chrome = { storage: { local: {
  async get(key) { return key in data ? { [key]: structuredClone(data[key]) } : {}; },
  async set(obj) { Object.assign(data, structuredClone(obj)); },
  async remove(key) { delete data[key]; }
} } };
require('../catalogo.js'); require('../core.js');
test('atalho exige limite de palavra e respeita posição do cursor', () => {
  assert.equal(QR.token('https://site.com/semvoz', 23), null);
  assert.equal(QR.token('texto/semvoz', 12), null);
  assert.deepEqual(QR.token('Olá /os resto', 7), { start: 4, end: 7, query: 'os' });
  assert.deepEqual(QR.token('/', 1), { start: 0, end: 1, query: '' });
});
test('busca por assunto sem acento e prioridade do atalho', () => {
  assert.ok(QR.search(QR_DEFAULTS, 'atendimento').length >= 2);
  assert.equal(QR.search(QR_DEFAULTS, '/finalizar')[0].shortcut, 'finalizar');
});
test('biblioteca padrão é o pacote geral, com saudação automática e sem asteriscos', () => {
  assert.deepEqual(QR_DEFAULTS, QR_PACOTES.geral.library);
  assert.equal(QR.validate(QR_DEFAULTS).length, QR_DEFAULTS.length);
  assert.equal(QR_DEFAULTS.find(r => r.shortcut === 'finalizar').body, 'Posso ajudar em algo mais? 🙂');
  assert.ok(QR_DEFAULTS.find(r => r.shortcut === 'saudacao').body.includes('{{saudacao}}'));
  assert.ok(!QR_DEFAULTS.some(row => row.body.includes('*')));
  for (const [id, pack] of Object.entries(QR_PACOTES)) {
    assert.ok(pack.title && pack.description, `pacote ${id} sem título ou descrição`);
    assert.ok(QR.validate(pack.library).length >= 6, `pacote ${id} tem poucas respostas`);
    assert.ok(!pack.library.some(row => row.body.includes('*')), `pacote ${id} usa asteriscos`);
  }
});
test('importação rejeita atalhos duplicados e estrutura inválida', () => {
  assert.throws(() => QR.validate([QR_DEFAULTS[0], QR_DEFAULTS[0]]), /duplicado/);
  assert.throws(() => QR.validate([{ ...QR_DEFAULTS[0], body: 45 }]), /inválido/);
  assert.throws(() => QR.validate([{ ...QR_DEFAULTS[0], shortcut: '../os' }]), /atalho/);
  assert.deepEqual(QR.validate([]), []);
});
test('campos repetidos pedem um único valor, sem interpretar conteúdo', () => {
  assert.deepEqual(QR.variables('Olá {{nome}}, OS {{ OS }}: {{nome}}'), ['nome','OS']);
  assert.equal(QR.fill('Olá {{nome}} / {{nome}}', { nome: '$& <b>Ana</b>' }), 'Olá $& <b>Ana</b> / $& <b>Ana</b>');
});
test('variáveis automáticas seguem o relógio', () => {
  assert.equal(QR.automatic(new Date(2026, 10, 3, 8, 5)).saudacao, 'Bom dia');
  assert.equal(QR.automatic(new Date(2026, 10, 3, 12, 0)).saudacao, 'Boa tarde');
  assert.equal(QR.automatic(new Date(2026, 10, 3, 18, 0)).saudacao, 'Boa noite');
  assert.equal(QR.automatic(new Date(2026, 10, 3, 2, 0)).saudacao, 'Boa noite');
  assert.equal(QR.automatic(new Date(2026, 10, 3, 9, 7)).data, '03/11/2026');
  assert.equal(QR.automatic(new Date(2026, 10, 3, 9, 7)).hora, '09:07');
});
test('variáveis fixas são validadas e o preenchimento deixa só o que falta', () => {
  assert.deepEqual(QR.validateVariables({ ' empresa ': ' Loja X ', atendente: 'Ana' }), { empresa: 'Loja X', atendente: 'Ana' });
  assert.throws(() => QR.validateVariables({ '': 'x' }), /nome/);
  assert.throws(() => QR.validateVariables({ 'a{b': 'x' }), /nome/);
  assert.throws(() => QR.validateVariables({ a: 'x'.repeat(501) }), /500/);
  assert.throws(() => QR.validateVariables([1]), /inválid/);
  const values = QR.known({ empresa: 'Loja X' }, new Date(2026, 10, 3, 15, 0));
  assert.equal(values.empresa, 'Loja X'); assert.equal(values.saudacao, 'Boa tarde');
  assert.deepEqual(QR.missing('{{saudacao}}! {{empresa}} aqui, {{nome}}?', values), ['nome']);
  assert.equal(QR.known({ saudacao: 'Oi' }).saudacao, 'Oi');
});
test('padrão de site vem da URL da aba', () => {
  assert.equal(QR.sitePattern('https://chat.exemplo.com/conversas/123?x=1'), 'https://chat.exemplo.com/*');
  assert.equal(QR.sitePattern('http://localhost:3000/chat'), 'http://localhost:3000/*');
  assert.equal(QR.sitePattern('chrome://extensions'), null);
  assert.equal(QR.sitePattern('file:///C:/teste.html'), null);
  assert.equal(QR.sitePattern('lixo'), null);
  assert.deepEqual(QR.validateSites(['https://a.com/*', 'https://a.com/*', 'x']), ['https://a.com/*']);
});
test('CSV aceita ; ou , e cabeçalhos em português, e exporta de volta', () => {
  const csv = 'Atalho;Título;Categoria;Mensagem\nola;"Saudação";Atendimento;"Olá, {{nome}}!\nTudo bem?"\n"/tchau";Despedida;Atendimento;Até logo\n';
  const rows = QR.parseCSV(csv);
  assert.deepEqual(rows, [
    { shortcut: 'ola', title: 'Saudação', category: 'Atendimento', body: 'Olá, {{nome}}!\nTudo bem?' },
    { shortcut: 'tchau', title: 'Despedida', category: 'Atendimento', body: 'Até logo' },
  ]);
  assert.deepEqual(QR.parseCSV('shortcut,title,category,body\r\na,"b ""c""",d,e\r\n'), [{ shortcut: 'a', title: 'b "c"', category: 'd', body: 'e' }]);
  assert.throws(() => QR.parseCSV('nome,texto\nx,y'), /coluna/);
  assert.deepEqual(QR.parseCSV(QR.toCSV(rows)), rows);
});
test('CSV exportado não vira fórmula na planilha e volta igual na importação', () => {
  const rows = [
    { shortcut: 'soma', title: '=SUM(A1)', category: '-Cobrança', body: '+55 48 99999-0000\n@todos' },
    { shortcut: 'lista', title: 'Lista', category: 'Geral', body: "'=já tinha aspa" },
  ];
  const csv = QR.toCSV(rows);
  assert.ok(!/;"?[=+\-@]/.test(csv), 'célula começa com gatilho de fórmula');
  assert.ok(csv.includes("'=SUM(A1)") && csv.includes("'-Cobrança") && csv.includes("'+55"));
  assert.deepEqual(QR.parseCSV(csv), rows);
  // Excel in a locale that splits on ',' must not see a trigger after a comma: the separator is pinned and commas are quoted.
  const comma = [{ shortcut: 'x', title: 'a,=1+1,b', category: 'Geral', body: 'ok' }];
  const out = QR.toCSV(comma);
  assert.ok(out.startsWith('sep=;\n'));
  assert.ok(out.includes(`"a,'=1+1,b"`));
  assert.deepEqual(QR.parseCSV(out), comma);
  assert.deepEqual(QR.parseCSV('sep=,\natalho,titulo,categoria,mensagem\ny,"t;1",c,m\n'), [{ shortcut: 'y', title: 't;1', category: 'c', body: 'm' }]);
  // Whatever separator a spreadsheet picks, no cell may start with a trigger: triggers after , ; tab or line break inside a value are neutralized too.
  const nasty = [
    { shortcut: 'n1', title: 'a,=1+1,b', category: 'x; -y', body: 'linha\n=HYPERLINK("http://x")\n\t@z\r\n+w' },
    { shortcut: 'n2', title: "já,'=com aspa", category: ",''=duas", body: "normal, 'texto com aspa' e -traço no meio" },
    { shortcut: 'n3', title: 'a,"=1+1', category: '" =x', body: 'linha\n"=1+1\n," \'@y' },
  ];
  const text = QR.toCSV(nasty);
  // A piece is safe only if the text marker ' comes before any quote, space or trigger.
  for (const piece of text.split(/[,;\t\r\n]/)) assert.ok(!/^["\s]*[=+\-@]/.test(piece), `célula perigosa: ${JSON.stringify(piece)}`);
  assert.deepEqual(QR.parseCSV(text), nasty);
});
test('link da planilha da equipe é normalizado para CSV', () => {
  assert.equal(QR.teamUrl('https://docs.google.com/spreadsheets/d/1AbC-xyz_9/edit?usp=sharing#gid=123'), 'https://docs.google.com/spreadsheets/d/1AbC-xyz_9/export?format=csv&gid=123');
  assert.equal(QR.teamUrl('https://docs.google.com/spreadsheets/d/1AbC/edit'), 'https://docs.google.com/spreadsheets/d/1AbC/export?format=csv');
  assert.equal(QR.teamUrl('https://docs.google.com/spreadsheets/d/e/2PACX-abc/pub?gid=0&single=true&output=csv'), 'https://docs.google.com/spreadsheets/d/e/2PACX-abc/pub?gid=0&single=true&output=csv');
  assert.equal(QR.teamUrl(' https://exemplo.com/respostas.csv '), 'https://exemplo.com/respostas.csv');
  assert.equal(QR.teamUrl('http://exemplo.com/x.csv'), null);
  assert.equal(QR.teamUrl('planilha'), null);
});
test('conteúdo da equipe pode ser CSV ou o JSON exportado', () => {
  const csv = 'atalho;titulo;categoria;mensagem\nola;Oi;A;Olá!\n';
  assert.equal(QR.parseLibraryText(csv)[0].shortcut, 'ola');
  assert.equal(QR.parseLibraryText('﻿' + JSON.stringify({ version: 1, library: [{ shortcut: 'x', title: 'X', category: 'A', body: 'b' }] }))[0].shortcut, 'x');
  assert.throws(() => QR.parseLibraryText('<html>login</html>'), /planilha|coluna/i);
});
test('aplicar equipe substitui as respostas da equipe e preserva as locais', () => {
  const local = [{ shortcut: 'minha', title: 'Minha', category: 'A', body: 'x' }, { shortcut: 'velha', title: 'Da equipe antes', category: 'A', body: 'y' }, { shortcut: 'ola', title: 'Editada local', category: 'A', body: 'z' }];
  const team = [{ shortcut: 'ola', title: 'Da planilha', category: 'A', body: 'w' }, { shortcut: 'nova', title: 'Nova', category: 'A', body: 'v' }];
  const rows = QR.applyTeam(local, team, ['ola', 'velha']);
  assert.deepEqual(rows.map(r => r.shortcut), ['ola', 'nova', 'minha']);
  assert.equal(rows[0].title, 'Da planilha');
  assert.deepEqual(QR.applyTeam([], team, []).map(r => r.shortcut), ['ola', 'nova']);
});
test('mesclar pacotes mantém as respostas atuais e pula atalhos repetidos', () => {
  const mine = [{ shortcut: 'ola', title: 'Minha', category: 'A', body: 'x' }];
  const merged = QR.merge(mine, [{ shortcut: 'ola', title: 'Pacote', category: 'A', body: 'y' }, { shortcut: 'novo', title: 'Novo', category: 'A', body: 'z' }]);
  assert.deepEqual(merged.rows.map(r => r.shortcut), ['ola', 'novo']);
  assert.equal(merged.rows[0].title, 'Minha'); assert.deepEqual(merged.skipped, ['ola']);
});
test('modelo da planilha copia tabela com 4 colunas, quebra de linha na célula e fórmula neutralizada', () => {
  const { html, text } = QR.toSheet([{ shortcut: 'ola', title: 'Oi <b>', category: 'Geral', body: 'Linha 1\nLinha 2' }, { shortcut: 'x', title: '=1+1', category: '', body: 'ok' }]);
  assert.match(html, /^<table><tr><th>atalho<\/th><th>titulo<\/th><th>categoria<\/th><th>mensagem<\/th><\/tr>/);
  assert.match(html, /<td>Oi &lt;b&gt;<\/td>/); assert.match(html, /<td>Linha 1<br>Linha 2<\/td>/); assert.match(html, /<td>'=1\+1<\/td>/);
  assert.equal(text.split('\n')[1], 'ola\tOi <b>\tGeral\tLinha 1 Linha 2');
});

test('planilha: linhas inválidas são puladas com o número da linha e as boas entram', () => {
  const csv = 'atalho;titulo;categoria;mensagem\nola;Oi;A;Olá\n;Sem atalho;A;x\nola;Repetida;A;y\nbom;Sem mensagem;A;\n\nok;Ok;A;Tudo certo\n';
  const { rows, skipped } = QR.parseTeamText(csv);
  assert.deepEqual(rows.map(r => r.shortcut), ['ola', 'ok']);
  assert.deepEqual(skipped.map(s => s.linha), [3, 4, 5]);
  assert.match(skipped[1].motivo, /duplicado/); assert.match(skipped[2].motivo, /Preencha/);
  assert.throws(() => QR.parseCSV(csv), /atalho/i);
  assert.throws(() => QR.parseTeamText('atalho;titulo;categoria;mensagem\n;a;b;c\n'), /Nenhuma linha .* válida.*Linha 2/);
  assert.throws(() => QR.parseTeamText('<html>login</html>'), /não está pública/);
});
test('substituídas: só atalhos próprios do usuário com conteúdo diferente', () => {
  const local = [{ shortcut: 'a', title: 'Minha', category: 'A', body: 'x' }, { shortcut: 'b', title: 'Igual', category: 'A', body: 'y' }, { shortcut: 'c', title: 'Da equipe antes', category: 'A', body: 'z' }];
  const team = [{ shortcut: 'a', title: 'Planilha', category: 'A', body: 'w' }, { shortcut: 'b', title: 'Igual', category: 'A', body: 'y' }, { shortcut: 'c', title: 'Nova versão', category: 'A', body: 'z2' }];
  assert.deepEqual(QR.replacedByTeam(local, team, ['c']), ['a']);
});
test('syncTeam grava erro de download, leitura e conteúdo; sucesso limpa o erro e registra linhas e substituídas', async () => {
  const url = 'https://exemplo.com/equipe.csv', mine = [{ shortcut: 'a', title: 'Minha', category: 'A', body: 'x' }, { shortcut: 'b', title: 'Outra', category: 'A', body: 'y' }];
  await QR.save(mine);
  const serve = (body, status = 200) => { globalThis.fetch = async () => ({ ok: status < 400, status, text: async () => body }); };
  const head = 'atalho;titulo;categoria;mensagem\n';
  // A first connection that fails does not leave a half-connected team.
  serve('<html>login</html>');
  await assert.rejects(() => QR.syncTeam(url), /não está pública/);
  assert.equal(await QR.loadTeam(), null);
  serve(head + 'a;Da planilha;A;w\n;vazio;A;x\nb;Outra;A;y\n');
  const ok = await QR.syncTeam(url);
  assert.deepEqual(ok.replaced, ['a']); assert.deepEqual(ok.skipped.map(s => s.linha), [3]); assert.equal(ok.count, 2);
  assert.equal((await QR.loadTeam()).error, undefined);
  // Connected sheet: each kind of failure is recorded with errorAt.
  serve('', 403);
  await assert.rejects(() => QR.syncTeam(), /não está pública/);
  let t = await QR.loadTeam(); assert.match(t.error, /baixar.*403/); assert.ok(t.errorAt); assert.equal(t.count, 2);
  serve('<html>login</html>');
  await assert.rejects(() => QR.syncTeam(), /não está pública/); assert.match((await QR.loadTeam()).error, /não está pública/);
  serve(head + ';x;A;y\n');
  await assert.rejects(() => QR.syncTeam(), /Não consegui ler a planilha/); assert.match((await QR.loadTeam()).error, /Nenhuma linha/);
  serve('{"version":2}');
  await assert.rejects(() => QR.syncTeam(), /Não consegui ler/);
  serve(head + 'a;Da planilha;A;w\n');
  t = await QR.syncTeam(); assert.equal(t.error, undefined); assert.equal((await QR.loadTeam()).error, undefined);
  // Library writes are serialized: a save racing a sync is not lost.
  serve(head + 'novo;Novo;A;n\n');
  const racing = QR.syncTeam();
  await QR.save([...(await QR.load()), { shortcut: 'meu', title: 'Meu', category: 'A', body: 'm' }]);
  await racing;
  assert.deepEqual((await QR.load()).map(r => r.shortcut).sort(), ['meu', 'novo']);
});
test('sincronização em segundo plano que termina depois de Desconectar não reconecta a planilha', async () => {
  await QR.saveTeam({ url: 'https://exemplo.com/eq.csv', shortcuts: [] });
  // The user disconnects while the download is still running.
  globalThis.fetch = async () => { await QR.saveTeam(null); return { ok: true, status: 200, text: async () => 'atalho;titulo;categoria;mensagem\nx;X;Geral;Olá\n' }; };
  assert.equal(await QR.syncTeam(), null);
  assert.equal(await QR.loadTeam(), null);
});
