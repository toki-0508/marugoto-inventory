// 物品名検索の共通ロジック。
// 明示的な別名に加えて、よくある表記ゆれを軽く吸収する。
const ItemSearch = (() => {
  const uniqueNonEmptyValues = values => [...new Set(values.map(v => String(v || '').trim()).filter(Boolean))];

  const kanaToHiragana = value => String(value || '').replace(/[\u30a1-\u30f6]/g, char =>
    String.fromCharCode(char.charCodeAt(0) - 0x60)
  );

  const normalize = value => kanaToHiragana(String(value || '').normalize('NFKC'))
    .toLowerCase()
    .replace(/[\s　・･._\-‐‑‒–—―ーｰ,、，.。/／\\]+/g, '');

  const aliasGroups = [
    ['椅子', 'いす', 'イス', 'チェア'],
    ['机', 'つくえ', 'テーブル', 'デスク'],
    ['延長コード', '延長ケーブル', 'コードリール', '電源コード', 'タップ', 'テーブルタップ'],
    ['プロジェクター', 'プロジェクタ'],
    ['マイク', 'マイクロフォン'],
    ['スピーカー', '音響'],
    ['養生テープ', 'テープ'],
    ['ガムテープ', '布テープ'],
    ['段ボール', 'ダンボール'],
  ].map(group => uniqueNonEmptyValues(group.map(normalize)));

  const splitAliases = value => uniqueNonEmptyValues(
    String(value || '')
      .split(/[\n,、，]+/)
      .map(v => v.trim())
  );

  const formatAliases = value => splitAliases(value).join(', ');

  const expandByAliasGroups = text => {
    const variants = new Set([text]);
    aliasGroups.forEach(group => {
      const matchedTerms = group.filter(term => term && text.includes(term));
      if (!matchedTerms.length) return;
      matchedTerms.forEach(matchedTerm => {
        group.forEach(alias => {
          if (alias && alias !== matchedTerm) {
            variants.add(text.replaceAll(matchedTerm, alias));
          }
        });
      });
      group.forEach(alias => variants.add(`${text}${alias}`));
    });
    return [...variants];
  };

  const itemCandidates = item => {
    const baseTexts = [
      item?.name,
      item?.category,
      item?.aliases,
      item?.storage_location,
      item?.note,
    ].flatMap(value => splitAliases(value).concat(String(value || '')));
    return uniqueNonEmptyValues(baseTexts.map(normalize).flatMap(expandByAliasGroups));
  };

  const editDistanceAtMostOne = (a, b) => {
    if (Math.abs(a.length - b.length) > 1) return false;
    let i = 0;
    let j = 0;
    let edits = 0;
    while (i < a.length && j < b.length) {
      if (a[i] === b[j]) {
        i++;
        j++;
        continue;
      }
      edits++;
      if (edits > 1) return false;
      if (a.length > b.length) i++;
      else if (a.length < b.length) j++;
      else {
        i++;
        j++;
      }
    }
    return edits + (a.length - i) + (b.length - j) <= 1;
  };

  const approximatelyIncludes = (candidate, query) => {
    if (!query) return true;
    if (candidate.includes(query)) return true;
    if (query.length < 3) return false;

    for (let size = query.length - 1; size <= query.length + 1; size++) {
      if (size <= 0 || size > candidate.length) continue;
      for (let start = 0; start <= candidate.length - size; start++) {
        if (editDistanceAtMostOne(candidate.slice(start, start + size), query)) return true;
      }
    }
    return false;
  };

  const queryTokens = query => uniqueNonEmptyValues(String(query || '').split(/[\s　]+/).map(normalize));

  const matchesItem = (item, query) => {
    const tokens = queryTokens(query);
    if (!tokens.length) return true;
    const candidates = itemCandidates(item);
    return tokens.every(token => candidates.some(candidate => approximatelyIncludes(candidate, token)));
  };

  return {
    formatAliases,
    matchesItem,
    normalize,
  };
})();
