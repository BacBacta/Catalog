# Cases où la personne n'a RIEN reçu

Produit par `harnais-balayage.test.ts`. **Ce fichier ne s'écrit pas à la main.**

`silence` est exclu : aucun message n'est parti, donc aucune réponse n'est due.
La question qu'il pose — une relance existe-t-elle ? — est ailleurs.

| Étape | Geste | Détail | Étape après |
|---|---|---|---|
| aucun_prospect | double_envoi | relivraison du même message | inscription_nom |
| inscription_nom | double_envoi | relivraison du même message | inscription_ville |
| inscription_ville | double_envoi | relivraison du même message | inscription_confirme |
| inscription_confirme | double_envoi | relivraison du même message | inscription_confirme |
| aucun_vendeuse | double_envoi | relivraison du même message | aucun_vendeuse |
| article_nom | double_envoi | relivraison du même message | article_prix |
| article_prix | double_envoi | relivraison du même message | article_photo |
| article_photo | double_envoi | relivraison du même message | article_photo |
| article_confirme | double_envoi | relivraison du même message | article_confirme |
| comptoir:article | double_envoi | relivraison du même message | comptoir:prix |
| comptoir:prix | double_envoi | relivraison du même message | comptoir:cliente |
| comptoir:cliente | double_envoi | relivraison du même message | comptoir:remise |
| comptoir:remise | double_envoi | relivraison du même message | comptoir:recap |
| comptoir:recap | double_envoi | relivraison du même message | aucun_vendeuse |
| accueil | double_envoi | relivraison du même message | accueil |
| catalogue | double_envoi | relivraison du même message | catalogue |
| quantite | double_envoi | relivraison du même message | ajout |
| ajout | double_envoi | relivraison du même message | ajout |
| mode | double_envoi | relivraison du même message | ville |
| ville | double_envoi | relivraison du même message | details |
| ville_doute | double_envoi | relivraison du même message | details |
| details | double_envoi | relivraison du même message | recap |
| recap | double_envoi | relivraison du même message | catalogue |
| avis_mot | double_envoi | relivraison du même message | accueil |
