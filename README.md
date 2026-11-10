# Ludonyon — Espace des bénévoles

Application communautaire pour les bénévoles, responsables et membres du
comité de la Ludothèque Nyon Région : annuaire, annonces, gestion
d'événements avec inscription, et un espace privé pour organiser les
activités.

## Fonctionnalités

- **Connexion** par email / mot de passe (comptes créés par un·e
  responsable ou un membre du comité, pas d'auto-inscription).
- **Annuaire des bénévoles** : nom, contact, compétences/disponibilités.
- **Annonces** : fil de nouvelles de l'équipe.
- **Événements** : liste des permanences/animations à venir, avec
  inscription et désinscription en un clic.
- **Planning des ouvertures** : grille mensuelle en lecture seule (mardi,
  mercredi matin/après-midi, vendredi, samedi — Gland en plus de Nyon le
  mercredi après-midi et le samedi matin) montrant qui tient la ludothèque.
- **Espace organisation** (réservé aux rôles Responsable et Comité) :
  créer des annonces et des événements, voir qui s'est inscrit, gérer les
  comptes bénévoles (créer, changer de rôle, réinitialiser un mot de
  passe, archiver), assigner les bénévoles sur le planning des ouvertures
  (à la main ou en important un fichier Excel — voir ci-dessous), déclarer
  des vacances globales (fermeture de la ludothèque, affichée sur le
  planning).

### Rôles

| Rôle | Accès |
| --- | --- |
| Bénévole | Annuaire, annonces, événements (inscription) |
| Responsable | Idem + Espace organisation |
| Comité | Idem + Espace organisation |

Une prochaine étape possible (non implémentée pour l'instant) : un espace
privé supplémentaire réservé au comité pour des listes de tâches internes.
Le modèle de rôles est déjà en place pour l'ajouter facilement plus tard.

## Stack technique

- [Next.js 16](https://nextjs.org) (App Router, Turbopack)
- [Prisma 7](https://www.prisma.io) + MySQL
- [NextAuth (Auth.js) v5](https://authjs.dev) — connexion par identifiants
- [Tailwind CSS 4](https://tailwindcss.com)
- TypeScript

## Démarrage local

Prérequis : Node.js 20.9+ et un serveur MySQL/MariaDB accessible (local ou distant).

```bash
npm install
cp .env.example .env
# renseignez DATABASE_URL (voir format dans .env.example) et générez
# une valeur pour AUTH_SECRET :
openssl rand -base64 32

npx prisma migrate dev   # crée les tables dans la base MySQL
npm run db:seed          # comptes de démonstration (voir ci-dessous)
npm run dev
```

L'application est alors disponible sur http://localhost:3000.

### Comptes de démonstration (créés par `npm run db:seed`)

| Email | Mot de passe | Rôle |
| --- | --- | --- |
| comite@ludonyon.ch | ludonyon2024 | Comité |
| responsable@ludonyon.ch | ludonyon2024 | Responsable |
| alex.martin@example.ch | benevole2024 | Bénévole |
| chris.rochat@example.ch | benevole2024 | Bénévole |

⚠️ Changez ou supprimez ces comptes avant toute mise en production.

### Ajouter les vrais comptes des bénévoles

Une fois connecté·e avec un compte Responsable ou Comité, allez dans
**Espace organisation → Bénévoles** pour créer un compte par bénévole
(un mot de passe provisoire à leur communiquer ; ils peuvent le changer
ensuite depuis **Mon profil**).

## Déploiement (Infomaniak, hébergement Node.js + MySQL)

1. Dans le Manager Infomaniak, créez un site **Node.js** (Hébergement →
   votre site → Ajouter un site) et choisissez **« Importer un projet
   existant »** pour cloner ce dépôt Git (branche de production).
2. Configurez le site :
   - **Commande de build** : `npm install && npm run build`
   - **Commande de démarrage** : `npm run start`
   - **Dossier d'exécution** : la racine du dépôt (là où se trouve
     `package.json`)
   - Le port est géré automatiquement par Infomaniak via la variable
     `PORT`, que `next start` lit tout seul.
3. Dans les **variables d'environnement** du site, ajoutez :
   - `DATABASE_URL` — chaîne de connexion à votre base MySQL Infomaniak,
     au format `mysql://UTILISATEUR:MOTDEPASSE@HOTE:PORT/NOM_BASE`
   - `TZ="Europe/Zurich"` — sans ça, un serveur en UTC (le défaut le plus
     courant) décale toutes les heures affichées, et surtout les horaires
     saisis à la création d'un événement (le champ "Début" est interprété
     dans le fuseau du serveur, pas celui de la personne qui le remplit).
   - `AUTH_SECRET` — générée avec `openssl rand -base64 32`
   - `AUTH_URL` — l'adresse publique complète du site, ex.
     `https://benevoles.ludo-gland.ch`. Sans ça, derrière le proxy
     d'Infomaniak, les redirections de connexion/déconnexion peuvent
     pointer vers l'adresse interne (`localhost`) au lieu du vrai domaine.
   - `VAPID_PRIVATE_KEY`, `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_SUBJECT` —
     pour les notifications push. Générez une paire de clés dédiée à la
     production avec `npx web-push generate-vapid-keys` (ne réutilisez
     pas celle du développement local). `VAPID_SUBJECT` est un
     `mailto:` de contact, ex. `mailto:contact@ludonyonregion.ch`.
   - `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`,
     `SMTP_FROM` — optionnel, pour l'envoi automatique de l'email de
     bienvenue à la création d'un compte bénévole (voir détails dans
     `.env.example`). Sans ces variables, l'application fonctionne
     normalement, il faut juste communiquer les identifiants manuellement.
4. Depuis le terminal SSH du site (bouton dans le Manager), lancez :
   ```bash
   npx prisma migrate deploy
   npm run db:seed
   ```
   Ça crée les tables et les comptes de démonstration (à changer/
   supprimer ensuite, voir ci-dessous).
5. Redémarrez le site depuis le Manager si nécessaire.

### Photos de profil

Les photos uploadées par les bénévoles sont stockées comme fichiers dans
`public/uploads/photos/` sur le serveur (pas dans la base de données, pas
dans le dépôt Git — ce dossier est volontairement ignoré par git). Elles
survivent aux `git pull` et rebuilds normaux. Seule l'action **« Réinitialiser
le site »** dans le Manager Infomaniak les effacerait (avec le reste du
site) : à éviter une fois en production.

### Séances comité et enregistrements audio

Un événement peut être marqué « Réservé au comité » (visible uniquement par
les membres du comité — page, liste, ordre du jour et enregistrement audio
bloqués pour les responsables et bénévoles, y compris par URL directe).
L'enregistrement (micro du navigateur, ~15-30 Mo/heure) est stocké dans
`storage/recordings/` à la racine du projet — volontairement **hors**
`public/` pour ne jamais être accessible par une simple URL statique, et
hors dépôt Git. Comme pour les photos, ce dossier doit survivre aux
déploiements ; seule une réinitialisation complète du site l'effacerait.

⚠️ Si l'envoi d'un enregistrement échoue pour une séance longue, ça peut
venir d'une limite de taille côté reverse-proxy d'Infomaniak (indépendante
de la limite Next.js déjà relevée à 220 Mo dans `next.config.ts`) — à
vérifier avec le support Infomaniak le cas échéant.

### Sauvegardes automatiques

Chaque nuit à 3h (heure serveur), un export JSON complet de toutes les
tables est écrit dans `storage/backups/` à la racine du projet — hors
dépôt Git, hors `public/`, comme les enregistrements ci-dessus. Les 14
derniers jours sont conservés, les plus anciens supprimés
automatiquement. Déclenchable aussi à la main, et téléchargeable,
depuis **Espace organisation → Paramètres** (réservé au rôle Comité : le
fichier contient les mots de passe de tous les comptes, hachés mais
sensibles).

⚠️ Comme pour les photos et enregistrements, ce dossier doit survivre aux
déploiements. Mais contrairement à eux, c'est une vraie sauvegarde de
secours : pensez à en télécharger une copie de temps en temps vers un
endroit hors de ce serveur (ordinateur personnel, cloud...) — un
problème qui toucherait le disque du serveur emporterait aussi bien la
base que ce dossier.

### Planning : import/export Excel et vacances globales

Depuis **Espace organisation → Planning**, un·e responsable/comité peut
générer un modèle Excel vide pour une période donnée : un bloc de colonnes
par jour d'ouverture (Nyon à gauche, Gland à droite, séparés par une
colonne vide), et pour chaque semaine 4 lignes empilées sous la date — une
par fonction (Ordi-caisse, Ordi retours, Accueil, Anim./accueil), avec le
libellé de fonction affiché une seule fois à gauche pour économiser la
place. Une couleur différente marque chaque mois pour s'y retrouver plus
facilement sur une période de plusieurs mois. C'est purement
organisationnel côté fichier : à l'import, tout le monde est simplement
ajouté à l'ouverture du jour, quelle que soit la ligne fonction où le
prénom a été saisi. Le fichier se complète avec les prénoms des bénévoles
(un onglet « Bénévoles » liste les prénoms exacts à utiliser — l'initiale
du nom de famille est ajoutée automatiquement en cas de doublon, ex.
« Marie D. » / « Marie L. »), puis se réimporte : le site reconnaît les
bénévoles actif·ve·s et met à jour le planning pour toute la période
couverte par le fichier (un jour laissé entièrement vide efface
l'assignation existante ; les noms non reconnus sont listés
après l'import pour correction). Le format du fichier (colonnes, position
des dates) ne doit pas être modifié manuellement.

Les **vacances globales** (fermeture complète de la ludothèque — vacances
scolaires, etc.) se déclarent depuis la même page et s'affichent comme
jours fermés sur le planning, pour tout le monde.

### Alerte "créneau à risque"

Si un créneau de la semaine suivante reste sans remplaçant·e trouvé·e après
qu'un·e bénévole a signalé un empêchement, les responsables et membres du
comité reçoivent une notification push groupée une fois par semaine, le
dimanche à 19h (heure serveur), listant tous les créneaux concernés — pas
de notification à chaque vérification.

### PWA et notifications push

Le site est installable (icône sur l'écran d'accueil, mobile et
ordinateur) et peut envoyer des notifications push aux bénévoles ayant
activé l'option depuis **Mon profil**. Ça ne nécessite aucune app store.

Trois usages :
- Rappel automatique ~1h avant un événement pour les personnes ayant coché
  "je veux être notifié·e" à l'inscription.
- Envoi manuel depuis **Espace organisation → Notifications** (à tous les
  bénévoles ou juste responsables/comité).
- Le rappel "ouvertures" (case globale dans Mon profil) n'est pas encore
  branché à un envoi push basé sur le planning des ouvertures.

⚠️ **À tester obligatoirement sur un vrai téléphone une fois déployé** —
l'activation des notifications (autorisation du navigateur, réception
réelle) ne peut pas être vérifiée autrement. Sur iPhone, le site doit
d'abord être ajouté à l'écran d'accueil (limite d'Apple, pas du site).

