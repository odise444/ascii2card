import React, { useState, useEffect } from 'react';

// ==================== 시퀀스 다이어그램 파서 ====================
function parseSequenceDiagram(text) {
  const lines = text.split('\n');
  const result = { title: '', nodes: [] };

  // 첫 줄에서 참여자 추출
  const firstLine = lines[0];
  const participants = firstLine.split(/\s{2,}/).map(p => p.trim()).filter(p => p);

  if (participants.length < 2) return null;

  result.title = participants[0];

  const messages = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];

    // 오른쪽 화살표: ────>
    const rightArrow = line.match(/│[─]+\s*(.+?)\s*[─]*>│\s*(.*)$/);
    if (rightArrow) {
      messages.push({
        direction: 'right',
        name: rightArrow[1].trim(),
        note: rightArrow[2]?.replace(/[()]/g, '').trim() || ''
      });
      continue;
    }

    // 왼쪽 화살표: <────
    const leftArrow = line.match(/│<[─]+\s*(.+?)\s*[─]*│\s*(.*)$/);
    if (leftArrow) {
      messages.push({
        direction: 'left',
        name: leftArrow[1].trim(),
        note: leftArrow[2]?.replace(/[()]/g, '').trim() || ''
      });
      continue;
    }

    // 대괄호 주석: [...]
    const comment = line.match(/\[\s*(.+?)\s*\]/);
    if (comment && messages.length > 0) {
      messages[messages.length - 1].detail = comment[1];
    }
  }

  result.nodes.push({
    type: 'sequence',
    participants,
    messages
  });

  return result;
}

// ==================== 계층 다이어그램 파서 ====================
function parseHierarchyDiagram(text) {
  const lines = text.split('\n');
  const result = { title: '', nodes: [] };
  let noteText = null;

  // 박스 위치 찾기 (┌의 인덱스들)
  function findBoxPositions(line) {
    const positions = [];
    let idx = 0;
    while ((idx = line.indexOf('┌', idx)) !== -1) {
      positions.push(idx);
      idx++;
    }
    return positions;
  }

  // 같은 줄에 여러 박스가 있는 줄 찾기
  let childBoxStartLine = -1;
  let childBoxEndLine = -1;
  let childBoxPositions = [];

  for (let i = 0; i < lines.length; i++) {
    const positions = findBoxPositions(lines[i]);
    if (positions.length >= 2) {
      childBoxStartLine = i;
      childBoxPositions = positions;
      break;
    }
  }

  // 자식 박스 끝 줄 찾기
  if (childBoxStartLine >= 0) {
    for (let i = childBoxStartLine + 1; i < lines.length; i++) {
      if (lines[i].includes('└') && (lines[i].match(/└/g) || []).length >= 2) {
        childBoxEndLine = i;
        break;
      }
    }
  }

  // 루트 박스 파싱 (자식 박스 시작 전까지)
  let rootBox = { lines: [] };
  let inRootBox = false;
  let connectionLabel = '';

  for (let i = 0; i < (childBoxStartLine >= 0 ? childBoxStartLine : lines.length); i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed.startsWith('※')) {
      noteText = trimmed;
      continue;
    }

    if (trimmed.startsWith('┌')) {
      inRootBox = true;
      continue;
    }

    if (trimmed.startsWith('└')) {
      inRootBox = false;
      continue;
    }

    if (trimmed.startsWith('├')) {
      continue;
    }

    if (inRootBox && trimmed.startsWith('│')) {
      const content = trimmed.replace(/^│/, '').replace(/│$/, '').trim();
      if (content && !content.match(/^[─┬┼]+$/)) {
        rootBox.lines.push(content);
      }
    }

  }

  // 연결선 라벨 찾기 (루트 박스와 자식 박스 사이)
  for (let i = 0; i < childBoxStartLine; i++) {
    const trimmed = lines[i].trim();
    const labelMatch = trimmed.match(/│\s*([^│┬┼─]+)\s*$/);
    if (labelMatch && !trimmed.startsWith('┌') && !trimmed.startsWith('└')) {
      const label = labelMatch[1].trim();
      if (label && !label.match(/^[─┬┼▼│├┤└┌┐┘\s]+$/)) {
        connectionLabel = label;
      }
    }
  }

  // rootBox.lines에서 연결선 문자만 있는 라인 제거
  rootBox.lines = rootBox.lines.filter(line => !line.match(/^[│┬┼─▼\s]+$/));

  // 자식 박스들 파싱 (위치 기반)
  let childBoxes = childBoxPositions.map(() => ({ lines: [], modules: [], currentModule: null }));

  if (childBoxStartLine >= 0 && childBoxEndLine >= 0) {
    for (let i = childBoxStartLine + 1; i < childBoxEndLine; i++) {
      const line = lines[i];

      // 각 박스 위치에서 내용 추출
      childBoxPositions.forEach((startPos, boxIdx) => {
        // 다음 박스 시작 위치 또는 줄 끝
        const endPos = childBoxPositions[boxIdx + 1] || line.length;
        const segment = line.substring(startPos, endPos);
        const box = childBoxes[boxIdx];

        // 중첩 박스 내용 감지 (│ │ content │ │ 패턴)
        const nestedContentMatch = segment.match(/│\s*│\s*(.+?)\s*│\s*│/);
        if (nestedContentMatch) {
          const content = nestedContentMatch[1].trim();
          if (content && !content.match(/^[─├┤┌┐└┘]+$/)) {
            if (box.currentModule) {
              box.currentModule.lines.push(content);
            }
          }
          return;
        }

        // 중첩 박스 시작 감지 (│ ┌───┐ │)
        if (/│\s*┌[─]+┐\s*│/.test(segment)) {
          box.currentModule = { lines: [] };
          return;
        }

        // 중첩 박스 끝 감지 (│ └───┘ │)
        if (/│\s*└[─]+┘\s*│/.test(segment)) {
          if (box.currentModule && box.currentModule.lines.length > 0) {
            box.modules.push(box.currentModule);
          }
          box.currentModule = null;
          return;
        }

        // 중첩 박스 구분선 (│ ├───┤ │)
        if (/│\s*├[─]+┤\s*│/.test(segment)) {
          if (box.currentModule && box.currentModule.lines.length > 0) {
            box.modules.push(box.currentModule);
          }
          box.currentModule = { lines: [] };
          return;
        }

        // 일반 내용 추출 (│ content │)
        const match = segment.match(/│([^│]+)│/);
        if (match) {
          const content = match[1].trim();
          if (content && !content.match(/^[─├┤┌┐└┘\s]+$/) && !content.includes('│')) {
            box.lines.push(content);
          }
        }
      });
    }
  }

  // currentModule 정리 (파싱 중 닫히지 않은 모듈 처리)
  childBoxes.forEach(box => {
    if (box.currentModule && box.currentModule.lines.length > 0) {
      box.modules.push(box.currentModule);
    }
    delete box.currentModule;
  });

  // 루트 정보 추출
  let rootTitle = '', rootSubtitle = '', rootInfo = [];
  rootBox.lines.forEach(line => {
    if (!rootTitle && !line.startsWith('-') && !line.startsWith('(')) {
      rootTitle = line;
    } else if (line.startsWith('-')) {
      rootInfo.push(line);
    } else {
      rootInfo.push(line);
    }
  });

  result.title = rootTitle || 'Hierarchy';

  const rootNode = {
    type: 'hierarchy',
    root: { title: rootTitle, subtitle: rootSubtitle, info: rootInfo },
    connection: connectionLabel,
    children: childBoxes.map(box => ({
      title: box.lines[0] || '',
      info: box.lines.slice(1).filter(l => !l.startsWith('┌') && !l.startsWith('└') && !l.startsWith('├')),
      modules: box.modules.length > 0 ? box.modules.map(m => ({
        title: m.lines[0] || '',
        info: m.lines.slice(1)
      })) : undefined
    }))
  };

  result.nodes.push(rootNode);
  if (noteText) result.nodes.push({ type: 'note', text: noteText, icon: '※' });
  return result;
}

