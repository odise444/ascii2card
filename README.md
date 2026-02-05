# ASCII to Card 변환기

ASCII 아트 다이어그램을 시각적 카드 UI로 변환하는 React 앱

## 실행

```bash
npm install
npm run dev
```

## 지원 다이어그램

| 타입 | 설명 | 감지 패턴 |
|------|------|-----------|
| hierarchy | 계층 구조 (중첩 모듈 지원) | `┐\s+┌` + `▼` |
| sequence | 시퀀스 다이어그램 | `│──>│` / `│<──│` |
| timeline | 타임라인 | `→` 흐름 |
| compare | 비교 다이어그램 | `──→` + `└──┘` |
| columns | 2컬럼 레이아웃 | 병렬 박스 |
| tree | 트리 구조 | `├─` / `└─` |
| kv | Key-Value | `key : value` |
| box | 단일 박스 | `┌─┐` |

## 테마

Dark / Light 테마 지원 (우측 상단 토글)

## 기술 스택

- React 18
- Vite 5
