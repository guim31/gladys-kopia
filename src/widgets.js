// -----------------------------------------------------------------------------
// Dashboard widget (manifest `widgets`, Gladys 5.1+): `kopia`.
//
// The use case: a glance at the wall tablet tells whether the snapshots ran,
// and which source did not. So the widget shows the number of sources failed,
// overdue and OK, then one row per source — failed first, then overdue,
// running, without snapshot, OK — with its state and its last success (or
// the progress of the one running).
//
// Every source by default, or the ones chosen in the widget settings (devices
// added to Gladys). The figures are sent as values, not bound to device
// features: the widget works before the devices are added.
//
// Budget (8 components, 2 texts): three tiles, one text when Kopia does not
// answer, one status list of ten rows at most, a Refresh button.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { stateOf } from './devices.js';
import { WIDGET_KEY } from './hub.js';
import { ERROR_TEXT, STATE_TEXT, formatTime, pick } from './texts.js';

// Action key of the button: permanent once published.
export const ACTIONS = Object.freeze({ REFRESH: 'refresh' });

export const MAX_ROWS = 10;

export const TEXT = {
  pick: {
    en: 'Enter the address and the password of your Kopia server in the configuration of the integration.',
    fr: "Saisissez l'adresse et le mot de passe de votre serveur Kopia dans la configuration de l'intégration.",
    de: 'Gib die Adresse und das Passwort deines Kopia-Servers in der Konfiguration der Integration ein.',
    es: 'Introduzca la dirección y la contraseña de su servidor Kopia en la configuración de la integración.',
  },
  empty: {
    en: 'No source yet: take a first snapshot in Kopia.',
    fr: 'Aucune source pour le moment : faites un premier instantané dans Kopia.',
    de: 'Noch keine Quelle: Erstelle einen ersten Snapshot in Kopia.',
    es: 'Todavía no hay ninguna fuente: haga una primera instantánea en Kopia.',
  },
  failed: { en: 'Failed', fr: 'En échec', de: 'Fehlgeschlagen', es: 'Fallidas' },
  overdue: { en: 'Overdue', fr: 'En retard', de: 'Überfällig', es: 'Con retraso' },
  ok: { en: 'OK', fr: 'OK', de: 'OK', es: 'Correctas' },
  more: { en: 'Others', fr: 'Autres', de: 'Weitere', es: 'Otras' },
  refresh: { en: 'Refresh', fr: 'Actualiser', de: 'Aktualisieren', es: 'Actualizar' },
  refreshed: {
    en: 'Kopia read again.',
    fr: 'Kopia relu.',
    de: 'Kopia neu gelesen.',
    es: 'Kopia leído de nuevo.',
  },
};

// Row order: what needs attention first.
const SEVERITY = ['failed', 'overdue', 'running', 'never', 'ok'];

const ROW_STYLE = {
  failed: { icon: 'x-circle', color: WIDGET_COLORS.DANGER },
  overdue: { icon: 'clock', color: WIDGET_COLORS.WARNING },
  running: { icon: 'play-circle', color: WIDGET_COLORS.INFO },
  never: { icon: 'circle', color: WIDGET_COLORS.NEUTRAL },
  ok: { icon: 'check-circle', color: WIDGET_COLORS.SUCCESS },
};

const fit = (text, max) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

function message(text, language) {
  return {
    ttl_seconds: 300,
    components: [{ type: 'text', variant: 'body', text: pick(text, language) }],
  };
}

/** The sources the widget shows: the chosen devices, or every source. */
export function selectSources(hub, settings) {
  const chosen = [settings?.sources ?? []].flat().filter((id) => typeof id === 'string' && id);
  if (chosen.length === 0) {
    return [...hub.sources.values()];
  }
  return [...new Set(chosen)].map((id) => hub.find(id)).filter(Boolean);
}

export function sortSources(sources) {
  return [...sources].sort(
    (a, b) =>
      SEVERITY.indexOf(stateOf(a)) - SEVERITY.indexOf(stateOf(b)) || a.name.localeCompare(b.name),
  );
}

function rowValue(source, language) {
  const state = stateOf(source);
  const text = pick(STATE_TEXT[state], language);
  if (state === 'running') {
    return source.progress === null ? text : `${text} · ${source.progress} %`;
  }
  return source.lastSuccess === null
    ? text
    : `${text} · ${formatTime(source.lastSuccess, language)}`;
}

async function get(hub, { settings, language = 'en' }) {
  if (!hub.client) {
    return message(TEXT.pick, language);
  }
  const sources = sortSources(selectSources(hub, settings));
  if (sources.length === 0 && !hub.error) {
    return message(TEXT.empty, language);
  }

  const failed = sources.filter((source) => source.lastRun?.result === 'error').length;
  const overdue = sources.filter((source) => source.overdue).length;
  const ok = sources.filter((source) => stateOf(source) === 'ok').length;
  const components = [
    {
      type: 'value',
      value: failed,
      label: pick(TEXT.failed, language),
      icon: 'x-circle',
      color: failed > 0 ? WIDGET_COLORS.DANGER : WIDGET_COLORS.NEUTRAL,
    },
    {
      type: 'value',
      value: overdue,
      label: pick(TEXT.overdue, language),
      icon: 'clock',
      color: overdue > 0 ? WIDGET_COLORS.WARNING : WIDGET_COLORS.NEUTRAL,
    },
    {
      type: 'value',
      value: ok,
      label: pick(TEXT.ok, language),
      icon: 'check-circle',
      color: WIDGET_COLORS.SUCCESS,
    },
  ];

  if (hub.error) {
    components.push({
      type: 'text',
      variant: 'body',
      text: pick(ERROR_TEXT[hub.error.kind], language),
    });
  }

  if (sources.length > 0) {
    const shown = sources.length > MAX_ROWS ? sources.slice(0, MAX_ROWS - 1) : sources;
    const items = shown.map((source) => ({
      label: fit(source.name, 40),
      value: fit(rowValue(source, language), 40),
      ...ROW_STYLE[stateOf(source)],
    }));
    if (sources.length > shown.length) {
      items.push({
        label: pick(TEXT.more, language),
        value: `+${sources.length - shown.length}`,
        icon: 'more-horizontal',
        color: WIDGET_COLORS.NEUTRAL,
      });
    }
    components.push({ type: 'status', items });
  }

  components.push({
    type: 'button',
    label: pick(TEXT.refresh, language),
    icon: 'refresh-cw',
    style: 'secondary',
    action: { key: ACTIONS.REFRESH },
  });

  // A snapshot running moves: refresh sooner.
  return { ttl_seconds: hub.error || hub.activeId ? 30 : 120, components };
}

async function action(hub, { actionKey }) {
  if (actionKey !== ACTIONS.REFRESH) {
    throw new Error(`Unknown action ${actionKey}`);
  }
  await hub.pollNow();
  if (hub.error) {
    return { message: ERROR_TEXT[hub.error.kind] };
  }
  return { message: TEXT.refreshed };
}

export const WIDGETS = {
  [WIDGET_KEY]: { get, action },
};
