// Run only against browser-replay.ts. All live POST responses are fixtures.
export async function runSavedChangeRegression(browser, tab) {
  const checks = [];
  const assert = (ok, text) => { if (!ok) throw new Error(text); checks.push(text); };
  const baseURL = 'http://localhost:8789';
  await (await browser.capabilities.get('viewport')).set({ width: 390, height: 844 });
  // Reset only this replay fixture's bookmark through the UI for repeatable runs.
  await tab.goto(baseURL + '/');
  const oldFixture = tab.playwright.getByRole('button', { name: /Remove .*HYPE long.*0x082e.*ca88/ });
  if (await oldFixture.count()) await oldFixture.click();
  await tab.playwright.domSnapshot();
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
  assert((await tab.playwright.locator('#save-confirmation-text').innerText()).includes('did not replace it'), 'Saving an older card preserves the newer bookmark');
  const clipboard = await tab.clipboard.read();
  try {
    await tab.playwright.locator('#save-copy-link').click();
    assert((await tab.clipboard.readText()).includes('s=replay-new-reading'), 'Save confirmation copies the retained bookmark, not the older card');
  } finally { if (clipboard.length) await tab.clipboard.write(clipboard); else await tab.clipboard.writeText(''); }
  await tab.playwright.getByRole('button', { name: 'Open my saved positions', exact: true }).click();
  await tab.playwright.getByRole('button', { name: /Refresh .*HYPE long.*with a new check/ }).click();
  await tab.playwright.getByText('That reading answered a different question, so there is nothing to compare it to.', { exact: true }).waitFor({ state: 'visible' });
  assert((await tab.playwright.locator('#changed-list li').count()) === 0, 'A selected-position check against a largest-position baseline is not presented as a trading change');
  await tab.playwright.locator('#full-analysis').click();
  await tab.playwright.locator('#load-context').click();
  await tab.playwright.getByRole('button', { name: 'Copy wallet link', exact: true }).waitFor({ state: 'visible' });
  await tab.playwright.locator('#watch-address').click();
  assert((await tab.playwright.locator('#save-confirmation-text').innerText()).includes('did not replace it'), 'An unsaved refresh cannot erase the last persisted bookmark');
  const afterFailureClipboard = await tab.clipboard.read();
  try {
    await tab.playwright.locator('#save-copy-link').click();
    assert((await tab.clipboard.readText()).includes('s=replay-focused-reading'), 'Confirmation retains the last successfully saved link after write failure');
  } finally { if (afterFailureClipboard.length) await tab.clipboard.write(afterFailureClipboard); else await tab.clipboard.writeText(''); }
  await tab.playwright.getByRole('button', { name: 'Open my saved positions', exact: true }).click();
  await tab.playwright.getByRole('button', { name: /HYPE long.*Open saved/ }).click();
  await tab.playwright.getByRole('button', { name: 'Copy link', exact: true }).waitFor({ state: 'visible' });
  assert((await tab.url()).includes('s=replay-focused-reading'), 'The retained reading can still reopen free after a failed write');
  assert((await tab.dev.logs({ levels: ['error'], limit: 20 })).length === 0, 'No browser errors in saved comparison');
  return { baseURL, fixtureOnly: true, checkedAt: new Date().toISOString(), checks };
}

// Disposable replay wallets only; checks the twelve-bookmark boundary through UI.
export async function runSavedCapacityRegression(browser, tab) {
  const checks = []; const assert = (ok, text) => { if (!ok) throw new Error(text); checks.push(text); };
  const origin = 'http://localhost:8789';
  const cleanup = async () => {
    await tab.goto(origin + '/');
    const buttons = tab.playwright.getByRole('button', { name: /Remove .*0x2222/ });
    while (await buttons.count()) { await buttons.first().click(); await tab.playwright.domSnapshot(); }
  };
  await cleanup();
  try {
    for (let i = 2; i <= 13; i++) {
      const address = '0x' + '2'.repeat(38) + i.toString(16).padStart(2, '0');
      await tab.goto(origin + '/?address=' + address);
      await tab.playwright.getByRole('button', { name: 'Check position', exact: true }).click();
      await tab.playwright.getByRole('button', { name: 'Copy wallet link', exact: true }).waitFor({ state: 'visible' });
      await tab.playwright.locator('#watch-address').click();
      if (i === 13) {
        assert((await tab.playwright.getByRole('status').first().innerText()).includes('12 saved-position slots are full'), 'Thirteenth save reports capacity without silently evicting a bookmark');
        assert(!await tab.playwright.locator('#save-confirmation').isVisible(), 'A rejected save does not claim success');
      }
    }
    await tab.playwright.getByRole('button', { name: 'Check another', exact: true }).click();
    assert(await tab.playwright.locator('#watched .watch-row').count() === 12, 'Twelve existing saved positions remain available');
    assert(await tab.playwright.getByRole('button', { name: /HYPE long.*0x082e.*Open saved/ }).isVisible(), 'Original replay bookmark is retained at capacity');
  } finally { await cleanup(); }
  return { checks, fixtureOnly: true };
}
