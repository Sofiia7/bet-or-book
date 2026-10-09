export async function runPilotRegression(browser, tab, baseURL) {
  const checks = []; const assert = (ok, label) => { if (!ok) throw new Error(label); checks.push(label); };
  const clipboard = await tab.clipboard.read();
  try {
    await (await browser.capabilities.get('viewport')).set({ width: 320, height: 844 });
    await tab.goto(baseURL + '/?s=12pk1a43rv3a1&claim=ownership');
    await tab.playwright.locator('#claim-result').waitFor({ state: 'visible' });
    assert((await tab.playwright.locator('#claim-result').innerText()).includes('Not established'), 'Funding claim stays unestablished');
    const width = await tab.playwright.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
    assert(width.client === width.scroll, '320 px claim selector fits');
    await tab.playwright.getByRole('button', { name: 'Copy embed', exact: true }).click();
    await tab.playwright.getByRole('button', { name: 'Embed copied', exact: true }).waitFor({ state: 'visible' });
    const embed = await tab.clipboard.readText();
    assert(embed.includes('<iframe') && embed.includes('/embed?s=12pk1a43rv3a1&claim=ownership'), 'Embed carries saved question');
    await tab.playwright.getByLabel('What does the alert claim?', { exact: true }).selectOption('spot');
    assert((await tab.url()).includes('claim=spot'), 'Claim choice travels in saved link');
    await tab.goto(baseURL + '/embed?s=12pk1a43rv3a1&claim=ownership');
    const widget = await tab.playwright.domSnapshot();
    assert(widget.includes('Not established') && widget.includes('2026-10-07') && widget.includes('Nansen'), 'Widget keeps dates, ownership caveat and attribution');
    assert(!widget.includes('Check position'), 'Widget cannot start paid checks');
  } finally { await tab.clipboard.write(clipboard); }
  return { baseURL, checks };
}
