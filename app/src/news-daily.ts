import type {ReaderEdition} from './news-reader-contract.ts';

export function beijingDate(at = Date.now()) {
  return new Date(at + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function dailyCutoffDate(at = Date.now()) {
  // Beijing 08:00 is UTC midnight.
  return new Date(at).toISOString().slice(0, 10);
}

export function dailyEditions(editions: ReaderEdition[]) {
  return editions.filter(e => e.kind === 'daily').sort((a, b) =>
    b.date.localeCompare(a.date) || b.generatedAt.localeCompare(a.generatedAt) || b.id.localeCompare(a.id));
}

export function editionVersion(edition: ReaderEdition, editions: ReaderEdition[]) {
  const versions = dailyEditions(editions).filter(e => e.date === edition.date);
  return versions.length - versions.findIndex(e => e.id === edition.id);
}
