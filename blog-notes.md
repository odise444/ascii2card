# ASCII to Card 블로그 시리즈 - 작성 소재 정리

---

## 1편: "ASCII 아트를 카드 UI로 바꾸는 도구를 만들었다"

### 1-1. 동기 (왜 만들었나)

- Claude 대화에서 ASCII 박스 다이어그램이 자주 등장
  - 시스템 아키텍처, 시퀀스 흐름, 비교표 등을 `┌─┐ │ └─┘`로 표현
  - 텍스트로는 훌륭하지만, 블로그/발표 자료에 그대로 붙이면 가독성이 떨어짐
- 원하는 것: ASCII → 깔끔한 카드 UI 자동 변환
- 기존 도구(Mermaid, PlantUML 등)와의 차이점:
  - 별도 문법을 새로 배울 필요 없음
  - Claude가 이미 만들어준 ASCII를 그대로 입력하면 됨
  - 실시간 미리보기 + JSON 중간 포맷으로 세밀한 커스터마이징 가능

### 1-2. 전체 파이프라인

```
ASCII 텍스트 입력
    ↓
[1] 타입 감지 (패턴 매칭)
    - `[└├]─` → tree
    - `│──>│` → sequence
    - `┐\s+┌` + `▼` → hierarchy
    - `──→` + `└──┘` → compare
    - 그 외 → 통합 파서에서 줄 단위 분석
    ↓
[2] JSON AST 생성
    {
      title: "제목",
      nodes: [
        { type: "timeline", items: [...] },
        { type: "kv", items: [...] },
        ...
      ]
    }
    ↓
[3] React 렌더링 (NodeRenderer)
    - 노드 타입별 컴포넌트 매핑
    - 테마별 색상 자동 적용
```

### 1-3. 변환 전/후 비교 포인트 (스크린샷 촬영 대상)

| 샘플 | ASCII 원본 특징 | 카드 변환 후 |
|------|----------------|-------------|
| `hierarchy` | `┌─┐ ▼ ┌─┐` 텍스트 박스 | 루트→자식 연결선 + 그라데이션 카드 |
| `sequence` | `│──> │<──` 화살표 | 참여자 헤더 + 방향별 색상 화살표 |
| `timeline` | `7월: ...` 텍스트 나열 | 세로 타임라인 + 날짜 뱃지 |
| `compare` | 숫자 나열 + `──→` | 좌우 비교 카드 + 결과 박스 (초록/빨강) |
| `tree` | `├─ └─` 들여쓰기 | 깊이별 들여쓰기 + 하이라이트 노드 |
| `arch` | 중첩 `┌─┐` 박스 | 스택 형태 카드 + 비용 뱃지 |

### 1-4. 8가지 다이어그램 타입 한줄 소개

1. **hierarchy** - 루트 → 자식 계층 (BMS 시스템처럼 1:N 구조)
2. **sequence** - 시퀀스 다이어그램 (SystemBMS ↔ MainBMS 통신)
3. **timeline** - 시간 순서 흐름 (월별 발전/소비 추이)
4. **compare** - 두 항목 비교 (여름 vs 겨울 발전량)
5. **columns** - 2컬럼 병렬 배치 (주택 🏡 vs 농지 🌾)
6. **tree** - 트리 구조 (메뉴/경로 네비게이션)
7. **kv** - Key-Value 표 (PV 용량, ESS 용량 등 스펙)
8. **box** - 단일/다중 카드 (서비스 박스 + 비용 표시)

---

## 2편: "8가지 ASCII 패턴을 자동 인식하는 파서 만들기"

### 2-1. 타입 감지 우선순위 (parseAsciiToJson 진입부)

파서가 텍스트를 받으면 아래 순서로 타입을 결정한다:

```
[우선순위 1] tree 감지
  조건: /[└├]─/.test(text) && !/^┌/.test(text.trim())
  의미: └─ 또는 ├─가 있고, 첫 줄이 ┌로 시작하지 않으면 → 박스 없는 순수 트리

[우선순위 2] sequence 감지
  조건: /│[─]+.*>│|│<[─]+.*│/.test(text) && !/┌.*┐/.test(text)
  의미: │──>│ 화살표 패턴이 있고, 박스(┌┐)가 없으면 → 시퀀스 다이어그램

[우선순위 3] hierarchy 감지
  조건: 같은 줄에 ┐  ┌ (공백 구분 다중 박스) && /▼/.test(text)
  의미: 한 줄에 여러 박스 시작 + 아래 화살표 → 계층 구조

[우선순위 4] compare 감지
  조건: /──+→/.test(text) && /└──[^┌]+──+┘/.test(text)
  의미: ──→ 결과 화살표 + └── label ──┘ 바닥 라벨

[나머지] 통합 파서 (줄 단위 분석)
  → timeline, kv, section, list, box, columns, branch, note, highlight
```