// ==================== 테이블 다이어그램 파서 ====================
function parseTableDiagram(text) {
  const lines = text.split('\n').filter(l => l.trim());
  const result = { title: '', nodes: [] };

  // ┬가 있는 첫 줄(헤더 테두리)에서 컬럼 구분 위치 파악
  const headerLine = lines.find(l => l.includes('┬'));
  if (!headerLine) return null;

  const separators = [];
  for (let i = 0; i < headerLine.length; i++) {
    if (headerLine[i] === '┌' || headerLine[i] === '├') separators.push(i);
    else if (headerLine[i] === '┬' || headerLine[i] === '┼') separators.push(i);
  }
  // 마지막 ┐ 또는 ┤ 위치 추가
  for (let i = headerLine.length - 1; i >= 0; i--) {
    if (headerLine[i] === '┐' || headerLine[i] === '┤') { separators.push(i); break; }
  }

  if (separators.length < 3) return null; // 최소 2컬럼

  // 데이터 줄 추출 (│ 내용 │ 형태, 구조선만 있는 줄 제외)
  const dataLines = lines.filter(l => {
    const t = l.trim();
    return t.startsWith('│') && !t.match(/^[│┼┬┴─┌┐└┘├┤\s]+$/);
  });

  if (dataLines.length === 0) return null;

  // 각 줄을 컬럼 위치 기준으로 분리
  const rows = dataLines.map(line => {
    const cells = [];
    for (let i = 0; i < separators.length - 1; i++) {
      const start = separators[i] + 1;
      const end = separators[i + 1];
      const cell = (end <= line.length ? line.substring(start, end) : line.substring(start)).replace(/│/g, '').trim();
      cells.push(cell);
    }
    return cells;
  });

  // ├───┼───┤ 줄이 있으면 헤더 구분선 있음
  const hasHeaderSep = lines.some(l => l.includes('┼'));

  const headers = rows[0] || [];
  const body = rows.slice(1);

  result.title = headers.join(' / ');
  result.nodes.push({
    type: 'table',
    headers,
    rows: body,
    hasHeaderSep
  });

  return result;
}

