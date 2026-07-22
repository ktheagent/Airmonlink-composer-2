#!/usr/bin/env python3
"""Deterministic Airmonlink Composer browser smoke test using Chromium CDP."""
from __future__ import annotations
import base64, json, os, re, subprocess, sys, time, urllib.request
from pathlib import Path
try:
    import websocket
    def open_websocket(url: str):
        return websocket.create_connection(url, timeout=25, max_size=None)
except ModuleNotFoundError:
    # `websockets` is commonly preinstalled with Chromium test environments.
    # Keep the smoke test reproducible without requiring the unrelated
    # `websocket-client` package when the standards-based client is available.
    from websockets.sync.client import connect
    def open_websocket(url: str):
        return connect(url, open_timeout=25, max_size=None)

ROOT = Path(__file__).resolve().parents[1]
PREVIEW = ROOT / 'Airmonlink-Composer-Preview.html'
SCREENSHOT = ROOT / 'Airmonlink-Composer-Preview.png'
SOLFA_SCREENSHOT = ROOT / 'Airmonlink-Composer-Tonic-Solfa-Preview.png'
SOLFA_PDF = ROOT / 'Airmonlink-Composer-Tonic-Solfa-Print.pdf'
WIZARD_SCREENSHOT = ROOT / 'Airmonlink-Composer-New-Score-Wizard.png'
PARSER_SCREENSHOT = ROOT / 'Airmonlink-Composer-Tonic-Solfa-Parser.png'
CHROMIUM = os.environ.get('CHROMIUM', '/usr/bin/chromium')
PORT = int(os.environ.get('AIRMON_CDP_PORT', '9222'))

class Cdp:
    def __init__(self, url: str):
        self.ws = open_websocket(url)
        self.number = 0
        self.exceptions, self.console_errors = [], []
    def call(self, method: str, params: dict | None = None):
        self.number += 1; target = self.number
        self.ws.send(json.dumps({'id': target, 'method': method, 'params': params or {}}))
        while True:
            item = json.loads(self.ws.recv()); self._record(item)
            if item.get('id') == target:
                if item.get('error'): raise RuntimeError(f"{method}: {item['error']}")
                return item.get('result', {})
    def _record(self, item: dict):
        if item.get('method') == 'Runtime.exceptionThrown':
            d = item.get('params', {}).get('exceptionDetails', {})
            self.exceptions.append(d.get('exception', {}).get('description') or d.get('text', 'Unknown exception'))
        if item.get('method') == 'Runtime.consoleAPICalled' and item.get('params', {}).get('type') in ('error','warning'):
            args = item.get('params', {}).get('args', [])
            self.console_errors.append(' '.join(str(a.get('value') or a.get('description') or '') for a in args))
    def evaluate(self, expression: str, await_promise: bool = False):
        result = self.call('Runtime.evaluate', {'expression': expression, 'returnByValue': True, 'awaitPromise': await_promise}).get('result', {})
        if result.get('subtype') == 'error': raise RuntimeError(result.get('description', 'JavaScript evaluation failed'))
        return result.get('value')
    def close(self): self.ws.close()

def wait_page():
    for _ in range(150):
        try:
            pages = json.load(urllib.request.urlopen(f'http://127.0.0.1:{PORT}/json', timeout=1))
            page = next((p for p in pages if p.get('type') == 'page'), None)
            if page: return page
        except Exception: pass
        time.sleep(.1)
    raise RuntimeError('Chromium DevTools endpoint did not become available.')

def shot(cdp: Cdp, path: Path):
    data = cdp.call('Page.captureScreenshot', {'format':'png','captureBeyondViewport':False}).get('data')
    path.write_bytes(base64.b64decode(data))

def print_pdf(cdp: Cdp, path: Path):
    data = cdp.call('Page.printToPDF', {'printBackground':True, 'preferCSSPageSize':True}).get('data')
    path.write_bytes(base64.b64decode(data))
    return path.read_bytes()

