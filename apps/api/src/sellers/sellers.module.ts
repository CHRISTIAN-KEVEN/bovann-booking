import { Module } from '@nestjs/common';
import { ENV } from '../config/config.module';
import { createOtpSender, OTP_SENDER } from './otp-sender';
import { SellerAuthController } from './seller-auth.controller';
import { SellerAuthGuard } from './seller-auth.guard';
import { SellerAuthService } from './seller-auth.service';

/** Sellers of the live directory: sign-in with a code by WhatsApp or SMS. */
@Module({
  controllers: [SellerAuthController],
  providers: [
    SellerAuthService,
    SellerAuthGuard,
    { provide: OTP_SENDER, useFactory: createOtpSender, inject: [ENV] },
  ],
  exports: [SellerAuthService, SellerAuthGuard],
})
export class SellersModule {}
