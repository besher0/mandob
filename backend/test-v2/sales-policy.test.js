'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {priceItems,centsText,date}=require('../src/sales-service');
const one='11111111-1111-4111-8111-111111111111';
const two='22222222-2222-4222-8222-222222222222';
function item(overrides={}){return {productId:one,quantity:2,unitPrice:'100.00',
  offerType:'NONE',bonusQuantity:0,discountPercent:'0',...overrides};}
test('server computes totals precisely with discount and bonus',()=>{
  const [normal]=priceItems([item()]);
  assert.equal(normal.total,'200.00');
  const [discount]=priceItems([item({offerType:'DISCOUNT',discountPercent:'12.50'})]);
  assert.equal(discount.total,'175.00');
  const [bonus]=priceItems([item({offerType:'BONUS',bonusQuantity:3})]);
  assert.equal(bonus.total,'200.00','free bonus is not billed');
  assert.equal(centsText(1234567n),'12345.67');
});
test('reject duplicated products, invalid discounts, malformed money and offer mismatch',()=>{
  assert.throws(()=>priceItems([item(),item()]),/مكرر/);
  assert.throws(()=>priceItems([item({quantity:0})]));
  assert.throws(()=>priceItems([item({unitPrice:'Infinity'})]));
  assert.throws(()=>priceItems([item({unitPrice:'1e5'})]));
  assert.throws(()=>priceItems([item({unitPrice:'0.00'})]));
  assert.throws(()=>priceItems([item({offerType:'DISCOUNT',discountPercent:'0'})]));
  assert.throws(()=>priceItems([item({offerType:'BONUS',bonusQuantity:0})]));
  assert.throws(()=>priceItems([item({discountPercent:'10'})]));
  assert.throws(()=>priceItems([item({offerType:'DISCOUNT',discountPercent:'100.01'})]));
  assert.throws(()=>priceItems([item({productId:'bad-id'})]));
  assert.equal(priceItems([item(),item({productId:two})]).length,2);
});
test('sales dates cannot be malformed or in the future',()=>{
  assert.throws(()=>date('2026-02-31'));
  assert.throws(()=>date('2099-01-01'));
  assert.equal(date('2026-01-01').toISOString(),'2026-01-01T00:00:00.000Z');
});
