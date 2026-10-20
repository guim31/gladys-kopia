# Kopia

[Kopia](https://kopia.io/) fait des instantanés chiffrés et dédupliqués de vos
fichiers vers un disque, un NAS ou un stockage en ligne. Cette intégration
amène les sources d'un serveur Kopia dans Gladys : chaque source (un dossier
sauvegardé) devient un appareil avec son état, son dernier instantané réussi,
sa taille, ses fichiers et les erreurs de son dernier instantané. Des scènes
peuvent réagir quand **n'importe quel** instantané réussit, échoue ou est en
retard (pas de réussite depuis trop longtemps), un widget de tableau de bord
liste les sources en échec d'abord, et une scène peut lancer un instantané.

Testée contre un vrai Kopia 0.23 (image Docker `kopia/kopia`, dépôt sur
système de fichiers, authentification Basic, HTTP et HTTPS auto-signé) : un
instantané qui réussit, un avec un fichier illisible, un dont le dossier a été
supprimé, et un instantané lancé depuis l'intégration. Pas encore testée sur un
vrai Gladys : vos retours sont bienvenus sur
[les issues](https://github.com/guim31/gladys-kopia/issues).

## Ce qu'il vous faut

- Gladys Assistant 5.1.0 ou plus récent.
- Kopia lancé en **serveur** avec son interface web, `kopia server start`,
  joignable depuis la machine de Gladys (port 51515 par défaut). KopiaUI,
  l'application de bureau, n'écoute que son propre ordinateur : elle ne
  convient pas.
- Le nom d'utilisateur et le mot de passe du serveur, donnés par
  `--server-username` (`kopia` par défaut) et `--server-password`. Pas le mot
  de passe du dépôt.

L'intégration lit Kopia toutes les 5 minutes par défaut (toutes les 30
secondes pendant un instantané) : quelques requêtes légères sur votre propre
réseau.

## Premiers pas

### 1. Lancer le serveur Kopia

Par exemple, avec un certificat généré par Kopia :

```
kopia server start --address=0.0.0.0:51515 \
  --server-username=kopia --server-password=… \
  --tls-generate-cert
```

Au premier démarrage, Kopia affiche `SERVER CERT SHA256: …` : notez cette
empreinte. Avec `--insecure` à la place d'un certificat, le serveur parle en
HTTP simple : à réserver à un réseau de confiance. L'image Docker
`kopia/kopia` accepte les mêmes options.

### 2. Configurer l'intégration

Dans Gladys, **Intégrations → Kopia → Configuration** :

- **Adresse de Kopia** : `https://192.168.1.2:51515` par exemple (`http://`
  avec `--insecure`). Une adresse seule (`192.168.1.2`) veut dire `http://`
  sur le port 51515 ; une adresse copiée depuis le navigateur convient aussi.
- **Nom d'utilisateur** et **Mot de passe** : le `--server-username` et le
  `--server-password` du serveur.
- **Empreinte du certificat** : seulement pour un certificat auto-signé
  (`--tls-generate-cert`) : le `SERVER CERT SHA256` noté plus haut.
  L'intégration accepte alors ce certificat, et aucun autre. À laisser vide en
  `http://` ou avec un certificat signé par une autorité reconnue.
- **Intervalle de rafraîchissement** : 1, 5 (par défaut) ou 15 minutes.
- **En retard après** : quand une source sans instantané réussi passe en
  retard. _Automatique_ (par défaut) suit la stratégie de planification de
  chaque source : son intervalle plus un quart de celui-ci (une heure au
  moins) — 30 heures pour un instantané quotidien, « heures de la journée »
  comprises. Une source sans intervalle (manuelle, ou une expression cron)
  n'est alors jamais en retard. Ou un délai fixe, de 12 heures à une semaine,
  pour toutes les sources.
- **Autoriser le lancement des instantanés** : permet à l'action de scène
  « Lancer un instantané » de fonctionner. À désactiver si personne ne doit
  lancer d'instantané depuis Gladys.
- **Langue des noms** : langue des noms des fonctionnalités, des états et des
  résultats de scène.

**Tester la connexion** lit Kopia et résume : le nombre de sources, en échec
et en retard.

### 3. Ajouter les sources

Dans l'onglet **Découverte**, ajoutez les sources à suivre, et l'appareil
« Kopia » pour le serveur. Une source apparaît dès qu'elle a une stratégie ou
un instantané dans Kopia. Les déclencheurs de scène fonctionnent pour toutes
les sources, ajoutées ou non.

## Les appareils

Chaque source :

| Fonctionnalité                     | Valeur                                                  |
| ---------------------------------- | ------------------------------------------------------- |
| État                               | OK, En échec, En retard, En cours ou Aucun instantané   |
| Dernier instantané réussi          | jour/mois heures:minutes, « - » s'il n'y en a pas       |
| Heures depuis la dernière réussite | en heures                                               |
| Durée du dernier instantané        | en secondes                                             |
| Taille                             | taille des fichiers du dernier instantané, en Mo        |
| Fichiers                           | fichiers du dernier instantané                          |
| Instantanés                        | instantanés conservés dans le dépôt                     |
| Erreurs du dernier instantané      | fichiers illisibles (1 pour un instantané qui a échoué) |
| En cours                           | 1 pendant un instantané de cette source                 |
| Prochain instantané planifié       | jour/mois heures:minutes, « - » sans planification      |

