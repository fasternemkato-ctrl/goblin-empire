CREATE TABLE users (
  id                  BIGINT PRIMARY KEY,                 -- Telegram user id
  username            TEXT,
  first_name          TEXT NOT NULL DEFAULT '',
  coins               BIGINT NOT NULL DEFAULT 0 CHECK (coins >= 0),
  total_earned        BIGINT NOT NULL DEFAULT 0 CHECK (total_earned >= 0),
  energy              DOUBLE PRECISION NOT NULL DEFAULT 500 CHECK (energy >= 0),
  energy_updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  tap_level           INT NOT NULL DEFAULT 0 CHECK (tap_level BETWEEN 0 AND 30),
  energy_level        INT NOT NULL DEFAULT 0 CHECK (energy_level BETWEEN 0 AND 30),
  regen_level         INT NOT NULL DEFAULT 0 CHECK (regen_level BETWEEN 0 AND 30),
  mine_level          INT NOT NULL DEFAULT 0 CHECK (mine_level BETWEEN 0 AND 30),
  passive_updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_tap_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seq            BIGINT NOT NULL DEFAULT 0,
  -- Задел под TON: адрес считается доверенным ТОЛЬКО после проверки ton-proof
  ton_wallet          TEXT,
  ton_wallet_verified BOOLEAN NOT NULL DEFAULT false,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX users_total_earned_idx ON users (total_earned DESC);

CREATE TABLE referrals (
  referee_id  BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  referrer_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX referrals_referrer_idx ON referrals (referrer_id);

-- Журнал всех движений монет, кроме тапов (покупки, бонусы). Нужен для аудита и будущего вывода в TON.
CREATE TABLE ledger (
  id         BIGSERIAL PRIMARY KEY,
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,
  amount     BIGINT NOT NULL,
  meta       JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ledger_user_idx ON ledger (user_id, created_at DESC);
