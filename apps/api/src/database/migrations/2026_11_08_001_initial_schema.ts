/* eslint-disable @typescript-eslint/no-explicit-any -- migrations must not depend on the evolving app schema types */
import { sql, type Kysely } from 'kysely';

/**
 * Initial schema. See docs/architecture.md §4 for the rationale of each rule.
 *
 * MySQL notes that shaped this file:
 * - A CHECK constraint may not use a column that has an FK referential action
 *   (CASCADE / SET NULL). Foreign keys referenced by CHECKs therefore use the
 *   default RESTRICT, and the application releases rows explicitly.
 * - MySQL has no partial unique indexes. "At most one row in state X" rules
 *   use a STORED generated column that is 1 in state X and NULL otherwise
 *   (UNIQUE allows any number of NULLs).
 * - All DATETIME values are UTC (the connection forces time_zone = '+00:00').
 */

const TABLE_OPTIONS = 'ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci';

const statements: string[] = [
  // ---------------------------------------------------------------- admins
  `CREATE TABLE t_admin_users (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    email VARCHAR(254) NOT NULL,
    full_name VARCHAR(120) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role ENUM('OWNER','STAFF') NOT NULL DEFAULT 'STAFF',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    last_login_at DATETIME(3) NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    UNIQUE KEY uq_admin_users_email (email)
  ) ${TABLE_OPTIONS}`,

  // ---------------------------------------------------------------- spaces
  `CREATE TABLE t_spaces (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    slug VARCHAR(80) NOT NULL,
    name VARCHAR(120) NOT NULL,
    address VARCHAR(255) NULL,
    timezone VARCHAR(64) NOT NULL DEFAULT 'Africa/Lome',
    slot_duration_min SMALLINT UNSIGNED NOT NULL DEFAULT 90,
    min_lead_min INT UNSIGNED NOT NULL DEFAULT 60,
    horizon_days SMALLINT UNSIGNED NOT NULL DEFAULT 90,
    hold_duration_min SMALLINT UNSIGNED NOT NULL DEFAULT 10,
    in_person_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    virtual_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    UNIQUE KEY uq_spaces_slug (slug),
    CONSTRAINT chk_spaces_slot_duration CHECK (slot_duration_min BETWEEN 15 AND 480),
    CONSTRAINT chk_spaces_horizon CHECK (horizon_days BETWEEN 1 AND 730),
    CONSTRAINT chk_spaces_hold CHECK (hold_duration_min BETWEEN 1 AND 60),
    CONSTRAINT chk_spaces_has_mode CHECK (in_person_enabled OR virtual_enabled)
  ) ${TABLE_OPTIONS}`,

  `CREATE TABLE t_space_owner_recipients (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    space_id BIGINT UNSIGNED NOT NULL,
    email VARCHAR(254) NOT NULL,
    name VARCHAR(120) NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    UNIQUE KEY uq_owner_recipients_space_email (space_id, email),
    CONSTRAINT fk_owner_recipients_space FOREIGN KEY (space_id) REFERENCES t_spaces (id) ON DELETE CASCADE
  ) ${TABLE_OPTIONS}`,

  // ISO weekday: 1 = Monday … 7 = Sunday.
  `CREATE TABLE t_opening_hours (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    space_id BIGINT UNSIGNED NOT NULL,
    weekday TINYINT UNSIGNED NOT NULL,
    is_open BOOLEAN NOT NULL DEFAULT TRUE,
    opens_at TIME NOT NULL,
    closes_at TIME NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_opening_hours_space_weekday (space_id, weekday),
    CONSTRAINT fk_opening_hours_space FOREIGN KEY (space_id) REFERENCES t_spaces (id) ON DELETE CASCADE,
    CONSTRAINT chk_opening_hours_weekday CHECK (weekday BETWEEN 1 AND 7),
    CONSTRAINT chk_opening_hours_range CHECK (closes_at > opens_at)
  ) ${TABLE_OPTIONS}`,

  `CREATE TABLE t_closures (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    space_id BIGINT UNSIGNED NOT NULL,
    starts_at DATETIME(3) NOT NULL,
    ends_at DATETIME(3) NOT NULL,
    reason VARCHAR(255) NULL,
    created_by BIGINT UNSIGNED NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    KEY ix_closures_space_range (space_id, starts_at, ends_at),
    CONSTRAINT fk_closures_space FOREIGN KEY (space_id) REFERENCES t_spaces (id) ON DELETE CASCADE,
    CONSTRAINT fk_closures_created_by FOREIGN KEY (created_by) REFERENCES t_admin_users (id),
    CONSTRAINT chk_closures_range CHECK (ends_at > starts_at)
  ) ${TABLE_OPTIONS}`,

  // ---------------------------------------------------------------- catalog
  // A full-day package has no fixed slot count: it takes every slot of the day.
  `CREATE TABLE t_packages (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    space_id BIGINT UNSIGNED NOT NULL,
    code VARCHAR(40) NOT NULL,
    name VARCHAR(120) NOT NULL,
    description VARCHAR(500) NULL,
    is_full_day BOOLEAN NOT NULL DEFAULT FALSE,
    slot_count SMALLINT UNSIGNED NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    sort_order SMALLINT NOT NULL DEFAULT 0,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    UNIQUE KEY uq_packages_space_code (space_id, code),
    CONSTRAINT fk_packages_space FOREIGN KEY (space_id) REFERENCES t_spaces (id),
    CONSTRAINT chk_packages_size CHECK (
      (is_full_day = TRUE AND slot_count IS NULL) OR
      (is_full_day = FALSE AND slot_count >= 1)
    )
  ) ${TABLE_OPTIONS}`,

  // Prices are versioned, never updated in place. is_current makes
  // "one open-ended price per package and mode" a database rule.
  `CREATE TABLE t_package_prices (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    package_id BIGINT UNSIGNED NOT NULL,
    mode ENUM('IN_PERSON','VIRTUAL') NOT NULL,
    price_xof INT UNSIGNED NOT NULL,
    valid_from DATETIME(3) NOT NULL,
    valid_to DATETIME(3) NULL,
    is_current TINYINT GENERATED ALWAYS AS (IF(valid_to IS NULL, 1, NULL)) STORED,
    created_by BIGINT UNSIGNED NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    UNIQUE KEY uq_package_prices_current (package_id, mode, is_current),
    KEY ix_package_prices_lookup (package_id, mode, valid_from),
    CONSTRAINT fk_package_prices_package FOREIGN KEY (package_id) REFERENCES t_packages (id) ON DELETE CASCADE,
    CONSTRAINT fk_package_prices_created_by FOREIGN KEY (created_by) REFERENCES t_admin_users (id),
    CONSTRAINT chk_package_prices_positive CHECK (price_xof > 0),
    CONSTRAINT chk_package_prices_validity CHECK (valid_to IS NULL OR valid_to > valid_from)
  ) ${TABLE_OPTIONS}`,

  // ---------------------------------------------------------------- customers
  `CREATE TABLE t_customers (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    full_name VARCHAR(120) NOT NULL,
    phone_e164 VARCHAR(16) NOT NULL,
    email VARCHAR(254) NULL,
    business_name VARCHAR(160) NOT NULL,
    business_sector VARCHAR(80) NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    UNIQUE KEY uq_customers_phone (phone_e164),
    CONSTRAINT chk_customers_phone CHECK (REGEXP_LIKE(phone_e164, '^[+][1-9][0-9]{6,14}$'))
  ) ${TABLE_OPTIONS}`,

  // ---------------------------------------------------------------- bookings
  `CREATE TABLE t_bookings (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    reference VARCHAR(20) NOT NULL,
    space_id BIGINT UNSIGNED NOT NULL,
    customer_id BIGINT UNSIGNED NOT NULL,
    mode ENUM('IN_PERSON','VIRTUAL') NOT NULL,
    booking_type ENUM('SLOTS','PACKAGE') NOT NULL,
    package_id BIGINT UNSIGNED NULL,
    package_name VARCHAR(120) NULL,
    slot_count SMALLINT UNSIGNED NOT NULL,
    starts_at DATETIME(3) NOT NULL,
    ends_at DATETIME(3) NOT NULL,
    unit_price_xof INT UNSIGNED NOT NULL,
    list_price_xof INT UNSIGNED NOT NULL,
    discount_xof INT UNSIGNED NOT NULL DEFAULT 0,
    total_xof INT UNSIGNED NOT NULL,
    currency CHAR(3) NOT NULL DEFAULT 'XOF',
    status ENUM('PENDING_PAYMENT','CONFIRMED','CANCELLED','EXPIRED','REFUNDED') NOT NULL DEFAULT 'PENDING_PAYMENT',
    hold_expires_at DATETIME(3) NULL,
    confirmed_at DATETIME(3) NULL,
    cancelled_at DATETIME(3) NULL,
    cancel_reason VARCHAR(255) NULL,
    live_description VARCHAR(1000) NULL,
    version INT UNSIGNED NOT NULL DEFAULT 0,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    UNIQUE KEY uq_bookings_reference (reference),
    UNIQUE KEY uq_bookings_id_space (id, space_id),
    KEY ix_bookings_space_start (space_id, starts_at),
    KEY ix_bookings_status_hold (status, hold_expires_at),
    KEY ix_bookings_customer (customer_id),
    CONSTRAINT fk_bookings_space FOREIGN KEY (space_id) REFERENCES t_spaces (id),
    CONSTRAINT fk_bookings_customer FOREIGN KEY (customer_id) REFERENCES t_customers (id),
    CONSTRAINT fk_bookings_package FOREIGN KEY (package_id) REFERENCES t_packages (id),
    CONSTRAINT chk_bookings_type CHECK (
      (booking_type = 'PACKAGE' AND package_id IS NOT NULL AND package_name IS NOT NULL) OR
      (booking_type = 'SLOTS' AND package_id IS NULL)
    ),
    CONSTRAINT chk_bookings_range CHECK (ends_at > starts_at),
    CONSTRAINT chk_bookings_slot_count CHECK (slot_count >= 1),
    CONSTRAINT chk_bookings_amounts CHECK (
      discount_xof <= list_price_xof AND total_xof = list_price_xof - discount_xof
    ),
    CONSTRAINT chk_bookings_hold CHECK (status <> 'PENDING_PAYMENT' OR hold_expires_at IS NOT NULL),
    CONSTRAINT chk_bookings_confirmed CHECK (status <> 'CONFIRMED' OR confirmed_at IS NOT NULL)
  ) ${TABLE_OPTIONS}`,

  // Permanent record of which slots a booking covers (kept after expiry/cancel).
  `CREATE TABLE t_booking_slots (
    booking_id BIGINT UNSIGNED NOT NULL,
    slot_start DATETIME(3) NOT NULL,
    PRIMARY KEY (booking_id, slot_start),
    CONSTRAINT fk_booking_slots_booking FOREIGN KEY (booking_id) REFERENCES t_bookings (id) ON DELETE CASCADE
  ) ${TABLE_OPTIONS}`,

  `CREATE TABLE t_slot_blocks (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    space_id BIGINT UNSIGNED NOT NULL,
    reason VARCHAR(255) NOT NULL,
    created_by BIGINT UNSIGNED NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    UNIQUE KEY uq_slot_blocks_id_space (id, space_id),
    CONSTRAINT fk_slot_blocks_space FOREIGN KEY (space_id) REFERENCES t_spaces (id),
    CONSTRAINT fk_slot_blocks_created_by FOREIGN KEY (created_by) REFERENCES t_admin_users (id)
  ) ${TABLE_OPTIONS}`,

  // THE anti-double-booking table: one row per occupied slot, UNIQUE per space.
  // Composite FKs guarantee a row can only point at a slot its booking really
  // covers, in the booking's own space (same for blocks).
  `CREATE TABLE t_slot_occupancies (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    space_id BIGINT UNSIGNED NOT NULL,
    slot_start DATETIME(3) NOT NULL,
    booking_id BIGINT UNSIGNED NULL,
    block_id BIGINT UNSIGNED NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    UNIQUE KEY uq_slot_occupancies_slot (space_id, slot_start),
    KEY ix_slot_occupancies_booking (booking_id),
    KEY ix_slot_occupancies_block (block_id),
    CONSTRAINT fk_occupancies_booking_space FOREIGN KEY (booking_id, space_id) REFERENCES t_bookings (id, space_id),
    CONSTRAINT fk_occupancies_booking_slot FOREIGN KEY (booking_id, slot_start) REFERENCES t_booking_slots (booking_id, slot_start),
    CONSTRAINT fk_occupancies_block_space FOREIGN KEY (block_id, space_id) REFERENCES t_slot_blocks (id, space_id),
    CONSTRAINT chk_occupancies_owner CHECK ((booking_id IS NULL) <> (block_id IS NULL))
  ) ${TABLE_OPTIONS}`,

  // ---------------------------------------------------------------- payments
  `CREATE TABLE t_payments (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    booking_id BIGINT UNSIGNED NOT NULL,
    provider VARCHAR(40) NOT NULL,
    provider_ref VARCHAR(128) NULL,
    idempotency_key VARCHAR(64) NOT NULL,
    method ENUM('MOBILE_MONEY','CARD') NOT NULL,
    channel VARCHAR(40) NULL,
    payer_phone VARCHAR(16) NULL,
    amount_xof INT UNSIGNED NOT NULL,
    currency CHAR(3) NOT NULL DEFAULT 'XOF',
    status ENUM('INITIATED','PENDING','SUCCEEDED','FAILED','CANCELLED','REFUNDED') NOT NULL DEFAULT 'INITIATED',
    is_succeeded TINYINT GENERATED ALWAYS AS (IF(status = 'SUCCEEDED', 1, NULL)) STORED,
    failure_reason VARCHAR(255) NULL,
    last_payload JSON NULL,
    succeeded_at DATETIME(3) NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    UNIQUE KEY uq_payments_idempotency (idempotency_key),
    UNIQUE KEY uq_payments_provider_ref (provider, provider_ref),
    UNIQUE KEY uq_payments_one_success (booking_id, is_succeeded),
    KEY ix_payments_status (status, created_at),
    CONSTRAINT fk_payments_booking FOREIGN KEY (booking_id) REFERENCES t_bookings (id),
    CONSTRAINT chk_payments_amount CHECK (amount_xof > 0),
    CONSTRAINT chk_payments_succeeded_at CHECK (status <> 'SUCCEEDED' OR succeeded_at IS NOT NULL)
  ) ${TABLE_OPTIONS}`,

  `CREATE TABLE t_payment_events (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    provider VARCHAR(40) NOT NULL,
    provider_event_id VARCHAR(128) NOT NULL,
    payment_id BIGINT UNSIGNED NULL,
    type VARCHAR(80) NOT NULL,
    signature_valid BOOLEAN NOT NULL,
    payload JSON NOT NULL,
    received_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    processed_at DATETIME(3) NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_payment_events_provider_event (provider, provider_event_id),
    CONSTRAINT fk_payment_events_payment FOREIGN KEY (payment_id) REFERENCES t_payments (id)
  ) ${TABLE_OPTIONS}`,

  // ---------------------------------------------------------------- notifications (outbox)
  `CREATE TABLE t_notifications (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    booking_id BIGINT UNSIGNED NULL,
    channel ENUM('EMAIL','SMS','WHATSAPP') NOT NULL,
    template VARCHAR(60) NOT NULL,
    recipient VARCHAR(254) NOT NULL,
    payload JSON NOT NULL,
    status ENUM('PENDING','SENDING','SENT','FAILED') NOT NULL DEFAULT 'PENDING',
    attempts SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    next_attempt_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    last_error VARCHAR(1000) NULL,
    sent_at DATETIME(3) NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    UNIQUE KEY uq_notifications_once (booking_id, template, recipient),
    KEY ix_notifications_queue (status, next_attempt_at),
    CONSTRAINT fk_notifications_booking FOREIGN KEY (booking_id) REFERENCES t_bookings (id),
    CONSTRAINT chk_notifications_sent CHECK (status <> 'SENT' OR sent_at IS NOT NULL)
  ) ${TABLE_OPTIONS}`,

  // ---------------------------------------------------------------- audit
  `CREATE TABLE t_audit_log (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    actor_type ENUM('ADMIN','CUSTOMER','SYSTEM','PROVIDER') NOT NULL,
    actor_id BIGINT UNSIGNED NULL,
    action VARCHAR(80) NOT NULL,
    entity VARCHAR(60) NOT NULL,
    entity_id VARCHAR(64) NOT NULL,
    data JSON NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    KEY ix_audit_entity (entity, entity_id),
    KEY ix_audit_created (created_at)
  ) ${TABLE_OPTIONS}`,
];

/** Drop order: children before parents. */
const tablesInDropOrder = [
  't_audit_log',
  't_notifications',
  't_payment_events',
  't_payments',
  't_slot_occupancies',
  't_slot_blocks',
  't_booking_slots',
  't_bookings',
  't_customers',
  't_package_prices',
  't_packages',
  't_closures',
  't_opening_hours',
  't_space_owner_recipients',
  't_spaces',
  't_admin_users',
];

export async function up(db: Kysely<any>): Promise<void> {
  for (const statement of statements) {
    await sql.raw(statement).execute(db);
  }
}

export async function down(db: Kysely<any>): Promise<void> {
  for (const table of tablesInDropOrder) {
    await sql.raw(`DROP TABLE IF EXISTS ${table}`).execute(db);
  }
}
