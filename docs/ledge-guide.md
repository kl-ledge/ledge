# Ledge, le guide

Ce guide est écrit à la main et versionné avec le code. `ledge brain @ledge` le sert aux agents, en tête de ce que Ledge sait de lui-même. Il sert à répondre aux questions sur Ledge lui-même : ce qu'il est, ce que permet chaque écran, et vers quel écran renvoyer l'utilisateur. Chaque écran porte entre parenthèses son identifiant dans le code. Un test vérifie que chaque écran déclaré dans le code figure ici : un nouvel écran s'ajoute donc aussi à ce guide.

## Ce qu'est Ledge

Ledge veille sur les sessions d'agents de l'utilisateur : Claude Code, Codex, Cursor Agent et OMP, lancés dans WSL ou sur un serveur SSH. Il montre ce que fait chaque agent et ce qu'il attend. Il permet de répondre à une demande sans ouvrir son terminal et de lancer des sessions.

- **Le daemon** (`ledge daemon`, paquet npm `@paradow/ledge`) tourne dans WSL ou sur un serveur. Il suit les sessions par leurs hooks et par tmux, garde les projets, les tâches, les décisions et les messages entre sessions, et les routines. La CLI `ledge` lui parle :
  - `ledge claude|codex|cursor` lance un agent suivi ;
  - `ledge attach <id>` met le terminal sur une session ;
  - `ledge who` liste les sessions en vie, et `ledge status` toutes les sessions avec leur id (`--all` : les archivées aussi) ; `--json` donne à un agent l'id, le nom, l'outil, l'état, le projet, le dossier, la branche, le sujet, l'archive et la dernière activité ;
  - « Gérer la session » en ligne de commande : `ledge archive <session>…` (`--close` ferme d'abord proprement une session en cours), `ledge unarchive`, `ledge resume`, `ledge rename <session> "<sujet>"` (le sujet ; le nom de l'agent ne change pas), `ledge move <session> <projet>` et `ledge delete <session>… --yes`. Une session agent peut tout faire sauf supprimer, qui reste à l'utilisateur ;
  - `ledge send` et `ledge read` servent aux messages entre sessions ;
  - `ledge task`, `ledge decide`, `ledge handover` et `ledge close` gèrent les tâches, les décisions, la passation de relais et la fermeture ;
  - `ledge brain` montre ce que Ledge sait de lui-même (`@ledge`, `@projects`, `@machines`) et l'index des notes de l'utilisateur ; `ledge brain <nom>` en lit une ;
  - une session propose un fait durable pour une note avec `ledge brain propose <nom> "<fait>" "<source>"` (`new:<nom>` : une nouvelle note), ou en signale une fausse avec `ledge brain flag <nom> "<quoi>"`. Elle arrive avec ses boutons dans la vue Tâches sur le PC, et dans le fil de la session sur le téléphone : « Ajouter » écrit le fait daté sous `## Ajouts`, « Modifier » écrit ton texte à la place, « Refuser » n'écrit rien (un signalement : « Marquer à revoir », « Ignorer » ; une nouvelle note : son titre et « quand la lire » se corrigent avant « Créer la note »). Sur le téléphone, « Ajouter » demande la vérification de l'appareil. `ledge decide` y répond aussi : « oui », « oui : <texte> » ou « non » ;
  - `ledge routine` programme une routine : Ledge tape une consigne dans une session permanente à heures fixes (voir « Les routines ») ;
  - `ledge tui` est Ledge dans un terminal (voir « Ledge dans un terminal ») ;
  - `ledge setup` et `ledge uninstall` installent et retirent les hooks et `~/.ledge`.
- **Ledge Desktop** est l'application Windows : la fenêtre principale, un espace de travail en onglets (sessions, sièges OpenRig, MR et PR, atelier, réglages), et l'**encoche**.
- **L'encoche** (l'île) ne reste pas à l'écran. Au repos, il n'y a rien en haut de l'écran.
  - Quand un agent a quelque chose à dire, une pastille sort du bord haut et flotte à 8 px de lui. Elle porte le logo du provider de l'agent (Claude, Codex…) et le signe de l'événement. Puis elle s'ouvre sur la notification, se referme et disparaît.
  - Une carte par événement, avec le logo, une pastille d'état, la phrase, le projet et la branche :
    - **tour terminé** : pastille verte et début de la dernière réponse, 6 s ;
    - **erreur** : pastille rouge et message de l'erreur, 6 s ;
    - **demande d'accord** : la commande, avec « Autoriser » (`Y`), « Refuser » (`N`), « Ouvrir dans Ledge » (`O`) et « Plus tard » (`Esc`) ;
    - **question** : les réponses proposées (`1`-`9`) et un champ libre ;
    - **plan ou diff à relire** : « Relire dans Ledge » et « Plus tard ».
  - Un avis (tour terminé, erreur) se ferme seul : un anneau autour du logo se vide pendant les 6 s, et le survol le retient. Un clic ouvre la session dans Ledge Desktop.
  - Une demande reste ouverte jusqu'à la réponse ou « Plus tard ». Après « Plus tard », plus rien n'est à l'écran : `Ctrl+Alt+L` rouvre la plus ancienne demande en attente.
  - Une seule notification à la fois, les demandes avant les avis ; « +2 autres » dit ce qui attend. « Ne pas déranger » n'ouvre rien.
  - Les avis de Ledge et « une machine est hors ligne » passent aussi par l'encoche : la demande urgente d'un rig (ses choix y répondent directement ; « Ouvrir » mène au bloc Demandes de la vue Rigs), une décision qu'une session pose à l'utilisateur (« Ouvrir » mène à la vue Tâches), une routine.
  - La musique, la ligne d'activité, les mascottes et le réveil au survol ne sont plus dans l'encoche.
  - `Ctrl+Alt+L` rouvre la plus ancienne demande en attente ; sans demande, il ne fait rien.
  - `Ctrl+Alt+N` ouvre « Nouvelle session » dans Ledge Desktop.
  - Ses réglages sont dans Réglages › Encoche.
- **Ledge mobile** est une application web pour le téléphone, servie par un relais. Elle se lie au PC depuis Réglages › Accès mobile.
- **Il n'y a plus de chat avec Ledge** ni de « point » écrit de lui-même, ni de page « À toi » (#40). Ce qui attend l'utilisateur se trouve là où il y répond : une session qui demande un accord ou pose une question, dans l'arbre et sa page ; une demande d'OpenRig, dans le bloc Demandes de la vue Rigs ; une décision qu'une session lui confie (`ledge task give ledge`) ou un signalement (`ledge report`), dans la vue Tâches sur le PC et dans le fil de la session sur le téléphone ; une routine à activer, sur sa page et dans l'écran Routines.

Les notes de l'utilisateur se rangent dans `~/.ledge/context/*.md`. Le front matter est optionnel :
- `title`, et `when`, qui dit quand lire la note ;
- `scope` : `sessions` ou `all` (le défaut) ; `chat`, la portée de l'ancien chat, n'est proposée à aucune session ;
- `projects` : les projets (noms ou ids, séparés par des virgules) dont les sessions la voient dans leur index ; sans lui, toutes ;
- `checked` : la date (`AAAA-MM-JJ`) où son contenu a été vérifié.

Une session lancée par Ledge reçoit à son démarrage l'index des notes de son projet, jamais les notes elles-mêmes, et en lit une avec `ledge brain <nom>`. `scope: chat` retire une note de ce que Ledge propose aux sessions ; ce n'est pas une protection : une session qui a un shell peut lire le dossier.

## Ledge dans un terminal

`ledge tui` montre Ledge dans le terminal, en six écrans, de `1` à `6` : la vue d'ensemble, la session choisie, « Nouvelle session », les Réglages, OpenRig et les Routines. `?` ouvre l'aide, `q` quitte.
- **La vue d'ensemble** range les sessions par projet et par branche, puis les rigs et le kernel. Une session qui demande un accord ou pose une question y porte son état ; `y`, `n`, `A` et `1`-`9` lui répondent quand elle est choisie, et `tab` mène à la prochaine qui attend. Une session qui a posé une décision à l'utilisateur porte un « ? » ambre après son nom.
- **L'écran Session** montre son fil et sa demande. Une décision qu'elle a posée s'affiche en ambre sous le fil d'Ariane (« Nova te demande : … · D répondre à la décision ») : `D` ouvre le champ, la réponse se relit, `y` l'envoie. Une relève qui a échoué s'y dit en rouge, et `H` réessaie ; dans l'arbre, son ◔ passe en rouge.
- **La ligne d'usage**, en bas de chaque écran, donne les limites des agents ; une alerte y prend la place de son agent, en ambre au-delà du seuil, en rouge quand la limite est atteinte (la plus grave, puis « +n »).
- **Réglages › Accès mobile** règle l'accès mobile (activer, relais, compte GitHub, appareils à renommer ou révoquer) ; `L` agit quand un téléphone demande à se lier : il ouvre « Lier un appareil », pour approuver ou refuser la demande.