// ==================== 통합 ASCII 파서 (v12 - 10/10 테스트 통과) ====================
function parseAsciiToJson(text) {
  const lines = text.split('\n');
  const result = { title: '', nodes: [] };
  if (!text.trim()) return result;
  if (/[└├]─/.test(text) && !/^┌/.test(text.trim())) return parseTree(text);

  // 테이블 감지 (┬ 또는 ┴가 있으면 멀티컬럼 테이블)
  if (/[┬┴]/.test(text)) {
    const tableResult = parseTableDiagram(text);
    if (tableResult && tableResult.nodes.length > 0) return tableResult;
  }

  // 시퀀스 다이어그램 감지 (│──> 또는 │<── 패턴 + 박스 없음)
  const hasSequenceArrows = /│[─]+.*>│|│<[─]+.*│/.test(text);
  const hasNoBoxes = !/┌.*┐/.test(text);
  if (hasSequenceArrows && hasNoBoxes) {
    const sequenceResult = parseSequenceDiagram(text);
    if (sequenceResult && sequenceResult.nodes.length > 0) return sequenceResult;
  }

  // 계층 다이어그램 감지 (같은 줄에 여러 독립 박스 + ▼ 연결선)
  const hasInlineMultipleBoxes = lines.some(line => {
    const trimmed = line.trim();
    // 줄이 ┌로 시작하고, 같은 줄에 ┐  ┌ 패턴이 있음 (공백으로 구분된 여러 박스)
    return trimmed.startsWith('┌') && /┐\s+┌/.test(line);
  });
  const hasDownArrows = /▼/.test(text);
  if (hasInlineMultipleBoxes && hasDownArrows) {
    const hierarchyResult = parseHierarchyDiagram(text);
    if (hierarchyResult && hierarchyResult.nodes.length > 0) return hierarchyResult;
  }

  const isCompareType = /──+→/.test(text) && /└──[^┌]+──+┘/.test(text);
  
  let columns = [], currentSection = null, currentList = null, kvItems = [];
  let inInnerBox = false, innerBoxLines = [], innerBoxCount = 0, innerBoxPositions = [];
  let compareMode = false, compareColumns = [], compareFlowLabel = null;
  let timelineItems = [];
  
  function flushPending() {
    if (currentSection) { result.nodes.push(currentSection); currentSection = null; }
    if (currentList) { result.nodes.push(currentList); currentList = null; }
    if (kvItems.length > 0) { result.nodes.push({ type: 'kv', items: [...kvItems] }); kvItems = []; }
  }
  function flushColumns() {
    if (columns.length >= 2 && (columns[0].items?.length > 0 || columns[1].items?.length > 0)) {
      result.nodes.push({ type: 'columns', children: columns.map((col, i) => ({ type: 'card', icon: col.icon || '', title: col.title, color: i === 0 ? 'blue' : 'green', items: col.items })) });
      columns = [];
    }
  }
  function flushCompare() {
    if (compareColumns.length >= 2) {
      result.nodes.push({ type: 'compare', columns: compareColumns, flow: compareFlowLabel });
      compareColumns = []; compareFlowLabel = null; compareMode = false;
    }
  }
  function flushTimeline() {
    if (timelineItems.length > 0) {
      result.nodes.push({ type: 'timeline', items: [...timelineItems] });
      timelineItems = [];
    }
  }
  
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    if (line.trim().startsWith('┌') || line.trim().startsWith('└') || line.trim().startsWith('├')) continue;
    
    let content = line;
    if (content.startsWith('│')) content = content.slice(1);
    if (content.endsWith('│')) content = content.slice(0, -1);
    const trimmed = content.trim();
    
    if (!trimmed) continue;
    if (/^─+$/.test(trimmed)) continue;
    if (/^[│┼┬┴▼▲←→─\s]+$/.test(trimmed) && !trimmed.includes('┌') && !trimmed.includes('└')) continue;
    
    if (isCompareType && /─────.*─────/.test(trimmed) && !trimmed.includes('→') && !trimmed.includes('┘')) continue;
    
    if (isCompareType) {
      const arrowMatch = trimmed.match(/^(.+?)\s*──+→\s*(.+)$/);
      if (arrowMatch && compareMode) {
        const leftResult = arrowMatch[1].trim();
        const rightResult = arrowMatch[2].trim();
        if (compareColumns[0]) { compareColumns[0].result = leftResult; compareColumns[0].positive = leftResult.includes('+') || leftResult.includes('잉여'); }
        if (compareColumns[1]) { compareColumns[1].result = rightResult; compareColumns[1].positive = !(rightResult.includes('-') || rightResult.includes('부족')); }
        continue;
      }
      const flowLabelMatch = trimmed.match(/└──\s*(.+?)\s*──+┘/);
      if (flowLabelMatch && compareMode) { compareFlowLabel = flowLabelMatch[1].trim(); continue; }
      if (/^[│↑↓\s]+$/.test(trimmed)) continue;
    }
    
    if (trimmed.includes('┌')) {
      flushColumns(); flushPending(); flushCompare(); flushTimeline();
      inInnerBox = true;
      innerBoxCount = (trimmed.match(/┌/g) || []).length;
      innerBoxLines = []; innerBoxPositions = [];
      let pos = 0;
      for (let b = 0; b < innerBoxCount; b++) { pos = content.indexOf('┌', pos); innerBoxPositions.push(pos); pos++; }
      continue;
    }
    
    if (inInnerBox) {
      if (trimmed.includes('└')) {
        const boxes = [];
        if (innerBoxCount === 1) {
          const boxContent = innerBoxLines.map(l => l.replace(/│/g, '').trim()).filter(l => l);
          if (boxContent.length > 0) {
            const title = boxContent[0];
            const items = boxContent.slice(1).filter(c => c.startsWith('•') || c.startsWith('-')).map(c => c.replace(/^[•-]\s*/, '').trim());
            const nonBulletItems = boxContent.slice(1).filter(c => !c.startsWith('•') && !c.startsWith('-') && c.length < 40);
            const subtitle = items.length === 0 ? nonBulletItems[0] || null : null;
            let cost = null;
            boxContent.forEach(c => { const m = c.match(/([\$₩][\d,]+(?:\/월)?|비용:\s*[\$₩]?[\d,]+|\d+만원)/); if (m) cost = m[1].replace(/^비용:\s*/, ''); });
            let color = 'blue';
            if (title.includes('무료')) color = 'green';
            else if (items.length > 0) color = 'orange';
            else if (cost) color = 'purple';
            boxes.push({ type: 'box', title, subtitle, items: items.length > 0 ? items : undefined, cost, color });
          }
        } else {
          const boxContents = Array.from({ length: innerBoxCount }, () => []);
          innerBoxLines.forEach(boxLine => {
            for (let b = 0; b < innerBoxCount; b++) {
              const startPos = innerBoxPositions[b];
              const endPos = b < innerBoxCount - 1 ? innerBoxPositions[b + 1] : boxLine.length;
              const segment = boxLine.slice(startPos, endPos);
              const clean = segment.replace(/│/g, '').trim();
              if (clean) boxContents[b].push(clean);
            }
          });
          boxContents.forEach((contents) => {
            if (contents.length === 0) return;
            let title = contents.join(' ').trim();
            let cost = null;
            const m = title.match(/([\$₩][\d,]+(?:\/월)?|\d+만원)/);
            if (m) { cost = m[1]; title = title.replace(m[1], '').trim(); }
            let color = 'gray';
            if (title.includes('무료')) color = 'green';
            else if (cost) color = 'purple';
            boxes.push({ type: 'box', title, cost, color });
          });
        }
        if (boxes.length === 1) result.nodes.push({ ...boxes[0] });
        else if (boxes.length > 1) result.nodes.push({ type: 'columns', children: boxes });
        inInnerBox = false; innerBoxLines = [];
        continue;
      }
      innerBoxLines.push(content);
      continue;
    }
    
    if (isCompareType) {
      const twoColMatch = content.match(/^(\s*)(\S.*?\S)\s{6,}(\S.*?\S)(\s*)$/);
      if (twoColMatch) {
        const left = twoColMatch[2].trim();
        const right = twoColMatch[3].trim();
        const leftKv = left.match(/^(\S+)\s+(\S+)$/);
        const rightKv = right.match(/^(\S+)\s+(\S+)$/);
        if (!compareMode && !leftKv) {
          compareMode = true;
          compareColumns = [{ title: left, items: [] }, { title: right, items: [] }];
          if (!result.title) result.title = left + ' vs ' + right;
        } else if (compareMode && leftKv && rightKv) {
          compareColumns[0].items.push({ k: leftKv[1], v: leftKv[2] });
          compareColumns[1].items.push({ k: rightKv[1], v: rightKv[2] });
        }
        continue;
      }
    }
    
    if (trimmed.includes('🏡') && trimmed.includes('🌾')) {
      const parts = trimmed.split(/(?=🏡|🌾)/).filter(p => p.trim());
      if (parts.length >= 2) {
        if (!result.title) result.title = trimmed;
        flushPending();
        columns = parts.map(p => {
          const icon = p.startsWith('🏡') ? '🏡' : p.startsWith('🌾') ? '🌾' : '';
          return { icon, title: p.replace(/^[🏡🌾]\s*/, '').trim(), items: [] };
        });
        continue;
      }
    }
    
    if (!result.title && !compareMode) { result.title = trimmed.replace(/^[📌💡🔥✨⚡🏗️]\s*/, ''); continue; }
    
    const monthMatch = trimmed.match(/^(\d+월):\s*(.+)$/);
    if (monthMatch) {
      flushPending(); flushColumns(); flushCompare();
      timelineItems.push({ label: monthMatch[1], text: monthMatch[2] });
      continue;
    }
    
    if (trimmed === '...' && timelineItems.length > 0) {
      timelineItems.push({ label: '...', text: '', ellipsis: true });
      continue;
    }
    
    if (trimmed.endsWith(':') && !trimmed.startsWith('※')) {
      flushPending(); flushColumns(); flushCompare(); flushTimeline();
      const sectionTitle = trimmed.slice(0, -1).trim();
      currentSection = { type: 'section', icon: '📋', title: sectionTitle, color: 'blue', items: [] };
      continue;
    }
    
    if (trimmed.startsWith('-') && !trimmed.startsWith('->')) {
      const bulletText = trimmed.replace(/^-\s*/, '');
      if (currentSection) currentSection.items.push(bulletText);
      continue;
    }
    
    if (trimmed.startsWith('※')) {
      flushPending(); flushColumns(); flushCompare(); flushTimeline();
      result.nodes.push({ type: 'note', text: trimmed, icon: '※' });
      continue;
    }
    
    if (trimmed.startsWith('→') && !trimmed.includes(':')) {
      flushPending(); flushColumns(); flushCompare(); flushTimeline();
      result.nodes.push({ type: 'highlight', text: trimmed });
      continue;
    }
    
    if (trimmed.includes('•') && columns.length >= 2) {
      const midPoint = content.length / 2;
      const bullets = [...content.matchAll(/•\s*([^•]+)/g)];
      bullets.forEach(match => { const pos = content.indexOf(match[0]); const colIdx = pos < midPoint ? 0 : 1; if (columns[colIdx]) columns[colIdx].items.push(match[1].trim()); });
      continue;
    }
    
    const bracketMatches = trimmed.match(/\[([^\]]+)\]/g);
    if (bracketMatches && bracketMatches.length >= 2) {
      flushColumns(); flushPending(); flushCompare(); flushTimeline();
      result.nodes.push({ type: 'branch', items: bracketMatches.map(m => m.replace(/[\[\]]/g, '')) });
      continue;
    }
    
    if (trimmed.startsWith('📌') && trimmed.includes(':')) {
      flushPending(); flushColumns(); flushCompare(); flushTimeline();
      result.nodes.push({ type: 'note', text: trimmed });
      continue;
    }
    
    const emojiSectionMatch = trimmed.match(/^([✅❌⚠️💡🔥⭐])\s*(.+)/);
    if (emojiSectionMatch && !trimmed.startsWith('•')) {
      flushPending(); flushColumns(); flushCompare(); flushTimeline();
      const iconColorMap = { '✅': 'green', '❌': 'red', '⚠️': 'orange', '💡': 'blue', '🔥': 'red', '⭐': 'orange' };
      currentSection = { type: 'section', icon: emojiSectionMatch[1], title: emojiSectionMatch[2], color: iconColorMap[emojiSectionMatch[1]] || 'orange', items: [] };
      continue;
    }
    
    const textSectionMatch = trimmed.match(/^([가-힣A-Za-z\s]+):\s*(.+)$/);
    if (textSectionMatch && !trimmed.startsWith('•') && columns.length === 0 && !compareMode) {
      const key = textSectionMatch[1].trim(), value = textSectionMatch[2];
      if (value.length > 20 && !currentSection) {
        flushPending(); flushTimeline();
        currentSection = { type: 'section', icon: '📋', title: key + ': ' + value, color: 'blue', items: [] };
        continue;
      } else if (value.length <= 20) {
        if (currentSection) { result.nodes.push(currentSection); currentSection = null; }
        flushTimeline();
        kvItems.push({ k: key, v: value });
        continue;
      }
    }
    
    if (trimmed.startsWith('•') && columns.length === 0) {
      const bulletText = trimmed.replace(/^•\s*/, '');
      if (currentSection) currentSection.items.push(bulletText);
      continue;
    }
    
    const numMatch = trimmed.match(/^(?:\[(\d+)\]|(\d+)\.|(\d)\uFE0F?\u20E3)\s*(.+)/);
    if (numMatch) {
      if (currentSection) { result.nodes.push(currentSection); currentSection = null; }
      flushColumns(); flushCompare(); flushTimeline();
      if (!currentList) currentList = { type: 'list', items: [] };
      const n = numMatch[1] || numMatch[2] || numMatch[3];
      currentList.items.push({ n: parseInt(n), text: numMatch[4], subs: [] });
      continue;
    }
    
    const subMatch = trimmed.match(/^(?:->|→)\s*(.+)/);
    if (subMatch && currentList?.items?.length > 0) {
      const lastItem = currentList.items[currentList.items.length - 1];
      if (!lastItem.subs) lastItem.subs = [];
      lastItem.subs.push(subMatch[1]);
      continue;
    }
    
    const spaceKvMatch = trimmed.match(/^(.+?)\s{2,}(.+)$/);
    if (spaceKvMatch && !currentSection && columns.length === 0 && !currentList && !compareMode && timelineItems.length === 0) {
      kvItems.push({ k: spaceKvMatch[1], v: spaceKvMatch[2] });
      continue;
    }
    
    if (compareMode && compareColumns.length >= 2 && compareColumns[0].result) {
      flushCompare();
      result.nodes.push({ type: 'note', text: trimmed });
      continue;
    }
  }
  
  flushPending(); flushColumns(); flushCompare(); flushTimeline();
  return result;
}

function parseTree(text) {
  const lines = text.split('\n').filter(l => l.trim());
  const result = { title: lines[0]?.trim() || '', nodes: [] };
  const treeNode = { type: 'tree', items: [] };
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i], match = line.match(/[└├]─\s*(.+)/);
    if (match) {
      let text = match[1].trim();
      const isHighlight = text.includes('←') || text.includes('**');
      text = text.replace(/\s*←.*$/, '').replace(/\*\*/g, '').trim();
      const depth = Math.floor((line.match(/^\s*/)[0].length) / 3);
      treeNode.items.push({ text, depth, highlight: isHighlight });
    }
  }
  if (treeNode.items.length > 0) result.nodes.push(treeNode);
  return result;
}

