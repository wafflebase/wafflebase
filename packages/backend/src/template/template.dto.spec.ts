import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { BrowseTemplatesDto, PublishTemplateDto } from './template.dto';

async function hasCategoryError(
  cls: typeof PublishTemplateDto | typeof BrowseTemplatesDto,
  category: unknown,
): Promise<boolean> {
  const dto = plainToInstance(cls, { scope: 'public', category });
  const errors = await validate(dto);
  return errors.some((e) => e.property === 'category');
}

describe('template DTO category', () => {
  it('accepts a top and a top/leaf slug on publish', async () => {
    expect(await hasCategoryError(PublishTemplateDto, 'work')).toBe(false);
    expect(await hasCategoryError(PublishTemplateDto, 'work/meeting')).toBe(
      false,
    );
  });

  it('refuses a v1 label and an unknown slug on publish', async () => {
    // Writes are slug-only: accepting a label here would keep writing the
    // vocabulary the data migration just retired.
    expect(await hasCategoryError(PublishTemplateDto, 'Business')).toBe(true);
    expect(await hasCategoryError(PublishTemplateDto, 'work/unknown')).toBe(
      true,
    );
  });

  it('accepts slugs and v1 labels on browse, nothing else', async () => {
    expect(await hasCategoryError(BrowseTemplatesDto, 'finance/budget')).toBe(
      false,
    );
    expect(
      await hasCategoryError(BrowseTemplatesDto, 'Project management'),
    ).toBe(false);
    expect(await hasCategoryError(BrowseTemplatesDto, 'Gardening')).toBe(true);
  });
});
