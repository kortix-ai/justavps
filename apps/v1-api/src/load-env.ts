import dotenv from 'dotenv';

dotenv.config({ quiet: true });
dotenv.config({ path: '.env.local', override: true, quiet: true });
dotenv.config({ path: 'apps/v1-api/.env', quiet: true });
dotenv.config({ path: 'apps/v1-api/.env.local', override: true, quiet: true });