**블로그 포인트**: 감지 순서가 중요한 이유
- tree와 hierarchy 모두 `├─`를 포함할 수 있음
- sequence와 일반 박스 모두 `│`를 포함함
- 먼저 "가장 특수한 패턴"을 확인하고, 실패하면 점점 일반적인 패턴으로 폴백

### 2-2. 통합 파서의 줄 단위 처리 흐름

```
for (각 줄) {
  [1단계] 외곽 테두리 제거
      ┌───┤ → skip
      └───┘ → skip
      ├───┤ → skip
      │ content │ → "content" 추출

  [2단계] 노이즈 필터링
      빈 줄 → skip
      ─── (구분선만) → skip
      │┼┬┴▼▲←→─ (구조 문자만) → skip

  [3단계] 내부 박스 감지 (┌가 포함된 줄)
      innerBoxCount = ┌의 개수
      → 1개면 단일 박스, 2개 이상이면 병렬 박스
      → └ 만날 때까지 내용 수집 후 box/columns 노드 생성

  [4단계] 패턴 매칭 (순서대로 시도)
      ① 타이틀 (첫 번째 텍스트 줄)
      ② N월: ... → timeline
      ③ text: → section 헤더
      ④ - bullet → section 아이템
      ⑤ ※ → note
      ⑥ → highlight → highlight
      ⑦ • bullet (2컬럼) → columns 아이템
      ⑧ [a] [b] [c] → branch
      ⑨ 📌 text: → note
      ⑩ ✅❌⚠️💡🔥⭐ text → 이모지 section
      ⑪ key: value → kv (value가 짧으면) / section (길면)
      ⑫ [N] 또는 N. 또는 N️⃣ → numbered list
      ⑬ -> 또는 → subtext → list의 하위항목
      ⑭ text    text (6칸+ 공백) → kv (스페이스 구분)

  [루프 종료] flush 모든 누적 데이터
}
```

### 2-3. 주요 파싱 기법 상세

#### 기법 1: 외곽 테두리 제거

```javascript
// 줄이 ┌ └ ├로 시작하면 구조선이므로 통째로 무시
if (line.trim().startsWith('┌') || line.trim().startsWith('└') || line.trim().startsWith('├')) continue;

// │로 감싸진 내용에서 │ 제거
let content = line;
if (content.startsWith('│')) content = content.slice(1);
if (content.endsWith('│')) content = content.slice(0, -1);
```

**포인트**: 모든 ASCII 박스의 "액자"를 벗기고 순수 내용만 추출하는 첫 단계

#### 기법 2: 내부 박스 감지 (중첩 박스)

```javascript
// 줄 안에 ┌가 포함되면 → 외곽이 아닌 "내부 박스"
if (trimmed.includes('┌')) {
  innerBoxCount = (trimmed.match(/┌/g) || []).length;
  // ┌의 위치를 기록해서 나중에 컬럼 분리에 사용
  innerBoxPositions = [];
  let pos = 0;
  for (let b = 0; b < innerBoxCount; b++) {
    pos = content.indexOf('┌', pos);
    innerBoxPositions.push(pos);
    pos++;
  }
}
```

**포인트**: `┌`의 x좌표(인덱스)를 기록해두면, 이후 줄에서 같은 위치 범위의 텍스트를 잘라서 각 박스의 내용을 분리할 수 있음

#### 기법 3: 이모지 키캡 숫자 매칭

```javascript
const numMatch = trimmed.match(/^(?:\[(\d+)\]|(\d+)\.|(\d)\uFE0F?\u20E3)\s*(.+)/);
```

세 가지 번호 형식을 하나의 정규식으로 처리:
- `[1] 텍스트` - 대괄호 번호
- `1. 텍스트` - 마침표 번호
- `1️⃣ 텍스트` - 이모지 키캡 (`\uFE0F` = 변형 선택자, `\u20E3` = 결합 키캡)

#### 기법 4: 들여쓰기 기반 depth 계산 (트리)

```javascript
const depth = Math.floor((line.match(/^\s*/)[0].length) / 3);
```

앞쪽 공백 수 ÷ 3 = 깊이 레벨. Claude가 만드는 트리는 보통 3칸 들여쓰기 사용

