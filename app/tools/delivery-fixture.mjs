import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { PNG } from "pngjs";
import { sha256Hex } from "../functions/lib/api.js";
import { GENERATION_CONFIG } from "../functions/lib/generation-config.js";
import { onRequestPost as checkout } from "../functions/api/checkout.js";
export const jpeg = Uint8Array.from([255,216,255,192,0,17,8,2,0,2,0,3,1,17,0,2,17,0,3,17,0,255,217]);
export const png = PNG.sync.write(new PNG({ width: 4, height: 4 }));
export async function fixture() {
  const db = new DatabaseSync(":memory:");
  for (const name of ["0001_custom_orders.sql", "0002_order_sku.sql", "0003_avatar_delivery.sql", "0004_delivery_fencing.sql", "0005_free_generation.sql"]) db.exec(readFileSync(new URL(`../migrations/${name}`, import.meta.url), "utf8"));
  function prepare(sql) {
    let args = [];
    return { bind(...values) { args = values; return this; }, async first() { return db.prepare(sql).get(...args) || null; },
      async all() { return { results: db.prepare(sql).all(...args) }; }, async run() { return { meta: { changes: db.prepare(sql).run(...args).changes } }; } };
  }
  const objects = new Map(), kv = new Map(), messages = [];
  const env = { PETI_DB: { prepare, async batch(statements) { db.exec("BEGIN"); try { const rows=[]; for (const statement of statements) rows.push(await statement.run()); db.exec("COMMIT"); return rows; } catch (error) { db.exec("ROLLBACK"); throw error; } } },
    PETI_KV: { get: async key => kv.get(key) || null },
    PETI_IMAGES: { async put(key, body, meta) { objects.set(key, { bytes: new Uint8Array(body), ...meta }); }, async get(key) { const object=objects.get(key); return object ? { ...object, size:object.bytes.length, body:object.bytes, arrayBuffer:async()=>object.bytes.buffer.slice(object.bytes.byteOffset,object.bytes.byteOffset+object.bytes.byteLength) } : null; }, async head(key) { return this.get(key); }, async delete(key) { objects.delete(key); } },
    PETI_DELIVERY_QUEUE: { async send(body) { messages.push(body); } }, ORDER_ACCESS_SECRET: "test-order-secret-12345678901234567890", AVATAR_ADMIN_SECRET: "test-admin-secret-12345678901234567890", PETI_PUBLIC_ORIGIN: "https://pet.test",
    ARK_API_KEY: "test-key", AFDIAN_USER_ID: "creator", AFDIAN_API_TOKEN: "test-token", AFDIAN_PLAN_ID: "plan", AFDIAN_SKU_ID: "sku",
    AFDIAN_PAY_URL: 'https://afdian.com/order/create?product_type=1&plan_id=plan&sku=%5B%7B%22sku_id%22%3A%22sku%22,%22count%22%3A1%7D%5D',
    FREE_GENERATION_ENABLED: "true", PAYMENT_ENABLED: "true",
  };
  db.prepare("INSERT INTO delivery_control VALUES ('heartbeat','ok',?)").run(Date.now());
  const testId=crypto.randomUUID(), token=crypto.randomUUID().replaceAll("-",""), tokenHash=await sha256Hex(token), photoId=crypto.randomUUID();
  const result={testId,petType:"cat",roleId:"mummy",petName:"馒头",roleName:"木乃伊喵",tokenHash,status:"completed"};
  kv.set(`session:${testId}`,JSON.stringify({tokenHash})); kv.set(`result:${testId}`,JSON.stringify(result));
  db.prepare("INSERT INTO photos VALUES (?,?,?,?,?)").run(photoId,testId,tokenHash,"photos/pet.jpg",Date.now()+86_400_000);
  await env.PETI_IMAGES.put("photos/pet.jpg",jpeg,{httpMetadata:{contentType:"image/jpeg"}});
  for (const key of ["references/style.png","references/dog-style.png"]) await env.PETI_IMAGES.put(key,png,{httpMetadata:{contentType:"image/png"}});
  return {db,env,objects,kv,messages,testId,token,photoId};
}
export function configured() {
  GENERATION_CONFIG.size="4x4"; GENERATION_CONFIG.prompts={cat:"cat / {roleId} / {petName}",dog:"dog / {roleId} / {petName}"};
  GENERATION_CONFIG.roleImageKeys={cat:{mummy:"references/style.png"},dog:{mummy:"references/dog-style.png"}};
}
export function post(handler,f,data,params={}) {
  return handler({env:f.env,params,request:new Request("https://pet.test/api",{method:"POST",headers:data instanceof FormData?{"CF-Connecting-IP":f.testId}:{"content-type":"application/json","CF-Connecting-IP":f.testId},body:data instanceof FormData?data:JSON.stringify({token:f.token,testId:f.testId,photoId:f.photoId,...data})})});
}
export async function newOrder(f) { configured(); const response=await post(checkout,f,{}); const order=await response.json(); if (!order.payId) throw new Error(JSON.stringify(order)); return order; }
export function paid(order,overrides={}) { return {out_trade_no:"2026102800000001",user_id:"buyer-1",status:2,product_type:1,plan_id:"plan",sku_detail:[{sku_id:"sku",count:1}],total_amount:(order.amountFen/100).toFixed(2),custom_order_id:order.payId,remark:order.payId,...overrides}; }
export const paidResponse=(order,overrides={})=>Response.json({ec:200,data:{list:[paid(order,overrides)]}});
export const storedOrder=(f,id)=>f.db.prepare("SELECT * FROM orders WHERE id=?").get(id);
