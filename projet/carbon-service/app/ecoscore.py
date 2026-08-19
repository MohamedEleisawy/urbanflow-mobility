"""Calcul de l'EcoScore d'un itineraire.

CE QUE LE DOSSIER IMPOSE
------------------------
Le dossier de conception fixe le cadre, et seulement le cadre :

  - une echelle de 0 a 100 (ecrit dans le dossier ET dans le diagramme de
    classes, ou l'attribut est note `ecoScore : float <<0-100>>`) ;
  - 100 = mobilite douce ;
  - 0 = voiture individuelle ;
  - un calcul base sur les emissions de CO2, la distance et le mode.

CE QUE LE DOSSIER NE DONNE PAS
------------------------------
AUCUNE FORMULE NUMERIQUE. Recherche faite dans les 39 pages du dossier :
"EcoScore" y apparait UNE seule fois, "formule" et "ponderation" zero fois.

La formule ci-dessous est donc une DECISION DE CONCEPTION UrbanFlow, et doit
etre presentee comme telle. Ce n'est ni une formule de l'ADEME, ni une
formule fournie par le dossier.

LA FORMULE RETENUE
------------------
                    saved_g
    eco_score  =  ------------  x  100
                   car_co2_g

Soit, en francais : LE POURCENTAGE D'EMISSIONS EVITEES PAR RAPPORT A LA
VOITURE INDIVIDUELLE. Une phrase, comprehensible par l'usager.

Elle respecte exactement les deux bornes du dossier :

    trajet en voiture      saved = 0        ->  score 0    (0 = voiture)
    trajet sans emission   saved = car      ->  score 100  (100 = doux)

Et elle utilise bien les trois entrees demandees, quoique INDIRECTEMENT :
le mode et la distance produisent les emissions, les emissions produisent le
score. C'est une chaine, pas une somme ponderee de trois termes.

    mode + distance  ->  emissions  ->  saved  ->  score

POURQUOI PAS UNE FORMULE COMPOSITE ?
------------------------------------
Melanger CO2, duree et correspondances imposerait de choisir des
coefficients (0,6 / 0,3 / 0,1 ?) que RIEN ne justifierait. C'est exactement
le raisonnement qui nous a fait refuser d'inventer un facteur d'emission
pour ESCOOTER a l'etape 4D-1 : on n'invente pas un nombre qu'on ne sait pas
defendre. La duree et le confort relevent d'ailleurs des criteres FASTEST /
SHORTEST, deja calcules ailleurs.

CE QUE LE SCORE MESURE, ET CE QU'IL NE MESURE PAS
-------------------------------------------------
Etant un RATIO, le score est independant de la distance parcourue :

    50 km en metro  ->  98,2       500 m en bus  ->  48,2

Il mesure donc l'EFFICACITE du trajet (« ce trajet etait-il propre ? »), et
NON la SOBRIETE (« avez-vous peu emis ? »). C'est coherent avec les bornes du
dossier, ou 0 et 100 designent des MODES et non des quantites. Pour la
quantite, la reponse existe deja : `saved_g`, en grammes.

Scores obtenus par mode pur (verifiables de tete) :

    WALK, BIKE     facteur 0     ->  100,0
    TRAM, METRO    facteur 4     ->   98,2
    BUS            facteur 113   ->   48,2
    CAR            facteur 218   ->    0,0
"""

#: Le score est un pourcentage : une decimale suffit, et deux afficheraient
#: du bruit sur un indicateur qui se lit « 92 / 100 ». Le CO2 garde ses deux
#: decimales (decision 4D-1) : les deux grandeurs n'ont pas la meme echelle.
DECIMALES = 1

SCORE_MINIMUM = 0.0
SCORE_MAXIMUM = 100.0


class EcoScoreIncoherentError(ValueError):
    """Les entrees violent une precondition du calcul.

    Cette erreur ne peut PAS survenir avec des donnees produites par
    `calculer_empreinte()` : elle signale un bug, pas une saisie invalide.
    """

    def __init__(self, saved_g: float, car_co2_g: float, score: float) -> None:
        super().__init__(
            f"EcoScore hors de [0, 100] : {score}. "
            f"Entrees incoherentes (saved_g={saved_g}, car_co2_g={car_co2_g}). "
            "Attendu : 0 <= saved_g <= car_co2_g."
        )


def calculer_ecoscore(saved_g: float, car_co2_g: float) -> float:
    """Renvoie l'EcoScore d'un itineraire, entre 0 et 100.

    Les deux arguments doivent etre les valeurs EN PLEINE PRECISION issues du
    calcul carbone, avant tout arrondi : arrondir puis diviser ferait deriver
    le score sans raison.

    POURQUOI AUCUN `clamp` ICI. Les bornes sont deja STRUCTURELLES :

      - `saved_g >= 0` est garanti par le `max(..., 0)` de `calculer_empreinte()`
        (etape 4D-1), donc le score ne peut pas etre negatif ;
      - `saved_g <= car_co2_g` decoule de `total_co2_g >= 0`, donc le score ne
        peut pas depasser 100.

    Ecrire `min(max(score, 0), 100)` serait donc du code mort qui, le jour ou
    une de ces deux proprietes se briserait, MASQUERAIT le bug au lieu de le
    reveler. On leve donc une erreur : une anomalie doit s'entendre.
    """
    if car_co2_g == 0:
        # Distance nulle : car_co2 = 0 et saved = 0, soit 0/0, qui n'a pas de
        # limite unique (0 m a pied tendrait vers 100, 0 m en voiture vers 0).
        #
        # CONVENTION, et non resultat mathematique : on renvoie 100, parce que
        # l'usager n'a emis aucun gramme et qu'il serait faux de l'en penaliser.
        # C'est aussi la valeur des autres trajets a zero emission.
        if saved_g == 0:
            return SCORE_MAXIMUM

        # car_co2 nul mais une economie non nulle : arithmetiquement impossible.
        raise EcoScoreIncoherentError(saved_g, car_co2_g, float("nan"))

    score = saved_g / car_co2_g * 100

    if not SCORE_MINIMUM <= score <= SCORE_MAXIMUM:
        raise EcoScoreIncoherentError(saved_g, car_co2_g, score)

    return round(score, DECIMALES)
