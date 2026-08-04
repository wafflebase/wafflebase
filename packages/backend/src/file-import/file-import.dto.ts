import { IsNotEmpty, IsString, Matches } from 'class-validator';
import { VALID_IMPORT_FILE_ID_PATTERN } from '../file/file.constants';

export class PreviewFileImportDto {
  /**
   * Blob id returned by the import upload route. Pattern-checked here as well
   * as in the service: it is interpolated into an S3 key and a temp-file name,
   * and a random UUID with a data extension is the only shape either should
   * see. The import pattern, not the document one — a pdf/image blob is not
   * something this endpoint may reach into.
   */
  @IsString()
  @IsNotEmpty()
  @Matches(VALID_IMPORT_FILE_ID_PATTERN)
  fileId!: string;
}
