import test from 'node:test';
import assert from 'node:assert/strict';
import {createDesktopApi} from '../desktop/api.mjs';

function fixture() {
  const events = [];
  const state = {devId: '10', appId: '20'};
  return {
    events,
    state,
    api: createDesktopApi({
      auth: {getStatus: () => ({status: 'connected'}), logout: async () => {events.push('credentials'); return {status: 'idle'};}},
      store: {saveState: async next => {events.push('context'); Object.assign(state, next); return state;}},
      service: {},
      clearAuthorizationSession: async () => events.push('session'),
    }),
  };
}

test('桌面退出清除官方凭据、独立授权会话和旧游戏选择', async () => {
  const {api, events, state} = fixture();
  const result = await api('/api/auth/logout', {method: 'POST'});
  assert.equal(result.status, 'idle');
  assert.deepEqual(events, ['credentials', 'session', 'context']);
  assert.deepEqual(state, {devId: '', appId: ''});
});

test('桌面应用不启动网页端口，使用隔离的 IPC 请求', async () => {
  const {api} = fixture();
  assert.equal((await api('/api/health')).mode, 'desktop');
  await assert.rejects(api('/api/not-found'), /不支持/);
});
