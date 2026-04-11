import { config as dotenvConfig } from 'dotenv';

dotenvConfig();
dotenvConfig({ path: '.env.local', override: true });
