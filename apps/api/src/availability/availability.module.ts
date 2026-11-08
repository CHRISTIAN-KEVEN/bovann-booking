import { Module } from '@nestjs/common';
import { AvailabilityService } from './availability.service';
import { CatalogRepository } from './catalog.repository';
import { SpacesController } from './spaces.controller';

@Module({
  controllers: [SpacesController],
  providers: [AvailabilityService, CatalogRepository],
  exports: [AvailabilityService, CatalogRepository],
})
export class AvailabilityModule {}
