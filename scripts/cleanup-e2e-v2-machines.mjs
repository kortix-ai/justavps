import 'dotenv/config';
import postgres from 'postgres';

const ids = [
  '62a401b5-0f6a-4b73-a8a8-87a1722b5ca4',
  'fc303d63-5f80-4c3a-a157-2be0045ad020',
  'cddd3786-b24b-47f6-a997-87af9b3f9d55',
  'ed799eed-b623-47e9-87f6-8c05dc935754',
  '45262591-21c9-4b0a-bddf-e7951021c44c',
  '9c020711-523d-4b6c-a921-dfc56274e792',
  'e074024b-7a64-490a-b347-10844e896890',
  '0ba0fadc-882b-445e-9b37-724714a1bb1b',
  '1cacf134-1340-407c-acd0-d8f8a3824854',
  '20f89666-63b8-44a8-8633-b69c407933a3',
  'ed93ec59-09e7-476f-bcff-62495ab5c0a3',
  '9c571383-5f32-4b74-9f3b-ad1c8586b047',
  '567dc49f-14dd-44b6-827d-f89e3f98cffc',
  '022c1725-3f5f-4c55-ba48-d4752e176c12',
];

const sql = postgres(process.env.DATABASE_URL, { ssl: 'require' });

try {
  await sql`update machines set status='deleted', deleted_at=now() where id = any(${ids})`;
  console.log(`Marked ${ids.length} stale e2e machines deleted`);
} finally {
  await sql.end();
}
