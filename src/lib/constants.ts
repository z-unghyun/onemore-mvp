import type { TimelineItem } from './types';

export const HOURH = 64;
export const START = 540;
export const HOURS = 16;
export const ENDM = 1500;

export const DATES = ['6월 18일 목', '6월 19일 금', '6월 20일 토'];

export const WALKS = [5, 3, 8, 11, 7];

export const CAT: Record<string, string[]> = {
  '식사': ['한식','양식','일식','중식','아시아','멕시칸','회/해물','안주'],
  '카페': ['디저트','브런치','베이커리','로스터리'],
  '놀거리': ['영화','만화','연극','스포츠'],
};

export const NAMES: Record<string, string[]> = {
  '한식': ['수라간','담백 한정식','한상차림'],
  '양식': ['라 트라토리아','보떼가 오스테리아','일 지오노'],
  '일식': ['스시 오마카세','라멘 타로','이자카야 사쿠라'],
  '중식': ['홍콩반점','쉐프의 딤섬','베이징 덕'],
  '아시아': ['탁시 타이','포 사이공','인도의 향'],
  '멕시칸': ['칸쿤 타코','살사 바','엘 브라보'],
  '회/해물': ['신선한 수산','동해바다','해물포차'],
  '안주': ['막걸리 한 잔','도깨비 호프','포차 골목'],
  '디저트': ['달달한 순간','쁘띠 가토','슈크림 팩토리'],
  '브런치': ['모닝 테이블','에그 앤 브레드','선샤인 브런치'],
  '베이커리': ['르 빵','우리밀 베이커리','크루아상 하우스'],
  '로스터리': ['핸드드립 연구소','커피 리퍼블릭','원두 공방'],
  '영화': ['CGV 강남','메가박스 코엑스','롯데시네마'],
  '만화': ['만화의 집','코믹스 라운지','그림 한 컷'],
  '연극': ['소극장 블루','드라마 하우스','아트홀 오'],
  '스포츠': ['클라이밍 짐','볼링 킹','야구 배팅장'],
};

export const KIND: Record<string, { bar: string; tint: string; num: string; numText: string; sheet: string; label: string }> = {
  '식사': { bar:'#8E97F2', tint:'#E8EAFF', num:'#E3E5FF', numText:'#5560CC', sheet:'#EEF0FB', label:'식사' },
  '카페': { bar:'#5FC98C', tint:'#DAF3E4', num:'#D2F0DD', numText:'#2E9460', sheet:'#E7F6EE', label:'카페' },
  '놀거리': { bar:'#F4A65C', tint:'#FCEAD3', num:'#FCE3C4', numText:'#C97A2E', sheet:'#FCF1E3', label:'놀거리' },
};

export const PRICE: Record<string, number> = {
  '식사': 46000,
  '카페': 13000,
  '놀거리': 28000,
};

export const INITIAL_ITEMS: TimelineItem[] = [
  { id: 1, kind: '식사', category: '양식', start: 1080, end: 1170, placeIdx: 0 },
  { id: 2, kind: '놀거리', category: '영화', start: 1200, end: 1320, placeIdx: 0 },
  { id: 3, kind: '카페', category: '디저트', start: 1335, end: 1395, placeIdx: 0 },
];

export const COUPLE_NAME = '민준 ♥ 서연';

export const REGIONS = ['강남', '을지로3가', '성수', '홍대', '한남', '연남'];
