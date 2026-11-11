import { Module } from '@nestjs/common';
import { SellersModule } from '../sellers/sellers.module';
import { LivesController } from './lives.controller';
import { LivesService } from './lives.service';
import { SellerLivesController } from './seller-lives.controller';

/** Live directory "En direct": the public wall and sellers' lives (admin routes live in AdminModule). */
@Module({
  imports: [SellersModule],
  controllers: [LivesController, SellerLivesController],
  providers: [LivesService],
  exports: [LivesService],
})
export class LivesModule {}
