# 0043 — Le site de la société : éditorial, et sur la société seule

Date : 05/08/2026 · Statut : accepté · Révise : 0041, 0042

## Contexte

Première version du site en ligne, deux reproches du porteur du produit, tous
deux justes :

1. **« Il y a un copié-collé des infos du RCCM. »** La page affichait l'objet
   social en huit étiquettes et la fiche légale portait sept lignes, dont le
   produit édité. Ça se lisait comme un extrait de greffe, pas comme une
   entreprise.
2. **« Le design est très basique. »** Cartes, badges, boutons pleins : le
   vocabulaire d'une application. Une maison de services ne se présente pas
   comme un tableau de bord.

S'y ajoute une instruction de cadrage : **le site ne parle pas des produits**.

## Décision 1 — Un registre éditorial, pas un registre applicatif

Serif **système** en très grand corps (`ui-serif`/Georgia — zéro octet
téléchargé), filets d'un pixel, numéros en mono espacé, une seule couleur
d'accent, et beaucoup de blanc. Les cartes, les ombres portées et les boutons
pleins ont disparu.

L'échelle typographique est **locale au site** : les jetons partagés plafonnent
à 2,125 rem parce qu'ils sont calibrés pour une application tenue à bout de
bras. Les élargir aurait grossi les montants de l'app vendeuse par ricochet.

**Le vide est le sujet.** Une page institutionnelle se juge à ce qu'elle a eu
le courage de ne pas dire.

## Décision 2 — Du registre, on ne garde que les mentions légales

Un registre de commerce énumère ce qu'une société a le **droit** de faire, avec
les dates de naissance des associés, la durée, les numéraires. Rien de tout
cela n'a sa place sur un site — publier les données personnelles d'un associé
serait même un contresens sur un site qui promet de collecter le minimum.

Ce qui reste, et rien de plus : **dénomination, forme juridique et capital,
immatriculation, siège, directeur de la publication, courriel**. C'est ce que
les mentions légales exigent.

Les domaines d'activité sont regroupés en **quatre lignes** dans les mots du
registre, sans une capacité ajoutée. Déclarer un domaine n'est pas l'exercer :
on ne transforme pas une énumération administrative en promesse commerciale.

## Décision 3 — La dénomination légale et le nom d'usage sont deux champs

`EDITEUR.societe` vaut `HORIZON SERVICES` — la forme du registre, pour les
mentions légales, où elle doit correspondre exactement au document déposé.
`EDITEUR.nom` vaut `Horizon Services`, pour la prose.

« HORIZON SERVICES est une société… » se lit comme un cri au milieu d'une
phrase. Une casse de registre n'est pas une casse de lecture, et les confondre
se voyait à l'écran.

## Décision 4 — Le site ne nomme aucun produit

Les produits édités ont leur propre domaine. Les faire entrer ici
transformerait la page de société en plaquette commerciale et brouillerait ce
qu'un vérificateur vient chercher : l'entreprise.

La politique de confidentialité parle donc de **« nos services »**. C'est exact
— la société les exploite — et ça reste vrai le jour où il y en a deux.

**La tension est connue et assumée** : un vérificateur qui rapproche le numéro
WhatsApp du site n'y trouvera pas le service qui l'utilise. Si la vérification
achoppe là-dessus, la réponse tient en une ligne à ajouter, pas en une refonte.

## Ce que ça ne fait pas

- **Aucun client, aucun chiffre, aucun témoignage, aucun effectif.** Rien de
  tout cela n'existe sous une forme montrable, et une page de société qui
  invente sa taille est ce qu'un vérificateur sait repérer.
- **Aucun formulaire de contact**, aucune page de tarifs, aucune traduction.
