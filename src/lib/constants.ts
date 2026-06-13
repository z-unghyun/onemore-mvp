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
  '놀거리': ['영화','연극','스포츠'],
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

export const INITIAL_ITEMS: TimelineItem[] = [];

export const COUPLE_NAME = '민준 ♥ 서연';

export const REGIONS: Array<{ name: string; sub: string }> = [
  { name: '강남',    sub: '다이닝 · 루프톱 핫플' },
  { name: '을지로3가', sub: '노포 · 힙한 골목' },
  { name: '성수',    sub: '카페 · 편집숍 천국' },
  { name: '홍대',    sub: '공연 · 라이브 무드' },
  { name: '한남',    sub: '갤러리 · 브런치' },
  { name: '연남',    sub: '산책 · 데이트 코스' },
];

export const REGION_COORDS: Record<string, { lat: number; lng: number }> = {
  '강남':    { lat: 37.4979, lng: 127.0276 },
  '을지로3가': { lat: 37.5663, lng: 126.9931 },
  '성수':    { lat: 37.5447, lng: 127.0557 },
  '홍대':    { lat: 37.5543, lng: 126.9228 },
  '한남':    { lat: 37.5344, lng: 127.0010 },
  '연남':    { lat: 37.5593, lng: 126.9234 },
};
