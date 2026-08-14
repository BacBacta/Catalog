# Ce que chaque geste a reçu, case par case

Produit par `harnais-balayage.test.ts`. **Ce fichier ne s'écrit pas à la main.**

| Étape | Geste | Étape après | Première réponse |
|---|---|---|---|
| aucun_prospect | texte_juste | inscription_nom | Bienvenue ! Ouvrons votre boutique — ça prend deux minutes, ici même. |
| aucun_prospect | texte_faute | accueil | Je suis Catalog. Ici, un vendeur/se ouvre sa boutique en deux minutes ; un acheteur/se suit sa commande et vér |
| aucun_prospect | texte_sans_accents | accueil | Je suis Catalog. Ici, un vendeur/se ouvre sa boutique en deux minutes ; un acheteur/se suit sa commande et vér |
| aucun_prospect | anglais | accueil | I am Catalog. Here, a seller opens her shop in two minutes, and a buyer tracks her order and checks her receip |
| aucun_prospect | pidgin | accueil | Je suis Catalog. Ici, un vendeur/se ouvre sa boutique en deux minutes ; un acheteur/se suit sa commande et vér |
| aucun_prospect | bouton_attendu | inscription_nom | Bienvenue ! Ouvrons votre boutique — ça prend deux minutes, ici même. |
| aucun_prospect | bouton_ancien | accueil | Je suis Catalog. Ici, un vendeur/se ouvre sa boutique en deux minutes ; un acheteur/se suit sa commande et vér |
| aucun_prospect | ligne_liste | accueil | Je suis Catalog. Ici, un vendeur/se ouvre sa boutique en deux minutes ; un acheteur/se suit sa commande et vér |
| aucun_prospect | flux_valide | accueil | Je suis Catalog. Ici, un vendeur/se ouvre sa boutique en deux minutes ; un acheteur/se suit sa commande et vér |
| aucun_prospect | flux_tronque | accueil | Je suis Catalog. Ici, un vendeur/se ouvre sa boutique en deux minutes ; un acheteur/se suit sa commande et vér |
| aucun_prospect | photo | accueil | Je suis Catalog. Ici, un vendeur/se ouvre sa boutique en deux minutes ; un acheteur/se suit sa commande et vér |
| aucun_prospect | photo_legendee | accueil | Je suis Catalog. Ici, un vendeur/se ouvre sa boutique en deux minutes ; un acheteur/se suit sa commande et vér |
| aucun_prospect | vocal | accueil | Je ne sais pas encore écouter les notes vocales. Écrivez-moi en quelques mots — ou envoyez la photo, avec « no |
| aucun_prospect | sticker | accueil | Joli. Mais je ne sais lire que le texte, les photos et les boutons. |
| aucun_prospect | document | accueil | Je ne sais pas encore ouvrir les documents. Écrivez-moi ce qu'il contient, en quelques mots. |
| aucun_prospect | localisation | accueil | Je suis Catalog. Ici, un vendeur/se ouvre sa boutique en deux minutes ; un acheteur/se suit sa commande et vér |
| aucun_prospect | hors_sujet | accueil | Je suis Catalog. Ici, un vendeur/se ouvre sa boutique en deux minutes ; un acheteur/se suit sa commande et vér |
| aucun_prospect | silence | aucun_prospect | **— MUET —** |
| aucun_prospect | double_envoi | inscription_nom | **— MUET —** |
| aucun_prospect | retour_arriere | accueil | Je suis Catalog. Ici, un vendeur/se ouvre sa boutique en deux minutes ; un acheteur/se suit sa commande et vér |
| aucun_prospect | abandon | accueil | Je suis Catalog. Ici, un vendeur/se ouvre sa boutique en deux minutes ; un acheteur/se suit sa commande et vér |
| aucun_prospect | reprise_25h | accueil | Je suis Catalog. Ici, un vendeur/se ouvre sa boutique en deux minutes ; un acheteur/se suit sa commande et vér |
| inscription_nom | texte_juste | inscription_ville | *Chez Mireille* — c'est noté. |
| inscription_nom | texte_faute | inscription_ville | *Chez Mireile* — c'est noté. |
| inscription_nom | texte_sans_accents | inscription_ville | *Chez Mireille Douala* — c'est noté. |
| inscription_nom | anglais | inscription_ville | *Mireille Shop* — c'est noté. |
| inscription_nom | pidgin | inscription_ville | *Mireille shop for Douala* — c'est noté. |
| inscription_nom | bouton_attendu | inscription_nom | Il me faut le nom de votre boutique, en quelques mots. |
| inscription_nom | bouton_ancien | inscription_nom | Il me faut le nom de votre boutique, en quelques mots. |
| inscription_nom | ligne_liste | inscription_nom | Il me faut le nom de votre boutique, en quelques mots. |
| inscription_nom | flux_valide | article_nom | ✅ *Chez Mireille* est ouverte. |
| inscription_nom | flux_tronque | inscription_nom | Le formulaire n'a pas pu être lu. Reprenons ici, c'est aussi rapide. |
| inscription_nom | photo | inscription_nom | Il me faut le nom de votre boutique, en quelques mots. |
| inscription_nom | photo_legendee | inscription_nom | Il me faut le nom de votre boutique, en quelques mots. |
| inscription_nom | vocal | inscription_nom | Je ne sais pas encore écouter les notes vocales. Écrivez-moi en quelques mots — ou envoyez la photo, avec « no |
| inscription_nom | sticker | inscription_nom | Joli. Mais je ne sais lire que le texte, les photos et les boutons. |
| inscription_nom | document | inscription_nom | Je ne sais pas encore ouvrir les documents. Écrivez-moi ce qu'il contient, en quelques mots. |
| inscription_nom | localisation | inscription_nom | Merci — je ne sais pas encore me servir d'une position partagée. Écrivez-moi votre quartier et un repère (« en |
| inscription_nom | hors_sujet | inscription_ville | *est-ce que vous vendez des chaussures pour bébé ?* — c'est noté. |
| inscription_nom | silence | inscription_nom | **— MUET —** |
| inscription_nom | double_envoi | inscription_ville | **— MUET —** |
| inscription_nom | retour_arriere | accueil | C'est annulé. |
| inscription_nom | abandon | accueil | C'est annulé. |
| inscription_nom | reprise_25h | accueil | Je suis Catalog. Ici, un vendeur/se ouvre sa boutique en deux minutes ; un acheteur/se suit sa commande et vér |
| inscription_ville | texte_juste | inscription_confirme | J'ai lu : *Chez Mireille*, à *Douala*. |
| inscription_ville | texte_faute | inscription_confirme | J'ai lu : *Chez Mireille*, à *Douala*. |
| inscription_ville | texte_sans_accents | inscription_confirme | J'ai lu : *Chez Mireille*, à *douala*. |
| inscription_ville | anglais | inscription_confirme | J'ai lu : *Chez Mireille*, à *Douala*. |
| inscription_ville | pidgin | inscription_confirme | J'ai lu : *Chez Mireille*, à *na Douala*. |
| inscription_ville | bouton_attendu | inscription_ville | Dites-moi la ville où vous vendez. |
| inscription_ville | bouton_ancien | inscription_ville | Dites-moi la ville où vous vendez. |
| inscription_ville | ligne_liste | inscription_ville | Dites-moi la ville où vous vendez. |
| inscription_ville | flux_valide | article_nom | ✅ *Chez Mireille* est ouverte. |
| inscription_ville | flux_tronque | inscription_ville | Le formulaire n'a pas pu être lu. Reprenons ici, c'est aussi rapide. |
| inscription_ville | photo | inscription_ville | Dites-moi la ville où vous vendez. |
| inscription_ville | photo_legendee | inscription_ville | Dites-moi la ville où vous vendez. |
| inscription_ville | vocal | inscription_ville | Je ne sais pas encore écouter les notes vocales. Écrivez-moi en quelques mots — ou envoyez la photo, avec « no |
| inscription_ville | sticker | inscription_ville | Joli. Mais je ne sais lire que le texte, les photos et les boutons. |
| inscription_ville | document | inscription_ville | Je ne sais pas encore ouvrir les documents. Écrivez-moi ce qu'il contient, en quelques mots. |
| inscription_ville | localisation | inscription_ville | Merci — je ne sais pas encore me servir d'une position partagée. Écrivez-moi votre quartier et un repère (« en |
| inscription_ville | hors_sujet | inscription_confirme | J'ai lu : *Chez Mireille*, à *est-ce que vous vendez des chaussures pour bébé ?*. |
| inscription_ville | silence | inscription_ville | **— MUET —** |
| inscription_ville | double_envoi | inscription_confirme | **— MUET —** |
| inscription_ville | retour_arriere | accueil | C'est annulé. |
| inscription_ville | abandon | accueil | C'est annulé. |
| inscription_ville | reprise_25h | accueil | Je suis Catalog. Ici, un vendeur/se ouvre sa boutique en deux minutes ; un acheteur/se suit sa commande et vér |
| inscription_confirme | texte_juste | inscription_confirme | J'ai lu : *Chez Mireille*, à *Douala*. |
| inscription_confirme | texte_faute | inscription_confirme | J'ai lu : *Chez Mireille*, à *Douala*. |
| inscription_confirme | texte_sans_accents | inscription_confirme | J'ai lu : *Chez Mireille*, à *Douala*. |
| inscription_confirme | anglais | inscription_confirme | J'ai lu : *Chez Mireille*, à *Douala*. |
| inscription_confirme | pidgin | inscription_confirme | J'ai lu : *Chez Mireille*, à *Douala*. |
| inscription_confirme | bouton_attendu | aucun_vendeuse | ✅ *Chez Mireille* est ouverte. |
| inscription_confirme | bouton_ancien | inscription_confirme | J'ai lu : *Chez Mireille*, à *Douala*. |
| inscription_confirme | ligne_liste | inscription_confirme | J'ai lu : *Chez Mireille*, à *Douala*. |
| inscription_confirme | flux_valide | inscription_confirme | Je ne sais pas encore lire ce type de message. Écrivez-moi, ou appuyez sur un bouton. |
| inscription_confirme | flux_tronque | inscription_confirme | Je ne sais pas encore lire ce type de message. Écrivez-moi, ou appuyez sur un bouton. |
| inscription_confirme | photo | inscription_confirme | J'ai lu : *Chez Mireille*, à *Douala*. |
| inscription_confirme | photo_legendee | inscription_confirme | J'ai lu : *Chez Mireille*, à *Douala*. |
| inscription_confirme | vocal | inscription_confirme | Je ne sais pas encore écouter les notes vocales. Écrivez-moi en quelques mots — ou envoyez la photo, avec « no |
| inscription_confirme | sticker | inscription_confirme | Joli. Mais je ne sais lire que le texte, les photos et les boutons. |
| inscription_confirme | document | inscription_confirme | Je ne sais pas encore ouvrir les documents. Écrivez-moi ce qu'il contient, en quelques mots. |
| inscription_confirme | localisation | inscription_confirme | Merci — je ne sais pas encore me servir d'une position partagée. Écrivez-moi votre quartier et un repère (« en |
| inscription_confirme | hors_sujet | inscription_confirme | J'ai lu : *Chez Mireille*, à *Douala*. |
| inscription_confirme | silence | inscription_confirme | **— MUET —** |
| inscription_confirme | double_envoi | inscription_confirme | **— MUET —** |
| inscription_confirme | retour_arriere | inscription_confirme | J'ai lu : *Chez Mireille*, à *Douala*. |
| inscription_confirme | abandon | accueil | C'est annulé. |
| inscription_confirme | reprise_25h | accueil | Je suis Catalog. Ici, un vendeur/se ouvre sa boutique en deux minutes ; un acheteur/se suit sa commande et vér |
| aucun_vendeuse | texte_juste | aucun_vendeuse | *‹boutique›* |
| aucun_vendeuse | texte_faute | aucun_vendeuse | *‹boutique›* |
| aucun_vendeuse | texte_sans_accents | aucun_vendeuse | *‹boutique›* |
| aucun_vendeuse | anglais | aucun_vendeuse | *‹boutique›* |
| aucun_vendeuse | pidgin | aucun_vendeuse | *‹boutique›* |
| aucun_vendeuse | bouton_attendu | article_nom | *Quel est le nom de l'article ?* |
| aucun_vendeuse | bouton_ancien | aucun_vendeuse | *‹boutique›* |
| aucun_vendeuse | ligne_liste | aucun_vendeuse | *‹boutique›* |
| aucun_vendeuse | flux_valide | aucun_vendeuse | ✅ *Chemise* — 9 000 FCFA est dans votre catalogue. |
| aucun_vendeuse | flux_tronque | article_nom | Le formulaire n'a pas pu être lu. Reprenons ici, c'est aussi rapide. |
| aucun_vendeuse | photo | article_nom | *Quel est le nom de l'article ?* |
| aucun_vendeuse | photo_legendee | article_confirme | (reaction) |
| aucun_vendeuse | vocal | aucun_vendeuse | Je ne sais pas encore écouter les notes vocales. Écrivez-moi en quelques mots — ou envoyez la photo, avec « no |
| aucun_vendeuse | sticker | aucun_vendeuse | Joli. Mais je ne sais lire que le texte, les photos et les boutons. |
| aucun_vendeuse | document | aucun_vendeuse | Je ne sais pas encore ouvrir les documents. Écrivez-moi ce qu'il contient, en quelques mots. |
| aucun_vendeuse | localisation | aucun_vendeuse | Merci — je ne sais pas encore me servir d'une position partagée. Écrivez-moi votre quartier et un repère (« en |
| aucun_vendeuse | hors_sujet | aucun_vendeuse | *‹boutique›* |
| aucun_vendeuse | silence | aucun_vendeuse | **— MUET —** |
| aucun_vendeuse | double_envoi | aucun_vendeuse | **— MUET —** |
| aucun_vendeuse | retour_arriere | aucun_vendeuse | *‹boutique›* |
| aucun_vendeuse | abandon | aucun_vendeuse | *‹boutique›* |
| aucun_vendeuse | reprise_25h | aucun_vendeuse | *‹boutique›* |
| article_nom | texte_juste | article_prix | *Robe wax grande taille* — son prix, en francs ? |
| article_nom | texte_faute | article_prix | *Robe wacks grande taile* — son prix, en francs ? |
| article_nom | texte_sans_accents | article_prix | *Robe wax grande taille* — son prix, en francs ? |
| article_nom | anglais | article_prix | *Wax dress* — son prix, en francs ? |
| article_nom | pidgin | article_prix | *Fine wax dress* — son prix, en francs ? |
| article_nom | bouton_attendu | article_nom | *Quel est le nom de l'article ?* |
| article_nom | bouton_ancien | article_nom | *Quel est le nom de l'article ?* |
| article_nom | ligne_liste | article_nom | *Quel est le nom de l'article ?* |
| article_nom | flux_valide | aucun_vendeuse | ✅ *Chemise* — 9 000 FCFA est dans votre catalogue. |
| article_nom | flux_tronque | article_nom | Le formulaire n'a pas pu être lu. Reprenons ici, c'est aussi rapide. |
| article_nom | photo | article_nom | *Quel est le nom de l'article ?* |
| article_nom | photo_legendee | article_confirme | (reaction) |
| article_nom | vocal | article_nom | Je ne sais pas encore écouter les notes vocales. Écrivez-moi en quelques mots — ou envoyez la photo, avec « no |
| article_nom | sticker | article_nom | Joli. Mais je ne sais lire que le texte, les photos et les boutons. |
| article_nom | document | article_nom | Je ne sais pas encore ouvrir les documents. Écrivez-moi ce qu'il contient, en quelques mots. |
| article_nom | localisation | article_nom | Merci — je ne sais pas encore me servir d'une position partagée. Écrivez-moi votre quartier et un repère (« en |
| article_nom | hors_sujet | article_prix | *est-ce que vous vendez des chaussures pour bébé ?* — son prix, en francs ? |
| article_nom | silence | article_nom | **— MUET —** |
| article_nom | double_envoi | article_prix | **— MUET —** |
| article_nom | retour_arriere | aucun_vendeuse | C'est annulé. |
| article_nom | abandon | aucun_vendeuse | C'est annulé. |
| article_nom | reprise_25h | aucun_vendeuse | *‹boutique›* |
| article_prix | texte_juste | article_photo | Robe wax — 12 500 FCFA. |
| article_prix | texte_faute | article_photo | Robe wax — 12 500 FCFA. |
| article_prix | texte_sans_accents | article_photo | Robe wax — 12 500 FCFA. |
| article_prix | anglais | article_photo | Robe wax — 12 500 FCFA. |
| article_prix | pidgin | article_photo | Robe wax — 12 500 FCFA. |
| article_prix | bouton_attendu | article_prix | Je n'ai pas compris le prix. Écrivez-le en chiffres, sans virgule. |
| article_prix | bouton_ancien | article_prix | Je n'ai pas compris le prix. Écrivez-le en chiffres, sans virgule. |
| article_prix | ligne_liste | article_prix | Je n'ai pas compris le prix. Écrivez-le en chiffres, sans virgule. |
| article_prix | flux_valide | aucun_vendeuse | ✅ *Chemise* — 9 000 FCFA est dans votre catalogue. |
| article_prix | flux_tronque | article_nom | Le formulaire n'a pas pu être lu. Reprenons ici, c'est aussi rapide. |
| article_prix | photo | article_prix | Je n'ai pas compris le prix. Écrivez-le en chiffres, sans virgule. |
| article_prix | photo_legendee | article_prix | Je n'ai pas compris le prix. Écrivez-le en chiffres, sans virgule. |
| article_prix | vocal | article_prix | Je ne sais pas encore écouter les notes vocales. Écrivez-moi en quelques mots — ou envoyez la photo, avec « no |
| article_prix | sticker | article_prix | Joli. Mais je ne sais lire que le texte, les photos et les boutons. |
| article_prix | document | article_prix | Je ne sais pas encore ouvrir les documents. Écrivez-moi ce qu'il contient, en quelques mots. |
| article_prix | localisation | article_prix | Merci — je ne sais pas encore me servir d'une position partagée. Écrivez-moi votre quartier et un repère (« en |
| article_prix | hors_sujet | article_prix | Je n'ai pas compris le prix. Écrivez-le en chiffres, sans virgule. |
| article_prix | silence | article_prix | **— MUET —** |
| article_prix | double_envoi | article_photo | **— MUET —** |
| article_prix | retour_arriere | aucun_vendeuse | C'est annulé. |
| article_prix | abandon | aucun_vendeuse | C'est annulé. |
| article_prix | reprise_25h | aucun_vendeuse | *‹boutique›* |
| article_photo | texte_juste | article_photo | J'attends la photo — envoyez-la comme une image, depuis l'appareil photo ou la galerie. |
| article_photo | texte_faute | article_photo | J'attends la photo — envoyez-la comme une image, depuis l'appareil photo ou la galerie. |
| article_photo | texte_sans_accents | article_photo | J'attends la photo — envoyez-la comme une image, depuis l'appareil photo ou la galerie. |
| article_photo | anglais | article_photo | J'attends la photo — envoyez-la comme une image, depuis l'appareil photo ou la galerie. |
| article_photo | pidgin | article_photo | J'attends la photo — envoyez-la comme une image, depuis l'appareil photo ou la galerie. |
| article_photo | bouton_attendu | aucun_vendeuse | ✅ *Robe wax* — 12 500 FCFA est dans votre catalogue. |
| article_photo | bouton_ancien | article_photo | J'attends la photo — envoyez-la comme une image, depuis l'appareil photo ou la galerie. |
| article_photo | ligne_liste | article_photo | J'attends la photo — envoyez-la comme une image, depuis l'appareil photo ou la galerie. |
| article_photo | flux_valide | aucun_vendeuse | ✅ *Chemise* — 9 000 FCFA est dans votre catalogue. |
| article_photo | flux_tronque | article_nom | Le formulaire n'a pas pu être lu. Reprenons ici, c'est aussi rapide. |
| article_photo | photo | aucun_vendeuse | ✅ *Robe wax* — 12 500 FCFA est dans votre catalogue. |
| article_photo | photo_legendee | aucun_vendeuse | ✅ *Robe wax* — 12 500 FCFA est dans votre catalogue. |
| article_photo | vocal | article_photo | Je ne sais pas encore écouter les notes vocales. Écrivez-moi en quelques mots — ou envoyez la photo, avec « no |
| article_photo | sticker | article_photo | Joli. Mais je ne sais lire que le texte, les photos et les boutons. |
| article_photo | document | article_photo | Je ne sais pas encore ouvrir les documents. Écrivez-moi ce qu'il contient, en quelques mots. |
| article_photo | localisation | article_photo | Merci — je ne sais pas encore me servir d'une position partagée. Écrivez-moi votre quartier et un repère (« en |
| article_photo | hors_sujet | article_photo | J'attends la photo — envoyez-la comme une image, depuis l'appareil photo ou la galerie. |
| article_photo | silence | article_photo | **— MUET —** |
| article_photo | double_envoi | article_photo | **— MUET —** |
| article_photo | retour_arriere | aucun_vendeuse | C'est annulé. |
| article_photo | abandon | aucun_vendeuse | C'est annulé. |
| article_photo | reprise_25h | aucun_vendeuse | *‹boutique›* |
| article_confirme | texte_juste | article_confirme | J'ai lu : *Robe wax* — *12 500 FCFA*. C'est bon ? |
| article_confirme | texte_faute | article_confirme | J'ai lu : *Robe wax* — *12 500 FCFA*. C'est bon ? |
| article_confirme | texte_sans_accents | article_confirme | J'ai lu : *Robe wax* — *12 500 FCFA*. C'est bon ? |
| article_confirme | anglais | article_confirme | J'ai lu : *Robe wax* — *12 500 FCFA*. C'est bon ? |
| article_confirme | pidgin | article_confirme | J'ai lu : *Robe wax* — *12 500 FCFA*. C'est bon ? |
| article_confirme | bouton_attendu | aucun_vendeuse | ✅ *Robe wax* — 12 500 FCFA est dans votre catalogue. |
| article_confirme | bouton_ancien | article_confirme | J'ai lu : *Robe wax* — *12 500 FCFA*. C'est bon ? |
| article_confirme | ligne_liste | article_confirme | J'ai lu : *Robe wax* — *12 500 FCFA*. C'est bon ? |
| article_confirme | flux_valide | aucun_vendeuse | ✅ *Chemise* — 9 000 FCFA est dans votre catalogue. |
| article_confirme | flux_tronque | article_nom | Le formulaire n'a pas pu être lu. Reprenons ici, c'est aussi rapide. |
| article_confirme | photo | article_confirme | J'ai lu : *Robe wax* — *12 500 FCFA*. C'est bon ? |
| article_confirme | photo_legendee | article_confirme | (reaction) |
| article_confirme | vocal | article_confirme | Je ne sais pas encore écouter les notes vocales. Écrivez-moi en quelques mots — ou envoyez la photo, avec « no |
| article_confirme | sticker | article_confirme | Joli. Mais je ne sais lire que le texte, les photos et les boutons. |
| article_confirme | document | article_confirme | Je ne sais pas encore ouvrir les documents. Écrivez-moi ce qu'il contient, en quelques mots. |
| article_confirme | localisation | article_confirme | Merci — je ne sais pas encore me servir d'une position partagée. Écrivez-moi votre quartier et un repère (« en |
| article_confirme | hors_sujet | article_confirme | J'ai lu : *Robe wax* — *12 500 FCFA*. C'est bon ? |
| article_confirme | silence | article_confirme | **— MUET —** |
| article_confirme | double_envoi | article_confirme | **— MUET —** |
| article_confirme | retour_arriere | article_confirme | J'ai lu : *Robe wax* — *12 500 FCFA*. C'est bon ? |
| article_confirme | abandon | aucun_vendeuse | C'est annulé. |
| article_confirme | reprise_25h | aucun_vendeuse | *‹boutique›* |
| comptoir:article | texte_juste | comptoir:prix | *Sac en cuir* — au prix convenu avec votre client/e, en francs ? |
| comptoir:article | texte_faute | comptoir:prix | *Sak en kuir* — au prix convenu avec votre client/e, en francs ? |
| comptoir:article | texte_sans_accents | comptoir:prix | *Sac en cuir marron* — au prix convenu avec votre client/e, en francs ? |
| comptoir:article | anglais | comptoir:prix | *Leather bag* — au prix convenu avec votre client/e, en francs ? |
| comptoir:article | pidgin | comptoir:prix | *Leather bag* — au prix convenu avec votre client/e, en francs ? |
| comptoir:article | bouton_attendu | aucun_vendeuse | C'est annulé — rien n'a été créé. |
| comptoir:article | bouton_ancien | comptoir:article | Je n'ai pas saisi l'article. En quelques mots — exemple : Robe wax grande taille. |
| comptoir:article | ligne_liste | comptoir:article | Je n'ai pas saisi l'article. En quelques mots — exemple : Robe wax grande taille. |
| comptoir:article | flux_valide | comptoir:article | Je ne sais pas encore lire ce type de message. Écrivez-moi, ou appuyez sur un bouton. |
| comptoir:article | flux_tronque | comptoir:article | Je ne sais pas encore lire ce type de message. Écrivez-moi, ou appuyez sur un bouton. |
| comptoir:article | photo | comptoir:article | Je n'ai pas saisi l'article. En quelques mots — exemple : Robe wax grande taille. |
| comptoir:article | photo_legendee | comptoir:article | Je n'ai pas saisi l'article. En quelques mots — exemple : Robe wax grande taille. |
| comptoir:article | vocal | comptoir:article | Je ne sais pas encore écouter les notes vocales. Écrivez-moi en quelques mots — ou envoyez la photo, avec « no |
| comptoir:article | sticker | comptoir:article | Joli. Mais je ne sais lire que le texte, les photos et les boutons. |
| comptoir:article | document | comptoir:article | Je ne sais pas encore ouvrir les documents. Écrivez-moi ce qu'il contient, en quelques mots. |
| comptoir:article | localisation | comptoir:article | Merci — je ne sais pas encore me servir d'une position partagée. Écrivez-moi votre quartier et un repère (« en |
| comptoir:article | hors_sujet | comptoir:prix | *est-ce que vous vendez des chaussures pour bébé ?* — au prix convenu avec votre client/e, en francs ? |
| comptoir:article | silence | comptoir:article | **— MUET —** |
| comptoir:article | double_envoi | comptoir:prix | **— MUET —** |
| comptoir:article | retour_arriere | comptoir:prix | *corriger* — au prix convenu avec votre client/e, en francs ? |
| comptoir:article | abandon | aucun_vendeuse | C'est annulé. |
| comptoir:article | reprise_25h | aucun_vendeuse | *‹boutique›* |
| comptoir:prix | texte_juste | comptoir:cliente | *Le numéro WhatsApp de votre client/e ?* |
| comptoir:prix | texte_faute | comptoir:cliente | *Le numéro WhatsApp de votre client/e ?* |
| comptoir:prix | texte_sans_accents | comptoir:cliente | *Le numéro WhatsApp de votre client/e ?* |
| comptoir:prix | anglais | comptoir:cliente | *Le numéro WhatsApp de votre client/e ?* |
| comptoir:prix | pidgin | comptoir:cliente | *Le numéro WhatsApp de votre client/e ?* |
| comptoir:prix | bouton_attendu | aucun_vendeuse | C'est annulé — rien n'a été créé. |
| comptoir:prix | bouton_ancien | comptoir:prix | Je n'ai pas lu de prix. En francs, en chiffres — exemple : 12500. |
| comptoir:prix | ligne_liste | comptoir:prix | Je n'ai pas lu de prix. En francs, en chiffres — exemple : 12500. |
| comptoir:prix | flux_valide | comptoir:prix | Je ne sais pas encore lire ce type de message. Écrivez-moi, ou appuyez sur un bouton. |
| comptoir:prix | flux_tronque | comptoir:prix | Je ne sais pas encore lire ce type de message. Écrivez-moi, ou appuyez sur un bouton. |
| comptoir:prix | photo | comptoir:prix | Je n'ai pas lu de prix. En francs, en chiffres — exemple : 12500. |
| comptoir:prix | photo_legendee | comptoir:prix | Je n'ai pas lu de prix. En francs, en chiffres — exemple : 12500. |
| comptoir:prix | vocal | comptoir:prix | Je ne sais pas encore écouter les notes vocales. Écrivez-moi en quelques mots — ou envoyez la photo, avec « no |
| comptoir:prix | sticker | comptoir:prix | Joli. Mais je ne sais lire que le texte, les photos et les boutons. |
| comptoir:prix | document | comptoir:prix | Je ne sais pas encore ouvrir les documents. Écrivez-moi ce qu'il contient, en quelques mots. |
| comptoir:prix | localisation | comptoir:prix | Merci — je ne sais pas encore me servir d'une position partagée. Écrivez-moi votre quartier et un repère (« en |
| comptoir:prix | hors_sujet | comptoir:prix | Je n'ai pas lu de prix. En francs, en chiffres — exemple : 12500. |
| comptoir:prix | silence | comptoir:prix | **— MUET —** |
| comptoir:prix | double_envoi | comptoir:cliente | **— MUET —** |
| comptoir:prix | retour_arriere | comptoir:prix | Je n'ai pas lu de prix. En francs, en chiffres — exemple : 12500. |
| comptoir:prix | abandon | aucun_vendeuse | C'est annulé. |
| comptoir:prix | reprise_25h | aucun_vendeuse | *‹boutique›* |
| comptoir:cliente | texte_juste | comptoir:remise | *Où se fait la remise ?* Le lieu convenu, en quelques mots. |
| comptoir:cliente | texte_faute | comptoir:remise | *Où se fait la remise ?* Le lieu convenu, en quelques mots. |
| comptoir:cliente | texte_sans_accents | comptoir:remise | *Où se fait la remise ?* Le lieu convenu, en quelques mots. |
| comptoir:cliente | anglais | comptoir:remise | *Où se fait la remise ?* Le lieu convenu, en quelques mots. |
| comptoir:cliente | pidgin | comptoir:remise | *Où se fait la remise ?* Le lieu convenu, en quelques mots. |
| comptoir:cliente | bouton_attendu | aucun_vendeuse | C'est annulé — rien n'a été créé. |
| comptoir:cliente | bouton_ancien | comptoir:cliente | Ce numéro ne se lit pas. Celui de votre client/e, au format camerounais — exemple : 677 00 11 22. |
| comptoir:cliente | ligne_liste | comptoir:cliente | Ce numéro ne se lit pas. Celui de votre client/e, au format camerounais — exemple : 677 00 11 22. |
| comptoir:cliente | flux_valide | comptoir:cliente | Je ne sais pas encore lire ce type de message. Écrivez-moi, ou appuyez sur un bouton. |
| comptoir:cliente | flux_tronque | comptoir:cliente | Je ne sais pas encore lire ce type de message. Écrivez-moi, ou appuyez sur un bouton. |
| comptoir:cliente | photo | comptoir:cliente | Ce numéro ne se lit pas. Celui de votre client/e, au format camerounais — exemple : 677 00 11 22. |
| comptoir:cliente | photo_legendee | comptoir:cliente | Ce numéro ne se lit pas. Celui de votre client/e, au format camerounais — exemple : 677 00 11 22. |
| comptoir:cliente | vocal | comptoir:cliente | Je ne sais pas encore écouter les notes vocales. Écrivez-moi en quelques mots — ou envoyez la photo, avec « no |
| comptoir:cliente | sticker | comptoir:cliente | Joli. Mais je ne sais lire que le texte, les photos et les boutons. |
| comptoir:cliente | document | comptoir:cliente | Je ne sais pas encore ouvrir les documents. Écrivez-moi ce qu'il contient, en quelques mots. |
| comptoir:cliente | localisation | comptoir:cliente | Merci — je ne sais pas encore me servir d'une position partagée. Écrivez-moi votre quartier et un repère (« en |
| comptoir:cliente | hors_sujet | comptoir:cliente | Ce numéro ne se lit pas. Celui de votre client/e, au format camerounais — exemple : 677 00 11 22. |
| comptoir:cliente | silence | comptoir:cliente | **— MUET —** |
| comptoir:cliente | double_envoi | comptoir:remise | **— MUET —** |
| comptoir:cliente | retour_arriere | comptoir:cliente | Ce numéro ne se lit pas. Celui de votre client/e, au format camerounais — exemple : 677 00 11 22. |
| comptoir:cliente | abandon | aucun_vendeuse | C'est annulé. |
| comptoir:cliente | reprise_25h | aucun_vendeuse | *‹boutique›* |
| comptoir:remise | texte_juste | comptoir:recap | 🧾 *Récapitulatif de la vente* |
| comptoir:remise | texte_faute | comptoir:recap | 🧾 *Récapitulatif de la vente* |
| comptoir:remise | texte_sans_accents | comptoir:recap | 🧾 *Récapitulatif de la vente* |
| comptoir:remise | anglais | comptoir:recap | 🧾 *Récapitulatif de la vente* |
| comptoir:remise | pidgin | comptoir:recap | 🧾 *Récapitulatif de la vente* |
| comptoir:remise | bouton_attendu | aucun_vendeuse | C'est annulé — rien n'a été créé. |
| comptoir:remise | bouton_ancien | comptoir:remise | Il me faut un lieu que votre client/e reconnaîtra. Exemple : Carrefour Warda, devant la pharmacie. |
| comptoir:remise | ligne_liste | comptoir:remise | Il me faut un lieu que votre client/e reconnaîtra. Exemple : Carrefour Warda, devant la pharmacie. |
| comptoir:remise | flux_valide | comptoir:remise | Je ne sais pas encore lire ce type de message. Écrivez-moi, ou appuyez sur un bouton. |
| comptoir:remise | flux_tronque | comptoir:remise | Je ne sais pas encore lire ce type de message. Écrivez-moi, ou appuyez sur un bouton. |
| comptoir:remise | photo | comptoir:remise | Il me faut un lieu que votre client/e reconnaîtra. Exemple : Carrefour Warda, devant la pharmacie. |
| comptoir:remise | photo_legendee | comptoir:remise | Il me faut un lieu que votre client/e reconnaîtra. Exemple : Carrefour Warda, devant la pharmacie. |
| comptoir:remise | vocal | comptoir:remise | Je ne sais pas encore écouter les notes vocales. Écrivez-moi en quelques mots — ou envoyez la photo, avec « no |
| comptoir:remise | sticker | comptoir:remise | Joli. Mais je ne sais lire que le texte, les photos et les boutons. |
| comptoir:remise | document | comptoir:remise | Je ne sais pas encore ouvrir les documents. Écrivez-moi ce qu'il contient, en quelques mots. |
| comptoir:remise | localisation | comptoir:remise | Merci — je ne sais pas encore me servir d'une position partagée. Écrivez-moi votre quartier et un repère (« en |
| comptoir:remise | hors_sujet | comptoir:recap | 🧾 *Récapitulatif de la vente* |
| comptoir:remise | silence | comptoir:remise | **— MUET —** |
| comptoir:remise | double_envoi | comptoir:recap | **— MUET —** |
| comptoir:remise | retour_arriere | comptoir:recap | 🧾 *Récapitulatif de la vente* |
| comptoir:remise | abandon | aucun_vendeuse | C'est annulé. |
| comptoir:remise | reprise_25h | aucun_vendeuse | *‹boutique›* |
| comptoir:recap | texte_juste | aucun_vendeuse | ✅ *CT-‹ref› est créée.* Transférez le message suivant à votre client/e — il porte tout ce qu'il faut pour paye |
| comptoir:recap | texte_faute | comptoir:recap | 🧾 *Récapitulatif de la vente* |
| comptoir:recap | texte_sans_accents | aucun_vendeuse | ✅ *CT-‹ref› est créée.* Transférez le message suivant à votre client/e — il porte tout ce qu'il faut pour paye |
| comptoir:recap | anglais | aucun_vendeuse | ✅ *CT-‹ref› est créée.* Transférez le message suivant à votre client/e — il porte tout ce qu'il faut pour paye |
| comptoir:recap | pidgin | comptoir:recap | 🧾 *Récapitulatif de la vente* |
| comptoir:recap | bouton_attendu | aucun_vendeuse | ✅ *CT-‹ref› est créée.* Transférez le message suivant à votre client/e — il porte tout ce qu'il faut pour paye |
| comptoir:recap | bouton_ancien | comptoir:recap | 🧾 *Récapitulatif de la vente* |
| comptoir:recap | ligne_liste | comptoir:recap | 🧾 *Récapitulatif de la vente* |
| comptoir:recap | flux_valide | comptoir:recap | Je ne sais pas encore lire ce type de message. Écrivez-moi, ou appuyez sur un bouton. |
| comptoir:recap | flux_tronque | comptoir:recap | Je ne sais pas encore lire ce type de message. Écrivez-moi, ou appuyez sur un bouton. |
| comptoir:recap | photo | comptoir:recap | 🧾 *Récapitulatif de la vente* |
| comptoir:recap | photo_legendee | comptoir:recap | 🧾 *Récapitulatif de la vente* |
| comptoir:recap | vocal | comptoir:recap | Je ne sais pas encore écouter les notes vocales. Écrivez-moi en quelques mots — ou envoyez la photo, avec « no |
| comptoir:recap | sticker | comptoir:recap | Joli. Mais je ne sais lire que le texte, les photos et les boutons. |
| comptoir:recap | document | comptoir:recap | Je ne sais pas encore ouvrir les documents. Écrivez-moi ce qu'il contient, en quelques mots. |
| comptoir:recap | localisation | comptoir:recap | Merci — je ne sais pas encore me servir d'une position partagée. Écrivez-moi votre quartier et un repère (« en |
| comptoir:recap | hors_sujet | comptoir:recap | 🧾 *Récapitulatif de la vente* |
| comptoir:recap | silence | comptoir:recap | **— MUET —** |
| comptoir:recap | double_envoi | aucun_vendeuse | **— MUET —** |
| comptoir:recap | retour_arriere | comptoir:article | *Qu'avez-vous vendu ?* |
| comptoir:recap | abandon | aucun_vendeuse | C'est annulé. |
| comptoir:recap | reprise_25h | aucun_vendeuse | *‹boutique›* |
| accueil | texte_juste | accueil | Je suis Catalog. Ici, un vendeur/se ouvre sa boutique en deux minutes ; un acheteur/se suit sa commande et vér |
| accueil | texte_faute | accueil | Je suis Catalog. Ici, un vendeur/se ouvre sa boutique en deux minutes ; un acheteur/se suit sa commande et vér |
| accueil | texte_sans_accents | accueil | Je suis Catalog. Ici, un vendeur/se ouvre sa boutique en deux minutes ; un acheteur/se suit sa commande et vér |
| accueil | anglais | accueil | I am Catalog. Here, a seller opens her shop in two minutes, and a buyer tracks her order and checks her receip |
| accueil | pidgin | accueil | Je suis Catalog. Ici, un vendeur/se ouvre sa boutique en deux minutes ; un acheteur/se suit sa commande et vér |
| accueil | bouton_attendu | inscription_nom | Bienvenue ! Ouvrons votre boutique — ça prend deux minutes, ici même. |
| accueil | bouton_ancien | accueil | Je suis Catalog. Ici, un vendeur/se ouvre sa boutique en deux minutes ; un acheteur/se suit sa commande et vér |
| accueil | ligne_liste | accueil | Je suis Catalog. Ici, un vendeur/se ouvre sa boutique en deux minutes ; un acheteur/se suit sa commande et vér |
| accueil | flux_valide | accueil | Je suis Catalog. Ici, un vendeur/se ouvre sa boutique en deux minutes ; un acheteur/se suit sa commande et vér |
| accueil | flux_tronque | accueil | Je suis Catalog. Ici, un vendeur/se ouvre sa boutique en deux minutes ; un acheteur/se suit sa commande et vér |
| accueil | photo | accueil | Je suis Catalog. Ici, un vendeur/se ouvre sa boutique en deux minutes ; un acheteur/se suit sa commande et vér |
| accueil | photo_legendee | accueil | Je suis Catalog. Ici, un vendeur/se ouvre sa boutique en deux minutes ; un acheteur/se suit sa commande et vér |
| accueil | vocal | accueil | Je ne sais pas encore écouter les notes vocales. Écrivez-moi en quelques mots — ou envoyez la photo, avec « no |
| accueil | sticker | accueil | Joli. Mais je ne sais lire que le texte, les photos et les boutons. |
| accueil | document | accueil | Je ne sais pas encore ouvrir les documents. Écrivez-moi ce qu'il contient, en quelques mots. |
| accueil | localisation | accueil | Je suis Catalog. Ici, un vendeur/se ouvre sa boutique en deux minutes ; un acheteur/se suit sa commande et vér |
| accueil | hors_sujet | accueil | Je suis Catalog. Ici, un vendeur/se ouvre sa boutique en deux minutes ; un acheteur/se suit sa commande et vér |
| accueil | silence | accueil | **— MUET —** |
| accueil | double_envoi | accueil | **— MUET —** |
| accueil | retour_arriere | accueil | Je suis Catalog. Ici, un vendeur/se ouvre sa boutique en deux minutes ; un acheteur/se suit sa commande et vér |
| accueil | abandon | accueil | Je suis Catalog. Ici, un vendeur/se ouvre sa boutique en deux minutes ; un acheteur/se suit sa commande et vér |
| accueil | reprise_25h | accueil | Je suis Catalog. Ici, un vendeur/se ouvre sa boutique en deux minutes ; un acheteur/se suit sa commande et vér |
| catalogue | texte_juste | catalogue | *‹boutique›* — Douala |
| catalogue | texte_faute | catalogue | *‹boutique›* — Douala |
| catalogue | texte_sans_accents | catalogue | *‹boutique›* — Douala |
| catalogue | anglais | catalogue | *‹boutique›* — Douala |
| catalogue | pidgin | catalogue | *‹boutique›* — Douala |
| catalogue | bouton_attendu | catalogue | Cette boutique n'a pas encore mis de photos — les articles sont dans la liste. |
| catalogue | bouton_ancien | catalogue | *‹boutique›* — Douala |
| catalogue | ligne_liste | catalogue | *‹boutique›* — 2 articles |
| catalogue | flux_valide | catalogue | *‹boutique›* — Douala |
| catalogue | flux_tronque | catalogue | *‹boutique›* — Douala |
| catalogue | photo | catalogue | *‹boutique›* — Douala |
| catalogue | photo_legendee | catalogue | *‹boutique›* — Douala |
| catalogue | vocal | catalogue | Je ne sais pas encore écouter les notes vocales. Écrivez-moi en quelques mots — ou envoyez la photo, avec « no |
| catalogue | sticker | catalogue | Joli. Mais je ne sais lire que le texte, les photos et les boutons. |
| catalogue | document | catalogue | Je ne sais pas encore ouvrir les documents. Écrivez-moi ce qu'il contient, en quelques mots. |
| catalogue | localisation | catalogue | *‹boutique›* — Douala |
| catalogue | hors_sujet | catalogue | *‹boutique›* — Douala |
| catalogue | silence | catalogue | **— MUET —** |
| catalogue | double_envoi | catalogue | **— MUET —** |
| catalogue | retour_arriere | catalogue | *‹boutique›* — Douala |
| catalogue | abandon | catalogue | C'est annulé — le panier est vide, rien n'a été commandé. |
| catalogue | reprise_25h | catalogue | *‹boutique›* — Douala |
| quantite | texte_juste | ajout | ✅ Ajouté : Article 1 × 2. |
| quantite | texte_faute | quantite | Je n'ai pas compris le nombre. Écrivez-le en chiffres (ex. : 3) — ou « annuler » pour abandonner. |
| quantite | texte_sans_accents | quantite | Je n'ai pas compris le nombre. Écrivez-le en chiffres (ex. : 3) — ou « annuler » pour abandonner. |
| quantite | anglais | quantite | Je n'ai pas compris le nombre. Écrivez-le en chiffres (ex. : 3) — ou « annuler » pour abandonner. |
| quantite | pidgin | quantite | Je n'ai pas compris le nombre. Écrivez-le en chiffres (ex. : 3) — ou « annuler » pour abandonner. |
| quantite | bouton_attendu | quantite | Écrivez le nombre voulu, en chiffres (ex. : 3). |
| quantite | bouton_ancien | quantite | Je n'ai pas compris le nombre. Écrivez-le en chiffres (ex. : 3) — ou « annuler » pour abandonner. |
| quantite | ligne_liste | ajout | ✅ Ajouté : Article 1 × 2. |
| quantite | flux_valide | quantite | Je n'ai pas compris le nombre. Écrivez-le en chiffres (ex. : 3) — ou « annuler » pour abandonner. |
| quantite | flux_tronque | quantite | Je n'ai pas compris le nombre. Écrivez-le en chiffres (ex. : 3) — ou « annuler » pour abandonner. |
| quantite | photo | quantite | Je n'ai pas compris le nombre. Écrivez-le en chiffres (ex. : 3) — ou « annuler » pour abandonner. |
| quantite | photo_legendee | quantite | Je n'ai pas compris le nombre. Écrivez-le en chiffres (ex. : 3) — ou « annuler » pour abandonner. |
| quantite | vocal | quantite | Je ne sais pas encore écouter les notes vocales. Écrivez-moi en quelques mots — ou envoyez la photo, avec « no |
| quantite | sticker | quantite | Joli. Mais je ne sais lire que le texte, les photos et les boutons. |
| quantite | document | quantite | Je ne sais pas encore ouvrir les documents. Écrivez-moi ce qu'il contient, en quelques mots. |
| quantite | localisation | quantite | Je n'ai pas compris le nombre. Écrivez-le en chiffres (ex. : 3) — ou « annuler » pour abandonner. |
| quantite | hors_sujet | quantite | Je n'ai pas compris le nombre. Écrivez-le en chiffres (ex. : 3) — ou « annuler » pour abandonner. |
| quantite | silence | quantite | **— MUET —** |
| quantite | double_envoi | ajout | **— MUET —** |
| quantite | retour_arriere | quantite | Je n'ai pas compris le nombre. Écrivez-le en chiffres (ex. : 3) — ou « annuler » pour abandonner. |
| quantite | abandon | catalogue | C'est annulé — le panier est vide, rien n'a été commandé. |
| quantite | reprise_25h | catalogue | *‹boutique›* — Douala |
| ajout | texte_juste | ajout | 🧺 *Votre panier* |
| ajout | texte_faute | ajout | 🧺 *Votre panier* |
| ajout | texte_sans_accents | ajout | 🧺 *Votre panier* |
| ajout | anglais | ajout | 🧺 *Votre panier* |
| ajout | pidgin | ajout | 🧺 *Votre panier* |
| ajout | bouton_attendu | mode | Comment recevoir votre commande (15 000 FCFA) ? |
| ajout | bouton_ancien | mode | Comment recevoir votre commande (15 000 FCFA) ? |
| ajout | ligne_liste | catalogue | *‹boutique›* — 2 articles |
| ajout | flux_valide | ajout | 🧺 *Votre panier* |
| ajout | flux_tronque | ajout | 🧺 *Votre panier* |
| ajout | photo | ajout | 🧺 *Votre panier* |
| ajout | photo_legendee | ajout | 🧺 *Votre panier* |
| ajout | vocal | ajout | Je ne sais pas encore écouter les notes vocales. Écrivez-moi en quelques mots — ou envoyez la photo, avec « no |
| ajout | sticker | ajout | Joli. Mais je ne sais lire que le texte, les photos et les boutons. |
| ajout | document | ajout | Je ne sais pas encore ouvrir les documents. Écrivez-moi ce qu'il contient, en quelques mots. |
| ajout | localisation | ajout | 🧺 *Votre panier* |
| ajout | hors_sujet | ajout | 🧺 *Votre panier* |
| ajout | silence | ajout | **— MUET —** |
| ajout | double_envoi | ajout | **— MUET —** |
| ajout | retour_arriere | ajout | 🧺 *Votre panier* |
| ajout | abandon | catalogue | C'est annulé — le panier est vide, rien n'a été commandé. |
| ajout | reprise_25h | catalogue | *‹boutique›* — Douala |
| mode | texte_juste | ville | *Livraison dans quelle ville ?* |
| mode | texte_faute | mode | Comment recevoir votre commande (15 000 FCFA) ? |
| mode | texte_sans_accents | ville | *Livraison dans quelle ville ?* |
| mode | anglais | ville | *Which city are we delivering to?* |
| mode | pidgin | mode | Comment recevoir votre commande (15 000 FCFA) ? |
| mode | bouton_attendu | details | Où se retrouve-t-on, et quel numéro appeler ? |
| mode | bouton_ancien | mode | Comment recevoir votre commande (15 000 FCFA) ? |
| mode | ligne_liste | catalogue | *‹boutique›* — 2 articles |
| mode | flux_valide | mode | Comment recevoir votre commande (15 000 FCFA) ? |
| mode | flux_tronque | mode | Comment recevoir votre commande (15 000 FCFA) ? |
| mode | photo | mode | Comment recevoir votre commande (15 000 FCFA) ? |
| mode | photo_legendee | mode | Comment recevoir votre commande (15 000 FCFA) ? |
| mode | vocal | mode | Je ne sais pas encore écouter les notes vocales. Écrivez-moi en quelques mots — ou envoyez la photo, avec « no |
| mode | sticker | mode | Joli. Mais je ne sais lire que le texte, les photos et les boutons. |
| mode | document | mode | Je ne sais pas encore ouvrir les documents. Écrivez-moi ce qu'il contient, en quelques mots. |
| mode | localisation | mode | Comment recevoir votre commande (15 000 FCFA) ? |
| mode | hors_sujet | mode | Comment recevoir votre commande (15 000 FCFA) ? |
| mode | silence | mode | **— MUET —** |
| mode | double_envoi | ville | **— MUET —** |
| mode | retour_arriere | mode | Comment recevoir votre commande (15 000 FCFA) ? |
| mode | abandon | catalogue | C'est annulé — le panier est vide, rien n'a été commandé. |
| mode | reprise_25h | catalogue | *‹boutique›* — Douala |
| ville | texte_juste | details | Votre quartier, un repère, puis le numéro à appeler — en un seul message. |
| ville | texte_faute | details | Votre quartier, un repère, puis le numéro à appeler — en un seul message. |
| ville | texte_sans_accents | details | Votre quartier, un repère, puis le numéro à appeler — en un seul message. |
| ville | anglais | details | Votre quartier, un repère, puis le numéro à appeler — en un seul message. |
| ville | pidgin | details | Votre quartier, un repère, puis le numéro à appeler — en un seul message. |
| ville | bouton_attendu | ville | *Livraison dans quelle ville ?* |
| ville | bouton_ancien | ville | *Livraison dans quelle ville ?* |
| ville | ligne_liste | catalogue | *‹boutique›* — 2 articles |
| ville | flux_valide | recap | *Récapitulatif — ‹boutique›* |
| ville | flux_tronque | ville | *Livraison dans quelle ville ?* |
| ville | photo | ville | *Livraison dans quelle ville ?* |
| ville | photo_legendee | ville | *Livraison dans quelle ville ?* |
| ville | vocal | ville | Je ne sais pas encore écouter les notes vocales. Écrivez-moi en quelques mots — ou envoyez la photo, avec « no |
| ville | sticker | ville | Joli. Mais je ne sais lire que le texte, les photos et les boutons. |
| ville | document | ville | Je ne sais pas encore ouvrir les documents. Écrivez-moi ce qu'il contient, en quelques mots. |
| ville | localisation | ville | *Livraison dans quelle ville ?* |
| ville | hors_sujet | ville_doute | Je note *est-ce que vous vendez des chaussures pour bébé ?* comme ville de livraison — c'est bien ça ? |
| ville | silence | ville | **— MUET —** |
| ville | double_envoi | details | **— MUET —** |
| ville | retour_arriere | details | Votre quartier, un repère, puis le numéro à appeler — en un seul message. |
| ville | abandon | catalogue | C'est annulé — le panier est vide, rien n'a été commandé. |
| ville | reprise_25h | catalogue | *‹boutique›* — Douala |
| ville_doute | texte_juste | details | Votre quartier, un repère, puis le numéro à appeler — en un seul message. |
| ville_doute | texte_faute | details | Votre quartier, un repère, puis le numéro à appeler — en un seul message. |
| ville_doute | texte_sans_accents | details | Votre quartier, un repère, puis le numéro à appeler — en un seul message. |
| ville_doute | anglais | details | Votre quartier, un repère, puis le numéro à appeler — en un seul message. |
| ville_doute | pidgin | details | Votre quartier, un repère, puis le numéro à appeler — en un seul message. |
| ville_doute | bouton_attendu | details | Votre quartier, un repère, puis le numéro à appeler — en un seul message. |
| ville_doute | bouton_ancien | ville | *Livraison dans quelle ville ?* |
| ville_doute | ligne_liste | catalogue | *‹boutique›* — 2 articles |
| ville_doute | flux_valide | ville | *Livraison dans quelle ville ?* |
| ville_doute | flux_tronque | ville | *Livraison dans quelle ville ?* |
| ville_doute | photo | ville | *Livraison dans quelle ville ?* |
| ville_doute | photo_legendee | ville | *Livraison dans quelle ville ?* |
| ville_doute | vocal | ville_doute | Je ne sais pas encore écouter les notes vocales. Écrivez-moi en quelques mots — ou envoyez la photo, avec « no |
| ville_doute | sticker | ville_doute | Joli. Mais je ne sais lire que le texte, les photos et les boutons. |
| ville_doute | document | ville_doute | Je ne sais pas encore ouvrir les documents. Écrivez-moi ce qu'il contient, en quelques mots. |
| ville_doute | localisation | ville | *Livraison dans quelle ville ?* |
| ville_doute | hors_sujet | ville | *Livraison dans quelle ville ?* |
| ville_doute | silence | ville_doute | **— MUET —** |
| ville_doute | double_envoi | details | **— MUET —** |
| ville_doute | retour_arriere | details | Votre quartier, un repère, puis le numéro à appeler — en un seul message. |
| ville_doute | abandon | catalogue | C'est annulé — le panier est vide, rien n'a été commandé. |
| ville_doute | reprise_25h | catalogue | *‹boutique›* — Douala |
| details | texte_juste | recap | *Récapitulatif — ‹boutique›* |
| details | texte_faute | recap | *Récapitulatif — ‹boutique›* |
| details | texte_sans_accents | recap | *Récapitulatif — ‹boutique›* |
| details | anglais | recap | *Récapitulatif — ‹boutique›* |
| details | pidgin | recap | *Récapitulatif — ‹boutique›* |
| details | bouton_attendu | catalogue | Pour parler directement à ‹boutique›, écrivez-lui sur son WhatsApp : |
| details | bouton_ancien | details | Écrivez-le en un message, comme dans l'exemple. |
| details | ligne_liste | catalogue | *‹boutique›* — 2 articles |
| details | flux_valide | details | Écrivez-le en un message, comme dans l'exemple. |
| details | flux_tronque | details | Écrivez-le en un message, comme dans l'exemple. |
| details | photo | details | Écrivez-le en un message, comme dans l'exemple. |
| details | photo_legendee | details | Écrivez-le en un message, comme dans l'exemple. |
| details | vocal | details | Je ne sais pas encore écouter les notes vocales. Écrivez-moi en quelques mots — ou envoyez la photo, avec « no |
| details | sticker | details | Joli. Mais je ne sais lire que le texte, les photos et les boutons. |
| details | document | details | Je ne sais pas encore ouvrir les documents. Écrivez-moi ce qu'il contient, en quelques mots. |
| details | localisation | details | 📍 Position bien reçue, merci. |
| details | hors_sujet | details | Il me manque le numéro à appeler, à la fin du message. Exemple : Bonapriso, en face de la pharmacie, 690 11 22 |
| details | silence | details | **— MUET —** |
| details | double_envoi | recap | **— MUET —** |
| details | retour_arriere | details | Il me manque le numéro à appeler, à la fin du message. Exemple : Bonapriso, en face de la pharmacie, 690 11 22 |
| details | abandon | catalogue | C'est annulé — le panier est vide, rien n'a été commandé. |
| details | reprise_25h | catalogue | *‹boutique›* — Douala |
| recap | texte_juste | catalogue | (template) |
| recap | texte_faute | recap | Utilisez les boutons : confirmer, corriger, ou annuler. |
| recap | texte_sans_accents | catalogue | (template) |
| recap | anglais | catalogue | (template) |
| recap | pidgin | recap | Utilisez les boutons : confirmer, corriger, ou annuler. |
| recap | bouton_attendu | catalogue | (template) |
| recap | bouton_ancien | recap | Utilisez les boutons : confirmer, corriger, ou annuler. |
| recap | ligne_liste | catalogue | *‹boutique›* — 2 articles |
| recap | flux_valide | recap | Utilisez les boutons : confirmer, corriger, ou annuler. |
| recap | flux_tronque | recap | Utilisez les boutons : confirmer, corriger, ou annuler. |
| recap | photo | recap | Utilisez les boutons : confirmer, corriger, ou annuler. |
| recap | photo_legendee | recap | Utilisez les boutons : confirmer, corriger, ou annuler. |
| recap | vocal | recap | Je ne sais pas encore écouter les notes vocales. Écrivez-moi en quelques mots — ou envoyez la photo, avec « no |
| recap | sticker | recap | Joli. Mais je ne sais lire que le texte, les photos et les boutons. |
| recap | document | recap | Je ne sais pas encore ouvrir les documents. Écrivez-moi ce qu'il contient, en quelques mots. |
| recap | localisation | recap | Utilisez les boutons : confirmer, corriger, ou annuler. |
| recap | hors_sujet | recap | Utilisez les boutons : confirmer, corriger, ou annuler. |
| recap | silence | recap | **— MUET —** |
| recap | double_envoi | catalogue | **— MUET —** |
| recap | retour_arriere | details | Où se retrouve-t-on, et quel numéro appeler ? |
| recap | abandon | catalogue | C'est annulé — le panier est vide, rien n'a été commandé. |
| recap | reprise_25h | catalogue | *‹boutique›* — Douala |
| avis_mot | texte_juste | accueil | C'est ajouté. Merci d'avoir pris le temps. |
| avis_mot | texte_faute | accueil | C'est ajouté. Merci d'avoir pris le temps. |
| avis_mot | texte_sans_accents | accueil | C'est ajouté. Merci d'avoir pris le temps. |
| avis_mot | anglais | accueil | C'est ajouté. Merci d'avoir pris le temps. |
| avis_mot | pidgin | accueil | C'est ajouté. Merci d'avoir pris le temps. |
| avis_mot | bouton_attendu | accueil | C'est ajouté. Merci d'avoir pris le temps. |
| avis_mot | bouton_ancien | accueil | Je suis Catalog. Ici, un vendeur/se ouvre sa boutique en deux minutes ; un acheteur/se suit sa commande et vér |
| avis_mot | ligne_liste | accueil | Je suis Catalog. Ici, un vendeur/se ouvre sa boutique en deux minutes ; un acheteur/se suit sa commande et vér |
| avis_mot | flux_valide | accueil | Je suis Catalog. Ici, un vendeur/se ouvre sa boutique en deux minutes ; un acheteur/se suit sa commande et vér |
| avis_mot | flux_tronque | accueil | Je suis Catalog. Ici, un vendeur/se ouvre sa boutique en deux minutes ; un acheteur/se suit sa commande et vér |
| avis_mot | photo | accueil | Je suis Catalog. Ici, un vendeur/se ouvre sa boutique en deux minutes ; un acheteur/se suit sa commande et vér |
| avis_mot | photo_legendee | accueil | Je suis Catalog. Ici, un vendeur/se ouvre sa boutique en deux minutes ; un acheteur/se suit sa commande et vér |
| avis_mot | vocal | avis_mot | Je ne sais pas encore écouter les notes vocales. Écrivez-moi en quelques mots — ou envoyez la photo, avec « no |
| avis_mot | sticker | avis_mot | Joli. Mais je ne sais lire que le texte, les photos et les boutons. |
| avis_mot | document | avis_mot | Je ne sais pas encore ouvrir les documents. Écrivez-moi ce qu'il contient, en quelques mots. |
| avis_mot | localisation | accueil | Je suis Catalog. Ici, un vendeur/se ouvre sa boutique en deux minutes ; un acheteur/se suit sa commande et vér |
| avis_mot | hors_sujet | accueil | C'est ajouté. Merci d'avoir pris le temps. |
| avis_mot | silence | avis_mot | **— MUET —** |
| avis_mot | double_envoi | accueil | **— MUET —** |
| avis_mot | retour_arriere | accueil | C'est ajouté. Merci d'avoir pris le temps. |
| avis_mot | abandon | accueil | C'est ajouté. Merci d'avoir pris le temps. |
| avis_mot | reprise_25h | accueil | Je suis Catalog. Ici, un vendeur/se ouvre sa boutique en deux minutes ; un acheteur/se suit sa commande et vér |
