"""Contrat d'entree et de sortie de l'endpoint POST /calculate.

Convention de nommage : snake_case, idiome Python et forme utilisee par le
dossier de conception (total_co2, breakdown, saved). La traduction vers le
camelCase de l'API publique sera faite par le proxy NestJS, a l'etape 4D-2 :
chaque service reste ainsi idiomatique dans son propre langage.
"""

from pydantic import BaseModel, Field, field_validator

from app.factors import ModeSansFacteurError, ModeTransport, facteur_pour


class SegmentIn(BaseModel):
    """Une portion de trajet soumise au calcul.

    On ne demande QUE ce dont le calcul a besoin : un mode et une distance.
    La duree, les arrets ou les noms de lignes n'interviennent pas, les
    emissions se mesurant au kilometre et non a la minute.
    """

    mode: ModeTransport
    #: Distance en METRES, comme partout ailleurs dans UrbanFlow.
    #: La conversion en kilometres est faite au moment du calcul.
    distance_m: int = Field(ge=0)

    @field_validator("mode")
    @classmethod
    def mode_doit_etre_calculable(cls, mode: ModeTransport) -> ModeTransport:
        """Refuse un mode reconnu mais depourvu de facteur d'emission.

        Cette validation distingue deux situations que FastAPI renverrait
        sinon de la meme facon :
          - un mode inconnu ("FUSEE") est rejete par l'enum ;
          - un mode connu mais sans facteur (ESCOOTER) est rejete ici, avec
            un message qui explique POURQUOI.
        Dans les deux cas la reponse est un 422.
        """
        try:
            facteur_pour(mode)
        except ModeSansFacteurError as erreur:
            raise ValueError(str(erreur)) from erreur

        return mode


class CalculationIn(BaseModel):
    """Corps attendu par POST /calculate."""

    #: Au moins un segment : calculer l'empreinte de rien n'a pas de sens.
    segments: list[SegmentIn] = Field(min_length=1)


class SegmentBreakdown(BaseModel):
    """Detail des emissions d'un segment, repris dans la reponse.

    Le dossier demande explicitement un "breakdown" : l'usager doit pouvoir
    voir quelle portion de son trajet emet quoi, et pas seulement un total.
    """

    mode: ModeTransport
    distance_m: int
    co2_g: float


class CalculationOut(BaseModel):
    """Resultat renvoye par POST /calculate.

    Toutes les valeurs de CO2 sont exprimees en GRAMMES de CO2 equivalent.
    """

    total_distance_m: int
    total_co2_g: float
    #: Ce que le meme trajet aurait emis en voiture individuelle.
    car_co2_g: float
    #: Economie realisee par rapport a la voiture, jamais negative.
    saved_g: float
    #: Score environnemental du trajet, de 0 (voiture) a 100 (mobilite douce).
    #: Une seule decimale, contre deux pour les grammes : voir app/ecoscore.py.
    eco_score: float
    breakdown: list[SegmentBreakdown]
