(function (root, factory) {
  const model = root.AirmonScoreModel || (typeof require === 'function' ? require('./score-model') : null);
  const lyrics = root.AirmonLyrics || (typeof require === 'function' ? require('./lyrics') : null);
  const api = factory(model, lyrics);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.AirmonAirscore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (model, lyrics) {
  'use strict';
  const CURRENT_VERSION = 9;

  function serialize(score) {
    const normalized = model?.normalizeScore ? model.normalizeScore(model.cloneScore ? model.cloneScore(score) : JSON.parse(JSON.stringify(score))) : score;
    if (normalized?.settings) delete normalized.settings.workspace;
    const scoreText = JSON.stringify(normalized);
    return JSON.stringify({
      signature: 'AIRM-Score',
      version: CURRENT_VERSION,
      schema: 'airscore-v10',
      savedAt: new Date().toISOString(),
      checksumAlgorithm: 'fnv1a32',
      checksum: checksum(scoreText),
      score: normalized
    }, null, 2);
  }

  function migrate(payload) {
    const migrated = JSON.parse(JSON.stringify(payload));
    migrated.version = Number(migrated.version) || 1;
    if (migrated.version < 2) {
      migrated.score.settings = migrated.score.settings || {};
      migrated.score.settings.autoFillRests = migrated.score.settings.autoFillRests !== false;
    }
    if (migrated.version < 3) {
      migrated.score.settings = migrated.score.settings || {};
      migrated.score.settings.solfaMode = migrated.score.settings.solfaMode || 'curwen';
      migrated.score.settings.solfaLabels = migrated.score.settings.solfaLabels || 'short';
      migrated.score.settings.solfaShowLyrics = migrated.score.settings.solfaShowLyrics !== false;
    }
    if (migrated.version < 4 && migrated.score?.settings) delete migrated.score.settings.workspace;
    if (migrated.version < 5) {
      migrated.score.settings = migrated.score.settings || {};
      migrated.score.settings.solfaMode = 'traditional';
      migrated.score.parts = Array.isArray(migrated.score.parts) ? migrated.score.parts : [];
      migrated.score.parts.forEach(part => { part.voiceLayers = [1, 2, 3, 4]; part.activeVoice = Math.max(1, Math.min(4, Number(part.activeVoice) || 1)); });
      migrated.score.spanners = Array.isArray(migrated.score.spanners) ? migrated.score.spanners : [];
    }

    if (migrated.version < 6) {
      migrated.score.settings = migrated.score.settings || {};
      // Version 7 makes the staff-only workspace the clean default while preserving
      // a user's explicit previous overlay choice when it was saved.
      if (typeof migrated.score.settings.showSolfa !== 'boolean') migrated.score.settings.showSolfa = false;
      migrated.score.settings.solfaShowVoiceLabels = Boolean(migrated.score.settings.solfaShowVoiceLabels);
      migrated.score.settings.staffGap = Math.max(44, Number(migrated.score.settings.staffGap) || 60);
      migrated.score.settings.partGap = Math.max(28, Number(migrated.score.settings.partGap) || 42);
      migrated.score.settings.systemGap = Math.max(32, Number(migrated.score.settings.systemGap) || 50);
      migrated.score.metadata = migrated.score.metadata || {};
      migrated.score.metadata.dedication = migrated.score.metadata.dedication || '';
      migrated.score.metadata.supportingText = migrated.score.metadata.supportingText || '';
      migrated.score.metadata.dateText = migrated.score.metadata.dateText || '';
    }

    if (migrated.version < 7) {
      migrated.score.settings = migrated.score.settings || {};
      // Version 8 preserves the video-guided rapid lyric workflow and layer-colour
      // editing preference without changing printed music or playback data.
      if (typeof migrated.score.settings.lyricAutoAdvance !== 'boolean') migrated.score.settings.lyricAutoAdvance = true;
      if (typeof migrated.score.settings.entryLayerColors !== 'boolean') migrated.score.settings.entryLayerColors = true;
    }

    if (migrated.version < 8) {
      migrated.score.settings = migrated.score.settings || {};
      migrated.score.settings.solfaConvention = migrated.score.settings.solfaConvention || 'airmonlink-traditional-v1';
      migrated.score.settings.solfaPitchSystem = migrated.score.settings.solfaPitchSystem || 'movable-do';
      migrated.score.settings.minorSolfaSystem = migrated.score.settings.minorSolfaSystem || 'do-based';
      migrated.score.settings.solfaOverlayPosition = migrated.score.settings.solfaOverlayPosition || 'below';
      migrated.score.settings.solfaOverlayScope = migrated.score.settings.solfaOverlayScope || 'entire-score';
      migrated.score.settings.solfaStaffVisibility = migrated.score.settings.solfaStaffVisibility || {};
      if (typeof migrated.score.settings.solfaShowOctaveMarks !== 'boolean') migrated.score.settings.solfaShowOctaveMarks = true;
      if (typeof migrated.score.settings.solfaShowMeasureDivisions !== 'boolean') migrated.score.settings.solfaShowMeasureDivisions = true;
      if (typeof migrated.score.settings.solfaShowTonicChanges !== 'boolean') migrated.score.settings.solfaShowTonicChanges = true;
      if (typeof migrated.score.settings.solfaShowWarnings !== 'boolean') migrated.score.settings.solfaShowWarnings = true;
      if (typeof migrated.score.settings.solfaLinkedEditing !== 'boolean') migrated.score.settings.solfaLinkedEditing = true;
      migrated.score.settings.solfaFontSize = Math.max(6, Math.min(18, Number(migrated.score.settings.solfaFontSize) || 8));
      migrated.score.settings.solfaVerticalSpacing = Math.max(4, Math.min(40, Number(migrated.score.settings.solfaVerticalSpacing) || 12));
      migrated.score.solfaMigrationReport = Array.isArray(migrated.score.solfaMigrationReport) ? migrated.score.solfaMigrationReport : [];
      migrated.score.solfaMigrationReport.push({ version: 9, status: 'migrated', convention: migrated.score.settings.solfaConvention, message: 'Formal tonic-solfa grammar settings were added without changing structured musical events.' });
    }
    if (migrated.version < 9 && lyrics?.repairLegacyVerseSuffixes) {
      lyrics.repairLegacyVerseSuffixes(migrated.score);
    }
    migrated.version = CURRENT_VERSION;
    migrated.schema = 'airscore-v10';
    return migrated;
  }

  function deserialize(text, options = {}) {
    const payload = typeof text === 'string' ? JSON.parse(text) : text;
    if (!payload || payload.signature !== 'AIRM-Score') throw new Error('This is not a valid .airscore project.');
    if (Number(payload.version) > CURRENT_VERSION) throw new Error('This project was created by a newer version of Airmonlink Composer.');
    if (!payload.score || !Array.isArray(payload.score.parts)) throw new Error('The .airscore project is incomplete.');
    if (payload.checksum && options.ignoreChecksum !== true) {
      const actual = checksum(JSON.stringify(payload.score));
      if (actual !== payload.checksum) throw new Error('The .airscore checksum does not match. The project may be damaged or incomplete.');
    }
    const migrated = migrate(payload);
    return model?.normalizeScore ? model.normalizeScore(migrated.score) : migrated.score;
  }

  function checksum(text) {
    let hash = 2166136261;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  }

  return { CURRENT_VERSION, serialize, deserialize, migrate, checksum };
});
