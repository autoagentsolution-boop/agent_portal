import { Body, Controller, Headers, HttpCode, Post, UnauthorizedException } from '@nestjs/common';
import { Public } from '../../auth/public.decorator.js';
import { ExecutionsService } from '../executions/executions.service.js';
import { N8nCallbackSchema } from './dto/callback.dto.js';
import { N8nService } from './n8n.service.js';

@Controller('n8n')
export class N8nController {
  constructor(
    private readonly n8n: N8nService,
    private readonly executions: ExecutionsService,
  ) {}

  @Post('callback')
  @Public()
  @HttpCode(200)
  async callback(
    @Body() body: unknown,
    @Headers('x-demo-callback-secret') secret: string | undefined,
  ) {
    if (!this.n8n.validateCallbackSecret(secret)) {
      throw new UnauthorizedException('Invalid callback secret');
    }
    const dto = N8nCallbackSchema.parse(body);
    await this.executions.updateFromCallback(dto);
    return { received: true };
  }
}
