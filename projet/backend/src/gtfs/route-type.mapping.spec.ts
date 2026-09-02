import { ModeTransport } from '@prisma/client';
import { describeRouteType, mapRouteType } from './route-type.mapping';

describe('mapRouteType', () => {
  it('traduit les trois types dont l’équivalent est indiscutable', () => {
    expect(mapRouteType(0)).toBe(ModeTransport.TRAM);
    expect(mapRouteType(1)).toBe(ModeTransport.METRO);
    expect(mapRouteType(3)).toBe(ModeTransport.BUS);
  });

  it('traduit le TRAIN, ajouté avec le réseau ferré', () => {
    // ⚠️ `route_type = 2` rendait `null` : les 24 lignes ferroviaires du flux
    // réel — RER A à E, Transilien, TER — étaient rejetées à l'import. Le
    // mode `TRAIN` a été ajouté avec son facteur carbone, et ces lignes sont
    // désormais routables.
    expect(mapRouteType(2)).toBe(ModeTransport.TRAIN);
  });

  it('renvoie null pour le ferry', () => {
    // ModeTransport ne contient pas de FERRY, et le flux d'Île-de-France
    // n'en publie aucun : rien ne justifierait de l'ajouter.
    expect(mapRouteType(4)).toBeNull();
  });

  it('renvoie null pour les autres modes GTFS', () => {
    expect(mapRouteType(5)).toBeNull(); // tramway à câble
    expect(mapRouteType(6)).toBeNull(); // télécabine
    expect(mapRouteType(7)).toBeNull(); // funiculaire
    expect(mapRouteType(12)).toBeNull(); // monorail
  });

  it('ne devine pas le trolleybus', () => {
    // Un trolleybus EST un autobus dans l'usage courant, mais le traduire
    // relèverait de l'interprétation. On préfère le signaler que le deviner.
    expect(mapRouteType(11)).toBeNull();
  });

  it('renvoie null pour un type inconnu', () => {
    expect(mapRouteType(999)).toBeNull();
    expect(mapRouteType(-1)).toBeNull();
  });
});

describe('describeRouteType', () => {
  it('donne un libellé lisible pour le bilan', () => {
    expect(describeRouteType(2)).toBe('2 (train)');
    expect(describeRouteType(4)).toBe('4 (ferry)');
  });

  it('reste explicite pour un type non répertorié', () => {
    expect(describeRouteType(999)).toBe('999 (inconnu)');
  });
});
