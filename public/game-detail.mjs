function payload(value) {
  return value?.result?.data?.result ?? value?.result?.data ?? value?.data?.result ?? value?.data ?? value?.result ?? value ?? {};
}

function fields(value) {
  const result = payload(value);
  return result?.fields && typeof result.fields === 'object' ? result.fields : {};
}

function https(value) {
  return typeof value === 'string' && /^https:\/\//i.test(value) ? value : '';
}

function fieldLabel(field) {
  const value = field?.current_value;
  return field?.value_labels?.[String(value)] ?? (value === undefined || value === null || value === '' ? '未填写' : String(value));
}

export function extractGameDetail({basic, assets, platform, versions, apps, appId = ''}) {
  const basicFields = fields(basic);
  const assetFields = fields(assets);
  const icon = https(basicFields.icon?.current_value) || https(assetFields.icon?.current_value);
  const screenshots = Array.isArray(assetFields.screenshots?.current_value) ? assetFields.screenshots.current_value.map(https).filter(Boolean) : [];
  const banners = Object.values(assetFields).filter(field => field?.input_type === 'image' && !/_ios$/.test(field.field_id || '') && https(field.current_value)).map(field => ({label: field.label || field.field_id, url: https(field.current_value)}));
  const videos = Object.values(assetFields).filter(field => field?.input_type === 'video' && field.current_value !== undefined && field.current_value !== null && field.current_value !== '').map(field => ({label: field.label || field.field_id, reference: String(field.current_value)}));
  const platforms = Object.entries(fields(platform)).filter(([id, field]) => id.startsWith('region_flag_') && field && typeof field === 'object').map(([id, field]) => ({id, label: field.label || id, value: fieldLabel(field)}));
  const versionResult = payload(versions);
  const versionList = Array.isArray(versionResult?.list) ? versionResult.list : [];
  const selectedApp = Array.isArray(payload(apps)?.list) ? payload(apps).list.find(item => String(item.id ?? item.app_id ?? '') === String(appId)) : null;
  return {
    title: basicFields.title?.current_value || selectedApp?.title || '',
    category: fieldLabel(basicFields.category),
    description: basicFields.description?.current_value || '',
    icon,
    cover: banners[0]?.url || screenshots[0] || '',
    banners,
    screenshots,
    videos,
    platforms,
    versions: versionList.map(version => ({id: String(version.version_id ?? ''), name: version.version || version.version_id || '未命名版本', status: version.status_label || version.status || '状态未提供', statusCode: version.status || '', time: version.created_time || version.release_time || version.updated_time || null})),
    versionTotal: Number.isInteger(versionResult?.total) ? versionResult.total : versionList.length,
    developerPageUrl: https(selectedApp?.page_url),
    reviewStatus: selectedApp?.review_status_label || '',
  };
}
