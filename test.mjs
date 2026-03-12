import { getMenu, createOrder } from './src/lib/db.js';
import { config } from 'dotenv';
config({ path: '.env.local' });

async function test() {
  console.log('Testing getMenu...');
  const menu = await getMenu(1);
  console.log('Menu:', menu);

  console.log('Testing connection (if it fails, check credentials)');
  process.exit(0);
}

test().catch(console.error);
