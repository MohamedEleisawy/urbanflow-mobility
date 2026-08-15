import { NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StopsService } from './stops.service';

describe('StopsService', () => {
  let service: StopsService;
  let prisma: {
    stop: { create: jest.Mock; findMany: jest.Mock; findUnique: jest.Mock };
  };

  const gareDuNord = {
    id: 'stop-1',
    name: 'Gare du Nord',
    latitude: 48.8809,
    longitude: 2.3553,
    pmrAccessible: true,
    operatorCode: 'RATP',
  };

  beforeEach(() => {
    prisma = {
      stop: { create: jest.fn(), findMany: jest.fn(), findUnique: jest.fn() },
    };
    service = new StopsService(prisma as unknown as PrismaService);
  });

  it('crée un arrêt', async () => {
    prisma.stop.create.mockResolvedValue(gareDuNord);

    const dto = {
      name: 'Gare du Nord',
      latitude: 48.8809,
      longitude: 2.3553,
      pmrAccessible: true,
      operatorCode: 'RATP',
    };

    const result = await service.create(dto);

    // Les données transmises à Prisma sont exactement celles reçues.
    expect(prisma.stop.create).toHaveBeenCalledWith({ data: dto });
    expect(result).toEqual(gareDuNord);
  });

  it('liste les arrêts par ordre alphabétique', async () => {
    prisma.stop.findMany.mockResolvedValue([gareDuNord]);

    await service.findAll();

    expect(prisma.stop.findMany).toHaveBeenCalledWith({
      orderBy: { name: 'asc' },
    });
  });

  it('renvoie un arrêt existant', async () => {
    prisma.stop.findUnique.mockResolvedValue(gareDuNord);

    await expect(service.findOne('stop-1')).resolves.toEqual(gareDuNord);
  });

  it("lève 404 quand l'arrêt n'existe pas", async () => {
    prisma.stop.findUnique.mockResolvedValue(null);

    await expect(service.findOne('inconnu')).rejects.toThrow(NotFoundException);
  });
});
