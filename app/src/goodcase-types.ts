export const categoryNames = { video:'视频', image:'图像', web:'编程', hardware:'硬件' } as const;
export type GoodcaseCategory = keyof typeof categoryNames;
export type GoodcaseSort = 'heat' | 'stability' | 'latest';
export type GoodcaseView = 'rankings' | 'models' | 'skills' | 'creators' | 'daily' | 'favorites';
export interface GoodcaseItem {
  slug:string; title:string; category:GoodcaseCategory; mediaType?:string; mediaUrl?:string; posterUrl?:string; thumbnailUrl?:string;
  url?:string; sourceUrl?:string; creator?:string; source?:string; model?:string; recommendedModels?:string[];
  summary?:string; text?:string; promptFull?:string; promptPreview?:string; promptTranslationZh?:string;
  currentHeatScore?:number; sourceHeatScore?:number; stabilityScore?:number; createdAt?:string; evidenceLevel?:string; costBand?:string;
  retest?:{total:number;reproduced:number}; provenance?:{verifiedAgainstSource?:boolean};
}
export interface GoodcaseInfo {title:string;url:string;category:string;text:string;summary?:string;posterUrl?:string}
export interface GoodcaseGroup {key:string;label:string;rows:{media:GoodcaseItem;href:string;subline:string}[]}
export interface GoodcaseRanking {category:GoodcaseCategory;sort:GoodcaseSort;page:number;items:GoodcaseItem[];total:number;hasMore:boolean;url:string}
export interface GoodcaseSnapshot {
  capturedAt:string; heat:GoodcaseGroup[]; stability:GoodcaseGroup[]; weekly:GoodcaseItem[];
  models:GoodcaseInfo[]; skills:GoodcaseInfo[]; creators:GoodcaseInfo[]; dailyCases:GoodcaseItem[]; cases:GoodcaseItem[];
  rankings:Record<GoodcaseCategory,Record<GoodcaseSort,GoodcaseRanking>>;
}
export interface GoodcaseSnapshotEntry {id:string;capturedAt:string;itemCount:number}
export interface GoodcaseRetests {count?:number;byModel?:{model:string;latest?:{verdict?:string;automaticOnly?:boolean;finalScore?:number;testedAt?:string;failureReason?:string}}[]}
