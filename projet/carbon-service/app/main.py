"""Point d'entrée ASGI du microservice carbone.

Le service expose deux endpoints :

  GET  /health     verifie que le service demarre (etape 1) ;
  POST /calculate  calcule l'empreinte carbone d'un itineraire (etape 4D-1).

Le calcul est SANS ETAT : aucune base de donnees, aucun utilisateur, aucun
appel reseau sortant. Le microservice recoit une liste de segments et renvoie
des grammes de CO2. L'enregistrement d'un trajet dans l'historique personnel
(CarbonRecord) releve de l'etape 4E et du backend NestJS, pas d'ici.

Depuis l'etape 4D-3-1, la reponse porte aussi un EcoScore de 0 a 100. Il est
calcule ici, et non dans NestJS, pour la meme raison que les emissions : tout
ce qui touche a l'environnement vit dans un seul service. Voir app/ecoscore.py.
"""

from fastapi import FastAPI
from pydantic import BaseModel

from app import __version__
from app.carbon import calculer_empreinte
from app.config import Settings, get_settings
from app.models import CalculationIn, CalculationOut


class HealthResponse(BaseModel):
    """Réponse renvoyée par l'endpoint de santé."""

    status: str
    service: str
    version: str
    environment: str


def create_app() -> FastAPI:
    """Construit l'application FastAPI (factory : facilite les tests)."""
    settings: Settings = get_settings()

    app = FastAPI(
        title=settings.app_name,
        version=__version__,
        description="Calculateur d'empreinte carbone du projet UrbanFlow Mobility.",
    )

    @app.get("/health", response_model=HealthResponse, tags=["monitoring"])
    def health() -> HealthResponse:
        """Vérifie que le service est opérationnel."""
        return HealthResponse(
            status="ok",
            service=settings.app_name,
            version=__version__,
            environment=settings.environment,
        )

    @app.post("/calculate", response_model=CalculationOut, tags=["carbone"])
    def calculate(requete: CalculationIn) -> CalculationOut:
        """Calcule l'empreinte carbone d'un itineraire.

        FastAPI valide le corps de la requete contre CalculationIn AVANT
        d'entrer dans cette fonction : une liste vide, une distance negative,
        un mode inconnu ou un mode sans facteur d'emission produisent donc
        automatiquement une reponse 422, sans qu'aucun calcul ne demarre.
        """
        return calculer_empreinte(requete.segments)

    return app


app = create_app()