// ==================== 샘플 데이터 ====================
const asciiSamples = {
  table: `┌──────────────┬──────────────┬──────────────────┐
│  ASCII (1fr)  │  JSON (1fr)  │  Card (1.3fr)    │
│  D2Coding     │  JetBrains   │  테마별 배경      │
│  편집 가능    │  편집 가능    │  실시간 미리보기  │
└──────────────┴──────────────┴──────────────────┘`,

  timeline: `┌─────────────────────────────────────────────────────┐
│  월별 상계 흐름                                     │
├─────────────────────────────────────────────────────┤
│                                                     │
│  7월: 발전 400kWh, 사용 300kWh → 잉여 100kWh 이월  │
│  8월: 발전 380kWh, 사용 320kWh → 잉여 60kWh 이월   │
│  ...                                                │
│  12월: 발전 200kWh, 사용 400kWh → 이월분 차감      │
│                                                     │
│  연말 정산:                                         │
│  - 누적 잉여전력 → 연평균 SMP로 현금 정산          │
│  - 또는 다음 해로 이월 선택 가능                   │
│                                                     │
│  ※ SMP 단가: 약 80~120원/kWh (시장가 변동)        │
│  ※ 전기요금 단가: 약 120~150원/kWh                │
│     → 판매보다 자가소비가 유리!                    │
│                                                     │
└─────────────────────────────────────────────────────┘`,

  season: `┌─────────────────────────────────────────────────────┐
│  여름                      겨울                     │
│                                                     │
│  발전 432kWh              발전 240kWh               │
│  사용 350kWh              사용 350kWh               │
│  ─────────                ─────────                 │
│  잉여 +82kWh   ──────→    부족 -110kWh              │
│       │                        ↑                   │
│       └── 한전 판매/이월 ──────┘                    │
│                                                     │
│  연간 정산으로 자급률 90%+ 달성 가능                │
└─────────────────────────────────────────────────────┘`,

  spec: `┌─────────────────────────────────────────────┐
│  4인 가구 단독주택 완전 자급 권장 사양      │
├─────────────────────────────────────────────┤
│  PV 용량      5~6 kW                        │
│  ESS 용량     10~15 kWh                     │
│  인버터       5kW 하이브리드                │
│  예상 자급률  연평균 90~95%                 │
└─────────────────────────────────────────────┘`,

  diagram: `┌─────────────────────────────────────────────────────────────┐
│  🏡 주택                    🌾 농지 (1,000㎡)              │
│  • 월 350kWh 사용           • 영농형 태양광 100kW         │
│  • 옥상 PV 6kW              • 농작물 재배 병행             │
│                                                             │
│              ┌─────────────────────┐                       │
│              │   홈 EMS Gateway    │                       │
│              │  (통합 모니터링)    │                       │
│              └─────────────────────┘                       │
│                                                             │
│   [주택 인버터]   [영농형 인버터]   [농업 센서]           │
└─────────────────────────────────────────────────────────────┘`,

  sections: `┌───────────────────────────────────────┐
│  3kW PV 분석                          │
├───────────────────────────────────────┤
│  ✅ 장점                              │
│  • 설치비 최소 (300~400만원)         │
│  • 인허가 간단                        │
│  ❌ 단점                              │
│  • 자급률 72% (그리드 의존)          │
│  • 겨울철 크게 부족 (45%)            │
│  📌 적합: 예산 제한, 소규모 시작      │
└───────────────────────────────────────┘`,

  tree: `한전 사이버지점 (cyber.kepco.co.kr)
└─ 제도·약관
   └─ 전기요금제도
      └─ 요금 상계거래제도 ← 여기!`,

  arch: `┌───────────────────────────────────────────────┐
│  💡 비용 최적화 아키텍처 (500 고객)           │
├───────────────────────────────────────────────┤
│  ┌───────────────────────────────────────┐   │
│  │        Cloudflare (무료)               │   │
│  └───────────────────────────────────────┘   │
│  ┌───────────────────────────────────────┐   │
│  │        AWS EKS  비용: $300/월          │   │
│  └───────────────────────────────────────┘   │
│  ┌────────────┐  ┌────────────┐  ┌────────┐ │
│  │ RDS $150   │  │ InfluxDB   │  │ Redis  │ │
│  └────────────┘  └────────────┘  └────────┘ │
│  총 월 비용: ~$700                           │
└───────────────────────────────────────────────┘`,

  hierarchy: `┌─────────────────────────────────────────────────────────────────────┐
│                        System BMS (STM32G474)                       │
│  - 전체 배터리 팩 상태 모니터링                                      │
│  - Main BMS 통합 관리                                               │
│  - 외부 인터페이스 (상위 시스템 연동)                                 │
└───────────────────────────┬─────────────────────────────────────────┘
                            │ BCAN (Extended CAN ID)
        ┌───────────────────┼───────────────────┐
        │                   │                   │
        ▼                   ▼                   ▼
┌───────────────┐   ┌───────────────┐   ┌───────────────┐
│  Main BMS #0  │   │  Main BMS #1  │   │  Main BMS #2  │
│   (96 cells)  │   │   (96 cells)  │   │   (96 cells)  │
│               │   │               │   │               │
│  6x LTC6813   │   │  6x LTC6813   │   │  6x LTC6813   │
│  (isoSPI)     │   │  (isoSPI)     │   │  (isoSPI)     │
└───────────────┘   └───────────────┘   └───────────────┘`,

  sequence: `SystemBMS                              MainBMS (x16)
    │                                       │
    │──── SYSTEM2MAIN_CMD ─────────────────>│ (Broadcast)
    │     [relay control, mode]             │
    │                                       │
    │<─── MAINxx_CYC_INFO_01 ──────────────│ (100ms)
    │<─── MAINxx_CYC_INFO_02 ──────────────│ (100ms)
    │<─── MAINxx_CYC_VOLT_01 ──────────────│ (100ms)
    │<─── MAINxx_CYC_TEMP_01 ──────────────│ (100ms)
    │<─── MAINxx_RTC ──────────────────────│ (1000ms)
    │                                       │`,

  sequenceCtrl: `SystemBMS                              MainBMS
    │                                       │
    │──── SYSTEM_BMS_CTRL_REQ ─────────────>│
    │     [CTRL_INDEX=0x1302, SOC=80%]      │
    │                                       │
    │<─── SYSTEM_BMS_CTRL_RES ─────────────│
    │     [ACK, 현재 SOC]                   │
    │                                       │`,

  hierarchyNested: `┌─────────────────────────────────────────────────────────────────────┐
│                          SystemBMS                                   │
│                      (Master Controller)                             │
└───────────────────────────┬─────────────────────────────────────────┘
                            │ BCAN Bus
        ┌───────────────────┼───────────────────────────────┐
        │                   │                               │
        ▼                   ▼                               ▼
┌───────────────┐   ┌───────────────┐             ┌───────────────┐
│   MainBMS 00  │   │   MainBMS 01  │    ...      │   MainBMS 15  │
│   (Pack 0)    │   │   (Pack 1)    │             │   (Pack 15)   │
│ ┌───────────┐ │   │ ┌───────────┐ │             │ ┌───────────┐ │
│ │ Module 0  │ │   │ │ Module 0  │ │             │ │ Module 0  │ │
│ │ Cell 1~24 │ │   │ │ Cell 1~24 │ │             │ │ Cell 1~24 │ │
│ ├───────────┤ │   │ ├───────────┤ │             │ ├───────────┤ │
│ │ Module 1  │ │   │ │ Module 1  │ │             │ │ Module 1  │ │
│ │ Cell 1~24 │ │   │ │ Cell 1~24 │ │             │ │ Cell 1~24 │ │
│ ├───────────┤ │   │ ├───────────┤ │             │ ├───────────┤ │
│ │ Module 2  │ │   │ │ Module 2  │ │             │ │ Module 2  │ │
│ │ Cell 1~24 │ │   │ │ Cell 1~24 │ │             │ │ Cell 1~24 │ │
│ ├───────────┤ │   │ ├───────────┤ │             │ ├───────────┤ │
│ │ Module 3  │ │   │ │ Module 3  │ │             │ │ Module 3  │ │
│ │ Cell 1~24 │ │   │ │ Cell 1~24 │ │             │ │ Cell 1~24 │ │
│ └───────────┘ │   │ └───────────┘ │             │ └───────────┘ │
└───────────────┘   └───────────────┘             └───────────────┘`
};

