# ASCII to Card 변환기

ASCII 아트 다이어그램을 시각적 카드 UI로 실시간 변환하는 React 웹 애플리케이션

## 실행

```bash
npm install
npm run dev
```

## 화면 구조 (3-패널 레이아웃)

```
┌──────────────┬──────────────┬──────────────────┐
│  ASCII 입력   │  JSON 뷰     │  Card 미리보기    │
│  (편집 가능)  │  (편집 가능)  │  (렌더링 결과)    │
└──────────────┴──────────────┴──────────────────┘
```

- **ASCII → JSON**: ASCII 아트 입력 시 자동 파싱
- **JSON → Card**: JSON 편집 시 즉시 카드 렌더링
- 양방향 편집 지원

## 지원 다이어그램 (8종)

| 타입 | 설명 | 감지 패턴 |
|------|------|-----------|
| hierarchy | 계층 구조 (중첩 모듈 지원) | `┐\s+┌` + `▼` |
| sequence | 시퀀스 다이어그램 | `│──>│` / `│<──│` |
| timeline | 타임라인 | `N월: ...` 패턴 |
| compare | 비교 다이어그램 | `──→` + `└──┘` |
| columns | 2컬럼 레이아웃 | 병렬 박스 |
| tree | 트리 구조 | `├─` / `└─` |
| kv | Key-Value | `key : value` |
| box | 단일/다중 박스 | `┌─┐` |

## 파서 구조

```
parseAsciiToJson()          ← 통합 파서 (자동 타입 감지)
  ├─ parseSequenceDiagram() ← 시퀀스 전용
  ├─ parseHierarchyDiagram()← 계층 전용
  └─ parseTree()            ← 트리 전용
```

나머지 타입(timeline, compare, columns, kv, box 등)은 통합 파서 내부에서 처리

## 테마

6종 테마 지원 (우측 상단 토글)

| 테마 | 스타일 |
|------|--------|
| Dark | 어두운 블루-퍼플 그라데이션 |
| Light | 밝은 배경, 블루 헤더 |
| Solar | 다크 + 골드/앰버 강조 |
| AWS | 다크 + 오렌지 강조 |
| Azure | 다크 네이비 + 블루 강조 |
| Minimal | 밝은 배경, 모노톤 |

각 테마별 20가지 색상 팔레트 제공

## 샘플 데이터

상단 버튼으로 프리셋 샘플 전환 가능:

`timeline` · `season` · `spec` · `diagram` · `sections` · `tree` · `arch` · `hierarchy` · `sequence` · `sequenceCtrl` · `hierarchyNested`

## 프로젝트 구조

```
ascii2card/
├─ index.html              ← 엔트리 HTML
├─ json-card-builder.jsx   ← 메인 컴포넌트 (파서 + 렌더러 + 테마 + 샘플)
├─ src/
│  └─ main.jsx             ← React 마운트
├─ vite.config.js          ← Vite 설정 (port: 3000)
└─ package.json
```

## 기술 스택

- React 18
- Vite 5
- CSS-in-JS (인라인 스타일, 외부 스타일시트 없음)
- 외부 라이브러리 의존성 없음 (React/ReactDOM만 사용)
