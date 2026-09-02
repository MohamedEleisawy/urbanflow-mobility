"""GET /factors : la table des facteurs est publiee, jamais dupliquee."""

from fastapi.testclient import TestClient

from app.factors import FACTEUR_VOITURE_G_PAR_KM, FACTEURS_G_PAR_KM, ModeTransport
from app.main import create_app

client = TestClient(create_app())


def test_factors_expose_exactement_la_table_interne() -> None:
    """La reponse EST la table du module, pas une copie ecrite a la main."""
    corps = client.get("/factors").json()

    attendu = {mode.value: facteur for mode, facteur in FACTEURS_G_PAR_KM.items()}

    assert corps["factors"] == attendu


def test_factors_repond_200() -> None:
    assert client.get("/factors").status_code == 200


def test_facteur_voiture_publie() -> None:
    corps = client.get("/factors").json()

    assert corps["car_factor_g_per_km"] == FACTEUR_VOITURE_G_PAR_KM


def test_escooter_est_absent_et_non_a_zero() -> None:
    """Un mode sans facteur ne doit pas passer pour un mode propre."""
    corps = client.get("/factors").json()

    assert ModeTransport.ESCOOTER.value not in corps["factors"]


def test_les_modes_du_reseau_sont_tous_calculables() -> None:
    """Les modes reellement importes doivent avoir un facteur."""
    corps = client.get("/factors").json()

    for mode in ("WALK", "TRAM", "METRO", "TRAIN", "BUS"):
        assert mode in corps["factors"], f"{mode} n'a pas de facteur d'emission"