## Les routines

Une routine réveille une session permanente à heures fixes : aux heures et aux jours choisis, l'horloge de Ledge tape sa consigne dans la session. Les heures sont locales (08:00 reste 08:00 au changement d'heure). Le daemon les garde dans `~/.ledge/routines.json`.

Une routine est soit **récurrente** (des heures, des jours, chaque semaine ou une semaine sur deux), soit **unique** (un ou plusieurs moments précis). Une semaine sur deux se cale sur une semaine de référence, l'ancre : `--every 2w --anchor 2026-11-27` (un vendredi de Sprint Review) fait tomber « jeudi 16:00 » sur les bonnes semaines. `ledge routine list` et `show` donnent les 3 prochains passages, pour vérifier la parité d'un coup d'œil. Une routine unique, une fois son dernier moment parti, quitte la liste active et reste dans l'historique ; un moment qui n'a pas pu partir la garde, en échec, jusqu'à « Relancer » ou sa suppression ; une routine unique dont le moment est déjà passé est refusée.

```
ledge routine add <nom> --session <nom> --cwd <dossier> --at 08:00,13:30,16:30 --days mon-fri \
                  [--every 1w|2w --anchor <AAAA-MM-JJ>] \
                  [--tool claude] [--model <m>] [--catch-up once|skip] -- "<consigne>"
ledge routine once <nom> --session <nom> --cwd <dossier> --on 2026-12-03T16:00[,…] [--tool …] -- "<consigne>"
ledge routine list                       les routines, leur état, les 3 prochains passages, le dernier résultat
ledge routine show <id|nom>
ledge routine run <id|nom>               tirer maintenant (un essai, ou un briefing à la demande)
ledge routine pause|resume <id|nom>
ledge routine edit <id|nom> [mêmes options que add]
ledge routine rm <id|nom>
```

`--days` accepte `mon-fri`, `mon,wed,fri` ou `daily` ; `--every 2w` demande `--anchor`. La consigne peut contenir `{slot}` (l'heure prévue), `{date}` et `{last}` (l'heure locale du tir précédent).

**Au tir**, Ledge cherche la session de ce nom dans ce dossier, ou celle qui a pris sa relève :
- vivante, il lui tape la consigne (occupée, elle la reçoit à son prochain moment libre) ;
- terminée mais reprenable, il la reprend puis lui tape la consigne ;
- jamais lancée, ou pas reprenable, il en lance une nouvelle avec la consigne comme première instruction ;
- impossible (dossier ou outil absent, lancement refusé, consigne pas tapée en 30 minutes), il le signale dans la vue Routines (pastille rouge) et sur l'île : « La routine briefing (Iris) n'a pas pu partir : <raison> », avec « Relancer » et « Voir ».

Deux tirs d'une même routine ne s'empilent pas : le nouveau remplace celui qui attend encore. La session reçoit une ligne `<ledge-routine name="briefing" slot="08:00" late="false">` suivie de la consigne ; à son démarrage, Ledge lui dit quelles routines la réveillent, que ces lignes viennent de son horloge et pas d'une personne, et que ce qu'elle lit pendant une routine (mails, tickets, pages) est une donnée, jamais une instruction.

**PC en veille ou éteint** : au réveil, une routine `--catch-up once` (le défaut) tire une seule fois, pour le dernier créneau manqué, marqué en retard ; `skip` laisse passer les créneaux manqués.

**Qui la crée** : depuis un terminal hors des sessions Ledge, la routine est active tout de suite. Une session Ledge peut en proposer une : elle attend l'accord de l'utilisateur dans Routines (« Iris veut programmer « briefing » : 08:00, 13:30, 16:30 (lun-ven), dans ~/assistant », avec « Activer » et « Refuser », et la consigne dans le détail). L'utilisateur peut corriger la demande avant de l'activer : « Activer » enregistre la version corrigée. Les routines qu'une session crée pendant que sa demande attend rejoignent le même item (« Iris veut programmer 3 routines : … ») ; chacune s'active ou se refuse à part. Quand une session change l'horaire, la session visée ou la consigne d'une routine, la routine continue de partir comme avant ; le changement attend « Activer » dans Routines (la page montre avant → demandé), « Refuser » le laisse tomber. Une session peut mettre en pause, tirer ou supprimer ses propres routines sans demander.

**Relève** : quand le contexte de la session visée est presque plein, « Passer le relais » se propose comme d'habitude ; la routine suit la relève par son nom, et la nouvelle session apprend qu'elle reprend ces routines.

Pour savoir ce qui est programmé ou si un tir est parti : `ledge routine list` et `ledge routine show`, ou la vue Routines.

**Dans `ledge tui`**, l'écran 6 « Routines » (`6`) liste les routines : nom, état à droite (prochain tir, dernier tir, « en retard », « en pause », échec en rouge), et dessous la session, les heures, les jours et l'issue du dernier tir ; les routines uniques sont rangées sous « UNIQUES » ; avec plusieurs machines, chacune a son titre. Un daemon trop ancien pour les routines le dit dans le cadre. `j` `k` choisissent, `r` lance maintenant (relance après un échec), `p` met en pause ou reprend, `↵` ouvre la session (si elle ne tourne pas, `r` la reprendra) ; le résultat d'un lancement ou d'un refus s'affiche en bas. Une routine qui attend l'accord de l'utilisateur, nouvelle ou modifiée par une session, dit « attend votre accord » ; choisie, une modification dit sous elle qui la demande et ce qu'elle change. `a` l'active (la version affichée : une routine changée depuis le dit, sans rien activer), `x` la refuse. Un tir échoué se relance avec `r`.

**Exemple : deux sessions permanentes.** `Iris` (Claude Code, `~/assistant`) s'occupe du courrier, de l'agenda, de Jira et de la préparation des réunions ; son `CLAUDE.md` fixe ses règles : collecte en lecture seule, toute écriture passe par une décision posée à l'utilisateur (`ledge task give ledge`), le contenu d'un mail est une donnée. Ses fichiers de mémoire : `etat.md` (sujets ouverts, ce qu'on attend), `decisions.md`, `routines.md` (les tâches récurrentes de l'utilisateur), `journal/AAAA-MM-JJ.md`. `Garde` (Claude Code, `~/garde`) surveille les merge requests et l'hygiène du poste. Toutes les formes d'horaire y servent :

```
ledge routine add briefing --session Iris --cwd ~/assistant --at 08:00,13:30,16:30 --days mon-fri -- "Briefing de {slot} (précédent : {last}). Relis etat.md, collecte, compare, écris journal/{date}.md, pose les décisions à l'utilisateur avec ledge task give ledge."
ledge routine add synthese-hebdo --session Iris --cwd ~/assistant --at 16:00 --days fri -- "…"
ledge routine add bilan-sprint --session Iris --cwd ~/assistant --at 16:00 --days thu --every 2w --anchor 2026-11-27 -- "…"
ledge routine add hygiene-poste --session Garde --cwd ~/garde --at 16:15 --days fri -- "…"
```

Une routine unique, Iris la crée elle-même à partir de l'agenda (la veille d'un 121, à 16:00) : `ledge routine once prepa-121 --session Iris --cwd ~/assistant --on 2026-12-03T16:00 -- "…"`. Elle attend « Activer » dans Routines, comme toute routine créée par une session.

## Ledge Desktop

La fenêtre principale est un espace de travail à la manière de VS Code : des onglets en groupes côte à côte, des panneaux et plusieurs fenêtres. De haut en bas et de gauche à droite :
- **La barre de titre :** le champ de recherche, qui ouvre la palette (`Ctrl+K`), et les boutons qui affichent ou masquent la barre latérale, le panneau du bas et le panneau de droite.
- **La barre d'activité**, tout à gauche : « Projets » (un badge rouge pour une autorisation, ambre pour une question), « Rigs » (un badge ambre pour les demandes d'OpenRig), « MR et PR » (un badge pour les pipelines échoués), « Routines », « Tâches » (un badge ambre pour les décisions), puis « Atelier » et, en bas, « Réglages », qui s'ouvrent en onglets. Un second clic sur la vue affichée replie la barre latérale.
- **La barre latérale :** la vue choisie dans la barre d'activité. Elle se redimensionne en glissant son bord ; un double-clic lui rend sa largeur.
- **La zone d'édition :** des groupes d'onglets côte à côte. Un groupe vide propose « Nouvelle session », « Aller à une session », « Demander à Ledge », « Prochaine demande », OpenRig, l'atelier, un terminal, les réglages et les sessions récentes.
- **Le panneau du bas** (`Ctrl+J`) : les terminaux et la sortie (les commandes `rig` lancées par Ledge).
- **Le panneau de droite** (son bouton dans la barre de titre) : le chat de Ledge, avec ses onglets « Conversation » et « Historique ».
- **La barre d'état :** le daemon, OpenRig, les demandes en attente (un clic mène à la suivante), les MR et PR, les limites d'usage des comptes et la disposition en cours.