#### 기법 5: 계층 다이어그램의 위치 기반 파싱

```javascript
// 자식 박스들의 ┌ 위치 기록
function findBoxPositions(line) {
  const positions = [];
  let idx = 0;
  while ((idx = line.indexOf('┌', idx)) !== -1) {
    positions.push(idx);
    idx++;
  }
  return positions;
}

// 각 줄에서 박스 위치별로 내용 추출
childBoxPositions.forEach((startPos, boxIdx) => {
  const endPos = childBoxPositions[boxIdx + 1] || line.length;
  const segment = line.substring(startPos, endPos);
  // segment에서 │ 사이의 내용 추출
});
```

**포인트**: 텍스트의 x좌표(컬럼 위치)가 곧 "어떤 박스에 속하는가"를 결정. 문자열을 표(grid)처럼 다루는 기법

#### 기법 6: 중첩 모듈 감지 (hierarchy 내부)

```javascript
// │ ┌───┐ │ → 중첩 박스 시작
if (/│\s*┌[─]+┐\s*│/.test(segment)) {
  box.currentModule = { lines: [] };
}
// │ ├───┤ │ → 중첩 박스 구분선 (모듈 경계)
if (/│\s*├[─]+┤\s*│/.test(segment)) {
  box.modules.push(box.currentModule);
  box.currentModule = { lines: [] };
}
// │ └───┘ │ → 중첩 박스 종료
if (/│\s*└[─]+┘\s*│/.test(segment)) {
  box.modules.push(box.currentModule);
  box.currentModule = null;
}
```

**포인트**: 박스 안의 박스를 재귀 없이 상태 머신(currentModule)으로 처리

#### 기법 7: flush 패턴 (누적 → 방출)

```javascript
// 섹션, 리스트, KV 등은 여러 줄에 걸쳐 누적
// 새로운 타입의 줄을 만나면 이전 누적분을 nodes에 push
function flushPending() {
  if (currentSection) { result.nodes.push(currentSection); currentSection = null; }
  if (currentList) { result.nodes.push(currentList); currentList = null; }
  if (kvItems.length > 0) { result.nodes.push({ type: 'kv', items: [...kvItems] }); kvItems = []; }
}
```

**포인트**: 줄 단위 파서에서 "여러 줄이 하나의 노드를 구성"하는 문제를 해결하는 전형적인 패턴

### 2-4. 시퀀스 파서 상세 (parseSequenceDiagram)

```
입력 예시:
SystemBMS                              MainBMS (x16)
    │                                       │
    │──── SYSTEM2MAIN_CMD ─────────────────>│ (Broadcast)
    │<─── MAINxx_CYC_INFO_01 ──────────────│ (100ms)
```

파싱 과정:
1. 첫 줄에서 참여자 추출: 2칸 이상 공백으로 split
2. 각 줄에서 화살표 방향 판별:
   - `│[─]+ text [─]*>│` → direction: 'right'
   - `│<[─]+ text [─]*│` → direction: 'left'
3. `[...]` 주석을 이전 메시지의 detail에 추가

### 2-5. 파서 진화 과정 (블로그 스토리텔링용)

```
v1  → 단순 리스트 (bullet만 파싱)
v2  → KV 쌍 추가
v3  → 박스 감지
v4  → 내부 박스 + 비용 파싱
v5  → 이모지 섹션
v6  → 타임라인
v7  → 2컬럼 레이아웃
v8  → 비교 다이어그램
v9  → 트리 구조
v10 → 시퀀스 다이어그램
v11 → 계층 구조
v12 → 중첩 모듈 + 브랜치 (10/10 테스트 통과)
```

각 버전에서 새 샘플을 추가할 때마다 기존 샘플이 깨지는 회귀 문제 발생
→ 타입 감지 우선순위와 flush 타이밍 조정이 핵심 과제였음

### 2-6. 회귀 테스트 케이스 설계 포인트

각 샘플이 곧 테스트 케이스:
- `asciiSamples` 객체에 11개 프리셋 (timeline, season, spec, diagram, sections, tree, arch, hierarchy, sequence, sequenceCtrl, hierarchyNested)
- 새 타입 추가 시: 새 샘플 추가 → 기존 11개 모두 정상 파싱 확인
- 검증 항목: `data.title` 존재, `data.nodes.length > 0`, 각 노드의 `type`이 기대값과 일치

---

## 3편: "JSON → 카드 UI 렌더링과 테마 시스템"

### 3-1. NodeRenderer 컴포넌트 매핑

