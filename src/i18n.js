// -----------------------------------------------------------------------------
// Runtime texts shown in Gladys. Every text is a { en, fr } object.
// -----------------------------------------------------------------------------

export const T = {
  noCredentials: {
    en: 'Enter the e-mail and password of your Sense account.',
    fr: 'Saisissez l’e-mail et le mot de passe de votre compte Sense.',
  },
  badCredentials: (hours) => ({
    en: `Sense refused the e-mail or the password: check them and save. New try in ${hours} h.`,
    fr: `Sense a refusé l’e-mail ou le mot de passe : vérifiez-les et enregistrez. Nouvel essai dans ${hours} h.`,
  }),
  mfaRequired: {
    en: 'Your Sense account asks for a two-factor code: enter the 6-digit code of your authenticator app with the "Enter the two-factor code" button.',
    fr: 'Votre compte Sense demande un code de double authentification : saisissez le code à 6 chiffres de votre application d’authentification avec le bouton « Saisir le code de double authentification ».',
  },
  noMonitor: {
    en: 'This Sense account has no monitor.',
    fr: 'Ce compte Sense n’a aucun moniteur.',
  },
  rateLimited: (minutes) => ({
    en: `Sense asked to slow down: every call paused for ${minutes} min.`,
    fr: `Sense demande de ralentir : tous les appels sont suspendus ${minutes} min.`,
  }),
  retry: (minutes, message) => ({
    en: `Sense could not be reached (${message}): new try in ${minutes} min.`,
    fr: `Sense est injoignable (${message}) : nouvel essai dans ${minutes} min.`,
  }),
  unreachable: (message) => ({
    en: `Sense is unreachable: ${message}. Retrying at the next refresh.`,
    fr: `Sense est injoignable : ${message}. Nouvel essai au prochain rafraîchissement.`,
  }),
  ok: (name, live) => ({
    en: `Connected to ${name}. Real time: ${live ? 'connected' : 'connecting…'}.`,
    fr: `Connecté à ${name}. Temps réel : ${live ? 'connecté' : 'connexion en cours…'}.`,
  }),
  mfa: {
    badFormat: {
      en: 'The code has 6 digits.',
      fr: 'Le code compte 6 chiffres.',
    },
    notNeeded: {
      en: 'No two-factor code is needed: the integration is connected.',
      fr: 'Aucun code n’est nécessaire : l’intégration est connectée.',
    },
    refused: {
      en: 'Sense refused this code: enter the current one (it changes every 30 seconds).',
      fr: 'Sense a refusé ce code : saisissez le code actuel (il change toutes les 30 secondes).',
    },
    ok: {
      en: 'Code accepted: the integration connects to Sense, see its status.',
      fr: 'Code accepté : l’intégration se connecte à Sense, voir son statut.',
    },
  },
  test: {
    ok: (name, solar, live) => ({
      en: `Connected to ${name}${solar ? ' (solar)' : ''}. Real time: ${live ? 'connected' : 'not connected yet'}.`,
      fr: `Connecté à ${name}${solar ? ' (solaire)' : ''}. Temps réel : ${live ? 'connecté' : 'pas encore connecté'}.`,
    }),
  },
};