**Ouvrir.** Un clic sur une session, dans l'explorateur, l'atelier, la palette ou l'encoche, l'ouvre selon Réglages › Espace de travail : dans le groupe actif ou à droite. `Ctrl`+clic l'ouvre toujours à droite. Un onglet déjà ouvert est mis au premier plan, jamais dupliqué.

**Aperçu : un clic regarde, un double clic garde.** Un simple clic dans l'explorateur, sur un agent de l'atelier, sur « Atelier » ou « Réglages » de la barre d'activité, sur la prochaine demande ou sur « Voir » dans l'encoche ouvre un onglet d'aperçu, son titre en italique. Le clic suivant le remplace à sa place : parcourir cinq agents ne laisse qu'un onglet. Un double clic, sur la ligne ou sur l'onglet, le garde. Agir dedans le garde aussi : taper dans son composeur ou son terminal, répondre à une demande, un bouton d'une MR, d'un rig ou d'une routine, un réglage changé, ouvrir un autre onglet depuis lui, le glisser. Le clic droit (« Ouvrir »), la palette, une session lancée, « Nouvelle routine », une disposition et le redémarrage ouvrent des onglets gardés.

**Groupes.** `Ctrl+\` (ou « Diviser à droite » du menu d'un onglet) crée un groupe vide à droite. On glisse un onglet d'un groupe à l'autre ; pendant le glisser, une zone « nouveau groupe » apparaît à droite. Le carré à gauche des onglets lie un groupe à une couleur : quand on change de session dans un groupe lié, les onglets Modifications et Terminal des groupes de la même couleur la suivent. Le + d'un groupe ouvre « Nouvelle session ».

**Fenêtres détachées.** Un onglet glissé hors de la fenêtre s'ouvre dans une nouvelle fenêtre, qui porte un seul groupe. Fermer cette fenêtre ramène ses onglets dans la fenêtre principale, sans rien fermer. Fermer la fenêtre principale la cache dans la zone de notification, avec ses fenêtres détachées ; « Quitter » (zone de notification) ferme tout.

**Dispositions.** Le menu « Disposition » de la barre d'état enregistre sous un nom les groupes, les fenêtres et les panneaux, et les applique. Réglages › Espace de travail choisit ce que Ledge rouvre au démarrage.

Raccourcis principaux :
- `Ctrl+K` ouvre la palette : `@` pour les sessions et les sièges, `>` pour les commandes ;
- `N` ouvre « Nouvelle session » (sur une autorisation en attente, `N` la refuse) ;
- `Y` / `N` autorisent ou refusent la demande de la session active ;
- `Ctrl+/` ouvre la vue Tâches, et la deuxième fois revient à la vue d'avant ; `/` ne fait rien ;
- `Ctrl+B` et `Ctrl+J` affichent ou masquent la barre latérale et le panneau du bas ;
- `Alt+1…9` ouvre la Nième session de la liste, `Alt+←/→` la session précédente ou suivante ;
- `Ctrl+\` divise le groupe à droite, `Ctrl+1…9` va au groupe N ;
- `Ctrl+W` ferme l'onglet, `Ctrl+Maj+T` rouvre le dernier fermé, `Ctrl+Tab` passe à l'onglet suivant du groupe, `Ctrl+Alt+←/→` envoie l'onglet dans le groupe voisin ;
- `` Ctrl+` `` bascule l'onglet d'une session entre son fil et son terminal ; `` Ctrl+Maj+` `` sort du terminal sans changer de vue ;
- `Ctrl+,` ouvre les réglages ;
- `?` liste les raccourcis ;
- Échap ferme une fenêtre modale, un menu, une confirmation ou le chat, ou retire un filtre.

### Barre latérale

#### Projets (`projects`)

Les sessions par projet, puis par branche. Un clic ouvre une session ; le clic droit propose « Ouvrir », « Ouvrir à droite », son terminal, « Envoyer un message… » et « Gérer la session ». Le menu d'un projet propose « Nouvelle session ici », « Écrire à tout le projet… », « Ajouter un dossier… » et « Modifier le projet… ». `Ctrl`+clic choisit plusieurs sessions, pour leur écrire d'un coup. On range une session en la glissant sur un projet. En bas, les **Archives**, repliables : les sessions archivées, avec leur projet et leur ancienneté. Une archive s'ouvre en lecture seule, avec « Reprendre ».

Une session disponible dont l'agent travaille encore en arrière-plan prend un petit anneau bleu sur son logo, et sa ligne dit pourquoi : le compteur de ses sous-agents passe en bleu tant que l'un travaille, et une commande lancée en arrière-plan (Claude Code) s'affiche sous la tâche, « … · en arrière-plan ». Le survol le redit (« Disponible, mais… »). Le projet compte ces sessions à part, avec un cercle creux bleu. Rien de tel pour Codex et Cursor, que Ledge ne sait pas lire.

Y renvoyer l'utilisateur pour retrouver une session, ou une session archivée.

#### Rigs (`rigs`)

OpenRig sur la machine affichée (le menu `● WSL ▾` de l'en-tête en change ; « + Lancer » ouvre « Lancer un rig »). En tête, le bloc **Demandes** : ce qu'OpenRig demande à l'utilisateur (les rigs, Max, l'opérateur), chaque demande en carte entière (choix, « Répondre autrement… », « Vu »), les plus urgentes d'abord ; il se replie et se rouvre à l'arrivée d'une demande, et la pastille ambre de l'icône Rigs compte celles qui attendent une réponse. Puis le **kernel** et ses sièges (l'operator, qui aide à composer une équipe ; l'advisor ; le queue worker), puis chaque **rig** avec ses sièges, puis la ligne du **daemon** OpenRig, collée en bas. Le kernel, chaque rig et le daemon ont sur leur ligne leurs boutons démarrer, redémarrer et arrêter ; un arrêt ou un redémarrage demande confirmation sous la ligne. Un clic sur un siège ouvre son fil, un clic sur un rig ouvre sa vue Rig, un clic sur « Daemon » ouvre la page OpenRig. Un siège disponible avec du travail en arrière-plan (sous-agents, commande) a un cercle creux bleu ; son rig en donne le nombre, avant celui de ses sièges. OpenRig arrêté, la vue propose « Démarrer OpenRig ».

Y renvoyer l'utilisateur pour suivre ses rigs et leurs sièges, ou démarrer et arrêter OpenRig, son kernel ou un rig.

#### MR et PR (`prs`)

Toutes les MR GitLab et les PR GitHub de l'utilisateur, lues par `gh` et `glab` sur chaque forge connectée, quel que soit le dépôt : celles qu'il a créées, celles qui lui sont assignées, celles qu'il doit relire, et celles des branches des sessions et des sièges. En tête, une recherche (réf, titre, dépôt) et un filtre par rôle : « Toutes », « Créées », « Assignées », « À relire », chacun avec le nombre de ses ouvertes. Les ouvertes viennent d'abord ; les fusionnées et fermées des 7 derniers jours sont repliées en bas. Chacune montre ses rôles (« créée », « assignée », « à relire », « branche suivie »), son hôte, son dépôt, son état, son agent, son pipeline et ses commentaires ouverts. Une même MR ou PR lue par plusieurs machines n'a qu'une ligne. Un clic l'ouvre dans un onglet. Quand `gh` ou `glab` manque ou n'est pas connecté sur une machine, la vue le dit et donne la commande à lancer.

#### Routines (`routines`)

L'icône réveil de la barre d'activité, après « MR et PR » ; sa pastille rouge compte les routines à activer et celles dont le dernier tir a échoué. Les routines y sont rangées en groupes repliables : **Récurrentes**, **Uniques**, **En pause** et **Passées** (ces deux-là repliées ; une unique passée y reste 30 jours). Dans chaque groupe : celles à activer, puis celles en échec, puis par prochain tir. Une ligne donne le nom et le prochain tir (l'heure seule si c'est aujourd'hui), puis la session réveillée, les heures et les jours (« 1 sem. sur 2 » pour une routine toutes les deux semaines, « unique » pour une unique), et au besoin « Attend ton accord », la raison d'un échec ou « en retard ». Les uniques qu'une session propose ensemble restent groupées sous « Proposées ensemble par … ». Au survol, « Lancer maintenant » et « Pause » / « Reprendre » ; au clic droit, aussi « Ouvrir la session » et « Supprimer… ». Le « + » ouvre « Nouvelle routine ». En pied, le fuseau des heures. Daemon local hors ligne : la vue le dit et rien ne part. Dans l'explorateur des projets, une petite horloge suit le nom d'une session qu'une routine réveille ; un clic ouvre la routine.

Y renvoyer l'utilisateur pour voir ce qui est programmé, lancer une routine tout de suite, la mettre en pause ou en créer une.

#### Tâches (`tasks`)

L'icône ☑ de la barre d'activité, après Routines, ou `Ctrl+/` (une deuxième fois, retour à la vue d'avant) ; sa pastille ambre compte les décisions qui attendent l'utilisateur. Toutes les tâches données entre sessions et par Ledge, les plus récentes d'abord, avec le nombre des ouvertes en tête.
- Filtres : « Toutes / Ouvertes / Closes », et le donneur (« Tous », « Ledge », « Les sessions », « Décisions »).
- Un clic ouvre une tâche à la place de la liste : son résultat, sa raison et son historique. « ‹ Tâches » ou Échap revient à la liste.
- Une décision se tranche ici : « Répondre », puis « Envoyer la réponse », puis « Confirmer l'envoi ».
- Un signalement d'agent (`ledge report`) y est une décision marquée « signalement » : son détail propose « Créer l'issue », « Modifier avant » ou « Ignorer ».
- « Voir dans Tâches », depuis une session, son fil, l'atelier ou l'île, ouvre cette vue sur la tâche.

Y renvoyer l'utilisateur pour suivre une tâche, trancher une décision qui l'attend ou traiter un signalement.

### Onglets

#### Session (`session`)

L'onglet porte le logo de l'agent, son nom et une pastille d'état ; il est souligné en rouge pour une autorisation, en ambre pour une question. Un sous-agent a son propre onglet.
- **Le fil :** les échanges, et une demande épinglée au-dessus de la réponse : « Autoriser » ou « Refuser » (`Y`/`N`), « Toujours autoriser pour cette session » ou « … dans ce projet » ; un plan s'approuve ou continue ; une question se répond par une option ou par un texte libre.
- **La réponse :** un champ sur plusieurs lignes (Entrée envoie, Maj+Entrée passe à la ligne).
- **L'aparté (`/btw <question>`, Claude Code seulement) :** une question posée à l'agent sans interrompre son travail ; il répond avec le contexte de la session, dans une carte sous le fil, hors du fil (rien n'entre dans la conversation). Ledge tape `/btw` dans le terminal de l'agent, sur un prompt vide, attend la réponse entière, la copie depuis le panneau de Claude Code et le referme. Il refuse quand un texte non envoyé est dans le prompt de l'agent ou qu'une demande attend une réponse ; si le panneau ne vient pas ou que la copie ne se lit pas, la carte renvoie à la vue Terminal. Cette copie passe aussi par le presse-papiers : si la session est ouverte au même moment dans un vrai terminal (`ledge attach`, Windows Terminal), son presse-papiers prend la réponse de l'aparté. La vue Terminal de Ledge Desktop n'est pas concernée, et Ledge efface la copie que tmux en garde.
- **La dictée :** le micro à côté du bouton d'envoi ouvre la saisie vocale de Windows (Win+H) dans le champ, qui garde le focus ; un second clic, Win+H ou la fenêtre de Windows l'arrêtent. Ledge ne sait pas si elle écoute : c'est la fenêtre de Windows qui le montre, et qui dit quand la saisie vocale est désactivée. Hors de Ledge Desktop, la dictée n'est pas disponible.
- **Le terminal :** `` Ctrl+` `` ou le menu de l'onglet bascule sur le tmux de l'agent, où l'on peut taper.
- **La barre du bas :** le modèle (un clic en change), le contexte, la branche, le projet, la puce de sa MR ou PR, « Interrompre » pendant le travail et, tout à droite, `+N −N`, qui ouvre ses modifications à côté.
- **Le menu « Gérer la session »** (clic droit dans l'explorateur) : « Renommer » (ou F2 : un champ s'ouvre sur place, dans l'explorateur, pour donner à la session un surnom affiché devant son nom, « KB Projet 1 (Otto) » ; la session garde son nom, son adresse pour les autres sessions ; Entrée garde le surnom, un champ vidé le retire, Échap annule), « Ranger dans… », « Terminer la session », « Archiver », « Supprimer… ». Quand le contexte de l'agent approche de sa limite, Ledge propose de passer le relais à une session neuve.
- « Ouvrir dans… » envoie le dossier de la session à l'éditeur choisi dans Réglages › Espace de travail (Cursor, VS Code ou Zed).

Y renvoyer l'utilisateur pour répondre à un agent, l'interrompre, ou gérer la session (renommer, archiver, supprimer, passer le relais).

#### Siège OpenRig (`seat`)

Un siège d'un rig, comme une session, avec le nom de son rig sur l'onglet. La réponse part par `rig send`. Son terminal est une capture en lecture seule. Le menu de l'onglet ouvre aussi son `role.md`.

#### Modifications (`changes`)

Les fichiers modifiés par une session, avec un diff par fichier. On l'ouvre par le `+N −N` de la barre du bas de la session ; il s'ouvre à côté, dans un groupe lié.

Y renvoyer l'utilisateur pour lire ce qu'un agent a modifié.

#### Terminal (`terminal`)

Un terminal en onglet : celui d'un agent (attaché, on peut y taper), la capture d'un siège (lecture seule) ou un shell. Le « + ▾ » du panneau du bas ouvre un shell : WSL, PowerShell, l'invite de commandes, Git Bash, Ledge (les CLI `ledge` et `rig`) ou SSH vers une machine. Un terminal se glisse du panneau du bas vers un groupe, ou hors de la fenêtre, et revient en le déposant sur le panneau du bas.

#### MR ou PR (`pr`)

Une MR ou une PR, en quatre vues :
- « Vue d'ensemble » : la description, les détails, le graphe du pipeline, « Relancer », le journal du job échoué, « Demander à X de corriger », et la revue avec « Fusionner » (seulement avec un pipeline réussi et l'approbation requise, après confirmation) ;
- « Discussion » : les fils de commentaires ; on répond, on résout, on envoie un fil à l'agent ou « Tout envoyer à X » ;
- « Modifications » : les fichiers, avec leurs commentaires en ligne ;
- « Commits ».

