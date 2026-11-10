/**
 * English versions of the API's French messages, keyed by the French text (the reference). The
 * error filter uses them when the request asks for English (Accept-Language). Messages built
 * with values are thrown with both languages instead (see `ApiError`).
 *
 * A French message missing here is sent in French, and logged so it can be added.
 */
export const MESSAGES_EN: Readonly<Record<string, string>> = {
  // Generic
  'Requête invalide.': 'Invalid request.',
  'Ressource introuvable.': 'Not found.',
  'Méthode non autorisée.': 'Method not allowed.',
  'Une erreur interne est survenue. Veuillez réessayer.':
    'Something went wrong on our side. Please try again.',
  'Trop de requêtes. Patientez un instant avant de réessayer.':
    'Too many requests. Wait a moment and try again.',

  // Spaces, availability, pricing
  'Cet espace est introuvable.': 'This space can’t be found.',
  'Les tarifs de cet espace ne sont pas encore disponibles.':
    'Prices for this space aren’t available yet.',
  'Espace invalide.': 'Invalid space.',
  'Identifiant d’espace invalide.': 'Invalid space identifier.',
  'Date invalide (format AAAA-MM-JJ).': 'Invalid date (format YYYY-MM-DD).',
  'Le paramètre « mode » est obligatoire : IN_PERSON (en studio) ou VIRTUAL (virtuel).':
    'The “mode” parameter is required: IN_PERSON (in studio) or VIRTUAL.',
  'Le paramètre « month » est obligatoire (format AAAA-MM).':
    'The “month” parameter is required (format YYYY-MM).',
  'Mode invalide.': 'Invalid mode.',

  // Bookings (customers)
  'Trop de créneaux sélectionnés en une seule réservation.':
    'Too many times chosen in one booking.',
  'Un des créneaux choisis n’existe pas pour cette date.':
    'One of the chosen times doesn’t exist on that date.',
  'Choisissez au moins un créneau.': 'Choose at least one time.',
  'Choisissez des créneaux ou un forfait.': 'Choose times or a package.',
  'Sélection invalide.': 'Invalid selection.',
  'Ce forfait n’existe plus.': 'This package no longer exists.',
  'Choisissez « En studio » ou « Virtuel ».': 'Choose “In studio” or “Virtual”.',
  'Choisissez un moyen de paiement.': 'Choose a payment method.',
  'Moyen de paiement invalide.': 'Invalid payment method.',
  'Choisissez T-Money ou Flooz.': 'Choose T-Money or Flooz.',
  'Vous devez accepter les conditions de réservation.': 'You must accept the booking terms.',
  'Adresse e-mail invalide.': 'Invalid email address.',
  'Description trop longue (1000 caractères maximum).':
    'Description too long (1,000 characters maximum).',
  'Réservation introuvable.': 'Booking not found.',
  'Aucune réservation ne correspond à cette référence et à ce numéro.':
    'No booking matches this reference and phone number.',
  'Référence invalide.': 'Invalid reference.',
  'La référence est obligatoire.': 'The reference is required.',
  'Le numéro de téléphone est obligatoire.': 'The phone number is required.',
  'Jeton de réservation manquant.': 'Missing booking token.',
  'Cette réservation est déjà confirmée : contactez le studio pour toute modification.':
    'This booking is already confirmed: contact the studio to change it.',
  'Cette réservation n’est plus active : elle ne peut pas être annulée.':
    'This booking is no longer active: it can’t be cancelled.',
  'Le service de paiement ne répond pas. Vos créneaux ont été libérés ; réessayez dans un instant.':
    'The payment service isn’t answering. Your times were released; try again in a moment.',
  'La vérification de sécurité a échoué. Rechargez la page et réessayez.':
    'The security check failed. Reload the page and try again.',
  'La vérification de sécurité est momentanément indisponible. Réessayez dans un instant.':
    'The security check is unavailable right now. Try again in a moment.',
  'Le reçu est disponible une fois la réservation confirmée.':
    'The receipt is available once the booking is confirmed.',

  // Admin: sign-in and accounts
  'E-mail ou mot de passe incorrect.': 'Wrong email or password.',
  'Trop de tentatives de connexion. Patientez une minute avant de réessayer.':
    'Too many sign-in attempts. Wait a minute before trying again.',
  'Votre session a expiré. Connectez-vous à nouveau.': 'Your session has expired. Sign in again.',
  'Choisissez votre propre mot de passe pour continuer.': 'Choose your own password to continue.',
  'Cette action est réservée aux administrateurs.': 'Only administrators can do this.',
  'Requête refusée : rechargez la page et réessayez.':
    'Request refused: reload the page and try again.',
  'Le mot de passe actuel est incorrect.': 'The current password is wrong.',
  'Choisissez un mot de passe différent de l’actuel.':
    'Choose a password different from the current one.',
  'Indiquez votre adresse e-mail.': 'Enter your email address.',
  'Indiquez votre mot de passe.': 'Enter your password.',
  'Indiquez votre mot de passe actuel.': 'Enter your current password.',
  'Un compte existe déjà avec cette adresse e-mail.': 'An account already uses this email address.',
  'Ce compte n’existe pas.': 'This account doesn’t exist.',
  'Vous ne pouvez pas retirer vos propres droits ni désactiver votre compte.':
    'You can’t remove your own rights or deactivate your own account.',
  'Il doit toujours rester au moins un administrateur actif.':
    'There must always be at least one active administrator.',
  'Pour votre propre compte, utilisez « Changer mon mot de passe ».':
    'For your own account, use “Change my password”.',
  'Rôle invalide.': 'Invalid role.',

  // Admin: bookings, payments, refunds
  'Client introuvable.': 'Customer not found.',
  'Cette réservation est déjà payée.': 'This booking is already paid.',
  'Aucun paiement n’est attendu pour cette réservation.':
    'No payment is expected for this booking.',
  'Aucun remboursement n’est en attente pour cette réservation.':
    'No refund is pending for this booking.',
  'Indiquez si la réservation est payée.': 'Say whether the booking is paid.',
  'Montant invalide.': 'Invalid amount.',
  'Cet espace est désactivé : réactivez-le pour réserver.':
    'This space is deactivated: reactivate it to book.',

  // Admin: planning, blocks, closures, hours
  'Un des créneaux choisis est déjà réservé ou bloqué. Actualisez le planning.':
    'One of the chosen times is already booked or blocked. Refresh the schedule.',
  'Un créneau déjà terminé ne peut pas être bloqué.':
    'A time that has already ended can’t be blocked.',
  'Un des créneaux tombe pendant une fermeture.': 'One of the times falls during a closure.',
  'Ce blocage n’existe plus.': 'This block no longer exists.',
  'Cette fermeture n’existe plus.': 'This closure no longer exists.',
  'Cette fermeture est entièrement dans le passé.': 'This closure is entirely in the past.',
  'Indiquez l’heure de début et l’heure de fin.': 'Enter the start and end times.',
  'La fin de la fermeture doit suivre son début.': 'The closure must end after it starts.',
  'La date de fin doit suivre la date de début.': 'The end date must come after the start date.',
  'Indiquez les horaires des 7 jours de la semaine.': 'Enter the hours for all 7 days of the week.',
  'Horaire invalide.': 'Invalid time.',
  'Période invalide.': 'Invalid period.',
  'Période trop longue (2 ans maximum).': 'Period too long (2 years maximum).',
  'Proposez au moins un mode : en studio ou virtuel.':
    'Offer at least one mode: in studio or virtual.',
  'Le nombre de créneaux doit être entre 1 et 20.': 'The number of slots must be between 1 and 20.',
  'Délai invalide.': 'Invalid delay.',
  'Délai trop long (7 jours maximum).': 'Delay too long (7 days maximum).',
  'Le délai de paiement doit être d’au moins 2 minutes.':
    'The time to pay must be at least 2 minutes.',
  'Le délai de paiement ne peut pas dépasser 15 minutes.':
    'The time to pay can’t be more than 15 minutes.',

  // Admin: packages and prices
  'Un forfait « journée » existe déjà pour cet espace.':
    'This space already has a full-day package.',
  'Un forfait ne peut pas devenir ou cesser d’être un forfait « journée » : créez-en un nouveau.':
    'A package can’t become or stop being a full-day package: create a new one.',
  'Un forfait actif doit avoir un prix pour au moins un mode.':
    'An active package needs a price for at least one mode.',
  'Indiquez un prix pour au moins un mode.': 'Enter a price for at least one mode.',
  'Prix trop bas (100 FCFA minimum).': 'Price too low (100 FCFA minimum).',
  'Prix trop élevé.': 'Price too high.',

  // Admin: emails
  'Cette adresse reçoit déjà les notifications.': 'This address already gets the notifications.',
  'Cette adresse n’existe plus.': 'This address no longer exists.',
  'Cet e-mail est introuvable.': 'This email can’t be found.',
  'Cet e-mail est déjà envoyé.': 'This email has already been sent.',
  'L’envoi des e-mails n’est pas encore configuré sur le serveur.':
    'Email sending isn’t set up on the server yet.',
  // Found by the catalog check
  'Aucun paiement n’a été reçu : il n’y a rien à rembourser.':
    'No payment was received: there is nothing to refund.',
  'Ce forfait n’est pas disponible.': 'This package isn’t available.',
  'Ce forfait n’est plus disponible à cette heure. Choisissez une autre heure de début.':
    'This package is no longer available at that time. Choose another start time.',
  'Ce mot de passe est trop simple.': 'This password is too simple.',
  'Date invalide : utilisez le format AAAA-MM-JJ, par exemple 2026-11-12.':
    'Invalid date: use the format YYYY-MM-DD, for example 2026-11-12.',
  'Désolé, un des créneaux choisis vient d’être réservé. Choisissez un autre horaire.':
    'Sorry, one of the chosen times was just booked. Choose another time.',
  'Le mot de passe est trop long (200 caractères maximum).':
    'The password is too long (200 characters maximum).',
  'Le mot de passe ne doit pas contenir votre adresse e-mail.':
    'The password must not contain your email address.',
  'Le prix doit être un nombre entier de FCFA.': 'The price must be a whole number of FCFA.',
  'Mois invalide : utilisez le format AAAA-MM, par exemple 2026-11.':
    'Invalid month: use the format YYYY-MM, for example 2026-11.',
  'Numéro de téléphone invalide : indiquez l’indicatif, par exemple +228 90 12 34 56.':
    'Invalid phone number: include the country code, for example +228 90 12 34 56.',
  'Un des créneaux choisis n’est plus libre. Actualisez le planning et choisissez un autre horaire.':
    'One of the chosen times is no longer free. Refresh the schedule and choose another time.',
  'Un forfait « créneau unique » (1 créneau) est obligatoire : il sert de prix de référence.':
    'A “single slot” package (1 slot) is required: it is the reference price.',
};
