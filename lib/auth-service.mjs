const LOGIN_HOST = 'accounts.taptap.cn';

function publicSession(session) {
  if (!session) return {status: 'idle', verificationUrl: null, expiresAt: null};
  return {
    status: session.status,
    verificationUrl: session.status === 'waiting' ? session.verificationUrl : null,
    expiresAt: session.status === 'waiting' ? session.expiresAt : null,
    message: session.message || null,
  };
}

function loginData(result) {
  if (!result?.ok) throw new Error('暂时无法发起 TapTap 授权，请稍后重试');
  const data = result.data || {};
  const url = new URL(data.verification_url || '');
  if (url.protocol !== 'https:' || url.hostname !== LOGIN_HOST) throw new Error('官方返回了无法识别的授权地址，已停止连接');
  if (!data.device_code || !Number.isFinite(Number(data.expires_at)) || !Number.isFinite(Number(data.interval))) {
    throw new Error('官方授权返回不完整，请重新连接');
  }
  return {
    verificationUrl: url.toString(),
    deviceCode: String(data.device_code),
    expiresAt: Number(data.expires_at),
    interval: Math.max(1, Number(data.interval)),
  };
}

export function createAuthService({runCli, now = () => Date.now()}) {
  let session = null;
  let starting = null;

  function getStatus() {
    if (session?.status === 'waiting' && now() >= session.expiresAt * 1000) {
      session.controller.abort();
      session = {status: 'expired', message: '登录链接已过期，请重新连接'};
    }
    return publicSession(session);
  }

  function cancel() {
    session?.controller?.abort();
    session = {status: 'idle'};
    return publicSession(session);
  }

  async function poll(current) {
    const timeoutMs = Math.max(5000, current.expiresAt * 1000 - now() + 10000);
    try {
      const result = await runCli([
        'auth', 'login',
        '--device-code', current.deviceCode,
        '--expires-at-unix', String(current.expiresAt),
        '--interval-seconds', String(current.interval),
      ], {timeoutMs, signal: current.controller.signal});
      if (session !== current) return;
      session = result?.ok
        ? {status: 'connected'}
        : {status: 'error', message: '授权没有完成，请重新连接'};
    } catch {
      if (session === current) session = {status: 'error', message: '授权等待中断，请重新连接'};
    }
  }

  async function start() {
    const current = getStatus();
    if (current.status === 'waiting') return current;
    if (starting) return starting;
    cancel();
    starting = (async () => {
      const result = await runCli(['auth', 'login', '--no-wait', '--json'], {timeoutMs: 30000});
      const data = loginData(result);
      const controller = new AbortController();
      session = {
        status: 'waiting',
        verificationUrl: data.verificationUrl,
        deviceCode: data.deviceCode,
        expiresAt: data.expiresAt,
        interval: data.interval,
        controller,
      };
      const currentSession = session;
      void poll(currentSession);
      return publicSession(currentSession);
    })();
    try { return await starting; }
    finally { starting = null; }
  }

  async function logout() {
    cancel();
    const result = await runCli(['auth', 'logout'], {timeoutMs: 30000});
    if (!result?.ok) throw new Error('退出连接未完成，请稍后重试');
    return publicSession(session);
  }

  return {start, getStatus, cancel, logout};
}

export {loginData as parseLoginData, publicSession as publicAuthSession};
