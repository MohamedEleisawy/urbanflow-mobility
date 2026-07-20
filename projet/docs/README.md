# Documentation technique — UrbanFlow Mobility

## Sources de vérité

La conception fonctionnelle et les diagrammes UML font foi et ne sont pas
redéfinis ici. Ils se trouvent dans [`../../dossier/`](../../dossier/) :

| Document                                        | Contenu                                        |
| ----------------------------------------------- | ---------------------------------------------- |
| `diagrammes/01_use_case.puml`                    | Cas d'utilisation (visiteur, usager, admin)    |
| `diagrammes/02_sequence_itineraire.puml`         | Séquence de recherche d'itinéraire avec cache  |
| `diagrammes/03_class_domain.puml`                | Modèle du domaine métier                       |
| `et6.pdf`                                        | Dossier de conception complet                  |

## Modèle du domaine (rappel)

Entités issues du diagramme de classes, à implémenter fidèlement :

- **User** — bcrypt (coût 12), suppression logique, export RGPD (art. 20)
- **UserPreferences** — modes préférés, mode PMR, budget CO₂ hebdomadaire, thème, langue
- **Route** — origine/destination (`GeoPoint`), durée, distance, EcoScore, estimation carbone
- **Segment** — un tronçon d'itinéraire, rattaché à un mode de transport et à deux arrêts
- **Stop** — arrêt géolocalisé, accessibilité PMR
- **GeoPoint** — objet-valeur latitude/longitude, compatible PostGIS
- **CarbonRecord** — émissions d'un trajet, calculées sur la Base Carbone® ADEME
- **CarbonBudget** — budget hebdomadaire et consommation associée
- **Alert** — perturbations issues du flux GTFS-Realtime

### Facteurs d'émission (ADEME Base Carbone®)

| Mode   | gCO₂e / km |
| ------ | ---------- |
| WALK   | 0          |
| BIKE   | 0          |
| TRAM   | 4          |
| METRO  | 4          |
| BUS    | 113        |
| CAR    | 218        |

**EcoScore** : 100 = mobilité douce, 0 = voiture individuelle. Calculé à partir
des émissions, de la distance et du mode de transport.

## Décisions d'architecture

Les décisions structurantes sont consignées dans [`adr/`](adr/).
