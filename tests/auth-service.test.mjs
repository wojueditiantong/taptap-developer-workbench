import test from 'node:test';
import assert from 'node:assert/strict';
import {createAuthService, parseLoginData} from '../lib/auth-service.mjs';

const loginResult = () => ({
  ok: true,
  data: {
    verification_url: 'https://accounts.taptap.cn/device?qrcode=1&user_code=test',
    device_code: 'temporary-secret',
    expires_at: 2000,
    interval: 1,
  },
});

test('应用内授权只返回登录链接，设备码不进入浏览器或记录', async () => {
  const calls = [];
  let finishPoll;
  const service = createAuthService({
    now: () => 1000000,
    runCli: async (args, options) => {
      calls.push({args, options});
      if (args.includes('--no-wait')) return loginResult();
      return new Promise(resolve => { finishPoll = resolve; });
    },
  });
  const started = await service.start();
  assert.equal(started.status, 'waiting');
  assert.equal(started.verificationUrl, 'https://accounts.taptap.cn/device?qrcode=1&user_code=test');
  assert.doesNotMatch(JSON.stringify(started), /temporary-secret/);
  assert.deepEqual(calls[1].args, [
    'auth', 'login', '--device-code', 'temporary-secret',
    '--expires-at-unix', '2000', '--interval-seconds', '1',
  ]);
  await service.start();
  assert.equal(calls.filter(call => call.args.includes('--no-wait')).length, 1);
  finishPoll({ok: true, data: {access_token: 'never-return-this'}});
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(service.getStatus(), {status: 'connected', verificationUrl: null, expiresAt: null, message: null});
});

test('授权链接过期后可以重新发起，取消不会留下等待状态', async () => {
  let clock = 1000000;
  const service = createAuthService({
    now: () => clock,
    runCli: async args => args.includes('--no-wait') ? loginResult() : new Promise(() => {}),
  });
  await service.start();
  clock = 2000000;
  assert.equal(service.getStatus().status, 'expired');
  clock = 1000000;
  await service.start();
  assert.equal(service.getStatus().status, 'waiting');
  assert.equal(service.cancel().status, 'idle');
});

test('非官方授权地址与不完整返回会被拒绝', () => {
  assert.throws(() => parseLoginData({ok: true, data: {...loginResult().data, verification_url: 'https://example.com/login'}}), /无法识别/);
  assert.throws(() => parseLoginData({ok: true, data: {...loginResult().data, device_code: ''}}), /不完整/);
});

test('退出连接调用官方登出并清理授权会话', async () => {
  const calls = [];
  const service = createAuthService({runCli: async args => {
    calls.push(args);
    return {ok: true, data: null};
  }});
  const result = await service.logout();
  assert.equal(result.status, 'idle');
  assert.deepEqual(calls, [['auth', 'logout']]);
  assert.doesNotMatch(JSON.stringify(result), /token|device/i);
});
