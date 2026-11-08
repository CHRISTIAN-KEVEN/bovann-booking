# Payment providers — analysis & recommendation

_2026-11-08 · Decisions answered by the product owner: merchant = Bovann Group (Togo); customers first from Togo and neighbouring West African countries, then the rest of Africa, then beyond; Bovann Group requests quotes and opens the merchant account._

## 1. The constraint that drives everything

- A provider onboards a **merchant** based on the country where the merchant's company is registered (KYC: RCCM, NIF, ID of the legal representative, local bank account).
- **Customers** can pay from anywhere, but only with the methods the provider supports:
  - **Cards (Visa/Mastercard)** work across borders.
  - **Mobile money** is country-specific: it only works if the provider is connected to that country's operator.

## 2. Findings

| Provider                   | Onboards a Togo merchant?                         | Togo mobile money                 | Other African mobile money                   | Cards                            | Notes / risks                                                                  |
| -------------------------- | ------------------------------------------------- | --------------------------------- | -------------------------------------------- | -------------------------------- | ------------------------------------------------------------------------------ |
| **FedaPay**                | Yes (launched in Togo)                            | Moov/Flooz, T-Money (Mixx by Yas) | Benin, CI, Senegal, Niger, Guinea, Mali, BF… | Yes                              | Refunds/cancellations not available by API (manual in dashboard)               |
| **PayDunya**               | Yes (Togo since 2023)                             | T-Money, Flooz                    | Senegal, CI, Benin…                          | Unconfirmed: to check with sales | Fees ~1.5–2%                                                                   |
| **Hub2**                   | Yes                                               | T-Money, Flooz                    | 9–12 countries in West & Central Africa      | Yes                              | Single API across countries; sales-led onboarding                              |
| **CinetPay**               | Yes                                               | T-Money, Flooz                    | ~10 francophone countries                    | Yes                              | ⚠️ 2025 fraud incident hit CI, Togo and BF; delayed merchant payouts into 2026 |
| **PayGate Global**         | Yes (Togolese)                                    | Flooz, T-Money                    | None                                         | **No**                           | Togo only; refunds not available by API                                        |
| **Moneroo** (orchestrator) | Yes (UEMOA)                                       | Moov Togo, Togocel                | Many (routes to several gateways)            | Cards in UEMOA incl. Togo        | Adds a dependency layer                                                        |
| **Flutterwave**            | Doubtful (needs a company in a supported country) | XOF mobile money                  | 30+ countries                                | Yes                              | –                                                                              |
| **Paystack**               | **No** (merchants only in NG, GH, ZA, KE, CI, RW) | –                                 | GH, KE, CI                                   | Yes                              | –                                                                              |
| **pawaPay**                | Togo not in its listed countries                  | –                                 | ~19–20 countries                             | No                               | Mobile money only                                                              |
| **Stripe**                 | **No** (Togo not supported)                       | –                                 | –                                            | –                                | Only via a foreign entity                                                      |
| **PayPal**                 | Receiving restricted for Togolese merchants       | –                                 | –                                            | –                                | –                                                                              |

## 3. Conclusion

No single provider covers "all of Africa and beyond" for a merchant registered in Togo. The coverage model:

1. **Togo and UEMOA customers** pay with local mobile money through a UEMOA-licensed aggregator.
2. **Customers anywhere else** pay by **international card** through the same aggregator, billed in XOF.
3. **Later, if demand justifies it:** add mobile money for specific non-UEMOA countries through a second provider.

## 4. Recommendation

- **Architecture:** a provider-agnostic `PaymentGateway` interface (initiate, verify, handle webhook, refund), one adapter per provider, routing by method and country, idempotent verified webhooks, and a reconciliation job.
- **Launch provider:** given the customer priorities (Togo + neighbours first), **Hub2 or FedaPay**, with PayDunya as a third quote.
- **Questions for each provider:** international Visa/Mastercard with 3-D Secure? Fees per method, settlement delay, reserves? Refund API? BCEAO licence and segregation of merchant funds? Sandbox, webhook signatures, SLA?
- **Not at launch:** CinetPay, until its settlement problems are clearly resolved. Flutterwave, Paystack, pawaPay and Stripe would need a foreign entity.

Development isn't blocked: the payment module is built against the interface with a mock provider (Phase 4).

## Sources

- [Kolonell: Integrating mobile payment in Togo 2026](https://kolonell.com/en/blog/integrate-mobile-payment-togo-tmoney-flooz-2026)
- [FedaPay launches in Togo (republicoftogo.com)](https://www.republicoftogo.com/toutes-les-rubriques/eco-finance/fedapay-se-lance-au-togo)
- [FedaPay coverage via EasySwitch docs](https://alldotpy.github.io/EasySwitch/integrations/fedapay)
- [PayGate Global via EasySwitch docs](https://alldotpy.github.io/EasySwitch/integrations/paygate)
- [Hub2 (CB Insights)](https://www.cbinsights.com/investor/hub2)
- [Moneroo coverage](https://moneroo.io/en/coverage)
- [CinetPay CEO interview, March 2026 (Financial Afrik)](https://www.financialafrik.com/2026/03/25/entretien-exclusif-avec-daniel-dindji-directeur-general-de-cinetpay/)
- [CinetPay owes >1bn FCFA after cyberattack (Osiris)](https://www.osiris.sn/apres-une-cyberattaque-cinetpay-doit-plus-d-un-milliard-de-francs-cfa-a-des.html)
- [Flutterwave availability (learnwithhasan)](https://learnwithhasan.com/payment-gateways/flutterwave/)
- [Paystack country coverage (mctaba)](https://mctaba.com/learn/paystack/paystack-by-country-nigeria-ghana-south-africa-kenya-rwanda-cote-d-ivoire)
- [pawaPay countries](https://pawapay.io/index.html)
- [Stripe not supported in Togo (doola)](https://www.doola.com/stripe-guide/how-to-open-a-stripe-account-in-togo/)
