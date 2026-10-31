import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
const order={payId:"test-order",petName:"馒头",petType:"dog",roleId:"pirate",roleName:"海盗汪",status:"queued",amountFen:180,refundStatus:"none",refundEligible:false,expiresAt:new Date(Date.now()+86400000).toISOString()};
test("专属链接直达订单，清除地址栏凭证，后台完成后保存头像",async({page})=>{
  let ready=false;const headers=[];
  await page.route("**/api/checkout/test-order",route=>{headers.push(route.request().headers()["x-pt-token"]);return route.fulfill({json:{...order,status:ready?"ready":"queued",imageUrl:ready?"/api/jobs/test-order/image":null}});});
  await page.route("**/api/refund-requests**",route=>route.fulfill({json:{request:null}}));
  await page.route("**/api/jobs/test-order/image*",async route=>route.fulfill({contentType:"image/png",body:await readFile(new URL("../public/assets/illus-nurse.png",import.meta.url))}));
  await page.setViewportSize({width:390,height:844});await page.goto("/avatar.html#order=test-order&access=secret-order-access");
  await expect(page.locator("#avatarMessage")).toContainText("已排队");expect(page.url()).not.toContain("access=");expect(headers).toEqual(["secret-order-access"]);
  ready=true;await page.locator("#refreshAvatar").click();await expect(page.locator("#avatarImage")).toBeVisible();
  const [download]=await Promise.all([page.waitForEvent("download"),page.locator("#downloadAvatar").click()]);expect(download.suggestedFilename()).toBe("PETI-馒头-万圣节头像.jpg");
  const bytes=await readFile(await download.path());expect(bytes.subarray(0,2).toString("hex")).toBe("ffd8");
  await page.reload();await expect(page.locator("#avatarImage")).toBeVisible();await page.screenshot({path:".wrangler/avatar-delivered-mobile.png",fullPage:true});
});
test("微信手机页保存头像前换成可长按保存的 https 图片地址",async({browser})=>{
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,userAgent:"Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/130 Mobile Safari/537.36 MicroMessenger/8.0"});
  const page=await context.newPage();
  const hostedId="11111111-2222-3333-4444-555555555555";
  const image=await readFile(new URL("../public/assets/illus-nurse.png",import.meta.url));
  const uploads=[];
  try{
    // 微信 WebView 没有 Web Share，强制走长按保存分支。
    await page.addInitScript(()=>{Object.defineProperty(navigator,"share",{configurable:true,value:undefined});Object.defineProperty(navigator,"canShare",{configurable:true,value:undefined});});
    await page.route("**/api/checkout/test-order",route=>route.fulfill({json:{...order,status:"ready",imageUrl:"/api/jobs/test-order/image"}}));
    await page.route("**/api/refund-requests**",route=>route.fulfill({json:{request:null}}));
    await page.route("**/api/jobs/test-order/image*",route=>route.fulfill({contentType:"image/png",body:image}));
    await page.route("**/api/save-images",route=>{uploads.push(route.request().postDataBuffer());return route.fulfill({status:201,json:{path:`/api/save-images/${hostedId}.png`}});});
    await page.route(`**/api/save-images/${hostedId}.png`,route=>route.fulfill({contentType:"image/png",body:image}));
    await page.goto("/avatar.html#order=test-order&access=access");
    await expect(page.locator("#avatarImage")).toBeVisible();
    await page.locator("#downloadAvatar").click();
    // 长按保存 blob: 图片在微信里会提示“保存失败”，所以页面上的图要换成 https 地址。
    await expect(page.locator("#avatarImage")).toHaveAttribute("src",new RegExp(`/api/save-images/${hostedId}\\.png$`));
    await expect(page.locator("#avatarMessage")).toContainText("长按头像保存");
    expect(uploads.length).toBe(1);expect(uploads[0].subarray(0,2).toString("hex")).toBe("ffd8");
  }finally{await context.close();}
});

