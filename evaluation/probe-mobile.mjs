import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
const browser = await chromium.launch({headless:true,args:['--enable-unsafe-swiftshader']});
try {
  const context = await browser.newContext({viewport:{width:390,height:844}});
  await context.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    const json = path === '/api/rides' ? [] : path === '/api/profile' ? {ftp:250}
      : path === '/api/health' ? {ok:true,storage:'sqlite',rides:0} : {status:'disconnected',error:null};
    return route.fulfill({json});
  });
  await context.addInitScript(() => localStorage.setItem('summit-world', JSON.stringify('sky')));
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:3001');
  await page.locator('.demo-start').click();
  await page.waitForTimeout(1500);
  const measure = async () => ({
    buttons: await page.locator('button').evaluateAll(nodes => nodes.filter(n =>
      ['Neste segment', 'Jeg er ferdig oppvarmet', 'Avslutt økt'].includes(n.textContent.trim())
    ).map(n => { const b=n.getBoundingClientRect(); return {
      label:n.textContent.trim(),x:b.x,y:b.y,width:b.width,height:b.height,
      fullyInsideViewport:b.top>=0&&b.bottom<=innerHeight,
    }; })),
    ...await page.evaluate(() => ({scrollY,viewport:{width:innerWidth,height:innerHeight},
      document:{width:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight}})),
  });
  const afterStart = await measure();
  await page.screenshot({path:'evaluation/evidence/mobile-viewport.png'});
  await page.evaluate(() => window.scrollTo(0,0));
  await page.waitForTimeout(100);
  const atTop = await measure();
  await page.screenshot({path:'evaluation/evidence/mobile-at-top.png'});
  writeFileSync('evaluation/mobile-probe.json', JSON.stringify({kind:'isolated_live_dom_probe',afterStart,atTop,
    limitation:'Fresh 390x844 browser context; all API requests mocked in-memory. Records automatic post-click scroll and explicit scroll-to-top. No physical mobile device, input comfort or human readability tested.'},null,2));
  console.log(JSON.stringify({afterStart,atTop}));
} finally { await browser.close(); }
