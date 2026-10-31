import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { fixture, configured, post, newOrder, paid, paidResponse, storedOrder, png, jpeg } from "./delivery-fixture.mjs";
import { GENERATION_CONFIG } from "../functions/lib/generation-config.js";
import { amountFen, CUTOFF, orderPayload } from "../functions/lib/custom.js";
import { onRequestPost as checkout } from "../functions/api/checkout.js";
import { onRequestPost as upload } from "../functions/api/photos.js";
import { onRequestPost as confirm } from "../functions/api/checkout/[payId]/confirm.js";
import { onRequestPost as jobs } from "../functions/api/jobs.js";
import { onRequestGet as image } from "../functions/api/jobs/[jobId]/image.js";
import { onRequestPost as webhook } from "../functions/api/afdian/webhook.js";
import { onRequestPost as refundApi } from "../functions/api/refund-requests.js";
import { onRequestGet as admin } from "../functions/api/admin/avatar-orders.js";
import { onRequestPost as adminVerify } from "../functions/api/admin/avatar-orders/[orderId].js";
import { afdianSignature, moneyFen, bindVerifiedPayment, processPaymentEvent, persistPaymentEvent } from "../functions/lib/payment.js";
import { processGeneration, recoverStaleGenerations } from "../functions/lib/generation-jobs.js";
import { dispatchPending, reconcilePayments } from "../functions/lib/delivery-scheduler.js";
import { orderAccessToken, verifyOrderAccess, avatarOrderUrl } from "../functions/lib/order-access.js";
import { requestRefund, reviewRefund, withdrawRefund } from "../functions/lib/refunds.js";
import { sendAvatarNotification } from "../functions/lib/avatar-notifications.js";
const initial=structuredClone(GENERATION_CONFIG), originalFetch=globalThis.fetch;
afterEach(()=>{Object.assign(GENERATION_CONFIG,structuredClone(initial));globalThis.fetch=originalFetch;});
const row=f=>f.db.prepare("SELECT * FROM orders").get();
async function paidOrder(f) { const o=await newOrder(f);await bindVerifiedPayment(f.env,row(f),paid(o));return o; }
const run=(f,o)=>processGeneration(f.env,o.payId);
const generated=()=>Response.json({data:[{b64_json:png.toString("base64")}]});
const responseError=error=>error instanceof Response;
test("价格时点、金额精度与官方签名示例",()=>{
  assert.equal(amountFen(CUTOFF-1),180);assert.equal(amountFen(CUTOFF),600);assert.equal(moneyFen("1.80"),180);
  for(const value of ["2.001","2","-2.00",2])assert.equal(moneyFen(value),null);
  assert.equal(afdianSignature("123",'{"a":333}',1624339905,"abc"),"a4acc28b81598b7e5d84ebdc3e91710c");
});
test("队列、心跳、密钥或参考图缺失时停止创建收费订单",async()=>{
  for(const mode of ["queue","heartbeat","secret","reference","key"]){const f=await fixture();configured();
    if(mode==="queue")delete f.env.PETI_DELIVERY_QUEUE;
    if(mode==="heartbeat")f.db.prepare("DELETE FROM delivery_control").run();
    if(mode==="secret")f.env.ORDER_ACCESS_SECRET="";
    if(mode==="reference")f.objects.delete("references/style.png");
    if(mode==="key")f.env.ARK_API_KEY="";
    assert.equal((await post(checkout,f,{})).status,503,mode);assert.equal(f.db.prepare("SELECT count(*) n FROM orders").get().n,0);
  }
});
test("上传核验同意；伪造凭证和未付订单不能生成",async()=>{
  const f=await fixture();configured();const form=new FormData();form.set("token",f.token);form.set("testId",f.testId);form.set("photo",new Blob([jpeg],{type:"image/jpeg"}),"pet.jpg");
  assert.equal((await post(upload,f,form)).status,400);form.set("consent","true");assert.equal((await post(upload,f,form)).status,201);
  assert.equal((await post(checkout,f,{token:"0".repeat(32)})).status,401);
  const o=await newOrder(f);assert.equal((await post(jobs,f,{payId:o.payId,paid:true})).status,402);
});
test("并发下单只保留一份报价，付款URL携带订单关联码",async()=>{
  const f=await fixture();configured();const [a,b]=await Promise.all([post(checkout,f,{amountFen:1}),post(checkout,f,{})]);
  const first=await a.json();assert.equal(first.payId,(await b.json()).payId);assert.equal(first.amountFen,amountFen());
  const url=new URL(first.payUrl);assert.equal(url.searchParams.get("custom_order_id"),first.payId);assert.equal(url.searchParams.get("remark"),first.payId);
});
test("验单校验金额、商品、数量、状态及关联码；用户改留言不影响新关联码",async()=>{
  const f=await fixture(),o=await newOrder(f);
  for(const change of [{total_amount:"0.01"},{plan_id:"wrong"},{status:0},{product_type:0},{sku_detail:[{sku_id:"sku",count:2}]},{custom_order_id:crypto.randomUUID()}]){
    globalThis.fetch=async()=>paidResponse(o,change);assert.equal((await post(confirm,f,{platformOrderNo:"2026102800000001"},{payId:o.payId})).status,409);
  }
  globalThis.fetch=async()=>paidResponse(o,{remark:"用户改了留言"});assert.equal((await post(confirm,f,{platformOrderNo:"2026102800000001"},{payId:o.payId})).status,200);
  assert.equal(row(f).status,"queued");assert.equal(row(f).attempts,0);assert.ok(f.messages.some(x=>x.type==="generate"));
});
test("Webhook先持久收件；伪造线索不能改变权威查单中的订单关联",async()=>{
  const f=await fixture(),o=await newOrder(f);let calls=0;globalThis.fetch=async()=>{calls++;return paidResponse(o,{custom_order_id:crypto.randomUUID()});};
  const data={data:{type:"order",order:{custom_order_id:o.payId,out_trade_no:"2026102800000001"}}};assert.equal((await post(webhook,f,data)).status,200);assert.equal(calls,0);
  await processPaymentEvent(f.env,"2026102800000001");assert.equal(calls,1);assert.equal(row(f).status,"unpaid");assert.equal(f.db.prepare("SELECT state FROM payment_inbox").get().state,"unmatched");
});
test("重复通知仅建一个任务，用户关页后后台仍能生成",async()=>{
  const f=await fixture(),o=await newOrder(f);globalThis.fetch=async()=>paidResponse(o);
  await persistPaymentEvent(f.env,"2026102800000001");await processPaymentEvent(f.env,"2026102800000001");await processPaymentEvent(f.env,"2026102800000001");
  assert.equal(f.db.prepare("SELECT count(*) n FROM delivery_jobs").get().n,1);assert.equal(f.db.prepare("SELECT count(*) n FROM avatar_notifications").get().n,1);
  let calls=0;globalThis.fetch=async()=>{calls++;return generated();};await run(f,o);await run(f,o);assert.equal(calls,1);assert.equal(row(f).status,"ready");
});
test("超大通知和退款内容受限；管理员接口需要独立凭证",async()=>{
  const f=await fixture();for(const [handler,size] of [[webhook,16385],[refundApi,8193]])assert.equal((await handler({env:f.env,request:new Request("https://pet.test/api",{method:"POST",body:"x".repeat(size)})})).status,413);
  assert.equal((await admin({env:f.env,request:new Request("https://pet.test/api")})).status,401);
});
test("重复付款保留交易明细，仅生成一份权益",async()=>{
  const f=await fixture(),o=await paidOrder(f);await bindVerifiedPayment(f.env,row(f),paid(o,{out_trade_no:"2026102800000002"}));
  assert.equal(f.db.prepare("SELECT count(*) n FROM delivery_jobs").get().n,1);assert.equal(f.db.prepare("SELECT state FROM payment_transactions WHERE trade_no='2026102800000002'").get().state,"duplicate");assert.equal(row(f).platform_order_no,"2026102800000001");
});
test("队列失败由持久任务补投；漏通知由分页对账恢复",async()=>{
  const f=await fixture(),o=await newOrder(f);f.env.PETI_DELIVERY_QUEUE.send=async()=>{throw Error("queue down");};await bindVerifiedPayment(f.env,row(f),paid(o));assert.equal(row(f).status,"unlocked");
  f.db.prepare("UPDATE delivery_jobs SET next_at=0").run();f.env.PETI_DELIVERY_QUEUE.send=async body=>f.messages.push(body);await dispatchPending(f.env);assert.equal(row(f).status,"queued");
  const g=await fixture(),p=await newOrder(g);globalThis.fetch=async()=>paidResponse(p);await reconcilePayments(g.env);await processPaymentEvent(g.env,"2026102800000001");assert.equal(row(g).status,"queued");
});
test("并发消费只调用一次生图，保存请求编号和成品；下载需要订单凭证",async()=>{
  const f=await fixture(),o=await paidOrder(f);let calls=0,release;const gate=new Promise(r=>release=r);
  globalThis.fetch=async(_url,options)=>{calls++;const body=JSON.parse(options.body);assert.match(body.image[0],/^data:image\/jpeg;base64,/);assert.match(body.image[1],/^data:image\/png;base64,/);await gate;return Response.json({data:[{b64_json:png.toString("base64")}]},{headers:{"x-request-id":"request-123"}});};
  const first=run(f,o);while(!calls)await new Promise(r=>setTimeout(r,1));await run(f,o);assert.equal(calls,1);release();await first;
  const attempt=f.db.prepare("SELECT * FROM generation_attempts").get();assert.equal(row(f).status,"ready");assert.equal(attempt.request_id,"request-123");assert.equal(attempt.http_status,200);
  const params={jobId:o.payId};assert.equal((await image({env:f.env,params,request:new Request("https://pet.test")})).status,401);assert.equal((await image({env:f.env,params,request:new Request("https://pet.test",{headers:{"X-PT-Token":f.token}})})).status,200);
});
test("按服务端猫狗结果选择Prompt，成品仅调用一次生成",async()=>{
  for(const pet of ["cat","dog"]){const f=await fixture();configured();const result=JSON.parse(f.kv.get(`result:${f.testId}`));result.petType=pet;f.kv.set(`result:${f.testId}`,JSON.stringify(result));const o=await paidOrder(f);let calls=0;
    globalThis.fetch=async(_url,options)=>{calls++;assert.equal(JSON.parse(options.body).prompt,`${pet} / mummy / 馒头`);return generated();};await run(f,o);assert.equal(row(f).status,"ready");assert.equal(calls,1);
  }
});
test("超时、损坏响应和存储失败不能盲重试收费调用",async()=>{
  for(const mode of ["timeout","invalid","storage"]){const f=await fixture(),o=await paidOrder(f);let calls=0;if(mode==="storage")f.env.PETI_IMAGES.put=async()=>{throw Error("disk");};
    globalThis.fetch=async()=>{calls++;if(mode==="timeout")throw Error("timeout");return mode==="invalid"?Response.json({data:[]}):generated();};await run(f,o);await run(f,o);assert.equal(row(f).status,"uncertain");assert.equal(row(f).retryable,0);assert.equal(calls,1,mode);
  }
});
test("429明确拒绝最多允许一次手动重试，重试仍由队列消费",async()=>{
  const f=await fixture(),o=await paidOrder(f);let calls=0;globalThis.fetch=async()=>{calls++;return new Response("quota",{status:429});};await run(f,o);assert.equal(row(f).retryable,1);assert.equal((await post(jobs,f,{payId:o.payId})).status,202);await run(f,o);assert.equal(row(f).attempts,2);assert.equal(row(f).retryable,0);assert.equal(calls,2);
});
test("调用前中断可安全恢复；调用后中断禁重发；落盘后中断补交付",async()=>{
  for(const mode of ["preparing","calling","stored"]){const f=await fixture(),o=await paidOrder(f),attempt=crypto.randomUUID(),key=`jobs/${o.payId}/${mode}.png`;
    f.db.prepare("UPDATE orders SET status='generating',attempts=1").run();f.db.prepare("UPDATE delivery_jobs SET state='running',attempt_id=?,lease_until=0").run(attempt);f.db.prepare("INSERT INTO generation_attempts(id,order_id,state,stage,started_at,image_key)VALUES(?,?,?,?,?,?)").run(attempt,o.payId,mode,mode,Date.now(),key);
    if(mode==="stored")await f.env.PETI_IMAGES.put(key,png,{httpMetadata:{contentType:"image/png"}});globalThis.fetch=()=>{throw Error("must not call model");};await recoverStaleGenerations(f.env);assert.equal(row(f).status,{preparing:"unlocked",calling:"uncertain",stored:"ready"}[mode]);
  }
});
test("专属链接限单访问并可撤销，签名不能移用到其他订单",async()=>{
  const f=await fixture();await paidOrder(f);const order=row(f),token=await orderAccessToken(f.env,order);assert.equal(await verifyOrderAccess(f.env,order,token),true);assert.equal(await verifyOrderAccess(f.env,{...order,id:crypto.randomUUID()},token),false);assert.equal(await verifyOrderAccess(f.env,{...order,link_version:2},token),false);
  const url=new URL(await avatarOrderUrl(f.env,order));assert.equal(url.pathname,"/avatar.html");assert.ok(url.hash.includes("access="));
});
test("私信发往实际付款账号；未知发送结果停止自动重发",async()=>{
  const f=await fixture(),o=await paidOrder(f);let calls=0;globalThis.fetch=async(_url,options)=>{calls++;const body=JSON.parse(JSON.parse(options.body).params);assert.equal(body.recipient,"buyer-1");assert.match(body.content,/avatar.html#order=/);throw Error("unknown");};await sendAvatarNotification(f.env,`${o.payId}:paid`);await sendAvatarNotification(f.env,`${o.payId}:paid`);assert.equal(calls,1);assert.equal(f.db.prepare("SELECT state FROM avatar_notifications").get().state,"uncertain");
});
test("退款申请幂等并暂停新生成；未核实的付款不能批准退款",async()=>{
  const f=await fixture(),o=await newOrder(f),r=await requestRefund(f.env,row(f),{reason:"payment_unconfirmed"});assert.equal((await requestRefund(f.env,row(f),{reason:"not_delivered"})).id,r.id);await assert.rejects(()=>reviewRefund(f.env,r.id,{action:"approve"}),responseError);
  await bindVerifiedPayment(f.env,row(f),paid(o));assert.equal(row(f).refund_status,"pending");let calls=0;globalThis.fetch=async()=>{calls++;return generated();};await run(f,o);assert.equal(calls,0);
});
test("退款与晚到图片并发保留申请，超时订单不能因晚到图片被驳回",async()=>{
  const f=await fixture(),o=await paidOrder(f);f.db.prepare("UPDATE orders SET paid_at=?").run(Date.now()-700000);let release,calls=0;const gate=new Promise(r=>release=r);globalThis.fetch=async()=>{calls++;await gate;return generated();};const running=run(f,o);while(!calls)await new Promise(r=>setTimeout(r,1));
  const r=await requestRefund(f.env,row(f),{reason:"not_delivered"});release();await running;assert.equal(row(f).refund_status,"pending");assert.notEqual(row(f).status,"ready");await assert.rejects(()=>reviewRefund(f.env,r.id,{action:"reject",note:"图片已到"}),responseError);await reviewRefund(f.env,r.id,{action:"approve"});assert.equal(row(f).refund_status,"approved");
  assert.equal((await image({env:f.env,params:{jobId:o.payId},request:new Request("https://pet.test",{headers:{"X-PT-Token":f.token}})})).status,409);
});
test("批准不代表资金已退，实退必须核对渠道、凭证及精确金额",async()=>{
  const f=await fixture();await paidOrder(f);const r=await requestRefund(f.env,row(f),{reason:"generation_failed"});await reviewRefund(f.env,r.id,{action:"approve"});assert.equal(f.db.prepare("SELECT state FROM payment_transactions").get().state,"paid");
  await assert.rejects(()=>reviewRefund(f.env,r.id,{action:"refunded"}),responseError);await assert.rejects(()=>reviewRefund(f.env,r.id,{action:"refunded",channel:"测试",proofReference:"proof",amountFen:1}),responseError);await reviewRefund(f.env,r.id,{action:"processing"});await reviewRefund(f.env,r.id,{action:"refunded",channel:"原支付渠道",proofReference:"refund-123",amountFen:row(f).amount_fen});assert.equal(row(f).refund_status,"refunded");assert.equal(f.db.prepare("SELECT state FROM payment_transactions").get().state,"refunded");await assert.rejects(()=>reviewRefund(f.env,r.id,{action:"refunded"}),responseError);
});
test("多付退款保留原交易权益，并恢复未调用的排队任务",async()=>{
  const f=await fixture(),o=await paidOrder(f);await bindVerifiedPayment(f.env,row(f),paid(o,{out_trade_no:"2026102800000002"}));const r=await requestRefund(f.env,row(f),{reason:"duplicate_payment"});await reviewRefund(f.env,r.id,{action:"approve"});await reviewRefund(f.env,r.id,{action:"refunded",channel:"原路",proofReference:"refund-extra",amountFen:row(f).amount_fen});assert.equal(row(f).refund_status,"none");assert.equal(f.db.prepare("SELECT state FROM payment_transactions WHERE trade_no='2026102800000001'").get().state,"paid");assert.equal(f.db.prepare("SELECT state FROM delivery_jobs").get().state,"pending");
});
test("未确认付款的订单不能冻结交付，只能按付款未识别或重复付款申请",async()=>{
  const f=await fixture();await newOrder(f);
  await assert.rejects(()=>requestRefund(f.env,row(f),{reason:"not_delivered"}),error=>error instanceof Response&&error.status===409);
  assert.equal(row(f).refund_status,"none");assert.equal(f.db.prepare("SELECT count(*) n FROM refund_requests").get().n,0);
  assert.equal((await requestRefund(f.env,row(f),{reason:"payment_unconfirmed"})).state,"pending");
});
test("撤回退款申请后恢复排队生成，撤回的申请不能再审核",async()=>{
  const f=await fixture(),o=await paidOrder(f);const r=await requestRefund(f.env,row(f),{reason:"not_delivered"});
  assert.equal(f.db.prepare("SELECT state FROM delivery_jobs").get().state,"blocked");
  const w=await withdrawRefund(f.env,row(f));assert.equal(w.state,"withdrawn");assert.equal(row(f).refund_status,"none");
  assert.equal(f.db.prepare("SELECT state FROM delivery_jobs").get().state,"queued");
  assert.equal(f.messages.filter(m=>m.type==="generate").length,2);
  await assert.rejects(()=>reviewRefund(f.env,w.id,{action:"approve"}),responseError);
  assert.equal((await requestRefund(f.env,row(f),{reason:"generation_failed"})).state,"pending");
  assert.equal(f.db.prepare("SELECT count(*) n FROM refund_requests").get().n,2);
});
test("同一订单最多两次售后申请，重复付款不受次数限制",async()=>{
  const f=await fixture();await paidOrder(f);
  for(let i=0;i<2;i++){const r=await requestRefund(f.env,row(f),{reason:"image_quality"});await reviewRefund(f.env,r.id,{action:"reject",note:"图片已交付"});}
  await assert.rejects(()=>requestRefund(f.env,row(f),{reason:"image_quality"}),error=>error instanceof Response&&error.status===409);
  assert.equal(row(f).refund_status,"rejected");
  assert.equal((await requestRefund(f.env,row(f),{reason:"duplicate_payment"})).state,"pending");
});
test("审核期间仍可领取已生成的头像，批准退款后才收回",async()=>{
  const f=await fixture(),o=await paidOrder(f);globalThis.fetch=async()=>generated();await run(f,o);assert.equal(row(f).status,"ready");
  const r=await requestRefund(f.env,row(f),{reason:"image_quality"});
  assert.match(orderPayload(row(f)).imageUrl,/\/api\/jobs\//);
  assert.equal((await image({env:f.env,params:{jobId:o.payId},request:new Request("https://pet.test",{headers:{"X-PT-Token":f.token}})})).status,200);
  await reviewRefund(f.env,r.id,{action:"approve"});
  assert.equal(orderPayload(row(f)).imageUrl,null);
  assert.equal((await image({env:f.env,params:{jobId:o.payId},request:new Request("https://pet.test",{headers:{"X-PT-Token":f.token}})})).status,409);
});
test("下单时锁定Prompt和素材版本，后续配置修改不改变已付订单",async()=>{
  const f=await fixture(),o=await paidOrder(f);GENERATION_CONFIG.prompts.cat="new prompt";GENERATION_CONFIG.roleImageKeys.cat.mummy="references/new.png";GENERATION_CONFIG.size="8x8";
  globalThis.fetch=async(_url,options)=>{const body=JSON.parse(options.body);assert.equal(body.prompt,"cat / mummy / 馒头");assert.equal(body.size,"4x4");return generated();};await run(f,o);assert.equal(row(f).status,"ready");
});
test("过期备料任务恢复后，旧执行者不能再启动收费调用或封锁新任务",async()=>{
  const f=await fixture(),o=await paidOrder(f);const get=f.env.PETI_IMAGES.get.bind(f.env.PETI_IMAGES);let release,preparing=false,first=true;const gate=new Promise(r=>release=r);
  f.env.PETI_IMAGES.get=async key=>{if(key==="photos/pet.jpg"&&first){first=false;preparing=true;await gate;}return get(key);};
  let calls=0;globalThis.fetch=async()=>{calls++;return generated();};const old=run(f,o);while(!preparing)await new Promise(r=>setTimeout(r,1));
  f.db.prepare("UPDATE delivery_jobs SET lease_until=0").run();await recoverStaleGenerations(f.env);release();await old;assert.equal(calls,0);assert.equal(f.db.prepare("SELECT state FROM delivery_jobs").get().state,"pending");await run(f,o);assert.equal(calls,1);assert.equal(row(f).status,"ready");
});
test("金额不匹配保留真实付款台账供退款，不能因此生成；旧交易不被重新认领",async()=>{
  const f=await fixture(),o=await newOrder(f);globalThis.fetch=async()=>paidResponse(o,{total_amount:"6.00"});
  assert.equal((await post(confirm,f,{platformOrderNo:"2026102800000001"},{payId:o.payId})).status,409);assert.equal(row(f).status,"unpaid");assert.equal(f.db.prepare("SELECT amount_fen FROM payment_transactions").get().amount_fen,600);
  const r=await requestRefund(f.env,row(f),{reason:"payment_unconfirmed"});await reviewRefund(f.env,r.id,{action:"approve"});assert.equal(f.db.prepare("SELECT amount_fen FROM refund_requests").get().amount_fen,600);
});
test("退款最后一步写入失败时整批回滚，同一笔交易不会留下第二次退款资格",async()=>{
  const f=await fixture(),o=await paidOrder(f);await bindVerifiedPayment(f.env,row(f),paid(o,{out_trade_no:"2026102800000002"}));
  const r=await requestRefund(f.env,row(f),{reason:"duplicate_payment"});await reviewRefund(f.env,r.id,{action:"approve"});
  const prepare=f.env.PETI_DB.prepare;f.env.PETI_DB.prepare=sql=>{const statement=prepare(sql);if(sql.startsWith("UPDATE payment_transactions SET state='refunded'"))statement.run=async()=>{throw Error("injected write failure");};return statement;};
  const body={action:"refunded",channel:"原路",proofReference:"refund-extra",amountFen:row(f).amount_fen};await assert.rejects(()=>reviewRefund(f.env,r.id,body));
  assert.equal(f.db.prepare("SELECT state FROM refund_requests WHERE id=?").get(r.id).state,"approved");assert.equal(row(f).refund_status,"approved");assert.equal(f.db.prepare("SELECT state FROM payment_transactions WHERE trade_no='2026102800000002'").get().state,"duplicate");
  assert.equal((await requestRefund(f.env,row(f),{reason:"duplicate_payment"})).id,r.id);f.env.PETI_DB.prepare=prepare;await reviewRefund(f.env,r.id,body);
  const second=await requestRefund(f.env,row(f),{reason:"duplicate_payment"});await assert.rejects(()=>reviewRefund(f.env,second.id,{action:"approve"}),responseError);
});
test("原付款退款后，后发现的额外付款仍可退款，但不恢复已退权益",async()=>{
  const f=await fixture(),o=await paidOrder(f);const r=await requestRefund(f.env,row(f),{reason:"generation_failed"});await reviewRefund(f.env,r.id,{action:"approve"});await reviewRefund(f.env,r.id,{action:"refunded",channel:"原路",proofReference:"primary",amountFen:row(f).amount_fen});assert.equal(row(f).primary_refunded,1);
  await bindVerifiedPayment(f.env,row(f),paid(o,{out_trade_no:"2026102800000002"}));const extra=await requestRefund(f.env,row(f),{reason:"duplicate_payment"});await reviewRefund(f.env,extra.id,{action:"approve"});await reviewRefund(f.env,extra.id,{action:"refunded",channel:"原路",proofReference:"extra",amountFen:row(f).amount_fen});
  assert.equal(row(f).primary_refunded,1);assert.equal(row(f).refund_status,"refunded");assert.equal(f.db.prepare("SELECT count(*) n FROM payment_transactions WHERE state='refunded'").get().n,2);let calls=0;globalThis.fetch=async()=>{calls++;return generated();};await run(f,o);assert.equal(calls,0);
});
test("管理员填写额外交易时核实该交易，不用原付款号覆盖输入",async()=>{
  const f=await fixture(),o=await paidOrder(f);let queried;
  globalThis.fetch=async(_url,options)=>{queried=JSON.parse(JSON.parse(options.body).params).out_trade_no;return paidResponse(o,{out_trade_no:"2026102800000003"});};
  const response=await adminVerify({env:f.env,params:{orderId:o.payId},request:new Request("https://pet.test/api/admin",{method:"POST",headers:{authorization:`Bearer ${f.env.AVATAR_ADMIN_SECRET}`,"content-type":"application/json"},body:JSON.stringify({action:"verify_payment",tradeNo:"2026102800000003"})})});
  assert.equal(response.status,200);assert.equal(queried,"2026102800000003");assert.equal(f.db.prepare("SELECT state FROM payment_transactions WHERE trade_no=?").get(queried).state,"duplicate");
});
test("重叠恢复任务与恢复后新生成之间有独立认领，旧恢复者不能修改新一轮",async()=>{
  const f=await fixture(),o=await paidOrder(f),attempt=crypto.randomUUID(),key=`jobs/${o.payId}/old.png`;
  f.db.prepare("UPDATE orders SET status='generating',attempts=1").run();f.db.prepare("UPDATE delivery_jobs SET state='running',attempt_id=?,lease_until=0").run(attempt);f.db.prepare("INSERT INTO generation_attempts(id,order_id,state,stage,started_at,image_key)VALUES(?,?,'preparing','preparing',0,?)").run(attempt,o.payId,key);
  const head=f.env.PETI_IMAGES.head.bind(f.env.PETI_IMAGES);let releaseHead,checking=false,first=true;const headGate=new Promise(r=>releaseHead=r);f.env.PETI_IMAGES.head=async k=>{if(k===key&&first){first=false;checking=true;await headGate;}return head(k);};
  const firstRecovery=recoverStaleGenerations(f.env);while(!checking)await new Promise(r=>setTimeout(r,1));f.db.prepare("UPDATE delivery_jobs SET lease_until=0").run();await recoverStaleGenerations(f.env);assert.equal(row(f).status,"unlocked");
  let releaseModel,called=false;const modelGate=new Promise(r=>releaseModel=r);globalThis.fetch=async()=>{called=true;await modelGate;return generated();};const newGeneration=run(f,o);while(!called)await new Promise(r=>setTimeout(r,1));releaseHead();await firstRecovery;assert.equal(row(f).status,"generating");assert.equal(row(f).attempts,1);releaseModel();await newGeneration;assert.equal(row(f).status,"ready");assert.equal(f.db.prepare("SELECT state FROM delivery_jobs").get().state,"succeeded");
});
test("未知结果积压超过20笔也不会阻塞运行任务恢复",async()=>{
  const f=await fixture(),o=await paidOrder(f);
  for(let i=0;i<21;i++){const id=crypto.randomUUID(),attempt=crypto.randomUUID();f.db.prepare("INSERT INTO orders(id,test_id,token_hash,photo_id,amount_fen,plan_id,sku_id,result_json,status,created_at,expires_at) SELECT ?,?,token_hash,photo_id,amount_fen,plan_id,sku_id,result_json,'uncertain',created_at,expires_at FROM orders WHERE id=?").run(id,id,o.payId);f.db.prepare("INSERT INTO delivery_jobs(order_id,state,attempt_id,updated_at)VALUES(?,'uncertain',?,0)").run(id,attempt);f.db.prepare("INSERT INTO generation_attempts(id,order_id,state,stage,started_at,image_key)VALUES(?,?,'uncertain','calling',0,?)").run(attempt,id,`jobs/${id}/missing.png`);}
  const attempt=crypto.randomUUID();f.db.prepare("UPDATE orders SET status='generating',attempts=1 WHERE id=?").run(o.payId);f.db.prepare("UPDATE delivery_jobs SET state='running',attempt_id=?,lease_until=0 WHERE order_id=?").run(attempt,o.payId);f.db.prepare("INSERT INTO generation_attempts(id,order_id,state,stage,started_at)VALUES(?,?,'preparing','preparing',0)").run(attempt,o.payId);
  await recoverStaleGenerations(f.env);assert.equal(storedOrder(f,o.payId).status,"unlocked");assert.equal(f.db.prepare("SELECT count(*) n FROM delivery_jobs WHERE state='uncertain' AND next_at>0").get().n,20);
});
test("旧退款驳回不能覆盖后续审核已启动的新生成",async()=>{
  const f=await fixture(),o=await paidOrder(f);const first=await requestRefund(f.env,row(f),{reason:"image_quality"});
  const prepare=f.env.PETI_DB.prepare;let releaseRead,reading=false,hold=true;const readGate=new Promise(r=>releaseRead=r);
  f.env.PETI_DB.prepare=sql=>{const statement=prepare(sql);if(sql==="SELECT * FROM delivery_jobs WHERE order_id=?"){const get=statement.first.bind(statement);statement.first=async()=>{const snapshot=await get();if(hold){hold=false;reading=true;await readGate;}return snapshot;};}return statement;};
  const oldReview=reviewRefund(f.env,first.id,{action:"reject",note:"第一次复核"});while(!reading)await new Promise(r=>setTimeout(r,1));
  const second=await requestRefund(f.env,row(f),{reason:"image_quality"});await reviewRefund(f.env,second.id,{action:"reject",note:"用户希望继续生成"});
  let releaseModel,called=false;const modelGate=new Promise(r=>releaseModel=r);globalThis.fetch=async()=>{called=true;await modelGate;return generated();};const current=run(f,o);while(!called)await new Promise(r=>setTimeout(r,1));releaseRead();await oldReview;
  assert.equal(row(f).status,"generating");assert.equal(f.db.prepare("SELECT state FROM delivery_jobs").get().state,"running");releaseModel();await current;assert.equal(row(f).status,"ready");
});
test("完成提醒写入中断后从已存成品恢复，补交付和提醒而不重复调用模型",async()=>{
  const f=await fixture(),o=await paidOrder(f);let calls=0;globalThis.fetch=async()=>{calls++;return generated();};
  const prepare=f.env.PETI_DB.prepare;let fail=true;f.env.PETI_DB.prepare=sql=>{const statement=prepare(sql);if(sql.includes("SELECT ?,id,'ready'")&&fail)statement.run=async()=>{fail=false;throw Error("notification insert interrupted");};return statement;};
  await run(f,o);assert.notEqual(row(f).status,"ready");assert.equal(f.db.prepare("SELECT count(*) n FROM avatar_notifications WHERE event='ready'").get().n,0);
  f.env.PETI_DB.prepare=prepare;f.db.prepare("UPDATE delivery_jobs SET next_at=0").run();await recoverStaleGenerations(f.env);assert.equal(row(f).status,"ready");assert.equal(f.db.prepare("SELECT count(*) n FROM avatar_notifications WHERE event='ready'").get().n,1);assert.equal(calls,1);
});
test("模拟付款需要管理员凭证和服务端测试开关，正式环境不能调用",async()=>{
  const f=await fixture(),o=await newOrder(f);
  const call=token=>adminVerify({env:f.env,params:{orderId:o.payId},request:new Request("https://pet.test/api/admin",{method:"POST",headers:{authorization:`Bearer ${token}`,"content-type":"application/json"},body:JSON.stringify({action:"confirm_test_payment",testMode:true})})});
  assert.equal((await call(f.env.AVATAR_ADMIN_SECRET)).status,404);assert.equal(row(f).status,"unpaid");
  f.env.PETI_TEST_MODE="true";assert.equal((await call("wrong")).status,401);assert.equal((await call(f.env.AVATAR_ADMIN_SECRET)).status,200);assert.equal(row(f).status,"queued");
});
test("测试环境不提供真实付款链接，也不扫描或发送爱发电消息",async()=>{
  const f=await fixture();f.env.PETI_TEST_MODE="true";configured();delete f.env.AFDIAN_API_TOKEN;delete f.env.AFDIAN_PAY_URL;
  const o=await (await post(checkout,f,{})).json();assert.equal(o.testMode,true);assert.equal(o.payUrl,null);
  await bindVerifiedPayment(f.env,row(f),paid(o));let calls=0;globalThis.fetch=async()=>{calls++;throw Error("must not contact Afdian");};
  await reconcilePayments(f.env);await sendAvatarNotification(f.env,`${o.payId}:paid`);assert.equal(calls,0);assert.equal(f.db.prepare("SELECT state FROM avatar_notifications").get().state,"test_captured");
  assert.match(f.db.prepare("SELECT value FROM delivery_control WHERE key LIKE 'test_notice:%'").get().value,/avatar.html/);
});
