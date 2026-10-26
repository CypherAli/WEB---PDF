import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from '../src/runtime.mjs';
import {snapshot} from '../src/dom.mjs';
import {domFunction} from '../src/dom-evaluate.mjs';
import {createHtml} from '../extension/shared.js';

test('offline SVG retains CSS paint, geometry, local definitions and hidden labels',async()=>{
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try {
    const page=await browser.newPage();
    const diagram=`<svg viewBox="0 0 800 300" width="800" height="300" role="img" aria-labelledby="title">
      <title id="title">Delivery loop</title><defs>
        <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10Z" class="head"/></marker>
        <linearGradient id="shade"><stop class="stop"/><stop offset="1" stop-color="white"/></linearGradient>
        <clipPath id="clip"><rect width="800" height="300"/></clipPath>
      </defs><g transform="translate(10 10)" clip-path="url(#clip)">
        <circle cx="120" cy="70" r="26" fill="var(--surface)" stroke="var(--accent)" stroke-width="2.5"/>
        <path class="edge" d="M120 100V180" marker-end="url(#arrow)"/>
        <rect class="node" x="30" y="190" width="190" height="80"/>
        <text x="125" y="230" text-anchor="middle">Build and verify</text>
        <path class="feedback" d="M500 200C500 280 300 280 300 200"/>
      </g><script>window.__svgScriptRan=true</script></svg>`;
    await page.setContent(`<!doctype html><style>
      body{font:16px Arial}main{--accent:rgb(30,50,255);--surface:rgb(245,246,248)}
      .edge{fill:none;stroke:var(--accent);stroke-width:2}.head{fill:var(--accent)}
      .node{fill:url(#shade);stroke:#7d8a9e}.stop{stop-color:var(--accent)}
      .feedback{fill:none;stroke:#7d8a9e;stroke-dasharray:9 10;opacity:.75}
      .sr-only{position:absolute;width:1px;height:1px;clip:rect(0,0,0,0);overflow:hidden}
      .sl-anchor-link{position:absolute;opacity:0}
    </style><main><h2>Find Your Starting Point</h2><a class="sl-anchor-link" href="#start"><span class="sr-only">Section titled hidden label</span></a><p>Readable text</p>${diagram}${diagram}</main>`);
    const readPaint=()=>page.locator('svg').first().evaluate(svg=>{
      const style=q=>getComputedStyle(svg.querySelector(q));
      return {fill:style('circle').fill,stroke:style('circle').stroke,width:style('circle').strokeWidth,
        edge:style('.edge, [data-edge]').stroke, transform:style('g').transform,
        dash:style('.feedback, [data-feedback]').strokeDasharray,opacity:style('.feedback, [data-feedback]').opacity};
    });
    await page.locator('.edge').evaluateAll(els=>els.forEach(el=>el.setAttribute('data-edge','')));
    await page.locator('.feedback').evaluateAll(els=>els.forEach(el=>el.setAttribute('data-feedback','')));
    const expected=await readPaint();
    const chunk=await page.evaluate(domFunction(snapshot),{selector:'main'});
    assert.ok(!chunk.html.includes('<script'));
    assert.ok(!chunk.html.includes('Section titled hidden label'));
    assert.ok(chunk.text.includes('Readable text'));
    await page.setContent(createHtml([{chunks:[chunk],report:{title:'SVG regression',source:'local',questions:[],complete:true}}]));
    assert.deepEqual(await readPaint(),expected);
    const refs=await page.locator('svg').evaluateAll(svgs=>svgs.map(svg=>{
      const edge=svg.querySelector('[data-edge]'),url=getComputedStyle(edge).markerEnd;
      const id=url.slice(url.lastIndexOf('#')+1).replace(/["')]/g,'');
      const resolves=value=>{const ref=value.slice(value.lastIndexOf('#')+1).replace(/["')]/g,'');return !!svg.querySelector(`[id="${ref}"]`);};
      return {id,local:!!svg.querySelector(`[id="${id}"]`),title:!!svg.querySelector(`[id="${svg.getAttribute('aria-labelledby')}"]`),
        gradient:resolves(getComputedStyle(svg.querySelector('g rect')).fill),clip:resolves(getComputedStyle(svg.querySelector('g')).clipPath)};
    }));
    assert.equal(refs.length,2);assert.notEqual(refs[0].id,refs[1].id);
    assert.ok(refs.every(ref=>ref.local && ref.title && ref.gradient && ref.clip),'each SVG resolves its own marker, gradient, clip and accessible title');
    assert.equal(await page.locator('svg text').first().textContent(),'Build and verify');
    await page.locator('.document').evaluate(el=>{el.style.width='400px';el.style.padding='0';});
    const size=await page.locator('svg').first().boundingBox();
    assert.equal(size.width,400);assert.equal(size.height,150);
  } finally {await browser.close();}
});
