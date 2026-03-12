import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

export async function query(text, params) {
  const start = Date.now();
  try {
    const res = await pool.query(text, params);
    const duration = Date.now() - start;
    console.log('executed query', { text, duration, rows: res.rowCount });
    return res;
  } catch (err) {
    console.error('query error', err.message);
    throw err;
  }
}

export async function getMenu(storeId = 1) {
  const res = await query(
    'SELECT id, name, price, description FROM "Product" WHERE "storeId" = $1 AND "isActive" = true',
    [storeId]
  );
  return res.rows;
}

export async function createOrder(customerName, products, storeId = 1, tableId = null) {
  // `products` is an array of { productId, quantity, priceSnapshot, note }
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    // 1. Calculate totalAmount and generate transactionCode
    const transactionCode = `TRX-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const totalAmount = products.reduce((acc, p) => acc + (p.priceSnapshot * p.quantity), 0);
    
    // 2. Insert into Order
    const orderQuery = `
      INSERT INTO "Order" (
        "transactionCode", "queueNumber", "customerName", "orderType", 
        "paymentStatus", "status", "totalAmount", "storeId", "tableId", "createdAt"
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_TIMESTAMP
      ) RETURNING id
    `;
    const queueNumber = Math.floor(Math.random() * 100) + 1; // dummy queue number for now
    const orderValues = [
      transactionCode, queueNumber, customerName || 'Guest', 'Dine In',
      'Unpaid', 'Pending', totalAmount, storeId, tableId
    ];
    
    const { rows: orderRows } = await client.query(orderQuery, orderValues);
    const orderId = orderRows[0].id;
    
    // 3. Insert into OrderItem
    const itemQuery = `
      INSERT INTO "OrderItem" (
        "orderId", "productId", "quantity", "priceSnapshot", "note"
      ) VALUES ($1, $2, $3, $4, $5)
    `;
    
    for (const item of products) {
      const itemValues = [
        orderId, item.productId, item.quantity, item.priceSnapshot, item.note || ''
      ];
      await client.query(itemQuery, itemValues);
    }
    
    await client.query('COMMIT');
    return { success: true, orderId, transactionCode };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
