# Plusieurs machines dans Ledge

Design validé : une liste par projet, provenance discrète dans les sessions, sessions d'une machine masquées tant qu'elle est déconnectée. Le formulaire de lancement choisit la machine avant le dossier. (Le chat commun et son routage entre machines ont été retirés avec le chat, #40.)

## Architecture

- L'overlay possède une connexion par machine, des identités de session qualifiées et un inventaire distinct par connexion.
- Le daemon reste lié au loopback. Chaque connexion distante passe par le daemon local, qui exécute la commande applicative `ledge bridge` via SSH et échange uniquement des messages Ledge sur stdin/stdout. Il ne transfère aucun port TCP.
- Les lectures de documents et les commandes de session conservent leur machine d'origine. Un serveur indisponible ne déclenche jamais un repli silencieux vers le local.
- Les dépôts sont regroupés par origine Git normalisée quand elle existe ; sans origine commune prouvée, les chemins restent propres à chaque machine.
- La mise à jour automatique existante vise uniquement le daemon local. Les daemons distants se mettent à jour séparément.

## Connexion distante

Installer Node 22+, tmux et une version de Ledge avec `ledge bridge` sous le compte utilisateur du serveur, puis exécuter `ledge setup`. Le daemon local doit également disposer du transport SSH. Depuis le WSL utilisé par Ledge, vérifier une première fois l'accès et approuver la clé du serveur :

```sh
ssh dev-server 'bash -lc "command -v ledge"'
```

Dans **Réglages → Affichage → Machines → Ajouter une machine**, renseigner un nom et l'alias SSH. Répéter pour chaque serveur. Aucun nom de serveur n'est imposé, aucun mot de passe ou clé privée n'est stocké par le front. L'alias est résolu par la configuration SSH du compte WSL qui exécute le daemon local (identité et ProxyCommand inclus). L'accès doit fonctionner sans interaction : `BatchMode=yes` et `StrictHostKeyChecking=yes` sont imposés. Une erreur de connexion est affichée dans les réglages.

La liste des machines vit dans `~/.ledge/machines.json`, tenue par le daemon local et partagée par toutes les fenêtres Ledge ; la liste gardée par l'île dans le navigateur est remise au daemon au premier message `machines`, et seulement si la liste du daemon se réduit à `local` ; sinon, la liste du daemon l'emporte. Avec un daemon plus ancien que cette version, l'île garde sa propre liste dans le navigateur.

Une machine distante peut être **désactivée** sans être retirée (bouton « Désactiver » dans Réglages → Machines ; `"disabled": true` dans `machines.json`). Elle reste listée dans les réglages, mais Ledge ne s'y connecte plus : pas de tentative de reconnexion, pas de sessions affichées, absente des choix de lancement et du chat. « Activer » la reconnecte. La machine locale ne peut pas être désactivée.

`AllowTcpForwarding no` peut rester inchangé : le transport utilise une commande SSH distante autorisée, pas `ssh -L`/`-R`. Le daemon n'écoute jamais sur une interface publique.

L'overlay ouvre `/ssh/<alias>` sur le même WebSocket loopback que son daemon local. Les vérifications d'origine s'appliquent aussi à cet accès ; l'alias est validé, la commande distante est fixe, les trames sont validées et bornées. Les connexions distantes ne reçoivent jamais les broadcasts locaux. Une fermeture du front termine le processus SSH ; la reconnexion ne renvoie aucune commande en attente.

Maquette autonome, archivée avec le chat : `docs/archive/mockups/ledge-multi-machine-chat.html`. Les chemins affichés sont illustratifs.

## Vérification prévue

Connexions simultanées avec IDs identiques, déconnexion/reconnexion isolée, commandes envoyées à une seule machine, absence de repli implicite, séparation des dossiers et documents, puis contrôles de typage, tests et build.
