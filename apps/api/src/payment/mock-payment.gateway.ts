import { formatXof } from '@bovann/shared';
import { Injectable } from '@nestjs/common';
import { currentLocale } from '../common/request-context';
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
    const en = currentLocale() === 'en';
    const instructions =
      input.method === 'MOBILE_MONEY'
        ? en
          ? `Simulated payment: a request for ${formatXof(input.amountXof, 'en')} would have been sent to ${input.payerPhone}.`
          : `Paiement simulé : une demande de ${input.amountXof} FCFA aurait été envoyée au ${input.payerPhone}.`
        : en
          ? 'Simulated card payment.'
          : 'Paiement par carte simulé.';
    return { providerRef: `mock_${input.idempotencyKey}`, instructions, redirectUrl: null };
  }
}
