(() => {
  'use strict';

  const theory = window.AirmonMusicTheory;
  const model = window.AirmonScoreModel;
  const layoutEngine = window.AirmonLayoutEngine;
  const lyricEngine = window.AirmonLyrics;
  const solfa = window.AirmonSolfa;
  const harmony = window.AirmonHarmony;
  const airscore = window.AirmonAirscore;
  const { HistoryManager } = window.AirmonHistory;
  const { SelectionModel, idsInRect } = window.AirmonSelection;
  const editing = window.AirmonEditing;
  const notations = window.AirmonNotations;
  const midi = window.AirmonMidiInput;
  const formats = window.AirmonFormats;
  const { PlaybackEngine } = window.AirmonPlayback;
  const workspaceState = window.AirmonWorkspaceState;
  const solfaLayout = window.AirmonSolfaLayout;

  const $ = selector => document.querySelector(selector);
  const $$ = selector => Array.from(document.querySelectorAll(selector));
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const EPSILON = 1e-8;
  const safeStorage = {
    getItem(key) { try { return window.localStorage?.getItem(key) ?? null; } catch (_) { return null; } },
    setItem(key, value) { try { window.localStorage?.setItem(key, String(value)); return true; } catch (_) { return false; } }
  };
  const state = {
    score: null,
    selectedPartId: null,
    selectedEventId: null,
    selectedSpannerId: null,
    selectedAnnotationId: null,
    selection: new SelectionModel(),
    clipboard: null,
    selectionMarquee: null,
    mode: 'note',
    duration: 1,
    activeVoice: 1,
    selectedMeasure: 0,
    currentView: 'score',
    zoom: 0.9,
    solfaFitMode: 'width',
    cursorBeat: 0,
    dirty: false,
    loop: false,
    loopStart: 0,
    loopEnd: null,
    playBeat: -1,
    filePath: null,
    readOnly: false,
    baselineChecksum: null,
    autosaveInFlight: false,
    harmonyAlternatives: [],
    history: new HistoryManager(160),
    playback: new PlaybackEngine(),
    layout: null,
    ghost: null,
    drag: null,
    lyricDrag: null,
    annotationDrag: null,
    publicationDrag: null,
    layoutTarget: null,
    suppressClickUntil: 0,
    workspace: 'beginner',
    panels: { composition: false, inspector: false, tonic: false, piano: false, playback: true, activeRight: null, rightCollapsed: true, floating: { composition: false, inspector: false, tonic: false }, rightWidth: 300, pianoHeight: 126 },
    panelResize: null,
    panelResizeTimer: null,
    pendingTextType: 'staff-text',
    activeMenu: null,
    menuTimer: null,
    lyricAssignmentPreview: null,
    lyricToolMode: null,
    midiAccess: null,
    midiStep: null,
    midiTransactionOpen: false,
    previewAudioNodes: new Set(),
    shutdown: { inProgress: false, approved: false, requestId: null, unsubscribe: null, stages: [] },
    metadataEditSnapshot: null,
    entryAccidental: null,
    performanceOrderIndex: 0,
    chordEntry: false,
    keypadFloating: false,
    keypadCollapsed: false,
    keypadDrag: null,
    wizardStep: 0,
    baselineRevision: null,
    checkpointRevision: null,
    performance: {
      scoreEpoch: 1,
      renderedScoreEpoch: -1,
      layoutSignature: '',
      renderIndex: null,
      renderIndexEpoch: -1,
      renderIndexLayout: '',
      signatures: Object.create(null),
      autosaveTimer: null,
      autosaveIdleHandle: null,
      autosaveInterval: null,
      domEventGroups: [],
      playActiveGroups: new Set(),
      maxDomDuration: 0,
      metrics: { fullScoreRenders: 0, fastScoreRefreshes: 0, solfaRenders: 0, mixerRenders: 0, autosaves: 0 }
    }
  };

  function init() {
    loadLocalPreferences();
    state.score = model.seedDemo(model.createScore({
      title: 'Airmonlink Choral Sketch', composer: 'John Dadzie', measures: 8, template: 'satb'
    }));
    state.score = model.normalizeScore(state.score);
    state.selectedPartId = state.score.parts[0]?.id || null;
    state.activeVoice = state.score.parts[0]?.activeVoice || 1;
    state.history.snapshot(state.score, 'Initial score');
    state.baselineChecksum = airscore.checksum(JSON.stringify(state.score));
    state.baselineRevision = state.score.revision || 0;
    window.AirmonPerformance = Object.freeze({
      snapshot: () => ({ ...state.performance.metrics, scoreEpoch: state.performance.scoreEpoch, renderedScoreEpoch: state.performance.renderedScoreEpoch, currentView: state.currentView, layoutPages: state.layout?.pages || 0 }),
      invalidateScore: reason => invalidateScoreRender(reason || 'external diagnostic')
    });
    state.workspace = safeStorage.getItem('airmon-workspace') || 'beginner';
    applyWorkspace(state.workspace);
    applyAccessibilityPreferences();
    document.body.classList.toggle('layer-colors-enabled', state.score.settings.entryLayerColors !== false);
    bindEvents();
    initializePanelSystem();
    initializeShutdownLifecycle();
    initializeNewScoreWizard();
    restoreEntryKeypadState();
    initializeMidiStep();
    buildPiano();
    renderAll();
    configurePlaybackCallbacks();
    setStatus('Ready — move over a staff to preview a note');
    initializeDocumentSession();
    initializeAssociatedFileOpening();
  }

  function configurePlaybackCallbacks() {
    state.playback.onPosition = beat => {
      state.playBeat = beat;
      state.cursorBeat = beat;
      updatePlaybackCursor();
    };
    state.playback.onStop = ({ beat } = {}) => {
      if (Number.isFinite(beat)) state.cursorBeat = clampCursor(beat);
      state.playBeat = -1;
      $('#playButton').textContent = '▶';
      updatePlaybackCursor();
      setStatus('Ready');
    };
  }

  function bindEvents() {
    buildFunctionalGroups();
    $('#newButton').addEventListener('click', () => openDialog('newScoreDialog'));
    $('#openButton').addEventListener('click', openProject);
    $('#saveButton').addEventListener('click', () => saveProject());
    $('#exportButton').addEventListener('click', () => openDialog('exportDialog'));
    $('#undoButton').addEventListener('click', undo);
    $('#redoButton').addEventListener('click', redo);
    $('#durationSelect').addEventListener('change', event => {
      state.duration = Number(event.target.value);
      state.ghost = null;
      renderScore();
      state.midiStep?.configure({ duration: state.duration });
      setStatus(`${theory.durationName(state.duration)} selected`);
    });
    $('#noteModeButton').addEventListener('click', () => setEntryMode('note'));
    $('#restModeButton').addEventListener('click', () => setEntryMode('rest'));
    $('#lyricsModeButton').addEventListener('click', () => setEntryMode('lyrics'));
    $('#voiceLayerSelect').addEventListener('change', event => setActiveVoice(Number(event.target.value)));
    $('#deleteButton').addEventListener('click', deleteSelected);
    $('#harmonizeButton').addEventListener('click', openHarmony);
    $('#solfaButton').addEventListener('click', () => setView('solfa'));
    $('#analyzeButton').addEventListener('click', inspectScore);
    $('#playButton').addEventListener('click', togglePlayback);
    $('#stopButton').addEventListener('click', () => state.playback.stop());
    $('#rewindButton').addEventListener('click', () => seekTo(0));
    $('#previousMeasureButton').addEventListener('click', () => navigateMeasure(-1));
    $('#nextMeasureButton').addEventListener('click', () => navigateMeasure(1));
    $('#skipBackMeasuresButton').addEventListener('click', () => skipMeasures(-1));
    $('#skipForwardMeasuresButton').addEventListener('click', () => skipMeasures(1));
    $('#goToMeasureButton').addEventListener('click', openGoToMeasure);
    $('#previousNoteButton').addEventListener('click', () => navigateNote(-1));
    $('#nextNoteButton').addEventListener('click', () => navigateNote(1));
    $('#previousBeatButton').addEventListener('click', () => navigateBeat(-1));
    $('#nextBeatButton').addEventListener('click', () => navigateBeat(1));
    $('#playbackSeek').addEventListener('input', event => seekTo(Number(event.target.value), true));
    $('#playbackSeek').addEventListener('change', event => seekTo(Number(event.target.value)));
    $('#loopButton').addEventListener('click', event => {
      state.loop = !state.loop;
      event.currentTarget.classList.toggle('active', state.loop);
      setStatus(state.loop ? 'Loop enabled' : 'Loop disabled');
    });
    $('#tempoInput').addEventListener('change', event => {
      checkpoint('Change tempo');
      state.score.settings.tempo = theory.clamp(Number(event.target.value) || 96, 30, 300);
      commit('Change tempo');
    });
    $('#themeButton').addEventListener('click', toggleTheme);
    $('#helpButton').addEventListener('click', () => openDialog('helpDialog'));
    $('#zoomSlider').addEventListener('input', event => setZoom(Number(event.target.value) / 100));
    $('#zoomOut').addEventListener('click', () => setZoom(state.zoom - .05));
    $('#zoomIn').addEventListener('click', () => setZoom(state.zoom + .05));
    $('#solfaFitWidth').addEventListener('click', () => applySolfaFit('width'));
    $('#solfaFitPage').addEventListener('click', () => applySolfaFit('page'));
    $('#solfaActualSize').addEventListener('click', () => applySolfaFit('actual'));
    $('#togglePiano').addEventListener('click', () => { $('#pianoDock').classList.toggle('collapsed'); persistPanelState(); });
    $('#connectMidiButton').addEventListener('click', connectMidiInput);
    $('#midiDeviceSelect').addEventListener('change', activateMidiDevice);
    $('#addPartButton').addEventListener('click', addPart);
    $('#insertMeasureButton').addEventListener('click', insertCurrentMeasure);
    $('#appendMeasureButton').addEventListener('click', appendMeasure);
    $('#measureSettingsButton').addEventListener('click', openMeasureSettings);
    $('#applyMeasureSettings').addEventListener('click', applyMeasureSettings);
    $('#closeInspector').addEventListener('click', () => closePanel('inspector'));
    $$('[data-dock-tab]').forEach(button => button.addEventListener('click', () => activateRightPanel(button.dataset.dockTab)));
    $$('[data-close-panel]').forEach(button => button.addEventListener('click', () => closePanel(button.dataset.closePanel)));
    $$('[data-float-panel]').forEach(button => button.addEventListener('click', () => togglePanelFloating(button.dataset.floatPanel)));
    $('#collapseRightDock').addEventListener('click', toggleRightDockCollapsed);
    $('#rightDockResizeHandle').addEventListener('pointerdown', beginRightDockResize);
    $('#pianoDockResizeHandle').addEventListener('pointerdown', beginPianoDockResize);
    $('#applyAnchoredText').addEventListener('click', applyAnchoredText);
    $('#applyPickup').addEventListener('click', applyPickupMeasure);
    $$('.nav-item').forEach(button => button.addEventListener('click', () => setView(button.dataset.view)));
    $('#applyInspector').addEventListener('click', applyInspector);
    $('#applyQuickLyric').addEventListener('click', applyQuickLyric);
    $('#quickLyricText').addEventListener('keydown', handleQuickLyricKeydown);
    $('#quickLyricVerse').addEventListener('change', event => {
      event.target.value = String(theory.clamp(Math.trunc(Number(event.target.value) || 1), 1, 24));
      // Verse is lane metadata. Changing it must never mutate or prefix lyric text.
      renderInspector();
      setStatus(`Verse ${event.target.value} selected. Typed text will be stored separately from the verse number.`);
    });
    $('#previousLyricNote').addEventListener('click', () => navigateLyricNote(-1));
    $('#nextLyricNote').addEventListener('click', () => navigateLyricNote(1));
    $('#quickLyricAutoAdvance').addEventListener('change', event => { checkpoint('Toggle lyric auto advance'); state.score.settings.lyricAutoAdvance = event.target.checked; model.touch(state.score); commit('Toggle lyric auto advance'); setStatus(`Lyric auto-advance ${event.target.checked ? 'enabled' : 'disabled'}.`); });
    $('#removeInspector').addEventListener('click', deleteSelected);
    $('#applyProperties').addEventListener('click', applyProperties);
    $('#createScoreButton').addEventListener('click', createNewScore);
    $('#wizardBack').addEventListener('click', () => setWizardStep(state.wizardStep - 1));
    $('#wizardNext').addEventListener('click', advanceNewScoreWizard);
    $$('[data-wizard-step]').forEach(button => button.addEventListener('click', () => setWizardStep(Number(button.dataset.wizardStep))));
    $$('[data-time-signature]').forEach(button => button.addEventListener('click', () => { $('#newScoreForm [name="timeSignature"]').value = button.dataset.timeSignature; updateNewScoreWizard(); }));
    $('#newScoreForm').addEventListener('input', updateNewScoreWizard);
    $('#newScoreForm').addEventListener('change', updateNewScoreWizard);
    $('#entryKeypadFloatButton').addEventListener('click', toggleEntryKeypadFloating);
    $('#entryKeypadCollapseButton').addEventListener('click', toggleEntryKeypadCollapsed);
    $('#entryKeypadHandle').addEventListener('pointerdown', beginEntryKeypadDrag);
    $$('.composition-groups details').forEach(group => group.addEventListener('toggle', () => {
      if (!group.open) return;
      $$('.composition-groups details').forEach(other => { if (other !== group) other.open = false; });
    }));
    $$('.template-card input').forEach(input => input.addEventListener('change', () => {
      $$('.template-card').forEach(card => card.classList.toggle('selected', card.querySelector('input').checked));
      updateNewScoreWizard();
    }));
    $$('[data-close-dialog]').forEach(button => button.addEventListener('click', () => closeDialog(button.dataset.closeDialog)));
    $('#generateHarmony').addEventListener('click', generateHarmonyAlternatives);
    $$('[data-export]').forEach(button => button.addEventListener('click', () => exportAs(button.dataset.export)));
    $('#webFileInput').addEventListener('change', handleWebFile);
    $('#commandSearchButton').addEventListener('click', openCommandSearch);
    $('#commandSearchInput').addEventListener('input', renderCommandSearch);
    $('#workspaceSelect').addEventListener('change', event => applyWorkspace(event.target.value));
    $('#solfaModeSelect').value = 'traditional';
    $('#solfaLabelSelect').addEventListener('change', event => updateSolfaSettings({ solfaMode: 'traditional', solfaLabels: event.target.value }));
    $$('#simpleEntryPalette [data-entry-mode]').forEach(button => button.addEventListener('click', () => setEntryMode(button.dataset.entryMode)));
    $$('#simpleEntryPalette [data-duration]').forEach(button => button.addEventListener('click', () => {
      state.duration = Number(button.dataset.duration);
      $('#durationSelect').value = String(state.duration);
      state.ghost = null;
      renderScore(); renderStatusBar();
      setStatus(`${theory.durationName(state.duration)} selected in Simple Entry.`);
    }));
    $('#solfaLyricsToggle').addEventListener('change', event => updateSolfaSettings({ solfaShowLyrics: event.target.checked }));
    $('#solfaRhythmToggle').addEventListener('change', event => updateSolfaSettings({ solfaShowRhythm: event.target.checked }));
    $('#solfaVoiceLabelsToggle').addEventListener('change', event => updateSolfaSettings({ solfaShowVoiceLabels: event.target.checked }, { remainInView: true }));
    $('#solfaEmptyLayersToggle').addEventListener('change', event => updateSolfaSettings({ solfaShowEmptyLayers: event.target.checked }, { remainInView: true }));
    $('#solfaOverlayToggle').addEventListener('change', event => updateSolfaSettings({ showSolfa: event.target.checked }, { scoreView: true }));
    $('#solfaOverlayPosition').addEventListener('change', event => updateSolfaSettings({ solfaOverlayPosition: event.target.value }, { scoreView: true }));
    $('#solfaOverlayScope').addEventListener('change', event => updateSolfaSettings({ solfaOverlayScope: event.target.value }, { scoreView: true }));
    $('#solfaPitchSystem').addEventListener('change', event => updateSolfaSettings({ solfaPitchSystem: event.target.value }, { remainInView: true }));
    $('#solfaMinorSystem').addEventListener('change', event => updateSolfaSettings({ minorSolfaSystem: event.target.value }, { remainInView: true }));
    $('#solfaFontSize').addEventListener('change', event => updateSolfaSettings({ solfaFontSize: theory.clamp(Number(event.target.value) || 8, 6, 18) }, { scoreView: true }));
    $('#solfaVerticalSpacing').addEventListener('change', event => updateSolfaSettings({ solfaVerticalSpacing: theory.clamp(Number(event.target.value) || 12, 4, 40) }, { scoreView: true }));
    $('#solfaOctaveToggle').addEventListener('change', event => updateSolfaSettings({ solfaShowOctaveMarks: event.target.checked }, { remainInView: true }));
    $('#solfaWarningsToggle').addEventListener('change', event => updateSolfaSettings({ solfaShowWarnings: event.target.checked }, { remainInView: true }));
    $('#toggleCurrentStaffSolfa').addEventListener('click', toggleCurrentStaffSolfa);
    $('#openSolfaTranscription').addEventListener('click', openSolfaTranscription);
    $('#validateSolfaInput').addEventListener('click', validateSolfaInput);
    $('#applySolfaInput').addEventListener('click', applySolfaInput);
    $('#applyCopyLayer').addEventListener('click', applyCopyToLayer);
    $('#applyPasteReplace').addEventListener('click', applyPasteReplace);
    $('#applyGoMeasure').addEventListener('click', applyGoToMeasure);
    $$('#simpleEntryPalette [data-layer]').forEach(button => button.addEventListener('click', () => setActiveVoice(Number(button.dataset.layer))));
    $$('[data-meta-field]').forEach(element => { element.addEventListener('focus', beginMetadataEdit); element.addEventListener('blur', commitMetadataEdit); element.addEventListener('pointerdown', event => beginPublicationDrag(event, element)); element.addEventListener('keydown', event => { if (event.key === 'Enter' && element.tagName !== 'P') { event.preventDefault(); element.blur(); } }); });
    $$('[data-header-edit]').forEach(button => button.addEventListener('click', () => editHeaderMusicalSetting(button.dataset.headerEdit)));
    $('#previewLyricsButton').addEventListener('click', previewPastedLyrics);
    $('#commitLyricsButton').addEventListener('click', commitPastedLyrics);
    $('#applyLyricTool').addEventListener('click', applyLyricTool);
    bindMenuSystem();
    window.addEventListener('keydown', handleKeyboard);
    window.addEventListener('resize', () => {
      clearTimeout(state.panelResizeTimer);
      state.panelResizeTimer = setTimeout(() => {
        const previous = JSON.stringify(state.panels);
        state.panels = sanitizePanelState(state.panels);
        applyPanelState({ persist: previous !== JSON.stringify(state.panels), render: false });
        if (state.currentView === 'score') renderScore();
        else if (state.currentView === 'solfa' && state.solfaFitMode !== 'manual') applySolfaFit(state.solfaFitMode);
      }, 120);
    });
    window.addEventListener('pointermove', event => { updateEntryKeypadDrag(event); updatePanelResize(event); if (!updatePublicationDrag(event) && !updateAnnotationDrag(event)) handleGlobalPointerMove(event); });
    window.addEventListener('pointerup', event => { finishEntryKeypadDrag(event); finishPanelResize(event); finishPublicationDrag(event); finishAnnotationDrag(event); finishMarquee(event); finishLyricDrag(event); finishDrag(event); });
    window.addEventListener('beforeunload', event => {
      // Electron shutdown is coordinated explicitly by the main process. The browser preview keeps the standard warning.
      if (!window.airmonDesktop && state.dirty && !state.shutdown.approved) {
        event.preventDefault();
        event.returnValue = '';
      }
    });
    state.performance.autosaveInterval = setInterval(() => scheduleAutosave(), 60000);
  }


  const commandCatalog = [
    ['new', 'New score', 'File'], ['open', 'Open project', 'File'], ['save', 'Save project', 'File'], ['saveAs', 'Save As', 'File'], ['recoveryCenter', 'Recovery Centre', 'File'], ['export', 'Export score', 'File'], ['exit', 'Exit Airmonlink Composer', 'File'],
    ['toggleCompositionPanel', 'Composition Notepad', 'View'], ['toggleInspector', 'Inspector', 'View'], ['togglePianoPanel', 'Piano Input', 'View'], ['toggleTonicPanel', 'Tonic Solfa panel', 'View'], ['togglePlaybackControls', 'Playback controls', 'View'], ['resetWorkspace', 'Reset Workspace Layout', 'View'],
    ['undo', 'Undo', 'Home'], ['redo', 'Redo', 'Home'], ['cut', 'Cut selection', 'Home'], ['copy', 'Copy selection', 'Home'], ['paste', 'Paste', 'Home'], ['copyToLayer', 'Copy selection to another layer', 'Home'], ['pasteReplace', 'Paste and replace selected passage', 'Home'], ['selectAllEvents', 'Select all events in active part', 'Home'], ['delete', 'Delete selection', 'Home'], ['inspect', 'Music Inspector', 'Home'],
    ['noteMode', 'Note entry mode', 'Note Input'], ['restMode', 'Rest entry mode', 'Note Input'], ['toggleChordEntry', 'Toggle chord-entry mode', 'Note Input'], ['toggleEntryKeypad', 'Float or dock the symbol keypad', 'Note Input'], ['duplicateSelection', 'Duplicate selected event', 'Note Input'],
    ['transposeUp', 'Transpose selected note up', 'Note Input'], ['transposeDown', 'Transpose selected note down', 'Note Input'], ['addIntervalAbove', 'Add interval above selected note', 'Note Input'], ['addIntervalBelow', 'Add interval below selected note', 'Note Input'],
    ['lyricsMode', 'Lyrics mode', 'Text and Lyrics'], ['pasteLyrics', 'Paste complete lyrics', 'Text and Lyrics'], ['copyVerse', 'Copy lyric verse', 'Text and Lyrics'], ['lyricSearch', 'Search and replace lyrics', 'Text and Lyrics'], ['resetLyricPosition', 'Reset lyric position', 'Text and Lyrics'],
    ['tie', 'Tie selected notes', 'Notations'], ['slur', 'Slur selected phrase', 'Notations'], ['removeTie', 'Remove tie', 'Notations'], ['removeSlur', 'Remove slur', 'Notations'], ['flipTie', 'Flip tie', 'Notations'], ['flipSlur', 'Flip slur', 'Notations'], ['resetSpanners', 'Reset tie and slur position', 'Notations'], ['articulationStaccato', 'Toggle staccato', 'Notations'], ['articulationTenuto', 'Toggle tenuto', 'Notations'], ['articulationAccent', 'Toggle accent', 'Notations'], ['articulationMarcato', 'Toggle marcato', 'Notations'], ['articulationFermata', 'Toggle fermata', 'Notations'], ['measureSettings', 'Measure settings', 'Notations'], ['insertMeasure', 'Insert measure before', 'Notations'], ['insertMeasureAfter', 'Insert measure after', 'Notations'], ['appendMeasure', 'Append measure', 'Notations'], ['deleteMeasure', 'Delete current measure', 'Notations'], ['configurePickup', 'Create or configure pickup measure', 'Rhythm and Measures'], ['addStaffText', 'Add staff text', 'Text'], ['addSystemText', 'Add system text', 'Text'], ['addRehearsalText', 'Add rehearsal mark', 'Text'], ['scoreProperties', 'Score metadata and properties', 'Text'], ['optimizeCurrentSystem', 'Optimize current system', 'Layout'], ['optimizeSelection', 'Optimize selected passage', 'Layout'], ['optimizeScore', 'Optimize complete score', 'Layout'],
    ['harmonize', 'Harmonize selection', 'Harmony and Composition'], ['solfaView', 'Open Tonic Sol-fa', 'Tonic Sol-fa'], ['toggleSolfaOverlay', 'Show or hide tonic sol-fa on staff', 'Tonic Sol-fa'], ['solfaTranscription', 'Tonic Sol-fa transcription and validation', 'Tonic Sol-fa'], ['toggleCurrentStaffSolfa', 'Toggle tonic sol-fa for current staff', 'Tonic Sol-fa'], ['toggleSolfaVoiceLabels', 'Show or hide S A T B margin labels', 'Tonic Sol-fa'], ['editSelectedSolfa', 'Edit selected note as tonic sol-fa', 'Tonic Sol-fa'],
    ['addPart', 'Add instrument or staff', 'Instruments and Staves'], ['playPause', 'Play or Pause', 'Playback'], ['stop', 'Stop playback', 'Playback'], ['previousBeat', 'Previous beat', 'Playback'], ['nextBeat', 'Next beat', 'Playback'], ['previousMeasure', 'Previous measure', 'Playback'], ['nextMeasure', 'Next measure', 'Playback'], ['skipBackMeasures', 'Skip backward several measures', 'Playback'], ['skipForwardMeasures', 'Skip forward several measures', 'Playback'], ['goToMeasure', 'Go to measure', 'Playback'], ['toggleLoop', 'Toggle loop', 'Playback'], ['setLoopStart', 'Set loop start', 'Playback'], ['setLoopEnd', 'Set loop end', 'Playback'], ['clearLoopRange', 'Clear loop range', 'Playback'],
    ['fullScreen', 'Full-screen score', 'Layout'], ['increaseStaffSpacing', 'Expand staff spacing', 'Layout'], ['decreaseStaffSpacing', 'Reduce staff spacing', 'Layout'], ['increaseSystemSpacing', 'Expand system spacing', 'Layout'], ['decreaseSystemSpacing', 'Reduce system spacing', 'Layout'], ['resetScoreSpacing', 'Reset score spacing', 'Layout'], ['toggleLeftPanel', 'Toggle score panel', 'Layout'], ['toggleInspector', 'Toggle Inspector', 'Layout'], ['resetWorkspace', 'Reset workspace layout', 'Layout'], ['highContrast', 'Toggle high contrast', 'Accessibility'], ['reducedMotion', 'Toggle reduced motion', 'Accessibility'],
    ['scoreView', 'Staff notation view', 'Parts'], ['mixerView', 'Mixer view', 'Parts'], ['soloActivePart', 'Solo active part', 'Parts'],
    ['exportMusicXml', 'Export MusicXML', 'Export'], ['exportMxl', 'Export compressed MusicXML', 'Export'], ['exportMidi', 'Export MIDI', 'Export'], ['exportSolfa', 'Export tonic sol-fa text', 'Export'], ['print', 'Print or PDF', 'Export'],
    ['help', 'Help', 'Help'], ['about', 'About Airmonlink Composer', 'Help']
  ];

  const functionalGroupDefinitions = [
    ['FILE AND PROJECT', ['new','open','save','saveAs','recoveryCenter','exit']],
    ['SELECTION AND CLIPBOARD', ['undo','redo','cut','copy','paste','pasteReplace','duplicateSelection','selectAllEvents','delete','inspect']],
    ['NOTE ENTRY', ['noteMode','restMode','toggleChordEntry','toggleEntryKeypad']],
    ['PITCH AND TONALITY', ['transposeUp','transposeDown','addIntervalAbove','addIntervalBelow','measureSettings']],
    ['RHYTHM AND MEASURES', ['configurePickup','insertMeasure','insertMeasureAfter','appendMeasure','deleteMeasure']],
    ['VOICES AND LAYERS', ['copyToLayer','soloActivePart']],
    ['ARTICULATIONS AND EXPRESSION', ['articulationStaccato','articulationTenuto','articulationAccent','articulationMarcato','articulationFermata']],
    ['TIES SLURS AND SPANNERS', ['tie','slur','removeTie','removeSlur','flipTie','flipSlur','resetSpanners']],
    ['LYRICS AND TEXT', ['lyricsMode','pasteLyrics','copyVerse','lyricSearch','resetLyricPosition','addStaffText','addSystemText','addRehearsalText','scoreProperties']],
    ['HARMONY AND CHORDS', ['harmonize','toggleChordEntry','addIntervalAbove','addIntervalBelow']],
    ['STAFF AND INSTRUMENTS', ['addPart','scoreView','mixerView','toggleLeftPanel','toggleInspector']],
    ['TONIC SOLFA', ['solfaView','toggleSolfaOverlay','solfaTranscription','toggleCurrentStaffSolfa','toggleSolfaVoiceLabels','editSelectedSolfa']],
    ['LAYOUT AND PAGES', ['fullScreen','increaseStaffSpacing','decreaseStaffSpacing','increaseSystemSpacing','decreaseSystemSpacing','resetScoreSpacing','optimizeCurrentSystem','optimizeSelection','optimizeScore','resetWorkspace']],
    ['PLAYBACK', ['playPause','stop','previousBeat','nextBeat','previousMeasure','nextMeasure','skipBackMeasures','skipForwardMeasures','goToMeasure','toggleLoop','setLoopStart','setLoopEnd','clearLoopRange','togglePlaybackControls']],
    ['IMPORT AND EXPORT', ['export','exportMusicXml','exportMxl','exportMidi','exportSolfa','print']],
    ['ACCESSIBILITY AND VIEW', ['toggleCompositionPanel','toggleInspector','togglePianoPanel','toggleTonicPanel','highContrast','reducedMotion','help','about']]
  ];

  function buildFunctionalGroups() {
    const container = $('.composition-groups');
    if (!container || container.dataset.generated === 'true') return;
    const keypad = $('#entryKeypadWindow');
    const catalog = new Map(commandCatalog.map(([name, label, category]) => [name, { label, category }]));
    container.innerHTML = '';
    functionalGroupDefinitions.forEach(([name, commands], groupIndex) => {
      const details = document.createElement('details'); details.dataset.functionGroup = name; details.open = groupIndex === 2;
      const summary = document.createElement('summary'); summary.textContent = name; summary.title = name; summary.tabIndex = 0; details.appendChild(summary);
      if (name === 'NOTE ENTRY' && keypad) details.appendChild(keypad);
      const grid = document.createElement('div'); grid.className = 'composition-command-grid';
      [...new Set(commands)].forEach(command => {
        const entry = catalog.get(command); if (!entry) return;
        const button = document.createElement('button'); button.type = 'button'; button.dataset.command = command; button.textContent = entry.label; button.title = `${entry.label} — ${name}`; button.setAttribute('aria-label', `${entry.label}, ${name}`); grid.appendChild(button);
      });
      details.appendChild(grid); container.appendChild(details);
    });
    container.dataset.generated = 'true';
  }

  function executeCommand(name) {
    if (state.shutdown.inProgress && name !== 'exit') return;
    closeCommandMenus();
    const actions = {
      new: openNewScoreWizard, open: openProject, save: () => saveProject(false), saveAs: () => saveProject(true), recoveryCenter: openRecoveryCenter, export: () => openDialog('exportDialog'), exit: requestApplicationExit,
      toggleCompositionPanel: () => togglePanel('composition'), toggleInspector: () => togglePanel('inspector'), togglePianoPanel: () => togglePanel('piano'), toggleTonicPanel: () => togglePanel('tonic'), togglePlaybackControls: () => togglePanel('playback'),
      undo, redo, cut: cutSelection, copy: copySelection, paste: pasteSelection, copyToLayer: openCopyLayerDialog, pasteReplace: openPasteReplaceDialog, selectAllEvents, delete: deleteSelected, inspect: inspectScore,
      noteMode: () => setEntryMode('note'), restMode: () => setEntryMode('rest'), eraserMode: () => setEntryMode('eraser'), lyricsMode: () => setEntryMode('lyrics'), toggleChordEntry, toggleEntryKeypad: toggleEntryKeypadFloating,
      duplicateSelection: duplicateSelected, transposeUp: () => transposeSelected(1), transposeDown: () => transposeSelected(-1), addIntervalAbove: () => addIntervalToSelection(1), addIntervalBelow: () => addIntervalToSelection(-1), dotDuration: () => setDottedDuration(1), doubleDotDuration: () => setDottedDuration(2), accidentalSharp: () => applyAccidentalCommand(1), accidentalFlat: () => applyAccidentalCommand(-1), accidentalNatural: () => applyAccidentalCommand(0),
      pasteLyrics: openPasteLyrics, copyVerse: () => openLyricTool('copy'), lyricSearch: () => openLyricTool('search'), resetLyricPosition,
      tie: createTieCommand, slur: createSlurCommand, removeTie: () => removeSpannerCommand('tie'), removeSlur: () => removeSpannerCommand('slur'), flipTie: () => flipSpannerCommand('tie'), flipSlur: () => flipSpannerCommand('slur'), resetSpanners: resetSpannerCommand, articulationStaccato: () => toggleArticulationCommand('staccato'), articulationTenuto: () => toggleArticulationCommand('tenuto'), articulationAccent: () => toggleArticulationCommand('accent'), articulationMarcato: () => toggleArticulationCommand('strong-accent'), articulationFermata: () => toggleArticulationCommand('fermata'),
      measureSettings: openMeasureSettings, insertMeasure: insertCurrentMeasure, insertMeasureAfter, appendMeasure, deleteMeasure: deleteCurrentMeasure,
      configurePickup: openPickupDialog, addStaffText: () => openAnchoredTextDialog('staff-text'), addSystemText: () => openAnchoredTextDialog('system-text'), addRehearsalText: () => openAnchoredTextDialog('rehearsal'), scoreProperties: () => openPanel('inspector'), optimizeCurrentSystem: () => optimizeScoreLayout('system'), optimizeSelection: () => optimizeScoreLayout('selection'), optimizeScore: () => optimizeScoreLayout('score'),
      harmonize: openHarmony, solfaView: () => setView('solfa'), toggleSolfaOverlay, solfaTranscription: openSolfaTranscription, toggleCurrentStaffSolfa, toggleSolfaVoiceLabels, editSelectedSolfa,
      addPart, playPause: togglePlayback, stop: () => state.playback.stop(), previousBeat: () => navigateBeat(-1), nextBeat: () => navigateBeat(1), previousMeasure: () => navigateMeasure(-1), nextMeasure: () => navigateMeasure(1), skipBackMeasures: () => skipMeasures(-1), skipForwardMeasures: () => skipMeasures(1), goToMeasure: openGoToMeasure,
      toggleLoop: () => $('#loopButton').click(), setLoopStart, setLoopEnd, clearLoopRange, fullScreen: toggleFullScreenScore, increaseStaffSpacing: () => adjustScoreSpacing('staffGap', 6), decreaseStaffSpacing: () => adjustScoreSpacing('staffGap', -6), increaseSystemSpacing: () => adjustScoreSpacing('systemGap', 8), decreaseSystemSpacing: () => adjustScoreSpacing('systemGap', -8), resetScoreSpacing, toggleLeftPanel: () => $('.left-panel').classList.toggle('hidden'), resetWorkspace, highContrast: () => toggleAccessibility('high-contrast'), reducedMotion: () => toggleAccessibility('reduced-motion'),
      scoreView: () => setView('score'), mixerView: () => setView('mixer'), soloActivePart,
      exportMusicXml: () => exportAs('musicxml'), exportMxl: () => exportAs('mxl'), exportMidi: () => exportAs('midi'), exportSolfa: () => exportAs('solfa'), print: () => exportAs('print'),
      help: () => openDialog('helpDialog'), about: () => openDialog('aboutDialog')
    };
    const action = actions[name];
    if (action) action();
    else toast(`Command is not available: ${name}`, 'error');
  }

  function bindMenuSystem() {
    const directIds = new Set(['noteModeButton','restModeButton','lyricsModeButton','measureSettingsButton','insertMeasureButton','appendMeasureButton','harmonizeButton','solfaButton','exportButton','deleteButton','analyzeButton']);
    $$('.menu-tab').forEach(button => {
      button.addEventListener('click', event => { event.stopPropagation(); toggleCommandMenu(button.dataset.menu, button); });
      button.addEventListener('pointerenter', () => {
        clearTimeout(state.menuTimer);
        state.menuTimer = setTimeout(() => { if (state.activeMenu) openCommandMenu(button.dataset.menu, button); }, 180);
      });
      button.addEventListener('keydown', event => {
        if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openCommandMenu(button.dataset.menu, button); document.querySelector(`#${button.dataset.menu} button`)?.focus(); }
        if (event.key === 'Escape') closeCommandMenus();
      });
    });
    $$('.command-popover').forEach(panel => {
      panel.addEventListener('pointerenter', () => clearTimeout(state.menuTimer));
      panel.addEventListener('pointerleave', () => { state.menuTimer = setTimeout(closeCommandMenus, 260); });
    });
    $$('[data-command]').forEach(element => {
      if (element.id && directIds.has(element.id)) return;
      element.addEventListener('click', event => { event.preventDefault(); executeCommand(element.dataset.command); });
    });
    document.addEventListener('click', event => { if (!event.target.closest('.professional-nav')) closeCommandMenus(); });
  }

  function toggleCommandMenu(id, button) { if (state.activeMenu === id) closeCommandMenus(); else openCommandMenu(id, button); }
  function openCommandMenu(id, button) {
    closeCommandMenus();
    const panel = document.getElementById(id); if (!panel) return;
    panel.classList.add('open');
    const width = panel.getBoundingClientRect().width || 260;
    panel.style.left = `${Math.max(8, Math.min(button.offsetLeft, window.innerWidth - width - 12))}px`;
    button.classList.add('active'); button.setAttribute('aria-expanded', 'true'); state.activeMenu = id;
  }
  function closeCommandMenus() {
    $$('.command-popover.open').forEach(panel => panel.classList.remove('open'));
    $$('.menu-tab.active').forEach(button => { button.classList.remove('active'); button.setAttribute('aria-expanded', 'false'); });
    state.activeMenu = null;
  }

  function openCommandSearch() { openDialog('commandDialog'); $('#commandSearchInput').value = ''; renderCommandSearch(); setTimeout(() => $('#commandSearchInput').focus(), 20); }
  function renderCommandSearch() {
    const query = String($('#commandSearchInput').value || '').trim().toLowerCase();
    const matches = commandCatalog.filter(([, label, group]) => !query || `${label} ${group}`.toLowerCase().includes(query)).slice(0, 30);
    const container = $('#commandSearchResults');
    container.innerHTML = matches.map(([name, label, group]) => `<button class="command-result" data-search-command="${escapeHtml(name)}"><span><strong>${escapeHtml(label)}</strong><br><small>${escapeHtml(group)}</small></span><small>Run ↵</small></button>`).join('') || '<div class="inspector-empty">No matching commands.</div>';
    container.querySelectorAll('[data-search-command]').forEach(button => button.addEventListener('click', () => { closeDialog('commandDialog'); executeCommand(button.dataset.searchCommand); }));
  }

  function applyWorkspace(value) {
    state.workspace = value === 'advanced' ? 'advanced' : 'beginner';
    document.body.classList.toggle('workspace-beginner', state.workspace === 'beginner');
    document.body.classList.toggle('workspace-advanced', state.workspace === 'advanced');
    safeStorage.setItem('airmon-workspace', state.workspace);
    if ($('#workspaceSelect')) $('#workspaceSelect').value = state.workspace;
    window.airmonDesktop?.setSettings?.({ workspace: state.workspace }).catch(() => {});
  }

  function panelViewport() { return { width: window.innerWidth, height: window.innerHeight }; }

  function defaultPanelState() {
    return workspaceState?.defaults?.() || { composition: false, inspector: false, tonic: false, piano: false, playback: true, activeRight: null, rightCollapsed: true, floating: { composition: false, inspector: false, tonic: false }, rightWidth: 300, pianoHeight: 126 };
  }

  function sanitizePanelState(value) {
    if (workspaceState?.sanitize) return workspaceState.sanitize(value, panelViewport());
    const defaults = defaultPanelState();
    const input = value && typeof value === 'object' ? value : {};
    return { ...defaults, ...input, floating: { ...defaults.floating, ...(input.floating || {}) } };
  }

  function readPanelState() {
    try {
      const stored = JSON.parse(safeStorage.getItem('airmon-panel-state') || '{}');
      return sanitizePanelState(workspaceState?.migrateStored ? workspaceState.migrateStored(stored) : stored);
    } catch (_) { return defaultPanelState(); }
  }

  function initializePanelSystem() {
    state.panels = readPanelState();
    applyPanelState({ persist: false });
  }

  function persistPanelState() {
    safeStorage.setItem('airmon-panel-state', JSON.stringify(state.panels));
    window.airmonDesktop?.setSettings?.({ panelState: state.panels }).catch(() => {});
  }

  function rightPanelNames() { return ['composition', 'inspector', 'tonic']; }

  function applyPanelState(options = {}) {
    const panelLayout = workspaceState?.layout ? workspaceState.layout(state.panels, panelViewport()) : null;
    state.panels = panelLayout?.state || sanitizePanelState(state.panels);
    const panels = state.panels;
    const openRight = rightPanelNames().filter(name => panels[name]);
    if (!openRight.includes(panels.activeRight)) panels.activeRight = openRight[0] || null;
    const dockedOpen = openRight.filter(name => !panels.floating?.[name]);
    const rightDock = $('#rightDock');
    const workspace = $('.workspace');
    const rightVisible = panelLayout?.rightVisible ?? dockedOpen.length > 0;
    const effectiveCollapsed = panelLayout?.effectiveRightCollapsed ?? Boolean(panels.rightCollapsed && rightVisible);
    rightDock.classList.toggle('hidden', !rightVisible);
    rightDock.classList.toggle('collapsed', effectiveCollapsed);
    rightDock.dataset.autoCollapsed = String(Boolean(effectiveCollapsed && !panels.rightCollapsed));
    workspace.classList.toggle('right-dock-hidden', !rightVisible);
    document.documentElement.style.setProperty('--right-dock-width', `${Number(panels.rightWidth) || 300}px`);
    document.documentElement.style.setProperty('--piano-dock-height', `${Number(panels.pianoHeight) || 126}px`);

    rightPanelNames().forEach(name => {
      const open = Boolean(panels[name]);
      const floating = Boolean(panels.floating?.[name]);
      const active = open && (floating || panels.activeRight === name);
      const tab = document.querySelector(`[data-dock-tab="${name}"]`);
      const panel = document.querySelector(`[data-dock-panel="${name}"]`);
      tab?.classList.toggle('hidden', !open || floating);
      tab?.classList.toggle('active', active && !floating);
      tab?.setAttribute('aria-selected', String(active && !floating));
      panel?.classList.toggle('floating', floating && open);
      panel?.classList.toggle('active', active);
      panel?.classList.toggle('hidden', !active);
    });

    document.body.classList.toggle('piano-hidden', !panels.piano);
    $('#pianoDock').classList.toggle('hidden', !panels.piano);
    document.body.classList.toggle('playback-controls-hidden', !panels.playback);
    $$('[data-panel-toggle]').forEach(button => {
      const name = button.dataset.panelToggle;
      const checked = name === 'piano' ? panels.piano : name === 'playback' ? panels.playback : Boolean(panels[name]);
      button.classList.toggle('checked', checked);
      button.setAttribute('aria-checked', String(checked));
    });
    $('#collapseRightDock').textContent = effectiveCollapsed ? '‹' : '›';
    $('#collapseRightDock').setAttribute('aria-label', effectiveCollapsed ? 'Expand right dock' : 'Collapse right dock');
    updateTonicPanelStatus();
    if (options.persist !== false) persistPanelState();
    if (options.render !== false) setTimeout(() => { if (state.currentView === 'score') renderScore(); }, 0);
  }

  function openPanel(name, options = {}) {
    if (name === 'piano') state.panels.piano = true;
    else if (name === 'playback') state.panels.playback = true;
    else if (rightPanelNames().includes(name)) {
      state.panels[name] = true;
      state.panels.activeRight = name;
      if (options.dock === true) state.panels.floating[name] = false;
    }
    applyPanelState();
  }

  function closePanel(name) {
    if (name === 'piano') state.panels.piano = false;
    else if (name === 'playback') state.panels.playback = false;
    else if (rightPanelNames().includes(name)) { state.panels[name] = false; state.panels.floating[name] = false; }
    applyPanelState();
  }

  function togglePanel(name) {
    const current = name === 'piano' ? state.panels.piano : name === 'playback' ? state.panels.playback : state.panels[name];
    if (current) closePanel(name); else openPanel(name);
  }

  function activateRightPanel(name) {
    if (!rightPanelNames().includes(name)) return;
    state.panels[name] = true;
    state.panels.activeRight = name;
    state.panels.floating[name] = false;
    applyPanelState();
  }

  function togglePanelFloating(name) {
    if (!rightPanelNames().includes(name)) return;
    state.panels[name] = true;
    state.panels.floating[name] = !state.panels.floating[name];
    if (!state.panels.floating[name]) state.panels.activeRight = name;
    applyPanelState();
    toast(`${name === 'composition' ? 'Composition Notepad' : name === 'inspector' ? 'Inspector' : 'Tonic Solfa'} ${state.panels.floating[name] ? 'floated' : 'redocked'}.`, 'success');
  }

  function toggleRightDockCollapsed() {
    state.panels.rightCollapsed = !state.panels.rightCollapsed;
    applyPanelState();
  }

  function beginRightDockResize(event) {
    if ($('#rightDock').classList.contains('collapsed')) return;
    state.panelResize = { kind: 'right', pointerId: event.pointerId, startX: event.clientX, startSize: Number(state.panels.rightWidth) || 300 };
    event.currentTarget.setPointerCapture?.(event.pointerId); event.preventDefault();
  }

  function beginPianoDockResize(event) {
    state.panelResize = { kind: 'piano', pointerId: event.pointerId, startY: event.clientY, startSize: Number(state.panels.pianoHeight) || 126 };
    event.currentTarget.setPointerCapture?.(event.pointerId); event.preventDefault();
  }

  function updatePanelResize(event) {
    const resize = state.panelResize;
    if (!resize || resize.pointerId !== event.pointerId) return;
    if (resize.kind === 'right') state.panels.rightWidth = resize.startSize + resize.startX - event.clientX;
    else state.panels.pianoHeight = resize.startSize + resize.startY - event.clientY;
    state.panels = sanitizePanelState(state.panels);
    applyPanelState({ persist: false, render: false });
  }

  function finishPanelResize(event) {
    if (!state.panelResize || (event.pointerId != null && state.panelResize.pointerId !== event.pointerId)) return;
    state.panelResize = null; persistPanelState();
  }

  function updateTonicPanelStatus() {
    const element = $('#tonicPanelStatus'); if (!element || !state.score) return;
    element.textContent = state.score.settings.showSolfa ? `Staff overlay is visible ${state.score.settings.solfaOverlayPosition || 'below'} the staff.` : 'Staff overlay is hidden.';
  }

  function resetWorkspace() {
    document.body.classList.remove('full-screen-score');
    $('.left-panel')?.classList.remove('hidden');
    state.panels = defaultPanelState();
    applyPanelState();
    setZoom(.9); applyWorkspace('beginner'); toast('Workspace layout reset.', 'success');
  }

  function adjustScoreSpacing(field, delta) {
    if (field === 'staffGap' && state.mode === 'layout' && state.layoutTarget?.partId) {
      const part = state.score.parts.find(item => item.id === state.layoutTarget.partId);
      if (part) {
        const staff = model.isMultiStaff(part) ? (state.layoutTarget.staff || activeStaffForPart(part)) : null;
        checkpoint('Adjust selected staff spacing');
        const amount = model.adjustStaffManualAfter(state.score, part.id, staff, delta);
        commit('Adjust selected staff spacing');
        toast(`${part.name}${staff ? ` · ${staff}` : ''} manual space is now ${amount} units beyond automatic collision spacing. Playback timing was not changed.`, 'success');
        return;
      }
    }
    const limits = field === 'staffGap' ? [44, 140] : [32, 180];
    checkpoint(`Adjust ${field}`);
    state.score.settings[field] = theory.clamp((Number(state.score.settings[field]) || (field === 'staffGap' ? 60 : 50)) + Number(delta), limits[0], limits[1]);
    model.touch(state.score);
    commit(`Adjust ${field}`);
    setEntryMode('layout');
    toast(`${field === 'staffGap' ? 'Staff' : 'System'} spacing is now ${state.score.settings[field]} units. Playback timing was not changed.`, 'success');
  }
  function resetScoreSpacing() {
    checkpoint('Reset score spacing');
    Object.assign(state.score.settings, { staffGap: 60, partGap: 42, systemGap: 50 });
    model.resetManualSpacing(state.score);
    commit('Reset score spacing');
    setEntryMode('layout');
    toast('Automatic score spacing and controlled manual staff offsets were reset without changing any musical timing.', 'success');
  }
  function toggleFullScreenScore() { document.body.classList.toggle('full-screen-score'); setTimeout(renderScore, 0); }
  function applyAccessibilityPreferences() {
    document.body.classList.toggle('high-contrast', safeStorage.getItem('airmon-high-contrast') === 'true');
    document.body.classList.toggle('reduced-motion', safeStorage.getItem('airmon-reduced-motion') === 'true');
  }
  function toggleAccessibility(className) {
    const active = document.body.classList.toggle(className);
    safeStorage.setItem(`airmon-${className}`, String(active));
    window.airmonDesktop?.setSettings?.({ [className === 'high-contrast' ? 'highContrast' : 'reducedMotion']: active }).catch(() => {});
    toast(`${className === 'high-contrast' ? 'High contrast' : 'Reduced motion'} ${active ? 'enabled' : 'disabled'}.`, 'success');
  }
  function syncDocumentState() {
    window.airmonDesktop?.updateDocumentState?.({
      dirty: Boolean(state.dirty),
      title: state.score?.metadata?.title || 'Untitled Score',
      filePath: state.filePath || null
    });
  }

  function recordShutdownStage(stage, details = {}) {
    const entry = { stage, at: Date.now(), ...details };
    state.shutdown.stages.push(entry);
    if (state.shutdown.stages.length > 80) state.shutdown.stages.shift();
    return entry;
  }

  async function boundedShutdownTask(label, task, timeoutMs = 2000) {
    const started = performance.now();
    let timer;
    try {
      const result = await Promise.race([
        Promise.resolve().then(task).then(value => ({ status: 'completed', value })),
        new Promise(resolve => { timer = setTimeout(() => resolve({ status: 'timeout' }), Math.max(1, timeoutMs)); })
      ]);
      recordShutdownStage(label, { status: result.status, durationMs: Math.round((performance.now() - started) * 10) / 10 });
      return result;
    } catch (error) {
      const result = { status: 'error', error };
      recordShutdownStage(label, { status: 'error', durationMs: Math.round((performance.now() - started) * 10) / 10, message: error?.message || String(error) });
      return result;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  function cancelAutosaveTasks() {
    if (state.performance.autosaveInterval) clearInterval(state.performance.autosaveInterval);
    state.performance.autosaveInterval = null;
    if (state.performance.autosaveTimer) clearTimeout(state.performance.autosaveTimer);
    state.performance.autosaveTimer = null;
    if (state.performance.autosaveIdleHandle != null) {
      if (typeof cancelIdleCallback === 'function') cancelIdleCallback(state.performance.autosaveIdleHandle);
      else clearTimeout(state.performance.autosaveIdleHandle);
    }
    state.performance.autosaveIdleHandle = null;
  }

  function resumeAutosaveTasks() {
    if (!state.performance.autosaveInterval) state.performance.autosaveInterval = setInterval(() => scheduleAutosave(), 60000);
  }

  function handleShutdownAbort(payload = {}) {
    if (payload.requestId && state.shutdown.requestId && payload.requestId !== state.shutdown.requestId) return;
    state.shutdown.inProgress = false;
    state.shutdown.approved = false;
    state.shutdown.requestId = null;
    configurePlaybackCallbacks();
    resumeAutosaveTasks();
    recordShutdownStage('shutdown-aborted-by-main', { status: payload.status || 'aborted' });
  }

  function stopPreviewAudio() {
    for (const node of state.previewAudioNodes) {
      try { node.stop(); } catch (_) {}
      try { node.disconnect?.(); } catch (_) {}
    }
    state.previewAudioNodes.clear();
  }

  async function closeMidiResources() {
    state.midiTransactionOpen = false;
    if (state.midiStep) {
      state.midiStep.activeNotes.clear();
      state.midiStep.currentChordStart = null;
      state.midiStep.sustain = false;
    }
    const access = state.midiAccess;
    state.midiAccess = null;
    if (!access) return true;
    access.onstatechange = null;
    const inputs = Array.from(access.inputs?.values?.() || []);
    const outputs = Array.from(access.outputs?.values?.() || []);
    for (const input of inputs) input.onmidimessage = null;
    for (const output of outputs) {
      if (typeof output.send === 'function') {
        for (let channel = 0; channel < 16; channel += 1) {
          try { output.send([0xB0 | channel, 123, 0]); } catch (_) {}
          try { output.send([0xB0 | channel, 120, 0]); } catch (_) {}
        }
      }
    }
    await Promise.allSettled([...inputs, ...outputs].map(port => typeof port.close === 'function' ? port.close() : Promise.resolve()));
    return true;
  }

  async function persistWorkspaceForShutdown() {
    if (!window.airmonDesktop?.setSettings) return true;
    const keypad = $('#simpleEntryPalette');
    return window.airmonDesktop.setSettings({
      workspace: state.workspace,
      theme: document.documentElement.classList.contains('light') ? 'light' : 'dark',
      highContrast: document.body.classList.contains('high-contrast'),
      reducedMotion: document.body.classList.contains('reduced-motion'),
      entryKeypadFloating: Boolean(state.keypadFloating),
      entryKeypadCollapsed: Boolean(state.keypadCollapsed),
      entryKeypadPosition: keypad ? { left: parseFloat(keypad.style.left) || 24, top: parseFloat(keypad.style.top) || 120 } : null,
      panelState: state.panels,
      inspectorHidden: !state.panels.inspector,
      pianoCollapsed: !state.panels.piano,
      lastView: state.currentView
    });
  }

  function closeOwnedUiForShutdown() {
    closeCommandMenus();
    document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close());
    state.drag = null;
    state.lyricDrag = null;
    state.keypadDrag = null;
    state.selectionMarquee = null;
    if (state.panels?.floating) Object.keys(state.panels.floating).forEach(name => { state.panels.floating[name] = false; });
  }

  async function waitForAutosaveToSettle() {
    while (state.autosaveInFlight) await new Promise(resolve => setTimeout(resolve, 25));
    return true;
  }

  async function handleShutdownRequest(payload = {}) {
    if (!payload.requestId || !window.airmonDesktop?.respondToShutdown) return;
    if (state.shutdown.inProgress) return;
    state.shutdown = { ...state.shutdown, inProgress: true, approved: false, requestId: payload.requestId, stages: [] };
    recordShutdownStage('renderer-shutdown-request', { reason: payload.reason || 'unknown', decision: payload.decision || 'discard' });

    try {
      if (payload.decision === 'save' && state.dirty) {
        const saved = await saveProject(false, { forShutdown: true });
        if (!saved) {
          state.shutdown.inProgress = false;
          recordShutdownStage('save-before-close', { status: 'canceled-or-failed' });
          window.airmonDesktop.respondToShutdown({ requestId: payload.requestId, status: 'canceled', diagnostics: state.shutdown.stages });
          return;
        }
      }

      cancelAutosaveTasks();
      await boundedShutdownTask('autosave-settle', waitForAutosaveToSettle, 1200);
      await boundedShutdownTask('playback-audio-stop', () => state.playback.shutdown(), 1800);
      stopPreviewAudio();
      recordShutdownStage('preview-notes-stop', { status: 'completed' });
      await boundedShutdownTask('midi-close', closeMidiResources, 1800);
      await boundedShutdownTask('workspace-save', persistWorkspaceForShutdown, 2200);
      closeOwnedUiForShutdown();
      recordShutdownStage('owned-ui-close', { status: 'completed' });

      state.shutdown.approved = true;
      syncDocumentState();
      window.airmonDesktop.respondToShutdown({ requestId: payload.requestId, status: 'approved', diagnostics: state.shutdown.stages });
    } catch (error) {
      state.shutdown.inProgress = false;
      recordShutdownStage('renderer-shutdown-error', { status: 'error', message: error?.message || String(error) });
      window.airmonDesktop.respondToShutdown({ requestId: payload.requestId, status: 'error', diagnostics: state.shutdown.stages });
    }
  }

  function initializeShutdownLifecycle() {
    if (window.airmonDesktop?.onShutdownRequest) state.shutdown.unsubscribe = window.airmonDesktop.onShutdownRequest(handleShutdownRequest);
    if (window.airmonDesktop?.onShutdownAbort) state.shutdown.unsubscribeAbort = window.airmonDesktop.onShutdownAbort(handleShutdownAbort);
    syncDocumentState();
  }

  function requestApplicationExit() {
    if (state.shutdown.inProgress) return;
    closeCommandMenus();
    if (window.airmonDesktop?.requestQuit) window.airmonDesktop.requestQuit();
    else window.close();
  }

  function confirmDiscardChanges(action = 'continue') {
    return !state.dirty || window.confirm(`This score has unsaved changes. Save it before you ${action}?

Choose Cancel to return and save. Choose OK to continue without saving.`);
  }

  function ensurePrimarySelection() {
    if (state.selection.isEmpty && state.selectedEventId) state.selection.selectEvent(state.selectedEventId);
    return state.selection.eventEntries(state.score);
  }

  function copySelection() {
    const entries = ensurePrimarySelection();
    if (!entries.length) return toast('Select one or more notes or rests first.');
    state.clipboard = editing.makeClipboard(state.score, state.selection);
    toast(`${entries.length} event${entries.length === 1 ? '' : 's'} copied.`, 'success');
  }

  function cutSelection() {
    const entries = ensurePrimarySelection();
    if (!entries.length) return toast('Select one or more notes or rests first.');
    state.clipboard = editing.makeClipboard(state.score, state.selection);
    checkpoint('Cut selection');
    editing.deleteSelection(state.score, state.selection);
    state.selection.clear(); state.selectedEventId = null;
    commit('Cut selection');
    toast(`${entries.length} event${entries.length === 1 ? '' : 's'} cut.`, 'success');
  }

  function pasteSelection() {
    if (!state.clipboard) return toast('Nothing has been copied in Airmonlink Composer.');
    const part = state.score.parts.find(item => item.id === state.selectedPartId) || state.score.parts[0];
    checkpoint('Paste selection');
    try {
      const created = editing.pasteClipboard(state.score, state.clipboard, { start: state.cursorBeat, partId: part?.id || null, voice: state.activeVoice });
      state.selection.selectEvents(created.map(item => item.event.id));
      const last = created.at(-1);
      state.selectedEventId = last?.event.id || null;
      state.selectedPartId = last?.partId || part?.id || null;
      commit('Paste selection');
      toast(`${created.length} event${created.length === 1 ? '' : 's'} pasted.`, 'success');
    } catch (error) { state.history.undo(state.score); toast(`Paste failed: ${error.message}`, 'error'); }
  }


  function openCopyLayerDialog() {
    const entries = ensurePrimarySelection();
    if (!entries.length) return toast('Select the notes or rests to copy to another layer.', 'error');
    $('#copyLayerTarget').value = String(state.activeVoice === 4 ? 1 : state.activeVoice + 1);
    openDialog('copyLayerDialog');
  }

  function applyCopyToLayer() {
    const entries = ensurePrimarySelection();
    if (!entries.length) return toast('Select the source passage first.', 'error');
    const targetVoice = Number($('#copyLayerTarget').value);
    const sourceVoiceSet = new Set(entries.map(({ event }) => Number(event.voice) || 1));
    if (sourceVoiceSet.size === 1 && sourceVoiceSet.has(targetVoice) && !window.confirm(`The selection is already in Layer ${targetVoice}. Copy it onto the same layer anyway?`)) return;
    checkpoint(`Copy selection to Layer ${targetVoice}`);
    try {
      const created = editing.copySelectionToLayer(state.score, state.selection, targetVoice, {
        partId: entries[0].part.id,
        staff: entries[0].event.staff || null,
        conflictMode: $('#copyLayerConflict').value,
        includeLyrics: $('#copyLayerLyrics').checked,
        includeMarkings: $('#copyLayerMarkings').checked
      });
      state.activeVoice = targetVoice;
      state.selection.selectEvents(created.map(item => item.event.id));
      state.selectedEventId = created.at(-1)?.event.id || null;
      commit(`Copy selection to Layer ${targetVoice}`);
      closeDialog('copyLayerDialog');
      toast(`${created.length} event${created.length === 1 ? '' : 's'} copied to independent Layer ${targetVoice}.`, 'success');
    } catch (error) {
      state.history.undo(state.score);
      toast(`Layer copy failed: ${error.message}`, 'error');
    }
  }

  function openPasteReplaceDialog() {
    if (!state.clipboard) return toast('Copy a source passage first.', 'error');
    const entries = ensurePrimarySelection();
    if (!entries.length) return toast('Select the destination notes or rests to override.', 'error');
    openDialog('pasteReplaceDialog');
  }

  function applyPasteReplace() {
    if (!state.clipboard) return toast('Copy a source passage first.', 'error');
    const entries = ensurePrimarySelection();
    if (!entries.length) return toast('Select the destination range first.', 'error');
    checkpoint('Paste and replace selection');
    try {
      const created = editing.replaceRange(state.score, state.selection, state.clipboard, {
        contentMode: $('#pasteReplaceMode').value,
        includeLyrics: $('#pasteReplaceLyrics').checked,
        includeMarkings: $('#pasteReplaceMarkings').checked
      });
      state.selection.selectEvents(created.map(item => item.event.id));
      state.selectedEventId = created.at(-1)?.event.id || null;
      if (created[0]) state.selectedPartId = created[0].partId;
      commit('Paste and replace selection');
      closeDialog('pasteReplaceDialog');
      toast(`Destination passage replaced with ${created.length} resulting event${created.length === 1 ? '' : 's'}.`, 'success');
    } catch (error) {
      state.history.undo(state.score);
      toast(`Replacement failed: ${error.message}`, 'error');
    }
  }

  function selectAllEvents() {
    const part = state.score.parts.find(item => item.id === state.selectedPartId) || state.score.parts[0];
    const ids = (part?.events || []).filter(event => event.generatedBy !== 'gap-fill').map(event => event.id);
    state.selection.selectEvents(ids);
    state.selectedEventId = ids[0] || null;
    renderAll();
    toast(`${ids.length} event${ids.length === 1 ? '' : 's'} selected in ${part?.name || 'active part'}.`, 'success');
  }

  function duplicateSelected() {
    const entries = ensurePrimarySelection();
    if (!entries.length) return toast('Select one or more notes or rests first.');
    checkpoint('Duplicate selection');
    try {
      const created = editing.duplicateSelection(state.score, state.selection);
      state.selection.selectEvents(created.map(item => item.event.id));
      const last = created.at(-1);
      state.selectedEventId = last?.event.id || null;
      state.selectedPartId = last?.partId || state.selectedPartId;
      if (last) state.cursorBeat = last.event.start;
      commit('Duplicate selection');
    } catch (error) { toast(error.message, 'error'); }
  }

  function transposeSelected(semitones) {
    const entries = ensurePrimarySelection().filter(({ event }) => event.type === 'note');
    if (!entries.length) return toast('Select one or more notes to transpose.');
    checkpoint('Transpose selection');
    const count = editing.transposeSelection(state.score, state.selection, semitones);
    commit('Transpose selection');
    toast(`${count} note${count === 1 ? '' : 's'} transposed.`, 'success');
  }

  function addIntervalToSelection(direction = 1) {
    const { part, event } = getSelected();
    if (!part || !event || event.type !== 'note') return toast('Select a note or one chord tone before adding an interval.', 'error');
    const answer = window.prompt(`Add interval ${direction < 0 ? 'below' : 'above'} the selected note. Enter m3, M3, P5, P8, octave, or a semitone number:`, 'M3');
    if (answer == null) return;
    try {
      const semitones = Math.abs(theory.intervalSemitones(answer));
      if (!semitones) throw new Error('Choose an interval larger than a unison.');
      const targetMidi = theory.clamp(Number(event.midi) + (direction < 0 ? -semitones : semitones), 0, 127);
      if (targetMidi === Number(event.midi)) throw new Error('The requested pitch is outside the supported range.');
      const before = model.chordMembers(state.score, event.id);
      if (before.some(note => Number(note.midi) === targetMidi)) return toast('That pitch is already present in the chord.', 'error');
      checkpoint(`Add interval ${direction < 0 ? 'below' : 'above'}`);
      const created = model.addIntervalToChord(state.score, part.id, event.id, answer, direction);
      const members = model.chordMembers(state.score, created.id);
      state.selection.selectEvents(members.map(note => note.id));
      state.selectedEventId = created.id;
      state.selectedPartId = part.id;
      commit(`Add interval ${direction < 0 ? 'below' : 'above'}`);
      toast(`${theory.midiToPitch(targetMidi)} added to the chord without changing its tick or duration.`, 'success');
    } catch (error) { toast(error.message, 'error'); }
  }

  function insertMeasureAfter() { checkpoint('Insert measure after'); model.insertMeasures(state.score, state.selectedMeasure + 1, 1); commit('Insert measure after'); }
  function deleteCurrentMeasure() {
    if (state.score.measures.length <= 1) return toast('A score must contain at least one measure.', 'error');
    if (!window.confirm(`Delete bar ${state.selectedMeasure + 1} and its contents?`)) return;
    checkpoint('Delete measure'); model.removeMeasure(state.score, state.selectedMeasure); state.selectedMeasure = Math.max(0, state.selectedMeasure - 1); commit('Delete measure');
  }
  function soloActivePart() {
    const part = state.score.parts.find(item => item.id === state.selectedPartId); if (!part) return;
    checkpoint('Solo active part'); const next = !part.solo; state.score.parts.forEach(item => { item.solo = item.id === part.id ? next : false; }); commit('Solo active part');
  }
  function navigateBeat(direction) {
    const measure = model.measureIndexAt(state.score, state.cursorBeat);
    const info = model.timeSignatureInfo(model.effectiveTimeSignature(state.score, measure));
    seekTo(state.cursorBeat + Number(direction) * info.pulseQuarterBeats);
  }
  function setLoopStart() {
    state.loopStart = clampCursor(state.cursorBeat);
    if (state.loopEnd != null && state.loopEnd <= state.loopStart + EPSILON) state.loopEnd = null;
    state.loop = true; $('#loopButton').classList.add('active');
    setStatus(`Loop starts at bar ${model.measureIndexAt(state.score, state.loopStart) + 1}, beat ${formatBeat(model.beatInMeasure(state.score, state.loopStart) + 1)}.`);
  }
  function setLoopEnd() {
    const end = theory.clamp(Number(state.cursorBeat) || 0, 0, model.totalBeats(state.score));
    if (end <= state.loopStart + EPSILON) return toast('Move the playback cursor after the loop start before setting the loop end.', 'error');
    state.loopEnd = end; state.loop = true; $('#loopButton').classList.add('active');
    setStatus(`Loop range set from ${formatBeat(state.loopStart)} to ${formatBeat(state.loopEnd)} quarter-note beats.`);
  }
  function clearLoopRange() {
    state.loopStart = 0; state.loopEnd = null; state.loop = false; $('#loopButton').classList.remove('active');
    setStatus('Loop range cleared.');
  }
  function activeLoopRange() {
    return state.loop && state.loopEnd != null && state.loopEnd > state.loopStart + EPSILON ? { start: state.loopStart, end: state.loopEnd } : null;
  }

  function selectedNotationEntries() {
    const entries = state.selection.eventEntries(state.score);
    if (entries.length) return entries;
    const selected = getSelected();
    return selected.part && selected.event ? [{ part: selected.part, event: selected.event }] : [];
  }

  function createTieCommand() {
    try {
      checkpoint('Add tie');
      const spanner = notations.createTie(state.score, selectedNotationEntries());
      state.selectedSpannerId = spanner.id;
      commit('Add tie');
      toast('Tie added. Playback and tonic sol-fa now sustain through the second note.', 'success');
    } catch (error) { toast(error.message, 'error'); }
  }

  function createSlurCommand() {
    try {
      checkpoint('Add slur');
      const spanner = notations.createSlur(state.score, selectedNotationEntries());
      state.selectedSpannerId = spanner.id;
      commit('Add slur');
      toast('Slur added to the selected phrase.', 'success');
    } catch (error) { toast(error.message, 'error'); }
  }

  function removeSpannerCommand(type) {
    checkpoint(`Remove ${type}`);
    const count = state.selectedSpannerId && model.removeSpanner(state.score, state.selectedSpannerId)
      ? 1 : notations.removeSpanners(state.score, selectedNotationEntries(), type);
    state.selectedSpannerId = null;
    if (!count) return toast(`Select a ${type} or one of its notes first.`, 'error');
    commit(`Remove ${type}`); toast(`${type === 'tie' ? 'Tie' : 'Slur'} removed.`, 'success');
  }

  function flipSpannerCommand(type) {
    checkpoint(`Flip ${type}`);
    let count = 0;
    if (state.selectedSpannerId) {
      const spanner = (state.score.spanners || []).find(item => item.id === state.selectedSpannerId && item.type === type);
      if (spanner) { spanner.direction = spanner.direction === 'above' ? 'below' : 'above'; model.touch(state.score); count = 1; }
    }
    if (!count) count = notations.flipSpanners(state.score, selectedNotationEntries(), type);
    if (!count) return toast(`Select a ${type} or one of its notes first.`, 'error');
    commit(`Flip ${type}`);
  }

  function resetSpannerCommand() {
    checkpoint('Reset tie and slur position');
    let count = 0;
    if (state.selectedSpannerId) {
      const spanner = (state.score.spanners || []).find(item => item.id === state.selectedSpannerId);
      if (spanner) { spanner.direction = 'auto'; spanner.placementOffset = 0; model.touch(state.score); count = 1; }
    }
    if (!count) count = notations.resetSpannerPositions(state.score, selectedNotationEntries());
    if (!count) return toast('Select a tie, slur, or attached note first.', 'error');
    commit('Reset tie and slur position');
  }

  function toggleArticulationCommand(name) {
    const entries = selectedNotationEntries().filter(entry => entry.event.type === 'note');
    if (!entries.length) return toast('Select one or more notes before adding a marking.', 'error');
    const allHave = entries.every(({ event }) => Array.isArray(event.articulations) && event.articulations.includes(name));
    checkpoint(`${allHave ? 'Remove' : 'Add'} ${name}`);
    notations.setArticulation(state.score, entries, name, !allHave);
    commit(`${allHave ? 'Remove' : 'Add'} ${name}`);
    toast(`${name.replace('-', ' ')} ${allHave ? 'removed' : 'added'}.`, 'success');
  }

  function updateSolfaSettings(patch, options = {}) {
    checkpoint('Change tonic sol-fa view');
    Object.assign(state.score.settings, { ...patch, solfaMode: 'traditional' });
    model.touch(state.score);
    commit('Change tonic sol-fa view');
    if (options.scoreView) setView('score');
    else if (!options.remainInView) setView('solfa');
    else renderAll();
  }
  function toggleSolfaOverlay() { updateSolfaSettings({ showSolfa: state.score.settings.showSolfa !== true }, { scoreView: true }); }
  function toggleSolfaVoiceLabels() { updateSolfaSettings({ solfaShowVoiceLabels: state.score.settings.solfaShowVoiceLabels !== true }, { remainInView: true }); }

  function currentSolfaStaffContext() {
    const selected = getSelected();
    const part = selected.part || state.score.parts.find(item => item.id === state.selectedPartId) || state.score.parts[0];
    const staff = selected.event?.staff || (part && model.isMultiStaff(part) ? model.defaultStaff(part, selected.event?.midi || 72) : null);
    return { part, staff, key: part ? `${part.id}:${staff || 'single'}` : '' };
  }

  function solfaVisibleForStaff(part, staff) {
    if (state.score.settings.showSolfa !== true) return false;
    const scope = state.score.settings.solfaOverlayScope || 'entire-score';
    if (scope === 'entire-score') return true;
    const key = `${part.id}:${staff || 'single'}`;
    if (scope === 'selected-staves') return state.score.settings.solfaStaffVisibility?.[key] === true;
    const current = currentSolfaStaffContext();
    return current.part?.id === part.id && (current.staff || null) === (staff || null);
  }

  function toggleCurrentStaffSolfa() {
    const current = currentSolfaStaffContext();
    if (!current.part) return toast('Choose a staff first.', 'error');
    const visibility = { ...(state.score.settings.solfaStaffVisibility || {}) };
    visibility[current.key] = visibility[current.key] !== true;
    updateSolfaSettings({ showSolfa: true, solfaOverlayScope: 'selected-staves', solfaStaffVisibility: visibility }, { scoreView: true });
    toast(`Tonic Sol-fa ${visibility[current.key] ? 'shown' : 'hidden'} for ${current.part.name}${current.staff ? ` ${current.staff}` : ''}.`, 'success');
  }

  function openSolfaTranscription() {
    const partSelect = $('#solfaInputPart');
    partSelect.innerHTML = state.score.parts.map(part => `<option value="${escapeHtml(part.id)}">${escapeHtml(part.name)}</option>`).join('');
    partSelect.value = state.selectedPartId || state.score.parts[0]?.id || '';
    $('#solfaInputVoice').value = String(state.activeVoice || 1);
    const current = currentSolfaStaffContext();
    $('#solfaInputStaff').value = current.staff || '';
    $('#solfaInputConvention').value = state.score.settings.solfaConvention || 'airmonlink-traditional-v1';
    const part = state.score.parts.find(item => item.id === partSelect.value);
    if (!$('#solfaSourceInput').value.trim() && part) {
      const bars = solfa.partToSolfa(part, state.score, { voice: state.activeVoice || 1, staff: current.staff, includeAutoRests: false, showRhythm: true, showOctaveMarks: true });
      $('#solfaSourceInput').value = bars.map(bar => bar.map(item => item.text).join(' ')).join(' | ');
    }
    renderSolfaSymbolTable();
    $('#solfaParseSummary').textContent = 'Validate before replacing staff notation. Unknown or ambiguous symbols are never silently discarded.';
    $('#solfaParsePreview').innerHTML = '';
    openDialog('solfaTranscriptionDialog');
  }

  function solfaInputOptions() {
    return {
      partId: $('#solfaInputPart').value,
      voice: Number($('#solfaInputVoice').value) || 1,
      staff: $('#solfaInputStaff').value || null,
      convention: $('#solfaInputConvention').value,
      allowIncompleteMeasures: $('#solfaAllowIncomplete').checked,
      pitchSystem: state.score.settings.solfaPitchSystem || 'movable-do',
      minorSystem: state.score.settings.minorSolfaSystem || 'do-based'
    };
  }

  function renderSolfaSymbolTable() {
    $('#solfaSymbolTable').innerHTML = solfa.symbolTable($('#solfaInputConvention').value).map(item => `<div><code>${escapeHtml(item.symbol)}</code><span><strong>${escapeHtml(item.meaning)}</strong><small>${escapeHtml(item.context)}</small></span></div>`).join('');
  }

  function renderSolfaParseResult(result) {
    const errors = result.diagnostics.filter(item => item.severity === 'error').length;
    const warnings = result.diagnostics.filter(item => item.severity !== 'error').length;
    $('#solfaParseSummary').innerHTML = `<strong>${result.events.length} timed events</strong> · ${result.measures.length} measures · ${errors} errors · ${warnings} warnings · Convention ${escapeHtml(result.convention)}`;
    const events = `<div class="solfa-preview-events">${result.events.map(item => `<span class="${item.rest ? 'rest' : ''}" title="Measure ${item.measure}, beat ${Number(item.beat).toFixed(3)}, duration ${item.duration}">${escapeHtml(item.rest ? '0' : `${item.syllable}${item.octaveShift > 0 ? "'".repeat(item.octaveShift) : item.octaveShift < 0 ? ','.repeat(-item.octaveShift) : ''}`)}<small>${item.pitch || 'rest'} · ${item.duration}</small></span>`).join('')}</div>`;
    const diagnostics = result.diagnostics.length ? `<div class="solfa-diagnostics">${result.diagnostics.map(item => `<article class="${item.severity}"><strong>${escapeHtml(item.code)}</strong><span>Bar ${item.measure}, beat ${Number(item.beat).toFixed(2)}, Layer ${item.voice}: ${escapeHtml(item.message)}</span><small>Symbol “${escapeHtml(item.symbol || '—')}” · ${escapeHtml(item.suggestion || '')}</small></article>`).join('')}</div>` : '<div class="analysis-item success">No parser errors. Staff pitch, onset, duration and measure placement are ready for preview.</div>';
    $('#solfaParsePreview').innerHTML = events + diagnostics;
  }

  function validateSolfaInput() {
    try {
      const result = solfa.previewSolfaToStaff(state.score, $('#solfaSourceInput').value, solfaInputOptions());
      state.lastSolfaParse = result;
      renderSolfaParseResult(result);
      if (result.valid) toast('Tonic Sol-fa passage validated against the score meter and tonic.', 'success');
      else toast('The passage contains errors that must be corrected before replacement.', 'error');
    } catch (error) { toast(error.message, 'error'); }
  }

  function applySolfaInput() {
    try {
      const options = solfaInputOptions();
      checkpoint('Replace staff passage from Tonic Sol-fa');
      const result = solfa.applySolfaPassage(state.score, options.partId, $('#solfaSourceInput').value, { ...options, replace: true });
      state.selectedPartId = options.partId; state.activeVoice = options.voice; state.selectedEventId = result.created.find(item => item.type === 'note')?.id || null;
      commit('Replace staff passage from Tonic Sol-fa');
      renderSolfaParseResult(result); closeDialog('solfaTranscriptionDialog'); setView('score');
      toast(`${result.created.length} structured notes and rests applied. Staff, playback and Tonic Sol-fa now share the same events.`, 'success');
    } catch (error) { state.score = state.history.undo(state.score) || state.score; renderAll(); toast(error.message, 'error'); }
  }


  function beginMetadataEdit(event) {
    const field = event.currentTarget.dataset.metaField;
    state.metadataEditSnapshot = { field, value: String(state.score.metadata[field] || '') };
  }

  function commitMetadataEdit(event) {
    const field = event.currentTarget.dataset.metaField;
    const value = event.currentTarget.textContent.trim();
    const previous = String(state.score.metadata[field] || '');
    if (value === previous) { state.metadataEditSnapshot = null; return; }
    checkpoint(`Edit ${field}`);
    state.score.metadata[field] = field === 'title' ? (value || 'Untitled Score') : value;
    model.touch(state.score);
    commit(`Edit ${field}`);
    state.metadataEditSnapshot = null;
    renderAll();
    toast('The editable heading was updated in staff notation and Tonic Sol-fa.', 'success');
  }

  function publicationLayoutKey(element) {
    const scope = element.closest('#solfaPage') ? 'solfa' : 'staff';
    return `${scope}:${element.dataset.metaField}`;
  }

  function applyPublicationTextLayouts() {
    $$('[data-meta-field]').forEach(element => {
      const style = state.score.publicationTextLayout?.[publicationLayoutKey(element)] || {};
      element.style.transform = `translate(${Number(style.offsetX) || 0}px,${Number(style.offsetY) || 0}px)`;
      element.style.textAlign = style.alignment || '';
      element.style.fontFamily = style.fontFamily || '';
      element.style.fontSize = style.fontSize ? `${style.fontSize}px` : '';
      element.style.fontStyle = style.fontStyle || '';
      element.style.fontWeight = style.fontWeight || '';
      element.classList.toggle('publication-hidden', style.visible === false);
    });
  }

  function beginPublicationDrag(pointer, element) {
    if (state.mode !== 'layout' || pointer.button !== 0) return;
    pointer.preventDefault(); pointer.stopPropagation();
    const key = publicationLayoutKey(element);
    const style = state.score.publicationTextLayout?.[key] || {};
    state.publicationDrag = { pointerId: pointer.pointerId, key, element, startX: pointer.clientX, startY: pointer.clientY, originalX: Number(style.offsetX) || 0, originalY: Number(style.offsetY) || 0, dx: 0, dy: 0, moved: false };
    element.setPointerCapture?.(pointer.pointerId); element.classList.add('publication-dragging');
  }

  function updatePublicationDrag(pointer) {
    const drag = state.publicationDrag;
    if (!drag || pointer.pointerId !== drag.pointerId) return false;
    drag.dx = (pointer.clientX - drag.startX) / Math.max(.25, state.zoom); drag.dy = (pointer.clientY - drag.startY) / Math.max(.25, state.zoom);
    drag.moved = drag.moved || Math.hypot(drag.dx, drag.dy) > 2;
    if (drag.moved) drag.element.style.transform = `translate(${drag.originalX + drag.dx}px,${drag.originalY + drag.dy}px)`;
    setStatus(`Publication text offset: X ${Math.round(drag.originalX + drag.dx)}, Y ${Math.round(drag.originalY + drag.dy)}.`);
    return true;
  }

  function finishPublicationDrag(pointer) {
    const drag = state.publicationDrag;
    if (!drag || (pointer.pointerId != null && pointer.pointerId !== drag.pointerId)) return;
    state.publicationDrag = null; drag.element.classList.remove('publication-dragging');
    if (!drag.moved) return;
    checkpoint('Move publication text');
    model.updatePublicationTextLayout(state.score, drag.key, { offsetX: drag.originalX + drag.dx, offsetY: drag.originalY + drag.dy });
    commit('Move publication text'); toast('Publication text moved without changing its semantic field.', 'success');
  }

  function editHeaderMusicalSetting(kind) {
    if (kind === 'key') {
      const value = window.prompt('Enter the opening key, for example C, E, Bb, Ab or Em.', model.effectiveKey(state.score, 0));
      if (value == null) return;
      checkpoint('Edit opening key');
      try { model.setMeasureAttributes(state.score, 0, { key: value.trim() }); commit('Edit opening key'); }
      catch (error) { state.history.undo(state.score); toast(error.message, 'error'); }
      return;
    }
    if (kind === 'time') {
      const value = window.prompt('Enter the opening time signature, for example 4/4, 3/4 or 6/8.', model.effectiveTimeSignature(state.score, 0));
      if (value == null) return;
      try { model.timeSignatureInfo(value.trim()); checkpoint('Edit opening time signature'); model.setMeasureAttributes(state.score, 0, { timeSignature: value.trim() }); commit('Edit opening time signature'); }
      catch (error) { toast(error.message, 'error'); }
      return;
    }
    if (kind === 'tempo') {
      const value = Number(window.prompt('Enter tempo in beats per minute.', state.score.settings.tempo));
      if (!Number.isFinite(value)) return;
      checkpoint('Edit tempo'); state.score.settings.tempo = theory.clamp(value, 30, 300); model.touch(state.score); commit('Edit tempo');
    }
  }

  function setDottedDuration(dots) {
    const base = theory.baseDuration(state.duration);
    state.duration = dots === 2 ? base * 1.75 : base * 1.5;
    $('#durationSelect').value = String(state.duration);
    state.midiStep?.configure({ duration: state.duration });
    renderAll();
    setStatus(`${dots === 2 ? 'Double-dotted' : 'Dotted'} ${theory.durationName(base)} selected.`);
  }

  function applyAccidentalCommand(alteration) {
    const entries = ensurePrimarySelection().filter(({ event }) => event.type === 'note');
    if (!entries.length) { state.entryAccidental = alteration; return toast('Accidental armed for the next entered note. Select an existing note to respell it immediately.', 'success'); }
    checkpoint('Apply accidental');
    entries.forEach(({ part, event }) => {
      const pitch = writtenPitch(event, part);
      const parsed = theory.parsePitch(pitch);
      const symbol = alteration === 2 ? '##' : alteration === 1 ? '#' : alteration === -1 ? 'b' : alteration === -2 ? 'bb' : '';
      model.updateEvent(state.score, part.id, event.id, { writtenPitch: `${parsed.letter}${symbol}${parsed.octave}` });
    });
    commit('Apply accidental');
    toast('Written pitch, playback pitch and tonic sol-fa were recalculated.', 'success');
  }

  function editSelectedSolfa() {
    const { part, event } = getSelected(); if (!part || !event || event.type !== 'note') return toast('Select a note before editing tonic sol-fa.', 'error');
    const current = solfa.eventToSolfa(event, state.score, part, { notationMode: 'traditional' }).syllable;
    const value = window.prompt('Enter tonic sol-fa syllable. Chromatic examples: di, ra, me, fi, se, le, te.', current);
    if (value == null) return;
    try { checkpoint('Edit tonic sol-fa'); solfa.updateEventFromSolfa(state.score, part.id, event.id, value); commit('Edit tonic sol-fa'); toast('Staff pitch, playback and tonic sol-fa updated together.', 'success'); }
    catch (error) { toast(error.message, 'error'); }
  }

  function openPasteLyrics() {
    const { event } = getSelected(); if (!event || event.type !== 'note') return toast('Select the first melody note before pasting lyrics.', 'error');
    $('#pasteLyricsText').value = ''; $('#pasteLyricsVerse').value = $('#quickLyricVerse').value || 1; $('#pasteLyricsPreview').innerHTML = ''; state.lyricAssignmentPreview = null; openDialog('pasteLyricsDialog');
  }
  function previewPastedLyrics() {
    const { part, event } = getSelected(); if (!part || !event || event.type !== 'note') return;
    const preview = lyricEngine.previewAssignments(state.score, $('#pasteLyricsText').value, { partIds: [part.id], voice: event.voice || 1, staff: event.staff || null, start: event.start });
    state.lyricAssignmentPreview = preview;
    $('#pasteLyricsPreview').innerHTML = preview.assignments.map((item, index) => `<div class="lyrics-preview-row ${item.valid ? '' : 'invalid'}"><strong>${index + 1}</strong><span>${escapeHtml(item.token.text || '—')} ${item.token.melisma ? '___' : ''}</span><span>${item.valid ? `${escapeHtml(item.pitch || '')} · beat ${formatBeat(item.start)}` : 'No remaining note'}</span></div>`).join('') + (preview.overflow ? `<div class="analysis-item error">${preview.overflow} lyric token(s) have no note anchor.</div>` : '');
  }
  function commitPastedLyrics() {
    if (!state.lyricAssignmentPreview) previewPastedLyrics();
    const preview = state.lyricAssignmentPreview; if (!preview) return;
    if (preview.overflow) return toast('Add more notes or shorten the lyrics before applying.', 'error');
    checkpoint('Paste lyrics'); const applied = lyricEngine.applyAssignments(state.score, preview, { verse: Number($('#pasteLyricsVerse').value), lineType: $('#pasteLyricsLineType').value }); commit('Paste lyrics'); closeDialog('pasteLyricsDialog'); toast(`${applied} lyric syllables attached.`, 'success');
  }
  function openLyricTool(mode) {
    state.lyricToolMode = mode; $('#lyricToolsTitle').textContent = mode === 'copy' ? 'Copy Verse' : 'Search and Replace Lyrics';
    $('#lyricCopyFields').style.display = mode === 'copy' ? 'contents' : 'none'; $('#lyricSearchFields').style.display = mode === 'search' ? 'contents' : 'none'; openDialog('lyricToolsDialog');
  }
  function applyLyricTool() {
    checkpoint(state.lyricToolMode === 'copy' ? 'Copy verse' : 'Replace lyrics');
    let count = 0;
    if (state.lyricToolMode === 'copy') count = lyricEngine.copyVerse(state.score, Number($('#copyVerseSource').value), Number($('#copyVerseTarget').value));
    else count = lyricEngine.searchReplace(state.score, $('#lyricSearchText').value, $('#lyricReplaceText').value, { verse: Number($('#lyricSearchVerse').value) || null });
    commit(state.lyricToolMode === 'copy' ? 'Copy verse' : 'Replace lyrics'); closeDialog('lyricToolsDialog'); toast(`${count} lyric item(s) updated.`, 'success');
  }
  function resetLyricPosition() {
    const { part, event } = getSelected(); if (!part || !event || event.type !== 'note') return toast('Select a lyric-bearing note first.', 'error');
    checkpoint('Reset lyric position'); lyricEngine.resetPosition(state.score, part.id, event.id, Number($('#quickLyricVerse').value) || null); commit('Reset lyric position');
  }


  function initializeMidiStep() {
    state.midiStep = new midi.StepTimeMidiInput(state.score, {
      partId: state.selectedPartId, voice: state.activeVoice, duration: state.duration, cursor: state.cursorBeat
    });
    const supported = Boolean(navigator.requestMIDIAccess);
    $('#connectMidiButton').disabled = !supported;
    $('#midiStatus').textContent = supported ? 'Ready to connect' : 'Web MIDI unavailable in this environment';
  }

  async function connectMidiInput() {
    if (!navigator.requestMIDIAccess) return toast('This browser or desktop shell does not expose Web MIDI.', 'error');
    try {
      state.midiAccess = await navigator.requestMIDIAccess({ sysex: false });
      refreshMidiDevices();
      state.midiAccess.onstatechange = refreshMidiDevices;
      $('#midiStatus').textContent = state.midiAccess.inputs.size ? 'Choose a MIDI keyboard' : 'No MIDI input detected';
    } catch (error) { $('#midiStatus').textContent = 'MIDI permission denied'; toast(error.message || 'MIDI access was denied.', 'error'); }
  }

  function refreshMidiDevices() {
    const select = $('#midiDeviceSelect');
    const previous = select.value;
    const inputs = state.midiAccess ? Array.from(state.midiAccess.inputs.values()) : [];
    select.innerHTML = '<option value="">MIDI keyboard…</option>' + inputs.map(input => `<option value="${escapeHtml(input.id)}">${escapeHtml(input.name || input.manufacturer || 'MIDI input')}</option>`).join('');
    if (inputs.some(input => input.id === previous)) select.value = previous;
    else if (inputs.length === 1) { select.value = inputs[0].id; activateMidiDevice(); }
  }

  function activateMidiDevice() {
    if (!state.midiAccess) return;
    for (const input of state.midiAccess.inputs.values()) input.onmidimessage = null;
    const input = state.midiAccess.inputs.get($('#midiDeviceSelect').value);
    if (!input) { $('#midiStatus').textContent = 'Not connected'; return; }
    input.onmidimessage = handleMidiStepMessage;
    $('#midiStatus').textContent = `Connected: ${input.name || 'MIDI keyboard'}`;
    setStatus(`MIDI step input connected to ${input.name || 'keyboard'}.`);
  }

  function handleMidiStepMessage(message) {
    if (state.shutdown.inProgress) return;
    try {
      const decoded = midi.decodeMidiMessage(message.data);
      const part = state.score.parts.find(item => item.id === state.selectedPartId) || state.score.parts[0];
      state.midiStep.configure({ score: state.score, partId: part.id, voice: state.activeVoice, staff: activeStaffForPart(part), duration: state.duration, cursor: state.cursorBeat });
      if (decoded.type === 'noteon' && !state.midiStep.activeNotes.size) { checkpoint('MIDI step entry'); state.midiTransactionOpen = true; }
      const result = state.midiStep.handle(message);
      if (result.entered.length) {
        invalidateScoreRender('MIDI step preview');
        state.selectedEventId = result.entered.at(-1).id;
        state.selection.selectEvents(result.entered.map(event => event.id));
        renderAll();
      }
      if (decoded.type === 'noteoff' && !state.midiStep.activeNotes.size && state.midiTransactionOpen) {
        state.cursorBeat = state.midiStep.cursor;
        state.midiTransactionOpen = false;
        commit('MIDI step entry');
      }
    } catch (error) { state.midiTransactionOpen = false; toast(error.message, 'error'); }
  }


  function checkpoint(label) {
    state.checkpointRevision = state.score?.revision || 0;
    state.history.snapshot(state.score, label);
  }
  function refreshDirtyState(defaultDirty = true) {
    if (state.baselineRevision == null) state.dirty = defaultDirty;
    else state.dirty = (state.score?.revision || 0) !== state.baselineRevision;
    return state.dirty;
  }
  function invalidateScoreRender(_reason = 'score changed') {
    state.performance.scoreEpoch += 1;
    state.performance.renderIndex = null;
    state.performance.renderIndexEpoch = -1;
    state.performance.signatures.score = '';
    state.performance.signatures.meta = '';
    state.performance.signatures.stats = '';
    state.performance.signatures.parts = '';
    state.performance.signatures.layers = '';
  }
  function commit(label) {
    if ((state.score?.revision || 0) === state.checkpointRevision) model.touch(state.score);
    state.checkpointRevision = null;
    state.history.snapshot(state.score, label);
    invalidateScoreRender(label);
    refreshDirtyState(true);
    $('#dirtyMark').textContent = '• Modified';
    scheduleAutosave();
    renderAll();
  }

  function undo() {
    const score = state.history.undo(state.score);
    if (score === state.score) return toast('Nothing to undo.');
    state.score = model.normalizeScore(score);
    state.selectedPartId = state.score.parts[0]?.id;
    state.selectedEventId = null;
    state.selection.clear();
    invalidateScoreRender('undo');
    refreshDirtyState(true);
    renderAll();
    toast('Undo', 'success');
  }

  function redo() {
    const score = state.history.redo(state.score);
    if (score === state.score) return toast('Nothing to redo.');
    state.score = model.normalizeScore(score);
    state.selectedPartId = state.score.parts[0]?.id;
    state.selectedEventId = null;
    state.selection.clear();
    invalidateScoreRender('redo');
    refreshDirtyState(true);
    renderAll();
    toast('Redo', 'success');
  }

  function setEntryMode(mode) {
    state.mode = mode;
    state.ghost = null;
    document.body.classList.toggle('layout-mode', mode === 'layout');
    $('#noteModeButton').classList.toggle('active', mode === 'note');
    $('#restModeButton').classList.toggle('active', mode === 'rest');
    $('#lyricsModeButton').classList.toggle('active', mode === 'lyrics');
    $$('#simpleEntryPalette [data-entry-mode]').forEach(button => button.classList.toggle('active', button.dataset.entryMode === mode));
    $('#entryHint').textContent = mode === 'note'
      ? `Layer ${state.activeVoice}: move over the staff to preview; click to place${state.chordEntry ? '; chord mode keeps the caret on this beat' : ''}; drag notes to move them`
      : mode === 'rest'
        ? `Layer ${state.activeVoice}: move over a staff to preview the rest; click to place it`
        : mode === 'eraser'
          ? 'Eraser: click a note, rest, lyric, tie or slur to remove only that object.'
          : mode === 'layout'
          ? 'Layout mode: notes are not selected automatically. Drag lyrics or use Layout controls to expand staves without changing playback.'
          : 'Lyrics mode: click a note, type its syllable in the Inspector, then drag the lyric to refine its position';
    renderScore();
  }

  function renderAll() {
    document.body.classList.toggle('layer-colors-enabled', state.score.settings.entryLayerColors !== false);
    if ($('#quickLyricAutoAdvance')) $('#quickLyricAutoAdvance').checked = state.score.settings.lyricAutoAdvance !== false;
    renderMeta();
    renderParts();
    renderLayers();
    if (state.currentView === 'score') renderScore();
    else if (state.currentView === 'solfa') renderSolfa();
    else if (state.currentView === 'mixer') renderMixer();
    renderInspector();
    renderStats();
    renderStatusBar();
    updateHistoryButtons();
    updateTimeline();
  }

  function renderMeta() {
    const score = state.score;
    syncDocumentState();
    const metaSignature = [score.revision || 0, state.dirty, state.readOnly, state.workspace, score.metadata.title, score.metadata.subtitle, score.metadata.dedication, score.metadata.composer, score.metadata.compositionDate, score.metadata.arranger, score.metadata.lyricist, score.metadata.supportingText, score.settings.tempo].join('|');
    if (state.performance.signatures.meta === metaSignature) return;
    state.performance.signatures.meta = metaSignature;
    const openingKey = model.effectiveKey(score, 0);
    const openingTime = model.effectiveTimeSignature(score, 0);
    $('#documentName').textContent = score.metadata.title;
    $('#scoreTitleSmall').textContent = score.metadata.title;
    if (document.activeElement !== $('#pageTitle')) $('#pageTitle').textContent = score.metadata.title;
    if (document.activeElement !== $('#pageSubtitle')) $('#pageSubtitle').textContent = score.metadata.subtitle || '';
    if (document.activeElement !== $('#pageComposer')) $('#pageComposer').textContent = score.metadata.composer || '';
    if (document.activeElement !== $('#pageDedication')) $('#pageDedication').textContent = score.metadata.dedication || '';
    [['pageCompositionDate','compositionDate'],['pageArranger','arranger'],['pageLyricist','lyricist'],['pageSource','source'],['pageCopyright','copyright'],['pageSupportingText','supportingText']].forEach(([id, field]) => { if (document.activeElement !== $(`#${id}`)) $(`#${id}`).textContent = score.metadata[field] || ''; });
    $('#pageMusicalMeta [data-header-edit="key"]').textContent = `Key is ${openingKey} ${/m$/.test(openingKey) ? 'minor' : 'major'}`;
    $('#pageMusicalMeta [data-header-edit="time"]').textContent = `Time: ${openingTime}`;
    $('#pageMusicalMeta [data-header-edit="tempo"]').textContent = `Tempo: ♩ = ${score.settings.tempo}`;
    if (document.activeElement !== $('#solfaTitle')) $('#solfaTitle').textContent = score.metadata.title;
    if (document.activeElement !== $('#solfaDedication')) $('#solfaDedication').textContent = score.metadata.dedication || '';
    if (document.activeElement !== $('#solfaComposer')) $('#solfaComposer').textContent = score.metadata.composer || '';
    $('#solfaKeyLine').textContent = `Tonic: ${openingKey} ${/m$/.test(openingKey) ? 'minor' : 'major'}`;
    $('#solfaTimeLine').textContent = `Time: ${openingTime}`;
    $('#solfaTempoLine').textContent = `Tempo: ♩ = ${score.settings.tempo}`;
    if (document.activeElement !== $('#solfaDate')) $('#solfaDate').textContent = score.metadata.compositionDate || score.metadata.dateText || '';
    if (document.activeElement !== $('#solfaSupporting')) $('#solfaSupporting').textContent = score.metadata.supportingText || '';
    [['solfaArranger','arranger'],['solfaLyricist','lyricist'],['solfaSource','source'],['solfaCopyright','copyright']].forEach(([id, field]) => { if (document.activeElement !== $(`#${id}`)) $(`#${id}`).textContent = score.metadata[field] || ''; });
    $('#keyChip').textContent = `${openingKey} ${/m$/.test(openingKey) ? 'minor' : 'major'}`;
    $('#timeChip').textContent = openingTime;
    $('#tempoInput').value = score.settings.tempo;
    $('#metaTitle').value = score.metadata.title;
    $('#metaComposer').value = score.metadata.composer || '';
    $('#metaCompositionDate').value = score.metadata.compositionDate || score.metadata.dateText || '';
    $('#metaSubtitle').value = score.metadata.subtitle || '';
    $('#metaLyricist').value = score.metadata.lyricist || '';
    $('#metaArranger').value = score.metadata.arranger || '';
    $('#metaSource').value = score.metadata.source || '';
    $('#metaSupportingText').value = score.metadata.supportingText || '';
    $('#metaKey').value = openingKey;
    $('#metaTime').value = openingTime;
    $('#dirtyMark').textContent = state.dirty ? '• Modified' : '';
    $('#solfaModeSelect').value = 'traditional';
    $('#solfaLabelSelect').value = score.settings.solfaLabels || 'short';
    $('#solfaLyricsToggle').checked = score.settings.solfaShowLyrics !== false;
    $('#solfaRhythmToggle').checked = score.settings.solfaShowRhythm !== false;
    $('#solfaVoiceLabelsToggle').checked = score.settings.solfaShowVoiceLabels === true;
    $('#solfaEmptyLayersToggle').checked = score.settings.solfaShowEmptyLayers === true;
    $('#solfaOverlayToggle').checked = score.settings.showSolfa === true;
    $('#solfaOverlayPosition').value = score.settings.solfaOverlayPosition || 'below';
    $('#solfaOverlayScope').value = score.settings.solfaOverlayScope || 'entire-score';
    $('#solfaPitchSystem').value = score.settings.solfaPitchSystem || 'movable-do';
    $('#solfaMinorSystem').value = score.settings.minorSolfaSystem || 'do-based';
    $('#solfaFontSize').value = Number(score.settings.solfaFontSize) || 8;
    $('#solfaVerticalSpacing').value = Number(score.settings.solfaVerticalSpacing) || 12;
    $('#solfaOctaveToggle').checked = score.settings.solfaShowOctaveMarks !== false;
    $('#solfaWarningsToggle').checked = score.settings.solfaShowWarnings !== false;
    const activeConvention = solfa.activeConvention(score);
    $('#solfaConventionNote').textContent = `${activeConvention.name}: ${activeConvention.description}`;
    $('#workspaceSelect').value = state.workspace;
    applyPublicationTextLayouts();
  }

  function renderParts() {
    const partsSignature = [state.performance.scoreEpoch, state.selectedPartId, ...state.score.parts.map(part => `${part.id}:${part.muted ? 1 : 0}:${part.solo ? 1 : 0}:${part.events.length}`)].join('|');
    if (state.performance.signatures.parts === partsSignature) return;
    state.performance.signatures.parts = partsSignature;
    const container = $('#partsList');
    container.innerHTML = '';
    state.score.parts.forEach((part, index) => {
      const row = document.createElement('div');
      row.className = `part-row ${part.id === state.selectedPartId ? 'selected' : ''}`;
      const clefLabel = part.clef === 'grand' ? 'grand staff' : part.clef;
      row.innerHTML = `<div class="part-avatar">${escapeHtml(part.shortName || String(index + 1))}</div><div class="part-info"><strong>${escapeHtml(part.name)}</strong><small>${part.events.filter(e => e.type === 'note').length} notes · ${escapeHtml(clefLabel)}</small></div><div class="part-actions"><button class="mute-button ${part.muted ? 'active' : ''}" title="Mute">M</button><button class="solo-button ${part.solo ? 'active' : ''}" title="Solo">S</button></div>`;
      row.addEventListener('click', event => {
        if (event.target.closest('button')) return;
        state.selectedPartId = part.id;
        state.activeVoice = Number(part.activeVoice) || 1;
        state.selectedEventId = null;
        state.ghost = null;
        renderAll();
      });
      row.querySelector('.mute-button').addEventListener('click', event => {
        event.stopPropagation();
        part.muted = !part.muted;
        commit('Toggle mute');
      });
      row.querySelector('.solo-button').addEventListener('click', event => {
        event.stopPropagation();
        part.solo = !part.solo;
        commit('Toggle solo');
      });
      container.appendChild(row);
    });
  }

  function renderLayers() {
    const layersSignature = `${state.performance.scoreEpoch}|${state.selectedPartId}|${state.activeVoice}`;
    if (state.performance.signatures.layers === layersSignature) return;
    state.performance.signatures.layers = layersSignature;
    const part = state.score.parts.find(item => item.id === state.selectedPartId) || state.score.parts[0];
    const container = $('#layerButtons');
    container.innerHTML = '';
    if (!part) return;
    const layers = [1, 2, 3, 4];
    part.voiceLayers = layers.slice();
    if (!layers.includes(state.activeVoice)) state.activeVoice = 1;
    layers.forEach(voice => {
      const button = document.createElement('button');
      const authored = part.events.filter(event => (event.voice || 1) === voice && event.generatedBy !== 'gap-fill');
      button.className = `layer-button ${voice === state.activeVoice ? 'active' : ''}`;
      button.innerHTML = `<strong>${voice}</strong><span>${authored.length} authored event${authored.length === 1 ? '' : 's'}</span>`;
      button.title = `Activate independent musical Layer ${voice}`;
      button.addEventListener('click', () => setActiveVoice(voice));
      container.appendChild(button);
    });
    $('#voiceLayerSelect').value = String(state.activeVoice);
    $$('#simpleEntryPalette [data-layer]').forEach(button => button.classList.toggle('active', Number(button.dataset.layer) === state.activeVoice));
    renderLayerCapacityInspector(part);
  }

  function activeStaffForPart(part) {
    const selected = getSelected();
    if (selected.part?.id === part.id && selected.event) return selected.event.staff || null;
    return model.isMultiStaff(part) ? model.defaultStaff(part, 72) : null;
  }

  function renderLayerCapacityInspector(part) {
    const panel = $('#layerCapacityInspector');
    if (!panel) return;
    const measureIndex = model.measureIndexAt(state.score, state.cursorBeat);
    const staff = activeStaffForPart(part);
    const report = notations.layerCapacityReport(state.score, part.id, measureIndex, staff);
    panel.innerHTML = `<div class="capacity-header"><strong>Bar ${measureIndex + 1}</strong><span>${escapeHtml(staff || 'single staff')}</span></div>` + report.map(item => {
      const stateClass = item.overfilled ? 'error' : item.incomplete ? 'warning' : 'complete';
      return `<button class="capacity-row ${stateClass} ${item.voice === state.activeVoice ? 'active' : ''}" data-capacity-layer="${item.voice}"><strong>L${item.voice}</strong><span>${formatBeat(item.used)}/${formatBeat(item.capacity)} beats</span><small>${item.authoredNoteCount} notes · ${item.authoredRestCount} entered rests · ${item.calculatedRestCount} calculated</small><em>${item.overfilled ? `Over by ${formatBeat(Math.abs(item.remaining))}` : item.incomplete ? `${formatBeat(item.remaining)} remaining` : 'Complete'}</em></button>`;
    }).join('');
    panel.querySelectorAll('[data-capacity-layer]').forEach(button => button.addEventListener('click', () => setActiveVoice(Number(button.dataset.capacityLayer))));
  }

  function setActiveVoice(voice) {
    const part = state.score.parts.find(item => item.id === state.selectedPartId) || state.score.parts[0];
    if (!part) return;
    state.activeVoice = model.activateVoice(part, voice);
    part.activeVoice = state.activeVoice;
    $('#voiceLayerSelect').value = String(state.activeVoice);
    state.midiStep?.configure({ partId: part.id, voice: state.activeVoice });
    state.selectedEventId = null;
    state.ghost = null;
    state.midiStep?.configure({ partId: part.id, voice: state.activeVoice });
    renderLayers();
    renderScore();
    setStatus(`Voice layer ${state.activeVoice} is active. New notes and rests will be entered in this independent voice.`);
  }

  function partStaffRows(part) {
    if (Array.isArray(part.staffDefinitions) && part.staffDefinitions.length > 1) {
      return part.staffDefinitions.map((staff, index) => ({ staff: staff.id || `staff-${index + 1}`, number: Number(staff.number) || index + 1, clef: staff.clef || (index === 1 ? 'bass' : 'treble') }));
    }
    if (part.clef === 'grand') return [
      { staff: 'treble', number: 1, clef: 'treble' },
      { staff: 'bass', number: 2, clef: 'bass' }
    ];
    return [{ staff: null, number: 1, clef: part.clef || 'treble' }];
  }

  function clefForRowAt(part, row, measureIndex) {
    let clef = row.clef;
    (part.clefChanges || []).filter(change => change.measureIndex <= measureIndex && (change.staff || null) === (row.staff || null)).sort((a, b) => a.measureIndex - b.measureIndex).forEach(change => { clef = change.clef || clef; });
    return clef;
  }

  function pageDimensionsPixels(score = state.score) {
    const landscape = score.settings.orientation === 'landscape';
    const sizes = { A4: [794, 1123], Letter: [816, 1056], Legal: [816, 1344], A3: [1123, 1587] };
    const base = sizes[score.settings.pageSize] || sizes.A4;
    return landscape ? [base[1], base[0]] : [...base];
  }
  function pageWidthPixels(score = state.score) { return pageDimensionsPixels(score)[0]; }
  function pageHeightPixels(score = state.score) { return pageDimensionsPixels(score)[1]; }

  function dynamicMeasuresPerSystem(score = state.score) {
    const marginPixels = (Number(score.settings.margins) || 15) * 3.78;
    const available = pageWidthPixels(score) - 132 - marginPixels * 2 - 28;
    const preferredMeasureWidth = Number(score.settings.measureWidth) || 174;
    return theory.clamp(Math.floor(available / preferredMeasureWidth), 1, 8);
  }

  function buildLayout() {
    const score = state.score;
    const staffX = 132;
    const pageWidth = pageWidthPixels(score);
    const marginPixels = (Number(score.settings.margins) || 15) * 3.78;
    const availableWidth = Math.max(260, pageWidth - staffX - marginPixels - 28);
    const systemPlan = layoutEngine.buildSystemPlan(score, {
      staffX,
      availableWidth,
      minMeasures: 1,
      maxMeasures: 8,
      rightPadding: 28
    });
    const staffLineSpacing = 7;
    const staffHeight = staffLineSpacing * 4;
    const baseStaffGap = Math.max(20, Number(score.settings.staffGap) || 60) - 28;
    const basePartGap = Math.max(20, Number(score.settings.partGap) || 42);
    const systemGap = Math.max(32, Number(score.settings.systemGap) || 50);
    const parts = [];
    let partCursor = 20;

    score.parts.forEach(part => {
      const definitions = partStaffRows(part);
      const rows = [];
      let previous = null;
      definitions.forEach(row => {
        const automaticRequirements = layoutEngine.staffVerticalRequirements(score, part, row.staff || null);
        const manualAfter = model.staffManualAfter(score, part.id, row.staff || null);
        const requirements = { ...automaticRequirements, automaticBelow: automaticRequirements.below, manualAfter, below: automaticRequirements.below + manualAfter };
        let offsetTop;
        if (!previous) offsetTop = partCursor + requirements.above;
        else offsetTop = previous.offsetTop + staffHeight + previous.requirements.below + baseStaffGap + requirements.above;
        const item = { ...row, offsetTop, requirements };
        rows.push(item);
        previous = item;
      });
      const blockTop = rows[0].offsetTop - rows[0].requirements.above;
      const last = rows.at(-1);
      const blockBottom = last.offsetTop + staffHeight + last.requirements.below;
      parts.push({ part, rows, blockTop, blockBottom, center: (rows[0].offsetTop + last.offsetTop + staffHeight) / 2 });
      partCursor = blockBottom + basePartGap;
    });

    const systemHeight = Math.max(130, partCursor + systemGap);
    const measureFrames = new Map();
    const measureToSystem = new Map();
    const pageHeight = pageHeightPixels(score);
    const pageGap = 36;
    const pageUsableBottom = Math.max(systemHeight, pageHeight - marginPixels);
    let pageIndex = 0;
    let pageCursor = 20;
    const systemsData = systemPlan.systems.map((system, index) => {
      if (index > 0 && (system.newPage || pageCursor + systemHeight > pageUsableBottom + EPSILON)) {
        pageIndex += 1;
        pageCursor = marginPixels;
      }
      const y = pageIndex * (pageHeight + pageGap) + pageCursor;
      pageCursor += systemHeight;
      const frames = system.frames.map(frame => ({ ...frame }));
      frames.forEach(frame => {
        measureFrames.set(frame.measureIndex, frame);
        measureToSystem.set(frame.measureIndex, index);
      });
      return {
        index,
        pageIndex,
        firstMeasure: system.measureIndices[0] || 0,
        measureIndices: [...system.measureIndices],
        frames,
        y,
        newPage: Boolean(system.newPage),
        manualBreakBefore: Boolean(system.manualBreakBefore),
        usedWidth: system.usedWidth,
        minimumWidth: system.minimumWidth
      };
    });
    const averageMeasureWidth = systemPlan.profiles.length ? systemPlan.profiles.reduce((sum, item) => sum + item.minWidth, 0) / systemPlan.profiles.length : 174;
    return {
      measuresPerSystem: Math.max(1, ...systemsData.map(item => item.measureIndices.length), 1),
      systems: systemsData.length,
      systemsData,
      measureFrames,
      measureToSystem,
      staffX,
      marginLeft: staffX,
      measureWidth: averageMeasureWidth,
      staffLineSpacing,
      staffHeight,
      systemHeight,
      parts,
      pageWidth,
      pageHeight,
      pageGap,
      pages: Math.max(1, ...systemsData.map(item => item.pageIndex + 1), 1),
      width: Math.max(pageWidth, staffX + availableWidth + 28),
      height: Math.max(300, Math.max(1, ...systemsData.map(item => item.pageIndex + 1)) * pageHeight + Math.max(0, Math.max(1, ...systemsData.map(item => item.pageIndex + 1)) - 1) * pageGap),
      layoutEngineVersion: 4
    };
  }

  function rowForEvent(partLayout, event) {
    if (partLayout.rows.length === 1) return partLayout.rows[0];
    const target = event.staff || model.defaultStaff(partLayout.part, event.midi) || partLayout.rows[0].staff;
    return partLayout.rows.find(row => row.staff === target) || partLayout.rows[0];
  }

  function keyForPart(part, measureIndex = 0) {
    const scoreKey = model.effectiveKey(state.score, measureIndex);
    if (state.score.settings.concertPitch !== false || !part.transpose) return scoreKey;
    return theory.transposeKey(scoreKey, Number(part.transpose || 0));
  }

  function writtenPitch(event, part) {
    const measureIndex = model.measureIndexAt(state.score, event.start);
    return theory.writtenPitchForEvent(event, part, keyForPart(part, measureIndex), state.score.settings.concertPitch !== false);
  }

  function eventY(event, part, row, system) {
    const pitch = writtenPitch(event, part);
    const measureIndex = model.measureIndexAt(state.score, event.start);
    const clef = clefForRowAt(part, row, measureIndex);
    const step = theory.staffStepForPitch(pitch, clef);
    const bottom = systemTop(system) + row.offsetTop + state.layout.staffHeight;
    return bottom - step * (state.layout.staffLineSpacing / 2);
  }

  function systemForMeasure(measureIndex) { return state.layout.measureToSystem?.get(measureIndex) ?? 0; }
  function systemTop(system) { return state.layout?.systemsData?.[system]?.y ?? system * (state.layout?.systemHeight || 0); }
  function systemForY(y) {
    const systems = state.layout?.systemsData || [];
    if (!systems.length) return 0;
    const value = Number(y) || 0;
    let nearest = 0;
    let nearestDistance = Infinity;
    systems.forEach((item, index) => {
      const top = item.y;
      const bottom = top + state.layout.systemHeight;
      if (value >= top && value <= bottom) { nearest = index; nearestDistance = 0; return; }
      const distance = Math.min(Math.abs(value - top), Math.abs(value - bottom));
      if (distance < nearestDistance) { nearest = index; nearestDistance = distance; }
    });
    return nearest;
  }
  function localMeasureIndex(measureIndex) { const system = state.layout.systemsData[systemForMeasure(measureIndex)]; return Math.max(0, system?.measureIndices.indexOf(measureIndex) ?? 0); }
  function measureFrame(measureIndex) { return state.layout.measureFrames?.get(measureIndex) || { measureIndex, x: state.layout.staffX + localMeasureIndex(measureIndex) * state.layout.measureWidth, width: state.layout.measureWidth, right: state.layout.staffX + (localMeasureIndex(measureIndex) + 1) * state.layout.measureWidth, profile: layoutEngine.measureContentProfile(state.score, measureIndex) }; }
  function measureX(measureIndex) { return measureFrame(measureIndex).x; }
  function measureAttributeInset(measureIndex) {
    const firstInSystem = localMeasureIndex(measureIndex) === 0;
    const measure = state.score.measures[measureIndex];
    const previousKey = measureIndex ? model.effectiveKey(state.score, measureIndex - 1) : null;
    const previousTime = measureIndex ? model.effectiveTimeSignature(state.score, measureIndex - 1) : null;
    const keyChanged = measureIndex === 0 || model.effectiveKey(state.score, measureIndex) !== previousKey || Boolean(measure.key);
    const timeChanged = measureIndex === 0 || model.effectiveTimeSignature(state.score, measureIndex) !== previousTime || Boolean(measure.timeSignature);
    if (firstInSystem) return 78;
    if (keyChanged || timeChanged) return 48;
    return 14;
  }
  function measureRight(measureIndex) { return measureFrame(measureIndex).right; }

  function scoreLayoutSignature(layout = state.layout || buildLayout()) {
    const settings = state.score.settings || {};
    const partShape = state.score.parts.map(part => `${part.id}:${part.clef}:${(part.staffDefinitions || []).map(row => `${row.id}:${row.clef}`).join(',')}:${part.braceGroup || ''}:${part.bracketGroup || ''}`).join('|');
    return [
      state.score.measures.length, layout.measuresPerSystem, layout.measureWidth.toFixed(3), layout.systemHeight.toFixed(3),
      settings.pageSize, settings.orientation, settings.margins, settings.staffGap, settings.partGap, settings.systemGap,
      settings.showSolfa, settings.solfaOverlayPosition, settings.solfaFontSize, settings.solfaVerticalSpacing, partShape
    ].join('~');
  }

  function renderIndexForLayout(layout) {
    const layoutSignature = scoreLayoutSignature(layout);
    if (state.performance.renderIndex && state.performance.renderIndexEpoch === state.performance.scoreEpoch && state.performance.renderIndexLayout === layoutSignature) return state.performance.renderIndex;
    const byPartSystem = new Map();
    const chordGroups = new Map();
    const positionGroups = new Map();
    const voicesByPosition = new Map();
    const eventRefs = new Map();
    for (const part of state.score.parts) {
      for (const event of part.events || []) {
        eventRefs.set(event.id, { part, event });
        if (event.hidden) continue;
        const measureIndex = model.measureIndexAt(state.score, event.start);
        const system = layout.measureToSystem?.get(measureIndex) ?? 0;
        const partSystemKey = `${part.id}|${system}`;
        if (!byPartSystem.has(partSystemKey)) byPartSystem.set(partSystemKey, []);
        byPartSystem.get(partSystemKey).push(event);
        const staff = event.staff || '';
        const voice = Number(event.voice) || 1;
        const positionKey = `${part.id}|${system}|${staff}|${Number(event.start).toFixed(8)}`;
        if (!voicesByPosition.has(positionKey)) voicesByPosition.set(positionKey, new Set());
        if (event.generatedBy !== 'gap-fill') voicesByPosition.get(positionKey).add(voice);
        if (event.type === 'note') {
          const chordKey = `${part.id}|${system}|${staff}|${voice}|${Number(event.start).toFixed(8)}`;
          if (!chordGroups.has(chordKey)) chordGroups.set(chordKey, []);
          chordGroups.get(chordKey).push(event);
          if (!positionGroups.has(positionKey)) positionGroups.set(positionKey, []);
          positionGroups.get(positionKey).push(event);
        }
      }
    }
    const index = { byPartSystem, chordGroups, positionGroups, voicesByPosition, eventRefs, layoutSignature };
    state.performance.renderIndex = index;
    state.performance.renderIndexEpoch = state.performance.scoreEpoch;
    state.performance.renderIndexLayout = layoutSignature;
    return index;
  }

  function renderContextForEvent(index, part, event, system) {
    const staff = event.staff || '';
    const voice = Number(event.voice) || 1;
    const chordKey = `${part.id}|${system}|${staff}|${voice}|${Number(event.start).toFixed(8)}`;
    const positionKey = `${part.id}|${system}|${staff}|${Number(event.start).toFixed(8)}`;
    return {
      chordMembers: index.chordGroups.get(chordKey) || [event],
      simultaneousNotes: index.positionGroups.get(positionKey) || [event],
      voicesHere: index.voicesByPosition.get(positionKey) || new Set([voice])
    };
  }

  function refreshPlaybackClasses() {
    for (const group of state.performance.playActiveGroups) group.classList.remove('play-active');
    state.performance.playActiveGroups.clear();
    if (state.playBeat < 0 || !state.performance.domEventGroups.length) return;
    const beat = state.playBeat;
    const items = state.performance.domEventGroups;
    let low = 0, high = items.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (items[mid].start <= beat + EPSILON) low = mid + 1;
      else high = mid;
    }
    const earliest = beat - Math.max(.0625, state.performance.maxDomDuration || 0);
    for (let index = low - 1; index >= 0 && items[index].start >= earliest - EPSILON; index -= 1) {
      const item = items[index];
      if (beat >= item.start - EPSILON && beat < item.start + item.duration - EPSILON) {
        item.group.classList.add('play-active');
        state.performance.playActiveGroups.add(item.group);
      }
    }
  }

  function refreshScoreDecorations(svg = $('#notationCanvas svg')) {
    if (!svg || !state.layout) return false;
    svg.querySelectorAll('.note-group').forEach(group => {
      const id = group.dataset.eventId;
      const voice = Number(group.dataset.voice) || 1;
      group.classList.toggle('selected', id === state.selectedEventId);
      group.classList.toggle('multi-selected', state.selection.hasEvent(id));
      group.classList.toggle('active-layer', voice === state.activeVoice);
    });
    svg.querySelectorAll('.staff-solfa-overlay[data-event-id]').forEach(item => item.classList.toggle('selected', item.dataset.eventId === state.selectedEventId));
    svg.querySelectorAll('.notation-spanner[data-spanner-id]').forEach(item => item.classList.toggle('selected', item.dataset.spannerId === state.selectedSpannerId));
    svg.querySelectorAll('.score-annotation[data-annotation-id]').forEach(item => item.classList.toggle('selected', item.dataset.annotationId === state.selectedAnnotationId));
    svg.querySelectorAll('.ghost-note,.selection-marquee,.notation-caret,.playhead-layer,.measure-highlight').forEach(item => item.remove());
    const activeBeat = state.playBeat >= 0 ? state.playBeat : state.cursorBeat;
    const activeMeasure = model.measureIndexAt(state.score, activeBeat);
    const system = systemForMeasure(activeMeasure);
    const systemData = state.layout.systemsData[system];
    if (systemData) {
      const highlight = svgEl('rect', {
        x: measureX(activeMeasure), y: systemData.y + 4, width: measureFrame(activeMeasure).width,
        height: state.layout.parts.at(-1)?.blockBottom + 18 || 70, class: 'measure-highlight'
      });
      svg.insertBefore(highlight, svg.firstChild);
    }
    if (state.ghost) drawGhost(svg, state.ghost);
    if (state.drag?.preview) drawDragPreview(svg, state.drag.preview);
    if (state.selectionMarquee) drawSelectionMarquee(svg, state.selectionMarquee);
    drawNotationCaret(svg);
    refreshPlaybackClasses();
    drawPlayhead(svg);
    updateTimeline();
    state.performance.metrics.fastScoreRefreshes += 1;
    return true;
  }

  function bindScoreDelegates(svg) {
    svg.addEventListener('click', event => {
      const lyric = event.target.closest('.score-lyric');
      if (lyric) return;
      const spannerEl = event.target.closest('.notation-spanner[data-spanner-id]');
      if (spannerEl) {
        event.stopPropagation();
        const spanner = (state.score.spanners || []).find(item => item.id === spannerEl.dataset.spannerId);
        if (!spanner) return;
        if (state.mode === 'eraser') { checkpoint(`Erase ${spanner.type}`); model.removeSpanner(state.score, spanner.id); commit(`Erase ${spanner.type}`); return; }
        state.selectedSpannerId = spanner.id;
        state.selection.selectEvents([spanner.startEventId, spanner.endEventId]);
        renderScore();
        setStatus(`${spanner.type === 'tie' ? 'Tie' : 'Slur'} selected.`);
        return;
      }
      const annotationEl = event.target.closest('.score-annotation[data-annotation-id]');
      if (annotationEl) {
        event.stopPropagation();
        if (Date.now() < state.suppressClickUntil) return;
        const annotation = (state.score.annotations || []).find(item => item.id === annotationEl.dataset.annotationId);
        if (!annotation) return;
        if (state.mode === 'eraser') {
          checkpoint('Erase anchored text');
          model.deleteAnnotation(state.score, annotation.id);
          state.selectedAnnotationId = null;
          commit('Erase anchored text');
          return;
        }
        state.selectedAnnotationId = annotation.id;
        state.cursorBeat = Number(annotation.start) || 0;
        openAnchoredTextDialog(annotation.type, annotation.id);
        return;
      }
      const overlay = event.target.closest('.staff-solfa-overlay[data-event-id]');
      const group = event.target.closest('.note-group[data-event-id]');
      const target = overlay || group;
      if (!target) return;
      event.stopPropagation();
      const ref = model.findEvent(state.score, target.dataset.eventId);
      if (!ref || ref.event.generatedBy === 'gap-fill') return;
      if (state.mode === 'layout') { setStatus(ref.event.type === 'rest' ? 'Layout mode is active; the rest remains unselected.' : 'Layout mode is active. The note remains unselected; drag lyrics or adjust staff spacing from Layout.'); return; }
      if (state.mode === 'eraser') { checkpoint(`Erase ${ref.event.type}`); notations.erase(state.score, { kind: 'event', partId: ref.part.id, eventId: ref.event.id }); commit(`Erase ${ref.event.type}`); return; }
      selectEvent(ref.part.id, ref.event.id, { additive: event.shiftKey, toggle: event.shiftKey });
      if (state.mode === 'lyrics') { $('#quickLyricText').focus(); $('#quickLyricText').select(); }
    });
    svg.addEventListener('pointerdown', event => {
      const annotationEl = event.target.closest('.score-annotation[data-annotation-id]');
      if (annotationEl && state.mode !== 'eraser') {
        const annotation = (state.score.annotations || []).find(item => item.id === annotationEl.dataset.annotationId);
        if (annotation) { beginAnnotationDrag(event, annotation, annotationEl); return; }
      }
      const lyricEl = event.target.closest('.score-lyric[data-event-id]');
      if (lyricEl) {
        const ref = model.findEvent(state.score, lyricEl.dataset.eventId);
        if (!ref) return;
        const verse = Number(lyricEl.dataset.verse) || 1;
        const lyric = (ref.event.lyrics || []).find(item => String(item.id || '') === String(lyricEl.dataset.lyricId || '') || (Number(item.verse) || 1) === verse);
        if (!lyric) return;
        if (state.mode === 'eraser') { event.preventDefault(); event.stopPropagation(); checkpoint('Erase lyric'); notations.erase(state.score, { type: 'lyric', id: lyric.id, noteId: ref.event.id }); commit('Erase lyric'); return; }
        beginLyricDrag(event, ref.part, ref.event, lyric);
        return;
      }
      const group = event.target.closest('.note-group[data-event-id]');
      if (!group || ['eraser','layout'].includes(state.mode) || event.shiftKey) return;
      const ref = model.findEvent(state.score, group.dataset.eventId);
      if (!ref || ref.event.generatedBy === 'gap-fill') return;
      const partLayout = state.layout.parts.find(item => item.part.id === ref.part.id);
      if (!partLayout) return;
      const system = Number(group.dataset.system) || 0;
      const row = rowForEvent(partLayout, ref.event);
      beginDrag(event, ref.part, ref.event, row, system);
    });
  }

  function drawScoreTextAndHarmony(svg, systemData) {
    const system = systemData.index;
    const systemY = systemData.y;
    const firstBounds = model.measureBounds(state.score, systemData.firstMeasure);
    const lastBounds = model.measureBounds(state.score, systemData.measureIndices.at(-1));
    const start = firstBounds.start;
    const end = lastBounds.end;
    const stack = new Map();
    const nextStack = key => { const value = stack.get(key) || 0; stack.set(key, value + 1); return value; };

    for (const annotation of state.score.annotations || []) {
      const beat = Number(annotation.start) || 0;
      if (['page', 'header', 'footer'].includes(annotation.scope) || beat < start - EPSILON || beat >= end - EPSILON) continue;
      const partLayout = annotation.partId ? state.layout.parts.find(item => item.part.id === annotation.partId) : null;
      let y;
      let anchor = 'start';
      if (!partLayout || annotation.scope === 'system' || annotation.scope === 'measure') {
        const key = `system:${annotation.placement}`;
        const index = nextStack(key);
        y = annotation.placement === 'below'
          ? systemY + state.layout.parts.at(-1).blockBottom + 16 + index * 13
          : systemY + state.layout.parts[0].blockTop - 13 - index * 13;
      } else {
        const row = partLayout.rows.find(item => (item.staff || null) === (annotation.staff || null)) || partLayout.rows[0];
        const key = `${annotation.partId}:${annotation.staff || 'single'}:${annotation.placement}`;
        const index = nextStack(key);
        y = annotation.placement === 'below'
          ? systemY + row.offsetTop + state.layout.staffHeight + row.requirements.below - 4 + index * 13
          : systemY + row.offsetTop - 9 - index * 13;
      }
      const x = xForBeat(beat) + (Number(annotation.offsetX) || 0);
      y += Number(annotation.offsetY) || 0;
      const rehearsal = annotation.type === 'rehearsal';
      const text = svgText(annotation.text, x, y, {
        class: `score-annotation annotation-${annotation.type || 'text'} ${annotation.id === state.selectedAnnotationId ? 'selected' : ''}`,
        'data-annotation-id': annotation.id,
        'font-size': rehearsal ? 10 : annotation.type === 'tempo-text' ? 10 : 9,
        'font-family': annotation.type === 'tempo-text' ? 'Georgia' : 'Arial',
        'font-weight': rehearsal ? 800 : annotation.type === 'system-text' ? 700 : 500,
        'text-anchor': anchor,
        fill: '#1a2430',
        role: 'button',
        'aria-label': `${annotation.type || 'text'}: ${annotation.text}`
      });
      svg.appendChild(text);
    }

    for (const symbol of state.score.chordSymbols || []) {
      const beat = Number(symbol.start) || 0;
      if (beat < start - EPSILON || beat >= end - EPSILON) continue;
      const partLayout = state.layout.parts.find(item => item.part.id === symbol.partId) || state.layout.parts[0];
      if (!partLayout) continue;
      const row = partLayout.rows.find(item => (item.staff || null) === (symbol.staff || null)) || partLayout.rows[0];
      const x = xForBeat(beat) + (Number(symbol.offsetX) || 0);
      const index = nextStack(`chord:${partLayout.part.id}:${row.staff || 'single'}`);
      const y = systemY + row.offsetTop - 11 - index * 13 + (Number(symbol.offsetY) || 0);
      svg.appendChild(svgText(symbol.text || symbol.symbol || 'C', x, y, {
        class: 'score-chord-symbol', 'font-size': 10, 'font-family': 'Georgia', 'font-weight': 700,
        'text-anchor': 'middle', fill: '#17202a', 'data-chord-symbol-id': symbol.id || ''
      }));
    }
  }

  function drawPageSheets(svg, layout) {
    for (let page = 0; page < layout.pages; page += 1) {
      const top = page * (layout.pageHeight + layout.pageGap);
      svg.appendChild(svgEl('rect', { x: 0, y: top, width: layout.pageWidth, height: layout.pageHeight, class: 'score-page-sheet', 'data-score-page': page + 1 }));
      if (page < layout.pages - 1) svg.appendChild(svgEl('rect', { x: 0, y: top + layout.pageHeight, width: layout.pageWidth, height: layout.pageGap, class: 'score-page-gap', 'aria-hidden': 'true' }));
      if (layout.pages > 1) svg.appendChild(svgText(`Page ${page + 1}`, layout.pageWidth - 18, top + layout.pageHeight - 12, { class: 'score-page-number', 'font-size': 8, 'text-anchor': 'end', fill: '#868b92' }));
    }
  }

  function drawPageAnnotations(svg, layout) {
    const margin = Math.max(18, (Number(state.score.settings.margins) || 15) * 3.78);
    const stackByPage = new Map();
    const nextStack = key => { const value = stackByPage.get(key) || 0; stackByPage.set(key, value + 1); return value; };
    for (const annotation of state.score.annotations || []) {
      if (!['page', 'header', 'footer'].includes(annotation.scope)) continue;
      const pageIndex = theory.clamp(Number(annotation.pageIndex) || 0, 0, Math.max(0, layout.pages - 1));
      const pageTop = pageIndex * (layout.pageHeight + layout.pageGap);
      const alignment = ['left', 'center', 'right'].includes(annotation.alignment) ? annotation.alignment : 'center';
      const anchor = alignment === 'left' ? 'start' : alignment === 'right' ? 'end' : 'middle';
      const xBase = alignment === 'left' ? margin : alignment === 'right' ? layout.pageWidth - margin : layout.pageWidth / 2;
      const slot = nextStack(`${pageIndex}:${annotation.scope}:${annotation.placement || 'above'}`);
      let yBase;
      if (annotation.scope === 'footer') yBase = pageTop + layout.pageHeight - margin - slot * 13;
      else if (annotation.scope === 'header') yBase = pageTop + Math.max(20, margin * .45) + slot * 13;
      else yBase = annotation.placement === 'below'
        ? pageTop + layout.pageHeight - margin - 20 - slot * 13
        : pageTop + margin + 20 + slot * 13;
      svg.appendChild(svgText(annotation.text, xBase + (Number(annotation.offsetX) || 0), yBase + (Number(annotation.offsetY) || 0), {
        class: `score-annotation annotation-${annotation.type || 'page-text'} ${annotation.id === state.selectedAnnotationId ? 'selected' : ''}`,
        'data-annotation-id': annotation.id,
        'font-size': annotation.scope === 'header' ? 10 : 9,
        'font-family': annotation.scope === 'header' ? 'Georgia' : 'Arial',
        'font-weight': annotation.scope === 'header' ? 700 : 500,
        'text-anchor': anchor,
        fill: '#1a2430',
        role: 'button',
        'aria-label': `${annotation.type || annotation.scope}: ${annotation.text}`
      }));
    }
  }

  function renderScore() {
    const canvas = $('#notationCanvas');
    const score = state.score;
    const nextLayout = buildLayout();
    const nextLayoutSignature = scoreLayoutSignature(nextLayout);
    const existingSvg = canvas.querySelector('svg');
    if (existingSvg && state.performance.renderedScoreEpoch === state.performance.scoreEpoch && state.performance.layoutSignature === nextLayoutSignature) {
      state.layout = nextLayout;
      refreshScoreDecorations(existingSvg);
      return;
    }
    state.layout = nextLayout;
    const layout = state.layout;
    const renderIndex = renderIndexForLayout(layout);
    const svg = svgEl('svg', { viewBox: `0 0 ${layout.width} ${layout.height}`, role: 'img', 'aria-label': 'Editable music notation score with independent voice layers' });
    svg.dataset.exportTitle = score.metadata.title;
    drawPageSheets(svg, layout);
    const activeBeat = state.playBeat >= 0 ? state.playBeat : state.cursorBeat;
    const activeMeasure = model.measureIndexAt(score, activeBeat);

    layout.systemsData.forEach(systemData => {
      const system = systemData.index;
      const systemY = systemData.y;
      const firstMeasure = systemData.firstMeasure;
      const visibleMeasureCount = systemData.measureIndices.length;
      if (systemData.measureIndices.includes(activeMeasure)) {
        const x = measureX(activeMeasure);
        svg.appendChild(svgEl('rect', { x, y: systemY + 4, width: measureFrame(activeMeasure).width, height: layout.parts.at(-1)?.blockBottom + 18 || 70, class: 'measure-highlight' }));
      }

      layout.parts.forEach((partLayout, partIndex) => {
        const { part, rows } = partLayout;
        const blockTop = systemY + partLayout.blockTop;
        const blockBottom = systemY + partLayout.blockBottom;
        svg.appendChild(svgText(part.shortName || part.name, 7, systemY + partLayout.center + 3, { 'font-size': 10, 'font-family': 'Arial', 'font-weight': 700, fill: '#1a2430' }));

        rows.forEach(row => {
          const top = systemY + row.offsetTop;
          drawStaffLines(svg, top, layout.staffX, systemData.frames.at(-1)?.right || layout.staffX);
          const openingClef = clefForRowAt(part, row, firstMeasure);
          drawClef(svg, openingClef, layout.staffX + 18, top);
          drawKeySignature(svg, openingClef, layout.staffX + 38, top, keyForPart(part, firstMeasure));
          if (system === 0 || score.measures[firstMeasure]?.timeSignature) drawTimeSignature(svg, layout.staffX + 62, top, model.effectiveTimeSignature(score, firstMeasure));

          const hit = svgEl('rect', { x: layout.staffX, y: top - 17, width: (systemData.frames.at(-1)?.right || layout.staffX) - layout.staffX, height: layout.staffHeight + 34, class: 'staff-hit', 'data-part-id': part.id, 'data-system': system, 'data-staff': row.staff || '', 'data-clef': openingClef, 'data-top': top });
          hit.addEventListener('pointerdown', event => { if (event.altKey) beginMarquee(event); });
          hit.addEventListener('pointermove', handleStaffPointerMove);
          hit.addEventListener('pointerleave', handleStaffPointerLeave);
          hit.addEventListener('click', handleStaffClick);
          svg.appendChild(hit);
        });

        if (rows.length > 1) drawAttachedBrace(svg, blockTop, blockBottom);

        systemData.measureIndices.forEach((measureIndex, localIndex) => {
          const frame = measureFrame(measureIndex);
          const x = frame.x;
          const measure = score.measures[measureIndex];
          const right = frame.right;
          const heavyRight = localIndex === visibleMeasureCount - 1 || measureIndex === score.measures.length - 1;
          svg.appendChild(svgEl('line', { x1: x, x2: x, y1: blockTop, y2: blockBottom, stroke: '#252b32', 'stroke-width': localIndex === 0 ? 1.15 : .8 }));
          svg.appendChild(svgEl('line', { x1: right, x2: right, y1: blockTop, y2: blockBottom, stroke: '#252b32', 'stroke-width': heavyRight ? 1.6 : .8 }));
          if (partIndex === 0) {
            svg.appendChild(svgText(String(measure.number || measureIndex + 1), x + 4, blockTop - 9, { 'font-size': 8, fill: '#6f737a' }));
            const globalTop = systemY + layout.parts[0].blockTop;
            const globalBottom = systemY + layout.parts.at(-1).blockBottom;
            drawRepeatAndEnding(svg, measureIndex, x, right, globalTop, globalBottom);
          }
          rows.forEach(row => {
            const top = systemY + row.offsetTop;
            const clef = clefForRowAt(part, row, measureIndex);
            const previousClef = measureIndex ? clefForRowAt(part, row, measureIndex - 1) : clef;
            const previousKey = measureIndex ? keyForPart(part, measureIndex - 1) : null;
            const previousTime = measureIndex ? model.effectiveTimeSignature(score, measureIndex - 1) : null;
            let attrX = x + 9;
            if (measureIndex !== firstMeasure && clef !== previousClef) { drawClef(svg, clef, attrX + 8, top); attrX += 28; }
            if (measureIndex !== firstMeasure && (measure.key || keyForPart(part, measureIndex) !== previousKey)) { drawKeySignature(svg, clef, attrX, top, keyForPart(part, measureIndex)); attrX += 22; }
            if (measureIndex !== firstMeasure && (measure.timeSignature || model.effectiveTimeSignature(score, measureIndex) !== previousTime)) drawTimeSignature(svg, attrX, top, model.effectiveTimeSignature(score, measureIndex));
          });
          drawMeasureCapacity(svg, part, measureIndex, x, blockTop);
        });

        const systemStart = model.measureBounds(score, firstMeasure).start;
        const lastMeasure = systemData.measureIndices.at(-1);
        const systemEnd = model.measureBounds(score, lastMeasure).end;
        const events = renderIndex.byPartSystem.get(`${part.id}|${system}`) || [];
        events.forEach(event => {
          const row = rowForEvent(partLayout, event);
          const top = systemY + row.offsetTop;
          const bottom = top + layout.staffHeight;
          const x = xForBeat(event.start);
          if (event.type === 'rest') drawRest(svg, event, x, top + layout.staffHeight / 2, part, row, system);
          else drawNote(svg, event, x, eventY(event, part, row, system), top, bottom, part, row, system, renderContextForEvent(renderIndex, part, event, system));
        });
      });
      drawScoreTextAndHarmony(svg, systemData);
      drawGroupBrackets(svg, system);
    });
    drawPageAnnotations(svg, layout);

    if (state.ghost) drawGhost(svg, state.ghost);
    if (state.drag?.preview) drawDragPreview(svg, state.drag.preview);
    if (state.selectionMarquee) drawSelectionMarquee(svg, state.selectionMarquee);
    drawSpanners(svg);
    drawNotationCaret(svg);
    drawPlayhead(svg);
    bindScoreDelegates(svg);
    canvas.replaceChildren(svg);
    state.performance.domEventGroups = Array.from(svg.querySelectorAll('.note-group[data-start]')).map(group => ({
      group, start: Number(group.dataset.start) || 0, duration: Number(group.dataset.duration) || .5
    })).sort((a, b) => a.start - b.start);
    state.performance.maxDomDuration = state.performance.domEventGroups.reduce((maximum, item) => Math.max(maximum, item.duration), 0);
    state.performance.playActiveGroups.clear();
    state.performance.renderedScoreEpoch = state.performance.scoreEpoch;
    state.performance.layoutSignature = nextLayoutSignature;
    state.performance.metrics.fullScoreRenders += 1;
    updatePlaybackCursor();
  }

  function eventRenderPoint(eventId) {
    const ref = model.findEvent(state.score, eventId);
    if (!ref || ref.event.type !== 'note') return null;
    const measureIndex = model.measureIndexAt(state.score, ref.event.start);
    const system = systemForMeasure(measureIndex);
    const partLayout = state.layout.parts.find(item => item.part.id === ref.part.id);
    if (!partLayout) return null;
    const row = rowForEvent(partLayout, ref.event);
    return { ref, system, row, x: xForBeat(ref.event.start), y: eventY(ref.event, ref.part, row, system), staffTop: systemTop(system) + row.offsetTop };
  }

  function spannerDirection(spanner, start) {
    if (spanner.direction === 'above' || spanner.direction === 'below') return spanner.direction;
    const voice = Number(start.ref.event.voice) || 1;
    return spanner.type === 'tie' ? (voice % 2 === 1 ? 'below' : 'above') : (voice % 2 === 1 ? 'above' : 'below');
  }

  function spannerCurvePath(x1, y1, x2, y2, direction, height) {
    const sign = direction === 'above' ? -1 : 1;
    const midX = (x1 + x2) / 2;
    const midY = (y1 + y2) / 2 + sign * height;
    return `M ${x1} ${y1} Q ${midX} ${midY} ${x2} ${y2}`;
  }

  function drawSpanners(svg) {
    for (const spanner of state.score.spanners || []) {
      const start = eventRenderPoint(spanner.startEventId);
      const end = eventRenderPoint(spanner.endEventId);
      if (!start || !end || start.ref.part.id !== end.ref.part.id) continue;
      const direction = spannerDirection(spanner, start);
      const sign = direction === 'above' ? -1 : 1;
      const noteOffset = spanner.type === 'tie' ? 5 : 8;
      const y1 = start.y + sign * noteOffset + Number(spanner.placementOffset || 0);
      const y2 = end.y + sign * noteOffset + Number(spanner.placementOffset || 0);
      const paths = [];
      if (start.system === end.system) {
        paths.push(spannerCurvePath(start.x + 3, y1, end.x - 3, y2, direction, spanner.type === 'tie' ? 8 : 15));
      } else {
        const right = (state.layout.systemsData[start.system].frames.at(-1)?.right || state.layout.staffX) - 7;
        const left = state.layout.staffX + 7;
        paths.push(spannerCurvePath(start.x + 3, y1, right, y1, direction, spanner.type === 'tie' ? 8 : 14));
        paths.push(spannerCurvePath(left, y2, end.x - 3, y2, direction, spanner.type === 'tie' ? 8 : 14));
      }
      paths.forEach(pathData => {
        const path = svgEl('path', { d: pathData, class: `notation-spanner ${spanner.type} ${spanner.id === state.selectedSpannerId ? 'selected' : ''}`, fill: 'none', 'data-spanner-id': spanner.id, role: 'button', 'aria-label': `${spanner.type} between selected notes` });
        svg.appendChild(path);
      });
    }
  }

  function drawNotationCaret(svg) {
    if (state.currentView !== 'score' || !['note','rest','lyrics'].includes(state.mode)) return;
    const part = state.score.parts.find(item => item.id === state.selectedPartId) || state.score.parts[0];
    const partLayout = state.layout.parts.find(item => item.part.id === part?.id);
    if (!partLayout) return;
    const measureIndex = model.measureIndexAt(state.score, state.cursorBeat);
    const system = systemForMeasure(measureIndex);
    const selected = getSelected();
    const staff = selected.part?.id === part.id && selected.event ? selected.event.staff || null : activeStaffForPart(part);
    const row = partLayout.rows.find(item => (item.staff || null) === (staff || null)) || partLayout.rows[0];
    const top = systemTop(system) + row.offsetTop - 8;
    const x = xForBeat(state.cursorBeat);
    const caret = svgEl('g', { class: 'notation-caret', 'aria-label': `Notation caret at bar ${measureIndex + 1}, layer ${state.activeVoice}` });
    caret.appendChild(svgEl('line', { x1: x, x2: x, y1: top, y2: top + state.layout.staffHeight + 16 }));
    caret.appendChild(svgEl('circle', { cx: x, cy: top - 2, r: 2.4 }));
    svg.appendChild(caret);
  }

  function drawAttachedBrace(svg, top, bottom) {
    const x = state.layout.staffX - 10;
    const h = bottom - top;
    const mid = top + h / 2;
    const path = `M ${x + 9} ${top} C ${x + 1} ${top}, ${x + 1} ${top + h * .2}, ${x + 6} ${mid - 5} C ${x + 1} ${mid - 2}, ${x + 1} ${mid + 2}, ${x + 6} ${mid + 5} C ${x + 1} ${bottom - h * .2}, ${x + 1} ${bottom}, ${x + 9} ${bottom}`;
    svg.appendChild(svgEl('path', { d: path, fill: 'none', stroke: '#141a21', 'stroke-width': 2.1, class: 'attached-brace' }));
    svg.appendChild(svgEl('line', { x1: state.layout.staffX, x2: state.layout.staffX, y1: top, y2: bottom, stroke: '#141a21', 'stroke-width': 1.2 }));
  }

  function drawRepeatAndEnding(svg, measureIndex, left, right, top, bottom) {
    const measure = state.score.measures[measureIndex];
    if (measure.repeatStart) {
      svg.appendChild(svgEl('line', { x1: left + 4, x2: left + 4, y1: top, y2: bottom, stroke: '#171d24', 'stroke-width': 2.1 }));
      svg.appendChild(svgEl('circle', { cx: left + 10, cy: top + state.layout.staffLineSpacing * 1.5, r: 1.45, fill: '#171d24' }));
      svg.appendChild(svgEl('circle', { cx: left + 10, cy: top + state.layout.staffLineSpacing * 2.5, r: 1.45, fill: '#171d24' }));
    }
    if (measure.repeatEnd) {
      svg.appendChild(svgEl('line', { x1: right - 4, x2: right - 4, y1: top, y2: bottom, stroke: '#171d24', 'stroke-width': 2.1 }));
      svg.appendChild(svgEl('circle', { cx: right - 10, cy: top + state.layout.staffLineSpacing * 1.5, r: 1.45, fill: '#171d24' }));
      svg.appendChild(svgEl('circle', { cx: right - 10, cy: top + state.layout.staffLineSpacing * 2.5, r: 1.45, fill: '#171d24' }));
      svg.appendChild(svgText(`×${measure.repeatTimes || 2}`, right - 4, top - 9, { 'font-size': 7, 'text-anchor': 'end', fill: '#5f6670' }));
    }
    if (measure.endings?.length) {
      const y = top - 18;
      svg.appendChild(svgEl('path', { d: `M ${left + 1} ${y + 7} L ${left + 1} ${y} L ${right - 2} ${y}`, fill: 'none', stroke: '#171d24', 'stroke-width': 1 }));
      svg.appendChild(svgText(`${measure.endings.join(',')}.`, left + 7, y - 2, { 'font-size': 8, 'font-weight': 700, fill: '#171d24' }));
    }
    if (measure.rehearsalMark) {
      svg.appendChild(svgText(measure.rehearsalMark, left + 20, top - 28, { 'font-size': 9, 'font-weight': 800, fill: '#111820' }));
    }
  }

  function drawStaffLines(svg, top, x1, x2) {
    for (let line = 0; line < 5; line += 1) {
      const y = top + line * state.layout.staffLineSpacing;
      svg.appendChild(svgEl('line', { x1, x2, y1: y, y2: y, stroke: '#272d35', 'stroke-width': .75 }));
    }
  }

  function drawClef(svg, clef, x, top) {
    const data = clef === 'bass'
      ? { symbol: '𝄢', size: 30, y: top + 24 }
      : clef === 'alto'
        ? { symbol: '𝄡', size: 31, y: top + 25 }
        : clef === 'tenor'
          ? { symbol: '𝄡', size: 31, y: top + 18 }
          : { symbol: '𝄞', size: 35, y: top + 28 };
    svg.appendChild(svgText(data.symbol, x, data.y, {
      class: 'clef-symbol', 'font-size': data.size, 'text-anchor': 'middle'
    }));
    if (clef === 'treble-8') svg.appendChild(svgText('8', x, top + 40, {
      'font-size': 8, 'font-family': 'Georgia', 'font-weight': 700, 'text-anchor': 'middle', fill: '#101820'
    }));
  }

  function drawKeySignature(svg, clef, x, top, key) {
    const count = theory.keySignatureCount(key);
    if (!count) return;
    const sharpSteps = { treble: [8, 5, 9, 6, 3, 7, 4], bass: [6, 3, 7, 4, 1, 5, 2], alto: [7, 4, 8, 5, 2, 6, 3], tenor: [5, 2, 6, 3, 7, 4, 8] };
    const flatSteps = { treble: [4, 7, 3, 6, 2, 5, 1], bass: [2, 5, 1, 4, 0, 3, -1], alto: [3, 6, 2, 5, 1, 4, 0], tenor: [1, 4, 0, 3, -1, 2, -2] };
    const normalizedClef = clef === 'treble-8' ? 'treble' : clef;
    const positions = count > 0 ? sharpSteps[normalizedClef] || sharpSteps.treble : flatSteps[normalizedClef] || flatSteps.treble;
    const symbol = count > 0 ? '♯' : '♭';
    for (let index = 0; index < Math.abs(count); index += 1) {
      const y = top + state.layout.staffHeight - positions[index] * state.layout.staffLineSpacing / 2 + 4;
      svg.appendChild(svgText(symbol, x + index * 8, y, {
        'font-size': 14, 'font-family': 'serif', 'text-anchor': 'middle', fill: '#151b22'
      }));
    }
  }

  function drawTimeSignature(svg, x, top, signature) {
    const [numerator, denominator] = String(signature).split('/');
    svg.appendChild(svgText(numerator, x, top + 11, {
      'font-size': 12, 'font-family': 'Georgia', 'font-weight': 700, fill: '#111'
    }));
    svg.appendChild(svgText(denominator, x, top + 26, {
      'font-size': 12, 'font-family': 'Georgia', 'font-weight': 700, fill: '#111'
    }));
  }

  function drawGroupBrackets(svg, system) {
    const groups = new Map();
    state.layout.parts.forEach(item => {
      const group = item.part.bracketGroup;
      if (!group) return;
      if (!groups.has(group)) groups.set(group, []);
      groups.get(group).push(item);
    });
    groups.forEach(items => {
      if (items.length < 2) return;
      const x = state.layout.staffX - 24;
      const top = systemTop(system) + items[0].blockTop;
      const bottom = systemTop(system) + items.at(-1).blockBottom;
      svg.appendChild(svgEl('path', { d: `M ${x + 8} ${top} L ${x} ${top} L ${x} ${bottom} L ${x + 8} ${bottom}`, fill: 'none', stroke: '#18212b', 'stroke-width': 1.8 }));
    });
  }

  function drawMeasureCapacity(svg, part, measureIndex, x, blockTop) {
    const selected = getSelected();
    const staff = selected.part?.id === part.id && selected.event ? selected.event.staff || null : (model.isMultiStaff(part) ? model.defaultStaff(part, 72) : null);
    const usage = model.measureUsage(state.score, part, measureIndex, state.activeVoice, staff);
    const authored = usage.events.filter(event => event.generatedBy !== 'gap-fill');
    if (!authored.length) return;
    let text;
    let className = 'bar-capacity';
    if (usage.complete) { text = `L${state.activeVoice} ✓`; className += ' complete'; }
    else if (usage.occupied > usage.capacity + EPSILON) { text = `L${state.activeVoice} over`; className += ' error'; }
    else text = `L${state.activeVoice}: ${formatBeat(usage.remaining)} open`;
    svg.appendChild(svgText(text, measureRight(measureIndex) - 5, blockTop - 8, { class: className, 'text-anchor': 'end' }));
  }

  function xForBeat(beat) {
    const measureIndex = model.measureIndexAt(state.score, beat);
    const frame = measureFrame(measureIndex);
    return layoutEngine.rhythmicPosition(frame, beat, measureAttributeInset(measureIndex));
  }

  function beatForPointer(pointerX, system) {
    const systemData = state.layout.systemsData[system];
    if (!systemData?.frames?.length) return 0;
    const frame = systemData.frames.find(item => pointerX >= item.x - EPSILON && pointerX < item.right - EPSILON)
      || (pointerX < systemData.frames[0].x ? systemData.frames[0] : systemData.frames.at(-1));
    const measureIndex = frame.measureIndex;
    const bounds = model.measureBounds(state.score, measureIndex);
    const raw = layoutEngine.beatForX(frame, pointerX, measureAttributeInset(measureIndex));
    return theory.clamp(model.snapBeat(state.score, raw, state.duration), bounds.start, bounds.end - .0001);
  }

  function yToWrittenPitch(pointerY, rowTop, clef, key) {
    const bottom = rowTop + state.layout.staffHeight;
    const step = Math.round((bottom - pointerY) / (state.layout.staffLineSpacing / 2));
    return theory.pitchForStaffStep(step, clef, key);
  }

  function drawNote(svg, event, x, y, staffTop, staffBottom, part, row, system, renderContext) {
    const group = svgEl('g', {
      class: `note-group voice-${event.voice || 1} ${Number(event.voice || 1) === state.activeVoice ? 'active-layer' : ''} ${event.id === state.selectedEventId ? 'selected' : ''} ${state.selection.hasEvent(event.id) ? 'multi-selected' : ''} ${event.generatedBy === 'harmony' ? 'generated-harmony' : ''}`,
      'data-event-id': event.id, 'data-part-id': part.id, 'data-start': event.start, 'data-duration': event.duration,
      'data-system': system, 'data-staff': row.staff || '', 'data-voice': event.voice || 1
    });
    const written = writtenPitch(event, part);
    const parsed = theory.parsePitch(written);
    const measureIndex = model.measureIndexAt(state.score, event.start);
    const expectedAccidental = theory.keySignatureAlteration(parsed.letter, keyForPart(part, measureIndex));
    const showAccidental = parsed.accidental !== expectedAccidental;
    const voice = Number(event.voice) || 1;
    const middle = staffTop + state.layout.staffHeight / 2;
    const voicesHere = renderContext?.voicesHere || new Set([voice]);
    const chordMembers = renderContext?.chordMembers || [event];
    const chordGeometry = chordMembers.map(note => {
      const pitch = writtenPitch(note, part);
      return { id: note.id, voice: Number(note.voice) || 1, step: theory.pitchToDiatonicIndex(pitch), y: eventY(note, part, row, system), accidental: theory.parsePitch(pitch).accidental !== theory.keySignatureAlteration(theory.parsePitch(pitch).letter, keyForPart(part, model.measureIndexAt(state.score, note.start))) };
    });
    const averageY = chordGeometry.reduce((sum, item) => sum + item.y, 0) / Math.max(1, chordGeometry.length);
    const stemUp = voicesHere.size > 1 ? voice % 2 === 1 : averageY >= middle;
    const headOffsets = layoutEngine.chordNoteheadOffsets(chordGeometry, stemUp, 7);
    const simultaneousGeometry = (renderContext?.simultaneousNotes || [event]).map(note => ({ id: note.id, voice: Number(note.voice) || 1, step: theory.pitchToDiatonicIndex(writtenPitch(note, part)) }));
    const unisonOffset = layoutEngine.voiceUnisonOffset(simultaneousGeometry, event.id, stemUp, 3);
    const headX = x + Number(headOffsets[event.id] || 0) + unisonOffset;
    const accidentalColumns = layoutEngine.accidentalColumns(chordGeometry);
    const extremeY = stemUp ? Math.min(...chordGeometry.map(item => item.y)) : Math.max(...chordGeometry.map(item => item.y));
    const stemOwner = stemUp
      ? chordGeometry.reduce((owner, item) => item.y > owner.y ? item : owner, chordGeometry[0])
      : chordGeometry.reduce((owner, item) => item.y < owner.y ? item : owner, chordGeometry[0]);
    drawLedgerLines(group, headX, y, staffTop, staffBottom);
    if (showAccidental) {
      const accidental = parsed.accidental > 0 ? '♯'.repeat(parsed.accidental) : parsed.accidental < 0 ? '♭'.repeat(-parsed.accidental) : '♮';
      const column = Number(accidentalColumns[event.id] || 0);
      group.appendChild(svgText(accidental, x - 12 - column * 8, y + 4, { class: 'accidental', 'text-anchor': 'middle' }));
    }
    drawNoteGlyph(group, headX, y, event.duration, stemUp, 'note-ink', {
      drawStem: event.id === stemOwner.id,
      stemX: x + (stemUp ? 5 : -5) + unisonOffset,
      stemEndY: stemUp ? extremeY - 27 : extremeY + 27
    });
    drawArticulations(group, event, headX, y, stemUp);
    const lyrics = Array.isArray(event.lyrics) && event.lyrics.length ? event.lyrics : (event.lyric ? [{ verse: event.lyricVerse || 1, text: event.lyric, syllabic: event.syllabic, melisma: event.melisma }] : []);
    if (state.score.settings.showLyrics) lyrics.sort((a, b) => (a.verse || 1) - (b.verse || 1)).forEach((lyric, lyricIndex) => {
      const lyricX = x + (Number(lyric.offsetX ?? event.lyricOffsetX) || 0);
      const lyricY = staffBottom + 21 + lyricIndex * 12 + (Number(lyric.offsetY ?? event.lyricOffsetY) || 0);
      const verse = Math.max(1, Number(lyric.verse) || 1);
      const firstInSystem = !part.events.some(candidate => candidate.type === 'note' && candidate.generatedBy !== 'gap-fill'
        && candidate.id !== event.id && (candidate.voice || 1) === (event.voice || 1)
        && (candidate.staff || null) === (event.staff || null) && candidate.start < event.start - 1e-8
        && systemForMeasure(model.measureIndexAt(state.score, candidate.start)) === system
        && (candidate.lyrics || []).some(item => Math.max(1, Number(item.verse) || 1) === verse && String(item.text || '')));
      const text = `${firstInSystem ? `${verse}. ` : ''}${lyric.text || ''}${lyric.syllabic === 'begin' || lyric.syllabic === 'middle' ? '-' : ''}`;
      const lyricElement = svgText(text, lyricX, lyricY, {
        class: 'score-lyric', 'font-size': 9, 'text-anchor': 'middle', 'font-family': 'Georgia', fill: '#232a34',
        'data-event-id': event.id, 'data-part-id': part.id, 'data-lyric-id': lyric.id || '', 'data-verse': lyric.verse || 1
      });
      group.appendChild(lyricElement);
      if (lyric.melisma) group.appendChild(svgEl('line', { x1: lyricX + 7, x2: lyricX + Math.max(22, event.duration * 24), y1: lyricY + 2, y2: lyricY + 2, stroke: '#343b44', 'stroke-width': .7, class: 'lyric-extension' }));
    });
    if (solfaVisibleForStaff(part, row.staff || null)) {
      const item = solfa.eventToSolfa(event, state.score, part, {
        mode: state.score.settings.mode,
        showRhythm: state.score.settings.solfaShowRhythm !== false,
        showOctaveMarks: state.score.settings.solfaShowOctaveMarks !== false,
        pitchSystem: state.score.settings.solfaPitchSystem || 'movable-do',
        minorSystem: state.score.settings.minorSolfaSystem || 'do-based'
      });
      const position = state.score.settings.solfaOverlayPosition || 'below';
      const spacing = Number(state.score.settings.solfaVerticalSpacing) || 12;
      const overlayY = position === 'above' ? staffTop - spacing : staffBottom + 35 + Math.max(0, lyrics.length - 1) * 12 + spacing;
      const context = solfa.rhythmContext(state.score, event);
      const label = item.tiedContinuation ? '—' : `${item.syllable}${item.octaveMarks || ''}${solfa.rhythmMark(event.duration, { showRhythm: state.score.settings.solfaShowRhythm !== false, pulse: context.pulse })}`;
      const overlay = svgText(label, x, overlayY, { class: `staff-solfa-overlay ${event.id === state.selectedEventId ? 'selected' : ''}`, 'font-size': Number(state.score.settings.solfaFontSize) || 8, 'text-anchor': 'middle', 'font-family': 'Arial', fill: item.valid ? '#5b6470' : '#c62d3b', 'data-event-id': event.id, 'data-part-id': part.id });
      group.appendChild(overlay);
    }
    svg.appendChild(group);
  }

  function drawArticulations(group, event, x, y, stemUp) {
    const items = Array.isArray(event.articulations) ? event.articulations : [];
    if (!items.length) return;
    const symbols = { staccato: '•', tenuto: '—', accent: '>', 'strong-accent': '^', fermata: '𝄐' };
    const side = stemUp ? 1 : -1;
    items.forEach((name, index) => {
      const symbol = symbols[name] || name.slice(0, 1);
      group.appendChild(svgText(symbol, x, y + side * (12 + index * 8), {
        class: `articulation articulation-${name}`, 'font-size': name === 'fermata' ? 13 : 10,
        'font-family': name === 'fermata' ? 'serif' : 'Arial', 'font-weight': 700, 'text-anchor': 'middle', fill: '#121820'
      }));
    });
  }

  function drawNoteGlyph(group, x, y, duration, stemUp, className = '', options = {}) {
    const base = theory.baseDuration(duration);
    const open = base >= 2;
    const breve = base >= 8;
    const whole = base >= 4 && base < 8;
    const head = svgEl('ellipse', {
      cx: x, cy: y, rx: 5.6, ry: 3.8, transform: `rotate(-18 ${x} ${y})`,
      fill: open ? '#fffef9' : '#121820', stroke: '#121820', 'stroke-width': 1.2,
      class: `note-head ${className}`
    });
    group.appendChild(head);
    if (breve) {
      group.appendChild(svgEl('line', { x1: x - 9, x2: x - 9, y1: y - 6, y2: y + 6, stroke: '#121820', 'stroke-width': 1.2, class: className }));
      group.appendChild(svgEl('line', { x1: x + 9, x2: x + 9, y1: y - 6, y2: y + 6, stroke: '#121820', 'stroke-width': 1.2, class: className }));
    }
    if (!whole && !breve && options.drawStem !== false) {
      const stemX = Number.isFinite(Number(options.stemX)) ? Number(options.stemX) : (stemUp ? x + 5 : x - 5);
      const stemEnd = Number.isFinite(Number(options.stemEndY)) ? Number(options.stemEndY) : (stemUp ? y - 27 : y + 27);
      group.appendChild(svgEl('line', { x1: stemX, x2: stemX, y1: y, y2: stemEnd, stroke: '#121820', 'stroke-width': 1.15, class: className }));
      const flags = theory.flagCount(duration);
      for (let flag = 0; flag < flags; flag += 1) {
        const offset = flag * 7;
        const path = stemUp
          ? `M ${stemX} ${stemEnd + offset} q 13 4 6 16`
          : `M ${stemX} ${stemEnd - offset} q -13 -4 -6 -16`;
        group.appendChild(svgEl('path', { d: path, fill: 'none', stroke: '#121820', 'stroke-width': 1.35, class: className }));
      }
    }
    if (theory.durationDots(duration)) group.appendChild(svgEl('circle', { cx: x + 10, cy: y, r: 1.4, fill: '#121820', class: className }));
  }

  function drawRest(svg, event, x, y, part, row, system) {
    const voice = Number(event.voice) || 1;
    const offset = voice === 1 ? -5 : voice === 2 ? 6 : voice % 2 === 1 ? -11 : 12;
    const group = svgEl('g', {
      class: `note-group rest-group voice-${voice} ${Number(voice) === state.activeVoice ? 'active-layer' : ''} ${event.id === state.selectedEventId ? 'selected' : ''} ${state.selection.hasEvent(event.id) ? 'multi-selected' : ''} ${event.generatedBy === 'gap-fill' ? 'implicit-rest' : ''}`,
      'data-event-id': event.id, 'data-part-id': part.id, 'data-start': event.start, 'data-duration': event.duration,
      'data-system': system, 'data-staff': row.staff || '', 'data-voice': voice
    });
    drawRestGlyph(group, x, y + offset, event.duration, 'rest-ink');
    if (solfaVisibleForStaff(part, row.staff || null) && (event.generatedBy !== 'gap-fill' || state.score.settings.solfaShowWarnings === true)) {
      const item = solfa.eventToSolfa(event, state.score, part, { showRhythm: state.score.settings.solfaShowRhythm !== false });
      const position = state.score.settings.solfaOverlayPosition || 'below';
      const spacing = Number(state.score.settings.solfaVerticalSpacing) || 12;
      const staffTop = row.top + systemTop(system);
      const staffBottom = staffTop + state.layout.staffHeight;
      const overlayY = position === 'above' ? staffTop - spacing : staffBottom + 35 + spacing;
      const overlay = svgText(item.text.trim() || '0', x, overlayY, { class: `staff-solfa-overlay rest ${event.id === state.selectedEventId ? 'selected' : ''}`, 'font-size': Number(state.score.settings.solfaFontSize) || 8, 'text-anchor': 'middle', 'font-family': 'Arial', fill: '#70757b', 'data-event-id': event.id, 'data-part-id': part.id });
      group.appendChild(overlay);
    }
    svg.appendChild(group);
  }

  function drawRestGlyph(group, x, y, duration, className = '') {
    const base = theory.baseDuration(duration);
    let symbol;
    if (base >= 8) symbol = '𝄺';
    else if (base >= 4) symbol = '𝄻';
    else if (base >= 2) symbol = '𝄼';
    else if (base >= 1) symbol = '𝄽';
    else if (base >= .5) symbol = '𝄾';
    else if (base >= .25) symbol = '𝄿';
    else if (base >= .125) symbol = '𝅀';
    else symbol = '𝅁';
    group.appendChild(svgText(symbol, x, y + 7, {
      'font-size': 22, 'text-anchor': 'middle', fill: '#141a21', class: className
    }));
    if (theory.durationDots(duration)) group.appendChild(svgEl('circle', { cx: x + 10, cy: y + 1, r: 1.4, fill: '#121820', class: className }));
  }

  function drawLedgerLines(group, x, y, top, bottom) {
    for (let ledger = bottom + state.layout.staffLineSpacing; y >= ledger - 2; ledger += state.layout.staffLineSpacing) {
      group.appendChild(svgEl('line', { x1: x - 8, x2: x + 8, y1: ledger, y2: ledger, stroke: '#272d35', 'stroke-width': .75 }));
    }
    for (let ledger = top - state.layout.staffLineSpacing; y <= ledger + 2; ledger -= state.layout.staffLineSpacing) {
      group.appendChild(svgEl('line', { x1: x - 8, x2: x + 8, y1: ledger, y2: ledger, stroke: '#272d35', 'stroke-width': .75 }));
    }
  }

  function pointerInSvg(event) {
    const svg = $('#notationCanvas svg');
    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    const viewBox = svg.viewBox.baseVal;
    return {
      x: (event.clientX - rect.left) * viewBox.width / rect.width,
      y: (event.clientY - rect.top) * viewBox.height / rect.height
    };
  }

  function previewFromPointer(event, hit) {
    const point = pointerInSvg(event);
    const partId = hit.dataset.partId;
    const part = state.score.parts.find(item => item.id === partId);
    const system = Number(hit.dataset.system);
    const rowTop = Number(hit.dataset.top);
    const staff = hit.dataset.staff || null;
    const start = beatForPointer(point.x, system);
    const measureIndex = model.measureIndexAt(state.score, start);
    const row = state.layout.parts.find(item => item.part.id === partId)?.rows.find(item => (item.staff || null) === staff);
    const clef = clefForRowAt(part, row || { staff, clef: hit.dataset.clef }, measureIndex);
    const automaticChord = state.mode === 'note' && Boolean(chordAnchorAt(part, start, state.activeVoice, staff));
    const candidate = { type: state.mode === 'lyrics' ? 'note' : state.mode, start, duration: state.duration, voice: state.activeVoice, staff, allowChord: event.shiftKey || state.chordEntry || automaticChord, allowAcrossBarline: state.mode === 'note' };
    let pitch = null;
    if (state.mode === 'note') {
      pitch = yToWrittenPitch(point.y, rowTop, clef, keyForPart(part, measureIndex));
      if (state.entryAccidental != null) {
        const parsed = theory.parsePitch(pitch);
        const symbol = state.entryAccidental === 2 ? '##' : state.entryAccidental === 1 ? '#' : state.entryAccidental === -1 ? 'b' : state.entryAccidental === -2 ? 'bb' : '';
        pitch = `${parsed.letter}${symbol}${parsed.octave}`;
      }
      candidate.writtenPitch = pitch;
      candidate.midi = theory.soundingMidiFromDisplay(theory.pitchToMidi(pitch), part, state.score.settings.concertPitch !== false);
    }
    const validation = state.mode === 'lyrics' ? { ok: false, reason: 'Select an existing note to enter lyrics.' } : model.canPlaceEvent(state.score, partId, candidate);
    return { partId, part, system, rowTop, clef, staff, start, pitch, midi: candidate.midi, duration: state.duration, mode: state.mode, voice: state.activeVoice, validation, point };
  }

  function beginMarquee(event) {
    event.preventDefault(); event.stopPropagation();
    const point = pointerInSvg(event);
    state.selectionMarquee = { pointerId: event.pointerId, x1: point.x, y1: point.y, x2: point.x, y2: point.y, additive: event.shiftKey };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setStatus('Marquee selection: drag around notes or rests, then release.');
  }

  function updateMarquee(event) {
    if (!state.selectionMarquee || event.pointerId !== state.selectionMarquee.pointerId) return false;
    const point = pointerInSvg(event);
    state.selectionMarquee.x2 = point.x; state.selectionMarquee.y2 = point.y;
    renderScore();
    return true;
  }

  function drawSelectionMarquee(svg, marquee) {
    const x = Math.min(marquee.x1, marquee.x2), y = Math.min(marquee.y1, marquee.y2);
    svg.appendChild(svgEl('rect', { x, y, width: Math.abs(marquee.x2 - marquee.x1), height: Math.abs(marquee.y2 - marquee.y1), class: 'selection-marquee' }));
  }

  function eventVisualBoxes() {
    const boxes = [];
    for (const partLayout of state.layout.parts) {
      const part = partLayout.part;
      for (const event of part.events.filter(item => item.generatedBy !== 'gap-fill' && !item.hidden)) {
        const measureIndex = model.measureIndexAt(state.score, event.start);
        const system = systemForMeasure(measureIndex);
        const row = rowForEvent(partLayout, event);
        const top = systemTop(system) + row.offsetTop;
        const x = xForBeat(event.start);
        const y = event.type === 'note' ? eventY(event, part, row, system) : top + state.layout.staffHeight / 2;
        boxes.push({ id: event.id, partId: part.id, box: { x1: x - 11, x2: x + 11, y1: y - 24, y2: y + 24 } });
      }
    }
    return boxes;
  }

  function finishMarquee(event) {
    if (!state.selectionMarquee || (event.pointerId != null && event.pointerId !== state.selectionMarquee.pointerId)) return;
    const marquee = state.selectionMarquee;
    state.selectionMarquee = null;
    state.suppressClickUntil = Date.now() + 250;
    const boxes = eventVisualBoxes();
    const ids = idsInRect(boxes, marquee);
    state.selection.selectEvents(ids, { additive: marquee.additive });
    const primary = boxes.find(item => ids.includes(item.id));
    if (primary) { state.selectedPartId = primary.partId; state.selectedEventId = primary.id; }
    else if (!marquee.additive) state.selectedEventId = null;
    renderAll();
    toast(`${ids.length} event${ids.length === 1 ? '' : 's'} selected by marquee.`, 'success');
  }

  function handleStaffPointerMove(event) {
    if (state.drag) return;
    if (state.mode === 'layout') { state.ghost = null; setStatus('Layout mode — use Esc-neutral tools to expand staves or move lyrics without selecting notes.'); return; }
    if (state.mode === 'lyrics') { state.ghost = null; setStatus('Select an existing note, then type or drag its lyric in the Lyrics bar.'); return; }
    state.ghost = previewFromPointer(event, event.currentTarget);
    renderScore();
    const label = state.ghost.mode === 'note' ? `${state.ghost.pitch} · ${theory.durationName(state.duration)}` : `${theory.durationName(state.duration)} rest`;
    setStatus(state.ghost.validation.ok ? `${label} — click to place${state.ghost.validation.crossesBarline ? ' as tied notes across the barline' : ''}` : state.ghost.validation.reason);
  }

  function handleStaffPointerLeave() {
    if (state.drag) return;
    state.ghost = null;
    renderScore();
  }

  function chordAnchorAt(part, start, voice, staff) {
    return (part?.events || []).find(item => item.type === 'note' && item.generatedBy !== 'gap-fill' && Math.abs(Number(item.start) - Number(start)) < EPSILON && (Number(item.voice) || 1) === (Number(voice) || 1) && (item.staff || null) === (staff || null));
  }

  function handleStaffClick(event) {
    if (Date.now() < state.suppressClickUntil || state.drag?.moved) return;
    if (state.mode === 'layout') return setStatus('Layout mode keeps note selection cleared. Use Note Entry when you want to enter or select notes.');
    if (state.mode === 'lyrics') return toast('Click an existing note, then type the syllable in the visible Lyrics bar.', 'error');
    const preview = state.ghost || previewFromPointer(event, event.currentTarget);
    state.selectedPartId = preview.partId;
    state.cursorBeat = preview.start;
    if (!preview.validation.ok) return toast(preview.validation.reason, 'error');
    checkpoint(preview.mode === 'rest' ? 'Add rest' : 'Add note');
    const data = { start: preview.start, duration: preview.duration, staff: preview.staff, voice: state.activeVoice };
    try {
      let created;
      let chordAdded = false;
      if (preview.mode === 'rest') created = [model.addRest(state.score, preview.partId, data)];
      else {
        const chordRequested = event.shiftKey || state.chordEntry || Boolean(chordAnchorAt(preview.part, preview.start, state.activeVoice, preview.staff));
        const anchor = chordRequested ? chordAnchorAt(preview.part, preview.start, state.activeVoice, preview.staff) : null;
        if (anchor) {
          const note = model.addChordTone(state.score, preview.partId, anchor.id, preview.midi);
          created = [note];
          chordAdded = true;
        } else created = editing.addNoteAcrossBarlines(state.score, preview.partId, { ...data, writtenPitch: preview.pitch, allowChord: chordRequested });
      }
      const primary = created[0];
      if (primary?.type === 'note') previewPitch(primary.midi);
      const selectedIds = chordAdded ? model.chordMembers(state.score, primary.id).map(item => item.id) : created.map(item => item.id);
      state.selection.selectEvents(selectedIds);
      state.selectedEventId = primary?.id || null;
      state.cursorBeat = (state.chordEntry || chordAdded) && preview.mode === 'note' ? preview.start : clampCursor(preview.start + preview.duration);
      state.ghost = null;
      if (preview.mode === 'note') state.entryAccidental = null;
      commit(preview.mode === 'rest' ? 'Add rest' : chordAdded ? 'Add chord tone' : (created.length > 1 ? 'Add tied note across barline' : 'Add note'));
      if (created.length > 1) toast(`The duration was split into ${created.length} tied notes across the barline.`, 'success');
    } catch (error) { toast(error.message, 'error'); }
  }

  function drawGhost(svg, ghost) {
    if (!ghost || !state.layout) return;
    const partLayout = state.layout.parts.find(item => item.part.id === ghost.partId);
    if (!partLayout) return;
    const row = partLayout.rows.find(item => (item.staff || null) === (ghost.staff || null)) || partLayout.rows[0];
    const x = xForBeat(ghost.start, ghost.system);
    const top = ghost.systemTop(system) + row.offsetTop;
    const bottom = top + state.layout.staffHeight;
    const group = svgEl('g', { class: `ghost-note ${ghost.validation.ok ? 'valid' : 'invalid'}` });
    if (ghost.mode === 'rest') drawRestGlyph(group, x, top + state.layout.staffHeight / 2, ghost.duration, 'ghost-ink');
    else {
      const step = theory.staffStepForPitch(ghost.pitch, ghost.clef);
      const y = bottom - step * state.layout.staffLineSpacing / 2;
      drawLedgerLines(group, x, y, top, bottom);
      drawNoteGlyph(group, x, y, ghost.duration, y >= top + state.layout.staffHeight / 2, 'ghost-ink');
      group.appendChild(svgText(ghost.pitch.replace(/-?\d+$/, ''), x, top - 9, {
        'font-size': 8, 'text-anchor': 'middle', fill: ghost.validation.ok ? '#286bd8' : '#c52d3d'
      }));
    }
    svg.appendChild(group);
  }

  function beginDrag(event, part, scoreEvent, row, system) {
    event.preventDefault();
    event.stopPropagation();
    const point = pointerInSvg(event);
    state.selectedPartId = part.id;
    state.selectedEventId = scoreEvent.id;
    if (!state.selection.hasEvent(scoreEvent.id)) state.selection.selectEvent(scoreEvent.id);
    state.drag = {
      pointerId: event.pointerId,
      partId: part.id,
      eventId: scoreEvent.id,
      original: JSON.parse(JSON.stringify(scoreEvent)),
      row: { ...row },
      system,
      originPoint: point,
      moved: false,
      preview: null
    };
    event.currentTarget.classList.add('dragging');
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function handleGlobalPointerMove(event) {
    if (updateMarquee(event)) return;
    if (updateLyricDrag(event)) return;
    if (!state.drag || event.pointerId !== state.drag.pointerId) return;
    const point = pointerInSvg(event);
    if (Math.hypot(point.x - state.drag.originPoint.x, point.y - state.drag.originPoint.y) > 3) state.drag.moved = true;
    if (!state.drag.moved) return;
    const part = state.score.parts.find(item => item.id === state.drag.partId);
    const original = state.drag.original;
    const system = systemForY(point.y);
    const partLayout = state.layout.parts.find(item => item.part.id === part.id);
    const row = partLayout.rows.find(item => (item.staff || null) === (state.drag.row.staff || null)) || partLayout.rows[0];
    const rowTop = systemTop(system) + row.offsetTop;
    const start = beatForPointer(point.x, system);
    const candidate = {
      type: original.type,
      start,
      duration: original.duration,
      voice: original.voice || 1,
      staff: original.staff,
      allowChord: event.shiftKey
    };
    let pitch = null;
    let midi = null;
    if (original.type === 'note') {
      pitch = yToWrittenPitch(point.y, rowTop, row.clef, keyForPart(part));
      midi = theory.soundingMidiFromDisplay(theory.pitchToMidi(pitch), part, state.score.settings.concertPitch !== false);
      candidate.writtenPitch = pitch;
      candidate.midi = midi;
    }
    const validation = model.canPlaceEvent(state.score, part.id, candidate, original.id);
    state.drag.preview = { partId: part.id, system, row, rowTop, start, pitch, midi, duration: original.duration, mode: original.type, validation };
    renderScore();
    setStatus(validation.ok ? `Move to bar ${model.measureIndexAt(state.score, start) + 1}, beat ${formatBeat(model.beatInMeasure(state.score, start) + 1)}${pitch ? ` · ${pitch}` : ''}` : validation.reason);
  }

  function drawDragPreview(svg, preview) {
    if (!preview) return;
    const x = xForBeat(preview.start, preview.system);
    const top = preview.rowTop;
    const group = svgEl('g', { class: `drag-preview ${preview.validation.ok ? 'valid' : 'invalid'}` });
    if (preview.mode === 'rest') drawRestGlyph(group, x, top + state.layout.staffHeight / 2, preview.duration, 'ghost-ink');
    else {
      const bottom = top + state.layout.staffHeight;
      const step = theory.staffStepForPitch(preview.pitch, preview.row.clef);
      const y = bottom - step * state.layout.staffLineSpacing / 2;
      drawLedgerLines(group, x, y, top, bottom);
      drawNoteGlyph(group, x, y, preview.duration, y >= top + state.layout.staffHeight / 2, 'ghost-ink');
    }
    svg.appendChild(group);
  }

  function finishDrag(event) {
    if (!state.drag || (event.pointerId != null && event.pointerId !== state.drag.pointerId)) return;
    const drag = state.drag;
    state.drag = null;
    if (drag.moved) state.suppressClickUntil = Date.now() + 250;
    if (!drag.moved || !drag.preview) {
      renderAll();
      return;
    }
    if (!drag.preview.validation.ok) {
      toast(drag.preview.validation.reason, 'error');
      renderAll();
      return;
    }
    checkpoint('Move note');
    const patch = { start: drag.preview.start };
    if (drag.original.type === 'note') patch.writtenPitch = drag.preview.pitch;
    model.updateEvent(state.score, drag.partId, drag.eventId, patch);
    state.cursorBeat = drag.preview.start;
    commit('Move note');
  }

  function beginAnnotationDrag(pointer, annotation, element) {
    pointer.preventDefault(); pointer.stopPropagation();
    state.selectedAnnotationId = annotation.id;
    const point = pointerInSvg(pointer);
    state.annotationDrag = {
      pointerId: pointer.pointerId, annotationId: annotation.id, originPoint: point,
      originalX: Number(annotation.offsetX) || 0, originalY: Number(annotation.offsetY) || 0,
      element, renderedX: Number(element.getAttribute('x')) || 0, renderedY: Number(element.getAttribute('y')) || 0,
      dx: 0, dy: 0, moved: false
    };
    pointer.currentTarget.setPointerCapture?.(pointer.pointerId);
    refreshScoreDecorations();
  }

  function updateAnnotationDrag(pointer) {
    const drag = state.annotationDrag;
    if (!drag || pointer.pointerId !== drag.pointerId) return false;
    const point = pointerInSvg(pointer);
    drag.dx = point.x - drag.originPoint.x; drag.dy = point.y - drag.originPoint.y;
    if (Math.hypot(drag.dx, drag.dy) > 2) drag.moved = true;
    if (!drag.moved) return true;
    drag.element?.setAttribute('x', String(drag.renderedX + drag.dx));
    drag.element?.setAttribute('y', String(drag.renderedY + drag.dy));
    setStatus(`Text offset: X ${Math.round(drag.originalX + drag.dx)}, Y ${Math.round(drag.originalY + drag.dy)}. Musical anchor is unchanged.`);
    return true;
  }

  function finishAnnotationDrag(pointer) {
    const drag = state.annotationDrag;
    if (!drag || (pointer.pointerId != null && pointer.pointerId !== drag.pointerId)) return;
    state.annotationDrag = null;
    if (!drag.moved) return;
    state.suppressClickUntil = Date.now() + 250;
    checkpoint('Move anchored text');
    model.updateAnnotation(state.score, drag.annotationId, { offsetX: drag.originalX + drag.dx, offsetY: drag.originalY + drag.dy });
    commit('Move anchored text');
    toast('Text moved visually while remaining anchored to the same measure and beat.', 'success');
  }

  function beginLyricDrag(pointer, part, event, lyric) {
    pointer.preventDefault(); pointer.stopPropagation();
    const point = pointerInSvg(pointer);
    state.selectedPartId = part.id; state.selectedEventId = event.id;
    state.selection.selectEvent(event.id);
    checkpoint('Move lyric');
    state.lyricDrag = {
      pointerId: pointer.pointerId, partId: part.id, eventId: event.id,
      lyricId: lyric?.id || null, verse: Number(lyric?.verse) || 1,
      originPoint: point, originalX: Number(lyric?.offsetX ?? event.lyricOffsetX) || 0,
      originalY: Number(lyric?.offsetY ?? event.lyricOffsetY) || 0, moved: false
    };
    pointer.currentTarget.setPointerCapture?.(pointer.pointerId);
  }

  function updateLyricDrag(pointer) {
    if (!state.lyricDrag || pointer.pointerId !== state.lyricDrag.pointerId) return false;
    const point = pointerInSvg(pointer); const drag = state.lyricDrag;
    const part = state.score.parts.find(item => item.id === drag.partId); const event = part?.events.find(item => item.id === drag.eventId);
    if (!event) return false;
    const lyric = (event.lyrics || []).find(item => (drag.lyricId && item.id === drag.lyricId) || (!drag.lyricId && Number(item.verse) === drag.verse));
    if (!lyric) return false;
    const dx = point.x - drag.originPoint.x; const dy = point.y - drag.originPoint.y;
    if (Math.hypot(dx, dy) > 2) drag.moved = true;
    if (!drag.moved) return true;
    lyric.offsetX = drag.originalX + dx; lyric.offsetY = drag.originalY + dy;
    model.normalizeEventLyrics(event, part);
    renderScore();
    setStatus(`Verse ${lyric.verse} position: X ${Math.round(lyric.offsetX)}, Y ${Math.round(lyric.offsetY)}`);
    return true;
  }

  function finishLyricDrag(pointer) {
    if (!state.lyricDrag || (pointer.pointerId != null && pointer.pointerId !== state.lyricDrag.pointerId)) return;
    const drag = state.lyricDrag; state.lyricDrag = null;
    if (!drag.moved) return;
    commit('Move lyric');
    toast('Lyric position updated without changing its note or rhythmic alignment.', 'success');
  }

  function selectEvent(partId, eventId, options = {}) {
    state.selectedPartId = partId;
    const targetRef = model.findEvent(state.score, eventId);
    if (targetRef) state.layoutTarget = { partId: targetRef.part.id, staff: targetRef.event.staff || null };
    state.selection.selectEvent(eventId, { additive: Boolean(options.additive), toggle: Boolean(options.toggle) });
    if (state.selection.hasEvent(eventId)) state.selectedEventId = eventId;
    else state.selectedEventId = state.selection.eventIds.values().next().value || null;
    announce(`${state.selection.eventIds.size} event${state.selection.eventIds.size === 1 ? '' : 's'} selected.`);
    renderAll();
  }

  function getSelected() {
    const part = state.score.parts.find(item => item.id === state.selectedPartId);
    let event = part?.events.find(item => item.id === state.selectedEventId);
    if (!event && !state.selection.isEmpty) {
      const first = state.selection.eventEntries(state.score)[0];
      if (first) { state.selectedPartId = first.part.id; state.selectedEventId = first.event.id; return first; }
    }
    return { part, event };
  }

  function renderInspector() {
    const { part, event } = getSelected();
    $('#inspectorEmpty').classList.toggle('hidden', Boolean(event));
    $('#noteInspector').classList.toggle('hidden', !event);
    if (!event) return;
    state.activeVoice = Number(event.voice) || 1;
    $('#voiceLayerSelect').value = String(state.activeVoice);
    $('#inspectorPitch').disabled = event.type === 'rest';
    $('#inspectorPitch').value = event.type === 'note' ? writtenPitch(event, part) : 'Rest';
    $('#inspectorStart').value = event.start;
    $('#inspectorDuration').value = String(event.duration);
    $('#inspectorVoice').value = String(event.voice || 1);
    const quickVerse = Math.max(1, Number($('#quickLyricVerse').value) || Number(event.lyricVerse) || 1);
    const lyricItem = (event.lyrics || []).find(item => Number(item.verse) === quickVerse) || { text: event.lyric || '', syllabic: event.syllabic || '', melisma: event.melisma };
    $('#inspectorLyric').value = lyricItem.text || '';
    $('#inspectorLyricVerse').value = quickVerse;
    $('#inspectorSyllabic').value = lyricItem.syllabic || '';
    $('#inspectorMelisma').checked = Boolean(lyricItem.melisma);
    $('#inspectorLyricX').value = Number(lyricItem.offsetX ?? event.lyricOffsetX) || 0;
    $('#inspectorLyricY').value = Number(lyricItem.offsetY ?? event.lyricOffsetY) || 0;
    $('#quickLyricText').value = lyricItem.text || '';
    $('#quickLyricSyllabic').value = lyricItem.syllabic || '';
    $('#quickLyricMelisma').checked = Boolean(lyricItem.melisma);
    $('#inspectorLyric').disabled = event.type === 'rest';
    $('#quickLyricText').disabled = event.type === 'rest';
    $('#inspectorVelocity').value = event.velocity || 88;
    $('#inspectorVelocity').disabled = event.type === 'rest';
  }

  function applyInspector() {
    const { part, event } = getSelected();
    if (!part || !event) return;
    try {
      const patch = {
        start: Number($('#inspectorStart').value), duration: Number($('#inspectorDuration').value),
        voice: Number($('#inspectorVoice').value), velocity: Number($('#inspectorVelocity').value)
      };
      if (event.type === 'note') patch.writtenPitch = $('#inspectorPitch').value.trim();
      const members = event.type === 'note' ? model.chordMembers(state.score, event.id) : [event];
      const structuralPatch = { start: patch.start, duration: patch.duration, voice: patch.voice };
      for (const member of members) {
        const candidate = { ...member, ...structuralPatch, type: member.type };
        const validation = model.canPlaceEvent(state.score, part.id, candidate, member.id);
        if (!validation.ok) return toast(validation.reason, 'error');
      }
      checkpoint(members.length > 1 ? 'Edit chord' : 'Edit event');
      if (members.length > 1) {
        for (const member of members) {
          model.updateEvent(state.score, part.id, member.id, {
            start: patch.start,
            duration: patch.duration,
            voice: patch.voice,
            velocity: member.id === event.id ? patch.velocity : member.velocity
          });
        }
        model.updateEvent(state.score, part.id, event.id, { writtenPitch: patch.writtenPitch, velocity: patch.velocity });
      } else model.updateEvent(state.score, part.id, event.id, patch);
      if (event.type === 'note') model.setLyric(state.score, part.id, event.id, $('#inspectorLyric').value, {
        verse: Number($('#inspectorLyricVerse').value), syllabic: $('#inspectorSyllabic').value || null,
        melisma: $('#inspectorMelisma').checked, offsetX: Number($('#inspectorLyricX').value) || 0,
        offsetY: Number($('#inspectorLyricY').value) || 0
      });
      state.activeVoice = Number(patch.voice) || 1; state.cursorBeat = patch.start;
      commit(members.length > 1 ? 'Edit chord' : 'Edit event');
      toast(members.length > 1 ? 'The chord retained one shared tick, duration and layer; the selected pitch and lyric remain independently editable.' : 'Notation, layer, lyrics, playback and tonic sol-fa updated together.', 'success');
    } catch (error) { toast(`Could not update event: ${error.message}`, 'error'); }
  }

  function handleQuickLyricKeydown(event) {
    const text = $('#quickLyricText').value.trim();
    if (!text && event.key === 'Backspace') { event.preventDefault(); navigateLyricNote(-1); return; }
    if (event.key === 'Enter' || event.key === 'Tab') { event.preventDefault(); applyQuickLyric(); return; }
    if (!text) return;
    if (event.key === ' ' || event.key === '-' || event.key === '_') {
      event.preventDefault();
      const syllabic = event.key === '-' ? ($('#quickLyricSyllabic').value || 'begin') : ($('#quickLyricSyllabic').value || 'single');
      applyQuickLyric({ syllabic, melisma: event.key === '_' || $('#quickLyricMelisma').checked, forceAdvance: true });
    }
  }

  function navigateLyricNote(direction) {
    const { part, event } = getSelected();
    if (!part || !event || event.type !== 'note') return toast('Select a note before navigating lyrics.', 'error');
    const options = { voice: event.voice || 1, staff: event.staff || null };
    const target = direction < 0
      ? lyricEngine.previousEligibleNote(state.score, part.id, event.id, options)
      : lyricEngine.nextEligibleNote(state.score, part.id, event.id, options);
    if (!target) return setStatus(direction < 0 ? 'This is the first eligible lyric note in the layer.' : 'This is the last eligible lyric note in the layer.');
    state.selectedPartId = target.part.id;
    state.selectedEventId = target.event.id;
    state.selection.selectEvent(target.event.id);
    state.cursorBeat = target.event.start;
    renderAll();
    $('#quickLyricText').focus();
    $('#quickLyricText').select();
  }

  function applyQuickLyric(overrides = {}) {
    const { part, event } = getSelected();
    if (!part || !event || event.type !== 'note') return toast('Select a note before entering lyrics.', 'error');
    const text = $('#quickLyricText').value;
    checkpoint('Enter lyric');
    const verse = Math.max(1, Number($('#quickLyricVerse').value) || 1);
    model.setLyric(state.score, part.id, event.id, text, {
      verse,
      lineType: 'verse',
      syllabic: overrides.syllabic ?? ($('#quickLyricSyllabic').value || null),
      melisma: overrides.melisma ?? $('#quickLyricMelisma').checked
    });
    commit('Enter lyric');
    const shouldAdvance = overrides.forceAdvance || state.score.settings.lyricAutoAdvance !== false;
    const next = shouldAdvance ? lyricEngine.nextEligibleNote(state.score, part.id, event.id, { voice: event.voice || 1, staff: event.staff || null }) : null;
    if (next) {
      state.selectedPartId = next.part.id; state.selectedEventId = next.event.id; state.selection.selectEvent(next.event.id); state.cursorBeat = next.event.start;
      renderAll(); $('#quickLyricText').focus(); $('#quickLyricText').select();
    } else if (shouldAdvance) $('#quickLyricText').value = '';
    setStatus(shouldAdvance ? 'Lyric attached and advanced to the next note.' : 'Lyric attached to the selected note.');
  }

  function deleteSelected() {
    const entries = ensurePrimarySelection();
    if (!entries.length) return toast('Select one or more notes or rests first.');
    checkpoint('Delete selection');
    const count = editing.deleteSelection(state.score, state.selection);
    state.selection.clear();
    state.selectedEventId = null;
    commit('Delete selection');
    toast(`${count} event${count === 1 ? '' : 's'} deleted.`, 'success');
  }

  function applyProperties() {
    try {
      const signature = $('#metaTime').value.trim(); model.timeSignatureInfo(signature);
      checkpoint('Update score properties');
      state.score.metadata.title = $('#metaTitle').value.trim() || 'Untitled Score';
      state.score.metadata.composer = $('#metaComposer').value.trim();
      state.score.metadata.compositionDate = $('#metaCompositionDate').value.trim();
      state.score.metadata.dateText = state.score.metadata.compositionDate;
      state.score.metadata.subtitle = $('#metaSubtitle').value.trim();
      state.score.metadata.lyricist = $('#metaLyricist').value.trim();
      state.score.metadata.arranger = $('#metaArranger').value.trim();
      state.score.metadata.source = $('#metaSource').value.trim();
      state.score.metadata.supportingText = $('#metaSupportingText').value.trim();
      model.setMeasureAttributes(state.score, 0, { key: $('#metaKey').value, timeSignature: signature });
      state.score.parts.forEach(part => part.events.forEach(item => {
        if (item.type !== 'note') return;
        const measureIndex = model.measureIndexAt(state.score, item.start);
        item.pitch = theory.spellMidiForKey(item.midi, model.effectiveKey(state.score, measureIndex));
        if (item.writtenPitch) item.writtenPitch = theory.spellMidiForKey(theory.displayMidiForPart(item.midi, part, state.score.settings.concertPitch !== false), keyForPart(part, measureIndex));
      }));
      commit('Update score properties');
      const issues = model.validateScore(state.score).filter(issue => issue.severity === 'error');
      if (issues.length) toast(`Properties updated. ${issues.length} existing event${issues.length === 1 ? '' : 's'} need attention.`, 'error');
      else toast('Score properties, measure timing and sol-fa recalculated.', 'success');
    } catch (error) { toast(error.message, 'error'); }
  }

  function initializeNewScoreWizard() {
    setWizardStep(0);
    updateNewScoreWizard();
  }

  function openNewScoreWizard() {
    setWizardStep(0);
    updateNewScoreWizard();
    openDialog('newScoreDialog');
  }

  function wizardFormData() {
    const form = $('#newScoreForm');
    const data = Object.fromEntries(new FormData(form).entries());
    data.autoFillRests = form.querySelector('[name="autoFillRests"]')?.checked !== false;
    return data;
  }

  function validateWizardStep(step = state.wizardStep) {
    const data = wizardFormData();
    try {
      if (step >= 1) {
        model.timeSignatureInfo(data.timeSignature);
        if (!(Number(data.measures) >= 1 && Number(data.measures) <= 2000)) throw new Error('Measures must be between 1 and 2,000.');
        if (!(Number(data.tempo) >= 30 && Number(data.tempo) <= 300)) throw new Error('Tempo must be between 30 and 300 BPM.');
        if (!(Number(data.staffCount) >= 1 && Number(data.staffCount) <= 64)) throw new Error('Initial staves must be between 1 and 64.');
      }
      if (step >= 2 && !String(data.title || '').trim()) throw new Error('Enter a score title.');
      $('#wizardValidation').textContent = '';
      return true;
    } catch (error) {
      $('#wizardValidation').textContent = error.message;
      return false;
    }
  }

  function setWizardStep(step) {
    const target = theory.clamp(Number(step) || 0, 0, 3);
    if (target > state.wizardStep && !validateWizardStep(state.wizardStep)) return;
    state.wizardStep = target;
    $$('[data-wizard-page]').forEach(page => page.classList.toggle('active', Number(page.dataset.wizardPage) === target));
    $$('[data-wizard-step]').forEach(button => {
      const value = Number(button.dataset.wizardStep);
      button.classList.toggle('active', value === target);
      button.classList.toggle('complete', value < target);
    });
    $('#wizardBack').hidden = target === 0;
    $('#wizardNext').hidden = target === 3;
    $('#createScoreButton').hidden = target !== 3;
    updateNewScoreWizard();
  }

  function advanceNewScoreWizard() {
    if (!validateWizardStep(state.wizardStep)) return;
    setWizardStep(state.wizardStep + 1);
  }

  function templatePreviewInfo(template, staffCount) {
    const counts = { solo:1, lead:1, piano:2, organ:2, 'voice-piano':3, ssa:3, satb:4, hymn:4, ttbb:4, 'string-quartet':4, 'african-percussion':4, 'worship-band':6, 'brass-band':10, 'concert-band':11, 'jazz-band':11, orchestra:14 };
    const count = template === 'custom' ? Math.max(1, Math.min(12, Number(staffCount) || 4)) : (counts[template] || 4);
    return { count, grand: ['piano','organ','voice-piano'].includes(template) };
  }

  function updateNewScoreWizard() {
    const data = wizardFormData();
    const title = String(data.title || '').trim() || 'Untitled Score';
    $('#wizardPreviewTitle').textContent = title;
    $('#wizardPreviewSubtitle').textContent = data.subtitle || '';
    $('#wizardPreviewDedication').textContent = data.dedication || '';
    $('#wizardPreviewComposer').textContent = data.composer || '';
    const supporting = [data.compositionDate && `Composed ${data.compositionDate}`, data.arranger && `Arranged by ${data.arranger}`, data.lyricist && `Lyrics: ${data.lyricist}`, data.source && `Source: ${data.source}`, data.supportingText].filter(Boolean).join(' · ');
    $('#wizardPreviewSupporting').textContent = supporting;
    $('#wizardPreviewMusicalMeta').textContent = `Key is ${data.key || 'C'} · Time ${data.timeSignature || '4/4'} · ♩ = ${Number(data.tempo) || 96}`;
    const orientation = data.orientation || 'portrait';
    $('#wizardPreviewPageLabel').textContent = `${data.pageSize || 'A4'} · ${orientation[0].toUpperCase()}${orientation.slice(1)}`;
    $('#wizardPreviewSheet').classList.toggle('landscape', orientation === 'landscape');
    const preview = templatePreviewInfo(data.template || 'satb', data.staffCount);
    const visible = Math.min(6, preview.count);
    $('#wizardPreviewStaves').innerHTML = Array.from({ length: 2 }, () => `<div class="wizard-preview-system">${preview.grand ? '<span class="wizard-preview-brace"></span>' : ''}${Array.from({ length: visible }, () => '<div class="wizard-preview-staff"></div>').join('')}</div>`).join('');
    $$('[data-time-signature]').forEach(button => button.classList.toggle('active', button.dataset.timeSignature === data.timeSignature));
    $$('.template-card').forEach(card => card.classList.toggle('selected', card.querySelector('input').checked));
    const templateLabel = $('.template-card input:checked')?.closest('.template-card')?.querySelector('strong')?.textContent || 'Score';
    const measures = Number(data.measures) || 16;
    $('#newScoreReview').innerHTML = [
      ['Score', `${templateLabel}<br>${preview.count} staff/staves · exactly four layers per staff`],
      ['Music', `${data.key || 'C'} · ${data.timeSignature || '4/4'} · ♩ = ${Number(data.tempo) || 96}<br>${measures} measures${Number(data.pickupBeats) ? ` · pickup ${data.pickupBeats} beats` : ''}`],
      ['Page', `${data.pageSize || 'A4'} · ${orientation}<br>${Number(data.margins) || 15} mm margins · ${data.concertPitch === 'false' ? 'transposed' : 'concert'} pitch`],
      ['Publication', `${title}<br>${data.composer || 'No composer entered'}${supporting ? `<br>${supporting}` : ''}`],
      ['Rhythm safety', `${data.autoFillRests ? 'Calculated rests enabled' : 'Calculated rests disabled'}<br>Barline overflow will split and tie notes`],
      ['Opening view', `Staff notation only<br>Tonic Sol-fa remains optional and synchronized`]
    ].map(([heading,body]) => `<div class="review-card"><strong>${escapeHtml(heading)}</strong><span>${String(body).split('<br>').map(escapeHtml).join('<br>')}</span></div>`).join('');
  }

  function toggleChordEntry() {
    state.chordEntry = !state.chordEntry;
    const button = $('#chordEntryButton');
    button?.classList.toggle('active', state.chordEntry);
    button?.setAttribute('aria-pressed', String(state.chordEntry));
    setStatus(state.chordEntry ? 'Chord entry enabled — additional notes stay on the same beat. Use Right Arrow or disable chord entry to advance.' : 'Chord entry disabled — the caret advances after note entry.');
    setEntryMode('note');
  }

  function restoreEntryKeypadState() {
    const floating = safeStorage.getItem('airmon-entry-keypad-floating') === 'true';
    const collapsed = safeStorage.getItem('airmon-entry-keypad-collapsed') === 'true';
    state.keypadFloating = floating;
    state.keypadCollapsed = collapsed;
    const panel = $('#entryKeypadWindow');
    panel.classList.toggle('floating', floating);
    panel.classList.toggle('keypad-collapsed', collapsed);
    const stored = safeStorage.getItem('airmon-entry-keypad-position');
    if (floating && stored) {
      try { const pos = JSON.parse(stored); panel.style.left = `${Number(pos.left) || 24}px`; panel.style.top = `${Number(pos.top) || 120}px`; } catch (_) {}
    }
    updateEntryKeypadChrome();
  }

  function updateEntryKeypadChrome() {
    const panel = $('#entryKeypadWindow');
    $('#entryKeypadModeLabel').textContent = state.keypadFloating ? 'Floating symbol keypad' : 'Docked symbol keypad';
    $('#entryKeypadFloatButton').textContent = state.keypadFloating ? '↙' : '↗';
    $('#entryKeypadCollapseButton').textContent = state.keypadCollapsed ? '+' : '−';
    if (!state.keypadFloating) { panel.style.left = ''; panel.style.top = ''; }
  }

  function toggleEntryKeypadFloating() {
    state.keypadFloating = !state.keypadFloating;
    const panel = $('#entryKeypadWindow');
    panel.classList.toggle('floating', state.keypadFloating);
    if (state.keypadFloating) {
      const rect = panel.getBoundingClientRect();
      panel.style.left = `${Math.max(12, Math.min(window.innerWidth - 330, rect.left || 24))}px`;
      panel.style.top = `${Math.max(70, Math.min(window.innerHeight - 180, rect.top || 120))}px`;
    }
    safeStorage.setItem('airmon-entry-keypad-floating', String(state.keypadFloating));
    updateEntryKeypadChrome();
    setStatus(state.keypadFloating ? 'Simple Entry symbols are now in a floating keypad.' : 'Simple Entry symbols are docked in the score panel.');
  }

  function toggleEntryKeypadCollapsed() {
    state.keypadCollapsed = !state.keypadCollapsed;
    $('#entryKeypadWindow').classList.toggle('keypad-collapsed', state.keypadCollapsed);
    safeStorage.setItem('airmon-entry-keypad-collapsed', String(state.keypadCollapsed));
    updateEntryKeypadChrome();
  }

  function beginEntryKeypadDrag(event) {
    if (!state.keypadFloating || event.target.closest('button')) return;
    const panel = $('#entryKeypadWindow');
    const rect = panel.getBoundingClientRect();
    state.keypadDrag = { pointerId:event.pointerId, offsetX:event.clientX-rect.left, offsetY:event.clientY-rect.top };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  }

  function updateEntryKeypadDrag(event) {
    if (!state.keypadDrag || event.pointerId !== state.keypadDrag.pointerId) return;
    const panel = $('#entryKeypadWindow');
    const left = theory.clamp(event.clientX - state.keypadDrag.offsetX, 8, Math.max(8, window.innerWidth - panel.offsetWidth - 8));
    const top = theory.clamp(event.clientY - state.keypadDrag.offsetY, 55, Math.max(55, window.innerHeight - panel.offsetHeight - 8));
    panel.style.left = `${left}px`; panel.style.top = `${top}px`;
  }

  function finishEntryKeypadDrag(event) {
    if (!state.keypadDrag || (event.pointerId != null && event.pointerId !== state.keypadDrag.pointerId)) return;
    const panel = $('#entryKeypadWindow');
    state.keypadDrag = null;
    safeStorage.setItem('airmon-entry-keypad-position', JSON.stringify({ left:parseFloat(panel.style.left)||24, top:parseFloat(panel.style.top)||120 }));
  }

  function createNewScore(event) {
    event.preventDefault();
    if (!confirmDiscardChanges('create a new score')) return;
    const form = $('#newScoreForm');
    const data = Object.fromEntries(new FormData(form).entries());
    data.autoFillRests = form.querySelector('[name="autoFillRests"]').checked;
    data.staffCount = Number(data.staffCount) || 4;
    data.measures = Number(data.measures) || 16;
    data.tempo = Number(data.tempo) || 96;
    data.initialLayers = 4;
    data.concertPitch = String(data.concertPitch) !== 'false';
    data.margins = Number(data.margins) || 15;
    data.showSolfa = false;
    data.lyricAutoAdvance = true;
    data.entryLayerColors = true;
    if (!validateWizardStep(3)) return;
    try {
      model.timeSignatureInfo(data.timeSignature);
      state.playback.stop({ notify: false });
      const previousPath = state.filePath;
      state.score = model.createScore(data);
      state.filePath = null; setDocumentReadOnly(false); state.baselineChecksum = null; state.baselineRevision = null;
      invalidateScoreRender('new score');
      if (previousPath && window.airmonDesktop?.releaseDocument) window.airmonDesktop.releaseDocument(previousPath).catch(() => {});
      state.selectedPartId = state.score.parts[0]?.id;
      state.selectedEventId = null; state.selection.clear(); state.activeVoice = 1; state.cursorBeat = 0;
      state.history = new HistoryManager(160); state.history.snapshot(state.score, 'New score'); state.dirty = true;
      state.midiStep = new midi.StepTimeMidiInput(state.score, { partId: state.selectedPartId, voice: 1, duration: state.duration, cursor: 0 });
      closeDialog('newScoreDialog'); setView('score'); renderAll();
      toast(`New score created with ${state.score.parts.length} staff part${state.score.parts.length === 1 ? '' : 's'} and ${state.score.measures.length} measures.`, 'success');
    } catch (error) { toast(error.message, 'error'); }
  }

  function insertCurrentMeasure() {
    const index = model.measureIndexAt(state.score, state.cursorBeat);
    checkpoint('Insert measure'); model.insertMeasures(state.score, index, 1); state.selectedMeasure = index; state.cursorBeat = model.measureStartBeat(state.score, index); commit('Insert measure');
    toast(`Inserted a new measure before bar ${index + 1}. All later notes, lyrics, layers and harmony were moved safely.`, 'success');
  }

  function appendMeasure() {
    checkpoint('Append measure'); const index = state.score.measures.length; model.appendMeasures(state.score, 1); state.selectedMeasure = index; state.cursorBeat = model.measureStartBeat(state.score, index); commit('Append measure'); toast(`Added bar ${index + 1}.`, 'success');
  }

  function openMeasureSettings() {
    const index = model.measureIndexAt(state.score, state.cursorBeat); state.selectedMeasure = index;
    const measure = state.score.measures[index];
    $('#measureNumberInput').value = index + 1;
    $('#measureNumberInput').max = state.score.measures.length;
    $('#measureTimeInput').value = measure.timeSignature || '';
    $('#measureKeyInput').value = measure.key || '';
    $('#measureRepeatTimes').value = measure.repeatTimes || 2;
    $('#measureRepeatStart').checked = Boolean(measure.repeatStart);
    $('#measureRepeatEnd').checked = Boolean(measure.repeatEnd);
    $('#measureNewSystem').checked = Boolean(measure.newSystem);
    $('#measureNewPage').checked = Boolean(measure.newPage);
    $('#measureEndings').value = (measure.endings || []).join(',');
    $('#measureRehearsal').value = measure.rehearsalMark || '';
    openDialog('measureDialog');
  }

  function applyMeasureSettings() {
    try {
      const index = theory.clamp(Number($('#measureNumberInput').value) - 1, 0, state.score.measures.length - 1);
      const timeSignature = $('#measureTimeInput').value.trim(); if (timeSignature) model.timeSignatureInfo(timeSignature);
      checkpoint('Update measure');
      model.setMeasureAttributes(state.score, index, {
        timeSignature: timeSignature || null, key: $('#measureKeyInput').value || null,
        repeatStart: $('#measureRepeatStart').checked, repeatEnd: $('#measureRepeatEnd').checked,
        repeatTimes: Number($('#measureRepeatTimes').value) || 2, endings: $('#measureEndings').value,
        rehearsalMark: $('#measureRehearsal').value,
        newSystem: $('#measureNewSystem').checked, newPage: $('#measureNewPage').checked
      });
      state.cursorBeat = model.measureStartBeat(state.score, index); state.selectedMeasure = index;
      commit('Update measure'); closeDialog('measureDialog');
      toast(`Bar ${index + 1} settings applied. Meter, key, repeats, endings and manual layout breaks now update notation, playback, MusicXML and tonic sol-fa.`, 'success');
    } catch (error) { toast(error.message, 'error'); }
  }

  function openPickupDialog() {
    const pickup = Math.max(0, Number(state.score.settings.pickupBeats) || 0);
    const common = ['0','0.25','0.5','0.75','1','1.5','2'];
    $('#pickupDuration').value = common.includes(String(pickup)) ? String(pickup) : 'custom';
    $('#pickupCustom').value = pickup || 1;
    openDialog('pickupDialog');
  }

  function applyPickupMeasure() {
    const selected = $('#pickupDuration').value;
    const value = selected === 'custom' ? Number($('#pickupCustom').value) : Number(selected);
    try {
      checkpoint('Configure pickup measure');
      const result = model.configurePickupMeasure(state.score, value);
      state.cursorBeat = 0;
      state.selectedMeasure = 0;
      commit('Configure pickup measure');
      closeDialog('pickupDialog');
      toast(result.pickupBeats > 0 ? `Pickup measure configured to ${formatBeat(result.pickupBeats)} quarter-note beats. Later score events remained aligned.` : 'Pickup removed. The first measure now uses its complete nominal duration.', 'success');
    } catch (error) {
      state.checkpointRevision = null;
      toast(`Could not configure pickup: ${error.message}`, 'error');
    }
  }

  function annotationAnchorContext() {
    const selected = getSelected();
    const part = selected.part || state.score.parts.find(item => item.id === state.selectedPartId) || state.score.parts[0];
    const start = selected.event?.start ?? state.cursorBeat;
    const measureIndex = model.measureIndexAt(state.score, start);
    const staff = selected.event?.staff || (model.isMultiStaff(part) ? activeStaffForPart(part) : null);
    return { part, staff, start, measureIndex };
  }

  function pageIndexForMeasure(measureIndex) {
    const layout = state.layout?.measureToSystem ? state.layout : buildLayout();
    const systemIndex = layout.measureToSystem?.get(measureIndex) ?? 0;
    return Math.max(0, Number(layout.systemsData?.[systemIndex]?.pageIndex) || 0);
  }

  function annotationTypeScope(type) {
    if (type === 'page-text') return 'page';
    if (type === 'header-text') return 'header';
    if (type === 'footer-text') return 'footer';
    if (type === 'measure-text' || type === 'rehearsal') return 'measure';
    if (['system-text', 'tempo-text'].includes(type)) return 'system';
    return 'segment';
  }

  function openAnchoredTextDialog(type = 'staff-text', annotationId = null) {
    const existing = annotationId ? (state.score.annotations || []).find(item => item.id === annotationId) : null;
    const context = annotationAnchorContext();
    const selectedType = existing?.type || type;
    const scope = existing?.scope || annotationTypeScope(selectedType);
    const pageIndex = existing?.pageIndex ?? pageIndexForMeasure(context.measureIndex);
    state.pendingTextType = selectedType;
    state.selectedAnnotationId = existing?.id || null;
    $('#anchoredTextTitle').textContent = existing ? 'Edit anchored text' : 'Add anchored text';
    $('#anchoredTextValue').value = existing?.text || '';
    $('#anchoredTextType').value = selectedType;
    $('#anchoredTextPlacement').value = existing?.placement || 'above';
    $('#anchoredTextAnchor').value = ['page', 'header', 'footer'].includes(scope)
      ? `Page ${pageIndex + 1} · ${scope === 'header' ? 'header' : scope === 'footer' ? 'footer' : 'page frame'}`
      : `Bar ${context.measureIndex + 1}, beat ${formatBeat(model.beatInMeasure(state.score, context.start) + 1)}${context.part ? ` · ${context.part.name}` : ''}${context.staff ? ` · ${context.staff}` : ''}`;
    openDialog('anchoredTextDialog');
    setTimeout(() => $('#anchoredTextValue')?.focus(), 0);
  }

  function applyAnchoredText() {
    const text = $('#anchoredTextValue').value.trim();
    if (!text) return toast('Enter text before adding it to the score.', 'error');
    const context = annotationAnchorContext();
    const type = $('#anchoredTextType').value || state.pendingTextType || 'staff-text';
    const scope = annotationTypeScope(type);
    const pageScoped = ['page', 'header', 'footer'].includes(scope);
    const systemScoped = pageScoped || scope === 'system' || scope === 'measure';
    const pageIndex = pageIndexForMeasure(context.measureIndex);
    const payload = {
      type,
      text,
      scope,
      start: pageScoped ? 0 : context.start,
      measureIndex: context.measureIndex,
      pageIndex,
      partId: systemScoped ? null : context.part?.id || null,
      staff: systemScoped ? null : context.staff || null,
      placement: $('#anchoredTextPlacement').value || 'above',
      alignment: pageScoped ? 'center' : 'left',
      style: type
    };
    const editingExisting = Boolean(state.selectedAnnotationId);
    checkpoint(editingExisting ? 'Edit anchored text' : 'Add anchored text');
    if (editingExisting) model.updateAnnotation(state.score, state.selectedAnnotationId, payload);
    else state.selectedAnnotationId = model.addAnnotation(state.score, payload).id;
    commit(editingExisting ? 'Update anchored text' : 'Add anchored text');
    closeDialog('anchoredTextDialog');
    toast(pageScoped ? 'Page text is anchored to the page frame and remains stable during musical reflow.' : 'Text is anchored to musical time and will remain attached during score reflow.', 'success');
  }

  function optimizeScoreLayout(scope = 'score') {
    const currentMeasure = model.measureIndexAt(state.score, state.cursorBeat);
    let selectedRange = null;
    if (scope === 'selection') {
      const entries = ensurePrimarySelection();
      if (!entries.length) return toast('Select one or more notes or rests before optimizing a passage.', 'error');
      const firstBeat = Math.min(...entries.map(({ event }) => Number(event.start) || 0));
      const lastBeat = Math.max(...entries.map(({ event }) => (Number(event.start) || 0) + Math.max(0, Number(event.duration) || 0)));
      selectedRange = {
        startMeasure: model.measureIndexAt(state.score, firstBeat),
        endMeasure: model.measureIndexAt(state.score, Math.max(firstBeat, lastBeat - EPSILON))
      };
    }
    const plan = layoutEngine.buildSystemPlan(state.score, {
      staffX: 132,
      availableWidth: Math.max(260, pageWidthPixels(state.score) - 190),
      minMeasures: 1,
      maxMeasures: 8,
      rightPadding: 28
    });
    const label = scope === 'system' ? 'Optimize current system' : scope === 'selection' ? 'Optimize selected passage' : 'Optimize complete score';
    checkpoint(label);
    state.score.layoutOptimization = {
      scope,
      measureIndex: scope === 'system' ? currentMeasure : null,
      startMeasure: selectedRange?.startMeasure ?? null,
      endMeasure: selectedRange?.endMeasure ?? null,
      systems: plan.systems.length,
      optimizedAt: new Date().toISOString(),
      preservesManualOffsets: true
    };
    model.touch(state.score);
    commit(label);
    const target = scope === 'system' ? 'Current system' : scope === 'selection' ? `Selected bars ${selectedRange.startMeasure + 1}–${selectedRange.endMeasure + 1}` : 'Complete score';
    toast(`${target} re-laid out from rhythmic density, lyrics, text, tonic sol-fa and staff collision requirements. Musical timing and manual offsets were preserved.`, 'success');
  }

  function renderImportReport(report) {
    const container = $('#importReportContent');
    if (!container || !report) return;
    const counts = report.counts || report;
    const rows = [
      ['Parts', counts.parts], ['Measures', counts.measures], ['Notes', counts.notes], ['Chords', counts.chords],
      ['Voices', counts.voices], ['Lyrics', counts.lyrics], ['Directions / text', counts.directions ?? counts.text],
      ['Metadata fields', counts.metadata], ['Harmony symbols', counts.harmony], ['Page / layout settings', counts.layout ?? counts.layoutImported]
    ].filter(([, value]) => value != null);
    const warnings = Array.isArray(report.warnings) ? report.warnings : [];
    const unsupported = Array.isArray(report.unsupported) ? report.unsupported : [];
    container.innerHTML = `${rows.map(([label, value]) => `<div class="analysis-item"><strong>${escapeHtml(label)}</strong><span>${Number(value) || 0}</span></div>`).join('')}${warnings.map(item => `<div class="analysis-item warning"><strong>Warning</strong><span>${escapeHtml(typeof item === 'string' ? item : item.message || JSON.stringify(item))}</span></div>`).join('')}${unsupported.map(item => `<div class="analysis-item warning"><strong>Unsupported</strong><span>${escapeHtml(typeof item === 'string' ? item : item.name || JSON.stringify(item))}</span></div>`).join('')}`;
  }

  function addPart() {
    const choices = Object.keys(model.INSTRUMENTS);
    const key = prompt(`Instrument key:\n${choices.join(', ')}`, 'piano');
    if (!key) return;
    checkpoint('Add instrument');
    state.score.parts.push(model.createPart(key));
    model.touch(state.score);
    commit('Add instrument');
  }

  function publicationVoiceLabel(part, voice) {
    const names = { soprano: 'S', alto: 'A', tenor: 'T', bass: 'B' };
    const normalized = String(part?.harmonyRole || part?.name || '').toLowerCase();
    for (const [key, label] of Object.entries(names)) if (normalized.includes(key)) return Number(voice) === 1 ? label : `${label}${voice}`;
    return `L${Number(voice) || 1}`;
  }

  function renderSolfa() {
    state.performance.metrics.solfaRenders += 1;
    const content = $('#solfaContent'); content.innerHTML = '';
    $$('#solfaPage .solfa-sheet.dynamic').forEach(page => page.remove());
    // Content-aware systems: a sparse hymn bar should not consume the same width
    // as a dense, multi-verse bar. The budget is deliberately independent of UI zoom.
    const measureWeight = index => {
      const bounds = model.measureBounds(state.score, index);
      const authored = state.score.parts.flatMap(part => part.events.filter(event => event.generatedBy !== 'gap-fill' && event.start >= bounds.start - 1e-8 && event.start < bounds.end - 1e-8));
      const lyricCharacters = authored.reduce((sum, event) => sum + (event.lyrics || []).reduce((inner, lyric) => inner + String(lyric.text || '').length, 0), 0);
      return theory.clamp(1.15 + authored.length * .16 + lyricCharacters * .012, 1.35, 3.4);
    };
    const pagePlan = solfaLayout.paginate(state.score);
    const systemGroups = pagePlan.systems.map(item => item.measureIndices);
    const firstSheet = $('#solfaFirstPage');
    const pageContents = [content];
    const dimensions = pagePlan.dimensions;
    firstSheet.style.width = `${dimensions.width}px`; firstSheet.style.minHeight = `${dimensions.height}px`;
    for (let pageIndex = 1; pageIndex < pagePlan.pages.length; pageIndex += 1) {
      const page = pagePlan.pages[pageIndex];
      const sheet = document.createElement('article');
      sheet.className = 'score-page solfa-sheet dynamic'; sheet.dataset.solfaPage = String(pageIndex + 1);
      sheet.style.width = `${dimensions.width}px`; sheet.style.minHeight = `${dimensions.height}px`;
      const header = document.createElement('div'); header.className = 'solfa-continuation-header';
      header.innerHTML = `<strong>${escapeHtml(state.score.metadata.title)}</strong><span>Key is ${escapeHtml(page.context.key)} · Time ${escapeHtml(page.context.timeSignature)} · begins at bar ${page.context.measure}</span>`;
      const pageContent = document.createElement('div'); pageContent.className = 'solfa-content';
      const footer = document.createElement('div'); footer.className = 'page-footer'; footer.innerHTML = `<span>Airmonlink Composer • Tonic Sol-fa</span><span class="solfa-page-number">${pageIndex + 1}</span>`;
      sheet.append(header, pageContent, footer); $('#solfaPage').appendChild(sheet); pageContents.push(pageContent);
    }
    const labelMode = state.score.settings.solfaLabels || 'short';
    const solfaOptions = {
      notationMode: 'traditional',
      labelStyle: labelMode === 'long' ? 'long' : 'short',
      noteNames: labelMode === 'notes',
      scaleDegrees: labelMode === 'degrees',
      showRhythm: state.score.settings.solfaShowRhythm !== false,
      showOctaveMarks: state.score.settings.solfaShowOctaveMarks !== false,
      pitchSystem: state.score.settings.solfaPitchSystem || 'movable-do',
      minorSystem: state.score.settings.minorSolfaSystem || 'do-based',
      convention: state.score.settings.solfaConvention || 'airmonlink-traditional-v1'
    };
    for (let system = 0; system < systemGroups.length; system += 1) {
      const indices = systemGroups[system];
      const showVoiceLabels = state.score.settings.solfaShowVoiceLabels === true;
      const grid = `${showVoiceLabels ? '46px' : '0px'} ${indices.map(index => `minmax(74px,${measureWeight(index).toFixed(2)}fr)`).join(' ')}`;
      const systemEl = document.createElement('section'); systemEl.className = 'solfa-system';
      const ruler = document.createElement('div'); ruler.className = 'solfa-system-ruler'; ruler.style.gridTemplateColumns = grid;
      ruler.innerHTML = `<span class="solfa-ruler-label">${showVoiceLabels ? `S${system + 1}` : ''}</span>${indices.map(index => `<span>Bar ${index + 1}</span>`).join('')}`;
      systemEl.appendChild(ruler);
      state.score.parts.forEach(part => {
        const partBlock = document.createElement('div'); partBlock.className = 'solfa-score-part';
        const rows = partStaffRows(part);
        const layers = [1, 2, 3, 4];
        rows.forEach(row => layers.forEach(voice => {
          const systemStart = model.measureBounds(state.score, indices[0]).start;
          const systemEnd = model.measureBounds(state.score, indices.at(-1)).end;
          const authored = part.events.some(event => (event.voice || 1) === voice && (rows.length === 1 || (event.staff || null) === (row.staff || null)) && event.generatedBy !== 'gap-fill' && event.start >= systemStart - 1e-8 && event.start < systemEnd - 1e-8);
          if (!authored && state.score.settings.solfaShowEmptyLayers !== true) return;
          const line = document.createElement('div'); line.className = 'solfa-layer-line'; line.style.gridTemplateColumns = grid;
          const label = document.createElement('div'); label.className = 'solfa-line-label'; label.textContent = showVoiceLabels ? publicationVoiceLabel(part, voice) : ''; label.setAttribute('aria-hidden', showVoiceLabels ? 'false' : 'true'); line.appendChild(label);
          const bars = solfa.partToSolfa(part, state.score, { ...solfaOptions, voice, staff: row.staff });
          const labelledVerses = new Set();
          const visibleVerses = [...new Set(indices.flatMap(index => (bars[index] || []).flatMap(token => (token.lyrics || []).map(lyric => Math.max(1, Number(lyric.verse) || 1)))))].sort((a, b) => a - b);
          indices.forEach(measureIndex => {
            const measure = state.score.measures[measureIndex];
            const bounds = model.measureBounds(state.score, measureIndex);
            const bar = bars[measureIndex] || [];
            const cell = document.createElement('div'); cell.className = `solfa-measure-cell ${bar.complete || state.score.settings.solfaShowWarnings === false ? 'complete' : 'incomplete'}`;
            const changes = [];
            if (measureIndex > 0 && measure.key && state.score.settings.solfaShowTonicChanges !== false) changes.push(`Key is ${bounds.key}`);
            if (measureIndex > 0 && measure.timeSignature && state.score.settings.solfaShowMeasureDivisions !== false) changes.push(`Time ${bounds.timeSignature}`);
            if (measure.repeatStart) changes.push('𝄆'); if (measure.repeatEnd) changes.push(`𝄇 ×${measure.repeatTimes || 2}`);
            if (measure.endings?.length) changes.push(`${measure.endings.join(',')}. ending`);
            if (changes.length) { const tag = document.createElement('span'); tag.className = 'solfa-measure-change'; tag.textContent = changes.join(' · '); cell.appendChild(tag); }
            bar.forEach(token => {
              const tokenEl = document.createElement('span'); tokenEl.className = `solfa-token ${token.rest ? 'rest' : 'editable'} ${token.valid ? '' : 'invalid'} ${token.eventId === state.selectedEventId ? 'selected' : ''}`;
              tokenEl.style.left = `${theory.clamp((token.start - bounds.start) / bounds.capacity, 0, .99) * 100}%`;
              tokenEl.innerHTML = `<strong>${escapeHtml(token.text)}</strong>`;
              if (!token.rest) {
                tokenEl.title = 'Double-click to edit this tonic sol-fa syllable and update the staff note.';
                tokenEl.addEventListener('click', () => { state.selectedPartId = part.id; state.selectedEventId = token.eventId; state.cursorBeat = token.start; state.selection.selectEvent(token.eventId); renderAll(); });
                tokenEl.addEventListener('dblclick', () => { state.selectedPartId = part.id; state.selectedEventId = token.eventId; editSelectedSolfa(); });
              }
              if (state.score.settings.solfaShowLyrics !== false) {
                const lyricLines = token.lyrics?.length ? token.lyrics : (token.lyric ? [{ verse: 1, text: token.lyric }] : []);
                lyricLines.forEach(lyric => {
                  const verse = Math.max(1, Number(lyric.verse) || 1);
                  const laneIndex = Math.max(0, visibleVerses.indexOf(verse));
                  const lyricEl = document.createElement('em'); lyricEl.style.top = `${24 + laneIndex * 14 + (Number(lyric.offsetY ?? token.lyricOffsetY) || 0)}px`; lyricEl.style.transform = `translateX(calc(-50% + ${Number(lyric.offsetX ?? token.lyricOffsetX) || 0}px))`;
                  const prefix = labelledVerses.has(verse) ? '' : `${verse}. `;
                  labelledVerses.add(verse);
                  lyricEl.textContent = `${prefix}${solfa.lyricPublicationText(lyric, token.rest ? '·' : '—')}`;
                  tokenEl.appendChild(lyricEl);
                });
              }
              cell.appendChild(tokenEl);
            });
            line.appendChild(cell);
          });
          partBlock.appendChild(line);
        }));
        if (partBlock.childElementCount) systemEl.appendChild(partBlock);
      });
      const pageIndex = pagePlan.pages.findIndex(page => page.systems.includes(pagePlan.systems[system]));
      pageContents[Math.max(0, pageIndex)].appendChild(systemEl);
    }
    $('#solfaPage').dataset.pageCount = String(pagePlan.pages.length);
    $('#solfaPage').dataset.printPageCount = String(pagePlan.pages.length);
    if (state.solfaFitMode !== 'manual') requestAnimationFrame(() => applySolfaFit(state.solfaFitMode));
  }

  function renderMixer() {
    state.performance.metrics.mixerRenders += 1;
    const container = $('#mixerContent');
    container.innerHTML = '';
    state.score.parts.forEach(part => {
      const strip = document.createElement('div');
      strip.className = 'channel-strip';
      strip.innerHTML = `<strong>${escapeHtml(part.shortName || part.name)}</strong><small>${escapeHtml(part.name)}</small><input class="vertical-range" type="range" min="0" max="1" step="0.01" value="${part.volume ?? .8}" aria-label="${escapeHtml(part.name)} volume"/><div class="channel-buttons"><button class="mixer-mute ${part.muted ? 'active' : ''}">M</button><button class="mixer-solo ${part.solo ? 'active' : ''}">S</button></div>`;
      strip.querySelector('input').addEventListener('input', event => {
        part.volume = Number(event.target.value);
        state.dirty = true;
        scheduleAutosave();
      });
      strip.querySelector('.mixer-mute').addEventListener('click', () => {
        part.muted = !part.muted;
        commit('Toggle mute');
      });
      strip.querySelector('.mixer-solo').addEventListener('click', () => {
        part.solo = !part.solo;
        commit('Toggle solo');
      });
      container.appendChild(strip);
    });
  }

  function renderStats() {
    const statsSignature = `${state.performance.scoreEpoch}|${state.score.revision || 0}`;
    if (state.performance.signatures.stats === statsSignature) return;
    state.performance.signatures.stats = statsSignature;
    const noteCount = state.score.parts.reduce((sum, part) => sum + part.events.filter(event => event.type === 'note').length, 0);
    const authoredRestCount = state.score.parts.reduce((sum, part) => sum + part.events.filter(event => event.type === 'rest' && event.generatedBy !== 'gap-fill').length, 0);
    const calculatedRestCount = state.score.parts.reduce((sum, part) => sum + part.events.filter(event => event.type === 'rest' && event.generatedBy === 'gap-fill').length, 0);
    const lyricCount = lyricEngine.lyricCount(state.score);
    $('#projectStats').innerHTML = `<div class="stat-line"><span>Parts</span><strong>${state.score.parts.length}</strong></div><div class="stat-line"><span>Measures</span><strong>${state.score.settings.measures}</strong></div><div class="stat-line"><span>Notes</span><strong>${noteCount}</strong></div><div class="stat-line"><span>Entered rests</span><strong>${authoredRestCount}</strong></div><div class="stat-line"><span>Calculated rests</span><strong>${calculatedRestCount}</strong></div><div class="stat-line"><span>Lyrics</span><strong>${lyricCount}</strong></div><div class="stat-line"><span>Revision</span><strong>${state.score.revision || 1}</strong></div>`;
  }


  function renderStatusBar() {
    const part = state.score.parts.find(item => item.id === state.selectedPartId) || state.score.parts[0];
    const selected = getSelected();
    const staff = selected.event?.staff || (model.isMultiStaff(part) ? 'treble' : part?.clef || '—');
    const measureIndex = model.measureIndexAt(state.score, state.cursorBeat);
    const key = model.effectiveKey(state.score, measureIndex);
    const time = model.effectiveTimeSignature(state.score, measureIndex);
    $('#statusPart').textContent = `Part: ${part?.name || '—'}`;
    $('#statusStaff').textContent = `Staff: ${staff || 'single'}`;
    $('#statusLayer').textContent = `Layer ${state.activeVoice}`;
    $('#statusMeasure').textContent = `Bar ${measureIndex + 1}`;
    $('#statusKey').textContent = `Key: ${key}`;
    $('#statusTime').textContent = `Time: ${time}`;
    $('#statusDuration').textContent = theory.durationName(state.duration);
    $('#statusDirty').textContent = state.readOnly ? 'Read-only' : (state.dirty ? 'Unsaved changes' : 'Saved');
    $('#statusDirty').classList.toggle('dirty', state.dirty || state.readOnly);
    $('#currentMeasureQuick').textContent = `Bar ${measureIndex + 1}`;
    $('#zoomQuick').textContent = `${Math.round(state.zoom * 100)}%`;
    const beatInBar = model.beatInMeasure(state.score, state.cursorBeat) + 1;
    const caret = $('#notationCaretReadout');
    if (caret) caret.textContent = `Caret: ${part?.shortName || part?.name || 'Part'} · ${staff || 'single staff'} · Layer ${state.activeVoice} · Bar ${measureIndex + 1} · Beat ${formatBeat(beatInBar)} · ${theory.durationName(state.duration)} · ${state.mode === 'eraser' ? 'Eraser' : state.chordEntry && state.mode === 'note' ? 'Chord entry' : 'Insert'}`;
  }

  function setView(view) {
    state.currentView = view;
    $('#scorePage').classList.toggle('hidden', view !== 'score');
    $('#solfaPage').classList.toggle('hidden', view !== 'solfa');
    $('#mixerPage').classList.toggle('hidden', view !== 'mixer');
    $('#solfaEditorToolbar').classList.toggle('hidden', view !== 'solfa');
    $$('.nav-item').forEach(button => button.classList.toggle('active', button.dataset.view === view));
    $('#currentViewLabel').textContent = view === 'score' ? 'Full Score' : view === 'solfa' ? 'Tonic Sol-fa' : 'Mixer';
    if (view === 'score') renderScore();
    else if (view === 'solfa') renderSolfa();
    else if (view === 'mixer') renderMixer();
    applyZoom();
  }

  function setZoom(value) {
    state.solfaFitMode = 'manual';
    state.zoom = theory.clamp(value, .55, 1.45);
    $('#zoomSlider').value = Math.round(state.zoom * 100);
    $('#zoomLabel').textContent = `${Math.round(state.zoom * 100)}%`;
    $('#zoomQuick').textContent = `${Math.round(state.zoom * 100)}%`;
    applyZoom();
  }

  function applyZoom() {
    ['scorePage', 'solfaPage'].forEach(id => {
      const element = document.getElementById(id);
      element.style.transform = `scale(${state.zoom})`;
      element.style.transformOrigin = 'top center';
      element.style.marginBottom = `${Math.max(-600, (state.zoom - 1) * element.offsetHeight)}px`;
    });
  }

  function applySolfaFit(mode) {
    state.solfaFitMode = mode;
    const dimensions = solfaLayout.pageDimensions(state.score);
    const viewport = $('#canvasScroll').getBoundingClientRect();
    state.zoom = solfaLayout.fitScale(mode, { width: viewport.width, height: viewport.height }, dimensions, state.zoom);
    $('#solfaPage').dataset.fitMode = mode;
    $('#zoomSlider').value = Math.round(state.zoom * 100);
    $('#zoomLabel').textContent = `${Math.round(state.zoom * 100)}%`;
    $('#zoomQuick').textContent = `${Math.round(state.zoom * 100)}%`;
    $$('.solfa-fit-controls button').forEach(button => button.classList.toggle('active', (mode === 'width' && button.id === 'solfaFitWidth') || (mode === 'page' && button.id === 'solfaFitPage') || (mode === 'actual' && button.id === 'solfaActualSize')));
    applyZoom();
  }

  function openHarmony() {
    const source = $('#harmonySource');
    source.innerHTML = state.score.parts.map(part => `<option value="${part.id}">${escapeHtml(part.name)}</option>`).join('');
    source.value = state.selectedPartId || state.score.parts[0]?.id;
    const selected = getSelected();
    $('#harmonySourceStaff').value = selected.event?.staff || 'all';
    $('#harmonySourceLayer').value = String(selected.event?.voice || state.activeVoice || 1);
    $('#harmonyResults').innerHTML = '<div class="empty-results">Choose the exact source staff and layer, then generate alternatives.</div>';
    openDialog('harmonyDialog');
  }

  function generateHarmonyAlternatives() {
    try {
      const sourcePartId = $('#harmonySource').value;
      const sourcePart = state.score.parts.find(part => part.id === sourcePartId);
      const sourceLayerValue = $('#harmonySourceLayer').value;
      const options = {
        sourcePartId,
        sourceStaff: $('#harmonySourceStaff').value,
        sourceVoice: sourceLayerValue === 'all' ? null : Number(sourceLayerValue),
        melodyVoice: $('#harmonyVoice').value,
        style: $('#harmonyStyle').value,
        destination: $('#harmonyDestination').value
      };
      if (!harmony.sourceMelodyEvents(state.score, sourcePart, options).length) return toast('The selected staff and layer have no melody notes.', 'error');
      state.harmonyAlternatives = harmony.generateAlternatives(state.score, options);
      const results = $('#harmonyResults'); results.innerHTML = '';
      state.harmonyAlternatives.forEach((variant, index) => {
        const card = document.createElement('div'); card.className = 'harmony-card';
        const voiceCounts = ['soprano','alto','tenor','bass'].map(voice => `${voice[0].toUpperCase()}: ${variant.eventsByVoice[voice].length}`).join(' · ');
        card.innerHTML = `<h3>${escapeHtml(variant.style)} harmony</h3><p>${variant.chords.slice(0, 8).map(chord => chord.symbol).join(' – ')}</p><div class="harmony-preview">${['soprano','alto','tenor','bass'].map((voice, i) => `<div class="voice-line" style="width:${88 - i * 8}%" title="${voice}"></div>`).join('')}</div><div class="warning">${variant.issues.length ? `${variant.issues.length} voice-leading notice${variant.issues.length === 1 ? '' : 's'}` : 'No basic voice-leading warnings'}<br>${voiceCounts}<br>Source: ${escapeHtml(variant.sourcePartName)} · ${escapeHtml(String(variant.sourceStaff || 'all staff'))} · Layer ${variant.sourceVoice || 'all'}</div><button class="button primary full">Apply to ${escapeHtml($('#harmonyDestination option:checked').textContent)}</button>`;
        card.querySelector('button').addEventListener('click', () => applyHarmony(index)); results.appendChild(card);
      });
    } catch (error) { toast(`Harmony generation failed: ${error.message}`, 'error'); }
  }

  function applyHarmony(index) {
    const variant = state.harmonyAlternatives[index]; if (!variant) return;
    checkpoint('Replace harmony');
    const destination = $('#harmonyDestination').value;
    const result = harmony.applyVariant(state.score, variant, { destination });
    state.selectedPartId = variant.sourcePartId; state.selectedEventId = null; state.cursorBeat = variant.sourceEvents[0]?.start || 0;
    commit('Replace harmony'); closeDialog('harmonyDialog'); setView('score');
    toast(`${result.style} harmony applied to ${result.destination}. Previous generated harmony for this source was fully replaced.`, 'success');
  }

  function inspectScore() {
    const issues = [...model.validateScore(state.score), ...solfa.verifyScoreSolfa(state.score)];
    const container = $('#analysisResults');
    if (!issues.length) {
      container.innerHTML = '<div class="analysis-item success"><span class="status-dot"></span><div><strong>No structural warnings found</strong><div>Staff pitch, playback pitch, tonic sol-fa, ranges and measure boundaries agree.</div></div></div>';
    } else {
      container.innerHTML = issues.map(issue => `<div class="analysis-item ${issue.severity === 'error' ? 'error' : ''}"><span class="status-dot"></span><div><strong>${escapeHtml(issue.severity)}</strong><div>${escapeHtml(issue.message)}</div></div></div>`).join('');
    }
    openDialog('analysisDialog');
  }

  function togglePlayback() {
    if (state.playback.playing) {
      state.playback.stop();
      return;
    }
    const hasNotes = state.score.parts.some(part => part.events.some(event => event.type === 'note'));
    if (!hasNotes) return toast('Enter at least one note before playback.', 'error');
    $('#playButton').textContent = '❚❚';
    const range = activeLoopRange();
    const start = range ? Math.max(range.start, Math.min(state.cursorBeat, range.end - EPSILON)) : (state.cursorBeat >= model.totalBeats(state.score) ? 0 : state.cursorBeat);
    state.playback.play(state.score, start, state.loop, range);
    setStatus('Playing');
  }

  function clampCursor(beat) {
    return theory.clamp(Number(beat) || 0, 0, Math.max(0, model.totalBeats(state.score) - .0001));
  }

  function seekTo(beat, previewOnly = false) {
    state.cursorBeat = clampCursor(beat);
    if (!previewOnly) state.playback.seek(state.score, state.cursorBeat, state.loop, activeLoopRange());
    else if (state.playback.playing) state.playback.seek(state.score, state.cursorBeat, state.loop, activeLoopRange());
    updateTimeline();
    renderScore();
  }

  function navigateMeasure(direction) {
    const current = model.measureIndexAt(state.score, state.cursorBeat);
    const bounds = model.measureBounds(state.score, current);
    const target = direction < 0 && state.cursorBeat > bounds.start + .001 ? current : theory.clamp(current + direction, 0, state.score.measures.length - 1);
    seekTo(model.measureStartBeat(state.score, target));
  }


  function skipMeasures(direction) {
    const count = Math.max(2, Number($('#measureSkipCount')?.value) || 4);
    const current = model.measureIndexAt(state.score, state.cursorBeat);
    const mode = $('#playbackNavigationMode')?.value || 'written';
    let target;
    if (mode === 'performance') {
      const order = model.playbackMeasureOrder(state.score);
      if (!order.length) return;
      const currentMatches = order.map((item, index) => ({ item, index })).filter(({ item }) => item.measureIndex === current);
      const nearest = currentMatches.find(({ index }) => index >= state.performanceOrderIndex) || currentMatches.at(-1);
      if (nearest) state.performanceOrderIndex = nearest.index;
      state.performanceOrderIndex = theory.clamp(state.performanceOrderIndex + direction * count, 0, order.length - 1);
      target = order[state.performanceOrderIndex].measureIndex;
    } else {
      target = theory.clamp(current + direction * count, 0, state.score.measures.length - 1);
      state.performanceOrderIndex = 0;
    }
    seekTo(model.measureStartBeat(state.score, target));
    setStatus(`Playback cursor moved ${direction < 0 ? 'back' : 'forward'} in ${mode === 'performance' ? 'performance' : 'written score'} order to bar ${target + 1}.`);
  }

  function openGoToMeasure() {
    $('#goMeasureNumber').max = String(state.score.measures.length);
    $('#goMeasureNumber').value = String(model.measureIndexAt(state.score, state.cursorBeat) + 1);
    openDialog('goMeasureDialog');
  }

  function applyGoToMeasure() {
    const target = theory.clamp((Number($('#goMeasureNumber').value) || 1) - 1, 0, state.score.measures.length - 1);
    if (($('#playbackNavigationMode')?.value || 'written') === 'performance') {
      const order = model.playbackMeasureOrder(state.score);
      state.performanceOrderIndex = Math.max(0, order.findIndex(item => item.measureIndex === target));
    }
    seekTo(model.measureStartBeat(state.score, target));
    closeDialog('goMeasureDialog');
    setStatus(`Playback cursor moved to bar ${target + 1}.`);
  }

  function allNoteStarts() {
    return [...new Set(state.score.parts.flatMap(part => part.events.filter(event => event.type === 'note').map(event => Number(event.start).toFixed(6))))]
      .map(Number).sort((a, b) => a - b);
  }

  function navigateNote(direction) {
    const starts = allNoteStarts();
    if (!starts.length) return toast('There are no notes to navigate.');
    let target;
    if (direction > 0) target = starts.find(start => start > state.cursorBeat + .001) ?? starts.at(-1);
    else target = [...starts].reverse().find(start => start < state.cursorBeat - .001) ?? starts[0];
    seekTo(target);
  }

  function updatePlaybackCursor() {
    const activeBeat = state.playBeat >= 0 ? state.playBeat : state.cursorBeat;
    refreshPlaybackClasses();
    state.cursorBeat = clampCursor(activeBeat);
    updateTimeline();
    const oldPlayhead = $('#notationCanvas .playhead-layer');
    if (oldPlayhead) {
      oldPlayhead.remove();
      const svg = $('#notationCanvas svg');
      if (svg) drawPlayhead(svg);
    }
  }

  function drawPlayhead(svg) {
    if (!state.layout) return;
    const beat = state.playBeat >= 0 ? state.playBeat : state.cursorBeat;
    const measureIndex = model.measureIndexAt(state.score, beat);
    const system = theory.clamp(systemForMeasure(measureIndex), 0, state.layout.systems - 1);
    const x = xForBeat(beat);
    const group = svgEl('g', { class: 'playhead-layer' });
    group.appendChild(svgEl('line', {
      x1: x, x2: x,
      y1: systemTop(system) + 7,
      y2: systemTop(system) + state.layout.parts.at(-1).blockBottom + 12,
      class: 'playhead-line'
    }));
    group.appendChild(svgEl('path', { d: `M ${x - 5} ${systemTop(system) + 5} L ${x + 5} ${systemTop(system) + 5} L ${x} ${systemTop(system) + 12} Z`, class: 'playhead-handle' }));
    svg.appendChild(group);
  }

  function updateTimeline() {
    const total = model.totalBeats(state.score); const seek = $('#playbackSeek');
    seek.max = String(total); seek.step = '0.0625'; seek.value = String(theory.clamp(state.playBeat >= 0 ? state.playBeat : state.cursorBeat, 0, total));
    $('#timelineStart').textContent = '1:1';
    const last = state.score.measures.length - 1; $('#timelineEnd').textContent = `${last + 1}:${formatBeat(model.measureCapacity(state.score, last))}`;
    updateCursorText();
  }

  function updateCursorText() {
    const barIndex = model.measureIndexAt(state.score, state.cursorBeat);
    const beat = model.beatInMeasure(state.score, state.cursorBeat) + 1;
    let noteAtCursor = null;
    let nearestDistance = Infinity;
    for (const part of state.score.parts) {
      for (const event of part.events) {
        if (event.type !== 'note') continue;
        const distance = Math.abs(Number(event.start) - state.cursorBeat);
        if (distance < nearestDistance) { nearestDistance = distance; noteAtCursor = { part, event }; }
      }
    }
    const pitchLabel = noteAtCursor && Math.abs(noteAtCursor.event.start - state.cursorBeat) < .001 ? ` · ${writtenPitch(noteAtCursor.event, noteAtCursor.part)} · L${noteAtCursor.event.voice || 1}` : '';
    $('#cursorPosition').textContent = `Bar ${barIndex + 1} • Beat ${formatBeat(beat)}${pitchLabel}`;
    state.selectedMeasure = barIndex;
    renderStatusBar();
    const activePart = state.score.parts.find(part => part.id === state.selectedPartId) || state.score.parts[0];
    if (activePart) renderLayerCapacityInspector(activePart);
  }

  function buildPiano() {
    const keyboard = $('#pianoKeyboard');
    keyboard.innerHTML = '';
    for (let midi = 48; midi <= 83; midi += 1) {
      const pitch = theory.midiToPitch(midi);
      const black = pitch.includes('#');
      const key = document.createElement('button');
      key.className = `piano-key ${black ? 'black' : ''}`;
      key.dataset.midi = midi;
      key.textContent = black ? pitch.replace(/\d/g, '') : pitch;
      key.title = pitch;
      key.addEventListener('mousedown', () => enterPianoNote(midi, key));
      keyboard.appendChild(key);
    }
  }

  function enterPianoNote(midi, key) {
    const part = state.score.parts.find(item => item.id === state.selectedPartId) || state.score.parts[0]; if (!part) return;
    key.classList.add('active'); setTimeout(() => key.classList.remove('active'), 180); previewPitch(midi);
    const rows = partStaffRows(part); const staff = rows.length > 1 ? (midi < 60 ? rows.at(-1).staff : rows[0].staff) : null;
    const existingAnchor = state.mode !== 'rest' ? chordAnchorAt(part, state.cursorBeat, state.activeVoice, staff) : null;
    const candidate = { type: state.mode === 'rest' ? 'rest' : 'note', midi, start: state.cursorBeat, duration: state.duration, staff, voice: state.activeVoice, allowChord: state.chordEntry || Boolean(existingAnchor), allowAcrossBarline: state.mode !== 'rest' };
    const validation = model.canPlaceEvent(state.score, part.id, candidate); if (!validation.ok) return toast(validation.reason, 'error');
    checkpoint(state.mode === 'rest' ? 'Add piano rest' : 'Add piano note');
    try {
      let events;
      let chordAdded = false;
      if (state.mode === 'rest') events = [model.addRest(state.score, part.id, candidate)];
      else {
        const anchor = existingAnchor;
        if (anchor) { events = [model.addChordTone(state.score, part.id, anchor.id, midi)]; chordAdded = true; }
        else events = editing.addNoteAcrossBarlines(state.score, part.id, candidate);
      }
      const selectedIds = chordAdded ? model.chordMembers(state.score, events[0].id).map(item => item.id) : events.map(item => item.id);
      state.selection.selectEvents(selectedIds);
      state.selectedEventId = events[0]?.id || null;
      if (!(state.chordEntry && state.mode !== 'rest') && !chordAdded) state.cursorBeat = clampCursor(state.cursorBeat + state.duration);
      commit(state.mode === 'rest' ? 'Add piano rest' : chordAdded ? 'Add piano chord tone' : (events.length > 1 ? 'Add tied piano note' : 'Add piano note'));
    } catch (error) { toast(error.message, 'error'); }
  }

  function previewPitch(midi) {
    try {
      const context = state.playback.ensureContext();
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.frequency.value = theory.frequencyForMidi(midi);
      oscillator.type = 'sine';
      gain.gain.setValueAtTime(.08, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(.0001, context.currentTime + .25);
      oscillator.connect(gain).connect(context.destination);
      state.previewAudioNodes.add(oscillator);
      oscillator.addEventListener?.('ended', () => state.previewAudioNodes.delete(oscillator), { once: true });
      oscillator.start();
      oscillator.stop(context.currentTime + .26);
    } catch (_) {}
  }

  async function saveProject(forceSaveAs = false, options = {}) {
    try {
      const text = airscore.serialize(state.score);
      const name = `${safeName(state.score.metadata.title)}.airscore`;
      let result;
      if (window.airmonDesktop?.saveDocument) {
        result = await window.airmonDesktop.saveDocument({
          content: bytesToBase64(new TextEncoder().encode(text)),
          currentPath: state.filePath,
          defaultName: name,
          filters: [{ name: 'Airmonlink Score', extensions: ['airscore'] }],
          saveAs: Boolean(forceSaveAs || state.readOnly),
          documentId: state.score.id
        });
      } else {
        // Browsers cannot overwrite an existing local file safely. Save therefore creates a new download.
        result = await saveBytes(new TextEncoder().encode(text), name, [{ name: 'Airmonlink Score', extensions: ['airscore'] }]);
      }
      if (result?.canceled) return false;
      if (result?.filePath) state.filePath = result.filePath;
      setDocumentReadOnly(false);
      markDocumentSaved();
      if (!options.forShutdown) {
        await renderRecentProjects();
        toast(result?.backupCreated ? 'Project saved atomically. A backup of the previous version was created.' : 'Project saved.', 'success');
      }
      return true;
    } catch (error) {
      if (error?.code === 'FILE_LOCKED') setDocumentReadOnly(true);
      if (!options.forShutdown) toast(`Save failed: ${error.message}`, 'error');
      return false;
    }
  }

  function markDocumentSaved() {
    state.dirty = false;
    state.baselineChecksum = airscore.checksum(JSON.stringify(state.score));
    state.baselineRevision = state.score.revision || 0;
    $('#dirtyMark').textContent = '';
    renderStatusBar();
    syncDocumentState();
  }

  function setDocumentReadOnly(value) {
    state.readOnly = Boolean(value);
    document.body.classList.toggle('document-read-only', state.readOnly);
    $('#readOnlyBanner').textContent = state.readOnly
      ? 'Read-only: this project is locked or its location is not writable. Save As creates an editable copy.'
      : '';
  }

  function initializeAssociatedFileOpening() {
    if (!window.airmonDesktop?.onOpenDocumentPath) return;
    window.airmonDesktop.onOpenDocumentPath(async ({ filePath } = {}) => {
      if (!filePath) return;
      if (!confirmDiscardChanges('open an associated project')) {
        window.airmonDesktop.reportAssociatedOpenResult?.({ filePath, success: false, error: 'User canceled opening the associated file.' });
        return;
      }
      try {
        const result = await window.airmonDesktop.openRecent(filePath);
        const previousPath = state.filePath;
        await loadProjectBytes(base64ToBytes(result.content), result.filePath, {
          filePath: result.filePath,
          readOnly: result.readOnly
        });
        if (previousPath && previousPath !== result.filePath) {
          window.airmonDesktop.releaseDocument(previousPath).catch(() => {});
        }
        window.airmonDesktop.reportAssociatedOpenResult?.({ filePath: result.filePath, success: true });
      } catch (error) {
        window.airmonDesktop.reportAssociatedOpenResult?.({ filePath, success: false, error: error.message });
        toast(`Associated file open failed: ${error.message}`, 'error');
      }
    });
    window.airmonDesktop.notifyRendererReady?.();
  }

  async function openProject() {
    if (!confirmDiscardChanges('open another project')) return;
    try {
      if (window.airmonDesktop?.openDocument) {
        const result = await window.airmonDesktop.openDocument({
          filters: [{ name: 'Music Projects', extensions: ['airscore','musicxml','xml','mxl','mid','midi'] }]
        });
        if (result.canceled) return;
        const previousPath = state.filePath;
        await loadProjectBytes(base64ToBytes(result.content), result.filePath, { filePath: result.filePath, readOnly: result.readOnly });
        if (previousPath && previousPath !== result.filePath) window.airmonDesktop.releaseDocument(previousPath).catch(() => {});
      } else $('#webFileInput').click();
    } catch (error) {
      toast(`Open failed: ${error.message}`, 'error');
    }
  }

  async function openRecentProject(filePath) {
    if (!confirmDiscardChanges('open a recent project')) return;
    try {
      const result = await window.airmonDesktop.openRecent(filePath);
      const previousPath = state.filePath;
      await loadProjectBytes(base64ToBytes(result.content), result.filePath, { filePath: result.filePath, readOnly: result.readOnly });
      if (previousPath && previousPath !== result.filePath) window.airmonDesktop.releaseDocument(previousPath).catch(() => {});
    } catch (error) { toast(`Could not open recent project: ${error.message}`, 'error'); }
  }

  async function handleWebFile(event) {
    const file = event.target.files[0];
    if (!file) return;
    await loadProjectBytes(new Uint8Array(await file.arrayBuffer()), file.name, { filePath: null, readOnly: false });
    event.target.value = '';
  }

  async function loadProjectBytes(bytes, fileName, options = {}) {
    const lower = String(fileName).toLowerCase();
    let score;
    if (lower.endsWith('.airscore')) score = airscore.deserialize(new TextDecoder().decode(bytes));
    else if (lower.endsWith('.xml') || lower.endsWith('.musicxml')) score = formats.parseMusicXML(new TextDecoder().decode(bytes));
    else if (lower.endsWith('.mxl')) score = await formats.parseMxl(bytes);
    else if (lower.endsWith('.mid') || lower.endsWith('.midi')) score = formats.parseMidi(bytes);
    else throw new Error('Unsupported file type.');
    state.playback.stop({ notify: false });
    state.score = model.normalizeScore(score);
    state.filePath = options.filePath ?? null;
    setDocumentReadOnly(options.readOnly);
    state.selectedPartId = state.score.parts[0]?.id;
    state.activeVoice = state.score.parts[0]?.activeVoice || 1;
    state.selectedEventId = null;
    state.selection.clear();
    state.history = new HistoryManager(160);
    state.history.snapshot(state.score, 'Opened project');
    state.dirty = false;
    state.baselineChecksum = airscore.checksum(JSON.stringify(state.score));
    state.baselineRevision = state.score.revision || 0;
    invalidateScoreRender('open project');
    state.cursorBeat = 0;
    setView('score');
    renderAll();
    toast(`Opened ${String(fileName).split(/[\\/]/).at(-1)}${state.readOnly ? ' in read-only mode' : ''}.`, state.readOnly ? 'error' : 'success');
    if (state.score.importReport) { renderImportReport(state.score.importReport); openDialog('importReportDialog'); }
    renderRecentProjects();
  }

  async function exportAs(type) {
    try {
      const base = safeName(state.score.metadata.title);
      let bytes;
      let name;
      let filters;
      if (type === 'airscore') {
        bytes = new TextEncoder().encode(airscore.serialize(state.score));
        name = `${base}.airscore`;
        filters = [{ name: 'Airmonlink Score', extensions: ['airscore'] }];
      }
      if (type === 'musicxml') {
        bytes = new TextEncoder().encode(formats.exportMusicXML(state.score));
        name = `${base}.musicxml`;
        filters = [{ name: 'MusicXML', extensions: ['musicxml','xml'] }];
      }
      if (type === 'mxl') {
        bytes = formats.createMxl(state.score);
        name = `${base}.mxl`;
        filters = [{ name: 'Compressed MusicXML', extensions: ['mxl'] }];
      }
      if (type === 'midi') {
        bytes = formats.exportMidi(state.score);
        name = `${base}.mid`;
        filters = [{ name: 'Standard MIDI', extensions: ['mid','midi'] }];
      }
      if (type === 'solfa') {
        bytes = new TextEncoder().encode(solfa.scoreToSolfaText(state.score));
        name = `${base}-tonic-solfa.txt`;
        filters = [{ name: 'Text', extensions: ['txt'] }];
      }
      if (type === 'svg') {
        const svg = $('#notationCanvas svg');
        if (!svg) throw new Error('No notation is available.');
        bytes = new TextEncoder().encode(`<?xml version="1.0" encoding="UTF-8"?>${svg.outerHTML}`);
        name = `${base}-score.svg`;
        filters = [{ name: 'SVG Image', extensions: ['svg'] }];
      }
      if (type === 'print') {
        closeDialog('exportDialog');
        window.print();
        return;
      }
      await saveBytes(bytes, name, filters);
      closeDialog('exportDialog');
      toast(`${name} exported.`, 'success');
    } catch (error) {
      toast(`Export failed: ${error.message}`, 'error');
    }
  }

  async function saveBytes(bytes, defaultName, filters) {
    if (window.airmonDesktop) return window.airmonDesktop.saveFile({ content: bytesToBase64(bytes), defaultName, filters });
    const blob = new Blob([bytes]);
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = defaultName;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return { filePath: defaultName };
  }

  function toggleTheme() {
    document.documentElement.classList.toggle('light');
    const theme = document.documentElement.classList.contains('light') ? 'light' : 'dark';
    safeStorage.setItem('airmon-theme', theme);
    window.airmonDesktop?.setSettings?.({ theme }).catch(() => {});
  }

  function openDialog(id) {
    const dialog = document.getElementById(id);
    if (!dialog.open) dialog.showModal();
  }

  function closeDialog(id) {
    const dialog = document.getElementById(id);
    if (dialog?.open) dialog.close();
  }

  function announce(text) { const region = $('#screenReaderStatus'); if (region) { region.textContent = ''; setTimeout(() => { region.textContent = String(text || ''); }, 10); } }

  function setStatus(text) {
    $('#statusText').textContent = text;
    announce(text);
    updateCursorText();
  }

  function updateHistoryButtons() {
    $('#undoButton').disabled = !state.history.canUndo;
    $('#redoButton').disabled = !state.history.canRedo;
  }

  function handleKeyboard(event) {
    if (state.shutdown.inProgress) { event.preventDefault(); return; }
    const editingText = ['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName);
    const commandKey = event.ctrlKey || event.metaKey;
    if (commandKey && event.key.toLowerCase() === 'k') {
      event.preventDefault(); openCommandSearch(); return;
    }
    if (event.key === 'Escape') {
      closeCommandMenus();
      const layoutSelection = getSelected();
      if (layoutSelection.part) state.layoutTarget = { partId: layoutSelection.part.id, staff: layoutSelection.event?.staff || null };
      state.selectionMarquee = null;
      state.selection.clear();
      state.selectedEventId = null;
      state.selectedSpannerId = null;
      state.ghost = null;
      state.drag = null;
      state.lyricDrag = null;
      setEntryMode('layout');
      if (document.body.classList.contains('full-screen-score')) toggleFullScreenScore();
      document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close());
      renderAll();
      setStatus('Layout mode — note selection cleared. Adjust staff spacing, lyrics and page objects without changing playback.');
      return;
    }
    if (commandKey && event.key.toLowerCase() === 's') {
      event.preventDefault();
      saveProject(event.shiftKey);
      return;
    }
    if (commandKey && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      if (event.shiftKey) redo(); else undo();
      return;
    }
    if (commandKey && event.key.toLowerCase() === 'y') { event.preventDefault(); redo(); return; }
    if (commandKey && !editingText && event.key.toLowerCase() === 'x') { event.preventDefault(); cutSelection(); return; }
    if (commandKey && !editingText && event.key.toLowerCase() === 'c') { event.preventDefault(); copySelection(); return; }
    if (commandKey && !editingText && event.key.toLowerCase() === 'v') { event.preventDefault(); pasteSelection(); return; }
    if (commandKey && !editingText && event.key.toLowerCase() === 'a') { event.preventDefault(); selectAllEvents(); return; }
    if (commandKey && event.key.toLowerCase() === 'd' && !editingText) { event.preventDefault(); duplicateSelected(); return; }
    if (editingText) return;
    if (event.altKey && ['1','2','3','4'].includes(event.key)) { event.preventDefault(); setActiveVoice(Number(event.key)); return; }
    if (event.key.toLowerCase() === 'n') { event.preventDefault(); setEntryMode('note'); return; }
    if (event.key.toLowerCase() === 'r') { event.preventDefault(); setEntryMode('rest'); return; }
    if (event.key.toLowerCase() === 'l') { event.preventDefault(); setEntryMode('lyrics'); return; }
    if (event.code === 'Space') { event.preventDefault(); togglePlayback(); }
    if (event.key === 'Delete' || event.key === 'Backspace') deleteSelected();
    const durationByKey = Object.fromEntries(model.DURATIONS.filter(item => item.key).map(item => [item.key, item.value]));
    if (durationByKey[event.key] != null) {
      state.duration = durationByKey[event.key];
      $('#durationSelect').value = String(state.duration);
      state.midiStep?.configure({ duration: state.duration });
      setStatus(`${theory.durationName(state.duration)} selected`);
      renderScore();
    }
    if (event.key === 'ArrowLeft') navigateNote(-1);
    if (event.key === 'ArrowRight') navigateNote(1);
    const pitchMap = { a: 69, b: 71, c: 60, d: 62, e: 64, f: 65, g: 67 };
    if (pitchMap[event.key.toLowerCase()] != null) enterPianoNote(pitchMap[event.key.toLowerCase()], { classList: { add() {}, remove() {} } });
  }

  async function initializeDocumentSession() {
    if (window.airmonDesktop?.getSettings) {
      try {
        const settings = await window.airmonDesktop.getSettings();
        if (settings.theme === 'light') document.documentElement.classList.add('light');
        if (settings.theme === 'dark') document.documentElement.classList.remove('light');
        if (settings.highContrast != null) document.body.classList.toggle('high-contrast', Boolean(settings.highContrast));
        if (settings.reducedMotion != null) document.body.classList.toggle('reduced-motion', Boolean(settings.reducedMotion));
        if (settings.workspace) applyWorkspace(settings.workspace);
        if (settings.panelState) {
          state.panels = sanitizePanelState(settings.panelState);
          applyPanelState({ persist: false });
        }
      } catch (_) {}
    }
    await renderRecentProjects();
    const recoveries = await listRecoveries();
    if (recoveries.length) {
      renderRecoveryList(recoveries);
      openDialog('recoveryDialog');
      setStatus(`${recoveries.length} recovery cop${recoveries.length === 1 ? 'y is' : 'ies are'} available for review.`);
    }
  }

  function loadLocalPreferences() {
    if (safeStorage.getItem('airmon-theme') === 'light') document.documentElement.classList.add('light');
  }

  function scheduleAutosave(options = {}) {
    if (state.shutdown.inProgress || !state.score || !state.dirty) return;
    if (state.performance.autosaveTimer) clearTimeout(state.performance.autosaveTimer);
    const delay = options.immediate ? 0 : 1800;
    state.performance.autosaveTimer = setTimeout(() => {
      state.performance.autosaveTimer = null;
      const run = () => { state.performance.autosaveIdleHandle = null; saveAutosave(); };
      if (typeof requestIdleCallback === 'function') state.performance.autosaveIdleHandle = requestIdleCallback(run, { timeout: 2500 });
      else state.performance.autosaveIdleHandle = setTimeout(run, 0);
    }, delay);
  }

  async function saveAutosave() {
    if (state.shutdown.inProgress || !state.score || !state.dirty || state.autosaveInFlight) return;
    state.autosaveInFlight = true;
    try {
      state.performance.metrics.autosaves += 1;
      const content = airscore.serialize(state.score);
      if (window.airmonDesktop?.autosaveDocument) {
        await window.airmonDesktop.autosaveDocument({
          documentId: state.score.id,
          title: state.score.metadata.title,
          originalPath: state.filePath,
          baselineChecksum: state.baselineChecksum,
          content
        });
      } else {
        safeStorage.setItem('airmon-recovery-v3', JSON.stringify({
          documentId: state.score.id,
          title: state.score.metadata.title,
          originalPath: state.filePath,
          savedAt: new Date().toISOString(),
          baselineChecksum: state.baselineChecksum,
          content
        }));
      }
    } catch (_) {
      // Autosave errors never interrupt music entry; the status remains dirty and the next interval retries.
    } finally { state.autosaveInFlight = false; }
  }

  async function listRecoveries() {
    if (window.airmonDesktop?.listRecoveries) return window.airmonDesktop.listRecoveries();
    try {
      const record = JSON.parse(safeStorage.getItem('airmon-recovery-v3') || 'null');
      return record ? [{ documentId: record.documentId, title: record.title, originalPath: record.originalPath, savedAt: record.savedAt, baselineChecksum: record.baselineChecksum }] : [];
    } catch (_) { return []; }
  }

  async function readRecovery(documentId) {
    if (window.airmonDesktop?.readRecovery) return window.airmonDesktop.readRecovery(documentId);
    try {
      const record = JSON.parse(safeStorage.getItem('airmon-recovery-v3') || 'null');
      return record?.documentId === documentId ? record : null;
    } catch (_) { return null; }
  }

  async function discardRecovery(documentId) {
    if (window.airmonDesktop?.discardRecovery) await window.airmonDesktop.discardRecovery(documentId);
    else {
      const record = await readRecovery(documentId);
      if (record) safeStorage.setItem('airmon-recovery-v3', '');
    }
  }

  async function openRecoveryCenter() {
    const records = await listRecoveries();
    renderRecoveryList(records);
    openDialog('recoveryDialog');
  }

  function renderRecoveryList(records) {
    const container = $('#recoveryList');
    if (!records.length) {
      container.innerHTML = '<div class="inspector-empty">No recovery copies are available.</div>';
      $('#recoveryCompare').classList.add('hidden');
      return;
    }
    container.innerHTML = records.map(record => `
      <article class="recovery-card" data-recovery-id="${escapeHtml(record.documentId)}">
        <header><div><strong>${escapeHtml(record.title || 'Untitled Score')}</strong><div class="recovery-path">${escapeHtml(record.originalPath || 'Unsaved document')}</div></div><time>${escapeHtml(new Date(record.savedAt).toLocaleString())}</time></header>
        <div class="recovery-actions"><button class="button primary" data-recovery-action="recover">Recover</button><button class="button" data-recovery-action="copy">Open as copy</button><button class="button" data-recovery-action="compare">Compare</button><button class="button danger" data-recovery-action="discard">Discard</button></div>
      </article>`).join('');
    container.querySelectorAll('[data-recovery-action]').forEach(button => button.addEventListener('click', async () => {
      const card = button.closest('[data-recovery-id]');
      const id = card.dataset.recoveryId;
      const action = button.dataset.recoveryAction;
      if (action === 'discard') {
        if (!window.confirm('Discard this recovery copy permanently?')) return;
        await discardRecovery(id); return openRecoveryCenter();
      }
      const record = await readRecovery(id);
      if (!record?.content) return toast('The recovery copy could not be read.', 'error');
      if (action === 'compare') return compareRecovery(record);
      if (!confirmDiscardChanges('open the recovered document')) return;
      await loadProjectBytes(new TextEncoder().encode(record.content), `${record.title || 'Recovered'}.airscore`, {
        filePath: action === 'recover' ? record.originalPath : null,
        readOnly: false
      });
      state.dirty = true;
      state.baselineChecksum = record.baselineChecksum || null;
      state.baselineRevision = null;
      invalidateScoreRender('recovery');
      closeDialog('recoveryDialog');
      renderAll();
      toast(action === 'copy' ? 'Recovery opened as an unsaved copy.' : 'Recovery restored. Save to confirm the recovered version.', 'success');
    }));
  }

  async function compareRecovery(record) {
    const panel = $('#recoveryCompare');
    try {
      const recovered = airscore.deserialize(record.content);
      const recoveredStats = scoreSummary(recovered);
      const currentStats = scoreSummary(state.score);
      panel.innerHTML = `<strong>Recovery comparison</strong><div class="form-grid"><div><small>Current</small><p>${escapeHtml(currentStats)}</p></div><div><small>Recovered</small><p>${escapeHtml(recoveredStats)}</p></div></div><p>The recovery was saved ${escapeHtml(new Date(record.savedAt).toLocaleString())}. Opening it never overwrites the current score automatically.</p>`;
      panel.classList.remove('hidden');
    } catch (error) { toast(`Recovery comparison failed: ${error.message}`, 'error'); }
  }

  function scoreSummary(score) {
    const notes = score.parts.reduce((count, part) => count + part.events.filter(event => event.type === 'note').length, 0);
    const lyrics = score.parts.reduce((count, part) => count + part.events.reduce((sum, event) => sum + (event.lyrics?.length || 0), 0), 0);
    return `${score.metadata?.title || 'Untitled'} · ${score.parts.length} parts · ${score.measures.length} bars · ${notes} notes · ${lyrics} lyrics`;
  }

  async function renderRecentProjects() {
    const container = $('#recentProjects');
    if (!container) return;
    if (!window.airmonDesktop?.listRecent) {
      container.innerHTML = '<small>Recent projects are available in the installed desktop application.</small>';
      return;
    }
    try {
      const recent = await window.airmonDesktop.listRecent();
      container.innerHTML = recent.length ? recent.map(item => `<button class="recent-project ${item.exists ? '' : 'missing'}" data-recent-path="${escapeHtml(item.filePath)}" ${item.exists ? '' : 'disabled'}><span><strong>${escapeHtml(item.name)}</strong><br><small>${escapeHtml(item.filePath)}</small></span><small>${item.exists ? 'Open' : 'Missing'}</small></button>`).join('') : '<small>No recent desktop projects yet.</small>';
      container.querySelectorAll('[data-recent-path]').forEach(button => button.addEventListener('click', () => openRecentProject(button.dataset.recentPath)));
    } catch (_) { container.innerHTML = '<small>Recent projects could not be loaded.</small>'; }
  }

  function toast(message, type = '') {
    const item = document.createElement('div');
    item.className = `toast ${type}`;
    item.textContent = message;
    $('#toastContainer').appendChild(item);
    setTimeout(() => item.remove(), 3500);
  }

  function formatBeat(value) {
    const number = Number(value);
    if (Math.abs(number - Math.round(number)) < 1e-8) return String(Math.round(number));
    return number.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
  }

  function safeName(value) { return String(value || 'Untitled Score').replace(/[\\/:*?"<>|]+/g, '-').trim() || 'Untitled Score'; }
  function escapeHtml(value) { return String(value ?? '').replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character])); }
  function svgEl(name, attrs = {}) {
    const element = document.createElementNS(SVG_NS, name);
    Object.entries(attrs).forEach(([key, value]) => element.setAttribute(key, String(value)));
    return element;
  }
  function svgText(text, x, y, attrs = {}) {
    const element = svgEl('text', { x, y, ...attrs });
    element.textContent = text;
    return element;
  }
  function bytesToBase64(bytes) {
    let binary = '';
    const chunk = 0x8000;
    for (let index = 0; index < bytes.length; index += chunk) binary += String.fromCharCode(...bytes.subarray(index, Math.min(index + chunk, bytes.length)));
    return btoa(binary);
  }
  function base64ToBytes(value) {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  }

  init();
})();
