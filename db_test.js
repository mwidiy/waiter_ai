const { Client } = require('pg');

async function test(pw) {
  const client = new Client({
    connectionString: `postgresql://postgres:${pw}@localhost:5432/MejaPesan`,
  });
  try {
    await client.connect();
    console.log(`Success with password: '${pw}'`);
    await client.end();
    return true;
  } catch (err) {
    console.log(`Failed with password: '${pw}' - ${err.message}`);
    return false;
  }
}

async function run() {
  if (await test('postgres')) return;
  if (await test('admin')) return;
  if (await test('123456')) return;
  if (await test('password')) return;
  if (await test('')) return;
}

run();
