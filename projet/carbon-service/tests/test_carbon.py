"""Tests du calcul d'empreinte carbone (etape 4D-1).

Deux niveaux :

  - la FONCTION PURE calculer_empreinte(), testee directement, sans FastAPI ;
  - l'ENDPOINT POST /calculate, teste via TestClient pour verifier la
    validation et les codes HTTP.

Toutes les valeurs attendues sont calculables de tete a partir des facteurs,
ce qui permet de verifier le resultat sans faire confiance au code.
"""

import pytest
from fastapi.testclient import TestClient

from app.carbon import calculer_empreinte
from app.factors import ModeSansFacteurError, ModeTransport, facteur_pour
from app.main import create_app
from app.models import SegmentIn

client = TestClient(create_app())


def segment(mode: str, distance_m: int) -> SegmentIn:
    """Construit un segment sans passer par la validation HTTP."""
    return SegmentIn(mode=ModeTransport(mode), distance_m=distance_m)


# ---------------------------------------------------------------------------
# Facteurs
# ---------------------------------------------------------------------------
class TestFacteurs:
    def test_facteurs_du_dossier_de_conception(self) -> None:
        # Ces cinq valeurs sont ecrites dans le diagramme de classes.
        assert facteur_pour(ModeTransport.BUS) == 113
        assert facteur_pour(ModeTransport.TRAM) == 4
        assert facteur_pour(ModeTransport.METRO) == 4
        assert facteur_pour(ModeTransport.BIKE) == 0
        assert facteur_pour(ModeTransport.CAR) == 218

    def test_marche_sans_emission(self) -> None:
        # Deduction de conception : aucune motorisation, comme le velo.
        assert facteur_pour(ModeTransport.WALK) == 0

    def test_escooter_leve_une_erreur_explicite(self) -> None:
        # Le dossier ne fournit aucun facteur pour la trottinette. On refuse
        # de calculer plutot que d'inventer une valeur.
        with pytest.raises(ModeSansFacteurError) as erreur:
            facteur_pour(ModeTransport.ESCOOTER)

        assert "ESCOOTER" in str(erreur.value)
        assert "non supporte" in str(erreur.value)


# ---------------------------------------------------------------------------
# Conversion des unites
# ---------------------------------------------------------------------------
class TestConversionUnites:
    def test_mille_metres_en_bus_font_exactement_113_grammes(self) -> None:
        # LE test de reference : 1000 m = 1 km, et le facteur bus vaut 113.
        # S'il echoue, c'est que la conversion metres -> kilometres est
        # fausse, et TOUTES les emissions le sont d'un facteur mille.
        resultat = calculer_empreinte([segment("BUS", 1000)])

        assert resultat.total_co2_g == 113

    def test_deux_kilometres_en_tram(self) -> None:
        resultat = calculer_empreinte([segment("TRAM", 2000)])

        assert resultat.total_co2_g == 8  # 2 km x 4

    def test_cinq_kilometres_en_metro(self) -> None:
        resultat = calculer_empreinte([segment("METRO", 5000)])

        assert resultat.total_co2_g == 20  # 5 km x 4

    def test_une_distance_inferieure_au_kilometre(self) -> None:
        # 500 m ne doivent pas etre traites comme 500 km.
        resultat = calculer_empreinte([segment("BUS", 500)])

        assert resultat.total_co2_g == 56.5  # 0,5 km x 113


# ---------------------------------------------------------------------------
# Modes sans emission
# ---------------------------------------------------------------------------
class TestModesSansEmission:
    def test_le_velo_n_emet_rien(self) -> None:
        resultat = calculer_empreinte([segment("BIKE", 5000)])

        assert resultat.total_co2_g == 0

    def test_la_marche_n_emet_rien(self) -> None:
        resultat = calculer_empreinte([segment("WALK", 1200)])

        assert resultat.total_co2_g == 0

    def test_un_mode_sans_emission_compte_quand_meme_dans_la_distance(self) -> None:
        # La distance parcourue a pied entre dans la comparaison voiture :
        # c'est bien ce trajet-la qu'on aurait pu faire en voiture.
        resultat = calculer_empreinte([segment("WALK", 2000)])

        assert resultat.total_distance_m == 2000
        assert resultat.car_co2_g == 436  # 2 km x 218
        assert resultat.saved_g == 436


