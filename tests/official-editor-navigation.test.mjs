import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {loadOfficialEditorDocument} from '../lib/official-editor-navigation.mjs';

const officialPage = value => /^https:\/\/([^.]+\.)?taptap\.cn\//.test(value);

function contentsWith({url, error, loading = false}) {
  const contents = new EventEmitter();
  contents.url = url;
  contents.loading = loading;
  contents.isLoading = () => contents.loading;
  contents.isDestroyed = () => false;
  contents.getURL = () => contents.url;
  contents.loadURL = async () => {
    if (error) throw error;
    contents.url = 'https://www.taptap.cn/moment-editor';
    return contents.url;
  };
  return contents;
}

test('登录跳转触发 ERR_ABORTED 时等待官方页面完成加载', async () => {
  const error = new Error("ERR_ABORTED (-3) loading 'https://www.taptap.cn/auth/login-by-accounts?session_id=test'");
  error.code = 'ERR_ABORTED';
  const contents = contentsWith({url: 'https://www.taptap.cn/auth/login-by-accounts?session_id=test', error, loading: true});
  const pending = loadOfficialEditorDocument({contents, target: 'https://www.taptap.cn/moment-editor', officialPage, settleTimeout: 500});
  setTimeout(() => {
    contents.url = 'https://accounts.taptap.cn/account/login';
    contents.loading = false;
    contents.emit('did-finish-load');
  }, 20);
  assert.equal(await pending, 'https://accounts.taptap.cn/account/login');
  assert.equal(contents.listenerCount('did-stop-loading'), 0);
  assert.equal(contents.listenerCount('did-finish-load'), 0);
});

test('只有仍在 TapTap 官方域内的中断才按登录跳转处理', async () => {
  const error = new Error('ERR_ABORTED (-3)');
  error.code = 'ERR_ABORTED';
  const contents = contentsWith({url: '', error});
  await assert.rejects(loadOfficialEditorDocument({contents, target: 'https://www.taptap.cn/moment-editor', officialPage}), /ERR_ABORTED/);
});

test('其他页面加载错误不会被吞掉', async () => {
  const error = new Error('ERR_CONNECTION_TIMED_OUT');
  error.code = 'ERR_CONNECTION_TIMED_OUT';
  const contents = contentsWith({url: '', error});
  await assert.rejects(loadOfficialEditorDocument({contents, target: 'https://www.taptap.cn/moment-editor', officialPage}), /ERR_CONNECTION_TIMED_OUT/);
});