```
node.type → 렌더링 형태

timeline   → 세로 타임라인 (라인 + 원형 마커 + 날짜 뱃지)
highlight  → 💡 강조 배너 (그라데이션 배경)
compare    → 좌우 비교 카드 + 화살표 결과 + 플로우 라벨
kv         → Key-Value 행 (좌: 라벨, 우: 값)
list       → 번호 뱃지 + 텍스트 + 하위항목
section    → 아이콘 + 제목 + 좌측 보더 불릿
note       → 정보 배너 (파란 배경)
sequence   → 참여자 헤더 + 세로 라인 + 방향별 화살표
hierarchy  → 루트 카드 → 연결선(라벨) → 자식 카드(모듈 포함)
tree       → 깊이별 들여쓰기 + 원형 마커 + 하이라이트
columns    → flex 가로 배치 (재귀: 자식을 NodeRenderer로 렌더)
card       → 상단 accent 바 + 아이콘 + 불릿 + 비용 뱃지
box        → subtitle 있으면 centered 스타일 / 없으면 card와 유사
branch     → 세로선 → 수평선 분기 → ▼ 화살표 → 하단 카드들
```

### 3-2. 테마 시스템 설계

#### 테마 구조 (themes 객체)

각 테마는 8개의 시맨틱 색상 슬롯을 가짐:

```javascript
{
  bg:       // 전체 배경 (그라데이션 또는 단색)
  cardBg:   // 카드 배경
  headerBg: // 카드 헤더 (그라데이션)
  text:     // 주 텍스트 색상
  subText:  // 보조 텍스트 색상
  accent:   // 강조 색상
  itemBg:   // 아이템 행 배경
  border:   // 테두리 색상
}
```

#### 6개 테마의 설계 의도

| 테마 | 배경 | 헤더 | 용도 |
|------|------|------|------|
| Dark | #12121a 그라데이션 | 앰버→오렌지 | 기본 다크 모드 |
| Light | #f8fafc 단색 | 블루 그라데이션 | 밝은 환경 |
| Solar | #1a1a2e 그라데이션 | 앰버→오렌지 | 에너지/태양광 주제 |
| AWS | #0f1419 그라데이션 | 오렌지 (#ff9900) | AWS 브랜드 색상 |
| Azure | #0a0f1a 그라데이션 | 블루 (#0078d4) | Azure 브랜드 색상 |
| Minimal | #fafafa 단색 | 블랙 (#18181b) | 인쇄/문서용 |

#### 라이트/다크 판별

```javascript
const getColors = (themeName) => {
  const isLightTheme = themeName === 'light' || themeName === 'minimal';
  return isLightTheme ? lightColors : darkColors;
};
```

light와 minimal만 라이트 팔레트, 나머지 4개는 다크 팔레트 사용

### 3-3. 20색 팔레트 시스템

각 색상은 4가지 변형을 가짐:

```javascript
{
  bg:     'rgba(59,130,246,0.1)',   // 배경 (10% 투명도)
  border: 'rgba(59,130,246,0.3)',   // 테두리 (30% 투명도)
  text:   '#93c5fd',                // 텍스트 (밝은 톤 / 어두운 톤)
  accent: '#3b82f6'                 // 강조 (원색)
}
```

20가지 색상: blue, green, red, orange, purple, gray, cyan, teal, emerald, lime, yellow, amber, pink, rose, indigo, violet, sky, slate, zinc, stone

**다크 vs 라이트 차이**: text 값만 다름
- 다크: `#93c5fd` (밝은 파스텔) → 어두운 배경에서 가독성
- 라이트: `#1d4ed8` (어두운 톤) → 밝은 배경에서 가독성
- bg, border, accent는 동일 (rgba 투명도로 양쪽 모두 호환)

#### 색상 자동 할당 로직

```javascript
// 파서에서 타입/내용에 따라 색상 자동 지정
if (title.includes('무료')) color = 'green';      // 무료 → 초록
else if (items.length > 0) color = 'orange';       // 불릿 있으면 → 주황
else if (cost) color = 'purple';                   // 비용 표시 → 보라

// 렌더러에서 색상 조회
const c = colors[node.color] || colors.orange;     // 기본값: orange
```

### 3-4. 렌더링 기법 상세

#### 시퀀스 다이어그램 렌더링

```
참여자 A (파란 박스)                    참여자 B (초록 박스)
    │                                       │
    │────── 라벨 (주황 뱃지) ───────────────▶│
    │                                       │
    │◀────── 라벨 (시안 뱃지) ──────────────│
```

