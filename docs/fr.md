# Moniteur d'énergie Sense

**Connecteur non officiel, sans lien avec Sense Labs.** Il amène votre
moniteur d'énergie **Sense** (États-Unis et Canada) dans Gladys : la puissance
consommée par la maison (et produite, avec du solaire) en temps réel, la
tension et la fréquence, la consommation horaire pour le suivi énergétique de Gladys
et, en option, les appareils détectés par Sense. Il utilise la même API cloud
que l'application Sense, que Sense ne documente pas et peut changer à tout
moment.

> **Jamais testé avec un vrai moniteur ni un vrai compte Sense.** Il a été
> écrit à partir de la bibliothèque sense-energy utilisée par Home Assistant et
> testé uniquement sur des réponses d'exemple. Merci de signaler ce qui marche
> et ce qui ne marche pas.

## Ce que vous obtenez

| Surface                                 | Contenu                                                                                                              |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Un appareil par **moniteur Sense**      | puissance consommée (W), tension L1 et L2 (V), fréquence (Hz), consommation par demi-heure pour le suivi énergétique |
| Avec du **solaire**                     | puissance produite (W), puissance réseau (W, signée : positive en import, négative en injection)                     |
| Option **Appareils détectés par Sense** | un appareil par équipement détecté par Sense : marche/arrêt et puissance (W), en lecture seule                       |
| Boutons                                 | **Tester la connexion**, **Saisir le code de double authentification**                                               |

## Installation

1. Installez l'intégration, saisissez l'**e-mail** et le **mot de passe** de
   votre compte Sense, puis enregistrez.
2. **Si votre compte utilise la double authentification**, le statut demande
   un code : cliquez sur **Saisir le code de double authentification** et tapez
   le code à 6 chiffres actuel de votre application d'authentification. Une
   seule fois : la session est ensuite gardée et renouvelée toute seule, même
   après un redémarrage.
3. Cliquez sur **Tester la connexion** : le moniteur et l'état du temps réel
   s'affichent.
4. Ouvrez **Découverte** et ajoutez le moniteur Sense (et les appareils
   détectés, si vous avez activé l'option).

## Suivi énergétique

Le flux temps réel donne une puissance, pas une énergie. L'intégration lit donc
la consommation horaire de Sense toutes les 15 minutes et publie chaque heure
terminée d'aujourd'hui et d'hier en deux demi-heures **datées** sur la
fonctionnalité « Consommation (30 min) » : le suivi énergétique reçoit la bonne
énergie dans la bonne demi-heure et peut la tarifer avec votre contrat ;
l'énergie d'un jour est la somme de ses demi-heures. Hier est relu à chaque
rafraîchissement pendant les 3 premières heures du jour (heure du moniteur),
pour ses dernières heures. Seuls aujourd'hui et hier sont lus : aucun
historique plus ancien n'est rattrapé, un Gladys arrêté plus d'un jour garde
un trou. La production, l'import et l'injection n'ont pas encore de total
journalier (la puissance réseau montre l'échange en temps réel).

## Appareils détectés

Avec l'option, chaque équipement que Sense liste dans son application (hors
équipements masqués ou fusionnés) devient un appareil avec sa marche/arrêt et
sa puissance. Sense met du temps à détecter les équipements et peut se
tromper ; la liste est relue toutes les 6 heures. Ces états sont facultatifs :
quand le budget d'états de Gladys est atteint, ils attendent la minute
suivante, jamais ceux du moniteur.

## Limites

- Comptes Sense des États-Unis et du Canada ; seul le premier moniteur du
  compte est lu.
- Appels : une seule connexion temps réel (WebSocket) ; la consommation horaire
  du jour toutes les 15 minutes, celle d'hier une fois par jour (à chaque
  rafraîchissement pendant les 3 premières heures du jour), les appareils détectés toutes les 6 heures. États publiés : le moniteur au
  plus toutes les 10 secondes, la puissance des appareils détectés au plus
  toutes les minutes.
- Reconnexion du temps réel : de 5 secondes jusqu'à 5 minutes, avec une part
  aléatoire. Après un échec de connexion : 5, 15, puis toutes les 60 minutes.
  E-mail ou mot de passe refusés : toutes les 6 heures. Quand Sense demande de
  ralentir (429), tous les appels attendent le délai demandé (15 minutes
  sinon), entre 1 minute et 6 heures.
- Gladys n'a pas d'unité de fréquence : la fréquence est un simple nombre.
- Les demi-heures suivent les heures pleines du moniteur : un fuseau décalé de
  45 minutes (Gladys ou moniteur) ne tombe pas sur la grille de 30 minutes de
  Gladys, et le suivi énergétique les refuse alors.

## Dépannage

- **« Sense a refusé l'e-mail ou le mot de passe »** : vérifiez-les dans
  l'application Sense, corrigez-les et enregistrez.
- **« Votre compte Sense demande un code de double authentification »** :
  utilisez **Saisir le code de double authentification**. Code refusé : tapez
  le code actuel (il change toutes les 30 secondes).
- **Temps réel « connexion en cours… » longtemps** : le moniteur est peut-être
  hors ligne ; le flux se reconnecte tout seul.
- **Pas d'énergie dans le suivi énergétique** : vérifiez que l'appareil du
  moniteur Sense est créé ; les heures apparaissent une fois terminées.
- Logs : réglez la variable `LOG_LEVEL` de l'intégration.

## Confidentialité

Le mot de passe est gardé par Gladys dans sa base, jamais réaffiché, et envoyé
seulement à `api.sense.com` pour se connecter. Les jetons de session (accès et
renouvellement) sont gardés au même endroit, dans la configuration de
l'intégration, hors du formulaire. Rien n'est journalisé avec
l'e-mail, le mot de passe ou un jeton.

## Crédits

La logique de l'API est portée depuis
[sense-energy](https://github.com/scottbonline/sense) (MIT, © 2018 Scott
Belisle), la bibliothèque de l'intégration Sense de Home Assistant.
