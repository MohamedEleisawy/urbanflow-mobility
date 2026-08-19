"""Tests de l'EcoScore (etape 4D-3-1).

Deux niveaux, comme pour le calcul carbone :

  - la FONCTION PURE calculer_ecoscore(), appelee avec deux nombres ;
  - le calcul COMPLET calculer_empreinte(), pour verifier que le score
    produit par un vrai itineraire est le bon.

Toutes les valeurs attendues sont calculables a la main a partir des
facteurs, ce qui permet de les verifier sans faire confiance au code :

    score = (car_co2 - total_co2) / car_co2 x 100

Exemple, le bus : 113 g/km contre 218 g/km pour la voiture, donc
(218 - 113) / 218 = 0,48165... soit 48,2 apres arrondi.
"""

import pytest

from app.carbon import calculer_empreinte
from app.ecoscore import EcoScoreIncoherentError, calculer_ecoscore
from app.factors import ModeTransport
from app.models import SegmentIn


def segment(mode: str, distance_m: int) -> SegmentIn:
    return SegmentIn(mode=ModeTransport(mode), distance_m=distance_m)


def score_de(*segments: tuple[str, int]) -> float:
    """EcoScore d'un itineraire decrit par des couples (mode, distance)."""
    return calculer_empreinte([segment(mode, d) for mode, d in segments]).eco_score


#: Echantillon volontairement varie : modes purs, multimodal, distance nulle.
ITINERAIRES_VARIES: tuple[tuple[tuple[str, int], ...], ...] = (
    (("WALK", 2000),),
    (("BIKE", 5000),),
    (("TRAM", 2000),),
    (("METRO", 5000),),
    (("BUS", 1000),),
    (("CAR", 8000),),
    (("WALK", 600), ("BUS", 3200)),
    (("BUS", 5000), ("CAR", 5000)),
    (("BUS", 0),),
)


# ---------------------------------------------------------------------------
# Modes purs
# ---------------------------------------------------------------------------
class TestModesPurs:
    def test_la_marche_obtient_le_score_maximal(self) -> None:
        # 0 g emis, 436 g evites : rien n'a ete gaspille.
        assert score_de(("WALK", 2000)) == 100.0

    def test_le_velo_obtient_le_score_maximal(self) -> None:
        assert score_de(("BIKE", 5000)) == 100.0

    def test_le_tram(self) -> None:
        # (218 - 4) / 218 = 0,98165...
        assert score_de(("TRAM", 2000)) == 98.2

    def test_le_metro(self) -> None:
        assert score_de(("METRO", 5000)) == 98.2

    def test_le_bus(self) -> None:
        # (218 - 113) / 218 = 0,48165...
        assert score_de(("BUS", 1000)) == 48.2

    def test_la_voiture_obtient_le_score_minimal(self) -> None:
        # C'est la borne basse du dossier : 0 = voiture individuelle.
        assert score_de(("CAR", 8000)) == 0.0


# ---------------------------------------------------------------------------
# Le score est un RATIO
# ---------------------------------------------------------------------------
class TestIndependanceALaDistance:
    def test_un_bus_obtient_le_meme_score_quelle_que_soit_la_distance(self) -> None:
        # LE test qui explique ce que mesure le score : l'EFFICACITE du
        # trajet, pas la sobriete. 1 km et 10 km en bus sont aussi
        # « propres » l'un que l'autre, meme si le second emet dix fois plus.
        assert score_de(("BUS", 1000)) == score_de(("BUS", 10000)) == 48.2

    def test_la_quantite_emise_reste_lisible_ailleurs(self) -> None:
        # La sobriete n'est pas perdue pour autant : elle se lit en grammes.
        court = calculer_empreinte([segment("BUS", 1000)])
        long = calculer_empreinte([segment("BUS", 10000)])

        assert court.eco_score == long.eco_score
        assert long.saved_g == court.saved_g * 10


# ---------------------------------------------------------------------------
# Itineraires multimodaux
# ---------------------------------------------------------------------------
class TestMultimodal:
    def test_marche_puis_bus(self) -> None:
        # 466,8 / 828,4 = 0,563495...
        assert score_de(("WALK", 600), ("BUS", 3200)) == 56.3

    def test_la_marche_tire_le_score_vers_le_haut(self) -> None:
        # 1030,4 / 1046,4 = 0,984709...
        assert score_de(("WALK", 500), ("METRO", 4000), ("WALK", 300)) == 98.5

    def test_la_voiture_tire_le_score_vers_le_bas(self) -> None:
        # 525 / 2180 = 0,240825...
        assert score_de(("BUS", 5000), ("CAR", 5000)) == 24.1

    def test_un_segment_en_voiture_degrade_le_score(self) -> None:
        assert score_de(("BUS", 5000), ("CAR", 5000)) < score_de(("BUS", 10000))


