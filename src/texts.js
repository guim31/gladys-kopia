// -----------------------------------------------------------------------------
// Texts the integration sends to Gladys outside the widget (src/widgets.js):
// connection status, errors, source states, the "Test the connection" report,
// scene outputs and errors, dates. Four languages, the four of the Gladys
// interface; German says "du", Spanish "usted". test/i18n.test.js checks every
// table.
// -----------------------------------------------------------------------------

import { ERROR_KINDS } from './kopia/client.js';

export const INIT_FAILED = {
  en: 'Initialization failed, check the integration logs.',
  fr: "L'initialisation a échoué, consultez les logs de l'intégration.",
  de: 'Initialisierung fehlgeschlagen, sieh dir die Protokolle der Integration an.',
  es: 'La inicialización ha fallado, consulte los registros de la integración.',
};

export const CONNECTION_TEXT = {
  noUrl: {
    en: 'Enter the address of your Kopia server in the configuration.',
    fr: "Saisissez l'adresse de votre serveur Kopia dans la configuration.",
    de: 'Gib die Adresse deines Kopia-Servers in der Konfiguration ein.',
    es: 'Introduzca la dirección de su servidor Kopia en la configuración.',
  },
  invalidUrl: {
    en: 'Address not understood, e.g. https://192.168.1.2:51515',
    fr: 'Adresse incomprise, ex. https://192.168.1.2:51515',
    de: 'Adresse nicht verstanden, z. B. https://192.168.1.2:51515',
    es: 'Dirección no válida, p. ej. https://192.168.1.2:51515',
  },
  noPassword: {
    en: 'Enter the password of the Kopia server in the configuration.',
    fr: 'Saisissez le mot de passe du serveur Kopia dans la configuration.',
    de: 'Gib das Passwort des Kopia-Servers in der Konfiguration ein.',
    es: 'Introduzca la contraseña del servidor Kopia en la configuración.',
  },
  invalidFingerprint: {
    en: 'Certificate fingerprint not understood: 64 hexadecimal characters (SHA-256).',
    fr: 'Empreinte du certificat incomprise : 64 caractères hexadécimaux (SHA-256).',
    de: 'Zertifikat-Fingerabdruck nicht verstanden: 64 Hexadezimalzeichen (SHA-256).',
    es: 'Huella del certificado no válida: 64 caracteres hexadecimales (SHA-256).',
  },
};

// One short explanation per error kind (src/kopia/client.js).
export const ERROR_TEXT = {
  [ERROR_KINDS.UNREACHABLE]: {
    en: 'Kopia does not answer',
    fr: 'Kopia ne répond pas',
    de: 'Kopia antwortet nicht',
    es: 'Kopia no responde',
  },
  [ERROR_KINDS.TLS]: {
    en: 'certificate refused: enter its fingerprint in the configuration',
    fr: 'certificat refusé : saisissez son empreinte dans la configuration',
    de: 'Zertifikat abgelehnt: Gib seinen Fingerabdruck in der Konfiguration ein',
    es: 'certificado rechazado: introduzca su huella en la configuración',
  },
  [ERROR_KINDS.FINGERPRINT]: {
    en: 'the certificate does not match the fingerprint of the configuration',
    fr: "le certificat ne correspond pas à l'empreinte de la configuration",
    de: 'das Zertifikat passt nicht zum Fingerabdruck der Konfiguration',
    es: 'el certificado no coincide con la huella de la configuración',
  },
  [ERROR_KINDS.AUTH]: {
    en: 'username or password refused by Kopia',
    fr: "nom d'utilisateur ou mot de passe refusé par Kopia",
    de: 'Benutzername oder Passwort von Kopia abgelehnt',
    es: 'usuario o contraseña rechazados por Kopia',
  },
  [ERROR_KINDS.NOT_KOPIA]: {
    en: 'no Kopia server at this address',
    fr: 'aucun serveur Kopia à cette adresse',
    de: 'kein Kopia-Server unter dieser Adresse',
    es: 'no hay ningún servidor Kopia en esta dirección',
  },
  [ERROR_KINDS.REDIRECT]: {
    en: 'the address redirects: enter the https:// address',
    fr: "l'adresse redirige : saisissez l'adresse en https://",
    de: 'die Adresse leitet um: Gib die https://-Adresse ein',
    es: 'la dirección redirige: introduzca la dirección https://',
  },
  [ERROR_KINDS.NO_REPOSITORY]: {
    en: 'Kopia is not connected to its repository',
    fr: "Kopia n'est pas connecté à son dépôt",
    de: 'Kopia ist nicht mit seinem Repository verbunden',
    es: 'Kopia no está conectado a su repositorio',
  },
  [ERROR_KINDS.NOT_FOUND]: {
    en: 'this source no longer exists in Kopia',
    fr: "cette source n'existe plus dans Kopia",
    de: 'diese Quelle existiert in Kopia nicht mehr',
    es: 'esta fuente ya no existe en Kopia',
  },
  [ERROR_KINDS.HTTP]: {
    en: 'unexpected answer, see the logs',
    fr: 'réponse inattendue, voir les logs',
    de: 'unerwartete Antwort, sieh in den Protokollen nach',
    es: 'respuesta inesperada, consulte los registros',
  },
};

