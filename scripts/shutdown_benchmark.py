#!/usr/bin/env python3
"""Measures renderer cleanup for the deterministic Electron shutdown request."""
from __future__ import annotations
import json, os, re, subprocess, time, urllib.request
from pathlib import Path
import websocket

ROOT = Path(__file__).resolve().parents[1]
PREVIEW = ROOT / 'Airmonlink-Composer-Preview.html'
CHROMIUM = os.environ.get('CHROMIUM', '/usr/bin/chromium')
PORT = int(os.environ.get('AIRMON_SHUTDOWN_CDP_PORT', '9333'))


def wait_page():
    for _ in range(150):
        try:
            pages = json.load(urllib.request.urlopen(f'http://127.0.0.1:{PORT}/json', timeout=1))
            page = next((p for p in pages if p.get('type') == 'page'), None)
            if page:
                return page
        except Exception:
            pass
        time.sleep(.1)
    raise RuntimeError('Chromium DevTools endpoint did not become available.')


def call(ws, number, method, params=None):
    ws.send(json.dumps({'id': number, 'method': method, 'params': params or {}}))
    while True:
        item = json.loads(ws.recv())
        if item.get('id') == number:
            if item.get('error'):
                raise RuntimeError(item['error'])
            return item.get('result', {})


def main():
    profile = f'/tmp/airmonlink-shutdown-benchmark-{PORT}'
    subprocess.run(['rm', '-rf', profile], check=False)
    proc = subprocess.Popen([
        CHROMIUM, '--headless', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
        f'--remote-debugging-port={PORT}', '--remote-allow-origins=*', f'--user-data-dir={profile}',
        '--window-size=1600,1000', 'about:blank'
    ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    ws = None
    try:
        page = wait_page()
        ws = websocket.create_connection(page['webSocketDebuggerUrl'], timeout=30, max_size=None)
        call(ws, 1, 'Runtime.enable')
        call(ws, 2, 'Page.enable')
        frame = call(ws, 3, 'Page.getFrameTree')['frameTree']['frame']['id']
        html = PREVIEW.read_text(encoding='utf-8')
        mock = '''<script>
window.__shutdownResponses=[];window.__shutdownRequestCallback=null;
window.airmonDesktop={
 onShutdownRequest(cb){window.__shutdownRequestCallback=cb;return()=>{}},
 onShutdownAbort(){return()=>{}}, respondToShutdown(p){window.__shutdownResponses.push(p)},
 updateDocumentState(){}, setSettings(p){return Promise.resolve(p)}, saveDocument(){return Promise.resolve({canceled:false,filePath:'benchmark.airscore'})}
};
</script>'''
        html = re.sub(r'<body([^>]*)>', lambda m: '<body'+m.group(1)+'>'+mock, html, count=1)
        call(ws, 4, 'Page.setDocumentContent', {'frameId': frame, 'html': html})
        for i in range(180):
            result = call(ws, 5+i, 'Runtime.evaluate', {'expression': "document.readyState+'|'+Boolean(document.querySelector('#notationCanvas svg'))", 'returnByValue': True})
            if result.get('result', {}).get('value', '').endswith('|true'):
                break
            time.sleep(.1)
        expr = """(async()=>{const start=performance.now();document.querySelector('#playButton').click();await new Promise(r=>setTimeout(r,40));await window.__shutdownRequestCallback({requestId:'shutdown-benchmark',reason:'window-close',decision:'discard'});const end=performance.now();const response=window.__shutdownResponses.at(-1);return {elapsedMs:Number((end-start).toFixed(3)),status:response?.status||null,stages:response?.diagnostics||[]};})()"""
        result = call(ws, 200, 'Runtime.evaluate', {'expression': expr, 'returnByValue': True, 'awaitPromise': True})
        value = result.get('result', {}).get('value')
        if not value or value.get('status') != 'approved':
            raise RuntimeError(f'Shutdown benchmark did not approve: {value}')
        print(json.dumps(value, indent=2))
        return 0
    finally:
        if ws:
            ws.close()
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()


if __name__ == '__main__':
    raise SystemExit(main())
