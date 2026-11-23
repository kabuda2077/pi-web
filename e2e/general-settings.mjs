// Run against the isolated-task-home preview; no production API routes.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const origin = 'http://127.0.0.1:30245';
assert.equal((await (await fetch(`${origin}/api/fixture-id`, { redirect:'error' })).json()).fixture, 'isolated-task-home-v1');
const out = fileURLToPath(new URL('../test-results/general-settings/', import.meta.url));
await mkdir(out, {recursive:true});
const browser = await chromium.launch({ channel:existsSync(chromium.executablePath())?'chromium':'chrome' });
try {
  const page = await browser.newPage({viewport:{width:1440,height:960},locale:'zh-CN',serviceWorkers:'block',reducedMotion:'reduce',colorScheme:'light'});
  await page.route('**/*', r => new URL(r.request().url()).origin === origin ? r.continue() : r.abort());
  const errors=[]; page.on('pageerror', e=>errors.push(e.message));
  page.on('response', r=>{ if(r.url().includes('/api/')&&r.status()>=400) errors.push(`${r.status()} ${r.url()}`); });
  const settingsButton = page.getByRole('button',{name:'设置',exact:true});
  let releaseTools;
  const gate = new Promise(resolve => {releaseTools = resolve;});
  let failRead = false;
  const methods = [];
  await page.route(`${origin}/api/tools/settings`, async route => {
    methods.push(route.request().method());
    await gate;
    if (failRead) return route.fulfill({json:{error:'Fixture tool settings unavailable'},status:503});
    return route.continue();
  });
  await page.goto(origin); await settingsButton.click();
  const general = page.locator('.settings-general');
  const theme = id => general.locator(`input[name="theme"][value="${id}"]`);
  const send = general.locator('input[name="enter-send-mode"][value="ctrlEnter"]');
  await theme('mist').locator('..').click(); await send.locator('..').click();
  await general.getByRole('heading',{name:'工具与通知'}).waitFor();
  const tools = general.locator('.settings-builtin-tools');
  const shell = general.getByRole('switch',{name:'使用 PowerShell 替代 Bash'});
  const push = general.getByRole('heading',{name:'后台推送'});
  const pushOffset = () => push.evaluate(el => el.getBoundingClientRect().top - el.closest('.settings-general-column').getBoundingClientRect().top);
  const widths = [1440,940,860,375,320];
  const before = new Map();
  await tools.getByText('加载中...').waitFor();
  assert.equal(await tools.getByRole('checkbox').count(),0);
  assert.equal(await shell.count(),0);
  await general.getByRole('heading',{name:'Shell 工具'}).waitFor();
  for (const width of widths) {
    await page.setViewportSize({width,height:960});
    before.set(width,await pushOffset());
  }
  releaseTools();
  await shell.waitFor();
  assert.ok(await shell.isEnabled() && await shell.isChecked());
  assert.ok(await tools.getByRole('checkbox',{name:'powershell',exact:true}).isChecked());
  assert.equal(await tools.getByRole('checkbox',{name:'grep',exact:true}).isChecked(),false);
  for(const width of [1440,940,860,375,320,1440]) {
    await page.setViewportSize({width,height:960});
    assert.equal(await pushOffset(),before.get(width),`Push moved at ${width}px`);
    const dims = await general.evaluate(n=>{
      const [a,b]=Array.from(n.querySelectorAll('.settings-general-column'),el=>el.getBoundingClientRect());
      const radios=Array.from(n.querySelectorAll('.settings-theme-option'),el=>el.offsetTop);
      return {width:n.clientWidth,cols:a.y===b.y?2:1,gap:b.left-a.right,overflow:n.scrollWidth-n.clientWidth,rows:new Set(radios).size};
    });
    assert.equal(dims.cols,dims.width>=900?2:1,JSON.stringify(dims));
    if(dims.cols===2) assert.equal(dims.gap,32);
    assert.equal(dims.overflow,0); assert.equal(dims.rows,3);
    assert.ok(await send.isChecked());assert.ok(await theme('mist').isChecked());
    console.log(`${width}px viewport: ${dims.cols} column(s), no overflow`);
  }
  await theme('auto').locator('..').click(); await general.evaluate(n=>n.scrollTo(0,0));
  await page.waitForFunction(()=>document.documentElement.dataset.theme==='light');
  await page.locator('.settings-dialog-surface').screenshot({path:`${out}desktop.png`});
  assert.deepEqual(errors,[]);
  await page.keyboard.press('Escape');
  await page.setViewportSize({width:1440,height:960});
  failRead=true;
  await settingsButton.click();
  await general.getByRole('alert').filter({hasText:'Fixture tool settings unavailable'}).waitFor();
  assert.equal(await tools.getByRole('checkbox').count(),0);
  assert.equal(await shell.count(),0);
  assert.deepEqual([...new Set(methods)],['GET']);
  assert.deepEqual([...new Set(errors)],[`503 ${origin}/api/tools/settings`]);
  console.log('Push offset unchanged at all five widths; read failure visible, no tool writes.');
} finally {await browser.close();}