L'appareil « Kopia », pour le serveur :

- **Dépôt connecté** : 1, ou 0 quand le serveur n'est pas connecté à son
  dépôt ;
- **Instantané en cours** : 1 ou 0 ;
- **Progression** : en % ;
- **Source actuelle** : son chemin, « - » s'il n'y en a pas ;
- **Sources en échec** et **Sources en retard** : combien.

Un instantané « échoue » quand Kopia n'a pas pu lire certains fichiers (il
enregistre l'instantané sans eux), quand il est incomplet, ou quand il échoue
complètement (un dossier supprimé, un stockage injoignable : aucun instantané
n'est enregistré). Les erreurs que la stratégie de la source ignore ne
comptent pas. L'état montre d'abord ce qui demande de l'attention : une source
en échec affiche « En échec » même si elle est aussi en retard.

Les sources d'un autre ordinateur ou utilisateur (clients du même dépôt) sont
nommées `utilisateur@hôte:/chemin`.

## Tableau de bord

Le widget **Kopia** affiche le nombre de sources en échec, en retard et OK,
puis une ligne par source : en échec d'abord, puis en retard, en cours, sans
instantané, OK, avec la dernière réussite (ou la progression de celle en
cours). Toutes les sources par défaut, ou celles choisies dans ses réglages.
Le bouton **Actualiser** relit Kopia.

## Scènes

### Déclencheurs

- **Un instantané réussit** : un instantané se termine sans erreur.
  Informations : source, durée (minutes), fichiers, taille, instantanés
  conservés.
- **Un instantané échoue** : fichiers illisibles, instantané incomplet, ou
  échec complet. Informations : source, première erreur, erreurs.
- **Une source est en retard** : une source n'a pas eu d'instantané réussi
  depuis plus longtemps que le délai « En retard après ». Une fois par délai
  dépassé, à nouveau après une nouvelle réussite. Informations : source,
  heures depuis la dernière réussite, dernière réussite.

Chaque déclencheur peut se limiter à certaines sources (vide : toutes).

### Actions

- **État d'une source** : lit l'état d'une source pour les actions suivantes :
  en échec, en retard, l'état en toutes lettres, la source, la dernière
  réussite, les heures depuis la dernière réussite (-1 s'il n'y en a pas), et
  une phrase toute prête (« /home/anna : En échec, dernière réussite 18/10
  02:05. »).
- **Lancer un instantané** : lance maintenant un instantané de la source.
  Refusé quand « Autoriser le lancement des instantanés » est désactivé.

### Idées de scènes

- **Un instantané échoue** → envoyer un message avec la source et sa première
  erreur, prises dans les informations du déclencheur.
- **Une source est en retard** → prévenir avec la source et les heures depuis
  sa dernière réussite.
- Chaque dimanche à 10 h → **État d'une source** → envoyer la phrase ; ou
  lancer un instantané des photos en quittant la maison, avec **Lancer un
  instantané**.

## Dépannage

- **« Kopia ne répond pas »** : vérifiez l'adresse et le port depuis la
  machine de Gladys, et que le serveur écoute le réseau
  (`--address=0.0.0.0:51515`, pas `127.0.0.1`).
- **« nom d'utilisateur ou mot de passe refusé par Kopia »** : saisissez-les à
  nouveau ; ce sont ceux de `--server-username` et `--server-password`.
- **« certificat refusé »** : un certificat auto-signé ; saisissez son
  empreinte dans la configuration.
- **« le certificat ne correspond pas à l'empreinte »** : le certificat a
  changé (Kopia en génère un nouveau quand ses fichiers sont supprimés) :
  saisissez la nouvelle empreinte.
- **« Kopia n'est pas connecté à son dépôt »** : reconnectez le serveur à son
  dépôt dans son interface web.
- **Une source ne passe jamais en retard** : en _Automatique_, une source sans
  intervalle ne peut pas être en retard ; choisissez un délai fixe. Une source
  qui n'a jamais réussi n'est pas en retard non plus : elle affiche En échec ou
  Aucun instantané.
- **Un échec complet n'apparaît plus après un redémarrage de Kopia** : Kopia
  ne garde ses tâches qu'en mémoire ; l'intégration l'a tout de même annoncé
  sur le moment.
- Pour en voir plus, mettez la variable `LOG_LEVEL` de l'intégration à
  `debug`.

## Limites

- Un seul serveur Kopia par intégration.
- Un échec complet (aucun instantané enregistré) n'est connu que par la liste
  des tâches du serveur, perdue à son redémarrage.
- L'intégration ne restaure, ne supprime ni ne modifie les instantanés ou les
  stratégies : elle les surveille, et les lance si c'est autorisé.
- Sans lien avec Kopia. Signalez un problème ou une idée sur
  [les issues](https://github.com/guim31/gladys-kopia/issues).