test("超时未交付可提交退款，订单自动带入，提交后显示暂停生成",async({page})=>{
  let request=null,submitted;
  await page.route("**/api/checkout/test-order",route=>route.fulfill({json:{...order,status:"uncertain",refundStatus:request?.status==="pending"?"pending":"none",refundEligible:true}}));
  await page.route("**/api/refund-requests**",route=>{if(route.request().method()==="POST"){const body=route.request().postDataJSON();if(body.action==="withdraw"){request={...request,status:"withdrawn"};return route.fulfill({json:request});}submitted=body;request={requestId:"refund-1",status:"pending",note:"",reason:body.reason};return route.fulfill({status:201,json:request});}return route.fulfill({json:{request}});});
  await page.setViewportSize({width:320,height:844});await page.goto("/avatar.html#order=test-order&access=access");
  await expect(page.locator("#refundHint")).toContainText("超过 10 分钟");await page.locator("#openRefundBtn").click();await page.locator("#refundDetails").fill("已等待很久仍未收到头像");
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:".wrangler/avatar-refund-mobile.png",fullPage:true});
  await page.locator("#submitRefundBtn").click();await expect(page.locator("#refundStatus")).toContainText("待审核");await expect(page.locator("#avatarMessage")).toContainText("已暂停");expect(submitted.payId).toBe("test-order");expect(submitted.token).toBe("access");
  await expect(page.locator("#withdrawRefundBtn")).toBeVisible();page.once("dialog",dialog=>dialog.accept());await page.locator("#withdrawRefundBtn").click();
  await expect(page.locator("#refundStatus")).toContainText("已撤回");await expect(page.locator("#withdrawRefundBtn")).toBeHidden();await expect(page.locator("#openRefundBtn")).toContainText("重新申请退款");
});
test("退款待审核期间仍显示已生成的头像",async({page})=>{
  await page.route("**/api/checkout/test-order",route=>route.fulfill({json:{...order,status:"ready",refundStatus:"pending",refundEligible:true,imageUrl:"/api/jobs/test-order/image"}}));
  await page.route("**/api/refund-requests**",route=>route.fulfill({json:{request:{requestId:"refund-1",status:"pending",reason:"image_quality",note:""}}}));
  await page.route("**/api/jobs/test-order/image*",async route=>route.fulfill({contentType:"image/png",body:await readFile(new URL("../public/assets/illus-nurse.png",import.meta.url))}));
  await page.setViewportSize({width:390,height:844});await page.goto("/avatar.html#order=test-order&access=access");
  await expect(page.locator("#avatarImage")).toBeVisible();await expect(page.locator("#downloadAvatar")).toBeVisible();
  await expect(page.locator("#withdrawRefundBtn")).toBeVisible();await expect(page.locator("#avatarMessage")).toContainText("仍可保存");
});
test("链接凭证缺失时提供找回说明，不查询或暴露订单",async({page})=>{
  let calls=0;await page.route("**/api/**",route=>{calls++;return route.abort();});await page.goto("/avatar.html#order=test-order");await expect(page.locator("#avatarError")).toContainText("从爱发电私信");expect(calls).toBe(0);
});
test("售后工作台审核流程可用，管理员凭证不写入浏览器存储",async({page})=>{
  let state="pending",actions=[];
  await page.route("**/api/admin/avatar-orders",route=>{expect(route.request().headers().authorization).toBe("Bearer test-admin");return route.fulfill({json:{orders:[],refunds:[{id:"refund-1",order_id:"test-order",state,amount_fen:180,reason:"generation_failed",details:"生成失败",contact:"",review_note:""}],attempts:[],payments:[],notifications:[],heartbeatAt:Date.now()}});});
  await page.route("**/api/admin/refunds/refund-1",route=>{const body=route.request().postDataJSON();actions.push(body);state=body.action==="approve"?"approved":"refunded";return route.fulfill({json:{status:state}});});
  await page.goto("/avatar-admin.html");await page.locator("#adminSecret").fill("test-admin");await page.locator("#adminLogin button").click();await expect(page.locator("#adminContent")).toBeVisible();
  await page.locator("#reviewSubmit").click();await expect(page.locator("#refundDetail")).toContainText("已批准");expect(actions[0].action).toBe("approve");
  await page.locator("#reviewAction").selectOption("refunded");await page.locator("#reviewChannel").fill("爱发电原路退款");await page.locator("#reviewProof").fill("verified-proof-1");await page.locator("#reviewAmount").fill("1.80");
  page.once("dialog",dialog=>dialog.accept());await page.locator("#reviewSubmit").click();await expect(page.locator("#refundDetail")).toContainText("已退款");expect(actions[1].amountFen).toBe(180);
  expect(await page.evaluate(()=>JSON.stringify({...localStorage,...sessionStorage}))).not.toContain("test-admin");await page.screenshot({path:".wrangler/avatar-admin-refunds.png",fullPage:true});
});
for(const primaryRefunded of [false,true])test(`已完成退款后仍能核对其他付款：原付款已退=${primaryRefunded}`,async({page})=>{
  await page.route("**/api/checkout/test-order",route=>route.fulfill({json:{...order,status:"failed",refundStatus:primaryRefunded?"refunded":"none",primaryRefunded}}));
  await page.route("**/api/refund-requests**",route=>route.fulfill({json:{request:{status:"refunded",reason:"duplicate_payment",note:"",channel:"原路",proofReference:"extra-refund"}}}));
  await page.goto("/avatar.html#order=test-order&access=access");await expect(page.locator("#openRefundBtn")).toBeVisible();await page.locator("#openRefundBtn").click();await expect(page.locator("#refundForm")).toBeVisible();
  if(primaryRefunded){await expect(page.locator("#refundReason")).toHaveValue("duplicate_payment");await expect(page.locator("#refundReason")).toBeDisabled();}
  else await expect(page.locator("#refundReason")).toBeEnabled();
});
