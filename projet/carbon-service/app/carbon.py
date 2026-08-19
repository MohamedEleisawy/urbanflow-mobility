"""Coeur du calcul d'empreinte carbone.

Fonction PURE : memes entrees, memes sorties, aucun effet de bord, aucun acces
au reseau ni a une base de donnees. Elle se teste donc directement, sans
demarrer FastAPI.

PRINCIPE, en une phrase :

    mode -> facteur d'emission -> multiplie par la distance -> grammes de CO2

ATTENTION AUX UNITES - c'est le piege principal de cette etape :

    nos distances     sont en METRES      (distance_m, entier)
    les facteurs ADEME sont en gCO2e/KILOMETRE
    le resultat        est en GRAMMES

Il faut donc IMPERATIVEMENT diviser par 1000 avant de multiplier. L'oublier
multiplierait toutes les emissions par mille, sans qu'aucune erreur ne soit
levee : un bug silencieux et grossier. D'ou un test dedie, verifiable de tete
(1000 m en bus = exactement 113 g).
"""

from collections.abc import Sequence

from app.ecoscore import calculer_ecoscore
from app.factors import FACTEUR_VOITURE_G_PAR_KM, facteur_pour
from app.models import CalculationOut, SegmentBreakdown, SegmentIn

#: Nombre de decimales conservees dans la REPONSE.
#:
#: Le calcul lui-meme se fait en pleine precision ; l'arrondi n'intervient
#: qu'au moment de construire le resultat. Sans cela, une soustraction de
#: flottants exposerait ses artefacts binaires : 828.4 - 361.6 vaut
#: 466.79999999999995 en arithmetique machine.
#:
#: Deux decimales sont deja bien au-dela de la precision des facteurs
#: eux-memes, que l'ADEME donne a l'unite.
DECIMALES = 2


def _metres_en_kilometres(distance_m: int) -> float:
    """Conversion isolee dans sa propre fonction, pour qu'elle soit visible."""
    return distance_m / 1000


def calculer_empreinte(segments: Sequence[SegmentIn]) -> CalculationOut:
    """Calcule l'empreinte carbone d'un itineraire.

    Leve ModeSansFacteurError si un segment utilise un mode sans facteur
    connu. Le mode est normalement deja valide par les modeles Pydantic ;
    cette fonction reste neanmoins correcte si elle est appelee directement.
    """
    breakdown: list[SegmentBreakdown] = []
    total_distance_m = 0
    total_co2_g = 0.0

    for segment in segments:
        distance_km = _metres_en_kilometres(segment.distance_m)
        co2_g = distance_km * facteur_pour(segment.mode)

        total_distance_m += segment.distance_m
        total_co2_g += co2_g

        breakdown.append(
            SegmentBreakdown(
                mode=segment.mode,
                distance_m=segment.distance_m,
                co2_g=round(co2_g, DECIMALES),
            )
        )

    # Reference : la MEME distance parcourue en voiture individuelle.
    car_co2_g = _metres_en_kilometres(total_distance_m) * FACTEUR_VOITURE_G_PAR_KM

    # Borne a 0 : un trajet effectue en voiture n'economise rien, il ne fait
    # pas "perdre" du carbone. Une valeur negative n'aurait aucun sens pour
    # l'usager.
    saved_g = max(car_co2_g - total_co2_g, 0.0)

    # L'EcoScore est calcule ICI, a partir des resultats qui precedent : les
    # emissions ne sont JAMAIS parcourues une seconde fois. Il recoit les
    # valeurs en PLEINE PRECISION, avant les arrondis ci-dessous.
    eco_score = calculer_ecoscore(saved_g, car_co2_g)

    return CalculationOut(
        total_distance_m=total_distance_m,
        total_co2_g=round(total_co2_g, DECIMALES),
        car_co2_g=round(car_co2_g, DECIMALES),
        saved_g=round(saved_g, DECIMALES),
        eco_score=eco_score,
        breakdown=breakdown,
    )