# ---------------------------------------------------------------------------
# Bornes
# ---------------------------------------------------------------------------
class TestBornes:
    def test_aucun_itineraire_ne_sort_de_l_intervalle(self) -> None:
        for itineraire in ITINERAIRES_VARIES:
            score = score_de(*itineraire)
            assert 0.0 <= score <= 100.0, itineraire

    def test_le_maximum_est_atteint_mais_jamais_depasse(self) -> None:
        assert score_de(("WALK", 10000)) == 100.0

    def test_le_minimum_est_atteint_mais_jamais_franchi(self) -> None:
        assert score_de(("CAR", 10000)) == 0.0


# ---------------------------------------------------------------------------
# Convention car_co2 = 0
# ---------------------------------------------------------------------------
class TestDistanceNulle:
    def test_une_distance_nulle_donne_le_score_maximal(self) -> None:
        # CONVENTION, pas resultat mathematique : 0/0 n'a pas de limite
        # unique. On renvoie 100 parce que l'usager n'a emis aucun gramme.
        assert score_de(("BUS", 0)) == 100.0

    def test_la_convention_vaut_aussi_pour_un_mode_carbone(self) -> None:
        # Consequence assumee : un trajet de 0 m EN VOITURE obtient 100.
        # C'est une entree degeneree, sans consequence pratique, mais il faut
        # savoir la nommer plutot que la decouvrir.
        assert score_de(("CAR", 0)) == 100.0

    def test_la_fonction_pure_applique_la_meme_convention(self) -> None:
        assert calculer_ecoscore(0.0, 0.0) == 100.0


# ---------------------------------------------------------------------------
# Arrondi et determinisme
# ---------------------------------------------------------------------------
class TestPrecision:
    def test_le_score_a_une_seule_decimale(self) -> None:
        # 48,16514... ne doit pas ressortir tel quel.
        score = score_de(("BUS", 1000))

        assert score == 48.2
        assert str(score) == "48.2"

    def test_le_calcul_utilise_les_valeurs_non_arrondies(self) -> None:
        # saved_g vaut 466.79999999999995 avant arrondi. Le score doit etre
        # calcule sur cette valeur-la, pas sur les 466.8 affiches.
        resultat = calculer_empreinte([segment("WALK", 600), segment("BUS", 3200)])

        assert resultat.saved_g == 466.8
        assert resultat.eco_score == 56.3

    def test_le_score_est_deterministe(self) -> None:
        # Aucune dependance a l'horloge, au hasard ou a un service externe :
        # deux appels identiques doivent donner exactement le meme resultat.
        itineraire = (("WALK", 600), ("BUS", 3200), ("METRO", 1500))

        assert score_de(*itineraire) == score_de(*itineraire)

    def test_deux_itineraires_equivalents_donnent_le_meme_score(self) -> None:
        # Un trajet decoupe en deux morceaux vaut le trajet entier.
        assert score_de(("BUS", 3000)) == score_de(("BUS", 1000), ("BUS", 2000))


# ---------------------------------------------------------------------------
# Coherence interne
# ---------------------------------------------------------------------------
class TestIncoherences:
    """Le score ne se contente pas de rester dans [0, 100] : il REFUSE de
    produire une valeur hors bornes.

    Un `min(max(score, 0), 100)` aurait ramene silencieusement le resultat
    dans l'intervalle — et aurait donc masque le bug qui l'en avait fait
    sortir. Une anomalie doit s'entendre.
    """

    def test_refuse_une_economie_negative(self) -> None:
        # C'est EXACTEMENT ce qui arriverait si le max(..., 0) de
        # calculer_empreinte() disparaissait : voir le test suivant.
        with pytest.raises(EcoScoreIncoherentError):
            calculer_ecoscore(-1.0, 100.0)

    def test_refuse_une_economie_superieure_a_la_reference(self) -> None:
        # Impossible tant que total_co2 >= 0 ; on veut le savoir si ca change.
        with pytest.raises(EcoScoreIncoherentError):
            calculer_ecoscore(150.0, 100.0)

    def test_refuse_une_economie_sans_reference(self) -> None:
        # car_co2 = 0 impose saved = 0 : toute autre valeur est un bug.
        with pytest.raises(EcoScoreIncoherentError):
            calculer_ecoscore(10.0, 0.0)

    def test_le_message_d_erreur_montre_les_entrees_fautives(self) -> None:
        with pytest.raises(EcoScoreIncoherentError) as erreur:
            calculer_ecoscore(-1.0, 100.0)

        assert "saved_g=-1.0" in str(erreur.value)
        assert "car_co2_g=100.0" in str(erreur.value)

    def test_la_borne_de_4d1_est_indispensable_au_score(self) -> None:
        """Prouve la dependance entre les deux etapes.

        Deux segments en voiture de 100 m et 200 m produisent, AVANT le
        max(..., 0) de calculer_empreinte(), une economie de -1,42e-14 :
        un residu strictement negatif, purement binaire (0,1 + 0,2 km
        cumulent 65.4 g quand 0,3 km d'un seul tenant en donnent
        65.39999999999999).

        Sans cette borne, calculer_ecoscore() recevrait donc une valeur
        negative et LEVERAIT EcoScoreIncoherentError. Que ce calcul
        aboutisse a 0.0 est la preuve que la borne fait son travail.
        """
        assert score_de(("CAR", 100), ("CAR", 200)) == 0.0
