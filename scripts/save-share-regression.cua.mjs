// UI-only regression. Uses a free bundled reading and preserves the clipboard.
export async function runSaveShareRegression(browser, tab, baseURL) {
  const checks = [];
  const assert = (ok, label) => { if (!ok) throw new Error(label); checks.push(label); };
  await (await browser.capabilities.get('viewport')).set({ width: 390, height: 844 });
  await tab.goto(baseURL + '/?s=12pk1a43rv3a1');
  await tab.playwright.locator('#card').waitFor({ state: 'visible' });
  await tab.playwright.locator('#watch-address').click();
  assert(await tab.playwright.locator('#save-confirmation').isVisible(), 'Save confirms browser-local storage and free reopening');
  const name = tab.playwright.getByLabel('Name this saved position (optional)', { exact: true });
  const original = await name.evaluate(el => el.value);
  const clipboard = await tab.clipboard.read();
  try {
    await name.press('ControlOrMeta+A');
    await name.press('Backspace');
    await name.pressSequentially('Audit Save Share');
    await tab.playwright.getByRole('button', { name: 'Copy saved reading link', exact: true }).click();
    assert(await tab.clipboard.readText() === baseURL + '/?s=12pk1a43rv3a1', 'Saved confirmation copies the exact dated reading link');
    await tab.playwright.getByRole('button', { name: 'Copy reading', exact: true }).click();
    const text = await tab.clipboard.readText();
    assert(text.includes('Read 07 Oct, 15:56 UTC'), 'Copied reading includes its original date');
    assert(text.includes('Still open:') && text.includes('not who holds the ETH now'), 'Copied reading includes the ownership limitation');
    assert(text.includes('Powered by @nansen_ai') && text.endsWith('/?s=12pk1a43rv3a1'), 'Copied reading carries attribution and saved link');
    for (const width of [320, 390, 1280]) {
      await (await browser.capabilities.get('viewport')).set({ width, height: 844 });
      const size = await tab.playwright.evaluate(() => ({ width: window.innerWidth, client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
      assert(size.width === width && size.scroll === size.client, width + ' px Save confirmation fits the viewport');
    }
    // Observe the resized layout before interacting with it.
    await tab.playwright.domSnapshot();
    await tab.playwright.getByRole('button', { name: 'Open my saved positions', exact: true }).click();
    const saved = tab.playwright.locator('#watched').getByRole('button', { name: /Audit Save Share.*Open saved/ });
    await saved.waitFor({ state: 'visible' });
    assert(await saved.isVisible(), 'Named position is accessible from the saved list');
    await tab.reload();
    await saved.waitFor({ state: 'visible' });
    assert(await saved.isVisible(), 'Saved name persists after reload');
    await saved.click();
    await tab.playwright.locator('#card').waitFor({ state: 'visible' });
    assert((await tab.playwright.locator('#snapshot-text').innerText()).includes('07 Oct, 15:56 UTC'), 'Reopening restores the original reading date');
    await tab.playwright.locator('#watch-address').click();
    await name.press('ControlOrMeta+A');
    await name.press('Backspace');
    if (original) await name.pressSequentially(original);
    assert((await tab.dev.logs({ levels: ['error'], limit: 20 })).length === 0, 'No JavaScript errors in Save and Share');
  } finally {
    if (clipboard.length) await tab.clipboard.write(clipboard); else await tab.clipboard.writeText('');
  }
  return { baseURL, checkedAt: new Date().toISOString(), checks };
}
