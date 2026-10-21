// 申請フォームの申請履歴：DOM に依存しない絞り込み・表示用の関数。
const RequestHistory = (() => {
  const STATUS_LABEL = {
    pending:  '申請中',
    ready:    '受け取り待ち',
    received: '受け取り済',
    returned: '返却完了',
    approved: '登録済み',
    rejected: '却下',
  };

  const kanaToHiragana = value => String(value || '').replace(/[ァ-ヶ]/g, char =>
    String.fromCharCode(char.charCodeAt(0) - 0x60)
  );

  // 団体名・名前の表記ゆれ（カナ/ひらがな、全角/半角、空白、複数名の区切り）を吸収する
  const normalize = value => kanaToHiragana(String(value || '').normalize('NFKC'))
    .toLowerCase()
    .replace(/[\s、,・/]+/g, '');

  const timeOf = request => {
    const time = Date.parse(request.created_at);
    return Number.isNaN(time) ? 0 : time;
  };

  // 団体名か名前のどちらかが部分一致した申請を新しい順に返す
  const filter = (requests, { organization = '', name = '' } = {}) => {
    const organizationQuery = normalize(organization);
    const nameQuery = normalize(name);
    if (!organizationQuery && !nameQuery) return [];
    return (requests || [])
      .filter(request =>
        (organizationQuery && normalize(request.organization).includes(organizationQuery)) ||
        (nameQuery && normalize(request.user_name).includes(nameQuery)))
      .sort((a, b) => timeOf(b) - timeOf(a) || Number(b.id) - Number(a.id));
  };

  const statusLabel = status => STATUS_LABEL[status] || String(status || '');

  const itemLabel = request => {
    const name = request.approved_item_name || request.item_name || request.purchase_name || '';
    const quantity = Number(request.approved_quantity) > 0 ? request.approved_quantity : request.quantity;
    return `${request.request_type === 'purchase' ? '購入：' : ''}${name} × ${quantity}`;
  };

  const pad = value => String(value).padStart(2, '0');
  const formatDateTime = value => {
    const date = new Date(value);
    if (!value || Number.isNaN(date.getTime())) return '';
    return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  };

  return { normalize, filter, statusLabel, itemLabel, formatDateTime };
})();
