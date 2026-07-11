import { DocumentService } from './document.service';
import { PrismaService } from 'src/database/prisma.service';

describe('DocumentService.updateDocument', () => {
  let update: jest.Mock;
  let service: DocumentService;

  beforeEach(() => {
    update = jest.fn().mockResolvedValue({ id: 'd1' });
    service = new DocumentService({
      document: { update },
    } as unknown as PrismaService);
  });

  it('advances updatedAt on a real metadata update (rename)', async () => {
    await service.updateDocument({ where: { id: 'd1' }, data: { title: 'New' } });
    const arg = update.mock.calls[0][0] as {
      data: { title?: string; updatedAt?: Date };
    };
    expect(arg.data.title).toBe('New');
    expect(arg.data.updatedAt).toBeInstanceOf(Date);
  });

  it('does not bump updatedAt for an empty / no-op update', async () => {
    // An empty-body PATCH must not re-sort the doc to the top of the list.
    await service.updateDocument({ where: { id: 'd1' }, data: {} });
    const arg = update.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(arg.data).not.toHaveProperty('updatedAt');
    expect(Object.keys(arg.data)).toHaveLength(0);
  });
});
