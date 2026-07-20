"""Point d'entrée ASGI du microservice carbone.

A ce stade (étape 1 du projet), le service expose uniquement un endpoint de
santé permettant de vérifier qu'il démarre correctement. La logique métier
(distance, émissions CO2, EcoScore) sera ajoutée dans une étape ultérieure.
"""

from fastapi import FastAPI
from pydantic import BaseModel

from app import __version__
from app.config import Settings, get_settings


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

    return app


app = create_app()
