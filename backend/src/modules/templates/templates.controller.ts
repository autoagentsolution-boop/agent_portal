import { Controller, Get, Param } from '@nestjs/common';
import { TemplatesService } from './templates.service.js';

@Controller('agent-templates')
export class TemplatesController {
  constructor(private readonly service: TemplatesService) {}

  @Get()
  findAll() {
    return this.service.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }
}