# ---------------------------------------------------------------------------
# Comparaison avec la voiture
# ---------------------------------------------------------------------------
class TestComparaisonVoiture:
    def test_calcule_ce_qu_aurait_emis_la_voiture(self) -> None:
        resultat = calculer_empreinte([segment("BUS", 10000)])

        assert resultat.car_co2_g == 2180  # 10 km x 218
        assert resultat.total_co2_g == 1130  # 10 km x 113
        assert resultat.saved_g == 1050

    def test_un_trajet_en_voiture_n_economise_rien(self) -> None:
        # saved est borne a 0 : on ne "perd" pas de carbone, on n'en
        # economise simplement aucun.
        resultat = calculer_empreinte([segment("CAR", 8000)])

        assert resultat.total_co2_g == resultat.car_co2_g
        assert resultat.saved_g == 0

    def test_saved_n_est_jamais_negatif(self) -> None:
        # Cas mesure, et non theorique : 0,1 km puis 0,2 km en voiture
        # cumulent 65.4 g, tandis que 0,3 km d'un seul tenant en donnent
        # 65.39999999999999. La soustraction laisse donc un residu
        # STRICTEMENT NEGATIF de -1.42e-14, purement binaire.
        #
        # Sans la borne max(..., 0), round() le transforme en -0.0 et l'API
        # repondrait "saved_g": -0.0. L'assertion porte sur str() et non sur
        # ">= 0", car en Python -0.0 >= 0 vaut True : une comparaison
        # numerique ne verrait pas le probleme.
        resultat = calculer_empreinte([segment("CAR", 100), segment("CAR", 200)])

        assert str(resultat.saved_g) == "0.0"


# ---------------------------------------------------------------------------
# Itineraire multimodal
# ---------------------------------------------------------------------------
class TestItineraireMultimodal:
    def test_additionne_les_segments(self) -> None:
        # 600 m a pied puis 3200 m en bus.
        resultat = calculer_empreinte([segment("WALK", 600), segment("BUS", 3200)])

        assert resultat.total_distance_m == 3800
        assert resultat.total_co2_g == 361.6  # 3,2 km x 113
        assert resultat.car_co2_g == 828.4  # 3,8 km x 218
        assert resultat.saved_g == 466.8

    def test_detaille_chaque_segment_dans_le_breakdown(self) -> None:
        resultat = calculer_empreinte([segment("WALK", 600), segment("BUS", 3200)])

        assert len(resultat.breakdown) == 2
        assert resultat.breakdown[0].mode == ModeTransport.WALK
        assert resultat.breakdown[0].co2_g == 0
        assert resultat.breakdown[1].mode == ModeTransport.BUS
        assert resultat.breakdown[1].co2_g == 361.6

    def test_le_breakdown_conserve_l_ordre_des_segments(self) -> None:
        resultat = calculer_empreinte(
            [segment("METRO", 1000), segment("WALK", 500), segment("BUS", 2000)]
        )

        assert [d.mode for d in resultat.breakdown] == [
            ModeTransport.METRO,
            ModeTransport.WALK,
            ModeTransport.BUS,
        ]

    def test_la_somme_du_breakdown_egale_le_total(self) -> None:
        resultat = calculer_empreinte(
            [segment("BUS", 1500), segment("TRAM", 2500), segment("WALK", 700)]
        )

        somme = sum(d.co2_g for d in resultat.breakdown)
        assert somme == pytest.approx(resultat.total_co2_g)


# ---------------------------------------------------------------------------
# Cas limites
# ---------------------------------------------------------------------------
class TestCasLimites:
    def test_une_distance_nulle_n_emet_rien(self) -> None:
        resultat = calculer_empreinte([segment("BUS", 0)])

        assert resultat.total_distance_m == 0
        assert resultat.total_co2_g == 0
        assert resultat.car_co2_g == 0
        assert resultat.saved_g == 0

    def test_arrondit_la_sortie_a_deux_decimales(self) -> None:
        # 828,4 - 361,6 vaut 466.79999999999995 en arithmetique flottante.
        # L'arrondi de sortie evite d'exposer cet artefact binaire.
        resultat = calculer_empreinte([segment("WALK", 600), segment("BUS", 3200)])

        assert resultat.saved_g == 466.8
        assert str(resultat.saved_g) == "466.8"

    def test_le_calcul_interne_reste_precis(self) -> None:
        # L'arrondi n'intervient qu'a la sortie : les totaux ne derivent pas
        # a force d'additionner des valeurs deja arrondies.
        resultat = calculer_empreinte([segment("BUS", 333) for _ in range(3)])

        # 3 x 0,333 km x 113 = 112.887
        assert resultat.total_co2_g == pytest.approx(112.89, abs=0.01)


