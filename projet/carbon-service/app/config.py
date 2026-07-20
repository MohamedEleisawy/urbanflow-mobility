"""Configuration du microservice, chargée depuis l'environnement.

Aucune valeur sensible n'est codée en dur : tout provient de variables
d'environnement (voir `.env.example` a la racine du monorepo).
"""

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Parametres applicatifs validés au démarrage par Pydantic."""

    model_config = SettingsConfigDict(env_prefix="CARBON_", env_file=".env", extra="ignore")

    app_name: str = "UrbanFlow Carbon Service"
    environment: str = "development"
    host: str = "0.0.0.0"  # noqa: S104 - conteneur, exposition maitrisée par Docker
    port: int = 8000


@lru_cache
def get_settings() -> Settings:
    """Retourne les paramètres en cache (une seule lecture de l'environnement)."""
    return Settings()
