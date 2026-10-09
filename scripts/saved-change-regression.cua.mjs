// Run only against browser-replay.ts. All live POST responses are fixtures.
export async function runSavedChangeRegression(browser, tab) {
  const checks = [];
  const assert = (ok, text) => { if (!ok) throw new Error(text); checks.push(text); };
  const baseURL = 'http://localhost:8789';
  await (await browser.capabilities.get('viewport')).set({ width: 390, height: 844 });
  await tab.goto(baseURL + '/?s=0aio3f82kqsu9');
  await tab.playwright.locator('#card').waitFor({ state: 'visible' });
  await tab.playwright.locator('#watch-address').click();
  await tab.playwright.getByRole('button', { name: 'Check live', exact: true }).click();
  await tab.playwright.locator('#changed-list li').waitFor({ state: 'visible' });
  assert((await tab.playwright.locator('#changed-list').innerText()).includes('$122.1M → $91.6M'), 'Manual check compares the original saved reading to the new fixture');
  assert(await tab.playwright.locator('#changed-previous').getAttribute('href') === '/?s=0aio3f82kqsu9', 'Previous link points to the user bookmark, without a provider call');
  assert(!await tab.playwright.locator('#full-analysis').getAttribute('open'), 'Change is visible without expanding Full analysis');
  await tab.reload();
  await tab.playwright.locator('#changed-list li').waitFor({ state: 'visible' });
  assert((await tab.playwright.locator('#changed-list').innerText()).includes('$122.1M → $91.6M'), 'Original baseline persists after reload');
  for (const width of [320, 390, 1280]) {
    await (await browser.capabilities.get('viewport')).set({ width, height: 844 });
    const size = await tab.playwright.evaluate(() => ({ width: window.innerWidth, client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
    assert(size.width === width && size.client === size.scroll, width + ' px comparison fits');
  }
  await tab.playwright.domSnapshot();
  await tab.playwright.getByRole('link', { name: 'Open previous reading · free', exact: true }).click();
  await tab.playwright.locator('#card').waitFor({ state: 'visible' });
  await tab.playwright.locator('#watch-address').click();
  await tab.playwright.getByRole('button', { name: 'Open my saved positions', exact: true }).click();
  await tab.playwright.getByRole('button', { name: /Refresh .*HYPE long.*with a new check/ }).click();
  await tab.playwright.getByText('That reading answered a different question, so there is nothing to compare it to.', { exact: true }).waitFor({ state: 'visible' });
  assert((await tab.playwright.locator('#changed-list li').count()) === 0, 'A selected-position check against a largest-position baseline is not presented as a trading change');
  assert((await tab.dev.logs({ levels: ['error'], limit: 20 })).length === 0, 'No browser errors in saved comparison');
  return { baseURL, fixtureOnly: true, checkedAt: new Date().toISOString(), checks };
}