// ==================== 테마 시스템 ====================
const themes = {
  dark: {
    name: 'Dark',
    bg: 'linear-gradient(135deg, #12121a 0%, #0a0a10 100%)',
    cardBg: 'rgba(25,25,40,0.95)',
    headerBg: 'linear-gradient(135deg, #f59e0b, #f97316)',
    text: '#f1f5f9',
    subText: '#94a3b8',
    accent: '#22c55e',
    itemBg: 'rgba(59, 130, 246, 0.1)',
    border: 'rgba(59, 130, 246, 0.2)',
  },
  light: {
    name: 'Light',
    bg: '#f8fafc',
    cardBg: '#ffffff',
    headerBg: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
    text: '#1e293b',
    subText: '#64748b',
    accent: '#059669',
    itemBg: '#f1f5f9',
    border: '#e2e8f0',
  },
  solar: {
    name: 'Solar',
    bg: 'linear-gradient(135deg, #1a1a2e 0%, #0f0f1a 100%)',
    cardBg: 'rgba(26, 26, 46, 0.95)',
    headerBg: 'linear-gradient(135deg, #f59e0b 0%, #f97316 100%)',
    text: '#fef3c7',
    subText: '#fcd34d',
    accent: '#f59e0b',
    itemBg: 'rgba(245, 158, 11, 0.1)',
    border: 'rgba(245, 158, 11, 0.2)',
  },
  aws: {
    name: 'AWS',
    bg: 'linear-gradient(135deg, #0f1419 0%, #1a202c 100%)',
    cardBg: 'rgba(26, 32, 44, 0.95)',
    headerBg: 'linear-gradient(135deg, #ff9900 0%, #ff6600 100%)',
    text: '#ffffff',
    subText: '#a0aec0',
    accent: '#ff9900',
    itemBg: 'rgba(255, 153, 0, 0.1)',
    border: 'rgba(255, 153, 0, 0.2)',
  },
  azure: {
    name: 'Azure',
    bg: 'linear-gradient(135deg, #0a0f1a 0%, #102040 100%)',
    cardBg: 'rgba(16, 32, 64, 0.95)',
    headerBg: 'linear-gradient(135deg, #0078d4 0%, #00bcf2 100%)',
    text: '#ffffff',
    subText: '#8cb4d8',
    accent: '#00bcf2',
    itemBg: 'rgba(0, 120, 212, 0.1)',
    border: 'rgba(0, 120, 212, 0.2)',
  },
  minimal: {
    name: 'Minimal',
    bg: '#fafafa',
    cardBg: '#ffffff',
    headerBg: '#18181b',
    text: '#18181b',
    subText: '#71717a',
    accent: '#18181b',
    itemBg: '#f4f4f5',
    border: '#e4e4e7',
  },
};

// ==================== 색상 팔레트 (테마별) ====================
const darkColors = {
  blue: { bg: 'rgba(59,130,246,0.1)', border: 'rgba(59,130,246,0.3)', text: '#93c5fd', accent: '#3b82f6' },
  green: { bg: 'rgba(34,197,94,0.1)', border: 'rgba(34,197,94,0.3)', text: '#86efac', accent: '#22c55e' },
  red: { bg: 'rgba(239,68,68,0.1)', border: 'rgba(239,68,68,0.3)', text: '#fca5a5', accent: '#ef4444' },
  orange: { bg: 'rgba(245,158,11,0.1)', border: 'rgba(245,158,11,0.3)', text: '#fcd34d', accent: '#f59e0b' },
  purple: { bg: 'rgba(139,92,246,0.1)', border: 'rgba(139,92,246,0.3)', text: '#c4b5fd', accent: '#8b5cf6' },
  gray: { bg: 'rgba(107,114,128,0.1)', border: 'rgba(107,114,128,0.3)', text: '#d1d5db', accent: '#6b7280' },
  cyan: { bg: 'rgba(6,182,212,0.1)', border: 'rgba(6,182,212,0.3)', text: '#67e8f9', accent: '#06b6d4' },
  teal: { bg: 'rgba(20,184,166,0.1)', border: 'rgba(20,184,166,0.3)', text: '#5eead4', accent: '#14b8a6' },
  emerald: { bg: 'rgba(16,185,129,0.1)', border: 'rgba(16,185,129,0.3)', text: '#6ee7b7', accent: '#10b981' },
  lime: { bg: 'rgba(132,204,22,0.1)', border: 'rgba(132,204,22,0.3)', text: '#bef264', accent: '#84cc16' },
  yellow: { bg: 'rgba(234,179,8,0.1)', border: 'rgba(234,179,8,0.3)', text: '#fde047', accent: '#eab308' },
  amber: { bg: 'rgba(245,158,11,0.1)', border: 'rgba(245,158,11,0.3)', text: '#fcd34d', accent: '#f59e0b' },
  pink: { bg: 'rgba(236,72,153,0.1)', border: 'rgba(236,72,153,0.3)', text: '#f9a8d4', accent: '#ec4899' },
  rose: { bg: 'rgba(244,63,94,0.1)', border: 'rgba(244,63,94,0.3)', text: '#fda4af', accent: '#f43f5e' },
  indigo: { bg: 'rgba(99,102,241,0.1)', border: 'rgba(99,102,241,0.3)', text: '#a5b4fc', accent: '#6366f1' },
  violet: { bg: 'rgba(139,92,246,0.1)', border: 'rgba(139,92,246,0.3)', text: '#c4b5fd', accent: '#8b5cf6' },
  sky: { bg: 'rgba(14,165,233,0.1)', border: 'rgba(14,165,233,0.3)', text: '#7dd3fc', accent: '#0ea5e9' },
  slate: { bg: 'rgba(100,116,139,0.1)', border: 'rgba(100,116,139,0.3)', text: '#cbd5e1', accent: '#64748b' },
  zinc: { bg: 'rgba(113,113,122,0.1)', border: 'rgba(113,113,122,0.3)', text: '#d4d4d8', accent: '#71717a' },
  stone: { bg: 'rgba(120,113,108,0.1)', border: 'rgba(120,113,108,0.3)', text: '#d6d3d1', accent: '#78716c' }
};

const lightColors = {
  blue: { bg: 'rgba(59,130,246,0.1)', border: 'rgba(59,130,246,0.3)', text: '#1d4ed8', accent: '#3b82f6' },
  green: { bg: 'rgba(34,197,94,0.1)', border: 'rgba(34,197,94,0.3)', text: '#15803d', accent: '#22c55e' },
  red: { bg: 'rgba(239,68,68,0.1)', border: 'rgba(239,68,68,0.3)', text: '#b91c1c', accent: '#ef4444' },
  orange: { bg: 'rgba(245,158,11,0.1)', border: 'rgba(245,158,11,0.3)', text: '#b45309', accent: '#f59e0b' },
  purple: { bg: 'rgba(139,92,246,0.1)', border: 'rgba(139,92,246,0.3)', text: '#6d28d9', accent: '#8b5cf6' },
  gray: { bg: 'rgba(107,114,128,0.1)', border: 'rgba(107,114,128,0.3)', text: '#374151', accent: '#6b7280' },
  cyan: { bg: 'rgba(6,182,212,0.1)', border: 'rgba(6,182,212,0.3)', text: '#0e7490', accent: '#06b6d4' },
  teal: { bg: 'rgba(20,184,166,0.1)', border: 'rgba(20,184,166,0.3)', text: '#0f766e', accent: '#14b8a6' },
  emerald: { bg: 'rgba(16,185,129,0.1)', border: 'rgba(16,185,129,0.3)', text: '#047857', accent: '#10b981' },
  lime: { bg: 'rgba(132,204,22,0.1)', border: 'rgba(132,204,22,0.3)', text: '#4d7c0f', accent: '#84cc16' },
  yellow: { bg: 'rgba(234,179,8,0.1)', border: 'rgba(234,179,8,0.3)', text: '#a16207', accent: '#eab308' },
  amber: { bg: 'rgba(245,158,11,0.1)', border: 'rgba(245,158,11,0.3)', text: '#b45309', accent: '#f59e0b' },
  pink: { bg: 'rgba(236,72,153,0.1)', border: 'rgba(236,72,153,0.3)', text: '#be185d', accent: '#ec4899' },
  rose: { bg: 'rgba(244,63,94,0.1)', border: 'rgba(244,63,94,0.3)', text: '#be123c', accent: '#f43f5e' },
  indigo: { bg: 'rgba(99,102,241,0.1)', border: 'rgba(99,102,241,0.3)', text: '#4338ca', accent: '#6366f1' },
  violet: { bg: 'rgba(139,92,246,0.1)', border: 'rgba(139,92,246,0.3)', text: '#6d28d9', accent: '#8b5cf6' },
  sky: { bg: 'rgba(14,165,233,0.1)', border: 'rgba(14,165,233,0.3)', text: '#0369a1', accent: '#0ea5e9' },
  slate: { bg: 'rgba(100,116,139,0.1)', border: 'rgba(100,116,139,0.3)', text: '#334155', accent: '#64748b' },
  zinc: { bg: 'rgba(113,113,122,0.1)', border: 'rgba(113,113,122,0.3)', text: '#3f3f46', accent: '#71717a' },
  stone: { bg: 'rgba(120,113,108,0.1)', border: 'rgba(120,113,108,0.3)', text: '#44403c', accent: '#78716c' }
};