- 세로 라인: absolute 포지션, width: 2px
- 화살표: flex + ▶/◀ 문자
- 라벨: inline-block 뱃지, z-index: 2로 라인 위에 표시
- 방향별 색상: right → orange, left → cyan

#### 계층 다이어그램 렌더링

```
        ┌──────────────┐
        │  루트 (파란)   │
        └──────┬───────┘
               │ 라벨 (주황 뱃지)
     ┌─────────┼─────────┐
     ▼         ▼         ▼
  ┌──────┐  ┌──────┐  ┌──────┐
  │자식1  │  │자식2  │  │자식3  │
  │(초록) │  │(초록) │  │(초록) │
  │┌────┐│  │┌────┐│  │┌────┐│
  ││모듈││  ││모듈││  ││모듈││
  │└────┘│  │└────┘│  │└────┘│
  └──────┘  └──────┘  └──────┘
```

- 연결선: absolute 수평선 + 각 자식 위치에 세로선 + ▼
- 자식 위치 계산: `((i + 0.5) / children.length) * 100`%
- 중첩 모듈: borderTop 구분 + cyan 색상 카드

#### 비교 다이어그램 렌더링

- 결과 박스: positive → green 배경, negative → red 배경
- 화살표: CSS clipPath로 삼각형 생성
  ```javascript
  clipPath: 'polygon(0 35%, 70% 35%, 70% 0, 100% 50%, 70% 100%, 70% 65%, 0 65%)'
  ```
- 플로우 라벨: 하단 ┘ 모양 border로 연결선 표현

### 3-5. 3-Column 에디터 UX

```
┌──────────────┬──────────────┬──────────────────┐
│  ASCII (1fr)  │  JSON (1fr)  │  Card (1.3fr)    │
│  mono 10px    │  mono 10px   │  테마별 배경      │
│  #050505 bg   │  #050505 bg  │  카드 + 그림자    │
└──────────────┴──────────────┴──────────────────┘
```

#### 양방향 데이터 흐름

```javascript
// editMode로 현재 편집 중인 패널 추적
const [editMode, setEditMode] = useState('ascii');

// ASCII 편집 시: ASCII → parse → JSON + Card 자동 갱신
useEffect(() => {
  if (editMode === 'ascii') {
    const parsed = parseAsciiToJson(ascii);
    setData(parsed);
    setJson(JSON.stringify(parsed, null, 2));
  }
}, [ascii, editMode]);

// JSON 편집 시: JSON → parse → Card만 갱신 (ASCII는 유지)
const handleJsonChange = (text) => {
  setJson(text);
  setEditMode('json');
  try {
    const parsed = JSON.parse(text);
    setData(parsed);    // Card 갱신
  } catch (e) {
    setError(e.message); // JSON 에러 표시
  }
};
```

**포인트**: `editMode` 상태가 "누가 소스인가"를 결정. ASCII 편집 중이면 JSON이 자동 덮어쓰여야 하고, JSON 편집 중이면 ASCII가 건드려지면 안 됨

#### UX 디테일

- JSON 에러 시: 배경색 `#0a0505` (붉은 톤) + 텍스트 `#faa` + ⚠ 아이콘
- 샘플 버튼: 상단에 11개 프리셋 버튼 (9px 폰트, 최소 공간)
- 테마 토글: Card 패널 상단에 6개 버튼 (선택 중인 테마 파란 테두리)
- 클립보드 복사: JSON 패널 상단 "copy" 버튼

### 3-6. 한글 모노스페이스 폰트 이슈

- ASCII 에디터: `fontFamily: '"D2Coding", monospace'`
  - D2Coding: 한글/영문 1:2 폭 비율을 맞춘 코딩 폰트
  - ASCII 아트의 줄 맞춤(alignment)이 폰트에 의존
  - 일반 고정폭 폰트는 한글이 2칸이 아닐 수 있어 표가 어긋남
- JSON 에디터: `fontFamily: '"JetBrains Mono", monospace'`
  - JSON은 영문 전용이므로 일반 코딩 폰트 사용
- 본문(Noto Sans KR): 카드 UI 렌더링에 사용, 가변폭

### 3-7. CSS-in-JS 인라인 스타일 선택 이유

- 테마 색상이 JavaScript 객체로 관리되므로, 스타일에서 직접 참조 가능
- 별도 CSS 파일이나 styled-components 없이 단일 파일로 완결
- 동적 색상 변경 (테마 전환)이 React 상태만으로 즉시 반영
- 트레이드오프: 파일이 1,362줄로 커짐, 스타일 재사용성 낮음
