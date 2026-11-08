import { Injectable } from '@nestjs/common';
import type {
  InitiatePaymentInput,
  InitiatePaymentResult,
  PaymentGateway,
} from './payment-gateway';

/**
 * Simulated provider for development, tests and demos. Nothing is charged.
 * The outcome is decided by calling the development-only endpoints
 * POST /api/v1/dev/payments/:reference/succeed|fail (see DevPaymentsController).
 * The environment validation refuses this adapter in production.
 */
@Injectable()
export class MockPaymentGateway implements PaymentGateway {
  readonly name = 'mock';

  async initiate(input: InitiatePaymentInput): Promise<InitiatePaymentResult> {
    const instructions =
      input.method === 'MOBILE_MONEY'
        ? `Paiement simulé : une demande de ${input.amountXof} FCFA aurait été envoyée au ${input.payerPhone}.`
        : 'Paiement par carte simulé.';
    return { providerRef: `mock_${input.idempotencyKey}`, instructions, redirectUrl: null };
  }
}