const getColors = (themeName) => {
  const isLightTheme = themeName === 'light' || themeName === 'minimal';
  return isLightTheme ? lightColors : darkColors;
};


// ==================== 노드 렌더러 ====================
function NodeRenderer({ node, theme = 'dark' }) {
  const colors = getColors(theme);
  const t = themes[theme] || themes.dark;
  const c = colors[node.color] || colors.orange;
  
  switch (node.type) {
    case 'timeline':
      return (
        <div style={{ marginBottom: 16, position: 'relative', paddingLeft: 20 }}>
          {/* 세로 라인 */}
          <div style={{ position: 'absolute', left: 6, top: 8, bottom: 8, width: 2, background: `linear-gradient(to bottom, ${colors.blue.accent}, ${colors.purple.accent})`, borderRadius: 1 }} />
          {node.items?.map((item, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'flex-start', marginBottom: 12, position: 'relative' }}>
              {/* 점/원 */}
              <div style={{ position: 'absolute', left: -17, top: 6, width: item.ellipsis ? 8 : 12, height: item.ellipsis ? 8 : 12, borderRadius: '50%', background: item.ellipsis ? t.subText : colors.blue.accent, border: item.ellipsis ? 'none' : `2px solid ${colors.blue.border}` }} />
              {item.ellipsis ? (
                <div style={{ color: t.subText, fontSize: 14, padding: '4px 0' }}>⋮</div>
              ) : (
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ background: colors.blue.bg, border: `1px solid ${colors.blue.border}`, borderRadius: 6, padding: '4px 10px', fontSize: 12, fontWeight: 600, color: colors.blue.text, whiteSpace: 'nowrap' }}>{item.label}</span>
                    <span style={{ color: t.text, fontSize: 12 }}>{item.text}</span>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      );
    
    case 'highlight':
      return (
        <div style={{ background: 'linear-gradient(135deg, rgba(245,158,11,0.15), rgba(239,68,68,0.1))', border: `1px solid ${colors.orange.border}`, borderRadius: 8, padding: '10px 14px', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 16 }}>💡</span>
          <span style={{ fontSize: 13, fontWeight: 600, color: colors.orange.text }}>{node.text.replace(/^→\s*/, '')}</span>
        </div>
      );
    
    case 'compare':
      const cols = node.columns || [];
      return (
        <div style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', gap: 80, marginBottom: 12, padding: '0 20px' }}>
            {cols.map((col, i) => (
              <div key={i} style={{ flex: 1, textAlign: 'center', fontSize: 14, fontWeight: 600, color: i === 0 ? colors.blue.text : colors.orange.text }}>{col.title}</div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 80, marginBottom: 12, padding: '0 20px' }}>
            {cols.map((col, i) => (
              <div key={i} style={{ flex: 1 }}>
                {col.items?.map((item, j) => (
                  <div key={j} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 10px', background: t.itemBg, borderRadius: 6, marginBottom: 4, fontSize: 12 }}>
                    <span style={{ color: t.subText }}>{item.k}</span>
                    <span style={{ color: t.text }}>{item.v}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 80, marginBottom: 8, padding: '0 20px' }}>
            {cols.map((_, i) => (
              <div key={i} style={{ flex: 1, height: 1, background: t.border }} />
            ))}
          </div>
          <div style={{ position: 'relative', padding: '0 20px' }}>
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <div style={{ flex: 1, padding: '14px 16px', background: cols[0]?.positive ? colors.green.bg : colors.red.bg, border: `1px solid ${cols[0]?.positive ? colors.green.border : colors.red.border}`, borderRadius: 4, textAlign: 'center' }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: cols[0]?.positive ? colors.green.text : colors.red.text }}>{cols[0]?.result}</span>
              </div>
              <div style={{ width: 80, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <div style={{ width: 50, height: 20, background: t.subText, clipPath: 'polygon(0 35%, 70% 35%, 70% 0, 100% 50%, 70% 100%, 70% 65%, 0 65%)' }} />
              </div>
              <div style={{ flex: 1, padding: '14px 16px', background: cols[1]?.positive ? colors.green.bg : colors.red.bg, border: `1px solid ${cols[1]?.positive ? colors.green.border : colors.red.border}`, borderRadius: 4, textAlign: 'center' }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: cols[1]?.positive ? colors.green.text : colors.red.text }}>{cols[1]?.result}</span>
              </div>
            </div>
            {node.flow && (
              <div style={{ display: 'flex', marginTop: 12, marginBottom: 24 }}>
                <div style={{ flex: 1, display: 'flex', justifyContent: 'center' }}>
                  <div style={{ width: '50%', borderLeft: `3px solid ${t.subText}`, borderBottom: `3px solid ${t.subText}`, height: 30, borderBottomLeftRadius: 6 }} />
                </div>
                <div style={{ width: 80, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
                  <div style={{ padding: '6px 12px', background: colors.gray.bg, border: `1px solid ${colors.gray.border}`, borderRadius: 4, fontSize: 11, color: colors.gray.text, whiteSpace: 'nowrap', transform: 'translateY(50%)' }}>
                    {node.flow}
                  </div>
                </div>
                <div style={{ flex: 1, display: 'flex', justifyContent: 'center' }}>
                  <div style={{ width: '50%', position: 'relative', borderRight: `3px solid ${t.subText}`, borderBottom: `3px solid ${t.subText}`, height: 30, borderBottomRightRadius: 6 }}>
                    <div style={{ position: 'absolute', right: -7, top: -8, width: 0, height: 0, borderLeft: '5px solid transparent', borderRight: '5px solid transparent', borderBottom: `8px solid ${t.subText}` }} />
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      );
    
    case 'table':
      const tblHeaders = node.headers || [];
      const tblRows = node.rows || [];
      return (
        <div style={{ marginBottom: 12, borderRadius: 8, overflow: 'hidden', border: `1px solid ${t.border}` }}>
          <div style={{ display: 'flex', background: colors.blue.bg, borderBottom: `2px solid ${colors.blue.border}` }}>
            {tblHeaders.map((h, i) => (
              <div key={i} style={{ flex: 1, padding: '10px 14px', fontSize: 12, fontWeight: 600, color: colors.blue.text, borderRight: i < tblHeaders.length - 1 ? `1px solid ${colors.blue.border}` : 'none' }}>
                {h}
              </div>
            ))}
          </div>
          {tblRows.map((row, i) => (
            <div key={i} style={{ display: 'flex', borderBottom: i < tblRows.length - 1 ? `1px solid ${t.border}` : 'none', background: i % 2 === 0 ? 'transparent' : t.itemBg }}>
              {row.map((cell, j) => (
                <div key={j} style={{ flex: 1, padding: '8px 14px', fontSize: 12, color: t.text, borderRight: j < row.length - 1 ? `1px solid ${t.border}` : 'none' }}>
                  {cell}
                </div>
              ))}
            </div>
          ))}
        </div>
      );

    case 'kv':
      return (
        <div style={{ marginBottom: 12 }}>
          {node.items?.map((item, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 14px', background: c.bg, border: `1px solid ${c.border}`, borderRadius: 8, marginBottom: 6 }}>
              <span style={{ color: c.text, fontSize: 13 }}>{item.k}</span>
              <span style={{ color: t.text, fontSize: 13, fontWeight: 600 }}>{item.v}</span>
            </div>
          ))}
        </div>
      );
    
    case 'list':
      return (
        <div style={{ marginBottom: 12 }}>
          {node.items?.map((item, i) => (
            <div key={i} style={{ background: c.bg, border: `1px solid ${c.border}`, borderRadius: 8, padding: 12, marginBottom: 8 }}>
              <div style={{ display: 'flex', gap: 10 }}>
                <span style={{ background: `linear-gradient(135deg, ${c.accent}, ${colors.orange.accent})`, color: 'white', width: 24, height: 24, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 'bold', flexShrink: 0 }}>{item.n}</span>
                <div>
                  <div style={{ color: t.text, fontSize: 13 }}>{item.text}</div>
                  {item.subs?.map((sub, j) => (
                    <div key={j} style={{ color: c.accent, fontSize: 11, marginTop: 4 }}>→ {sub}</div>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      );
    
    case 'section':
      return (
        <div style={{ background: c.bg, border: `1px solid ${c.border}`, borderRadius: 10, padding: 14, marginBottom: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: c.text, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 16 }}>{node.icon}</span>
            {node.title}
          </div>
          {node.items?.map((item, i) => (
            <div key={i} style={{ color: t.text, fontSize: 12, marginBottom: 6, paddingLeft: 8, borderLeft: `2px solid ${c.border}` }}>{item}</div>
          ))}
        </div>
      );
    
    case 'note':
      return (
        <div style={{ background: colors.blue.bg, border: `1px solid ${colors.blue.border}`, borderRadius: 8, padding: '10px 14px', marginBottom: 10, fontSize: 12, color: colors.blue.text }}>
          {node.text}
        </div>
      );

    case 'sequence':
      const seqParticipants = node.participants || [];
      const seqMessages = node.messages || [];
      return (
        <div style={{ marginBottom: 16 }}>
          {/* 참여자 헤더 */}
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16, padding: '0 20px' }}>
            {seqParticipants.map((p, i) => (
              <div key={i} style={{
                background: i === 0 ? colors.blue.bg : colors.green.bg,
                border: `2px solid ${i === 0 ? colors.blue.border : colors.green.border}`,
                borderRadius: 8,
                padding: '10px 20px',
                fontWeight: 600,
                fontSize: 13,
                color: i === 0 ? colors.blue.text : colors.green.text
              }}>
                {p}
              </div>
            ))}
          </div>

          {/* 메시지들 */}
          <div style={{ position: 'relative', padding: '0 40px' }}>
            {/* 세로 라인들 */}
            <div style={{ position: 'absolute', left: 60, top: 0, bottom: 0, width: 2, background: colors.blue.border }} />
            <div style={{ position: 'absolute', right: 60, top: 0, bottom: 0, width: 2, background: colors.green.border }} />

            {seqMessages.map((msg, i) => (
              <div key={i} style={{ marginBottom: msg.detail ? 28 : 16 }}>
                {/* 라벨 (화살표 위에 표시) */}
                <div style={{
                  textAlign: 'center',
                  marginBottom: 4,
                  position: 'relative',
                  zIndex: 2
                }}>
                  <span style={{
                    display: 'inline-block',
                    background: msg.direction === 'right' ? colors.orange.bg : colors.cyan.bg,
                    border: `1px solid ${msg.direction === 'right' ? colors.orange.border : colors.cyan.border}`,
                    borderRadius: 4,
                    padding: '4px 12px',
                    fontSize: 11,
                    color: msg.direction === 'right' ? colors.orange.text : colors.cyan.text,
                    whiteSpace: 'nowrap'
                  }}>
                    {msg.name}
                    {msg.note && <span style={{ color: t.subText, marginLeft: 8 }}>({msg.note})</span>}
                  </span>
                </div>
                {/* 화살표 라인 */}
                <div style={{ display: 'flex', alignItems: 'center', paddingLeft: 30, paddingRight: 30 }}>
                  {msg.direction === 'right' ? (
                    <>
                      <div style={{ flex: 1, height: 2, background: colors.orange.accent }} />
                      <div style={{ color: colors.orange.accent, marginLeft: -6, fontSize: 12 }}>▶</div>
                    </>
                  ) : (
                    <>
                      <div style={{ color: colors.cyan.accent, marginRight: -6, fontSize: 12 }}>◀</div>
                      <div style={{ flex: 1, height: 2, background: colors.cyan.accent }} />
                    </>
                  )}
                </div>
                {msg.detail && (
                  <div style={{
                    textAlign: 'center',
                    marginTop: 6,
                    fontSize: 10,
                    color: t.subText,
                    fontFamily: 'monospace'
                  }}>
                    [{msg.detail}]
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      );

    case 'hierarchy':
      const root = node.root || {};
      const children = node.children || [];
      const connection = node.connection || '';
      return (
        <div style={{ marginBottom: 16 }}>
          {/* 루트 박스 */}
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 8 }}>
            <div style={{
              background: `linear-gradient(135deg, ${colors.blue.bg}, ${colors.purple.bg})`,
              border: `2px solid ${colors.blue.border}`,
              borderRadius: 12,
              padding: '16px 32px',
              textAlign: 'center',
              minWidth: 200
            }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: colors.blue.text }}>{root.title}</div>
              {root.subtitle && <div style={{ fontSize: 12, color: t.subText, marginTop: 4 }}>({root.subtitle})</div>}
              {root.info?.map((info, i) => (
                <div key={i} style={{ fontSize: 11, color: t.text, marginTop: 4, padding: '2px 8px', background: colors.blue.bg, borderRadius: 4 }}>{info}</div>
              ))}
            </div>
          </div>

          {/* 연결선 + 라벨 */}
          {children.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ width: 2, height: 20, background: t.subText }} />
                {connection && (
                  <span style={{ fontSize: 11, color: colors.orange.text, background: colors.orange.bg, padding: '2px 8px', borderRadius: 4, marginLeft: 8 }}>{connection}</span>
                )}
              </div>
              <div style={{ position: 'relative', width: '80%', height: 24 }}>
                <div style={{ position: 'absolute', top: 0, left: `${100 / (children.length * 2)}%`, right: `${100 / (children.length * 2)}%`, height: 2, background: t.subText }} />
                {children.map((_, i) => {
                  const pos = ((i + 0.5) / children.length) * 100;
                  return (
                    <div key={i} style={{ position: 'absolute', left: `${pos}%`, top: 0, transform: 'translateX(-50%)', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                      <div style={{ width: 2, height: 16, background: t.subText }} />
                      <div style={{ color: t.subText, fontSize: 10, marginTop: -2 }}>▼</div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* 자식 박스들 */}
          {children.length > 0 && (
            <div style={{ display: 'flex', justifyContent: 'center', gap: 12, flexWrap: 'wrap' }}>
              {children.map((child, i) => (
                <div key={i} style={{
                  background: colors.green.bg,
                  border: `1px solid ${colors.green.border}`,
                  borderRadius: 10,
                  padding: '12px 16px',
                  textAlign: 'center',
                  minWidth: 120
                }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: colors.green.text }}>{child.title}</div>
                  {child.info?.map((info, j) => (
                    <div key={j} style={{ fontSize: 11, color: t.subText, marginTop: 4 }}>{info}</div>
                  ))}
                  {/* 중첩 모듈들 */}
                  {child.modules?.length > 0 && (
                    <div style={{ marginTop: 8, borderTop: `1px solid ${colors.green.border}`, paddingTop: 8 }}>
                      {child.modules.map((mod, k) => (
                        <div key={k} style={{
                          background: colors.cyan.bg,
                          border: `1px solid ${colors.cyan.border}`,
                          borderRadius: 6,
                          padding: '6px 10px',
                          marginTop: k > 0 ? 4 : 0,
                          fontSize: 10
                        }}>
                          <div style={{ fontWeight: 600, color: colors.cyan.text }}>{mod.title}</div>
                          {mod.info?.map((info, l) => (
                            <div key={l} style={{ color: t.subText, marginTop: 2 }}>{info}</div>
                          ))}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      );

    case 'tree':
      return (
        <div style={{ marginBottom: 12 }}>
          {node.items?.map((item, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', marginLeft: item.depth * 20, marginBottom: 8 }}>
              <div style={{ width: 20, height: 20, borderRadius: '50%', background: item.highlight ? c.accent : t.border, display: 'flex', alignItems: 'center', justifyContent: 'center', marginRight: 10, fontSize: 10 }}>
                {i === node.items.length - 1 ? '📍' : '→'}
              </div>
              <div style={{ padding: '8px 14px', background: item.highlight ? c.bg : t.itemBg, border: `1px solid ${item.highlight ? c.border : t.border}`, borderRadius: 8, color: item.highlight ? c.text : t.text, fontSize: 13, fontWeight: item.highlight ? 600 : 400 }}>
                {item.text}
                {item.highlight && <span style={{ marginLeft: 8, fontSize: 11 }}>✓</span>}
              </div>
            </div>
          ))}
        </div>
      );
    
    case 'columns':
      return (
        <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
          {node.children?.map((child, i) => (
            <div key={i} style={{ flex: 1 }}><NodeRenderer node={{...child, type: child.type || 'box'}} theme={theme} /></div>
          ))}
        </div>
      );
    
    case 'card':
      return (
        <div style={{ background: c.bg, border: `1px solid ${c.border}`, borderRadius: 10, padding: 14, height: '100%', position: 'relative' }}>
          <div style={{ position: 'absolute', top: -1, left: 16, right: 16, height: 3, background: c.accent, borderRadius: '0 0 3px 3px' }} />
          <div style={{ fontSize: 13, fontWeight: 600, color: c.text, marginBottom: 8 }}>{node.icon} {node.title}</div>
          {node.items?.map((item, i) => (
            <div key={i} style={{ fontSize: 11, color: t.text, marginBottom: 4, paddingLeft: 8, borderLeft: `2px solid ${c.border}` }}>{item}</div>
          ))}
          {node.cost && (
            <div style={{ marginTop: 8, padding: '4px 10px', background: `${c.accent}30`, borderRadius: 4, fontSize: 11, fontWeight: 600, color: c.accent, display: 'inline-block' }}>
              💰 {node.cost}
            </div>
          )}
        </div>
      );

    case 'box':
      if (node.subtitle) {
        return (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', margin: '16px 0' }}>
            <div style={{ background: `linear-gradient(135deg, ${c.bg}, ${colors.orange.bg})`, border: `2px solid ${c.border}`, borderRadius: 12, padding: '16px 24px', textAlign: 'center' }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: c.text }}>{node.title}</div>
              <div style={{ fontSize: 11, color: c.accent, marginTop: 4 }}>{node.subtitle}</div>
            </div>
          </div>
        );
      }
      return (
        <div style={{ background: c.bg, border: `1px solid ${c.border}`, borderRadius: 10, padding: 14, marginBottom: 10, position: 'relative' }}>
          <div style={{ position: 'absolute', top: -1, left: 16, right: 16, height: 3, background: c.accent, borderRadius: '0 0 3px 3px' }} />
          <div style={{ fontSize: 13, fontWeight: 600, color: c.text, marginBottom: node.items?.length ? 8 : 0 }}>{node.title}</div>
          {node.items?.map((item, i) => (
            <div key={i} style={{ fontSize: 11, color: t.text, marginBottom: 4, paddingLeft: 8, borderLeft: `2px solid ${c.border}` }}>{item}</div>
          ))}
          {node.cost && (
            <div style={{ marginTop: 8, padding: '4px 10px', background: `${c.accent}30`, borderRadius: 4, fontSize: 11, fontWeight: 600, color: c.accent, display: 'inline-block' }}>
              💰 {node.cost}
            </div>
          )}
        </div>
      );

    case 'branch':
      const items = node.items || [];
      return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <div style={{ width: 2, height: 20, background: t.subText }} />
          <div style={{ position: 'relative', width: '80%', height: 30 }}>
            <div style={{ position: 'absolute', top: 0, left: `${100 / (items.length * 2)}%`, right: `${100 / (items.length * 2)}%`, height: 2, background: t.subText }} />
            {items.map((_, i) => {
              const pos = ((i + 0.5) / items.length) * 100;
              return (
                <div key={i} style={{ position: 'absolute', left: `${pos}%`, top: 0, transform: 'translateX(-50%)', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  <div style={{ width: 2, height: 20, background: t.subText }} />
                  <div style={{ color: t.subText, fontSize: 12, marginTop: -4 }}>▼</div>
                </div>
              );
            })}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-around', width: '100%', gap: 8, marginTop: 8 }}>
            {items.map((item, i) => (
              <div key={i} style={{ background: colors.purple.bg, border: `1px solid ${colors.purple.border}`, borderRadius: 8, padding: '10px 16px', fontSize: 12, color: colors.purple.text, textAlign: 'center', flex: 1 }}>{item}</div>
            ))}
          </div>
        </div>
      );
    
    default:
      return <div style={{ color: '#f66', fontSize: 12, padding: 8, background: 'rgba(255,0,0,0.1)', borderRadius: 4 }}>Unknown: {node.type}</div>;
  }
}

// ==================== 메인 앱 ====================
export default function App() {
  const [ascii, setAscii] = useState(asciiSamples.timeline);
  const [json, setJson] = useState('');
  const [data, setData] = useState({ title: '', nodes: [] });
  const [error, setError] = useState(null);
  const [editMode, setEditMode] = useState('ascii');
  const [theme, setTheme] = useState('dark');

  useEffect(() => {
    if (editMode === 'ascii') {
      const parsed = parseAsciiToJson(ascii);
      setData(parsed);
      setJson(JSON.stringify(parsed, null, 2));
      setError(null);
    }
  }, [ascii, editMode]);

  const handleJsonChange = (text) => {
    setJson(text);
    setEditMode('json');
    try {
      const parsed = JSON.parse(text);
      setData(parsed);
      setError(null);
    } catch (e) {
      setError(e.message);
    }
  };

  const handleAsciiChange = (text) => {
    setAscii(text);
    setEditMode('ascii');
  };

  return (
    <div style={{ display: 'flex', height: '100vh', fontFamily: 'system-ui, sans-serif', background: '#0a0a0a', color: '#eee' }}>
      {/* ASCII */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', borderRight: '1px solid #222', minWidth: 0 }}>
        <div style={{ padding: '6px 10px', borderBottom: '1px solid #222', fontSize: 11, background: '#111', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 4 }}>
          <span style={{ color: editMode === 'ascii' ? '#3b82f6' : '#666' }}>ASCII</span>
          <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
            {Object.keys(asciiSamples).map(k => (
              <button key={k} onClick={() => handleAsciiChange(asciiSamples[k])} style={{ fontSize: 9, background: '#222', border: 'none', color: '#888', padding: '2px 5px', borderRadius: 3, cursor: 'pointer' }}>{k}</button>
            ))}
          </div>
        </div>
        <textarea value={ascii} onChange={(e) => handleAsciiChange(e.target.value)} spellCheck={false}
          style={{ flex: 1, padding: 10, background: '#050505', border: 'none', color: '#bbb', fontSize: 10, fontFamily: '"D2Coding", monospace', resize: 'none', lineHeight: 1.3 }} />
      </div>

      {/* JSON */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', borderRight: '1px solid #222', minWidth: 0 }}>
        <div style={{ padding: '6px 10px', borderBottom: '1px solid #222', fontSize: 11, background: '#111', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 4 }}>
          <span style={{ color: editMode === 'json' ? '#8b5cf6' : '#666' }}>JSON {error && <span style={{ color: '#f66' }}>⚠</span>}</span>
          <button onClick={() => navigator.clipboard.writeText(json)} style={{ fontSize: 9, background: '#222', border: 'none', color: '#888', padding: '2px 5px', borderRadius: 3, cursor: 'pointer' }}>copy</button>
        </div>
        <textarea value={json} onChange={(e) => handleJsonChange(e.target.value)} spellCheck={false}
          style={{ flex: 1, padding: 10, background: error ? '#0a0505' : '#050505', border: 'none', color: error ? '#faa' : '#888', fontSize: 10, fontFamily: '"JetBrains Mono", monospace', resize: 'none', lineHeight: 1.3 }} />
      </div>

      {/* Card */}
      <div style={{ flex: 1.3, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <div style={{ padding: '6px 10px', borderBottom: '1px solid #222', fontSize: 11, background: '#111', color: '#22c55e', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>Card</span>
          <div style={{ display: 'flex', gap: 4 }}>
            {Object.entries(themes).map(([key, val]) => (
              <button key={key} onClick={() => setTheme(key)} style={{ padding: '2px 6px', borderRadius: 4, border: theme === key ? '1px solid #3b82f6' : '1px solid #333', background: theme === key ? 'rgba(59,130,246,0.2)' : 'transparent', color: theme === key ? '#3b82f6' : '#666', cursor: 'pointer', fontSize: 9 }}>
                {val.name}
              </button>
            ))}
          </div>
        </div>
        <div style={{ flex: 1, overflow: 'auto', padding: 16, background: themes[theme].bg }}>
          <div style={{ background: themes[theme].cardBg, borderRadius: 14, overflow: 'hidden', boxShadow: '0 8px 32px rgba(0,0,0,0.5)', border: `1px solid ${themes[theme].border}` }}>
            <div style={{ background: themes[theme].headerBg, padding: '14px 18px' }}>
              <h2 style={{ margin: 0, fontSize: 15, color: 'white' }}>{data.title || '제목 없음'}</h2>
            </div>
            <div style={{ padding: 14 }}>
              {data.nodes?.map((node, i) => <NodeRenderer key={i} node={node} theme={theme} />)}
              {(!data.nodes || data.nodes.length === 0) && (
                <div style={{ color: '#555', fontSize: 11, textAlign: 'center', padding: 16 }}>nodes 배열에 요소를 추가하세요</div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
