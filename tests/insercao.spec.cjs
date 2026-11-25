const { test, expect } = require('@playwright/test');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const page_ = pathToFileURL(path.resolve(__dirname, '..', 'teste.html')).href;
const REPLY = 'Posso ajudar em algo mais? 🙂';
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    // Same chrome.* stand-in as browser.spec.cjs: storage over localStorage, permissions always granted.
    const listeners = [], read = () => JSON.parse(localStorage.getItem('test-store') || '{}');
    globalThis.chrome = {
      storage: { local: {
        async get(key) { const all = read(); return key in all ? { [key]: all[key] } : {}; },
        async set(data) { const all = { ...read(), ...data }; localStorage.setItem('test-store', JSON.stringify(all)); const changes = Object.fromEntries(Object.keys(data).map(k => [k, { newValue: data[k] }])); listeners.forEach(fn => fn(changes, 'local')); },
        async remove(key) { const all = read(); delete all[key]; localStorage.setItem('test-store', JSON.stringify(all)); listeners.forEach(fn => fn({ [key]: {} }, 'local')); }
      }, onChanged: { addListener(fn) { listeners.push(fn); } } },
      permissions: { async contains() { return true; }, async request() { return true; }, async remove() { return true; } },
      tabs: { async query() { return [{ id: 1, url: 'https://app.exemplo.com/atendimento/42' }]; } },
      scripting: { async executeScript() {} },
      runtime: { openOptionsPage() {} }
    };
  });
});
test('textarea: atalho na 2ª linha abre o menu e preserva a 1ª linha', async ({ page }) => {
  await page.goto(page_); const field = page.locator('#plain');
  await field.click(); await page.keyboard.type('Olá'); await page.keyboard.press('Enter'); await page.keyboard.type('/finaliz');
  await page.waitForTimeout(150); await page.keyboard.press('Enter');
  await expect(field).toHaveValue(`Olá\n${REPLY}`);
});
test('editor rico: atalho na 2ª linha abre o menu e preserva a 1ª linha', async ({ page }) => {
  await page.goto(page_); const rich = page.locator('#rich');
  for (const nl of ['Enter', 'Shift+Enter']) {
    await rich.click(); await page.keyboard.press('Control+A'); await page.keyboard.press('Backspace');
    await page.keyboard.type('Olá'); await page.keyboard.press(nl); await page.keyboard.type('/finaliz');
    await page.waitForTimeout(150); await page.keyboard.press('Enter'); await page.waitForTimeout(200);
    const text = await rich.innerText();
    expect(text.replace(/\n+/g, '\n').trim(), nl).toBe(`Olá\n${REPLY}`);
  }
});
test('Enter com menu aberto não chega aos listeners de captura do site', async ({ page }) => {
  await page.goto(page_);
  // Site listeners are usually registered after the extension (document_start); window capture is the earliest a site can use then.
  await page.evaluate(() => {
    globalThis.siteEnters = 0;
    const count = e => { if (e.key === 'Enter') globalThis.siteEnters++; };
    window.addEventListener('keydown', count, true); document.addEventListener('keydown', count, true);
  });
  for (const id of ['#plain', '#rich']) {
    const el = page.locator(id); await el.click(); await page.keyboard.type('/finaliz'); await page.waitForTimeout(150);
    await page.keyboard.press('Enter'); await page.waitForTimeout(200);
  }
  await expect(page.locator('#plain')).toHaveValue(REPLY);
  await expect(page.locator('#rich')).toContainText(REPLY);
  expect(await page.evaluate(() => globalThis.siteEnters)).toBe(0);
});
test('mesma resposta inserida duas vezes resulta em duas ocorrências', async ({ page }) => {
  await page.goto(page_);
  const times = s => s.split(REPLY).length - 1;
  const field = page.locator('#plain'); await field.click();
  await page.keyboard.type('/finaliz'); await page.waitForTimeout(150); await page.keyboard.press('Enter');
  await page.keyboard.type(' /finaliz'); await page.waitForTimeout(150); await page.keyboard.press('Enter');
  expect(times(await field.inputValue())).toBe(2);
  const rich = page.locator('#rich'); await rich.click();
  await page.keyboard.type('/finaliz'); await page.waitForTimeout(150); await page.keyboard.press('Enter'); await page.waitForTimeout(200);
  await page.keyboard.type(' /finaliz'); await page.waitForTimeout(150); await page.keyboard.press('Enter'); await page.waitForTimeout(200);
  expect(times(await rich.innerText())).toBe(2);
  expect(await rich.innerText()).not.toContain('/finaliz');
});
