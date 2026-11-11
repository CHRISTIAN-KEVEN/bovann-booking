/**
 * Sellers of the live directory: sign-in with a one-time code sent to their phone
 * (WhatsApp, or SMS), no password.
 */

/** Every state-changing seller request must carry this header (CSRF protection). */
export const SELLER_CSRF_HEADER = 'X-Bovann-Seller';

export const OTP_CHANNELS = ['WHATSAPP', 'SMS'] as const;
export type OtpChannel = (typeof OTP_CHANNELS)[number];

export const OTP_LENGTH = 6;

/** POST /seller/auth/code */
export interface SellerCodeRequest {
  /** E.164, e.g. "+22890123456". */
  phone: string;
  channel: OtpChannel;
}

export interface SellerCodeResponse {
  phone: string;
  channel: OtpChannel;
  /** The code stops working after this many seconds. */
  expiresInSec: number;
  /** A new code can be asked for after this many seconds. */
  resendInSec: number;
  /**
   * Development only, with simulated sending: the code itself, so it can be typed without a
   * phone. Never present in production (the API refuses to start with simulated sending there).
   */
  devCode?: string;
}

/** POST /seller/auth/verify */
export interface SellerVerifyRequest {
  phone: string;
  code: string;
}

export interface SellerMe {
  id: number;
  phone: string;
}