### Emails (SMTP)

Si les variables `SMTP_*` sont renseignées (voir `.env.example`), un email
avec l'adresse du site, l'identifiant et le mot de passe provisoire est
envoyé automatiquement à la création d'un compte bénévole. Un mode d'emploi
PDF optionnel peut être mis en ligne depuis **Espace organisation →
Paramètres** : il est alors joint à cet email. Le statut de la
configuration SMTP est visible sur cette même page.

Avec un compte Office 365, l'authentification SMTP doit d'abord être
activée pour le compte utilisé (souvent désactivée par défaut) dans le
centre d'administration Microsoft 365.

### Mises à jour

- **Avec accès SSH** (inclus sur la plupart des offres Infomaniak) : sur
  le serveur, `git pull` puis relancez la commande de build et
  redémarrez le site.
- **Sans SSH** : reconstruisez le projet localement et transférez les
  fichiers par SFTP, puis redémarrez le site manuellement depuis le
  Manager.

## Structure du projet

```
prisma/schema.prisma        Modèle de données (User, Announcement, Event, EventSignup)
prisma/seed.ts               Script de données de démonstration
src/auth.ts                  Configuration NextAuth (rôles, session)
src/proxy.ts                 Protection des routes (connexion + accès Espace organisation)
src/lib/actions/             Server Actions (mutations : événements, annonces, bénévoles, profil)
src/app/(auth)/connexion/    Page de connexion
src/app/(main)/              Pages authentifiées (accueil, annuaire, annonces, événements, profil)
src/app/(main)/organisation/ Espace privé Responsables/Comité
```
