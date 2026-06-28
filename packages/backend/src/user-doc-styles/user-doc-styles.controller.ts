import { Body, Controller, Get, Put, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/jwt-auth.guard';
import { AuthenticatedRequest } from 'src/auth/auth.types';
import { UserDocStylesService } from './user-doc-styles.service';
import { UpdateUserDocStylesDto } from './user-doc-styles.dto';

@Controller('auth/me/doc-styles')
@UseGuards(JwtAuthGuard)
export class UserDocStylesController {
  constructor(private readonly userDocStylesService: UserDocStylesService) {}

  @Get()
  async getDocStyles(
    @Req() req: AuthenticatedRequest,
  ): Promise<{ styles: unknown }> {
    const styles = await this.userDocStylesService.get(Number(req.user.id));
    return { styles };
  }

  @Put()
  async updateDocStyles(
    @Req() req: AuthenticatedRequest,
    @Body() body: UpdateUserDocStylesDto,
  ): Promise<{ styles: unknown }> {
    const userId = Number(req.user.id);
    await this.userDocStylesService.upsert(userId, body.styles);
    return { styles: body.styles };
  }
}
