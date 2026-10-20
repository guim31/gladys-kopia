// -----------------------------------------------------------------------------
// Scene action handlers (manifest `scene_actions`, Gladys 5.1+).
//
// "Is this source failed?" is already a scene condition on the device
// features. The reading action is about what a condition cannot do: put the
// state in a message ("/home/anna: failed, last success 18/10 02:05"). It
// reads Kopia again when the last read is older than 15 seconds.
//
// "Start a snapshot" can be disabled in the configuration: a scene, a voice
// assistant or another user of Gladys then cannot start one.
//
// Keys, outputs and behaviour are the ones of guim31/gladys-duplicati.
// -----------------------------------------------------------------------------

import { hoursSince, stateOf } from './devices.js';
import { SENTENCE_TEXT, STATE_TEXT, formatTime, labelled, pick } from './texts.js';

export const SCENE_ACTIONS = {
  async get_backup_status(hub, { fields = {} }) {
    const source = await hub.sourceOf(fields.device);
    const language = hub.config.language;
    const state = stateOf(source);
    const stateText = pick(STATE_TEXT[state], language);
    const lastSuccess = source.lastSuccess === null ? '' : formatTime(source.lastSuccess, language);
    const words = SENTENCE_TEXT[language] ?? SENTENCE_TEXT.en;
    return {
      failed: source.lastRun?.result === 'error',
      overdue: source.overdue,
      state: stateText,
      name: source.name,
      last_success: lastSuccess,
      hours_since_success: hoursSince(source, hub.now()) ?? -1,
      sentence: `${labelled(source.name, stateText, language)}, ${
        lastSuccess ? words.lastSuccess(lastSuccess) : words.never
      }.`,
    };
  },

  async start_backup(hub, { fields = {} }) {
    await hub.startSnapshot(await hub.sourceOf(fields.device));
  },
};
