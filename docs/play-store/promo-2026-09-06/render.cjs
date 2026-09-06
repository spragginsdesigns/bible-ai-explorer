/* Rebuild this promo set without generating or rewriting any app UI. */
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { createRequire } = require('node:module');
const { pathToFileURL } = require('node:url');

const runtime = process.env.CODEX_NODE_MODULES || path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules');
const runtimeRequire = createRequire(path.join(runtime, '_promo.cjs'));
const sharp = runtimeRequire('sharp');
const { chromium } = runtimeRequire('playwright');
const root = __dirname;
const W = 1080, H = 1920, panelTop = 432;
const esc = (s) => String(s).replace(/[&<>\"]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');
const read = (p) => fs.readFile(path.join(root, p));

async function main() {
  const specs = JSON.parse(await read('layout-spec.json'));
  for (const p of ['panels','screenshots']) await fs.mkdir(path.join(root,p), {recursive:true});
  const provenance = [];
  for (const s of specs) {
    const raw = await read('sources/' + s.source);
    const metadata = await sharp(raw).metadata();
    const panel = await sharp(raw).extract(s.crop).resize({width:s.panelWidth, kernel:'lanczos3'}).removeAlpha().png().toBuffer();
    const pm = await sharp(panel).metadata();
    s.panelHeight = pm.height;
    s.panelLeft = Math.round((W-s.panelWidth)/2);
    if (panelTop + s.panelHeight > 1850) throw new Error('Panel overlaps footer: ' + s.id);
    await fs.writeFile(path.join(root,'panels',s.id+'.png'), panel);
    provenance.push({id:s.id, source:s.source, sourceDimensions:[metadata.width,metadata.height], sourceSha256:sha256(raw), crop:s.crop, panelDimensions:[pm.width,pm.height], panelSha256:sha256(panel), placement:{left:s.panelLeft,top:panelTop}, alt:s.alt});
  }
  const cards = specs.map((s,i) => `<article class="promo" id="${esc(s.id)}">
    <div class="backdrop"></div><div class="top-shade"></div>
    <div class="brand"><span>SureWord</span><i></i><b>BIBLE STUDY</b></div>
    <h1>${esc(s.headline[0])}<br><em>${esc(s.headline[1])}</em></h1>
    <p class="subtitle">${esc(s.subtitle)}</p>
    <div class="screen" style="left:${s.panelLeft}px;top:${panelTop}px;width:${s.panelWidth}px;height:${s.panelHeight}px"><img width="${s.panelWidth}" height="${s.panelHeight}" src="panels/${s.id}.png" alt="${esc(s.alt)}"></div>
    <footer><span>${esc(s.feature)}</span><div class="dots">${specs.map((_,j)=>`<i class="${i===j?'active':''}"></i>`).join('')}</div></footer>
  </article>`).join('\n');
  const html = `<!doctype html><html lang="en"><meta charset="utf-8"><title>SureWord · Play Store artwork</title><style>
    @font-face{font-family:Brand;src:url('sources/fonts/brand.ttf')}@font-face{font-family:Headline;src:url('sources/fonts/headline.ttf');font-weight:600}@font-face{font-family:Body;src:url('sources/fonts/body.ttf')}
    *{box-sizing:border-box}body{margin:0;background:#111;color:#f7f1e4}.promo{position:relative;width:${W}px;height:${H}px;overflow:hidden;background:#070807;margin:0;font-family:Body,sans-serif;isolation:isolate}
    .backdrop{position:absolute;inset:0;background:url('sources/gold-arch-background.png') center/cover no-repeat;z-index:-2}.top-shade{position:absolute;inset:0;background:linear-gradient(#070807 0%,rgba(7,8,7,.75) 12%,transparent 46%);z-index:-1}
    .brand{position:absolute;left:76px;right:76px;top:48px;height:64px;display:flex;align-items:center;gap:25px;color:#d9b96e}.brand span{font:52px Brand}.brand i{height:28px;width:1px;background:#786038}.brand b{font:20px Body;letter-spacing:4px;padding-top:5px}
    h1{position:absolute;left:74px;right:58px;top:133px;margin:0;font:600 104px/.91 Headline,Georgia,serif;letter-spacing:-2.1px;color:#f7f1e4}h1 em{font-style:normal;color:#f1c85f}
    .subtitle{position:absolute;left:78px;right:50px;top:341px;margin:0;font:31px/1.25 Body,sans-serif;color:#d3c9b5;white-space:nowrap}
    .screen{position:absolute;border-radius:34px;overflow:hidden;outline:1px solid rgba(223,185,98,.38);box-shadow:0 28px 65px #000,0 0 44px rgba(192,144,43,.10)}.screen img{display:block;max-width:none}
    footer{position:absolute;left:78px;right:78px;bottom:40px;display:flex;align-items:center;justify-content:space-between;border-top:1px solid #4b3b1e;padding-top:18px;color:#c8b27c;font:18px Body;letter-spacing:2.6px}.dots{display:flex;gap:9px}.dots i{display:block;width:7px;height:7px;border-radius:100%;background:#493d26}.dots .active{width:24px;border-radius:8px;background:#e6bb56}
  </style><body>${cards}</body></html>`;
  await fs.writeFile(path.join(root,'artwork.html'),html);
  const browser = await chromium.launch({headless:true});
  try {
    const page = await browser.newPage({viewport:{width:W,height:H},deviceScaleFactor:1});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(pathToFileURL(path.join(root,'artwork.html')).href);
    await page.evaluate(async()=>{await document.fonts.ready;await Promise.all([...document.images].map(img=>img.decode()));});
    const typography = await page.locator('.promo').evaluateAll(cards=>cards.map(c=>{
      const title=c.querySelector('h1'), sub=c.querySelector('.subtitle');
      return {id:c.id, titleWidth:title.scrollWidth, titleBox:title.clientWidth, subWidth:sub.scrollWidth, subBox:sub.clientWidth};
    }));
    for (const s of specs) {
      const raw = await page.locator('[id="'+s.id+'"]').screenshot({type:'png',animations:'disabled'});
      const out = path.join(root,'screenshots',s.id+'.png');
      await sharp(raw).removeAlpha().toColourspace('srgb').png({compressionLevel:9,palette:false}).toFile(out);
      const m = await sharp(out).metadata();
      if(m.width!==W||m.height!==H||m.channels!==3||m.hasAlpha) throw new Error('Invalid Play export '+s.id);
      // The interior must be the original prepared screenshot, byte for byte.
      const inset=42;
      const area={left:inset,top:inset,width:s.panelWidth-inset*2,height:s.panelHeight-inset*2};
      const expected=await sharp(path.join(root,'panels',s.id+'.png')).extract(area).raw().toBuffer();
      const actual=await sharp(out).extract({...area,left:s.panelLeft+inset,top:panelTop+inset}).raw().toBuffer();
      if (!actual.equals(expected)) throw new Error('Screenshot pixels changed: '+s.id);
      const p=provenance.find(p=>p.id===s.id);p.finalSha256=sha256(await fs.readFile(out));p.pixelIntegrity='PASS: screenshot interior matches original crop and resize exactly';
      process.stdout.write(s.id+' | 1080x1920 RGB | source pixels verified\n');
    }
    await fs.writeFile(path.join(root,'verification.json'),JSON.stringify({android:{version:'1.50.0',versionCode:49,commit:'68f67f7',device:'emulator-5554'},export:{width:W,height:H,format:'PNG',channels:3,alpha:false},browserErrors:errors,typography,images:provenance},null,2)+'\n');
    if(errors.length||typography.some(t=>t.titleWidth>t.titleBox||t.subWidth>t.subBox))throw new Error('Render or typography overflow');
  } finally { await browser.close(); }
  const thumbW=270, thumbH=480, gap=18, cols=4, rows=Math.ceil(specs.length/cols);
  const thumbnails=await Promise.all(specs.map(async(s,i)=>({input:await sharp(path.join(root,'screenshots',s.id+'.png')).resize(thumbW,thumbH).toBuffer(),left:gap+(i%cols)*(thumbW+gap),top:gap+Math.floor(i/cols)*(thumbH+gap)})));
  await sharp({create:{width:cols*(thumbW+gap)+gap,height:rows*(thumbH+gap)+gap,channels:3,background:'#171612'}}).composite(thumbnails).png().toFile(path.join(root,'contact-sheet.png'));
  const gallery=`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>SureWord · Play Store promo images</title><style>body{background:#0b0b09;color:#eee5d5;font:17px/1.5 system-ui;margin:0;padding:32px}header{max-width:1400px;margin:auto auto 28px}h1{font:36px Georgia;margin:0 0 8px;color:#edc567}p{margin:6px 0;color:#c5baa3}a{color:#edc567}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:24px;max-width:1400px;margin:auto}figure{margin:0}img{width:100%;height:auto;border-radius:12px;border:1px solid #574622}figcaption{font-size:14px;padding-top:8px}strong{color:#e6be64}</style><body><header><h1>SureWord · Go deeper in the Word.</h1><p>${specs.length} Play Store phone images · 1080 × 1920 · RGB PNG</p><p>Real Android 1.50.0 captures. Click an image for the full-size export.</p><p><a href="research-and-claims.md">Research & claims</a> · <a href="verification.json">Capture provenance & verification</a> · <a href="layout-spec.json">Editable copy & crop settings</a></p></header><main class="grid">${specs.map((s,i)=>`<figure><a href="screenshots/${s.id}.png"><img src="screenshots/${s.id}.png" alt="${esc(s.alt)}"></a><figcaption><strong>${String(i+1).padStart(2,'0')}</strong> · ${esc(s.feature)}</figcaption></figure>`).join('')}</main></body></html>`;
  await fs.writeFile(path.join(root,'index.html'),gallery);
}
main().catch(e=>{process.stderr.write(e.stack+'\n');process.exitCode=1;});
