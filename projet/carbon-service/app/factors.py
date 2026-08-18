"""Facteurs d'emission de CO2 par mode de transport.

SOURCE DES VALEURS
------------------
Ces facteurs proviennent du dossier de conception UrbanFlow Mobility, qui les
attribue lui-meme a la Base Carbone(R) de l'ADEME. Ils y sont ecrits noir sur
blanc dans le diagramme de classes, en note de la classe CarbonRecord :

    BUS : 113 gCO2e/km
    TRAM : 4 gCO2e/km
    METRO : 4 gCO2e/km
    BIKE : 0 gCO2e/km
    CAR : 218 gCO2e/km

WALK n'y figure pas : sa valeur de 0 est une deduction de conception, la marche
ne mettant en oeuvre aucune motorisation - exactement le meme raisonnement que
pour le velo, dont le dossier donne bien 0.

POURQUOI DES VALEURS EMBARQUEES, ET NON L'API ADEME
---------------------------------------------------
Le dossier mentionne l'existence d'une API Base Carbone ouverte. Nous ne
l'appelons PAS a chaque calcul, et ce choix est assume :

  - determinisme : deux calculs identiques donnent toujours le meme resultat ;
  - testabilite : aucun test ne depend d'un service exterieur ;
  - disponibilite : une panne de l'ADEME ne doit pas empecher de comparer deux
    itineraires ;
  - rapidite : une multiplication n'a pas besoin d'un aller-retour reseau.

C'est d'ailleurs conforme au dossier lui-meme, qui prone "la limitation des
appels vers les APIs externes" (section 3.4).

Ce fichier est volontairement le SEUL endroit ou ces valeurs apparaissent : le
jour ou elles proviendront d'un import ADEME, seule cette table changera, et
la logique de calcul restera intacte.
"""

from enum import StrEnum


class ModeTransport(StrEnum):
    """Modes de transport, identiques a l'enum ModeTransport de Prisma.

    StrEnum (Python 3.11+) plutot que le vieil idiome `class X(str, Enum)` :
    chaque membre EST une chaine, donc il se compare et se serialise en JSON
    comme "BUS" sans conversion explicite.

    On reprend la liste COMPLETE du backend, y compris ESCOOTER, afin que les
    deux services parlent exactement le meme vocabulaire. Un mode peut donc
    etre reconnu sans pour autant etre calculable : voir facteur_pour().
    """

    WALK = "WALK"
    BUS = "BUS"
    TRAM = "TRAM"
    METRO = "METRO"
    BIKE = "BIKE"
    ESCOOTER = "ESCOOTER"
    CAR = "CAR"


#: Grammes de CO2 equivalent emis par kilometre parcouru.
#:
#: ESCOOTER est VOLONTAIREMENT ABSENT : le dossier ne fournit aucune valeur
#: pour la trottinette. Plutot que d'en inventer une - ou pire, de la traiter
#: comme 0, ce qui sous-estimerait les emissions - le service refuse
#: explicitement de calculer ce mode.
FACTEURS_G_PAR_KM: dict[ModeTransport, float] = {
    ModeTransport.WALK: 0.0,
    ModeTransport.BIKE: 0.0,
    ModeTransport.TRAM: 4.0,
    ModeTransport.METRO: 4.0,
    ModeTransport.BUS: 113.0,
    ModeTransport.CAR: 218.0,
}

#: Reference utilisee pour repondre a la question "combien aurais-je emis en
#: voiture ?". C'est le meme facteur que le mode CAR.
FACTEUR_VOITURE_G_PAR_KM: float = FACTEURS_G_PAR_KM[ModeTransport.CAR]


class ModeSansFacteurError(ValueError):
    """Le mode est reconnu, mais aucun facteur d'emission n'est disponible."""

    def __init__(self, mode: ModeTransport) -> None:
        self.mode = mode
        disponibles = ", ".join(sorted(m.value for m in FACTEURS_G_PAR_KM))
        super().__init__(
            f"Mode '{mode.value}' non supporte : aucun facteur d'emission valide "
            f"dans le dossier de conception. Modes calculables : {disponibles}."
        )


def facteur_pour(mode: ModeTransport) -> float:
    """Renvoie le facteur d'emission d'un mode, en gCO2e par kilometre.

    Leve ModeSansFacteurError si le mode n'a pas de facteur : jamais de valeur
    par defaut silencieuse.
    """
    facteur = FACTEURS_G_PAR_KM.get(mode)

    if facteur is None:
        raise ModeSansFacteurError(mode)

    return facteur
