import pg from 'pg';
import { config } from './config.js';

// BIGINT (oid 20) -> Number. Telegram ID и монеты заведомо < 2^53.
pg.types.setTypeParser(20, (v) => Number(v));

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  ssl: config.dbSsl ? true : false, // true = проверка сертификата
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

pool.on('error', (err) => console.error('pg pool error:', err.message));

export const query = (text, params) => pool.query(text, params);

/** Выполняет fn внутри транзакции. */
export async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* ignore */ }
    throw err;
  } finally {
    client.release();
  }
}
