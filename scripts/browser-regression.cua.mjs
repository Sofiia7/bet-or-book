// Run in the Codex CUA runtime, with an existing browser and temporary tab.
// No browser connection, storage mutation or paid request outside the UI.
// Usage: await runBrowserRegression(browser, tab, 'http://localhost:8788')
export async function runBrowserRegression(browser, tab, baseURL) {
  const checks = [];
  const assert = (condition, message) => {
    if (!condition) throw new Error(message);
    checks.push(message);
  };
  const viewport = await browser.capabilities.get('viewport');
  const fits = async (name, expectedWidth) => {
    const size = await tab.playwright.evaluate(() => ({
      viewport: window.innerWidth, width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth,
    }));
    assert(size.width === size.scroll, name + ': no horizontal overflow');
    assert(size.viewport === expectedWidth, name + ': viewport applied');
  };
  await viewport.set({ width: 390, height: 844 });
  await tab.goto(baseURL + '/');
  await tab.playwright.getByRole('heading', { name: "Don't Get Rekt Copytrading.", exact: true }).waitFor({ state: 'visible' });
  const initial = await tab.playwright.domSnapshot();
  assert(initial.includes('Do a funder’s holdings cover') && initial.includes('More evidence cases'), 'Three contrasting examples and additional case');
  await fits('390 px home', 390);
  await tab.playwright.getByLabel('Check a Hyperliquid wallet', { exact: true }).fill('0x' + 'a'.repeat(64));
  await tab.playwright.getByRole('button', { name: 'Check position', exact: true }).click();
  assert((await tab.playwright.locator('#status').innerText()).includes('transaction hash'), 'Transaction hash is rejected');
  assert(await tab.playwright.locator('#address').getAttribute('aria-invalid') === 'true', 'Invalid input is announced');
  await tab.playwright.getByLabel('Check a Hyperliquid wallet', { exact: true }).fill('0x' + '1'.repeat(40) + ' 0x' + '2'.repeat(40));
  await tab.playwright.getByRole('button', { name: 'Check position', exact: true }).click();
  assert(await tab.playwright.locator('#address-choice-buttons button').count() === 2, 'Multiple addresses require a choice');
  assert(!await tab.playwright.locator('#check-progress').isVisible(), 'Address choice does not start a paid check');
  await tab.playwright.getByRole('link', { name: 'Explore', exact: true }).click();
  await tab.playwright.getByRole('button', { name: '$212.1M ETH short · Open saved reading', exact: true }).waitFor({ state: 'visible' });
  assert(await tab.playwright.locator('#case-studies').isVisible(), 'Explore starts with case studies');
  await tab.playwright.getByRole('button', { name: 'Archive', exact: true }).click();
  await tab.playwright.locator('#archive-list li').first().waitFor({ state: 'visible' });
  assert(await tab.playwright.locator('#archive-list li').count() > 0, 'Archive opens separately');
  await tab.playwright.getByRole('button', { name: 'Recent case studies', exact: true }).click();
  await tab.playwright.getByRole('button', { name: '$212.1M ETH short · Open saved reading', exact: true }).click();
  await tab.playwright.locator('#card').waitFor({ state: 'visible' });
  assert((await tab.playwright.locator('#headline').innerText()).includes('Ownership is unverified'), 'Funder headline keeps ownership boundary');
  await tab.back();
  assert(await tab.playwright.getByRole('heading', { name: 'Explore', exact: true }).isVisible(), 'Back returns from a reading to Explore');
  await tab.goto(baseURL + '/?s=12pk1a43rv3a1');
  await tab.playwright.locator('#card').waitFor({ state: 'visible' });
  assert(!await tab.playwright.locator('#entry-controls').isVisible(), 'Shared reading shows result before search');
  assert((await tab.playwright.locator('#snapshot-text').innerText()).includes('UTC'), 'Saved date is visible');
  assert(await tab.playwright.locator('#takeaway').isVisible(), 'Evidence takeaway is visible');
  const clipboard = await tab.clipboard.read();
  try {
    await tab.playwright.getByRole('button', { name: 'Copy link', exact: true }).click();
    assert((await tab.clipboard.readText()).endsWith('/?s=12pk1a43rv3a1'), 'Share copies the saved reading link');
  } finally { if (clipboard.length) await tab.clipboard.write(clipboard); else await tab.clipboard.writeText(''); }
  for (const width of [320, 390, 1280]) {
    await viewport.set({ width, height: 844 });
    await fits(width + ' px reading', width);
  }
  await tab.playwright.locator('#card').press('Tab');
  assert(await tab.playwright.evaluate(() => document.activeElement.id) === 'check-live', 'Keyboard reaches the first reading action');
  await tab.goto(baseURL + '/?s=0tx322smj5om6');
  await tab.playwright.locator('#card').waitFor({ state: 'visible' });
  assert(await tab.playwright.locator('#source-warning').isVisible(), 'Incomplete reading keeps its warning');
  assert((await tab.playwright.locator('#snapshot-text').innerText()).includes('rules of the time'), 'Archive keeps historical rules and date');
  const errors = await tab.dev.logs({ levels: ['error'], limit: 20 });
  assert(errors.length === 0, 'No browser JavaScript errors');
  return { baseURL, checkedAt: new Date().toISOString(), checks };
}