# ---------------------------------------------------------------------------
# Endpoint HTTP
# ---------------------------------------------------------------------------
class TestEndpointCalculate:
    def test_renvoie_200_et_le_resultat_complet(self) -> None:
        reponse = client.post(
            "/calculate",
            json={
                "segments": [
                    {"mode": "WALK", "distance_m": 600},
                    {"mode": "BUS", "distance_m": 3200},
                ]
            },
        )

        assert reponse.status_code == 200
        assert reponse.json() == {
            "total_distance_m": 3800,
            "total_co2_g": 361.6,
            "car_co2_g": 828.4,
            "saved_g": 466.8,
            # Ajoute a l'etape 4D-3-1 : 466,8 / 828,4 = 0,5635...
            "eco_score": 56.3,
            "breakdown": [
                {"mode": "WALK", "distance_m": 600, "co2_g": 0.0},
                {"mode": "BUS", "distance_m": 3200, "co2_g": 361.6},
            ],
        }

    def test_refuse_une_liste_vide(self) -> None:
        reponse = client.post("/calculate", json={"segments": []})

        assert reponse.status_code == 422

    def test_refuse_une_distance_negative(self) -> None:
        reponse = client.post(
            "/calculate",
            json={"segments": [{"mode": "BUS", "distance_m": -100}]},
        )

        assert reponse.status_code == 422

    def test_refuse_escooter_avec_un_message_explicite(self) -> None:
        reponse = client.post(
            "/calculate",
            json={"segments": [{"mode": "ESCOOTER", "distance_m": 1000}]},
        )

        assert reponse.status_code == 422
        # Le message doit expliquer POURQUOI, pas seulement refuser.
        assert "ESCOOTER" in reponse.text

    def test_refuse_un_mode_inexistant(self) -> None:
        reponse = client.post(
            "/calculate",
            json={"segments": [{"mode": "FUSEE", "distance_m": 1000}]},
        )

        assert reponse.status_code == 422

    def test_refuse_une_distance_non_numerique(self) -> None:
        reponse = client.post(
            "/calculate",
            json={"segments": [{"mode": "BUS", "distance_m": "beaucoup"}]},
        )

        assert reponse.status_code == 422

    def test_refuse_un_segment_sans_mode(self) -> None:
        reponse = client.post("/calculate", json={"segments": [{"distance_m": 1000}]})

        assert reponse.status_code == 422

    def test_refuse_un_corps_vide(self) -> None:
        reponse = client.post("/calculate", json={})

        assert reponse.status_code == 422


# ---------------------------------------------------------------------------
# EcoScore exposé par l'API (etape 4D-3-1)
# ---------------------------------------------------------------------------
class TestEcoScoreDansLApi:
    def calculer(self, segments: list[dict[str, object]]) -> dict[str, object]:
        reponse = client.post("/calculate", json={"segments": segments})
        assert reponse.status_code == 200
        corps: dict[str, object] = reponse.json()
        return corps

    def test_la_reponse_contient_un_eco_score(self) -> None:
        corps = self.calculer([{"mode": "BUS", "distance_m": 1000}])

        assert "eco_score" in corps

    def test_marche_puis_bus_donne_56_3(self) -> None:
        corps = self.calculer(
            [
                {"mode": "WALK", "distance_m": 600},
                {"mode": "BUS", "distance_m": 3200},
            ]
        )

        assert corps["eco_score"] == 56.3

    def test_la_voiture_donne_zero(self) -> None:
        corps = self.calculer([{"mode": "CAR", "distance_m": 8000}])

        assert corps["eco_score"] == 0.0

    def test_la_marche_donne_cent(self) -> None:
        corps = self.calculer([{"mode": "WALK", "distance_m": 2000}])

        assert corps["eco_score"] == 100.0

    def test_une_distance_nulle_donne_cent(self) -> None:
        # Convention documentee dans app/ecoscore.py.
        corps = self.calculer([{"mode": "BUS", "distance_m": 0}])

        assert corps["eco_score"] == 100.0

    def test_le_score_sort_avec_une_seule_decimale(self) -> None:
        # Contrairement aux grammes, arrondis a deux decimales (4D-1).
        corps = self.calculer([{"mode": "BUS", "distance_m": 1000}])

        assert corps["eco_score"] == 48.2
        assert round(float(str(corps["eco_score"])), 1) == corps["eco_score"]

    def test_les_autres_champs_gardent_leur_format(self) -> None:
        # L'ajout du score ne doit RIEN changer d'autre dans la reponse.
        corps = self.calculer(
            [
                {"mode": "WALK", "distance_m": 600},
                {"mode": "BUS", "distance_m": 3200},
            ]
        )

        assert corps["total_distance_m"] == 3800
        assert corps["total_co2_g"] == 361.6
        assert corps["car_co2_g"] == 828.4
        assert corps["saved_g"] == 466.8

    def test_escooter_reste_refuse_avant_tout_score(self) -> None:
        # Le mode est rejete par la validation : aucun EcoScore n'est produit,
        # et surtout aucune valeur n'est inventee pour un mode sans facteur.
        reponse = client.post(
            "/calculate",
            json={"segments": [{"mode": "ESCOOTER", "distance_m": 1000}]},
        )

        assert reponse.status_code == 422
        assert "eco_score" not in reponse.text


# ---------------------------------------------------------------------------
# Non-regression
# ---------------------------------------------------------------------------
def test_health_fonctionne_toujours() -> None:
    reponse = client.get("/health")

    assert reponse.status_code == 200
    assert reponse.json()["status"] == "ok"
