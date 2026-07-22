#!/usr/bin/env python3
from __future__ import annotations
import base64, json, os, statistics, subprocess, time, urllib.request
from pathlib import Path
import websocket

ROOT = Path(__file__).resolve().parents[1]
OLD = Path(os.environ.get('AIRMON_OLD_PREVIEW', '/mnt/data/Airmonlink-Composer-0.9.0/Airmonlink-Composer-Preview.html'))
NEW = ROOT / 'Airmonlink-Composer-Preview.html'
CHROMIUM = os.environ.get('CHROMIUM', '/usr/bin/chromium')

class Cdp:
    def __init__(self, url):
        self.ws = websocket.create_connection(url, timeout=180, max_size=None); self.i = 0
    def call(self, method, params=None):
        self.i += 1; target = self.i
        self.ws.send(json.dumps({'id':target,'method':method,'params':params or {}}))
        while True:
            msg = json.loads(self.ws.recv())
            if msg.get('id') == target:
                if msg.get('error'): raise RuntimeError(msg['error'])
                return msg.get('result', {})
    def eval(self, expr):
        return self.call('Runtime.evaluate', {'expression':expr,'returnByValue':True}).get('result',{}).get('value')
    def close(self): self.ws.close()

def wait_page(port):
    for _ in range(200):
        try:
            pages=json.load(urllib.request.urlopen(f'http://127.0.0.1:{port}/json',timeout=1))
            page=next((p for p in pages if p.get('type')=='page'),None)
            if page:return page
        except Exception: pass
        time.sleep(.05)
    raise RuntimeError('CDP unavailable')

def run_one(path:Path, port:int, screenshot:Path):
    profile=f'/tmp/airmon-perf-{port}'; subprocess.run(['rm','-rf',profile],check=False)
    proc=subprocess.Popen([CHROMIUM,'--headless','--no-sandbox','--disable-gpu','--disable-dev-shm-usage',f'--remote-debugging-port={port}','--remote-allow-origins=*',f'--user-data-dir={profile}','--window-size=1600,1000','about:blank'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    cdp=None
    try:
        page=wait_page(port); cdp=Cdp(page['webSocketDebuggerUrl']); cdp.call('Runtime.enable'); cdp.call('Page.enable')
        frame=cdp.call('Page.getFrameTree')['frameTree']['frame']['id']
        start=time.perf_counter(); cdp.call('Page.setDocumentContent',{'frameId':frame,'html':path.read_text(encoding='utf-8')})
        for _ in range(400):
            if cdp.eval("Boolean(document.querySelector('#notationCanvas svg'))"): break
            time.sleep(.01)
        boot=(time.perf_counter()-start)*1000
        time.sleep(.4)
        cdp.eval("document.body.classList.remove('high-contrast','reduced-motion');document.querySelectorAll('.toast').forEach(t=>t.remove());true")
        png=cdp.call('Page.captureScreenshot',{'format':'png','captureBeyondViewport':False}).get('data'); screenshot.write_bytes(base64.b64decode(png))
        click_expr="""(()=>{const ids=[...document.querySelectorAll('.note-group[data-event-id]')].slice(0,8).map(x=>x.dataset.eventId);const samples=[];for(let pass=0;pass<3;pass++){const t=performance.now();for(let i=0;i<10;i++){const id=ids[i%ids.length];document.querySelector(`.note-group[data-event-id='${id}']`)?.dispatchEvent(new MouseEvent('click',{bubbles:true}));}samples.push(performance.now()-t);}return samples})()"""
        layer_expr="""(()=>{const samples=[];for(let pass=0;pass<3;pass++){const t=performance.now();for(let i=0;i<8;i++){document.querySelector(`#layerButtons .layer-button:nth-child(${i%4+1})`)?.click();}samples.push(performance.now()-t);}return samples})()"""
        clicks=cdp.eval(click_expr); layers=cdp.eval(layer_expr)
        metrics=cdp.eval("window.AirmonPerformance?AirmonPerformance.snapshot():null")
        return {'boot_ms':boot,'selection_10_ms_samples':clicks,'selection_10_ms_median':statistics.median(clicks),'layer_8_ms_samples':layers,'layer_8_ms_median':statistics.median(layers),'metrics':metrics}
    finally:
        if cdp: cdp.close()
        proc.terminate()
        try:proc.wait(timeout=5)
        except subprocess.TimeoutExpired:proc.kill()

def main():
    if not OLD.exists() or not NEW.exists(): raise SystemExit('Missing preview')
    old=run_one(OLD,9331,ROOT/'UI-BEFORE-0.9.0.png')
    new=run_one(NEW,9332,ROOT/'UI-AFTER-0.9.1.png')
    def gain(a,b): return ((a-b)/a*100) if a else 0
    result={'old':old,'new':new,'improvement_percent':{'boot':gain(old['boot_ms'],new['boot_ms']),'selection':gain(old['selection_10_ms_median'],new['selection_10_ms_median']),'layer_switching':gain(old['layer_8_ms_median'],new['layer_8_ms_median'])}}
    (ROOT/'PERFORMANCE-COMPARISON.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
    print(json.dumps(result,indent=2))
if __name__=='__main__':main()
