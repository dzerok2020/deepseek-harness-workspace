"""Run against npm run preview. Requires Python playwright, pillow and numpy."""
import json, os, time
from pathlib import Path
import numpy as np
from PIL import Image
from playwright.sync_api import sync_playwright
ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'evidence'
URL = os.environ.get('THREEUI_URL', 'http://127.0.0.1:5207')
# Authored low-quality scene options keep software WebGL verification bounded.
PAGE_URL = URL + '/?q=low&post=0&shadow=0&dpr=1'
INIT = """(() => {
const s=window.__probe={raf:new Set(),ticks:0,resize:0,intersection:0,gl:0};
const raf=requestAnimationFrame.bind(window),cancel=cancelAnimationFrame.bind(window);
window.requestAnimationFrame=cb=>{let id=raf(t=>{s.raf.delete(id);s.ticks++;cb(t)});s.raf.add(id);return id};
window.cancelAnimationFrame=id=>{s.raf.delete(id);return cancel(id)};
for(const [name,key] of [['ResizeObserver','resize'],['IntersectionObserver','intersection']]){
 const Original=window[name];window[name]=class extends Original{constructor(...a){super(...a);this.live=false}observe(...a){if(!this.live){s[key]++;this.live=true}return super.observe(...a)}disconnect(){if(this.live){s[key]--;this.live=false}return super.disconnect()}};
}
const get=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(type,...a){const c=get.call(this,type,...a);if(c&&type.startsWith('webgl')&&!this.__counted){this.__counted=true;s.gl++}return c};
})();"""
def probe(page):
    return page.evaluate("({raf:__probe.raf.size,ticks:__probe.ticks,resize:__probe.resize,intersection:__probe.intersection,gl:__probe.gl,canvases:document.querySelectorAll('canvas').length,iframes:document.querySelectorAll('iframe').length})")
def difference(a,b):
    x=np.array(Image.open(a).convert('RGB')).astype(float)
    y=np.array(Image.open(b).convert('RGB')).astype(float)
    return {'meanAbsoluteDelta':float(np.abs(x-y).mean()),'changedPixelFraction':float(np.any(x!=y,axis=2).mean())}
report={'url':PAGE_URL,'devices':{},'limitations':['Software WebGL: low quality, postprocessing and shadows disabled using upstream scene options. Default high quality timed out taking a screenshot after shader repair.']}
with sync_playwright() as p:
    browser=p.chromium.launch(args=['--enable-webgl','--ignore-gpu-blocklist'])
    for device,width,height in [('desktop',1440,1100),('mobile',390,844)]:
        context=browser.new_context(viewport={'width':width,'height':height},device_scale_factor=1,is_mobile=device=='mobile',has_touch=device=='mobile')
        context.add_init_script(INIT)
        page=context.new_page(); errors=[]; warnings=[]; requests=[]; failed=[]; responses=[]
        page.on('pageerror',lambda e:errors.append(str(e)))
        page.on('console',lambda m:errors.append(m.text) if m.type=='error' else warnings.append(m.text) if m.type=='warning' else None)
        page.on('request',lambda r:requests.append({'url':r.url,'type':r.resource_type}) if r.url.startswith('http') and not r.url.startswith(URL) else None)
        page.on('requestfailed',lambda r:failed.append({'url':r.url,'failure':r.failure}))
        page.on('response',lambda r:responses.append({'url':r.url,'status':r.status}) if not r.url.startswith(URL) or r.status>=400 else None)
        page.goto(PAGE_URL,wait_until='networkidle');page.locator('canvas').wait_for();page.wait_for_timeout(1200)
        results={}
        for tab,label in [('shader','01 / Shader'),('scene','02 / Scene')]:
            page.get_by_role('button',name=label,exact=True).click();page.locator('canvas').wait_for();page.wait_for_timeout(1600)
            a=OUT/f'{device}-{tab}-a.png';b=OUT/f'{device}-{tab}-b.png'
            page.screenshot(path=str(OUT/f'{device}-{tab}.png'),full_page=True)
            page.get_by_test_id('stage').screenshot(path=str(a));page.wait_for_timeout(750);page.get_by_test_id('stage').screenshot(path=str(b))
            motion=difference(a,b);assert motion['meanAbsoluteDelta']>0.01,(device,tab,motion)
            before=probe(page);page.get_by_role('button',name='Unmount specimen',exact=True).click();page.wait_for_timeout(500);unmounted=probe(page)
            assert unmounted['raf']==0 and unmounted['resize']==0 and unmounted['intersection']==0 and unmounted['canvases']==0,unmounted
            cycles=[]
            for _ in range(3):
                page.get_by_role('button',name='Mount specimen',exact=True).click();page.locator('canvas').wait_for();page.wait_for_timeout(250)
                page.get_by_role('button',name='Unmount specimen',exact=True).click();page.wait_for_timeout(250);cycles.append(probe(page))
                assert all(cycles[-1][k]==0 for k in ['raf','resize','intersection','canvases']),cycles[-1]
            results[tab]={'motion':motion,'mounted':before,'unmounted':unmounted,'threeMoreCycles':cycles}
        for tab,label in [('interaction','03 / Interaction'),('nebula','04 / External probe')]:
            assert not errors, 'Native WebGL errors: '+str(errors)
            start_errors=len(errors);start_failed=len(failed);start_req=len(requests)
            page.get_by_role('button',name=label,exact=True).click();page.locator('iframe').wait_for();page.wait_for_timeout(7000)
            frame=page.frames[-1]; info={'title':frame.title(),'canvas':frame.locator('canvas').count(),'buttons':frame.locator('button').count()}
            a=OUT/f'{device}-{tab}-a.png';b=OUT/f'{device}-{tab}-b.png'
            page.get_by_test_id('stage').screenshot(path=str(a));page.wait_for_timeout(750);page.get_by_test_id('stage').screenshot(path=str(b));info['motion']=difference(a,b)
            info['buttonTexts']=frame.locator('button').all_text_contents()
            if frame.locator('button').count():
                button=frame.locator('button').first
                try:
                    button.hover(timeout=3000);page.wait_for_timeout(400);button.click(timeout=3000);info['clicked']=True
                except Exception as e:info['clicked']=False;info['interactionError']=str(e)
            info.update({'errors':errors[start_errors:],'failed':failed[start_failed:],'externalRequests':requests[start_req:]})
            page.screenshot(path=str(OUT/f'{device}-{tab}.png'),full_page=True)
            page.get_by_role('button',name='Unmount specimen',exact=True).click();page.wait_for_timeout(500);info['afterUnmount']=probe(page);assert info['afterUnmount']['iframes']==0
            results[tab]=info
        page.emulate_media(reduced_motion='reduce');page.get_by_role('button',name='01 / Shader',exact=True).click();page.wait_for_timeout(300)
        reduced=probe(page);assert reduced['canvases']==0 and reduced['iframes']==0
        page.screenshot(path=str(OUT/f'{device}-reduced-motion.png'),full_page=True)
        assert page.locator('body').evaluate('(e)=>e.scrollWidth<=innerWidth'),'horizontal overflow'
        results['reducedMotion']=reduced
        report['devices'][device]={'results':results,'errors':errors,'warnings':warnings,'externalRequests':requests,'failedRequests':failed,'networkResponses':responses}
        (OUT/'browser-report.json').write_text(json.dumps(report,indent=2))
        context.close()
    browser.close()
print(json.dumps(report,indent=2))
