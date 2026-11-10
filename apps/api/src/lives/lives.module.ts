import { Module } from '@nestjs/common';
import { LivesController } from './lives.controller';
import { LivesService } from './lives.service';

/** Live directory "En direct": the public wall (admin routes live in AdminModule). */
@Module({
  controllers: [LivesController],
  providers: [LivesService],
  exports: [LivesService],
})
export class LivesModule {}