« Ouvrir sur GitHub / GitLab » est là aussi.

Y renvoyer l'utilisateur pour suivre une MR ou une PR, faire corriger un pipeline ou fusionner.

#### Routine (`routine`)

Une routine dans un onglet (son nom, l'icône réveil ; « • » tant que des modifications ne sont pas enregistrées) :
- l'en-tête : son état (« Active », « En pause », « Attend ton accord », « Passée »), « Lancer maintenant » (« Relancer » après un échec), « Pause » / « Reprendre » et ⋯ (« Ouvrir la session », « Supprimer… ») ; « Réveille X dans dossier » ;
- un bandeau quand il le faut : une demande d'une session (« Activer », « Refuser » ; on peut la corriger avant de l'activer), une modification demandée par une session (avant → demandé), un tir échoué (« Relancer »), la confirmation de suppression ;
- « Tirs » : les 3 prochains et les 5 derniers (issue, retard, raison d'un échec) ;
- « Configuration », modifiable sur place : nom, session (existante ou nouvelle), type (récurrente ou unique), heures et jours, fréquence (chaque semaine, ou toutes les deux semaines avec sa semaine de référence), dates d'une unique, les 3 prochains passages calculés par Ledge, créneau manqué, prompt et ses variables `{slot}`, `{date}`, `{last}`. « Enregistrer » (`Ctrl+S`) ou « Annuler les modifications ».

Une unique passée se lit sans se modifier : « Programmer à nouveau… » en crée une nouvelle à partir d'elle. « Nouvelle routine » est la même page, vide. Les demandes et les échecs des routines arrivent aussi dans « À toi ».

Y renvoyer l'utilisateur pour régler une routine, activer la demande d'une session ou relancer un tir échoué.

#### Rig (`rig`)

La vue d'un rig (« Rig · nom »), ouverte d'un clic sur un rig ou sur le kernel :
- l'en-tête : son état, ses sièges, sa machine, « Redémarrer » et « Arrêter » (ou « Démarrer ») ;
- la topologie : les sièges et leurs liens ; un clic sur un siège ouvre son fil ;
- les réglages : la spec, les permissions du rig (Spec, Auto, Standard, Ouvert, YOLO, Verrouillé), les sièges par rôle avec un ± quand le rig tourne, le dernier snapshot et « Snapshot maintenant » ;
- la file OpenRig du rig.

Le kernel a une vue sans réglages, avec « Parler à l'operator ».

Y renvoyer l'utilisateur pour régler un rig, changer le nombre de ses sièges ou prendre un snapshot.

#### OpenRig (`openrig`)

La page OpenRig d'une machine (« OpenRig · machine »), ouverte par « Daemon » en bas de la vue Rigs ou par la palette. Une colonne à gauche donne l'état du daemon, ses boutons, et ses sections :
- « Vue d'ensemble » : le daemon, le kernel, les rigs en marche, les sièges actifs et ceux qui attendent, les dernières commandes ;
- « Rigs » : une carte par rig, kernel compris, avec « Ouvrir la vue Rig → » ;
- « Rôles » : chaque rôle, sa description, son modèle, les rigs qui l'utilisent et son fichier de consignes ;
- « Machines » : chaque machine, sa version d'OpenRig, ses rigs, « Afficher » et « Ajouter une machine » ;
- « Daemon » : relancer les rigs qui tournaient, démarrer sans le kernel, les permissions proposées au lancement, et ce qui précède un arrêt (snapshot, confirmation si un siège travaille) ;
- « Sortie » : les commandes `rig` lancées depuis Ledge.

« Lancer un rig… » est en bas de la colonne.

Y renvoyer l'utilisateur pour régler OpenRig sur une machine, voir ses rôles, ou lancer un rig.

#### Atelier (`atelier`)

Chaque projet est une table, avec ses agents assis autour et leurs sous-agents en petits bots ; les rigs ont leurs salles. Un clic sur un agent ouvre sa session, `Ctrl`+clic à droite. On range une session en la glissant sur une table. Le zoom se règle au clavier (+, −, 0) ou avec `Ctrl` + molette. La barre de l'onglet propose « Masquer les sous-agents », « Figer les animations » et « Détacher », qui l'envoie dans une fenêtre détachée (« Ramener » l'en fait revenir). Le bureau de Ledge ouvre le chat.

Y renvoyer l'utilisateur pour avoir une vue d'ensemble de qui travaille où.

#### Réglages (`settings`)

Un onglet, ouvert par `Ctrl+,` ou par « Réglages » en bas de la barre d'activité.

##### Général (`general`)

- Langue.
- Lancement au démarrage de Windows.
- « Au démarrage, reprendre les sessions ouvertes ».
- **Agent par défaut :** le harnais qui fait tourner le chat de Ledge et les sessions proposées.
- **Contexte max :** le seuil de passation de relais.
- **Alerte de limite d'usage :** au-delà de ce seuil, Ledge Desktop prévient une seule fois qu'une fenêtre d'usage d'un harnais (5 h, semaine, par modèle) approche de sa limite.
- Vérification des mises à jour.

##### Espace de travail (`workspace`)

- **Ouvrir une session :** dans le groupe actif, ou à droite.
- **Au démarrage :** la dernière disposition, une disposition choisie, ou l'atelier seul.
- **Dispositions :** appliquer ou supprimer.
- **Barre d'état :** les limites d'usage des comptes, et le seuil d'alerte.
- **Ouvrir dans… :** Cursor, VS Code ou Zed.
- **Terminaux :** le nombre de terminaux visibles en rendu rapide (WebGL).

##### Apparence (`appearance`)

Photo de profil, thème (Galet clair, Signal sombre), couleur d'accent, échelle de l'interface, mouvements réduits, agents autour d'une table.

##### Encoche (`island`)

- Afficher l'encoche, l'écran où elle se trouve, et sa position (gauche, centre, droite).
- Un aperçu : l'encoche ouverte sur une demande, à la position et à la taille choisies.
- Taille de l'encoche, qui règle aussi ses cartes.
- « Autoriser et répondre depuis l'encoche ».
- « Avis quand un agent a terminé » : la carte « Terminé » de 6 s.
- « Raccourci pour rouvrir une demande » (`Ctrl+Alt+L` par défaut).

##### Notifications (`notifications`)

« Ne pas déranger », et ce qui se passe quand un agent a terminé : son, ou état de session seul (plus de bulle : c'est Ledge qui parle, voir « Ledge, l'opérateur »).

##### Sons (`sounds`)

Marche ou arrêt, volume et bouton de test, catégories de sons, « Seulement quand le terminal est derrière ».

##### Machines (`machines`)

La machine locale (WSL) et les serveurs SSH : « Ajouter une machine » (un alias `Host` de `~/.ssh/config`), Tester, Modifier, Retirer. Y renvoyer l'utilisateur pour suivre des agents sur un serveur.

##### Accès mobile (`mobile`)

Activer l'accès mobile, choisir le serveur relais, se connecter avec GitHub, voir l'état, gérer les appareils liés (« Comparer le code », « Révoquer »). « Taper dans les terminaux depuis le téléphone » (désactivé par défaut) permet à un téléphone de prendre la main sur le terminal d'un agent ; le terminal de la session affiche alors « Téléphone au clavier » avec « Reprendre la main ». Y renvoyer l'utilisateur pour lier un téléphone.

##### Projets (`projects`)

« Nouveau projet », modifier, supprimer ; « Dossiers mémorisés » (« Oublier ») ; « Laisser Ledge organiser » pour que Ledge propose des projets.

##### Notes (`notes`)

Les notes de l'utilisateur (`~/.ledge/context`) : chacune avec son titre, « quand la lire », sa portée (chat et sessions, chat seulement, sessions seulement), ses projets, sa date et le nombre de ses ajouts ; « ancienne » après 60 jours sans vérification ni modification, « À revoir » quand un signalement a été validé. « Ouvrir » affiche la note ; « Vérifiée aujourd'hui » met `checked` à la date du jour ; « Effacer le signalement » retire « À revoir » ; « Ouvrir le dossier » ouvre un terminal dans le dossier. Le texte d'une note se change dans son fichier.

##### Raccourcis clavier (`shortcuts`)

Les raccourcis valables partout dans Windows. Le raccourci qui rouvre la plus ancienne demande se change dans Réglages › Encoche.

##### À propos (`about`)

Les versions de Ledge Desktop et de chaque daemon, la dernière version publiée, « Mettre à jour ». La mise à jour met à jour les serveurs, puis le daemon WSL, puis l'application, sans couper les sessions. Ledge ne se met jamais à jour sans un clic.

### Le chat de Ledge, panneau de droite

Le bouton « Panneau de droite » de la barre de titre l'ouvre, à droite de tout ce qui est affiché. Il a deux onglets (les tâches ont leur propre vue, « Tâches »). « Nouvelle conversation » repart de zéro ; les conversations sont quotidiennes.

#### Conversation (`conversation`)

On y pose des questions à Ledge, on mentionne une session, on valide les cartes que Ledge propose. Survoler un agent nommé dans une réponse l'allume dans l'atelier.

Y renvoyer l'utilisateur pour une discussion avec Ledge.

#### Historique (`history`)

Les conversations du jour avec Ledge, chacune avec « Voir dans la conversation ».

### Fenêtres de dialogue

#### Palette (`search`)

S'ouvre par `Ctrl+K` ou le champ de la barre de titre. On y cherche une session ou un siège (`@`, archives comprises), une commande (`>` : nouvelle session, atelier, réglages, MR et PR, nouveau terminal, diviser, lancer un rig, vue Rig, section d'OpenRig, machine affichée, dispositions) ou un mot.

#### Raccourcis clavier (`shortcuts`)

S'ouvre par `?`. Liste complète des raccourcis.

#### Nouvelle session (`launch`)

S'ouvre par `N`, `Ctrl+Alt+N` partout dans Windows, le + d'un groupe, « Nouvelle session » d'un groupe vide, le menu d'un projet ou la palette. `Ctrl+Entrée` lance, Échap ferme.
- **Champs :** projet, où travailler (une nouvelle branche dans un worktree, ou le dossier du projet), agent (Claude Code, Codex, Cursor Agent, OMP, avec la limite d'usage de son compte), modèle, permissions, premier message, et où ouvrir la session (groupe actif, à droite).

Y renvoyer l'utilisateur pour lancer lui-même une session avec des réglages précis.

#### Projet (`project`)

Crée (« Nouveau projet »), modifie ou supprime un projet. On y donne son nom, sa couleur, sa description et ses dossiers. Un projet a au moins un dossier : la section « Dossiers du projet » montre ceux qui sont retenus, puis le navigateur pour en ajouter ; enregistrer sans dossier est bloqué, et le formulaire dit quoi faire. Un projet enregistré sans dossier avant cette règle est marqué « Aucun dossier : à compléter » dans Réglages › Projets, avec « Ajouter un dossier » ; on peut toujours le supprimer. On l'ouvre aussi pour ranger une session dans un nouveau projet, ou pour vérifier un projet que Ledge a proposé.

#### Écrire à plusieurs sessions (`broadcast`)

S'ouvre par « Écrire à tout le projet… » dans le menu d'un projet, ou par « Écrire aux N sessions… » une fois plusieurs sessions choisies dans la vue Projets avec `Ctrl`+clic (`Échap` vide la sélection).
- **Champ :** le message. « Envoyer » l'écrit à chaque session lancée par Ledge et vivante, sur chaque machine où le projet ou la sélection a des sessions ; chacune le reçoit dans sa file, à la fin de son tour.
- Le compte rendu dit à qui il a été remis et qui l'a refusé, avec la raison ; une machine hors ligne, trop ancienne ou muette y est nommée.
- Ces entrées n'apparaissent que si le daemon local connaît l'envoi groupé ; une machine distante plus ancienne ne reçoit rien et est dite « version trop ancienne ».

Y renvoyer l'utilisateur pour donner la même consigne à toutes les sessions d'un projet ou à quelques-unes d'un coup.

#### Lancer un rig (`rigLaunch`)

S'ouvre par « + Lancer » de la vue Rigs, sur la machine qu'elle affiche, par « Lancer un rig… » de la page OpenRig, ou par la palette. `Ctrl+Entrée` lance, `Échap` ferme.
- **Partir de :** un rig arrêté de la machine (relance, depuis son dernier snapshot ou à neuf), une spec de la bibliothèque, un rig vide (la spec `factory` avec un lead et un siège d'implémentation), ou « Composer avec l'operator » (le kernel doit tourner). Un rig en marche est grisé.
- **Champs :** nom, machine, dossier de travail, sièges par rôle, permissions (Spec, Auto, Standard, Ouvert, YOLO, Verrouillé) ; « Plus d'options » : harnais, modèle et permission par rôle, délégation, garder la spec, « Vérifier ». La commande `rig` exacte est affichée et suit les champs.
- « Lancer » ouvre la vue Rig du rig. Daemon arrêté : la fenêtre propose « Démarrer OpenRig ».
- **Avec l'operator :** un champ « Ce que tu veux » ; l'operator propose une équipe dans son fil, et rien ne démarre avant que l'utilisateur valide.

#### Signaler (`report`)

S'ouvre par le drapeau de la barre de titre (« Signaler un bug ou proposer une idée »). En haut, **Bug** ou **Idée**. Un bug : titre, ce qui s'est passé, ce qui était attendu, comment le reproduire (facultatif) ; une idée : titre, le besoin, le contexte, une proposition. « Joint au signalement » montre les versions de Ledge Desktop et du daemon, le système et l'outil de la session au premier plan ; chacun se retire d'un clic. Pour un bug, « Ajouter un extrait du journal du daemon » (décoché) montre les 50 dernières lignes telles qu'elles partiraient, relues pour retirer chemins personnels et jetons. Rien d'autre ne part. « Créer l'issue » (`Ctrl+Entrée`) la crée sur kl-ledge/ledge avec le `gh` connecté de la machine (label `bug` ou `enhancement`) ; un toast donne son numéro avec « Ouvrir ». Sans titre, rien ne part. `gh` absent ou refus de GitHub : « Ouvrir sur GitHub » ouvre la page préremplie, à valider là-bas. Ce qui est écrit est gardé jusqu'à l'envoi ou la fermeture de Ledge.

Un agent signale par `ledge report bug|feature "titre" "détail"` : rien n'est créé, une décision marquée « signalement » arrive dans la vue Tâches avec « Créer l'issue », « Modifier avant » (cette fenêtre, préremplie) et « Ignorer » ; l'agent apprend ce qu'il en est advenu.

Y renvoyer l'utilisateur pour lancer ou relancer une équipe OpenRig avec des réglages précis (par exemple trois développeurs et trois relecteurs), sur n'importe quelle machine.

## Ledge mobile

Une application web pour le téléphone et la tablette. Sur le téléphone, trois onglets fixes en bas : « Sessions », « MR/PR », « Rigs » ; l'en-tête porte le nom du PC (sa pastille, verte quand il répond, ambre « hors ligne » sinon, qui ouvre Réglages › Connexion) et la roue dentée des Réglages, avec un point corail tant que la passkey attend d'être mise à jour. Sur une tablette, ces onglets forment un rail à gauche, avec « Atelier » quand le PC le propose, puis « Réglages » en bas ; chaque onglet s'ouvre en deux volets, la liste à gauche et ce qu'elle ouvre à droite. L'application s'ouvre sur Sessions, comme toute adresse inconnue et les anciennes `#/atoi` et `#/chat`. Le badge de Sessions compte les autorisations en rouge, sinon les questions et les décisions en ambre ; celui de Rigs, les demandes OpenRig ouvertes. Quand le PC ou le relais ne répond plus, un bandeau le dit en tête de chaque onglet, avec « Réessayer », et le dernier état connu reste affiché, sans action possible. Pour la lier :
1. Sur le PC, dans Réglages › Accès mobile, activer l'accès, choisir le relais et se connecter avec GitHub.
2. Sur le téléphone, ouvrir l'adresse du relais et se connecter avec le même compte.
3. Comparer le code affiché sur les deux appareils et approuver sur le PC.

Le côté PC se fait aussi depuis `ledge tui` › Réglages › Accès mobile ; `L` ouvre « Lier un appareil » quand un téléphone demande à se lier.

Le relais peut être le tien : `ledge-relay launch` le lance sur ton serveur (voir `apps/relay/README.md`), et son adresse se saisit dans Réglages › Accès mobile.

### Sessions (`sessions`)

Les sessions groupées par projet, puis par rig OpenRig. Les filtres en haut : « Toutes », « En attente » et « Au travail », chacun avec son compte. Une ligne donne le point d'état de la session, son outil, son nom et ce qu'elle fait ; elle dit « Fermeture… » pendant qu'elle se ferme depuis ce téléphone. Une session dont une décision t'attend porte « Décision » en ambre. Toucher une ligne ouvre le fil de la session ; un appui long ouvre ses actions : « Ouvrir le fil », « Ouvrir le terminal », puis celles de « Plus d'actions ». Sur une tablette, la liste reste à gauche et le fil, ou une demande ouverte depuis sa notification, s'ouvre à droite ; une fois une demande décidée, la suivante s'ouvre, et au clavier Y autorise et N refuse.

Sur un téléphone, « Liste · Atelier » à côté du titre montre les agents en îlots : un îlot par projet puis par rig, ou, avec « Rigs », les rigs puis « Hors rig ». Chaque agent est un siège avec son point d'état ; ses sous-agents sont de petits sièges en pointillés, que l'œil masque (leur nombre revient alors sur l'agent, « +2 »). Toucher un siège ouvre le fil, un appui long ses actions. En bas, le bureau de Ledge dit sur combien d'agents il veille ; quand des demandes OpenRig attendent, il en donne le nombre et ouvre Rigs. Le téléphone garde ces choix.

### Routines (`routines`)

La ligne « Routines », en tête de Sessions, dit combien de routines le PC garde et quand part le prochain tir ; une pastille rouge compte celles qui attendent ton accord ou dont le dernier tir a échoué. Elle ouvre l'écran Routines (« Retour aux sessions ») : les routines en lecture seule, les récurrentes puis les uniques, chacune avec la session qu'elle réveille, ses heures et ses jours (« 1 semaine sur 2 » pour une routine toutes les deux semaines, « unique » pour une routine unique), son prochain tir et son dernier tir (« en retard » s'il est parti au réveil du PC, la raison s'il a échoué). « Lancer maintenant » (« Relancer » après un échec) et « Pause » / « Reprendre » agissent sur place. Les routines qui attendent ton accord sont en tête de l'écran : la demande d'activation montre sa consigne en entier ; « Activer » demande Face ID ou la vérification de l'appareil, « Refuser » non ; plusieurs routines uniques proposées ensemble se règlent d'un coup (« Activer les 3 » / « Refuser les 3 »), le tri une par une se fait sur le PC. Un tir qui n'a pas pu partir garde « Relancer » sur sa ligne. Créer ou modifier une routine se fait sur le PC, ou en le demandant à Ledge. Les sessions qu'une routine réveille portent une petite horloge dans la liste.

### Nouvelle session (`launch`)

« Nouvelle », en haut de Sessions, lance un agent sur le PC. Sur un téléphone, l'écran s'ouvre par-dessus les onglets. Il reprend les champs de Ledge Desktop :
- **Projet :** le projet et sa machine.
- **Où travailler :** les dossiers que le projet déclare sur ce PC. Un dossier absent ou d'une autre machine reste dans la liste, grisé, avec sa raison. Claude Code et OMP peuvent prendre plusieurs dossiers ; l'agent démarre dans le premier coché.
- **Agent** et **Modèle :** le modèle et l'effort. Pour OMP seulement, **Permissions** s'ajoute : Demander, Fichiers auto ou Auto.
- **Premier message :** avec trois idées pour commencer.

Le dernier choix d'agent, de modèle et d'effort est retenu pour chaque projet. Tant qu'il manque quelque chose, le bouton du bas dit quoi : la consigne, une machine en ligne, une version plus récente de Ledge sur le PC, ou des accords protégés sur cet appareil. Sinon, il lance avec Face ID ou la vérification de l'appareil. Un refus le dit au-dessus du bouton, avec le formulaire encore rempli. « Fermer » garde le brouillon. Une fois l'agent lancé, l'écran passe au fil de la nouvelle session.

### MR et PR (`prs`)

Toutes les MR GitLab et les PR GitHub de l'utilisateur (créées, assignées, à relire) et celles des branches des sessions et des sièges, lues sur le PC par `gh` et `glab`. En tête, une recherche et le filtre par rôle de Desktop ; chaque ligne porte ses rôles. Les ouvertes, le plus récent changement en haut, chacune avec le point de son pipeline, sa forge, son dépôt, son agent et son état, puis en mots « pipeline échoué », les discussions ouvertes, « prête à fusionner » ; les fusionnées et fermées des 7 derniers jours repliées en bas. Toucher une ligne ouvre la MR ou PR. Une forge que le PC ne lit pas a son bandeau au-dessus de la liste : `glab` ou `gh` absent, pas connecté (avec la commande à lancer et « Copier »), ou un relevé qui échoue depuis une heure donnée. Le badge rouge de l'onglet compte les pipelines échoués. Hors ligne, la dernière liste reste affichée, grisée, sans action. Un PC qui ne transmet pas encore ses MR et PR : l'onglet le dit.

### MR ou PR (`pr`)

Une MR ou PR ouverte depuis l'onglet MR/PR. En tête : son numéro et son titre, sa forge, son dépôt et ses branches, et « Ouvrir sur GitHub » ou « GitLab », qui l'ouvre dans le navigateur du téléphone. Quatre vues, en bande qui défile : Vue d'ensemble, Discussion, Modifications, Commits. La vue d'ensemble lit le pipeline de haut en bas, une étape par colonne, ses jobs avec leur durée ; le journal du job échoué s'ouvre sous le graphe (ses 60 dernières lignes), et toucher un autre job ouvre son journal dans une feuille. Un pipeline échoué propose « Relancer » (les jobs en échec, sous ton nom, après Face ID ou la vérification de l'appareil) et « Demander à <agent> de corriger », qui écrit à la session la plus active de la branche dans son fil, sans vérification ; « ▾ » choisit une autre session de la branche, et une ligne dit quand aucune n'y travaille. Puis « Pour fusionner » (ce qui manque, puis ce qui est acquis), la description, l'auteur, les relecteurs, les étiquettes et le ticket. Le pied dit les approbations et le premier manque, avec « Fusionner », actif seulement quand rien ne manque : la feuille dit la commande exacte que le PC lancera et la tête lue, puis demande Face ID (ou la vérification de l'appareil) ; si la branche a bougé d'ici là, rien n'est fusionné et le reçu propose « Relire ». Le reçu donne la commande lancée, ou le refus en mots. Fusionnée ou fermée, elle se lit sans bouton, le pied dit quand. La vue Discussion dit combien de fils sont ouverts et résolus, avec « Tout envoyer à <agent> » (les fils ouverts, à la session de la branche). Chaque fil ouvert montre son fichier, sa ligne et la ligne du diff, puis ses commentaires, avec « Répondre » (le champ s'ouvre dans le fil), « Envoyer à <agent> » et, pour un fil de revue, « Résoudre ». Les fils résolus sont repliés ; les toucher les déplie. En bas, « Ajouter un commentaire… ». Répondre, résoudre et publier écrivent sur la forge sous ton nom, après Face ID (ou la vérification de l'appareil) ; un texte non publié reste dans son champ, et le reçu le dit avec « Réessayer ». Un détail allégé par le PC, illisible, trop lourd, ou une MR ou PR qui n'est plus suivie, le disent en mots.

### Rigs (`rigs`)

OpenRig sur le PC. En tête, le bloc « Demandes » : ce que les rigs, Max et l'opérateur te demandent, les plus urgentes d'abord, chacune avec sa carte (qui la pose, la question, la recommandation en premier, « Répondre autrement… », « Vu », Face ID quand il le faut) ; « Replier » le replie, une nouvelle demande le rouvre. Puis le daemon (son état, sa version) et le kernel ; puis les rigs, ceux qui tournent d'abord, chacun avec sa pastille (en marche, démarrage, partiel, arrêté) et, en mots, les autorisations et les questions qui t'attendent. OpenRig arrêté : « Démarrer OpenRig », avec ses deux choix de démarrage. Aucun rig : « Parler à Max ». Un PC qui ne transmet pas encore ses rigs : l'onglet le dit, sous les demandes. Hors ligne, le dernier état connu reste affiché, grisé, sans action possible.

### Rig (`rig`)

Un rig : ses sièges, ses permissions et son dernier snapshot en tuiles, le siège qui attend (« Voir »), la topologie par pod (toucher un siège ouvre sa fiche : harnais, contexte, travail, liens, « Ouvrir sa session », « Réglages du siège »), puis la file OpenRig de ce rig (une ligne se déplie, en lecture seule ; les lignes closes sont repliées). En bas : « Sièges » (un siège de plus ou de moins par rôle), « Redémarrer », « Arrêter » ; un rig arrêté propose « Démarrer », depuis le dernier snapshot ou à neuf. « ⋯ » : prendre un snapshot, les snapshots, les permissions, « Actualiser ». Arrêter, redémarrer, retirer un siège, YOLO, « Spec » et un changement de harnais demandent Face ID (ou la vérification de l'appareil). Sur tablette, les actions passent dans l'en-tête du volet et la vue se met sur deux colonnes, avec « Sièges par rôle » et les snapshots ; toucher un siège ouvre sa session, un appui long ou un clic droit ouvre sa fiche (un siège dont Ledge ne suit pas la session ouvre sa fiche). Un bloc qui n'a pas pu être lu le dit à sa place, avec « Réessayer » ; un rig qui n'existe plus sur le PC le dit sur tout l'écran.

### Kernel (`kernel`)

Le rig d'OpenRig lui-même : sa topologie (Max, l'advisor, le queue worker), le dernier mot de Max et « Parler à Max », les rigs pilotés (leurs sièges et leur niveau de permissions), le routage de la file (les 20 derniers mouvements, tous les rigs, le plus récent en haut). Plus bas, « Redémarrer » et « Arrêter » le kernel, puis le daemon avec ses deux choix de démarrage gardés sur ce téléphone (« relancer les rigs qui tournaient », « Démarrer sans le kernel ») et ses propres « Redémarrer » et « Arrêter ». Ces arrêts et redémarrages demandent Face ID. « ⋯ » : « Actualiser », « Redémarrer le kernel », « Arrêter le kernel ». Sur tablette, l'objectif en cours de Max s'affiche en fil.

### Max (`max`)

Les objectifs donnés à Max, l'opérateur du kernel, le plus récent en haut, avec leur état ; le champ du bas en envoie un nouveau. Un objectif s'ouvre en fil : ton texte, sa trace, la proposition d'équipe ou la question de Max (qui se répondent dans les Demandes, en tête de Rigs ; « Voir la demande » l'ouvre), et le champ pour lui écrire sur cet objectif. Une demande qui n'est pas partie le dit, avec « Renvoyer » quand c'est sans risque ; le champ garde alors ton texte.

### Atelier (`atelier`)

Sur iPad seulement, avec un PC qui le propose : l'Atelier de Ledge Desktop, ses pièces par projet et par rig, ses agents et leurs sous-agents. Il s'ouvre lisible, une pièce entière à l'écran ; on fait glisser d'un doigt, on pince pour zoomer, « Ajuster » revient à la vue lisible, un double toucher cadre une pièce. Toucher un agent ouvre sa session dans un panneau par-dessus (« Plein écran » mène à son fil). Le nom d'une pièce ouvre ses agents et « Écrire au groupe ». Le bureau de Ledge donne le nombre de demandes OpenRig qui attendent, et les ouvre dans Rigs.

### Fil d'une session (`thread`)

Les échanges avec un agent et le champ pour lui écrire. Le fil s'ouvre en bas, sur le dernier échange. Si on l'a remonté, il ne bouge pas quand un message arrive ; une demande qui arrive est signalée par la pastille « Demande en bas ». Passer au terminal puis revenir au fil retrouve l'endroit où on en était.

- **L'en-tête** donne le nom de la session et son point d'état, plus l'heure de fin d'une session terminée. La bascule « Fil · Terminal » passe d'une vue à l'autre, et « Plus d'actions » ouvre la feuille des actions. Sur une tablette, l'en-tête donne aussi le projet et la branche.
- **Les outils** lancés d'affilée tiennent en une ligne, « 4 outils · Read, Write, Edit, Bash » ; un toucher la déplie, un outil par ligne (✓ fait, ● en cours, ✕ en échec).
- **La demande en attente** arrive au pied du fil : elle se décide sur place, avec « Toujours » quand l'agent le propose. Sur une tablette, au clavier, Y autorise et N refuse.
- **Une décision confiée à Ledge** (`ledge task give ledge`) ou une proposition de note prend la place du champ, une à la fois, la plus ancienne d'abord (« 1 sur 2 ») : la décision se répond par écrit, « Envoyer ma réponse » demande Face ID ou la vérification de l'appareil, puis « Réponse envoyée à … » ; la proposition garde Ajouter, Modifier, Refuser. Sans passkey, « Ouvrir les Réglages ». Une session terminée garde ce pied au-dessus de « Session terminée ». Sa notification ouvre ce fil.
- **Le pied** donne le modèle (un toucher ouvre « Modèle et effort » quand le téléphone peut le changer), le contexte utilisé en pour cent, ambre près de la limite, puis la branche, ou le dossier sans Git. Sur une tablette, il ajoute le contexte en tokens (« 620k / 1M »), le projet et la limite de l'outil (« Claude 5 h 84 % ») quand le PC les connaît.
- **« Plus d'actions »** regroupe « Modèle et effort », « Plan de travail » (quand l'agent en a un), « Interrompre », « Écrire au groupe » (aux sessions vivantes du même projet ou du même rig) et « Fermer », en rouge, qui demande la vérification de l'appareil. Une action qui ne se fait pas d'ici reste visible, grisée, et dit pourquoi.
- **Une session terminée** garde son fil lisible. À la place du champ, « Session terminée » et « Reprendre », qui relance l'agent sur cette conversation après la vérification de l'appareil. Une session fermée de force le dit : son dernier tour peut manquer.
- **Une session démarrée hors de Ledge** se lit seulement : le champ dit « Réponds dans le terminal ».

### Terminal (`terminal`)

Le terminal d'un agent, en direct et en couleurs, à la taille du PC, sous le même en-tête que le fil. Le bandeau donne le projet, l'état (« Lecture seule · en direct », « Au clavier ») et la taille du PC. « Affichage », dans « Plus d'actions », passe de « Lisible » (suit le curseur) à « Ajusté » (toute la largeur) ; on pince pour zoomer. « Interrompre » est dans « Plus d'actions ». « Prendre la main » (passkey de l'appareil, et le réglage « Taper dans les terminaux depuis le téléphone » activé sur le PC) ouvre le clavier avec une rangée de touches : Échap, Tab, Ctrl et Alt collants, flèches, ↵, ^C, Coller et « Ligne » pour la dictée, que « Taper ↵ » envoie. Quand une autorisation attend et que l'écran montre son choix numéroté, des touches en ambre (« 1 Oui », « 2 Toujours », « 3 Non ») tapent son chiffre. La main est rendue après 5 minutes sans frappe, au bout de 30 minutes, ou dès que l'appli passe en arrière-plan ; la dernière minute est décomptée dans le bandeau. Sans ce réglage, le terminal reste en lecture seule.

### Demande (`request`)

Une demande seule : autorisation, question, plan ou modifications. On l'approuve, la refuse ou y répond. Les notifications et les liens partagés ouvrent cet écran.

### Demande d'un rig (`ask`)

Une demande OpenRig en entier, ouverte depuis sa notification ou une ligne des Demandes sur tablette (« Retour » mène à Rigs) : qui la pose, son texte complet, sa source et « Détails », puis la réponse (une option, « Répondre autrement… », « Répondre… » pour une ligne en attente de toi, ou « Vu » pour une nouvelle). Toute réponse sauf « Vu » se confirme avec Face ID ou le code de l'appareil ; sans accords protégés sur cet appareil, on y répond sur le PC.

### Réglages (`connection`)

S'ouvre depuis la roue dentée en en-tête (par-dessus l'onglet courant, qui reste allumé), ou depuis « Réglages » en bas du rail sur tablette. Dans l'ordre :
- **Mettre à jour ta passkey :** en tête tant que la passkey de l'appareil date d'avant la reconnexion sans code ; « Plus tard » la retire pour de bon sur cet appareil, la ligne de Connexion la garde.
- **Cet appareil :** son nom (« Renommer »).
- **Apparence :** le thème, la langue (Français ou English ; français par défaut, appliquée tout de suite) et « Réduire les animations », propres à cet appareil.
- **Notifications sur cet appareil :** l'interrupteur principal ; une fois activées, « Décision à prendre » se coupe, et « Pause » (1 h, 4 h, jusqu'à demain 8 h) les suspend toutes. Les demandes d'accord et les questions préviennent toujours, sauf pendant une pause.
- **Usage :** ouvre Réglages › Usage, les limites de chaque outil (5 h et semaine, le mois pour Cursor), l'alerte du moment en tête ; un point ambre sur la ligne tant qu'une alerte est active.
- **Ledge :** « Contexte max » (le seuil partagé avec le PC, comme Réglages › Général sur le desktop) et « Agent du chat » (l'agent qui répond aux questions posées depuis cet appareil ; « PC » : le même que le chat du PC).
- **Projets :** la liste dans son ordre, chaque projet avec sa couleur et ses agents. Monter ou descendre un projet, « Modifier » (nom, couleur), « Nouveau projet » (avec son premier dossier : un récent du PC ou « Parcourir… », confirmé par la passkey), et « Supprimer le projet… » avec la passkey de l'appareil : ses agents, ses dossiers et ses règles vont sans projet ou vers un autre projet. « Dossiers… » liste les dossiers du projet (« Retirer », sauf pour le dernier : un projet garde au moins un dossier) ; « Ajouter un dossier » parcourt les dossiers du PC, ses dossiers récents en tête, et ajoute celui affiché avec la passkey de l'appareil. Les dossiers d'un serveur et les règles de rangement se règlent sur le desktop.
- **Le PC :** met à jour ou redémarre le daemon du PC.
- **Connexion :** le compte, le serveur, le PC, les empreintes, les versions, et « Protéger les accords ».
- **Réglés sur le PC :** en lecture seule. L'accès mobile, les appareils liés, « Taper dans les terminaux », les machines et les règles de rangement ne se changent que dans Ledge Desktop › Réglages : un appareil ne peut pas élargir ses propres droits.

On peut aussi s'y déconnecter.

### Écrans qui s'affichent d'eux-mêmes

Ces écrans ne sont pas des adresses : l'application les montre d'elle-même, selon l'état de la liaison avec le PC.
- **Connexion GitHub :** quand le téléphone n'est pas lié, « Continuer avec GitHub », puis la comparaison du code avec le PC.
- **Clé changée :** si la clé du PC a changé, « Refaire la liaison » ou « Se déconnecter ».
- **Nouvelle version :** quand une nouvelle version de l'application mobile est prête, « Mettre à jour » ou « Plus tard ».

## Où renvoyer l'utilisateur

| Il veut… | Écran |
|---|---|
| répondre à un agent, voir ses modifications | Session et Modifications (desktop), Demande ou Fil (mobile) |
| voir ce qui l'attend | les badges de la barre d'activité : Projets (sessions), Rigs (demandes d'OpenRig), Tâches (décisions) (desktop) ; les badges des onglets Sessions et Rigs (mobile) ; `tab` dans `ledge tui` |
| lancer une session lui-même | Nouvelle session (`N`, `Ctrl+Alt+N`) |
| créer, modifier ou supprimer un projet, lui ajouter un dossier | Réglages › Projets (desktop ou mobile), ou le menu d'un projet dans la vue Projets ; les dossiers d'un serveur sur le desktop |
| choisir les notifications d'un téléphone, les mettre en pause | Réglages (mobile) › Notifications sur cet appareil |
| renommer, archiver, supprimer une session, passer le relais | Session › « Gérer la session », ou `ledge rename`, `ledge archive`, `ledge delete` |
| trancher une décision, suivre une tâche | la vue Tâches (`Ctrl+/`) (desktop), le fil de la session (mobile), l'écran Session et `D` (`ledge tui`), `ledge decide` |
| suivre une MR ou une PR, la faire corriger, la fusionner | vue et onglet MR et PR |
| démarrer, arrêter, lancer ou régler un rig OpenRig | vue Rigs, vue Rig, page OpenRig, Lancer un rig |
| ajouter un serveur | Réglages › Machines |
| lier un téléphone | Réglages › Accès mobile |
| changer l'agent proposé au lancement | Réglages › Général › Agent par défaut |
| régler l'encoche, les notifications, les sons | Réglages › Encoche, Notifications, Sons |
| mettre Ledge à jour | Réglages › À propos |
| programmer une consigne à heures fixes dans une session | `ledge routine add` (voir « Les routines ») |
| donner du contexte durable à Ledge | une note dans `~/.ledge/context/` (une session peut la proposer : `ledge brain propose`) |
| voir et vérifier ses notes | Réglages › Notes |
