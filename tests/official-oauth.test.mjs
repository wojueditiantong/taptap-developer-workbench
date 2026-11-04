import test from 'node:test';
import assert from 'node:assert/strict';
import {weChatAuthorizationUrl} from '../lib/official-editor-url.mjs';

test('微信授权只接受微信官方 HTTPS 授权端点', () => {
  const qr = 'https://open.weixin.qq.com/connect/qrconnect?appid=smoke&state=test';
  const mobile = 'https://open.weixin.qq.com/connect/oauth2/authorize?appid=smoke#wechat_redirect';
  assert.equal(weChatAuthorizationUrl(qr), qr);
  assert.equal(weChatAuthorizationUrl(mobile), mobile);
  for (const value of [
    'http://open.weixin.qq.com/connect/qrconnect',
    'https://open.weixin.qq.com.evil.example/connect/qrconnect',
    'https://open.weixin.qq.com@evil.example/connect/qrconnect',
    'https://user:password@open.weixin.qq.com/connect/qrconnect',
    'https://open.weixin.qq.com/other',
    'https://example.com/connect/qrconnect',
    'javascript:alert(1)',
    'not-a-url',
  ]) assert.equal(weChatAuthorizationUrl(value), '', value);
});

test('伪造域名与协议相对地址不能绕过微信授权白名单', () => {
  for (const value of [
    '//open.weixin.qq.com/connect/qrconnect',
    'https://evil.example/?next=https://open.weixin.qq.com/connect/qrconnect',
    'https://open.weixin.qq.com/connect/qrconnect.evil',
    '',
    null,
  ]) assert.equal(weChatAuthorizationUrl(value), '');
});