// The state of a source, in words (feature "State", widget rows, scene outputs).
export const STATE_TEXT = {
  ok: { en: 'OK', fr: 'OK', de: 'OK', es: 'Correcta' },
  failed: { en: 'Failed', fr: 'En échec', de: 'Fehlgeschlagen', es: 'Fallida' },
  overdue: { en: 'Overdue', fr: 'En retard', de: 'Überfällig', es: 'Con retraso' },
  running: { en: 'Running', fr: 'En cours', de: 'Läuft', es: 'En curso' },
  never: { en: 'No snapshot', fr: 'Aucun instantané', de: 'Kein Snapshot', es: 'Sin instantánea' },
};

// The "Test the connection" report.
export const REPORT_TEXT = {
  en: {
    ok: 'Connected',
    sources: (count) => `${count} source(s)`,
    failed: (count) => `${count} failed`,
    overdue: (count) => `${count} overdue`,
  },
  fr: {
    ok: 'Connecté',
    sources: (count) => `${count} source(s)`,
    failed: (count) => `${count} en échec`,
    overdue: (count) => `${count} en retard`,
  },
  de: {
    ok: 'Verbunden',
    sources: (count) => `${count} Quelle(n)`,
    failed: (count) => `${count} fehlgeschlagen`,
    overdue: (count) => `${count} überfällig`,
  },
  es: {
    ok: 'Conectado',
    sources: (count) => `${count} fuente(s)`,
    failed: (count) => `${count} fallida(s)`,
    overdue: (count) => `${count} con retraso`,
  },
};

// Errors of the scene actions (shown in Gladys).
export const ACTION_TEXT = {
  unknownSource: {
    en: 'This device is not a Kopia source.',
    fr: "Cet appareil n'est pas une source Kopia.",
    de: 'Dieses Gerät ist keine Kopia-Quelle.',
    es: 'Este dispositivo no es una fuente de Kopia.',
  },
  startDisabled: {
    en: 'Starting snapshots from Gladys is disabled in the configuration of the integration.',
    fr: "Le lancement des instantanés depuis Gladys est désactivé dans la configuration de l'intégration.",
    de: 'Das Starten von Snapshots aus Gladys ist in der Konfiguration der Integration deaktiviert.',
    es: 'El inicio de instantáneas desde Gladys está desactivado en la configuración de la integración.',
  },
};

// The `sentence` output of "State of a source".
export const SENTENCE_TEXT = {
  en: { lastSuccess: (time) => `last success ${time}`, never: 'never succeeded' },
  fr: { lastSuccess: (time) => `dernière réussite ${time}`, never: 'jamais réussie' },
  de: { lastSuccess: (time) => `letzter Erfolg ${time}`, never: 'noch nie erfolgreich' },
  es: { lastSuccess: (time) => `último éxito ${time}`, never: 'nunca se completó' },
};

export const LANGUAGE_FALLBACK = 'en';

const LOCALES = { en: 'en-GB', fr: 'fr-FR', de: 'de-DE', es: 'es-ES' };
const formats = new Map();

/**
 * A date as day/month hours:minutes, in the time zone of Gladys (the
 * supervisor injects TZ). Day and month: a weekly snapshot made six days ago
 * is not "today at 02:00".
 */
export function formatTime(time, language) {
  const locale = LOCALES[language] ?? LOCALES.en;
  if (!formats.has(locale)) {
    formats.set(
      locale,
      new Intl.DateTimeFormat(locale, {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      }),
    );
  }
  return formats.get(locale).format(new Date(time));
}

/** "Name: text", with the space French puts before a colon. */
export const labelled = (name, text, language) =>
  `${name}${language === 'fr' ? ' : ' : ': '}${text}`;
export const pick = (text, language) => text[language] ?? text[LANGUAGE_FALLBACK];
