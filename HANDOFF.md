# 원모어(OneMore) 프로토타입 핸드오프

## 목적
이 문서는 **사용자 로그 수집 + 설문조사 레이어 추가** 작업을 위한 핸드오프입니다.
피칭 자료용 프로토타입으로, 실사용자가 직접 써보면서 행동 로그와 설문 응답을 남기는 기능을 붙여야 합니다.

---

## 서비스 개요

**원모어** — 커플 데이트 코스 자동 추천 + 번들 할인 앱 (MVP 프로토타입)

핵심 플로우:
1. 지역 선택 (강남, 성수, 홍대 등 6곳)
2. 타임라인에 식사/카페/놀거리 블록을 드래그앤드롭으로 배치
3. "계획 짜기" 버튼 → Google Places API로 근처 장소 자동 추천
4. 각 장소를 "다른 곳 선택"으로 교체 가능 (스왑 시트)
5. 제휴 매장 수에 따라 누적 번들 할인 (1곳=5%, 2곳=10%, 3곳=15%, 4곳=20%)
6. 결제 → 예약 확정 → 후기 작성

---

## 기술 스택

- **Framework**: Next.js 14 App Router (TypeScript)
- **Styling**: 인라인 스타일만 사용 (CSS 모듈/Tailwind 없음)
- **API**: Google Places API (Nearby Search, Directions, Distance Matrix, Photos)
  - 서버사이드 프록시: `/api/places` — 클라이언트에 키 노출 없음
- **배포**: Vercel
- **저장소**: `z-unghyun/onemore-mvp` (branch: `claude/stoic-faraday-gkdj72`)
- **환경변수**: `GOOGLE_MAPS_KEY` (Vercel에 설정됨)

---

## 파일 구조

```
src/
├── app/
│   ├── api/places/route.ts          # Google Places API 프록시 (서버)
│   ├── api/places/photo/route.ts    # 사진 스트리밍 프록시
│   ├── globals.css                  # 애니메이션(omUp, omDash, omRing, omPop)
│   ├── layout.tsx
│   └── page.tsx                     # <App /> 마운트
├── components/
│   └── App.tsx                      # 앱 전체 (단일 파일 ~1000줄)
└── lib/
    ├── constants.ts                 # HOURH, START, HOURS, DATES, CAT, KIND, PRICE, REGIONS 등
    ├── places.ts                    # Google Places API 호출 함수들
    └── types.ts                     # TimelineItem, AppState 타입
```

---

## 핵심 타입

```typescript
// src/lib/types.ts
interface TimelineItem {
  id: number;
  kind: '식사' | '카페' | '놀거리';
  category: string | null;       // 예: '영화', '브런치', null
  start: number;                 // 분 단위, 540=9:00, 900=15:00
  end: number;
  placeIdx: number;
  placeId?: string;              // Google Place ID
  placeName?: string;            // 추천된 장소명 (없으면 미추천 상태)
  lat?: number;
  lng?: number;
  placeRating?: number;
  photoRef?: string;
  isPartner?: boolean;           // 제휴 여부 (할인 적용)
}
```

---

## 앱 상태 (App.tsx 내 useState들)

| state | 타입 | 설명 |
|---|---|---|
| `tab` | `'home'\|'plan'\|'calendar'\|'mypage'` | 현재 탭 |
| `planStage` | `'build'\|'final'\|'checkout'\|'complete'` | 계획 단계 |
| `region` | `string` | 선택 지역 (강남 등) |
| `items` | `TimelineItem[]` | 타임라인 블록들 |
| `hasRecommended` | `boolean` | 계획짜기 버튼 한 번이라도 눌렀는지 |
| `isMobile` | `boolean` | 768px 미만 여부 |

---

## 로그 수집 시 캡처해야 할 주요 이벤트

프로토타입에서 의미 있는 사용자 행동:

| 이벤트 | 발생 위치 | 수집 가치 |
|---|---|---|
| 지역 선택 | 장소 검색 시트에서 지역 클릭 | 어느 지역이 인기 있는지 |
| 블록 추가 | 식사/카페/놀거리 드롭 또는 탭 | 어떤 kind를 많이 쓰는지 |
| 카테고리 선택 | 카테고리 피커에서 선택 | 세부 카테고리 선호도 |
| 계획 짜기 클릭 | "계획 짜기" 버튼 | 핵심 CTA 전환율 |
| 장소 스왑 | "다른 곳 선택" 후 변경 | 추천 만족도 |
| notFound 발생 | 추천 결과 없음 카드 | 서비스 커버리지 한계 |
| 결제 진행 | "계획 확정" 버튼 | 구매 의도 |
| 이탈 시점 | 어느 단계에서 멈추는지 | 퍼널 이탈 분석 |

---

## 설문 시점 제안

| 시점 | 질문 예시 |
|---|---|
| 계획 짜기 직후 (final 단계 진입 시) | "추천 결과가 마음에 드셨나요?" |
| 스왑 3회 이상 후 | "원하는 장소를 찾기 어려우셨나요?" |
| complete 단계 도달 시 | "이 앱을 실제로 쓴다면 얼마를 낼 의향이 있나요?" |
| 세션 종료 전 (beforeunload) | 간단한 NPS |

---

## 추가 구현 시 주의사항

1. **인라인 스타일만** — 이 프로젝트는 CSS 클래스를 쓰지 않습니다. 모든 스타일은 `style={{ }}` 인라인으로.
2. **단일 컴포넌트 구조** — `App.tsx` 하나에 모든 UI가 있습니다. 새 기능도 여기에 추가하거나, 별도 컴포넌트로 분리 후 import.
3. **isMobile 분기** — 모바일(768px 미만)과 데스크탑 UI가 일부 다릅니다. 새 UI도 동일하게 분기 필요.
4. **서버 API 없음** — DB 없이 순수 클라이언트 상태만 있습니다. 로그 수집은 외부 서비스(Mixpanel, PostHog, Google Analytics 등) SDK 삽입 또는 `/api/log` 엔드포인트 신규 추가로 구현.
5. **환경변수** — Vercel에 `GOOGLE_MAPS_KEY`만 설정됨. 추가 키(분석툴 등) 필요 시 동일하게 Vercel에 추가.

---

## 현재 브랜치 상태

- Branch: `claude/stoic-faraday-gkdj72`
- 최신 커밋: `39a05e9` — mobile touch drag, compact header, no-overlap timeline, category deselect, notFound kind pool
- PR 없음, main 미머지 상태

작업 완료 후 `main`으로 PR 또는 직접 머지 필요.
