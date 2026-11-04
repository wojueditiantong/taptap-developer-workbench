export function smokeData(args) {
  if (args[0] === 'dashboard-stats' && args[1] === 'get-dashboard-stats') {
    const data = JSON.parse(args[args.indexOf('--data') + 1]);
    const metric = data.metric;
    const specs = {
      pv: {highlights: [{label: '总浏览量', value: '8640'}], key: 'pv_from_total', values: [1050, 1210, 1120, 1380, 1290, 1270, 1320], sources: {index_feed: 5100, search: 1380, outer: 860, community: 620, find_game: 480}},
      download: {highlights: [{label: '总体新增下载请求量', value: '1560'}, {label: '平台处理后', value: '1482'}], key: 'all_download_new', values: [180, 205, 196, 240, 250, 238, 251]},
      reserve: {highlights: [{label: '预约总量', value: '32'}], key: 'reserve', values: [3, 4, 5, 4, 6, 5, 5]},
      review: {highlights: [{label: '好评', value: '18'}, {label: '中评', value: '5'}, {label: '差评', value: '2'}], key: 'positive', values: [2, 3, 2, 3, 2, 3, 3]},
      topic: {highlights: [{label: '帖子量', value: '14'}], key: 'topic', values: [1, 2, 1, 3, 2, 2, 3]},
    };
    const spec = specs[metric];
    if (!spec) return null;
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const previous = data.end_date < today;
    const factor = previous ? 0.8 : 1;
    const highlights = spec.highlights.map(item => ({...item, value: String(Math.round(Number(item.value) * factor))}));
    const series = spec.values.map((value, index) => {
      const date = new Date(`${data.start_date || '2026-10-25'}T00:00:00Z`);
      date.setUTCDate(date.getUTCDate() + index);
      return {timestamp: date.toISOString().slice(0, 10), values: {[spec.key]: Math.round(value * factor), ...(metric === 'review' ? {score: 8.2} : {})}};
    });
    return {ok: true, data: {result: {metric, highlights, series, columns: [{key: 'index_feed', label: '首页推荐'}, {key: 'search', label: '搜索'}, {key: 'outer', label: '外部来源'}, {key: 'community', label: '社区内容'}, {key: 'find_game', label: '找游戏'}], ...(spec.sources ? {series: series.map((point, index) => ({...point, values: {pv_from_total: point.values.pv_from_total, ...Object.fromEntries(Object.entries(spec.sources).map(([key, total]) => [key, Math.round(total / 7 * factor + index)]))}}))} : {})}}};
  }
  if (args[0] === 'dashboard-stats') return {ok: false, error: {type: 'permission', hint: '当前账号没有论坛统计权限'}};
  if (args[0] === 'player-feedback') return {ok: true, data: {result: {list: [{review_id: 1, score: 2, contents: '希望字体和地图在手机上更容易看清。', device: 'Android 设备', played_tips: '18 分钟', has_official_comment: false}]}}};
  if (args[0] === 'app' && args[1] === 'analyze-app-status') return {ok: true, data: {result: {blockers: [{code: 'TEST_EVIDENCE_REQUIRED', message: '请先在真实设备完成本版本自测'}], warnings: []}}};
  if (args[0] === 'app' && args[1] === 'get-app-module') {
    const data = JSON.parse(args[args.indexOf('--data') + 1]);
    const fields = {
      'basic-info': {
        title: {label: '游戏名称', input_type: 'text', current_value: '脱敏示例游戏', filled: true, state: 'required', constraints: {max_length: 60}},
        description: {label: '游戏简介', input_type: 'textarea', current_value: '', filled: false, state: 'required', constraints: {max_length: 1500}},
        category: {label: '游戏类型', input_type: 'select', current_value: 'rpg', filled: true, state: 'required', options: {rpg: '角色扮演', casual: '休闲'}, value_labels: {rpg: '角色扮演', casual: '休闲'}},
      },
      'assets-upload': {
        icon: {label: '游戏图标', input_type: 'image', current_value: 'https://img2-tc.tapimg.com/moment/smoke/example.png', filled: true, state: 'required', image_spec: {min_width: 512, min_height: 512, aspect_ratio: '1:1', formats: ['png'], max_file_size_mb: 2}},
        screenshots: {label: '游戏截图', input_type: 'image_array', current_value: ['https://img2-tc.tapimg.com/moment/smoke/screenshot-1.png', 'https://img2-tc.tapimg.com/moment/smoke/screenshot-2.png'], filled: true, state: 'required', image_spec: {min_width: 1080, min_height: 1920, formats: ['png', 'jpg'], requirements: ['使用真实游戏画面']}},
        trailer: {label: '宣传视频', input_type: 'video', current_value: null, filled: false, state: 'optional', video_spec: {formats: ['mp4'], min_seconds: 10, max_seconds: 120}},
        gameplay_demo_video: {label: '实机录屏', input_type: 'video', current_value: 81002, filled: true, state: 'optional', video_spec: {formats: ['mp4'], min_seconds: 10, max_seconds: 120}},
      },
      'platform-status': {
        region_flag_android: {label: 'Android 下载', input_type: 'select', current_value: 1, filled: true, state: 'required', options: {1: '敬请期待', 4: '开放下载'}, value_labels: {1: '敬请期待', 4: '开放下载'}},
        region_flag_pc: {label: 'Windows 下载', input_type: 'select', current_value: 1, filled: true, state: 'required', options: {1: '敬请期待', 4: '开放下载'}, value_labels: {1: '敬请期待', 4: '开放下载'}},
      },
      'release-settings': {},
    };
    return {ok: true, data: {result: {module_id: data.module_id, fields: fields[data.module_id] ?? {}}}};
  }
  if (args[0] === 'app' && args[1] === 'list-packages') return {ok: true, data: {result: {
    list: [{package_id: '90001', type: 'apk', status: 'ready', version: '0.3.0', updated_time: '2026-10-31 12:00'}, {package_id: '90002', type: 'windows', branch: 1, status: 'ready', version: '0.3.0', updated_time: '2026-10-31 12:10'}, {package_id: '90003', type: 'apk', status: 'processing', version: '0.2.9'}],
    current_bindings: [],
    package_slots: {main: {available: true, expected: {kind: 'none'}}, windows: {available: true, expected: {kind: 'none'}}, apk_mini_game_play: {available: false}},
  }}};
  if (args[0] === 'app' && args[1] === 'list-app-versions') return {ok: true, data: {result: {list: [{version_id: '7001', version: '0.3.0', status: 'scheduled', status_label: '定时上线', release_time: Math.floor(Date.now() / 1000) + 86400, updated_time: '2026-10-31 12:20'}, {version_id: '7000', version: '0.2.0', status: 'online', status_label: '已上线', release_time: 1761000000}], total: 2}}};
  if (args[0] === 'app' && args[1] === 'get-app-version') return {ok: true, data: {result: {version_id: '7001', version: '0.3.0', status: 'scheduled', logs: []}}};
  if (args[0] === 'app' && args[1] === 'prepare-review-snapshot') return {ok: true, data: {result: {version_id: '7001', version: '0.3.0', revision: 'smoke-revision', changes: [{field_id: 'description', label: '游戏简介', to: '补充本次更新说明'}], warnings: []}}};
  if (args[0] === 'app' && args[1] === 'precheck-app-review') return {ok: true, data: {result: {version_id: '7001', preaudit_status: 'passed', blockers: [], warnings: []}}};
  if (args[0] === 'qualification') return {ok: true, data: {result: {qualifications: [{qualification_type: 'privacy-compliance', status: 'pending_upload', reason: '仅登记，不代表所有游戏都必须提交'}]}}};
  if (args[0] === 'package-management' || args[0] === 'test-plan') return {ok: true, data: {result: {status: 'ready', items: []}}};
  if (args[0] === 'community-management' && args[1] === 'get-community-forum-publish-options') return {ok: true, data: {result: {
    app_id: '20001', group_id: '30001', group_honor_total: 0, group_honors: [], default_group_honor: null,
    group_labels: [{name: '综合', params: {group_label_id: '0'}, actions: {create_topic: true}}, {name: '开发日志', params: {group_label_id: '40001'}, actions: {create_topic: true}}],
    author_options: [{is_selected: false, text: '用个人身份发布', create_params: {is_official: false}}, {is_selected: true, text: '示例游戏官方', create_params: {is_official: true}}],
  }}};
  if (args[0] === 'community-management' && args[1] === 'list-community-moments') return {ok: true, data: {result: {total: 2, list: [
    {moment_id: '90071992547409931234', title: '示例版本更新说明', summary: '本次更新内容与已知问题。', url: 'https://www.taptap.cn/moment/90071992547409931234', publish_time: 1761860000, commented_time: 1761865000, group_label: '开发日志', status: {is_official: true}, stat: {comments: 8, ups: 21, pv_total: 340}},
    {moment_id: '80002', title: null, summary: null, publish_time: 1761770000, commented_time: 1761770000, has_video: true, status: {}, stat: {}},
  ]}}};
  if (args[0] === 'community-management' && args[1] === 'get-community-moment') return {ok: true, data: {result: {moment_id: '90071992547409931234', title: '示例版本更新说明', content: '[b]更新内容[/b]\n这是一段脱敏的正文验收内容。', images: [], video: null, publish_time: 1761860000, url: 'https://www.taptap.cn/moment/90071992547409931234'}}};
  if (args[0] === 'community-management' && args[1] === 'get-community-topic-draft') return {ok: true, data: {result: {draft_id: '60001', preview_url: 'https://www.taptap.cn/moment-editor?draft_id=60001'}}};
  if (args[0] === 'community-management' && args[1] === '+upload-image') return {ok: true, data: {url: 'https://img2-tc.tapimg.com/moment/smoke/example.png', width: 1280, height: 720, info: {width: 1280, height: 720, size: 182734, format: 'png'}}};
  if (args[0] === 'community-management' && args[1] === '+upload-video') return {ok: true, data: {videoId: 91001, status: 'transcoding', fileName: 'smoke-video.mp4'}};
  if (args[0] === 'community-management' && ['create-community-topic-draft', 'update-community-topic-draft'].includes(args[1])) return {ok: true, data: {result: args.includes('--yes') ? {draft_id: '60001', preview_url: 'https://www.taptap.cn/moment-editor?draft_id=60001', smokeSaved: true} : {status: 'dry_run'}}};
  return null;
}