def main():
    if not PREVIEW.exists(): raise RuntimeError('Run npm run preview first.')
    profile = f'/tmp/airmonlink-composer-smoke-{PORT}'
    subprocess.run(['rm','-rf',profile], check=False)
    proc = subprocess.Popen([CHROMIUM,'--headless','--no-sandbox','--disable-gpu','--disable-dev-shm-usage',f'--remote-debugging-port={PORT}','--remote-allow-origins=*',f'--user-data-dir={profile}','--window-size=1600,1000','about:blank'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    cdp = None
    try:
        page = wait_page(); cdp = Cdp(page['webSocketDebuggerUrl'])
        cdp.call('Runtime.enable'); cdp.call('Page.enable')
        frame = cdp.call('Page.getFrameTree')['frameTree']['frame']['id']
        html = PREVIEW.read_text(encoding='utf-8')
        shutdown_mock = '''<script>
window.__shutdownResponses=[];window.__shutdownRequestCallback=null;window.__shutdownAbortCallback=null;window.__documentStates=[];
window.airmonDesktop={
 onShutdownRequest(cb){window.__shutdownRequestCallback=cb;return()=>{window.__shutdownRequestCallback=null}},
 onShutdownAbort(cb){window.__shutdownAbortCallback=cb;return()=>{window.__shutdownAbortCallback=null}},
 respondToShutdown(payload){window.__shutdownResponses.push(payload)},
 updateDocumentState(payload){window.__documentStates.push(payload)},
 setSettings(payload){window.__shutdownSettings=payload;return Promise.resolve(payload)}
};
</script>'''
        html = re.sub(r'<body([^>]*)>', lambda m: '<body'+m.group(1)+'>'+shutdown_mock, html, count=1)
        cdp.call('Page.setDocumentContent', {'frameId':frame,'html':html})
        ready = ''
        for _ in range(180):
            ready = cdp.evaluate('document.readyState+"|"+Boolean(window.AirmonScoreModel)+"|"+Boolean(window.AirmonSolfaParser)+"|"+Boolean(document.querySelector("#notationCanvas svg"))')
            if ready.endswith('|true'): break
            time.sleep(.1)
        checks = {}
        add = lambda name, expr, await_promise=False: checks.__setitem__(name, bool(cdp.evaluate(expr, await_promise)))
        checks['application boot'] = ready.endswith('|true')
        add('performance diagnostics available', "Boolean(window.AirmonPerformance)&&typeof window.AirmonPerformance.snapshot==='function'")
        add('hidden heavy views are lazy at boot', "(()=>{const m=AirmonPerformance.snapshot();return m.fullScoreRenders>=1&&m.solfaRenders===0&&m.mixerRenders===0})()")
        add('selection uses fast score refresh', "(()=>{const before=AirmonPerformance.snapshot();const note=document.querySelector('.note-group[data-event-id]');if(!note)return false;note.dispatchEvent(new MouseEvent('click',{bubbles:true}));const after=AirmonPerformance.snapshot();return after.fullScoreRenders===before.fullScoreRenders&&after.fastScoreRefreshes>before.fastScoreRefreshes})()")
        add('fifteen menu groups including View', "document.querySelectorAll('.menu-tab').length===15&&Boolean(document.querySelector('[data-menu=viewMenu]'))")
        add('File Exit command', "Boolean(document.querySelector('#fileMenu [data-command=exit]'))")
        add('score renderer', "document.querySelectorAll('.note-group').length>0")
        add('exactly four layers', "document.querySelectorAll('#voiceLayerSelect option').length===4&&document.querySelectorAll('#layerButtons .layer-button').length===4")
        add('layer capacity inspector', "document.querySelectorAll('#layerCapacityInspector .capacity-row').length===4")
        add('symbol note palette', "document.querySelectorAll('#simpleEntryPalette [data-duration]').length>=8&&[...document.querySelectorAll('#simpleEntryPalette [data-duration]')].every(b=>Boolean(b.title||b.getAttribute('aria-label')))")
        add('official logo embedded', "[...document.querySelectorAll('img[alt*=Airmonlink]')].every(i=>i.src.startsWith('data:image/png;base64,'))")
        add('dedicated solfa page retained', "document.querySelectorAll('[data-command=solfaView]').length>=1&&Boolean(document.querySelector('#solfaPage'))&&Boolean(document.querySelector('#solfaContent'))")
        add('single public solfa feature', "document.querySelectorAll('[data-command=solfaCurwen],[data-command=solfaModern]').length===0")
        add('score unobstructed by right dock at startup', "document.querySelector('#rightDock').classList.contains('hidden')&&document.querySelector('[data-panel-toggle=composition]').getAttribute('aria-checked')==='false'&&document.querySelector('.workspace').classList.contains('right-dock-hidden')")
        add('Inspector hidden by default', "document.querySelector('#inspectorPanel').classList.contains('hidden')&&document.querySelector('[data-panel-toggle=inspector]').getAttribute('aria-checked')==='false'")
        add('Piano hidden by default', "document.querySelector('#pianoDock').classList.contains('hidden')&&document.querySelector('[data-panel-toggle=piano]').getAttribute('aria-checked')==='false'")
        add('View menu toggles Inspector without overlap', "(()=>{document.querySelector('[data-command=toggleInspector]').click();const shown=!document.querySelector('#inspectorPanel').classList.contains('hidden');const active=document.querySelector('[data-dock-tab=inspector]')?.classList.contains('active');const compositionHidden=document.querySelector('#compositionPanel').classList.contains('hidden');document.querySelector('[data-command=toggleInspector]').click();return shown&&active&&compositionHidden})()")
        add('Piano dock reduces workspace rather than overlays', "(()=>{const before=document.querySelector('.workspace').getBoundingClientRect().height;document.querySelector('[data-command=togglePianoPanel]').click();const dock=document.querySelector('#pianoDock');const after=document.querySelector('.workspace').getBoundingClientRect().height;const ok=!dock.classList.contains('hidden')&&after<before;document.querySelector('[data-command=togglePianoPanel]').click();return ok})()")
        add('Tonic panel does not replace dedicated page', "(()=>{document.querySelector('[data-command=toggleTonicPanel]').click();const panel=!document.querySelector('#tonicPanel').classList.contains('hidden');const page=Boolean(document.querySelector('#solfaPage'));document.querySelector('[data-command=toggleTonicPanel]').click();return panel&&page})()")
        add('workspace state sanitizer available', "Boolean(window.AirmonWorkspaceState)&&typeof AirmonWorkspaceState.sanitize==='function'&&AirmonWorkspaceState.layout({composition:true,rightWidth:900},{width:500,height:640}).effectiveRightCollapsed===true")
        cdp.evaluate("document.querySelector('[data-float-panel=composition]').click();true")
        cdp.call('Emulation.setDeviceMetricsOverride', {'width':500,'height':640,'deviceScaleFactor':1,'mobile':False})
        cdp.evaluate("window.dispatchEvent(new Event('resize'));true")
        time.sleep(.35)
        checks['compact viewport redocks and protects canvas'] = bool(cdp.evaluate("(()=>{const composition=document.querySelector('[data-dock-panel=composition]');const canvas=document.querySelector('#canvasScroll');const workspace=document.querySelector('.workspace');return !composition.classList.contains('floating')&&canvas&&canvas.getBoundingClientRect().width>=200&&getComputedStyle(workspace).display==='grid'})()"))
        cdp.call('Emulation.clearDeviceMetricsOverride')
        cdp.evaluate("window.dispatchEvent(new Event('resize'));true")
        time.sleep(.25)
        add('page sheets render from page-aware layout', "document.querySelectorAll('#notationCanvas .score-page-sheet').length>=1&&document.querySelectorAll('#notationCanvas .score-page-sheet').length===AirmonPerformance.snapshot().layoutPages")
        add('chord engraving collision helpers', "(()=>{const u=AirmonLayoutEngine.chordNoteheadOffsets([{id:'c',step:28},{id:'d',step:29},{id:'e',step:30}],true,7);const a=AirmonLayoutEngine.accidentalColumns([{id:'a',step:30,accidental:true},{id:'b',step:32,accidental:true}]);return u.c===0&&u.d===7&&u.e===0&&a.a!==a.b})()")
        add('selection optimization command exposed', "Boolean(document.querySelector('[data-command=optimizeSelection]'))&&[...document.querySelectorAll('[data-command=optimizeSelection]')].some(button=>button.closest('#compositionPanel'))")
        add('semantic page text controls exposed', "['measure-text','page-text','header-text','footer-text'].every(value=>Boolean(document.querySelector(`#anchoredTextType option[value='${value}']`)))")
        add('formal parser module', "Boolean(AirmonSolfaParser.parsePassage)&&Boolean(AirmonSolfaParser.symbolTable)&&Boolean(AirmonSolfaParser.convention('airmonlink-traditional-v1'))")
        add('versioned conventions', "Object.keys(AirmonSolfaParser.CONVENTIONS).includes('airmonlink-traditional-v1')&&Object.keys(AirmonSolfaParser.CONVENTIONS).includes('airmonlink-legacy-v0')")
        add('symbol table context rules', "AirmonSolfaParser.symbolTable().some(x=>x.symbol===',')&&AirmonSolfaParser.symbolTable().some(x=>x.symbol==='- / —')&&AirmonSolfaParser.symbolTable().some(x=>x.symbol==='|')")
        add('context-aware comma parsing', "(()=>{const p=AirmonSolfaParser.parsePassage(',d d, , d',{score:AirmonScoreModel.createScore({template:'lead',measures:2}),allowIncompleteMeasures:true});return p.events[0].octaveShift===-1&&p.events.some(e=>e.duration<1)})()")
        add('timed rests and continuations', "(()=>{const p=AirmonSolfaParser.parsePassage('d - 0 r',{score:AirmonScoreModel.createScore({template:'lead'}),allowIncompleteMeasures:true});return p.events.some(e=>e.rest)&&p.events[0].continuations.length===1&&p.events[0].duration>1})()")
        add('measure diagnostics include location', "(()=>{const p=AirmonSolfaParser.parsePassage('d',{score:AirmonScoreModel.createScore({template:'lead',timeSignature:'4/4'})});return p.diagnostics.some(d=>d.measure===1&&d.beat>=1&&d.voice===1)})()")
        add('compound meter capacity', "(()=>{const s=AirmonScoreModel.createScore({template:'lead',timeSignature:'6/8'});const p=AirmonSolfaParser.parsePassage('d. r. m. f. s. l.',{score:s});return p.measures[0].capacity===3&&p.measures[0].complete})()")
        add('movable and fixed pitch systems', "Boolean(AirmonSolfa.degreeInfoForPitch('C4','C major',{pitchSystem:'movable-do'}))&&Boolean(AirmonSolfa.degreeInfoForPitch('C4','C major',{pitchSystem:'fixed-do'}))")
        add('minor systems available', "Boolean(document.querySelector('#solfaMinorSystem option[value=do-based]'))&&Boolean(document.querySelector('#solfaMinorSystem option[value=la-based]'))")
        add('overlay controls complete', "Boolean(document.querySelector('#solfaOverlayPosition'))&&Boolean(document.querySelector('#solfaOverlayScope'))&&Boolean(document.querySelector('#solfaFontSize'))&&Boolean(document.querySelector('#solfaVerticalSpacing'))")
        add('overlay defaults optional', "!document.querySelector('#solfaOverlayToggle').checked&&document.querySelectorAll('.staff-solfa-overlay').length===0")
        add('above staff overlay', "(()=>{document.querySelector('[data-command=toggleSolfaOverlay]').click();const p=document.querySelector('#solfaOverlayPosition');p.value='above';p.dispatchEvent(new Event('change',{bubbles:true}));return document.querySelectorAll('.staff-solfa-overlay').length>0})()")
        add('below staff overlay', "(()=>{const p=document.querySelector('#solfaOverlayPosition');p.value='below';p.dispatchEvent(new Event('change',{bubbles:true}));return document.querySelectorAll('.staff-solfa-overlay').length>0})()")
        add('linked overlay selection', "(()=>{const x=document.querySelector('.staff-solfa-overlay[data-event-id]');if(!x)return false;x.dispatchEvent(new MouseEvent('click',{bubbles:true}));return Boolean(document.querySelector(`.note-group[data-event-id='${x.dataset.eventId}'].selected,.note-group[data-event-id='${x.dataset.eventId}'].multi-selected`))})()")
        add('editable publication heading', "document.querySelector('#pageTitle').isContentEditable&&document.querySelector('#pageComposer').isContentEditable")
        add('mixer renders only when opened', "(()=>{const before=AirmonPerformance.snapshot();document.querySelector('[data-command=mixerView]').click();const opened=AirmonPerformance.snapshot();document.querySelector('[data-command=scoreView]').click();return opened.mixerRenders>before.mixerRenders})()")
        add('staff labels excluded from solfa body', "(()=>{const before=AirmonPerformance.snapshot();document.querySelector('[data-command=solfaView]').click();const after=AirmonPerformance.snapshot();const t=document.querySelector('#solfaContent').textContent;return after.solfaRenders>before.solfaRenders&&!/(treble-L|bass-L|staff-\\d+-voice)/i.test(t)})()")
        add('solfa publication rendered', "document.querySelectorAll('#solfaContent .solfa-system').length>0&&document.querySelectorAll('#solfaContent .solfa-token').length>0")
        cdp.evaluate("document.body.classList.remove('high-contrast','reduced-motion');document.querySelectorAll('.toast').forEach(t=>t.remove());true")
        time.sleep(.3); shot(cdp, SOLFA_SCREENSHOT)
        pdf = print_pdf(cdp, SOLFA_PDF)
        checks['tonic solfa print produces PDF'] = pdf.startswith(b'%PDF-') and len(pdf) > 1000
        cdp.evaluate("document.querySelector('[data-command=scoreView]').click();if(document.querySelector('#solfaOverlayToggle').checked)document.querySelector('[data-command=toggleSolfaOverlay]').click();true")
        add('escape neutral layout mode', "(()=>{document.querySelector('[data-entry-mode=note]').click();document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));return document.body.classList.contains('layout-mode')&&document.querySelectorAll('.note-group.selected,.note-group.multi-selected').length===0})()")
        add('manual system and page break controls', "Boolean(document.querySelector('#measureNewSystem'))&&Boolean(document.querySelector('#measureNewPage'))")
        add('measure navigation controls', "Boolean(document.querySelector('[data-command=skipBackMeasures]'))&&Boolean(document.querySelector('[data-command=skipForwardMeasures]'))&&Boolean(document.querySelector('[data-command=goToMeasure]'))")
        add('copy layer and replace dialogs', "Boolean(document.querySelector('#copyLayerDialog'))&&Boolean(document.querySelector('#pasteReplaceDialog'))")
        add('MXL browser round trip', "(async()=>{const s=AirmonScoreModel.createScore({template:'lead',title:'Smoke'});AirmonScoreModel.addNote(s,s.parts[0].id,{midi:60,start:0,duration:1,lyric:'Sing'});const b=AirmonFormats.createMxl(s);const x=await AirmonFormats.extractMxlXml(b);return x.includes('<work-title>Smoke</work-title>')&&x.includes('<text>Sing</text>')})()", True)
        add('MXL Phase 2 semantic round trip', "(async()=>{const s=AirmonScoreModel.createScore({template:'lead',measures:3,title:'Compressed Phase Two',composer:'E. Writer',pickupBeats:1});s.parts[0].events=[];const n=AirmonScoreModel.addNote(s,s.parts[0].id,{midi:60,start:0,duration:1,voice:1});AirmonScoreModel.addChordTone(s,s.parts[0].id,n.id,64);AirmonScoreModel.setLyric(s,s.parts[0].id,n.id,'Glo',{verse:1,syllabic:'begin'});AirmonScoreModel.setLyric(s,s.parts[0].id,n.id,'Glory',{verse:2,melisma:true});AirmonScoreModel.addAnnotation(s,{text:'Page Two Header',type:'header-text',scope:'header',pageIndex:1,alignment:'center'});s.measures[2].newPage=true;const r=await AirmonFormats.parseMxl(AirmonFormats.createMxl(s));const notes=r.parts[0].events.filter(e=>e.type==='note'&&Math.abs(e.start)<1e-8);const header=r.annotations.find(a=>a.type==='header-text');return r.metadata.title==='Compressed Phase Two'&&r.metadata.composer==='E. Writer'&&r.settings.pickupBeats===1&&notes.length===2&&notes[0].chordId===notes[1].chordId&&notes.some(e=>e.lyrics?.length===2)&&header?.pageIndex===1&&r.measures[2].newPage})()", True)
        add('MusicXML page layout and print breaks', "(()=>{const xml=`<score-partwise version='4.0'><defaults><scaling><millimeters>7.05556</millimeters><tenths>40</tenths></scaling><page-layout><page-height>1584</page-height><page-width>1224</page-width><page-margins type='both'><left-margin>102</left-margin><right-margin>102</right-margin><top-margin>102</top-margin><bottom-margin>102</bottom-margin></page-margins></page-layout><system-layout><system-distance>400</system-distance></system-layout><staff-layout><staff-distance>340</staff-distance></staff-layout></defaults><part-list><score-part id='P1'><part-name>Voice</part-name></score-part></part-list><part id='P1'><measure number='1'><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes><note><rest/><duration>4</duration><voice>1</voice><type>whole</type></note></measure><measure number='2'><print new-system='yes'/><note><rest/><duration>4</duration><voice>1</voice><type>whole</type></note></measure><measure number='3'><print new-page='yes'/><note><rest/><duration>4</duration><voice>1</voice><type>whole</type></note></measure></part></score-partwise>`;const s=AirmonFormats.parseMusicXML(xml);const plan=AirmonLayoutEngine.buildSystemPlan(s,{staffX:120,availableWidth:2000,maxMeasures:8});const out=AirmonFormats.exportMusicXML(s);return s.settings.pageSize==='Letter'&&s.settings.orientation==='portrait'&&s.measures[1].newSystem&&s.measures[2].newPage&&plan.systems.length===3&&plan.systems[2].newPage&&out.includes('<defaults><scaling>')&&out.includes('new-page=\"yes\"')})()")
        add('MusicXML Phase 2 semantic import', """(()=>{const xml=`<?xml version="1.0"?><score-partwise version="4.0"><work><work-title>Phase Two Fixture</work-title></work><movement-title>Movement One</movement-title><identification><creator type="composer">Ama Composer</creator><creator type="lyricist">Kojo Poet</creator><rights>Copyright Test</rights><source>Archive Source</source><miscellaneous><miscellaneous-field name="composition-date">2026-07-21</miscellaneous-field></miscellaneous></identification><credit page="1"><credit-type>dedication</credit-type><credit-words>For the Choir</credit-words></credit><part-list><score-part id="P1"><part-name>Choir</part-name></score-part></part-list><part id="P1"><measure number="0" implicit="yes"><attributes><divisions>4</divisions><key><fifths>0</fifths><mode>major</mode></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes><direction placement="above"><direction-type><words>Allegro</words></direction-type><sound tempo="112"/></direction><harmony><root><root-step>C</root-step></root><kind text="C">major</kind></harmony><note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><type>quarter</type><lyric number="1"><syllabic>begin</syllabic><text>Hel</text></lyric><lyric number="2" xml:lang="en"><text>Praise</text><extend type="start"/></lyric></note></measure><measure number="1"><direction placement="above"><direction-type><rehearsal>A</rehearsal></direction-type></direction><direction placement="below"><direction-type><dynamics><mf/></dynamics></direction-type></direction><note><pitch><step>E</step><octave>4</octave></pitch><duration>16</duration><voice>1</voice><type>whole</type></note><note><chord/><pitch><step>G</step><octave>4</octave></pitch><duration>16</duration><voice>1</voice><type>whole</type></note><backup><duration>16</duration></backup><note><rest/><duration>16</duration><voice>2</voice><type>whole</type></note></measure></part></score-partwise>`;const s=AirmonFormats.parseMusicXML(xml);const notes=s.parts[0].events.filter(e=>e.type==='note');const chord=notes.filter(e=>Math.abs(e.start-1)<1e-8);return s.metadata.title==='Phase Two Fixture'&&s.metadata.composer==='Ama Composer'&&s.metadata.compositionDate==='2026-07-21'&&s.metadata.source==='Archive Source'&&s.settings.pickupBeats===1&&s.settings.tempo===112&&s.parts[0].events.some(e=>e.lyrics?.length===2&&e.lyrics[1].melisma)&&chord.length===2&&chord[0].chordId&&chord[0].chordId===chord[1].chordId&&s.annotations.some(a=>a.text==='Allegro')&&s.annotations.some(a=>a.type==='rehearsal')&&s.annotations.some(a=>a.type==='dynamics')&&s.chordSymbols.length===1&&s.importReport.lyricsImported===2&&s.importReport.textDirectionsImported>=3})()""")
        add('MusicXML semantic round trip preserves lyrics chords voices and credits', """(()=>{const s=AirmonScoreModel.createScore({template:'lead',measures:3,title:'Round Trip',composer:'A. Composer',compositionDate:'2026-07-21',source:'Archive',pickupBeats:1});s.parts[0].events=[];const n=AirmonScoreModel.addNote(s,s.parts[0].id,{midi:60,start:0,duration:1,voice:1});AirmonScoreModel.addChordTone(s,s.parts[0].id,n.id,64);AirmonScoreModel.setLyric(s,s.parts[0].id,n.id,'Hal',{verse:1,syllabic:'begin'});AirmonScoreModel.setLyric(s,s.parts[0].id,n.id,'Praise',{verse:2,melisma:true});AirmonScoreModel.addRest(s,s.parts[0].id,{start:1,duration:4,voice:2});AirmonScoreModel.addAnnotation(s,{text:'Cantabile',type:'staff-text',scope:'segment',start:1,partId:s.parts[0].id});s.measures[1].newSystem=true;s.measures[2].newPage=true;const xml=AirmonFormats.exportMusicXML(s);const r=AirmonFormats.parseMusicXML(xml);const notes=r.parts[0].events.filter(e=>e.type==='note'&&Math.abs(e.start)<1e-8);return r.metadata.title==='Round Trip'&&r.metadata.composer==='A. Composer'&&r.metadata.compositionDate==='2026-07-21'&&r.metadata.source==='Archive'&&r.settings.pickupBeats===1&&notes.length===2&&notes[0].chordId===notes[1].chordId&&notes.some(e=>e.lyrics?.length===2)&&r.parts[0].events.some(e=>e.voice===2&&e.type==='rest')&&r.annotations.some(a=>a.text==='Cantabile')&&r.measures[1].newSystem&&r.measures[2].newPage})()""")
        add('interval chord commands available', "Boolean(document.querySelector('[data-command=addIntervalAbove]'))&&Boolean(document.querySelector('[data-command=addIntervalBelow]'))&&AirmonMusicTheory.intervalSemitones('M3')===4&&AirmonMusicTheory.intervalSemitones('P5')===7")
        add('semantic chord model groups simultaneous pitches', "(()=>{const s=AirmonScoreModel.createScore({template:'lead',measures:2});s.parts[0].events=[];const n=AirmonScoreModel.addNote(s,s.parts[0].id,{midi:60,start:0,duration:1});AirmonScoreModel.addChordTone(s,s.parts[0].id,n.id,64);AirmonScoreModel.addChordTone(s,s.parts[0].id,n.id,67);const c=AirmonScoreModel.chordMembers(s,n.id);return c.length===3&&new Set(c.map(x=>x.chordId)).size===1&&c.every(x=>x.start===0&&x.duration===1)})()")
        add('pickup command preserves semantic timing', "(()=>{const s=AirmonScoreModel.createScore({template:'lead',measures:3,timeSignature:'4/4'});s.parts[0].events=[];AirmonScoreModel.addNote(s,s.parts[0].id,{midi:60,start:0,duration:1});const later=AirmonScoreModel.addNote(s,s.parts[0].id,{midi:64,start:4,duration:1});AirmonScoreModel.configurePickupMeasure(s,1);return s.settings.pickupBeats===1&&AirmonScoreModel.findEvent(s,later.id).event.start===1})()")
        add('anchored score text survives reflow data', "(()=>{const s=AirmonScoreModel.createScore({template:'lead'});const a=AirmonScoreModel.addAnnotation(s,{text:'dolce',type:'technique-text',scope:'segment',start:1,partId:s.parts[0].id});const x=AirmonScoreModel.normalizeScore(JSON.parse(JSON.stringify(s)));return x.annotations.some(i=>i.id===a.id&&i.start===1&&i.text==='dolce')})()")
        add('composition date and source metadata controls', "Boolean(document.querySelector('#metaCompositionDate'))&&Boolean(document.querySelector('#metaSource'))&&Boolean(document.querySelector('#newScoreForm [name=compositionDate]'))&&Boolean(document.querySelector('#newScoreForm [name=source]'))")
        add('import report dialog available', "Boolean(document.querySelector('#importReportDialog'))&&Boolean(document.querySelector('#importReportContent'))")
        add('barline split creates tie', "(()=>{const s=AirmonScoreModel.createScore({template:'lead',measures:3,timeSignature:'4/4'});const n=AirmonEditing.addNoteAcrossBarlines(s,s.parts[0].id,{midi:60,start:3,duration:3,voice:1});return n.length===2&&s.spanners.some(x=>x.type==='tie')})()")
        add('four-layer independent events', "(()=>{const s=AirmonScoreModel.createScore({template:'lead',autoFillRests:false});for(let v=1;v<=4;v++)AirmonScoreModel.addNote(s,s.parts[0].id,{midi:59+v,start:0,duration:1,voice:v});return new Set(s.parts[0].events.filter(e=>!e.rest).map(e=>e.voice)).size===4})()")
        add('recovery centre exists', "Boolean(document.querySelector('[data-command=recoveryCenter]'))&&Boolean(document.querySelector('#recoveryDialog'))")
        add('accessibility controls', "Boolean(document.querySelector('[data-command=highContrast]'))&&Boolean(document.querySelector('[data-command=reducedMotion]'))")
        add('command search', "(()=>{document.querySelector('#commandSearchButton').click();const ok=document.querySelector('#commandDialog').open;document.querySelector('#commandDialog').close();return ok})()")
        # Parser dialog and screenshot
        cdp.evaluate("document.querySelector('[data-command=solfaTranscription]').click();document.querySelector('#solfaSourceInput').value=`d r m f | s — : l t d'`;document.querySelector('#validateSolfaInput').click();true")
        time.sleep(.3)
        checks['transcription dialog opens'] = bool(cdp.evaluate("document.querySelector('#solfaTranscriptionDialog').open"))
        checks['parser preview and symbol table'] = bool(cdp.evaluate("document.querySelector('#solfaParsePreview').textContent.length>0&&document.querySelectorAll('#solfaSymbolTable > div').length>=7"))
        checks['parser dialog has no horizontal overflow'] = bool(cdp.evaluate("(()=>{const d=document.querySelector('#solfaTranscriptionDialog');const b=d.querySelector('.solfa-transcription-body');return d.scrollWidth<=d.clientWidth+1&&b.scrollWidth<=b.clientWidth+1})()"))
        shot(cdp, PARSER_SCREENSHOT)
        cdp.evaluate("document.querySelector('#solfaTranscriptionDialog').close();true")
        # Wizard and screenshot
        cdp.evaluate("document.querySelector('[data-command=new]').click();document.querySelector('#newScoreForm [name=title]').value='Accuracy Test Score';document.querySelector('#newScoreForm [name=title]').dispatchEvent(new Event('input',{bubbles:true}));true")
        time.sleep(.2)
        checks['guided score wizard'] = bool(cdp.evaluate("document.querySelector('#newScoreDialog').open&&document.querySelectorAll('[data-wizard-page]').length===4&&document.querySelector('#wizardPreviewTitle').textContent==='Accuracy Test Score'"))
        shot(cdp, WIZARD_SCREENSHOT)
        cdp.evaluate("document.querySelector('#newScoreDialog').close();document.querySelectorAll('.toast').forEach(t=>t.remove());true")
        time.sleep(.25); shot(cdp, SCREENSHOT)
        add('renderer shutdown registration', "typeof window.__shutdownRequestCallback==='function'&&window.__documentStates.length>0")
        add('playback and timers cleanly stop on shutdown', "(async()=>{document.querySelector('#playButton').click();await new Promise(r=>setTimeout(r,40));await window.__shutdownRequestCallback({requestId:'smoke-shutdown',reason:'window-close',decision:'discard'});const response=window.__shutdownResponses.at(-1);return response?.status==='approved'&&response.requestId==='smoke-shutdown'&&response.diagnostics.some(x=>x.stage==='playback-audio-stop'&&x.status==='completed')&&response.diagnostics.some(x=>x.stage==='midi-close')&&Boolean(window.__shutdownSettings)})()", True)
        checks['no runtime exceptions'] = not cdp.exceptions
        checks['no console errors'] = not cdp.console_errors
        failed = [k for k,v in checks.items() if not v]
        print(json.dumps({'checks':checks,'exceptions':cdp.exceptions,'console':cdp.console_errors,'screenshot':str(SCREENSHOT),'solfaScreenshot':str(SOLFA_SCREENSHOT),'solfaPdf':str(SOLFA_PDF),'wizardScreenshot':str(WIZARD_SCREENSHOT),'parserScreenshot':str(PARSER_SCREENSHOT)}, indent=2))
        return 1 if failed else 0
    finally:
        if cdp: cdp.close()
        proc.terminate()
        try: proc.wait(timeout=5)
        except subprocess.TimeoutExpired: proc.kill()

if __name__ == '__main__': sys.exit(main())
